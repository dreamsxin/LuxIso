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

export interface FakeGL {
  gl: WebGL2RenderingContext;
  /** Textures created, in order. */
  created: FakeHandle[];
  /** Textures passed to `deleteTexture`, in order. Duplicates are kept. */
  deleted: FakeHandle[];
  /** Names of every call, in order. */
  calls: string[];
  /** Textures created but not yet deleted. */
  live(): FakeHandle[];
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

export function createFakeGL(): FakeGL {
  const created: FakeHandle[] = [];
  const deleted: FakeHandle[] = [];
  const calls: string[] = [];
  let nextId = 1;

  const api: Record<string, unknown> = {
    ...ENUMS,
    createTexture: () => {
      const handle: FakeHandle = { id: nextId++ };
      created.push(handle);
      return handle;
    },
    deleteTexture: (handle: FakeHandle) => { deleted.push(handle); },
    createBuffer: () => ({ id: nextId++ }),
    deleteBuffer: () => {},
    createVertexArray: () => ({ id: nextId++ }),
    deleteVertexArray: () => {},
    createFramebuffer: () => ({ id: nextId++ }),
    deleteFramebuffer: () => {},
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
    calls,
    live: () => created.filter((handle) => !deleted.includes(handle)),
  };
}
