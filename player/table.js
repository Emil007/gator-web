/**
 * Pinball table POC — native physics, ROM tiles for look.
 * Not a line-accurate port of HAL physics yet; proves "no emu" path.
 */

export function createTable(assets) {
  const W = 160;
  const H = 144;

  const ball = { x: 80, y: 100, vx: 0.6, vy: -1.2, r: 3 };
  const left = { x: 36, y: 128, angle: 0.45, len: 28 };
  const right = { x: 124, y: 128, angle: -0.45, len: 28 };
  let nudgeCooldown = 0;

  const gravity = 0.045;
  const friction = 0.995;

  function flipperTip(f, raised) {
    const a = raised ? f.angle - Math.sign(f.angle) * 0.7 : f.angle;
    return {
      x: f.x + Math.cos(a) * f.len * (f === left ? 1 : -1),
      y: f.y + Math.sin(Math.abs(a)) * 8,
      a,
    };
  }

  function collideFlipper(f, raised) {
    const tip = flipperTip(f, raised);
    const x1 = f.x;
    const y1 = f.y;
    const x2 = tip.x;
    const y2 = tip.y;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((ball.x - x1) * dx + (ball.y - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    const ddx = ball.x - cx;
    const ddy = ball.y - cy;
    const dist = Math.hypot(ddx, ddy);
    if (dist < ball.r + 2) {
      const nx = ddx / (dist || 1);
      const ny = ddy / (dist || 1);
      const push = ball.r + 2 - dist;
      ball.x += nx * push;
      ball.y += ny * push;
      const bounce = raised ? 2.4 : 1.4;
      const dot = ball.vx * nx + ball.vy * ny;
      ball.vx = (ball.vx - 2 * dot * nx) * 0.9;
      ball.vy = (ball.vy - 2 * dot * ny) * 0.9 - (raised ? bounce * 0.35 : 0);
    }
  }

  function update(input) {
    if (nudgeCooldown > 0) nudgeCooldown--;
    if (input.nudge() && nudgeCooldown === 0) {
      ball.vx += (Math.random() - 0.5) * 1.5;
      ball.vy -= 0.4;
      nudgeCooldown = 40;
    }

    ball.vy += gravity;
    ball.vx *= friction;
    ball.vy *= friction;
    ball.x += ball.vx;
    ball.y += ball.vy;

    // walls
    if (ball.x < ball.r + 8) {
      ball.x = ball.r + 8;
      ball.vx = Math.abs(ball.vx) * 0.85;
    }
    if (ball.x > W - ball.r - 8) {
      ball.x = W - ball.r - 8;
      ball.vx = -Math.abs(ball.vx) * 0.85;
    }
    if (ball.y < ball.r + 8) {
      ball.y = ball.r + 8;
      ball.vy = Math.abs(ball.vy) * 0.85;
    }

    // drain
    if (ball.y > H + 10) {
      ball.x = 80;
      ball.y = 40;
      ball.vx = (Math.random() - 0.5) * 1.2;
      ball.vy = 0.5;
    }

    collideFlipper(left, input.leftFlipper());
    collideFlipper(right, input.rightFlipper());
  }

  function draw(ctx) {
    // playfield from ROM tile scrap — tiled backdrop from bank3 sample
    ctx.fillStyle = "#0f380f";
    ctx.fillRect(0, 0, W, H);

    if (assets.atlas) {
      ctx.globalAlpha = 0.35;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(assets.atlas, 0, 0, 128, 64, 16, 16, 128, 64);
      ctx.globalAlpha = 1;
    }

    // rails
    ctx.strokeStyle = "#306230";
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, W - 12, H - 12);

    // bumper
    ctx.fillStyle = "#8bac0f";
    ctx.beginPath();
    ctx.arc(80, 48, 8, 0, Math.PI * 2);
    ctx.fill();
    const ddx = ball.x - 80;
    const ddy = ball.y - 48;
    const d = Math.hypot(ddx, ddy);
    if (d < ball.r + 8) {
      const nx = ddx / (d || 1);
      const ny = ddy / (d || 1);
      ball.x = 80 + nx * (ball.r + 8);
      ball.y = 48 + ny * (ball.r + 8);
      const dot = ball.vx * nx + ball.vy * ny;
      ball.vx -= 2.2 * dot * nx;
      ball.vy -= 2.2 * dot * ny;
    }

    function drawFlip(f, raised) {
      const tip = flipperTip(f, raised);
      ctx.strokeStyle = "#9bbc0f";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
    }
    // need input — passed via closure set each frame
    drawFlip(left, draw._left);
    drawFlip(right, draw._right);

    ctx.fillStyle = "#e0f0a0";
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
  }

  return {
    update(input) {
      draw._left = input.leftFlipper();
      draw._right = input.rightFlipper();
      update(input);
    },
    draw,
  };
}
