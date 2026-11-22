/**
 * Stage 2 depth post-processing (2.5dwallpp `finish_depth` + `object_depth`), split into pieces so the
 * reconstructor can cache each one against only the settings it depends on.
 *
 *   raw -> percentile clip to 0..1 -> gaussian smooth -> [guided edge snap] -> gamma      (whole-image depth)
 *   depth + mask -> rim-fixed object depth (nearest fill from inside) -> percentile rescale (object depth)
 */
import { gaussianBlur } from './blur';
import { guidedFilter } from './guided';
import { alphaBox, cropBinary, pasteCrop } from './crop';
import { dilateBinary, erodeBinary, nearestSite } from './morphology';

const HIST_BINS = 4096;

/**
 * Percentiles (0..100) of the finite values of `values` (restricted to `where !== 0` when given),
 * via a histogram with linear interpolation inside the bin (accurate to ~range/4096).
 */
export function percentileRange(
  values: Float32Array,
  loPct: number,
  hiPct: number,
  where?: Uint8Array,
): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (where && !where[i]) continue;
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!(hi >= lo)) return [0, 1];
  if (!(hi - lo > 1e-12)) return [lo, hi];
  const hist = new Uint32Array(HIST_BINS);
  const scale = HIST_BINS / (hi - lo);
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    if (where && !where[i]) continue;
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    hist[Math.min(HIST_BINS - 1, Math.floor((v - lo) * scale))]!++;
    count++;
  }
  const at = (pct: number): number => {
    const target = Math.min(1, Math.max(0, pct / 100)) * count;
    let acc = 0;
    for (let b = 0; b < HIST_BINS; b++) {
      const c = hist[b]!;
      if (acc + c >= target && c > 0) return lo + (b + (target - acc) / c) / scale;
      acc += c;
    }
    return hi;
  };
  return [Math.max(lo, at(loPct)), Math.min(hi, at(hiPct))];
}

/** (raw - lo) / (hi - lo) clamped to 0..1, with lo/hi the clip percentiles of the raw map. Non-finite -> 0. */
export function clipDepth(raw: Float32Array, clipLo: number, clipHi: number): Float32Array {
  const [lo, hi] = percentileRange(raw, clipLo, clipHi);
  const inv = 1 / Math.max(hi - lo, 1e-6);
  const out = new Float32Array(raw.length);
  for (let i = 0; i < out.length; i++) {
    const v = (raw[i]! - lo) * inv;
    out[i] = v > 0 ? (v < 1 ? v : 1) : 0; // NaN -> 0
  }
  return out;
}

/** Gaussian smoothing (sigma px). Returns a new array. */
export function smoothDepth(d: Float32Array, w: number, h: number, sigma: number): Float32Array {
  return sigma > 0.01 ? gaussianBlur(d, w, h, sigma) : d.slice();
}

/**
 * Optional guided-filter edge snap (guide = photo luma, radius px) then gamma. Returns `d` itself when
 * both are off, otherwise a new array.
 */
export function snapAndGamma(d: Float32Array, luma: Float32Array, w: number, h: number, edgeSnap: number, gamma: number): Float32Array {
  let out = d;
  if (edgeSnap >= 1) out = guidedFilter(luma, d, w, h, Math.round(edgeSnap), 1e-3);
  if (out === d && gamma === 1) return d;
  if (out === d) out = d.slice();
  if (gamma === 1) {
    for (let i = 0; i < out.length; i++) out[i] = out[i]! < 0 ? 0 : out[i]! > 1 ? 1 : out[i]!;
    return out;
  }
  // Gamma through a LUT (Math.pow per pixel is ~10x slower).
  const L = 4096;
  const lut = new Float32Array(L + 1);
  for (let i = 0; i <= L; i++) lut[i] = Math.pow(i / L, gamma);
  for (let i = 0; i < out.length; i++) {
    const v = out[i]!;
    const f = (v < 0 ? 0 : v > 1 ? 1 : v) * L;
    const i0 = Math.min(L - 1, Math.floor(f));
    const t = f - i0;
    out[i] = lut[i0]! * (1 - t) + lut[i0 + 1]! * t;
  }
  return out;
}

export function invertDepth(d: Float32Array): Float32Array {
  const out = new Float32Array(d.length);
  for (let i = 0; i < out.length; i++) out[i] = 1 - d[i]!;
  return out;
}

/** Pixels farther than this (px) outside the cut-out keep the original depth. */
const BAND_PX = 12;
const MIN_OBJECT_PIXELS = 16;

/** Mask-only part of object_depth, independent of the depth values (cached separately). */
export interface RimGeometry {
  /** alpha > 0.5 */
  inside: Uint8Array;
  /** inside dilated by 12 px: where the rim fix applies. */
  band: Uint8Array;
  /** Per pixel: index of the nearest pixel of the trusted core (mask eroded by `rim` px). */
  nearest: Int32Array;
}

export function buildRimGeometry(alpha: Float32Array, w: number, h: number, rim: number): RimGeometry | null {
  const n = w * h;
  // Everything here only matters within BAND_PX of the object, so work on a padded crop.
  const box = alphaBox(alpha, w, h, 0.5, BAND_PX + 4);
  if (!box) return null;
  const cw = box.x1 - box.x0;
  const ch = box.y1 - box.y0;
  const inC = cropBinary(alpha, w, box, 0.5);
  let count = 0;
  for (let i = 0; i < inC.length; i++) count += inC[i]!;
  if (count < MIN_OBJECT_PIXELS) return null;
  let core: Uint8Array = inC;
  if (rim > 0) {
    const eroded = erodeBinary(inC, cw, ch, rim);
    let c = 0;
    for (let i = 0; i < eroded.length; i++) c += eroded[i]!;
    if (c >= MIN_OBJECT_PIXELS) core = eroded;
  }
  const nearC = nearestSite(core, cw, ch);

  const inside = new Uint8Array(n);
  const band = new Uint8Array(n);
  const nearest = new Int32Array(n);
  pasteCrop(inside, w, box, inC);
  pasteCrop(band, w, box, dilateBinary(inC, cw, ch, BAND_PX));
  const mapped = new Int32Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const s = nearC[y * cw + x]!;
      const sx = s % cw;
      mapped[y * cw + x] = (box.y0 + (s - sx) / cw) * w + box.x0 + sx;
    }
  }
  pasteCrop(nearest, w, box, mapped);
  return { inside, band, nearest };
}

/**
 * fgDepth: depth with the blurry rim replaced from just inside the object, true range kept.
 * objDepth: fgDepth rescaled to 0..1 by the clip percentiles inside the mask; 0 beyond the band.
 */
export function objectDepth(
  depth: Float32Array,
  geom: RimGeometry | null,
  clipLo: number,
  clipHi: number,
): { fgDepth: Float32Array; objDepth: Float32Array } {
  if (!geom) return { fgDepth: depth.slice(), objDepth: new Float32Array(depth.length) };
  const { inside, band, nearest } = geom;
  const n = depth.length;
  const fg = new Float32Array(n);
  for (let i = 0; i < n; i++) fg[i] = band[i] ? depth[nearest[i]!]! : depth[i]!;
  const [lo, hi] = percentileRange(fg, clipLo, clipHi, inside);
  const inv = 1 / Math.max(hi - lo, 1e-6);
  const obj = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!band[i]) continue;
    const v = (fg[i]! - lo) * inv;
    obj[i] = v > 0 ? (v < 1 ? v : 1) : 0;
  }
  return { fgDepth: fg, objDepth: obj };
}
