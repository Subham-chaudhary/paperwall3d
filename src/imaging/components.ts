/** Connected-component helpers for binary masks (flat Uint8Array, 1 = set). */
import { nearestSite } from './morphology';

export interface Labeling {
  /** 0 = background, otherwise the 1-based component id. */
  labels: Int32Array;
  /** Pixel count per component id (index 0 unused). */
  areas: number[];
}

/** Labels the set pixels' connected components (8-connectivity by default, like OpenCV). */
export function labelComponents(bin: Uint8Array, w: number, h: number, eight = true): Labeling {
  const n = w * h;
  const labels = new Int32Array(n);
  const queue = new Int32Array(n);
  const areas: number[] = [0];
  for (let start = 0; start < n; start++) {
    if (!bin[start] || labels[start]) continue;
    const id = areas.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = id;
    while (head < tail) {
      const p = queue[head++]!;
      const x = p % w;
      const y = (p - x) / w;
      const y0 = y > 0 ? -1 : 0;
      const y1 = y < h - 1 ? 1 : 0;
      const x0 = x > 0 ? -1 : 0;
      const x1 = x < w - 1 ? 1 : 0;
      for (let dy = y0; dy <= y1; dy++) {
        for (let dx = x0; dx <= x1; dx++) {
          if (!eight && dx !== 0 && dy !== 0) continue;
          const q = p + dy * w + dx;
          if (bin[q] && !labels[q]) {
            labels[q] = id;
            queue[tail++] = q;
          }
        }
      }
    }
    areas.push(tail);
  }
  return { labels, areas };
}

/** New mask holding only the pixels whose component id has `keep[id] !== 0`. */
export function keepComponents(lab: Labeling, keep: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(lab.labels.length);
  for (let i = 0; i < out.length; i++) {
    const id = lab.labels[i]!;
    if (id && keep[id]) out[i] = 1;
  }
  return out;
}

/** Drops components smaller than `minPixels`. */
export function removeSmallBlobs(bin: Uint8Array, w: number, h: number, minPixels: number): Uint8Array {
  const lab = labelComponents(bin, w, h);
  const keep = new Uint8Array(lab.areas.length);
  for (let id = 1; id < lab.areas.length; id++) keep[id] = lab.areas[id]! >= minPixels ? 1 : 0;
  return keepComponents(lab, keep);
}

/** Keeps only the biggest component. */
export function largestBlob(bin: Uint8Array, w: number, h: number): Uint8Array {
  const lab = labelComponents(bin, w, h);
  let best = 0;
  for (let id = 1; id < lab.areas.length; id++) if (best === 0 || lab.areas[id]! > lab.areas[best]!) best = id;
  const keep = new Uint8Array(lab.areas.length);
  if (best) keep[best] = 1;
  return keepComponents(lab, keep);
}

/**
 * Keeps only the blob nearest to the click point (clickX/Y in 0..1): a click that lands slightly off the
 * object still picks the closest one.
 */
export function pickBlob(bin: Uint8Array, w: number, h: number, click: readonly [number, number]): Uint8Array {
  const lab = labelComponents(bin, w, h);
  if (lab.areas.length <= 1) return bin;
  const cx = Math.min(w - 1, Math.max(0, Math.floor(click[0] * w)));
  const cy = Math.min(h - 1, Math.max(0, Math.floor(click[1] * h)));
  const site = nearestSite(bin, w, h)[cy * w + cx]!;
  const keep = new Uint8Array(lab.areas.length);
  keep[lab.labels[site]!] = 1;
  return keepComponents(lab, keep);
}

/** Fills holes: background pixels (4-connected) that cannot reach the image border become foreground. */
export function fillHoles(bin: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h;
  const outside = new Uint8Array(n);
  const queue = new Int32Array(n);
  let tail = 0;
  const seed = (i: number): void => {
    if (!bin[i] && !outside[i]) {
      outside[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  for (let head = 0; head < tail; ) {
    const p = queue[head++]!;
    const x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p < n - w) seed(p + w);
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = bin[i] || !outside[i] ? 1 : 0;
  return out;
}
