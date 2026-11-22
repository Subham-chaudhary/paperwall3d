/**
 * U²-Net / U²-NetP pre- and post-processing and the multi-pass mask predictor (pure TypedArray code, runs inside
 * the inference worker; the model call itself is injected so this stays testable).
 *
 * One pass: stretch to S×S (S = 320), divide by the image maximum (as in the reference implementation),
 *           ImageNet mean/std, NCHW float32 -> d0 side-output (already sigmoid) -> bilinear upsample, clip 0..1.
 * flip_avg: also run the mirrored image, flip that output back, average.
 * refine:   bbox of prob > 0.5 padded 15 %, crop the photo, run again (object gets the full 320×320), paste back.
 *
 * The result is the raw probability map; min-max normalisation and thresholding happen in reconstruct.
 */
import { resample } from '../imaging/resample';
import type { SegmentationModelSpec } from './models';

/** Runs the network on one [1,3,S,S] input and returns the S*S sigmoid map. */
export type SegmentationRunner = (input: Float32Array) => Promise<Float32Array>;

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

/** Mirrors every row of `channels` planes of an S×S image (new array). Its own inverse. */
export function mirrorPlanes(data: Float32Array, S: number, channels: number): Float32Array {
  const out = new Float32Array(data.length);
  for (let c = 0; c < channels; c++) {
    for (let y = 0; y < S; y++) {
      const row = (c * S + y) * S;
      for (let x = 0; x < S; x++) out[row + x] = data[row + S - 1 - x]!;
    }
  }
  return out;
}

export interface MaskOptions {
  flipAvg: boolean;
  refine: boolean;
  /** Called before each network pass with a short description ("zoom pass", ...). */
  onPass?: (label: string) => void;
}

/** Crops a rectangle out of an RGBA image. */
function cropRgba(rgba: Uint8ClampedArray, w: number, x0: number, y0: number, cw: number, ch: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const s = ((y0 + y) * w + x0) * 4;
    out.set(rgba.subarray(s, s + cw * 4), y * cw * 4);
  }
  return out;
}

async function onePass(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  spec: SegmentationModelSpec,
  run: SegmentationRunner,
  flipAvg: boolean,
): Promise<Float32Array> {
  const S = spec.inputSize;
  const input = prepareSegmentationInput(rgba, w, h, spec);
  const first = await run(input);
  if (first.length < S * S) throw new Error(`Unexpected segmentation output size ${first.length}`);
  const prob = first.slice(0, S * S);
  if (flipAvg) {
    const second = await run(mirrorPlanes(input, S, 3));
    if (second.length < S * S) throw new Error(`Unexpected segmentation output size ${second.length}`);
    const back = mirrorPlanes(second.subarray(0, S * S), S, 1);
    for (let i = 0; i < prob.length; i++) prob[i] = (prob[i]! + back[i]!) * 0.5;
  }
  const up = resample(prob, S, S, w, h, 1);
  for (let i = 0; i < up.length; i++) up[i] = up[i]! < 0 ? 0 : up[i]! > 1 ? 1 : up[i]!;
  return up;
}

/** Object probability map 0..1 at the image's resolution. */
export async function predictMask(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  spec: SegmentationModelSpec,
  run: SegmentationRunner,
  opts: MaskOptions,
): Promise<Float32Array> {
  const prob = await onePass(rgba, w, h, spec, run, opts.flipAvg);
  if (!opts.refine) return prob;

  let xMin = w;
  let xMax = -1;
  let yMin = h;
  let yMax = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (prob[y * w + x]! > 0.5) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
  }
  if (xMax < 0) return prob; // first pass found nothing: nothing to zoom into

  const padX = Math.floor((xMax - xMin) * 0.15);
  const padY = Math.floor((yMax - yMin) * 0.15);
  const x0 = Math.max(0, xMin - padX);
  const x1 = Math.min(w, xMax + 1 + padX);
  const y0 = Math.max(0, yMin - padY);
  const y1 = Math.min(h, yMax + 1 + padY);
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw < 2 || ch < 2) return prob;

  opts.onPass?.('zoom pass');
  const crop = await onePass(cropRgba(rgba, w, x0, y0, cw, ch), cw, ch, spec, run, opts.flipAvg);
  for (let y = 0; y < ch; y++) prob.set(crop.subarray(y * cw, (y + 1) * cw), (y0 + y) * w + x0);
  return prob;
}
