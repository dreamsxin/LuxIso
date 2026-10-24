import type {EditorRenderer} from '../../../src/editor/EditorRenderer';
import type {EditorState} from '../../../src/editor/EditorState';
import type {RenderStats} from '../contracts/RenderBackend';
import type {DebugMarker} from '../extraction/SceneExtractor';
import {SceneExtractor} from '../extraction/SceneExtractor';
import {WebGLRenderer} from '../renderer/WebGLRenderer';

export interface EditorWebGLPreviewOptions {
  /**
   * DPR source, injectable for tests. Defaults to `window.devicePixelRatio`.
   * Clamped to [1, 2], matching `Engine.maxPixelRatio`.
   */
  pixelRatio?: () => number;
}

export interface EditorFrameSize {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
}

/** Experimental adapter that renders the editor's rebuilt Scene with WebGL2. */
export class EditorWebGLPreview {
  private readonly _renderer: WebGLRenderer;
  private readonly _extractor = new SceneExtractor();
  private readonly _pixelRatio: () => number;
  private _raf: number | null = null;
  private _enabled = false;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly _state: EditorState,
    private readonly _source: EditorRenderer,
    options: EditorWebGLPreviewOptions = {}
  ) {
    this._renderer = new WebGLRenderer(canvas);
    this._pixelRatio = options.pixelRatio ?? (() =>
      (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));
  }

  /**
   * Resolve the GL frame size from the 2-D canvas's *CSS* box.
   *
   * The preview used to pass the 2-D canvas's backing-store size as CSS pixels
   * with dpr pinned to 1, so above DPR 1 the GL backing was undersized and
   * `pick()` (CSS-pixel input, multiplied by the renderer's dpr) addressed the
   * wrong texels. Logical CSS pixels are the framework-wide contract; the
   * renderer scales its own backing store. Returns null for an unlaid-out
   * canvas — drawing at 0×0 used to build a real 1×1 backing for an invisible
   * frame every rAF tick.
   */
  static resolveFrame(
    clientWidth: number,
    clientHeight: number,
    pixelRatio: number
  ): EditorFrameSize | null {
    if (!Number.isFinite(clientWidth) || !Number.isFinite(clientHeight)) {return null;}
    if (clientWidth <= 0 || clientHeight <= 0) {return null;}
    return {
      cssWidth: clientWidth,
      cssHeight: clientHeight,
      dpr: Math.max(1, Math.min(2, pixelRatio || 1)),
    };
  }

  get stats(): Readonly<RenderStats> {
    return this._renderer.stats;
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
  }

  start(): void {
    if (this._raf !== null) {return;}
    const frame = (): void => {
      if (this._enabled) {this._render();}
      this._raf = requestAnimationFrame(frame);
    };
    this._raf = requestAnimationFrame(frame);
  }

  pick(x: number, y: number): string | undefined {
    return this._renderer.pick(x, y)?.objectId;
  }

  dispose(): void {
    if (this._raf !== null) {cancelAnimationFrame(this._raf);}
    this._raf = null;
    this._renderer.dispose();
  }

  private _render(): void {
    const scene = this._source.engine.scene;
    if (!scene) {return;}
    const sourceCanvas = this._source.engine.canvas;
    const frame = EditorWebGLPreview.resolveFrame(
      sourceCanvas.clientWidth,
      sourceCanvas.clientHeight,
      this._pixelRatio()
    );
    if (!frame) {return;}
    this._renderer.resize(frame.cssWidth, frame.cssHeight, frame.dpr);
    const snapshot = this._extractor.extract(scene, {
      viewportWidth: frame.cssWidth,
      viewportHeight: frame.cssHeight,
      originX: this._source.engine.originX,
      originY: this._source.engine.originY,
      selectedId: this._state.selectedId,
      showCollision: this._state.activeTool === 'walkable' || this._state.activeTool === 'blocked',
      debugMarkers: this._lightMarkers(),
      clearColor: '#111118',
    });
    this._renderer.render(snapshot);
  }

  private _lightMarkers(): DebugMarker[] {
    return this._state.scene.lights.map(light => ({
      id: light.id,
      x: light.x,
      y: light.y,
      color: light.color,
      kind: light.type,
    }));
  }
}
