/**
 * HD finalisation of the colour layers (output resolution > processing resolution).
 *
 * The maps and the mask are refined at the processing size; the colour layers the user sees and exports come from
 * the picture's own pixels (up to 4K). Everything here works inside the object's padded bounding box and keeps the
 * big buffers as Uint8, so a 3840x2560 frame needs no full-frame Float32 temporary:
 *
 *   alpha   fast guided filter (He & Sun): the coefficients a, b are solved at processing size with the processing
 *           luminance as guide; they are bilinearly upsampled and applied to the HD luminance, so edges snap to the
 *           real HD edges at O(HD pixels). The result is gated to the neighbourhood of the processing mask and
 *           blended toward the plain bilinear upsample where the guide is flat (no texture copying).
 *   fg      HD colours; in the edge band (and a few pixels beyond it) the colour of the nearest core pixel is taken
 *           from the HD image (displaced by the processing-resolution nearest-site vector), so no background colour
 *           survives at the rim and bilinear/mip filtering has no pale or dark fringe.
 *   bg      the object's hole is filled at <= 800 px (push-pull), bilinearly upsampled and composited into the HD
 *           source only inside the soft hole; every other pixel is the untouched HD source.
 */
import { boxBlur } from './blur';
import { alphaBox, type Box } from './crop';
import { axisTaps, estimateNoise, hashNoise, type Defringe, type HoleInfo } from './layers';

/** Guided-filter window radius in processing pixels, and regularisation (variance of luma 0..1). */
export const GUIDE_RADIUS = 3;
export const GUIDE_EPS = 1e-3;
/** The HD alpha may deviate from the bilinear upsample only within this many processing px of the mask's edge band. */
export const GATE_RADIUS = 3;
/** Crop padding at processing size (guide window + gate + margin). */
export const HD_BOX_PAD = GUIDE_RADIUS + GATE_RADIUS + 2;
/** Where the processing alpha is nearly constant (hi - lo below this) the HD alpha is the plain bilinear upsample. */
const FLAT = 0.02;

const CH = 6; // a, b, conf, lo, hi, alpha

export interface AlphaGuide {
  /** Processing-size crop. */
  box: Box;
  bw: number;
  bh: number;
  /** Interleaved per crop pixel: a, b, confidence, local min alpha, local max alpha, alpha. */
  coef: Float32Array;
}

/** Separable window min and max (edge-clamped) of radius `g`. */
function windowMinMax(src: Float32Array, w: number, h: number, g: number): { lo: Float32Array; hi: Float32Array } {
  const tLo = new Float32Array(w * h);
  const tHi = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let lo = 2;
      let hi = -1;
      const a = Math.max(0, x - g);
      const b = Math.min(w - 1, x + g);
      for (let k = a; k <= b; k++) {
        const v = src[row + k]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      tLo[row + x] = lo;
      tHi[row + x] = hi;
    }
  }
  const lo = new Float32Array(w * h);
  const hi = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const a = Math.max(0, y - g);
    const b = Math.min(h - 1, y + g);
    for (let x = 0; x < w; x++) {
      let l = 2;
      let u = -1;
      for (let k = a; k <= b; k++) {
        const i = k * w + x;
        if (tLo[i]! < l) l = tLo[i]!;
        if (tHi[i]! > u) u = tHi[i]!;
      }
      lo[y * w + x] = l;
      hi[y * w + x] = u;
    }
  }
  return { lo, hi };
}

/**
 * Processing-size half of the fast guided filter, restricted to the object's padded box. Null when the mask is empty.
 * `luma` is the processing-size guide (0..1), `alpha` the final mask.
 */
