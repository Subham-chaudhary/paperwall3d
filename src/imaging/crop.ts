/** Bounding-box helpers: the object layers only need work near the object, so EDTs run on a padded crop. */

export interface Box {
  x0: number;
  y0: number;
  /** Exclusive. */
  x1: number;
  y1: number;
}

/** Bounding box of `alpha > thr`, grown by `pad` px and clamped to the image; null if nothing is set. */
export function alphaBox(alpha: Float32Array, w: number, h: number, thr: number, pad: number): Box | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (alpha[row + x]! > thr) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad), x1: Math.min(w, x1 + 1 + pad), y1: Math.min(h, y1 + 1 + pad) };
}

/** Crop of `alpha > thr` as a binary mask of the box size. */
export function cropBinary(alpha: Float32Array, w: number, box: Box, thr: number): Uint8Array {
  const cw = box.x1 - box.x0;
  const ch = box.y1 - box.y0;
  const out = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    const s = (box.y0 + y) * w + box.x0;
    for (let x = 0; x < cw; x++) out[y * cw + x] = alpha[s + x]! > thr ? 1 : 0;
  }
  return out;
}

/** Writes a box-sized map into a full-size array (other pixels untouched). */
export function pasteCrop<T extends Float32Array | Uint8Array | Int32Array>(dst: T, w: number, box: Box, src: ArrayLike<number>): void {
  const cw = box.x1 - box.x0;
  const ch = box.y1 - box.y0;
  for (let y = 0; y < ch; y++) {
    const d = (box.y0 + y) * w + box.x0;
    for (let x = 0; x < cw; x++) dst[d + x] = src[y * cw + x]!;
  }
}
