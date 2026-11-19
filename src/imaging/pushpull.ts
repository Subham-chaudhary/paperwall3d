/**
 * Multi-scale "push-pull" hole filling (Gortler et al.'s pull-push scattered-data interpolation).
 *
 * Push (analysis): build an image pyramid of weight-premultiplied values.
 * Pull (synthesis): walk back down; wherever a pixel's own weight is below 1, blend in the (smoothly
 * upsampled) estimate from the coarser level. Valid pixels (weight 1) are reproduced exactly.
 * Cost is O(n) and the result is a smooth, edge-continuous fill — ideal for hiding a removed subject.
 */

interface Level {
  w: number;
  h: number;
  /** Weight-premultiplied values, interleaved. */
  c: Float32Array;
  /** Coverage weight 0..1. */
  wt: Float32Array;
}

/**
 * @param data     interleaved values (`channels` per pixel). Contents under zero-weight pixels are ignored.
 * @param weight   per-pixel validity 0..1
 * @param fallback value used when no pixel at all is valid (per channel; default 0.5)
 * @returns a new interleaved array in which every pixel has a value
 */
export function pushPullFill(
  data: Float32Array,
  weight: Float32Array,
  w: number,
  h: number,
  channels: number,
  fallback = 0.5,
): Float32Array {
  const n = w * h;
  const c0 = new Float32Array(n * channels);
  const w0 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const wt = weight[i]! < 0 ? 0 : weight[i]! > 1 ? 1 : weight[i]!;
    w0[i] = wt;
    if (wt > 0) for (let c = 0; c < channels; c++) c0[i * channels + c] = data[i * channels + c]! * wt;
  }

  // Push.
  const levels: Level[] = [{ w, h, c: c0, wt: w0 }];
  for (;;) {
    const cur = levels[levels.length - 1]!;
    if (cur.w <= 1 && cur.h <= 1) break;
    const nw = Math.max(1, (cur.w + 1) >> 1);
    const nh = Math.max(1, (cur.h + 1) >> 1);
    const nc = new Float32Array(nw * nh * channels);
    const nwt = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let sumW = 0;
        const o = (y * nw + x) * channels;
        for (let dy = 0; dy < 2; dy++) {
          const sy = 2 * y + dy;
          if (sy >= cur.h) continue;
          for (let dx = 0; dx < 2; dx++) {
            const sx = 2 * x + dx;
            if (sx >= cur.w) continue;
            const si = sy * cur.w + sx;
            sumW += cur.wt[si]!;
            for (let c = 0; c < channels; c++) nc[o + c] = nc[o + c]! + cur.c[si * channels + c]!;
          }
        }
        if (sumW > 0) {
          const wn = sumW > 1 ? 1 : sumW;
          // Keep C/W equal to the weighted-average colour of the children.
          const k = wn / sumW;
          for (let c = 0; c < channels; c++) nc[o + c] = nc[o + c]! * k;
          nwt[y * nw + x] = wn;
        }
      }
    }
    levels.push({ w: nw, h: nh, c: nc, wt: nwt });
  }

  // Pull. `est` holds the fully-resolved colour image of the level below in the loop (coarser).
  const top = levels[levels.length - 1]!;
  let est = new Float32Array(top.w * top.h * channels);
  for (let i = 0; i < top.w * top.h; i++) {
    const wt = top.wt[i]!;
    for (let c = 0; c < channels; c++) est[i * channels + c] = wt > 1e-6 ? top.c[i * channels + c]! / wt : fallback;
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const lv = levels[l]!;
    const cw = levels[l + 1]!.w;
    const ch = levels[l + 1]!.h;
    const out = new Float32Array(lv.w * lv.h * channels);
    // Precompute horizontal taps (half-pixel-centre mapping from this level to the coarser one).
    const x0 = new Int32Array(lv.w);
    const x1 = new Int32Array(lv.w);
    const tx = new Float32Array(lv.w);
    for (let x = 0; x < lv.w; x++) {
      const fx = (x + 0.5) / 2 - 0.5;
      const ix = Math.floor(fx);
      tx[x] = fx - ix;
      x0[x] = Math.min(Math.max(ix, 0), cw - 1);
      x1[x] = Math.min(Math.max(ix + 1, 0), cw - 1);
    }
    for (let y = 0; y < lv.h; y++) {
      const fy = (y + 0.5) / 2 - 0.5;
      const iy = Math.floor(fy);
      const ty = fy - iy;
      const r0 = Math.min(Math.max(iy, 0), ch - 1) * cw;
      const r1 = Math.min(Math.max(iy + 1, 0), ch - 1) * cw;
      for (let x = 0; x < lv.w; x++) {
        const i = y * lv.w + x;
        const wt = lv.wt[i]!;
        const o = i * channels;
        if (wt >= 1) {
          for (let c = 0; c < channels; c++) out[o + c] = lv.c[o + c]!;
          continue;
        }
        const a = (x0[x]! + r0) * channels;
        const b = (x1[x]! + r0) * channels;
        const cc = (x0[x]! + r1) * channels;
        const d = (x1[x]! + r1) * channels;
        const fx = tx[x]!;
        const inv = 1 - wt;
        for (let c = 0; c < channels; c++) {
          const top2 = est[a + c]! * (1 - fx) + est[b + c]! * fx;
          const bot2 = est[cc + c]! * (1 - fx) + est[d + c]! * fx;
          out[o + c] = lv.c[o + c]! + inv * (top2 * (1 - ty) + bot2 * ty);
        }
      }
    }
    est = out;
  }
  return est;
}
