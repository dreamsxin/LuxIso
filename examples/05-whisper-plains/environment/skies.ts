/**
 * Sky backdrops for the three whisper-plains scenes.
 *
 * These lived inline in `main.ts`, which is the page: it wires the engine, input,
 * HUD, scene manager and teleport flow. Eighty lines of gradient and star-field
 * painting sitting next to that had two costs — the page file was the only place
 * to look for anything, and the painting itself could never be tested, because
 * reaching it meant booting a canvas and a scene manager first.
 *
 * Each function takes exactly what it paints with (a context, a size, a
 * timestamp) so a test can hand it a recording context and assert what was drawn.
 */
import { hexToRgba } from '../../../src/index';
import type { DayNightCycle } from './DayNightCycle';

/** Stars per field. Constant so a test can assert the count. */
const STAR_COUNT = 60;
/** Drifting motes in the daytime plains sky. */
const MOTE_COUNT = 18;

/**
 * The twinkling star field, drawn from a deterministic pseudo-random layout.
 *
 * Plains and lake painted this identically apart from the palette, as two
 * verbatim copies of the same loop. `colorFor` keeps both exact while there is
 * only one loop to fix when the next star bug turns up.
 *
 * Positions come from `Math.sin(i * k)` rather than `Math.random()`, so the field
 * is stable across frames — a moving star field would read as noise.
 */
export function drawStarField(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ts: number,
  alpha: number,
  colorFor: (i: number) => string,
): void {
  const t = ts * 0.001;
  for (let i = 0; i < STAR_COUNT; i++) {
    ctx.globalAlpha = Math.max(0, 0.3 + Math.sin(t * (0.7 + i * 0.22) + i * 1.3) * 0.45) * alpha;
    ctx.fillStyle = colorFor(i);
    ctx.beginPath();
    ctx.arc(
      (Math.sin(i * 127.1) * 0.5 + 0.5) * w,
      (Math.sin(i * 311.7) * 0.5 + 0.5) * h * 0.52,
      0.5 + (i % 5) * 0.28,
      0, Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Plains star palette: mostly white, with warm and cool outliers. */
const plainsStarColor = (i: number): string =>
  i % 9 === 0 ? '#ffd0a0' : i % 13 === 0 ? '#c0e0ff' : '#ffffff';

/** Lake star palette: white with warm outliers only. */
const lakeStarColor = (i: number): string => (i % 9 === 0 ? '#ffd0a0' : '#ffffff');

/**
 * The plains sky: a day/night gradient, the sun or moon with its glow, drifting
 * motes by day and stars by night.
 */
export function drawPlainsSky(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ts: number,
  dn: DayNightCycle,
): void {
  const c = dn.getColors();
  const grad = ctx.createLinearGradient(0, 0, 0, h * 0.72);
  grad.addColorStop(0, c.skyTop);
  grad.addColorStop(0.6, c.skyBottom);
  grad.addColorStop(1, c.skyBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const cx = c.celestialX * w, cy = c.celestialY * h;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, c.celestialRadius, 0, Math.PI * 2);
  ctx.fillStyle = c.celestialColor;
  ctx.shadowColor = c.celestialGlowColor;
  ctx.shadowBlur = c.celestialRadius * 2.5;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();

  // `hexToRgba` rather than a local hex parser: the one that used to live here
  // handled `#rrggbb` only, and the framework's already covers `rgb()` and short
  // hex. A second colour parser is a second thing to fix.
  const glowR = c.celestialRadius * 5.5;
  const glow = ctx.createRadialGradient(cx, cy, c.celestialRadius * 0.5, cx, cy, glowR);
  glow.addColorStop(0, hexToRgba(c.celestialGlowColor, c.celestialGlowAlpha));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  const day = 1 - c.nightOverlay;
  if (day > 0.3) {
    // Rayleigh-ish bloom around the sun, strongest at noon.
    const rb = ctx.createRadialGradient(cx, cy, c.celestialRadius * 2, cx, cy, c.celestialRadius * 14);
    rb.addColorStop(0, `rgba(255,220,180,${(day * 0.12).toFixed(3)})`);
    rb.addColorStop(0.5, `rgba(180,200,255,${(day * 0.10).toFixed(3)})`);
    rb.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rb;
    ctx.fillRect(0, 0, w, h);
  }
  if (c.nightOverlay > 0.02) {
    ctx.fillStyle = `rgba(4,9,26,${(c.nightOverlay * 0.82).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
  }

  if (day > 0.15) {
    const t2 = ts * 0.001;
    const moteColors = ['255,200,255', '200,220,255', '220,255,220', '255,240,180', '200,180,255'];
    for (let i = 0; i < MOTE_COUNT; i++) {
      const fx = (Math.sin(i * 73.1 + t2 * (0.12 + i * 0.008)) * 0.5 + 0.5) * w;
      const fy = (Math.sin(i * 137.5 + t2 * (0.09 + i * 0.006)) * 0.5 + 0.5) * h * 0.75;
      ctx.globalAlpha = Math.max(0, 0.4 + Math.sin(t2 * (1.2 + i * 0.3) + i * 2.1) * 0.35) * day * 0.55;
      ctx.beginPath();
      ctx.arc(fx, fy, 1.2 + (i % 4) * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${moteColors[i % moteColors.length]})`;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (c.showStars) drawStarField(ctx, w, h, ts, c.starAlpha, plainsStarColor);
}

/** The lake's permanent night sky: cold gradient, a fixed moon, and stars. */
export function drawLakeSky(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ts: number,
): void {
  const grad = ctx.createLinearGradient(0, 0, 0, h * 0.75);
  grad.addColorStop(0, '#04091a');
  grad.addColorStop(0.25, '#080f28');
  grad.addColorStop(0.6, '#0c1e48');
  grad.addColorStop(1, '#102060');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const mx = w * 0.76, my = h * 0.09;
  ctx.save();
  ctx.beginPath();
  ctx.arc(mx, my, 14, 0, Math.PI * 2);
  ctx.fillStyle = '#e8f0ff';
  ctx.shadowColor = '#c0d8ff';
  ctx.shadowBlur = 20;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();

  const mg = ctx.createRadialGradient(mx, my, 10, mx, my, 80);
  mg.addColorStop(0, 'rgba(200,220,255,0.25)');
  mg.addColorStop(1, 'rgba(100,140,255,0)');
  ctx.fillStyle = mg;
  ctx.fillRect(0, 0, w, h);

  drawStarField(ctx, w, h, ts, 1, lakeStarColor);
}

/** The deep sea: no sky at all, just a slowly breathing bioluminescent glow. */
export function drawDeepSky(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ts: number,
): void {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#000810');
  grad.addColorStop(0.4, '#001020');
  grad.addColorStop(1, '#001830');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const t = ts * 0.0005, gy = h * 0.7;
  const glow = ctx.createRadialGradient(w * 0.5, gy, 0, w * 0.5, gy, w * 0.6);
  glow.addColorStop(0, `rgba(0,180,160,${(0.06 + Math.sin(t) * 0.02).toFixed(3)})`);
  glow.addColorStop(1, 'rgba(0,80,100,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
}


