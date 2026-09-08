# Native port: what we're proving

**Question:** Can a late-80s Game Boy title run as a *native* web app without an opcode-interpreter emulator?

## Approach: flow-based static recompilation (1:1)

1. Trace reachable SM83 from vectors / known entries (not a blind linear bank scan).
2. Emit one JS function per instruction with identical architectural effects + M-cycle cost.
3. Host runs **~70224 T-cycles per frame** (DMG), advancing DIV, TIMA, LY, STAT modes, and IRQs.
4. Rare AOT holes: **one-instruction decode fallback** (bridge only — not the main loop).
5. PPU draws VRAM/OAM the game itself writes. MBC1 bank select is `wr($2000)`.

## Current fidelity

| Area | Status |
|------|--------|
| Instruction semantics (AOT) | 1:1 for traced ops |
| Code/data separation | Flow-based (much better than linear) |
| Frame pacing | DMG 70224 T/frame |
| DIV / TIMA / TAC | Yes |
| LY / LYC / STAT modes + IRQs | Yes |
| VBlank / STAT / Timer IRQs | Yes |
| EI delay | Yes |
| APU / serial link | Not yet |
| Cycle-perfect PPU mid-scanline | Approximate modes only |

## Regenerate

```powershell
python scripts\recompile_to_js.py
```

Needs US retail `.gb` in `roms/` (gitignored).
