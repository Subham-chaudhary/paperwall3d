/**
 * Layer construction (2.5dwallpp `build_layers`): background with the object inpainted out, its depth, and the
 * defringed foreground cut-out.
 *
 * Inpainting runs on a downscaled copy (<= 800 px long edge, like the reference) with a push-pull fill, and is
 * composited back at full resolution through a soft (Gaussian) hole mask so untouched pixels stay sharp. Only the
 * padded bounding box of the hole is touched at full resolution, and the downscaled source is computed once per image.
 */
import { gaussianBlur } from './blur';
import { alphaBox, cropBinary, pasteCrop, type Box } from './crop';
import { dilateBinary, erodeBinary, nearestSite } from './morphology';
import { pushPullFill } from './pushpull';
import { resample } from './resample';

export const INPAINT_MAX_SIDE = 800;
/** Hole = (alpha > 0.01) dilated by ~9x9 (radius 4 disc). */
const HOLE_RADIUS = 4;
const HOLE_BLEND_SIGMA = 2;
/** Crop padding: hole radius + several blend sigmas. */
const HOLE_PAD = HOLE_RADIUS + 12;

/** Per-image constants of the inpainter (independent of the mask). */
export interface InpaintSource {
  w: number;
  h: number;
  /** Working size of the fill. */
  sw: number;
  sh: number;
  /** Source RGB 0..1 at working size, interleaved. */
  rgbSmall: Float32Array;
  /** Amplitude (0..1 units) of the synthetic grain added inside the hole. */
  grain: number;
}

export function inpaintSize(w: number, h: number): { sw: number; sh: number } {
  const s = Math.min(1, INPAINT_MAX_SIDE / Math.max(w, h));
  return { sw: Math.max(1, Math.round(w * s)), sh: Math.max(1, Math.round(h * s)) };
}

export function prepareInpaintSource(source: Uint8ClampedArray, luma: Float32Array, w: number, h: number): InpaintSource {
  const { sw, sh } = inpaintSize(w, h);
  const small = sw === w && sh === h ? null : resample(source, w, h, sw, sh, 4);
  const rgbSmall = new Float32Array(sw * sh * 3);
  for (let i = 0; i < sw * sh; i++) {
    for (let c = 0; c < 3; c++) rgbSmall[i * 3 + c] = (small ? small[i * 4 + c]! : source[i * 4 + c]!) / 255;
  }
  return { w, h, sw, sh, rgbSmall, grain: Math.min(0.03, estimateNoise(luma, w, h) * 0.8) * 0.7 };
}

export interface HoleInfo {
  w: number;
  h: number;
  /** Padded bounding box of the hole, or null when the mask is empty. */
  box: Box | null;
  /** Full-res hole, 1 = to be synthesised (only set inside `box`). */
  hole: Uint8Array;
  /** Full-res soft blend weight 0..1 (Gaussian of the hole; zero outside `box`). */
  soft: Float32Array;
  sw: number;
  sh: number;
  /** Validity weight at working size: 0 inside the hole, 1 elsewhere. */
  validSmall: Float32Array;
  /** False when nothing valid is left to copy colours from. */
  hasValid: boolean;
}

export function buildHole(alpha: Float32Array, w: number, h: number): HoleInfo {
  const n = w * h;
  const { sw, sh } = inpaintSize(w, h);
  const hole = new Uint8Array(n);
  const soft = new Float32Array(n);
  const box = alphaBox(alpha, w, h, 0.01, HOLE_PAD);
  if (box) {
    const cw = box.x1 - box.x0;
    const ch = box.y1 - box.y0;
    const holeC = dilateBinary(cropBinary(alpha, w, box, 0.01), cw, ch, HOLE_RADIUS);
    const holeF = new Float32Array(holeC.length);
    for (let i = 0; i < holeF.length; i++) holeF[i] = holeC[i]!;
    pasteCrop(hole, w, box, holeC);
    pasteCrop(soft, w, box, gaussianBlur(holeF, cw, ch, HOLE_BLEND_SIGMA));
  }

  // A working-size pixel is invalid when any of 4 samples of its footprint is in the hole (never sample colours
  // from the object's edge).
  const validSmall = new Float32Array(sw * sh);
  const fx = w / sw;
  const fy = h / sh;
  let valid = 0;
  for (let y = 0; y < sh; y++) {
    const ya = Math.min(h - 1, Math.floor((y + 0.25) * fy));
    const yb = Math.min(h - 1, Math.floor((y + 0.75) * fy));
    for (let x = 0; x < sw; x++) {
      const xa = Math.min(w - 1, Math.floor((x + 0.25) * fx));
      const xb = Math.min(w - 1, Math.floor((x + 0.75) * fx));
      const inHole = hole[ya * w + xa]! | hole[ya * w + xb]! | hole[yb * w + xa]! | hole[yb * w + xb]!;
      validSmall[y * sw + x] = inHole ? 0 : 1;
      valid += inHole ? 0 : 1;
    }
  }
  return { w, h, box, hole, soft, sw, sh, validSmall, hasValid: valid > 0 };
}

/** Cheap integer hash to [-1, 1]. */
function hashNoise(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + 1274126177 * 7;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return ((h & 0xffff) / 0xffff) * 2 - 1;
}

/** Mean clipped pixel-to-pixel luma difference (subsampled): a robust grain estimate (0..1 units). */
function estimateNoise(luma: Float32Array, w: number, h: number): number {
  let sum = 0;
  let cnt = 0;
  for (let y = 0; y < h; y += 3) {
    for (let x = 0; x < w - 1; x += 3) {
      const i = y * w + x;
      sum += Math.min(Math.abs(luma[i + 1]! - luma[i]!), 0.08);
      cnt++;
    }
  }
  return cnt ? sum / cnt : 0;
}

