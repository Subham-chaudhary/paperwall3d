/**
 * Main-thread handle to the reconstruct worker.
 *
 * - Source/raw data is shipped to the worker once per (source, raw) pair; later calls only send settings.
 * - Requests are serialised. A request that is still queued when a newer one for the same inputs arrives is
 *   coalesced: both promises resolve with the newest result, so rapid slider drags don't pile up.
 * - If workers are unavailable the same code runs inline on the main thread.
 */
import type { PreparedScene, RawAnalysis, Settings, SourceImage } from '../core/types';
import type { ReconstructRequest, ReconstructResponse } from '../imaging/reconstruct.protocol';
import { Reconstructor, type ReconstructOutput, type ReconstructParams } from '../imaging/reconstructor';

/**
 * A PreparedScene plus the background-layer depth (foreground region filled from its surroundings).
 * Renderers that know about the extra field can displace the background mesh with it to avoid a
 * foreground-shaped bump behind the subject; others can ignore it.
 */
export interface PreparedSceneEx extends PreparedScene {
  backgroundDepth: Float32Array;
}

interface Waiter {
  resolve: (scene: PreparedSceneEx) => void;
  reject: (err: unknown) => void;
}

interface Job {
  source: SourceImage;
  raw: RawAnalysis;
  params: ReconstructParams;
  waiters: Waiter[];
}

function pickParams(s: Settings): ReconstructParams {
  return { segmentation: s.segmentation, depth: s.depth, reconstruction: s.reconstruction };
}

export class ReconstructClient {
  private worker: Worker | null = null;
  private inline: Reconstructor | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: ReconstructResponse) => void; reject: (e: unknown) => void }>();
  private queue: Job[] = [];
  private running = false;
  private installed: { source: SourceImage; raw: RawAnalysis } | null = null;

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

  reconstruct(source: SourceImage, raw: RawAnalysis, settings: Settings): Promise<PreparedSceneEx> {
    return new Promise<PreparedSceneEx>((resolve, reject) => {
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
          let scene: PreparedSceneEx;
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

  private async execute(job: Job): Promise<PreparedSceneEx> {
    const { source, raw } = job;
    if (!this.installed || this.installed.source !== source || this.installed.raw !== raw) {
      const inputs = {
        width: raw.width,
        height: raw.height,
        source: source.pixels.data,
        rawMask: raw.rawMask,
        rawDepth: raw.rawDepth,
        hasSegmentation: raw.segmentationModel !== null,
      };
      if (this.inline) {
        this.inline.setInputs(inputs);
      } else {
        await this.request({ type: 'setInputs', id: this.nextId++, inputs });
      }
      this.installed = { source, raw };
    }

    let output: ReconstructOutput;
    if (this.inline) {
      output = this.inline.run(job.params);
    } else {
      const res = await this.request({ type: 'run', id: this.nextId++, params: job.params });
      if (res.type !== 'result') throw new Error('Unexpected reconstruct response');
      output = res.output;
    }
    return toScene(source, output);
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

function toScene(source: SourceImage, out: ReconstructOutput): PreparedSceneEx {
  const { width, height } = out;
  return {
    width,
    height,
    source: source.pixels,
    mask: out.mask,
    depth: out.depth,
    backgroundDepth: out.backgroundDepth,
    background: new ImageData(out.background as Uint8ClampedArray<ArrayBuffer>, width, height),
    foreground: new ImageData(out.foreground as Uint8ClampedArray<ArrayBuffer>, width, height),
    hasForeground: out.hasForeground,
    timings: out.timings,
  };
}