export function buildAlphaGuide(
  alpha: Float32Array,
  luma: Float32Array,
  w: number,
  h: number,
  r = GUIDE_RADIUS,
  eps = GUIDE_EPS,
  gate = GATE_RADIUS,
): AlphaGuide | null {
  const box = alphaBox(alpha, w, h, 0, r + gate + 2);
  if (!box) return null;
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  const n = bw * bh;
  const I = new Float32Array(n);
  const p = new Float32Array(n);
  for (let y = 0; y < bh; y++) {
    const s = (box.y0 + y) * w + box.x0;
    I.set(luma.subarray(s, s + bw), y * bw);
    p.set(alpha.subarray(s, s + bw), y * bw);
  }
  const Ip = new Float32Array(n);
  const II = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    Ip[i] = I[i]! * p[i]!;
    II[i] = I[i]! * I[i]!;
  }
  const mI = boxBlur(I, bw, bh, r);
  const mp = boxBlur(p, bw, bh, r);
  const mIp = boxBlur(Ip, bw, bh, r);
  const mII = boxBlur(II, bw, bh, r);
  const abc = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const varI = Math.max(0, mII[i]! - mI[i]! * mI[i]!);
    const cov = mIp[i]! - mI[i]! * mp[i]!;
    const a = cov / (varI + eps);
    abc[i * 3] = a;
    abc[i * 3 + 1] = mp[i]! - a * mI[i]!;
    abc[i * 3 + 2] = varI / (varI + eps);
  }
  const sm = boxBlur(abc, bw, bh, r, 3);
  const { lo, hi } = windowMinMax(p, bw, bh, gate);
  const coef = new Float32Array(n * CH);
  for (let i = 0; i < n; i++) {
    const o = i * CH;
    coef[o] = sm[i * 3]!;
    coef[o + 1] = sm[i * 3 + 1]!;
    coef[o + 2] = sm[i * 3 + 2]!;
    coef[o + 3] = lo[i]!;
    coef[o + 4] = hi[i]!;
    coef[o + 5] = p[i]!;
  }
  return { box, bw, bh, coef };
}

/** Bilinear taps (half-pixel centres) from HD columns/rows to a crop of the processing grid. */
function cropAxis(full: number, small: number, from: number, to: number, origin: number, len: number): { i0: Int32Array; i1: Int32Array; t: Float32Array } {
  const n = to - from;
  const i0 = new Int32Array(n);
  const i1 = new Int32Array(n);
  const t = new Float32Array(n);
  const scale = small / full;
  for (let k = 0; k < n; k++) {
    const f = (from + k + 0.5) * scale - 0.5;
    const fl = Math.floor(f);
    t[k] = f - fl;
    i0[k] = Math.min(Math.max(fl - origin, 0), len - 1);
    i1[k] = Math.min(Math.max(fl + 1 - origin, 0), len - 1);
  }
  return { i0, i1, t };
}

/** HD-pixel box covering a processing-size box. */
export function toHdBox(box: Box, w: number, h: number, W: number, H: number): Box {
  return {
    x0: Math.max(0, Math.floor((box.x0 * W) / w)),
    y0: Math.max(0, Math.floor((box.y0 * H) / h)),
    x1: Math.min(W, Math.ceil((box.x1 * W) / w)),
    y1: Math.min(H, Math.ceil((box.y1 * H) / h)),
  };
}

