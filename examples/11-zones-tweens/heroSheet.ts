/**
 * Procedurally paints the 8-direction sprite sheet used by example 11, so the
 * demo exercises `DirectionalAnimator.buildSheet` / `DirectionalAnimator`
 * end-to-end without shipping a binary asset.
 *
 * Layout is exactly what `buildSheet` documents: one direction per row, one
 * frame per column, row order S, SW, W, NW, N, NE, E, SE.
 *
 *   rows 0–7  · idle (1 column)
 *   rows 8–15 · walk (4 columns)
 *
 * The "hero" is a little hooded blob with a nose triangle that points in the
 * screen-projected direction of movement, a two-frame bob, and feet that swap
 * on alternating frames. Everything is deterministic — no Math.random().
 */
import {DirectionalAnimator} from '../../src/index';

const FRAME = 32;
const COLS = 4;
const DIRS: Array<{dir: string; dx: number; dy: number}> = [
  {dir: 'S', dx: 0, dy: 1},
  {dir: 'SW', dx: -1, dy: 1},
  {dir: 'W', dx: -1, dy: 0},
  {dir: 'NW', dx: -1, dy: -1},
  {dir: 'N', dx: 0, dy: -1},
  {dir: 'NE', dx: 1, dy: -1},
  {dir: 'E', dx: 1, dy: 0},
  {dir: 'SE', dx: 1, dy: 1},
];

function paintFrame(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  dx: number,
  dy: number,
  walk: boolean
): void {
  const ox = col * FRAME;
  const oy = row * FRAME;
  // World delta → screen-projected angle (same projection math the engine uses):
  // sx = (x - y) * tileW/2, sy = (x + y) * tileH/2.
  const sx = (dx - dy);
  const sy = (dx + dy) * 0.5;
  const angle = Math.atan2(sy, sx);
  const phase = walk ? (col % 4) : 0;
  const bob = walk ? [0, -1, 0, 1][phase] : 0;
  const step = walk ? [0, 2, 0, -2][phase] : 0;

  ctx.save();
  ctx.translate(ox, oy);
  ctx.lineJoin = 'round';

  // Shadow (frame-space, cheap and view-independent enough for a demo sprite)
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(16, 28, 8, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Feet
  ctx.fillStyle = '#2c2140';
  ctx.fillRect(11, 25 + step, 4, 3);
  ctx.fillRect(17, 25 - step, 4, 3);

  // Body / hood
  const cy = 17 + bob;
  ctx.fillStyle = '#5a78d6';
  ctx.strokeStyle = '#2e4388';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(16, cy, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Lighter belly
  ctx.fillStyle = '#8ea2e8';
  ctx.beginPath();
  ctx.arc(16, cy + 2, 5, 0, Math.PI * 2);
  ctx.fill();

  // Nose — the one thing that actually differs per direction row.
  const nx = 16 + Math.cos(angle) * 8;
  const ny = cy + Math.sin(angle) * 8;
  const sideX = 16 + Math.cos(angle + Math.PI / 2) * 3.2;
  const sideY = cy + Math.sin(angle + Math.PI / 2) * 3.2;
  ctx.fillStyle = '#ffd9a0';
  ctx.beginPath();
  ctx.moveTo(nx, ny);
  ctx.lineTo(sideX, sideY);
  ctx.lineTo(16 + Math.cos(angle - Math.PI / 2) * 3.2, cy + Math.sin(angle - Math.PI / 2) * 3.2);
  ctx.closePath();
  ctx.fill();

  // Eyes on the facing side
  ctx.fillStyle = '#1a1530';
  const eyeA = angle - 0.5;
  const eyeB = angle + 0.5;
  ctx.beginPath();
  ctx.arc(16 + Math.cos(eyeA) * 5.5, cy + Math.sin(eyeA) * 5.5, 1.4, 0, Math.PI * 2);
  ctx.arc(16 + Math.cos(eyeB) * 5.5, cy + Math.sin(eyeB) * 5.5, 1.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** Paints the sheet, returns a `data:` URL and the matching SpriteSheet. */
export function buildHeroSheet(): ReturnType<typeof DirectionalAnimator.buildSheet> {
  const canvas = document.createElement('canvas');
  canvas.width = FRAME * COLS;
  canvas.height = FRAME * DIRS.length * 2;
  const ctx = canvas.getContext('2d')!;

  DIRS.forEach(({dx, dy}, row) => {
    paintFrame(ctx, 0, row, dx, dy, false);
    for (let col = 0; col < COLS; col++) {
      paintFrame(ctx, col, DIRS.length + row, dx, dy, true);
    }
  });

  const url = canvas.toDataURL('image/png');
  return DirectionalAnimator.buildSheet(
    url,
    FRAME,
    FRAME,
    [
      {name: 'idle', rowStart: 0, frameCount: 1, fps: 1, loop: true},
      {name: 'walk', rowStart: DIRS.length, frameCount: 4, fps: 9, loop: true},
    ],
    1.4,
    1
  );
}
