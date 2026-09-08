import { loadRomFromFile, loadRomFromUrl } from "./rom.js";
import { createMachine, CYCLES_PER_FRAME } from "./machine.js";
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
let speed = 1; // 1 = realtime (~60 Hz frames)
let frames = 0;
let fallbackHits = 0;

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

/** Run one DMG frame (~70224 T-cycles) of recompiled code. */
function runFrameCycles() {
  let cycles = 0;
  const target = CYCLES_PER_FRAME * speed;
  let steps = 0;
  const maxSteps = 500000 * speed;

  while (cycles < target && steps < maxSteps) {
    const irqCyc = machine.checkInterrupts();
    if (irqCyc) {
      cycles += irqCyc * 4;
      machine.advanceDots(irqCyc * 4);
    }

    if (machine.r.halted) {
      // burn cycles until interrupt wakes
      machine.advanceDots(4);
      cycles += 4;
      steps++;
      continue;
    }

    const pcBefore = machine.r.pc;
    const bankBefore = machine.getRomBank();
    const m = cpu.step() || 1;
    // detect fallback: step always returns m-cycles now
    cycles += m * 4;
    machine.advanceDots(m * 4);
    steps++;

    // rough fallback counter: if PC landed on unmapped often
    if (m === 1 && machine.r.pc === ((pcBefore + 1) & 0xffff)) {
      // could be nop or skip — ignore
    }
  }
  return { cycles, steps };
}

function frame() {
  if (!machine || !cpu) return;
  pollInput();
  const { cycles, steps } = runFrameCycles();
  renderFrame(machine, frameBuf);
  ctx.putImageData(frameBuf, 0, 0);
  frames++;
  if ((frames & 0x1f) === 0) {
    status.textContent =
      `${status.dataset.name} · pc=$${machine.r.pc.toString(16).padStart(4, "0")}` +
      ` bank=${machine.getRomBank()} ly=${machine.getLY()}` +
      ` · ${steps}|${cycles}t · ${cpu.count}ops · x${speed}`;
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
  fallbackHits = 0;
  log(
    `1:1 flow-based static recompile\n` +
      `ROM ${name}\n` +
      `AOT ops: ${cpu.count}\n` +
      `scheduler: ${CYCLES_PER_FRAME} T-cycles/frame (DMG), DIV/TIMA/LY/STAT/IRQs\n` +
      `holes: one-instruction decode fallback (not a full interpreter loop)`
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
  speed = Math.max(0.25, speed / 2);
  log(`speed → ${speed}x (${CYCLES_PER_FRAME * speed} T/frame)`);
});
document.getElementById("mode-play")?.addEventListener("click", () => {
  speed = Math.min(4, speed * 2);
  log(`speed → ${speed}x (${CYCLES_PER_FRAME * speed} T/frame)`);
});

probeQuick();
