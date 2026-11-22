/**
 * Shared contracts between the AI pipeline (src/ai, src/imaging),
 * the renderer (src/render) and the UI shell (src/ui).
 *
 * Settings schema v2 mirrors the 2.5dwallpp config.json document: the sections `parallax`, `layers`,
 * `mask`, `depth` and `camera3d` use exactly the same key names, ranges and defaults, so a config.json
 * from either app can be pasted into the other. `view`, `wallpaper` and `runtime` are PaperWall3D-only.
 *
 * Conventions
 * - All per-pixel maps are row-major Float32Array of length width*height, values in 0..1 unless stated.
 * - depth: 1 = nearest to camera, 0 = farthest.
 * - mask:  1 = main object, 0 = background.
 * - Image coordinates for `click` / `center`: [x, y] in 0..1, origin top-left.
 * - "working resolution": the long edge of the processed image (Settings.runtime.workingResolution).
 */

// ───────────────────────────────────────────── Settings ─────────────────────────────────────────────

export type SegmentationModelId = 'u2netp' | 'u2net';
export type DepthModelId = 'depth-anything-v2-small' | 'heuristic';
export type Backend = 'auto' | 'webgpu' | 'wasm';
/** Which editor the viewport shows: live 2D parallax wallpaper, true 3D orbit camera, or the config.json editor. */
export type ViewMode = '2d' | '3d' | 'config';
/** Pipeline stage overlay in the 2D view (a tuning aid). `result` = the live render. */
export type StageView = 'result' | 'mask' | 'objdepth' | 'depth';
/** Where depth is applied: `subject` = flat background plane + object relief; `all` = whole-image depth. */
export type LayerScope = 'subject' | 'all';
export type WallpaperAspect = 'screen' | '16:9' | '16:10' | '21:9' | '32:9' | '9:19.5' | '1:1';

/** 2D parallax view (view-only, instant). */
export interface ParallaxSettings {
  /** Camera shift as a fraction of the image (0..0.12, step 0.002). Default 0.04. */
  strength: number;
  /** Depth that stays fixed in place, 0 = far, 1 = near (0..1). Default 0.5. */
  focus: number;
  /** 3D tilt of the whole picture toward the cursor, degrees (0..20, step 0.5). Default 5. */
  tilt: number;
  /** Depth-based shading that follows the cursor (0..1). Default 0.25. */
  lighting: number;
  /** Per-frame lerp factor of cursor follow, higher = snappier (0.02..0.4). Default 0.12. */
  smoothing: number;
  /** Move on its own, no mouse needed. */
  autoMotion: boolean;
  /** Inverse parallax direction (default true). */
  inverse: boolean;
}

/** Layer composition, shared by the 2D and 3D views (view-only, instant). */
export interface LayerSettings {
  scope: LayerScope;
  /** Depth of the flat background plane in scope "subject" (0..1). Default 0.2. */
  backgroundDepth: number;
  /** Scale of the object around its own centre (0.3..2). Default 1. */
  objectSize: number;
  /** How far the object's shape sticks out in scope "subject" (0..1.5). Default 0.5. */
  objectRelief: number;
}

/** Stage 1 · object mask. `mask_model`, `flip_avg`, `refine`, `use_subject` re-run the masker; the rest is post-processing. */
export interface MaskSettings {
  /** Separate the object from the background at all. */
  use_subject: boolean;
  mask_model: SegmentationModelId;
  /** Average with a mirrored pass (steadier mask, 2x slower). */
  flip_avg: boolean;
  /** Second pass zoomed in on the object found by the first (bbox of prob>0.5, padded 15%). */
  refine: boolean;
  /** Min-max normalise the model's confidence (threshold becomes relative). */
  mask_norm: boolean;
  /** Confidence threshold, lower includes more (0.05..0.95). Default 0.5. */
  thresh: number;
  /** Grow the mask over near-depth regions (can flood into the ground). Default off. */
  depth_assist: boolean;
  /** Drop blobs smaller than this, % of the image (0..10, step 0.1). Default 0.2. */
  min_area: number;
  /** Keep only the biggest object. */
  largest_only: boolean;
  /** Fill holes inside the object. Default on. */
  fill_holes: boolean;
  /** Swap object and background. */
  mask_invert: boolean;
  /** Grow (+) / shrink (-) the cut-out, px (-40..40). */
  grow: number;
  /** Blur the cut-out's edge, px (0..20). Default 2. */
  feather: number;
  /** Ignore this many px of the blurry rim when taking object depth and colour (0..20). Default 4. */
  rim: number;
  /** Object picked by clicking: [x, y] in 0..1 image coordinates, or null for automatic. */
  click: [number, number] | null;
}

