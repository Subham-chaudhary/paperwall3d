/**
 * Depth Anything V2 pre- and post-processing (pure TypedArray code, runs inside the inference worker).
 *
 * Pre:  resize keeping aspect ratio so the long edge is ~518 and both sides are multiples of 14,
 *       rescale to 0..1, ImageNet mean/std, NCHW float32.
 * Post: relative inverse depth (bigger = nearer) → robust 1 %/99 % min-max → bilinear upsample to working size.
 */
import { percentileNormalize } from '../imaging/normalize';
import { resample } from '../imaging/resample';
import type { DepthModelSpec } from './models';

export interface DepthInput {
  data: Float32Array;
  width: number;
  height: number;
}

export function depthInputSize(w: number, h: number, spec: DepthModelSpec): { width: number; height: number } {
  const m = spec.multipleOf;
  const scale = spec.inputLongEdge / Math.max(w, h);
  const snap = (v: number): number => Math.max(m, Math.round((v * scale) / m) * m);
  return { width: snap(w), height: snap(h) };
}

export function prepareDepthInput(rgba: Uint8ClampedArray, w: number, h: number, spec: DepthModelSpec): DepthInput {
  const { width, height } = depthInputSize(w, h, spec);
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
 * @throws if the network produced non-finite values (broken fp16 kernels on some GPUs)
 */
export function postprocessDepth(output: Float32Array, outW: number, outH: number, w: number, h: number): Float32Array {
  const n = outW * outH;
  if (output.length < n) throw new Error(`Unexpected depth output size ${output.length}`);
  const d = output.slice(0, n);
  let finite = 0;
  for (let i = 0; i < n; i += 7) if (Number.isFinite(d[i]!)) finite++;
  if (finite < Math.ceil(n / 7) * 0.99) throw new Error('Depth model produced non-finite values');
  percentileNormalize(d, 0.01, 0.99);
  return resample(d, outW, outH, w, h, 1);
}
