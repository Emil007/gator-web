/** Minimal DMG PPU — BG + window + sprites (8×8 / 8×16), OBJ priority.
 * Uses per-scanline LCDC/scroll snapshots when present (mid-frame tile-data switches).
 */

const SHADE = [
  [155, 188, 15],
  [139, 172, 15],
  [48, 98, 48],
  [15, 56, 15],
];

function palMap(reg) {
  const bgp = reg & 0xff;
  return [bgp & 3, (bgp >> 2) & 3, (bgp >> 4) & 3, (bgp >> 6) & 3];
}

export function renderFrame(m, imageData) {
  const { vram, oam, io } = m;
  const lineLcdc = m.lineLcdc;
  const lineScx = m.lineScx;
  const lineScy = m.lineScy;
  const lineBgp = m.lineBgp;
  const out = imageData.data;
  const bgIdx = new Uint8Array(160 * 144);

  const fallbackLcdc = io[0x40];
  if (!(fallbackLcdc & 0x80) && !(lineLcdc && lineLcdc[0] & 0x80)) {
    for (let i = 0; i < out.length; i += 4) {
      out[i] = 15;
      out[i + 1] = 56;
      out[i + 2] = 15;
      out[i + 3] = 255;
    }
    return;
  }

  const obp0 = palMap(io[0x48]);
  const obp1 = palMap(io[0x49]);

  function tilePixel(tileIndex, px, py, signed) {
    let addr;
    if (signed) {
      const t = tileIndex > 127 ? tileIndex - 256 : tileIndex;
      addr = 0x1000 + t * 16 + py * 2;
    } else {
      addr = (tileIndex & 0xff) * 16 + py * 2;
    }
    const lo = vram[addr & 0x1fff];
    const hi = vram[(addr + 1) & 0x1fff];
    const bit = 7 - px;
    return ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
  }

  for (let y = 0; y < 144; y++) {
    const lcdc = lineLcdc ? lineLcdc[y] : fallbackLcdc;
    if (!(lcdc & 0x80)) {
      for (let x = 0; x < 160; x++) {
        const i = (y * 160 + x) * 4;
        out[i] = 15;
        out[i + 1] = 56;
        out[i + 2] = 15;
        out[i + 3] = 255;
        bgIdx[y * 160 + x] = 0;
      }
      continue;
    }

    const scx = lineScx ? lineScx[y] : io[0x43];
    const scy = lineScy ? lineScy[y] : io[0x42];
    const bgp = palMap(lineBgp ? lineBgp[y] : io[0x47]);
    const bgOn = lcdc & 0x01;
    const mapBase = lcdc & 0x08 ? 0x1c00 : 0x1800;
    const tileBaseSigned = !(lcdc & 0x10);
    const winOn = lcdc & 0x20;
    const winMap = lcdc & 0x40 ? 0x1c00 : 0x1800;

    for (let x = 0; x < 160; x++) {
      let color = 0;
      if (bgOn) {
        const bx = (x + scx) & 0xff;
        const by = (y + scy) & 0xff;
        const ti = vram[mapBase + (by >> 3) * 32 + (bx >> 3)];
        color = tilePixel(ti, bx & 7, by & 7, tileBaseSigned);
      }
      if (winOn) {
        const wy = io[0x4a];
        const wx = io[0x4b] - 7;
        if (y >= wy && x >= wx) {
          const bx = x - wx;
          const by = y - wy;
          const ti = vram[winMap + (by >> 3) * 32 + (bx >> 3)];
          color = tilePixel(ti, bx & 7, by & 7, tileBaseSigned);
        }
      }
      bgIdx[y * 160 + x] = color;
      const shade = SHADE[bgp[color]];
      const i = (y * 160 + x) * 4;
      out[i] = shade[0];
      out[i + 1] = shade[1];
      out[i + 2] = shade[2];
      out[i + 3] = 255;
    }
  }

  // Sprites use end-of-frame LCDC (OBJ flags don't mid-frame toggle on this title)
  const lcdc = fallbackLcdc;
  const objOn = lcdc & 0x02;
  const obj8x16 = lcdc & 0x04;
  if (!objOn) return;

  const h = obj8x16 ? 16 : 8;
  const sprites = [];
  for (let s = 0; s < 40; s++) {
    const oy = oam[s * 4] - 16;
    const ox = oam[s * 4 + 1] - 8;
    if (oy >= 144 || oy + h <= 0 || ox >= 160 || ox + 8 <= 0) continue;
    sprites.push({ s, oy, ox, tile: oam[s * 4 + 2], attr: oam[s * 4 + 3] });
  }
  sprites.sort((a, b) => b.ox - a.ox || b.s - a.s);

  const objPainted = new Uint8Array(160 * 144);

  for (const sp of sprites) {
    let tile = sp.tile;
    if (obj8x16) tile &= 0xfe;
    const pal = sp.attr & 0x10 ? obp1 : obp0;
    const xFlip = sp.attr & 0x20;
    const yFlip = sp.attr & 0x40;
    const behind = sp.attr & 0x80;

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < 8; px++) {
        const x = sp.ox + px;
        const y = sp.oy + py;
        if (x < 0 || x >= 160 || y < 0 || y >= 144) continue;
        const pix = y * 160 + x;
        if (objPainted[pix]) continue;

        const tpx = xFlip ? 7 - px : px;
        let tpy = py;
        let ti = tile;
        if (obj8x16) {
          if (yFlip) {
            tpy = 15 - py;
            ti = tile + (py < 8 ? 1 : 0);
          } else {
            ti = tile + (py >= 8 ? 1 : 0);
          }
          tpy &= 7;
        } else if (yFlip) {
          tpy = 7 - py;
        }

        const c = tilePixel(ti, tpx, tpy, false);
        if (c === 0) continue;
        if (behind && bgIdx[pix] !== 0) continue;

        const shade = SHADE[pal[c]];
        const i = pix * 4;
        out[i] = shade[0];
        out[i + 1] = shade[1];
        out[i + 2] = shade[2];
        objPainted[pix] = 1;
      }
    }
  }
}
