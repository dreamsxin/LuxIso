/**
 * LuxIso Scene Editor — main entry point.
 * Wires together EditorState, EditorRenderer, and the HTML UI panels.
 */
import { EditorState, ToolType, EditorWall, EditorLight, EditorCharacter, EditorProp } from './EditorState';
import { EditorRenderer } from './EditorRenderer';
import { EditorWebGLPreview } from '../../webgl-next/src/editor/EditorWebGLPreview';
import { WebGLUnavailableError } from '../../webgl-next/src/renderer/WebGLRenderer';

// ── DOM refs ──────────────────────────────────────────────────────────────────

const canvas   = document.getElementById('editor-canvas') as HTMLCanvasElement;
const webglCanvas = document.getElementById('editor-webgl-canvas') as HTMLCanvasElement;
const canvasStack = document.getElementById('canvas-stack')!;
const rendererButtons = document.querySelectorAll<HTMLButtonElement>('[data-renderer]');

// Size canvas to match the default 10×10 scene
const COLS = 10, ROWS = 10, TILE_W = 64, TILE_H = 32;
canvas.width  = (COLS + ROWS) * (TILE_W / 2);
canvas.height = (COLS + ROWS) * (TILE_H / 2) + 120;

const toolBtns = document.querySelectorAll<HTMLButtonElement>('[data-tool]');
const propPanel    = document.getElementById('prop-panel')!;
const propContent  = document.getElementById('prop-content')!;
const jsonOutput   = document.getElementById('json-output') as HTMLTextAreaElement;
const exportBtn    = document.getElementById('btn-export')!;
const importBtn    = document.getElementById('btn-import')!;
const clearBtn     = document.getElementById('btn-clear')!;
const deleteBtn    = document.getElementById('btn-delete')!;
const undoBtn      = document.getElementById('btn-undo') as HTMLButtonElement;
const redoBtn      = document.getElementById('btn-redo') as HTMLButtonElement;
const sceneNameInput = document.getElementById('scene-name') as HTMLInputElement;
const sceneColsInput = document.getElementById('scene-cols') as HTMLInputElement;
const sceneRowsInput = document.getElementById('scene-rows') as HTMLInputElement;
const objectList   = document.getElementById('object-list')!;
const statusbar    = document.getElementById('statusbar')!;

// ── State & renderer ──────────────────────────────────────────────────────────

const state    = new EditorState();
const renderer = new EditorRenderer(canvas, state);
let webglPreview: EditorWebGLPreview | null = null;
let rendererBackend: 'canvas' | 'webgl' = 'canvas';

try {
  webglPreview = new EditorWebGLPreview(webglCanvas, state, renderer);
} catch (error) {
  const button = document.querySelector<HTMLButtonElement>('[data-renderer="webgl"]');
  if (button) {
    button.disabled = true;
    button.title = error instanceof WebGLUnavailableError ? 'WebGL2 is unavailable' : String(error);
  }
}

rendererButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const requested = button.dataset.renderer as 'canvas' | 'webgl';
    if (requested === 'webgl' && !webglPreview) return;
    rendererBackend = requested;
    canvasStack.dataset.backend = rendererBackend;
    webglPreview?.setEnabled(rendererBackend === 'webgl');
    rendererButtons.forEach((candidate) => candidate.classList.toggle('active', candidate === button));
    refreshStatus();
  });
});

// ── Tool buttons ──────────────────────────────────────────────────────────────

toolBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    state.setTool(btn.dataset.tool as ToolType);
    updateToolUI();
  });
});

function updateToolUI(): void {
  toolBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === state.activeTool);
  });
}
updateToolUI();

// ── Coordinate helper ─────────────────────────────────────────────────────────

function getCanvasPos(e: MouseEvent): { cx: number; cy: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    cx: (e.clientX - rect.left) * (canvas.width  / rect.width),
    cy: (e.clientY - rect.top)  * (canvas.height / rect.height),
  };
}

// ── Hit testing ───────────────────────────────────────────────────────────────

function findObjectAt(wx: number, wy: number): string | undefined {
  const all = state.allObjects();
  // Iterate in reverse so topmost (last-placed) objects are preferred
  for (let i = all.length - 1; i >= 0; i--) {
    const obj = all[i];
    const x = (obj as { x?: number }).x;
    const y = (obj as { y?: number }).y;
    if (x === undefined || y === undefined) continue;
    // ~1.2 world units ≈ 0.6 tile — large enough to click on props/lights
    if (Math.hypot(wx - x, wy - y) < 1.2) return obj.id;
  }
  return undefined;
}

