/**
 * Fast guided filter (He et al.) — an edge-preserving smoother that snaps `p` to the edges of a
 * guide image `I`. Cost is independent of the radius; for large radii the statistics are computed at a
 * reduced resolution ("fast guided filter") and the linear coefficients are upsampled.
 */
import { boxBlur } from './blur';
import { resample } from './resample';

/**
 * @param guide   single-channel guide (e.g. luma, 0..1)
 * @param input   single-channel map to filter
 * @param r       window radius in pixels
 * @param eps     regularisation (variance units of the guide, e.g. 1e-3 .. 1e-1)
 */
export function guidedFilter(guide: Float32Array, input: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  if (r < 1) return input.slice();
  const s = r >= 12 ? 4 : r >= 2 ? 2 : 1;
  const ws = s === 1 ? w : Math.max(1, Math.ceil(w / s));
  const hs = s === 1 ? h : Math.max(1, Math.ceil(h / s));
  const rs = Math.max(1, Math.round(r / s));
  const I = s === 1 ? guide : resample(guide, w, h, ws, hs);
  const p = s === 1 ? input : resample(input, w, h, ws, hs);
  const n = ws * hs;

  const Ip = new Float32Array(n);
  const II = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    Ip[i] = I[i]! * p[i]!;
    II[i] = I[i]! * I[i]!;
  }
  const mI = boxBlur(I, ws, hs, rs);
  const mp = boxBlur(p, ws, hs, rs);
  const mIp = boxBlur(Ip, ws, hs, rs);
  const mII = boxBlur(II, ws, hs, rs);

  // Pack a and b into one 2-channel buffer so a single blur / resample handles both.
  const ab = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const varI = mII[i]! - mI[i]! * mI[i]!;
    const cov = mIp[i]! - mI[i]! * mp[i]!;
    const a = cov / (varI + eps);
    ab[i * 2] = a;
    ab[i * 2 + 1] = mp[i]! - a * mI[i]!;
  }
  const mab = boxBlur(ab, ws, hs, rs, 2);
  const full = s === 1 ? mab : resample(mab, ws, hs, w, h, 2);

  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = full[i * 2]! * guide[i]! + full[i * 2 + 1]!;
  return out;
}
