# gator-web

**Native port lab** — can a banked Game Boy title run on the web *without* emulating SM83/MBC1?

Private research repo. You supply a `.gb` you own; it is used as an **asset/data pack only**. Game code here is JavaScript.

## Thesis

Banks, VBlank, and `$FF**` registers are platform glue. Algorithms, tables, and tiles are portable. See [`docs/NATIVE_PORT.md`](docs/NATIVE_PORT.md).

## Run

```powershell
powershell -ExecutionPolicy Bypass -File scripts\serve_player.ps1
```

Open http://127.0.0.1:8765/player/ → load a ROM → native canvas loop (no EmulatorJS).

## What’s implemented

- ROM load (file / local `roms/` when serving from repo root)
- Header parse + bank slices
- 2bpp tile decode from bank 3 → atlas
- `ASCII+0x1F` menu string decode (from RE)
- Attract → menu → **pinball table POC** (native physics; ROM tiles for backdrop)
- State modes inspired by `$FFBD` jump table (not cycle-accurate yet)

## What’s next

- Port real collision / object tables from the matching disassembly
- BG map reconstruction for authentic tables
- Sound via Web Audio from bank 1 driver RE
- Side-by-side compare vs emulator as reference only

## Layout

```
player/          native web runtime (ES modules)
docs/            port architecture notes
scripts/         local static server
```

ROMs are gitignored. Never commit dumps.
