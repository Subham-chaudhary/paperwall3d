/**
 * Output (colour-layer) resolution policy: the uploaded picture's own size, capped at 4K, never upscaled.
 */
import type { OutputResolution } from './types';

/** 4K UHD long edge. */
export const MAX_OUTPUT_LONG_EDGE = 3840;
/** 'auto' cap on low-memory / small touch devices. */
export const LOW_MEMORY_LONG_EDGE = 2560;

/** True on devices where 4K colour layers (~3 × 40 MB in RAM + VRAM) are risky. */
export function isLowMemoryDevice(): boolean {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : undefined;
  if (nav?.deviceMemory !== undefined && nav.deviceMemory <= 4) return true;
  if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && Math.max(screen.width, screen.height) <= 1366) return true;
  return false;
}

/**
 * Long edge (px) of the colour layers for a picture whose long edge is `sourceLongEdge`.
 * Never above the source (no upscaling), never below the processing resolution, and capped by the setting,
 * by 4K, by the low-memory cap (auto only) and by `maxTextureSize` when given.
 */
export function resolveOutputLongEdge(
  setting: OutputResolution,
  sourceLongEdge: number,
  processingLongEdge: number,
  maxTextureSize = Infinity,
): number {
  let cap = setting === 'auto' ? (isLowMemoryDevice() ? LOW_MEMORY_LONG_EDGE : MAX_OUTPUT_LONG_EDGE) : setting;
  cap = Math.min(cap, MAX_OUTPUT_LONG_EDGE, maxTextureSize);
  const out = Math.min(sourceLongEdge, cap);
  return Math.max(Math.min(processingLongEdge, sourceLongEdge), Math.round(out));
}
