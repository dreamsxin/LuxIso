import type { PickResult, RenderBackend, RenderStats } from '../contracts/RenderBackend';
import {
  MAX_OMNI_LIGHTS,
  RENDER_VERTEX_FLOATS,
  type RenderRange,
  type RenderSnapshot,
} from '../contracts/RenderSnapshot';
import { GLResourceRegistry } from '../device/GLResourceRegistry';
import type { GLResourceCounts } from '../device/GLResourceRegistry';
import { decodePickId } from '../extraction/GeometryBuilder';
import { TextureRegistry } from '../resources/TextureRegistry';
import { computeShadowMaskCacheKey } from './ShadowMaskCacheKey';
import {
  pickingFragmentShader,
  shadowCompositeFragmentShader,
  shadowCompositeVertexShader,
  shadowMaskFragmentShader,
  vertexShader,
  visualFragmentShader,
} from './shaders';

const MAX_DIRECTIONAL_LIGHTS = 4;

interface ProgramState {
  program: WebGLProgram;
  viewport: WebGLUniformLocation;
  origin: WebGLUniformLocation;
  cameraIso: WebGLUniformLocation;
  zoom: WebGLUniformLocation;
  elevation: WebGLUniformLocation;
  rotation: WebGLUniformLocation;
  aspect: WebGLUniformLocation;
  texture: WebGLUniformLocation | null;
}

interface VisualProgramState extends ProgramState {
  ambientColor: WebGLUniformLocation;
  ambientIntensity: WebGLUniformLocation;
  omniCount: WebGLUniformLocation;
  omniPosition: WebGLUniformLocation;
  omniColor: WebGLUniformLocation;
  omniParams: WebGLUniformLocation;
  directionalCount: WebGLUniformLocation;
  directionalDirection: WebGLUniformLocation;
  directionalColor: WebGLUniformLocation;
  directionalIntensity: WebGLUniformLocation;
}

interface ShadowCompositeProgramState {
  program: WebGLProgram;
  mask: WebGLUniformLocation;
}

export class WebGLUnavailableError extends Error {
  constructor(message = 'WebGL2 is unavailable in this browser.') {
    super(message);
    this.name = 'WebGLUnavailableError';
  }
}

export class WebGLRenderer implements RenderBackend {
  readonly kind = 'webgl2' as const;

  private readonly _gl: WebGL2RenderingContext;
  private _resources: GLResourceRegistry;
  private _buffer!: WebGLBuffer;
  private _vao!: WebGLVertexArrayObject;
  private _visual!: VisualProgramState;
  private _picking!: ProgramState;
  private _shadowMask!: ProgramState;
  private _shadowComposite!: ShadowCompositeProgramState;
  private _pickTexture!: WebGLTexture;
  private _pickFramebuffer!: WebGLFramebuffer;
  private _shadowMaskTexture!: WebGLTexture;
  private _shadowMaskFramebuffer!: WebGLFramebuffer;
  private _textures!: TextureRegistry;
  private _bufferCapacity = 0;
  private _pickWidth = 0;
  private _pickHeight = 0;
  private _shadowMaskWidth = 0;
  private _shadowMaskHeight = 0;
  private _shadowMaskCacheKey: number | null = null;
  private _dpr = 1;
  private _contextLost = false;
  private _disposed = false;
  private _lastSnapshot: RenderSnapshot | null = null;
  private readonly _pixel = new Uint8Array(4);
  private readonly _omniPosition = new Float32Array(MAX_OMNI_LIGHTS * 2);
  private readonly _omniColor = new Float32Array(MAX_OMNI_LIGHTS * 3);
  private readonly _omniParams = new Float32Array(MAX_OMNI_LIGHTS * 4);
  private readonly _directionalDirection = new Float32Array(MAX_DIRECTIONAL_LIGHTS * 2);
  private readonly _directionalColor = new Float32Array(MAX_DIRECTIONAL_LIGHTS * 3);
  private readonly _directionalIntensity = new Float32Array(MAX_DIRECTIONAL_LIGHTS);
  private readonly _statsValue: RenderStats = {
    frame: 0,
    cpuMs: 0,
    drawCalls: 0,
    triangles: 0,
    vertices: 0,
    bufferBytes: 0,
    omniLights: 0,
    segments: 0,
    textures: 0,
    textOverlays: 0,
    unsupportedObjects: 0,
    shadowMaskCacheHits: 0,
    shadowMaskCacheMisses: 0,
    contextLost: false,
  };

