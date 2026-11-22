/**
 * Cheap post-processing stage, as pure TypedArray code (runs inside `reconstruct.worker.ts`, or on the main
 * thread as a fallback). Ports 2.5dwallpp's finish_depth / build_mask / object_depth / build_layers.
 *
 * Work is split into independently cached stages so that dragging one slider only recomputes what it affects:
 *
 *   rawDepth: clip(clip_lo, clip_hi) > smooth > snap+gamma > [invert] = depth > objDepth/fgDepth (needs rimGeometry)
 *   rawMask:  binary(thresh, norm, assist, blobs, click, fill, invert, grow) > feather = alpha
 *   alpha:    > rimGeometry(rim), > hole > bgColor, bgDepth(depth), > fg (defringe)
 *
 * The mask is found with the depth BEFORE depth_invert (as in the reference); only depth_assist reads it.
 */
import type { DepthSettings, MaskSettings } from '../core/types';
import { buildRimGeometry, clipDepth, invertDepth, objectDepth, smoothDepth, snapAndGamma, type RimGeometry } from './depthFinish';
import { buildForeground, buildHole, inpaintColor, inpaintDepth, prepareInpaintSource, type HoleInfo, type InpaintSource } from './layers';
import { buildBinaryMask, featherMask } from './mask';
import { lumaOf } from './pixels';

export interface ReconstructInputs {
  width: number;
  height: number;
  /** Working-resolution RGBA. */
  source: Uint8ClampedArray;
  /** Object probability 0..1 (zeros when no masker ran). */
  rawMask: Float32Array;
  /** Raw depth-model output, bigger = nearer, un-normalised. */
  rawDepth: Float32Array;
  /** False when no segmentation model produced `rawMask`. */
  hasSegmentation: boolean;
}

export interface ReconstructParams {
  mask: MaskSettings;
  depth: DepthSettings;
}

export interface ReconstructOutput {
  width: number;
  height: number;
  mask: Float32Array;
  depth: Float32Array;
  /** RGBA, alpha 255. */
  bgColor: Uint8ClampedArray;
  bgDepth: Float32Array;
  /** RGBA, alpha = mask. */
  fg: Uint8ClampedArray;
  fgDepth: Float32Array;
  objDepth: Float32Array;
  center: [number, number];
  coverage: number;
  hasForeground: boolean;
  timings: Record<string, number>;
}

/** Below this object area fraction the mask counts as empty (the masker found nothing). */
const MIN_COVERAGE = 0.001;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

