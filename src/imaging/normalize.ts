/** Range normalisation helpers for model outputs. */

/** Linear min-max normalisation to 0..1, in place. A constant map becomes all zeros. */
export function minMaxNormalize(a: Float32Array): void {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < a.length; i++) {
    const v = a[i]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = hi - lo;
  if (!(range > 1e-12)) {
    a.fill(0);
    return;
  }
  const inv = 1 / range;
  for (let i = 0; i < a.length; i++) a[i] = (a[i]! - lo) * inv;
}

/**
 * Robust normalisation: maps the `loQ` quantile to 0 and the `hiQ` quantile to 1 (clamped), in place.
 * Uses a 2048-bin histogram, so it is O(n) and allocation-light. Non-finite values are treated as the minimum.
 */
export function percentileNormalize(a: Float32Array, loQ = 0.01, hiQ = 0.99): void {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < a.length; i++) {
    const v = a[i]!;
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!(hi - lo > 1e-12)) {
    a.fill(0);
    return;
  }
  const BINS = 2048;
  const hist = new Uint32Array(BINS);
  const scale = (BINS - 1) / (hi - lo);
  let count = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i]!;
    if (!Number.isFinite(v)) continue;
    hist[Math.floor((v - lo) * scale)]!++;
    count++;
  }
  const quantile = (q: number): number => {
    const target = q * count;
    let acc = 0;
    for (let b = 0; b < BINS; b++) {
      acc += hist[b]!;
      if (acc >= target) return lo + b / scale;
    }
    return hi;
  };
  const pLo = quantile(loQ);
  const pHi = quantile(hiQ);
  const range = pHi - pLo;
  if (!(range > 1e-12)) {
    minMaxNormalize(a);
    return;
  }
  const inv = 1 / range;
  for (let i = 0; i < a.length; i++) {
    const v = ((a[i]! - pLo) * inv) as number;
    a[i] = Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0;
  }
}
