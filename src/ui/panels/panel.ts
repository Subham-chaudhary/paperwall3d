/**
 * Collapsible Blender-style panel: rounded header with triangle, optional icon, title, right-side header buttons and
 * drag-handle dots. `sub: true` renders a nested sub-panel (flat header, indented body).
 */
import { getPref, setPref } from '../../persistence/prefs';
import { h } from '../dom';
import { icon, type IconName } from '../icons';
import { tip, type TipSpec } from '../widgets/tooltip';

export interface PanelOpts {
  /** Stable id used to remember the collapsed state in localStorage. */
  id: string;
  title: string;
  defaultOpen?: boolean;
  /** Icon shown before the title. */
  icon?: IconName;
  /** Tooltip of the whole header. */
  tooltip?: TipSpec | string;
  /** Small icon buttons at the right of the header (presets, inspect eye, reset). */
  actions?: HTMLElement[];
  /** Nested sub-panel (smaller, flat header). */
  sub?: boolean;
}

const openers = new WeakMap<HTMLElement, (open: boolean) => void>();

/** Expand or collapse a panel created by `panel()` from code (workspace switches, view changes). */
export function setPanelOpen(el: HTMLElement, open: boolean): void {
  openers.get(el)?.(open);
}

/** Expand a panel and every panel that contains it. */
export function revealPanelChain(el: HTMLElement): void {
  for (let p = el.closest<HTMLElement>('.pw-panel'); p; p = p.parentElement?.closest<HTMLElement>('.pw-panel') ?? null) {
    setPanelOpen(p, true);
  }
}

export function panel(o: PanelOpts, ...body: (HTMLElement | null)[]): HTMLElement {
  const key = `panel.${o.id}`;
  let open = getPref<boolean>(key, o.defaultOpen ?? true);

  const arrow = h('span', { class: 'pw-panel-arrow' });
  const actions = o.actions?.length ? h('span', { class: 'pw-panel-actions' }, ...o.actions) : null;
  const header = h(
    'div',
    { class: 'pw-panel-header', attrs: { role: 'button', tabindex: 0, 'aria-expanded': open } },
    arrow,
    o.icon ? h('span', { class: 'pw-panel-icon' }, icon(o.icon, 14)) : null,
    h('span', { class: 'pw-panel-title', text: o.title }),
    actions,
    o.sub ? null : h('span', { class: 'pw-panel-grip' }, icon('grip', 12)),
  );
  tip(header, o.tooltip);
  const content = h('div', { class: 'pw-panel-body' }, ...body);
  const el = h('section', { class: 'pw-panel' + (o.sub ? ' sub' : ''), data: { panel: o.id } }, header, content);

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
    // Header buttons handle their own clicks.
    if ((e.target as HTMLElement).closest('.pw-panel-actions, .pw-check, .pw-btn, .pw-num')) return;
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
