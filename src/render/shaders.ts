/**
 * GLSL for the layer material (shared by background and foreground).
 *
 * Colour fidelity: albedo is sampled from an sRGB texture (decoded to linear by the GPU),
 * lit in linear space with a normalisation constant chosen so that a camera-facing surface
 * under the DEFAULT light rig reproduces the source pixel exactly; the result is re-encoded
 * by three's `colorspace_fragment`. With lighting disabled the texel is passed through untouched.
 */

export const LAYER_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const LAYER_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uDepthMap;
uniform vec2 uTexel;
uniform float uMode;          // 0 render, 1 depth, 2 mask
uniform float uLit;
uniform float uExposure;
uniform float uAmbient;
uniform vec3 uKeyColor;
uniform float uKeyIntensity;
uniform vec3 uKeyDir;
uniform vec3 uRimColor;
uniform float uRimIntensity;
uniform vec3 uRimDir;
uniform float uDepthShading;
uniform float uLightNorm;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPos;

// Google "Turbo" colormap polynomial approximation (Anton Mikhailov).
vec3 turbo(float x) {
  x = clamp(x, 0.0, 1.0);
  vec4 r4 = vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234);
  vec4 g4 = vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333);
  vec4 b4 = vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771);
  vec2 r2 = vec2(-152.94239396, 59.28637943);
  vec2 g2 = vec2(4.27729857, 2.82956604);
  vec2 b2 = vec2(-89.90310912, 27.34824973);
  vec4 v4 = vec4(1.0, x, x * x, x * x * x);
  vec2 v2 = v4.zw * v4.z;
  return clamp(vec3(dot(v4, r4) + dot(v2, r2), dot(v4, g4) + dot(v2, g2), dot(v4, b4) + dot(v2, b2)), 0.0, 1.0);
}

void main() {
  vec4 tex = texture2D(uMap, vUv);
#ifdef IS_FOREGROUND
  float alpha = tex.a;
  if (alpha < 0.02) discard;
#else
  float alpha = 1.0;
#endif

  vec3 col;
  float d = texture2D(uDepthMap, vUv).r;

  if (uMode > 1.5) {
    // Mask view: foreground white over a dark background.
#ifdef IS_FOREGROUND
    col = vec3(1.0);
#else
    col = vec3(0.0033, 0.003, 0.006);
#endif
  } else if (uMode > 0.5) {
    // Depth view: near = warm, far = cool. Colormap is sRGB -> convert to linear working space.
    col = pow(turbo(d), vec3(2.2));
  } else if (uLit < 0.5) {
    col = tex.rgb;
  } else {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(cameraPosition - vWorldPos);
    float ndl = max(dot(n, uKeyDir), 0.0);
    vec3 light = (vec3(uAmbient) + uKeyColor * (uKeyIntensity * ndl)) * uLightNorm;

    // Rim light from behind/side: strongest where the surface turns away from the viewer.
    float ndv = clamp(dot(n, v), 0.0, 1.0);
    float rim = pow(1.0 - ndv, 2.0) * (0.4 + 0.6 * max(dot(n, uRimDir), 0.0));
    light += uRimColor * (uRimIntensity * rim);

    // Depth shading: far areas darker + cavity term (darker where neighbours are nearer).
    float k = 6.0;
    float avg = 0.25 * (texture2D(uDepthMap, vUv + vec2(uTexel.x * k, 0.0)).r +
                        texture2D(uDepthMap, vUv - vec2(uTexel.x * k, 0.0)).r +
                        texture2D(uDepthMap, vUv + vec2(0.0, uTexel.y * k)).r +
                        texture2D(uDepthMap, vUv - vec2(0.0, uTexel.y * k)).r);
    float cavity = clamp((avg - d) * 8.0, 0.0, 1.0);
    float shade = 1.0 - uDepthShading * (0.35 * (1.0 - d) + 0.5 * cavity);

    col = tex.rgb * light * shade * uExposure;
  }

  gl_FragColor = vec4(col, alpha);
#include <colorspace_fragment>
}
`;

export const GRID_VERTEX = /* glsl */ `
attribute vec4 color;
varying vec4 vColor;
void main() {
  vColor = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const GRID_FRAGMENT = /* glsl */ `
varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
#include <colorspace_fragment>
}
`;
