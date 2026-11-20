/** Blender-style tooltips: description plus a python-path-like line, shown after a short hover delay. */
import { h } from '../dom';

export interface TipSpec {
  title?: string;
  desc?: string;
  /** Settings path, e.g. "geometry.foregroundRelief", rendered as paperwall3d.geometry.foreground_relief. */
  path?: string;
  /** Free-form extra line (e.g. shortcut). */
  extra?: string;
}

const DELAY_MS = 600;
let tipEl: HTMLDivElement | null = null;
let timer: number | undefined;

const snake = (s: string): string => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

/** `geometry.foregroundRelief` -> `paperwall3d.geometry.foreground_relief` */
export function pyPath(path: string): string {
  const [section, key] = path.split('.');
  return `paperwall3d.${section}${key ? '.' + snake(key) : ''}`;
}

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
  if (spec.extra) el.appendChild(h('div', { class: 'pw-tooltip-extra', text: spec.extra }));
  if (spec.path) el.appendChild(h('div', { class: 'pw-tooltip-path', text: `Python: ${pyPath(spec.path)}` }));
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