/** HD alpha (Uint8, full frame, zero outside the box) by guided upsampling; `hd` is the RGBA HD source. */
export function upsampleAlpha(g: AlphaGuide, hd: Uint8ClampedArray, W: number, H: number, w: number, h: number): { alpha: Uint8Array; box: Box } {
  const hb = toHdBox(g.box, w, h, W, H);
  const out = new Uint8Array(W * H);
  const { bw, bh, coef } = g;
  const ax = cropAxis(W, w, hb.x0, hb.x1, g.box.x0, bw);
  const ay = cropAxis(H, h, hb.y0, hb.y1, g.box.y0, bh);
  const kr = 0.299 / 255;
  const kg = 0.587 / 255;
  const kb = 0.114 / 255;
  for (let y = hb.y0; y < hb.y1; y++) {
    const ky = y - hb.y0;
    const r0 = ay.i0[ky]! * bw;
    const r1 = ay.i1[ky]! * bw;
    const ty = ay.t[ky]!;
    const uy = 1 - ty;
    for (let x = hb.x0; x < hb.x1; x++) {
      const kx = x - hb.x0;
      const tx = ax.t[kx]!;
      const ux = 1 - tx;
      const w00 = ux * uy;
      const w10 = tx * uy;
      const w01 = ux * ty;
      const w11 = tx * ty;
      const o00 = (r0 + ax.i0[kx]!) * CH;
      const o10 = (r0 + ax.i1[kx]!) * CH;
      const o01 = (r1 + ax.i0[kx]!) * CH;
      const o11 = (r1 + ax.i1[kx]!) * CH;
      const bil = coef[o00 + 5]! * w00 + coef[o10 + 5]! * w10 + coef[o01 + 5]! * w01 + coef[o11 + 5]! * w11;
      const lo = coef[o00 + 3]! * w00 + coef[o10 + 3]! * w10 + coef[o01 + 3]! * w01 + coef[o11 + 3]! * w11;
      const hi = coef[o00 + 4]! * w00 + coef[o10 + 4]! * w10 + coef[o01 + 4]! * w01 + coef[o11 + 4]! * w11;
      let v = bil;
      if (hi - lo > FLAT) {
        const a = coef[o00]! * w00 + coef[o10]! * w10 + coef[o01]! * w01 + coef[o11]! * w11;
        const b = coef[o00 + 1]! * w00 + coef[o10 + 1]! * w10 + coef[o01 + 1]! * w01 + coef[o11 + 1]! * w11;
        const c = coef[o00 + 2]! * w00 + coef[o10 + 2]! * w10 + coef[o01 + 2]! * w01 + coef[o11 + 2]! * w11;
        const q = (y * W + x) * 4;
        const lum = hd[q]! * kr + hd[q + 1]! * kg + hd[q + 2]! * kb;
        v = bil + c * (a * lum + b - bil);
        if (v < lo) v = lo;
        else if (v > hi) v = hi;
      }
      out[y * W + x] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0;
    }
  }
  return { alpha: out, box: hb };
}

/**
 * HD foreground RGBA: the HD source with alpha = `alpha`, and the edge band recoloured from the core.
 * `extend2` > 0 also recolours alpha-0 pixels whose nearest core pixel is within sqrt(extend2) processing px
 * (colour extension keeps filtered/mipmapped samples from picking up background colour).
 */
export function buildForegroundHd(
  hd: Uint8ClampedArray,
  W: number,
  H: number,
  alpha: Uint8Array,
  hb: Box,
  w: number,
  h: number,
  def: Defringe | null,
  extend2: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(hd);
  const n = W * H;
  for (let i = 3; i < n * 4; i += 4) out[i] = 0;
  const sx = W / w;
  const sy = H / h;
  const qx = new Int32Array(hb.x1 - hb.x0);
  for (let k = 0; k < qx.length; k++) qx[k] = Math.min(w - 1, Math.floor((hb.x0 + k + 0.5) / sx));
  for (let y = hb.y0; y < hb.y1; y++) {
    const qy = Math.min(h - 1, Math.floor((y + 0.5) / sy));
    const row = y * W;
    const kyRow = def ? qy - def.box.y0 : 0;
    const inRow = def !== null && kyRow >= 0 && kyRow < def.box.y1 - def.box.y0;
    for (let x = hb.x0; x < hb.x1; x++) {
      const a = alpha[row + x]!;
      const o = (row + x) * 4;
      out[o + 3] = a;
      if (!inRow) continue;
      const d = def!;
      const kx = qx[x - hb.x0]! - d.box.x0;
      if (kx < 0 || kx >= d.cw) continue;
      const k = kyRow * d.cw + kx;
      if (d.core[k]) continue;
      const s = d.nearest[k]!;
      const sxc = s % d.cw;
      const dx = sxc - kx;
      const dy = (s - sxc) / d.cw - kyRow;
      if (a === 0 && dx * dx + dy * dy > extend2) continue;
      let tx = x + Math.round(dx * sx);
      let ty = y + Math.round(dy * sy);
      tx = tx < 0 ? 0 : tx >= W ? W - 1 : tx;
      ty = ty < 0 ? 0 : ty >= H ? H - 1 : ty;
      const so = (ty * W + tx) * 4;
      out[o] = hd[so]!;
      out[o + 1] = hd[so + 1]!;
      out[o + 2] = hd[so + 2]!;
    }
  }
  return out;
}

