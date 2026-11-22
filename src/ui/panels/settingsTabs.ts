/**
 * The "Scene" properties tab: the view switch and "Show stage" dropdown, then one collapsible Blender panel per
 * category of src/core/categories.ts, in the order a user adjusts things (Motion first, Processing last).
 *
 * A category panel is: basic fields, then its action buttons, then its advanced groups as collapsed sub-panels.
 * The header carries the extras: presets menu, inspect eye (shows the pipeline stage in the 2D view) and a reset button.
 */
import {
  CATEGORIES,
  type ActionId,
  type SettingsCategory,
  type SettingsGroup,
} from '../../core/categories';
import { fieldSchema } from '../../core/schema';
import { PRESETS } from '../../core/presets';
import type { SettingsPath, StageView, ViewMode } from '../../core/types';
import type { AppContext } from '../context';
import { h } from '../dom';
import { icon, type IconName } from '../icons';
import type { ScenePanel } from '../state';
import { STAGES, VIEW_MODES } from '../viewmodes';
import { settingsBinding } from '../widgets/binding';
import { button, enumField, iconToggle, segmented, type ButtonWidget } from '../widgets/controls';
import { openMenu, type MenuItem } from '../widgets/menu';
import { propRow } from '../widgets/layout';
import { tip, type TipSpec } from '../widgets/tooltip';
import type { Fields } from './fields';
import { panel, revealPanelChain, setPanelOpen } from './panel';

export const page = (...panels: HTMLElement[]): HTMLElement => h('div', { class: 'pw-tab-page' }, ...panels);

/** "1 · Subject Mask" -> "Subject Mask" (toasts and tooltips). */
const plainTitle = (c: SettingsCategory): string => c.title.replace(/^\d+\s*·\s*/, '');

/** Small square icon button for a panel header. */
function headerButton(ic: IconName, spec: TipSpec, onClick: (e: MouseEvent) => void): HTMLButtonElement {
  const b = h('button', { class: 'pw-icon-toggle pw-hdr-toggle', attrs: { type: 'button' } }, icon(ic, 14));
  tip(b, spec);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(e);
  });
  b.addEventListener('dblclick', (e) => e.stopPropagation());
  return b;
}

