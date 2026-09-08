import { loadRomFromFile, loadRomFromUrl } from "./rom.js";
import { createMachine } from "./machine.js";
import { renderFrame } from "./ppu.js";
import { bindRecompiled } from "./generated/recompiled.js";

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
const frameBuf = ctx.createImageData(160, 144);
const quick = document.getElementById("quick");
const quickButtons = document.getElementById("quick-buttons");

let machine = null;
let cpu = null;
let raf = 0;
let stepsPerFrame = 20000;
let frames = 0;

const keys = new Set();
window.addEventListener("keydown", (e) => {
  keys.add(e.key.toLowerCase());
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "enter"].includes(e.key.toLowerCase())) {
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

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
        /* ignore */
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

function pollInput() {
  if (!machine) return;
  machine.setJoypad({
    left: keys.has("arrowleft"),
    right: keys.has("arrowright"),
    up: keys.has("arrowup"),
    down: keys.has("arrowdown"),
    a: keys.has("x") || keys.has("a"),
    b: keys.has("z") || keys.has("s") || keys.has("b"),
    start: keys.has("enter"),
    select: keys.has("shift"),
  });
}

function serviceInterrupts() {
  // Minimal IE/IF: raise VBlank each frame when LCD on
  const ie = machine.hram ? 0 : 0;
  // IE is at 0xffff — stored in machine; read via rd
  // Set IF VBlank bit
  const ifReg = machine.rd(0xff0f) | 0x01;
  machine.wr(0xff0f, ifReg);
  const ieReg = machine.rd(0xffff);
  if (machine.r.ime && (ifReg & ieReg & 0x01)) {
    machine.r.ime = 0;
    machine.r.halted = 0;
    machine.wr(0xff0f, ifReg & ~0x01);
    machine.push16(machine.r.pc);
    machine.r.pc = 0x0040;
  }
}

function frame() {
  if (!machine || !cpu) return;
  pollInput();

  // Advance LY through a frame while executing — unblocks wait loops
  let steps = 0;
  const budget = stepsPerFrame;
  while (steps < budget) {
    if (machine.r.halted) {
      machine.r.halted = 0;
      break;
    }
    // Simulate LY periodically
    if ((steps & 0x3f) === 0) machine.tickLY();
    const ok = cpu.step();
    steps++;
    if (!ok && steps > 100) {
      // unmapped stretch — still nudge LY
      machine.tickLY();
    }
  }

  serviceInterrupts();
  renderFrame(machine, frameBuf);
  ctx.putImageData(frameBuf, 0, 0);
  frames++;
  if ((frames & 0x3f) === 0) {
    status.textContent = `${status.dataset.name} · pc=$${machine.r.pc.toString(16).padStart(4, "0")} bank=${machine.getRomBank()} ops=${cpu.count}`;
  }
  raf = requestAnimationFrame(frame);
}

function showApp(name) {
  boot.hidden = true;
  app.hidden = false;
  status.textContent = name;
  status.dataset.name = name;
}

async function startRom(bytes, name) {
  if (raf) cancelAnimationFrame(raf);
  machine = createMachine(bytes);
  machine.r.pc = 0x0100;
  cpu = bindRecompiled(machine);
  log(
    `1:1 static recompile runtime\n` +
      `ROM ${name} (${bytes.length} bytes)\n` +
      `recompiled ops: ${cpu.count}\n` +
      `entry $0100 — original SM83 semantics as JS, not an interpreter loop over opcodes\n` +
      `PPU renders VRAM/OAM the game itself writes`
  );
  showApp(name);
  frame();
}

async function startFromFile(file) {
  await startRom(await loadRomFromFile(file), file.name);
}
async function startFromUrl(url, name) {
  await startRom(await loadRomFromUrl(url), name);
}

fileInput.addEventListener("change", () => {
  const f = fileInput.files && fileInput.files[0];
  if (f) startFromFile(f);
});

document.getElementById("eject").addEventListener("click", () => location.reload());
document.getElementById("mode-menu")?.addEventListener("click", () => {
  stepsPerFrame = Math.max(2000, stepsPerFrame / 2);
  log(`steps/frame → ${stepsPerFrame}`);
});
document.getElementById("mode-play")?.addEventListener("click", () => {
  stepsPerFrame = Math.min(200000, stepsPerFrame * 2);
  log(`steps/frame → ${stepsPerFrame}`);
});

probeQuick();
