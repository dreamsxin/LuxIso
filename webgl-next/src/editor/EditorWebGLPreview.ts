import type {EditorRenderer} from '../../../src/editor/EditorRenderer';
import type {EditorState} from '../../../src/editor/EditorState';
import type {RenderStats} from '../contracts/RenderBackend';
import type {DebugMarker} from '../extraction/SceneExtractor';
import {SceneExtractor} from '../extraction/SceneExtractor';
import {WebGLRenderer} from '../renderer/WebGLRenderer';

/** Experimental adapter that renders the editor's rebuilt Scene with WebGL2. */
export class EditorWebGLPreview {
  private readonly _renderer: WebGLRenderer;
  private readonly _extractor = new SceneExtractor();
  private _raf: number | null = null;
  private _enabled = false;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly _state: EditorState,
    private readonly _source: EditorRenderer
  ) {
    this._renderer = new WebGLRenderer(canvas);
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
    const width = sourceCanvas.width;
    const height = sourceCanvas.height;
    this._renderer.resize(width, height, 1);
    const snapshot = this._extractor.extract(scene, {
      viewportWidth: width,
      viewportHeight: height,
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
