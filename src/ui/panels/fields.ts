/**
 * Generic field builder: turns a Settings path into a ready-made property row (label + bound widget), driven by
 * SCHEMA (label, description, range, step, unit, options, "re-runs the model" flag).
 */
import { fieldSchema, type FieldSchema } from '../../core/schema';
import type { SettingsStore } from '../../core/store';
import type { SettingsPath } from '../../core/types';
import type { AppContext } from '../context';
import { h } from '../dom';
import { icon } from '../icons';
import { settingsBinding } from '../widgets/binding';
import { checkbox, colorField, enumField } from '../widgets/controls';
import { numberField, type Widget } from '../widgets/number';
import { tip, type TipSpec } from '../widgets/tooltip';

const decimals = (step: number): number => (String(step).split('.')[1] ?? '').length;

/** Small badge marking settings that re-run an AI model when changed. */
export function modelBadge(): HTMLElement {
  const b = h('span', { class: 'pw-model-badge' }, icon('cpu', 10));
  tip(b, { title: 'Re-runs the model', desc: 'Changing this runs the AI model again (a few seconds). Other settings only re-split the cached model output or update the view.' });
  return b;
}

export class Fields {
  constructor(readonly ctx: AppContext) {}

  get store(): SettingsStore {
    return this.ctx.store;
  }

  schema(path: SettingsPath): FieldSchema {
    return fieldSchema(path);
  }

  tip(path: SettingsPath): TipSpec {
    const f = fieldSchema(path);
    return { title: f.label, desc: f.desc, extra: f.model ? 'Re-runs the model when changed' : undefined, path };
  }

  /** The bare input widget for a path (number / checkbox / enum / colour). Points have their own row, see `row`. */
  widget(path: SettingsPath): Widget {
    const f = fieldSchema(path);
    switch (f.kind) {
      case 'number': {
        const integer = f.step % 1 === 0 && f.min % 1 === 0;
        return numberField({
          bind: settingsBinding<number>(this.store, path),
          min: f.min,
          max: f.max,
          step: f.step,
          integer,
          snap: true,
          plain: true,
          // mask / depth settings re-run the pipeline: commit on release, not while dragging
          defer: path.startsWith('mask.') || path.startsWith('depth.'),
          precision: decimals(f.step),
          slider: f.slider,
          tip: this.tip(path),
        });
      }
      case 'bool':
        return checkbox({ bind: settingsBinding<boolean>(this.store, path), label: f.label, tip: this.tip(path) });
      case 'enum':
        return enumField<string | number>({
          bind: settingsBinding<string | number>(this.store, path),
          options: f.options,
          tip: this.tip(path),
        });
      case 'color':
        return colorField({ bind: settingsBinding<string>(this.store, path), tip: this.tip(path) });
      default:
        throw new Error(`${path}: no generic widget (see the Pick object buttons)`);
    }
  }

  /** Property-split row: right-aligned label (with the model badge when relevant) and the widget. */
  row(path: SettingsPath, label?: string): HTMLElement {
    const f = fieldSchema(path);
    const w = this.widget(path);
    const text = f.kind === 'bool' ? '' : (label ?? f.label);
    const lab = h('div', { class: 'pw-prop-label' }, f.model ? modelBadge() : null, text);
    return h('div', { class: 'pw-prop' }, lab, h('div', { class: 'pw-prop-field' }, w.el));
  }

  rows(...paths: SettingsPath[]): HTMLElement[] {
    return paths.map((p) => this.row(p));
  }
}
