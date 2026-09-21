import {describe, expect, it} from 'vitest';
import {GLResourceRegistry} from '../../webgl-next/src/device/GLResourceRegistry';
import {WebGLRenderer, WebGLUnavailableError} from '../../webgl-next/src/renderer/WebGLRenderer';
import {
  pickingFragmentShader,
  shadowCompositeFragmentShader,
  shadowMaskFragmentShader,
  vertexShader,
  visualFragmentShader,
} from '../../webgl-next/src/renderer/shaders';

describe('WebGL Next renderer contract', () => {
  it('fails explicitly when WebGL2 is unavailable so callers can fall back', () => {
    const canvas = {getContext: () => null} as unknown as HTMLCanvasElement;
    expect(() => new WebGLRenderer(canvas)).toThrow(WebGLUnavailableError);
  });

  it('keeps visual and picking passes on the same vertex transform', () => {
    expect(vertexShader).toContain('uCameraIso');
    expect(vertexShader).toContain('uRotation');
    expect(visualFragmentShader).toContain('uOmniPosition[8]');
    expect(visualFragmentShader).toContain('uDirectionalDirection[4]');
    expect(shadowMaskFragmentShader).toContain('vColor.rgb + vec3(1.0 - vColor.a)');
    expect(shadowCompositeFragmentShader).toContain('uShadowMask');
    expect(pickingFragmentShader).toContain('vPick');
  });

  it('deletes normal resources and abandons invalid context handles', () => {
    const deleted: string[] = [];
    const gl = {
      createBuffer: () => ({kind: 'buffer'}),
      createVertexArray: () => ({kind: 'vertex-array'}),
      createTexture: () => ({kind: 'texture'}),
      createFramebuffer: () => ({kind: 'framebuffer'}),
      deleteBuffer: () => deleted.push('buffer'),
      deleteVertexArray: () => deleted.push('vertex-array'),
      deleteTexture: () => deleted.push('texture'),
      deleteFramebuffer: () => deleted.push('framebuffer'),
    } as unknown as WebGL2RenderingContext;
    const registry = new GLResourceRegistry(gl);

    registry.buffer();
    registry.vertexArray();
    registry.texture();
    registry.framebuffer();
    expect(registry.counts).toEqual({
      buffers: 1,
      vertexArrays: 1,
      programs: 0,
      textures: 1,
      framebuffers: 1,
      total: 4,
    });

    registry.dispose();
    expect(deleted).toEqual(['buffer', 'vertex-array', 'texture', 'framebuffer']);
    expect(registry.counts.total).toBe(0);

    registry.buffer();
    registry.abandon();
    expect(registry.counts.total).toBe(0);
    expect(deleted).toHaveLength(4);
  });
});
