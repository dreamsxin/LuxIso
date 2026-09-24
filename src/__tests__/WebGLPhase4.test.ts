import {describe, expect, it} from 'vitest';
import {ParticleBlend, ParticleSystem} from '../animation/ParticleSystem';
import {SpriteSheet} from '../animation/SpriteSheet';
import {AssetLoader} from '../core/AssetLoader';
import {Scene} from '../core/Scene';
import {Character} from '../elements/Character';
import {Floor} from '../elements/Floor';
import {FloatingText} from '../elements/props/FloatingText';
import {TileCollider} from '../physics/TileCollider';
import {RENDER_VERTEX_FLOATS} from '../../webgl-next/src/contracts/RenderSnapshot';
import {SceneExtractor} from '../../webgl-next/src/extraction/SceneExtractor';
import {renderPointToScreen} from '../../webgl-next/src/overlays/cameraTransform';

describe('WebGL Next Phase 4 extraction', () => {
  it('exposes allocation-free particle render state with blend and lifecycle values', () => {
    const system = new ParticleSystem('fx', 0, 0, 0);
    system.spawn({
      x: 1, y: 2, z: 3,
      vx: 0, vy: 0, vz: 0,
      life: 2,
      size: 4,
      sizeFinal: 2,
      color: '#ff0000',
      colorEnd: '#0000ff',
      alphaStart: 0.8,
      alphaEnd: 0.2,
      blend: ParticleBlend.ADD,
      shape: 'square',
    });

    const states: Array<{blend: ParticleBlend; shape: string; alpha: number}> = [];
    system.forEachParticle(particle => states.push({
      blend: particle.blend,
      shape: particle.shape,
      alpha: particle.alpha,
    }));

    expect(system.particleCount).toBe(1);
    expect(states).toEqual([{blend: ParticleBlend.ADD, shape: 'square', alpha: 0.8}]);
  });

  it('extracts particles, labels, minimap, collision, and selection debug data', () => {
    const scene = new Scene({cols: 4, rows: 4});
    scene.addObject(new Floor({id: 'floor', cols: 4, rows: 4}));
    const character = new Character({id: 'hero', x: 1.5, y: 1.5});
    scene.addObject(character);
    const particles = new ParticleSystem('fx', 2, 2, 0);
    particles.spawn({
      x: 2, y: 2, z: 10,
      vx: 0, vy: 0, vz: 0,
      life: 1, size: 2, color: '#ffaa00', blend: ParticleBlend.ADD,
    });
    scene.addObject(particles);
    scene.addObject(new FloatingText({id: 'label', x: 1.5, y: 1.5, z: 32, text: '42'}));
    scene.collider = new TileCollider(4, 4);
    scene.collider.setWalkable(2, 2, false);

    const snapshot = new SceneExtractor().extract(scene, {
      viewportWidth: 640,
      viewportHeight: 480,
      selectedId: 'hero',
      showCollision: true,
    });

    expect(snapshot.unsupported).toEqual([]);
    expect(snapshot.textOverlays).toHaveLength(1);
    expect(snapshot.textOverlays[0].text).toBe('42');
    expect(snapshot.minimap.walkable[2 * 4 + 2]).toBe(0);
    expect(snapshot.minimap.items.map(item => item.id)).toEqual(['hero']);
    expect(snapshot.geometry.debug.count).toBeGreaterThan(0);
    expect(snapshot.geometry.segments.some(segment => segment.blend === 'add')).toBe(true);
    expect([...snapshot.pickLookup.values()]).toContain('fx');
  });

  it('extracts the active sprite frame as textured geometry', () => {
    const url = 'memory://hero-atlas';
    AssetLoader.register(url, {
      naturalWidth: 64,
      naturalHeight: 32,
    } as HTMLImageElement);
    const sheet = new SpriteSheet({
      url,
      clips: [{name: 'idle', fps: 4, frames: [{x: 16, y: 0, w: 16, h: 32}]}],
    });
    const scene = new Scene({cols: 2, rows: 2});
    scene.addObject(new Floor({id: 'floor', cols: 2, rows: 2}));
    const character = new Character({id: 'sprite', x: 1, y: 1});
    character.setSpriteSheet(sheet);
    scene.addObject(character);
    const snapshot = new SceneExtractor().extract(scene, {
      viewportWidth: 400,
      viewportHeight: 300,
    });
    const textureSegment = snapshot.geometry.segments.find(segment => segment.textureUrl === url);

    expect(textureSegment?.count).toBe(6);
    expect(snapshot.geometry.data[textureSegment!.first * RENDER_VERTEX_FLOATS + 16]).toBe(1);
  });

  it('culls a large floor to the visible camera region', () => {
    const scene = new Scene({cols: 100, rows: 100});
    scene.addObject(new Floor({id: 'large-floor', cols: 100, rows: 100}));
    scene.camera.x = 50;
    scene.camera.y = 50;
    const snapshot = new SceneExtractor().extract(scene, {
      viewportWidth: 320,
      viewportHeight: 240,
      originX: 160,
      originY: 80,
    });

    expect(snapshot.geometry.floor.count).toBeGreaterThan(0);
    expect(snapshot.geometry.floor.count).toBeLessThan(100 * 100 * 6);
  });

  it('keeps DOM overlay coordinates aligned with the WebGL camera transform', () => {
    const scene = new Scene({tileW: 64, tileH: 32});
    scene.camera.x = 2;
    scene.camera.y = 1;
    scene.camera.zoom = 1.5;
    scene.view = {rotation: 90, elevation: 0.75};
    const snapshot = new SceneExtractor().extract(scene, {
      viewportWidth: 800,
      viewportHeight: 600,
      originX: 400,
      originY: 120,
    });
    const screen = renderPointToScreen(64, 96, snapshot);

    expect(screen.x).toBeCloseTo(616);
    expect(screen.y).toBeCloseTo(96);
  });
});
