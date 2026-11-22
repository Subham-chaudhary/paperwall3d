/**
 * Pipeline facade implementing IPipeline.
 *
 * analyze():     expensive, runs in the inference worker; results are cached per component
 *                (mask per image + (mask_model, flip_avg, refine), depth per image + (depth model, depth_size, backend))
 *                so toggling settings back and forth never repeats inference.
 * reconstruct(): cheap, runs in the reconstruct worker (see reconstructClient.ts).
 */
import { Emitter } from '../core/events';
import type {
  BackendInfo,
  DepthModelId,
  IPipeline,
  ModelCacheEntry,
  PipelineProgress,
  PreparedScene,
  RawAnalysis,
  SegmentationModelId,
  Settings,
  SourceImage,
} from '../core/types';
import { probeBackend } from './backend';
import { getImageAlpha, loadSourceImage } from './imageLoader';
import { abortError, InferenceClient } from './inferenceClient';
import type { DepthJob, SegmentationJob } from './worker/protocol';
import { clearModelCache, listModels } from './modelCache';
import { ReconstructClient } from './reconstructClient';

interface MaskEntry {
  mask: Float32Array;
  model: SegmentationModelId | null;
  backend: RawAnalysis['backendUsed'];
}
interface DepthEntry {
  depth: Float32Array;
  model: DepthModelId;
  backend: RawAnalysis['backendUsed'];
}

/** Small insertion-ordered LRU. */
class Lru<V> {
  private map = new Map<string, V>();
  constructor(private max: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
  clear(): void {
    this.map.clear();
  }
}

export class Pipeline implements IPipeline {
  private emitter = new Emitter<{ progress: PipelineProgress }>();
  private inference = new InferenceClient();
  private reconstructor: ReconstructClient | null = null;

  private imageIds = new WeakMap<SourceImage, number>();
  private nextImageId = 1;
  private maskCache = new Lru<MaskEntry>(6);
  private depthCache = new Lru<DepthEntry>(6);
  private rawCache = new Lru<RawAnalysis>(6);
  private activeBackend: BackendInfo['active'] = null;
  /** Generation counter: an analyze() whose generation is stale drops its result. */
  private generation = 0;

  onProgress(cb: (p: PipelineProgress) => void): () => void {
    return this.emitter.on('progress', cb);
  }

  private emit(p: PipelineProgress): void {
    this.emitter.emit('progress', p);
  }

  getBackendInfo(): Promise<BackendInfo> {
    return probeBackend(this.activeBackend);
  }

