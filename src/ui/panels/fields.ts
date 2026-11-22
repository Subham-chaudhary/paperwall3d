/**
 * Generic field builder: turns a Settings path into a ready-made property row (label + bound widget), driven by
 * SCHEMA (label, description, range, step, unit, options, "re-runs the model" flag) and CATEGORIES (where the field
 * lives, and whether it currently has an effect).
 *
 * Every row is registered here: on each store change the rows get Blender's "inactive" look (dimmed, still
 * interactive) and an "Inactive: <reason>" tooltip line when `fieldState()` says the setting has no effect.
 */
import { CATEGORIES, fieldState, type SettingsCategory, type SettingsGroup } from '../../core/categories';
import { fieldSchema, type FieldSchema } from '../../core/schema';
import type { SettingsStore } from '../../core/store';
import type { Settings, SettingsPath } from '../../core/types';
import type { AppContext } from '../context';
import { h } from '../dom';
import { icon } from '../icons';
import { settingsBinding } from '../widgets/binding';
import { checkbox, colorField, enumField } from '../widgets/controls';
import { numberField, type Widget } from '../widgets/number';
import { tip, type TipSpec } from '../widgets/tooltip';

/** Fixed readout decimals from the field's step, so values do not jitter while dragging (0.002 -> 3, 0.01 -> 2, 1 -> 0). */
export const decimals = (step: number): number => (String(step).split('.')[1] ?? '').length;

/** Where a path lives in the Properties editor. */
export interface FieldLocation {
  category: SettingsCategory;
  group: SettingsGroup;
}

const LOCATIONS = new Map<SettingsPath, FieldLocation>();
for (const category of CATEGORIES) for (const group of category.groups) for (const p of group.fields) LOCATIONS.set(p, { category, group });

export function locate(path: SettingsPath): FieldLocation | undefined {
  return LOCATIONS.get(path);
}

/** Small badge marking settings that re-run an AI model when changed. */
export function modelBadge(): HTMLElement {
  const b = h('span', { class: 'pw-model-badge' }, icon('cpu', 10));
  tip(b, { title: 'Re-runs the model', desc: 'Changing this runs the AI model again (a few seconds). Other settings only re-split the cached model output or update the view.' });
  return b;
}

interface Registered {
  path: SettingsPath;
  el: HTMLElement;
  spec: TipSpec;
}

export class Fields {
  private readonly registered: Registered[] = [];

  constructor(readonly ctx: AppContext) {
    ctx.store.subscribe(() => this.syncInactive());
  }

  get store(): SettingsStore {
    return this.ctx.store;
  }

  schema(path: SettingsPath): FieldSchema {
    return fieldSchema(path);
  }

  /** Tooltip: "Category ▸ Label", the description, the section (advanced) and the config.json key. */
  tip(path: SettingsPath): TipSpec {
    const f = fieldSchema(path);
    const loc = locate(path);
    return {
      title: loc ? `${loc.category.title} ▸ ${f.label}` : f.label,
      desc: f.desc,
      section: loc && loc.group.tier === 'advanced' ? `Advanced · ${loc.group.title}` : undefined,
      extra: f.model ? 'Re-runs the model when changed' : undefined,
      path,
    };
  }

  /** The bare input widget for a path (number / checkbox / enum / colour). Points have their own row, see `row`. */
  widget(path: SettingsPath, spec: TipSpec = this.tip(path)): Widget {
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
          // mask / depth settings re-run the pipeline: commit on release, not while dragging
          defer: path.startsWith('mask.') || path.startsWith('depth.'),
          precision: decimals(f.step),
          slider: f.slider,
          tip: spec,
        });
      }
      case 'bool':
        return checkbox({ bind: settingsBinding<boolean>(this.store, path), label: f.label, tip: spec });
      case 'enum':
        return enumField<string | number>({
          bind: settingsBinding<string | number>(this.store, path),
          options: f.options,
          tip: spec,
        });
      case 'color':
        return colorField({ bind: settingsBinding<string>(this.store, path), tip: spec });
      default:
        throw new Error(`${path}: no generic widget (see the Pick object buttons)`);
    }
  }

  /** Property-split row: right-aligned label (with the model badge when relevant) and the widget. */
  row(path: SettingsPath, label?: string): HTMLElement {
    const f = fieldSchema(path);
    const spec = this.tip(path);
    const w = this.widget(path, spec);
    const text = f.kind === 'bool' ? '' : (label ?? f.label);
    const lab = h('div', { class: 'pw-prop-label' }, f.model ? modelBadge() : null, text);
    const el = h('div', { class: 'pw-prop', data: { path } }, lab, h('div', { class: 'pw-prop-field' }, w.el));
    this.registered.push({ path, el, spec });
    this.applyState({ path, el, spec });
    return el;
  }

  rows(...paths: SettingsPath[]): HTMLElement[] {
    return paths.map((p) => this.row(p));
  }

  /** The row element built for a path (undefined when the path has no row). */
  rowFor(path: SettingsPath): HTMLElement | undefined {
    return this.registered.find((r) => r.path === path)?.el;
  }

  /** Re-evaluate `fieldState` for every row (runs on each store change). */
  syncInactive(): void {
    for (const r of this.registered) this.applyState(r);
  }

  private applyState(r: Registered): void {
    const st = fieldState(r.path, this.store.get() as Settings);
    r.el.classList.toggle('inactive', !st.enabled);
    r.spec.inactive = st.enabled ? undefined : st.reason;
  }
}
