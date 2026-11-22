/**
 * 2D view geometry: image fitting, the perspective used for the tilt, and the extra zoom that keeps a
 * tilted cover-fit picture from revealing its edges.
 *
 * Scene units of the 2D view are viewport pixels (CSS px); the image plane sits at z = 0 and the camera
 * looks down -z from `perspectiveDistance(vh)`, so the plane at rest maps 1:1 onto its fitted rectangle.
 */
export type FitMode = 'contain' | 'cover';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Distance of the 2D camera from the picture, in viewport heights (≈ CSS `perspective: 1000px` at 860 px). */
const PERSPECTIVE_HEIGHTS = 1.15;

export const perspectiveDistance = (vh: number): number => PERSPECTIVE_HEIGHTS * vh;

/** Vertical field of view (degrees) at which the plane z = 0 is exactly `vh` tall on screen. */
export const perspectiveFov = (vh: number): number => (2 * Math.atan(vh / 2 / perspectiveDistance(vh)) * 180) / Math.PI;

/**
 * Centred rectangle of an `iw`×`ih` image inside a `vw`×`vh` viewport (top-left origin).
 * Self-contained (no imports, no closures): htmlWallpaper.ts embeds its source into the exported page.
 */
export function fitRect(vw: number, vh: number, iw: number, ih: number, mode: FitMode): Rect {
  const k = mode === 'cover' ? Math.max(vw / iw, vh / ih) : Math.min(vw / iw, vh / ih);
  const w = iw * k;
  const h = ih * k;
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
}

/**
 * Smallest scale (about its centre) a `w`×`h` plane rotated by (rx, ry) (matrix Rx·Ry) needs so that it still covers
 * the whole `vw`×`vh` viewport seen from distance `dist` on the z axis. The four viewport corners are traced back onto
 * the rotated plane; if they all lie inside the plane, so does everything between them. Returns >= 1.
 * Self-contained like `fitRect`.
 */
export function tiltCoverScale(vw: number, vh: number, w: number, h: number, rx: number, ry: number, dist: number): number {
  if (rx === 0 && ry === 0) return 1;
  const tanHalf = vh / 2 / dist;
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
  // plane normal R*(0,0,1) with R = Rx*Ry
  const n = [sy, -sx * cy, cx * cy];
  let s = 1;
  for (const qx of [-1, 1]) {
    for (const qy of [-1, 1]) {
      const d = [(qx * tanHalf * vw) / vh, qy * tanHalf, -1];
      const denom = n[0]! * d[0]! + n[1]! * d[1]! + n[2]! * d[2]!;
      if (Math.abs(denom) < 1e-6) continue;
      const t = -(n[2]! * dist) / denom;
      const hx = d[0]! * t, hy = d[1]! * t, hz = dist + d[2]! * t;
      // R^T * hit: Ry^T * Rx^T
      const ax = hx, ay = cx * hy + sx * hz;
      const lx = cy * ax - sy * (-sx * hy + cx * hz);
      const ly = ay;
      s = Math.max(s, Math.abs(lx) / (w / 2), Math.abs(ly) / (h / 2));
    }
  }
  return s;
}

/** Size of the colour layers of a scene (the output resolution); the maps may be smaller but share the aspect. */
export function colorSize(sc: { width: number; height: number; colorWidth?: number; colorHeight?: number }): { w: number; h: number } {
  return { w: sc.colorWidth || sc.width, h: sc.colorHeight || sc.height };
}