  private readonly _onContextLost = (event: Event): void => {
    event.preventDefault();
    this._contextLost = true;
    this._statsValue.contextLost = true;
    this._textures.dispose();
    this._resources.abandon();
    this._shadowMaskCacheKey = null;
  };

  private readonly _onContextRestored = (): void => {
    if (this._disposed) return;
    this._contextLost = false;
    this._statsValue.contextLost = false;
    this._resources = new GLResourceRegistry(this._gl);
    this._initResources();
  };

  constructor(readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      depth: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!context) throw new WebGLUnavailableError();
    this._gl = context;
    this._resources = new GLResourceRegistry(context);
    this._initResources();
    canvas.addEventListener('webglcontextlost', this._onContextLost);
    canvas.addEventListener('webglcontextrestored', this._onContextRestored);
  }

  get stats(): Readonly<RenderStats> {
    return this._statsValue;
  }

  get resourceCounts(): GLResourceCounts {
    return this._resources.counts;
  }

  get capabilities(): Readonly<Record<string, string | number>> {
    return {
      renderer: String(this._gl.getParameter(this._gl.RENDERER)),
      maxTextureSize: Number(this._gl.getParameter(this._gl.MAX_TEXTURE_SIZE)),
      maxVertexAttributes: Number(this._gl.getParameter(this._gl.MAX_VERTEX_ATTRIBS)),
      maxFragmentUniformVectors: Number(this._gl.getParameter(this._gl.MAX_FRAGMENT_UNIFORM_VECTORS)),
    };
  }

  resize(cssWidth: number, cssHeight: number, dpr = window.devicePixelRatio || 1): void {
    this._assertUsable();
    this._dpr = Math.max(1, Math.min(3, dpr));
    const width = Math.max(1, Math.round(cssWidth * this._dpr));
    const height = Math.max(1, Math.round(cssHeight * this._dpr));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    if (!this._contextLost) {
      this._resizePickTarget(width, height);
      this._resizeShadowMaskTarget(width, height);
    }
  }

  render(snapshot: RenderSnapshot): void {
    this._assertUsable();
    if (this._contextLost) return;
    const startedAt = performance.now();
    const gl = this._gl;
    // Open the texture frame before anything resolves a URL, so this frame's
    // references are what keeps a texture alive.
    this._textures.beginFrame();
    const geometry = snapshot.geometry;
    const byteLength = geometry.vertexCount * RENDER_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
    this._uploadGeometry(geometry.data, byteLength);

    gl.bindVertexArray(this._vao);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.DITHER);
    const clear = snapshot.environment.clearColor;
    gl.clearColor(clear[0], clear[1], clear[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this._visual.program);
    this._setTransformUniforms(this._visual, snapshot);
    this._setLightUniforms(snapshot);
    let visualDrawCalls = this._drawRange(this._visual, snapshot, false, geometry.floor);
    visualDrawCalls += this._renderShadowLayer(snapshot);

    gl.useProgram(this._visual.program);
    gl.enable(gl.DITHER);
    visualDrawCalls += this._drawRange(this._visual, snapshot, false, geometry.opaque);
    visualDrawCalls += this._drawRange(this._visual, snapshot, false, geometry.transparent);
    visualDrawCalls += this._drawRange(this._visual, snapshot, false, geometry.debug);

    const pickingDrawCalls = this._renderPicking(snapshot);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Every resolve for this frame has happened, so anything still idle is idle.
    this._textures.evictIdle();


    this._lastSnapshot = snapshot;
    this._statsValue.frame = snapshot.frame;
    this._statsValue.cpuMs = performance.now() - startedAt;
    this._statsValue.drawCalls = visualDrawCalls + pickingDrawCalls;
    this._statsValue.triangles = geometry.vertexCount / 3;
    this._statsValue.vertices = geometry.vertexCount;
    this._statsValue.bufferBytes = byteLength;
    this._statsValue.omniLights = Math.min(MAX_OMNI_LIGHTS, snapshot.omniLights.length);
    this._statsValue.segments = snapshot.geometry.segments.length;
    this._statsValue.textures = this._textures.size;
    this._statsValue.textOverlays = snapshot.textOverlays.length;
    this._statsValue.unsupportedObjects = snapshot.unsupported.length;
  }

  pick(x: number, y: number): PickResult | null {
    if (this._contextLost || !this._lastSnapshot) return null;
    const px = Math.floor(x * this._dpr);
    const py = this.canvas.height - 1 - Math.floor(y * this._dpr);
    if (px < 0 || py < 0 || px >= this.canvas.width || py >= this.canvas.height) return null;

    const gl = this._gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._pickFramebuffer);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this._pixel);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const pickId = decodePickId(this._pixel[0], this._pixel[1], this._pixel[2]);
    if (pickId === 0) return null;
    const objectId = this._lastSnapshot.pickLookup.get(pickId);
    return objectId ? { pickId, objectId } : null;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
    this._textures.dispose();
    if (this._contextLost) this._resources.abandon();
    else this._resources.dispose();
    this._lastSnapshot = null;
  }

  private _initResources(): void {
    const gl = this._gl;
    this._bufferCapacity = 0;
    this._buffer = this._resources.buffer();
    this._vao = this._resources.vertexArray();
    this._visual = this._createVisualProgram();
    this._picking = this._createProgram(pickingFragmentShader);
    this._shadowMask = this._createProgram(shadowMaskFragmentShader);
    this._shadowComposite = this._createShadowCompositeProgram();
    this._pickTexture = this._resources.texture();
    this._pickFramebuffer = this._resources.framebuffer();
    this._shadowMaskTexture = this._resources.texture();
    this._shadowMaskFramebuffer = this._resources.framebuffer();
    this._textures = new TextureRegistry(gl, this._resources);

    gl.bindVertexArray(this._vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
    const stride = RENDER_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
    this._attribute(0, 2, stride, 0);
    this._attribute(1, 2, stride, 2);
    this._attribute(2, 4, stride, 4);
    this._attribute(3, 2, stride, 8);
    this._attribute(4, 1, stride, 10);
    this._attribute(5, 3, stride, 11);
    this._attribute(6, 2, stride, 14);
    this._attribute(7, 1, stride, 16);
    gl.bindVertexArray(null);
    this._resizePickTarget(Math.max(1, this.canvas.width), Math.max(1, this.canvas.height));
    this._resizeShadowMaskTarget(Math.max(1, this.canvas.width), Math.max(1, this.canvas.height));
  }

  private _attribute(index: number, size: number, stride: number, offsetFloats: number): void {
    this._gl.enableVertexAttribArray(index);
    this._gl.vertexAttribPointer(
      index,
      size,
      this._gl.FLOAT,
      false,
      stride,
      offsetFloats * Float32Array.BYTES_PER_ELEMENT,
    );
  }

  private _createVisualProgram(): VisualProgramState {
    const base = this._createProgram(visualFragmentShader);
    return {
      ...base,
      ambientColor: this._uniform(base.program, 'uAmbientColor'),
      ambientIntensity: this._uniform(base.program, 'uAmbientIntensity'),
      omniCount: this._uniform(base.program, 'uOmniCount'),
      omniPosition: this._uniform(base.program, 'uOmniPosition[0]'),
      omniColor: this._uniform(base.program, 'uOmniColor[0]'),
      omniParams: this._uniform(base.program, 'uOmniParams[0]'),
      directionalCount: this._uniform(base.program, 'uDirectionalCount'),
      directionalDirection: this._uniform(base.program, 'uDirectionalDirection[0]'),
      directionalColor: this._uniform(base.program, 'uDirectionalColor[0]'),
      directionalIntensity: this._uniform(base.program, 'uDirectionalIntensity[0]'),
    };
  }

  private _createProgram(fragmentSource: string): ProgramState {
    const program = this._resources.program(vertexShader, fragmentSource);
    return {
      program,
      viewport: this._uniform(program, 'uViewport'),
      origin: this._uniform(program, 'uOrigin'),
      cameraIso: this._uniform(program, 'uCameraIso'),
      zoom: this._uniform(program, 'uZoom'),
      elevation: this._uniform(program, 'uElevation'),
      rotation: this._uniform(program, 'uRotation'),
      aspect: this._uniform(program, 'uAspect'),
      texture: this._gl.getUniformLocation(program, 'uTexture'),
    };
  }

  private _createShadowCompositeProgram(): ShadowCompositeProgramState {
    const program = this._resources.program(shadowCompositeVertexShader, shadowCompositeFragmentShader);
    return { program, mask: this._uniform(program, 'uShadowMask') };
  }

  private _uniform(program: WebGLProgram, name: string): WebGLUniformLocation {
    const location = this._gl.getUniformLocation(program, name);
    if (location === null) throw new Error(`Required shader uniform is missing: ${name}`);
    return location;
  }

  private _setTransformUniforms(program: ProgramState, snapshot: RenderSnapshot): void {
    const gl = this._gl;
    const camera = snapshot.camera;
    const cameraIsoX = (camera.worldX - camera.worldY) * (snapshot.tileW / 2);
    const cameraIsoY = (camera.worldX + camera.worldY) * (snapshot.tileH / 2);
    gl.uniform2f(program.viewport, camera.viewportWidth, camera.viewportHeight);
    gl.uniform2f(program.origin, camera.originX, camera.originY);
    gl.uniform2f(program.cameraIso, cameraIsoX, cameraIsoY);
    gl.uniform1f(program.zoom, camera.zoom);
    gl.uniform1f(program.elevation, camera.elevation);
    gl.uniform1f(program.rotation, camera.rotation * Math.PI / 180);
    gl.uniform1f(program.aspect, snapshot.tileW / snapshot.tileH);
    if (program.texture) gl.uniform1i(program.texture, 0);
  }

  private _setLightUniforms(snapshot: RenderSnapshot): void {
    const gl = this._gl;
    const program = this._visual;
    const environment = snapshot.environment;
    gl.uniform3fv(program.ambientColor, environment.ambientColor);
    gl.uniform1f(program.ambientIntensity, environment.ambientIntensity);

    const omniCount = Math.min(MAX_OMNI_LIGHTS, snapshot.omniLights.length);
    this._omniPosition.fill(0);
    this._omniColor.fill(0);
    this._omniParams.fill(0);
    for (let i = 0; i < omniCount; i++) {
      const light = snapshot.omniLights[i];
      const positionOffset = i * 2;
      const colorOffset = i * 3;
      const paramsOffset = i * 4;
      this._omniPosition[positionOffset] = light.x;
      this._omniPosition[positionOffset + 1] = light.y;
      this._omniColor[colorOffset] = light.color[0];
      this._omniColor[colorOffset + 1] = light.color[1];
      this._omniColor[colorOffset + 2] = light.color[2];
      this._omniParams[paramsOffset] = light.radius;
      this._omniParams[paramsOffset + 1] = light.global ? 1 : 0;
      this._omniParams[paramsOffset + 2] = light.quadratic ? 1 : 0;
      this._omniParams[paramsOffset + 3] = light.intensity;
    }
    gl.uniform1i(program.omniCount, omniCount);
    gl.uniform2fv(program.omniPosition, this._omniPosition);
    gl.uniform3fv(program.omniColor, this._omniColor);
    gl.uniform4fv(program.omniParams, this._omniParams);

    const directionalCount = Math.min(MAX_DIRECTIONAL_LIGHTS, snapshot.directionalLights.length);
    this._directionalDirection.fill(0);
    this._directionalColor.fill(0);
    this._directionalIntensity.fill(0);
    for (let i = 0; i < directionalCount; i++) {
      const light = snapshot.directionalLights[i];
      const directionOffset = i * 2;
      const colorOffset = i * 3;
      this._directionalDirection[directionOffset] = light.x;
      this._directionalDirection[directionOffset + 1] = light.y;
      this._directionalColor[colorOffset] = light.color[0];
      this._directionalColor[colorOffset + 1] = light.color[1];
      this._directionalColor[colorOffset + 2] = light.color[2];
      this._directionalIntensity[i] = light.intensity;
    }
    gl.uniform1i(program.directionalCount, directionalCount);
    gl.uniform2fv(program.directionalDirection, this._directionalDirection);
    gl.uniform3fv(program.directionalColor, this._directionalColor);
    gl.uniform1fv(program.directionalIntensity, this._directionalIntensity);
  }

  private _uploadGeometry(data: Float32Array, byteLength: number): void {
    const gl = this._gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
    if (byteLength > this._bufferCapacity) {
      this._bufferCapacity = nextPowerOfTwo(Math.max(1024, byteLength));
      gl.bufferData(gl.ARRAY_BUFFER, this._bufferCapacity, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, byteLength / Float32Array.BYTES_PER_ELEMENT);
  }

  private _renderPicking(snapshot: RenderSnapshot): number {
    const gl = this._gl;
    if (this._pickWidth !== this.canvas.width || this._pickHeight !== this.canvas.height) {
      this._resizePickTarget(this.canvas.width, this.canvas.height);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._pickFramebuffer);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    gl.disable(gl.DITHER);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this._picking.program);
    this._setTransformUniforms(this._picking, snapshot);
    const geometry = snapshot.geometry;
    return this._drawRange(this._picking, snapshot, true, geometry.floor) +
      this._drawRange(this._picking, snapshot, true, geometry.opaque) +
      this._drawRange(this._picking, snapshot, true, geometry.transparent) +
      this._drawRange(this._picking, snapshot, true, geometry.debug);
  }

  private _drawRange(
    _program: ProgramState,
    snapshot: RenderSnapshot,
    picking: boolean,
    range: RenderRange,
  ): number {
    if (range.count <= 0) return 0;
    const gl = this._gl;
    const segments = snapshot.geometry.segments.length > 0
      ? snapshot.geometry.segments
      : [{ first: 0, count: snapshot.geometry.vertexCount, blend: 'alpha' as const }];
    let drawCalls = 0;
    const rangeEnd = range.first + range.count;
    gl.activeTexture(gl.TEXTURE0);
    for (const segment of segments) {
      const first = Math.max(range.first, segment.first);
      const end = Math.min(rangeEnd, segment.first + segment.count);
      const count = end - first;
      if (count <= 0) continue;
      let texture = this._textures.white;
      if (segment.textureUrl) {
        const resolved = this._textures.resolve(segment.textureUrl);
        if (!resolved) continue;
        texture = resolved;
      }
      gl.bindTexture(gl.TEXTURE_2D, texture);
      if (!picking) this._setBlendMode(segment.blend);
      gl.drawArrays(gl.TRIANGLES, first, count);
      drawCalls++;
    }
    return drawCalls;
  }

  private _renderShadowLayer(snapshot: RenderSnapshot): number {
    const shadows = snapshot.geometry.shadows;
    this._statsValue.shadowMaskCacheHits = 0;
    this._statsValue.shadowMaskCacheMisses = 0;
    if (shadows.count <= 0) return 0;

    const cacheKey = computeShadowMaskCacheKey(snapshot, this.canvas.width, this.canvas.height);
    let drawCalls = 0;
    if (cacheKey !== this._shadowMaskCacheKey) {
      this._renderShadowMask(snapshot);
      this._shadowMaskCacheKey = cacheKey;
      this._statsValue.shadowMaskCacheMisses = 1;
      drawCalls++;
    } else {
      this._statsValue.shadowMaskCacheHits = 1;
    }
    this._compositeShadowMask();
    return drawCalls + 1;
  }

  private _renderShadowMask(snapshot: RenderSnapshot): void {
    const gl = this._gl;
    const shadows = snapshot.geometry.shadows;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._shadowMaskFramebuffer);
    gl.viewport(0, 0, this._shadowMaskWidth, this._shadowMaskHeight);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.DITHER);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this._shadowMask.program);
    this._setTransformUniforms(this._shadowMask, snapshot);
    gl.drawArrays(gl.TRIANGLES, shadows.first, shadows.count);
  }

  private _compositeShadowMask(): void {
    const gl = this._gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this._shadowComposite.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._shadowMaskTexture);
    gl.uniform1i(this._shadowComposite.mask, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private _setBlendMode(blend: 'alpha' | 'add' | 'multiply'): void {
    const gl = this._gl;
    if (blend === 'add') {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    } else if (blend === 'multiply') {
      gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
  }

  private _resizePickTarget(width: number, height: number): void {
    const gl = this._gl;
    this._pickWidth = width;
    this._pickHeight = height;
    gl.bindTexture(gl.TEXTURE_2D, this._pickTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._pickFramebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this._pickTexture,
      0,
    );
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Picking framebuffer is incomplete: 0x${status.toString(16)}`);
    }
  }

  private _resizeShadowMaskTarget(width: number, height: number): void {
    const gl = this._gl;
    this._shadowMaskWidth = width;
    this._shadowMaskHeight = height;
    this._shadowMaskCacheKey = null;
    gl.bindTexture(gl.TEXTURE_2D, this._shadowMaskTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._shadowMaskFramebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this._shadowMaskTexture,
      0,
    );
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Shadow-mask framebuffer is incomplete: 0x${status.toString(16)}`);
    }
  }

  private _assertUsable(): void {
    if (this._disposed) throw new Error('WebGLRenderer has been disposed.');
  }
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}
