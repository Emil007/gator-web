import { loadRomFromFile, loadRomFromUrl } from "./rom.js";
import { createMachine, CYCLES_PER_FRAME } from "./machine.js";
import { renderFrame } from "./ppu.js";
import { bindRecompiled } from "./generated/recompiled.js";

const VARIANTS = [
  {
    label: "US / EU",
    path: "roms/Pinball - Revenge of the 'Gator (USA, Europe).gb",
  },
  {
    label: "Japan",
    path: "roms/Pinball - 66hiki no Wani Daikoushin! (Japan).gb",
  },
  {
    label: "Beta",
    path: "roms/Pinball - Revenge of the 'Gator (USA, Europe) (Beta).gb",
  },
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
let speed = 1;
let frames = 0;
let lastLog = "";

const keys = new Set();
window.addEventListener("keydown", (e) => {
  keys.add(e.key.toLowerCase());
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "enter"].includes(e.key.toLowerCase())) {
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

function log(msg) {
  lastLog = String(msg);
  logEl.textContent = lastLog;
}

function romBase() {
  return location.pathname.replace(/\\/g, "/").includes("/player") ? "../" : "./";
}

async function probeQuick() {
  const base = romBase();
  const found = [];
  await Promise.all(
    VARIANTS.map(async (v) => {
      const url = base + encodeURI(v.path);
      try {
        const res = await fetch(url, { method: "HEAD", cache: "no-store" });
        if (res.ok) found.push({ ...v, url });
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

function runFrameCycles() {
  let cycles = 0;
  const target = CYCLES_PER_FRAME * speed;
  let steps = 0;
  const maxSteps = 800000 * speed;

  while (cycles < target && steps < maxSteps) {
    const irqCyc = machine.checkInterrupts();
    if (irqCyc) {
      cycles += irqCyc * 4;
      machine.advanceDots(irqCyc * 4);
    }

    if (machine.r.halted) {
      machine.advanceDots(4);
      cycles += 4;
      steps++;
      continue;
    }

    const m = cpu.step() || 1;
    cycles += m * 4;
    machine.advanceDots(m * 4);
    steps++;
  }
  return { cycles, steps };
}

function frame() {
  if (!machine || !cpu) return;
  try {
    pollInput();
    const { cycles, steps } = runFrameCycles();
    renderFrame(machine, frameBuf);
    ctx.putImageData(frameBuf, 0, 0);
    frames++;
    if ((frames & 0x0f) === 0) {
      const lcdc = machine.io[0x40];
      status.textContent =
        `${status.dataset.name} · pc=$${machine.r.pc.toString(16).padStart(4, "0")}` +
        ` bank=${machine.getRomBank()} ly=${machine.getLY()} lcdc=$${lcdc.toString(16)}` +
        ` · ${steps}ops/${cycles}t · x${speed}`;
    }
  } catch (err) {
    log(`RUNTIME ERROR at pc=$${machine?.r?.pc?.toString(16)}\n${err?.stack || err}`);
    console.error(err);
    return;
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
  try {
    if (raf) cancelAnimationFrame(raf);
    log(`Loading ${name} (${bytes.length} bytes)…`);
    machine = createMachine(bytes);
    machine.r.pc = 0x0100;
    cpu = bindRecompiled(machine);
    log(
      `Running ${name}\n` +
        `AOT ops: ${cpu.count}\n` +
        `Frame: ${CYCLES_PER_FRAME} T-cycles · full decode fallback for holes\n` +
        `If the screen stays dark, watch pc/ly/lcdc in the status line.`
    );
    showApp(name);
    // paint once immediately so UI isn't blank during first heavy frames
    renderFrame(machine, frameBuf);
    ctx.putImageData(frameBuf, 0, 0);
    frame();
  } catch (err) {
    log(`BOOT ERROR\n${err?.stack || err}`);
    console.error(err);
    boot.hidden = false;
    app.hidden = true;
  }
}

async function startFromFile(file) {
  await startRom(await loadRomFromFile(file), file.name);
}

async function startFromUrl(url, name) {
  try {
    log(`Fetching ${name}…`);
    const bytes = await loadRomFromUrl(url);
    await startRom(bytes, name);
  } catch (err) {
    log(`FETCH ERROR for ${name}\n${err?.stack || err}`);
    console.error(err);
  }
}

fileInput.addEventListener("change", () => {
  const f = fileInput.files && fileInput.files[0];
  if (f) startFromFile(f).catch((e) => log(String(e)));
});

document.getElementById("eject").addEventListener("click", () => location.reload());
document.getElementById("mode-menu")?.addEventListener("click", () => {
  speed = Math.max(0.25, speed / 2);
  log(`speed → ${speed}x`);
});
document.getElementById("mode-play")?.addEventListener("click", () => {
  speed = Math.min(4, speed * 2);
  log(`speed → ${speed}x`);
});

probeQuick().catch((e) => console.warn(e));
