/**
 * Separable image resampling on interleaved TypedArrays.
 *
 * Upscaling uses bilinear interpolation with half-pixel centers (matches canvas / GPU sampling);
 * downscaling uses exact area averaging, so large reductions (e.g. 1024 → 320 for the networks) don't alias.
 */

export type NumericArray = Float32Array | Uint8Array | Uint8ClampedArray;

interface AxisTable {
  /** First source index per destination index. */
  start: Int32Array;
  /** Number of taps per destination index. */
  count: Int32Array;
  /** Offset of the first tap weight per destination index. */
  offset: Int32Array;
  weights: Float32Array;
}

function buildAxis(srcLen: number, dstLen: number): AxisTable {
  const start = new Int32Array(dstLen);
  const count = new Int32Array(dstLen);
  const offset = new Int32Array(dstLen);
  const scale = srcLen / dstLen;
  const maxTaps = scale > 1 ? Math.ceil(scale) + 2 : 2;
  const weights = new Float32Array(dstLen * maxTaps);
  let w = 0;
  for (let i = 0; i < dstLen; i++) {
    offset[i] = w;
    if (scale > 1) {
      // Area average over [i*scale, (i+1)*scale).
      const x0 = i * scale;
      const x1 = Math.min(srcLen, (i + 1) * scale);
      const first = Math.floor(x0);
      const last = Math.min(srcLen - 1, Math.ceil(x1) - 1);
      let sum = 0;
      for (let s = first; s <= last; s++) {
        const overlap = Math.min(x1, s + 1) - Math.max(x0, s);
        weights[w++] = overlap;
        sum += overlap;
      }
      for (let k = offset[i]!; k < w; k++) weights[k] = weights[k]! / sum;
      start[i] = first;
      count[i] = last - first + 1;
    } else {
      const s = (i + 0.5) * scale - 0.5;
      const i0 = Math.floor(s);
      const t = s - i0;
      const a = Math.min(Math.max(i0, 0), srcLen - 1);
      const b = Math.min(Math.max(i0 + 1, 0), srcLen - 1);
      if (a === b) {
        weights[w++] = 1;
        start[i] = a;
        count[i] = 1;
      } else {
        weights[w++] = 1 - t;
        weights[w++] = t;
        start[i] = a;
        count[i] = 2;
      }
    }
  }
  return { start, count, offset, weights };
}

/**
 * Resamples `channels` interleaved channels from sw×sh to dw×dh. Output is always Float32 and keeps the
 * input's numeric range (0..255 stays 0..255).
 */
export function resample(src: NumericArray, sw: number, sh: number, dw: number, dh: number, channels = 1): Float32Array {
  const ax = buildAxis(sw, dw);
  const ay = buildAxis(sh, dh);
  const rowLen = dw * channels;

  // Horizontal pass: sw×sh → dw×sh.
  const tmp = new Float32Array(rowLen * sh);
  for (let y = 0; y < sh; y++) {
    const srow = y * sw * channels;
    const drow = y * rowLen;
    for (let x = 0; x < dw; x++) {
      const st = ax.start[x]!;
      const n = ax.count[x]!;
      const wo = ax.offset[x]!;
      for (let c = 0; c < channels; c++) {
        let acc = 0;
        for (let k = 0; k < n; k++) acc += src[srow + (st + k) * channels + c]! * ax.weights[wo + k]!;
        tmp[drow + x * channels + c] = acc;
      }
    }
  }

  // Vertical pass: dw×sh → dw×dh, accumulating whole rows for cache friendliness.
  const out = new Float32Array(rowLen * dh);
  for (let y = 0; y < dh; y++) {
    const st = ay.start[y]!;
    const n = ay.count[y]!;
    const wo = ay.offset[y]!;
    const drow = y * rowLen;
    for (let k = 0; k < n; k++) {
      const wgt = ay.weights[wo + k]!;
      const srow = (st + k) * rowLen;
      for (let i = 0; i < rowLen; i++) out[drow + i] = out[drow + i]! + tmp[srow + i]! * wgt;
    }
  }
  return out;
}

/** Convenience: resample a single-channel map. */
export function resizeMap(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  if (sw === dw && sh === dh) return src.slice();
  return resample(src, sw, sh, dw, dh, 1);
}
