/**
 * Segmentation mask refinement: invert → threshold → grow/shrink → island removal (hard, binary stage),
 * then feather + edge snapping (soft stage). The two stages are split so that changing the feather
 * does not invalidate the inpainting work that only depends on the binary mask.
 */
import type { SegmentationSettings } from '../core/types';
import { gaussianBlur } from './blur';
import { removeSmallRegions } from './components';
import { guidedFilter } from './guided';
import { dilateBinary, erodeBinary } from './morphology';

export interface BinaryMask {
  /** 1 = foreground. */
  bin: Uint8Array;
  /** Fraction of pixels that are foreground, 0..1. */
  coverage: number;
}

/** Hard foreground mask from the raw model output. */
export function refineBinaryMask(raw: Float32Array, w: number, h: number, s: SegmentationSettings): BinaryMask {
  const n = w * h;
  let bin: Uint8Array = new Uint8Array(n);
  const t = s.threshold;
  if (s.invert) for (let i = 0; i < n; i++) bin[i] = 1 - raw[i]! >= t ? 1 : 0;
  else for (let i = 0; i < n; i++) bin[i] = raw[i]! >= t ? 1 : 0;

  if (s.dilate > 0) bin = dilateBinary(bin, w, h, s.dilate);
  else if (s.dilate < 0) bin = erodeBinary(bin, w, h, -s.dilate);

  const minArea = Math.max(0, s.minIslandArea) * n;
  let count = 0;
  if (minArea > 1) count = removeSmallRegions(bin, w, h, minArea);
  else for (let i = 0; i < n; i++) count += bin[i]!;
  return { bin, coverage: count / n };
}

/**
 * Soft alpha from the binary mask: Gaussian feather, then a gentle guided-filter pass so the transition
 * snaps to strong image edges (cheap matting-style refinement).
 *
 * @param guide luma of the source image, 0..1
 */
export function softenMask(bin: Uint8Array, guide: Float32Array, w: number, h: number, feather: number): Float32Array {
  const n = w * h;
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) alpha[i] = bin[i]!;
  if (feather <= 0.05) return alpha;

  const blurred = gaussianBlur(alpha, w, h, feather * 0.5);
  const snapped = guidedFilter(guide, blurred, w, h, Math.max(2, Math.round(feather)), 0.02);
  for (let i = 0; i < n; i++) {
    const v = 0.5 * blurred[i]! + 0.5 * snapped[i]!;
    blurred[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return blurred;
}