/** Grain amplitude (0..1 units) for the synthetic noise inside the hole, estimated on the HD image itself. */
export function estimateGrainHd(hd: Uint8ClampedArray, W: number, H: number): number {
  const k = 1 / 255;
  const row = new Float32Array(W);
  let sum = 0;
  let cnt = 0;
  for (let y = 0; y < H; y += 3) {
    for (let x = 0; x < W; x++) {
      const q = (y * W + x) * 4;
      row[x] = (0.299 * hd[q]! + 0.587 * hd[q + 1]! + 0.114 * hd[q + 2]!) * k;
    }
    // estimateNoise subsamples every 3rd pixel of every 3rd row; feed it a single row.
    sum += estimateNoise(row, W, 1);
    cnt++;
  }
  const noise = cnt ? sum / cnt : 0;
  return Math.min(0.03, noise * 0.8) * 0.7;
}

/**
 * HD background: the HD source with the hole filled from `fill` (push-pull result at the inpaint size, RGB 0..1) and
 * blended through the soft hole mask (upsampled bilinearly from the processing-size `info.soft`).
 */
export function inpaintColorHd(
  hd: Uint8ClampedArray,
  W: number,
  H: number,
  fill: Float32Array,
  info: HoleInfo,
  grain: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(hd);
  const { box, soft, w, h, sw, sh } = info;
  if (!box) return out;
  const hb = toHdBox(box, w, h, W, H);
  const fx = axisTaps(W, sw, hb.x0, hb.x1);
  const fy = axisTaps(H, sh, hb.y0, hb.y1);
  const mx = axisTaps(W, w, hb.x0, hb.x1);
  const my = axisTaps(H, h, hb.y0, hb.y1);
  for (let y = hb.y0; y < hb.y1; y++) {
    const ky = y - hb.y0;
    const sr0 = my.i0[ky]! * w;
    const sr1 = my.i1[ky]! * w;
    const sty = my.t[ky]!;
    const fr0 = fy.i0[ky]! * sw;
    const fr1 = fy.i1[ky]! * sw;
    const fty = fy.t[ky]!;
    for (let x = hb.x0; x < hb.x1; x++) {
      const kx = x - hb.x0;
      const stx = mx.t[kx]!;
      const a0 = soft[sr0 + mx.i0[kx]!]!;
      const a1 = soft[sr0 + mx.i1[kx]!]!;
      const b0 = soft[sr1 + mx.i0[kx]!]!;
      const b1 = soft[sr1 + mx.i1[kx]!]!;
      const b = (a0 * (1 - stx) + a1 * stx) * (1 - sty) + (b0 * (1 - stx) + b1 * stx) * sty;
      if (b <= 0.001) continue;
      const tx = fx.t[kx]!;
      const p00 = (fr0 + fx.i0[kx]!) * 3;
      const p10 = (fr0 + fx.i1[kx]!) * 3;
      const p01 = (fr1 + fx.i0[kx]!) * 3;
      const p11 = (fr1 + fx.i1[kx]!) * 3;
      const nz = grain > 0.0005 ? hashNoise(x, y) * grain * b : 0;
      const o = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = fill[p00 + c]! * (1 - tx) + fill[p10 + c]! * tx;
        const bot = fill[p01 + c]! * (1 - tx) + fill[p11 + c]! * tx;
        const v = top * (1 - fty) + bot * fty;
        out[o + c] = hd[o + c]! * (1 - b) + (v + nz) * b * 255;
      }
    }
  }
  return out;
}