/** Stage 2 · object depth. `model` and `depth_size` re-run the depth model; the rest is post-processing. */
export interface DepthSettings {
  /** PaperWall3D extra: `heuristic` = offline fallback, no model download. */
  model: DepthModelId;
  /** Short side fed to the depth model, px (252..1008, step 14). Default 518. */
  depth_size: number;
  /** Percentile clipped at the near end (0..40, step 0.5). Default 1. */
  clip_lo: number;
  /** Percentile clipped at the far end (60..100, step 0.5). Default 99. */
  clip_hi: number;
  /** Gaussian smoothing of the depth map, sigma px (0..6, step 0.1). Default 1.2. */
  smooth: number;
  /** Below 1 pushes mid depths forward, above 1 pushes them back (0.3..3, step 0.05). Default 1. */
  gamma: number;
  /** Flip near and far. */
  depth_invert: boolean;
  /** Snap depth edges to the photo's edges, radius px (0..30, 0 = off). Default 0. */
  edge_snap: number;
}

/** 3D camera view (true orbit) + GLB export geometry (view-only, instant). */
export interface Camera3DSettings {
  /** Mesh resolution along the long side (64..512, step 32). Default 256. */
  segs: number;
  /** How far depth sticks out, image height = 1 (0..2, step 0.02). Default 0.6. */
  zscale: number;
  /** Drop triangles stretched across a depth cliff beyond this step (0.02..0.6). Default 0.25. */
  tear: number;
  wire: boolean;
  /** Colour by depth. */
  depthcol: boolean;
  /** Show the background plane. Default on. */
  showbg: boolean;
  /** Auto-rotate the camera. */
  rotate: boolean;
}

/** PaperWall3D-only: editor view state. */
export interface ViewSettings {
  mode: ViewMode;
  stage: StageView;
  background: string;
  showStats: boolean;
}

/** PaperWall3D-only: the wallpaper preview shown before export. */
export interface WallpaperSettings {
  /** Preview frame aspect; `screen` = the user's actual screen aspect. */
  aspect: WallpaperAspect;
  /** Show a desktop-like clock/date overlay to judge the wallpaper in context. */
  overlay: boolean;
}

export interface RuntimeSettings {
  backend: Backend;
  /** Long edge of the processed image in pixels. */
  workingResolution: 768 | 1024 | 1600 | 2048;
}

export interface Settings {
  parallax: ParallaxSettings;
  layers: LayerSettings;
  mask: MaskSettings;
  depth: DepthSettings;
  camera3d: Camera3DSettings;
  view: ViewSettings;
  wallpaper: WallpaperSettings;
  runtime: RuntimeSettings;
}

export type SettingsSection = keyof Settings;

/** Dot path into Settings, e.g. "mask.thresh". */
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

/** Output of the expensive AI stage. Re-run only when a model-affecting setting changes (see store `invalidation`). */
export interface RawAnalysis {
  width: number;
  height: number;
  /** Object probability 0..1 at working resolution (after flip-average / zoom-in pass). All zeros if no masker ran. */
  rawMask: Float32Array;
  /**
   * Raw depth-model output upsampled (bilinear) to working resolution: relative inverse depth, bigger = nearer,
   * NOT normalised (percentile clipping happens in reconstruct, driven by depth.clip_lo/clip_hi).
   */
  rawDepth: Float32Array;
  segmentationModel: SegmentationModelId | null;
  depthModel: DepthModelId;
  backendUsed: 'webgpu' | 'wasm' | 'cpu';
  timings: Record<string, number>;
}

/**
 * Output of the cheap post-processing stage (the 2.5dwallpp layer set).
 * Re-run whenever a non-model mask/depth setting changes.
 */
