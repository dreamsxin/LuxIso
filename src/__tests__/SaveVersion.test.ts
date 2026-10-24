import {describe, expect, it} from 'vitest';
import {Engine} from '../core/Engine';
import {Scene} from '../core/Scene';
import {SceneSerializer} from '../core/SceneSerializer';
import {Floor} from '../elements/Floor';
import {OmniLight} from '../lighting/OmniLight';

/**
 * The save-format version field.
 *
 * Before `formatVersion` existed, a save written by a newer framework loaded
 * into an older one and silently mis-built: unknown fields ignored, missing
 * fields becoming defaults, corruption surfacing later as gameplay weirdness.
 * `checkVersion` turns that into a load-time rejection; `toJSON` stamps the
 * current version so future format changes have a migration hook.
 */

function canvas2d(): HTMLCanvasElement {
  const ctx = new Proxy({}, {get: () => () => {}, set: () => true});
  return {
    width: 100, height: 100, style: {}, parentElement: null,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
}

function scene(): Scene {
  const s = new Scene({name: 'v', tileW: 64, tileH: 32, cols: 4, rows: 4});
  s.addObject(new Floor({id: 'floor', cols: 4, rows: 4}));
  s.addLight(new OmniLight({id: 'l1', x: 2, y: 2, z: 120}));
  return s;
}

describe('SceneSerializer — format version', () => {
  it('stamps the current version into every save record', () => {
    const json = SceneSerializer.toJSON(scene());
    expect(json.formatVersion).toBe(SceneSerializer.FORMAT_VERSION);
  });

  it('accepts its own output and round-trips it through buildScene', () => {
    const json = SceneSerializer.toJSON(scene());
    const check = SceneSerializer.checkVersion(json);
    expect(check).toEqual({ok: true, version: SceneSerializer.FORMAT_VERSION});

    const engine = new Engine({canvas: canvas2d()});
    const built = engine.buildScene(JSON.parse(JSON.stringify(json)));
    expect(built.name).toBe('v');
    expect(built.allLights).toHaveLength(1);
  });

  it('accepts legacy records with no version field', () => {
    // level1.json and every pre-versioning save look like this.
    const check = SceneSerializer.checkVersion({name: 'legacy', cols: 4, rows: 4});
    expect(check).toEqual({ok: true, version: null});
  });

  it('rejects records from a newer format with both versions named', () => {
    const check = SceneSerializer.checkVersion({formatVersion: SceneSerializer.FORMAT_VERSION + 1});
    expect(check.ok).toBe(false);
    expect(check.version).toBe(SceneSerializer.FORMAT_VERSION + 1);
    expect(check.message).toContain(`${SceneSerializer.FORMAT_VERSION + 1}`);
    expect(check.message).toContain(`${SceneSerializer.FORMAT_VERSION}`);
  });

  it('rejects garbage version values instead of guessing', () => {
    for (const bad of ['1', 0, -1, 1.5, null]) {
      const check = SceneSerializer.checkVersion({formatVersion: bad});
      expect(check.ok).toBe(false);
      expect(check.message).toBeTruthy();
    }
  });

  it('buildScene throws on a future-format record instead of mis-building it', () => {
    const engine = new Engine({canvas: canvas2d()});
    expect(() => engine.buildScene({formatVersion: 99, cols: 2, rows: 2}))
      .toThrow(/format 99/);
  });
});
