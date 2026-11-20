/** Blender-style controls: checkbox, enum dropdown, segmented toggle row, color swatch, button, text field. */
import { h } from '../dom';
import { icon, type IconName } from '../icons';
import type { Binding } from './binding';
import { closeMenus, isMenuOpenFor, openMenu } from './menu';
import type { Widget } from './number';
import { tip, type TipSpec } from './tooltip';

// ───────────────────────────────────────────── Checkbox ─────────────────────────────────────────────

export interface CheckboxOpts {
  bind: Binding<boolean>;
  label: string;
  tip?: TipSpec;
}

/** Blue filled box with white check mark; the label is clickable too. */
export function checkbox(o: CheckboxOpts): Widget {
  const box = h('span', { class: 'pw-check-box' }, icon('check', 12));
  const el = h(
    'div',
    { class: 'pw-check', attrs: { role: 'checkbox', tabindex: 0 } },
    box,
    h('span', { class: 'pw-check-label', text: o.label }),
  );
  tip(el, o.tip);
  const refresh = (): void => {
    const v = o.bind.get();
    el.classList.toggle('on', v);
    el.setAttribute('aria-checked', String(v));
  };
  const toggle = (): void => {
    o.bind.begin();
    o.bind.set(!o.bind.get());
    refresh();
  };
  el.addEventListener('click', toggle);
  el.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggle();
    }
  });
  o.bind.subscribe(refresh);
  refresh();
  return { el, refresh };
}

// ───────────────────────────────────────────── Enum dropdown ─────────────────────────────────────────────

export interface EnumOption<T> {
  value: T;
  label: string;
  icon?: IconName;
  shortcut?: string;
}

export interface EnumOpts<T extends string | number> {
  bind: Binding<T>;
  options: readonly EnumOption<T>[];
  icon?: IconName;
  tip?: TipSpec;
  /** Header-style flat dropdown (used in area headers). */
  flat?: boolean;
}

export function enumField<T extends string | number>(o: EnumOpts<T>): Widget {
  const text = h('span', { class: 'pw-enum-text' });
  const lead = h('span', { class: 'pw-enum-icon' });
  const el = h(
    'button',
    { class: 'pw-enum' + (o.flat ? ' flat' : ''), attrs: { type: 'button', role: 'combobox' } },
    lead,
    text,
    h('span', { class: 'pw-enum-arrow' }, icon('upDown', 12)),
  );
  tip(el, o.tip);
  const refresh = (): void => {
    const cur = o.options.find((x) => x.value === o.bind.get());
    text.textContent = cur?.label ?? String(o.bind.get());
    lead.replaceChildren();
    const ic = cur?.icon ?? o.icon;
    if (ic) lead.appendChild(icon(ic, 14));
    lead.style.display = ic ? '' : 'none';
  };
  el.addEventListener('click', () => {
    if (isMenuOpenFor(el)) {
      closeMenus();
      return;
    }
    const cur = o.bind.get();
    openMenu(
      o.options.map((opt) => ({
        label: opt.label,
        icon: opt.icon,
        shortcut: opt.shortcut,
        checked: opt.value === cur,
        run: () => {
          o.bind.begin();
          o.bind.set(opt.value);
          refresh();
        },
      })),
      { anchor: el },
    );
  });
  o.bind.subscribe(refresh);
  refresh();
  return { el, refresh };
}

// ───────────────────────────────────────────── Segmented ─────────────────────────────────────────────

export interface SegmentedOpts<T extends string | number> {
  bind: Binding<T>;
  options: readonly (EnumOption<T> & { tip?: TipSpec })[];
  /** Show only icons (labels become tooltips). */
  iconOnly?: boolean;
  tip?: TipSpec;
  /** Skip undo checkpoints (e.g. view-mode toggles). */
  noUndo?: boolean;
}

/** Joined row of toggle buttons where exactly one is active. */
export function segmented<T extends string | number>(o: SegmentedOpts<T>): Widget {
  const el = h('div', { class: 'pw-seg', attrs: { role: 'radiogroup' } });
  tip(el, o.tip);
  const buttons = o.options.map((opt) => {
    const b = h(
      'button',
      { class: 'pw-seg-btn' + (o.iconOnly ? ' icon-only' : ''), attrs: { type: 'button', role: 'radio' } },
      opt.icon ? icon(opt.icon, 14) : null,
      o.iconOnly ? null : h('span', { text: opt.label }),
    );
    tip(b, opt.tip ?? (o.iconOnly ? { desc: opt.label, extra: opt.shortcut } : undefined));
    b.addEventListener('click', () => {
      if (o.bind.get() === opt.value) return;
      if (!o.noUndo) o.bind.begin();
      o.bind.set(opt.value);
      refresh();
    });
    el.appendChild(b);
    return b;
  });
  const refresh = (): void => {
    const v = o.bind.get();
    buttons.forEach((b, i) => {
      const on = o.options[i]?.value === v;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    });
  };
  o.bind.subscribe(refresh);
  refresh();
  return { el, refresh };
}

