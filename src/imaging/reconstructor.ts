/**
 * Cheap post-processing stage, as pure TypedArray code (runs inside `reconstruct.worker.ts`, or on the main
 * thread as a fallback).
 *
 * Work is split into independently cached stages so that dragging one slider only recomputes what it affects:
 *
 *   rawMask ─ binary(thresh, invert, dilate, islands) ─┬─ soft(feather) ─┬─ depth(depth settings) ─ bgDepth
 *                                                      │                 └─ foreground(edgeBleed)
 *                                                      └─ hole(padding, softness) ─ background
 */
import type { DepthSettings, ReconstructionSettings, SegmentationSettings } from '../core/types';
import { refineDepth } from './depthRefine';
import { applyAlpha, buildForegroundColors } from './foreground';
import { buildHole, inpaintBackground, inpaintDepth, type HoleInfo } from './inpaint';
import { refineBinaryMask, softenMask, type BinaryMask } from './maskRefine';
import { lumaOf } from './pixels';

export interface ReconstructInputs {
  width: number;
  height: number;
  /** Working-resolution RGBA. */
  source: Uint8ClampedArray;
  rawMask: Float32Array;
  rawDepth: Float32Array;
  /** False when no segmentation model produced `rawMask`. */
  hasSegmentation: boolean;
}

export interface ReconstructParams {
  segmentation: SegmentationSettings;
  depth: DepthSettings;
  reconstruction: ReconstructionSettings;
}

export interface ReconstructOutput {
  width: number;
  height: number;
  mask: Float32Array;
  depth: Float32Array;
  /** Depth with the foreground region filled from its surroundings (for the background layer). */
  backgroundDepth: Float32Array;
  /** RGBA, alpha 255. */
  background: Uint8ClampedArray;
  /** RGBA, alpha = mask. */
  foreground: Uint8ClampedArray;
  hasForeground: boolean;
  timings: Record<string, number>;
}

/** Below this foreground area fraction the mask is considered empty (segmentation found nothing). */
const MIN_COVERAGE = 0.001;
/** Above this fraction the "foreground" is basically the whole frame, so there is nothing to separate. */
const MAX_COVERAGE = 0.985;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class Reconstructor {
  private inputs: ReconstructInputs | null = null;
  private luma: Float32Array | null = null;
  private cache = new Map<string, { key: string; value: unknown }>();

  /** Installs new source data and drops every cached stage. */
  setInputs(inputs: ReconstructInputs): void {
    this.inputs = inputs;
    this.luma = lumaOf(inputs.source, inputs.width * inputs.height);
    this.cache.clear();
  }

  hasInputs(): boolean {
    return this.inputs !== null;
  }

  /** Returns a cached stage value, recomputing (and timing) it only when its key changed. */
  private stage<T>(name: string, key: string, timings: Record<string, number>, compute: () => T): T {
    const hit = this.cache.get(name);
    if (hit && hit.key === key) return hit.value as T;
    const t0 = now();
    const value = compute();
    timings[name] = Math.round((now() - t0) * 10) / 10;
    this.cache.set(name, { key, value });
    return value;
  }

  run(params: ReconstructParams): ReconstructOutput {
    const inp = this.inputs;
    const luma = this.luma;
    if (!inp || !luma) throw new Error('Reconstructor: inputs not set');
    const { width: w, height: h } = inp;
    const n = w * h;
    const seg = params.segmentation;
    const rec = params.reconstruction;
    const timings: Record<string, number> = {};
    const t0 = now();

    const segActive = seg.enabled && inp.hasSegmentation;
    const binKey = JSON.stringify([segActive, seg.threshold, seg.invert, seg.dilate, seg.minIslandArea]);

    const binary: BinaryMask | null = segActive
      ? this.stage('mask-binary', binKey, timings, () => refineBinaryMask(inp.rawMask, w, h, seg))
      : null;
    const hasForeground = !!binary && binary.coverage >= MIN_COVERAGE && binary.coverage <= MAX_COVERAGE;

    // Soft mask.
    const softKey = `${binKey}|${seg.feather}`;
    const mask = hasForeground
      ? this.stage('mask-soft', softKey, timings, () => softenMask(binary!.bin, luma, w, h, seg.feather))
      : new Float32Array(n);

    // Depth.
    const d = params.depth;
    const depthKey = `${softKey}|${hasForeground}|${[d.invert, d.contrast, d.gamma, d.smoothing, d.near, d.far].join(',')}`;
    const depth = this.stage('depth', depthKey, timings, () =>
      refineDepth(inp.rawDepth, hasForeground ? mask : null, luma, w, h, d),
    );

    // Background layer + its depth.
    let background: Uint8ClampedArray;
    let backgroundDepth: Float32Array;
    if (hasForeground && rec.inpaint) {
      const holeKey = `${binKey}|${rec.inpaintPadding}|${rec.inpaintSoftness}`;
      const hole = this.stage<HoleInfo>('hole', holeKey, timings, () =>
        buildHole(binary!.bin, w, h, rec.inpaintPadding, rec.inpaintSoftness),
      );
      background = this.stage('background', holeKey, timings, () =>
        inpaintBackground(inp.source, hole, w, h, rec.inpaintSoftness),
      );
      backgroundDepth = this.stage('background-depth', `${depthKey}|${holeKey}`, timings, () =>
        inpaintDepth(depth, hole, w, h),
      );
    } else {
      background = this.stage('background', 'plain', timings, () => opaqueCopy(inp.source));
      backgroundDepth = depth;
    }

    // Foreground layer.
    let foreground: Uint8ClampedArray;
    if (hasForeground) {
      const colors = this.stage('foreground-colors', `${binKey}|${rec.edgeBleed}`, timings, () =>
        buildForegroundColors(inp.source, binary!.bin, w, h, rec.edgeBleed),
      );
      foreground = this.stage('foreground', `${softKey}|${rec.edgeBleed}`, timings, () => applyAlpha(colors, mask));
    } else {
      foreground = this.stage('foreground', 'empty', timings, () => new Uint8ClampedArray(n * 4));
    }

    timings.total = Math.round((now() - t0) * 10) / 10;
    // Hand out copies: the caller transfers them, and the cached originals must stay intact.
    return {
      width: w,
      height: h,
      mask: mask.slice(),
      depth: depth.slice(),
      backgroundDepth: backgroundDepth.slice(),
      background: background.slice(),
      foreground: foreground.slice(),
      hasForeground,
      timings,
    };
  }
}

function opaqueCopy(src: Uint8ClampedArray): Uint8ClampedArray {
  const out = src.slice();
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return out;
}
