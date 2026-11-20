/**
 * GLB export: bakes the current displaced layers into standard-material meshes
 * ("Background", "Foreground") with embedded textures, plus the rest-pose camera.
 * The exploded-view offsets and wireframe overlays are never part of the export.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { SceneLayers } from './layers';

export async function exportLayersToGLB(layers: SceneLayers, restCamera: THREE.PerspectiveCamera): Promise<Blob> {
  const root = new THREE.Scene();
  root.name = 'PaperWall3D';
  const disposables: { dispose(): void }[] = [];

  const add = (name: string, layer: NonNullable<SceneLayers['foreground']>, map: THREE.Texture, alphaBlend: boolean): void => {
    const geo = layer.cloneBaked();
    const mat = new THREE.MeshStandardMaterial({
      name: `${name}Material`,
      map,
      roughness: 1,
      metalness: 0,
      transparent: alphaBlend,
      alphaTest: 0,
      side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    root.add(mesh);
    disposables.push(geo, mat);
  };

  add('Background', layers.background, layers.bgTexture, false);
  if (layers.foreground && layers.fgTexture) add('Foreground', layers.foreground, layers.fgTexture, true);

  const cam = restCamera.clone();
  cam.name = 'Camera';
  root.add(cam);

  try {
    const buffer = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false });
    return new Blob([buffer as ArrayBuffer], { type: 'model/gltf-binary' });
  } finally {
    for (const d of disposables) d.dispose();
  }
}
