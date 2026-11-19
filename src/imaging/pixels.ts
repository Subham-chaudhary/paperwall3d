/** RGBA <-> float conversions shared by the layer builders. */

/** Interleaved RGB floats 0..1 from RGBA bytes. */
export function rgbaToRgbFloat(rgba: Uint8ClampedArray, n: number): Float32Array {
  const out = new Float32Array(n * 3);
  const k = 1 / 255;
  for (let i = 0; i < n; i++) {
    out[i * 3] = rgba[i * 4]! * k;
    out[i * 3 + 1] = rgba[i * 4 + 1]! * k;
    out[i * 3 + 2] = rgba[i * 4 + 2]! * k;
  }
  return out;
}

/** Rec.601 luma 0..1 of an RGBA image. */
export function lumaOf(rgba: Uint8ClampedArray, n: number): Float32Array {
  const out = new Float32Array(n);
  const k = 1 / 255;
  for (let i = 0; i < n; i++) out[i] = (0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!) * k;
  return out;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
