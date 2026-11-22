/** Blender-style tooltips: description plus a python-path-like line, shown after a short hover delay. */
import { h } from '../dom';

export interface TipSpec {
  title?: string;
  desc?: string;
  /** Settings path, e.g. "mask.thresh", shown as the config.json key. */
  path?: string;
  /** Free-form extra line (e.g. shortcut). */
  extra?: string;
  /** Section the setting lives in (advanced sub-panel), shown as its own line. */
  section?: string;
  /** Why the setting currently has no effect, shown as "Inactive: <reason>". May be changed while the tip exists. */
  inactive?: string;
}

const DELAY_MS = 600;
let tipEl: HTMLDivElement | null = null;
let timer: number | undefined;

function hide(): void {
  window.clearTimeout(timer);
  timer = undefined;
  tipEl?.remove();
  tipEl = null;
}

function show(anchor: HTMLElement, spec: TipSpec): void {
  hide();
  const el = h('div', { class: 'pw-tooltip' });
  if (spec.title) el.appendChild(h('div', { class: 'pw-tooltip-title', text: spec.title }));
  if (spec.desc) el.appendChild(h('div', { class: 'pw-tooltip-desc', text: spec.desc }));
  if (spec.inactive) el.appendChild(h('div', { class: 'pw-tooltip-inactive', text: `Inactive: ${spec.inactive}` }));
  if (spec.section) el.appendChild(h('div', { class: 'pw-tooltip-extra', text: spec.section }));
  if (spec.extra) el.appendChild(h('div', { class: 'pw-tooltip-extra', text: spec.extra }));
  if (spec.path) el.appendChild(h('div', { class: 'pw-tooltip-path', text: `config.json: ${spec.path}` }));
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const tw = el.offsetWidth;
  const th = el.offsetHeight;
  let x = r.left + 8;
  let y = r.bottom + 4;
  if (x + tw > window.innerWidth - 6) x = window.innerWidth - tw - 6;
  if (y + th > window.innerHeight - 6) y = Math.max(6, r.top - th - 4);
  el.style.left = `${Math.max(6, x)}px`;
  el.style.top = `${y}px`;
  tipEl = el;
}

/** Attach a delayed tooltip to an element. */
export function tip(el: HTMLElement, spec: TipSpec | string | undefined): void {
  if (!spec) return;
  const s: TipSpec = typeof spec === 'string' ? { desc: spec } : spec;
  el.addEventListener('pointerenter', (e) => {
    if (e.buttons) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => show(el, s), DELAY_MS);
  });
  el.addEventListener('pointerleave', hide);
  el.addEventListener('pointerdown', hide);
}

export function hideTooltip(): void {
  hide();
}

window.addEventListener('keydown', hide, true);
window.addEventListener('wheel', hide, { passive: true, capture: true });
