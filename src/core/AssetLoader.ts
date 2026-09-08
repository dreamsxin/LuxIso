/**
 * AssetLoader — image preloader with LRU-style cache.
 *
 * ## Usage
 *
 * ### Static API (backwards-compatible, uses a shared global instance)
 * ```ts
 * await AssetLoader.loadImage('/sprites/hero.png');
 * const img = AssetLoader.get('/sprites/hero.png');
 * ```
 *
 * ### Instance API (recommended for multi-scene / testable code)
 * ```ts
 * // Each scene owns its loader; clearing one never affects another.
 * const loader = new AssetLoader();
 * await loader.loadImage('/sprites/hero.png');
 * loader.unload('/sprites/hero.png'); // free a single asset
 * loader.clear();                     // free all assets for this scene
 * console.log(loader.size);           // 0
 * ```
 */
export class AssetLoader {
  // ── Instance state ────────────────────────────────────────────────────────
  private _cache   = new Map<string, HTMLImageElement>();
  private _pending = new Map<string, Promise<HTMLImageElement>>();
  /**
   * Bumped whenever a URL is unloaded or the whole cache is cleared. An
   * in-flight load captures the value at start and refuses to write into the
   * cache if it changed, which is what makes `unload()` behave as documented.
   */
  private _epoch = new Map<string, number>();

  // ── Instance API ──────────────────────────────────────────────────────────

  /** Load a single image (returns cached promise if already loading/loaded). */
  loadImage(url: string): Promise<HTMLImageElement> {
    const cached = this._cache.get(url);
    if (cached) return Promise.resolve(cached);

    const inFlight = this._pending.get(url);
    if (inFlight) return inFlight;

    const startedAt = this._epoch.get(url) ?? 0;
    const isCurrent = (): boolean => (this._epoch.get(url) ?? 0) === startedAt;

    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // Skip both writes when the URL was unloaded mid-flight: caching here
        // would resurrect an asset the caller explicitly released, and deleting
        // the pending entry could clobber a newer load for the same URL.
        if (isCurrent()) {
          this._cache.set(url, img);
          this._pending.delete(url);
        }
        resolve(img);
      };
      img.onerror = () => {
        if (isCurrent()) this._pending.delete(url);
        reject(new Error(`AssetLoader: failed to load image "${url}"`));
      };
      img.src = url;
    });

    this._pending.set(url, promise);
    return promise;
  }

  /** Load multiple images in parallel; resolves when all are ready. */
  loadAll(urls: string[]): Promise<HTMLImageElement[]> {
    return Promise.all(urls.map((u) => this.loadImage(u)));
  }

  /** Synchronous get — returns undefined if not yet loaded. */
  get(url: string): HTMLImageElement | undefined {
    return this._cache.get(url);
  }

  /**
   * Remove a single URL from the cache.
   * Any in-flight load for this URL is left to complete (its promise still
   * resolves for existing awaiters) but the result is not stored, and the next
   * `loadImage(url)` starts a fresh load.
   */
  unload(url: string): void {
    this._cache.delete(url);
    this._pending.delete(url);
    this._epoch.set(url, (this._epoch.get(url) ?? 0) + 1);
  }

  /** Clear the entire cache and cancel tracking of in-flight loads. */
  clear(): void {
    for (const url of this._pending.keys()) {
      this._epoch.set(url, (this._epoch.get(url) ?? 0) + 1);
    }
    this._cache.clear();
    this._pending.clear();
  }

  /** Number of successfully loaded (cached) assets. */
  get size(): number {
    return this._cache.size;
  }

  // ── Global default instance + static API (backwards-compatible) ───────────

  /**
   * Shared global instance used by the static methods.
   * Replace with your own instance if you need a different global default.
   */
  static readonly default = new AssetLoader();

  /** @see {@link AssetLoader#loadImage} */
  static loadImage(url: string): Promise<HTMLImageElement> {
    return AssetLoader.default.loadImage(url);
  }

  /** @see {@link AssetLoader#loadAll} */
  static loadAll(urls: string[]): Promise<HTMLImageElement[]> {
    return AssetLoader.default.loadAll(urls);
  }

  /** @see {@link AssetLoader#get} */
  static get(url: string): HTMLImageElement | undefined {
    return AssetLoader.default.get(url);
  }

  /**
   * Register an already-loaded image directly into the cache.
   * Useful for images loaded via FileReader / data URLs that don't
   * go through a network fetch (e.g. the sprite editor).
   */
  register(url: string, img: HTMLImageElement): void {
    this._cache.set(url, img);
  }

  /** @see {@link AssetLoader#register} */
  static register(url: string, img: HTMLImageElement): void {
    AssetLoader.default.register(url, img);
  }

  /**
   * Clear the global default cache.
   * To clear a specific scene's loader, call `loader.clear()` on that instance.
   */
  static clear(): void {
    AssetLoader.default.clear();
  }
}
