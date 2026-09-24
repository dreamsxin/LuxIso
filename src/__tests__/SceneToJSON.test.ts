import {describe, it, expect} from 'vitest';
import {Scene} from '../core/Scene';
import {Floor} from '../elements/Floor';
import {Wall} from '../elements/Wall';
import {Character} from '../elements/Character';
import {Cloud} from '../elements/props/Cloud';
import {OmniLight} from '../lighting/OmniLight';
import {DirectionalLight} from '../lighting/DirectionalLight';
import {TileCollider} from '../physics/TileCollider';
import {Engine} from '../core/Engine';
import {SceneSerializer} from '../core/SceneSerializer';
import {Tree} from '../elements/props/Tree';
import {FlowerPatch} from '../elements/props/FlowerPatch';
import {Lantern} from '../elements/props/Lantern';

function buildScene(): Scene {
  const scene = new Scene({name: 'Serialization Test', tileW: 64, tileH: 32, cols: 6, rows: 6});
  scene.ambientColor = '#102030';
  scene.ambientIntensity = 0.42;
  scene.dynamicLighting = true;
  scene.view = {rotation: 90, elevation: 0.75};
  scene.camera.x = 1.5;
  scene.camera.y = 2.5;
  scene.camera.zoom = 1.25;
  scene.camera.lerpFactor = 0.2;

  scene.addObject(new Floor({id: 'floor', cols: 6, rows: 6, color: '#333344'}));
  scene.addObject(new Wall({id: 'w1', x: 0, y: 0, endX: 6, endY: 0, height: 64, color: '#445566'}));
  scene.addObject(new Character({id: 'player', x: 2, y: 3, z: 0, radius: 20, color: '#5590cc'}));
  scene.addObject(new Cloud({id: 'c1', x: 1, y: 1, altitude: 5, speed: 0.3, angle: 0.2, scale: 1.1, seed: 0.6}));
  scene.addObject(new Tree({
    id: 'tree-1', x: 4, y: 1, canopyColor: '#4a9a68', trunkColor: '#76513b', heightPx: 76, scale: 1.1,
  }));
  scene.addObject(new FlowerPatch({
    id: 'flowers-1', x: 4, y: 2, color: '#f47ca5', accentColor: '#fff0a6', count: 8, seed: 3.5,
  }));
  scene.addObject(new Lantern({id: 'lantern-1', x: 4, y: 3, glowColor: '#ffd166', postColor: '#40504b', heightPx: 54}));

  scene.addLight(new OmniLight({
    id: 'lamp', x: 3, y: 3, z: 100, color: '#ffcc66', intensity: 1.2, radius: 300,
    isGlobal: true, falloff: 'quadratic',
  }));
  const sun = new DirectionalLight({id: 'sun', angle: 45, elevation: 60, color: '#aabbff', intensity: 0.3});
  sun.enabled = false;
  scene.addLight(sun);

  const collider = new TileCollider(6, 6);
  collider.setWalkable(0, 0, false);
  scene.collider = collider;

  return scene;
}

