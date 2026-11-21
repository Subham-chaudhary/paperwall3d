/** Outliner: scene tree with visibility toggles; clicking an item jumps to the relevant Properties tab. */
import type { AppContext } from './context';
import { h } from './dom';
import { icon, type IconName } from './icons';
import type { LayerId, OutlinerId, PropTab } from './state';
import { iconToggle } from './widgets/controls';

interface Item {
  id: LayerId;
  label: string;
  icon: IconName;
  tab: PropTab;
  suffix?: string;
}

const ITEMS: Item[] = [
  { id: 'camera', label: 'Camera', icon: 'camera', tab: 'camera' },
  { id: 'keyLight', label: 'Key Light', icon: 'sun', tab: 'lighting' },
  { id: 'rimLight', label: 'Rim Light', icon: 'bulb', tab: 'lighting' },
  { id: 'background', label: 'Background', icon: 'mesh', tab: 'geometry', suffix: 'mesh' },
  { id: 'foreground', label: 'Foreground', icon: 'mesh', tab: 'geometry', suffix: 'mesh' },
  { id: 'depth', label: 'Depth Map', icon: 'depth', tab: 'depth' },
  { id: 'mask', label: 'Mask', icon: 'mask', tab: 'segmentation' },
];

export function createOutliner(ctx: AppContext): HTMLElement {
  const filter = h('input', { class: 'pw-search-input', attrs: { type: 'search', placeholder: 'Filter', spellcheck: 'false' } });
  filter.addEventListener('keydown', (e) => e.stopPropagation());
  const header = h(
    'div',
    { class: 'pw-area-header' },
    h('span', { class: 'pw-editor-type' }, icon('collection', 14), h('span', { text: 'Outliner' })),
    h('label', { class: 'pw-header-search' }, icon('search', 12), filter),
  );
  const tree = h('div', { class: 'pw-tree', attrs: { role: 'tree' } });

  const visible = (id: LayerId): boolean => {
    const s = ctx.store;
    switch (id) {
      case 'keyLight':
        return s.getValue('lighting.keyIntensity') > 0;
      case 'rimLight':
        return s.getValue('lighting.rimIntensity') > 0;
      case 'depth':
        return s.getValue('view.mode') === 'depth';
      case 'mask':
        return s.getValue('view.mode') === 'mask';
      default:
        return ctx.ui.layers[id];
    }
  };

  const toggles: { id: LayerId; sync: () => void }[] = [];
  let collapsed = false;
  const rows = new Map<OutlinerId, HTMLElement>();

  const sceneRow = h(
    'div',
    { class: 'pw-tree-row scene', attrs: { role: 'treeitem' } },
    h('span', { class: 'pw-tree-expander' }),
    h('span', { class: 'pw-tree-icon' }, icon('scene', 14)),
    h('span', { class: 'pw-tree-label' }),
  );
  const sceneLabel = sceneRow.querySelector('.pw-tree-label') as HTMLElement;
  const expander = sceneRow.querySelector('.pw-tree-expander') as HTMLElement;
  const syncScene = (): void => {
    sceneLabel.textContent = ctx.sceneName;
    expander.replaceChildren(icon(collapsed ? 'triRight' : 'triDown', 10));
    tree.classList.toggle('collapsed', collapsed);
  };
  expander.addEventListener('click', (e) => {
    e.stopPropagation();
    collapsed = !collapsed;
    syncScene();
  });
  sceneRow.addEventListener('click', () => {
    ctx.ui.select('scene');
    ctx.ui.setTab('image');
  });
  rows.set('scene', sceneRow);
  tree.appendChild(sceneRow);

  for (const it of ITEMS) {
    const eye = iconToggle({
      icon: 'eye',
      iconOff: 'eyeOff',
      get: () => visible(it.id),
      onToggle: (v) => ctx.setLayerVisible(it.id, v),
      tip: { desc: `Toggle visibility of ${it.label}` },
      class: 'pw-eye',
    });
    toggles.push({ id: it.id, sync: eye.refresh });
    const row = h(
      'div',
      { class: 'pw-tree-row child', attrs: { role: 'treeitem' } },
      h('span', { class: 'pw-tree-expander' }),
      h('span', { class: 'pw-tree-icon' }, icon(it.icon, 14)),
      h('span', { class: 'pw-tree-label', text: it.label }),
      it.suffix ? h('span', { class: 'pw-tree-suffix', text: `(${it.suffix})` }) : null,
      eye.el,
    );
    row.dataset.label = it.label.toLowerCase();
    row.addEventListener('click', () => {
      ctx.ui.select(it.id);
      ctx.ui.setTab(it.tab);
    });
    rows.set(it.id, row);
    tree.appendChild(row);
  }

  const applySelection = (): void => rows.forEach((r, id) => r.classList.toggle('selected', id === ctx.ui.selection));
  const syncDim = (): void => {
    // Foreground is irrelevant when no subject was detected.
    const fg = rows.get('foreground');
    fg?.classList.toggle('dim', !!ctx.scene && !ctx.scene.hasForeground);
  };
  const syncAll = (): void => {
    syncScene();
    toggles.forEach((t) => t.sync());
    syncDim();
  };
  filter.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    rows.forEach((r, id) => {
      if (id === 'scene') return;
      r.classList.toggle('filtered-out', !!q && !(r.dataset.label ?? '').includes(q));
    });
  });

  ctx.ui.on('selection', applySelection);
  ctx.ui.on('layers', syncAll);
  ctx.store.subscribe(syncAll);
  ctx.events.on('name', syncAll);
  ctx.events.on('scene', syncAll);
  applySelection();
  syncAll();

  return h('div', { class: 'pw-area pw-outliner' }, header, tree);
}
