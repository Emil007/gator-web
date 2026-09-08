/** Game Boy 2bpp tile decode → RGBA ImageData / atlas. */

const DMG = [
  [155, 188, 15, 255], // lightest
  [139, 172, 15, 255],
  [48, 98, 48, 255],
  [15, 56, 15, 255], // darkest
];

export function decodeTile(tile16, palette = DMG) {
  const pixels = new Uint8ClampedArray(8 * 8 * 4);
  for (let y = 0; y < 8; y++) {
    const lo = tile16[y * 2];
    const hi = tile16[y * 2 + 1];
    for (let x = 0; x < 8; x++) {
      const bit = 7 - x;
      const c = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
      const p = palette[c];
      const i = (y * 8 + x) * 4;
      pixels[i] = p[0];
      pixels[i + 1] = p[1];
      pixels[i + 2] = p[2];
      pixels[i + 3] = p[3];
    }
  }
  return pixels;
}

/** Decode a contiguous tile blob starting at ROM file offset. */
export function decodeTileBlob(rom, offset, tileCount) {
  const tiles = [];
  for (let t = 0; t < tileCount; t++) {
    const start = offset + t * 16;
    tiles.push(decodeTile(rom.subarray(start, start + 16)));
  }
  return tiles;
}

/** Build an atlas canvas: tilesPerRow wide. */
export function buildAtlas(tiles, tilesPerRow = 16) {
  const rows = Math.ceil(tiles.length / tilesPerRow);
  const canvas = document.createElement("canvas");
  canvas.width = tilesPerRow * 8;
  canvas.height = rows * 8;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(8, 8);
  tiles.forEach((pix, i) => {
    img.data.set(pix);
    const x = (i % tilesPerRow) * 8;
    const y = Math.floor(i / tilesPerRow) * 8;
    ctx.putImageData(img, x, y);
  });
  return canvas;
}

export function drawTile(ctx, tilePixels, dx, dy, scale = 1) {
  const img = ctx.createImageData(8, 8);
  img.data.set(tilePixels);
  if (scale === 1) {
    ctx.putImageData(img, dx, dy);
    return;
  }
  // scale via temporary canvas
  const tmp = document.createElement("canvas");
  tmp.width = 8;
  tmp.height = 8;
  tmp.getContext("2d").putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, dx, dy, 8 * scale, 8 * scale);
}
