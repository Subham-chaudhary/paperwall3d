/**
 * Grid meshes for the 3D camera view and the GLB export (2.5dwallpp's view3d.js / export_glb.py).
 *
 * - The grid has `segs` cells on the long side; the image is 1 unit tall, centred, +x right, +y up, +z toward the viewer.
 *   UVs use v = 0 at the top of the image (textures are not flipped; this is also the glTF convention).
 * - Depth D of a vertex = base + sampledMap * scale; z = (D - 0.5) * zscale.
 * - Edge tear: per vertex the largest |D| step to its 4 neighbours; triangles with any vertex above `tear` are dropped.
 * - The object mesh keeps only triangles that touch the object (alpha > 0 at a vertex, dilated by one vertex).
 * - Subject scope: flat background at backgroundDepth; object at backgroundDepth + 0.1 + objDepth * relief.
 *
 * `LayerGrids` holds the maps sampled at the vertices (per scene and segs); `LayerMesh` is a built layer.
 * zscale / backgroundDepth changes only rewrite z in place (`applyDepth`); topology depends on segs, scope,
 * tear and (subject scope) relief.
 */
import type { LayerScope, PreparedScene } from '../core/types';
import { colorSize } from './layout';

export interface MeshParams {
  segs: number;
  zscale: number;
  tear: number;
  scope: LayerScope;
  backgroundDepth: number;
  objectRelief: number;
}

/** Whether two parameter sets produce the same triangles/vertices (z only differs). */
export function sameTopology(a: MeshParams, b: MeshParams): boolean {
  return a.segs === b.segs && a.scope === b.scope && a.tear === b.tear && (a.scope === 'all' || a.objectRelief === b.objectRelief);
}

export interface LayerMesh {
  /** xyz per vertex. */
  position: Float32Array;
  uv: Float32Array;
  index: Uint32Array;
  /** Sampled depth map value per vertex (before base/scale). */
  raw: Float32Array;
  base: number;
  scale: number;
}

/** Long side `segs` cells; the short side keeps the cell square. */
export function gridSize(segs: number, aspect: number): { sx: number; sy: number } {
  return aspect >= 1
    ? { sx: segs, sy: Math.max(8, Math.round(segs / aspect)) }
    : { sx: Math.max(8, Math.round(segs * aspect)), sy: segs };
}

/** Per-axis pixel ranges (inclusive) that vertex i's cell footprint covers. */
function ranges(n: number, cells: number): { lo: Int32Array; hi: Int32Array } {
  const lo = new Int32Array(cells + 1);
  const hi = new Int32Array(cells + 1);
  for (let i = 0; i <= cells; i++) {
    const a = ((i - 0.5) / cells) * n;
    const b = ((i + 0.5) / cells) * n;
    lo[i] = Math.min(n - 1, Math.max(0, Math.floor(a + 1e-6)));
    hi[i] = Math.min(n - 1, Math.max(lo[i]!, Math.ceil(b - 1e-6) - 1));
  }
  return { lo, hi };
}

/**
 * Sample a full-resolution map at the (sx+1)×(sy+1) grid vertices: area average when shrinking, bilinear when enlarging.
 * With `weight` the average is weighted by it (e.g. the object mask, so silhouette vertices are not diluted by the
 * zeros beyond the edge); vertices without any weight fall back to the plain average.
 */
export function sampleGrid(map: Float32Array, w: number, h: number, sx: number, sy: number, weight?: Float32Array): Float32Array {
  const nx = sx + 1;
  const ny = sy + 1;
  const out = new Float32Array(nx * ny);
  const box = w / sx >= 1.5 && h / sy >= 1.5;
  const X = box ? ranges(w, sx) : null;
  const Y = box ? ranges(h, sy) : null;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let sum = 0;
      let wsum = 0;
      let plain = 0;
      let wplain = 0;
      const add = (idx: number, k: number): void => {
        const v = map[idx]!;
        plain += v * k;
        wplain += k;
        if (weight) {
          const q = weight[idx]! * k;
          sum += v * q;
          wsum += q;
        }
      };
      if (X && Y) {
        for (let y = Y.lo[j]!; y <= Y.hi[j]!; y++) for (let x = X.lo[i]!; x <= X.hi[i]!; x++) add(y * w + x, 1);
      } else {
        const fy = Math.min(h - 1, Math.max(0, (j / sy) * h - 0.5));
        const y0 = Math.floor(fy);
        const y1 = Math.min(h - 1, y0 + 1);
        const ty = fy - y0;
        const fx = Math.min(w - 1, Math.max(0, (i / sx) * w - 0.5));
        const x0 = Math.floor(fx);
        const x1 = Math.min(w - 1, x0 + 1);
        const tx = fx - x0;
        add(y0 * w + x0, (1 - tx) * (1 - ty));
        add(y0 * w + x1, tx * (1 - ty));
        add(y1 * w + x0, (1 - tx) * ty);
        add(y1 * w + x1, tx * ty);
      }
      out[j * nx + i] = weight && wsum > 1e-6 ? sum / wsum : plain / wplain;
    }
  }
  return out;
}