  async loadImage(file: Blob, name: string, workingResolution: number): Promise<SourceImage> {
    this.emit({ stage: 'decode', progress: -1, message: `Decoding ${name}` });
    try {
      const img = await loadSourceImage(file, name, workingResolution);
      this.emit({
        stage: 'decode',
        progress: 1,
        message: `Loaded ${name} — ${img.originalWidth}×${img.originalHeight}` +
          (img.width !== img.originalWidth ? ` (working size ${img.width}×${img.height})` : ''),
      });
      return img;
    } catch (err) {
      this.emit({ stage: 'error', progress: 0, message: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  private imageId(source: SourceImage): number {
    let id = this.imageIds.get(source);
    if (id === undefined) {
      id = this.nextImageId++;
      this.imageIds.set(source, id);
    }
    return id;
  }

  async analyze(source: SourceImage, settings: Settings): Promise<RawAnalysis> {
    const gen = ++this.generation;
    const t0 = performance.now();
    const id = this.imageId(source);
    const { width: w, height: h } = source;
    const m = settings.mask;
    // A meaningful alpha channel in the image replaces the masker.
    const alpha = m.use_subject ? getImageAlpha(source) : undefined;
    const segJob: SegmentationJob | null = m.use_subject && !alpha
      ? { model: m.mask_model, flipAvg: m.flip_avg, refine: m.refine }
      : null;
    const depthJob: DepthJob = { model: settings.depth.model, size: Math.round(settings.depth.depth_size) };
    const backend = settings.runtime.backend;

    // Cache keys follow 2.5dwallpp: mask = (model, flip, refine), depth = (model, input size); the backend is
    // part of the depth key because the fp16 (WebGPU) and int8 (WASM) builds give different maps.
    const maskKey = alpha ? `${id}|alpha` : segJob ? `${id}|${segJob.model}|${+segJob.flipAvg}|${+segJob.refine}` : `${id}|off`;
    const depthKey =
      depthJob.model === 'heuristic' ? `${id}|heuristic` : `${id}|${depthJob.model}|${depthJob.size}|${backend}`;
    const rawKey = `${maskKey}|${depthKey}`;

    const fullHit = this.rawCache.get(rawKey);
    if (fullHit) {
      this.activeBackend = fullHit.backendUsed;
      this.emit({ stage: 'done', progress: 1, message: 'Analysis loaded from memory cache' });
      return fullHit;
    }

    let maskEntry: MaskEntry | undefined = alpha
      ? { mask: alpha, model: null, backend: 'cpu' }
      : segJob
        ? this.maskCache.get(maskKey)
        : { mask: new Float32Array(w * h), model: null, backend: 'cpu' };
    if (alpha) this.emit({ stage: 'segmentation', progress: 1, message: "Using the image's transparency as the mask" });
    let depthEntry = this.depthCache.get(depthKey);
    const timings: Record<string, number> = {};
    let degraded = false;

    if (!maskEntry || !depthEntry) {
      const outcome = await this.inference.run(
        {
          width: w,
          height: h,
          pixels: source.pixels.data,
          segmentation: maskEntry ? null : segJob,
          depth: depthEntry ? null : depthJob,
          backend,
        },
        (p) => {
          if (gen === this.generation) this.emit(p);
        },
      );
      if (gen !== this.generation) throw abortError('Analysis superseded');
      Object.assign(timings, outcome.timings);
      degraded = outcome.degraded;

      if (!maskEntry) {
        // A failed segmentation yields an empty mask and segmentationModel null.
        maskEntry = outcome.rawMask
          ? { mask: outcome.rawMask, model: outcome.segmentationModel, backend: outcome.backendUsed }
          : { mask: new Float32Array(w * h), model: null, backend: 'cpu' };
        if (outcome.rawMask && !degraded) this.maskCache.set(maskKey, maskEntry);
      }
      if (!depthEntry && outcome.rawDepth) {
        depthEntry = { depth: outcome.rawDepth, model: outcome.depthModel ?? 'heuristic', backend: outcome.backendUsed };
        if (!degraded) this.depthCache.set(depthKey, depthEntry);
      }
    } else {
      timings.cache = 0;
    }
    if (!depthEntry) throw new Error('Analysis produced no depth map');

    const raw: RawAnalysis = {
      width: w,
      height: h,
      rawMask: maskEntry.mask,
      rawDepth: depthEntry.depth,
      segmentationModel: maskEntry.model,
      depthModel: depthEntry.model,
      backendUsed: depthEntry.backend !== 'cpu' ? depthEntry.backend : maskEntry.backend,
      timings: { ...timings, total: Math.round(performance.now() - t0) },
    };
    this.activeBackend = raw.backendUsed;
    if (!degraded) this.rawCache.set(rawKey, raw);
    this.emit({
      stage: 'done',
      progress: 1,
      message: `Analysis complete in ${((performance.now() - t0) / 1000).toFixed(1)} s` +
        (raw.depthModel === 'heuristic' ? ' (heuristic depth)' : ` (${raw.backendUsed === 'webgpu' ? 'WebGPU' : raw.backendUsed.toUpperCase()})`),
    });
    return raw;
  }

  async reconstruct(source: SourceImage, raw: RawAnalysis, settings: Settings): Promise<PreparedScene> {
    this.reconstructor ??= new ReconstructClient();
    const t0 = performance.now();
    this.emit({ stage: 'refine', progress: -1, message: 'Refining mask and depth' });
    try {
      const scene = await this.reconstructor.reconstruct(source, raw, settings);
      this.emit({
        stage: 'done',
        progress: 1,
        message: `Scene updated in ${Math.round(performance.now() - t0)} ms`,
      });
      return scene;
    } catch (err) {
      this.emit({ stage: 'error', progress: 0, message: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  listModels(): Promise<ModelCacheEntry[]> {
    return listModels();
  }

  async clearModelCache(): Promise<void> {
    await clearModelCache();
  }

  cancel(): void {
    this.generation++;
    this.inference.cancel();
  }

  dispose(): void {
    this.cancel();
    this.inference.dispose();
    this.reconstructor?.dispose();
    this.reconstructor = null;
    this.maskCache.clear();
    this.depthCache.clear();
    this.rawCache.clear();
    this.emitter.clear();
  }
}
