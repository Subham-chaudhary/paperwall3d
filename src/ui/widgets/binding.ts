/** Two-way bindings between widgets and a value source (usually a SettingsStore path). */
import type { PathValue, SettingsStore } from '../../core/store';
import type { SettingsPath } from '../../core/types';

export interface Binding<T> {
  get(): T;
  set(v: T): void;
  /** Called once at the start of a user gesture (records an undo checkpoint for settings). */
  begin(): void;
  /** Subscribe to external changes (undo/redo, other widgets). Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void;
}

/** Paths of Settings whose value type is assignable to T. */
export type PathsOf<T> = { [P in SettingsPath]: PathValue<P> extends T ? P : never }[SettingsPath];
export type NumPath = PathsOf<number>;
export type BoolPath = PathsOf<boolean>;
export type StrPath = PathsOf<string>;

/** Binding to a Settings path. The caller guarantees T matches the path's value type (see PathsOf). */
export function settingsBinding<T>(store: SettingsStore, path: SettingsPath): Binding<T> {
  return {
    get: () => store.getValue(path) as unknown as T,
    set: (v) => store.set(path, v as unknown as PathValue<SettingsPath>),
    begin: () => store.checkpoint(),
    subscribe: (fn) =>
      store.subscribe((_s, changed) => {
        if (changed.includes(path)) fn();
      }),
  };
}

/** Binding to arbitrary state (e.g. preferences) with no undo support. */
export function customBinding<T>(
  get: () => T,
  set: (v: T) => void,
  subscribe: (fn: () => void) => () => void = () => () => {},
): Binding<T> {
  return { get, set, begin: () => {}, subscribe };
}
