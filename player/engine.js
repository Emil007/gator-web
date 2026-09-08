/**
 * Native runtime — mirrors high-level GB game states without SM83.
 * Modes roughly follow $FFBD jump table from RE (attract / menu / play).
 */

import { parseHeader, bankSlice, md5ish } from "./rom.js";
import { decodeTileBlob, buildAtlas } from "./gfx.js";
import { extractMenuStrings, creditsAscii, decodeRange } from "./text.js";
import { createTable } from "./table.js";

export const Mode = {
  ATTRACT: 0,
  MENU: 1,
  TABLE: 2,
};

export function createEngine(rom, name, log) {
  const header = parseHeader(rom);
  const menu = extractMenuStrings(rom);
  const credits = creditsAscii(rom);

  // Bank 3 is mostly 2bpp in this title — take a window as atlas sample
  const bank3 = bankSlice(rom, 3);
  const tiles = decodeTileBlob(bank3, 0, 256);
  const atlas = buildAtlas(tiles, 16);

  const assets = { atlas, tiles, menu, credits, header };
  const table = createTable(assets);

  let mode = Mode.ATTRACT;
  let attractT = 0;

  log(
    `loaded ${name}\n` +
      `title="${header.title}" banks=${header.bankCount} dest=${header.destination}\n` +
      `fp=${md5ish(rom)} variant~${menu.variantGuess}\n` +
      `credits: ${credits.slice(0, 48)}…\n` +
      `menu decode: ${decodeRange(rom, 0x0650, 0x40).slice(0, 60)}…\n` +
      `bank3 tiles decoded: ${tiles.length} (atlas ${atlas.width}x${atlas.height})\n` +
      `runtime: native JS (no SM83)`
  );

  function setMode(m) {
    mode = m;
    log(`mode → ${Object.keys(Mode).find((k) => Mode[k] === m)}`);
  }

  function update(input) {
    if (mode === Mode.ATTRACT) {
      attractT++;
      if (input.start() || attractT > 400) setMode(Mode.MENU);
    } else if (mode === Mode.MENU) {
      if (input.start() || input.leftFlipper() || input.rightFlipper()) {
        setMode(Mode.TABLE);
      }
    } else if (mode === Mode.TABLE) {
      table.update(input);
    }
  }

  function draw(ctx) {
    if (mode === Mode.ATTRACT || mode === Mode.MENU) {
      ctx.fillStyle = "#0f380f";
      ctx.fillRect(0, 0, 160, 144);
      ctx.imageSmoothingEnabled = false;
      // show ROM tile atlas as "boot proof"
      ctx.drawImage(atlas, 0, 0, 160, 80, 0, 0, 160, 80);

      ctx.fillStyle = "#9bbc0f";
      ctx.font = "bold 10px monospace";
      ctx.fillText("gator native", 8, 96);
      ctx.font = "8px monospace";
      ctx.fillText(menu.variantGuess + " · " + header.title, 8, 108);
      const line =
        mode === Mode.ATTRACT ? "press Enter" : "Z/X or Enter → table POC";
      ctx.fillText(line, 8, 120);
      ctx.fillText("assets from your ROM", 8, 132);
    } else {
      table.draw(ctx);
    }
  }

  return {
    assets,
    get mode() {
      return mode;
    },
    setMode,
    update,
    draw,
  };
}
