/**
 * Sprite Editor — visual tool for configuring 8-direction character animations.
 *
 * Workflow:
 *   1. Upload a sprite sheet image (or enter a URL)
 *   2. Set frame size (w × h), scale, and anchorY
 *   3. Define actions: name, starting row, frame count, fps
 *   4. Preview all 8 directions live on the canvas grid
 *   5. Export the SpriteSheet JSON config
 */
import {SpriteSheet} from '../animation/SpriteSheet';
import {DirectionalAnimator} from '../animation/DirectionalAnimator';
import {Direction} from '../animation/AnimationController';
import {AssetLoader} from '../core/AssetLoader';

// ── DOM refs ──────────────────────────────────────────────────────────────────

const uploadInput = document.getElementById('upload-img') as HTMLInputElement;
const urlInput = document.getElementById('img-url') as HTMLInputElement;
const loadUrlBtn = document.getElementById('btn-load-url') as HTMLButtonElement;
const frameWInput = document.getElementById('frame-w') as HTMLInputElement;
const frameHInput = document.getElementById('frame-h') as HTMLInputElement;
const scaleInput = document.getElementById('sprite-scale') as HTMLInputElement;
const anchorYInput = document.getElementById('anchor-y') as HTMLInputElement;
const actionsList = document.getElementById('actions-list') as HTMLElement;
const addActionBtn = document.getElementById('btn-add-action') as HTMLButtonElement;
const exportBtn = document.getElementById('btn-export-sprite') as HTMLButtonElement;
const copyJsonBtn = document.getElementById('btn-copy-json') as HTMLButtonElement;
const jsonOut = document.getElementById('sprite-json') as HTMLTextAreaElement;
const previewGrid = document.getElementById('preview-grid') as HTMLElement;
const sheetPreview = document.getElementById('sheet-preview') as HTMLCanvasElement;
const sheetCtx = sheetPreview.getContext('2d')!;
const activeActionSel = document.getElementById('active-action') as HTMLSelectElement;
const playBtn = document.getElementById('btn-play') as HTMLButtonElement;
const frameInfo = document.getElementById('frame-info') as HTMLElement;

// ── State ─────────────────────────────────────────────────────────────────────

interface ActionDef {
  id: number;
  name: string;
  rowStart: number;
  frameCount: number;
  fps: number;
  loop: boolean;
}

let imageEl: HTMLImageElement | null = null;
let imageUrl = '';
let frameW = 64, frameH = 64, drawScale = 2, anchorY = 1;
let selectedFrameCol = -1, selectedFrameRow = -1;
let actions: ActionDef[] = [
  {id: 1, name: 'idle', rowStart: 0, frameCount: 4, fps: 6, loop: true},
  {id: 2, name: 'walk', rowStart: 8, frameCount: 8, fps: 12, loop: true},
];
let nextId = 3;

let sheet: SpriteSheet | null = null;
// Map dir → { canvas, ctx, animator }
interface DirCell {canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; anim: DirectionalAnimator}
let dirCells: Map<Direction, DirCell> = new Map();

let activeAction = 'idle';
let lastTs = 0;
let rafId = 0;
let playing = false;

const DIRS: Direction[] = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];
const DIR_LABELS: Record<Direction, string> = {
  N: '↑ N', NE: '↗ NE', E: '→ E', SE: '↘ SE',
  S: '↓ S', SW: '↙ SW', W: '← W', NW: '↖ NW',
};

// ── Image loading ─────────────────────────────────────────────────────────────

uploadInput.addEventListener('change', () => {
  const file = uploadInput.files?.[0];
  if (!file) {return;}
  const reader = new FileReader();
  reader.onload = e => loadImageFromUrl(e.target!.result as string);
  reader.readAsDataURL(file);
});

loadUrlBtn.addEventListener('click', () => {
  const url = urlInput.value.trim();
  if (url) {loadImageFromUrl(url);}
});

urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { const url = urlInput.value.trim(); if (url) {loadImageFromUrl(url);} }
});

function loadImageFromUrl(url: string): void {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    imageEl = img;
    imageUrl = url;
    // Register into AssetLoader cache so sheet.image works without fetch
    AssetLoader.register(url, img);
    drawSheetPreview();
    rebuildSheet();
  };
  img.onerror = () => alert(`Failed to load: ${url.slice(0, 80)}`);
  img.src = url;
}

// ── Sheet preview ─────────────────────────────────────────────────────────────

const PREVIEW_MAX_W = 600, PREVIEW_MAX_H = 400;

