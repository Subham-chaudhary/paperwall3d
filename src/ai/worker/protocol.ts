/** Message shapes between the main thread and the inference worker. */
import type { Backend, DepthModelId, PipelineProgress, SegmentationModelId } from '../../core/types';

export interface AnalyzeRequest {
  type: 'analyze';
  jobId: number;
  width: number;
  height: number;
  /** Working-resolution RGBA (a private copy, transferred). */
  pixels: Uint8ClampedArray;
  /** null = skip segmentation (disabled, or caller already has the mask). */
  segmentation: SegmentationModelId | null;
  /** null = skip depth (caller already has it). */
  depth: DepthModelId | null;
  backend: Backend;
}

export interface CancelRequest {
  type: 'cancel';
  jobId: number;
}

export type InferenceRequest = AnalyzeRequest | CancelRequest;

export interface AnalyzeResult {
  type: 'result';
  jobId: number;
  /** null when segmentation was disabled or failed. */
  rawMask: Float32Array | null;
  /** null when depth was not requested. */
  rawDepth: Float32Array | null;
  segmentationModel: SegmentationModelId | null;
  /** The model that actually produced rawDepth ('heuristic' after a fallback); null when depth was not requested. */
  depthModel: DepthModelId | null;
  backendUsed: 'webgpu' | 'wasm' | 'cpu';
  timings: Record<string, number>;
  /** True when a model failed and a fallback was used (result should not be cached as the requested config). */
  degraded: boolean;
}

export type InferenceResponse =
  | { type: 'progress'; jobId: number; progress: PipelineProgress }
  | AnalyzeResult
  | { type: 'error'; jobId: number; message: string; cancelled: boolean };
