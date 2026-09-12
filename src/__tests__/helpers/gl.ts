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
export interface FakeHandle { readonly id: number; }

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
};

export function createFakeGL(options: FakeGLOptions = {}): FakeGL {
  const created: FakeHandle[] = [];
  const deleted: FakeHandle[] = [];
  const shaders: FakeHandle[] = [];
  const deletedShaders: FakeHandle[] = [];
  const programs: FakeHandle[] = [];
  const deletedPrograms: FakeHandle[] = [];
  const calls: string[] = [];
  let nextId = 1;

  const fails = new Set(options.failCreate ?? []);
  const infoLog = options.infoLog ?? 'fake GL failure';
  const handle = (): FakeHandle => ({ id: nextId++ });

  const api: Record<string, unknown> = {
    ...ENUMS,
    createTexture: () => {
      if (fails.has('texture')) return null;
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
      if (fails.has('shader')) return null;
      const shader = handle();
      shaders.push(shader);
      return shader;
    },
    deleteShader: (shader: FakeHandle) => { deletedShaders.push(shader); },
    getShaderParameter: () => !options.failCompile,
    getShaderInfoLog: () => infoLog,
    createProgram: () => {
      if (fails.has('program')) return null;
      const program = handle();
      programs.push(program);
      return program;
    },
    deleteProgram: (program: FakeHandle) => { deletedPrograms.push(program); },
    getProgramParameter: () => !options.failLink,
    getProgramInfoLog: () => infoLog,
  };

  const gl = new Proxy(api, {
    get: (target, prop: string) => {
      if (prop in target) {
        const value = target[prop];
        if (typeof value !== 'function') return value;
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
    live: () => created.filter((texture) => !deleted.includes(texture)),
    liveShaders: () => shaders.filter((shader) => !deletedShaders.includes(shader)),
  };
}
