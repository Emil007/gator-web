# Technical review — running a GB ROM in the browser

This document is the architecture / technical review for **gator**: what the project is, what it is not, and exactly how a user-supplied ROM becomes pixels and audio in a web page.

Live player: https://emil007.github.io/gator-web/player/

---

## 1. One-sentence summary

**gator** is a small JavaScript **Game Boy host** (dynamic SM83 + DMG-ish PPU/APU/IO) that loads **your** `.gb` / `.zip` in the browser and executes the ROM’s own machine code — it does not ship or rewrite the commercial game.

## 2. What this is / is not

| Is | Is not |
|----|--------|
| Client-only BYOR runtime | A dump of Revenge of the ’Gator / 66匹のワニ大行進 |
| Fetch → decode → execute SM83 from ROM bytes | EmulatorJS / a Wasm core wrapped in a skin |
| Flipper-oriented input UX mapped to joypad pins | A high-level reimplementation of pinball physics in JS |
| Suitable for demos and RE-backed research | A claim of cycle-perfect hardware identity |

The **program**, **tiles**, and **sound data** remain inside the ROM file the user selects. The repository only contains the host.

## 3. End-to-end pipeline

```
User file (.gb | .gbc | .zip)
        │
        ▼
   rom.js          validate header / extract zip / soft-label JP·US·Beta
        │
        ▼
   machine.js      MBC1 memory map, timers, LCD regs, joypad, APU register file
        │
        ├──────────────────┬──────────────────┐
        ▼                  ▼                  ▼
  cpu + decode        ppu.js              apu.js
  SM83 step loop      VRAM/OAM →          NR* → Web Audio
  ~70224 T/frame      160×144 canvas
        ▲
        │
  input_pinball.js     D-Pad / A·B / Start
```

Orchestration lives in `player/main.js` (`requestAnimationFrame`).

### 3.1 Load (`rom.js`)

1. Read the file as bytes (or inflate a ZIP and take the first `.gb`/`.gbc`).
2. Reject non-GB payloads (Nintendo logo / size / title heuristics).
3. Optionally label Japan vs US/EU vs Beta (destination byte + string probes). All three share one runtime path.

### 3.2 Machine (`machine.js`)

Exposes the address space the game expects:

| Range | Role |
|-------|------|
| `$0000–$3FFF` | ROM bank 0 (fixed) |
| `$4000–$7FFF` | Switchable ROM bank; **masked to cart size** (64 KiB → banks 0–3) |
| `$8000–$9FFF` | VRAM |
| `$C000–$DFFF` | WRAM (this title relocates SP near `$CFFF`) |
| `$FE00–$FE9F` | OAM |
| `$FF00–$FF7F` | IO (joypad, DIV/TIMA, LCD, APU) |
| `$FF80–$FFFE` | HRAM (OAM DMA stub copied here at boot) |
| `$FFFF` | Interrupt enable |

Each CPU step’s T-cycles advance **DIV**, **TIMA**, **LY/STAT**, **APU**, and feed **interrupt dispatch** (VBlank / STAT / timer / …).

### 3.3 CPU (`cpu.js` + `decode.js`)

- **Dynamic** interpreter only (published player has no AOT `recompiled.js`).
- Per frame: while cycle budget remains → `checkInterrupts` → one instruction → `advanceDots`.
- Budget ≈ **70224 T-cycles** (DMG frame), scaled by the UI speed control.

Notable fixed bugs on the way to playability: MBC1 bank masking; ALU register ops calling `regR[i]()` (so `OR C` is not `OR 0`); HRAM DMA stub copy completing so VBlank’s `CALL $FF80` returns.

### 3.4 PPU (`ppu.js`)

Blit BG + window + sprites (8×8 / 8×16) into `ImageData`. OBJ-to-BG priority uses a BG color-index buffer; OBJ-to-OBJ uses DMG-style X then OAM-index priority.

**Per-scanline LCDC / SCX / SCY / BGP** are snapshotted when each visible line ends (`machine.js`). This title’s attract/title code flips LCDC bit 4 around LY≈104 so the logo uses signed `$8800/$9000` tiles while `PUSH START KEY` uses unsigned `$8000` font tiles — a single end-of-frame LCDC read draws one or the other wrong.

Not a full cycle-accurate mid-scanline PPU (no per-dot mode timings), but enough for this game’s mid-frame register trick.

### 3.5 APU (`apu.js`)

Writes to `$FF10–$FF3F` update square / wave / noise channel state. `advance(t)` clocks channels and **pushes mixed samples into a ring buffer**; a Web Audio `ScriptProcessor` only pops that queue (hold-last on underrun). AudioContext is resumed on the same user gesture as “load ROM”.

### 3.6 Input (`input_pinball.js`)

Hardware mapping for this game (not a full Game Boy pad UI):

| Action | Joypad |
|--------|--------|
| Left flipper | Any D-Pad direction |
| Right flipper | A or B |
| Plunger | Hold A/B, release to launch |
| Start / pause | Start |

Keys use `event.code` (arrows / Space / Enter) with `preventDefault` on press **and** key-repeat so the page doesn’t scroll. Mobile play uses invisible hit zones and fullscreen chrome (`overflow` lock only in that mode).

## 4. Frame algorithm (pseudo)

```
onAnimationFrame(ts):           # wall-clock ~60 Hz (not 1 GB frame per rAF)
  while timeBudget:
    syncJoypad()
    cycles = 0
    while cycles < 70224:
      cycles += handleIrq()
      if halted: advance(4); continue
      m = cpu.step()            # decode.js
      advance(m * 4)            # DIV, TIMA, LY(+line LCDC snap), APU→ring
  ppu.renderFrame(machine, imageData)   # uses lineLcdc[y] …
  canvas.putImageData(...)
```

## 5. Fidelity matrix

| Subsystem | Status |
|-----------|--------|
| SM83 semantics | Implemented |
| MBC1 bank mask | Implemented |
| DIV / TIMA / LY / IRQs / EI delay | Implemented (approx) |
| PPU | Per-line LCDC/scroll; not cycle-accurate mid-scanline |
| APU | Ring-buffer mixer; not bit-perfect |
| Serial / link cable | Not implemented |
| Static recompiler | Experiment only; not used in player |

## 6. Supported ROMs

Same engine for:

- Japan — `Pinball - 66hiki no Wani Daikoushin! (Japan).gb`
- US/EU — `Pinball - Revenge of the 'Gator (USA, Europe).gb`
- Beta — `Pinball - Revenge of the 'Gator (USA, Europe) (Beta).gb`

All are 64 KiB MBC1, header title `PINBALL`.

## 7. Security / publishing posture

- No commercial dumps in git (`roms/` gitignored).
- No AOT blob of game code in the public tree.
- GitHub Pages serves static `player/` with `.nojekyll`.
- Processing is local to the browser tab.

## 8. Module map

| Path | Responsibility |
|------|----------------|
| `player/main.js` | Boot UI, rAF loop, mobile fullscreen |
| `player/rom.js` | Load / zip / identify |
| `player/machine.js` | Bus + timing + IRQ + APU hook |
| `player/cpu.js` | CPU façade |
| `player/decode.js` | SM83 one-step |
| `player/ppu.js` | Frame render |
| `player/apu.js` | Sound |
| `player/input_pinball.js` | Controls |
| `scripts/serve_player.ps1` | Local static server |

---

*Companion overview also lives in the root `README.md`. This file is the deeper review-oriented writeup.*
