/** Left tool column (Blender's toolbar): view switch, Pick Object, Preview Wallpaper. */
import type { AppContext } from './context';
import { h } from './dom';
import { icon, type IconName } from './icons';
import { tip } from './widgets/tooltip';

interface ToolDef {
  op: string;
  icon: IconName;
  label: string;
  desc: string;
  shortcut?: string;
  active: (ctx: AppContext) => boolean;
}

const TOOLS: (ToolDef | 'sep')[] = [
  { op: 'view.mode_2d', icon: 'imageEditor', label: '2D Parallax', desc: 'Live wallpaper parallax under the cursor.', active: (c) => c.store.getValue('view.mode') === '2d' },
  { op: 'view.mode_3d', icon: 'view3d', label: '3D Camera', desc: 'Orbit the displaced meshes in 3D.', active: (c) => c.store.getValue('view.mode') === '3d' },
  { op: 'view.mode_config', icon: 'file', label: 'config.json', desc: 'Every setting as commented JSON, in sync with the sliders.', active: (c) => c.store.getValue('view.mode') === 'config' },
  'sep',
  { op: 'view.pick_object', icon: 'eyedropper', label: 'Pick Object', desc: 'Click the object you want as the main object.', shortcut: 'P', active: (c) => c.ui.picking },
  'sep',
  { op: 'view.preview_wallpaper', icon: 'fullscreen', label: 'Preview Wallpaper', desc: 'Full-window wallpaper preview. Exports go through it.', shortcut: 'F', active: (c) => c.ui.previewOpen },
];

export function createToolbar(ctx: AppContext): HTMLElement {
  const el = h('div', { class: 'pw-toolbar', attrs: { role: 'toolbar', 'aria-orientation': 'vertical' } });
  const buttons: [ToolDef, HTMLElement][] = [];
  for (const t of TOOLS) {
    if (t === 'sep') {
      el.appendChild(h('div', { class: 'pw-toolbar-sep' }));
      continue;
    }
    const b = h('button', { class: 'pw-tool', attrs: { type: 'button' } }, icon(t.icon, 18));
    tip(b, { title: t.label, desc: t.desc, extra: t.shortcut });
    b.addEventListener('click', () => ctx.ops.run(t.op));
    el.appendChild(b);
    buttons.push([t, b]);
  }
  const apply = (): void => {
    for (const [t, b] of buttons) {
      b.classList.toggle('active', t.active(ctx));
      b.toggleAttribute('disabled', !ctx.ops.enabled(t.op));
    }
  };
  ctx.ui.on('picking', apply);
  ctx.ui.on('preview', apply);
  ctx.events.on('image', apply);
  ctx.store.subscribe((_s, changed) => {
    if (changed.includes('view.mode')) apply();
  });
  apply();
  return el;
}
