/**
 * Shared contracts between the AI pipeline (src/ai, src/imaging),
 * the renderer (src/render) and the UI shell (src/ui).
 *
 * Conventions
 * - All per-pixel maps are row-major Float32Array of length width*height, values in 0..1.
 * - depth: 1 = nearest to camera, 0 = farthest.
 * - mask:  1 = foreground subject, 0 = background.
 * - "working resolution": the long edge of the processed image (Settings.runtime.workingResolution).
 */

// ───────────────────────────────────────────── Settings ─────────────────────────────────────────────

export type SegmentationModelId = 'u2netp' | 'u2net';
export type DepthModelId = 'depth-anything-v2-small' | 'heuristic';
export type Backend = 'auto' | 'webgpu' | 'wasm';
export type CameraMode = 'cursor' | 'orbit' | 'auto' | 'static';
export type ViewMode = 'render' | 'depth' | 'mask' | 'wireframe' | 'layers';

export interface SegmentationSettings {
  enabled: boolean;
  model: SegmentationModelId;
  /** Alpha threshold 0..1 applied to the raw model output before feathering. */
  threshold: number;
  /** Edge feather radius in pixels (working resolution). */
  feather: number;
  /** Morphological grow (>0) / shrink (<0) in pixels. */
  dilate: number;
  /** Remove small islands smaller than this fraction of the image area (0..0.05). */
  minIslandArea: number;
  invert: boolean;
}

export interface DepthSettings {
  model: DepthModelId;
  invert: boolean;
  /** Contrast multiplier around the mid-depth (0.2..3). */
  contrast: number;
  /** Gamma applied to normalized depth (0.2..3). */
  gamma: number;
  /** Edge-preserving smoothing radius in pixels (0..16). */
  smoothing: number;
  /** Near/far clip of normalized depth (0..1), remapped to full range. */
  near: number;
  far: number;
}

export interface ReconstructionSettings {
  /** Fill the hole left by the foreground in the background layer. */
  inpaint: boolean;
  /** How far (px) to grow the mask before inpainting, to hide halos. */
  inpaintPadding: number;
  /** Extra blur applied to the inpainted region only (0..1). */
  inpaintSoftness: number;
  /** Extend foreground edge colors outward to avoid dark fringes (px). */
  edgeBleed: number;
}

export interface GeometrySettings {
  /** Grid segments along the long edge of displacement meshes (32..512). */
  meshResolution: number;
  /** Displacement strength of the background mesh, in scene units (0..2). */
  backgroundRelief: number;
  /** Displacement strength of the foreground mesh, in scene units (0..2). */
  foregroundRelief: number;
  /** Z offset of the foreground layer from the background (0..2). */
  objectElevation: number;
  /** Uniform scale of the foreground layer (0.8..1.3). */
  foregroundScale: number;
  /** Depth-gradient threshold at which triangles are discarded to avoid stretched edges (0..1, 1 = off). */
  discontinuityCutoff: number;
  /** Overscan of the background plane so edges stay hidden while moving (1..1.5). */
  overscan: number;
}

export interface LightingSettings {
  enabled: boolean;
  exposure: number;
  ambient: number;
  keyIntensity: number;
  keyColor: string;
  /** Degrees. */
  keyAzimuth: number;
  keyElevation: number;
  rimIntensity: number;
  rimColor: string;
  /** Light direction follows the cursor. */
  followCursor: boolean;
  /** Screen-space ambient occlusion-ish darkening derived from depth (0..1). */
  depthShading: number;
}

export interface CameraSettings {
  mode: CameraMode;
  /** Horizontal/vertical translation parallax amount (0..2). */
  parallax: number;
  /** Max rotation tilt in degrees (0..20). */
  tilt: number;
  /** Smoothing factor of cursor follow (0..0.99). Higher = smoother/slower. */
  damping: number;
  /** Vertical field of view in degrees (15..75). */
  fov: number;
  /** Dolly / zoom (0.5..2). */
  zoom: number;
  /** Auto-mode animation speed (0..2). */
  autoSpeed: number;
  invertX: boolean;
  invertY: boolean;
}

export interface ViewSettings {
  mode: ViewMode;
  showGrid: boolean;
  showStats: boolean;
  background: string;
}

export interface RuntimeSettings {
  backend: Backend;
  /** Long edge of the processed image in pixels. */
  workingResolution: 512 | 768 | 1024 | 1536 | 2048;
}

export interface Settings {
  segmentation: SegmentationSettings;
  depth: DepthSettings;
  reconstruction: ReconstructionSettings;
  geometry: GeometrySettings;
  lighting: LightingSettings;
  camera: CameraSettings;
  view: ViewSettings;
  runtime: RuntimeSettings;
}

export type SettingsSection = keyof Settings;

/** Dot path into Settings, e.g. "geometry.foregroundRelief". */
export type SettingsPath = {
  [S in SettingsSection]: `${S}.${Extract<keyof Settings[S], string>}`;
}[SettingsSection];

