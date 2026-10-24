export const vertexShader = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aSample;
layout(location = 2) in vec4 aColor;
layout(location = 3) in vec2 aNormal;
layout(location = 4) in float aLit;
layout(location = 5) in vec3 aPick;
layout(location = 6) in vec2 aUv;
layout(location = 7) in float aTextured;

uniform vec2 uViewport;
uniform vec2 uOrigin;
uniform vec2 uCameraIso;
uniform float uZoom;
uniform float uElevation;
uniform float uRotation;
uniform float uAspect;

out vec2 vSample;
out vec4 vColor;
out vec2 vNormal;
out float vLit;
out vec3 vPick;
out vec2 vUv;
out float vTextured;

void main() {
  vec2 p = aPosition - uCameraIso;
  p.y *= uElevation / 0.5;
  float c = cos(uRotation);
  float s = sin(uRotation);
  p = vec2(c * p.x + s * uAspect * p.y, -s * p.x / uAspect + c * p.y);
  vec2 screen = uOrigin + p * uZoom;
  vec2 clip = vec2(screen.x / uViewport.x * 2.0 - 1.0, 1.0 - screen.y / uViewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vSample = aSample;
  vColor = aColor;
  vNormal = aNormal;
  vLit = aLit;
  vPick = aPick;
  vUv = aUv;
  vTextured = aTextured;
}
`;

export const visualFragmentShader = `#version 300 es
precision highp float;

in vec2 vSample;
in vec4 vColor;
in vec2 vNormal;
in float vLit;
in vec2 vUv;
in float vTextured;

uniform vec3 uAmbientColor;
uniform float uAmbientIntensity;
uniform int uOmniCount;
uniform vec2 uOmniPosition[16];
uniform vec3 uOmniColor[16];
uniform vec4 uOmniParams[16];
uniform int uDirectionalCount;
uniform vec2 uDirectionalDirection[4];
uniform vec3 uDirectionalColor[4];
uniform float uDirectionalIntensity[4];
uniform sampler2D uTexture;

out vec4 outColor;

void main() {
  vec3 light = uAmbientColor * uAmbientIntensity;
  vec2 normal = normalize(vNormal);

  for (int i = 0; i < 4; i++) {
    if (i >= uDirectionalCount) break;
    float facing = max(dot(normal, normalize(uDirectionalDirection[i])), 0.0);
    if (normal.y < -0.9) facing = max(facing, 0.55);
    light += uDirectionalColor[i] * uDirectionalIntensity[i] * facing;
  }

  for (int i = 0; i < 16; i++) {
    if (i >= uOmniCount) break;
    float globalLight = uOmniParams[i].y;
    float attenuation = 1.0;
    if (globalLight < 0.5) {
      float radius = max(1.0, uOmniParams[i].x);
      attenuation = max(0.0, 1.0 - distance(vSample, uOmniPosition[i]) / radius);
      if (uOmniParams[i].z > 0.5) attenuation *= attenuation;
    }
    light += uOmniColor[i] * uOmniParams[i].w * attenuation;
  }

  vec4 texel = vTextured > 0.5 ? texture(uTexture, vUv) : vec4(1.0);
  if (vTextured > 0.5 && texel.a < 0.05) discard;
  vec4 base = vColor * texel;
  vec3 litColor = base.rgb * clamp(light, vec3(0.0), vec3(1.45));
  vec3 color = mix(base.rgb, litColor, clamp(vLit, 0.0, 1.0));
  outColor = vec4(color, base.a);
}
`;

export const pickingFragmentShader = `#version 300 es
precision highp float;

in vec3 vPick;
in vec2 vUv;
in float vTextured;
uniform sampler2D uTexture;
out vec4 outColor;

void main() {
  if (vTextured > 0.5 && texture(uTexture, vUv).a < 0.05) discard;
  outColor = vec4(vPick, 1.0);
}
`;

export const shadowMaskFragmentShader = `#version 300 es
precision highp float;

in vec4 vColor;
out vec4 outColor;

void main() {
  vec3 attenuation = clamp(vColor.rgb + vec3(1.0 - vColor.a), 0.0, 1.0);
  outColor = vec4(attenuation, 1.0);
}
`;

export const shadowCompositeVertexShader = `#version 300 es
precision highp float;

out vec2 vUv;

void main() {
  vec2 uv = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = uv;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const shadowCompositeFragmentShader = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uShadowMask;
out vec4 outColor;

void main() {
  outColor = texture(uShadowMask, vUv);
}
`;
