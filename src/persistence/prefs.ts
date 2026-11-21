/** localStorage-backed preferences. Every access is guarded: storage can be unavailable or full. */

const PREFIX = 'pw3d.';

export function getPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setPref<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable: preferences are a convenience only */
  }
}

export function removePref(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** Persisted area sizes and layout toggles. */
export interface LayoutPrefs {
  rightWidth: number;
  outlinerHeight: number;
  stripHeight: number;
  sidebarOpen: boolean;
  stripOpen: boolean;
}

export const DEFAULT_LAYOUT: LayoutPrefs = {
  rightWidth: 340,
  outlinerHeight: 230,
  stripHeight: 170,
  sidebarOpen: false,
  stripOpen: true,
};

export interface UserPrefs {
  showSplash: boolean;
  embedAssets: boolean;
  outputWidth: number;
  outputHeight: number;
}

export const DEFAULT_USER_PREFS: UserPrefs = {
  showSplash: true,
  embedAssets: false,
  outputWidth: 0,
  outputHeight: 0,
};
