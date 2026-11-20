/**
 * View-mode plumbing: maps `view.mode` onto shader mode, wireframe overlay and exploded layout.
 *
 * render    - shaded
 * depth     - turbo colormap of the depth map (near = warm)
 * mask      - foreground white over dark
 * wireframe - shaded + Blender-like wire overlay (orange foreground / grey background)
 * layers    - exploded layers with the camera orbited (see CameraRig.layersBlend)
 */
import type { ViewMode } from '../core/types';
import type { SharedUniforms } from './materials';
import { viewModeUniform } from './materials';
import type { SceneLayers } from './layers';

export function applyViewMode(mode: ViewMode, uniforms: SharedUniforms, layers: SceneLayers | null): void {
  uniforms.uMode.value = viewModeUniform(mode);
  layers?.setWireframe(mode === 'wireframe');
}

export function isExploded(mode: ViewMode): boolean {
  return mode === 'layers';
}
