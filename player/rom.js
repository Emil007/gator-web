/** ROM load helpers — .gb / .gbc / .zip (bring-your-own; never ships dumps). */

const NINTENDO_LOGO = new Uint8Array([
  0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b, 0x03, 0x73, 0x00, 0x83, 0x00, 0x0c, 0x00, 0x0d,
  0x00, 0x08, 0x11, 0x1f, 0x88, 0x89, 0x00, 0x0e, 0xdc, 0xcc, 0x6e, 0xe6, 0xdd, 0xdd, 0xd9, 0x99,
  0xbb, 0xbb, 0x67, 0x63, 0x6e, 0x0e, 0xec, 0xcc, 0xdd, 0xdc, 0x99, 0x9f, 0xbb, 0xb9, 0x33, 0x3e,
]);

/** Known No-Intro-ish fingerprints (size + dest + light hash) — soft ID only. */
const KNOWN = [
  { id: "us", label: "US / EU", dest: 0x01 },
  { id: "jp", label: "Japan", dest: 0x00 },
  { id: "beta", label: "Beta", dest: 0x00 },
];

export function parseHeader(bytes) {
  const titleBytes = bytes.subarray(0x134, 0x144);
  const title = Array.from(titleBytes)
    .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ""))
    .join("")
    .replace(/\0+$/, "")
    .trim();
  return {
    title,
    cartType: bytes[0x147],
    romSizeCode: bytes[0x148],
    ramSizeCode: bytes[0x149],
    destination: bytes[0x14A],
    version: bytes[0x14C],
    bankCount: 2 << bytes[0x148],
  };
}

export function looksLikeGbRom(bytes) {
  if (!bytes || bytes.length < 0x150) return false;
  // Prefer Nintendo logo check; also accept 32/64 KiB carts with PINBALL title
  let logo = true;
  for (let i = 0; i < NINTENDO_LOGO.length; i++) {
    if (bytes[0x104 + i] !== NINTENDO_LOGO[i]) {
      logo = false;
      break;
    }
  }
  if (logo) return true;
  const h = parseHeader(bytes);
  return h.title.includes("PINBALL") && (bytes.length === 32768 || bytes.length === 65536);
}

export function identifyVariant(bytes) {
  const h = parseHeader(bytes);
  const fp = md5ish(bytes);
  // Soft labels — all three are playable the same way
  if (h.title && !h.title.includes("PINBALL")) {
    return { id: "other", label: h.title || "Unknown GB", header: h, fp, knownGator: false };
  }
  let label = "PINBALL (unknown region)";
  if (h.destination === 0x01) label = "US / EU";
  else if (bytes.length === 65536) label = "Japan or Beta";
  // Refine JP vs Beta via a few known differing bytes if present
  if (h.destination === 0x00 && bytes.length === 65536) {
    // WANI string appears in JP (+0x1F encoded); crude probe
    const probe = bytes.subarray(0x5e0, 0x700);
    let hasWani = false;
    let hasGator = false;
    for (let i = 0; i < probe.length - 4; i++) {
      // 'W'+0x1F etc is messy; check ASCII-ish after -0x1F
      const s = String.fromCharCode(...[0, 1, 2, 3].map((k) => (probe[i + k] - 0x1f) & 0xff));
      if (s === "WANI") hasWani = true;
      if (s === "GATO") hasGator = true;
    }
    if (hasWani) label = "Japan";
    else if (hasGator) label = "US/EU Beta";
  }
  return { id: "gator", label, header: h, fp, knownGator: true };
}

function u16(v, o) {
  return v[o] | (v[o + 1] << 8);
}
function u32(v, o) {
  return (v[o] | (v[o + 1] << 8) | (v[o + 2] << 16) | (v[o + 3] << 24)) >>> 0;
}

async function inflateRaw(data) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser can’t inflate ZIP entries (no DecompressionStream)");
  }
  const ds = new DecompressionStream("deflate-raw");
  const out = await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}

/**
 * Minimal ZIP reader: STORE + DEFLATE, finds .gb/.gbc members.
 */
