/**
 * A minimal fake WebGL2 context, enough for the resource-owning classes.
 *
 * `GLResourceRegistry` and `TextureRegistry` are pure bookkeeping over a handful
 * of GL calls, but they had no unit tests because a real context needs a browser.
 * This records handle creation and deletion so a test can assert that what was
 * created is what gets deleted — which is the whole contract those two classes
 * exist to keep.
 */

/** A GL handle stand-in. Distinguishable by id when a test needs to name one. */
export interface FakeHandle {readonly id: number;}

/** Resource kinds whose `create*` call can be made to fail. */
export type FakeGLResource =
  | 'buffer' | 'vertexArray' | 'texture' | 'framebuffer' | 'program' | 'shader';

export interface FakeGLOptions {
  /** Kinds whose create call returns null, as a real driver does under pressure. */
  failCreate?: readonly FakeGLResource[];
  /** Fail `getShaderParameter(COMPILE_STATUS)`. */
  failCompile?: boolean;
  /** Fail `getProgramParameter(LINK_STATUS)`. */
  failLink?: boolean;
  /**
   * Info log for a compile or link failure. Defaults to a message; pass `''` to
   * exercise the caller's own fallback text.
   */
  infoLog?: string;
}

export interface FakeGL {
  gl: WebGL2RenderingContext;
  /** Textures created, in order. */
  created: FakeHandle[];
  /** Textures passed to `deleteTexture`, in order. Duplicates are kept. */
  deleted: FakeHandle[];
  /** Shaders created, in order. */
  shaders: FakeHandle[];
  /** Shaders passed to `deleteShader`, in order. */
  deletedShaders: FakeHandle[];
  /** Programs created, in order. */
  programs: FakeHandle[];
  /** Programs passed to `deleteProgram`, in order. */
  deletedPrograms: FakeHandle[];
  /** Names of every call, in order. */
  calls: string[];
  /** `uniform1i` calls, with the uniform name tagged by `getUniformLocation`. */
  uniform1iCalls: Array<{name: string; value: number}>;
  /** `uniform2fv` calls; value is a copy of the uploaded array. */
  uniform2fvCalls: Array<{name: string; value: number[]}>;
  /** Arguments of the last `readPixels(x, y, w, h, ...)` call. */
  lastReadPixels: {x: number; y: number; w: number; h: number} | null;
  /** Textures created but not yet deleted. */
  live(): FakeHandle[];
  /** Shaders created but not yet deleted — a leak shows up here. */
  liveShaders(): FakeHandle[];
}

/** GL enum values a test never inspects — any stable number will do. */
const ENUMS: Record<string, number> = {
  TEXTURE_2D: 0x0de1,
  RGBA: 0x1908,
  UNSIGNED_BYTE: 0x1401,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  NEAREST: 0x2600,
  CLAMP_TO_EDGE: 0x812f,
  UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
  VERTEX_SHADER: 0x8b31,
  FRAGMENT_SHADER: 0x8b30,
  LINK_STATUS: 0x8b82,
  COMPILE_STATUS: 0x8b81,
  // The rest only need stable values: they are arguments to no-op calls.
  RGBA8: 0x8058,
  DYNAMIC_DRAW: 0x88e8,
  TEXTURE0: 0x84c0,
  BLEND: 0x0be2,
  DITHER: 0x0bd0,
  DEPTH_TEST: 0x0b71,
  SRC_ALPHA: 0x0302,
  ONE_MINUS_SRC_ALPHA: 0x0303,
  ONE: 1,
  ZERO: 0,
  DST_COLOR: 0x0306,
  COLOR_BUFFER_BIT: 0x4000,
  FRAMEBUFFER: 0x8d40,
  COLOR_ATTACHMENT0: 0x8ce0,
  FRAMEBUFFER_COMPLETE: 0x8cdd,
  TRIANGLES: 0x0004,
  FLOAT: 0x1406,
};

