import { Scene } from '../src/core/Scene';
import { AssetLoader } from '../src/core/AssetLoader';
import { ParticleBlend, ParticleSystem } from '../src/animation/ParticleSystem';
import { SpriteSheet } from '../src/animation/SpriteSheet';
import { Character } from '../src/elements/Character';
import { Floor } from '../src/elements/Floor';
import { Wall } from '../src/elements/Wall';
import { Boulder } from '../src/elements/props/Boulder';
import { Chest } from '../src/elements/props/Chest';
import { Cloud } from '../src/elements/props/Cloud';
import { Crystal } from '../src/elements/props/Crystal';
import { Tree } from '../src/elements/props/Tree';
import { FlowerPatch } from '../src/elements/props/FlowerPatch';
import { Lantern } from '../src/elements/props/Lantern';
import { FloatingText } from '../src/elements/props/FloatingText';
import { DirectionalLight } from '../src/lighting/DirectionalLight';
import { OmniLight } from '../src/lighting/OmniLight';
import { TileCollider } from '../src/physics/TileCollider';
import { MovementComponent } from '../src/ecs/components/MovementComponent';
import { SceneExtractor } from './src/extraction/SceneExtractor';
import { DomOverlayRenderer } from './src/overlays/DomOverlayRenderer';
import { MinimapRenderer } from './src/overlays/MinimapRenderer';
import { WebGLRenderer, WebGLUnavailableError } from './src/renderer/WebGLRenderer';
import {
  applyPreviewLightingFixture,
  getPreviewLightingFixture,
  PREVIEW_LIGHTING_FIXTURES,
} from './src/testing/PreviewLightingFixtures';

type ViewMode = 'webgl' | 'compare' | 'canvas';

const viewport = required<HTMLElement>('viewport');
const webglCanvas = required<HTMLCanvasElement>('webgl-canvas');
const referenceCanvas = required<HTMLCanvasElement>('canvas-reference');
const referenceContext = getCanvasContext(referenceCanvas);

const scene = await createScene();
const fixtureSelect = required<HTMLSelectElement>('fixture');
populateFixtureSelect(fixtureSelect);
const requestedFixtureId = new URL(window.location.href).searchParams.get('fixture');
const initialFixture = getPreviewLightingFixture(requestedFixtureId);
let activeFixtureId = initialFixture?.id ?? '';
if (initialFixture) applyPreviewLightingFixture(scene, initialFixture);
else if (requestedFixtureId) updateFixtureUrl(null);
fixtureSelect.value = activeFixtureId;
required<HTMLInputElement>('orbit').checked = !activeFixtureId;
const orbitLight = scene.getLightById('work-light') as OmniLight;
const runner = requirePreviewRunner(scene);
const runnerMovement = requireRunnerMovement(runner);
const extractor = new SceneExtractor();
const domOverlays = new DomOverlayRenderer(required('dom-overlays'));
const minimap = new MinimapRenderer(required<HTMLCanvasElement>('minimap'));
let renderer: WebGLRenderer | null = null;
let mode: ViewMode = 'webgl';
let selectedId = '';
let moveTarget: { x: number; y: number } | null = null;
let movementWasActive = false;
let lastFrame = performance.now();
let fixedAccumulator = 0;
let fpsWindowStart = lastFrame;
let fpsFrames = 0;
let currentFps = 0;

try {
  renderer = new WebGLRenderer(webglCanvas);
  bindRendererLifecycleStatus(renderer);
  const capabilities = renderer.capabilities;
  required('backend-status').textContent = `就绪 · ${capabilities.renderer}`;
} catch (error) {
  mode = 'canvas';
  viewport.dataset.mode = mode;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode="webgl"], [data-mode="compare"]')) {
    button.disabled = true;
    button.classList.remove('active');
  }
  document.querySelector<HTMLButtonElement>('[data-mode="canvas"]')?.classList.add('active');
  required('backend-status').textContent = error instanceof WebGLUnavailableError
    ? 'WebGL 2 不可用 · Canvas fallback'
    : `初始化失败 · ${error instanceof Error ? error.message : String(error)}`;
}

if (initialFixture) required('selection').textContent = `校验夹具 · ${initialFixture.label}`;

