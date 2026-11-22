/**
 * The 2D parallax fragment shader, shared by the in-app view (three.js, GLSL ES 3.00) and the exported HTML
 * wallpaper (raw WebGL1, GLSL ES 1.00) so the two can never drift. A port of 2.5dwallpp's viewer shader.
 *
 * For each screen pixel, find which texel of the layer is visible after the camera shift: a texel at depth d lands
 * at  screen = p + shift * (d - focus).  Ray-march from the nearest depth to the farthest and take the first surface
 * the ray meets, so near parts always hide far ones. D = uBase + depthTexture * uScale, or the constant uFlatDepth for a
 * flat layer. The march is NOT alpha-aware (skipping transparent texels leaves a striped ghost of the object edge).
 *
 * The including side defines SAMPLE_DEPTH(p) and SAMPLE_COLOR(p, uv) and declares `varying vec2 vUv`:
 *  - SAMPLE_DEPTH: depth texture lookup without derivatives;
 *  - SAMPLE_COLOR: colour lookup at the marched point `p`; `uv` is the smooth un-marched coordinate (for filter footprints).
 */

/** Upper bound of the march loop; `uSteps` (<= this) picks the actual count per frame. */
export const PARALLAX_MAX_STEPS = 48;

export const PARALLAX_FRAG_COMMON = /* glsl */ `
uniform sampler2D uColor, uDepth;
uniform vec2 uShift, uTexel, uLightDir, uPivot;
uniform float uFocus, uLight, uZoom, uIsFg, uFlat, uFlatDepth, uBase, uScale, uObjScale;
uniform int uSteps;

float D(vec2 p) { return uFlat > 0.5 ? uFlatDepth : uBase + SAMPLE_DEPTH(p).r * uScale; }

vec2 march(vec2 uv) {
  if (uFlat > 0.5 || uScale < 1e-4) {            // flat layer: one rigid shift
    float d = uFlat > 0.5 ? uFlatDepth : uBase;
    return clamp(uv - uShift * (d - uFocus), 0.0, 1.0);
  }
  float hi = uBase + uScale, lo = uBase, dL = (hi - lo) / float(uSteps);
  vec2 prevP = clamp(uv - uShift * (hi - uFocus), 0.0, 1.0);
  float prevDiff = D(prevP) - hi;                // <= 0 while the surface lies below the ray
  if (prevDiff >= 0.0) return prevP;
  for (int i = 1; i <= ${PARALLAX_MAX_STEPS}; i++) {
    if (i > uSteps) break;
    float L = hi - dL * float(i);
    vec2 p = clamp(uv - uShift * (L - uFocus), 0.0, 1.0);
    float diff = D(p) - L;                       // >= 0: the ray has reached a surface
    if (diff >= 0.0) return mix(prevP, p, prevDiff / (prevDiff - diff));   // refine inside the last step
    prevP = p; prevDiff = diff;
  }
  return prevP;                                  // nothing hit: show the farthest texel
}

void main() {
  vec2 uv = (vUv - 0.5) / uZoom + 0.5;           // zoom hides the stretched borders
  if (uIsFg > 0.5) uv = uPivot + (uv - uPivot) / uObjScale;   // object size, about the object centre
  bool outside = any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)));
  vec2 p = march(uv);
  vec4 c = SAMPLE_COLOR(p, uv);

  // subtle lighting from the depth gradient, light follows the cursor
  float gx = D(p + vec2(uTexel.x * 2.0, 0.0)) - D(p - vec2(uTexel.x * 2.0, 0.0));
  float gy = D(p + vec2(0.0, uTexel.y * 2.0)) - D(p - vec2(0.0, uTexel.y * 2.0));
  gx = clamp(gx, -0.04, 0.04); gy = clamp(gy, -0.04, 0.04);   // ignore silhouette cliffs (avoids halos)
  vec3 n = normalize(vec3(-gx * 6.0, -gy * 6.0, 1.0));
  vec3 l = normalize(vec3(uLightDir, 0.9));
  float shade = dot(n, l) - dot(vec3(0.0, 0.0, 1.0), l);
  vec3 rgb = c.rgb * (1.0 + uLight * shade * 2.0);

  float a = mix(1.0, c.a, uIsFg);
  if (outside && uIsFg > 0.5) a = 0.0;           // no edge-smearing when the object is scaled up
  gl_FragColor = vec4(rgb * a, a);               // premultiplied alpha, raw (gamma-space) values
}`;

/** Steps for a drawing buffer of this many pixels: 48, or 32 above ~4 MP. The linear refinement is kept either way. */
export const marchSteps = (pixels: number): number => (pixels > 4e6 ? 32 : PARALLAX_MAX_STEPS);
