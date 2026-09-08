# gator-web

**1:1 native port lab** (private): statically recompile Game Boy SM83 into JavaScript and run it with a DMG PPU — **not** EmulatorJS, **not** a fetch/decode/execute interpreter loop.

You supply a `.gb` you own. The ROM bytes are the program + assets; git never stores dumps.

## Idea

| Layer | Role |
|-------|------|
| `scripts/recompile_to_js.py` | Ahead-of-time: each instruction in banks 0–2 → JS with identical register/memory semantics |
| `player/generated/recompiled.js` | Generated step table (~33k ops) |
| `player/machine.js` | Registers, MBC1 bank select, WRAM/VRAM/OAM/IO |
| `player/ppu.js` | Renders 160×144 from VRAM/OAM the **game code** fills |
| Your ROM | Loaded at runtime only |

See [`docs/NATIVE_PORT.md`](docs/NATIVE_PORT.md).

## Run

```powershell
# optional: regenerate JS from your US retail ROM in roms/
python scripts\recompile_to_js.py

powershell -ExecutionPolicy Bypass -File scripts\serve_player.ps1
```

Open http://127.0.0.1:8765/player/

Controls: Arrows, X=A, Z=B, Enter=Start, Shift=Select. Toolbar Faster/Slower adjusts how many recompiled ops run per animation frame (timing still approximate).

## Fidelity status

- **Instruction semantics:** 1:1 for recompiled ops (flags, banks, stack, HRAM).
- **Coverage:** banks 0–2 recompiled; bank 3 consumed as data via `rd`.
- **Timing / APU / serial:** not cycle-accurate yet — enough LY ticking to escape busy-waits; sound TBD.
- **Goal:** keep replacing approximate host glue until behavior matches a reference emulator frame-for-frame.

## Layout

```
player/                 runtime + UI
player/generated/       recompiled.js (generated)
scripts/recompile_to_js.py
docs/
```
