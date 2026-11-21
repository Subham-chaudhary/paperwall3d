/** Import/export of reusable wallpaper configuration files (*.pw3d.json). */
import { APP_VERSION, CONFIG_SCHEMA_VERSION } from '../core/version';
import { mergeSettings } from '../core/defaults';
import type { PreparedScene, RawAnalysis, Settings, SourceImage, WallpaperConfig } from '../core/types';

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

/** Encode a 0..1 float map as an 8-bit grayscale PNG data URL. */
export function mapToPngDataUrl(map: Float32Array, w: number, h: number): string {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(0, Math.min(255, Math.round((map[i] ?? 0) * 255)));
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

export function imageDataToPngDataUrl(img: ImageData): string {
  const c = makeCanvas(img.width, img.height);
  c.getContext('2d')?.putImageData(img, 0, 0);
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
  scene: PreparedScene | null;
  embedAssets: boolean;
}

/**
 * Build a config. Embedded mask/depth are the RAW model outputs (not the refined maps),
 * so re-importing reproduces the exact result without re-running AI inference.
 */
export async function buildConfig(input: BuildConfigInput): Promise<WallpaperConfig> {
  const cfg: WallpaperConfig = {
    format: 'paperwall3d',
    version: CONFIG_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    name: input.name,
    settings: structuredClone(input.settings) as Settings,
  };
  if (input.embedAssets && input.source) {
    const assets: NonNullable<WallpaperConfig['assets']> = {};
    assets.source = await blobToDataUrl(input.source.blob);
    if (input.raw) {
      assets.mask = mapToPngDataUrl(input.raw.rawMask, input.raw.width, input.raw.height);
      assets.depth = mapToPngDataUrl(input.raw.rawDepth, input.raw.width, input.raw.height);
    }
    if (input.scene && input.scene.hasForeground) assets.background = imageDataToPngDataUrl(input.scene.background);
    cfg.assets = assets;
  }
  return cfg;
}

export interface ParsedConfig {
  name: string;
  settings: Settings;
  assets: NonNullable<WallpaperConfig['assets']>;
  /** True when the file was written by a newer schema version than this app understands. */
  newer: boolean;
}

/** Parse and validate a config file's text. Throws a user-presentable Error when invalid. */
export function parseConfig(text: string): ParsedConfig {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('Not a valid JSON file');
  }
  if (!obj || typeof obj !== 'object' || (obj as { format?: unknown }).format !== 'paperwall3d') {
    throw new Error('Not a PaperWall3D wallpaper config (missing format "paperwall3d")');
  }
  const o = obj as Partial<WallpaperConfig>;
  const version = typeof o.version === 'number' ? o.version : 1;
  const assets: ParsedConfig['assets'] = {};
  if (o.assets && typeof o.assets === 'object') {
    for (const k of ['source', 'mask', 'depth', 'background'] as const) {
      const v = o.assets[k];
      if (typeof v === 'string' && v.startsWith('data:')) assets[k] = v;
    }
  }
  return {
    name: typeof o.name === 'string' && o.name ? o.name : 'Imported Wallpaper',
    settings: mergeSettings(o.settings),
    assets,
    newer: version > CONFIG_SCHEMA_VERSION,
  };
}
