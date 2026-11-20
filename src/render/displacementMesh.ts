/**
 * CPU-displaced grid mesh for one layer (background or foreground).
 *
 * Why CPU displacement: the exported GLB must contain real displaced geometry, and live slider
 * feedback only needs a cheap pass over a typed array (z = depth * relief, plus normals), which
 * costs ~1-3 ms at 256 segments. Heavy work (box-filtering the depth/mask maps down to the grid,
 * push-pull hole filling, topology) happens only when the scene, mesh resolution, overscan or
 * discontinuity cutoff change.
 *
 * Coordinates: world units, image plane height = 2, width = 2 * aspect, centred at the origin,
 * +x right, +y up, +z toward the camera. UVs use v = 0 at the TOP of the image (textures are not flipped).
 */
import * as THREE from 'three';
import { pushPullFill } from './depthFill';

export type LayerKind = 'background' | 'foreground';

export interface LayerInput {
  kind: LayerKind;
  width: number;
  height: number;
  /** Depth, 0..1 (1 = near). For the background this is already foreground-free (see fillBackgroundDepth). */
  depth: Float32Array;
  /** Foreground mask, 0..1 (foreground layer: weights depth extrapolation and culls empty triangles). */
  mask: Float32Array;
  /** Mask centroid in world xy (foreground scaling pivot). */
  centroid: { x: number; y: number };
}

export interface DisplacementParams {
  relief: number;
  /** Z offset of the layer (foreground elevation; 0 for the background). */
  elevation: number;
  /** Uniform xy scale around the centroid (foreground only). */
  scale: number;
  /** Rest camera distance used to pre-compensate perspective so the rest view equals the source image. */
  compDist: number;
}

const MASK_EPS = 0.02;

/** Mirror-wrap an integer index into [0, n). */
function mirror(i: number, n: number): number {
  const p = 2 * n;
  let m = ((i % p) + p) % p;
  if (m >= n) m = p - 1 - m;
  return m;
}

export class DisplacementLayer {
  readonly kind: LayerKind;
  /** Holds the shaded mesh and the wireframe overlay. */
  readonly object = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly wire: THREE.Mesh;

  private geometry: THREE.BufferGeometry;
  private readonly input: LayerInput;
  private readonly aspect: number;

  private cols = 0;
  private rows = 0;
  private cellW = 0;
  private cellH = 0;
  private baseXY: Float32Array = new Float32Array(0);
  private gridDepth: Float32Array = new Float32Array(0);
  private gridMask: Float32Array = new Float32Array(0);
  private zGrid: Float32Array = new Float32Array(0);
  private position!: THREE.BufferAttribute;
  private normal!: THREE.BufferAttribute;
  private uv!: THREE.BufferAttribute;
  private cutoff = 1;
  private last: DisplacementParams | null = null;