/** The scene's maps sampled on one grid resolution. */
export class LayerGrids {
  readonly aspect: number;
  readonly sx: number;
  readonly sy: number;
  readonly segs: number;
  /** Background depth (scope all) or whole-image depth (single layer). */
  readonly bg: Float32Array;
  obj: Float32Array | null;
  readonly fg: Float32Array | null;
  /** 1 where a vertex lies within one vertex of the object. */
  readonly near: Uint8Array | null;
  /** 1 where the object mask is > 0 at the vertex (the object's own vertices). */
  readonly inside: Uint8Array | null;
  readonly hasForeground: boolean;
  readonly center: [number, number];

  constructor(scene: PreparedScene, segs: number) {
    this.segs = segs;
    const cs = colorSize(scene);
    this.aspect = cs.w / cs.h; // the colour layers set the picture's aspect; the maps are sampled by UV
    const { sx, sy } = gridSize(segs, this.aspect);
    this.sx = sx;
    this.sy = sy;
    this.hasForeground = scene.hasForeground;
    this.center = scene.center;
    const { width: w, height: h } = scene;
    if (!scene.hasForeground) {
      this.bg = sampleGrid(scene.depth, w, h, sx, sy);
      this.obj = this.fg = null;
      this.near = this.inside = null;
      return;
    }
    this.bg = sampleGrid(scene.bgDepth, w, h, sx, sy);
    this.obj = sampleGrid(scene.objDepth, w, h, sx, sy, scene.mask);
    this.fg = sampleGrid(scene.fgDepth, w, h, sx, sy, scene.mask);
    const a = sampleGrid(scene.mask, w, h, sx, sy);
    const nx = sx + 1;
    const ny = sy + 1;
    const inside = new Uint8Array(nx * ny);
    for (let k = 0; k < inside.length; k++) inside[k] = a[k]! > 0 ? 1 : 0;
    this.inside = inside;
    // Beyond the silhouette the object depth map is 0 (a cliff down to the base). Extend the object's own depth one
    // vertex outward instead, so the rim is not a slanted skirt when seen from the side.
    const obj = this.obj;
    const filled = obj.slice();
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (inside[k]) continue;
        let sum = 0;
        let cnt = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const jj = j + dj;
            const ii = i + di;
            if (jj >= 0 && jj < ny && ii >= 0 && ii < nx && inside[jj * nx + ii]) {
              sum += obj[jj * nx + ii]!;
              cnt++;
            }
          }
        }
        if (cnt) filled[k] = sum / cnt;
      }
    }
    this.obj = filled;
    const near = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let hit = 0;
        for (let dj = -1; dj <= 1 && !hit; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= ny) continue;
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            if (ii >= 0 && ii < nx && a[jj * nx + ii]! > 0) {
              hit = 1;
              break;
            }
          }
        }
        near[j * nx + i] = hit;
      }
    }
    this.near = near;
  }
}

/** Per vertex: the largest absolute depth step to its 4 neighbours, tested against `tear`. */
function tearOk(d: Float32Array, nx: number, ny: number, tear: number, only: Uint8Array | null): Uint8Array {
  const ok = new Uint8Array(nx * ny);
  // `only`: object layer, whose silhouette is cut by alpha anyway; only steps between the object's own vertices tear.
  const use = (k: number, n: number): boolean => !only || (only[k]! !== 0 && only[n]! !== 0);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const v = d[k]!;
      let step = 0;
      if (i > 0 && use(k, k - 1)) step = Math.max(step, Math.abs(d[k - 1]! - v));
      if (i < nx - 1 && use(k, k + 1)) step = Math.max(step, Math.abs(d[k + 1]! - v));
      if (j > 0 && use(k, k - nx)) step = Math.max(step, Math.abs(d[k - nx]! - v));
      if (j < ny - 1 && use(k, k + nx)) step = Math.max(step, Math.abs(d[k + nx]! - v));
      ok[k] = step <= tear ? 1 : 0;
    }
  }
  return ok;
}

