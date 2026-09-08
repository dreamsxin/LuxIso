import { GLResourceRegistry } from '../device/GLResourceRegistry';

interface TextureRecord {
  texture: WebGLTexture | null;
  loading: boolean;
  failed: boolean;
}

/**
 * Lazy URL-to-texture registry. CPU image loading survives normal render frames.
 *
 * GPU handles are owned by `GLResourceRegistry`, not by this class: `dispose()`
 * only drops JS references, because the renderer either deletes the whole
 * registry (`GLResourceRegistry.dispose`) or abandons already-invalidated
 * handles after context loss (`GLResourceRegistry.abandon`).
 *
 * Records are never evicted within a renderer lifetime, so a URL that stops
 * being referenced stays resident. Tracked as a roadmap item; fixing it needs
 * per-frame reference counting.
 */
export class TextureRegistry {
  readonly white: WebGLTexture;
  private readonly _records = new Map<string, TextureRecord>();
  private readonly _loadingImages = new Set<HTMLImageElement>();
  private readonly _reportedFailures = new Set<string>();
  private _disposed = false;

  constructor(
    private readonly _gl: WebGL2RenderingContext,
    private readonly _resources: GLResourceRegistry,
  ) {
    this.white = this._resources.texture();
    this._gl.bindTexture(this._gl.TEXTURE_2D, this.white);
    this._gl.texImage2D(
      this._gl.TEXTURE_2D,
      0,
      this._gl.RGBA,
      1,
      1,
      0,
      this._gl.RGBA,
      this._gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    );
    this._configureTexture();
    this._gl.bindTexture(this._gl.TEXTURE_2D, null);
  }

  resolve(url: string): WebGLTexture | null {
    if (this._disposed) return null;
    let record = this._records.get(url);
    if (!record) {
      record = { texture: null, loading: true, failed: false };
      this._records.set(url, record);
      this._load(url, record);
    }
    if (record.failed) {
      // `failed` used to be set and never read, so the caller's
      // `if (!resolved) continue` silently dropped every segment using this URL:
      // a 404 or CORS error made those objects permanently invisible with no
      // diagnostic. Fall back to the 1x1 white texture so geometry still draws
      // (untextured) and report the URL once.
      if (!this._reportedFailures.has(url)) {
        this._reportedFailures.add(url);
        console.warn(`TextureRegistry: failed to load "${url}"; drawing untextured.`);
      }
      return this.white;
    }
    return record.texture;
  }

  /** URLs whose image load failed. Useful for surfacing asset problems in the UI. */
  get failedUrls(): readonly string[] {
    const failed: string[] = [];
    for (const [url, record] of this._records) {
      if (record.failed) failed.push(url);
    }
    return failed;
  }


  get size(): number {
    let count = 0;
    for (const record of this._records.values()) {
      if (record.texture) count++;
    }
    return count;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const image of this._loadingImages) {
      image.onload = null;
      image.onerror = null;
    }
    this._loadingImages.clear();
    this._records.clear();
    this._reportedFailures.clear();
  }

  private _load(url: string, record: TextureRecord): void {
    const image = new Image();
    this._loadingImages.add(image);
    if (!url.startsWith('data:') && !url.startsWith('blob:')) image.crossOrigin = 'anonymous';
    image.onload = () => {
      this._loadingImages.delete(image);
      if (this._disposed) return;
      const texture = this._resources.texture();
      const gl = this._gl;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      this._configureTexture();
      gl.bindTexture(gl.TEXTURE_2D, null);
      record.texture = texture;
      record.loading = false;
    };
    image.onerror = () => {
      this._loadingImages.delete(image);
      if (this._disposed) return;
      record.loading = false;
      record.failed = true;
    };
    image.src = url;
  }

  private _configureTexture(): void {
    const gl = this._gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
}
