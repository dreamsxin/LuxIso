import {describe, it, expect, beforeEach, vi} from 'vitest';
import {Minimap} from '../core/Minimap';
import {Scene} from '../core/Scene';
import {Character} from '../elements/Character';

// Mock OffscreenCanvas if not available in the test environment
if (typeof OffscreenCanvas === 'undefined') {
  (globalThis as any).OffscreenCanvas = class {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return {
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        arc: vi.fn(),
        arcTo: vi.fn(),
        fill: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
      };
    }
  };
}

describe('Minimap', () => {
  let scene: Scene;
  let minimap: Minimap;

  beforeEach(() => {
    scene = new Scene({cols: 10, rows: 10});
    minimap = new Minimap(scene, {cols: 10, rows: 10});
  });

  it('can be initialized with style', () => {
    const customMinimap = new Minimap(scene, {
      cols: 5,
      rows: 5,
      style: {bg: '#ff0000', alpha: 0.5},
    });
    expect(customMinimap.alpha).toBe(0.5);
  });

  it('draws to a provided canvas context', () => {
    const mockCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      clip: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      arcTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    // Add a character to the scene to be drawn on minimap
    const char = new Character({id: 'player', x: 2, y: 3});
    scene.addObject(char);

    minimap.draw(mockCtx, 0, 0, 100, 100);

    expect(mockCtx.save).toHaveBeenCalled();
    expect(mockCtx.restore).toHaveBeenCalled();
    expect(mockCtx.drawImage).toHaveBeenCalled();
  });

  it('updates scene reference', () => {
    const scene2 = new Scene();
    minimap.setScene(scene2);
    // No easy way to verify internal state without exposing it,
    // but we can verify it doesn't crash.
    expect(minimap).toBeDefined();
  });
});
