/**
 * Settings schema: label, description, range/step/options for every setting.
 * Single source of truth for the properties panels, the config.json editor (its `//` comments),
 * tooltips, and clamping of imported configs. Ranges/defaults match 2.5dwallpp.
 */
import type { Settings, SettingsPath, SettingsSection } from './types';
import { DEFAULT_SETTINGS, cloneSettings } from './defaults';

export interface NumberField {
  kind: 'number';
  min: number;
  max: number;
  step: number;
  /** Display unit, e.g. "px", "°", "%". */
  unit?: string;
  /** Render as a filled factor slider (Blender style) rather than a plain number field. */
  slider?: boolean;
}
export interface BoolField {
  kind: 'bool';
}
export interface EnumField {
  kind: 'enum';
  options: { value: string | number; label: string }[];
}
export interface ColorField {
  kind: 'color';
}
/** [x, y] | null — set by clicking the image (mask.click). */
export interface PointField {
  kind: 'point';
}
export type FieldType = NumberField | BoolField | EnumField | ColorField | PointField;

export type FieldSchema = FieldType & {
  label: string;
  desc: string;
  /** Changing it re-runs a model (shown with a small "model" badge in the UI). */
  model?: boolean;
  /** PaperWall3D-only key inside a shared section: left out of the 2.5dwallpp-compatible config.json. */
  local?: boolean;
};

export interface SectionSchema {
  label: string;
  /** Part of the 2.5dwallpp-compatible config.json document. */
  shared: boolean;
  fields: Record<string, FieldSchema>;
}

const num = (label: string, desc: string, min: number, max: number, step: number, extra: Partial<NumberField> & { model?: boolean } = {}): FieldSchema => ({
  kind: 'number', label, desc, min, max, step, ...extra,
});
const bool = (label: string, desc: string, model = false): FieldSchema => ({ kind: 'bool', label, desc, model });
const enm = (label: string, desc: string, options: EnumField['options'], model = false): FieldSchema => ({ kind: 'enum', label, desc, options, model });

