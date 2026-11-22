/**
 * Import/export of reusable wallpaper configuration files.
 *  - `*.pw3d.json`: format "paperwall3d", version 2 (settings are 2.5dwallpp-compatible). Version 1 files are still read.
 *  - bare 2.5dwallpp `config.json` (nested or flat keys, `//` comments and trailing commas allowed).
 */
import { APP_VERSION, CONFIG_SCHEMA_VERSION } from '../core/version';
import { cloneSettings, DEFAULT_SETTINGS } from '../core/defaults';
import { SCHEMA } from '../core/schema';
import type { RawAnalysis, Settings, SourceImage, WallpaperConfig } from '../core/types';
import { applyConfigObject, loadSettings, SHARED_SECTIONS } from './configJson';
import { formatJsoncError, parseJsonc } from './jsonc';

/** Schema version written into `.pw3d.json` files. */
export const PW3D_CONFIG_VERSION = CONFIG_SCHEMA_VERSION;

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error ?? new Error('Failed to read blob'));
    fr.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  return res.blob();
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Encode a float map as an 8-bit grayscale PNG data URL. With `normalize` the map is min-max scaled to 0..1 first. */
export function mapToPngDataUrl(map: Float32Array, w: number, h: number, normalize = false): string {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  let lo = 0;
  let span = 1;
  if (normalize) {
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 0; i < w * h; i++) {
      const v = map[i] ?? 0;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (Number.isFinite(mn) && mx > mn) {
      lo = mn;
      span = mx - mn;
    }
  }
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(0, Math.min(255, Math.round((((map[i] ?? 0) - lo) / span) * 255)));
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/** Decode a grayscale PNG data URL back into a 0..1 float map. */
export async function pngDataUrlToMap(url: string): Promise<{ data: Float32Array; width: number; height: number }> {
  const blob = await dataUrlToBlob(url);
  const bmp = await createImageBitmap(blob);
  const c = makeCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const data = new Float32Array(c.width * c.height);
  for (let i = 0; i < data.length; i++) data[i] = (px[i * 4] ?? 0) / 255;
  return { data, width: c.width, height: c.height };
}

export interface BuildConfigInput {
  name: string;
  settings: Settings;
  source: SourceImage | null;
  raw: RawAnalysis | null;
  embedAssets: boolean;
}

/**
 * Build a `.pw3d.json`. Embedded mask/depth are the RAW model outputs (the depth min-max scaled to 8 bit: the
 * percentile clipping in reconstruct is affine-invariant), so re-importing reproduces the result without a model run.
 */
export async function buildConfig(input: BuildConfigInput): Promise<WallpaperConfig> {
  const cfg: WallpaperConfig = {
    format: 'paperwall3d',
    version: PW3D_CONFIG_VERSION,
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    name: input.name,
    settings: cloneSettings(input.settings),
  };
  if (input.embedAssets && input.source) {
    const assets: NonNullable<WallpaperConfig['assets']> = {};
    assets.source = await blobToDataUrl(input.source.blob);
    if (input.raw) {
      assets.mask = mapToPngDataUrl(input.raw.rawMask, input.raw.width, input.raw.height);
      assets.depth = mapToPngDataUrl(input.raw.rawDepth, input.raw.width, input.raw.height, true);
    }
    cfg.assets = assets;
  }
  return cfg;
}

export interface ParsedConfig {
  /** `pw3d`: a PaperWall3D file (replaces all settings). `config`: a bare 2.5dwallpp config.json (merged onto the current settings). */
  kind: 'pw3d' | 'config';
  name: string;
  settings: Settings;
  assets: NonNullable<WallpaperConfig['assets']>;
  /** Clamping / skipped-key problems by path. */
  problems: string[];
  /** True when the file was written by a newer schema version than this app understands. */
  newer: boolean;
  /** True for a v1 file: settings were migrated and embedded mask/depth maps are ignored (old depth semantics). */
  legacy: boolean;
}

/** v1 (segmentation/reconstruction/geometry/...) → the few settings that still exist in v2. */
function migrateV1(s: unknown): Rec {
  if (!isObj(s)) return {};
  const seg = isObj(s.segmentation) ? s.segmentation : {};
  const depth = isObj(s.depth) ? s.depth : {};
  const view = isObj(s.view) ? s.view : {};
  return {
    mask: {
      use_subject: seg.enabled,
      mask_model: seg.model,
      thresh: seg.threshold,
      feather: seg.feather,
      grow: seg.dilate,
      mask_invert: seg.invert,
    },
    depth: { model: depth.model, gamma: depth.gamma, depth_invert: depth.invert },
    runtime: s.runtime,
    view: { background: view.background, showStats: view.showStats },
  };
}

/** Parse and validate a config file's text. Throws a user-presentable Error when invalid. */
export function parseConfig(text: string, current: Settings = DEFAULT_SETTINGS): ParsedConfig {
  const r = parseJsonc(text);
  if (!r.ok) throw new Error(`Not a valid JSON file (${formatJsoncError(r.error)})`);
  const obj = r.value;
  if (!isObj(obj)) throw new Error('Not a config file: the top level must be a { ... } object');

  if (obj.format === 'paperwall3d') {
    const version = typeof obj.version === 'number' ? obj.version : 1;
    const legacy = version < 2;
    const assets: ParsedConfig['assets'] = {};
    if (isObj(obj.assets)) {
      const keys = legacy ? (['source'] as const) : (['source', 'mask', 'depth'] as const);
      for (const k of keys) {
        const v = obj.assets[k];
        if (typeof v === 'string' && v.startsWith('data:')) assets[k] = v;
      }
    }
    const { settings, problems } = loadSettings(legacy ? migrateV1(obj.settings) : obj.settings);
    return {
      kind: 'pw3d',
      name: typeof obj.name === 'string' && obj.name ? obj.name : 'Imported Wallpaper',
      settings,
      assets,
      problems: legacy ? [] : problems,
      newer: version > PW3D_CONFIG_VERSION,
      legacy,
    };
  }

  // Bare config.json: needs at least one recognisable key.
  const known = Object.keys(obj).some(
    (k) => (Object.hasOwn(SCHEMA, k) && SCHEMA[k as keyof typeof SCHEMA].shared) || SHARED_SECTIONS.some((s) => Object.hasOwn(SCHEMA[s].fields, k)),
  );
  if (!known) throw new Error('Not a PaperWall3D wallpaper config or a 2.5dwallpp config.json (no known settings found)');
  const res = applyConfigObject(obj, current);
  return { kind: 'config', name: 'config.json', settings: res.settings, assets: {}, problems: res.problems, newer: false, legacy: false };
}
