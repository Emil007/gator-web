# gator

Bring-your-own-ROM web player for *Pinball: Revenge of the 'Gator* / *66匹のワニ大行進* (Game Boy).

**This repository does not ship any commercial ROM.** You supply a dump you are allowed to use. The file is read only in your browser; nothing is uploaded.

**Play:** [https://emil007.github.io/gator-web/player/](https://emil007.github.io/gator-web/player/)

---

## What this project is

A **small, purpose-built Game Boy runtime in JavaScript** that loads a `.gb` (or a `.zip` containing one) and runs it entirely client-side.

It is:

| This | Not that |
|------|----------|
| A dynamic SM83 CPU + DMG-ish PPU/APU/IO in the browser | EmulatorJS / Wasm Boy / a packaged third-party emulator shell |
| Driven by **your** ROM bytes as the program | A rewrite of the game’s logic in JS |
| Fine for private research and BYOR demos | A redistributed copy of HAL/Nintendo’s game |

The game code, graphics, and sound data stay inside the ROM you load. The repo only contains the host that *interprets* SM83 and draws/plays what that code writes to VRAM/OAM/APU registers.

---

## How a ROM becomes a playable page

```
┌─────────────┐     file picker / zip     ┌──────────────┐
│  Your .gb   │ ───────────────────────► │  rom.js      │  validate + identify
└─────────────┘                           └──────┬───────┘
                                                 │
                                                 ▼
                                          ┌──────────────┐
                                          │ machine.js   │  memory, MBC1, timers,
                                          │              │  joypad, LCD regs, APU
                                          └──────┬───────┘
                         each animation frame    │
              ┌──────────────────────────────────┼──────────────────────────┐
              ▼                                  ▼                          ▼
       ┌────────────┐                    ┌────────────┐              ┌──────────┐
       │ cpu.js +   │  fetch/decode/     │  ppu.js    │  VRAM/OAM →  │  apu.js  │
       │ decode.js  │  execute SM83      │            │  canvas      │  Web     │
       │            │  until ~70224 T    │            │              │  Audio   │
       └────────────┘                    └────────────┘              └──────────┘
              ▲
              │  left/right/plunger/start
       ┌────────────┐
       │ input_     │  keyboard / mouse / invisible touch zones
       │ pinball.js │  → DMG joypad bits (D-Pad / A·B / Start)
       └────────────┘
```

### 1. Load the ROM (`player/rom.js`)

- Accepts `.gb`, `.gbc`, or `.zip` (store or deflate; first `.gb`/`.gbc` inside).
- Checks Nintendo logo / size / title so random files fail early.
- Soft-labels JP / US-EU / Beta when possible; all three use the same runtime.

### 2. Build a machine (`player/machine.js`)

Maps a 64 KiB MBC1 cart the way the hardware does:

| Region | Role |
|--------|------|
| `$0000–$3FFF` | Fixed ROM bank 0 |
| `$4000–$7FFF` | Switchable ROM bank (masked to cart size — important for 4-bank 64 KiB carts) |
| `$8000–$9FFF` | VRAM |
| `$C000–$DFFF` | WRAM |
| `$FE00–$FE9F` | OAM |
| `$FF00–$FF7F` | IO (joypad, timers, LCD, APU) |
| `$FF80–$FFFE` | HRAM |
| `$FFFF` | IE |

Also advances **DIV / TIMA**, **LY / STAT**, and **interrupt dispatch** (VBlank, STAT, timer, …) roughly on the DMG’s **70224 T-cycles per frame**.

### 3. Run the CPU (`player/cpu.js` + `decode.js`)

Each frame the host:

1. Checks pending interrupts  
2. **Fetch → decode → execute** one SM83 instruction from the current PC (ROM/WRAM/HRAM as mapped)  
3. Advances timers / LCD / APU by that instruction’s T-cycles  
4. Repeats until a frame’s worth of cycles is consumed  

There is **no ahead-of-time recompile blob** in the published player. The ROM is the program.

### 4. Draw (`player/ppu.js`)

Once per frame, a software PPU reads **LCDC, SCX/SCY, BGP/OBP, WY/WX, VRAM tile maps, OAM** and paints a 160×144 `ImageData` onto the canvas (BG + window + 8×8/8×16 sprites, OBJ priority).

### 5. Sound (`player/apu.js`)

APU registers `$FF10–$FF3F` drive a compact square / wave / noise mixer into the Web Audio API (started on the same user gesture as “load ROM”).

### 6. Input (`player/input_pinball.js`)

The original game only needs a few pins:

| Player action | Joypad |
|---------------|--------|
| Left flipper | any D-Pad bit |
| Right flipper + plunger | A and B (shared) |
| Start / pause | Start |

The UI exposes arrows / Space / Enter, mouse on the screen, and on phones **invisible** L / plunger / R zones (fullscreen play chrome).

---

## Fidelity (honest)

| Area | Status |
|------|--------|
| SM83 instruction semantics | Implemented in `decode.js` |
| MBC1 bank masking | Yes (64 KiB → banks 0–3) |
| Frame pacing | ~70224 T/frame |
| DIV / TIMA / LY / basic IRQs | Yes |
| PPU | Frame renderer; not cycle-accurate mid-scanline |
| APU | Functional mixer; not bit-perfect |
| Serial / link cable | No |

Good enough to boot and play the three known dumps; not a claim of pixel/cycle identity with a reference emulator.

---

## Run locally

```powershell
powershell -ExecutionPolicy Bypass -File scripts\serve_player.ps1
```

Open http://127.0.0.1:8765/player/

Optional: put dumps in `roms/` (gitignored) for quick-load buttons.

### Controls

- **← / →** flippers · **Space or ↓** plunger (hold, then release) · **Enter** start  
- **Mobile:** left / center / right of the screen · top strip = start · triple-tap top = eject  

### Supported dumps

| Variant | Typical filename |
|---------|------------------|
| Japan | `Pinball - 66hiki no Wani Daikoushin! (Japan).gb` |
| US / Europe | `Pinball - Revenge of the 'Gator (USA, Europe).gb` |
| Beta | `Pinball - Revenge of the 'Gator (USA, Europe) (Beta).gb` |

---

## Layout

```
player/
  index.html        UI shell
  main.js           frame loop, ROM load, mobile chrome
  rom.js            .gb / .zip load + header checks
  machine.js        memory, MBC1, timers, LCD IO, hooks APU
  cpu.js / decode.js  dynamic SM83
  ppu.js            frame render → canvas
  apu.js            DMG channels → Web Audio
  input_pinball.js  flipper-centric → joypad bits
scripts/
  serve_player.ps1  local static server
roms/               your dumps only (gitignored)
docs/NATIVE_PORT.md short fidelity notes
```

---

## Publishing notes

- GitHub Pages serves `/player/` with `.nojekyll`.  
- Never commit `.gb` dumps or AOT recompile blobs derived from commercial ROMs.  
- Users always bring their own ROM.
