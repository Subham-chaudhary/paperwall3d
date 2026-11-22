/**
 * Registry of the ONNX models PaperWall3D can download at runtime.
 *
 * Every URL below was verified against the Hugging Face CDN (HTTP 200, a content-length, and
 * `access-control-allow-origin` echoing the caller's origin on the redirect) so the browser can fetch
 * them cross-origin. Files are cached in Cache Storage by `modelCache.ts`; nothing is bundled.
 *
 * Model I/O (inspected from the ONNX protobuf graph headers):
 * - U²-Net / U²-NetP: input  `input.1`  float32 [1,3,320,320]; first output (`1959`, d0) float32 [1,1,320,320],
 *   already sigmoid-activated. The remaining six outputs are deeper-supervision side outputs we ignore.
 * - Depth Anything V2 Small: input `pixel_values` float32 [batch,3,H,W] (H and W dynamic, multiples of 14);
 *   output `predicted_depth` float32 [batch,H,W] holding relative inverse depth (bigger = nearer).
 *   The fp16 build keeps float32 inputs/outputs.
 */
import type { DepthModelId, SegmentationModelId } from '../core/types';

/** Execution backend a model file is intended for. */
export type ModelBackend = 'webgpu' | 'wasm';

const HF = 'https://huggingface.co';
const hf = (repo: string, path: string): string => `${HF}/${repo}/resolve/main/${path}`;

/** A single downloadable file. The first URL is tried first; the rest are mirrors. */
export interface ModelFile {
  /** Stable cache id, unique across the registry. */
  id: string;
  label: string;
  urls: readonly string[];
  /** Approximate download size in bytes (used for progress when the server omits content-length). */
  sizeBytes: number;
}

export interface SegmentationModelSpec {
  id: SegmentationModelId;
  label: string;
  file: ModelFile;
  /** Square network input resolution. */
  inputSize: number;
  mean: readonly [number, number, number];
  std: readonly [number, number, number];
}

export interface DepthModelSpec {
  id: Exclude<DepthModelId, 'heuristic'>;
  label: string;
  /** Preferred file per backend: fp16 for WebGPU, int8-quantized for WASM (CPU has no fast fp16 path). */
  files: Record<ModelBackend, ModelFile>;
  /** Both input dimensions are rounded to a multiple of this (ViT patch size). */
  multipleOf: number;
  mean: readonly [number, number, number];
  std: readonly [number, number, number];
}

const IMAGENET_MEAN = [0.485, 0.456, 0.406] as const;
const IMAGENET_STD = [0.229, 0.224, 0.225] as const;

const SEGMENTATION: Record<SegmentationModelId, SegmentationModelSpec> = {
  u2netp: {
    id: 'u2netp',
    label: 'U²-NetP (fast)',
    file: {
      id: 'u2netp',
      label: 'U²-NetP segmentation',
      urls: [
        hf('BritishWerewolf/U-2-Netp', 'onnx/model.onnx'), // 4,574,861 B
        hf('nfa04/u2netp-onnx', 'u2netp.onnx'), // identical file
      ],
      sizeBytes: 4_574_861,
    },
    inputSize: 320,
    mean: IMAGENET_MEAN,
    std: IMAGENET_STD,
  },
  u2net: {
    id: 'u2net',
    label: 'U²-Net (full quality)',
    file: {
      id: 'u2net',
      label: 'U²-Net segmentation',
      urls: [
        hf('BritishWerewolf/U-2-Net', 'onnx/model.onnx'), // 175,997,641 B
        hf('Remeich/u2netp', 'u2net.onnx'), // mirror (same size)
      ],
      sizeBytes: 175_997_641,
    },
    inputSize: 320,
    mean: IMAGENET_MEAN,
    std: IMAGENET_STD,
  },
};

const DA_REPO = 'onnx-community/depth-anything-v2-small';

const DEPTH: Record<Exclude<DepthModelId, 'heuristic'>, DepthModelSpec> = {
  'depth-anything-v2-small': {
    id: 'depth-anything-v2-small',
    label: 'Depth Anything V2 Small',
    files: {
      webgpu: {
        id: 'depth-anything-v2-small-fp16',
        label: 'Depth Anything V2 Small (fp16)',
        urls: [hf(DA_REPO, 'onnx/model_fp16.onnx')], // 49,642,442 B
        sizeBytes: 49_642_442,
      },
      wasm: {
        id: 'depth-anything-v2-small-q8',
        label: 'Depth Anything V2 Small (int8)',
        urls: [
          hf(DA_REPO, 'onnx/model_quantized.onnx'), // 27,258,801 B
          hf(DA_REPO, 'onnx/model_uint8.onnx'), // identical blob
        ],
        sizeBytes: 27_258_801,
      },
    },
    multipleOf: 14,
    mean: IMAGENET_MEAN,
    std: IMAGENET_STD,
  },
};

export function getSegmentationSpec(id: SegmentationModelId): SegmentationModelSpec {
  return SEGMENTATION[id];
}

export function getDepthSpec(id: Exclude<DepthModelId, 'heuristic'>): DepthModelSpec {
  return DEPTH[id];
}

/** Every downloadable file, in display order. */
export function allModelFiles(): ModelFile[] {
  return [
    SEGMENTATION.u2netp.file,
    DEPTH['depth-anything-v2-small'].files.webgpu,
    DEPTH['depth-anything-v2-small'].files.wasm,
    SEGMENTATION.u2net.file,
  ];
}

/** Human-readable size, e.g. "26.1 MB". */
export function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
