/**
 * Background reconstruction: removes the foreground from the source image by filling the (grown) hole with
 * a push-pull interpolation, optional softening, and a touch of synthesised grain so the fill does not look
 * plasticky next to photographic texture. The same hole is used to fill the depth map so the background
 * mesh has no foreground-shaped bump.
 */
import { gaussianBlur, gaussianBlurSmooth } from './blur';
import { dilateBinary } from './morphology';
import { clamp01, lumaOf, rgbaToRgbFloat } from './pixels';
import { pushPullFill } from './pushpull';

export interface HoleInfo {
  /** 1 where the background must be synthesised. */
  hole: Uint8Array;
  /** Feathered hole 0..1 used to blend the fill into the source. */
  blend: Float32Array;
}

/** Grows the foreground mask by `padding` px to cover halos, and prepares a soft blend weight. */
export function buildHole(bin: Uint8Array, w: number, h: number, padding: number, softness: number): HoleInfo {
  const hole = dilateBinary(bin, w, h, Math.max(0, padding));
  const n = w * h;
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = hole[i]!;
  const blur = gaussianBlur(f, w, h, 1.2 + softness * 2);
  // Reach full opacity at the hole boundary instead of 50 %.
  for (let i = 0; i < n; i++) blur[i] = clamp01(blur[i]! * 1.5);
  return { hole, blend: blur };
}

/** Mean clipped pixel-to-pixel luma difference over valid (non-hole) pixels: a robust grain estimate (0..1 units). */
function estimateNoise(luma: Float32Array, hole: Uint8Array, w: number, h: number): number {
  let sum = 0;
  let cnt = 0;
  for (let y = 0; y < h; y += 3) {
    for (let x = 0; x < w - 1; x += 3) {
      const i = y * w + x;
      if (hole[i] || hole[i + 1]) continue;
      sum += Math.min(Math.abs(luma[i + 1]! - luma[i]!), 0.08);
      cnt++;
    }
  }
  return cnt ? sum / cnt : 0;
}

/** Cheap integer hash to [-1, 1]. */
function hashNoise(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return ((h & 0xffff) / 0xffff) * 2 - 1;
}

/**
 * @returns RGBA bytes (alpha 255) of the source with the hole filled.
 */
export function inpaintBackground(
  source: Uint8ClampedArray,
  info: HoleInfo,
  w: number,
  h: number,
  softness: number,
): Uint8ClampedArray {
  const n = w * h;
  const { hole, blend } = info;
  const rgb = rgbaToRgbFloat(source, n);
  const weight = new Float32Array(n);
  for (let i = 0; i < n; i++) weight[i] = hole[i] ? 0 : 1;

  let fill = pushPullFill(rgb, weight, w, h, 3);
  if (softness > 0.02) fill = gaussianBlurSmooth(fill, w, h, softness * Math.max(1.5, 0.008 * Math.max(w, h)), 3);

  const amp = Math.min(0.03, estimateNoise(lumaOf(source, n), hole, w, h) * 0.8) * (1 - 0.6 * softness);
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const b = blend[i]!;
    const o = i * 4;
    if (b <= 0) {
      out[o] = source[o]!;
      out[o + 1] = source[o + 1]!;
      out[o + 2] = source[o + 2]!;
      out[o + 3] = 255;
      continue;
    }
    let nz = 0;
    if (amp > 0.0005) nz = hashNoise(i % w, (i / w) | 0, 7) * amp * b;
    for (let c = 0; c < 3; c++) {
      const v = rgb[i * 3 + c]! * (1 - b) + fill[i * 3 + c]! * b + nz;
      out[o + c] = v * 255 + 0.5;
    }
    out[o + 3] = 255;
  }
  return out;
}

/** Depth map for the background layer: the foreground region is replaced by interpolated background depth. */
export function inpaintDepth(depth: Float32Array, info: HoleInfo, w: number, h: number): Float32Array {
  const n = w * h;
  const weight = new Float32Array(n);
  for (let i = 0; i < n; i++) weight[i] = info.hole[i] ? 0 : 1;
  const fill = pushPullFill(depth, weight, w, h, 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const b = info.blend[i]!;
    out[i] = depth[i]! * (1 - b) + fill[i]! * b;
  }
  return out;
}
