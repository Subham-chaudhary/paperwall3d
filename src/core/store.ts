import type { Settings, SettingsPath, SettingsSection } from './types';
import { cloneSettings, DEFAULT_SETTINGS } from './defaults';

export type PathValue<P extends SettingsPath> = P extends `${infer S}.${infer K}`
  ? S extends SettingsSection
    ? K extends keyof Settings[S]
      ? Settings[S][K]
      : never
    : never
  : never;

export type SettingsListener = (settings: Settings, changed: SettingsPath[]) => void;

type Rec = Record<string, unknown>;

function diff(a: Settings, b: Settings): SettingsPath[] {
  const changed: SettingsPath[] = [];
  for (const s of Object.keys(b) as SettingsSection[]) {
    for (const k of Object.keys(b[s])) {
      if ((a[s] as unknown as Rec)[k] !== (b[s] as unknown as Rec)[k]) changed.push(`${s}.${k}` as SettingsPath);
    }
  }
  return changed;
}

/**
 * Tiny observable settings store. Listeners are notified once per microtask with the
 * list of paths that changed, so bursts of slider updates coalesce.
 */
export class SettingsStore {
  private state: Settings;
  private listeners = new Set<SettingsListener>();
  private pending = new Set<SettingsPath>();
  private scheduled = false;
  private undoStack: Settings[] = [];
  private redoStack: Settings[] = [];

  constructor(initial: Settings = DEFAULT_SETTINGS) {
    this.state = cloneSettings(initial);
  }

  get(): Readonly<Settings> {
    return this.state;
  }

  getValue<P extends SettingsPath>(path: P): PathValue<P> {
    const [s, k] = path.split('.') as [SettingsSection, string];
    return (this.state[s] as unknown as Rec)[k] as PathValue<P>;
  }

  set<P extends SettingsPath>(path: P, value: PathValue<P>): void {
    const [s, k] = path.split('.') as [SettingsSection, string];
    const section = this.state[s] as unknown as Rec;
    if (section[k] === value) return;
    section[k] = value;
    this.queue([path]);
  }

  /** Replace everything (e.g. loading a config). Records an undo step. */
  replace(next: Settings): void {
    this.checkpoint();
    this.swap(cloneSettings(next));
  }

  /** Snapshot current state onto the undo stack (call at the start of a user gesture). */
  checkpoint(): void {
    this.undoStack.push(cloneSettings(this.state));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(cloneSettings(this.state));
    this.swap(prev);
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(cloneSettings(this.state));
    this.swap(next);
    return true;
  }

  subscribe(fn: SettingsListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private swap(next: Settings): void {
    const changed = diff(this.state, next);
    this.state = next;
    this.queue(changed);
  }

  private queue(paths: SettingsPath[]): void {
    if (!paths.length) return;
    paths.forEach((p) => this.pending.add(p));
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      const changed = [...this.pending];
      this.pending.clear();
      for (const fn of this.listeners) fn(this.state, changed);
    });
  }
}

export type Invalidation = 'analyze' | 'reconstruct' | 'render' | 'none';

/** Settings that change a model's raw output (2.5dwallpp: mask key = model|flip|refine, depth key = input size). */
const ANALYZE_PATHS = new Set<SettingsPath>([
  'mask.use_subject',
  'mask.mask_model',
  'mask.flip_avg',
  'mask.refine',
  'depth.model',
  'depth.depth_size',
  'runtime.backend',
  'runtime.workingResolution',
]);

/**
 * Which pipeline stage a settings change invalidates:
 * model keys → 'analyze'; other mask/depth keys → 'reconstruct' (re-split, no model run);
 * parallax/layers/camera3d/view/wallpaper → 'render' (instant, GPU only).
 */
export function invalidation(changed: SettingsPath[]): Invalidation {
  const rank: Record<Invalidation, number> = { none: 0, render: 1, reconstruct: 2, analyze: 3 };
  let level: Invalidation = 'none';
  for (const p of changed) {
    let l: Invalidation = 'render';
    if (ANALYZE_PATHS.has(p)) l = 'analyze';
    else if (p.startsWith('mask.') || p.startsWith('depth.')) l = 'reconstruct';
    if (rank[l] > rank[level]) level = l;
  }
  return level;
}