function findObjectAtCanvas(cx: number, cy: number, wx: number, wy: number): string | undefined {
  if (rendererBackend === 'webgl' && webglPreview) {
    const rect = canvas.getBoundingClientRect();
    const screenX = cx * (rect.width / canvas.width);
    const screenY = cy * (rect.height / canvas.height);
    const picked = webglPreview.pick(screenX, screenY);
    return picked && state.getById(picked) ? picked : undefined;
  }
  return findObjectAt(wx, wy);
}

// ── Canvas interaction ────────────────────────────────────────────────────────

/** Current tile being painted (to avoid duplicate paints during drag). */
let _lastPaintCol = -1, _lastPaintRow = -1;
/** Drag tracking state. */
let _isDragging = false;
let _dragStartWorld: { x: number; y: number } | null = null;
let _dragOriginWorld: { x: number; y: number } | null = null;

canvas.addEventListener('mousemove', (e) => {
  const { cx, cy } = getCanvasPos(e);
  const world = renderer.canvasToWorld(cx, cy);
  renderer.hoverWorld = world;

  const s = state.scene;
  const col = Math.floor(world.x);
  const row = Math.floor(world.y);

  // Update status bar with tile coordinates
  if (col >= 0 && col < s.cols && row >= 0 && row < s.rows) {
    updateStatusTile(col, row);
  }

  const tool = state.activeTool;

  // ── Walkable/blocked continuous paint on mousedown+drag ────────────────
  if (e.buttons === 1 && (tool === 'walkable' || tool === 'blocked')) {
    if (col !== _lastPaintCol || row !== _lastPaintRow) {
      _lastPaintCol = col; _lastPaintRow = row;
      state.paintWalkable(col, row, tool === 'walkable');
    }
    return;
  }

  // ── Drag object (select tool, mousedown on object) ─────────────────────
  if (e.buttons === 1 && tool === 'select' && state.dragId) {
    // Offset-corrected drag position
    if (_dragStartWorld) {
      const dx = world.x - _dragStartWorld.x;
      const dy = world.y - _dragStartWorld.y;
      if (_dragOriginWorld) {
        const nx = _dragOriginWorld.x + dx;
        const ny = _dragOriginWorld.y + dy;
        state.dragObject(state.dragId, nx, ny);
      }
    }
    _isDragging = true;
  }
});

canvas.addEventListener('mouseleave', () => {
  renderer.hoverWorld = null;
  _lastPaintCol = -1; _lastPaintRow = -1;
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;           // left-button only for mousedown

  const { cx, cy } = getCanvasPos(e);
  const world = renderer.canvasToWorld(cx, cy);
  const s = state.scene;
  const col = Math.floor(world.x), row = Math.floor(world.y);
  const tool = state.activeTool;

  // ── Walkable/blocked: single-click paint ─────────────────────────────
  if (tool === 'walkable' || tool === 'blocked') {
    if (col >= 0 && col < s.cols && row >= 0 && row < s.rows) {
      _lastPaintCol = col; _lastPaintRow = row;
      state.paintWalkable(col, row, tool === 'walkable');
    }
    return;
  }

  // ── Select: start drag if clicking on object ──────────────────────────
  if (tool === 'select') {
    const hit = findObjectAtCanvas(cx, cy, world.x, world.y);
    if (hit) {
      const obj = state.getById(hit) as { x: number; y: number } | undefined;
      state.dragId = hit;
      state.select(hit);
      updatePropPanel();
      _dragStartWorld  = { ...world };
      _dragOriginWorld = obj ? { x: obj.x, y: obj.y } : { ...world };
    }
  }
});

