import { loadRomFromUrl, loadRomBytes } from "./rom.js";
import { createMachine, CYCLES_PER_FRAME } from "./machine.js";
import { renderFrame } from "./ppu.js";
import { createCpu } from "./cpu.js";
import { createPinballInput } from "./input_pinball.js";

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
const touchPad = document.getElementById("touch-pad");

let machine = null;
let cpu = null;
let raf = 0;
let speed = 1;
let frames = 0;
let lastFrameTs = 0;
let frameAccMs = 0;
const FRAME_MS = 1000 / 60;

const input = createPinballInput(null);

function isTouchUi() {
  // Phones/tablets, or a narrow viewport with touch (covers “desktop site” on mobile).
  return (
    matchMedia("(hover: none) and (pointer: coarse)").matches ||
    (navigator.maxTouchPoints > 0 && matchMedia("(max-width: 900px)").matches) ||
    matchMedia("(max-width: 640px)").matches
  );
}

function log(msg) {
  if (logEl) logEl.textContent = String(msg);
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

function bindTouchPad() {
  if (!touchPad) return;
  const active = new Map(); // pointerId -> side

  const down = (e) => {
    const eject = e.target.closest?.("#touch-eject");
    if (eject && touchPad.contains(eject)) {
      e.preventDefault();
      ejectRom();
      return;
    }
    const btn = e.target.closest?.("[data-side]");
    if (!btn || !touchPad.contains(btn)) return;
    e.preventDefault();
    const side = btn.dataset.side;
    active.set(e.pointerId, side);
    btn.classList.add("is-down");
    input.held[side] = true;
    input.sync();
    try {
      btn.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const up = (e) => {
    const side = active.get(e.pointerId);
    if (!side) return;
    e.preventDefault();
    active.delete(e.pointerId);
    const btn = touchPad.querySelector(`[data-side="${side}"]`);
    let still = false;
    for (const s of active.values()) if (s === side) still = true;
    if (!still) {
      btn?.classList.remove("is-down");
      input.held[side] = false;
      input.sync();
    }
  };

  touchPad.addEventListener("pointerdown", down);
  touchPad.addEventListener("pointerup", up);
  touchPad.addEventListener("pointercancel", up);
  touchPad.addEventListener("lostpointercapture", up);
}

/** Title/attract uniquely flips LCDC bit4 mid-frame (signed logo → unsigned font). */
function isTitleAttract(m) {
  const lines = m?.lineLcdc;
  if (!lines) return false;
  return (lines[40] & 0x10) === 0 && (lines[120] & 0x10) !== 0;
}

function updateTouchChrome() {
  if (!document.body.classList.contains("touch-ui") || !machine) return;
  const title = isTitleAttract(machine);
  document.body.classList.toggle("touch-title", title);
  // Release flipper/plunger holds when leaving the table UI
  if (title && (input.held.left || input.held.right || input.held.plunger)) {
    input.held.left = false;
    input.held.right = false;
    input.held.plunger = false;
    input.sync();
    touchPad?.querySelectorAll(".is-down").forEach((el) => {
      if (el.dataset.side !== "start") el.classList.remove("is-down");
    });
  }
}

async function enterPlayChrome() {
  document.body.classList.add("is-playing");
  if (isTouchUi()) {
    document.body.classList.add("touch-ui", "touch-title");
    if (touchPad) touchPad.hidden = false;
    const root = document.documentElement;
    try {
      if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: "hide" });
      else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
    } catch {
      /* iOS / denied — CSS fullscreen still applies */
    }
    try {
      await screen.orientation?.lock?.("portrait");
    } catch {
      /* optional */
    }
  }
}

function leavePlayChrome() {
  document.body.classList.remove("is-playing", "touch-ui", "touch-title", "touch-debug");
  if (touchPad) touchPad.hidden = true;
  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
}

function runFrameCycles() {
  let cycles = 0;
  const target = CYCLES_PER_FRAME;
  let steps = 0;
  const maxSteps = 800000;

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

function frame(ts) {
  if (!machine || !cpu) return;
  try {
    if (!lastFrameTs) lastFrameTs = ts;
    let dt = ts - lastFrameTs;
    lastFrameTs = ts;
    if (dt > 100) dt = 100; // tab resume
    frameAccMs += dt * speed;

    let ran = 0;
    while (frameAccMs >= FRAME_MS && ran < 4) {
      frameAccMs -= FRAME_MS;
      input.sync();
      runFrameCycles();
      ran++;
      frames++;
    }
    // Keep a little audio backlog; if we're starved, catch up one extra frame
    if (ran === 0 && machine.audioQueued && machine.audioQueued() < 2048) {
      input.sync();
      runFrameCycles();
      ran = 1;
      frames++;
      frameAccMs = 0;
    }

    if (ran > 0) {
      renderFrame(machine, frameBuf);
      ctx.putImageData(frameBuf, 0, 0);
      updateTouchChrome();
    }

    if ((frames & 0x0f) === 0 && status) {
      const lcdc = machine.io[0x40];
      status.textContent =
        `${status.dataset.name} · dynamic · pc=$${machine.r.pc.toString(16).padStart(4, "0")}` +
        ` bank=${machine.getRomBank()} ly=${machine.getLY()} lcdc=$${lcdc.toString(16)}` +
        ` · x${speed}`;
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
  if (status) {
    status.textContent = name;
    status.dataset.name = name;
  }
  enterPlayChrome();
}

async function startRom(bytes, name) {
  try {
    if (raf) cancelAnimationFrame(raf);
    lastFrameTs = 0;
    frameAccMs = 0;
    frames = 0;
    log(`Loading ${name} (${bytes.length} bytes)…`);
    machine = createMachine(bytes);
    machine.r.pc = 0x0100;
    cpu = createCpu(machine);
    input.attachMachine(machine);
    if (!isTouchUi()) input.bindPointerSurface(canvas);
    await machine.resumeAudio().catch(() => {});
    log(
      `Running ${name}\n` +
        `Left ← · Right → · Plunger hold Space/↓ · Start Enter\n` +
        `Mobile: Start / Exit below the screen · flippers after title · sound on`
    );
    showApp(name);
    renderFrame(machine, frameBuf);
    ctx.putImageData(frameBuf, 0, 0);
    frame();
  } catch (err) {
    log(`BOOT ERROR\n${err?.stack || err}`);
    console.error(err);
    leavePlayChrome();
    boot.hidden = false;
    app.hidden = true;
  }
}

async function startFromFile(file) {
  const { bytes, name, info } = await loadRomBytes(file, file.name);
  log(`Detected: ${info.label} · ${name} · ${bytes.length} bytes`);
  await startRom(bytes, name);
}

async function startFromUrl(url, name) {
  try {
    log(`Fetching ${name}…`);
    await startRom(await loadRomFromUrl(url), name);
  } catch (err) {
    log(`FETCH ERROR for ${name}\n${err?.stack || err}`);
    console.error(err);
  }
}

fileInput.addEventListener("change", () => {
  const f = fileInput.files && fileInput.files[0];
  if (f) startFromFile(f).catch((e) => log(String(e)));
});

function ejectRom() {
  leavePlayChrome();
  location.reload();
}

document.getElementById("eject")?.addEventListener("click", ejectRom);
document.getElementById("touch-eject")?.addEventListener("click", (e) => {
  e.preventDefault();
  ejectRom();
});
document.getElementById("mode-menu")?.addEventListener("click", () => {
  speed = Math.max(0.25, speed / 2);
  log(`speed → ${speed}x`);
});
document.getElementById("mode-play")?.addEventListener("click", () => {
  speed = Math.min(4, speed * 2);
  log(`speed → ${speed}x`);
});

bindTouchPad();
probeQuick().catch((e) => console.warn(e));
