/**
 * Inference worker: downloads models, runs segmentation + depth with ONNX Runtime Web, and returns
 * working-resolution maps. Everything heavy (decode of model bytes, tensor prep, inference) happens here so
 * the UI thread stays responsive.
 *
 * Backend policy: WebGPU when requested/auto and an adapter exists, otherwise WASM. If a WebGPU session
 * cannot be created or run, the model is retried on WASM (using that backend's preferred model file).
 * If the depth model cannot be used at all, a heuristic depth map is substituted.
 */
import type { Backend, DepthModelId, PipelineProgress, SegmentationModelId } from '../../core/types';
import { heuristicDepth } from '../../imaging/heuristicDepth';
import { detectWebGpu } from '../backend';
import { postprocessDepth, prepareDepthInput } from '../depth';
import { ModelDownloadError } from '../modelCache';
import { formatMB, getDepthSpec, getSegmentationSpec, type ModelFile } from '../models';
import { predictMask, type SegmentationRunner } from '../segmentation';
import type { AnalyzeRequest, AnalyzeResult, InferenceRequest, InferenceResponse } from './protocol';
import { loadOrt, SessionPool, tensorToFloat32, type ExecutionProvider, type OrtSession } from './ortRuntime';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const pool = new SessionPool();

const cancelledJobs = new Set<number>();
const aborters = new Map<number, AbortController>();

class CancelledError extends Error {
  constructor() {
    super('Analysis cancelled');
    this.name = 'CancelledError';
  }
}

