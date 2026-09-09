/**
 * Full SM83 one-step decoder — primary CPU path for the dynamic runtime.
 */
export function createDecodeStep(M) {
  const {
    r, rd, wr, push16, pop16, push_af, pop_af,
    inc8, dec8, add_a, adc_a, sub_a, sbc_a, and_a, xor_a, or_a, cp_a,
    add_hl, add_sp, ld_hl_sp, rlca, rrca, rla, rra, daa,
    rlc, rrc, rl, rr, sla, sra, swap, srl, bit, res, set,
    stopcpu, ei,
  } = M;

  const regR = [
    () => r.b, () => r.c, () => r.d, () => r.e,
    () => r.h, () => r.l, () => rd(r.hl), () => r.a,
  ];
  const regW = [
    (v) => { r.b = v; }, (v) => { r.c = v; }, (v) => { r.d = v; }, (v) => { r.e = v; },
    (v) => { r.h = v; }, (v) => { r.l = v; }, (v) => { wr(r.hl, v); }, (v) => { r.a = v; },
  ];

  return function decodeStep() {
    const pc0 = r.pc;
    const op = rd(pc0);
    let jp = -1;
    let m = 1;

    const fetch8 = () => {
      const v = rd(r.pc);
      r.pc = (r.pc + 1) & 0xffff;
      return v;
    };
    const fetch16 = () => fetch8() | (fetch8() << 8);
    const rel = (n) => {
      const off = n < 0x80 ? n : n - 0x100;
      return (r.pc + off) & 0xffff;
    };

    r.pc = (pc0 + 1) & 0xffff;

    if (op === 0xcb) {
      const cb = fetch8();
      const ri = cb & 7;
      const g = cb >> 3;
      if (g < 8) {
        const fns = [rlc, rrc, rl, rr, sla, sra, swap, srl];
        regW[ri](fns[g](regR[ri]()));
        m = ri === 6 ? 4 : 2;
      } else if (g < 16) {
        bit(g - 8, regR[ri]());
        m = ri === 6 ? 3 : 2;
      } else if (g < 24) {
        regW[ri](res(g - 16, regR[ri]()));
        m = ri === 6 ? 4 : 2;
      } else {
        regW[ri](set(g - 24, regR[ri]()));
        m = ri === 6 ? 4 : 2;
      }
      return m;
    }

    switch (op) {
      case 0x00: m = 1; break;
      case 0x01: r.bc = fetch16(); m = 3; break;
      case 0x02: wr(r.bc, r.a); m = 2; break;
      case 0x03: r.bc = (r.bc + 1) & 0xffff; m = 2; break;
      case 0x04: r.b = inc8(r.b); m = 1; break;
      case 0x05: r.b = dec8(r.b); m = 1; break;
      case 0x06: r.b = fetch8(); m = 2; break;
      case 0x07: rlca(); m = 1; break;
      case 0x08: {
        const a = fetch16();
        wr(a, r.sp & 0xff);
        wr((a + 1) & 0xffff, r.sp >> 8);
        m = 5;
        break;
      }
      case 0x09: add_hl(r.bc); m = 2; break;
      case 0x0a: r.a = rd(r.bc); m = 2; break;
      case 0x0b: r.bc = (r.bc - 1) & 0xffff; m = 2; break;
      case 0x0c: r.c = inc8(r.c); m = 1; break;
      case 0x0d: r.c = dec8(r.c); m = 1; break;
      case 0x0e: r.c = fetch8(); m = 2; break;
      case 0x0f: rrca(); m = 1; break;
      case 0x10: fetch8(); stopcpu(); m = 1; break;
      case 0x11: r.de = fetch16(); m = 3; break;
      case 0x12: wr(r.de, r.a); m = 2; break;
      case 0x13: r.de = (r.de + 1) & 0xffff; m = 2; break;
      case 0x14: r.d = inc8(r.d); m = 1; break;
      case 0x15: r.d = dec8(r.d); m = 1; break;
      case 0x16: r.d = fetch8(); m = 2; break;
      case 0x17: rla(); m = 1; break;
      case 0x18: jp = rel(fetch8()); m = 3; break;
      case 0x19: add_hl(r.de); m = 2; break;
      case 0x1a: r.a = rd(r.de); m = 2; break;
      case 0x1b: r.de = (r.de - 1) & 0xffff; m = 2; break;
      case 0x1c: r.e = inc8(r.e); m = 1; break;
      case 0x1d: r.e = dec8(r.e); m = 1; break;
      case 0x1e: r.e = fetch8(); m = 2; break;
      case 0x1f: rra(); m = 1; break;
      case 0x20: { const n = fetch8(); if (!r.fz) jp = rel(n); m = 3; break; }
      case 0x21: r.hl = fetch16(); m = 3; break;
      case 0x22: wr(r.hl, r.a); r.hl = (r.hl + 1) & 0xffff; m = 2; break;
      case 0x23: r.hl = (r.hl + 1) & 0xffff; m = 2; break;
      case 0x24: r.h = inc8(r.h); m = 1; break;
      case 0x25: r.h = dec8(r.h); m = 1; break;
      case 0x26: r.h = fetch8(); m = 2; break;
      case 0x27: daa(); m = 1; break;
      case 0x28: { const n = fetch8(); if (r.fz) jp = rel(n); m = 3; break; }
      case 0x29: add_hl(r.hl); m = 2; break;
      case 0x2a: r.a = rd(r.hl); r.hl = (r.hl + 1) & 0xffff; m = 2; break;
      case 0x2b: r.hl = (r.hl - 1) & 0xffff; m = 2; break;
      case 0x2c: r.l = inc8(r.l); m = 1; break;
      case 0x2d: r.l = dec8(r.l); m = 1; break;
      case 0x2e: r.l = fetch8(); m = 2; break;
      case 0x2f: r.a ^= 0xff; r.fn = 1; r.fh = 1; m = 1; break;
      case 0x30: { const n = fetch8(); if (!r.fc) jp = rel(n); m = 3; break; }
      case 0x31: r.sp = fetch16(); m = 3; break;
      case 0x32: wr(r.hl, r.a); r.hl = (r.hl - 1) & 0xffff; m = 2; break;
      case 0x33: r.sp = (r.sp + 1) & 0xffff; m = 2; break;
      case 0x34: wr(r.hl, inc8(rd(r.hl))); m = 3; break;
      case 0x35: wr(r.hl, dec8(rd(r.hl))); m = 3; break;
      case 0x36: wr(r.hl, fetch8()); m = 3; break;
      case 0x37: r.fc = 1; r.fn = 0; r.fh = 0; m = 1; break;
      case 0x38: { const n = fetch8(); if (r.fc) jp = rel(n); m = 3; break; }
      case 0x39: add_hl(r.sp); m = 2; break;
      case 0x3a: r.a = rd(r.hl); r.hl = (r.hl - 1) & 0xffff; m = 2; break;
      case 0x3b: r.sp = (r.sp - 1) & 0xffff; m = 2; break;
      case 0x3c: r.a = inc8(r.a); m = 1; break;
      case 0x3d: r.a = dec8(r.a); m = 1; break;
      case 0x3e: r.a = fetch8(); m = 2; break;
      case 0x3f: r.fc ^= 1; r.fn = 0; r.fh = 0; m = 1; break;
      default:
        break;
    }

    if (op >= 0x40 && op <= 0x7f) {
      if (op === 0x76) {
        r.halted = 1;
        m = 1;
      } else {
        const rdn = (op >> 3) & 7;
        const rs = op & 7;
        regW[rdn](regR[rs]());
        m = rdn === 6 || rs === 6 ? 2 : 1;
      }
    } else if (op >= 0x80 && op <= 0xbf) {
      const fns = [add_a, adc_a, sub_a, sbc_a, and_a, xor_a, or_a, cp_a];
      fns[(op >> 3) & 7](regR[op & 7]);
      m = (op & 7) === 6 ? 2 : 1;
    } else if (op >= 0xc0) {
      switch (op) {
        case 0xc0: if (!r.fz) jp = pop16(); m = 5; break;
        case 0xc1: r.bc = pop16(); m = 3; break;
        case 0xc2: { const a = fetch16(); if (!r.fz) jp = a; m = 4; break; }
        case 0xc3: jp = fetch16(); m = 4; break;
        case 0xc4: { const a = fetch16(); if (!r.fz) { push16(r.pc); jp = a; } m = 6; break; }
        case 0xc5: push16(r.bc); m = 4; break;
        case 0xc6: add_a(fetch8()); m = 2; break;
        case 0xc7: push16(r.pc); jp = 0x00; m = 4; break;
        case 0xc8: if (r.fz) jp = pop16(); m = 5; break;
        case 0xc9: jp = pop16(); m = 4; break;
        case 0xca: { const a = fetch16(); if (r.fz) jp = a; m = 4; break; }
        case 0xcc: { const a = fetch16(); if (r.fz) { push16(r.pc); jp = a; } m = 6; break; }
        case 0xcd: { const a = fetch16(); push16(r.pc); jp = a; m = 6; break; }
        case 0xce: adc_a(fetch8()); m = 2; break;
        case 0xcf: push16(r.pc); jp = 0x08; m = 4; break;
        case 0xd0: if (!r.fc) jp = pop16(); m = 5; break;
        case 0xd1: r.de = pop16(); m = 3; break;
        case 0xd2: { const a = fetch16(); if (!r.fc) jp = a; m = 4; break; }
        case 0xd4: { const a = fetch16(); if (!r.fc) { push16(r.pc); jp = a; } m = 6; break; }
        case 0xd5: push16(r.de); m = 4; break;
        case 0xd6: sub_a(fetch8()); m = 2; break;
        case 0xd7: push16(r.pc); jp = 0x10; m = 4; break;
        case 0xd8: if (r.fc) jp = pop16(); m = 5; break;
        case 0xd9: jp = pop16(); r.ime = 1; m = 4; break;
        case 0xda: { const a = fetch16(); if (r.fc) jp = a; m = 4; break; }
        case 0xdc: { const a = fetch16(); if (r.fc) { push16(r.pc); jp = a; } m = 6; break; }
        case 0xde: sbc_a(fetch8()); m = 2; break;
        case 0xdf: push16(r.pc); jp = 0x18; m = 4; break;
        case 0xe0: wr(0xff00 + fetch8(), r.a); m = 3; break;
        case 0xe1: r.hl = pop16(); m = 3; break;
        case 0xe2: wr(0xff00 + r.c, r.a); m = 2; break;
        case 0xe5: push16(r.hl); m = 4; break;
        case 0xe6: and_a(fetch8()); m = 2; break;
        case 0xe7: push16(r.pc); jp = 0x20; m = 4; break;
        case 0xe8: add_sp(fetch8()); m = 4; break;
        case 0xe9: jp = r.hl; m = 1; break;
        case 0xea: wr(fetch16(), r.a); m = 4; break;
        case 0xee: xor_a(fetch8()); m = 2; break;
        case 0xef: push16(r.pc); jp = 0x28; m = 4; break;
        case 0xf0: r.a = rd(0xff00 + fetch8()); m = 3; break;
        case 0xf1: pop_af(); m = 3; break;
        case 0xf2: r.a = rd(0xff00 + r.c); m = 2; break;
        case 0xf3: r.ime = 0; m = 1; break;
        case 0xf5: push_af(); m = 4; break;
        case 0xf6: or_a(fetch8()); m = 2; break;
        case 0xf7: push16(r.pc); jp = 0x30; m = 4; break;
        case 0xf8: ld_hl_sp(fetch8()); m = 3; break;
        case 0xf9: r.sp = r.hl; m = 2; break;
        case 0xfa: r.a = rd(fetch16()); m = 4; break;
        case 0xfb: ei(); m = 1; break;
        case 0xfe: cp_a(fetch8()); m = 2; break;
        case 0xff: push16(r.pc); jp = 0x38; m = 4; break;
        default: m = 1; break;
      }
    }

    if (jp >= 0) r.pc = jp & 0xffff;
    return m;
  };
}
