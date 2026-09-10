import { describe, it, expect } from 'vitest';
import { validateSceneJson, validateComponents, requireComponent } from '../core/Validator';
import { Crystal } from '../elements/props/Crystal';
import { HealthComponent } from '../ecs/components/HealthComponent';
import { MovementComponent } from '../ecs/components/MovementComponent';

describe('validateSceneJson', () => {
  it('passes a valid minimal scene', () => {
    const r = validateSceneJson({ cols: 10, rows: 10, tileW: 64, tileH: 32 });
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('errors on non-object input', () => {
    expect(validateSceneJson(null).ok).toBe(false);
    expect(validateSceneJson('string').ok).toBe(false);
  });

  it('errors on invalid cols/rows', () => {
    const r = validateSceneJson({ cols: 0, rows: -1 });
    expect(r.errors.some(e => e.includes('cols'))).toBe(true);
    expect(r.errors.some(e => e.includes('rows'))).toBe(true);
  });

  it('warns on non-standard tile ratio', () => {
    const r = validateSceneJson({ cols: 5, rows: 5, tileW: 64, tileH: 64 });
    expect(r.warnings.some(w => w.includes('ratio'))).toBe(true);
  });

  it('errors on missing floor.id', () => {
    const r = validateSceneJson({ cols: 5, rows: 5, floor: { cols: 5, rows: 5 } });
    expect(r.errors.some(e => e.includes('floor.id'))).toBe(true);
  });

  it('warns on walkable row count mismatch', () => {
    const r = validateSceneJson({
      cols: 3, rows: 3,
      floor: { id: 'f', walkable: [[true, true, true], [true, true, true]] }, // only 2 rows
    });
    expect(r.warnings.some(w => w.includes('rows'))).toBe(true);
  });

  it('warns, not errors, on a light type it cannot know about', () => {
    // The validator has no view of Engine.registerLight(), so calling an
    // unrecognised type invalid was a false negative for every custom type.
    const r = validateSceneJson({ lights: [{ type: 'spot' }] });
    expect(r.ok).toBe(true);
    expect(r.warnings.some(w => w.includes("'spot'"))).toBe(true);
  });

  it('errors on an unknown light type once the caller declares the set', () => {
    const r = validateSceneJson({ lights: [{ type: 'spot' }] }, { lightTypes: ['aura'] });
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.includes("'spot'"))).toBe(true);
  });

  it('accepts a declared custom light type', () => {
    const r = validateSceneJson({ lights: [{ type: 'aura' }] }, { lightTypes: ['aura'] });
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('errors on a non-string light type', () => {
    const r = validateSceneJson({ lights: [{ type: 7 }] });
    expect(r.errors.some(e => e.includes('must be a string'))).toBe(true);
  });

  it('validates directional angle and elevation, which only omni got', () => {
    const bad = validateSceneJson({ lights: [{ type: 'directional', angle: '45' }] });
    expect(bad.errors.some(e => e.includes('angle'))).toBe(true);

    const ok = validateSceneJson({ lights: [{ type: 'directional', angle: 45, elevation: 0.8 }] });
    expect(ok.ok).toBe(true);
  });

  it('warns on an unknown prop type but errors once declared', () => {
    const loose = validateSceneJson({ props: [{ id: 'm1', type: 'mob', x: 1, y: 1 }] });
    expect(loose.ok).toBe(true);
    expect(loose.warnings.some(w => w.includes('registerProp'))).toBe(true);

    const strict = validateSceneJson(
      { props: [{ id: 'm1', type: 'mob', x: 1, y: 1 }] },
      { propTypes: ['spawner'] },
    );
    expect(strict.ok).toBe(false);
  });

  it('errors on a non-numeric or non-positive prop health', () => {
    for (const health of ['100', 0, -5]) {
      const r = validateSceneJson({ props: [{ id: 'c', type: 'chest', x: 1, y: 1, health }] });
      expect(r.errors.some(e => e.includes('health'))).toBe(true);
    }
    const ok = validateSceneJson({ props: [{ id: 'c', type: 'chest', x: 1, y: 1, health: 50 }] });
    expect(ok.ok).toBe(true);
  });

  it('catches a duplicate id across different collections', () => {
    const r = validateSceneJson({
      floor: { id: 'ground' },
      characters: [{ id: 'hero', x: 1, y: 1 }],
      props: [{ id: 'hero', type: 'chest', x: 2, y: 2 }],
    });
    // `removeById` filters every match and `getById` returns the first, so a
    // duplicate means one object is unreachable and both die together.
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.includes('Duplicate id "hero"'))).toBe(true);
  });

  it('accepts distinct ids across collections', () => {
    const r = validateSceneJson({
      floor: { id: 'ground' },
      walls: [{ id: 'w1', x: 0, y: 0, endX: 4, endY: 0 }],
      characters: [{ id: 'hero', x: 1, y: 1 }],
      props: [{ id: 'chest-1', type: 'chest', x: 2, y: 2 }],
      lights: [{ id: 'torch', type: 'omni', x: 1, y: 1, z: 0 }],
    });
    expect(r.errors).toEqual([]);
  });

  it('reports a zero-length wall only when the coordinates are numbers', () => {
    const missing = validateSceneJson({ walls: [{ id: 'w' }] });
    // Four coordinate errors, but no bogus "zero length" on top of them:
    // `undefined === undefined` used to make every incomplete wall zero-length.
    expect(missing.warnings.some(w => w.includes('zero length'))).toBe(false);

    const degenerate = validateSceneJson({ walls: [{ id: 'w', x: 2, y: 2, endX: 2, endY: 2 }] });
    expect(degenerate.warnings.some(w => w.includes('zero length'))).toBe(true);
  });

  it('warns on character out of bounds', () => {
    const r = validateSceneJson({
      cols: 5, rows: 5,
      characters: [{ id: 'p', x: 10, y: 10 }],
    });
    expect(r.warnings.some(w => w.includes('outside'))).toBe(true);
  });
});

describe('validateComponents', () => {
  it('passes when all required components present', () => {
    const entity = new Crystal('e', 0, 0);
    entity.addComponent(new HealthComponent({ max: 10 }));
    const r = validateComponents(entity, [HealthComponent]);
    expect(r.ok).toBe(true);
  });

  it('accepts custom registry types supplied by the caller', () => {
    const r = validateSceneJson({
      lights: [{ type: 'spot', x: 1, y: 2 }],
      props: [{ id: 'door-1', type: 'door', x: 1, y: 2 }],
    }, {
      lightTypes: ['spot'],
      propTypes: ['door'],
    });
    expect(r.ok).toBe(true);
  });

  it('errors on missing component', () => {
    const entity = new Crystal('e', 0, 0);
    const r = validateComponents(entity, [HealthComponent, MovementComponent]);
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toContain('HealthComponent');
    expect(r.errors[1]).toContain('MovementComponent');
  });
});

describe('requireComponent', () => {
  it('returns component when present', () => {
    const entity = new Crystal('e', 0, 0);
    const comp = entity.addComponent(new HealthComponent({ max: 10 }));
    expect(requireComponent(entity, HealthComponent)).toBe(comp);
  });

  it('throws when required component missing', () => {
    const entity = new Crystal('e', 0, 0);
    expect(() => requireComponent(entity, HealthComponent)).toThrow(/HealthComponent/);
  });

  it('returns undefined when not required', () => {
    const entity = new Crystal('e', 0, 0);
    expect(requireComponent(entity, HealthComponent, false)).toBeUndefined();
  });
});
