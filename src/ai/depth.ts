/**
 * Depth Anything V2 pre- and post-processing (pure TypedArray code, runs inside the inference worker).
 *
 * Pre:  resize keeping the aspect ratio so the SHORT side is `depth_size` (both sides multiples of 14),
 *       rescale to 0..1, ImageNet mean/std, NCHW float32.
 * Post: relative inverse depth (bigger = nearer) is only upsampled to working size. It stays raw and
 *       un-normalised: the percentile clip happens in reconstruct (depth.clip_lo / clip_hi).
 */
import { resample } from '../imaging/resample';
import type { DepthModelSpec } from './models';

export interface DepthInput {
  data: Float32Array;
  width: number;
  height: number;
}

export const DEPTH_SIZE_MIN = 252;
export const DEPTH_SIZE_MAX = 1008;

/** Network input size for an image: short side ~`size` (the long side is capped at 2x), multiples of `spec.multipleOf`. */
export function depthInputSize(w: number, h: number, size: number, spec: DepthModelSpec): { width: number; height: number } {
  const m = spec.multipleOf;
  const clamped = Math.min(DEPTH_SIZE_MAX, Math.max(DEPTH_SIZE_MIN, size));
  const scale = Math.min(clamped / Math.min(w, h), (2 * clamped) / Math.max(w, h));
  const snap = (v: number): number => Math.max(m, Math.round((v * scale) / m) * m);
  return { width: snap(w), height: snap(h) };
}

export function prepareDepthInput(rgba: Uint8ClampedArray, w: number, h: number, size: number, spec: DepthModelSpec): DepthInput {
  const { width, height } = depthInputSize(w, h, size, spec);
  const small = resample(rgba, w, h, width, height, 4);
  const plane = width * height;
  const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const o = i * 4;
    for (let c = 0; c < 3; c++) data[c * plane + i] = (small[o + c]! / 255 - spec.mean[c]!) / spec.std[c]!;
  }
  return { data, width, height };
}

/**
 * @param output     predicted_depth values, (outW × outH)
 * @returns raw depth bilinearly upsampled to w × h
 * @throws if the network produced non-finite values (broken fp16 kernels on some GPUs)
 */
export function postprocessDepth(output: Float32Array, outW: number, outH: number, w: number, h: number): Float32Array {
  const n = outW * outH;
  if (output.length < n) throw new Error(`Unexpected depth output size ${output.length}`);
  const d = output.slice(0, n);
  let finite = 0;
  for (let i = 0; i < n; i += 7) if (Number.isFinite(d[i]!)) finite++;
  if (finite < Math.ceil(n / 7) * 0.99) throw new Error('Depth model produced non-finite values');
  for (let i = 0; i < n; i++) if (!Number.isFinite(d[i]!)) d[i] = 0;
  return resample(d, outW, outH, w, h, 1);
}
