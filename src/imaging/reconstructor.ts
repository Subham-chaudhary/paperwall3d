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
 *
 * Colour layers: when the output (HD) size exceeds the processing size, bgColor/fg are built at HD size from the HD
 * source by `hd.ts` (guided alpha upsampling, HD defringe, hole fill composited into HD). Depth-only changes never
 * touch them: the caller passes the key of the colour layers it already holds and gets `colorKind: 'known'`.
 */
import type { DepthSettings, MaskSettings } from '../core/types';
import { buildRimGeometry, clipDepth, invertDepth, objectDepth, smoothDepth, snapAndGamma, type RimGeometry } from './depthFinish';
import {
  buildAlphaGuide,
  buildForegroundHd,
  estimateGrainHd,
  GATE_RADIUS,
  HD_BOX_PAD,
  inpaintColorHd,
  upsampleAlpha,
  type AlphaGuide,
} from './hd';
import {
  buildDefringe,
  buildForeground,
  buildHole,
  inpaintColor,
  inpaintDepth,
  prepareInpaintSource,
  type Defringe,
  type HoleInfo,
  type InpaintSource,
} from './layers';
import { buildBinaryMask, featherMask } from './mask';
import { lumaOf } from './pixels';
import { pushPullFill } from './pushpull';

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
  /** Output-resolution RGBA when it is larger than the processing size; omitted/null when the same size. */
  hd?: Uint8ClampedArray | null;
  hdWidth?: number;
  hdHeight?: number;
}

export interface ReconstructParams {
  mask: MaskSettings;
  depth: DepthSettings;
  /** Key of the colour layers the caller already holds; they are not rebuilt or re-sent while it still matches. */
  knownColorKey?: string | null;
}

/**
 * `data`: `bgColor`/`fg` are new buffers (colorWidth x colorHeight, owned by the caller, safe to transfer).
 * `known`: unchanged since `knownColorKey`; both are null. `plain`: no object, so the background is the source itself
 * and the foreground is an empty 1x1; both are null.
 */
export type ColorKind = 'data' | 'known' | 'plain';

export interface ReconstructOutput {
  /** Size of the maps (processing resolution). */
  width: number;
  height: number;
  /** Size of the colour layers (output resolution). */
  colorWidth: number;
  colorHeight: number;
  mask: Float32Array;
  depth: Float32Array;
  colorKind: ColorKind;
  /** Identifies the colour layers' content; send it back as `knownColorKey`. */
  colorKey: string;
  /** RGBA, alpha 255. Null unless colorKind is 'data'. */
  bgColor: Uint8ClampedArray | null;
  bgDepth: Float32Array;
  /** RGBA, alpha = mask. Null unless colorKind is 'data'. */
  fg: Uint8ClampedArray | null;
  fgDepth: Float32Array;
  objDepth: Float32Array;
  center: [number, number];
  coverage: number;
  hasForeground: boolean;
  timings: Record<string, number>;
}

/** Below this object area fraction the mask counts as empty (the masker found nothing). */
const MIN_COVERAGE = 0.001;

/** Unique per installed HD image, across instances (so a worker -> inline fallback never repeats a key). */
let nextHdId = 1;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

interface MaskStats {
  coverage: number;
  center: [number, number];
}

interface HdImage {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

export class Reconstructor {
  private inputs: ReconstructInputs | null = null;
  private luma: Float32Array | null = null;
  private cache = new Map<string, { key: string; value: unknown }>();
  private hd: HdImage | null = null;
  private hdId = 0;

  /** Installs new source data and drops every cached stage. */
  setInputs(inputs: ReconstructInputs): void {
    this.inputs = inputs;
    this.luma = lumaOf(inputs.source, inputs.width * inputs.height);
    this.cache.clear();
    this.installHd(inputs.hd ?? null, inputs.hdWidth ?? 0, inputs.hdHeight ?? 0);
  }

  /**
   * Replaces only the output-resolution pixels. The processing pixels, raw maps and every map stage stay valid, so a
   * change of output resolution costs one HD finalisation and nothing else.
   */
  setHd(hd: Uint8ClampedArray | null, width: number, height: number): void {
    if (!this.inputs) throw new Error('Reconstructor: inputs not set');
    this.installHd(hd, width, height);
  }

