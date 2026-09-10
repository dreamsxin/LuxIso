/**
 * Teaches the WebGL2 path how to draw a `Combatant`.
 *
 * Without this the renderer's built-in `instanceof` chain has no branch for the
 * type and falls back to a magenta diagnostic diamond — the registry added for
 * exactly this case is what makes a custom entity renderable on the GL backend.
 * Kept in its own module so `Combatant` itself stays free of renderer imports and
 * the Canvas2D page does not pull in the extractor.
 */
import { hexToRgb } from '../../src/index';
import { SceneExtractor } from '../../webgl-next/src/extraction/SceneExtractor';
import type { RenderColor } from '../../webgl-next/src/extraction/GeometryBuilder';
import { Combatant } from './Combatant';

function tint(hex: string, factor: number, alpha = 1): RenderColor {
  const [r, g, b] = hexToRgb(hex);
  return [
    Math.min(1, (r / 255) * factor),
    Math.min(1, (g / 255) * factor),
    Math.min(1, (b / 255) * factor),
    alpha,
  ];
}

/**
 * Register the extractor. Safe to call repeatedly: `SceneExtractor.register`
 * replaces an existing registration for the same constructor, so no local
 * "already done" latch is needed — and a latch would be wrong, since it would
 * skip re-registering after `clearExtractors()`.
 */
export function registerCombatantExtractor(): void {
  SceneExtractor.register(Combatant, (unit, ctx) => {
    const r = unit.radius;
    const base = ctx.project(unit.position.x, unit.position.y, unit.position.z);
    const bx = base[0];
    const by = base[1];
    const bodyTop = by - r * 1.9;

    // Body — a tapered column. `sample` is the point the lightmap is read at, so
    // it stays at the feet: sampling the head would light the unit by whatever
    // happens to be behind it.
    ctx.builder.quad(
      [bx - r * 0.62, by],
      [bx + r * 0.62, by],
      [bx + r * 0.42, bodyTop],
      [bx - r * 0.42, bodyTop],
      { color: tint(unit.color, 0.9), sample: base, pickId: ctx.pickId },
    );

    // Cap, brighter so the flat colour still reads as a rounded top.
    ctx.builder.quad(
      [bx - r * 0.42, bodyTop],
      [bx + r * 0.42, bodyTop],
      [bx + r * 0.3, bodyTop - r * 0.34],
      [bx - r * 0.3, bodyTop - r * 0.34],
      { color: tint(unit.color, 1.3), sample: base, pickId: ctx.pickId },
    );

    // Health bar, unlit so it stays readable in the dark.
    const frac = Math.max(0, Math.min(1, unit.health.fraction));
    if (!unit.health.isDead) {
      const w = r * 2.2;
      const h = 3;
      const barY = bodyTop - r * 0.9;
      const left = bx - w / 2;
      ctx.builder.quad(
        [left, barY], [left + w, barY], [left + w, barY + h], [left, barY + h],
        { color: [0, 0, 0, 0.55], sample: base, lit: false, pickId: ctx.pickId },
      );
      if (frac > 0) {
        const fill: RenderColor = frac > 0.5
          ? [0.49, 0.88, 0.54, 1]
          : frac > 0.25 ? [0.94, 0.75, 0.25, 1] : [0.88, 0.25, 0.25, 1];
        ctx.builder.quad(
          [left, barY], [left + w * frac, barY], [left + w * frac, barY + h], [left, barY + h],
          { color: fill, sample: base, lit: false, pickId: ctx.pickId },
        );
      }
    }
  });
}
