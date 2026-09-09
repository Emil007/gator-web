/**
 * Native pinball controls → Game Boy joypad bits.
 *
 * Official Revenge of the 'Gator mapping:
 *   Left flipper  → any D-Pad direction
 *   Right flipper → A or B (same)
 *   Plunger       → hold A/B, release to launch
 *   Start         → pause / menus
 *   Select        → unused
 *
 * Keys use event.code (physical / layout-stable): arrows + Space + Enter.
 * No letter keys (Z/Y differ on DE vs US).
 */

export function createPinballInput(machine) {
  const held = {
    left: false,
    right: false,
    plunger: false,
    start: false,
  };

  function sync() {
    if (!machine) return;
    // Title / attract: L·R navigate modes (d-pad); Start confirms
    if (typeof document !== "undefined" && document.body.classList.contains("touch-title")) {
      machine.setJoypad({
        left: held.left,
        right: held.right,
        up: false,
        down: false,
        a: false,
        b: false,
        start: held.start,
        select: false,
      });
      return;
    }
    // A/B shared: right flipper and plunger both press face buttons
    const action = held.right || held.plunger;
    machine.setJoypad({
      // any d-pad bit = left flipper; use Left for clarity
      left: held.left,
      right: false,
      up: false,
      down: held.left, // also Down — matches “any direction” / common muscle memory
      a: action,
      b: action,
      start: held.start,
      select: false,
    });
  }

  function set(side, on) {
    held[side] = on;
    sync();
  }

  function isGameKey(c) {
    return (
      c === "ArrowLeft" ||
      c === "ArrowRight" ||
      c === "ArrowDown" ||
      c === "ArrowUp" ||
      c === "Space" ||
      c === "Enter" ||
      c === "Escape" ||
      c === "ControlLeft" ||
      c === "ControlRight" ||
      c === "ShiftLeft" ||
      c === "ShiftRight"
    );
  }

  window.addEventListener("keydown", (e) => {
    const c = e.code;
    // Always block browser scroll/page keys — including key-repeat while held
    if (isGameKey(c)) e.preventDefault();
    if (e.repeat) return;
    if (c === "ArrowLeft" || c === "ControlLeft" || c === "ShiftLeft") set("left", true);
    if (c === "ArrowRight" || c === "ControlRight" || c === "ShiftRight") set("right", true);
    if (c === "ArrowDown" || c === "ArrowUp" || c === "Space") set("plunger", true);
    if (c === "Enter" || c === "Escape") set("start", true);
  });

  window.addEventListener("keyup", (e) => {
    const c = e.code;
    if (isGameKey(c)) e.preventDefault();
    if (c === "ArrowLeft" || c === "ControlLeft" || c === "ShiftLeft") set("left", false);
    if (c === "ArrowRight" || c === "ControlRight" || c === "ShiftRight") set("right", false);
    if (c === "ArrowDown" || c === "ArrowUp" || c === "Space") set("plunger", false);
    if (c === "Enter" || c === "Escape") set("start", false);
  });

  function bindPointerSurface(el) {
    if (!el) return;

    el.addEventListener("mousedown", (e) => {
      if (e.button === 0) set("left", true);
      if (e.button === 2) set("right", true);
    });
    el.addEventListener("mouseup", (e) => {
      if (e.button === 0) set("left", false);
      if (e.button === 2) set("right", false);
    });
    el.addEventListener("mouseleave", () => {
      set("left", false);
      set("right", false);
    });
    el.addEventListener("contextmenu", (e) => e.preventDefault());

    const touchIds = new Map();
    const which = (clientX) => {
      const rect = el.getBoundingClientRect();
      const x = (clientX - rect.left) / rect.width;
      if (x < 0.33) return "left";
      if (x > 0.66) return "right";
      return "plunger"; // middle third = plunger (hold / release)
    };

    el.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) {
          const side = which(t.clientX);
          touchIds.set(t.identifier, side);
          set(side, true);
        }
      },
      { passive: false }
    );

    el.addEventListener(
      "touchend",
      (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) {
          const side = touchIds.get(t.identifier);
          touchIds.delete(t.identifier);
          let still = false;
          for (const s of touchIds.values()) if (s === side) still = true;
          if (!still && side) set(side, false);
        }
      },
      { passive: false }
    );

    el.addEventListener("touchcancel", (e) => {
      for (const t of e.changedTouches) {
        const side = touchIds.get(t.identifier);
        touchIds.delete(t.identifier);
        if (side) set(side, false);
      }
    });
  }

  return {
    held,
    sync,
    bindPointerSurface,
    bindTouchSurface: bindPointerSurface,
    attachMachine(m) {
      machine = m;
      sync();
    },
  };
}