canvas.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return;
  _lastPaintCol = -1; _lastPaintRow = -1;

  if (state.dragId && _isDragging && _dragOriginWorld && _dragStartWorld) {
    // Commit move (create undo entry)
    const { cx, cy } = getCanvasPos(e);
    const world = renderer.canvasToWorld(cx, cy);
    const dx = world.x - _dragStartWorld.x;
    const dy = world.y - _dragStartWorld.y;
    const nx = _dragOriginWorld.x + dx;
    const ny = _dragOriginWorld.y + dy;
    const snapped = renderer.snapToTile(nx, ny);
    // Restore pre-drag position first so moveObject creates correct undo
    const obj = state.getById(state.dragId) as { x: number; y: number } | undefined;
    if (obj) {
      obj.x = _dragOriginWorld.x;
      obj.y = _dragOriginWorld.y;
    }
    state.moveObject(state.dragId, snapped.x, snapped.y);
    updatePropPanel();
  }
  state.dragId = null;
  _isDragging = false;
  _dragStartWorld = null;
  _dragOriginWorld = null;
});

// ── Right-click = delete object under cursor ──────────────────────────────────

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const { cx, cy } = getCanvasPos(e);
  const world = renderer.canvasToWorld(cx, cy);
  const hit = findObjectAtCanvas(cx, cy, world.x, world.y);
  if (hit) {
    state.removeById(hit);
    updatePropPanel();
  }
});

// ── Click = place object ──────────────────────────────────────────────────────

canvas.addEventListener('click', (e) => {
  // Ignore if this was actually a drag release
  if (_isDragging) { _isDragging = false; return; }

  const { cx, cy } = getCanvasPos(e);
  const world = renderer.canvasToWorld(cx, cy);
  const s = state.scene;

  // Clamp to scene bounds
  if (world.x < 0 || world.x > s.cols || world.y < 0 || world.y > s.rows) return;

  const tool = state.activeTool;

  // walkable/blocked handled in mousedown; wall/light/prop/select below
  if (tool === 'walkable' || tool === 'blocked') return;

  if (tool === 'select') {
    const hit = findObjectAtCanvas(cx, cy, world.x, world.y);
    state.select(hit ?? null);
    updatePropPanel();
    return;
  }

  if (tool === 'wall') {
    const snapped = renderer.snapToGrid(world.x, world.y);
    if (!state.wallStart) {
      state.wallStart = snapped;
    } else {
      const w: EditorWall = {
        id: state.nextId('wall'),
        x: state.wallStart.x, y: state.wallStart.y,
        endX: snapped.x, endY: snapped.y,
        height: 80,
      };
      state.wallStart = null;
      state.addWall(w);
    }
    return;
  }

  if (tool === 'omnilight') {
    const snapped = renderer.snapToTile(world.x, world.y);
    const l: EditorLight = {
      id: state.nextId('omni'),
      type: 'omni',
      x: snapped.x,
      y: snapped.y,
      z: 0,
      color: '#ffd080',
      intensity: 1,
      radius: 320,
    };
    state.addLight(l);
    return;
  }

  if (tool === 'dirlight') {
    const snapped = renderer.snapToTile(world.x, world.y);
    const l: EditorLight = {
      id: state.nextId('dirlight'),
      type: 'directional',
      x: snapped.x,
      y: snapped.y,
      color: '#ffe8b0',
      intensity: 0.9,
      angle: -0.5,
      elevation: 0.6,
    };
    state.addLight(l);
    return;
  }

  if (tool === 'character') {
    const snapped = renderer.snapToTile(world.x, world.y);
    const c: EditorCharacter = {
      id: state.nextId('player'),
      x: snapped.x, y: snapped.y, z: 48,
      radius: 26, color: '#5590cc',
    };
    state.addCharacter(c);
    return;
  }

  const propKinds: Record<string, EditorProp['kind']> = {
    crystal: 'crystal', boulder: 'boulder', chest: 'chest',
    tree: 'tree', flowers: 'flowers', lantern: 'lantern',
  };
  if (tool in propKinds) {
    const snapped = renderer.snapToTile(world.x, world.y);
    const defaultColors: Record<string, string> = {
      crystal: '#8060e0', boulder: '#7a7a8a', chest: '#a05c18',
      tree: '#4f9d68', flowers: '#f47ca5', lantern: '#ffd166',
    };
    const p: EditorProp = {
      id: state.nextId(tool),
      kind: propKinds[tool],
      x: snapped.x, y: snapped.y,
      color: defaultColors[tool],
    };
    if (p.kind === 'crystal') p.heightPx = 48;
    if (p.kind === 'boulder') p.radius = 18;
    if (p.kind === 'tree') Object.assign(p, { trunkColor: '#80583f', heightPx: 72, scale: 1 });
    if (p.kind === 'flowers') Object.assign(p, { accentColor: '#fff0a6', count: 7, seed: 1 });
    if (p.kind === 'lantern') Object.assign(p, { postColor: '#40504b', heightPx: 50 });
    state.addProp(p);
    return;
  }
});