// ───────────────────────────────────────────── Pipeline data ─────────────────────────────────────────────

export interface SourceImage {
  name: string;
  /** Original dimensions. */
  originalWidth: number;
  originalHeight: number;
  /** Working-resolution dimensions. */
  width: number;
  height: number;
  /** Working-resolution RGBA pixels. */
  pixels: ImageData;
  /** Original file bytes (kept for persistence/export). */
  blob: Blob;
}

/** Output of the expensive AI stage. Re-run only when the image or a model choice changes. */
export interface RawAnalysis {
  width: number;
  height: number;
  /** Model mask upsampled to working resolution, 0..1. */
  rawMask: Float32Array;
  /** Model depth upsampled to working resolution, normalized 0..1 (1 = near). */
  rawDepth: Float32Array;
  segmentationModel: SegmentationModelId | null;
  depthModel: DepthModelId;
  backendUsed: 'webgpu' | 'wasm' | 'cpu';
  timings: Record<string, number>;
}

/** Output of the cheap post-processing stage. Re-run whenever segmentation/depth/reconstruction settings change. */
export interface PreparedScene {
  width: number;
  height: number;
  source: ImageData;
  /** Refined foreground mask, 0..1. */
  mask: Float32Array;
  /** Refined depth, 0..1 (1 = near). */
  depth: Float32Array;
  /** Depth with the foreground region filled from its surroundings (for the background mesh). Optional. */
  backgroundDepth?: Float32Array;
  /** Background layer with the foreground removed and the hole filled. Alpha = 255. */
  background: ImageData;
  /** Foreground layer: source colors (edge-bled) with alpha = mask. */
  foreground: ImageData;
  /** False when segmentation is disabled or the mask is empty → renderer uses a single layer. */
  hasForeground: boolean;
  timings: Record<string, number>;
}

export type PipelineStage =
  | 'idle'
  | 'decode'
  | 'download-segmentation'
  | 'download-depth'
  | 'init-runtime'
  | 'segmentation'
  | 'depth'
  | 'refine'
  | 'inpaint'
  | 'done'
  | 'error';

export interface PipelineProgress {
  stage: PipelineStage;
  /** 0..1 within the stage, or -1 if indeterminate. */
  progress: number;
  message: string;
  /** For downloads. */
  loadedBytes?: number;
  totalBytes?: number;
}

export interface BackendInfo {
  webgpu: boolean;
  wasmThreads: boolean;
  crossOriginIsolated: boolean;
  hardwareConcurrency: number;
  active: 'webgpu' | 'wasm' | 'cpu' | null;
}

export interface ModelCacheEntry {
  id: string;
  label: string;
  url: string;
  sizeBytes: number;
  cached: boolean;
}

// ───────────────────────────────────────────── Module interfaces ─────────────────────────────────────────────

export interface IPipeline {
  onProgress(cb: (p: PipelineProgress) => void): () => void;
  getBackendInfo(): Promise<BackendInfo>;
  /** Decode + resize to working resolution. */
  loadImage(file: Blob, name: string, workingResolution: number): Promise<SourceImage>;
  /** Run AI models. Expensive; cached per (image, model) internally. */
  analyze(source: SourceImage, settings: Settings): Promise<RawAnalysis>;
  /** Cheap post-processing. Safe to call on every slider change (debounced by caller). */
  reconstruct(source: SourceImage, raw: RawAnalysis, settings: Settings): Promise<PreparedScene>;
  listModels(): Promise<ModelCacheEntry[]>;
  clearModelCache(): Promise<void>;
  /** Abort the in-flight analyze() if any. */
  cancel(): void;
  dispose(): void;
}

export interface RenderStats {
  fps: number;
  triangles: number;
  drawCalls: number;
  textures: number;
  gpu: string;
}

export interface IRenderer {
  /** Build/replace all scene geometry from a prepared scene. */
  setScene(scene: PreparedScene, settings: Settings): void;
  /** Apply settings live. Geometry is rebuilt only when needed (e.g. meshResolution). */
  updateSettings(settings: Settings): void;
  /** Feed normalized pointer position (-1..1, y up). Called by the viewport on pointermove. */
  setPointer(x: number, y: number): void;
  resize(width: number, height: number): void;
  resetView(): void;
  getStats(): RenderStats;
  exportGLB(): Promise<Blob>;
  /** Render a still at the given size (defaults to source aspect at 1920 long edge). */
  screenshot(width?: number, height?: number): Promise<Blob>;
  readonly canvas: HTMLCanvasElement;
  dispose(): void;
}

/** Reusable wallpaper configuration file (*.pw3d.json). */
export interface WallpaperConfig {
  format: 'paperwall3d';
  version: number; // schema version, currently 1
  appVersion: string;
  createdAt: string;
  name: string;
  settings: Settings;
  /** Optional embedded assets as data URLs (PNG for maps, original for source). */
  assets?: {
    source?: string;
    mask?: string;
    depth?: string;
    background?: string;
  };
}
