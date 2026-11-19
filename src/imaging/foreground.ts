/**
 * Foreground layer: source colours with alpha = refined mask. Pixels near the silhouette are blends of
 * subject and old background; those colours are replaced by colours extrapolated from the solid interior
 * (push-pull), which prevents dark/bright fringes once the layer is filtered or displaced.
 */
import { erodeBinary } from './morphology';
import { rgbaToRgbFloat } from './pixels';
import { pushPullFill } from './pushpull';

/**
 * Opaque RGBA of the source whose pixels outside the trusted interior carry extrapolated colours.
 * Independent of the mask softness, so it is cached separately from the alpha channel.
 *
 * @param bin        binary foreground mask
 * @param edgeBleed  px; 0 keeps the raw source colours. The trusted interior is the mask eroded by ~0.4 x edgeBleed.
 */
export function buildForegroundColors(
  source: Uint8ClampedArray,
  bin: Uint8Array,
  w: number,
  h: number,
  edgeBleed: number,
): Uint8ClampedArray {
  const n = w * h;
  const out = source.slice();
  if (edgeBleed <= 0) return out;

  let core = erodeBinary(bin, w, h, Math.min(6, Math.max(1, edgeBleed * 0.4)));
  let coreCount = 0;
  for (let i = 0; i < n; i++) coreCount += core[i]!;
  if (coreCount === 0) core = bin; // thin object: trust whatever there is

  const weight = new Float32Array(n);
  for (let i = 0; i < n; i++) weight[i] = core[i]!;
  const filled = pushPullFill(rgbaToRgbFloat(source, n), weight, w, h, 3);
  for (let i = 0; i < n; i++) {
    if (core[i]) continue;
    out[i * 4] = filled[i * 3]! * 255 + 0.5;
    out[i * 4 + 1] = filled[i * 3 + 1]! * 255 + 0.5;
    out[i * 4 + 2] = filled[i * 3 + 2]! * 255 + 0.5;
  }
  return out;
}

/** Foreground layer: the given colours with alpha = soft mask. Returns a new array. */
export function applyAlpha(colors: Uint8ClampedArray, alpha: Float32Array): Uint8ClampedArray {
  const out = colors.slice();
  for (let i = 0; i < alpha.length; i++) out[i * 4 + 3] = alpha[i]! * 255 + 0.5;
  return out;
}
