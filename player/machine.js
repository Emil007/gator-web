/** GB machine — memory, SM83 helpers, timers, LY/STAT, interrupt dispatch. */

import { createDecodeStep } from "./decode.js";

const CYCLES_PER_LINE = 456;
const LINES_PER_FRAME = 154;
export const CYCLES_PER_FRAME = CYCLES_PER_LINE * LINES_PER_FRAME; // 70224

export function createMachine(romBytes) {
  const rom = romBytes;
  const vram = new Uint8Array(0x2000);
  const wram = new Uint8Array(0x2000);
  const oam = new Uint8Array(0xa0);
  const hram = new Uint8Array(0x7f);
  const io = new Uint8Array(0x80);

  let romBank = 1;
  let ie = 0;
  let div = 0; // 16-bit internal DIV counter
  let timaReload = 0;
  let lineCycles = 0;
  let ly = 0;
  let statMode = 1; // VBlank at start post-boot-ish; we'll set properly
  let imeScheduled = 0; // EI delay

  const r = {
    a: 0x01,
    b: 0x00,
    c: 0x13,
    d: 0x00,
    e: 0xd8,
    h: 0x01,
    l: 0x4d,
    fz: 1,
    fn: 0,
    fh: 1,
    fc: 1,
    get f() {
      return (this.fz << 7) | (this.fn << 6) | (this.fh << 5) | (this.fc << 4);
    },
    set f(v) {
      this.fz = (v >> 7) & 1;
      this.fn = (v >> 6) & 1;
      this.fh = (v >> 5) & 1;
      this.fc = (v >> 4) & 1;
    },
    get bc() {
      return (this.b << 8) | this.c;
    },
    set bc(v) {
      this.b = (v >> 8) & 0xff;
      this.c = v & 0xff;
    },
    get de() {
      return (this.d << 8) | this.e;
    },
    set de(v) {
      this.d = (v >> 8) & 0xff;
      this.e = v & 0xff;
    },
    get hl() {
      return (this.h << 8) | this.l;
    },
    set hl(v) {
      this.h = (v >> 8) & 0xff;
      this.l = v & 0xff;
    },
    sp: 0xfffe,
    pc: 0x0100,
    ime: 0,
    halted: 0,
  };

  io[0x00] = 0xcf;
  io[0x05] = 0x00;
  io[0x06] = 0x00;
  io[0x07] = 0xf8;
  io[0x0f] = 0xe0;
  io[0x40] = 0x91;
  io[0x41] = 0x85;
  io[0x42] = 0x00;
  io[0x43] = 0x00;
  io[0x44] = 0x00;
  io[0x45] = 0x00;
  io[0x47] = 0xfc;
  io[0x48] = 0xff;
  io[0x49] = 0xff;

  let joypadButtons = 0xff;
  let joypadDp = 0xff;

  function setJoypad({ left, right, up, down, a, b, start, select }) {
    let dp = 0xff;
    let btn = 0xff;
    if (right) dp &= ~0x01;
    if (left) dp &= ~0x02;
    if (up) dp &= ~0x04;
    if (down) dp &= ~0x08;
    if (a) btn &= ~0x01;
    if (b) btn &= ~0x02;
    if (select) btn &= ~0x04;
    if (start) btn &= ~0x08;
    joypadDp = dp;
    joypadButtons = btn;
  }

  function requestInterrupt(bit) {
    io[0x0f] |= bit;
    if (r.halted) r.halted = 0;
  }

  function updateStatMode(mode) {
    statMode = mode;
    io[0x41] = (io[0x41] & 0xf8) | (mode & 7);
    const stat = io[0x41];
    // mode interrupts
    if (mode === 0 && stat & 0x08) requestInterrupt(0x02);
    if (mode === 1 && stat & 0x10) requestInterrupt(0x02);
    if (mode === 2 && stat & 0x20) requestInterrupt(0x02);
  }

  function checkLyc() {
    const lyc = io[0x45];
    const match = ly === lyc;
    if (match) io[0x41] |= 0x04;
    else io[0x41] &= ~0x04;
    if (match && io[0x41] & 0x40) requestInterrupt(0x02);
  }

  function advanceDots(dots) {
    // DIV: increments at 16384 Hz = every 256 T-cycles
    div = (div + dots) & 0xffff;
    io[0x04] = (div >> 8) & 0xff;

    // Timer
    const tac = io[0x07];
    if (tac & 0x04) {
      const freqs = [1024, 16, 64, 256]; // T-cycles per TIMA tick
      const period = freqs[tac & 3];
      // crude: accumulate via div edge — use lineCycles-style local
      // Better: track timer counter
      advanceTimer(dots, period);
    }

    if (timaReload > 0) {
      timaReload -= dots;
      if (timaReload <= 0) {
        io[0x05] = io[0x06];
        requestInterrupt(0x04);
        timaReload = 0;
      }
    }

    const lcdOn = io[0x40] & 0x80;
    if (!lcdOn) {
      // LY frozen at 0 while LCD off, but DIV/timer still run (handled above)
      ly = 0;
      io[0x44] = 0;
      lineCycles = 0;
      updateStatMode(0);
      return;
    }

    lineCycles += dots;
    while (lineCycles >= CYCLES_PER_LINE) {
      lineCycles -= CYCLES_PER_LINE;
      ly++;
      if (ly === 144) {
        requestInterrupt(0x01); // VBlank
        updateStatMode(1);
      }
      if (ly >= LINES_PER_FRAME) ly = 0;
      io[0x44] = ly;
      checkLyc();
    }

    // mode within line
    if (ly >= 144) {
      updateStatMode(1);
    } else if (lineCycles < 80) {
      updateStatMode(2); // OAM
    } else if (lineCycles < 80 + 172) {
      updateStatMode(3); // transfer
    } else {
      updateStatMode(0); // HBlank
    }
  }

  let timerAcc = 0;
  function advanceTimer(dots, period) {
    timerAcc += dots;
    while (timerAcc >= period) {
      timerAcc -= period;
      const t = io[0x05] + 1;
      if (t > 0xff) {
        io[0x05] = 0; // overflow; reload after 1 M-cycle delay
        timaReload = 4;
      } else {
        io[0x05] = t;
      }
    }
  }

  function rd(addr) {
    addr &= 0xffff;
    if (addr < 0x4000) return rom[addr];
    if (addr < 0x8000) {
      const b = romBank || 1;
      return rom[(b & 0x1f) * 0x4000 + (addr - 0x4000)];
    }
    if (addr < 0xa000) return vram[addr - 0x8000];
    if (addr < 0xc000) return 0xff;
    if (addr < 0xe000) return wram[addr - 0xc000];
    if (addr < 0xfe00) return wram[addr - 0xe000];
    if (addr < 0xfea0) return oam[addr - 0xfe00];
    if (addr < 0xff00) return 0xff;
    if (addr === 0xff00) {
      const sel = io[0x00] & 0x30;
      let v = 0xc0 | sel;
      if (!(sel & 0x10)) v |= joypadDp & 0x0f;
      else if (!(sel & 0x20)) v |= joypadButtons & 0x0f;
      else v |= 0x0f;
      return v;
    }
    if (addr === 0xff04) return (div >> 8) & 0xff;
    if (addr === 0xff44) return ly;
    if (addr < 0xff80) return io[addr - 0xff00];
    if (addr < 0xffff) return hram[addr - 0xff80];
    return ie;
  }

  function wr(addr, val) {
    addr &= 0xffff;
    val &= 0xff;
    if (addr < 0x2000) return;
    if (addr < 0x4000) {
      romBank = val & 0x1f;
      if (romBank === 0) romBank = 1;
      return;
    }
    if (addr < 0x8000) return;
    if (addr < 0xa000) {
      vram[addr - 0x8000] = val;
      return;
    }
    if (addr < 0xc000) return;
    if (addr < 0xe000) {
      wram[addr - 0xc000] = val;
      return;
    }
    if (addr < 0xfe00) {
      wram[addr - 0xe000] = val;
      return;
    }
    if (addr < 0xfea0) {
      oam[addr - 0xfe00] = val;
      return;
    }
    if (addr < 0xff00) return;
    if (addr < 0xff80) {
      if (addr === 0xff04) {
        div = 0;
        return;
      }
      if (addr === 0xff07) {
        io[0x07] = val;
        return;
      }
      if (addr === 0xff0f) {
        io[0x0f] = 0xe0 | (val & 0x1f);
        return;
      }
      if (addr === 0xff41) {
        io[0x41] = (io[0x41] & 0x07) | (val & 0x78);
        return;
      }
      if (addr === 0xff44) return; // LY read-only
      if (addr === 0xff46) {
        const src = val << 8;
        for (let i = 0; i < 0xa0; i++) oam[i] = rd(src + i);
        return;
      }
      io[addr - 0xff00] = val;
      if (addr === 0xff45) checkLyc();
      return;
    }
    if (addr < 0xffff) {
      hram[addr - 0xff80] = val;
      return;
    }
    ie = val;
  }

  function wr16abs(addr, v) {
    wr(addr, v & 0xff);
    wr((addr + 1) & 0xffff, (v >> 8) & 0xff);
  }
  function push16(v) {
    r.sp = (r.sp - 1) & 0xffff;
    wr(r.sp, (v >> 8) & 0xff);
    r.sp = (r.sp - 1) & 0xffff;
    wr(r.sp, v & 0xff);
  }
  function pop16() {
    const lo = rd(r.sp);
    r.sp = (r.sp + 1) & 0xffff;
    const hi = rd(r.sp);
    r.sp = (r.sp + 1) & 0xffff;
    return (hi << 8) | lo;
  }
  function push_af() {
    push16((r.a << 8) | r.f);
  }
  function pop_af() {
    const v = pop16();
    r.a = v >> 8;
    r.f = v & 0xf0;
  }

  function inc8(v) {
    const n = (v + 1) & 0xff;
    r.fz = n === 0 ? 1 : 0;
    r.fn = 0;
    r.fh = (v & 0xf) === 0xf ? 1 : 0;
    return n;
  }
  function dec8(v) {
    const n = (v - 1) & 0xff;
    r.fz = n === 0 ? 1 : 0;
    r.fn = 1;
    r.fh = (v & 0xf) === 0 ? 1 : 0;
    return n;
  }
  function add_a(v) {
    const a = r.a,
      s = a + v;
    r.a = s & 0xff;
    r.fz = r.a === 0 ? 1 : 0;
    r.fn = 0;
    r.fh = (a & 0xf) + (v & 0xf) > 0xf ? 1 : 0;
    r.fc = s > 0xff ? 1 : 0;
  }
  function adc_a(v) {
    const a = r.a,
      s = a + v + r.fc;
    r.a = s & 0xff;
    r.fz = r.a === 0 ? 1 : 0;
    r.fn = 0;
    r.fh = (a & 0xf) + (v & 0xf) + r.fc > 0xf ? 1 : 0;
    r.fc = s > 0xff ? 1 : 0;
  }
  function sub_a(v) {
    const a = r.a,
      s = a - v;
    r.a = s & 0xff;
    r.fz = r.a === 0 ? 1 : 0;
    r.fn = 1;
    r.fh = (a & 0xf) - (v & 0xf) < 0 ? 1 : 0;
    r.fc = s < 0 ? 1 : 0;
  }
  function sbc_a(v) {
    const a = r.a,
      s = a - v - r.fc;
    r.a = s & 0xff;
    r.fz = r.a === 0 ? 1 : 0;
    r.fn = 1;
    r.fh = (a & 0xf) - (v & 0xf) - r.fc < 0 ? 1 : 0;
    r.fc = s < 0 ? 1 : 0;
  }
  function and_a(v) {
    r.a &= v;
    r.fz = r.a === 0 ? 1 : 0;
    r.fn = 0;
    r.fh = 1;
    r.fc = 0;
  }
  function xor_a(v) {
    r.a ^= v;
    r.fz = r.a === 0 ? 1 : 0;
    r.fn = 0;
    r.fh = 0;
    r.fc = 0;
  }
  function or_a(v) {
    r.a |= v;
    r.fz = r.a === 0 ? 1 : 0;
    r.fn = 0;
    r.fh = 0;
    r.fc = 0;
  }
  function cp_a(v) {
    const a = r.a,
      s = a - v;
    r.fz = (s & 0xff) === 0 ? 1 : 0;
    r.fn = 1;
    r.fh = (a & 0xf) - (v & 0xf) < 0 ? 1 : 0;
    r.fc = s < 0 ? 1 : 0;
  }
  function add_hl(v) {
    const hl = r.hl,
      s = hl + v;
    r.fn = 0;
    r.fh = (hl & 0xfff) + (v & 0xfff) > 0xfff ? 1 : 0;
    r.fc = s > 0xffff ? 1 : 0;
    r.hl = s & 0xffff;
  }
  function add_sp(n) {
    const off = n < 0x80 ? n : n - 0x100;
    const sp = r.sp,
      s = sp + off;
    r.fz = 0;
    r.fn = 0;
    r.fh = (sp & 0xf) + (off & 0xf) > 0xf ? 1 : 0;
    r.fc = (sp & 0xff) + (off & 0xff) > 0xff ? 1 : 0;
    r.sp = s & 0xffff;
  }
  function ld_hl_sp(n) {
    const off = n < 0x80 ? n : n - 0x100;
    const sp = r.sp,
      s = sp + off;
    r.fz = 0;
    r.fn = 0;
    r.fh = (sp & 0xf) + (off & 0xf) > 0xf ? 1 : 0;
    r.fc = (sp & 0xff) + (off & 0xff) > 0xff ? 1 : 0;
    r.hl = s & 0xffff;
  }
  function rlca() {
    const c = (r.a >> 7) & 1;
    r.a = ((r.a << 1) | c) & 0xff;
    r.fz = 0;
    r.fn = 0;
    r.fh = 0;
    r.fc = c;
  }
  function rrca() {
    const c = r.a & 1;
    r.a = ((r.a >> 1) | (c << 7)) & 0xff;
    r.fz = 0;
    r.fn = 0;
    r.fh = 0;
    r.fc = c;
  }
  function rla() {
    const c = (r.a >> 7) & 1;
    r.a = ((r.a << 1) | r.fc) & 0xff;
    r.fz = 0;
    r.fn = 0;
    r.fh = 0;
    r.fc = c;
  }
  function rra() {
    const c = r.a & 1;
    r.a = ((r.a >> 1) | (r.fc << 7)) & 0xff;
    r.fz = 0;
    r.fn = 0;
    r.fh = 0;
    r.fc = c;
  }
  function daa() {
    let a = r.a;
    if (!r.fn) {
      if (r.fc || a > 0x99) {
        a = (a + 0x60) & 0xff;
        r.fc = 1;
      }
      if (r.fh || (a & 0xf) > 9) a = (a + 0x06) & 0xff;
    } else {
      if (r.fc) a = (a - 0x60) & 0xff;
      if (r.fh) a = (a - 0x06) & 0xff;
    }
    r.a = a;
    r.fz = a === 0 ? 1 : 0;
    r.fh = 0;
  }
  function rlc(v) {
    const c = (v >> 7) & 1;
    const n = ((v << 1) | c) & 0xff;
    r.fz = n === 0 ? 1 : 0;
    r.fn = 0;
    r.fh = 0;
    r.fc = c;
    return n;
  }
  function rrc(v) {
    const c = v & 1;
    const n = ((v >> 1) | (c << 7)) & 0xff;
    r.fz = n === 0 ? 1 : 0;
    r.fn = 0;
    r.fh = 0;
    r.fc = c;
    return n;
  }
  function rl(v) {
    const c = (v >> 7) & 1;
    const n = ((v << 1) | r.fc) & 0xff;
    r.fz = n === 0 ? 1 : 0;
    r.fn = 0;
    r.fh = 0;
    r.fc = c;
    return n;
  }
  function rr(v) {
    const c = v & 1;
    const n = ((v >> 1) | (r.fc << 7)) & 0xff;
    r.fz = n === 0 ? 1 : 0;
    r.fn = 0;
    r.fh = 0;
    r.fc = c;
    return n;
  }
  function sla(v) {
    const c = (v >> 7) & 1;
    const n = (v << 1) & 0xff;
    r.fz = n === 0 ? 1 : 0;
    r.fn = 0;
    r.fh = 0;
    r.fc = c;
    return n;
  }
  function sra(v) {
    const c = v & 1;
    const n = ((v >> 1) | (v & 0x80)) & 0xff;
    r.fz = n === 0 ? 1 : 0;
    r.fn = 0;
    r.fh = 0;
    r.fc = c;
    return n;
  }
  function swap(v) {
    const n = ((v << 4) | (v >> 4)) & 0xff;
    r.fz = n === 0 ? 1 : 0;
    r.fn = 0;
    r.fh = 0;
    r.fc = 0;
    return n;
  }
  function srl(v) {
    const c = v & 1;
    const n = (v >> 1) & 0xff;
    r.fz = n === 0 ? 1 : 0;
    r.fn = 0;
    r.fh = 0;
    r.fc = c;
    return n;
  }
  function bit(b, v) {
    r.fz = ((v >> b) & 1) === 0 ? 1 : 0;
    r.fn = 0;
    r.fh = 1;
  }
  function res(b, v) {
    return v & ~(1 << b);
  }
  function set(b, v) {
    return v | (1 << b);
  }
  function stopcpu() {
    r.halted = 1;
  }
  function ei() {
    imeScheduled = 1;
  }

  const IRQ_VEC = [0x40, 0x48, 0x50, 0x58, 0x60];

  function checkInterrupts() {
    if (imeScheduled) {
      r.ime = 1;
      imeScheduled = 0;
    }
    const pending = io[0x0f] & ie & 0x1f;
    if (!pending) return 0;
    if (r.halted) r.halted = 0;
    if (!r.ime) return 0;
    for (let i = 0; i < 5; i++) {
      const mask = 1 << i;
      if (pending & mask) {
        r.ime = 0;
        io[0x0f] &= ~mask;
        push16(r.pc);
        r.pc = IRQ_VEC[i];
        return 5; // interrupt entry M-cycles (approx)
      }
    }
    return 0;
  }

  const api = {
    r,
    rd,
    wr,
    wr16abs,
    push16,
    pop16,
    push_af,
    pop_af,
    inc8,
    dec8,
    add_a,
    adc_a,
    sub_a,
    sbc_a,
    and_a,
    xor_a,
    or_a,
    cp_a,
    add_hl,
    add_sp,
    ld_hl_sp,
    rlca,
    rrca,
    rla,
    rra,
    daa,
    rlc,
    rrc,
    rl,
    rr,
    sla,
    sra,
    swap,
    srl,
    bit,
    res,
    set,
    stopcpu,
    ei,
    romBank: () => romBank,
    setJoypad,
    advanceDots,
    checkInterrupts,
    getLY: () => ly,
    vram,
    oam,
    io,
    wram,
    hram,
    getRomBank: () => romBank,
  };
  api.decodeStep = createDecodeStep(api);
  return api;
}