// ── Property panel ────────────────────────────────────────────────────────────

function updatePropPanel(): void {
  const id = state.selectedId;
  if (!id) {
    propPanel.classList.add('hidden');
    return;
  }
  const obj = state.getById(id);
  if (!obj) { propPanel.classList.add('hidden'); return; }

  propPanel.classList.remove('hidden');
  propContent.innerHTML = buildPropForm(obj);

  propContent.querySelectorAll<HTMLInputElement>('[data-field]').forEach(input => {
    input.addEventListener('input', () => {
      const field = input.dataset.field!;
      const val   = input.type === 'number' ? parseFloat(input.value) : input.value;
      state.updateObject(id, { [field]: val } as never);
    });
  });
}

/**
 * Escape a value for interpolation into an HTML template.
 *
 * Object ids, colors and other fields come straight from imported scene JSON,
 * so they are untrusted: without escaping, an id like
 * `x" onfocus=alert(1) autofocus data-z="` breaks out of the attribute and
 * executes script in the editor's origin.
 */
function escHtml(v: unknown): string {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildPropForm(obj: ReturnType<EditorState['getById']>): string {
  if (!obj) return '';
  // Show kind as a read-only badge
  const kindBadge = 'kind' in obj
    ? `<div class="obj-kind-badge">${escHtml((obj as { kind: string }).kind)}</div>`
    : '';

  const fields = Object.entries(obj)
    .filter(([k]) => k !== 'id' && k !== 'kind' && k !== 'type')
    .map(([k, v]) => {
      const isNum   = typeof v === 'number';
      const isColor = typeof v === 'string' && v.startsWith('#');
      const inputType = isColor ? 'color' : isNum ? 'number' : 'text';
      const step = isNum && !Number.isInteger(v) ? '0.01' : '1';
      return `
        <div class="field-row">
          <label>${escHtml(k)}</label>
          <input type="${inputType}" data-field="${escHtml(k)}" value="${escHtml(v)}"
            ${isNum ? `step="${step}"` : ''} />
        </div>`;
    }).join('');

  return `<div class="obj-id">${escHtml(obj.id)}</div>${kindBadge}${fields}`;
}

state.onChange(() => {
  if (state.selectedId) updatePropPanel();
  else propPanel.classList.add('hidden');
  updateObjectList();
});

// ── Object list panel ─────────────────────────────────────────────────────────

function updateObjectList(): void {
  const objs = state.allObjects();
  if (objs.length === 0) {
    objectList.innerHTML = '<div class="obj-list-empty">No objects</div>';
    return;
  }
  const kindLabel = (o: ReturnType<EditorState['getById']>): string => {
    if (!o) return '';
    if ('kind' in o) return (o as { kind: string }).kind;
    if ('type' in o) return (o as { type: string }).type;
    if ('radius' in o && 'color' in o) return 'char';
    if ('endX' in o) return 'wall';
    if ('angle' in o || 'elevation' in o) return 'dirlight';
    if ('radius' in o) return 'omni';
    return '?';
  };
  objectList.innerHTML = objs.map(o => `
    <div class="obj-list-item${o.id === state.selectedId ? ' active' : ''}" data-id="${escHtml(o.id)}">
      <span class="obj-kind">${escHtml(kindLabel(o))}</span>
      <span class="obj-name">${escHtml(o.id)}</span>
    </div>`).join('');
  objectList.querySelectorAll<HTMLElement>('[data-id]').forEach(el => {
    el.addEventListener('click', () => {
      state.select(el.dataset.id!);
      updatePropPanel();
    });
  });
}
updateObjectList();

// ── Toolbar actions ───────────────────────────────────────────────────────────

deleteBtn.addEventListener('click', () => {
  if (state.selectedId) {
    state.removeById(state.selectedId);
    updatePropPanel();
  }
});

exportBtn.addEventListener('click', () => {
  jsonOutput.value = state.toJSON();
  jsonOutput.select();
  navigator.clipboard?.writeText(jsonOutput.value).catch(() => {});
});

importBtn.addEventListener('click', () => {
  const json = jsonOutput.value.trim();
  if (json) state.loadJSON(json);
});

clearBtn.addEventListener('click', () => {
  if (confirm('Clear scene?')) {
    Object.assign(state.scene, EditorState.defaultScene());
    state.selectedId = null;
    state.emit();
    updatePropPanel();
  }
});

sceneNameInput.addEventListener('input', () => {
  state.scene.name = sceneNameInput.value;
});
sceneNameInput.value = state.scene.name;

// ── Scene size ────────────────────────────────────────────────────────────────

function applySceneSize(): void {
  const cols = Math.max(2, Math.min(32, parseInt(sceneColsInput.value) || 10));
  const rows = Math.max(2, Math.min(32, parseInt(sceneRowsInput.value) || 10));
  sceneColsInput.value = String(cols);
  sceneRowsInput.value = String(rows);
  state.setSceneSize(cols, rows);
  const s = state.scene;
  canvas.width  = (s.cols + s.rows) * (s.tileW / 2);
  canvas.height = (s.cols + s.rows) * (s.tileH / 2) + 120;
}
sceneColsInput.addEventListener('change', applySceneSize);
sceneRowsInput.addEventListener('change', applySceneSize);

// ── Undo / Redo ───────────────────────────────────────────────────────────────

function updateUndoRedo(): void {
  undoBtn.disabled = !state.canUndo;
  redoBtn.disabled = !state.canRedo;
  undoBtn.title = state.canUndo ? `Undo: ${state.undoDescription} (Ctrl+Z)` : 'Nothing to undo';
  redoBtn.title = state.canRedo ? `Redo: ${state.redoDescription} (Ctrl+Y)` : 'Nothing to redo';
}
undoBtn.addEventListener('click', () => { state.undo(); updateUndoRedo(); });
redoBtn.addEventListener('click', () => { state.redo(); updateUndoRedo(); });
updateUndoRedo();
state.onChange(updateUndoRedo);

// ── Start rendering ───────────────────────────────────────────────────────────

renderer.start();
webglPreview?.start();
window.addEventListener('beforeunload', () => webglPreview?.dispose());

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

const keyMap: Record<string, ToolType> = {
  v: 'select', w: 'wall', l: 'omnilight', d: 'dirlight',
  c: 'character', '1': 'crystal', '2': 'boulder', '3': 'chest',
  '4': 'tree', '5': 'flowers', '6': 'lantern',
  b: 'blocked', p: 'walkable',
};
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); state.undo(); updateUndoRedo(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Z')) { e.preventDefault(); state.redo(); updateUndoRedo(); return; }
  const tool = keyMap[e.key.toLowerCase()];
  if (tool) { state.setTool(tool); updateToolUI(); }
  if (e.key === 'Escape') { state.wallStart = null; state.select(null); updatePropPanel(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedId) {
    state.removeById(state.selectedId);
    updatePropPanel();
  }
});