function post(msg: InferenceResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

const nowMs = (): number => performance.now();
const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Jobs run strictly one after another: sessions are shared and ORT runs are not re-entrant-friendly. */
let chain: Promise<void> = Promise.resolve();

ctx.onmessage = (ev: MessageEvent<InferenceRequest>) => {
  const req = ev.data;
  if (req.type === 'cancel') {
    cancelledJobs.add(req.jobId);
    aborters.get(req.jobId)?.abort();
    return;
  }
  chain = chain.then(() => handleAnalyze(req));
};

async function handleAnalyze(req: AnalyzeRequest): Promise<void> {
  const { jobId } = req;
  const aborter = new AbortController();
  aborters.set(jobId, aborter);
  const check = (): void => {
    if (cancelledJobs.has(jobId)) throw new CancelledError();
  };
  const progress = (p: PipelineProgress): void => post({ type: 'progress', jobId, progress: p });
  try {
    check();
    const result = await analyze(req, aborter.signal, check, progress);
    check();
    post(result, [...(result.rawDepth ? [result.rawDepth.buffer] : []), ...(result.rawMask ? [result.rawMask.buffer] : [])]);
  } catch (err) {
    const cancelled = err instanceof CancelledError || cancelledJobs.has(jobId) || (err instanceof DOMException && err.name === 'AbortError');
    post({ type: 'error', jobId, message: err instanceof Error ? err.message : String(err), cancelled });
  } finally {
    aborters.delete(jobId);
    cancelledJobs.delete(jobId);
  }
}

type ProgressFn = (p: PipelineProgress) => void;

interface ModelRun<T> {
  value: T;
  backend: ExecutionProvider;
}

/**
 * Obtains a session for the model (downloading it if needed) and runs `run` on it, falling back from
 * WebGPU to WASM on any failure.
 */
async function withSession<T>(
  kind: 'segmentation' | 'depth',
  label: string,
  files: Record<ExecutionProvider, ModelFile>,
  preferred: ExecutionProvider,
  signal: AbortSignal,
  check: () => void,
  progress: ProgressFn,
  timings: Record<string, number>,
  run: (session: OrtSession, backend: ExecutionProvider) => Promise<T>,
): Promise<ModelRun<T>> {
  const order: ExecutionProvider[] = preferred === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'];
  const downloadStage = kind === 'segmentation' ? 'download-segmentation' : 'download-depth';
  let lastError: unknown = null;
  for (const backend of order) {
    check();
    const file = files[backend];
    if (pool.isKnownBroken(file, backend)) continue;
    const t0 = nowMs();
    let throttle = 0;
    try {
      const session = await pool.get(
        file,
        backend,
        {
          onDownload: (loaded, total, fromCache) => {
            const t = nowMs();
            if (t - throttle < 80 && loaded < total) return;
            throttle = t;
            progress({
              stage: downloadStage,
              progress: total > 0 ? loaded / total : -1,
              message: fromCache
                ? `Loading ${file.label} from cache`
                : `Downloading ${file.label} — ${formatMB(loaded)} / ${formatMB(total)}`,
              loadedBytes: loaded,
              totalBytes: total,
            });
          },
          onCreating: () =>
            progress({
              stage: 'init-runtime',
              progress: -1,
              message: `Initializing ONNX Runtime (${backend === 'webgpu' ? 'WebGPU' : 'WASM'}) — ${label}`,
            }),
        },
        signal,
      );
      timings[`${kind}-load`] = round1((timings[`${kind}-load`] ?? 0) + nowMs() - t0);
      check();
      const value = await run(session, backend);
      return { value, backend };
    } catch (err) {
      if (err instanceof CancelledError || signal.aborted) throw err;
      // A network failure says nothing about the backend: don't blame WebGPU. Only try the other
      // backend when it uses a different file (which may already be cached).
      if (err instanceof ModelDownloadError) {
        if (backend === 'webgpu' && files.wasm.id !== file.id) {
          lastError = err;
          continue;
        }
        throw err;
      }
      lastError = err;
      if (backend === 'webgpu') {
        pool.markBroken(file, backend);
        progress({
          stage: 'init-runtime',
          progress: -1,
          message: `WebGPU unavailable for ${label} (${errorText(err)}) — retrying on WASM`,
        });
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'no usable backend'));
}

function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 120 ? `${msg.slice(0, 117)}...` : msg;
}

async function pickBackend(requested: Backend, progress: ProgressFn): Promise<ExecutionProvider> {
  if (requested === 'wasm') return 'wasm';
  if (await detectWebGpu()) return 'webgpu';
  if (requested === 'webgpu') {
    progress({ stage: 'init-runtime', progress: -1, message: 'WebGPU is not available in this browser — using WASM' });
  }
  return 'wasm';
}

async function analyze(req: AnalyzeRequest, signal: AbortSignal, check: () => void, progress: ProgressFn): Promise<AnalyzeResult> {
  const { width: w, height: h, pixels } = req;
  const timings: Record<string, number> = {};
  const t0 = nowMs();
  let degraded = false;
  const preferred = await pickBackend(req.backend, progress);
  const ort = await loadOrt();

  // ── Segmentation ──────────────────────────────────────────────
  let rawMask: Float32Array | null = null;
  let segUsed: SegmentationModelId | null = null;
  let segBackend: ExecutionProvider | null = null;
  if (req.segmentation) {
    const seg = req.segmentation;
    const spec = getSegmentationSpec(seg.model);
    try {
      const out = await withSession(
        'segmentation',
        spec.label,
        { webgpu: spec.file, wasm: spec.file },
        preferred,
        signal,
        check,
        progress,
        timings,
        async (session) => {
          progress({ stage: 'segmentation', progress: -1, message: `Segmenting subject — ${spec.label}` });
          const t = nowMs();
          const inputName = session.inputNames[0]!;
          const run: SegmentationRunner = async (input) => {
            check();
            const tensor = new ort.Tensor('float32', input, [1, 3, spec.inputSize, spec.inputSize]);
            const outputs = await session.run({ [inputName]: tensor });
            const first = outputs[session.outputNames[0]!];
            if (!first) throw new Error('Segmentation model returned no output');
            return tensorToFloat32(first);
          };
          const mask = await predictMask(pixels, w, h, spec, run, {
            flipAvg: seg.flipAvg,
            refine: seg.refine,
            onPass: (label) => progress({ stage: 'segmentation', progress: -1, message: `Segmenting subject (${label}) — ${spec.label}` }),
          });
          timings.segmentation = round1(nowMs() - t);
          return mask;
        },
      );
      rawMask = out.value;
      segBackend = out.backend;
      segUsed = spec.id;
      progress({ stage: 'segmentation', progress: 1, message: 'Segmentation done' });
    } catch (err) {
      if (err instanceof CancelledError || signal.aborted) throw err;
      degraded = true;
      progress({
        stage: 'segmentation',
        progress: 1,
        message: `Segmentation failed (${errorText(err)}) — continuing without a subject mask`,
      });
    }
  }
  check();

  // ── Depth ─────────────────────────────────────────────────────
  let rawDepth: Float32Array | null = null;
  let depthUsed: DepthModelId | null = req.depth?.model ?? null;
  let depthBackend: ExecutionProvider | null = null;
  if (req.depth && req.depth.model !== 'heuristic') {
    const depthJob = req.depth;
    const spec = getDepthSpec(req.depth.model);
    try {
      const out = await withSession(
        'depth',
        spec.label,
        spec.files,
        preferred,
        signal,
        check,
        progress,
        timings,
        async (session, backend) => {
          progress({ stage: 'depth', progress: -1, message: `Estimating depth — ${spec.label}` });
          const t = nowMs();
          const input = prepareDepthInput(pixels, w, h, depthJob.size, spec);
          const tensor = new ort.Tensor('float32', input.data, [1, 3, input.height, input.width]);
          const outputs = await session.run({ [session.inputNames[0]!]: tensor });
          const first = outputs[session.outputNames[0]!];
          if (!first) throw new Error('Depth model returned no output');
          const dims = first.dims;
          const outW = Number(dims[dims.length - 1]);
          const outH = Number(dims[dims.length - 2]);
          try {
            const depth = postprocessDepth(tensorToFloat32(first), outW, outH, w, h);
            timings.depth = round1(nowMs() - t);
            return depth;
          } catch (err) {
            // NaN output: this model file / backend pair is broken (e.g. fp16 on a GPU without proper support).
            pool.markBroken(spec.files[backend], backend);
            throw err;
          }
        },
      );
      rawDepth = out.value;
      depthBackend = out.backend;
      progress({ stage: 'depth', progress: 1, message: 'Depth estimation done' });
    } catch (err) {
      if (err instanceof CancelledError || signal.aborted) throw err;
      degraded = true;
      depthUsed = 'heuristic';
      progress({
        stage: 'depth',
        progress: -1,
        message: `Depth model unavailable (${errorText(err)}) — using heuristic depth`,
      });
    }
  }
  if (!rawDepth && req.depth) {
    check();
    const t = nowMs();
    rawDepth = heuristicDepth(pixels, w, h);
    depthUsed = 'heuristic';
    timings['depth-heuristic'] = round1(nowMs() - t);
  }

  timings.total = round1(nowMs() - t0);
  const backendUsed = depthBackend ?? segBackend ?? 'cpu';
  return {
    type: 'result',
    jobId: req.jobId,
    rawMask,
    rawDepth,
    segmentationModel: segUsed,
    depthModel: depthUsed,
    backendUsed,
    timings,
    degraded,
  };
}
