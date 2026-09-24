import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {Engine} from '../core/Engine';
import {Scene} from '../core/Scene';

// Minimal canvas stub

function makeCanvas(): HTMLCanvasElement {
  const canvas = {
    width: 640,
    height: 480,
    getContext: () => ({
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      clip: vi.fn(),
      createRadialGradient: vi.fn(() => ({
        addColorStop: vi.fn(),
      })),
      createLinearGradient: vi.fn(() => ({
        addColorStop: vi.fn(),
      })),
      setLineDash: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({width: 0})),
      globalCompositeOperation: 'source-over',
      globalAlpha: 1,
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
    }),
  } as unknown as HTMLCanvasElement;
  return canvas;
}

// Tests

describe('Engine - construction', () => {
  it('sets default origin to canvas centre', () => {
    const canvas = makeCanvas();
    const engine = new Engine({canvas});
    expect(engine.originX).toBe(320);
    expect(engine.originY).toBe(240);
  });

  it('exposes ctx', () => {
    const canvas = makeCanvas();
    const engine = new Engine({canvas});
    expect(engine.ctx).toBeDefined();
  });

  it('scene is null before setScene', () => {
    const engine = new Engine({canvas: makeCanvas()});
    expect(engine.scene).toBeNull();
  });
});

describe('Engine - buildScene', () => {
  it('returns a Scene instance', () => {
    const engine = new Engine({canvas: makeCanvas()});
    const scene = engine.buildScene({
      cols: 5, rows: 5,
      floor: {id: 'f', cols: 5, rows: 5},
    });
    expect(scene).toBeInstanceOf(Scene);
  });

  it('scene has correct dimensions', () => {
    const engine = new Engine({canvas: makeCanvas()});
    const scene = engine.buildScene({cols: 8, rows: 6, tileW: 64, tileH: 32});
    expect(scene.cols).toBe(8);
    expect(scene.rows).toBe(6);
    expect(scene.tileW).toBe(64);
    expect(scene.tileH).toBe(32);
  });

  it('builds collider from walkable map', () => {
    const engine = new Engine({canvas: makeCanvas()});
    const scene = engine.buildScene({
      cols: 2, rows: 2,
      floor: {
        id: 'f', cols: 2, rows: 2,
        walkable: [[true, false], [false, true]],
      },
    });
    expect(scene.collider).not.toBeNull();
    expect(scene.collider!.isWalkable(0, 0)).toBe(true);
    expect(scene.collider!.isWalkable(1, 0)).toBe(false);
  });
});

describe('Engine - setScene / scene getter', () => {
  it('setScene stores the scene', () => {
    const engine = new Engine({canvas: makeCanvas()});
    const scene = new Scene({cols: 4, rows: 4});
    engine.setScene(scene);
    expect(engine.scene).toBe(scene);
  });
});

describe('Engine - start / stop', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn((_cb: FrameRequestCallback) => {
      // Don't actually call cb; just return an id
      return 1;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('start calls requestAnimationFrame', () => {
    const engine = new Engine({canvas: makeCanvas()});
    engine.setScene(new Scene());
    engine.start();
    expect(requestAnimationFrame).toHaveBeenCalled();
    engine.stop();
  });

  it('stop calls cancelAnimationFrame', () => {
    const engine = new Engine({canvas: makeCanvas()});
    engine.setScene(new Scene());
    engine.start();
    engine.stop();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  });

  it('calling start twice does not double-register', () => {
    const engine = new Engine({canvas: makeCanvas()});
    engine.setScene(new Scene());
    engine.start();
    engine.start();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    engine.stop();
  });
});
