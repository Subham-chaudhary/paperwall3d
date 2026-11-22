/**
 * The 2.5dwallpp-compatible config.json document: only the `shared` sections of SCHEMA (parallax, layers, mask,
 * depth, camera3d), nested, with `//` comments above every key generated from SCHEMA. Also the reverse:
 * applying a (nested or flat) parsed document onto settings with per-path problem reports.
 */
import { cloneSettings, DEFAULT_SETTINGS, mergeSettings } from '../core/defaults';
import { sanitizeSettings, SCHEMA, sharedKeys, type FieldSchema } from '../core/schema';
import type { Settings, SettingsPath, SettingsSection } from '../core/types';

type Rec = Record<string, unknown>;

export const SHARED_SECTIONS: SettingsSection[] = (Object.keys(SCHEMA) as SettingsSection[]).filter((s) => SCHEMA[s].shared);

const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const clean = (n: number): number => Number(n.toFixed(6));

/** Merge a raw settings document onto defaults and clamp it. Problems are returned, never thrown. */
export function loadSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): { settings: Settings; problems: string[] } {
  return sanitizeSettings(mergeSettings(raw, base));
}

/** The shared sections as plain nested data (what Download writes, and what 2.5dwallpp reads). */
export function snapshotShared(settings: Settings, useDefaults = false): Record<string, Rec> {
  const src = useDefaults ? DEFAULT_SETTINGS : settings;
  const out: Record<string, Rec> = {};
  for (const s of SHARED_SECTIONS) {
    const sec: Rec = {};
    for (const k of sharedKeys(s)) {
      const v = (src[s] as unknown as Rec)[k];
      sec[k] = typeof v === 'number' ? clean(v) : Array.isArray(v) ? [...v] : v;
    }
    out[s] = sec;
  }
  return out;
}

export function strictConfigJson(settings: Settings): string {
  return JSON.stringify(snapshotShared(settings), null, 2) + '\n';
}

const q = (v: unknown): string => JSON.stringify(v);

/** One-line constraint text for a field: range/step/options/default and the description. */
export function fieldComment(section: SettingsSection, key: string, f: FieldSchema): string {
  const def = (DEFAULT_SETTINGS[section] as unknown as Rec)[key];
  const note = f.desc.replace(/\.$/, '');
  const badge = f.model ? ' (re-runs the model)' : '';
  switch (f.kind) {
    case 'bool':
      return `${note}${badge}. true | false, default ${q(def)}`;
    case 'enum':
      return `${note}${badge}. One of: ${f.options.map((o) => `${q(o.value)} (${o.label})`).join(', ')}. Default ${q(def)}`;
    case 'point':
      return `${note}. null (automatic) or [x, y] with both between 0 and 1. Default null`;
    case 'color':
      return `${note}. A #rrggbb colour, default ${q(def)}`;
    default:
      return `${note}${badge}. Range ${clean(f.min)} to ${clean(f.max)}, step ${clean(f.step)}${f.unit ? ` (${f.unit})` : ''}, default ${q(def)}`;
  }
}

function wrap(text: string, indent: string, width = 100): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && (indent + '// ' + cur + ' ' + w).length > width) {
      lines.push(indent + '// ' + cur);
      cur = w;
    } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(indent + '// ' + cur);
  return lines;
}

/** The whole document as commented JSON. */
export function buildConfigText(settings: Settings): string {
  const snap = snapshotShared(settings);
  const lines: string[] = ['{'];
  SHARED_SECTIONS.forEach((s, si) => {
    lines.push(`  // ---- ${SCHEMA[s].label} ----`);
    lines.push(`  ${q(s)}: {`);
    const keys = sharedKeys(s);
    keys.forEach((k, i) => {
      lines.push(...wrap(fieldComment(s, k, SCHEMA[s].fields[k]!), '    '));
      lines.push(`    ${q(k)}: ${q((snap[s] as Rec)[k])}${i < keys.length - 1 ? ',' : ''}`);
      if (i < keys.length - 1) lines.push('');
    });
    lines.push(`  }${si < SHARED_SECTIONS.length - 1 ? ',' : ''}`);
    if (si < SHARED_SECTIONS.length - 1) lines.push('');
  });
  lines.push('}');
  return lines.join('\n') + '\n';
}

export interface ApplyResult {
  settings: Settings;
  /** Human-readable problems, each starting with the offending path (e.g. `mask.thresh: 5 → 0.95`). */
  problems: string[];
  /** Shared paths whose value differs from `current`. */
  changed: SettingsPath[];
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Validate a parsed config document (nested `{ mask: { thresh } }` or flat `{ thresh }` keys, like 2.5dwallpp)
 * and merge the valid values onto `current`. Out-of-range numbers are clamped by `sanitizeSettings`;
 * wrong types, unknown keys and bad enum values are reported and skipped (the current value stays).
 */
export function applyConfigObject(obj: unknown, current: Settings): ApplyResult {
  const problems: string[] = [];
  if (!isObj(obj)) {
    return { settings: cloneSettings(current), problems: ['the top level must be an { ... } object'], changed: [] };
  }

  const entries: [SettingsSection, string, unknown][] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (Object.hasOwn(SCHEMA, k)) {
      const sec = k as SettingsSection;
      if (!SCHEMA[sec].shared) {
        problems.push(`"${k}" is not part of config.json, ignored`);
        continue;
      }
      if (!isObj(v)) {
        problems.push(`"${k}" must be an { ... } object`);
        continue;
      }
      for (const [k2, v2] of Object.entries(v)) entries.push([sec, k2, v2]);
    } else {
      const owner = SHARED_SECTIONS.find((s) => Object.hasOwn(SCHEMA[s].fields, k));
      if (!owner) problems.push(`unknown key "${k}" ignored`);
      else entries.push([owner, k, v]);
    }
  }

  const partial: Record<string, Rec> = {};
  const supplied = new Set<string>();
  for (const [sec, key, v] of entries) {
    const path = `${sec}.${key}`;
    const f = SCHEMA[sec].fields[key];
    if (!f) {
      problems.push(`${path}: unknown key ignored`);
      continue;
    }
    let ok = true;
    switch (f.kind) {
      case 'bool':
        ok = typeof v === 'boolean';
        if (!ok) problems.push(`${path}: must be true or false`);
        break;
      case 'number':
        ok = typeof v === 'number' && Number.isFinite(v);
        if (!ok) problems.push(`${path}: must be a number`);
        break;
      case 'enum':
        ok = f.options.some((o) => o.value === v);
        if (!ok) problems.push(`${path}: must be one of ${f.options.map((o) => q(o.value)).join(', ')}`);
        break;
      case 'point':
        ok = v === null || (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && n >= 0 && n <= 1));
        if (!ok) problems.push(`${path}: must be null or [x, y] with both between 0 and 1`);
        break;
      case 'color':
        ok = typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
        if (!ok) problems.push(`${path}: must be a #rrggbb colour`);
        break;
    }
    if (!ok) continue;
    (partial[sec] ??= {})[key] = v;
    supplied.add(path);
  }

  const merged = mergeSettings(partial, current);
  const { settings, problems: sp } = sanitizeSettings(merged);
  for (const p of sp) if (supplied.has(p.split(':')[0] ?? '')) problems.push(p);

  const changed: SettingsPath[] = [];
  for (const s of SHARED_SECTIONS) {
    for (const k of Object.keys(SCHEMA[s].fields)) {
      if (!sameValue((settings[s] as unknown as Rec)[k], (current[s] as unknown as Rec)[k])) changed.push(`${s}.${k}` as SettingsPath);
    }
  }
  return { settings, problems, changed };
}