  private installHd(data: Uint8ClampedArray | null, w: number, h: number): void {
    const inp = this.inputs!;
    this.hd = data && (w !== inp.width || h !== inp.height) ? { data, w, h } : null;
    this.hdId = nextHdId++;
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
    const colorWidth = this.hd?.w ?? w;
    const colorHeight = this.hd?.h ?? h;
    let colorKind: ColorKind = 'plain';
    let colorKey = 'plain';
    let bgColor: Uint8ClampedArray | null = null;
    let fg: Uint8ClampedArray | null = null;
    let bgDepth: Float32Array;
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
      bgDepth = this.stage('bg-depth', `${alphaKey}|${depthKey}`, timings, () => inpaintDepth(depth, hole));
      const defringe = Math.min(m.rim, 3);
      colorKey = `${this.hdId}|${colorWidth}x${colorHeight}|${alphaKey}|${defringe}`;
      if (params.knownColorKey === colorKey) {
        colorKind = 'known';
      } else {
        colorKind = 'data';
        const isrc = this.stage<InpaintSource>('inpaint-source', 'image', timings, () => prepareInpaintSource(inp.source, luma, w, h));
        if (this.hd) {
          const t1 = now();
          const colors = this.buildHdColors(this.hd, alpha, alphaKey, defringe, hole, isrc, timings);
          bgColor = colors.bg;
          fg = colors.fg;
          timings.hd = Math.round((now() - t1) * 10) / 10;
        } else {
          // Same size as the processing resolution: the 2.1.x path, stage-cached. Copies, since the caller owns them.
          bgColor = this.stage('bg-color', alphaKey, timings, () => inpaintColor(inp.source, isrc, hole)).slice();
          fg = this.stage('fg', `${alphaKey}|${defringe}`, timings, () => buildForeground(inp.source, alpha, w, h, defringe)).slice();
        }
      }
    } else {
      bgDepth = depth;
      fgDepth = depth;
      objDepth = this.stage('object-depth', 'empty', timings, () => new Float32Array(n));
    }

    timings.total = Math.round((now() - t0) * 10) / 10;
    // Hand out copies: the caller transfers them, and the cached originals must stay intact.
    return {
      width: w,
      height: h,
      colorWidth,
      colorHeight,
      mask: alpha.slice(),
      depth: depth.slice(),
      colorKind,
      colorKey,
      bgColor,
      bgDepth: bgDepth.slice(),
      fg,
      fgDepth: fgDepth.slice(),
      objDepth: objDepth.slice(),
      center: stats.center,
      coverage: stats.coverage,
      hasForeground,
      timings,
    };
  }

  /**
   * HD finalisation. The processing-size parts (guided-filter coefficients, defringe geometry, hole fill) are cached
   * per mask; the HD pixel passes run every time and produce fresh buffers, which are never retained (40 MB each at 4K).
   */
  private buildHdColors(
    hd: HdImage,
    alpha: Float32Array,
    alphaKey: string,
    defringe: number,
    hole: HoleInfo,
    isrc: InpaintSource,
    timings: Record<string, number>,
  ): { bg: Uint8ClampedArray; fg: Uint8ClampedArray } {
    const inp = this.inputs!;
    const luma = this.luma!;
    const { width: w, height: h } = inp;
    const guide = this.stage<AlphaGuide | null>('hd-guide', alphaKey, timings, () => buildAlphaGuide(alpha, luma, w, h));
    const def = this.stage<Defringe | null>('hd-defringe', `${alphaKey}|${defringe}`, timings, () =>
      buildDefringe(alpha, w, h, defringe, HD_BOX_PAD),
    );
    const fill = this.stage<Float32Array | null>('hd-fill', alphaKey, timings, () =>
      hole.box && hole.hasValid ? pushPullFill(isrc.rgbSmall, hole.validSmall, hole.sw, hole.sh, 3) : null,
    );
    const grain = this.stage('hd-grain', `${this.hdId}`, timings, () => estimateGrainHd(hd.data, hd.w, hd.h));

    const t0 = now();
    const ext = defringe + GATE_RADIUS + 2;
    let fg: Uint8ClampedArray;
    if (guide) {
      const up = upsampleAlpha(guide, hd.data, hd.w, hd.h, w, h);
      timings['hd-alpha'] = Math.round((now() - t0) * 10) / 10;
      fg = buildForegroundHd(hd.data, hd.w, hd.h, up.alpha, up.box, w, h, def, ext * ext);
    } else {
      fg = new Uint8ClampedArray(hd.data.length);
    }
    const t1 = now();
    timings['hd-fg'] = Math.round((t1 - t0) * 10) / 10;
    const bg = fill ? inpaintColorHd(hd.data, hd.w, hd.h, fill, hole, grain) : new Uint8ClampedArray(hd.data);
    timings['hd-bg'] = Math.round((now() - t1) * 10) / 10;
    return { bg, fg };
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