export function createFakeGL(options: FakeGLOptions = {}): FakeGL {
  const created: FakeHandle[] = [];
  const deleted: FakeHandle[] = [];
  const shaders: FakeHandle[] = [];
  const deletedShaders: FakeHandle[] = [];
  const programs: FakeHandle[] = [];
  const deletedPrograms: FakeHandle[] = [];
  const calls: string[] = [];
  const uniform1iCalls: Array<{name: string; value: number}> = [];
  const uniform2fvCalls: Array<{name: string; value: number[]}> = [];
  let nextId = 1;
  const state: {lastReadPixels: {x: number; y: number; w: number; h: number} | null} = {
    lastReadPixels: null,
  };

  const fails = new Set(options.failCreate ?? []);
  const infoLog = options.infoLog ?? 'fake GL failure';
  const handle = (): FakeHandle => ({id: nextId++});

  const api: Record<string, unknown> = {
    ...ENUMS,
    createTexture: () => {
      if (fails.has('texture')) {return null;}
      const texture = handle();
      created.push(texture);
      return texture;
    },
    deleteTexture: (texture: FakeHandle) => { deleted.push(texture); },
    createBuffer: () => (fails.has('buffer') ? null : handle()),
    deleteBuffer: () => {},
    createVertexArray: () => (fails.has('vertexArray') ? null : handle()),
    deleteVertexArray: () => {},
    createFramebuffer: () => (fails.has('framebuffer') ? null : handle()),
    deleteFramebuffer: () => {},
    createShader: () => {
      if (fails.has('shader')) {return null;}
      const shader = handle();
      shaders.push(shader);
      return shader;
    },
    deleteShader: (shader: FakeHandle) => { deletedShaders.push(shader); },
    getShaderParameter: () => !options.failCompile,
    getShaderInfoLog: () => infoLog,
    createProgram: () => {
      if (fails.has('program')) {return null;}
      const program = handle();
      programs.push(program);
      return program;
    },
    deleteProgram: (program: FakeHandle) => { deletedPrograms.push(program); },
    getProgramParameter: () => !options.failLink,
    getProgramInfoLog: () => infoLog,
    // Tag locations with their uniform name so a test can assert what value was
    // uploaded to which uniform without parsing a shader.
    getUniformLocation: (_program: unknown, name: string) => ({id: nextId++, uniform: name}),
    checkFramebufferStatus: () => ENUMS.FRAMEBUFFER_COMPLETE,
    getParameter: () => 0,
    uniform1i: (location: {uniform?: string}, value: number) => {
      uniform1iCalls.push({name: location?.uniform ?? '', value});
    },
    uniform2fv: (location: {uniform?: string}, value: ArrayLike<number>) => {
      uniform2fvCalls.push({name: location?.uniform ?? '', value: Array.from(value)});
    },
    readPixels: (x: number, y: number, w: number, h: number) => {
      state.lastReadPixels = {x, y, w, h};
    },
  };

  const gl = new Proxy(api, {
    get: (target, prop: string) => {
      if (prop in target) {
        const value = target[prop];
        if (typeof value !== 'function') {return value;}
        return (...args: unknown[]) => {
          calls.push(prop);
          return (value as (...a: unknown[]) => unknown)(...args);
        };
      }
      // Everything else is a state-setting call with no return value.
      return (...args: unknown[]) => { void args; calls.push(prop); };
    },
  }) as unknown as WebGL2RenderingContext;

  return {
    gl,
    created,
    deleted,
    shaders,
    deletedShaders,
    programs,
    deletedPrograms,
    calls,
    uniform1iCalls,
    uniform2fvCalls,
    get lastReadPixels() {return state.lastReadPixels;},
    live: () => created.filter(texture => !deleted.includes(texture)),
    liveShaders: () => shaders.filter(shader => !deletedShaders.includes(shader)),
  };
}