function drawSheetPreview(): void {
  if (!imageEl) {
    sheetPreview.width = 400;
    sheetPreview.height = 200;
    sheetCtx.clearRect(0, 0, 400, 200);
    sheetCtx.fillStyle = '#1a1a28';
    sheetCtx.fillRect(0, 0, 400, 200);
    sheetCtx.fillStyle = '#333355';
    sheetCtx.font = '13px monospace';
    sheetCtx.textAlign = 'center';
    sheetCtx.fillText('Upload or paste URL to load a sprite sheet', 200, 105);
    sheetCtx.textAlign = 'left';
    return;
  }

  const scale = Math.min(PREVIEW_MAX_W / imageEl.width, PREVIEW_MAX_H / imageEl.height, 1);
  sheetPreview.width = Math.round(imageEl.width * scale);
  sheetPreview.height = Math.round(imageEl.height * scale);
  sheetCtx.imageSmoothingEnabled = false;
  sheetCtx.clearRect(0, 0, sheetPreview.width, sheetPreview.height);
  sheetCtx.drawImage(imageEl, 0, 0, sheetPreview.width, sheetPreview.height);

  const gw = frameW * scale, gh = frameH * scale;

  // Action row highlights
  actions.forEach((a, i) => {
    const hue = (i * 55 + 200) % 360;
    sheetCtx.fillStyle = `hsla(${hue},75%,60%,0.14)`;
    for (let d = 0; d < 8; d++) {
      const row = a.rowStart + d;
      sheetCtx.fillRect(0, row * gh, Math.min(a.frameCount * gw, sheetPreview.width), gh);
    }
    // Label first row
    sheetCtx.fillStyle = `hsla(${hue},75%,70%,0.85)`;
    sheetCtx.font = '9px monospace';
    sheetCtx.fillText(a.name, 3, a.rowStart * gh + 10);
  });

  // Grid lines
  sheetCtx.strokeStyle = 'rgba(100,160,255,0.25)';
  sheetCtx.lineWidth = 0.5;
  for (let x = 0; x <= sheetPreview.width + 0.5; x += gw) {
    sheetCtx.beginPath(); sheetCtx.moveTo(x, 0); sheetCtx.lineTo(x, sheetPreview.height); sheetCtx.stroke();
  }
  for (let y = 0; y <= sheetPreview.height + 0.5; y += gh) {
    sheetCtx.beginPath(); sheetCtx.moveTo(0, y); sheetCtx.lineTo(sheetPreview.width, y); sheetCtx.stroke();
  }

  // Selected frame highlight
  if (selectedFrameCol >= 0 && selectedFrameRow >= 0) {
    sheetCtx.strokeStyle = 'rgba(255,220,60,0.9)';
    sheetCtx.lineWidth = 1.5;
    sheetCtx.strokeRect(selectedFrameCol * gw + 0.75, selectedFrameRow * gh + 0.75, gw - 1.5, gh - 1.5);
    sheetCtx.fillStyle = 'rgba(255,220,60,0.12)';
    sheetCtx.fillRect(selectedFrameCol * gw, selectedFrameRow * gh, gw, gh);
  }
}

sheetPreview.addEventListener('click', e => {
  if (!imageEl) {return;}
  const rect = sheetPreview.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (sheetPreview.width / rect.width);
  const py = (e.clientY - rect.top) * (sheetPreview.height / rect.height);
  const scale = sheetPreview.width / imageEl.width;
  const gw = frameW * scale, gh = frameH * scale;
  selectedFrameCol = Math.floor(px / gw);
  selectedFrameRow = Math.floor(py / gh);
  drawSheetPreview();
  const srcX = selectedFrameCol * frameW;
  const srcY = selectedFrameRow * frameH;
  // Which action & direction does this row belong to?
  let hint = '';
  for (const a of actions) {
    for (let d = 0; d < 8; d++) {
      if (a.rowStart + d === selectedFrameRow) {
        hint = `  [${a.name} / ${DIRS[d]}]`;
      }
    }
  }
  frameInfo.textContent =
    `col:${selectedFrameCol}  row:${selectedFrameRow}  →  x:${srcX}  y:${srcY}  w:${frameW}  h:${frameH}${hint}`;
});

// ── Config inputs ─────────────────────────────────────────────────────────────

[frameWInput, frameHInput, scaleInput].forEach(el => {
  el.addEventListener('input', () => {
    frameW = Math.max(1, parseInt(frameWInput.value, 10) || 64);
    frameH = Math.max(1, parseInt(frameHInput.value, 10) || 64);
    drawScale = Math.max(0.1, parseFloat(scaleInput.value) || 1);
    drawSheetPreview();
    rebuildSheet();
  });
});

