# Native port: what we're proving

**Question:** Can a late-80s Game Boy title (SM83 + MBC1 banks + MMIO) run as a *native* web app — not by emulating via an opcode interpreter — if we reverse-engineer / recompile control flow and only use the ROM as the program+asset blob at runtime?

## Approach: static recompilation (1:1)

1. Classify ROM banks 0–2 as code, bank 3 as data (tiles).
2. Translate each SM83 instruction into a JS statement with the same architectural effects.
3. Drive those functions from `requestAnimationFrame`, with a small host PPU that displays VRAM/OAM.
4. MBC1 `LD ($2000),A` becomes `romBank = a` inside `wr()`.

This is the same family of technique as other “PC ports” of console games: the **program is the original program**, expressed in another ISA, not a clean-room rewrite of “pinball-like” gameplay.

## What we are *not* doing

- No EmulatorJS / Gambatte / mGBA core
- No interpretive `while(true){ fetch; decode; execute }` loop over raw opcodes
- ROM files are never committed

## GB concepts → web

| Game Boy | Native web |
|----------|------------|
| ROM banks | `Uint8Array` + bank index on `$2000` writes |
| SM83 code | AOT JS functions in `generated/recompiled.js` |
| VRAM / OAM / IO | `machine.js` buffers |
| LCD | `ppu.js` → canvas |
| Joypad `$FF00` | Keyboard → IO read |
| VBlank IRQ | Host sets IF + vectors to `$0040` each frame (approximate) |

## Regenerate

```powershell
python scripts\recompile_to_js.py
```

Requires the US retail `.gb` under `roms/` (gitignored).
