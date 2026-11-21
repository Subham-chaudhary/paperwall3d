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
} from '../core/types';
import type { ProjectSummary } from '../persistence/projects';
import type { OperatorRegistry } from './operators';
import type { Reports } from './reports';
import type { LayerId, UIState } from './state';

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
  readonly backendInfo: BackendInfo | null;
  sceneName: string;

  openImage(file: Blob, name?: string): Promise<void>;
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

  importConfig(file: File): Promise<void>;
  exportConfig(embedAssets: boolean): Promise<void>;
  exportGLB(): Promise<void>;
  renderImage(width?: number, height?: number): Promise<void>;

  resetView(): void;
  setLayerVisible(layer: LayerId, visible: boolean): void;
}
