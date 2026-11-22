/**
 * Stage 1 post-processing: model probability map -> final object alpha (2.5dwallpp `build_mask`).
 *
 *   raw prob -> [min-max normalise] -> threshold -> [depth assist] -> drop small blobs -> click-pick / largest-only
 *            -> fill holes -> invert -> grow/shrink          (hard, binary stage)
 *            -> gaussian feather                            (soft stage)
 */
import type { MaskSettings } from '../core/types';
import { gaussianBlur } from './blur';
import { fillHoles, keepComponents, labelComponents, largestBlob, pickBlob, removeSmallBlobs } from './components';
import { dilateBinary, erodeBinary } from './morphology';
import { minMaxNormalize } from './normalize';

/** Settings that shape the binary mask (everything except the feather). */
export type BinaryMaskParams = Pick<
  MaskSettings,
  'mask_norm' | 'thresh' | 'depth_assist' | 'min_area' | 'largest_only' | 'fill_holes' | 'mask_invert' | 'grow' | 'click'
>;

/** Otsu threshold of an 8-bit image: pixels > t form the "near" class. */
export function otsuThreshold(d8: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < d8.length; i++) hist[d8[i]!]!++;
  const total = d8.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t]!;
  let wB = 0;
  let sumB = 0;
  let best = -1;
  let bestT = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      bestT = t;
    }
  }
  return bestT;
}

/** 5x5 square morphological open (erode then dilate); the border does not erode. */
function openSquare5(bin: Uint8Array, w: number, h: number): Uint8Array {
  return squareFilter(squareFilter(bin, w, h, 2, true), w, h, 2, false);
}

/** Separable (2r+1)² min (erode) or max (dilate) filter on a binary mask, out-of-image samples ignored. */
function squareFilter(src: Uint8Array, w: number, h: number, r: number, erode: boolean): Uint8Array {
  const tmp = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = erode ? 1 : 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) {
        const s = src[y * w + k]!;
        if (erode ? !s : s) {
          v = erode ? 0 : 1;
          break;
        }
      }
      tmp[y * w + x] = v;
    }
  }
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = erode ? 1 : 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) {
        const s = tmp[k * w + x]!;
        if (erode ? !s : s) {
          v = erode ? 0 : 1;
          break;
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/**
 * Grows `sel` over the near-depth regions it touches (Otsu on depth shifted by (thresh - 0.5)).
 * Off by default: it floods into ground planes.
 */
function depthAssist(
  sel: Uint8Array,
  depth: Float32Array,
  w: number,
  h: number,
  thresh: number,
  click: readonly [number, number] | null,
): Uint8Array {
  const n = w * h;
  const d8 = new Uint8Array(n);
  for (let i = 0; i < n; i++) d8[i] = Math.min(255, Math.max(0, Math.floor(depth[i]! * 255 + 0.5)));
  const otsu = otsuThreshold(d8);
  const t = Math.min(254, Math.max(1, Math.round(otsu + (thresh - 0.5) * 255)));
  const rough = new Uint8Array(n);
  for (let i = 0; i < n; i++) rough[i] = d8[i]! > t ? 1 : 0;
  const near = openSquare5(rough, w, h);

  const lab = labelComponents(near, w, h);
  const keep = new Uint8Array(lab.areas.length);
  for (let i = 0; i < n; i++) if (sel[i] && near[i]) keep[lab.labels[i]!] = 1;
  const grown = keepComponents(lab, keep);
  if (click) {
    const picked = pickBlob(near, w, h, click);
    for (let i = 0; i < n; i++) if (picked[i]) grown[i] = 1;
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = sel[i] || grown[i] ? 1 : 0;
  return out;
}

/**
 * Hard object mask (1 = object).
 * @param depth finished depth BEFORE depth_invert; only read when `depth_assist` is on.
 */
export function buildBinaryMask(
  rawProb: Float32Array,
  depth: Float32Array | null,
  w: number,
  h: number,
  p: BinaryMaskParams,
): Uint8Array {
  const n = w * h;
  let prob = rawProb;
  if (p.mask_norm) {
    prob = rawProb.slice();
    minMaxNormalize(prob);
  }
  let sel: Uint8Array = new Uint8Array(n);
  for (let i = 0; i < n; i++) sel[i] = prob[i]! > p.thresh ? 1 : 0;

  if (p.depth_assist && depth) sel = depthAssist(sel, depth, w, h, p.thresh, p.click);

  if (p.min_area > 0) sel = removeSmallBlobs(sel, w, h, (p.min_area / 100) * n);
  if (p.click) sel = pickBlob(sel, w, h, p.click);
  else if (p.largest_only) sel = largestBlob(sel, w, h);

  if (p.fill_holes) sel = fillHoles(sel, w, h);
  if (p.mask_invert) {
    const inv = new Uint8Array(n);
    for (let i = 0; i < n; i++) inv[i] = sel[i] ? 0 : 1;
    sel = inv;
  }

  const k = Math.round(Math.abs(p.grow));
  if (k > 0) sel = p.grow > 0 ? dilateBinary(sel, w, h, k) : erodeBinary(sel, w, h, k);
  return sel;
}

/** Alpha 0..1: the binary mask blurred by a Gaussian of sigma `feather` px. */
export function featherMask(bin: Uint8Array, w: number, h: number, feather: number): Float32Array {
  const alpha = new Float32Array(bin.length);
  for (let i = 0; i < alpha.length; i++) alpha[i] = bin[i]!;
  if (feather <= 0.05) return alpha;
  const out = gaussianBlur(alpha, w, h, feather);
  for (let i = 0; i < out.length; i++) out[i] = out[i]! < 0 ? 0 : out[i]! > 1 ? 1 : out[i]!;
  return out;
}