/** Assemble a mesh from the grid: drop torn triangles (`tear`) and, for the object, triangles away from it (`near`). */
function assemble(
  g: LayerGrids,
  raw: Float32Array,
  base: number,
  scale: number,
  tear: number | null,
  near: Uint8Array | null,
  inside: Uint8Array | null,
): LayerMesh | null {
  const nx = g.sx + 1;
  const ny = g.sy + 1;
  const ok = tear === null ? null : tearOk(base === 0 && scale === 1 ? raw : raw.map((v) => base + v * scale), nx, ny, tear, inside);

  const tris: number[] = [];
  for (let j = 0; j < g.sy; j++) {
    for (let i = 0; i < g.sx; i++) {
      const tl = j * nx + i;
      const tr = tl + 1;
      const bl = tl + nx;
      const br = bl + 1;
      // counter-clockwise seen from +z
      for (const [a, b, c] of [
        [tl, bl, br],
        [tl, br, tr],
      ] as const) {
        if (ok && !(ok[a]! && ok[b]! && ok[c]!)) continue;
        if (near && !(near[a]! || near[b]! || near[c]!)) continue;
        tris.push(a, b, c);
      }
    }
  }
  if (!tris.length) return null;

  const remap = new Int32Array(nx * ny).fill(-1);
  let used = 0;
  for (let t = 0; t < tris.length; t++) if (remap[tris[t]!] < 0) remap[tris[t]!] = used++;

  const position = new Float32Array(used * 3);
  const uv = new Float32Array(used * 2);
  const rawOut = new Float32Array(used);
  for (let k = 0; k < remap.length; k++) {
    const m = remap[k]!;
    if (m < 0) continue;
    const i = k % nx;
    const j = (k - i) / nx;
    position[m * 3] = (i / g.sx - 0.5) * g.aspect;
    position[m * 3 + 1] = 0.5 - j / g.sy;
    uv[m * 2] = i / g.sx;
    uv[m * 2 + 1] = j / g.sy;
    rawOut[m] = raw[k]!;
  }
  const index = new Uint32Array(tris.length);
  for (let t = 0; t < tris.length; t++) index[t] = remap[tris[t]!]!;
  return { position, uv, index, raw: rawOut, base, scale };
}

/** One flat quad covering the image (used for the flat background plane in the GLB: same look, far smaller). */
function flatQuad(aspect: number, depth: number): LayerMesh {
  const hw = aspect / 2;
  return {
    position: new Float32Array([-hw, 0.5, 0, hw, 0.5, 0, -hw, -0.5, 0, hw, -0.5, 0]),
    uv: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
    index: new Uint32Array([0, 2, 3, 0, 3, 1]),
    raw: new Float32Array(4),
    base: depth,
    scale: 1,
  };
}

/**
 * Background layer. Single layer / scope all: displaced by the depth map. Scope subject: a flat plane at
 * backgroundDepth (`coarse` = a single quad instead of the full grid). Null if every triangle tears.
 */
export function buildBackground(g: LayerGrids, p: MeshParams, coarse: boolean): LayerMesh | null {
  let m: LayerMesh | null;
  if (g.hasForeground && p.scope === 'subject') {
    m = coarse ? flatQuad(g.aspect, p.backgroundDepth) : assemble(g, new Float32Array(g.bg.length), p.backgroundDepth, 1, null, null, null);
  } else {
    m = assemble(g, g.bg, 0, 1, p.tear, null, null);
  }
  if (m) applyDepth(m, m.base, m.scale, p.zscale);
  return m;
}

/** Object layer (null when there is none or nothing survives). */
export function buildObject(g: LayerGrids, p: MeshParams): LayerMesh | null {
  if (!g.hasForeground || !g.obj || !g.fg) return null;
  const subject = p.scope === 'subject';
  const m = subject
    ? assemble(g, g.obj, p.backgroundDepth + 0.1, p.objectRelief, p.tear, g.near, g.inside)
    : assemble(g, g.fg, 0, 1, p.tear, g.near, g.inside);
  if (m) applyDepth(m, m.base, m.scale, p.zscale);
  return m;
}

/** z = (D - 0.5) * zscale with D = base + raw * scale, written in place. */
export function applyDepth(m: LayerMesh, base: number, scale: number, zscale: number): void {
  m.base = base;
  m.scale = scale;
  const n = m.raw.length;
  for (let i = 0; i < n; i++) m.position[i * 3 + 2] = (base + m.raw[i]! * scale - 0.5) * zscale;
}

/** Depth D of vertex i. */
export const vertexDepth = (m: LayerMesh, i: number): number => m.base + m.raw[i]! * m.scale;

/** Scale xy about `center` (image coordinates 0..1), in the mesh's own space. */
export function bakeObjectSize(m: LayerMesh, s: number, aspect: number, center: [number, number]): void {
  if (s === 1) return;
  const px = (center[0] - 0.5) * aspect;
  const py = 0.5 - center[1];
  for (let i = 0; i < m.raw.length; i++) {
    m.position[i * 3] = px + (m.position[i * 3]! - px) * s;
    m.position[i * 3 + 1] = py + (m.position[i * 3 + 1]! - py) * s;
  }
}
