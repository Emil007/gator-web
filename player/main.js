import { loadRomFromFile, loadRomFromUrl } from "./rom.js";
import { createInput } from "./input.js";
import { createEngine, Mode } from "./engine.js";

const VARIANTS = [
  { label: "US / EU", path: "roms/Pinball - Revenge of the 'Gator (USA, Europe).gb" },
  { label: "Japan", path: "roms/Pinball - 66hiki no Wani Daikoushin! (Japan).gb" },
  { label: "Beta", path: "roms/Pinball - Revenge of the 'Gator (USA, Europe) (Beta).gb" },
];

const boot = document.getElementById("boot");
const app = document.getElementById("app");
const fileInput = document.getElementById("file");
const status = document.getElementById("status");
const logEl = document.getElementById("log");
const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");
const quick = document.getElementById("quick");
const quickButtons = document.getElementById("quick-buttons");

const input = createInput();
let engine = null;
let raf = 0;

function log(msg) {
  logEl.textContent = String(msg);
}

function romBase() {
  return location.pathname.replace(/\\/g, "/").includes("/player") ? "../" : "./";
}

async function probeQuick() {
  const base = romBase();
  const found = [];
  await Promise.all(
    VARIANTS.map(async (v) => {
      try {
        const res = await fetch(base + v.path, { method: "HEAD", cache: "no-store" });
        if (res.ok) found.push({ ...v, url: base + v.path });
      } catch {
        /* file:// or missing */
      }
    })
  );
  if (!found.length) return;
  quick.hidden = false;
  for (const v of found) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = v.label;
    btn.addEventListener("click", () => startFromUrl(v.url, v.path.split("/").pop()));
    quickButtons.appendChild(btn);
  }
}

function stopLoop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

function frame() {
  if (!engine) return;
  engine.update(input);
  engine.draw(ctx);
  raf = requestAnimationFrame(frame);
}

function showApp(name) {
  boot.hidden = true;
  app.hidden = false;
  status.textContent = name;
}

async function startRom(bytes, name) {
  stopLoop();
  engine = createEngine(bytes, name, log);
  showApp(name);
  frame();
}

async function startFromFile(file) {
  const bytes = await loadRomFromFile(file);
  await startRom(bytes, file.name);
}

async function startFromUrl(url, name) {
  const bytes = await loadRomFromUrl(url);
  await startRom(bytes, name);
}

fileInput.addEventListener("change", () => {
  const f = fileInput.files && fileInput.files[0];
  if (f) startFromFile(f);
});

document.getElementById("eject").addEventListener("click", () => location.reload());
document.getElementById("mode-menu").addEventListener("click", () => engine && engine.setMode(Mode.MENU));
document.getElementById("mode-play").addEventListener("click", () => engine && engine.setMode(Mode.TABLE));

probeQuick();
