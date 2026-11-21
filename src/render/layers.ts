/**
 * SceneLayers: owns all GPU resources (textures, materials, geometries) built from one PreparedScene
 * and applies geometry settings to the background / foreground displacement meshes.
 * Everything is released in `dispose()`, which the renderer calls on every `setScene`.
 */
import * as THREE from 'three';
import type { GeometrySettings, PreparedScene } from '../core/types';
import { fillBackgroundDepth } from './depthFill';
import { DisplacementLayer } from './displacementMesh';
import { createLayerMaterial, type SharedUniforms } from './materials';
import { depthTexture, imageDataTexture } from './textures';

/** Exploded-view offsets (world units along z) at full blend. */
const EXPLODE_BG = -0.45;
const EXPLODE_FG = 0.6;

export class SceneLayers {
  readonly group = new THREE.Group();
  /** Image aspect (width / height). */
  readonly aspect: number;
  readonly background: DisplacementLayer;
  readonly foreground: DisplacementLayer | null;

  readonly bgTexture: THREE.DataTexture;
  readonly fgTexture: THREE.DataTexture | null;
  private readonly bgDepthTex: THREE.DataTexture;
  private readonly fgDepthTex: THREE.DataTexture | null;
  private readonly materials: THREE.Material[] = [];

  private lastGeometry: GeometrySettings | null = null;

  constructor(scene: PreparedScene, shared: SharedUniforms, maxAnisotropy: number) {
    this.group.name = 'PaperWall3D';
    this.aspect = scene.width / scene.height;
    shared.uTexel.value.set(1 / scene.width, 1 / scene.height);

    this.bgTexture = imageDataTexture(scene.background, maxAnisotropy, true);
    // The background must not inherit the subject's depth: fill the masked region from its surroundings.
    const bgDepth = !scene.hasForeground
      ? scene.depth
      : (scene.backgroundDepth ?? fillBackgroundDepth(scene.depth, scene.mask, scene.width, scene.height));
    this.bgDepthTex = depthTexture(bgDepth, scene.width, scene.height);

    const centroid = maskCentroid(scene.mask, scene.width, scene.height, this.aspect);

    const bgMat = createLayerMaterial('background', shared, this.bgTexture, this.bgDepthTex);
    this.materials.push(bgMat);
    this.background = new DisplacementLayer(
      { kind: 'background', width: scene.width, height: scene.height, depth: bgDepth, mask: scene.mask, centroid },
      bgMat,
      0x8a8a8a,
    );
    this.group.add(this.background.object);

    if (scene.hasForeground) {
      this.fgTexture = imageDataTexture(scene.foreground, maxAnisotropy, false);
      this.fgDepthTex = depthTexture(scene.depth, scene.width, scene.height);
      const fgMat = createLayerMaterial('foreground', shared, this.fgTexture, this.fgDepthTex);
      this.materials.push(fgMat);
      this.foreground = new DisplacementLayer(
        { kind: 'foreground', width: scene.width, height: scene.height, depth: scene.depth, mask: scene.mask, centroid },
        fgMat,
        0xf08a24,
      );
      this.group.add(this.foreground.object);
    } else {
      this.fgTexture = null;
      this.fgDepthTex = null;
      this.foreground = null;
    }
  }

  /** Apply geometry settings, rebuilding only what changed since the previous call. */
  update(g: GeometrySettings, compDist: number): void {
    const prev = this.lastGeometry;
    const rebuildAll = !prev || prev.meshResolution !== g.meshResolution;

    if (rebuildAll || prev.overscan !== g.overscan) {
      this.background.configure(g.meshResolution, g.overscan, g.discontinuityCutoff);
    }
    this.background.update({ relief: g.backgroundRelief, elevation: 0, scale: 1, compDist });

    const fg = this.foreground;
    if (fg) {
      if (rebuildAll) fg.configure(g.meshResolution, g.overscan, g.discontinuityCutoff);
      else if (prev.discontinuityCutoff !== g.discontinuityCutoff) fg.setCutoff(g.discontinuityCutoff);
      fg.update({ relief: g.foregroundRelief, elevation: g.objectElevation, scale: g.foregroundScale, compDist });
    }
    this.lastGeometry = { ...g };
  }

  /** Exploded-view blend 0..1 (moves layers apart along z without touching geometry). */
  setExplode(blend: number): void {
    this.background.object.position.z = EXPLODE_BG * blend;
    if (this.foreground) this.foreground.object.position.z = EXPLODE_FG * blend;
  }

  setWireframe(on: boolean): void {
    this.background.wire.visible = on;
    if (this.foreground) this.foreground.wire.visible = on;
  }

  get triangleCount(): number {
    return this.background.triangleCount + (this.foreground?.triangleCount ?? 0);
  }

  dispose(): void {
    this.background.dispose();
    this.foreground?.dispose();
    for (const m of this.materials) m.dispose();
    this.bgTexture.dispose();
    this.fgTexture?.dispose();
    this.bgDepthTex.dispose();
    this.fgDepthTex?.dispose();
    this.group.clear();
  }
}

/** Mask-weighted centroid in world xy (falls back to the image centre for empty masks). */
function maskCentroid(mask: Float32Array, w: number, h: number, aspect: number): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  let sm = 0;
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    let rowX = 0;
    const o = y * w;
    for (let x = 0; x < w; x++) {
      const m = mask[o + x]!;
      rowSum += m;
      rowX += m * x;
    }
    sm += rowSum;
    sx += rowX;
    sy += rowSum * y;
  }
  if (sm < 1e-6) return { x: 0, y: 0 };
  const u = (sx / sm + 0.5) / w;
  const v = (sy / sm + 0.5) / h;
  return { x: (u - 0.5) * 2 * aspect, y: (0.5 - v) * 2 };
}