/**
 * Test hook for the Playwright lifecycle suite.
 *
 * That suite constructs and disposes renderers of its own to assert
 * GLResourceRegistry releases every handle. It used to reach the class by
 * dynamically importing `/webgl-next/src/renderer/WebGLRenderer.ts`, which only
 * resolves through Vite's dev module graph — and that single line was the reason
 * the whole browser suite had to run against the dev server rather than the
 * production bundle. Re-exporting the already-imported class here lets the suite
 * run against `vite preview`, i.e. against the artifact we actually ship.
 *
 * This file is the preview entry point; it is not part of the published library
 * (`files: ["dist"]`, and the lib build bundles only `src/index.ts`).
 */
declare global {
  interface Window {
    __luxisoPreview?: { WebGLRenderer: typeof WebGLRenderer };
  }
}
window.__luxisoPreview = { WebGLRenderer };


syncControls();
bindControls();
bindViewportInput();
new ResizeObserver(resizeSurfaces).observe(viewport);
resizeSurfaces();
requestAnimationFrame(frame);

async function createScene(): Promise<Scene> {
  const next = new Scene({ name: 'Lantern Garden', tileW: 64, tileH: 32, cols: 12, rows: 10 });
  next.ambientColor = '#dcebe4';
  next.ambientIntensity = 0.44;
  next.camera.x = 6;
  next.camera.y = 4.8;

  next.addObject(new Floor({
    id: 'floor', cols: 12, rows: 10, color: '#3f7358', altColor: '#477d60',
  }));
  next.addObject(new Wall({
    id: 'north-wall', x: 1, y: 1, endX: 10.7, endY: 1, height: 50, color: '#819084',
    openings: [{ type: 'window', offsetX: 0.34, width: 0.14, height: 0.3, offsetY: 0.45 }],
  }));
  next.addObject(new Wall({
    id: 'west-wall', x: 1, y: 1, endX: 1, endY: 8.7, height: 50, color: '#89998b',
    openings: [{ type: 'door', offsetX: 0.6, width: 0.18, height: 0.78 }],
  }));
  next.addObject(new Wall({
    id: 'garden-wall', x: 8.2, y: 5.9, endX: 8.2, endY: 8.4, height: 30, color: '#718376',
  }));

  const runner = new Character({ id: 'runner', x: 5.0, y: 5.35, radius: 20, color: '#d96355' });
  runner.setSpriteSheet(await createPreviewSpriteSheet());
  next.addObject(runner);
  next.addObject(new Crystal('violet-crystal', 3.05, 3.25, '#896ee8', 58));
  next.addObject(new Crystal('cyan-crystal', 8.75, 6.85, '#45c8bd', 46));
  next.addObject(new Boulder('mossy-boulder', 6.1, 7.55, '#687b70', 19));
  next.addObject(new Chest('garden-chest', 6.15, 3.25, '#b46f2d'));

  for (const tree of [
    { id: 'tree-nw', x: 2.0, y: 1.9, canopyColor: '#4f9d68', scale: 1.05 },
    { id: 'tree-ne', x: 9.8, y: 1.9, canopyColor: '#5aa873', scale: 0.92 },
    { id: 'tree-sw', x: 2.0, y: 8.0, canopyColor: '#438d61', scale: 1.12 },
    { id: 'tree-east', x: 10.2, y: 7.7, canopyColor: '#58a16d', scale: 1.02 },
  ]) next.addObject(new Tree({ ...tree, trunkColor: '#815b43', heightPx: 72 }));

  for (const flowers of [
    { id: 'flowers-pink', x: 3.65, y: 6.7, color: '#f47ca5', accentColor: '#fff0a6', seed: 1.2 },
    { id: 'flowers-blue', x: 5.15, y: 2.45, color: '#7fb7ff', accentColor: '#f8f0b4', seed: 2.7 },
    { id: 'flowers-coral', x: 8.55, y: 4.25, color: '#ff9178', accentColor: '#ffe58a', seed: 4.1 },
    { id: 'flowers-lilac', x: 4.15, y: 4.2, color: '#c59bff', accentColor: '#fff0a6', seed: 5.8 },
  ]) next.addObject(new FlowerPatch({ ...flowers, count: 8 }));

  next.addObject(new Lantern({ id: 'lantern-west', x: 4.75, y: 3.25, glowColor: '#ffd166', postColor: '#40504b', heightPx: 52 }));
  next.addObject(new Lantern({ id: 'lantern-east', x: 7.5, y: 3.25, glowColor: '#ffcf73', postColor: '#40504b', heightPx: 52 }));
  next.addObject(new Cloud({ id: 'cloud-a', x: 2.2, y: 6.7, altitude: 5.2, speed: 0.22, angle: -0.18, scale: 0.8, seed: 0.42 }));

  const sparks = new ParticleSystem('crystal-sparkles', 3.05, 3.25, 18);
  sparks.addEmitter({
    rate: 13,
    maxParticles: 46,
    life: [0.8, 1.6],
    speed: [0.25, 0.8],
    vz: [8, 18],
    size: [1.1, 2.3],
    sizeFinal: 0.2,
    color: ['#e4d6ff', '#9edfff'],
    colorEnd: '#9d7ee8',
    alphaStart: 0.82,
    alphaEnd: 0,
    gravity: 8,
    blend: ParticleBlend.ADD,
  });
  next.addObject(sparks);

  const dust = new ParticleSystem('garden-pollen', 5.5, 5.0, 30);
  dust.addEmitter({
    rate: 7,
    maxParticles: 24,
    spawnRadius: 5,
    life: [2, 4],
    speed: [0.08, 0.25],
    vz: [0.3, 1.2],
    size: [0.8, 1.6],
    color: ['#d8edc8', '#fff0b5'],
    alphaStart: 0.28,
    alphaEnd: 0,
    blend: ParticleBlend.ALPHA,
  });
  next.addObject(dust);
  next.addObject(new FloatingText({
    id: 'garden-label', x: 6.15, y: 3.25, z: 74, text: 'LANTERN GARDEN', color: '#fff0b0', duration: 1_000_000, speed: 0, fontSize: 12,
  }));

  next.collider = new TileCollider(12, 10);
  for (const [col, row] of [[1, 1], [9, 1], [1, 7], [10, 7], [8, 6], [6, 7]] as const) {
    next.collider.setWalkable(col, row, false);
  }
  runner.addComponent(new MovementComponent({ speed: 2.4, radius: 0.24, collider: next.collider }));

  next.addLight(new DirectionalLight({ id: 'sun', angle: 220, elevation: 48, color: '#f0f6e8', intensity: 0.5 }));
  next.addLight(new OmniLight({
    id: 'work-light', x: 6, y: 5, z: 96, radius: 300, color: '#b7d8ff', intensity: 0.8, falloff: 'quadratic',
  }));
  next.addLight(new OmniLight({
    id: 'lantern-west-light', x: 4.75, y: 3.25, z: 52, radius: 170, color: '#ffd166', intensity: 0.78, falloff: 'quadratic',
  }));
  next.addLight(new OmniLight({
    id: 'lantern-east-light', x: 7.5, y: 3.25, z: 52, radius: 170, color: '#ffcf73', intensity: 0.78, falloff: 'quadratic',
  }));
  next.addLight(new OmniLight({
    id: 'sky-fill', x: 0, y: 0, z: 0, color: '#7fa8a0', intensity: 0.17, isGlobal: true,
  }));
  return next;
}

