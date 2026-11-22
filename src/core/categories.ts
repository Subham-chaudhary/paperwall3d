/**
 * Presentation layout of the settings: categories ordered by what a user adjusts first, each with a
 * basic group (always visible) and optional advanced groups (collapsed sub-panels).
 *
 * This is UI-only. The stored settings keep their 2.5dwallpp-compatible sections and keys
 * (parallax / layers / mask / depth / camera3d), so config.json stays interchangeable.
 */
import type { Settings, SettingsPath, StageView } from './types';

export type CategoryId = 'motion' | 'depthLayers' | 'subject' | 'depthMap' | 'camera3d' | 'wallpaper' | 'processing';
export type ActionId =
  | 'pick-object'
  | 'clear-pick'
  | 'reset-camera'
  | 'export-glb'
  | 'preview-wallpaper'
  | 'export-html'
  | 'reanalyze';

export interface SettingsGroup {
  id: string;
  title: string;
  tier: 'basic' | 'advanced';
  fields: SettingsPath[];
  /** Buttons rendered after the fields of this group. */
  actions?: ActionId[];
}

export interface SettingsCategory {
  id: CategoryId;
  title: string;
  /** Icon name from src/ui/icons.ts. */
  icon: string;
  /** One-line hint shown as the panel header tooltip. */
  hint: string;
  groups: SettingsGroup[];
  /** Panel header "inspect" toggle: shows this pipeline stage in the 2D view. */
  inspect?: StageView;
  /** Show a presets menu in the panel header (src/core/presets.ts). */
  presets?: boolean;
  /** Collapsed when the app starts. */
  collapsed?: boolean;
}

export const CATEGORIES: SettingsCategory[] = [
  {
    id: 'motion',
    title: 'Motion',
    icon: 'cursor',
    hint: 'How the wallpaper moves with the cursor. Start here.',
    presets: true,
    groups: [
      {
        id: 'motion-basic',
        title: 'Motion',
        tier: 'basic',
        fields: ['parallax.strength', 'parallax.tilt', 'parallax.focus', 'parallax.smoothing', 'parallax.lighting', 'parallax.inverse', 'parallax.autoMotion'],
      },
    ],
  },
  {
    id: 'depthLayers',
    title: 'Depth & Layers',
    icon: 'layers',
    hint: 'How much depth the picture gets and how the object sits on the background.',
    groups: [
      {
        id: 'layers-basic',
        title: 'Depth & Layers',
        tier: 'basic',
        fields: ['layers.scope', 'layers.objectRelief', 'layers.objectSize', 'layers.backgroundDepth'],
      },
    ],
  },
  {
    id: 'subject',
    title: '1 · Subject Mask',
    icon: 'mask',
    hint: 'Which part of the picture is the object. Fix it if the object is cut or has a halo.',
    inspect: 'mask',
    groups: [
      {
        id: 'mask-basic',
        title: 'Subject Mask',
        tier: 'basic',
        fields: ['mask.use_subject', 'mask.thresh', 'mask.grow', 'mask.feather'],
        actions: ['pick-object', 'clear-pick'],
      },
      {
        id: 'mask-detection',
        title: 'Detection',
        tier: 'advanced',
        fields: ['mask.mask_model', 'mask.refine', 'mask.flip_avg', 'mask.mask_norm', 'mask.depth_assist'],
      },
      {
        id: 'mask-cleanup',
        title: 'Cleanup',
        tier: 'advanced',
        fields: ['mask.rim', 'mask.fill_holes', 'mask.min_area', 'mask.largest_only', 'mask.mask_invert'],
      },
    ],
  },
  {
    id: 'depthMap',
    title: '2 · Depth Map',
    icon: 'depth',
    hint: 'The estimated depth. Near parts should be bright when inspected.',
    inspect: 'objdepth',
    groups: [
      {
        id: 'depth-basic',
        title: 'Depth Map',
        tier: 'basic',
        fields: ['depth.depth_invert', 'depth.gamma', 'depth.smooth'],
      },
      {
        id: 'depth-range',
        title: 'Range',
        tier: 'advanced',
        fields: ['depth.clip_lo', 'depth.clip_hi', 'depth.edge_snap'],
      },
      {
        id: 'depth-model',
        title: 'Model',
        tier: 'advanced',
        fields: ['depth.model', 'depth.depth_size'],
      },
    ],
  },
  {
    id: 'camera3d',
    title: '3D Camera',
    icon: 'cube',
    hint: 'The 3D inspection view and the GLB export. Does not change the 2D wallpaper.',
    collapsed: true,
    groups: [
      {
        id: 'cam-basic',
        title: '3D Camera',
        tier: 'basic',
        fields: ['camera3d.zscale', 'camera3d.showbg', 'camera3d.rotate'],
        actions: ['reset-camera', 'export-glb'],
      },
      {
        id: 'cam-mesh',
        title: 'Mesh',
        tier: 'advanced',
        fields: ['camera3d.segs', 'camera3d.tear', 'camera3d.wire', 'camera3d.depthcol'],
      },
    ],
  },
  {
    id: 'wallpaper',
    title: 'Wallpaper & Export',
    icon: 'fullscreen',
    hint: 'Preview the wallpaper and export it.',
    collapsed: true,
    groups: [
      {
        id: 'wallpaper-basic',
        title: 'Wallpaper',
        tier: 'basic',
        fields: ['wallpaper.aspect', 'wallpaper.overlay'],
        actions: ['preview-wallpaper', 'export-html'],
      },
    ],
  },
  {
    id: 'processing',
    title: 'Processing',
    icon: 'gear',
    hint: 'Image resolution, AI backend and viewport options.',
    collapsed: true,
    groups: [
      {
        id: 'processing-basic',
        title: 'Processing',
        tier: 'basic',
        fields: ['runtime.workingResolution', 'runtime.backend'],
        actions: ['reanalyze'],
      },
      {
        id: 'processing-viewport',
        title: 'Viewport',
        tier: 'advanced',
        fields: ['view.background', 'view.showStats'],
      },
    ],
  },
];

