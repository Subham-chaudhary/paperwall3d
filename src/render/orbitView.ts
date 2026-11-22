/**
 * True 3D view: the layer set as displaced meshes under an OrbitControls camera.
 *
 * Meshes come from meshBuild.ts (CPU grid, edge-tear, object cut by alpha) and are unlit, sRGB-correct so colours
 * match the source. Topology is rebuilt only when segs / tear / scope / (subject scope) relief change; z-scale and
 * background-depth changes rewrite the z attribute in place so those sliders feel live.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PreparedScene, Settings } from '../core/types';
import { createGridHelper, disposeGridHelper } from './gridHelper';
import {
  applyDepth,
  buildBackground,
  buildObject,
  LayerGrids,
  sameTopology,
  vertexDepth,
  type LayerMesh,
  type MeshParams,
} from './meshBuild';
import { colorSize } from './layout';
import { grayImage, imageDataTexture, type ColorTextureCache } from './textures';

const FOV = 40;
const WIRE_OBJECT = '#ff3c9e';
const WIRE_BACKGROUND = '#6b5fa8';

export interface OrbitInputs {
  settings: Settings;
  showBackground: boolean;
  showForeground: boolean;
  showGrid: boolean;
}

/** Google's "turbo" colormap (polynomial approximation), t in 0..1 -> sRGB 0..1. */
function turbo(t: number, out: THREE.Color): THREE.Color {
  const x = Math.min(1, Math.max(0, t));
  const r = 0.13572138 + x * (4.6153926 + x * (-42.66032258 + x * (132.13108234 + x * (-152.94239396 + x * 59.28637943))));
  const g = 0.09140261 + x * (2.19418839 + x * (4.84296658 + x * (-14.18503333 + x * (4.27729857 + x * 2.82956604))));
  const b = 0.1066733 + x * (12.64194608 + x * (-60.58204836 + x * (110.36276771 + x * (-89.90310912 + x * 27.34824973))));
  const c = (v: number): number => Math.min(1, Math.max(0, v));
  return out.setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace);
}

interface Slot {
  data: LayerMesh;
  geometry: THREE.BufferGeometry;
  group: THREE.Group;
  mesh: THREE.Mesh;
  wire: THREE.Mesh;
  /** `base|scale` the vertex colours were computed for, or null if stale/absent. */
  colorsFor: string | null;
}

interface LayerMaterials {
  textured: THREE.MeshBasicMaterial;
  depth: THREE.MeshBasicMaterial;
  wire: THREE.MeshBasicMaterial;
}