export interface PreparedScene {
  width: number;
  height: number;
  /** Working-resolution source colours. */
  source: ImageData;
  /** Stage 1: main object mask = final alpha (thresholded, cleaned, grown, feathered), 0..1. */
  mask: Float32Array;
  /** Whole-image depth, finished (clip, smooth, edge snap, gamma, invert), 0..1. */
  depth: Float32Array;
  /** Background colour with the object inpainted out (hole = mask>0.01 dilated). Alpha 255. */
  bgColor: ImageData;
  /** Whole-image depth with the object inpainted out (scope "all" background). */
  bgDepth: Float32Array;
  /** Object RGBA: defringed colours, alpha = mask. */
  fg: ImageData;
  /** Object depth in the true range, rim fixed by nearest fill from inside (scope "all" object). */
  fgDepth: Float32Array;
  /** Object depth re-scaled to 0..1 by percentiles inside the mask, 0 beyond the edge band (scope "subject"). */
  objDepth: Float32Array;
  /** Object centroid [x, y] in 0..1 image coordinates (pivot for objectSize). [0.5, 0.5] if no object. */
  center: [number, number];
  /** Fraction of the image covered by the object, 0..1. */
  coverage: number;
  /** False when use_subject is off or the mask is empty → single-layer rendering. */
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
  /** Run AI models. Expensive; cached per (image, model key) internally. */
  analyze(source: SourceImage, settings: Settings): Promise<RawAnalysis>;
  /** Cheap post-processing → layer set. Safe to call on every slider change (debounced by caller). */
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

/** `editor`: image contain-fitted in the viewport. `wallpaper`: cover-fitted, no overlays/grid (preview before export). */
export type Presentation = 'editor' | 'wallpaper';

export interface IRenderer {
  /** Replace all scene resources from a prepared scene. */
  setScene(scene: PreparedScene, settings: Settings): void;
  /** Apply settings live (parallax, layers, camera3d, view.mode, view.stage, view.background). */
  updateSettings(settings: Settings): void;
  /** Normalized pointer position (-1..1, y up) for the 2D parallax. The 3D view handles its own orbit input. */
  setPointer(x: number, y: number): void;
  resize(width: number, height: number): void;
  /** Reset the 3D orbit camera and the 2D cursor smoothing. */
  resetView(): void;
  /** Show/hide one layer in both views. Persists across setScene() calls. */
  setLayerVisibility(layer: 'background' | 'foreground', visible: boolean): void;
  setPresentation(mode: Presentation): void;
  /** Picking mode: show the untilted, unshifted source so the user can click the object. */
  setPicking(on: boolean): void;
  /** Map a client (CSS px) point to image coordinates [x, y] in 0..1 in the 2D view, or null if outside the image. */
  imagePointAt(clientX: number, clientY: number): [number, number] | null;
  getStats(): RenderStats;
  /** GLB built from the layers with the current camera3d/layers settings (same triangle dropping as the 3D view). */
  exportGLB(): Promise<Blob>;
  /** Render the current 2D parallax view as a still (defaults to source aspect at 1920 long edge). */
  screenshot(width?: number, height?: number): Promise<Blob>;
  /**
   * Self-contained live wallpaper page (text/html): the 2D parallax shader + the layer textures as data URIs,
   * current parallax/layers settings baked in, cover-fit, input = cursor, auto motion fallback, device orientation
   * (gyro) on phones. Works as a web wallpaper in Wallpaper Engine / Lively or opened in any browser.
   */
  exportHTML(options?: { title?: string }): Promise<Blob>;
  readonly canvas: HTMLCanvasElement;
  dispose(): void;
}

/** Reusable wallpaper configuration file (*.pw3d.json). The bare `settings` object is 2.5dwallpp config.json-compatible. */
export interface WallpaperConfig {
  format: 'paperwall3d';
  version: number; // schema version, currently 2
  appVersion: string;
  createdAt: string;
  name: string;
  settings: Settings;
  /** Optional embedded assets as data URLs (PNG for maps, original for source). */
  assets?: {
    source?: string;
    mask?: string;
    depth?: string;
  };
}
