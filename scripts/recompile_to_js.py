#!/usr/bin/env python3
"""Static recompiler — walk .code ranges instruction-aligned → JS step table."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROM = next(p for p in (ROOT / "roms").glob("*.gb") if "Europe" in p.name and "Beta" not in p.name)
OUT = ROOT / "player" / "generated" / "recompiled.js"
SYM = ROOT / "symbols" / "us.sym"

OPS: dict[int, tuple[int, str]] = {}
CB: dict[int, str] = {}


def op(c, s, t):
    OPS[c] = (s, t)


def fill():
    op(0x00, 1, "")
    op(0x01, 3, "r.bc={nn};")
    op(0x02, 1, "wr(r.bc,r.a);")
    op(0x03, 1, "r.bc=(r.bc+1)&0xffff;")
    op(0x04, 1, "r.b=inc8(r.b);")
    op(0x05, 1, "r.b=dec8(r.b);")
    op(0x06, 2, "r.b={n};")
    op(0x07, 1, "rlca();")
    op(0x08, 3, "wr16abs({nn},r.sp);")
    op(0x09, 1, "add_hl(r.bc);")
    op(0x0A, 1, "r.a=rd(r.bc);")
    op(0x0B, 1, "r.bc=(r.bc-1)&0xffff;")
    op(0x0C, 1, "r.c=inc8(r.c);")
    op(0x0D, 1, "r.c=dec8(r.c);")
    op(0x0E, 2, "r.c={n};")
    op(0x0F, 1, "rrca();")
    op(0x10, 2, "stopcpu();")
    op(0x11, 3, "r.de={nn};")
    op(0x12, 1, "wr(r.de,r.a);")
    op(0x13, 1, "r.de=(r.de+1)&0xffff;")
    op(0x14, 1, "r.d=inc8(r.d);")
    op(0x15, 1, "r.d=dec8(r.d);")
    op(0x16, 2, "r.d={n};")
    op(0x17, 1, "rla();")
    op(0x18, 2, "CTRL_JP={rel};")
    op(0x19, 1, "add_hl(r.de);")
    op(0x1A, 1, "r.a=rd(r.de);")
    op(0x1B, 1, "r.de=(r.de-1)&0xffff;")
    op(0x1C, 1, "r.e=inc8(r.e);")
    op(0x1D, 1, "r.e=dec8(r.e);")
    op(0x1E, 2, "r.e={n};")
    op(0x1F, 1, "rra();")
    op(0x20, 2, "if(!r.fz)CTRL_JP={rel};")
    op(0x21, 3, "r.hl={nn};")
    op(0x22, 1, "wr(r.hl,r.a);r.hl=(r.hl+1)&0xffff;")
    op(0x23, 1, "r.hl=(r.hl+1)&0xffff;")
    op(0x24, 1, "r.h=inc8(r.h);")
    op(0x25, 1, "r.h=dec8(r.h);")
    op(0x26, 2, "r.h={n};")
    op(0x27, 1, "daa();")
    op(0x28, 2, "if(r.fz)CTRL_JP={rel};")
    op(0x29, 1, "add_hl(r.hl);")
    op(0x2A, 1, "r.a=rd(r.hl);r.hl=(r.hl+1)&0xffff;")
    op(0x2B, 1, "r.hl=(r.hl-1)&0xffff;")
    op(0x2C, 1, "r.l=inc8(r.l);")
    op(0x2D, 1, "r.l=dec8(r.l);")
    op(0x2E, 2, "r.l={n};")
    op(0x2F, 1, "r.a^=0xff;r.fn=1;r.fh=1;")
    op(0x30, 2, "if(!r.fc)CTRL_JP={rel};")
    op(0x31, 3, "r.sp={nn};")
    op(0x32, 1, "wr(r.hl,r.a);r.hl=(r.hl-1)&0xffff;")
    op(0x33, 1, "r.sp=(r.sp+1)&0xffff;")
    op(0x34, 1, "wr(r.hl,inc8(rd(r.hl)));")
    op(0x35, 1, "wr(r.hl,dec8(rd(r.hl)));")
    op(0x36, 2, "wr(r.hl,{n});")
    op(0x37, 1, "r.fc=1;r.fn=0;r.fh=0;")
    op(0x38, 2, "if(r.fc)CTRL_JP={rel};")
    op(0x39, 1, "add_hl(r.sp);")
    op(0x3A, 1, "r.a=rd(r.hl);r.hl=(r.hl-1)&0xffff;")
    op(0x3B, 1, "r.sp=(r.sp-1)&0xffff;")
    op(0x3C, 1, "r.a=inc8(r.a);")
    op(0x3D, 1, "r.a=dec8(r.a);")
    op(0x3E, 2, "r.a={n};")
    op(0x3F, 1, "r.fc^=1;r.fn=0;r.fh=0;")
    regs = ["r.b", "r.c", "r.d", "r.e", "r.h", "r.l", None, "r.a"]
    for i, rdn in enumerate(regs):
        for j, rs in enumerate(regs):
            code = 0x40 + i * 8 + j
            if code == 0x76:
                op(0x76, 1, "CTRL_HALT=1;")
                continue
            src = "rd(r.hl)" if rs is None else rs
            if rdn is None:
                op(code, 1, f"wr(r.hl,{src});")
            else:
                op(code, 1, f"{rdn}={src};")
    for ai, fn in enumerate(["add_a", "adc_a", "sub_a", "sbc_a", "and_a", "xor_a", "or_a", "cp_a"]):
        for j, rs in enumerate(regs):
            src = "rd(r.hl)" if rs is None else rs
            op(0x80 + ai * 8 + j, 1, f"{fn}({src});")

    def jcall(cond, nn="nn"):
        return f"if({cond}){{push16(NEXT);CTRL_JP={{{nn}}};}}"

    pairs = [
        (0xC0, 1, "if(!r.fz){CTRL_JP=pop16();}"),
        (0xC1, 1, "r.bc=pop16();"),
        (0xC2, 3, "if(!r.fz)CTRL_JP={nn};"),
        (0xC3, 3, "CTRL_JP={nn};"),
        (0xC4, 3, "if(!r.fz){push16(NEXT);CTRL_JP={nn};}"),
        (0xC5, 1, "push16(r.bc);"),
        (0xC6, 2, "add_a({n});"),
        (0xC7, 1, "push16(NEXT);CTRL_JP=0x00;"),
        (0xC8, 1, "if(r.fz){CTRL_JP=pop16();}"),
        (0xC9, 1, "CTRL_JP=pop16();"),
        (0xCA, 3, "if(r.fz)CTRL_JP={nn};"),
        (0xCC, 3, "if(r.fz){push16(NEXT);CTRL_JP={nn};}"),
        (0xCD, 3, "push16(NEXT);CTRL_JP={nn};"),
        (0xCE, 2, "adc_a({n});"),
        (0xCF, 1, "push16(NEXT);CTRL_JP=0x08;"),
        (0xD0, 1, "if(!r.fc){CTRL_JP=pop16();}"),
        (0xD1, 1, "r.de=pop16();"),
        (0xD2, 3, "if(!r.fc)CTRL_JP={nn};"),
        (0xD4, 3, "if(!r.fc){push16(NEXT);CTRL_JP={nn};}"),
        (0xD5, 1, "push16(r.de);"),
        (0xD6, 2, "sub_a({n});"),
        (0xD7, 1, "push16(NEXT);CTRL_JP=0x10;"),
        (0xD8, 1, "if(r.fc){CTRL_JP=pop16();}"),
        (0xD9, 1, "CTRL_JP=pop16();r.ime=1;"),
        (0xDA, 3, "if(r.fc)CTRL_JP={nn};"),
        (0xDC, 3, "if(r.fc){push16(NEXT);CTRL_JP={nn};}"),
        (0xDE, 2, "sbc_a({n});"),
        (0xDF, 1, "push16(NEXT);CTRL_JP=0x18;"),
        (0xE0, 2, "wr(0xff00+{n},r.a);"),
        (0xE1, 1, "r.hl=pop16();"),
        (0xE2, 1, "wr(0xff00+r.c,r.a);"),
        (0xE5, 1, "push16(r.hl);"),
        (0xE6, 2, "and_a({n});"),
        (0xE7, 1, "push16(NEXT);CTRL_JP=0x20;"),
        (0xE8, 2, "add_sp({n});"),
        (0xE9, 1, "CTRL_JP=r.hl;"),
        (0xEA, 3, "wr({nn},r.a);"),
        (0xEE, 2, "xor_a({n});"),
        (0xEF, 1, "push16(NEXT);CTRL_JP=0x28;"),
        (0xF0, 2, "r.a=rd(0xff00+{n});"),
        (0xF1, 1, "pop_af();"),
        (0xF2, 1, "r.a=rd(0xff00+r.c);"),
        (0xF3, 1, "r.ime=0;"),
        (0xF5, 1, "push_af();"),
        (0xF6, 2, "or_a({n});"),
        (0xF7, 1, "push16(NEXT);CTRL_JP=0x30;"),
        (0xF8, 2, "ld_hl_sp({n});"),
        (0xF9, 1, "r.sp=r.hl;"),
        (0xFA, 3, "r.a=rd({nn});"),
        (0xFB, 1, "r.ime=1;"),
        (0xFE, 2, "cp_a({n});"),
        (0xFF, 1, "push16(NEXT);CTRL_JP=0x38;"),
    ]
    for c, s, t in pairs:
        op(c, s, t)

    cbregs = ["r.b", "r.c", "r.d", "r.e", "r.h", "r.l", None, "r.a"]
    for gi, gn in enumerate(["rlc", "rrc", "rl", "rr", "sla", "sra", "swap", "srl"]):
        for j, rg in enumerate(cbregs):
            if rg is None:
                CB[gi * 8 + j] = f"wr(r.hl,{gn}(rd(r.hl)));"
            else:
                CB[gi * 8 + j] = f"{rg}={gn}({rg});"
    for bi in range(8):
        for j, rg in enumerate(cbregs):
            src = "rd(r.hl)" if rg is None else rg
            CB[0x40 + bi * 8 + j] = f"bit({bi},{src});"
            if rg is None:
                CB[0x80 + bi * 8 + j] = f"wr(r.hl,res({bi},rd(r.hl)));"
                CB[0xC0 + bi * 8 + j] = f"wr(r.hl,set({bi},rd(r.hl)));"
            else:
                CB[0x80 + bi * 8 + j] = f"{rg}=res({bi},{rg});"
                CB[0xC0 + bi * 8 + j] = f"{rg}=set({bi},{rg});"


fill()


def code_ranges() -> list[tuple[int, int]]:
    """Banks 0–2 as code for 1:1 coverage; bank 3 is tile data."""
    return [(0x0000, 0x3FFF), (0x4000, 0x7FFF), (0x8000, 0xBFFF)]


def key_for(file_off: int) -> str:
    bank = file_off // 0x4000
    cpu = file_off if bank == 0 else 0x4000 + (file_off % 0x4000)
    if cpu < 0x4000:
        return f"{cpu:04x}"
    return f"{bank:x}:{cpu:04x}"


def main():
    rom = ROM.read_bytes()
    cases = {}
    for start, end in code_ranges():
        pc = start
        while pc <= end:
            bank = pc // 0x4000
            cpu = pc if bank == 0 else 0x4000 + (pc % 0x4000)
            opb = rom[pc]
            if opb == 0xCB:
                if pc + 1 > end:
                    break
                cb = rom[pc + 1]
                body = CB.get(cb, "")
                nxt = cpu + 2
                cases[key_for(pc)] = (2, body, nxt, None)
                pc += 2
                continue
            if opb not in OPS:
                pc += 1
                continue
            size, tmpl = OPS[opb]
            if pc + size - 1 > end and size > 1:
                break
            n = rom[pc + 1] if size >= 2 else 0
            nn = (rom[pc + 1] | (rom[pc + 2] << 8)) if size >= 3 else 0
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
            cases[key_for(pc)] = (size, body, nxt, None)
            pc += size

    lines = []
    lines.append("// AUTO-GENERATED — scripts/recompile_to_js.py")
    lines.append(f"// ROM: {ROM.name}")
    lines.append("export function bindRecompiled(M) {")
    lines.append("  const {")
    lines.append("    r, rd, wr, wr16abs, push16, pop16, push_af, pop_af,")
    lines.append("    inc8, dec8, add_a, adc_a, sub_a, sbc_a, and_a, xor_a, or_a, cp_a,")
    lines.append("    add_hl, add_sp, ld_hl_sp, rlca, rrca, rla, rra, daa,")
    lines.append("    rlc, rrc, rl, rr, sla, sra, swap, srl, bit, res, set,")
    lines.append("    stopcpu, romBank")
    lines.append("  } = M;")
    lines.append("  const ops = {")
    for k, (size, body, nxt, _) in sorted(cases.items()):
        # body may set CTRL_JP / CTRL_HALT
        js = (
            f"let CTRL_JP=-1,CTRL_HALT=0; {body} "
            f"if(CTRL_JP>=0)r.pc=CTRL_JP&0xffff; else r.pc=0x{nxt:04x}; "
            f"if(CTRL_HALT)r.halted=1;"
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
    lines.append("      if (!fn) { r.pc = (r.pc + 1) & 0xffff; return false; }")
    lines.append("      fn();")
    lines.append("      return true;")
    lines.append("    }")
    lines.append("  };")
    lines.append("}")
    lines.append("")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT} ops={len(cases)} bytes={OUT.stat().st_size}")


if __name__ == "__main__":
    main()
