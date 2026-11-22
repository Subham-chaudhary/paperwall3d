/** The surface the UI layer uses to talk to the application orchestrator (src/app.ts). */
import type { Emitter } from '../core/events';
import type { SettingsStore } from '../core/store';
import type {
  BackendInfo,
  IRenderer,
  ModelCacheEntry,
  PipelineProgress,
  PreparedScene,
  RawAnalysis,
  SourceImage,
  StageView,
  ViewMode,
} from '../core/types';
import type { PresetId } from '../core/presets';
import type { ProjectSummary } from '../persistence/projects';
import type { OperatorRegistry } from './operators';
import type { Reports } from './reports';
import type { LayerId, UIState } from './state';

export type { PresetId } from '../core/presets';

export interface AppEvents extends Record<string, unknown> {
  /** A new source image was loaded (or cleared). */
  image: SourceImage | null;
  /** A new PreparedScene (or the demo scene) was handed to the renderer. */
  scene: PreparedScene;
  /** Pipeline progress; null when no job is running. */
  progress: PipelineProgress | null;
  backend: BackendInfo | null;
  /** Scene/project name changed. */
  name: string;
  /** Recent projects list may have changed. */
  recents: void;
}

export interface AppContext {
  readonly store: SettingsStore;
  readonly ui: UIState;
  readonly reports: Reports;
  readonly ops: OperatorRegistry;
  readonly events: Emitter<AppEvents>;

  readonly renderer: IRenderer | null;
  readonly source: SourceImage | null;
  readonly raw: RawAnalysis | null;
  readonly scene: PreparedScene | null;
  /** True while the placeholder demo scene is shown. */
  readonly isDemo: boolean;
  readonly busy: boolean;
  /** The element the renderer lives in (moved into the wallpaper preview frame while it is open). */
  readonly viewportHost: HTMLElement | null;
  readonly backendInfo: BackendInfo | null;
  sceneName: string;

  /** `presetId`: apply that preset (src/core/presets.ts) before analysing. */
  openImage(file: Blob, name?: string, presetId?: PresetId): Promise<void>;
  /** Apply a preset to the current settings (one undo step). */
  applyPreset(id: PresetId): void;
  reanalyze(): void;
  cancelJob(): void;
  newScene(): void;
  resetSettings(): void;

  listModels(): Promise<ModelCacheEntry[]>;
  clearModelCache(): Promise<void>;

  saveProject(): Promise<void>;
  openProject(id: string): Promise<void>;
  recentProjects(): Promise<ProjectSummary[]>;
  deleteProject(id: string): Promise<void>;

  /** Accepts a `.pw3d.json` (v1/v2) or a bare 2.5dwallpp `config.json`. */
  importConfig(file: File): Promise<void>;
  /** `.pw3d.json` (v2), optionally with the source image and maps embedded. */
  exportConfig(embedAssets: boolean): Promise<void>;
  /** Plain 2.5dwallpp-compatible `config.json` (shared sections, no comments). */
  exportConfigJson(): Promise<void>;
  exportGLB(): Promise<void>;
  /** Self-contained live HTML wallpaper (renderer.exportHTML). */
  exportHTML(): Promise<void>;
  renderImage(width?: number, height?: number): Promise<void>;

  resetView(): void;
  setLayerVisible(layer: LayerId, visible: boolean): void;
  /** Enter/leave Pick Object mode (status hint + renderer.setPicking). Picking is only possible in the 2D view. */
  setPicking(on: boolean): void;
  /** A click in the viewport while picking: map to image coordinates and set `mask.click`. Returns false if outside the image. */
  pickAt(clientX: number, clientY: number): boolean;
  clearPick(): void;
  /** Switch view and/or stage (no undo checkpoint). */
  showView(mode?: ViewMode, stage?: StageView): void;
}
