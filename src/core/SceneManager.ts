/**
 * SceneManager — multi-scene lifecycle management.
 *
 * Manages a stack of named scenes with push/pop/replace transitions.
 * Each scene can define optional `onEnter` / `onExit` / `onPause` / `onResume`
 * lifecycle hooks via a `ManagedScene` wrapper.
 *
 * @example
 *   const mgr = new SceneManager(engine);
 *
 *   mgr.register('game',  async () => {
 *     const scene = await engine.loadScene('/scenes/level1.json');
 *     return { scene, onEnter: () => audio.playBgm('/music/game.mp3') };
 *   });
 *
 *   mgr.register('menu', async () => {
 *     const scene = engine.buildScene({ cols: 1, rows: 1 });
 *     return { scene };
 *   });
 *
 *   await mgr.push('menu');
 *
 *   // Later, transition to game:
 *   await mgr.replace('game');
 *
 *   // Pause game, show overlay:
 *   await mgr.push('pause-overlay');
 *
 *   // Resume:
 *   await mgr.pop();
 */
import { Engine } from './Engine';
import { Scene } from './Scene';
import { InputManager } from './InputManager';
import { AssetLoader } from './AssetLoader';

export interface ManagedScene {
  scene: Scene;
  /**
   * Optional per-scene asset loader. When provided, SceneManager automatically
   * calls `assetLoader.clear()` after `onExit()` to release scene-specific resources.
   */
  assetLoader?: AssetLoader;
  /** Called when this scene becomes the active (top) scene. */
  onEnter?(): void | Promise<void>;
  /** Called when this scene is removed from the stack. */
  onExit?():  void | Promise<void>;
  /** Called when another scene is pushed on top of this one. */
  onPause?(): void | Promise<void>;
  /** Called when the scene above this one is popped. */
  onResume?():void | Promise<void>;
  /**
   * Called every frame while this scene is active, before scene.draw().
   * Use this to handle input, update game logic, and spawn particles.
   * @param dt  Frame delta in seconds.
   * @param input  The engine's InputManager for polling pointer/keyboard.
   */
  onUpdate?(dt: number, input: InputManager): void;
  /**
   * Called every frame to draw the background (sky, water, etc.) before
   * the scene objects are rendered. Runs before scene.draw().
   * @param ctx  The main canvas 2D context.
   * @param w    Canvas width in pixels.
   * @param h    Canvas height in pixels.
   * @param ts   Timestamp in milliseconds (from requestAnimationFrame).
   */
  onDrawBackground?(ctx: CanvasRenderingContext2D, w: number, h: number, ts: number): void;
  /**
   * Called every frame after scene.draw() to render overlays (HUD markers,
   * click indicators, etc.) on top of the scene.
   */
  onDrawOverlay?(ctx: CanvasRenderingContext2D, w: number, h: number, ts: number): void;
}

type SceneFactory = () => Promise<ManagedScene> | ManagedScene;

export class SceneManager {
  private _engine:    Engine;
  private _registry   = new Map<string, SceneFactory>();
  private _stack:     Array<{ name: string; managed: ManagedScene }> = [];
  private _loading    = false;

  constructor(engine: Engine) {
    this._engine = engine;
  }

  // ── Registry ──────────────────────────────────────────────────────────────

  /**
   * Register a named scene factory.
   *
   * The factory runs lazily — nothing happens until the name is pushed — but it
   * runs on *every* `push`/`replace` of that name, not just the first. Results
   * are deliberately not cached: a factory that builds fresh state per entry is
   * the common case. Return a scene captured outside the factory if you want
   * one instance reused across entries.
   */
  register(name: string, factory: SceneFactory): void {
    this._registry.set(name, factory);
  }


  // ── Stack operations ──────────────────────────────────────────────────────

  /** Current active scene name, or null if the stack is empty. */
  get current(): string | null {
    return this._stack.length > 0 ? this._stack[this._stack.length - 1].name : null;
  }

  /** The active ManagedScene, or null if the stack is empty. */
  get currentManaged(): ManagedScene | null {
    return this._stack.length > 0 ? this._stack[this._stack.length - 1].managed : null;
  }

  /** Depth of the scene stack. */
  get depth(): number { return this._stack.length; }

  /**
   * Call once per frame to drive the active scene's onUpdate hook.
   * Typically called from your engine's preFrame callback.
   */
  update(dt: number, input: InputManager): void {
    const managed = this.currentManaged;
    if (managed?.onUpdate) managed.onUpdate(dt, input);
  }

