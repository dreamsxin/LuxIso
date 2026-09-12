export interface GLResourceCounts {
  readonly buffers: number;
  readonly vertexArrays: number;
  readonly programs: number;
  readonly textures: number;
  readonly framebuffers: number;
  readonly total: number;
}

export class GLResourceRegistry {
  private readonly _buffers: WebGLBuffer[] = [];
  private readonly _vertexArrays: WebGLVertexArrayObject[] = [];
  private readonly _programs: WebGLProgram[] = [];
  private readonly _textures: WebGLTexture[] = [];
  private readonly _framebuffers: WebGLFramebuffer[] = [];

  constructor(private readonly _gl: WebGL2RenderingContext) {}

  get counts(): GLResourceCounts {
    const buffers = this._buffers.length;
    const vertexArrays = this._vertexArrays.length;
    const programs = this._programs.length;
    const textures = this._textures.length;
    const framebuffers = this._framebuffers.length;
    return {
      buffers,
      vertexArrays,
      programs,
      textures,
      framebuffers,
      total: buffers + vertexArrays + programs + textures + framebuffers,
    };
  }

  buffer(): WebGLBuffer {
    const resource = this._gl.createBuffer();
    if (!resource) throw new Error('Unable to create WebGL buffer.');
    this._buffers.push(resource);
    return resource;
  }

  vertexArray(): WebGLVertexArrayObject {
    const resource = this._gl.createVertexArray();
    if (!resource) throw new Error('Unable to create WebGL vertex array.');
    this._vertexArrays.push(resource);
    return resource;
  }

  texture(): WebGLTexture {
    const resource = this._gl.createTexture();
    if (!resource) throw new Error('Unable to create WebGL texture.');
    this._textures.push(resource);
    return resource;
  }

  framebuffer(): WebGLFramebuffer {
    const resource = this._gl.createFramebuffer();
    if (!resource) throw new Error('Unable to create WebGL framebuffer.');
    this._framebuffers.push(resource);
    return resource;
  }

  program(vertexSource: string, fragmentSource: string): WebGLProgram {
    const vertex = this._shader(this._gl.VERTEX_SHADER, vertexSource);
    const fragment = this._shader(this._gl.FRAGMENT_SHADER, fragmentSource);
    const program = this._gl.createProgram();
    if (!program) throw new Error('Unable to create WebGL program.');
    this._gl.attachShader(program, vertex);
    this._gl.attachShader(program, fragment);
    this._gl.linkProgram(program);
    this._gl.deleteShader(vertex);
    this._gl.deleteShader(fragment);
    if (!this._gl.getProgramParameter(program, this._gl.LINK_STATUS)) {
      const log = this._gl.getProgramInfoLog(program) || 'Unknown shader link error.';
      this._gl.deleteProgram(program);
      throw new Error(log);
    }
    this._programs.push(program);
    return program;
  }

  /**
   * Delete one texture and stop tracking it.
   *
   * `dispose()` is all-or-nothing, which is right for teardown but leaves no way
   * to reclaim a single texture that is no longer referenced — the reason
   * `TextureRegistry` could only ever grow. Returns false for a handle this
   * registry never created, so a double release is a no-op rather than a
   * double `deleteTexture`.
   */
  releaseTexture(texture: WebGLTexture): boolean {
    const index = this._textures.indexOf(texture);
    if (index < 0) return false;
    this._textures.splice(index, 1);
    this._gl.deleteTexture(texture);
    return true;
  }

  dispose(): void {
    for (const resource of this._buffers) this._gl.deleteBuffer(resource);
    for (const resource of this._vertexArrays) this._gl.deleteVertexArray(resource);
    for (const resource of this._programs) this._gl.deleteProgram(resource);
    for (const resource of this._textures) this._gl.deleteTexture(resource);
    for (const resource of this._framebuffers) this._gl.deleteFramebuffer(resource);
    this.abandon();
  }

  /** Clear JS references after the browser has invalidated every GPU handle. */
  abandon(): void {
    this._buffers.length = 0;
    this._vertexArrays.length = 0;
    this._programs.length = 0;
    this._textures.length = 0;
    this._framebuffers.length = 0;
  }

  private _shader(type: number, source: string): WebGLShader {
    const shader = this._gl.createShader(type);
    if (!shader) throw new Error('Unable to create WebGL shader.');
    this._gl.shaderSource(shader, source);
    this._gl.compileShader(shader);
    if (!this._gl.getShaderParameter(shader, this._gl.COMPILE_STATUS)) {
      const log = this._gl.getShaderInfoLog(shader) || 'Unknown shader compile error.';
      this._gl.deleteShader(shader);
      throw new Error(log);
    }
    return shader;
  }
}