// ── Status bar ────────────────────────────────────────────────────────────────

const toolHints: Record<string, string> = {
  select:    '[V] Click to select. Right-click to delete. Drag to move.',
  wall:      '[W] Click start point, then end point to place a wall.',
  omnilight: '[L] Click to place an Omni Light.',
  dirlight:  '[D] Click to place a Directional Light.',
  character: '[C] Click to place a Character.',
  crystal:   '[1] Click to place a Crystal prop.',
  boulder:   '[2] Click to place a Boulder prop.',
  chest:     '[3] Click to place a Chest prop.',
  tree:      '[4] Click to place a Tree prop.',
  flowers:   '[5] Click to place a Flower Patch prop.',
  lantern:   '[6] Click to place a Lantern prop.',
  blocked:   '[B] Click or drag tiles to mark as blocked.',
  walkable:  '[P] Click or drag tiles to mark as walkable.',
};

let _statusTileText = '';

function updateStatusTile(col: number, row: number): void {
  _statusTileText = `  |  tile (${col}, ${row})`;
  refreshStatus();
}

function refreshStatus(): void {
  const backend = rendererBackend === 'webgl'
    ? `  |  WebGL ${webglPreview?.stats.drawCalls ?? 0} draws`
    : '  |  Canvas 2D';
  statusbar.textContent = (toolHints[state.activeTool] ?? '') + _statusTileText + backend;
}

state.onChange(() => {
  _statusTileText = '';
  refreshStatus();
});
