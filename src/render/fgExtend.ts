/**
 * Split an RGBA object layer into what the HTML wallpaper embeds: an OPAQUE colour image whose transparent area
 * is filled by extending the object's own edge colours outward (so bilinear filtering and JPEG compression never
 * pull black or garbage into the silhouette), and a separate 8-bit alpha plane.
 *
 * Fill: nearest-"known"-pixel propagation (two chamfer passes over the padded alpha bounding box). A pixel is known
 * when alpha >= 128; anything unknown within RADIUS px takes the colour of its nearest known pixel (also replacing the
 * faint, possibly dark colours of soft edge pixels); farther away it gets the mean object colour, which also keeps
 * the JPEG small.
 */

/** How far (px at the layer's own resolution) edge colours are extended into the transparent area. */
const RADIUS = 24;
const KNOWN_ALPHA = 128;

export function splitObjectLayer(fg: ImageData): { color: ImageData; alpha: Uint8Array } {
  const { width: W, height: H } = fg;
  const src = fg.data;
  const n = W * H;
  const alpha = new Uint8Array(n);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  let sr = 0, sg = 0, sb = 0, cnt = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const a = src[i * 4 + 3]!;
      alpha[i] = a;
      if (a >= KNOWN_ALPHA) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        sr += src[i * 4]!;
        sg += src[i * 4 + 1]!;
        sb += src[i * 4 + 2]!;
        cnt++;
      }
    }
  }
  const out = new ImageData(W, H);
  const dst = out.data;
  const mr = cnt ? Math.round(sr / cnt) : 128;
  const mg = cnt ? Math.round(sg / cnt) : 128;
  const mb = cnt ? Math.round(sb / cnt) : 128;
  for (let i = 0; i < n; i++) {
    dst[i * 4] = mr;
    dst[i * 4 + 1] = mg;
    dst[i * 4 + 2] = mb;
    dst[i * 4 + 3] = 255;
  }
  if (!cnt) return { color: out, alpha };

  // padded bounding box of the known pixels
  x0 = Math.max(0, x0 - RADIUS);
  y0 = Math.max(0, y0 - RADIUS);
  x1 = Math.min(W - 1, x1 + RADIUS);
  y1 = Math.min(H - 1, y1 + RADIUS);
  const rw = x1 - x0 + 1;
  const rh = y1 - y0 + 1;
  const sx = new Int16Array(rw * rh).fill(-1);
  const sy = new Int16Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      if (alpha[(y + y0) * W + x + x0]! >= KNOWN_ALPHA) {
        sx[y * rw + x] = x;
        sy[y * rw + x] = y;
      }
    }
  }
  const dist2 = (x: number, y: number, k: number): number => {
    const dx = x - sx[k]!;
    const dy = y - sy[k]!;
    return dx * dx + dy * dy;
  };
  const relax = (x: number, y: number, i: number, nx: number, ny: number): void => {
    const k = ny * rw + nx;
    if (sx[k]! < 0) return;
    if (sx[i]! < 0 || dist2(x, y, k) < dist2(x, y, i)) {
      sx[i] = sx[k]!;
      sy[i] = sy[k]!;
    }
  };
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x;
      if (x > 0) relax(x, y, i, x - 1, y);
      if (y > 0) {
        relax(x, y, i, x, y - 1);
        if (x > 0) relax(x, y, i, x - 1, y - 1);
        if (x < rw - 1) relax(x, y, i, x + 1, y - 1);
      }
    }
  }
  for (let y = rh - 1; y >= 0; y--) {
    for (let x = rw - 1; x >= 0; x--) {
      const i = y * rw + x;
      if (x < rw - 1) relax(x, y, i, x + 1, y);
      if (y < rh - 1) {
        relax(x, y, i, x, y + 1);
        if (x < rw - 1) relax(x, y, i, x + 1, y + 1);
        if (x > 0) relax(x, y, i, x - 1, y + 1);
      }
    }
  }
  const r2 = RADIUS * RADIUS;
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x;
      if (sx[i]! < 0) continue;
      const own = alpha[(y + y0) * W + x + x0]! >= KNOWN_ALPHA;
      if (!own && dist2(x, y, i) > r2) continue;
      const s = ((sy[i]! + y0) * W + sx[i]! + x0) * 4;
      const d = ((y + y0) * W + x + x0) * 4;
      dst[d] = src[s]!;
      dst[d + 1] = src[s + 1]!;
      dst[d + 2] = src[s + 2]!;
    }
  }
  return { color: out, alpha };
}
