import { describe, it, expect } from 'vitest';
import { createFakeGL } from './helpers/gl';
import { GLResourceRegistry } from '../../webgl-next/src/device/GLResourceRegistry';

/**
 * The WebGL2 handle registry — every GPU object the renderer owns passes through
 * it, and the context-loss story depends on its counts being honest.
 *
 * At 27% branch coverage the untested half was the entire failure surface: a
 * `create*` returning null, a shader that will not compile, a program that will
 * not link. Those paths only run when something is already wrong, which is
 * exactly when a leak or a useless error message costs the most.
 */

const VERTEX = 'void main() {}';
const FRAGMENT = 'void main() {}';

describe('GLResourceRegistry — counts', () => {
  it('starts empty and tracks each kind separately', () => {
    const fake = createFakeGL();
    const resources = new GLResourceRegistry(fake.gl);
    expect(resources.counts.total).toBe(0);

    resources.buffer();
    resources.vertexArray();
    resources.texture();
    resources.texture();
    resources.framebuffer();
    resources.program(VERTEX, FRAGMENT);

    const counts = resources.counts;
    expect(counts.buffers).toBe(1);
    expect(counts.vertexArrays).toBe(1);
    expect(counts.textures).toBe(2);
    expect(counts.framebuffers).toBe(1);
    expect(counts.programs).toBe(1);
    expect(counts.total).toBe(6);
  });

  it('deletes everything it owns on dispose, and reaches zero', () => {
    const fake = createFakeGL();
    const resources = new GLResourceRegistry(fake.gl);
    const texture = resources.texture();
    resources.buffer();
    resources.program(VERTEX, FRAGMENT);

    resources.dispose();

    expect(fake.deleted).toEqual([texture]);
    expect(fake.deletedPrograms).toEqual(fake.programs);
    expect(resources.counts.total).toBe(0);
  });

  it('abandons handles without deleting them, for a lost context', () => {
    const fake = createFakeGL();
    const resources = new GLResourceRegistry(fake.gl);
    resources.texture();
    resources.program(VERTEX, FRAGMENT);

    // The browser has already invalidated every handle; deleting them would be
    // calling into a dead context.
    resources.abandon();

    expect(resources.counts.total).toBe(0);
    expect(fake.deleted).toEqual([]);
    expect(fake.deletedPrograms).toEqual([]);
  });
});

describe('GLResourceRegistry — releaseTexture', () => {
  it('deletes one handle and stops counting it', () => {
    const fake = createFakeGL();
    const resources = new GLResourceRegistry(fake.gl);
    const a = resources.texture();
    const b = resources.texture();

    expect(resources.releaseTexture(a)).toBe(true);
    expect(resources.counts.textures).toBe(1);
    expect(fake.deleted).toEqual([a]);

    // A second release is a no-op rather than a double delete.
    expect(resources.releaseTexture(a)).toBe(false);
    expect(fake.deleted).toEqual([a]);

    resources.dispose();
    expect(fake.deleted).toEqual([a, b]);
    expect(resources.counts.total).toBe(0);
  });
});

describe('GLResourceRegistry — creation failure', () => {
  it('throws a named error for each kind the driver refuses', () => {
    let resources = new GLResourceRegistry(createFakeGL({ failCreate: ['buffer'] }).gl);
    expect(() => resources.buffer()).toThrow(/buffer/i);

    resources = new GLResourceRegistry(createFakeGL({ failCreate: ['vertexArray'] }).gl);
    expect(() => resources.vertexArray()).toThrow(/vertex array/i);

    resources = new GLResourceRegistry(createFakeGL({ failCreate: ['texture'] }).gl);
    expect(() => resources.texture()).toThrow(/texture/i);

    resources = new GLResourceRegistry(createFakeGL({ failCreate: ['framebuffer'] }).gl);
    expect(() => resources.framebuffer()).toThrow(/framebuffer/i);
  });

  it('counts nothing for a refused handle', () => {
    const fake = createFakeGL({ failCreate: ['texture'] });
    const resources = new GLResourceRegistry(fake.gl);
    expect(() => resources.texture()).toThrow();
    expect(resources.counts.textures).toBe(0);
  });
});

describe('GLResourceRegistry — shader and program failure', () => {
  it('reports the compile log and deletes the shader it could not compile', () => {
    const fake = createFakeGL({ failCompile: true, infoLog: 'syntax error line 3' });
    const resources = new GLResourceRegistry(fake.gl);

    expect(() => resources.program(VERTEX, FRAGMENT)).toThrow('syntax error line 3');
    expect(fake.liveShaders()).toEqual([]);
    expect(resources.counts.programs).toBe(0);
  });

  it('falls back to a message when the driver gives no compile log', () => {
    const fake = createFakeGL({ failCompile: true, infoLog: '' });
    const resources = new GLResourceRegistry(fake.gl);
    expect(() => resources.program(VERTEX, FRAGMENT)).toThrow(/unknown shader compile error/i);
  });

  it('reports the link log and deletes both shaders and the program', () => {
    const fake = createFakeGL({ failLink: true, infoLog: 'varying mismatch' });
    const resources = new GLResourceRegistry(fake.gl);

    expect(() => resources.program(VERTEX, FRAGMENT)).toThrow('varying mismatch');
    expect(fake.liveShaders()).toEqual([]);
    expect(fake.deletedPrograms).toEqual(fake.programs);
    expect(resources.counts.programs).toBe(0);
  });

  it('falls back to a message when the driver gives no link log', () => {
    const fake = createFakeGL({ failLink: true, infoLog: '' });
    const resources = new GLResourceRegistry(fake.gl);
    expect(() => resources.program(VERTEX, FRAGMENT)).toThrow(/unknown shader link error/i);
  });

  it('throws when a shader handle cannot be created at all', () => {
    const fake = createFakeGL({ failCreate: ['shader'] });
    const resources = new GLResourceRegistry(fake.gl);
    expect(() => resources.program(VERTEX, FRAGMENT)).toThrow(/shader/i);
    expect(fake.liveShaders()).toEqual([]);
  });

  it('leaks no shader when the program handle cannot be created', () => {
    const fake = createFakeGL({ failCreate: ['program'] });
    const resources = new GLResourceRegistry(fake.gl);

    expect(() => resources.program(VERTEX, FRAGMENT)).toThrow(/program/i);
    // Both shaders compiled before `createProgram` refused; leaving them behind
    // would strand two GPU objects per failed load.
    expect(fake.shaders.length).toBe(2);
    expect(fake.liveShaders()).toEqual([]);
  });

  it('deletes the vertex shader when only the fragment shader fails', () => {
    // The failure order that leaks: the vertex shader is already compiled and
    // held in a local when `_shader` throws for the fragment source.
    let compiled = 0;
    const fake = createFakeGL();
    const gl = fake.gl as unknown as {
      getShaderParameter: (...args: unknown[]) => boolean;
    };
    gl.getShaderParameter = (): boolean => {
      compiled++;
      return compiled === 1;   // vertex passes, fragment fails
    };

    const resources = new GLResourceRegistry(fake.gl);
    expect(() => resources.program(VERTEX, FRAGMENT)).toThrow();
    expect(fake.shaders.length).toBe(2);
    expect(fake.liveShaders()).toEqual([]);
  });
});

