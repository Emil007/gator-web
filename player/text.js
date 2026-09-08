/** UI text encoding from RE: stored = ASCII + 0x1F; $7F ≈ blank; $4A separator. */

const ENC = 0x1f;

export function decodeByte(b) {
  if (b === 0x7f) return " ";
  if (b === 0x4a) return "|";
  if (b === 0x30) return "™"; // special tile before GATOR in US/BETA
  const c = (b - ENC) & 0xff;
  if (c >= 32 && c < 127) return String.fromCharCode(c);
  return "";
}

export function decodeRange(rom, start, length) {
  let out = "";
  for (let i = 0; i < length; i++) out += decodeByte(rom[start + i]);
  return out.replace(/[ \t]+/g, " ").trim();
}

/** Pull the known title/menu blob around $05E0. */
export function extractMenuStrings(rom) {
  const raw = decodeRange(rom, 0x05e0, 0x100);
  const hasGator = /GATOR/i.test(raw);
  const hasWani = /WANI/i.test(raw);
  return {
    raw,
    variantGuess: hasWani ? "JP" : hasGator ? "US/BETA" : "unknown",
    snippets: {
      lab: raw.includes("HAL") || raw.includes("LABOR"),
      nintendo: /NINTENDO/i.test(raw),
      gator: hasGator,
      wani: hasWani,
      match: /MATCH/i.test(raw),
    },
  };
}

export function creditsAscii(rom) {
  return Array.from(rom.subarray(0x80, 0x100))
    .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : " "))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
