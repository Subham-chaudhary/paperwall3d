/** Factory that turns a Settings path into a ready-made property row (label + bound widget). */
import type { SettingsStore } from '../../core/store';
import type { SettingsPath } from '../../core/types';
import { checkbox, colorField, enumField, segmented, type EnumOption } from '../widgets/controls';
import { settingsBinding, type BoolPath, type NumPath, type StrPath } from '../widgets/binding';
import { propRow } from '../widgets/layout';
import { numberField, type Widget } from '../widgets/number';
import type { TipSpec } from '../widgets/tooltip';

export interface NumSpec {
  min: number;
  max: number;
  step?: number;
  precision?: number;
  unit?: string;
  scale?: number;
  integer?: boolean;
  slider?: boolean;
  desc: string;
}

export class Fields {
  constructor(readonly store: SettingsStore) {}

  tip(path: SettingsPath, desc: string): TipSpec {
    return { desc, path };
  }

  /** Bare number widget (optionally with an in-field label), not wrapped in a row. */
  numWidget(path: NumPath, spec: NumSpec, label?: string): Widget {
    return numberField({
      bind: settingsBinding<number>(this.store, path),
      min: spec.min,
      max: spec.max,
      step: spec.step,
      precision: spec.precision,
      unit: spec.unit,
      scale: spec.scale,
      integer: spec.integer,
      slider: spec.slider,
      label,
      tip: this.tip(path, spec.desc),
    });
  }

  /** Property-split row with a number field / slider. */
  num(path: NumPath, label: string, spec: NumSpec): HTMLElement {
    return propRow(label, this.numWidget(path, spec).el);
  }

  check(path: BoolPath, label: string, desc: string): HTMLElement {
    return propRow(null, checkbox({ bind: settingsBinding<boolean>(this.store, path), label, tip: this.tip(path, desc) }).el);
  }

  /** Checkbox without a row wrapper (for panel headers). */
  checkWidget(path: BoolPath, label: string, desc: string): Widget {
    return checkbox({ bind: settingsBinding<boolean>(this.store, path), label, tip: this.tip(path, desc) });
  }

  enum<T extends string | number>(
    path: StrPath | NumPath,
    label: string,
    options: readonly EnumOption<T>[],
    desc: string,
  ): HTMLElement {
    return propRow(label, enumField({ bind: settingsBinding<T>(this.store, path), options, tip: this.tip(path, desc) }).el);
  }

  seg<T extends string | number>(
    path: StrPath | NumPath,
    label: string | null,
    options: readonly EnumOption<T>[],
    desc: string,
  ): HTMLElement {
    return propRow(label, segmented({ bind: settingsBinding<T>(this.store, path), options, tip: this.tip(path, desc) }).el);
  }

  color(path: StrPath, label: string, desc: string): HTMLElement {
    return propRow(label, colorField({ bind: settingsBinding<string>(this.store, path), tip: this.tip(path, desc) }).el);
  }

  boolBinding(path: BoolPath) {
    return settingsBinding<boolean>(this.store, path);
  }
}
