/**
 * The "Scene" properties tab: one scrolling column that mirrors 2.5dwallpp's settings panel
 * (view switch, show stage, Parallax, Layers, 1 · Object mask, 2 · Object depth, 3D camera, footer buttons),
 * built from SCHEMA by the generic field builder.
 */
import { fieldSchema } from '../../core/schema';
import type { StageView, ViewMode } from '../../core/types';
import type { AppContext } from '../context';
import { h } from '../dom';
import { settingsBinding } from '../widgets/binding';
import { button, enumField, segmented } from '../widgets/controls';
import { PRESETS } from '../../core/presets';
import type { MenuItem } from '../widgets/menu';
import { propRow, spacedRow } from '../widgets/layout';
import { STAGES, VIEW_MODES } from '../viewmodes';
import type { Fields } from './fields';
import { panel, setPanelOpen } from './panel';
import type { ScenePanel } from '../state';

export const page = (...panels: HTMLElement[]): HTMLElement => h('div', { class: 'pw-tab-page' }, ...panels);

export function sceneTab(ctx: AppContext, f: Fields): HTMLElement {
  const store = ctx.store;

  // 1. View switch (the viewport header keeps its own copy)
  const viewSeg = segmented<ViewMode>({
    bind: settingsBinding<ViewMode>(store, 'view.mode'),
    options: VIEW_MODES,
    noUndo: true,
    tip: f.tip('view.mode'),
  });
  const viewRow = h('div', { class: 'pw-scene-viewrow' }, viewSeg.el);

  // 2. Show stage
  const stageRow = propRow(
    fieldSchema('view.stage').label,
    enumField<StageView>({ bind: settingsBinding<StageView>(store, 'view.stage'), options: STAGES, tip: f.tip('view.stage') }).el,
  );

  // Header: scene name + full screen (wallpaper preview)
  const name = h('span', { class: 'pw-scene-title-name' });
  const syncName = (): void => {
    name.textContent = ctx.sceneName;
  };
  ctx.events.on('name', syncName);
  syncName();
  const fullscreen = button({
    label: '⛶ Full screen',
    onClick: () => ctx.ops.run('view.preview_wallpaper'),
    tip: { desc: 'Full screen (F) · Esc to exit', extra: 'Opens the Wallpaper Preview' },
  });
  const title = h('div', { class: 'pw-scene-title' }, name, fullscreen.el);

  const panels: Record<ScenePanel, HTMLElement> = {
    parallax: panel(
      {
        id: 'sc.parallax',
        title: 'Parallax',
        menuTip: 'Presets by image type (a starting point)',
        menu: () => [
          { heading: 'Presets' },
          ...PRESETS.map<MenuItem>((p) => ({ label: p.label, icon: 'sparkle', run: () => ctx.applyPreset(p.id) })),
        ],
      },
      ...f.rows('parallax.strength', 'parallax.focus', 'parallax.tilt', 'parallax.lighting', 'parallax.smoothing', 'parallax.autoMotion', 'parallax.inverse'),
    ),
    layers: panel({ id: 'sc.layers', title: 'Layers (2D + 3D)' }, ...f.rows('layers.scope', 'layers.backgroundDepth', 'layers.objectSize', 'layers.objectRelief')),
    mask: (() => {
      const clear = button({ label: 'Clear pick', icon: 'close', onClick: () => ctx.clearPick(), tip: { desc: 'Go back to the automatically chosen main object.' } });
      const pick = button({ label: 'Pick object…', icon: 'eyedropper', onClick: () => ctx.ops.run('view.pick_object'), tip: { title: 'Pick Object', desc: 'Click the object you want as the main object in the image.', extra: 'P' } });
      const btns = propRow(null, spacedRow(pick.el, clear.el));
      const sync = (): void => {
        clear.el.hidden = !store.getValue('mask.click');
        pick.setLabel(ctx.ui.picking ? 'Picking…' : 'Pick object…');
        pick.el.classList.toggle('active', ctx.ui.picking);
      };
      store.subscribe((_s, c) => c.includes('mask.click') && sync());
      ctx.ui.on('picking', sync);
      sync();
      return panel(
        { id: 'sc.mask', title: '1 · Object mask' },
        ...f.rows(
          'mask.use_subject', 'mask.mask_model', 'mask.flip_avg', 'mask.refine', 'mask.mask_norm', 'mask.thresh', 'mask.depth_assist',
          'mask.min_area', 'mask.largest_only', 'mask.fill_holes', 'mask.mask_invert', 'mask.grow', 'mask.feather', 'mask.rim',
        ),
        btns,
      );
    })(),
    depth: panel(
      { id: 'sc.depth', title: '2 · Object depth' },
      ...f.rows('depth.depth_size', 'depth.clip_lo', 'depth.clip_hi', 'depth.smooth', 'depth.edge_snap', 'depth.gamma', 'depth.depth_invert'),
    ),
    camera3d: panel(
      { id: 'sc.camera3d', title: '3D camera', defaultOpen: false },
      ...f.rows('camera3d.segs', 'camera3d.zscale', 'camera3d.tear', 'camera3d.wire', 'camera3d.depthcol', 'camera3d.showbg', 'camera3d.rotate'),
      propRow(null, button({ label: 'Reset camera', icon: 'refresh', onClick: () => ctx.ops.run('view.reset'), tip: { desc: 'Reset the 3D orbit camera.', extra: 'Home' } }).el),
    ),
  };

  // The 3D camera panel opens by itself when the view becomes 3D.
  store.subscribe((_s, c) => {
    if (c.includes('view.mode') && store.getValue('view.mode') === '3d') setPanelOpen(panels.camera3d, true);
  });
  // Workspaces reveal the relevant panel.
  ctx.ui.on('reveal', (id) => {
    const el = panels[id];
    setPanelOpen(el, true);
    requestAnimationFrame(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  });

  const footer = propRow(
    null,
    spacedRow(
      button({ label: 'Download .glb', icon: 'download', onClick: () => ctx.ops.run('file.export_glb'), tip: { desc: 'Download the 3D model (uses the 3D camera settings). Opens the wallpaper preview first.', extra: 'Ctrl E' } }).el,
      button({ label: 'New image', icon: 'folder', onClick: () => ctx.ops.run('file.open_image'), tip: { desc: 'Open another image.', extra: 'Ctrl O' } }).el,
    ),
  );

  return page(
    h('div', { class: 'pw-scene-head' }, title, viewRow, stageRow),
    panels.parallax,
    panels.layers,
    panels.mask,
    panels.depth,
    panels.camera3d,
    h('div', { class: 'pw-scene-foot' }, footer),
  );
}
