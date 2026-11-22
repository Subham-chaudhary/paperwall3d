/**
 * Starting-point presets by image type, from the 2.5dwallpp author's workflow notes
 * (portrait tested; product / landscape / illustration are reasoned starting points).
 * A preset is a partial settings document applied on top of the current settings.
 */
import type { Settings } from './types';

type Partial2<T> = { [S in keyof T]?: Partial<T[S]> };
export type SettingsPatch = Partial2<Settings>;

export type PresetId = 'portrait' | 'product' | 'landscape' | 'illustration';

export interface Preset {
  id: PresetId;
  label: string;
  desc: string;
  patch: SettingsPatch;
}

export const PRESETS: Preset[] = [
  {
    id: 'portrait',
    label: 'Portrait',
    desc: 'A person or animal in front of a background',
    patch: {
      mask: { use_subject: true, rim: 4, feather: 2 },
      layers: { scope: 'subject', objectRelief: 0.65, backgroundDepth: 0.2 },
      parallax: { strength: 0.05, tilt: 5, lighting: 0.25, smoothing: 0.12 },
    },
  },
  {
    id: 'product',
    label: 'Product',
    desc: 'An object on a plain background',
    patch: {
      mask: { use_subject: true, feather: 2 },
      layers: { scope: 'subject', objectRelief: 0.8, backgroundDepth: 0.2 },
      parallax: { strength: 0.05, tilt: 5, lighting: 0.25 },
    },
  },
  {
    id: 'landscape',
    label: 'Landscape',
    desc: 'A scene with no single subject: depth everywhere, gentle motion',
    patch: {
      mask: { use_subject: false },
      layers: { scope: 'all' },
      depth: { smooth: 2 },
      parallax: { strength: 0.03, tilt: 4, lighting: 0.1 },
    },
  },
  {
    id: 'illustration',
    label: 'Illustration',
    desc: 'Stylised art: rely on the mask, keep relief low',
    patch: {
      mask: { use_subject: true },
      layers: { scope: 'subject', objectRelief: 0.4 },
      parallax: { strength: 0.04, tilt: 5, lighting: 0.15 },
    },
  },
];