export class OrbitView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 100);
  private readonly controls: OrbitControls;
  private readonly grid = createGridHelper();
  private readonly root = new THREE.Group();

  private data: PreparedScene | null = null;
  private grids: LayerGrids | null = null;
  private params: MeshParams | null = null;
  private bg: Slot | null = null;
  private fg: Slot | null = null;
  private mats: { bg: LayerMaterials; fg: LayerMaterials } | null = null;
  private textures: THREE.Texture[] = [];
  private element: HTMLElement | null = null;
  private viewAspect = 1;

  constructor(
    private readonly maxAnisotropy: number,
    private readonly colorCache: ColorTextureCache,
  ) {
    this.scene.add(this.grid, this.root);
    this.controls = new OrbitControls(this.camera);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.rotateSpeed = 0.8;
    c.autoRotateSpeed = 1.5;
    c.screenSpacePanning = true;
    c.minDistance = 0.2;
    c.maxDistance = 8;
  }

  /** Attach to / detach from the canvas. The controls only listen while the 3D view is showing. */
  setActive(element: HTMLElement | null): void {
    if (element === this.element) return;
    if (this.element) this.controls.disconnect();
    this.element = element;
    if (element) this.controls.connect(element);
  }

  setScene(scene: PreparedScene): void {
    this.disposeScene();
    this.data = scene;
    this.resetCamera();
  }

  resize(w: number, h: number): void {
    this.viewAspect = w / Math.max(h, 1);
    this.camera.aspect = this.viewAspect;
    this.camera.updateProjectionMatrix();
  }

  /** Back to the front view fitting the whole picture. */
  resetCamera(): void {
    const cs = this.data ? colorSize(this.data) : null;
    const aspect = cs ? cs.w / cs.h : 1.6;
    const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const dist = 1.15 * Math.max(0.5 / t, aspect / 2 / (t * Math.max(this.viewAspect, 0.1)));
    this.camera.position.set(0, 0, dist);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  /** Advance damping / auto-rotate. True while the camera is still moving. */
  update(dt: number): boolean {
    return this.controls.update(dt);
  }

  /** Bring meshes and visibility in line with the settings. Cheap when nothing relevant changed. */
  sync(inp: OrbitInputs): void {
    const sc = this.data;
    if (!sc) return;
    this.mats ??= { bg: this.layerMaterials(sc, 'bg'), fg: this.layerMaterials(sc, 'fg') };
    const c = inp.settings.camera3d;
    const L = inp.settings.layers;
    const next: MeshParams = {
      segs: c.segs,
      zscale: c.zscale,
      tear: c.tear,
      scope: L.scope,
      backgroundDepth: L.backgroundDepth,
      objectRelief: L.objectRelief,
    };

    if (!this.grids || this.grids.segs !== next.segs) this.grids = new LayerGrids(sc, next.segs);
    const prev = this.params;
    if (!prev || !sameTopology(prev, next)) {
      this.rebuild(next);
    } else if (prev.zscale !== next.zscale || prev.backgroundDepth !== next.backgroundDepth || prev.objectRelief !== next.objectRelief) {
      this.rewriteDepth(next);
    }
    this.params = next;

    this.placeObject(L.objectSize, sc);

    const useDepthColors = c.depthcol;
    for (const slot of [this.bg, this.fg]) {
      if (!slot) continue;
      const isFg = slot === this.fg;
      const m = isFg ? this.mats.fg : this.mats.bg;
      slot.mesh.material = useDepthColors ? m.depth : m.textured;
      if (useDepthColors) this.updateColors(slot);
      slot.wire.visible = c.wire;
    }
    if (this.bg) this.bg.group.visible = c.showbg && inp.showBackground;
    if (this.fg) this.fg.group.visible = inp.showForeground;
    this.grid.visible = inp.showGrid;
    this.controls.autoRotate = c.rotate;
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.setActive(null);
    this.controls.dispose();
    this.disposeScene();
    this.scene.remove(this.grid);
    disposeGridHelper(this.grid);
  }

  // ───────────────────────────────────────── internals ─────────────────────────────────────────

  private layerMaterials(sc: PreparedScene, kind: 'bg' | 'fg'): LayerMaterials {
    const single = !sc.hasForeground;
    const isFg = kind === 'fg';
    const colorImg = isFg ? sc.fg : single ? sc.source : sc.bgColor;
    // Colour textures are shared through the cache (re-used while the ImageData instances stay the same).
    const map = isFg && single ? null : this.colorCache.get(colorImg, true);
    const shared = { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 } as const;
    const textured = new THREE.MeshBasicMaterial({ ...shared, map: map ?? undefined, alphaTest: isFg ? 0.5 : 0 });
    const depth = new THREE.MeshBasicMaterial({ ...shared, vertexColors: true });
    if (isFg) {
      const alphaMap = imageDataTexture(grayImage(sc.mask, sc.width, sc.height), this.maxAnisotropy, false);
      this.textures.push(alphaMap);
      depth.alphaMap = alphaMap;
      depth.alphaTest = 0.5;
    }
    const wire = new THREE.MeshBasicMaterial({
      color: new THREE.Color(isFg ? WIRE_OBJECT : WIRE_BACKGROUND),
      wireframe: true,
    });
    return { textured, depth, wire };
  }

  private makeSlot(data: LayerMesh, mats: LayerMaterials, name: string): Slot {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.position, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('uv', new THREE.BufferAttribute(data.uv, 2));
    geometry.setIndex(new THREE.BufferAttribute(data.index, 1));
    const mesh = new THREE.Mesh(geometry, mats.textured);
    const wire = new THREE.Mesh(geometry, mats.wire);
    mesh.name = name;
    wire.name = `${name} wireframe`;
    mesh.frustumCulled = wire.frustumCulled = false; // z is rewritten in place
    wire.renderOrder = 1;
    const group = new THREE.Group();
    group.add(mesh, wire);
    this.root.add(group);
    return { data, geometry, group, mesh, wire, colorsFor: null };
  }

  private disposeSlot(slot: Slot | null): void {
    if (!slot) return;
    this.root.remove(slot.group);
    slot.geometry.dispose();
  }

  private rebuild(p: MeshParams): void {
    const g = this.grids!;
    const mats = this.mats!;
    this.disposeSlot(this.bg);
    this.disposeSlot(this.fg);
    this.bg = this.fg = null;
    const bg = buildBackground(g, p, false);
    if (bg) this.bg = this.makeSlot(bg, mats.bg, 'Background');
    const fg = buildObject(g, p);
    if (fg) this.fg = this.makeSlot(fg, mats.fg, 'Foreground');
  }

  private rewriteDepth(p: MeshParams): void {
    const subject = p.scope === 'subject';
    const single = !this.data!.hasForeground;
    if (this.bg) {
      // flat background plane (subject scope) moves with backgroundDepth; a depth-mapped one only changes z-scale
      const flat = !single && subject;
      applyDepth(this.bg.data, flat ? p.backgroundDepth : 0, 1, p.zscale);
      this.markZ(this.bg);
    }
    if (this.fg) {
      applyDepth(this.fg.data, subject ? p.backgroundDepth + 0.1 : 0, subject ? p.objectRelief : 1, p.zscale);
      this.markZ(this.fg);
    }
  }

  private markZ(slot: Slot): void {
    (slot.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    slot.colorsFor = null;
  }

  /** Depth ramp colours per vertex (turbo), refreshed only when depth changed. */
  private updateColors(slot: Slot): void {
    const key = `${slot.data.base}|${slot.data.scale}`;
    if (slot.colorsFor === key && slot.geometry.getAttribute('color')) return;
    const n = slot.data.raw.length;
    let attr = slot.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!attr) {
      attr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
      slot.geometry.setAttribute('color', attr);
    }
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      turbo(vertexDepth(slot.data, i), c);
      attr.setXYZ(i, c.r, c.g, c.b);
    }
    attr.needsUpdate = true;
    slot.colorsFor = key;
  }

  /** Object size scales the object mesh about the object centre (relief and depth stay as they are). */
  private placeObject(s: number, sc: PreparedScene): void {
    if (!this.fg) return;
    const cs = colorSize(sc);
    const aspect = cs.w / cs.h;
    const [cx, cy] = sc.center;
    this.fg.group.scale.set(s, s, 1);
    this.fg.group.position.set((cx - 0.5) * aspect * (1 - s), (0.5 - cy) * (1 - s), 0);
  }

  private disposeScene(): void {
    this.disposeSlot(this.bg);
    this.disposeSlot(this.fg);
    this.bg = this.fg = null;
    if (this.mats) {
      for (const m of [this.mats.bg, this.mats.fg]) {
        m.textured.dispose();
        m.depth.dispose();
        m.wire.dispose();
      }
    }
    this.mats = null;
    for (const t of this.textures) t.dispose();
    this.textures = [];
    this.grids = null;
    this.params = null;
    this.data = null;
  }
}