function bindControls(): void {
  fixtureSelect.addEventListener('change', () => {
    navigateToFixture(fixtureSelect.value || null);
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>('.mode')) {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      mode = button.dataset.mode as ViewMode;
      viewport.dataset.mode = mode;
      for (const candidate of document.querySelectorAll('.mode')) candidate.classList.toggle('active', candidate === button);
      resizeSurfaces();
    });
  }

  bindRange('rotation', 'rotation-value', (value) => {
    scene.view.rotation = value;
    return `${Math.round(value)}°`;
  });
  bindRange('elevation', 'elevation-value', (value) => {
    scene.view.elevation = value;
    return value.toFixed(2);
  });
  bindRange('zoom', 'zoom-value', (value) => {
    scene.camera.setZoom(value);
    return value.toFixed(2);
  });
  bindRange('ambient', 'ambient-value', (value) => {
    scene.ambientIntensity = value;
    return value.toFixed(2);
  });
  bindRange('light-intensity', 'light-value', (value) => {
    orbitLight.intensity = value;
    return value.toFixed(2);
  });
  required<HTMLInputElement>('orbit').addEventListener('change', (event) => {
    if ((event.currentTarget as HTMLInputElement).checked) clearActiveFixture();
  });
}

function bindRendererLifecycleStatus(currentRenderer: WebGLRenderer): void {
  const status = required('backend-status');
  webglCanvas.addEventListener('webglcontextlost', () => {
    status.textContent = '上下文丢失 · 等待恢复';
  });
  webglCanvas.addEventListener('webglcontextrestored', () => {
    status.textContent = `已恢复 · ${currentRenderer.capabilities.renderer}`;
  });
}