export async function extractGbFromZip(bytes) {
  const v = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const entries = [];
  let i = 0;
  while (i + 30 < v.length) {
    if (u32(v, i) !== 0x04034b50) {
      // skip until next local header or give up after EOCD scan
      break;
    }
    const flags = u16(v, i + 6);
    const method = u16(v, i + 8);
    let compSize = u32(v, i + 18);
    let uncompSize = u32(v, i + 22);
    const nameLen = u16(v, i + 26);
    const extraLen = u16(v, i + 28);
    const nameStart = i + 30;
    const name = new TextDecoder().decode(v.subarray(nameStart, nameStart + nameLen));
    let dataStart = nameStart + nameLen + extraLen;
    let dataEnd = dataStart + compSize;

    if (flags & 0x08) {
      // data descriptor: sizes were 0 — scan for descriptor signature after compressed data (fragile).
      // Prefer re-parse via central directory below.
      break;
    }

    const comp = v.subarray(dataStart, dataEnd);
    entries.push({ name, method, comp, uncompSize });
    i = dataEnd;
  }

  // Fallback: central directory (handles data-descriptor zips)
  if (!entries.length) {
    let eocd = -1;
    for (let p = v.length - 22; p >= Math.max(0, v.length - 0x10000); p--) {
      if (u32(v, p) === 0x06054b50) {
        eocd = p;
        break;
      }
    }
    if (eocd < 0) throw new Error("Not a ZIP, or unsupported ZIP layout");
    let cd = u32(v, eocd + 16);
    const nEntries = u16(v, eocd + 10);
    for (let n = 0; n < nEntries; n++) {
      if (u32(v, cd) !== 0x02014b50) break;
      const method = u16(v, cd + 10);
      const compSize = u32(v, cd + 20);
      const uncompSize = u32(v, cd + 24);
      const nameLen = u16(v, cd + 28);
      const extraLen = u16(v, cd + 30);
      const commentLen = u16(v, cd + 32);
      const localOff = u32(v, cd + 42);
      const name = new TextDecoder().decode(v.subarray(cd + 46, cd + 46 + nameLen));
      const lh = localOff;
      if (u32(v, lh) !== 0x04034b50) {
        cd += 46 + nameLen + extraLen + commentLen;
        continue;
      }
      const lName = u16(v, lh + 26);
      const lExtra = u16(v, lh + 28);
      const dataStart = lh + 30 + lName + lExtra;
      const comp = v.subarray(dataStart, dataStart + compSize);
      entries.push({ name, method, comp, uncompSize });
      cd += 46 + nameLen + extraLen + commentLen;
    }
  }

  const romish = entries.filter((e) => /\.(gb|gbc)$/i.test(e.name) && !e.name.endsWith("/"));
  if (!romish.length) throw new Error("ZIP has no .gb / .gbc file inside");

  const pick = romish[0];
  let raw;
  if (pick.method === 0) raw = pick.comp;
  else if (pick.method === 8) raw = await inflateRaw(pick.comp);
  else throw new Error(`ZIP compression method ${pick.method} not supported (need store/deflate)`);

  if (pick.uncompSize && raw.length !== pick.uncompSize) {
    // some writers lie; still try
  }
  return { bytes: raw, name: pick.name.split(/[/\\]/).pop() };
}

export async function loadRomBytes(fileOrBuf, nameHint = "") {
  let bytes;
  let name = nameHint;

  if (fileOrBuf instanceof File || fileOrBuf instanceof Blob) {
    name = name || fileOrBuf.name || "rom";
    bytes = new Uint8Array(await fileOrBuf.arrayBuffer());
  } else {
    bytes = fileOrBuf instanceof Uint8Array ? fileOrBuf : new Uint8Array(fileOrBuf);
  }

  const lower = name.toLowerCase();
  if (lower.endsWith(".zip") || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    const extracted = await extractGbFromZip(bytes);
    bytes = extracted.bytes;
    name = extracted.name || name.replace(/\.zip$/i, ".gb");
  }

  if (!looksLikeGbRom(bytes)) {
    throw new Error("File doesn’t look like a Game Boy ROM (.gb/.gbc)");
  }

  const info = identifyVariant(bytes);
  return { bytes, name, info };
}

export async function loadRomFromFile(file) {
  const { bytes } = await loadRomBytes(file, file.name);
  return bytes;
}

export async function loadRomFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const name = decodeURIComponent(url.split("/").pop() || "rom.gb");
  const { bytes } = await loadRomBytes(buf, name);
  return bytes;
}

export function md5ish(bytes) {
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i += 97) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// silence unused in tree-shaking edge cases
void KNOWN;
