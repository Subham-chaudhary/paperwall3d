import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  segmentation: {
    enabled: true,
    model: 'u2netp',
    threshold: 0.5,
    feather: 2,
    dilate: 0,
    minIslandArea: 0.002,
    invert: false,
  },
  depth: {
    model: 'depth-anything-v2-small',
    invert: false,
    contrast: 1,
    gamma: 1,
    smoothing: 2,
    near: 0,
    far: 1,
  },
  reconstruction: {
    inpaint: true,
    inpaintPadding: 6,
    inpaintSoftness: 0.4,
    edgeBleed: 4,
  },
  geometry: {
    meshResolution: 256,
    backgroundRelief: 0.35,
    foregroundRelief: 0.25,
    objectElevation: 0.3,
    foregroundScale: 1,
    discontinuityCutoff: 0.6,
    overscan: 1.12,
  },
  lighting: {
    enabled: true,
    exposure: 1,
    ambient: 0.75,
    keyIntensity: 0.6,
    keyColor: '#fff4e5',
    keyAzimuth: 35,
    keyElevation: 40,
    rimIntensity: 0.25,
    rimColor: '#9ecbff',
    followCursor: true,
    depthShading: 0.2,
  },
  camera: {
    mode: 'cursor',
    parallax: 1,
    tilt: 6,
    damping: 0.9,
    fov: 35,
    zoom: 1,
    autoSpeed: 0.5,
    invertX: false,
    invertY: false,
  },
  view: {
    mode: 'render',
    showGrid: false,
    showStats: false,
    background: '#1d1d1d',
  },
  runtime: {
    backend: 'auto',
    workingResolution: 1024,
  },
};

export function cloneSettings(s: Settings): Settings {
  return structuredClone(s);
}

/** Deep-merge a partial (possibly older-schema) settings object onto defaults. Unknown keys are dropped. */
export function mergeSettings(partial: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const out = cloneSettings(base);
  if (!partial || typeof partial !== 'object') return out;
  for (const section of Object.keys(out) as (keyof Settings)[]) {
    const src = (partial as Record<string, unknown>)[section];
    if (!src || typeof src !== 'object') continue;
    const dst = out[section] as unknown as Record<string, unknown>;
    for (const key of Object.keys(dst)) {
      const v = (src as Record<string, unknown>)[key];
      if (v !== undefined && typeof v === typeof dst[key]) dst[key] = v;
    }
  }
  return out;
}
