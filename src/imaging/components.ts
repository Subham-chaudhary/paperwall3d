/** Connected-component clean-up for binary masks. */

/**
 * In place: removes foreground islands smaller than `minArea` pixels (never the largest one) and fills
 * background holes smaller than `minArea` that don't touch the image border. 4-connectivity.
 * Returns the remaining foreground pixel count.
 */
export function removeSmallRegions(bin: Uint8Array, w: number, h: number, minArea: number): number {
  const n = w * h;
  const labels = new Int32Array(n); // 0 = unvisited, otherwise label id (1-based)
  const queue = new Int32Array(n);
  const areas: number[] = [0];
  const touchesBorder: boolean[] = [false];
  const isFg: boolean[] = [false];

  let largestFg = 0;
  for (let start = 0; start < n; start++) {
    if (labels[start]) continue;
    const value = bin[start]!;
    const id = areas.length;
    let head = 0;
    let tail = 0;
    let border = false;
    queue[tail++] = start;
    labels[start] = id;
    while (head < tail) {
      const p = queue[head++]!;
      const x = p % w;
      const y = (p - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      for (let dir = 0; dir < 4; dir++) {
        let q: number;
        if (dir === 0) q = x > 0 ? p - 1 : -1;
        else if (dir === 1) q = x < w - 1 ? p + 1 : -1;
        else if (dir === 2) q = y > 0 ? p - w : -1;
        else q = y < h - 1 ? p + w : -1;
        if (q >= 0 && !labels[q] && bin[q] === value) {
          labels[q] = id;
          queue[tail++] = q;
        }
      }
    }
    areas.push(tail);
    touchesBorder.push(border);
    isFg.push(value !== 0);
    if (value !== 0 && (largestFg === 0 || tail > areas[largestFg]!)) largestFg = id;
  }

  let remaining = 0;
  for (let i = 0; i < n; i++) {
    const id = labels[i]!;
    if (isFg[id]) {
      if (id !== largestFg && areas[id]! < minArea) bin[i] = 0;
    } else if (areas[id]! < minArea && !touchesBorder[id]) {
      bin[i] = 1;
    }
    if (bin[i]) remaining++;
  }
  return remaining;
}
