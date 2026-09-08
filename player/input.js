/** Keyboard → flipper / menu actions. */

export function createInput() {
  const down = new Set();

  const onKey = (e, isDown) => {
    const k = e.key.toLowerCase();
    if (["z", "x", "/", " ", "arrowleft", "arrowright", "enter", "escape"].includes(k)) {
      e.preventDefault();
    }
    if (isDown) down.add(k);
    else down.delete(k);
  };

  window.addEventListener("keydown", (e) => onKey(e, true));
  window.addEventListener("keyup", (e) => onKey(e, false));

  return {
    leftFlipper: () => down.has("z") || down.has("arrowleft"),
    rightFlipper: () => down.has("x") || down.has("/") || down.has("arrowright"),
    nudge: () => down.has(" "),
    start: () => down.has("enter"),
  };
}
