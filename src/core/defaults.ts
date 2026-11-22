import type { Settings } from './types';

/** Defaults follow 2.5dwallpp, except `mask.mask_model`: U²-NetP (fast, 4.6 MB) instead of U²-Net (176 MB). */
export const DEFAULT_SETTINGS: Settings = {
  parallax: {
    strength: 0.04,
    focus: 0.5,
    tilt: 5,
    lighting: 0.25,
    smoothing: 0.12,
    autoMotion: false,
    inverse: true,
  },
  layers: {
    scope: 'subject',
    backgroundDepth: 0.2,
    objectSize: 1,
    objectRelief: 0.5,
  },
  mask: {
    use_subject: true,
    mask_model: 'u2netp',
    flip_avg: false,
    refine: false,
    mask_norm: true,
    thresh: 0.5,
    depth_assist: false,
    min_area: 0.2,
    largest_only: false,
    fill_holes: true,
    mask_invert: false,
    grow: 0,
    feather: 2,
    rim: 4,
    click: null,
  },
  depth: {
    model: 'depth-anything-v2-small',
    depth_size: 518,
    clip_lo: 1,
    clip_hi: 99,
    smooth: 1.2,
    gamma: 1,
    depth_invert: false,
    edge_snap: 0,
  },
  camera3d: {
    segs: 256,
    zscale: 0.6,
    tear: 0.25,
    wire: false,
    depthcol: false,
    showbg: true,
    rotate: false,
  },
  view: {
    mode: '2d',
    stage: 'result',
    background: '#0b0a12',
    showStats: false,
  },
  wallpaper: {
    aspect: 'screen',
    overlay: true,
  },
  runtime: {
    backend: 'auto',
    workingResolution: 1600,
    outputResolution: 'auto',
  },
};

export function cloneSettings(s: Settings): Settings {
  return structuredClone(s);
}

type Rec = Record<string, unknown>;

function isClick(v: unknown): v is [number, number] | null {
  return v === null || (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n)));
}

/**
 * Merge a partial settings document onto `base`. Accepts the nested form (`{ mask: { thresh: 0.4 } }`) and,
 * like 2.5dwallpp's config.json, flat keys (`{ thresh: 0.4 }`) which are matched to their section by name.
 * Unknown keys and values of the wrong type are dropped. Numbers/enums are NOT clamped here; use
 * `sanitizeSettings` from ./schema for that.
 */
export function mergeSettings(partial: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const out = cloneSettings(base);
  if (!partial || typeof partial !== 'object') return out;
  const src = partial as Rec;
  const sections = Object.keys(out) as (keyof Settings)[];

  const assign = (section: keyof Settings, key: string, v: unknown): void => {
    const dst = out[section] as unknown as Rec;
    if (!(key in dst) || v === undefined) return;
    if (key === 'click') {
      if (isClick(v)) dst[key] = v === null ? null : [v[0], v[1]];
      return;
    }
    if (typeof v === typeof dst[key]) dst[key] = v;
  };

  for (const [k, v] of Object.entries(src)) {
    if ((sections as string[]).includes(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [kk, vv] of Object.entries(v as Rec)) assign(k as keyof Settings, kk, vv);
    } else {
      // flat key: find the section that owns it
      const owner = sections.find((s) => k in (out[s] as unknown as Rec));
      if (owner) assign(owner, k, v);
    }
  }
  return out;
}
