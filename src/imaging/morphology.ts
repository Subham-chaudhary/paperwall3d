/**
 * Binary morphology via an exact Euclidean distance transform (Felzenszwalb & Huttenlocher, O(n)).
 * Compared with box max/min filters it yields round structuring elements, so grown/shrunk masks
 * keep smooth outlines at any radius.
 */

const INF = 1e20;

/** 1-D squared-distance transform of the sampled function `f` (length n) into `d`, using scratch `v`/`z`. */
function dt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    const fq = f[q]! + q * q;
    let s = (fq - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (fq - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const dq = q - v[k]!;
    d[q] = dq * dq + f[v[k]!]!;
  }
}

/**
 * Squared distance from every pixel to the nearest pixel where `set !== 0` (0 on the set itself).
 * If the set is empty every value is ≥ 1e20.
 */
export function squaredDistanceTo(set: Uint8Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const m = Math.max(w, h);
  const f = new Float64Array(m);
  const d = new Float64Array(m);
  const v = new Int32Array(m);
  const z = new Float64Array(m + 1);

  // Columns.
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = set[y * w + x] ? 0 : INF;
    dt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y]!;
  }
  // Rows.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = out[row + x]!;
    dt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[row + x] = d[x]!;
  }
  return out;
}

/** Grows the set by `r` pixels (round structuring element). */
export function dilateBinary(set: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return set.slice();
  const dist = squaredDistanceTo(set, w, h);
  const r2 = r * r;
  const out = new Uint8Array(set.length);
  for (let i = 0; i < out.length; i++) out[i] = dist[i]! <= r2 ? 1 : 0;
  return out;
}

/** Shrinks the set by `r` pixels. The image border does not count as background. */
export function erodeBinary(set: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return set.slice();
  const inv = new Uint8Array(set.length);
  for (let i = 0; i < inv.length; i++) inv[i] = set[i] ? 0 : 1;
  const dist = squaredDistanceTo(inv, w, h);
  const r2 = r * r;
  const out = new Uint8Array(set.length);
  for (let i = 0; i < out.length; i++) out[i] = set[i] && dist[i]! > r2 ? 1 : 0;
  return out;
}