function syncControls(): void {
  syncRange('rotation', 'rotation-value', scene.view.rotation, `${Math.round(scene.view.rotation)}°`);
  syncRange('elevation', 'elevation-value', scene.view.elevation, scene.view.elevation.toFixed(2));
  syncRange('zoom', 'zoom-value', scene.camera.zoom, scene.camera.zoom.toFixed(2));
  syncRange('ambient', 'ambient-value', scene.ambientIntensity, scene.ambientIntensity.toFixed(2));
  syncRange('light-intensity', 'light-value', orbitLight.intensity, orbitLight.intensity.toFixed(2));
}

function syncRange(inputId: string, outputId: string, value: number, label: string): void {
  required<HTMLInputElement>(inputId).value = String(value);
  required<HTMLOutputElement>(outputId).value = label;
}

function bindViewportInput(): void {
  let pointerStart: { x: number; y: number; cameraX: number; cameraY: number } | null = null;

  webglCanvas.addEventListener('pointerdown', (event) => {
    webglCanvas.setPointerCapture(event.pointerId);
    pointerStart = { x: event.clientX, y: event.clientY, cameraX: scene.camera.x, cameraY: scene.camera.y };
  });
  webglCanvas.addEventListener('pointermove', (event) => {
    if (!pointerStart || !(event.buttons & 1)) return;
    clearActiveFixture();
    const dx = (event.clientX - pointerStart.x) / (scene.tileW * scene.camera.zoom);
    const dy = (event.clientY - pointerStart.y) / (scene.tileH * scene.camera.zoom);
    scene.camera.x = pointerStart.cameraX - dx - dy;
    scene.camera.y = pointerStart.cameraY + dx - dy;
  });
  webglCanvas.addEventListener('pointerup', (event) => {
    if (!pointerStart) return;
    const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
    pointerStart = null;
    if (webglCanvas.hasPointerCapture(event.pointerId)) webglCanvas.releasePointerCapture(event.pointerId);
    if (moved > 5 || !renderer) return;
    const rect = webglCanvas.getBoundingClientRect();
    const result = renderer.pick(event.clientX - rect.left, event.clientY - rect.top);
    if (result && result.objectId !== 'floor') {
      selectedId = result.objectId;
      required('selection').textContent = `已选择 · ${selectedId}`;
      const chest = scene.getById(selectedId);
      if (chest instanceof Chest) chest.toggle();
    } else {
      requestRunnerMove(event.clientX - rect.left, event.clientY - rect.top, rect);
    }
  });
  webglCanvas.addEventListener('pointercancel', (event) => {
    pointerStart = null;
    if (webglCanvas.hasPointerCapture(event.pointerId)) webglCanvas.releasePointerCapture(event.pointerId);
  });
  webglCanvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    clearActiveFixture();
    scene.camera.setZoom(scene.camera.zoom * (event.deltaY > 0 ? 0.92 : 1.08));
    const zoom = required<HTMLInputElement>('zoom');
    zoom.value = String(scene.camera.zoom);
    required<HTMLOutputElement>('zoom-value').value = scene.camera.zoom.toFixed(2);
  }, { passive: false });
}

function requestRunnerMove(screenX: number, screenY: number, rect: DOMRect): void {
  clearActiveFixture();
  const world = scene.camera.screenToWorld(
    screenX,
    screenY,
    rect.width,
    rect.height,
    scene.tileW,
    scene.tileH,
    rect.width / 2,
    sceneOriginY(rect.height),
    scene.view,
  );
  const target = {
    x: Math.max(0.5, Math.min(scene.cols - 0.5, Math.floor(world.x) + 0.5)),
    y: Math.max(0.5, Math.min(scene.rows - 0.5, Math.floor(world.y) + 0.5)),
  };
  selectedId = '';
  if (runnerMovement.pathTo(target.x, target.y)) {
    moveTarget = target;
    movementWasActive = runnerMovement.isMoving;
    required('selection').textContent = `移动至 · ${target.x.toFixed(1)}, ${target.y.toFixed(1)}`;
  } else {
    moveTarget = null;
    movementWasActive = false;
    required('selection').textContent = `路径不可达 · ${target.x.toFixed(1)}, ${target.y.toFixed(1)}`;
  }
}

