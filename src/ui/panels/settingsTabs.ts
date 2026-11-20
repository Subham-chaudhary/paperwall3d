/** Properties tabs that map 1:1 onto Settings sections. */
import type { DepthModelId, SegmentationModelId } from '../../core/types';
import { h } from '../dom';
import { bindInactive, propRow, row } from '../widgets/layout';
import type { Fields } from './fields';
import { panel } from './panel';
import { CAMERA_MODES, VIEW_MODES } from '../viewmodes';

const page = (...panels: HTMLElement[]): HTMLElement => h('div', { class: 'pw-tab-page' }, ...panels);

export function segmentationTab(f: Fields): HTMLElement {
  const refine = h('div', { class: 'pw-col' });
  refine.append(
    f.num('segmentation.threshold', 'Threshold', {
      min: 0, max: 1, slider: true, desc: 'Alpha threshold applied to the raw model output before feathering.',
    }),
    f.num('segmentation.feather', 'Feather', {
      min: 0, max: 32, step: 0.5, precision: 1, unit: ' px', desc: 'Edge feather radius in pixels (working resolution).',
    }),
    f.num('segmentation.dilate', 'Grow / Shrink', {
      min: -32, max: 32, integer: true, unit: ' px', desc: 'Morphological grow (positive) or shrink (negative) of the mask in pixels.',
    }),
    f.num('segmentation.minIslandArea', 'Min Island', {
      min: 0, max: 0.05, step: 0.001, scale: 100, precision: 2, unit: ' %',
      desc: 'Remove isolated mask islands smaller than this percentage of the image area.',
    }),
    f.check('segmentation.invert', 'Invert Mask', 'Swap foreground and background.'),
  );
  bindInactive(refine, f.boolBinding('segmentation.enabled'));
  const model = h('div', { class: 'pw-col' });
  model.append(
    f.enum<SegmentationModelId>(
      'segmentation.model',
      'Model',
      [
        { value: 'u2netp', label: 'U²-Net-P (Fast, 4.6 MB)' },
        { value: 'u2net', label: 'U²-Net (Accurate, 176 MB)' },
      ],
      'Salient-object segmentation model. Changing it re-runs analysis.',
    ),
  );
  bindInactive(model, f.boolBinding('segmentation.enabled'));
  return page(
    panel(
      { id: 'seg.main', title: 'Segmentation', headerWidget: f.checkWidget('segmentation.enabled', '', 'Separate a foreground subject from the background. When off, a single layer is used.').el },
      model,
    ),
    panel({ id: 'seg.refine', title: 'Mask Refinement' }, refine),
  );
}

export function depthTab(f: Fields): HTMLElement {
  const modelRow = f.enum<DepthModelId>(
    'depth.model',
    'Model',
    [
      { value: 'depth-anything-v2-small', label: 'Depth Anything V2 Small' },
      { value: 'heuristic', label: 'Heuristic (no AI)' },
    ],
    'Monocular depth estimation model. Changing it re-runs analysis.',
  );
  const near = f.numWidget('depth.near', { min: 0, max: 1, slider: true, desc: 'Normalized depth below this value is clipped to 0.' }, 'Near');
  const far = f.numWidget('depth.far', { min: 0, max: 1, slider: true, desc: 'Normalized depth above this value is clipped to 1.' }, 'Far');
  return page(
    panel(
      { id: 'depth.main', title: 'Depth Estimation' },
      modelRow,
      f.check('depth.invert', 'Invert Depth', 'Flip near and far.'),
    ),
    panel(
      { id: 'depth.remap', title: 'Depth Remap' },
      f.num('depth.contrast', 'Contrast', { min: 0.2, max: 3, step: 0.05, slider: true, precision: 2, desc: 'Contrast multiplier around the mid-depth.' }),
      f.num('depth.gamma', 'Gamma', { min: 0.2, max: 3, step: 0.05, slider: true, precision: 2, desc: 'Gamma applied to normalized depth.' }),
      f.num('depth.smoothing', 'Smoothing', { min: 0, max: 16, step: 0.5, precision: 1, unit: ' px', desc: 'Edge-preserving smoothing radius in pixels.' }),
      propRow('Clip', row(near.el, far.el)),
    ),
  );
}

export function reconstructionTab(f: Fields): HTMLElement {
  const body = h('div', { class: 'pw-col' });
  body.append(
    f.num('reconstruction.inpaintPadding', 'Padding', {
      min: 0, max: 64, integer: true, unit: ' px', desc: 'How far the mask is grown before inpainting, to hide halos.',
    }),
    f.num('reconstruction.inpaintSoftness', 'Softness', {
      min: 0, max: 1, slider: true, desc: 'Extra blur applied to the inpainted region only.',
    }),
  );
  bindInactive(body, f.boolBinding('reconstruction.inpaint'));
  return page(
    panel(
      { id: 'recon.inpaint', title: 'Background Inpainting', headerWidget: f.checkWidget('reconstruction.inpaint', '', 'Fill the hole left by the foreground in the background layer.').el },
      body,
    ),
    panel(
      { id: 'recon.edges', title: 'Foreground Edges' },
      f.num('reconstruction.edgeBleed', 'Edge Bleed', {
        min: 0, max: 32, integer: true, unit: ' px', desc: 'Extend foreground edge colors outward to avoid dark fringes.',
      }),
    ),
  );
}

