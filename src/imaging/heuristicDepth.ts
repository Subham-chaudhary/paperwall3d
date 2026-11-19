/**
 * Offline depth estimate used when the neural model is disabled or unavailable.
 * Blend of three monocular cues, all cheap and model-free:
 *  - vertical position (lower in the frame is nearer, the ground-plane prior),
 *  - luminance (brighter is nearer, a weak atmospheric/lighting prior),
 *  - saturation (nearer objects tend to be more saturated).
 * The result is heavily blurred so the mesh stays smooth, then percentile-normalised to 0..1 (1 = near).
 */
import { gaussianBlur } from './blur';
import { percentileNormalize } from './normalize';

export function heuristicDepth(rgba: Uint8ClampedArray, w: number, h: number): Float32Array {
  const n = w * h;
  const d = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const vertical = h > 1 ? y / (h - 1) : 0.5;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r = rgba[i * 4]! / 255;
      const g = rgba[i * 4 + 1]! / 255;
      const b = rgba[i * 4 + 2]! / 255;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const mx = Math.max(r, g, b);
      const sat = mx > 1e-4 ? (mx - Math.min(r, g, b)) / mx : 0;
      d[i] = 0.55 * vertical + 0.28 * lum + 0.17 * sat;
    }
  }
  const out = gaussianBlur(d, w, h, Math.max(2, Math.max(w, h) * 0.015));
  percentileNormalize(out, 0.01, 0.99);
  return out;
}