function resizeSurfaces(): void {
  if (renderer && mode !== 'canvas') {
    const rect = webglCanvas.parentElement!.getBoundingClientRect();
    renderer.resize(rect.width, rect.height);
  }
  if (mode !== 'webgl') resizeReferenceCanvas();
}

function resizeReferenceCanvas(): void {
  const rect = referenceCanvas.parentElement!.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (referenceCanvas.width !== width || referenceCanvas.height !== height) {
    referenceCanvas.width = width;
    referenceCanvas.height = height;
  }
  referenceCanvas.style.width = `${rect.width}px`;
  referenceCanvas.style.height = `${rect.height}px`;
}

function frame(now: number): void {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  fpsFrames++;
  if (now - fpsWindowStart >= 500) {
    currentFps = fpsFrames * 1000 / (now - fpsWindowStart);
    fpsFrames = 0;
    fpsWindowStart = now;
  }

  if (!activeFixtureId) {
    if (required<HTMLInputElement>('orbit').checked) {
      const angle = now * 0.00038;
      orbitLight.position.x = 6 + Math.cos(angle) * 3.4;
      orbitLight.position.y = 5 + Math.sin(angle) * 2.6;
    }
    fixedAccumulator += dt;
    while (fixedAccumulator >= 1 / 60) {
      scene.fixedUpdate(1 / 60);
      fixedAccumulator -= 1 / 60;
    }
    scene.update(now);
  } else {
    fixedAccumulator = 0;
  }
  const moving = runnerMovement.isMoving;
  if (movementWasActive && !moving && moveTarget) {
    const distance = Math.hypot(runner.position.x - moveTarget.x, runner.position.y - moveTarget.y);
    required('selection').textContent = distance < 0.15
      ? `已到达 · ${moveTarget.x.toFixed(1)}, ${moveTarget.y.toFixed(1)}`
      : '移动已停止';
    moveTarget = null;
  }
  movementWasActive = moving;

  if (renderer && mode !== 'canvas') {
    const rect = webglCanvas.getBoundingClientRect();
    const snapshot = extractor.extract(scene, {
      viewportWidth: rect.width,
      viewportHeight: rect.height,
      originX: rect.width / 2,
      originY: sceneOriginY(rect.height),
      clearColor: '#111a18',
      selectedId,
      showCollision: required<HTMLInputElement>('collision-overlay').checked,
      debugMarkers: moveTarget ? [{ id: 'move-target', ...moveTarget, kind: 'target', color: '#8fe8b5' }] : undefined,
    });
    renderer.render(snapshot);
    domOverlays.render(snapshot);
    minimap.render(snapshot);
  }
  if (mode !== 'webgl') renderCanvasReference();
  if (mode === 'canvas') domOverlays.clear();
  updateMetrics(dt);
  requestAnimationFrame(frame);
}

function renderCanvasReference(): void {
  const rect = referenceCanvas.getBoundingClientRect();
  const dpr = referenceCanvas.width / Math.max(1, rect.width);
  referenceContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  referenceContext.fillStyle = '#111a18';
  referenceContext.fillRect(0, 0, rect.width, rect.height);
  scene.draw(referenceContext, rect.width, rect.height, rect.width / 2, sceneOriginY(rect.height));
  if (moveTarget) drawCanvasMoveTarget(referenceContext, rect, moveTarget);
}

function drawCanvasMoveTarget(
  context: CanvasRenderingContext2D,
  rect: DOMRect,
  target: { x: number; y: number },
): void {
  const screen = scene.camera.worldToScreen(
    target.x, target.y, 0, scene.tileW, scene.tileH, rect.width / 2, sceneOriginY(rect.height), scene.view,
  );
  context.save();
  context.beginPath();
  context.ellipse(screen.sx, screen.sy, 11, 5, 0, 0, Math.PI * 2);
  context.fillStyle = 'rgba(143,232,181,0.28)';
  context.fill();
  context.beginPath();
  context.moveTo(screen.sx, screen.sy - 5);
  context.lineTo(screen.sx + 9, screen.sy);
  context.lineTo(screen.sx, screen.sy + 5);
  context.lineTo(screen.sx - 9, screen.sy);
  context.closePath();
  context.strokeStyle = '#8fe8b5';
  context.lineWidth = 1.5;
  context.stroke();
  context.restore();
}

