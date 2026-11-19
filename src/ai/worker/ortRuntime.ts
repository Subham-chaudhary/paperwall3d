/**
 * ONNX Runtime Web bootstrap + session pool (worker side).
 *
 * - The runtime is loaded with a dynamic import so Rollup puts it in its own chunk; ORT spawns its
 *   multi-thread helper workers from the file that contains it, so that file must be ORT-only.
 * - The WASM binary is self-hosted: Vite emits it as a build asset via `?url` (no third-party CDN).
 */
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import { wasmThreadCount } from '../backend';
import { fetchModel } from '../modelCache';
import type { ModelFile } from '../models';

export type Ort = typeof import('onnxruntime-web/webgpu');
export type OrtSession = import('onnxruntime-web/webgpu').InferenceSession;
export type ExecutionProvider = 'webgpu' | 'wasm';

let ortPromise: Promise<Ort> | null = null;

/** Loads and configures ONNX Runtime Web (once). */
export function loadOrt(): Promise<Ort> {
  ortPromise ??= import('onnxruntime-web/webgpu').then((ort) => {
    ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, self.location.href).href };
    ort.env.wasm.numThreads = wasmThreadCount();
    ort.env.wasm.proxy = false; // we are already inside a worker
    ort.env.logLevel = 'error';
    return ort;
  });
  return ortPromise;
}

export interface SessionProgress {
  onDownload(loaded: number, total: number, fromCache: boolean): void;
  onCreating(): void;
}

/** Sessions cached per (model file, execution provider); failed combinations are remembered. */
export class SessionPool {
  private sessions = new Map<string, Promise<OrtSession>>();
  private failed = new Set<string>();

  has(file: ModelFile, ep: ExecutionProvider): boolean {
    return this.sessions.has(`${file.id}:${ep}`);
  }

  isKnownBroken(file: ModelFile, ep: ExecutionProvider): boolean {
    return this.failed.has(`${file.id}:${ep}`);
  }

  async get(file: ModelFile, ep: ExecutionProvider, progress: SessionProgress, signal?: AbortSignal): Promise<OrtSession> {
    const key = `${file.id}:${ep}`;
    if (this.failed.has(key)) throw new Error(`${ep} is not usable for ${file.label}`);
    let p = this.sessions.get(key);
    if (!p) {
      p = this.create(file, ep, progress, signal);
      this.sessions.set(key, p);
      p.catch(() => {
        // Don't poison the cache with aborted downloads / failed creations.
        this.sessions.delete(key);
      });
    }
    return p;
  }

  /** Marks a combination as unusable (e.g. it produced NaNs) and releases its session. */
  markBroken(file: ModelFile, ep: ExecutionProvider): void {
    const key = `${file.id}:${ep}`;
    this.failed.add(key);
    const p = this.sessions.get(key);
    this.sessions.delete(key);
    void p?.then((s) => s.release()).catch(() => undefined);
  }

  private async create(file: ModelFile, ep: ExecutionProvider, progress: SessionProgress, signal?: AbortSignal): Promise<OrtSession> {
    const [ort, bytes] = await Promise.all([loadOrt(), fetchModel(file, progress.onDownload, signal)]);
    progress.onCreating();
    try {
      return await ort.InferenceSession.create(new Uint8Array(bytes), {
        executionProviders: [ep],
        graphOptimizationLevel: 'all',
      });
    } catch (err) {
      if (ep === 'webgpu') this.failed.add(`${file.id}:${ep}`);
      throw err;
    }
  }
}

/** Float16 (IEEE 754 half) bits to float32. */
function halfToFloat(h: number): number {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 0x1f) return f ? NaN : s ? -Infinity : Infinity;
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

/** Reads any numeric tensor output as float32 (handles fp16 outputs defensively). */
export function tensorToFloat32(t: { data: unknown; type: string }): Float32Array {
  const d = t.data;
  if (d instanceof Float32Array) return d;
  if (t.type === 'float16' && d instanceof Uint16Array) {
    const out = new Float32Array(d.length);
    for (let i = 0; i < d.length; i++) out[i] = halfToFloat(d[i]!);
    return out;
  }
  return Float32Array.from(d as ArrayLike<number>);
}