export function geometryTab(f: Fields): HTMLElement {
  return page(
    panel(
      { id: 'geo.mesh', title: 'Mesh' },
      f.num('geometry.meshResolution', 'Resolution', {
        min: 32, max: 512, step: 16, integer: true, desc: 'Grid segments along the long edge of the displacement meshes.',
      }),
      f.num('geometry.overscan', 'Overscan', {
        min: 1, max: 1.5, step: 0.01, precision: 2, slider: true, desc: 'Overscan of the background plane so edges stay hidden while moving.',
      }),
      f.num('geometry.discontinuityCutoff', 'Edge Cutoff', {
        min: 0, max: 1, slider: true, desc: 'Depth-gradient threshold at which triangles are discarded to avoid stretched edges (1 = off).',
      }),
    ),
    panel(
      { id: 'geo.displace', title: 'Displacement' },
      f.num('geometry.backgroundRelief', 'Background', { min: 0, max: 2, step: 0.01, slider: true, desc: 'Displacement strength of the background mesh, in scene units.' }),
      f.num('geometry.foregroundRelief', 'Foreground', { min: 0, max: 2, step: 0.01, slider: true, desc: 'Displacement strength of the foreground mesh, in scene units.' }),
    ),
    panel(
      { id: 'geo.fg', title: 'Foreground Object' },
      f.num('geometry.objectElevation', 'Elevation', { min: 0, max: 2, step: 0.01, slider: true, desc: 'Z offset of the foreground layer from the background.' }),
      f.num('geometry.foregroundScale', 'Scale', { min: 0.8, max: 1.3, step: 0.01, slider: true, desc: 'Uniform scale of the foreground layer.' }),
    ),
  );
}

export function lightingTab(f: Fields): HTMLElement {
  const globalCol = h('div', { class: 'pw-col' });
  globalCol.append(
    f.num('lighting.exposure', 'Exposure', { min: 0.1, max: 3, step: 0.05, slider: true, desc: 'Overall exposure multiplier.' }),
    f.num('lighting.ambient', 'Ambient', { min: 0, max: 2, step: 0.01, slider: true, desc: 'Ambient light intensity.' }),
    f.num('lighting.depthShading', 'Depth Shading', { min: 0, max: 1, slider: true, desc: 'Ambient-occlusion-style darkening derived from depth.' }),
  );
  const key = h('div', { class: 'pw-col' });
  key.append(
    f.num('lighting.keyIntensity', 'Strength', { min: 0, max: 2, step: 0.01, slider: true, desc: 'Key light intensity.' }),
    f.color('lighting.keyColor', 'Color', 'Key light color.'),
    f.num('lighting.keyAzimuth', 'Azimuth', { min: -180, max: 180, step: 1, precision: 0, unit: '°', desc: 'Key light horizontal angle in degrees.' }),
    f.num('lighting.keyElevation', 'Elevation', { min: -90, max: 90, step: 1, precision: 0, unit: '°', desc: 'Key light vertical angle in degrees.' }),
    f.check('lighting.followCursor', 'Follow Cursor', 'The light direction follows the pointer.'),
  );
  const rim = h('div', { class: 'pw-col' });
  rim.append(
    f.num('lighting.rimIntensity', 'Strength', { min: 0, max: 2, step: 0.01, slider: true, desc: 'Rim light intensity.' }),
    f.color('lighting.rimColor', 'Color', 'Rim light color.'),
  );
  for (const el of [globalCol, key, rim]) bindInactive(el, f.boolBinding('lighting.enabled'));
  return page(
    panel(
      { id: 'light.global', title: 'Lighting', headerWidget: f.checkWidget('lighting.enabled', '', 'Enable lighting. When off, the image is shown unlit.').el },
      globalCol,
    ),
    panel({ id: 'light.key', title: 'Key Light' }, key),
    panel({ id: 'light.rim', title: 'Rim Light' }, rim),
  );
}

export function cameraTab(f: Fields): HTMLElement {
  return page(
    panel(
      { id: 'cam.mode', title: 'Camera Mode' },
      f.enum('camera.mode', 'Mode', CAMERA_MODES, 'How the camera reacts: follow the cursor, orbit by dragging, animate automatically or stay static.'),
      f.num('camera.autoSpeed', 'Auto Speed', { min: 0, max: 2, step: 0.01, slider: true, desc: 'Speed of the automatic animation.' }),
    ),
    panel(
      { id: 'cam.parallax', title: 'Parallax' },
      f.num('camera.parallax', 'Amount', { min: 0, max: 2, step: 0.01, slider: true, desc: 'Horizontal/vertical translation parallax amount.' }),
      f.num('camera.tilt', 'Tilt', { min: 0, max: 20, step: 0.5, precision: 1, unit: '°', desc: 'Maximum rotation tilt in degrees.' }),
      f.num('camera.damping', 'Damping', { min: 0, max: 0.99, step: 0.01, slider: true, desc: 'Cursor-follow smoothing. Higher = smoother and slower.' }),
      f.check('camera.invertX', 'Invert X', 'Mirror horizontal movement.'),
      f.check('camera.invertY', 'Invert Y', 'Mirror vertical movement.'),
    ),
    panel(
      { id: 'cam.lens', title: 'Lens' },
      f.num('camera.fov', 'Field of View', { min: 15, max: 75, step: 1, precision: 0, unit: '°', desc: 'Vertical field of view in degrees.' }),
      f.num('camera.zoom', 'Zoom', { min: 0.5, max: 2, step: 0.01, slider: true, desc: 'Dolly / zoom.' }),
    ),
  );
}

export function viewTab(f: Fields): HTMLElement {
  return page(
    panel(
      { id: 'view.shading', title: 'Shading' },
      f.seg('view.mode', null, VIEW_MODES, 'Viewport display mode.'),
      f.color('view.background', 'Background', 'Viewport background color.'),
    ),
    panel(
      { id: 'view.overlays', title: 'Overlays' },
      f.check('view.showGrid', 'Grid', 'Show a reference grid.'),
      f.check('view.showStats', 'Statistics', 'Show FPS, triangle and draw-call statistics in the viewport.'),
    ),
  );
}