// ───────────────────────────────────────────── Color ─────────────────────────────────────────────

export interface ColorOpts {
  bind: Binding<string>;
  tip?: TipSpec;
}

/** Color swatch field backed by the native color input. */
export function colorField(o: ColorOpts): Widget {
  const input = h('input', { class: 'pw-color-input', attrs: { type: 'color' } });
  const hex = h('span', { class: 'pw-color-hex' });
  const el = h('div', { class: 'pw-color' }, hex, input);
  tip(el, o.tip);
  let began = false;
  const refresh = (): void => {
    const v = o.bind.get();
    if (input.value.toLowerCase() !== v.toLowerCase()) input.value = v;
    el.style.setProperty('--swatch', v);
    hex.textContent = v.toUpperCase();
    // Pick readable text color over the swatch.
    const n = parseInt(v.slice(1), 16);
    const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    el.classList.toggle('light', lum > 0.55);
  };
  input.addEventListener('input', () => {
    if (!began) {
      began = true;
      o.bind.begin();
    }
    o.bind.set(input.value);
    refresh();
  });
  input.addEventListener('change', () => {
    began = false;
  });
  o.bind.subscribe(refresh);
  refresh();
  return { el, refresh };
}

// ───────────────────────────────────────────── Button ─────────────────────────────────────────────

export interface ButtonOpts {
  label?: string;
  icon?: IconName;
  onClick: (e: MouseEvent) => void;
  tip?: TipSpec;
  variant?: 'default' | 'primary' | 'danger';
  /** Square icon-only button. */
  iconOnly?: boolean;
  disabled?: boolean;
}

export interface ButtonWidget extends Widget<HTMLButtonElement> {
  setDisabled(d: boolean): void;
  setLabel(text: string): void;
}

/** Operator-style button. */
export function button(o: ButtonOpts): ButtonWidget {
  const label = h('span', { class: 'pw-btn-label', text: o.label ?? '' });
  const el = h(
    'button',
    { class: `pw-btn ${o.variant ?? 'default'}` + (o.iconOnly ? ' icon-only' : ''), attrs: { type: 'button' } },
    o.icon ? icon(o.icon, 14) : null,
    o.iconOnly ? null : label,
  );
  tip(el, o.tip);
  el.disabled = o.disabled ?? false;
  el.addEventListener('click', (e) => {
    if (!el.disabled) o.onClick(e);
  });
  return {
    el,
    refresh: () => {},
    setDisabled: (d) => {
      el.disabled = d;
    },
    setLabel: (t) => {
      label.textContent = t;
    },
  };
}

// ───────────────────────────────────────────── Text field ─────────────────────────────────────────────

export interface TextOpts {
  bind: Binding<string>;
  placeholder?: string;
  tip?: TipSpec;
  icon?: IconName;
}

/** Single-line text field. Commits on Enter/blur, reverts on Esc. */
export function textField(o: TextOpts): Widget<HTMLElement> {
  const input = h('input', { class: 'pw-text-input', attrs: { type: 'text', spellcheck: 'false', placeholder: o.placeholder } });
  const el = h('div', { class: 'pw-text' }, o.icon ? icon(o.icon, 14) : null, input);
  tip(el, o.tip);
  const refresh = (): void => {
    if (document.activeElement !== input) input.value = o.bind.get();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') input.blur();
    else if (e.key === 'Escape') {
      input.value = o.bind.get();
      input.blur();
    }
  });
  input.addEventListener('focus', () => input.select());
  input.addEventListener('blur', () => {
    const v = input.value.trim();
    if (v && v !== o.bind.get()) {
      o.bind.begin();
      o.bind.set(v);
    }
    input.value = o.bind.get();
  });
  o.bind.subscribe(refresh);
  refresh();
  return { el, refresh };
}

// ───────────────────────────────────────────── Icon toggle ─────────────────────────────────────────────

export interface IconToggleOpts {
  icon: IconName;
  iconOff?: IconName;
  get: () => boolean;
  onToggle: (next: boolean) => void;
  tip?: TipSpec;
  class?: string;
}

/** Small icon button with on/off state (eye toggles, header toggles). */
export function iconToggle(o: IconToggleOpts): Widget<HTMLButtonElement> & { setOn(on: boolean): void } {
  const el = h('button', { class: 'pw-icon-toggle ' + (o.class ?? ''), attrs: { type: 'button' } });
  tip(el, o.tip);
  const setOn = (on: boolean): void => {
    el.classList.toggle('on', on);
    el.replaceChildren(icon(on ? o.icon : (o.iconOff ?? o.icon), 14));
  };
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    o.onToggle(!o.get());
    setOn(o.get());
  });
  el.addEventListener('dblclick', (e) => e.stopPropagation());
  setOn(o.get());
  return { el, refresh: () => setOn(o.get()), setOn };
}