export const SCHEMA: { [S in SettingsSection]: SectionSchema } = {
  parallax: {
    label: 'Parallax',
    shared: true,
    fields: {
      strength: num('Strength', 'Camera shift of the parallax, as a fraction of the image', 0, 0.12, 0.002, { slider: true }),
      focus: num('Focus plane', 'Depth that stays fixed in place (0 = far, 1 = near)', 0, 1, 0.01, { slider: true }),
      tilt: num('Tilt (°)', 'Tilt of the whole picture toward the cursor, in degrees', 0, 20, 0.5),
      lighting: num('Lighting', 'Depth-based shading that follows the cursor', 0, 1, 0.01, { slider: true }),
      smoothing: num('Smoothing', 'How quickly the view follows the cursor (higher = snappier)', 0.02, 0.4, 0.01, { slider: true }),
      autoMotion: bool('Auto motion', 'Move on its own, no mouse needed'),
      inverse: bool('Inverse parallax', 'Inverse parallax direction'),
    },
  },
  layers: {
    label: 'Layers (2D + 3D)',
    shared: true,
    fields: {
      scope: enm('3D scope', 'Where depth is applied', [
        { value: 'subject', label: 'Subject only (background flat)' },
        { value: 'all', label: 'Whole image' },
      ]),
      backgroundDepth: num('Background plane depth', 'Depth of the flat background plane (scope "subject")', 0, 1, 0.01, { slider: true }),
      objectSize: num('Object size', "Scale of the object, around its own centre", 0.3, 2, 0.01),
      objectRelief: num('Object relief', "How far the object's shape sticks out (scope \"subject\")", 0, 1.5, 0.01, { slider: true }),
    },
  },
  mask: {
    label: '1 · Object mask',
    shared: true,
    fields: {
      use_subject: bool('Separate object', 'Separate the object from the background at all', true),
      mask_model: enm('Model', 'Masking model', [
        { value: 'u2net', label: 'U²-Net (176 MB, accurate)' },
        { value: 'u2netp', label: 'U²-NetP (4.6 MB, fast, partial)' },
      ], true),
      flip_avg: bool('Flip-average (steadier)', 'Average with a mirrored pass (steadier mask, 2x slower)', true),
      refine: bool('Zoom-in second pass', 'Second pass zoomed in on the object found by the first', true),
      mask_norm: bool('Normalise confidence', "Normalise the model's confidence (threshold becomes relative)"),
      thresh: num('Confidence threshold', 'Confidence threshold: lower includes more', 0.05, 0.95, 0.01, { slider: true }),
      depth_assist: bool('Depth assist (grow over near regions; can flood)', 'Grow the mask over near-depth regions (can flood into the ground)'),
      min_area: num('Min blob size (% of image)', 'Drop blobs smaller than this, in % of the image', 0, 10, 0.1),
      largest_only: bool('Largest object only', 'Keep only the biggest object'),
      fill_holes: bool('Fill holes', 'Fill holes inside the object'),
      mask_invert: bool('Invert mask (object ↔ background)', 'Swap object and background'),
      grow: num('Grow / shrink (px)', "Grow (+) or shrink (-) the cut-out, in px", -40, 40, 1),
      feather: num('Edge feather (px)', "Blur the cut-out's edge, in px", 0, 20, 1),
      rim: num('Edge cleanup (px)', "Ignore this many px of the blurry rim when taking object depth and colour", 0, 20, 1),
      click: { kind: 'point', label: 'Picked object', desc: 'Object picked by clicking: [x, y] in 0..1 image coordinates, or null for automatic' },
    },
  },
  depth: {
    label: '2 · Object depth',
    shared: true,
    fields: {
      model: {
        ...enm('Model', 'Depth model (heuristic = offline fallback, no download)', [
          { value: 'depth-anything-v2-small', label: 'Depth Anything V2 Small' },
          { value: 'heuristic', label: 'Heuristic (offline)' },
        ], true),
        local: true,
      },
      depth_size: num('Model input size (px)', 'Short side fed to the depth model, in px (bigger = finer but slower)', 252, 1008, 14, { model: true }),
      clip_lo: num('Clip low (percentile)', 'Percentile clipped at the near end', 0, 40, 0.5),
      clip_hi: num('Clip high (percentile)', 'Percentile clipped at the far end', 60, 100, 0.5),
      smooth: num('Smoothing σ', 'Gaussian smoothing of the depth map, sigma in px', 0, 6, 0.1),
      edge_snap: num('Edge snap to image (px)', "Snap depth edges to the photo's edges, radius in px (0 = off)", 0, 30, 1),
      gamma: num('Gamma', 'Below 1 pushes mid depths forward, above 1 pushes them back', 0.3, 3, 0.05),
      depth_invert: bool('Invert depth (near ↔ far)', 'Flip near and far'),
    },
  },
  camera3d: {
    label: '3D camera',
    shared: true,
    fields: {
      segs: num('Mesh resolution', 'Mesh resolution along the long side', 64, 512, 32),
      zscale: num('Depth scale', 'How far depth sticks out in the 3D view (image height = 1)', 0, 2, 0.02),
      tear: num('Edge-tear cutoff', 'Drop mesh triangles stretched across a depth cliff beyond this step', 0.02, 0.6, 0.01, { slider: true }),
      wire: bool('Wireframe', 'Wireframe'),
      depthcol: bool('Depth colours', 'Colour by depth'),
      showbg: bool('Show background', 'Show the background plane'),
      rotate: bool('Auto-rotate', 'Auto-rotate the camera'),
    },
  },
  view: {
    label: 'Viewport',
    shared: false,
    fields: {
      mode: enm('View', 'Viewport editor', [
        { value: '2d', label: '2D Parallax' },
        { value: '3d', label: '3D Camera' },
        { value: 'config', label: 'config.json' },
      ]),
      stage: enm('Show stage', 'Overlay a pipeline stage on the 2D view (tuning aid)', [
        { value: 'result', label: 'Result' },
        { value: 'mask', label: '1 · Main object mask' },
        { value: 'objdepth', label: '2 · Object depth (masked)' },
        { value: 'depth', label: 'Whole-image depth' },
      ]),
      background: { kind: 'color', label: 'Background', desc: 'Viewport background colour' },
      showStats: bool('Statistics', 'Show FPS / triangles / GPU overlay'),
    },
  },
  wallpaper: {
    label: 'Wallpaper Preview',
    shared: false,
    fields: {
      aspect: enm('Frame', 'Preview frame aspect ratio', [
        { value: 'screen', label: 'This screen' },
        { value: '16:9', label: '16:9 Desktop' },
        { value: '16:10', label: '16:10 Laptop' },
        { value: '21:9', label: '21:9 Ultrawide' },
        { value: '32:9', label: '32:9 Super ultrawide' },
        { value: '9:19.5', label: '9:19.5 Phone' },
        { value: '1:1', label: '1:1 Square' },
      ]),
      overlay: bool('Desktop Overlay', 'Show a clock/date overlay to judge the wallpaper in context'),
    },
  },
  runtime: {
    label: 'Runtime',
    shared: false,
    fields: {
      backend: enm('AI Backend', 'Inference backend', [
        { value: 'auto', label: 'Auto (WebGPU if available)' },
        { value: 'webgpu', label: 'WebGPU' },
        { value: 'wasm', label: 'WASM (CPU)' },
      ], true),
      workingResolution: enm('Working Resolution', 'Long edge of the processed image', [
        { value: 768, label: '768 px' },
        { value: 1024, label: '1024 px' },
        { value: 1600, label: '1600 px' },
        { value: 2048, label: '2048 px' },
      ], true),
    },
  },
};

