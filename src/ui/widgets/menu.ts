/**
 * Blender-style popup menus: used by the top-bar menus, enum dropdowns, context menus and
 * the area-header dropdowns. Supports separators, shortcuts, check marks, nested submenus
 * and basic keyboard navigation.
 */
import { h } from '../dom';
import { icon, type IconName } from '../icons';

export interface MenuItem {
  label?: string;
  icon?: IconName;
  /** Display string, right-aligned (e.g. "Ctrl S"). */
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  separator?: boolean;
  /** Non-interactive section title. */
  heading?: string;
  submenu?: MenuItem[] | (() => MenuItem[]);
  run?: () => void;
}

export interface MenuOptions {
  /** Open below (default) or to the right of this element. */
  anchor?: HTMLElement;
  /** Or open at a screen point. */
  x?: number;
  y?: number;
  minWidth?: number;
  onClose?: () => void;
}

export interface MenuHandle {
  close(): void;
}

interface Level {
  el: HTMLDivElement;
  items: MenuItem[];
  rows: HTMLElement[];
  active: number;
}

let current: { close: () => void; anchor?: HTMLElement } | null = null;

export function closeMenus(): void {
  current?.close();
}

export function isMenuOpen(): boolean {
  return current !== null;
}

/** True when the open menu was opened from this anchor element. */
export function isMenuOpenFor(anchor: HTMLElement): boolean {
  return current !== null && current.anchor === anchor;
}

