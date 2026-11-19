/**
 * O(1)-per-pixel blurs: running-sum box blur (edge-clamped) and a 3-pass box approximation of a Gaussian.
 * All functions work on interleaved Float32 data with an arbitrary channel count.
 */
import { resample } from './resample';

/** Edge-clamped box blur with window (2r+1)×(2r+1). Returns a new array. */
export function boxBlur(src: Float32Array, w: number, h: number, r: number, channels = 1): Float32Array {
  const rad = Math.max(0, Math.floor(r));
  if (rad === 0) return src.slice();
  const tmp = new Float32Array(src.length);
  boxH(src, tmp, w, h, rad, channels);
  const out = new Float32Array(src.length);
  boxV(tmp, out, w, h, rad, channels);
  return out;
}

function boxH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, ch: number): void {
  const inv = 1 / (2 * r + 1);
  const last = w - 1;
  for (let y = 0; y < h; y++) {
    const rowBase = y * w;
    for (let c = 0; c < ch; c++) {
      // Window for x = 0 covers [-r, r]; indices < 0 clamp to 0.
      let acc = src[rowBase * ch + c]! * r;
      for (let k = 0; k <= r; k++) acc += src[(rowBase + Math.min(k, last)) * ch + c]!;
      for (let x = 0; x < w; x++) {
        dst[(rowBase + x) * ch + c] = acc * inv;
        const add = src[(rowBase + Math.min(x + r + 1, last)) * ch + c]!;
        const sub = src[(rowBase + Math.max(x - r, 0)) * ch + c]!;
        acc += add - sub;
      }
    }
  }
}

function boxV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, ch: number): void {
  const inv = 1 / (2 * r + 1);
  const last = h - 1;
  const rowLen = w * ch;
  const acc = new Float64Array(rowLen);
  for (let i = 0; i < rowLen; i++) acc[i] = src[i]! * r;
  for (let k = 0; k <= r; k++) {
    const row = Math.min(k, last) * rowLen;
    for (let i = 0; i < rowLen; i++) acc[i] = acc[i]! + src[row + i]!;
  }
  for (let y = 0; y < h; y++) {
    const out = y * rowLen;
    const addRow = Math.min(y + r + 1, last) * rowLen;
    const subRow = Math.max(y - r, 0) * rowLen;
    for (let i = 0; i < rowLen; i++) {
      const a = acc[i]!;
      dst[out + i] = a * inv;
      acc[i] = a + src[addRow + i]! - src[subRow + i]!;
    }
  }
}

/** Box radii whose 3-fold application approximates a Gaussian of the given sigma. */
function gaussianBoxRadii(sigma: number): [number, number, number] {
  const n = 3;
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes = [0, 1, 2].map((i) => (i < m ? wl : wu));
  return sizes.map((s) => Math.max(0, (s - 1) / 2)) as [number, number, number];
}

/** Approximate Gaussian blur (3 box passes). `sigma <= 0` returns a copy. */
export function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number, channels = 1): Float32Array {
  if (sigma <= 0.01) return src.slice();
  const radii = gaussianBoxRadii(sigma);
  let cur = src;
  for (const r of radii) cur = boxBlur(cur, w, h, r, channels);
  return cur;
}

/** Normalised convolution: blur(values·weights) / blur(weights). Where the weight sum vanishes, `fallback` is used. */
export function weightedBlur(
  values: Float32Array,
  weights: Float32Array,
  w: number,
  h: number,
  r: number,
  fallback: number,
): Float32Array {
  const n = w * h;
  const num = new Float32Array(n);
  for (let i = 0; i < n; i++) num[i] = values[i]! * weights[i]!;
  const bn = boxBlur(num, w, h, r);
  const bd = boxBlur(weights, w, h, r);
  for (let i = 0; i < n; i++) {
    const d = bd[i]!;
    bn[i] = d > 1e-5 ? bn[i]! / d : fallback;
  }
  return bn;
}

/**
 * Gaussian blur for smooth data (e.g. synthesised fills) where speed matters more than texture: for
 * sigma >= 3 it blurs at half resolution and upsamples, ~2x faster than the full-resolution blur.
 */
export function gaussianBlurSmooth(src: Float32Array, w: number, h: number, sigma: number, channels = 1): Float32Array {
  if (sigma < 3 || w < 8 || h < 8) return gaussianBlur(src, w, h, sigma, channels);
  const hw = Math.ceil(w / 2);
  const hh = Math.ceil(h / 2);
  const small = resample(src, w, h, hw, hh, channels);
  return resample(gaussianBlur(small, hw, hh, sigma / 2, channels), hw, hh, w, h, channels);
}