  /**
   * Push a new scene onto the stack.
   * The current top scene receives `onPause`, the new scene receives `onEnter`.
   *
   * If the new scene fails to build or its `onEnter` throws, the push is rolled
   * back: the previous scene is re-activated and resumed before the error
   * propagates. `onPause` and `onResume` are strictly paired, and a scene left
   * paused forever because the *next* scene failed is close to impossible to
   * diagnose from the symptom.
   */
  async push(name: string): Promise<void> {
    if (this._loading) return;
    this._loading = true;
    const previous = this._stack[this._stack.length - 1];
    let paused = false;
    let pushed = false;
    let built: ManagedScene | null = null;
    try {
      if (previous?.managed.onPause) {
        await previous.managed.onPause();
        paused = true;
      }

      const managed = await this._build(name);
      built = managed;
      this._stack.push({ name, managed });
      pushed = true;
      this._engine.setScene(managed.scene);
      if (managed.onEnter) await managed.onEnter();
    } catch (err) {
      if (pushed) this._stack.pop();
      // The factory already ran, so the failed scene may be holding textures.
      // `ManagedScene.assetLoader` promises they are released after the scene
      // leaves, and the rollback path was the one place that forgot: a retry
      // loop on a flaky level load grew the heap with nothing able to free it.
      built?.assetLoader?.clear();
      if (previous) {
        this._engine.setScene(previous.managed.scene);
        if (paused && previous.managed.onResume) await previous.managed.onResume();
      }
      throw err;
    } finally {
      this._loading = false;
    }
  }


  /**
   * Pop the top scene off the stack.
   * The popped scene receives `onExit`, the new top receives `onResume`.
   *
   * Installing and resuming the new top happens in a `finally`: a throwing
   * `onExit` used to leave the popped scene both off the stack *and* still on the
   * engine with its assets freed, while the scene underneath never got
   * `setScene` or `onResume` — paused forever, which `push`'s docstring calls
   * close to impossible to diagnose from the symptom. The error still propagates.
   */
  async pop(): Promise<void> {
    if (this._loading || this._stack.length === 0) return;
    this._loading = true;
    try {
      const top = this._stack.pop()!;
      try {
        if (top.managed.onExit) await top.managed.onExit();
      } finally {
        // The scene is already off the stack, so this is the last chance to
        // release its assets — a throwing onExit must not turn into a leak.
        top.managed.assetLoader?.clear();

        const newTop = this._stack[this._stack.length - 1];
        if (newTop) {
          this._engine.setScene(newTop.managed.scene);
          if (newTop.managed.onResume) await newTop.managed.onResume();
        } else {
          this._engine.setScene(new Scene());
        }
      }
    } finally {
      this._loading = false;
    }
  }

  /**
   * Replace the entire stack with a single new scene.
   * All existing scenes receive `onExit`, unwound top to bottom.
   *
   * Build first, retire second. The old order — exit everything, empty the
   * stack, then build — had no way back: a failed build or a throwing `onEnter`
   * left `depth === 0` with the engine still drawing a scene whose `onExit` had
   * run and whose `assetLoader.clear()` had already executed, so the game froze
   * on the previous level with its textures gone and no recovery path. Even on
   * the success path that order left a window where the live scene's assets were
   * freed. `push()` was hardened against exactly this and says why; this is the
   * same guarantee.
   */
  async replace(name: string): Promise<void> {
    if (this._loading) return;
    this._loading = true;
    try {
      // Nothing is disturbed if this throws.
      const managed = await this._build(name);
      const outgoing = this._stack;
      this._stack = [{ name, managed }];
      this._engine.setScene(managed.scene);

      try {
        if (managed.onEnter) await managed.onEnter();
      } catch (err) {
        // The outgoing scenes have not been exited yet, so this is recoverable.
        this._stack = outgoing;
        const previous = outgoing[outgoing.length - 1];
        if (previous) this._engine.setScene(previous.managed.scene);
        throw err;
      }

      // Only once the new scene is live and entered do the old ones retire.
      for (let i = outgoing.length - 1; i >= 0; i--) {
        const old = outgoing[i].managed;
        try {
          if (old.onExit) await old.onExit();
        } finally {
          old.assetLoader?.clear();
        }
      }
    } finally {
      this._loading = false;
    }
  }


  /**
   * Pop all scenes and push a new one.
   * Equivalent to `replace` but semantically clearer for "go to main menu".
   */
  async goto(name: string): Promise<void> {
    return this.replace(name);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async _build(name: string): Promise<ManagedScene> {
    const factory = this._registry.get(name);
    if (!factory) throw new Error(`SceneManager: scene "${name}" is not registered`);
    return factory();
  }
}
