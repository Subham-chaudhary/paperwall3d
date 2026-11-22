/**
 * GLB export: the same meshes as the 3D view (same grid, depth mapping, edge-tear triangle dropping, object
 * size), as unlit materials with embedded textures: a `background` plane (a single quad when it is flat) and a
 * `object` cut out by alpha, plus a perspective camera framing the picture.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { PreparedScene, Settings } from '../core/types';
import { bakeObjectSize, buildBackground, buildObject, LayerGrids, type LayerMesh } from './meshBuild';
import { colorSize } from './layout';
import { fitImageData, imageDataTexture } from './textures';

const FOV = 40;
/** glTF viewers rarely take more; the exporter resamples (HD layers are at most 3840 px, so normally nothing changes). */
const MAX_GLB_TEXTURE = 4096;

export interface ExportOptions {
  showBackground: boolean;
  showForeground: boolean;
}

function geometryOf(m: LayerMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  return g;
}

export async function exportSceneToGLB(scene: PreparedScene, settings: Settings, opts: ExportOptions): Promise<Blob> {
  const root = new THREE.Scene();
  root.name = 'PaperWall3D';
  const disposables: { dispose(): void }[] = [];
  const c = settings.camera3d;
  const L = settings.layers;
  const single = !scene.hasForeground;
  const grids = new LayerGrids(scene, c.segs);
  const params = {
    segs: c.segs,
    zscale: c.zscale,
    tear: c.tear,
    scope: L.scope,
    backgroundDepth: L.backgroundDepth,
    objectRelief: L.objectRelief,
  };

  const add = (name: string, data: LayerMesh, img: ImageData, cutout: boolean): void => {
    const geometry = geometryOf(data);
    const map = imageDataTexture(fitImageData(img, MAX_GLB_TEXTURE), 1, true);
    map.generateMipmaps = false;
    map.userData.mimeType = cutout ? 'image/png' : 'image/jpeg';
    const material = new THREE.MeshBasicMaterial({
      name: `${name}Material`,
      map,
      side: THREE.DoubleSide,
      alphaTest: cutout ? 0.5 : 0,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    root.add(mesh);
    disposables.push(geometry, material, map);
  };

  if (opts.showBackground) {
    const bg = buildBackground(grids, params, true);
    if (bg) add('background', bg, single ? scene.source : scene.bgColor, false);
  }
  if (opts.showForeground && !single) {
    const fg = buildObject(grids, params);
    if (fg) {
      bakeObjectSize(fg, L.objectSize, grids.aspect, scene.center);
      add('object', fg, scene.fg, true);
    }
  }
  if (!root.children.length) throw new Error('Nothing to export: every layer is hidden or empty');

  const cs = colorSize(scene);
  const aspect = cs.w / cs.h;
  const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const cam = new THREE.PerspectiveCamera(FOV, aspect, 0.01, 100);
  cam.name = 'Camera';
  cam.position.set(0, 0, (1.15 * 0.5) / t); // whole picture in frame, like the 3D view's home camera
  cam.updateMatrixWorld();
  root.add(cam);

  try {
    const buffer = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false, maxTextureSize: MAX_GLB_TEXTURE });
    return new Blob([buffer as ArrayBuffer], { type: 'model/gltf-binary' });
  } finally {
    for (const d of disposables) d.dispose();
  }
}
