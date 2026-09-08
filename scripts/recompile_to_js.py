#!/usr/bin/env python3
"""
Flow-based SM83 → JS static recompiler with M-cycle costs.
Follows control flow from entry points so data bytes aren't decoded as code.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROM = next(p for p in (ROOT / "roms").glob("*.gb") if "Europe" in p.name and "Beta" not in p.name)
OUT = ROOT / "player" / "generated" / "recompiled.js"

# size, js_template, m_cycles (approx; conditional taken/not averaged high)
OPS: dict[int, tuple[int, str, int]] = {}
CB: dict[int, tuple[str, int]] = {}


def op(c, s, t, m=1):
    OPS[c] = (s, t, m)


def fill():
    op(0x00, 1, "", 1)
    op(0x01, 3, "r.bc={nn};", 3)
    op(0x02, 1, "wr(r.bc,r.a);", 2)
    op(0x03, 1, "r.bc=(r.bc+1)&0xffff;", 2)
    op(0x04, 1, "r.b=inc8(r.b);", 1)
    op(0x05, 1, "r.b=dec8(r.b);", 1)
    op(0x06, 2, "r.b={n};", 2)
    op(0x07, 1, "rlca();", 1)
    op(0x08, 3, "wr16abs({nn},r.sp);", 5)
    op(0x09, 1, "add_hl(r.bc);", 2)
    op(0x0A, 1, "r.a=rd(r.bc);", 2)
    op(0x0B, 1, "r.bc=(r.bc-1)&0xffff;", 2)
    op(0x0C, 1, "r.c=inc8(r.c);", 1)
    op(0x0D, 1, "r.c=dec8(r.c);", 1)
    op(0x0E, 2, "r.c={n};", 2)
    op(0x0F, 1, "rrca();", 1)
    op(0x10, 2, "stopcpu();", 1)
    op(0x11, 3, "r.de={nn};", 3)
    op(0x12, 1, "wr(r.de,r.a);", 2)
    op(0x13, 1, "r.de=(r.de+1)&0xffff;", 2)
    op(0x14, 1, "r.d=inc8(r.d);", 1)
    op(0x15, 1, "r.d=dec8(r.d);", 1)
    op(0x16, 2, "r.d={n};", 2)
    op(0x17, 1, "rla();", 1)
    op(0x18, 2, "CTRL_JP={rel};", 3)
    op(0x19, 1, "add_hl(r.de);", 2)
    op(0x1A, 1, "r.a=rd(r.de);", 2)
    op(0x1B, 1, "r.de=(r.de-1)&0xffff;", 2)
    op(0x1C, 1, "r.e=inc8(r.e);", 1)
    op(0x1D, 1, "r.e=dec8(r.e);", 1)
    op(0x1E, 2, "r.e={n};", 2)
    op(0x1F, 1, "rra();", 1)
    op(0x20, 2, "if(!r.fz)CTRL_JP={rel};", 3)
    op(0x21, 3, "r.hl={nn};", 3)
    op(0x22, 1, "wr(r.hl,r.a);r.hl=(r.hl+1)&0xffff;", 2)
    op(0x23, 1, "r.hl=(r.hl+1)&0xffff;", 2)
    op(0x24, 1, "r.h=inc8(r.h);", 1)
    op(0x25, 1, "r.h=dec8(r.h);", 1)
    op(0x26, 2, "r.h={n};", 2)
    op(0x27, 1, "daa();", 1)
    op(0x28, 2, "if(r.fz)CTRL_JP={rel};", 3)
    op(0x29, 1, "add_hl(r.hl);", 2)
    op(0x2A, 1, "r.a=rd(r.hl);r.hl=(r.hl+1)&0xffff;", 2)
    op(0x2B, 1, "r.hl=(r.hl-1)&0xffff;", 2)
    op(0x2C, 1, "r.l=inc8(r.l);", 1)
    op(0x2D, 1, "r.l=dec8(r.l);", 1)
    op(0x2E, 2, "r.l={n};", 2)
    op(0x2F, 1, "r.a^=0xff;r.fn=1;r.fh=1;", 1)
    op(0x30, 2, "if(!r.fc)CTRL_JP={rel};", 3)
    op(0x31, 3, "r.sp={nn};", 3)
    op(0x32, 1, "wr(r.hl,r.a);r.hl=(r.hl-1)&0xffff;", 2)
    op(0x33, 1, "r.sp=(r.sp+1)&0xffff;", 2)
    op(0x34, 1, "wr(r.hl,inc8(rd(r.hl)));", 3)
    op(0x35, 1, "wr(r.hl,dec8(rd(r.hl)));", 3)
    op(0x36, 2, "wr(r.hl,{n});", 3)
    op(0x37, 1, "r.fc=1;r.fn=0;r.fh=0;", 1)
    op(0x38, 2, "if(r.fc)CTRL_JP={rel};", 3)
    op(0x39, 1, "add_hl(r.sp);", 2)
    op(0x3A, 1, "r.a=rd(r.hl);r.hl=(r.hl-1)&0xffff;", 2)
    op(0x3B, 1, "r.sp=(r.sp-1)&0xffff;", 2)
    op(0x3C, 1, "r.a=inc8(r.a);", 1)
    op(0x3D, 1, "r.a=dec8(r.a);", 1)
    op(0x3E, 2, "r.a={n};", 2)
    op(0x3F, 1, "r.fc^=1;r.fn=0;r.fh=0;", 1)
    regs = ["r.b", "r.c", "r.d", "r.e", "r.h", "r.l", None, "r.a"]
    for i, rdn in enumerate(regs):
        for j, rs in enumerate(regs):
            code = 0x40 + i * 8 + j
            if code == 0x76:
                op(0x76, 1, "CTRL_HALT=1;", 1)
                continue
            src = "rd(r.hl)" if rs is None else rs
            m = 2 if (rdn is None or rs is None) else 1
            if rdn is None:
                op(code, 1, f"wr(r.hl,{src});", m)
            else:
                op(code, 1, f"{rdn}={src};", m)
    for ai, fn in enumerate(["add_a", "adc_a", "sub_a", "sbc_a", "and_a", "xor_a", "or_a", "cp_a"]):
        for j, rs in enumerate(regs):
            src = "rd(r.hl)" if rs is None else rs
            op(0x80 + ai * 8 + j, 1, f"{fn}({src});", 2 if rs is None else 1)
    pairs = [
        (0xC0, 1, "if(!r.fz){CTRL_JP=pop16();}", 5),
        (0xC1, 1, "r.bc=pop16();", 3),
        (0xC2, 3, "if(!r.fz)CTRL_JP={nn};", 4),
        (0xC3, 3, "CTRL_JP={nn};", 4),
        (0xC4, 3, "if(!r.fz){push16(NEXT);CTRL_JP={nn};}", 6),
        (0xC5, 1, "push16(r.bc);", 4),
        (0xC6, 2, "add_a({n});", 2),
        (0xC7, 1, "push16(NEXT);CTRL_JP=0x00;", 4),
        (0xC8, 1, "if(r.fz){CTRL_JP=pop16();}", 5),
        (0xC9, 1, "CTRL_JP=pop16();", 4),
        (0xCA, 3, "if(r.fz)CTRL_JP={nn};", 4),
        (0xCC, 3, "if(r.fz){push16(NEXT);CTRL_JP={nn};}", 6),
        (0xCD, 3, "push16(NEXT);CTRL_JP={nn};", 6),
        (0xCE, 2, "adc_a({n});", 2),
        (0xCF, 1, "push16(NEXT);CTRL_JP=0x08;", 4),
        (0xD0, 1, "if(!r.fc){CTRL_JP=pop16();}", 5),
        (0xD1, 1, "r.de=pop16();", 3),
        (0xD2, 3, "if(!r.fc)CTRL_JP={nn};", 4),
        (0xD4, 3, "if(!r.fc){push16(NEXT);CTRL_JP={nn};}", 6),
        (0xD5, 1, "push16(r.de);", 4),
        (0xD6, 2, "sub_a({n});", 2),
        (0xD7, 1, "push16(NEXT);CTRL_JP=0x10;", 4),
        (0xD8, 1, "if(r.fc){CTRL_JP=pop16();}", 5),
        (0xD9, 1, "CTRL_JP=pop16();r.ime=1;", 4),
        (0xDA, 3, "if(r.fc)CTRL_JP={nn};", 4),
        (0xDC, 3, "if(r.fc){push16(NEXT);CTRL_JP={nn};}", 6),
        (0xDE, 2, "sbc_a({n});", 2),
        (0xDF, 1, "push16(NEXT);CTRL_JP=0x18;", 4),
        (0xE0, 2, "wr(0xff00+{n},r.a);", 3),
        (0xE1, 1, "r.hl=pop16();", 3),
        (0xE2, 1, "wr(0xff00+r.c,r.a);", 2),
        (0xE5, 1, "push16(r.hl);", 4),
        (0xE6, 2, "and_a({n});", 2),
        (0xE7, 1, "push16(NEXT);CTRL_JP=0x20;", 4),
        (0xE8, 2, "add_sp({n});", 4),
        (0xE9, 1, "CTRL_JP=r.hl;", 1),
        (0xEA, 3, "wr({nn},r.a);", 4),
        (0xEE, 2, "xor_a({n});", 2),
        (0xEF, 1, "push16(NEXT);CTRL_JP=0x28;", 4),
        (0xF0, 2, "r.a=rd(0xff00+{n});", 3),
        (0xF1, 1, "pop_af();", 3),
        (0xF2, 1, "r.a=rd(0xff00+r.c);", 2),
        (0xF3, 1, "r.ime=0;", 1),
        (0xF5, 1, "push_af();", 4),
        (0xF6, 2, "or_a({n});", 2),
        (0xF7, 1, "push16(NEXT);CTRL_JP=0x30;", 4),
        (0xF8, 2, "ld_hl_sp({n});", 3),
        (0xF9, 1, "r.sp=r.hl;", 2),
        (0xFA, 3, "r.a=rd({nn});", 4),
        (0xFB, 1, "ei();", 1),
        (0xFE, 2, "cp_a({n});", 2),
        (0xFF, 1, "push16(NEXT);CTRL_JP=0x38;", 4),
    ]
    for c, s, t, m in pairs:
        op(c, s, t, m)

    cbregs = ["r.b", "r.c", "r.d", "r.e", "r.h", "r.l", None, "r.a"]
    for gi, gn in enumerate(["rlc", "rrc", "rl", "rr", "sla", "sra", "swap", "srl"]):
        for j, rg in enumerate(cbregs):
            m = 4 if rg is None else 2
            if rg is None:
                CB[gi * 8 + j] = (f"wr(r.hl,{gn}(rd(r.hl)));", m)
            else:
                CB[gi * 8 + j] = (f"{rg}={gn}({rg});", m)
    for bi in range(8):
        for j, rg in enumerate(cbregs):
            src = "rd(r.hl)" if rg is None else rg
            m = 3 if rg is None else 2
            CB[0x40 + bi * 8 + j] = (f"bit({bi},{src});", m)
            m2 = 4 if rg is None else 2
            if rg is None:
                CB[0x80 + bi * 8 + j] = (f"wr(r.hl,res({bi},rd(r.hl)));", m2)
                CB[0xC0 + bi * 8 + j] = (f"wr(r.hl,set({bi},rd(r.hl)));", m2)
            else:
                CB[0x80 + bi * 8 + j] = (f"{rg}=res({bi},{rg});", m2)
                CB[0xC0 + bi * 8 + j] = (f"{rg}=set({bi},{rg});", m2)


fill()

UNCOND_JP = {0xC3, 0xE9}
UNCOND_JR = {0x18}
UNCOND_RET = {0xC9, 0xD9}
UNCOND_CALL = {0xCD}


def file_off(bank: int, addr: int) -> int:
    if addr < 0x4000:
        return addr
    return bank * 0x4000 + (addr - 0x4000)


def key_for(bank: int, cpu: int) -> str:
    if cpu < 0x4000:
        return f"{cpu:04x}"
    return f"{bank:x}:{cpu:04x}"


def discover(rom: bytes) -> dict[tuple[int, int], tuple[int, str, int, int]]:
    """Return {(bank,cpu): (size, body, next_cpu, mcycles)}"""
    work: list[tuple[int, int]] = []
    seen: set[tuple[int, int]] = set()
    out: dict[tuple[int, int], tuple[int, str, int, int]] = {}

    def add(bank: int, addr: int):
        if addr > 0x7FFF:
            return
        b = 0 if addr < 0x4000 else bank
        if b < 0 or b > 3:
            return
        # bank 3 is tiles — don't follow as code
        if b == 3:
            return
        key = (b, addr)
        if key not in seen:
            seen.add(key)
            work.append(key)

    seeds = [
        (0, 0x0000),
        (0, 0x0008),
        (0, 0x0010),
        (0, 0x0018),
        (0, 0x0020),
        (0, 0x0028),
        (0, 0x0030),
        (0, 0x0038),
        (0, 0x0040),
        (0, 0x0048),
        (0, 0x0050),
        (0, 0x0058),
        (0, 0x0060),
        (0, 0x0100),
        (0, 0x0150),
        (0, 0x02DB),
        (1, 0x4000),
        (1, 0x6172),
        (1, 0x61BA),
        (2, 0x4000),
    ]
    # game state handlers
    base = 0x38E
    for i in range(19):
        p = rom[base + 2 * i] | (rom[base + 2 * i + 1] << 8)
        if 0x0150 <= p < 0x4000:
            seeds.append((0, p))
    for s in seeds:
        add(*s)

    cur_bank = 1
    while work:
        bank, cpu = work.pop()
        off = file_off(bank, cpu)
        if off >= len(rom):
            continue
        opb = rom[off]
        if opb == 0xCB:
            cb = rom[off + 1]
            body, m = CB.get(cb, ("", 2))
            nxt = (cpu + 2) & 0xFFFF
            out[(bank, cpu)] = (2, body, nxt, m)
            add(bank, nxt)
            continue
        if opb not in OPS:
            continue
        size, tmpl, m = OPS[opb]
        n = rom[off + 1] if size >= 2 else 0
        nn = (rom[off + 1] | (rom[off + 2] << 8)) if size >= 3 else 0
        rel = 0
        if opb in (0x18, 0x20, 0x28, 0x30, 0x38):
            off8 = n if n < 128 else n - 256
            rel = (cpu + 2 + off8) & 0xFFFF
        nxt = (cpu + size) & 0xFFFF
        body = (
            tmpl.replace("{n}", f"0x{n:02x}")
            .replace("{nn}", f"0x{nn:04x}")
            .replace("{rel}", f"0x{rel:04x}")
            .replace("NEXT", f"0x{nxt:04x}")
        )
        out[(bank, cpu)] = (size, body, nxt, m)

        # bank switch pattern: 3E xx CD 17 11
        if opb == 0x3E and size == 2:
            if off + 4 < len(rom) and rom[off + 2] == 0xCD:
                tgt = rom[off + 3] | (rom[off + 4] << 8)
                if tgt == 0x1117:
                    cur_bank = n if n else 1

        # LD HL,nn / LD A,n / CALL BankedCall
        if opb == 0x21 and off + 7 < len(rom):
            hl = nn
            if rom[off + 3] == 0x3E and rom[off + 5] == 0xCD:
                if (rom[off + 6] | (rom[off + 7] << 8)) == 0x1107:
                    cb = rom[off + 4] or 1
                    add(cb & 3 or 1, hl)

        if opb in UNCOND_JP:
            if opb == 0xE9:
                continue
            add(cur_bank if nn >= 0x4000 else 0, nn)
            continue
        if opb in UNCOND_JR:
            add(bank if rel >= 0x4000 else 0, rel)
            continue
        if opb in UNCOND_RET:
            continue
        if opb in UNCOND_CALL or opb in (0xC4, 0xCC, 0xD4, 0xDC):
            add(cur_bank if nn >= 0x4000 else 0, nn)
            if opb == 0xCD and nn == 0x10FB:
                # jump table: don't fall through into pointer words
                continue
            add(bank, nxt)
            continue
        if opb in (0xC2, 0xCA, 0xD2, 0xDA):
            add(cur_bank if nn >= 0x4000 else 0, nn)
            add(bank, nxt)
            continue
        if opb in (0x20, 0x28, 0x30, 0x38):
            add(bank if rel >= 0x4000 else 0, rel)
            add(bank, nxt)
            continue
        if opb in (0xC7, 0xCF, 0xD7, 0xDF, 0xE7, 0xEF, 0xF7, 0xFF):
            add(0, opb & 0x38)
            add(bank, nxt)
            continue
        if opb == 0x76:  # HALT
            continue
        add(bank, nxt)

    return out


def main():
    rom = ROM.read_bytes()
    cases = discover(rom)

    lines = []
    lines.append("// AUTO-GENERATED — scripts/recompile_to_js.py (flow-based)")
    lines.append(f"// ROM: {ROM.name}")
    lines.append("export function bindRecompiled(M) {")
    lines.append("  const {")
    lines.append("    r, rd, wr, wr16abs, push16, pop16, push_af, pop_af,")
    lines.append("    inc8, dec8, add_a, adc_a, sub_a, sbc_a, and_a, xor_a, or_a, cp_a,")
    lines.append("    add_hl, add_sp, ld_hl_sp, rlca, rrca, rla, rra, daa,")
    lines.append("    rlc, rrc, rl, rr, sla, sra, swap, srl, bit, res, set,")
    lines.append("    stopcpu, romBank, decodeStep, ei")
    lines.append("  } = M;")
    lines.append("  const ops = {")
    for (bank, cpu), (size, body, nxt, m) in sorted(cases.items(), key=lambda x: (x[0][0], x[0][1])):
        k = key_for(bank, cpu)
        js = (
            f"let CTRL_JP=-1,CTRL_HALT=0; {body} "
            f"if(CTRL_JP>=0)r.pc=CTRL_JP&0xffff; else r.pc=0x{nxt:04x}; "
            f"if(CTRL_HALT)r.halted=1; return {m};"
        )
        lines.append(f"    '{k}':()=>{{{js}}},")
    lines.append("  };")
    lines.append("  return {")
    lines.append("    count: Object.keys(ops).length,")
    lines.append("    step() {")
    lines.append("      const b = r.pc < 0x4000 ? 0 : (romBank() || 1);")
    lines.append("      const key = r.pc < 0x4000")
    lines.append("        ? r.pc.toString(16).padStart(4,'0')")
    lines.append("        : (b.toString(16) + ':' + r.pc.toString(16).padStart(4,'0'));")
    lines.append("      const fn = ops[key];")
    lines.append("      if (fn) return fn();")
    lines.append("      // Rare hole: decode one instruction from ROM (keeps fidelity)")
    lines.append("      return decodeStep();")
    lines.append("    }")
    lines.append("  };")
    lines.append("}")
    lines.append("")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT} ops={len(cases)} bytes={OUT.stat().st_size}")


if __name__ == "__main__":
    main()