/** Every SettingsPath that appears in some category (used to assert full coverage). */
export const CATEGORIZED_PATHS: SettingsPath[] = CATEGORIES.flatMap((c) => c.groups.flatMap((g) => g.fields));

/** Settings that are set elsewhere in the UI (view switch / stage dropdown / picking), not via a field. */
export const UNCATEGORIZED_PATHS: SettingsPath[] = ['view.mode', 'view.stage', 'mask.click'];

export interface FieldState {
  enabled: boolean;
  /** Why the field currently has no effect (tooltip on the greyed-out field). */
  reason?: string;
}

/**
 * Whether a field currently has an effect. Disabled fields stay editable-looking but greyed (Blender's
 * "inactive" state), so users see why a slider does nothing instead of the value silently being ignored.
 */
export function fieldState(path: SettingsPath, s: Settings): FieldState {
  const subjectOff = !s.mask.use_subject;
  if (path.startsWith('mask.') && path !== 'mask.use_subject' && subjectOff) {
    return { enabled: false, reason: 'Separate object is off' };
  }
  if ((path === 'layers.objectRelief' || path === 'layers.objectSize') && subjectOff) {
    return { enabled: false, reason: 'Separate object is off' };
  }
  if ((path === 'layers.backgroundDepth' || path === 'layers.objectRelief') && s.layers.scope === 'all') {
    return { enabled: false, reason: 'Only used when depth applies to the subject only' };
  }
  if (path === 'depth.depth_size' && s.depth.model === 'heuristic') {
    return { enabled: false, reason: 'The heuristic depth does not use a model input size' };
  }
  return { enabled: true };
}

/** Defaults for one category (per-panel "Reset to defaults"). */
export function categoryPaths(id: CategoryId): SettingsPath[] {
  const c = CATEGORIES.find((x) => x.id === id);
  return c ? c.groups.flatMap((g) => g.fields) : [];
}
