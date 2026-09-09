# Native port: what we're proving

**Question:** Can a late-80s Game Boy title run as a *native* web app without shipping an EmulatorJS shell?

## Approach: dynamic SM83 (current)

1. Load the user’s `.gb` into a MBC1-aware machine.
2. Each frame: fetch/decode/execute instructions from ROM bytes (`player/decode.js`) until ~70224 T-cycles.
3. Advance DIV, TIMA, LY, STAT modes, and IRQs alongside the CPU.
4. PPU draws VRAM/OAM the game itself writes.
5. Input is pinball-native (left/right flippers, start, nudge) mapped onto the joypad bits the original code polls.

An optional AOT recompiler (`scripts/recompile_to_js.py`) remains as an experiment only — the player no longer depends on it.

## Current fidelity

| Area | Status |
|------|--------|
| Instruction semantics | Dynamic SM83 decode |
| Frame pacing | DMG 70224 T/frame |
| DIV / TIMA / TAC | Yes |
| LY / LYC / STAT modes + IRQs | Yes |
| VBlank / STAT / Timer IRQs | Yes |
| EI delay | Yes |
| APU | Functional mixer (square/wave/noise → Web Audio); not bit-perfect |
| Controls UX | Flipper-centric (not full GB pad UI) |

## Run

```powershell
powershell -ExecutionPolicy Bypass -File scripts\serve_player.ps1
```
