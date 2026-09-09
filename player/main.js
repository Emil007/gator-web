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

const input = createPinballInput(null);

function isTouchUi() {
  // Prefer real touch phones/tablets; don't trip on Windows laptops with a touchscreen.
  return (
    matchMedia("(hover: none) and (pointer: coarse)").matches ||
    (matchMedia("(max-width: 820px)").matches && navigator.maxTouchPoints > 0)
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
    const zone = e.target.closest?.("[data-side]");
    if (!zone) return;
    e.preventDefault();
    const side = zone.dataset.side;
    active.set(e.pointerId, side);
    input.held[side] = true;
    input.sync();
    try {
      zone.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const up = (e) => {
    const side = active.get(e.pointerId);
    if (!side) return;
    e.preventDefault();
    active.delete(e.pointerId);
    let still = false;
    for (const s of active.values()) if (s === side) still = true;
    if (!still) {
      input.held[side] = false;
      input.sync();
    }
  };

  touchPad.addEventListener("pointerdown", down);
  touchPad.addEventListener("pointerup", up);
  touchPad.addEventListener("pointercancel", up);
  touchPad.addEventListener("lostpointercapture", up);
}

async function enterPlayChrome() {
  document.body.classList.add("is-playing");
  if (isTouchUi()) {
    document.body.classList.add("touch-ui");
    if (new URLSearchParams(location.search).has("touchdebug")) {
      document.body.classList.add("touch-debug");
    }
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
  document.body.classList.remove("is-playing", "touch-ui", "touch-debug");
  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
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
    input.sync();
    const { cycles, steps } = runFrameCycles();
    renderFrame(machine, frameBuf);
    ctx.putImageData(frameBuf, 0, 0);
    frames++;
    if ((frames & 0x0f) === 0 && status) {
      const lcdc = machine.io[0x40];
      status.textContent =
        `${status.dataset.name} · dynamic · pc=$${machine.r.pc.toString(16).padStart(4, "0")}` +
        ` bank=${machine.getRomBank()} ly=${machine.getLY()} lcdc=$${lcdc.toString(16)}` +
        ` · ${steps}/${cycles}t · x${speed}`;
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
    log(`Loading ${name} (${bytes.length} bytes)…`);
    machine = createMachine(bytes);
    machine.r.pc = 0x0100;
    cpu = createCpu(machine);
    input.attachMachine(machine);
    input.bindPointerSurface(canvas);
    await machine.resumeAudio().catch(() => {});
    log(
      `Running ${name}\n` +
        `Left ← · Right → · Plunger hold Space/↓ · Start Enter\n` +
        `Mobile: L / hold center / R · top strip = start · sound on`
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

document.getElementById("eject")?.addEventListener("click", () => {
  leavePlayChrome();
  location.reload();
});
document.getElementById("mode-menu")?.addEventListener("click", () => {
  speed = Math.max(0.25, speed / 2);
  log(`speed → ${speed}x`);
});
document.getElementById("mode-play")?.addEventListener("click", () => {
  speed = Math.min(4, speed * 2);
  log(`speed → ${speed}x`);
});

// Triple-tap top start zone quickly → eject (escape hatch on mobile)
let startTaps = 0;
let startTapTimer = 0;
touchPad?.querySelector(".zone-start")?.addEventListener("pointerdown", () => {
  startTaps++;
  clearTimeout(startTapTimer);
  startTapTimer = setTimeout(() => {
    startTaps = 0;
  }, 600);
  if (startTaps >= 3) {
    startTaps = 0;
    leavePlayChrome();
    location.reload();
  }
});

bindTouchPad();
probeQuick().catch((e) => console.warn(e));