/** Keys of a section that belong in the 2.5dwallpp-compatible config.json (excludes `local` fields). */
export function sharedKeys(section: SettingsSection): string[] {
  return Object.entries(SCHEMA[section].fields).filter(([, f]) => !f.local).map(([k]) => k);
}

export function fieldSchema(path: SettingsPath): FieldSchema {
  const [s, k] = path.split('.') as [SettingsSection, string];
  const f = SCHEMA[s].fields[k];
  if (!f) throw new Error(`No schema for ${path}`);
  return f;
}

/** Clamp numbers to range and snap to step, validate enums/points. Returns the fixed settings and a list of problems. */
export function sanitizeSettings(input: Settings): { settings: Settings; problems: string[] } {
  const out = cloneSettings(input);
  const problems: string[] = [];
  for (const s of Object.keys(SCHEMA) as SettingsSection[]) {
    const sec = out[s] as unknown as Record<string, unknown>;
    const def = DEFAULT_SETTINGS[s] as unknown as Record<string, unknown>;
    for (const [k, f] of Object.entries(SCHEMA[s].fields)) {
      const v = sec[k];
      const path = `${s}.${k}`;
      if (f.kind === 'number') {
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          problems.push(`${path}: not a number, reset to default`);
          sec[k] = def[k];
          continue;
        }
        const snapped = Math.round((Math.min(f.max, Math.max(f.min, v)) - f.min) / f.step) * f.step + f.min;
        const fixed = Number(snapped.toFixed(6));
        if (fixed !== v) problems.push(`${path}: ${v} → ${fixed}`);
        sec[k] = fixed;
      } else if (f.kind === 'enum') {
        if (!f.options.some((o) => o.value === v)) {
          problems.push(`${path}: "${String(v)}" is not one of ${f.options.map((o) => o.value).join(', ')}`);
          sec[k] = def[k];
        }
      } else if (f.kind === 'point') {
        if (v !== null && !(Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && n >= 0 && n <= 1))) {
          problems.push(`${path}: expected [x, y] in 0..1 or null`);
          sec[k] = null;
        }
      }
    }
  }
  return { settings: out, problems };
}
