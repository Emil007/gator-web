# gator-web

Browser Game Boy player for local ROMs. **You supply the ROM** — nothing is uploaded or shipped in this repo.

Built for quickly playing dumps you already own (e.g. Pinball / ’Gator variants) via [EmulatorJS](https://emulatorjs.org/).

## Play locally

```powershell
powershell -ExecutionPolicy Bypass -File scripts\serve_player.ps1
```

Open http://127.0.0.1:8765/player/

- Drop a `.gb` / choose a file, or
- If you keep ROMs in a sibling `roms/` folder when serving from a parent project, quick-load buttons appear

## Play on GitHub Pages

After Pages is enabled for this repo (deploy from `main`, folder `/`), open:

https://emil007.github.io/gator-web/player/

Use **Choose ROM** / drag-and-drop. Quick-load from `roms/` is local-server only.

## Controls (EmulatorJS defaults)

| Button | Key |
|--------|-----|
| D-Pad | Arrows |
| A | X |
| B | Z |
| Start | Enter |
| Select | Shift |

Remap in the emulator menu. Save states stay in this browser origin.

## Layout

```
player/                 web UI + EmulatorJS loader
scripts/serve_player.ps1
index.html              redirects → player/
```
