/**
 * Blender-style number field / slider.
 * - Drag horizontally to change the value. Ctrl snaps to steps, Shift gives fine precision.
 * - Click without dragging (or double-click) enters text editing: Enter commits, Esc cancels.
 * - Non-slider fields show arrow steppers on hover.
 * - Sliders fill proportionally in blue.
 */
import { h, clamp } from '../dom';
import { icon } from '../icons';
import type { Binding } from './binding';
import { tip, type TipSpec } from './tooltip';

export interface NumberOpts {
  bind: Binding<number>;
  min: number;
  max: number;
  /** Snap / stepper increment. Defaults to 1 for integers, otherwise range/100. */
  step?: number;
  precision?: number;
  /** Appended to the displayed value, e.g. "°" or " px". */
  unit?: string;
  /** Display multiplier (e.g. 100 to show a 0..1 fraction as a percentage). */
  scale?: number;
  integer?: boolean;
  /** Snap every committed value to the step grid (min + n * step), as the config.json clamping does. */
  snap?: boolean;
  /** Readout as (+value).toString(): no fixed decimals, no unit, trailing zeros dropped (2.5dwallpp style). */
  plain?: boolean;
  /** While dragging only the readout moves; the value is committed to the binding on release (the `change` event). */
  defer?: boolean;
  /** Factor slider with blue fill. */
  slider?: boolean;
  /** Label shown at the left inside the field. */
  label?: string;
  tip?: TipSpec;
}

export interface Widget<E extends HTMLElement = HTMLElement> {
  el: E;
  refresh(): void;
}

const DRAG_THRESHOLD = 3;

export function numberField(o: NumberOpts): Widget {
  const integer = o.integer ?? false;
  const range = o.max - o.min;
  const step = o.step ?? (integer ? 1 : range / 100);
  const scale = o.scale ?? 1;
  const precision = o.precision ?? (integer ? 0 : o.slider ? 3 : 2);
  const unit = o.unit ?? '';

  const fill = h('div', { class: 'pw-num-fill' });
  const label = h('span', { class: 'pw-num-label', text: o.label ?? '' });
  const value = h('span', { class: 'pw-num-value' });
  const spacer = h('span', { class: 'pw-num-spacer' });
  const left = h('span', { class: 'pw-num-arrow left' }, icon('arrowLeft', 10));
  const right = h('span', { class: 'pw-num-arrow right' }, icon('arrowRight', 10));
  const el = h(
    'div',
    { class: 'pw-num' + (o.slider ? ' slider' : '') + (o.label ? ' has-label' : ''), attrs: { tabindex: 0, role: 'spinbutton' } },
    o.slider ? fill : null,
    o.slider ? null : left,
    label,
    value,
    spacer,
    o.slider ? null : right,
  );
  tip(el, o.tip);

  const fmt = (v: number): string => (o.plain ? String(Number((v * scale).toFixed(6))) : (v * scale).toFixed(precision) + unit);

  /** Value shown while a deferred drag is in progress (not yet committed). */
  let live: number | null = null;

  const refresh = (): void => {
    const v = live ?? o.bind.get();
    value.textContent = fmt(v);
    fill.style.width = `${clamp(((v - o.min) / range) * 100, 0, 100)}%`;
    el.setAttribute('aria-valuenow', String(v));
  };

  const quantize = (v: number): number => {
    let r = clamp(v, o.min, o.max);
    if (o.snap) r = clamp(Number((Math.round((r - o.min) / step) * step + o.min).toFixed(6)), o.min, o.max);
    else if (integer) r = Math.round(r);
    else r = Math.round(r * 1e6) / 1e6;
    return r;
  };

  const commit = (v: number): void => {
    o.bind.set(quantize(v));
    refresh();
  };

  let editing = false;

  const startEdit = (): void => {
    if (editing) return;
    editing = true;
    const current = o.bind.get();
    const input = h('input', {
      class: 'pw-num-input',
      attrs: { type: 'text', spellcheck: 'false' },
    });
    input.value = String(Number((current * scale).toFixed(Math.max(precision, 3))));
    el.classList.add('editing');
    el.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (apply: boolean): void => {
      if (done) return;
      done = true;
      editing = false;
      if (apply) {
        const parsed = parseFloat(input.value.replace(',', '.'));
        if (Number.isFinite(parsed)) {
          o.bind.begin();
          commit(parsed / scale);
        }
      }
      input.remove();
      el.classList.remove('editing');
      refresh();
      el.focus({ preventScroll: true });
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
      else if (e.key === 'Tab') finish(true);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
  };

  const stepBy = (dir: 1 | -1, mult = 1): void => {
    o.bind.begin();
    commit(o.bind.get() + dir * step * mult);
  };

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || editing) return;
    const rect = el.getBoundingClientRect();
    const startX = e.clientX;
    let lastX = e.clientX;
    let acc = o.bind.get();
    let dragged = false;
    const clickedArrow: 'left' | 'right' | null =
      !o.slider && e.clientX - rect.left < 18 ? 'left' : !o.slider && rect.right - e.clientX < 18 ? 'right' : null;
    el.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent): void => {
      if (!dragged && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD) return;
      if (!dragged) {
        dragged = true;
        el.classList.add('dragging');
        o.bind.begin();
      }
      const dx = ev.clientX - lastX;
      lastX = ev.clientX;
      const width = Math.max(60, el.clientWidth);
      acc = clamp(acc + dx * (range / width) * (ev.shiftKey ? 0.1 : 1), o.min, o.max);
      const next = ev.ctrlKey || ev.metaKey ? Math.round(acc / step) * step : acc;
      if (o.defer) {
        live = quantize(next);
        refresh();
      } else commit(next);
    };
    const onUp = (ev: PointerEvent): void => {
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.classList.remove('dragging');
      if (dragged) {
        if (live !== null) {
          const v = live;
          live = null;
          o.bind.set(v);
          refresh();
        }
        return;
      }
      if (clickedArrow) stepBy(clickedArrow === 'left' ? -1 : 1, ev.shiftKey ? 0.1 : ev.ctrlKey ? 10 : 1);
      else startEdit();
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  });

  el.addEventListener('dblclick', () => startEdit());
  el.addEventListener('keydown', (e) => {
    if (editing) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stepBy(-1, e.shiftKey ? 0.1 : 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      stepBy(1, e.shiftKey ? 0.1 : 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      startEdit();
    }
  });

  o.bind.subscribe(refresh);
  refresh();
  return { el, refresh };
}