describe('Scene.toJSON()', () => {
  it('exports correct top-level fields', () => {
    const json = buildScene().toJSON();
    expect(json.cols).toBe(6);
    expect(json.rows).toBe(6);
    expect(json.tileW).toBe(64);
    expect(json.tileH).toBe(32);
    expect(json.name).toBe('Serialization Test');
    expect(json.ambientColor).toBe('#102030');
    expect(json.ambientIntensity).toBe(0.42);
    expect(json.dynamicLighting).toBe(true);
    expect(json.view).toEqual({rotation: 90, elevation: 0.75});
    expect(json.camera).toEqual({x: 1.5, y: 2.5, zoom: 1.25, lerpFactor: 0.2});
  });

  it('exports floor with color and walkable grid', () => {
    const json = buildScene().toJSON() as Record<string, unknown>;
    const floor = json.floor as Record<string, unknown>;
    expect(floor).toBeTruthy();
    expect(floor.id).toBe('floor');
    expect(floor.cols).toBe(6);
    expect(floor.color).toBe('#333344');
    // walkable grid from collider
    const walkable = floor.walkable as boolean[][];
    expect(walkable[0][0]).toBe(false); // blocked
    expect(walkable[0][1]).toBe(true); // walkable
  });

  it('exports walls correctly', () => {
    const json = buildScene().toJSON() as Record<string, unknown>;
    const walls = json.walls as Record<string, unknown>[];
    expect(walls).toHaveLength(1);
    expect(walls[0].id).toBe('w1');
    expect(walls[0].x).toBe(0);
    expect(walls[0].endX).toBe(6);
    expect(walls[0].height).toBe(64);
  });

  it('exports omni and directional lights', () => {
    const json = buildScene().toJSON() as Record<string, unknown>;
    const lights = json.lights as Record<string, unknown>[];
    expect(lights).toHaveLength(2);

    const omni = lights.find(l => l.type === 'omni')!;
    expect(omni.x).toBe(3);
    expect(omni.color).toBe('#ffcc66');
    expect(omni.intensity).toBe(1.2);
    expect(omni.id).toBe('lamp');
    expect(omni.isGlobal).toBe(true);
    expect(omni.falloff).toBe('quadratic');

    const dir = lights.find(l => l.type === 'directional')!;
    expect(dir.angle).toBe(45);
    expect(dir.elevation).toBe(60);
    expect(dir.intensity).toBe(0.3);
    expect(dir.id).toBe('sun');
    expect(dir.enabled).toBe(false);
  });

  it('exports characters', () => {
    const json = buildScene().toJSON() as Record<string, unknown>;
    const chars = json.characters as Record<string, unknown>[];
    expect(chars).toHaveLength(1);
    expect(chars[0].id).toBe('player');
    expect(chars[0].x).toBe(2);
    expect(chars[0].color).toBe('#5590cc');
  });

  it('exports clouds with correct altitude', () => {
    const json = buildScene().toJSON() as Record<string, unknown>;
    const clouds = json.clouds as Record<string, unknown>[];
    expect(clouds).toHaveLength(1);
    expect(clouds[0].id).toBe('c1');
    expect(clouds[0].altitude).toBeCloseTo(5, 1);
    expect(clouds[0].speed).toBeCloseTo(0.3, 3);
    expect(clouds[0].seed).toBeCloseTo(0.6, 3);
  });

  it('produces JSON that JSON.stringify round-trips cleanly', () => {
    const json = buildScene().toJSON();
    const str = JSON.stringify(json);
    const back = JSON.parse(str);
    expect(back.cols).toBe(6);
    expect((back.lights as unknown[]).length).toBe(2);
  });

  it('round-trips common garden props through the built-in registry', () => {
    const canvas = {
      width: 1,
      height: 1,
      getContext: () => ({}),
    } as unknown as HTMLCanvasElement;
    const json = buildScene().toJSON() as {props: Array<Record<string, unknown>>};
    const restored = new Engine({canvas}).buildScene(json);

    expect(json.props.find(prop => prop.type === 'tree')).toMatchObject({
      color: '#4a9a68', trunkColor: '#76513b', heightPx: 76, scale: 1.1,
    });
    expect(json.props.find(prop => prop.type === 'flowers')).toMatchObject({
      color: '#f47ca5', accentColor: '#fff0a6', count: 8, seed: 3.5,
    });
    expect(json.props.find(prop => prop.type === 'lantern')).toMatchObject({
      color: '#ffd166', postColor: '#40504b', heightPx: 54,
    });
    expect(restored.getById('tree-1')).toBeInstanceOf(Tree);
    expect(restored.getById('flowers-1')).toBeInstanceOf(FlowerPatch);
    expect(restored.getById('lantern-1')).toBeInstanceOf(Lantern);
  });

  it('delegates serialization to SceneSerializer', () => {
    const scene = buildScene();
    expect(scene.toJSON()).toEqual(SceneSerializer.toJSON(scene));
  });

  it('round-trips scene, camera, light, and collider state through Engine', () => {
    const original = buildScene();
    const canvas = {
      width: 1,
      height: 1,
      getContext: () => ({}),
    } as unknown as HTMLCanvasElement;
    const restored = new Engine({canvas}).buildScene(original.toJSON());

    expect(restored.name).toBe(original.name);
    expect(restored.ambientColor).toBe(original.ambientColor);
    expect(restored.ambientIntensity).toBe(original.ambientIntensity);
    expect(restored.dynamicLighting).toBe(true);
    expect(restored.view).toEqual(original.view);
    expect(restored.camera.x).toBe(1.5);
    expect(restored.camera.y).toBe(2.5);
    expect(restored.camera.zoom).toBe(1.25);
    expect(restored.camera.lerpFactor).toBe(0.2);
    expect(restored.collider?.isWalkable(0, 0)).toBe(false);

    const lamp = restored.getLightById('lamp') as OmniLight;
    expect(lamp).toBeInstanceOf(OmniLight);
    expect(lamp.isGlobal).toBe(true);
    expect(lamp.falloff).toBe('quadratic');
    expect(restored.getLightById('sun')?.enabled).toBe(false);
  });
});
