# Pinball: Revenge of the 'Gator — Reverse Engineering Notes

HAL Laboratory pinball for Game Boy (1989–1990). Three known ROM variants are in `roms/`.

| Tag | File | Product | SHA-1 |
|-----|------|---------|-------|
| **JP** | `Pinball - 66hiki no Wani Daikoushin! (Japan).gb` | DMG-PBJ | `3671335514b388ee08322416abd873f11a5e0b66` |
| **US** | `Pinball - Revenge of the 'Gator (USA, Europe).gb` | DMG-PBE | `493834db1c3c7859086a1c570a4bf5e5f6dd332b` |
| **BETA** | `Pinball - Revenge of the 'Gator (USA, Europe) (Beta).gb` | proto | `7f25663b3c1c15a3ee4f1bb719741823eea71ebb` |

All three are **64 KiB**, **MBC1**, **no SRAM**, header title `PINBALL`, licensee `0xB6`. Hashes match No-Intro / Hidden Palace.

## Variant relationship

```
JP (Oct 1989) ──localization──► BETA (English proto) ──polish──► US/EU retail
```

| Compare | Differing bytes | Where it bites |
|---------|-----------------|----------------|
| JP ↔ US | ~34 538 (53%) | Text, tiles, most of banks 1–3 |
| JP ↔ BETA | ~35 470 | Same plus proto graphics drift |
| US ↔ BETA | ~24 399 | Almost all in **banks 2–3** (graphics); bank0 only **69** bytes |

### Per 4 KiB block (identity)

| ROM offset | Notes |
|------------|--------|
| `$1000`, `$3000` | **Identical** across all three |
| `$4000`–`$6000` | US == BETA; JP differs (code/data localization) |
| `$7000` | All differ (US↔BETA still 1433 bytes — late bank1 assets) |
| `$8000` | Nearly identical (1 byte JP↔US) |
| `$9000`–`$FFFF` | Heavy graphics divergence (JP vs English; BETA vs US tiles) |

### Header

| Field | JP | BETA | US |
|-------|----|------|-----|
| Destination `$014A` | Japan (`00`) | Japan (`00`) | Non-Japan (`01`) |
| Header checksum | `2D` | `2D` | `2C` |
| Global checksum | `83ED` | `F41C` | `DD73` |

BETA is English content with a **Japan destination byte** still set — typical unfinished localization cart.

### User-visible string deltas (encoding below)

- JP menu/title uses **`WANI`** (鰐); US/BETA use **`GATOR`** prefixed with control byte `$30` (trademark / special tile).
- Shared English UI: `HAL LABORATORY INC`, `LICENSED BY NINTENDO`, `PUSH START`, `MATCH`, `PLAYER` / `PLAYERS`, `PLAY A` / `PLAY B`.
- Cleartext staff at `$0080`: **TOSHIO SENGOKU**, **MAKI SENGOKU** (repeated).

## Cartridge / memory map

```
ROM 64 KiB = 4 × 16 KiB banks (MBC1)
  Bank 0  $0000–$3FFF  fixed (vectors, header, boot, game state, many utils)
  Bank 1  $4000–$7FFF  switchable — sound driver, more game code
  Bank 2  $8000–$BFFF  switchable — primarily graphics
  Bank 3  $C000–$FFFF  switchable — primarily graphics

CPU view when bank N mapped at $4000:
  $0000–$3FFF  always ROM bank 0
  $4000–$7FFF  ROM bank N
```

Only **one** `LD ($2000),A` site: `$111F`, inside bank-switch helper `$1117`. Current bank cached at **`$C0B4`**.

## Boot path

```
$0100  NOP / JP $0150
$0150  JP $02DB
$02DB  wait LY==$91
       LCD off
       SP=$FFFE, DI
       fill VRAM $8000 len $6000 with 0      ; CALL $108E memset
       SP=$CFFF
       fill OAM  $FE00 len $0100 with 0
       fill HRAM $FF80 len $007F with 0
       CALL $1117 with A=1   ; select ROM bank 1
       CALL $1057            ; clear BG map $9800
       CALL $1082            ; clear BG map $9C00
       copy $0FAD → $FF80 (10 bytes)  ; OAM DMA stub (LDH (DMA),A)
       reset scroll/pal/IF; IE=$0D (VBlank+LCD+Timer? bits 0,2,3)
       CALL $6172            ; sound init (NR52/NR50/NR51)
       LCD on ($80)
       timer TMA/TIMA=$BC, start
       copy 15 bytes $037A → $C0BA
       init countdown slots $C0CC..=5,4,3,2,1
       EI
.main  CALL $0D61            ; wait / sync on FFC8 flags
       CALL $0389            ; game-state dispatcher
       JR .main
```

OAM DMA routine source at `$0FAD`:

```
3E C0  E0 46  3E 28  3D  20 FD  C9
; LD A,$C0 / LDH ($46),A / delay / RET
```

## Interrupts

| Vector | Handler | Role |
|--------|---------|------|
| `$0040` VBlank | `$0153` | Frame work, optional call `$FF80` DMA, SCX/SCY from `$FFB7`/`$FFB8`, banked call via `$1107` |
| `$0048` STAT | `$0191` | Alt SCX from `$FFB6`, toggles LCDC BG tile bit |
| `$0050` Timer | `$019C` | Increments `$FFCD`, may force LCD on path |
| `$0058` Serial | `$01B4` | Link cable: `$FF01` ↔ `$FFCA`/`$C0AA`, `$FFCB` TX |
| `$0060` Joypad | `RETI` only | unused |

