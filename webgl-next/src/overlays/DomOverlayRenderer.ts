import type { RenderSnapshot } from '../contracts/RenderSnapshot';
import { renderPointToScreen } from './cameraTransform';

/** Bridges renderer-neutral text records into accessible DOM labels. */
export class DomOverlayRenderer {
  private readonly _elements = new Map<string, HTMLSpanElement>();
  private _frame = 0;

  constructor(private readonly _root: HTMLElement) {}

  render(snapshot: RenderSnapshot): void {
    const frame = ++this._frame;
    for (const label of snapshot.textOverlays) {
      let element = this._elements.get(label.id);
      if (!element) {
        element = document.createElement('span');
        element.className = 'webgl-text-overlay';
        element.dataset.overlayId = label.id;
        // Set in code, not only in the preview's stylesheet: the renderer takes
        // any root element, and a label that accepts pointer events sits over
        // the play area and swallows taps meant for the game.
        element.style.pointerEvents = 'none';
        this._root.append(element);
        this._elements.set(label.id, element);
      }
      const screen = renderPointToScreen(label.x, label.y, snapshot);
      element.dataset.frame = String(frame);
      element.textContent = label.text;
      element.style.color = label.color;
      element.style.opacity = String(label.alpha);
      element.style.fontSize = `${label.fontSize * snapshot.camera.zoom}px`;
      element.style.transform = `translate3d(${screen.x}px, ${screen.y}px, 0) translate(-50%, -50%)`;
    }

    for (const [id, element] of this._elements) {
      if (element.dataset.frame === String(frame)) continue;
      element.remove();
      this._elements.delete(id);
    }
  }

  clear(): void {
    for (const element of this._elements.values()) element.remove();
    this._elements.clear();
  }
}
