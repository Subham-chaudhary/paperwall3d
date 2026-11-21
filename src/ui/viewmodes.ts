/** Shared option lists for view modes and camera modes (headers, pie menu, properties, operators). */
import type { CameraMode, ViewMode } from '../core/types';
import type { EnumOption } from './widgets/controls';

export const VIEW_MODES: readonly EnumOption<ViewMode>[] = [
  { value: 'render', label: 'Rendered', icon: 'aperture' },
  { value: 'depth', label: 'Depth', icon: 'shadedSphere' },
  { value: 'mask', label: 'Mask', icon: 'mask' },
  { value: 'wireframe', label: 'Wireframe', icon: 'wireframe' },
  { value: 'layers', label: 'Layers', icon: 'layers' },
];

export const CAMERA_MODES: readonly EnumOption<CameraMode>[] = [
  { value: 'cursor', label: 'Cursor Follow', icon: 'cursor' },
  { value: 'orbit', label: 'Orbit (Drag)', icon: 'orbit' },
  { value: 'auto', label: 'Auto Animate', icon: 'refresh' },
  { value: 'static', label: 'Static', icon: 'lock' },
];