RST helpers (bank 0 unless noted):

| RST | Target | Role |
|-----|--------|------|
| `RST00` | `$10F0` | Index pointer table: `HL += 2*A`, return word |
| `RST08` | `$61BA` US/BETA, `$61E0` JP | Sound/music driver entry (bank 1) |
| `RST10` | `$0ED2` | Sprite / object setup helper |
| `RST18` | `$1148` | (util) |
| `RST20` | `$0DE4` | (util) |
| `RST28` | `$0E18` | (util) |
| `RST30` | `$1037` | (util) |
| `RST38` | inline | tiny HL helper |

Jump-table dispatcher at `$10FB`: pops return address, indexes word table by `A`, `JP HL`.

## Game state machine

`$0389`: `LDH A,($FFBD)` → `CALL $10FB` → pointer table at `$038E`.

| `$FFBD` | Handler | Likely role (tentative) |
|---------|---------|-------------------------|
| 0 | `$03B4` | Attract / title |
| 1 | `$040B` | Menu |
| 2 | `$06DF` | Mode setup |
| 3 | `$06FE` | |
| 4 | `$074E` | |
| 5 | `$075E` | |
| 6 | `$077D` | |
| 7 | `$0914` | |
| 8 | `$092C` | |
| 9–15 | `$02D9` | stubs |
| 16 | `$09F7` | |
| 17 | `$0A0D` | |
| 18 | `$09D2` | |

## Text encoding

UI strings (not the `$0080` credits) store bytes as:

```
stored = ASCII + 0x1F
```

Padding / blank often `$7F` (decodes to `` ` `` if treated as ASCII). Record separator / terminator often `$4A` (`+`). US/BETA insert raw `$30` before `GATOR` (not in +$1F alphabet) — special tile (™ / logo mark).

Decode helper: `python decode_text.py`

Primary string blob: **`$05E0`–`$06E0`** (credits line + menu labels). JP substitutes `WANI` for `GATOR`.

## Sound

- Init `$6172` (bank 1): enables APU, max stereo pan.
- Runtime entry `RST08` → `$61BA` (US) / `$61E0` (JP) — pointer shift matches localization size change in bank 1.
- Uses WRAM `$CD03`, `$CDCA`, `$CDCE`, tables near `$79F3`/`$7A18` (US).

## Link cable

Serial ISR and `$FFC9` bit0/bit7 gating show **2P / versus** support (`MATCH`, `PLAYERS` strings). TX buffer `$FFCB`, RX `$FFCA` + `$C0AA`.

## HRAM / WRAM scratch (observed)

| Addr | Use |
|------|-----|
| `$FFB6`–`$FFB8` | Scroll shadows (STAT/VBlank split-screen style) |
| `$FFBD` | Game state index |
| `$FFC8` | Sync flags (bit7/6/5) |
| `$FFC9` | Mode / link flags |
| `$FFCA`/`$FFCB` | Serial RX/TX |
| `$FFCD` | Frame-ish counter |
| `$C0B4` | Current MBC1 ROM bank |
| `$C0BA`… | Copy of table at `$037A` |
| `$C0CC`… | Five related countdown bytes |

## Tooling in this repo

| Script | Purpose |
|--------|---------|
| `scripts/setup_tools.ps1` | Download RGBDS + clone mgbdis |
| `scripts/generate_sym.py` | Reachability `.sym` for US |
| `scripts/disassemble_all.py` | mgbdis + rebuild + MD5 check (us/jp/beta) |
| `scripts/build.ps1` | Assemble US `disassembly/` → identical `game.gb` |
| `analyze_roms.py` | Headers, pairwise diffs, strings, entropy |
| `decode_text.py` | +$1F string decode, boot follow |
| `map_systems.py` | State table, block identity, HRAM notes |

### Rebuildable disassembly

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup_tools.ps1
python scripts\disassemble_all.py          # all three variants
powershell -ExecutionPolicy Bypass -File scripts\build.ps1   # US only
```

| Output | Matches |
|--------|---------|
| `disassembly/game.gb` | US/EU retail |
| `disassembly-jp/game.gb` | Japan retail |
| `disassembly-beta/game.gb` | US/EU beta |

Each bank is a full RGBDS `SECTION` (`bank_000.asm` … `bank_003.asm`). Bank 3 is emitted as `.data` (tile graphics); banks 0–2 are instruction-disassembled with RE labels on the US tree.

## Next RE targets

1. Label remaining `$FFBD` state handlers and menu flow in the asm.
2. Pinball physics: ball position/velocity WRAM, collision tables.
3. `.image` extractions for bank 3 tiles; BETA↔US title TM / `'Gator` tilemap diffs.
4. Full sound script format behind `RST08`.
5. Grow `symbols/us.sym` (and JP/BETA) until every routine has a name.

## References

- [Hidden Palace — prototype](https://hiddenpalace.org/Pinball:_Revenge_of_the_%27Gator_(Prototype))
- [GBHWDB DMG-PBE-0](https://gbhwdb.gekkio.fi/cartridges/DMG-PBE-0)
- [GBHWDB DMG-PBJ-0](https://gbhwdb.gekkio.fi/cartridges/DMG-PBJ-0)
- Pan Docs / gbdev — MBC1, interrupt vectors, APU
