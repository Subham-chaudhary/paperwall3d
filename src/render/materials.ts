/**
 * Layer materials + the shared uniform block that drives lighting / view mode for every layer.
 *
 * One ShaderMaterial per layer; both reference the *same* uniform objects so a single
 * `applyLighting` call updates everything.
 */
import * as THREE from 'three';
import { DEFAULT_SETTINGS } from '../core/defaults';
import type { LightingSettings, ViewMode } from '../core/types';
import type { LayerKind } from './displacementMesh';
import { LAYER_FRAGMENT, LAYER_VERTEX } from './shaders';

const DEG = Math.PI / 180;

/** Normalisation so a camera-facing surface under the default rig keeps its source colour. */
const LIGHT_NORM = (() => {
  const l = DEFAULT_SETTINGS.lighting;
  const ndl = Math.max(Math.cos(l.keyAzimuth * DEG) * Math.cos(l.keyElevation * DEG), 0);
  const key = new THREE.Color(l.keyColor);
  const keyLum = key.r * 0.2126 + key.g * 0.7152 + key.b * 0.0722;
  return 1 / (l.ambient + l.keyIntensity * ndl * keyLum);
})();

interface U<T> {
  value: T;
}

export interface SharedUniforms {
  uMode: U<number>;
  uLit: U<number>;
  uExposure: U<number>;
  uAmbient: U<number>;
  uKeyColor: U<THREE.Color>;
  uKeyIntensity: U<number>;
  uKeyDir: U<THREE.Vector3>;
  uRimColor: U<THREE.Color>;
  uRimIntensity: U<number>;
  uRimDir: U<THREE.Vector3>;
  uDepthShading: U<number>;
  uLightNorm: U<number>;
  uTexel: U<THREE.Vector2>;
}

export function createSharedUniforms(): SharedUniforms {
  return {
    uMode: { value: 0 },
    uLit: { value: 1 },
    uExposure: { value: 1 },
    uAmbient: { value: 0.75 },
    uKeyColor: { value: new THREE.Color('#ffffff') },
    uKeyIntensity: { value: 0.6 },
    uKeyDir: { value: new THREE.Vector3(0, 0, 1) },
    uRimColor: { value: new THREE.Color('#ffffff') },
    uRimIntensity: { value: 0.25 },
    uRimDir: { value: new THREE.Vector3(0, 0, -1) },
    uDepthShading: { value: 0.2 },
    uLightNorm: { value: LIGHT_NORM },
    uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
  };
}

/** Push lighting settings into the shared uniforms. The pointer (-1..1) steers the key light when followCursor is on. */
export function applyLighting(u: SharedUniforms, l: LightingSettings, pointerX: number, pointerY: number): void {
  u.uLit.value = l.enabled ? 1 : 0;
  u.uExposure.value = l.exposure;
  u.uAmbient.value = l.ambient;
  u.uKeyColor.value.set(l.keyColor);
  u.uKeyIntensity.value = l.keyIntensity;
  u.uRimColor.value.set(l.rimColor);
  u.uRimIntensity.value = l.rimIntensity;
  u.uDepthShading.value = l.depthShading;

  const az = (l.keyAzimuth + (l.followCursor ? pointerX * 35 : 0)) * DEG;
  const el = Math.min(Math.max(l.keyElevation + (l.followCursor ? pointerY * 20 : 0), -10), 89) * DEG;
  u.uKeyDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
  // Rim comes from the opposite side and from behind the surface.
  u.uRimDir.value.set(-u.uKeyDir.value.x * 1.2, 0.35, -0.7).normalize();
}

export function viewModeUniform(mode: ViewMode): number {
  return mode === 'depth' ? 1 : mode === 'mask' ? 2 : 0;
}

export function createLayerMaterial(
  kind: LayerKind,
  shared: SharedUniforms,
  map: THREE.Texture,
  depthMap: THREE.Texture,
): THREE.ShaderMaterial {
  const fg = kind === 'foreground';
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map }, uDepthMap: { value: depthMap }, ...shared },
    vertexShader: LAYER_VERTEX,
    fragmentShader: LAYER_FRAGMENT,
    defines: fg ? { IS_FOREGROUND: '' } : {},
    // Foreground: smooth alpha-blended edges with depth writes so layers still sort correctly.
    transparent: fg,
    depthWrite: true,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}
