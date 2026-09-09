# gator

Bring-your-own-ROM web player for *Pinball: Revenge of the 'Gator* / *66匹のワニ大行進* (Game Boy).

**This repo does not include any commercial ROM.** You must supply a dump you are allowed to use. The browser loads it locally; nothing is uploaded.

## Play

```powershell
powershell -ExecutionPolicy Bypass -File scripts\serve_player.ps1
```

Open http://127.0.0.1:8765/player/ and pick a `.gb`, `.gbc`, or `.zip` that contains one.

Supported dumps (same engine path for all):

| Variant | Typical file |
|---------|----------------|
| Japan | `Pinball - 66hiki no Wani Daikoushin! (Japan).gb` |
| US / Europe | `Pinball - Revenge of the 'Gator (USA, Europe).gb` |
| Beta | `Pinball - Revenge of the 'Gator (USA, Europe) (Beta).gb` |

Optional: drop files in local `roms/` (gitignored) for quick-load buttons when serving from the repo.

## Controls

- **← / →** left / right flipper · **Space or ↓** plunger (hold, then release) · **Enter** start/pause  
- **Mobile:** invisible zones — left / center (plunger) / right · top strip = start · triple-tap top = eject  

## What this is

A small dynamic SM83 runtime + PPU in the browser. It is not Nintendo’s emulator, not EmulatorJS, and not a redistributed game.

## Layout

```
player/     web UI + CPU/PPU/input
scripts/    local serve helper
roms/       your dumps only (gitignored)
```
