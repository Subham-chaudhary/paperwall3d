/**
 * Main-thread handle to the reconstruct worker.
 *
 * - Source/raw data is shipped to the worker once per (source, raw) pair; later calls only send settings.
 * - Requests are serialised. A request that is still queued when a newer one for the same inputs arrives is
 *   coalesced: both promises resolve with the newest result, so rapid slider drags don't pile up.
 * - If workers are unavailable the same code runs inline on the main thread.
 */
import type { PreparedScene, RawAnalysis, Settings, SourceImage } from '../core/types';
import { getImageAlpha } from './imageLoader';
import type { ReconstructRequest, ReconstructResponse } from '../imaging/reconstruct.protocol';
import { Reconstructor, type ReconstructOutput, type ReconstructParams } from '../imaging/reconstructor';

interface Waiter {
  resolve: (scene: PreparedScene) => void;
  reject: (err: unknown) => void;
}

interface Job {
  source: SourceImage;
  raw: RawAnalysis;
  params: ReconstructParams;
  waiters: Waiter[];
}

/** Snapshot of the settings that affect reconstruction (the store mutates its objects in place). */
function pickParams(s: Settings): ReconstructParams {
  return { mask: { ...s.mask, click: s.mask.click ? [s.mask.click[0], s.mask.click[1]] : null }, depth: { ...s.depth } };
}

