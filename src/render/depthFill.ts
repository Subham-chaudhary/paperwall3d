/**
 * Multi-scale "push-pull" hole filling for scalar grids.
 *
 * Used to derive a clean background depth (foreground region replaced by depth
 * propagated from the surrounding background) and an extrapolated foreground
 * depth (so mesh vertices that fall outside the mask follow the object instead of
 * the far background). Works on small grids (mesh-resolution sized), so it is cheap.
 */

interface Level {
  w: number;
  h: number;
  /** Weighted-average value of the valid samples covered by each cell. */
  val: Float32Array;
  /** Validity 0..1. */
  wt: Float32Array;
}

/**
 * Fill low-weight cells of `values` from higher-weight neighbours.
 * `result = wt * value + (1 - wt) * smoothFill`, where the smooth fill comes from a
 * coarser pyramid level (bilinearly upsampled). Weights are expected in 0..1.
 * If no cell has any weight the result is all zeros — callers must handle that case.
 */
export function pushPullFill(values: Float32Array, weights: Float32Array, w: number, h: number): Float32Array {
  const levels: Level[] = [{ w, h, val: values, wt: weights }];

  // Push: build the pyramid (coarse cell = weighted average of up to 4 children).
  for (let cur = levels[0]!; cur.w > 1 || cur.h > 1; cur = levels[levels.length - 1]!) {
    const nw = Math.max(1, (cur.w + 1) >> 1);
    const nh = Math.max(1, (cur.h + 1) >> 1);
    const val = new Float32Array(nw * nh);
    const wt = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let sv = 0;
        let sw = 0;
        let n = 0;
        for (let dy = 0; dy < 2; dy++) {
          const yy = y * 2 + dy;
          if (yy >= cur.h) continue;
          for (let dx = 0; dx < 2; dx++) {
            const xx = x * 2 + dx;
            if (xx >= cur.w) continue;
            const i = yy * cur.w + xx;
            const wi = cur.wt[i]!;
            sv += cur.val[i]! * wi;
            sw += wi;
            n++;
          }
        }
        const o = y * nw + x;
        val[o] = sw > 1e-6 ? sv / sw : 0;
        wt[o] = sw / n;
      }
    }
    levels.push({ w: nw, h: nh, val, wt });
  }

  // Pull: from coarse to fine, fill each level's holes from the (already filled) coarser one.
  let filled: Float32Array = levels[levels.length - 1]!.val;
  for (let l = levels.length - 2; l >= 0; l--) {
    const lv = levels[l]!;
    const coarse = levels[l + 1]!;
    const out = new Float32Array(lv.w * lv.h);
    for (let y = 0; y < lv.h; y++) {
      const sy = Math.min(Math.max((y + 0.5) / 2 - 0.5, 0), coarse.h - 1);
      const y0 = Math.floor(sy);
      const y1 = Math.min(y0 + 1, coarse.h - 1);
      const fy = sy - y0;
      for (let x = 0; x < lv.w; x++) {
        const sx = Math.min(Math.max((x + 0.5) / 2 - 0.5, 0), coarse.w - 1);
        const x0 = Math.floor(sx);
        const x1 = Math.min(x0 + 1, coarse.w - 1);
        const fx = sx - x0;
        const up =
          (filled[y0 * coarse.w + x0]! * (1 - fx) + filled[y0 * coarse.w + x1]! * fx) * (1 - fy) +
          (filled[y1 * coarse.w + x0]! * (1 - fx) + filled[y1 * coarse.w + x1]! * fx) * fy;
        const i = y * lv.w + x;
        const wi = lv.wt[i]!;
        out[i] = wi * lv.val[i]! + (1 - wi) * up;
      }
    }
    filled = out;
  }
  // Single-level input (1x1 grid) returns the input values untouched.
  return filled === levels[0]!.val ? filled.slice() : filled;
}

const HOLE_EPS = 0.02;

/**
 * Background depth with the foreground subject removed: pixels covered (or nearly covered) by
 * the mask are replaced by depth propagated from the surrounding background. Runs on a
 * downsampled copy (long edge <= ~384) and blends back into the full-resolution depth with a
 * soft hole indicator, so untouched background keeps all its detail.
 * Returns the input array itself when there is nothing to fill.
 */
export function fillBackgroundDepth(depth: Float32Array, mask: Float32Array, w: number, h: number): Float32Array {
  const f = Math.max(1, Math.ceil(Math.max(w, h) / 384));
  const lw = Math.ceil(w / f);
  const lh = Math.ceil(h / f);
  const val = new Float32Array(lw * lh);
  const wt = new Float32Array(lw * lh);
  let anyHole = false;
  let anyValid = false;

  for (let by = 0; by < lh; by++) {
    for (let bx = 0; bx < lw; bx++) {
      let sum = 0;
      let valid = 0;
      let total = 0;
      for (let y = by * f; y < Math.min(by * f + f, h); y++) {
        for (let x = bx * f; x < Math.min(bx * f + f, w); x++) {
          const p = y * w + x;
          total++;
          if (mask[p]! < HOLE_EPS) {
            sum += depth[p]!;
            valid++;
          }
        }
      }
      const o = by * lw + bx;
      val[o] = valid > 0 ? sum / valid : 0;
      wt[o] = valid === total ? 1 : 0;
      if (valid < total) anyHole = true;
      if (valid > 0) anyValid = true;
    }
  }
  if (!anyHole || !anyValid) return depth;

  // Erode the valid set by one block so the fill also covers mask feathering / halos.
  const wtE = new Float32Array(lw * lh);
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      let m = 1;
      for (let dy = -1; dy <= 1 && m > 0; dy++) {
        const yy = Math.min(Math.max(y + dy, 0), lh - 1);
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(Math.max(x + dx, 0), lw - 1);
          if (wt[yy * lw + xx]! < m) m = wt[yy * lw + xx]!;
        }
      }
      wtE[y * lw + x] = m;
    }
  }
  const filled = pushPullFill(val, wtE, lw, lh);

  const out = new Float32Array(depth.length);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(Math.max((y + 0.5) / f - 0.5, 0), lh - 1);
    const y0 = Math.floor(sy);
    const y1 = Math.min(y0 + 1, lh - 1);
    const fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(Math.max((x + 0.5) / f - 0.5, 0), lw - 1);
      const x0 = Math.floor(sx);
      const x1 = Math.min(x0 + 1, lw - 1);
      const fx = sx - x0;
      const i00 = y0 * lw + x0;
      const i10 = y0 * lw + x1;
      const i01 = y1 * lw + x0;
      const i11 = y1 * lw + x1;
      const hole =
        ((1 - wtE[i00]!) * (1 - fx) + (1 - wtE[i10]!) * fx) * (1 - fy) + ((1 - wtE[i01]!) * (1 - fx) + (1 - wtE[i11]!) * fx) * fy;
      const p = y * w + x;
      if (hole <= 0) {
        out[p] = depth[p]!;
      } else {
        const fill =
          (filled[i00]! * (1 - fx) + filled[i10]! * fx) * (1 - fy) + (filled[i01]! * (1 - fx) + filled[i11]! * fx) * fy;
        out[p] = depth[p]! * (1 - hole) + fill * hole;
      }
    }
  }
  return out;
}