interface MaskStats {
  coverage: number;
  center: [number, number];
}

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
    const m = params.mask;
    const d = params.depth;
    const timings: Record<string, number> = {};
    const t0 = now();

    // Whole-image depth.
    const clipHi = Math.max(d.clip_hi, d.clip_lo + 5); // same guard as the reference
    const clipKey = `${d.clip_lo}|${clipHi}`;
    const clipped = this.stage('depth-clip', clipKey, timings, () => clipDepth(inp.rawDepth, d.clip_lo, clipHi));
    const smoothKey = `${clipKey}|${d.smooth}`;
    const smoothed = this.stage('depth-smooth', smoothKey, timings, () => smoothDepth(clipped, w, h, d.smooth));
    const preKey = `${smoothKey}|${d.edge_snap}|${d.gamma}`;
    const depthPre = this.stage('depth-finish', preKey, timings, () => snapAndGamma(smoothed, luma, w, h, d.edge_snap, d.gamma));
    const depthKey = `${preKey}|${d.depth_invert}`;
    const depth = this.stage('depth', depthKey, timings, () => (d.depth_invert ? invertDepth(depthPre) : depthPre));

    // Object mask.
    const useSubject = m.use_subject && inp.hasSegmentation;
    let alpha: Float32Array;
    let alphaKey: string;
    if (useSubject) {
      const click = m.click ? `${m.click[0].toFixed(5)},${m.click[1].toFixed(5)}` : '-';
      const binKey = [
        m.mask_norm,
        m.thresh,
        m.depth_assist,
        m.min_area,
        m.largest_only,
        m.fill_holes,
        m.mask_invert,
        m.grow,
        click,
        m.depth_assist ? preKey : '',
      ].join('|');
      const bin = this.stage('mask-binary', binKey, timings, () =>
        buildBinaryMask(inp.rawMask, m.depth_assist ? depthPre : null, w, h, m),
      );
      alphaKey = `${binKey}|${m.feather}`;
      alpha = this.stage('mask', alphaKey, timings, () => featherMask(bin, w, h, m.feather));
    } else {
      alphaKey = 'off';
      alpha = this.stage('mask', alphaKey, timings, () => new Float32Array(n));
    }
    const stats = this.stage<MaskStats>('mask-stats', alphaKey, timings, () => maskStats(alpha, w, h));
    const hasForeground = useSubject && stats.coverage > MIN_COVERAGE;

    // Layers.
    let bgColor: Uint8ClampedArray;
    let bgDepth: Float32Array;
    let fg: Uint8ClampedArray;
    let fgDepth: Float32Array;
    let objDepth: Float32Array;
    if (hasForeground) {
      const geom = this.stage<RimGeometry | null>('rim-geometry', `${alphaKey}|${m.rim}`, timings, () =>
        buildRimGeometry(alpha, w, h, m.rim),
      );
      const obj = this.stage('object-depth', `${alphaKey}|${m.rim}|${depthKey}|${d.clip_lo}|${clipHi}`, timings, () =>
        objectDepth(depth, geom, d.clip_lo, clipHi),
      );
      fgDepth = obj.fgDepth;
      objDepth = obj.objDepth;

      const hole = this.stage<HoleInfo>('hole', alphaKey, timings, () => buildHole(alpha, w, h));
      const isrc = this.stage<InpaintSource>('inpaint-source', 'image', timings, () => prepareInpaintSource(inp.source, luma, w, h));
      bgColor = this.stage('bg-color', alphaKey, timings, () => inpaintColor(inp.source, isrc, hole));
      bgDepth = this.stage('bg-depth', `${alphaKey}|${depthKey}`, timings, () => inpaintDepth(depth, hole));
      const defringe = Math.min(m.rim, 3);
      fg = this.stage('fg', `${alphaKey}|${defringe}`, timings, () => buildForeground(inp.source, alpha, w, h, defringe));
    } else {
      bgColor = this.stage('bg-color', 'plain', timings, () => opaqueCopy(inp.source));
      bgDepth = depth;
      fg = this.stage('fg', 'empty', timings, () => new Uint8ClampedArray(n * 4));
      fgDepth = depth;
      objDepth = this.stage('object-depth', 'empty', timings, () => new Float32Array(n));
    }

    timings.total = Math.round((now() - t0) * 10) / 10;
    // Hand out copies: the caller transfers them, and the cached originals must stay intact.
    return {
      width: w,
      height: h,
      mask: alpha.slice(),
      depth: depth.slice(),
      bgColor: bgColor.slice(),
      bgDepth: bgDepth.slice(),
      fg: fg.slice(),
      fgDepth: fgDepth.slice(),
      objDepth: objDepth.slice(),
      center: stats.center,
      coverage: stats.coverage,
      hasForeground,
      timings,
    };
  }
}

function maskStats(alpha: Float32Array, w: number, h: number): MaskStats {
  let count = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x]! > 0.5) {
        count++;
        sx += x + 0.5;
        sy += y + 0.5;
      }
    }
  }
  return count
    ? { coverage: count / (w * h), center: [sx / count / w, sy / count / h] }
    : { coverage: 0, center: [0.5, 0.5] };
}

function opaqueCopy(src: Uint8ClampedArray): Uint8ClampedArray {
  const out = src.slice();
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return out;
}
