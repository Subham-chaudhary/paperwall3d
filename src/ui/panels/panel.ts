/** Collapsible Blender-style panel: rounded header with triangle, title and drag-handle dots. */
import { getPref, setPref } from '../../persistence/prefs';
import { h } from '../dom';
import { icon } from '../icons';
import { openMenu, type MenuItem } from '../widgets/menu';
import { tip } from '../widgets/tooltip';

export interface PanelOpts {
  /** Stable id used to remember the collapsed state in localStorage. */
  id: string;
  title: string;
  defaultOpen?: boolean;
  /** Extra widget shown in the header (e.g. an enable checkbox). */
  headerWidget?: HTMLElement;
  /** Blender-style list icon at the right of the header that opens this menu (e.g. presets). */
  menu?: () => MenuItem[];
  menuTip?: string;
}

const openers = new WeakMap<HTMLElement, (open: boolean) => void>();

/** Expand or collapse a panel created by `panel()` from code (workspace switches, view changes). */
export function setPanelOpen(el: HTMLElement, open: boolean): void {
  openers.get(el)?.(open);
}

export function panel(o: PanelOpts, ...body: HTMLElement[]): HTMLElement {
  const key = `panel.${o.id}`;
  let open = getPref<boolean>(key, o.defaultOpen ?? true);

  const arrow = h('span', { class: 'pw-panel-arrow' });
  let menuBtn: HTMLElement | null = null;
  if (o.menu) {
    const items = o.menu;
    menuBtn = h('button', { class: 'pw-panel-menu', attrs: { type: 'button' } }, icon('collection', 14));
    tip(menuBtn, { desc: o.menuTip ?? 'Presets' });
    const anchor = menuBtn;
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openMenu(items(), { anchor });
    });
  }
  const header = h(
    'div',
    { class: 'pw-panel-header', attrs: { role: 'button', tabindex: 0, 'aria-expanded': open } },
    arrow,
    h('span', { class: 'pw-panel-title', text: o.title }),
    o.headerWidget ? h('span', { class: 'pw-panel-header-widget' }, o.headerWidget) : null,
    menuBtn,
    h('span', { class: 'pw-panel-grip' }, icon('grip', 12)),
  );
  const content = h('div', { class: 'pw-panel-body' }, ...body);
  const el = h('section', { class: 'pw-panel' }, header, content);

  const apply = (): void => {
    arrow.replaceChildren(icon(open ? 'triDown' : 'triRight', 12));
    el.classList.toggle('collapsed', !open);
    header.setAttribute('aria-expanded', String(open));
  };
  const toggle = (): void => {
    open = !open;
    setPref(key, open);
    apply();
  };
  openers.set(el, (v) => {
    if (open === v) return;
    open = v;
    setPref(key, open);
    apply();
  });
  header.addEventListener('click', (e) => {
    // Header widgets (checkbox etc.) handle their own clicks.
    if ((e.target as HTMLElement).closest('.pw-panel-header-widget, .pw-panel-menu, .pw-check, .pw-btn, .pw-num')) return;
    toggle();
  });
  header.addEventListener('keydown', (e) => {
    if (e.target === header && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      toggle();
    }
  });
  apply();
  return el;
}
