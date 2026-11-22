/** Shared option lists for views and pipeline stages (viewport header, pie menu, operators). */
import type { StageView, ViewMode } from '../core/types';
import type { EnumOption } from './widgets/controls';

export const VIEW_MODES: readonly EnumOption<ViewMode>[] = [
  { value: '2d', label: '2D Parallax', icon: 'imageEditor' },
  { value: '3d', label: '3D Camera', icon: 'view3d' },
  { value: 'config', label: 'config.json', icon: 'file' },
];

export const STAGES: readonly EnumOption<StageView>[] = [
  { value: 'result', label: 'Result', icon: 'aperture' },
  { value: 'mask', label: '1 · Main object mask', icon: 'mask' },
  { value: 'objdepth', label: '2 · Object depth (masked)', icon: 'depth' },
  { value: 'depth', label: 'Whole-image depth', icon: 'shadedSphere' },
];

export const STAGE_SHORT: Record<StageView, string> = {
  result: 'Result',
  mask: 'Mask',
  objdepth: 'Object Depth',
  depth: 'Whole Depth',
};
