/** Properties editor: vertical icon tab column on the left edge, collapsible panels on the right. */
import { h } from '../dom';
import type { AppContext } from '../context';
import { icon, type IconName } from '../icons';
import type { PropTab } from '../state';
import { tip } from '../widgets/tooltip';
import { appendHeaderSearch } from './search';
import { imageTab, systemTab } from './appTabs';
import { Fields } from './fields';
import { sceneTab } from './settingsTabs';

export interface TabDef {
  id: PropTab;
  label: string;
  icon: IconName;
}

export const TABS: readonly TabDef[] = [
  { id: 'scene', label: 'Scene', icon: 'scene' },
  { id: 'image', label: 'Image', icon: 'image' },
  { id: 'system', label: 'System', icon: 'cpu' },
];

export function createProperties(ctx: AppContext): HTMLElement {
  const f = new Fields(ctx);
  const pages: Record<PropTab, HTMLElement> = {
    scene: sceneTab(ctx, f),
    image: imageTab(ctx),
    system: systemTab(ctx),
  };

  const crumb = h('span', { class: 'pw-crumb-tab' });
  const header = h(
    'div',
    { class: 'pw-area-header' },
    h('span', { class: 'pw-editor-type' }, icon('wrench', 14), h('span', { text: 'Properties' })),
    h('span', { class: 'pw-crumb' }, icon('scene', 12), h('span', { text: 'Scene' }), icon('chevRight', 10), crumb),
  );
  appendHeaderSearch(header, pages);

  const tabCol = h('div', { class: 'pw-tabcol', attrs: { role: 'tablist', 'aria-orientation': 'vertical' } });
  const tabButtons = new Map<PropTab, HTMLElement>();
  for (const t of TABS) {
    const b = h('button', { class: 'pw-tabbtn', attrs: { type: 'button', role: 'tab' } }, icon(t.icon, 16));
    tip(b, { desc: t.label });
    b.addEventListener('click', () => ctx.ui.setTab(t.id));
    tabCol.appendChild(b);
    tabButtons.set(t.id, b);
  }

  const scroll = h('div', { class: 'pw-props-scroll' });
  for (const t of TABS) scroll.appendChild(pages[t.id]);

  const apply = (): void => {
    const cur = ctx.ui.tab;
    for (const t of TABS) {
      const on = t.id === cur;
      pages[t.id].hidden = !on;
      tabButtons.get(t.id)?.classList.toggle('active', on);
      tabButtons.get(t.id)?.setAttribute('aria-selected', String(on));
    }
    crumb.textContent = TABS.find((t) => t.id === cur)?.label ?? '';
    scroll.scrollTop = 0;
  };
  ctx.ui.on('tab', apply);
  apply();

  return h('div', { class: 'pw-area pw-properties' }, header, h('div', { class: 'pw-props-body' }, tabCol, scroll));
}
