/** Minimal DMG PPU — BG + sprites, enough for 1:1 frames from machine VRAM/OAM. */

const SHADE = [
  [155, 188, 15],
  [139, 172, 15],
  [48, 98, 48],
  [15, 56, 15],
];

function palMap(bgp) {
  return [bgp & 3, (bgp >> 2) & 3, (bgp >> 4) & 3, (bgp >> 6) & 3];
}

export function renderFrame(m, imageData) {
  const { vram, oam, io } = m;
  const lcdc = io[0x40];
  const scx = io[0x43];
  const scy = io[0x42];
  const bgp = palMap(io[0x47] || 0xe4);
  const obp0 = palMap(io[0x48] || 0xe4);
  const obp1 = palMap(io[0x49] || 0xe4);
  const out = imageData.data;

  const bgOn = lcdc & 0x01;
  const objOn = lcdc & 0x02;
  const obj8x16 = lcdc & 0x04;
  const mapBase = lcdc & 0x08 ? 0x1c00 : 0x1800; // relative to vram[0]
  const tileBaseSigned = !(lcdc & 0x10); // 0=8800 signed, 1=8000 unsigned
  const winOn = lcdc & 0x20;
  const winMap = lcdc & 0x40 ? 0x1c00 : 0x1800;
  const lcdEnable = lcdc & 0x80;

  if (!lcdEnable) {
    for (let i = 0; i < out.length; i += 4) {
      out[i] = 15;
      out[i + 1] = 56;
      out[i + 2] = 15;
      out[i + 3] = 255;
    }
    return;
  }

  function tilePixel(tileIndex, px, py, signed) {
    let addr;
    if (signed) {
      const t = tileIndex > 127 ? tileIndex - 256 : tileIndex;
      addr = 0x1000 + t * 16 + py * 2; // 8800 area relative: vram index 0x1000 = 0x9000
    } else {
      addr = tileIndex * 16 + py * 2;
    }
    const lo = vram[addr & 0x1fff];
    const hi = vram[(addr + 1) & 0x1fff];
    const bit = 7 - px;
    return ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
  }

  for (let y = 0; y < 144; y++) {
    for (let x = 0; x < 160; x++) {
      let color = 0;
      if (bgOn) {
        const bx = (x + scx) & 0xff;
        const by = (y + scy) & 0xff;
        const tx = bx >> 3;
        const ty = by >> 3;
        const ti = vram[mapBase + ty * 32 + tx];
        color = tilePixel(ti, bx & 7, by & 7, tileBaseSigned);
      }
      // window
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
      const shade = SHADE[bgp[color]];
      const i = (y * 160 + x) * 4;
      out[i] = shade[0];
      out[i + 1] = shade[1];
      out[i + 2] = shade[2];
      out[i + 3] = 255;
    }
  }

  if (objOn) {
    const h = obj8x16 ? 16 : 8;
    for (let s = 0; s < 40; s++) {
      const oy = oam[s * 4] - 16;
      const ox = oam[s * 4 + 1] - 8;
      let tile = oam[s * 4 + 2];
      const attr = oam[s * 4 + 3];
      if (obj8x16) tile &= 0xfe;
      const pal = attr & 0x10 ? obp1 : obp0;
      const xFlip = attr & 0x20;
      const yFlip = attr & 0x40;
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < 8; px++) {
          const x = ox + px;
          const y = oy + py;
          if (x < 0 || x >= 160 || y < 0 || y >= 144) continue;
          const tpx = xFlip ? 7 - px : px;
          const tpy = yFlip ? h - 1 - py : py;
          const ti = obj8x16 ? tile + (tpy >= 8 ? 1 : 0) : tile;
          const cy = tpy & 7;
          const c = tilePixel(ti, tpx, cy, false);
          if (c === 0) continue;
          const shade = SHADE[pal[c]];
          const i = (y * 160 + x) * 4;
          if (!(attr & 0x80) || out[i] === SHADE[bgp[0]][0]) {
            out[i] = shade[0];
            out[i + 1] = shade[1];
            out[i + 2] = shade[2];
          }
        }
      }
    }
  }
}
