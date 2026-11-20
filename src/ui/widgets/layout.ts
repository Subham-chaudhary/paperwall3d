/** Layout helpers in the spirit of Blender's UILayout: property-split rows, columns, aligned rows. */
import { h, type Child } from '../dom';
import type { Binding } from './binding';

/** Vertical stack with Blender's tight 2px spacing. */
export function column(...children: Child[]): HTMLElement {
  return h('div', { class: 'pw-col' }, ...children);
}

/** Horizontal row; children share the width equally and are visually joined (aligned). */
export function row(...children: Child[]): HTMLElement {
  return h('div', { class: 'pw-row aligned' }, ...children);
}

/** Horizontal row with a gap between children (not joined). */
export function spacedRow(...children: Child[]): HTMLElement {
  return h('div', { class: 'pw-row' }, ...children);
}

/** Two-column split with a given first-column factor (0..1). */
export function split(factor: number, a: Child, b: Child): HTMLElement {
  const el = h('div', { class: 'pw-split' }, h('div', {}, a), h('div', {}, b));
  el.style.gridTemplateColumns = `${factor}fr ${1 - factor}fr`;
  return el;
}

/**
 * Property-split row: right-aligned label column on the left, controls on the right.
 * Pass `null` as label for a row whose controls start at the field column.
 */
export function propRow(label: string | null, ...content: Child[]): HTMLElement {
  return h(
    'div',
    { class: 'pw-prop' },
    h('div', { class: 'pw-prop-label', text: label ?? '' }),
    h('div', { class: 'pw-prop-field' }, ...content),
  );
}

/** Read-only label/value row. */
export function infoRow(label: string, value: Child): HTMLElement {
  return h('div', { class: 'pw-prop info' }, h('div', { class: 'pw-prop-label', text: label }), h('div', { class: 'pw-prop-value' }, value));
}

/** Add the `inactive` (greyed) class to `el` while a boolean binding equals `inactiveWhen`. */
export function bindInactive(el: HTMLElement, bind: Binding<boolean>, inactiveWhen = false): void {
  const apply = (): void => {
    el.classList.toggle('inactive', bind.get() === inactiveWhen);
  };
  bind.subscribe(apply);
  apply();
}