export class ReconstructClient {
  private worker: Worker | null = null;
  private inline: Reconstructor | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: ReconstructResponse) => void; reject: (e: unknown) => void }>();
  private queue: Job[] = [];
  private running = false;
  private installed: { source: SourceImage; raw: RawAnalysis } | null = null;
  /** Stable empty foreground so a no-object scene keeps the same ImageData identity. */
  private emptyFg: ImageData | null = null;
  /** Colour layers (HD) last received for the installed inputs; reused (same objects) while the worker reports them unchanged. */
  private lastColor: { key: string; bg: ImageData; fg: ImageData } | null = null;

  constructor() {
    try {
      this.worker = new Worker(new URL('../imaging/reconstruct.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent<ReconstructResponse>) => {
        const p = this.pending.get(ev.data.id);
        if (!p) return;
        this.pending.delete(ev.data.id);
        if (ev.data.type === 'error') p.reject(new Error(ev.data.message));
        else p.resolve(ev.data);
      };
      this.worker.onerror = () => this.fallBackToInline();
    } catch {
      this.fallBackToInline();
    }
  }

  reconstruct(source: SourceImage, raw: RawAnalysis, settings: Settings): Promise<PreparedScene> {
    return new Promise<PreparedScene>((resolve, reject) => {
      const params = pickParams(settings);
      const tail = this.queue[this.queue.length - 1];
      if (tail && tail.source === source && tail.raw === raw) {
        tail.params = params;
        tail.waiters.push({ resolve, reject });
      } else {
        this.queue.push({ source, raw, params, waiters: [{ resolve, reject }] });
      }
      void this.pump();
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.inline = null;
    const err = new Error('Pipeline disposed');
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    for (const job of this.queue) job.waiters.forEach((w) => w.reject(err));
    this.queue = [];
  }

  private fallBackToInline(): void {
    this.worker?.terminate();
    this.worker = null;
    this.inline = new Reconstructor();
    this.installed = null;
    this.lastColor = null;
    const err = new Error('Reconstruct worker failed');
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let job = this.queue.shift(); job; job = this.queue.shift()) {
        try {
          let scene: PreparedScene;
          try {
            scene = await this.execute(job);
          } catch (err) {
            // A dying worker rejects the in-flight request: retry once on the inline path.
            if (!this.inline) throw err;
            scene = await this.execute(job);
          }
          job.waiters.forEach((w) => w.resolve(scene));
        } catch (err) {
          job.waiters.forEach((w) => w.reject(err));
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async execute(job: Job): Promise<PreparedScene> {
    const { source, raw } = job;
    if (!this.installed || this.installed.source !== source || this.installed.raw !== raw) {
      const hd = hdPixels(source);
      if (this.installed && this.installed.raw === raw && sameProcessingPixels(this.installed.source, source)) {
        // Same picture at the same processing size, new output resolution: only the HD pixels change, every map stage
        // (and the analysis it came from) stays valid.
        if (this.inline) {
          this.inline.setHd(hd?.data ?? null, hd?.width ?? 0, hd?.height ?? 0);
        } else {
          await this.request({ type: 'setHd', id: this.nextId++, hd: hd?.data ?? null, width: hd?.width ?? 0, height: hd?.height ?? 0 });
        }
      } else {
        const inputs = {
          width: raw.width,
          height: raw.height,
          source: source.pixels.data,
          rawMask: raw.rawMask,
          rawDepth: raw.rawDepth,
          // An image's own alpha stands in for the masker (segmentationModel stays null).
          hasSegmentation: raw.segmentationModel !== null || getImageAlpha(source) !== undefined,
          hd: hd?.data ?? null,
          hdWidth: hd?.width ?? 0,
          hdHeight: hd?.height ?? 0,
        };
        if (this.inline) {
          this.inline.setInputs(inputs);
        } else {
          await this.request({ type: 'setInputs', id: this.nextId++, inputs });
        }
      }
      this.installed = { source, raw };
      this.lastColor = null;
    }

    const params: ReconstructParams = { ...job.params, knownColorKey: this.lastColor?.key ?? null };
    let output: ReconstructOutput;
    if (this.inline) {
      output = this.inline.run(params);
    } else {
      const res = await this.request({ type: 'run', id: this.nextId++, params });
      if (res.type !== 'result') throw new Error('Unexpected reconstruct response');
      output = res.output;
    }
    return this.toScene(source, output);
  }

  private toScene(source: SourceImage, out: ReconstructOutput): PreparedScene {
    const { width, height } = out;
    let bg: ImageData;
    let fg: ImageData;
    if (out.colorKind === 'data' && out.bgColor && out.fg) {
      const cw = out.colorWidth;
      const ch = out.colorHeight;
      bg = new ImageData(out.bgColor as Uint8ClampedArray<ArrayBuffer>, cw, ch);
      fg = new ImageData(out.fg as Uint8ClampedArray<ArrayBuffer>, cw, ch);
      this.lastColor = { key: out.colorKey, bg, fg };
    } else if (out.colorKind === 'known' && this.lastColor && this.lastColor.key === out.colorKey) {
      ({ bg, fg } = this.lastColor);
    } else if (out.colorKind === 'plain') {
      // No object: the background is the source itself and the foreground an empty 1x1.
      bg = source.hd;
      fg = this.emptyFg ??= new ImageData(1, 1);
    } else {
      throw new Error('Reconstruct returned no colour layers');
    }
    return {
      width,
      height,
      colorWidth: out.colorWidth,
      colorHeight: out.colorHeight,
      source: source.hd,
      mask: out.mask,
      depth: out.depth,
      bgColor: bg,
      bgDepth: out.bgDepth,
      fg,
      fgDepth: out.fgDepth,
      objDepth: out.objDepth,
      center: out.center,
      coverage: out.coverage,
      hasForeground: out.hasForeground,
      timings: out.timings,
    };
  }

  private request(req: ReconstructRequest): Promise<ReconstructResponse> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('Reconstruct worker unavailable'));
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, { resolve, reject });
      worker.postMessage(req);
    });
  }
}

/** The output-resolution pixels when they are a different size from the processing pixels, else null. */
function hdPixels(source: SourceImage): ImageData | null {
  const hd = source.hd;
  return hd && hd !== source.pixels && (hd.width !== source.pixels.width || hd.height !== source.pixels.height) ? hd : null;
}

/** True when both images hold identical processing-size pixels (a reload at another output resolution). */
function sameProcessingPixels(a: SourceImage, b: SourceImage): boolean {
  if (a === b) return true;
  const pa = a.pixels;
  const pb = b.pixels;
  if (pa.width !== pb.width || pa.height !== pb.height) return false;
  const da = pa.data;
  const db = pb.data;
  if (da.byteLength % 4 === 0 && da.byteOffset % 4 === 0 && db.byteOffset % 4 === 0) {
    const ua = new Uint32Array(da.buffer, da.byteOffset, da.byteLength / 4);
    const ub = new Uint32Array(db.buffer, db.byteOffset, db.byteLength / 4);
    for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) return false;
    return true;
  }
  for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) return false;
  return true;
}