  constructor(input: LayerInput, material: THREE.Material, wireColor: number) {
    this.kind = input.kind;
    this.input = input;
    this.aspect = input.width / input.height;
    this.geometry = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.name = input.kind === 'foreground' ? 'Foreground' : 'Background';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = input.kind === 'foreground' ? 1 : 0;
    this.wire = new THREE.Mesh(
      this.geometry,
      new THREE.MeshBasicMaterial({
        color: wireColor,
        wireframe: true,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    );
    this.wire.frustumCulled = false;
    this.wire.renderOrder = 2;
    this.wire.visible = false;
    this.object.add(this.mesh, this.wire);
  }

  get triangleCount(): number {
    return (this.geometry.index?.count ?? 0) / 3;
  }

  /**
   * (Re)build the grid: sampling of depth/mask, UVs, topology. Call when the scene, resolution
   * or overscan changes; follow with `update()`.
   */
  configure(resolution: number, overscan: number, cutoff: number): void {
    const { width: iw, height: ih, depth, mask } = this.input;
    const fg = this.kind === 'foreground';
    const extent = fg ? 1 : overscan;
    const planeW = 2 * this.aspect * extent;
    const planeH = 2 * extent;
    const seg = Math.max(2, Math.round(resolution));
    const segX = planeW >= planeH ? seg : Math.max(1, Math.round((seg * planeW) / planeH));
    const segY = planeW >= planeH ? Math.max(1, Math.round((seg * planeH) / planeW)) : seg;
    const cols = segX + 1;
    const rows = segY + 1;
    const n = cols * rows;
    this.cols = cols;
    this.rows = rows;
    this.cellW = planeW / segX;
    this.cellH = planeH / segY;
    this.cutoff = cutoff;
    this.last = null;

    this.baseXY = new Float32Array(n * 2);
    const uvs = new Float32Array(n * 2);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        const px = (i / segX - 0.5) * planeW;
        const py = (0.5 - j / segY) * planeH;
        this.baseXY[k * 2] = px;
        this.baseXY[k * 2 + 1] = py;
        uvs[k * 2] = 0.5 + px / (2 * this.aspect);
        uvs[k * 2 + 1] = 0.5 - py / 2;
      }
    }

    // Footprint of one grid cell in source pixels.
    const cellPxX = (this.cellW / (2 * this.aspect)) * iw;
    const cellPxY = (this.cellH / 2) * ih;
    const rx = Math.max(0.5, cellPxX / 2);
    const ry = Math.max(0.5, cellPxY / 2);

    const avgDepth = new Float32Array(n); // plain box average of the depth map
    const val = new Float32Array(n);
    const wt = new Float32Array(n);
    const cov = new Float32Array(n); // foreground: mask coverage of each footprint
    const gridMask = new Float32Array(n);

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        const cx = uvs[k * 2]! * iw - 0.5;
        const cy = uvs[k * 2 + 1]! * ih - 0.5;
        const xa = Math.round(cx - rx);
        const xb = Math.round(cx + rx);
        const ya = Math.round(cy - ry);
        const yb = Math.round(cy + ry);
        let sumAll = 0;
        let count = 0;
        let sumDM = 0;
        let sumM = 0; // foreground: mask-weighted depth
        for (let y = ya; y <= yb; y++) {
          const row = mirror(y, ih) * iw;
          for (let x = xa; x <= xb; x++) {
            const p = row + mirror(x, iw);
            const d = depth[p]!;
            sumAll += d;
            count++;
            if (fg) {
              const m = mask[p]!;
              sumDM += d * m;
              sumM += m;
            }
          }
        }
        avgDepth[k] = sumAll / count;
        if (fg) {
          // Only trust vertices whose footprint is (almost) fully inside the subject; silhouette vertices are
          // extrapolated below, which keeps the outline smooth instead of jagged by partial-coverage depth.
          val[k] = sumM > 1e-6 ? sumDM / sumM : avgDepth[k]!;
          cov[k] = sumM / count;
          wt[k] = Math.min(Math.max((cov[k]! - 0.8) / 0.2, 0), 1);
        }
      }
    }

    if (fg) {
      // Max-filtered mask (one cell radius) -> conservative triangle culling.
      const mrx = Math.max(1, Math.round(cellPxX));
      const mry = Math.max(1, Math.round(cellPxY));
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const k = j * cols + i;
          const cx = Math.round(uvs[k * 2]! * iw - 0.5);
          const cy = Math.round(uvs[k * 2 + 1]! * ih - 0.5);
          let mx = 0;
          for (let y = cy - mry; y <= cy + mry && mx < 1; y++) {
            if (y < 0 || y >= ih) continue;
            const row = y * iw;
            for (let x = cx - mrx; x <= cx + mrx; x++) {
              if (x < 0 || x >= iw) continue;
              const m = mask[row + x]!;
              if (m > mx) mx = m;
            }
          }
          gridMask[k] = mx;
        }
      }
    }
    this.gridMask = gridMask;

    // Foreground: multi-scale extrapolation of depth into vertices outside the subject, so the
    // silhouette follows the object instead of the far background.
    let totalW = 0;
    for (let k = 0; k < n; k++) totalW += wt[k]!;
    if (fg && totalW < 4) {
      // Very thin subject: no vertex is fully inside, fall back to partial-coverage weighting.
      totalW = 0;
      for (let k = 0; k < n; k++) totalW += wt[k] = Math.min(1, cov[k]! * 4);
    }
    this.gridDepth = fg && totalW > 0 ? pushPullFill(val, wt, cols, rows) : avgDepth;

    this.zGrid = new Float32Array(n);
    this.position = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.normal = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.normal.setUsage(THREE.DynamicDrawUsage);
    this.uv = new THREE.BufferAttribute(uvs, 2);

    this.swapGeometry();
  }

  /** Foreground only: rebuild the index buffer for a new discontinuity cutoff. */
  setCutoff(cutoff: number): void {
    if (this.kind !== 'foreground' || cutoff === this.cutoff || this.cols === 0) return;
    this.cutoff = cutoff;
    this.swapGeometry();
  }

  /** Recompute positions (and normals) for new displacement parameters. Cheap; no allocation. */
  update(p: DisplacementParams): void {
    if (this.cols === 0) return;
    const prev = this.last;
    if (prev && prev.relief === p.relief && prev.elevation === p.elevation && prev.scale === p.scale && prev.compDist === p.compDist) {
      return;
    }
    const heightChanged = !prev || prev.relief !== p.relief || prev.elevation !== p.elevation || prev.scale !== p.scale;
    this.last = { ...p };

    const fg = this.kind === 'foreground';
    const n = this.cols * this.rows;
    const z = this.zGrid;
    const gd = this.gridDepth;
    const base = fg ? p.elevation : 0;
    const s = fg ? p.scale : 1;
    const cx = this.input.centroid.x;
    const cy = this.input.centroid.y;
    const D = p.compDist;
    const bxy = this.baseXY;
    const pos = this.position.array as Float32Array;

    for (let k = 0; k < n; k++) {
      const zk = base + gd[k]! * p.relief;
      z[k] = zk;
      let x = bxy[k * 2]!;
      let y = bxy[k * 2 + 1]!;
      if (fg) {
        x = cx + (x - cx) * s;
        y = cy + (y - cy) * s;
      }
      // Pre-compensate perspective so geometry at depth z projects to where the flat image pixel would.
      const f = D > 0 ? Math.max((D - zk) / D, 0.05) : 1;
      pos[k * 3] = x * f;
      pos[k * 3 + 1] = y * f;
      pos[k * 3 + 2] = zk;
    }
    this.position.needsUpdate = true;

    if (heightChanged) {
      this.computeNormals(this.cellW * s, this.cellH * s);
      this.normal.needsUpdate = true;
    }
  }

  /** Fresh, GPU-independent copy of the current baked geometry (used for GLB export). */
  cloneBaked(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute((this.position.array as Float32Array).slice(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute((this.normal.array as Float32Array).slice(), 3));
    g.setAttribute('uv', new THREE.BufferAttribute((this.uv.array as Float32Array).slice(), 2));
    const idx = this.geometry.index;
    if (idx) g.setIndex(new THREE.BufferAttribute((idx.array as Uint32Array).slice(), 1));
    return g;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.wire.material as THREE.Material).dispose();
  }

  // ───────────────────────────────────────── internals ─────────────────────────────────────────

  /** Build a new BufferGeometry (new index, shared vertex attributes) and dispose the old one. */
  private swapGeometry(): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', this.position);
    g.setAttribute('normal', this.normal);
    g.setAttribute('uv', this.uv);
    g.setIndex(this.buildIndex());
    const old = this.geometry;
    this.geometry = g;
    this.mesh.geometry = g;
    this.wire.geometry = g;
    old.dispose();
  }

  private buildIndex(): THREE.BufferAttribute {
    const { cols, rows } = this;
    const d = this.gridDepth;
    const m = this.gridMask;
    const fg = this.kind === 'foreground';
    const cut = fg && this.cutoff < 0.999 ? this.cutoff : Infinity;
    const out = new Uint32Array((cols - 1) * (rows - 1) * 6);
    let n = 0;

    const keep = (p: number, q: number, r: number): boolean => {
      if (!fg) return true;
      if (m[p]! < MASK_EPS && m[q]! < MASK_EPS && m[r]! < MASK_EPS) return false;
      if (cut === Infinity) return true;
      const a = d[p]!;
      const b = d[q]!;
      const c = d[r]!;
      return Math.max(a, b, c) - Math.min(a, b, c) <= cut;
    };
    const emit = (p: number, q: number, r: number): void => {
      if (!keep(p, q, r)) return;
      out[n++] = p;
      out[n++] = q;
      out[n++] = r;
    };

    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = j * cols + i;
        const b = a + 1;
        const c = a + cols;
        const e = c + 1;
        // Split along the diagonal with the smaller depth difference (fewer stretched triangles). CCW seen from +z.
        if (Math.abs(d[a]! - d[e]!) <= Math.abs(d[b]! - d[c]!)) {
          emit(a, c, e);
          emit(a, e, b);
        } else {
          emit(a, c, b);
          emit(b, c, e);
        }
      }
    }
    return new THREE.BufferAttribute(out.slice(0, n), 1);
  }

  /** Normals from a Sobel gradient of the height field (smooth, robust against hard depth steps). */
  private computeNormals(cw: number, ch: number): void {
    const { cols, rows } = this;
    const z = this.zGrid;
    const nor = this.normal.array as Float32Array;
    // Sobel weights sum to 4 (smoothing) x 2 cells (difference span).
    const invX = 1 / (8 * cw);
    const invY = 1 / (8 * ch);
    for (let j = 0; j < rows; j++) {
      const r0 = Math.max(j - 1, 0) * cols;
      const r1 = j * cols;
      const r2 = Math.min(j + 1, rows - 1) * cols;
      for (let i = 0; i < cols; i++) {
        const c0 = Math.max(i - 1, 0);
        const c2 = Math.min(i + 1, cols - 1);
        const span = c2 - c0 || 1;
        const rspan = (Math.min(j + 1, rows - 1) - Math.max(j - 1, 0)) || 1;
        const dzdx =
          ((z[r0 + c2]! - z[r0 + c0]!) + 2 * (z[r1 + c2]! - z[r1 + c0]!) + (z[r2 + c2]! - z[r2 + c0]!)) * invX * (2 / span);
        // Row index grows downward, world y grows upward.
        const dzdy =
          ((z[r0 + c0]! - z[r2 + c0]!) + 2 * (z[r0 + i]! - z[r2 + i]!) + (z[r0 + c2]! - z[r2 + c2]!)) * invY * (2 / rspan);
        const il = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
        const o = (r1 + i) * 3;
        nor[o] = -dzdx * il;
        nor[o + 1] = -dzdy * il;
        nor[o + 2] = il;
      }
    }
  }
}