anchorYInput.addEventListener('input', () => {
  anchorY = Math.max(0, Math.min(1, parseFloat(anchorYInput.value) || 1));
  // No need to rebuild sheet; anchorY only affects overlay drawing in tick()
  drawSheetPreview();
});

// ── Actions list ──────────────────────────────────────────────────────────────

function renderActionsList(): void {
  actionsList.innerHTML = '';
  actions.forEach(a => {
    const row = document.createElement('div');
    row.className = 'action-row';
    row.innerHTML = `
      <input class="a-name"  type="text"   value="${escHtml(a.name)}" placeholder="name" />
      <input class="a-row"   type="number" value="${a.rowStart}"   min="0"  placeholder="row" />
      <input class="a-count" type="number" value="${a.frameCount}" min="1"  placeholder="frames" />
      <input class="a-fps"   type="number" value="${a.fps}"        min="1"  placeholder="fps" />
      <label><input class="a-loop" type="checkbox" ${a.loop ? 'checked' : ''} /> loop</label>
      <button class="btn-del-action" data-id="${a.id}" title="Delete action">✕</button>
    `;
    const q = <T extends Element>(cls: string) => row.querySelector<T>(`.${cls}`)!;

    q<HTMLInputElement>('a-name').addEventListener('change', e => {
      a.name = (e.target as HTMLInputElement).value.trim() || a.name;
      syncActiveActionSel();
      rebuildSheet();
    });
    q<HTMLInputElement>('a-row').addEventListener('input', e => {
      a.rowStart = Math.max(0, parseInt((e.target as HTMLInputElement).value, 10) || 0);
      drawSheetPreview();
      rebuildSheet();
    });
    q<HTMLInputElement>('a-count').addEventListener('input', e => {
      a.frameCount = Math.max(1, parseInt((e.target as HTMLInputElement).value, 10) || 1);
      rebuildSheet();
    });
    q<HTMLInputElement>('a-fps').addEventListener('input', e => {
      a.fps = Math.max(1, parseInt((e.target as HTMLInputElement).value, 10) || 12);
      rebuildSheet();
    });
    q<HTMLInputElement>('a-loop').addEventListener('change', e => {
      a.loop = (e.target as HTMLInputElement).checked;
      rebuildSheet();
    });
    q<HTMLButtonElement>('btn-del-action').addEventListener('click', () => {
      actions = actions.filter(x => x.id !== a.id);
      renderActionsList();
      drawSheetPreview();
      rebuildSheet();
    });
    actionsList.appendChild(row);
  });

  syncActiveActionSel();
}

function syncActiveActionSel(): void {
  const prev = activeActionSel.value;
  activeActionSel.innerHTML = actions.map(a =>
    `<option value="${escHtml(a.name)}">${escHtml(a.name)}</option>`
  ).join('');
  if (actions.find(a => a.name === prev)) {
    activeActionSel.value = prev;
    activeAction = prev;
  } else if (actions.length > 0) {
    activeAction = actions[0].name;
    activeActionSel.value = activeAction;
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

addActionBtn.addEventListener('click', () => {
  const n = nextId++;
  actions.push({id: n, name: `action${n}`, rowStart: 0, frameCount: 4, fps: 8, loop: true});
  renderActionsList();
  drawSheetPreview();
  rebuildSheet();
});

activeActionSel.addEventListener('change', () => {
  activeAction = activeActionSel.value;
  dirCells.forEach(({anim}) => anim.setAction(activeAction));
});

// ── Sheet rebuild ─────────────────────────────────────────────────────────────

function rebuildSheet(): void {
  if (!imageEl || actions.length === 0) {return;}

  sheet = DirectionalAnimator.buildSheet(
    imageUrl, frameW, frameH,
    actions.map(a => ({name: a.name, rowStart: a.rowStart, frameCount: a.frameCount, fps: a.fps, loop: a.loop})),
    drawScale,
    anchorY
  );

  // Rebuild preview cells & animators
  buildPreviewGrid();
}

// ── Preview grid ──────────────────────────────────────────────────────────────

// Max preview cell canvas size (px, after scale)
const CELL_MAX = 120;

function buildPreviewGrid(): void {
  previewGrid.innerHTML = '';
  dirCells = new Map();

  if (!sheet) {return;}

  const cw = Math.min(Math.round(frameW * drawScale), CELL_MAX);
  const ch = Math.min(Math.round(frameH * drawScale), CELL_MAX);

  DIRS.forEach(dir => {
    const cell = document.createElement('div');
    cell.className = 'preview-cell';

    const label = document.createElement('div');
    label.className = 'dir-label';
    label.textContent = DIR_LABELS[dir];

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    canvas.style.imageRendering = 'pixelated';

    const ctx = canvas.getContext('2d')!;
    const anim = new DirectionalAnimator(sheet!, {initialAction: activeAction, initialDirection: dir});

    cell.appendChild(label);
    cell.appendChild(canvas);
    previewGrid.appendChild(cell);

    dirCells.set(dir, {canvas, ctx, anim});
  });
}

// ── Animation loop ────────────────────────────────────────────────────────────

function tick(ts: number): void {
  const dt = Math.min((ts - lastTs) / 1000, 0.1);
  lastTs = ts;

  dirCells.forEach(({canvas, ctx, anim}, _dir) => {
    anim.update(dt);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const result = anim.currentFrame();
    if (!result) {return;}
    const {frame, image} = result;

    // Scale to fit cell canvas, preserving aspect
    const scaleX = canvas.width / frame.w;
    const scaleY = canvas.height / frame.h;
    const s = Math.min(scaleX, scaleY);
    const dw = frame.w * s;
    const dh = frame.h * s;
    const dx = (canvas.width - dw) / 2;
    const dy = (canvas.height - dh) / 2;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, dx, dy, dw, dh);

    // Anchor line
    const anchorLineY = dy + dh * anchorY;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,180,40,0.65)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(dx, anchorLineY);
    ctx.lineTo(dx + dw, anchorLineY);
    ctx.stroke();
    ctx.restore();

    // Clip name (bottom label)
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, canvas.height - 13, canvas.width, 13);
    ctx.fillStyle = '#7799dd';
    ctx.font = '8px monospace';
    ctx.fillText(anim.clipName, 3, canvas.height - 3);
  });

  if (playing) {rafId = requestAnimationFrame(tick);}
}