/** Bilinear lookup table from full-res coordinates to a working-size grid (half-pixel centres). */
function axisTaps(full: number, small: number, from: number, to: number): { i0: Int32Array; i1: Int32Array; t: Float32Array } {
  const len = to - from;
  const i0 = new Int32Array(len);
  const i1 = new Int32Array(len);
  const t = new Float32Array(len);
  const scale = small / full;
  for (let k = 0; k < len; k++) {
    const f = (from + k + 0.5) * scale - 0.5;
    const fl = Math.floor(f);
    t[k] = f - fl;
    i0[k] = Math.min(Math.max(fl, 0), small - 1);
    i1[k] = Math.min(Math.max(fl + 1, 0), small - 1);
  }
  return { i0, i1, t };
}

/**
 * Fills the hole at working size, then calls `emit(pixelIndex, blend, value[0..channels))` for every pixel of the
 * hole's box whose blend weight is non-zero, with `value` bilinearly upsampled from the fill.
 */
function forEachFilled(
  smallData: Float32Array,
  info: HoleInfo,
  channels: number,
  emit: (i: number, blend: number, value: Float32Array) => void,
): void {
  const { w, h, sw, sh, box, soft, validSmall } = info;
  if (!box) return;
  const est = pushPullFill(smallData, validSmall, sw, sh, channels);
  const ax = axisTaps(w, sw, box.x0, box.x1);
  const ay = axisTaps(h, sh, box.y0, box.y1);
  const v = new Float32Array(channels);
  for (let y = box.y0; y < box.y1; y++) {
    const ky = y - box.y0;
    const r0 = ay.i0[ky]! * sw;
    const r1 = ay.i1[ky]! * sw;
    const ty = ay.t[ky]!;
    for (let x = box.x0; x < box.x1; x++) {
      const i = y * w + x;
      const b = soft[i]!;
      if (b <= 0.001) continue;
      const kx = x - box.x0;
      const tx = ax.t[kx]!;
      const a = (r0 + ax.i0[kx]!) * channels;
      const bb = (r0 + ax.i1[kx]!) * channels;
      const c = (r1 + ax.i0[kx]!) * channels;
      const d = (r1 + ax.i1[kx]!) * channels;
      for (let ch = 0; ch < channels; ch++) {
        const top = est[a + ch]! * (1 - tx) + est[bb + ch]! * tx;
        const bot = est[c + ch]! * (1 - tx) + est[d + ch]! * tx;
        v[ch] = top * (1 - ty) + bot * ty;
      }
      emit(i, b, v);
    }
  }
}

/** Source colours with the hole inpainted. RGBA bytes, alpha 255. */
export function inpaintColor(source: Uint8ClampedArray, src: InpaintSource, info: HoleInfo): Uint8ClampedArray {
  const { w } = info;
  const out = new Uint8ClampedArray(source.length);
  out.set(source);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  if (!info.hasValid) return out;
  const amp = src.grain;
  // A little synthetic grain keeps the fill from looking plasticky next to photographic texture.
  forEachFilled(src.rgbSmall, info, 3, (i, b, v) => {
    const nz = amp > 0.0005 ? hashNoise(i % w, (i / w) | 0) * amp * b : 0;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = source[i * 4 + c]! * (1 - b) + (v[c]! + nz) * b * 255 + 0.5;
  });
  return out;
}

/** Whole-image depth with the hole inpainted. */
export function inpaintDepth(depth: Float32Array, info: HoleInfo): Float32Array {
  const out = depth.slice();
  if (!info.hasValid) return out;
  const { w, h, sw, sh } = info;
  const small = sw === w && sh === h ? depth : resample(depth, w, h, sw, sh, 1);
  forEachFilled(small, info, 1, (i, b, v) => {
    out[i] = depth[i]! * (1 - b) + v[0]! * b;
  });
  return out;
}

/**
 * Foreground RGBA. The cut-out's edge pixels still hold background colour (a pale outline once the object moves),
 * so every pixel with alpha > 0 outside the core (mask eroded by `radius` px) takes the nearest colour from the core.
 */
export function buildForeground(source: Uint8ClampedArray, alpha: Float32Array, w: number, h: number, radius: number): Uint8ClampedArray {
  const n = w * h;
  const out = new Uint8ClampedArray(n * 4);
  out.set(source);
  const box = radius > 0 ? alphaBox(alpha, w, h, 0, 4) : null;
  let core: Uint8Array | null = null;
  let nearest: Int32Array | null = null;
  let cw = 0;
  if (box) {
    cw = box.x1 - box.x0;
    const ch = box.y1 - box.y0;
    const eroded = erodeBinary(cropBinary(alpha, w, box, 0.5), cw, ch, radius);
    let c = 0;
    for (let i = 0; i < eroded.length; i++) c += eroded[i]!;
    if (c >= 16) {
      core = eroded;
      nearest = nearestSite(eroded, cw, ch);
    }
  }
  for (let i = 0; i < n; i++) out[i * 4 + 3] = alpha[i]! * 255 + 0.5;
  if (box && core && nearest) {
    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) {
        const i = y * w + x;
        const k = (y - box.y0) * cw + (x - box.x0);
        if (alpha[i]! > 0 && !core[k]) {
          const s = nearest[k]!;
          const sx = s % cw;
          const sy = (s - sx) / cw;
          const so = ((box.y0 + sy) * w + box.x0 + sx) * 4;
          out[i * 4] = source[so]!;
          out[i * 4 + 1] = source[so + 1]!;
          out[i * 4 + 2] = source[so + 2]!;
        }
      }
    }
  }
  return out;
}
