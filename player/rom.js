/** ROM as a data pack — not executed as SM83. */

export function parseHeader(bytes) {
  const titleBytes = bytes.subarray(0x134, 0x144);
  const title = Array.from(titleBytes)
    .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ""))
    .join("")
    .replace(/\0+$/, "");
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

export function bankSlice(rom, bank) {
  const n = bank === 0 ? 1 : bank; // MBC1: write 0 selects bank 1
  const base = (n & 0x1f) * 0x4000;
  return rom.subarray(base, base + 0x4000);
}

export function cpuRead(rom, bank, addr) {
  if (addr < 0x4000) return rom[addr];
  const n = bank === 0 ? 1 : bank;
  return rom[n * 0x4000 + (addr - 0x4000)];
}

export async function loadRomFromFile(file) {
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

export async function loadRomFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

export function md5ish(bytes) {
  // lightweight fingerprint for UI (not crypto)
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i += 97) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