export function sceneTab(ctx: AppContext, f: Fields): HTMLElement {
  const store = ctx.store;

  // ── Top: view switch + Show stage (the viewport header keeps its own copies) ──
  const viewSeg = segmented<ViewMode>({
    bind: settingsBinding<ViewMode>(store, 'view.mode'),
    options: VIEW_MODES,
    noUndo: true,
    tip: f.tip('view.mode'),
  });
  const viewRow = h('div', { class: 'pw-scene-viewrow' }, viewSeg.el);
  const stageRow = propRow(
    fieldSchema('view.stage').label,
    enumField<StageView>({ bind: settingsBinding<StageView>(store, 'view.stage'), options: STAGES, tip: f.tip('view.stage') }).el,
  );

  // ── Action buttons ──
  const syncers: (() => void)[] = [];
  const sync = (): void => syncers.forEach((s) => s());
  store.subscribe(sync);
  ctx.ui.on('picking', sync);
  ctx.events.on('image', sync);
  ctx.events.on('scene', sync);

  /** A button that runs an operator and is disabled while the operator's poll says it cannot run. */
  const opButton = (op: string, label: string, ic: IconName | undefined, spec: TipSpec, variant: 'default' | 'primary' = 'default'): ButtonWidget => {
    const b = button({ label, icon: ic, variant, onClick: () => ctx.ops.run(op), tip: spec });
    syncers.push(() => b.setDisabled(!ctx.ops.enabled(op)));
    return b;
  };

  const action = (id: ActionId): HTMLElement => {
    switch (id) {
      case 'pick-object': {
        const b = opButton('view.pick_object', 'Pick object…', 'eyedropper', {
          title: 'Pick Object',
          desc: 'Click the object you want as the main object in the image.',
          extra: 'P',
        });
        syncers.push(() => {
          b.setLabel(ctx.ui.picking ? 'Picking…' : 'Pick object…');
          b.el.classList.toggle('active', ctx.ui.picking);
        });
        return b.el;
      }
      case 'clear-pick': {
        const b = button({ label: 'Clear pick', icon: 'close', onClick: () => ctx.clearPick(), tip: { desc: 'Go back to the automatically chosen main object.' } });
        syncers.push(() => {
          b.el.hidden = !store.getValue('mask.click');
        });
        return b.el;
      }
      case 'reset-camera':
        return opButton('view.reset', 'Reset camera', 'refresh', { desc: 'Reset the 3D orbit camera.', extra: 'Home' }).el;
      case 'export-glb':
        return opButton('file.export_glb', '⬇ Download .glb', undefined, {
          desc: 'Download the 3D model (uses the 3D camera settings). Opens the wallpaper preview first.',
          extra: 'Ctrl E',
        }).el;
      case 'preview-wallpaper':
        return opButton('view.preview_wallpaper', 'Preview wallpaper', 'fullscreen', {
          desc: 'Full-window preview of the wallpaper in a desktop frame. Every export goes through it.',
          extra: 'Ctrl Shift P',
        }).el;
      case 'export-html':
        return opButton(
          'file.export_html',
          'Save Live Wallpaper (.html)',
          'sparkle',
          { desc: 'Self-contained web wallpaper for Wallpaper Engine / Lively / any browser (opens the wallpaper preview first).' },
          'primary',
        ).el;
      case 'reanalyze':
        return opButton('image.reanalyze', 'Re-analyze', 'refresh', {
          desc: 'Run the object-mask and depth models again on the current image.',
          extra: 'Shift R',
        }).el;
    }
  };

  const actionRow = (ids: ActionId[] | undefined): HTMLElement | null =>
    ids?.length ? h('div', { class: 'pw-actions' }, ...ids.map(action)) : null;

  // ── Panels ──
  const panels = new Map<ScenePanel, HTMLElement>();
  const inspectToggles: { sync: () => void }[] = [];

  const groupBody = (g: SettingsGroup): (HTMLElement | null)[] => [...f.rows(...(g.fields as SettingsPath[])), actionRow(g.actions)];

  const headerActions = (c: SettingsCategory): HTMLElement[] => {
    const out: HTMLElement[] = [];
    if (c.presets) {
      out.push(
        headerButton('collection', { title: 'Presets', desc: 'Starting points by image type (portrait, product, landscape, illustration).' }, (e) => {
          const items: MenuItem[] = [
            { heading: 'Presets' },
            ...PRESETS.map<MenuItem>((p) => ({ label: p.label, icon: 'sparkle', run: () => ctx.applyPreset(p.id) })),
          ];
          openMenu(items, { anchor: e.currentTarget as HTMLElement });
        }),
      );
    }
    if (c.inspect) {
      const stage = c.inspect;
      const active = (): boolean => store.getValue('view.mode') === '2d' && store.getValue('view.stage') === stage;
      const eye = iconToggle({
        icon: 'eye',
        get: active,
        onToggle: (on) => ctx.showView('2d', on ? stage : 'result'),
        tip: {
          title: `Inspect ${plainTitle(c)}`,
          desc: `Show this stage in the 2D view while you tune it. Click again to go back to the Result.`,
        },
        class: 'pw-hdr-toggle',
      });
      inspectToggles.push({ sync: eye.refresh });
      out.push(eye.el);
    }
    out.push(
      headerButton('refresh', { title: 'Reset to defaults', desc: `Put every ${plainTitle(c)} setting back to its default (one undo step).` }, () => ctx.resetCategory(c.id)),
    );
    return out;
  };

  for (const c of CATEGORIES) {
    const body: (HTMLElement | null)[] = [];
    for (const g of c.groups) {
      if (g.tier === 'basic') body.push(...groupBody(g));
    }
    for (const g of c.groups) {
      if (g.tier !== 'advanced') continue;
      body.push(panel({ id: `cat.${c.id}.${g.id}`, title: g.title, defaultOpen: false, sub: true }, ...groupBody(g)));
    }
    panels.set(
      c.id,
      panel(
        { id: `cat.${c.id}`, title: c.title, icon: c.icon as IconName, tooltip: c.hint, defaultOpen: !c.collapsed, actions: headerActions(c) },
        ...body,
      ),
    );
  }
  store.subscribe((_s, changed) => {
    if (changed.includes('view.mode') || changed.includes('view.stage')) inspectToggles.forEach((t) => t.sync());
    // The 3D Camera panel opens by itself when the view becomes 3D.
    const cam = panels.get('camera3d');
    if (cam && changed.includes('view.mode') && store.getValue('view.mode') === '3d') setPanelOpen(cam, true);
  });

  const el = page(h('div', { class: 'pw-scene-head' }, viewRow, stageRow), ...CATEGORIES.map((c) => panels.get(c.id) as HTMLElement));

  // Workspaces and the outliner reveal the relevant panel.
  ctx.ui.on('reveal', (id) => {
    const p = panels.get(id);
    if (!p) return;
    setPanelOpen(p, true);
    requestAnimationFrame(() => p.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  });
  // F3 search: open the field's panels, scroll to it and flash it.
  ctx.ui.on('revealField', (path) => {
    const row = f.rowFor(path);
    if (!row) return;
    revealPanelChain(row);
    requestAnimationFrame(() => {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.classList.remove('flash');
      void row.offsetWidth;
      row.classList.add('flash');
      window.setTimeout(() => row.classList.remove('flash'), 1800);
    });
  });

  sync();
  return el;
}
