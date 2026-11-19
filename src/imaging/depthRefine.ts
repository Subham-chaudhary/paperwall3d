/**
 * Depth map refinement: invert / clip / contrast / gamma (one LUT), guided edge-preserving smoothing,
 * then foreground coherence so the subject sits as a unit in front of its surroundings.
 */
import type { DepthSettings } from '../core/types';
import { weightedBlur } from './blur';
import { guidedFilter } from './guided';
import { resample } from './resample';

const LUT_SIZE = 1024;

/** Point-wise tone curve of all depth settings, sampled at LUT_SIZE+1 points. */
export function buildDepthLut(s: DepthSettings): Float32Array {
  const lut = new Float32Array(LUT_SIZE + 1);
  const near = Math.min(Math.max(s.near, 0), 0.99);
  const far = Math.min(Math.max(s.far, near + 0.01), 1);
  const gamma = Math.max(0.05, s.gamma);
  for (let i = 0; i <= LUT_SIZE; i++) {
    let d = i / LUT_SIZE;
    if (s.invert) d = 1 - d;
    d = (d - near) / (far - near);
    d = d < 0 ? 0 : d > 1 ? 1 : d;
    d = (d - 0.5) * s.contrast + 0.5;
    d = d < 0 ? 0 : d > 1 ? 1 : d;
    lut[i] = Math.pow(d, gamma);
  }
  return lut;
}

export function applyLut(src: Float32Array, lut: Float32Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const v = src[i]!;
    const f = (v < 0 ? 0 : v > 1 ? 1 : v) * LUT_SIZE;
    const i0 = Math.min(LUT_SIZE - 1, Math.floor(f));
    const t = f - i0;
    out[i] = lut[i0]! * (1 - t) + lut[i0 + 1]! * t;
  }
  return out;
}

/** How strongly in-mask depth is pulled toward its smoothed local average (0 = untouched, 1 = fully flat). */
const COHERENCE = 0.5;
/** Minimum depth gap kept between the subject and the background immediately around it. */
const FOREGROUND_MARGIN = 0.02;

/**
 * Smooths the depth inside `mask` toward its low-frequency average and guarantees it is at least as near
 * as the surrounding background. All statistics are computed at 1/4 resolution.
 */
export function makeForegroundCoherent(depth: Float32Array, mask: Float32Array, w: number, h: number): Float32Array {
  const S = 4;
  const ws = Math.max(1, Math.ceil(w / S));
  const hs = Math.max(1, Math.ceil(h / S));
  const dS = resample(depth, w, h, ws, hs);
  const mS = resample(mask, w, h, ws, hs);
  const bgS = new Float32Array(ws * hs);
  let mean = 0;
  for (let i = 0; i < bgS.length; i++) {
    bgS[i] = 1 - mS[i]!;
    mean += dS[i]!;
  }
  mean /= bgS.length;

  const r = Math.max(2, Math.round(Math.max(ws, hs) * 0.07));
  const fgBlur = resample(weightedBlur(dS, mS, ws, hs, r, mean), ws, hs, w, h);
  const bgBlur = resample(weightedBlur(dS, bgS, ws, hs, r * 2, mean), ws, hs, w, h);

  const out = new Float32Array(depth.length);
  for (let i = 0; i < out.length; i++) {
    const m = mask[i]!;
    const d = depth[i]!;
    if (m <= 0) {
      out[i] = d;
      continue;
    }
    let f = d + (fgBlur[i]! - d) * COHERENCE;
    const floor = Math.min(1, bgBlur[i]! + FOREGROUND_MARGIN);
    if (f < floor) f = floor;
    out[i] = d + (f - d) * m;
  }
  return out;
}

/**
 * Full depth refinement.
 * @param mask  refined soft foreground mask (all zeros when there is no foreground)
 * @param guide luma of the source image, 0..1
 */
export function refineDepth(
  raw: Float32Array,
  mask: Float32Array | null,
  guide: Float32Array,
  w: number,
  h: number,
  s: DepthSettings,
): Float32Array {
  let depth = applyLut(raw, buildDepthLut(s));
  if (s.smoothing >= 1) depth = guidedFilter(guide, depth, w, h, Math.round(s.smoothing), 0.004);
  if (mask) depth = makeForegroundCoherent(depth, mask, w, h);
  for (let i = 0; i < depth.length; i++) {
    const v = depth[i]!;
    depth[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return depth;
}