function updateMetrics(_dt: number): void {
  required('fps').textContent = currentFps.toFixed(0);
  if (!renderer || mode === 'canvas') return;
  const stats = renderer.stats;
  required('cpu').textContent = `${stats.cpuMs.toFixed(2)} ms`;
  required('draw-calls').textContent = String(stats.drawCalls);
  required('triangles').textContent = Math.round(stats.triangles).toLocaleString();
  required('buffer').textContent = `${(stats.bufferBytes / 1024).toFixed(1)} KB`;
  required('lights').textContent = String(stats.omniLights);
  required('segments').textContent = String(stats.segments);
  required('textures').textContent = String(stats.textures);
  const shadowCache = extractor.shadowCacheStats;
  required('shadow-cache').textContent = `${shadowCache.hits} hit / ${shadowCache.misses} miss`;
  required('shadow-mask-cache').textContent = `${stats.shadowMaskCacheHits} hit / ${stats.shadowMaskCacheMisses} miss`;
  required('text-overlays').textContent = String(stats.textOverlays);
  required('fallbacks').textContent = String(stats.unsupportedObjects);
}

function bindRange(
  inputId: string,
  outputId: string,
  apply: (value: number) => string,
): void {
  const input = required<HTMLInputElement>(inputId);
  const output = required<HTMLOutputElement>(outputId);
  input.addEventListener('input', () => {
    clearActiveFixture();
    output.value = apply(Number(input.value));
  });
}

function populateFixtureSelect(select: HTMLSelectElement): void {
  select.replaceChildren(new Option('交互默认', ''));
  for (const fixture of PREVIEW_LIGHTING_FIXTURES) {
    select.add(new Option(fixture.label, fixture.id));
  }
}

function navigateToFixture(id: string | null): void {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('fixture', id);
  else url.searchParams.delete('fixture');
  window.location.replace(url.toString());
}

function updateFixtureUrl(id: string | null): void {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('fixture', id);
  else url.searchParams.delete('fixture');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function clearActiveFixture(): void {
  if (!activeFixtureId) return;
  activeFixtureId = '';
  fixtureSelect.value = '';
  updateFixtureUrl(null);
}

function required<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}.`);
  return element as T;
}

function requirePreviewRunner(currentScene: Scene): Character {
  const object = currentScene.getById('runner');
  if (!(object instanceof Character)) throw new Error('Preview runner is missing.');
  return object;
}

function requireRunnerMovement(character: Character): MovementComponent {
  const movement = character.getComponent(MovementComponent);
  if (!movement) throw new Error('Preview runner movement is missing.');
  return movement;
}

function getCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable.');
  return context;
}

async function createPreviewSpriteSheet(): Promise<SpriteSheet> {
  const atlas = document.createElement('canvas');
  atlas.width = 128;
  atlas.height = 40;
  const context = getCanvasContext(atlas);
  for (let frame = 0; frame < 4; frame++) {
    const x = frame * 32;
    const bob = frame % 2;
    context.fillStyle = '#17212a';
    context.fillRect(x + 9, 29, 14, 5);
    context.fillStyle = '#d96355';
    context.fillRect(x + 10, 13 + bob, 12, 16);
    context.fillStyle = '#f0b47c';
    context.fillRect(x + 12, 6 + bob, 8, 8);
    context.fillStyle = '#ebeff3';
    context.fillRect(x + 9 + (frame % 2) * 2, 29 + bob, 5, 8);
    context.fillRect(x + 18 - (frame % 2) * 2, 29 - bob, 5, 8);
    context.fillStyle = '#355b76';
    context.fillRect(x + 7, 15 + bob, 4, 11);
    context.fillRect(x + 21, 15 + bob, 4, 11);
  }
  const url = atlas.toDataURL('image/png');
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Failed to build preview sprite atlas.'));
    image.src = url;
  });
  AssetLoader.register(url, image);
  const frames = [0, 1, 2, 3].map((frame) => ({ x: frame * 32, y: 0, w: 32, h: 40 }));
  return new SpriteSheet({
    url,
    scale: 1.35,
    anchorY: 0.92,
    clips: [
      { name: 'idle', fps: 6, loop: true, frames },
      { name: 'walk', fps: 9, loop: true, frames },
    ],
  });
}

function sceneOriginY(height: number): number {
  return Math.max(135, Math.min(400, height * 0.36));
}