function startPlay(): void {
  if (playing) {return;}
  playing = true;
  lastTs = performance.now();
  playBtn.textContent = '⏸ Pause';
  rafId = requestAnimationFrame(tick);
}

function stopPlay(): void {
  if (!playing) {return;}
  playing = false;
  cancelAnimationFrame(rafId);
  rafId = 0;
  playBtn.textContent = '▶ Play';
}

playBtn.addEventListener('click', () => {
  if (playing) { stopPlay(); } else { startPlay(); }
});

// ── Export ────────────────────────────────────────────────────────────────────

exportBtn.addEventListener('click', () => {
  if (!imageUrl) { alert('Load an image first.'); return; }
  if (actions.length === 0) { alert('Define at least one action.'); return; }
  const config = {
    url: imageUrl.startsWith('data:') ? '(embedded — replace with asset path)' : imageUrl,
    frameW, frameH,
    scale: drawScale,
    anchorY,
    actions: actions.map(a => ({
      name: a.name, rowStart: a.rowStart, frameCount: a.frameCount, fps: a.fps, loop: a.loop,
    })),
  };
  jsonOut.value = JSON.stringify(config, null, 2);
  jsonOut.removeAttribute('readonly');
  jsonOut.select();
});

copyJsonBtn.addEventListener('click', () => {
  if (!jsonOut.value) { alert('Click "Export JSON" first.'); return; }
  navigator.clipboard.writeText(jsonOut.value)
    .then(() => {
      copyJsonBtn.textContent = '✓ Copied!';
      setTimeout(() => { copyJsonBtn.textContent = 'Copy to Clipboard'; }, 1500);
    })
    .catch(() => { jsonOut.select(); document.execCommand('copy'); });
});

// ── Import JSON ───────────────────────────────────────────────────────────────

const importBtn = document.getElementById('btn-import-json') as HTMLButtonElement | null;
importBtn?.addEventListener('click', () => {
  try {
    const cfg = JSON.parse(jsonOut.value);
    if (cfg.frameW) { frameW = cfg.frameW; frameWInput.value = String(frameW); }
    if (cfg.frameH) { frameH = cfg.frameH; frameHInput.value = String(frameH); }
    if (cfg.scale) { drawScale = cfg.scale; scaleInput.value = String(drawScale); }
    if (cfg.anchorY !== undefined) { anchorY = cfg.anchorY; anchorYInput.value = String(anchorY); }
    if (Array.isArray(cfg.actions)) {
      actions = cfg.actions.map((a: Omit<ActionDef, 'id'>) => ({...a, id: nextId++}));
    }
    if (cfg.url && !cfg.url.startsWith('(')) {loadImageFromUrl(cfg.url);}
    renderActionsList();
    drawSheetPreview();
    rebuildSheet();
  } catch { alert('Invalid JSON'); }
});

// ── Init ──────────────────────────────────────────────────────────────────────

renderActionsList();
drawSheetPreview(); // Show placeholder
startPlay();
