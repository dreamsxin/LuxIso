/**
 * Shared color utility functions used across the rendering pipeline.
 * All functions accept CSS hex strings (#rrggbb) and return CSS color strings.
 */

/** Parse a CSS color string to [r, g, b] components (0–255).
 * Supports both `#rrggbb` hex and `rgb(r,g,b)` formats.
 */
export function hexToRgb(hex: string): [number, number, number] {
  if (hex.startsWith('rgb')) {
    const m = hex.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) {return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];}
    return [0, 0, 0];
  }
  let value = hex.replace('#', '');
  if (value.length === 3) {value = value.split('').map(channel => channel + channel).join('');}
  const n = parseInt(value, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Convert a hex color to `rgba(r,g,b,a)` string. */
export function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Shift each RGB channel by `amount` (positive = lighter, negative = darker).
 * Returns a hex string.
 */
export function shiftColor(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const clamp = (v: number) => Math.min(255, Math.max(0, v));
  const rr = clamp(r + amount).toString(16).padStart(2, '0');
  const gg = clamp(g + amount).toString(16).padStart(2, '0');
  const bb = clamp(b + amount).toString(16).padStart(2, '0');
  return `#${rr}${gg}${bb}`;
}

/**
 * Scale each RGB channel by `factor` (0 = black, 1 = original).
 * Returns an `rgb(r,g,b)` string.
 */
export function blendColor(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  const rr = Math.min(255, Math.round(r * factor));
  const gg = Math.min(255, Math.round(g * factor));
  const bb = Math.min(255, Math.round(b * factor));
  return `rgb(${rr},${gg},${bb})`;
}

/**
 * Scale each RGB channel by `factor`, returning `"r,g,b"` (no `rgb()` wrapper).
 * Useful when the caller wraps it in `rgb(${blendColorRaw(...)})`.
 */
export function blendColorRaw(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  const rr = Math.min(255, Math.round(r * factor));
  const gg = Math.min(255, Math.round(g * factor));
  const bb = Math.min(255, Math.round(b * factor));
  return `${rr},${gg},${bb}`;
}

/**
 * Linearly interpolate between two hex colors.
 * t=0 → from, t=1 → to. Returns an `rgb(r,g,b)` string.
 */
export function lerpColor(from: string, to: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(from);
  const [br, bg, bb] = hexToRgb(to);
  return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`;
}
