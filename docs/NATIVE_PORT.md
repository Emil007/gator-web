# Native port: what we're proving

**Question:** Can a late-80s Game Boy title (SM83 + MBC1 banks + MMIO) run as a *native* web app — not by emulating the chip — if we reverse-engineer control flow and only use the ROM as an asset/data pack?

**Answer we're building toward:** Yes. Banks and memory-mapped hardware are *platform details*. The game is algorithms + tables + tiles + timing intent. Those map cleanly to JS modules, ArrayBuffers, Canvas, and `requestAnimationFrame`.

## What we are *not* doing

- No SM83 interpreter / no Gambatte / no EmulatorJS
- No cycle-accurate PPU/APU clone (unless a later experiment needs it)
- ROM is never committed; the browser keeps it in a local `ArrayBuffer`

## GB concepts → web

| Game Boy | Native web |
|----------|------------|
| ROM bank 0 fixed `$0000–$3FFF` | Always-loaded module / data slice `rom.slice(0, 0x4000)` |
| Switchable `$4000–$7FFF` via MBC1 `$2000` | `bank = n` index into `rom.subarray(n*0x4000, …)` or ES modules per bank |
| VRAM `$8000–$9FFF` 2bpp tiles | Decode once → `ImageData` / atlas canvas |
| BG map `$9800` / `$9C00` | `Uint8Array(32*32)` of tile indices + draw |
| OAM sprites | Objects with x/y/tile; draw atop BG |
| HRAM game state (`$FFBD`, …) | Plain JS object `state = { mode, flags, … }` |
| `RST` / jump tables | `switch` / function tables |
| VBlank-paced loop | `requestAnimationFrame` (~60 Hz); optional fixed 59.7 Hz accumulator |
| APU registers | Web Audio (later); or silence stubs |
| Serial 2P | WebRTC / local two-instance later |

## Port strategy (incremental)

1. **Asset layer** — parse header, decode 2bpp, pull known tables/strings from RE map  
2. **Platform shim** — input, frame loop, LCD canvas (160×144 scaled)  
3. **Systems** — port labeled routines from the disassembly as JS (state machine first, then table physics)  
4. **Fidelity** — compare behavior against the real ROM in an emulator *side-by-side* while developing (emu is a *reference*, not the runtime)

## Why banks aren't a blocker

MBC1 banking exists because the CPU address space is 16-bit. In JS we have the whole 64 KiB in one buffer. `BankSwitch(a)` becomes `currentBank = a || 1`. Calls that were `BankedCall(hl, bank)` become `banks[bank][hl]()` or just direct function imports after static analysis.

Self-modifying code and exact interrupt timing are the hard parts for a *mechanical* asm→JS translator. A *hand/semiauto port* of a 64 KiB pinball game avoids most of that.