/** Open a menu; closes any other open menu first. */
export function openMenu(items: MenuItem[], opts: MenuOptions): MenuHandle {
  closeMenus();
  const levels: Level[] = [];
  let closed = false;
  let hoverTimer: number | undefined;

  const root = h('div', { class: 'pw-menu-root' });
  document.body.appendChild(root);

  const close = (): void => {
    if (closed) return;
    closed = true;
    window.clearTimeout(hoverTimer);
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
    root.remove();
    if (current?.close === close) current = null;
    opts.anchor?.classList.remove('menu-open');
    opts.onClose?.();
  };

  const closeFrom = (depth: number): void => {
    while (levels.length > depth) levels.pop()?.el.remove();
  };

  const onOutside = (e: PointerEvent): void => {
    const t = e.target as Node | null;
    if (t && root.contains(t)) return;
    if (t && opts.anchor?.contains(t)) return; // the anchor's own handler toggles
    close();
  };

  const placeAt = (el: HTMLElement, x: number, y: number, flipX?: number): void => {
    const w = el.offsetWidth;
    const hh = el.offsetHeight;
    let left = x;
    if (left + w > window.innerWidth - 4) left = flipX !== undefined ? flipX - w : window.innerWidth - w - 4;
    let top = y;
    if (top + hh > window.innerHeight - 4) top = Math.max(4, window.innerHeight - hh - 4);
    el.style.left = `${Math.max(4, left)}px`;
    el.style.top = `${top}px`;
  };

  const build = (list: MenuItem[], depth: number): Level => {
    const el = h('div', { class: 'pw-menu', attrs: { role: 'menu' } });
    if (opts.minWidth && depth === 0) el.style.minWidth = `${opts.minWidth}px`;
    const level: Level = { el, items: list, rows: [], active: -1 };
    list.forEach((item, idx) => {
      if (item.separator) {
        el.appendChild(h('div', { class: 'pw-menu-sep' }));
        level.rows.push(el);
        return;
      }
      if (item.heading) {
        el.appendChild(h('div', { class: 'pw-menu-heading', text: item.heading }));
        level.rows.push(el);
        return;
      }
      const row = h('div', {
        class: 'pw-menu-item' + (item.disabled ? ' disabled' : '') + (item.checked ? ' checked' : ''),
        attrs: { role: 'menuitem' },
      });
      const lead = h('span', { class: 'pw-menu-lead' });
      if (item.icon) lead.appendChild(icon(item.icon, 14));
      else if (item.checked) lead.appendChild(icon('check', 14));
      row.appendChild(lead);
      row.appendChild(h('span', { class: 'pw-menu-label', text: item.label ?? '' }));
      if (item.shortcut) row.appendChild(h('span', { class: 'pw-menu-shortcut', text: item.shortcut }));
      if (item.submenu) row.appendChild(h('span', { class: 'pw-menu-arrow' }, icon('chevRight', 12)));
      row.addEventListener('pointerenter', () => {
        setActive(level, idx);
        window.clearTimeout(hoverTimer);
        if (item.submenu && !item.disabled) {
          hoverTimer = window.setTimeout(() => openSub(level, idx, depth), 120);
        } else {
          hoverTimer = window.setTimeout(() => closeFrom(depth + 1), 200);
        }
      });
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (item.disabled) return;
        if (item.submenu) {
          openSub(level, idx, depth);
          return;
        }
        close();
        item.run?.();
      });
      el.appendChild(row);
      level.rows.push(row);
    });
    root.appendChild(el);
    levels[depth] = level;
    return level;
  };

  const setActive = (level: Level, idx: number): void => {
    level.rows.forEach((r, i) => r.classList.toggle('active', i === idx && r !== level.el));
    level.active = idx;
  };

  const openSub = (level: Level, idx: number, depth: number): void => {
    const item = level.items[idx];
    const row = level.rows[idx];
    if (!item?.submenu || !row) return;
    closeFrom(depth + 1);
    const sub = typeof item.submenu === 'function' ? item.submenu() : item.submenu;
    const lv = build(sub, depth + 1);
    const rr = row.getBoundingClientRect();
    placeAt(lv.el, rr.right - 2, rr.top - 4, rr.left + 2);
  };

  const onKey = (e: KeyboardEvent): void => {
    const level = levels[levels.length - 1];
    if (!level) return;
    const selectable = (i: number): boolean => {
      const it = level.items[i];
      return !!it && !it.separator && !it.heading && !it.disabled;
    };
    const move = (dir: 1 | -1): void => {
      let i = level.active;
      for (let n = 0; n < level.items.length; n++) {
        i = (i + dir + level.items.length) % level.items.length;
        if (selectable(i)) {
          setActive(level, i);
          level.rows[i]?.scrollIntoView({ block: 'nearest' });
          return;
        }
      }
    };
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        if (levels.length > 1) closeFrom(levels.length - 1);
        else close();
        break;
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'ArrowRight':
        if (level.active >= 0 && level.items[level.active]?.submenu) {
          e.preventDefault();
          openSub(level, level.active, levels.length - 1);
          const sub = levels[levels.length - 1];
          if (sub && sub !== level) {
            for (let i = 0; i < sub.items.length; i++) {
              const it = sub.items[i];
              if (it && !it.separator && !it.heading && !it.disabled) {
                setActive(sub, i);
                break;
              }
            }
          }
        }
        break;
      case 'ArrowLeft':
        if (levels.length > 1) {
          e.preventDefault();
          closeFrom(levels.length - 1);
        }
        break;
      case 'Enter':
      case ' ': {
        const it = level.items[level.active];
        if (it && selectable(level.active)) {
          e.preventDefault();
          e.stopPropagation();
          level.rows[level.active]?.click();
        }
        break;
      }
      default:
    }
  };

  const top = build(items, 0);
  let x = opts.x ?? 0;
  let y = opts.y ?? 0;
  if (opts.anchor) {
    const r = opts.anchor.getBoundingClientRect();
    x = r.left;
    y = r.bottom + 1;
    if (!opts.minWidth) top.el.style.minWidth = `${Math.max(120, r.width)}px`;
    opts.anchor.classList.add('menu-open');
  }
  placeAt(top.el, x, y);
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', close);
  current = { close, anchor: opts.anchor };
  return { close };
}
