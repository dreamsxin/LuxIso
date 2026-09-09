import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SceneManager } from '../core/SceneManager';
import { Engine } from '../core/Engine';
import { Scene } from '../core/Scene';
import { AssetLoader } from '../core/AssetLoader';

/** Minimal canvas stub: Engine only needs a 2D context and dimensions here. */
function makeCanvas(): HTMLCanvasElement {
  return {
    getContext: () => ({
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
    }),
    width: 800,
    height: 600,
  } as unknown as HTMLCanvasElement;
}

describe('SceneManager', () => {
  let engine: Engine;
  let mgr: SceneManager;

  beforeEach(() => {
    engine = new Engine({ canvas: makeCanvas() });
    mgr = new SceneManager(engine);
  });


  it('registers and pushes scenes', async () => {
    const scene1 = new Scene();
    const onEnter = vi.fn();
    
    mgr.register('menu', () => ({
      scene: scene1,
      onEnter
    }));

    await mgr.push('menu');
    
    expect(mgr.current).toBe('menu');
    expect(engine.scene).toBe(scene1);
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('handles stack push and pop lifecycle', async () => {
    const scene1 = new Scene();
    const scene2 = new Scene();
    const onPause = vi.fn();
    const onResume = vi.fn();
    const onExit = vi.fn();

    mgr.register('level1', () => ({
      scene: scene1,
      onPause,
      onResume
    }));

    mgr.register('pauseMenu', () => ({
      scene: scene2,
      onExit
    }));

    await mgr.push('level1');
    await mgr.push('pauseMenu');

    expect(mgr.current).toBe('pauseMenu');
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(engine.scene).toBe(scene2);

    await mgr.pop();
    expect(mgr.current).toBe('level1');
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(engine.scene).toBe(scene1);
  });

  it('replaces the current scene', async () => {
    const scene1 = new Scene();
    const scene2 = new Scene();
    const onExit1 = vi.fn();
    const onEnter2 = vi.fn();

    mgr.register('s1', () => ({ scene: scene1, onExit: onExit1 }));
    mgr.register('s2', () => ({ scene: scene2, onEnter: onEnter2 }));

    await mgr.push('s1');
    await mgr.replace('s2');

    expect(mgr.current).toBe('s2');
    expect(mgr.depth).toBe(1);
    expect(onExit1).toHaveBeenCalledTimes(1);
    expect(onEnter2).toHaveBeenCalledTimes(1);
  });

  it('runs the factory on every push, not just the first', async () => {
    const factory = vi.fn(() => ({ scene: new Scene() }));
    mgr.register('s', factory);

    await mgr.push('s');
    await mgr.pop();
    await mgr.push('s');

    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('throws for an unregistered name', async () => {
    await expect(mgr.push('nope')).rejects.toThrow(/not registered/);
    expect(mgr.depth).toBe(0);
  });

  it('pop on an empty stack is a no-op', async () => {
    await mgr.pop();
    expect(mgr.depth).toBe(0);
    expect(mgr.current).toBeNull();
  });

  it('drives only the top scene from update()', async () => {
    const bottom = vi.fn();
    const top = vi.fn();
    mgr.register('bottom', () => ({ scene: new Scene(), onUpdate: bottom }));
    mgr.register('top',    () => ({ scene: new Scene(), onUpdate: top }));

    await mgr.push('bottom');
    await mgr.push('top');
    mgr.update(0.016, {} as never);

    expect(top).toHaveBeenCalledTimes(1);
    expect(bottom).not.toHaveBeenCalled();
  });
});

describe('SceneManager — failed push rollback', () => {
  let engine: Engine;
  let mgr: SceneManager;

  beforeEach(() => {
    engine = new Engine({ canvas: makeCanvas() });
    mgr = new SceneManager(engine);
  });

  it('resumes the previous scene when the new scene fails to build', async () => {
    const base = new Scene();
    const onPause  = vi.fn();
    const onResume = vi.fn();
    mgr.register('base', () => ({ scene: base, onPause, onResume }));
    mgr.register('broken', () => { throw new Error('build failed'); });

    await mgr.push('base');
    await expect(mgr.push('broken')).rejects.toThrow('build failed');

    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(mgr.current).toBe('base');
    expect(mgr.depth).toBe(1);
    expect(engine.scene).toBe(base);
  });

  it('rolls back a scene whose onEnter throws', async () => {
    const base = new Scene();
    const onResume = vi.fn();
    mgr.register('base', () => ({ scene: base, onPause: vi.fn(), onResume }));
    mgr.register('bad', () => ({
      scene: new Scene(),
      onEnter() { throw new Error('enter failed'); },
    }));

    await mgr.push('base');
    await expect(mgr.push('bad')).rejects.toThrow('enter failed');

    expect(mgr.depth).toBe(1);
    expect(mgr.current).toBe('base');
    expect(engine.scene).toBe(base);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('does not resume anything when the failed push was the first', async () => {
    mgr.register('broken', () => { throw new Error('nope'); });
    await expect(mgr.push('broken')).rejects.toThrow('nope');
    expect(mgr.depth).toBe(0);
    expect(mgr.current).toBeNull();
  });

  it('clears the loading guard so a later push still works', async () => {
    mgr.register('broken', () => { throw new Error('nope'); });
    mgr.register('good', () => ({ scene: new Scene() }));

    await expect(mgr.push('broken')).rejects.toThrow('nope');
    await mgr.push('good');
    expect(mgr.current).toBe('good');
  });
});

describe('SceneManager — per-scene AssetLoader', () => {
  let engine: Engine;
  let mgr: SceneManager;

  beforeEach(() => {
    engine = new Engine({ canvas: makeCanvas() });
    mgr = new SceneManager(engine);
  });

  function loaderWithOneAsset(): AssetLoader {
    const loader = new AssetLoader();
    loader.register('/a.png', {} as HTMLImageElement);
    return loader;
  }

  it('clears the scene loader on pop', async () => {
    const assetLoader = loaderWithOneAsset();
    mgr.register('s', () => ({ scene: new Scene(), assetLoader }));

    await mgr.push('s');
    expect(assetLoader.size).toBe(1);
    await mgr.pop();
    expect(assetLoader.size).toBe(0);
  });

  it('clears the scene loader on replace', async () => {
    const assetLoader = loaderWithOneAsset();
    mgr.register('s1', () => ({ scene: new Scene(), assetLoader }));
    mgr.register('s2', () => ({ scene: new Scene() }));

    await mgr.push('s1');
    await mgr.replace('s2');
    expect(assetLoader.size).toBe(0);
  });

  it('clears every stacked scene loader on replace', async () => {
    const bottomLoader = loaderWithOneAsset();
    const topLoader    = loaderWithOneAsset();
    mgr.register('bottom', () => ({ scene: new Scene(), assetLoader: bottomLoader }));
    mgr.register('top',    () => ({ scene: new Scene(), assetLoader: topLoader }));
    mgr.register('fresh',  () => ({ scene: new Scene() }));

    await mgr.push('bottom');
    await mgr.push('top');
    await mgr.replace('fresh');

    expect(bottomLoader.size).toBe(0);
    expect(topLoader.size).toBe(0);
    expect(mgr.depth).toBe(1);
  });

  it('still clears the loader when onExit throws', async () => {
    const assetLoader = loaderWithOneAsset();
    mgr.register('s', () => ({
      scene: new Scene(),
      assetLoader,
      onExit() { throw new Error('exit failed'); },
    }));

    await mgr.push('s');
    await expect(mgr.pop()).rejects.toThrow('exit failed');
    // The scene is already off the stack, so this was the last chance to free
    // its assets.
    expect(assetLoader.size).toBe(0);
    expect(mgr.depth).toBe(0);
  });
});

