/**
 * U²-Net / U²-NetP pre- and post-processing (pure TypedArray code, runs inside the inference worker).
 *
 * Pre:  stretch to S×S (S = 320), divide by the image maximum (as in the reference implementation),
 *       ImageNet mean/std, NCHW float32.
 * Post: d0 side-output (already sigmoid) → min-max normalise → bilinear upsample to working resolution.
 */
import { minMaxNormalize } from '../imaging/normalize';
import { resample } from '../imaging/resample';
import type { SegmentationModelSpec } from './models';

/** Builds the [1,3,S,S] input tensor data. */
export function prepareSegmentationInput(rgba: Uint8ClampedArray, w: number, h: number, spec: SegmentationModelSpec): Float32Array {
  const S = spec.inputSize;
  const small = resample(rgba, w, h, S, S, 4); // 0..255
  const plane = S * S;
  let max = 1e-6;
  for (let i = 0; i < plane; i++) {
    const o = i * 4;
    max = Math.max(max, small[o]!, small[o + 1]!, small[o + 2]!);
  }
  const inv = 1 / max;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const o = i * 4;
    for (let c = 0; c < 3; c++) out[c * plane + i] = (small[o + c]! * inv - spec.mean[c]!) / spec.std[c]!;
  }
  return out;
}

/** Turns the raw network output (S×S) into a 0..1 mask at working resolution. */
export function postprocessSegmentation(output: Float32Array, spec: SegmentationModelSpec, w: number, h: number): Float32Array {
  const S = spec.inputSize;
  if (output.length < S * S) throw new Error(`Unexpected segmentation output size ${output.length}`);
  const mask = output.slice(0, S * S);
  minMaxNormalize(mask);
  return resample(mask, S, S, w, h, 1);
}
