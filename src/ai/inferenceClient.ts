/** Main-thread handle to the inference worker: one request at a time, with cancellation. */
import type { Backend, PipelineProgress } from '../core/types';
import type { AnalyzeResult, DepthJob, InferenceRequest, InferenceResponse, SegmentationJob } from './worker/protocol';

export interface AnalyzeJob {
  width: number;
  height: number;
  /** Working-resolution RGBA. It is copied before being sent. */
  pixels: Uint8ClampedArray;
  segmentation: SegmentationJob | null;
  depth: DepthJob | null;
  backend: Backend;
}

export type AnalyzeOutcome = Omit<AnalyzeResult, 'type' | 'jobId'>;

export function abortError(message = 'Analysis cancelled'): DOMException {
  return new DOMException(message, 'AbortError');
}

export class InferenceClient {
  private worker: Worker | null = null;
  private nextJobId = 1;
  private current: {
    jobId: number;
    resolve: (r: AnalyzeOutcome) => void;
    reject: (e: unknown) => void;
    onProgress: (p: PipelineProgress) => void;
  } | null = null;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./worker/inference.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<InferenceResponse>) => this.onMessage(ev.data);
    worker.onerror = (ev) => {
      const cur = this.current;
      this.current = null;
      // A crashed worker (e.g. out of memory) is discarded; the next job starts a fresh one.
      this.worker?.terminate();
      this.worker = null;
      cur?.reject(new Error(ev.message || 'Inference worker crashed'));
    };
    this.worker = worker;
    return worker;
  }

  private onMessage(msg: InferenceResponse): void {
    const cur = this.current;
    if (!cur || msg.jobId !== cur.jobId) return; // stale message from a cancelled job
    if (msg.type === 'progress') {
      cur.onProgress(msg.progress);
    } else if (msg.type === 'result') {
      this.current = null;
      cur.resolve({
        rawMask: msg.rawMask,
        rawDepth: msg.rawDepth,
        segmentationModel: msg.segmentationModel,
        depthModel: msg.depthModel,
        backendUsed: msg.backendUsed,
        timings: msg.timings,
        degraded: msg.degraded,
      });
    } else {
      this.current = null;
      cur.reject(msg.cancelled ? abortError() : new Error(msg.message));
    }
  }

  /** Starts a job; any job still in flight is cancelled (its promise rejects with an AbortError). */
  run(job: AnalyzeJob, onProgress: (p: PipelineProgress) => void): Promise<AnalyzeOutcome> {
    this.cancel();
    const worker = this.ensureWorker();
    const jobId = this.nextJobId++;
    const promise = new Promise<AnalyzeOutcome>((resolve, reject) => {
      this.current = { jobId, resolve, reject, onProgress };
    });
    const pixels = job.pixels.slice();
    const req: InferenceRequest = {
      type: 'analyze',
      jobId,
      width: job.width,
      height: job.height,
      pixels,
      segmentation: job.segmentation,
      depth: job.depth,
      backend: job.backend,
    };
    worker.postMessage(req, [pixels.buffer]);
    return promise;
  }

  cancel(): void {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    this.worker?.postMessage({ type: 'cancel', jobId: cur.jobId } satisfies InferenceRequest);
    cur.reject(abortError());
  }

  dispose(): void {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }
}
