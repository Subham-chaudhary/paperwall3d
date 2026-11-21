/**
 * Application orchestrator.
 *
 * Flow
 *   openImage -> pipeline.loadImage -> pipeline.analyze (AI, expensive) -> pipeline.reconstruct -> renderer.setScene
 *   settings change -> invalidation():
 *       'analyze'     re-run analyze (+ reconstruct), cancelling any in-flight job
 *       'reconstruct' debounced (~100 ms), latest-wins, never overlapping reconstruct -> renderer.setScene
 *       'render'      renderer.updateSettings only
 *   renderer.updateSettings is called on every change regardless.
 *
 * A monotonically increasing `gen` counter invalidates in-flight jobs: any async step that finishes
 * after a newer job started (or after cancel) drops its result.
 */
import { Emitter } from './core/events';
import { cloneSettings, DEFAULT_SETTINGS, mergeSettings } from './core/defaults';
import { invalidation, SettingsStore } from './core/store';
import type {
  BackendInfo,
  IPipeline,
  IRenderer,
  ModelCacheEntry,
  PipelineProgress,
  PreparedScene,
  RawAnalysis,
  Settings,
  SettingsPath,
  SourceImage,
} from './core/types';
import { createPipeline } from './ai';
import { createDemoScene, createRenderer } from './render';
import { buildConfig, dataUrlToBlob, parseConfig, pngDataUrlToMap } from './persistence/config';
import { getPref, setPref } from './persistence/prefs';
import {
  deleteProject,
  getAnalysis,
  getProject,
  listProjects,
  newProjectId,
  putAnalysis,
  saveProject,
  updateProjectSettings,
  type ProjectSummary,
} from './persistence/projects';
import type { AppContext, AppEvents } from './ui/context';
import { downloadBlob, stripExtension } from './ui/dom';
import { OperatorRegistry, registerOperators } from './ui/operators';
import { errorMessage, Reports } from './ui/reports';
import { createShell, type Shell } from './ui/shell';
import { openSplash } from './ui/splash';
import { UIState, type LayerId } from './ui/state';
import { userPrefs } from './ui/userprefs';

const RECONSTRUCT_DEBOUNCE_MS = 100;
const AUTOSAVE_DEBOUNCE_MS = 500;
const IMAGE_NAME_RE = /\.(jpe?g|png|webp)$/i;

export class App implements AppContext {
  readonly store: SettingsStore;
  readonly ui = new UIState();
  readonly reports = new Reports();
  readonly ops = new OperatorRegistry();
  readonly events = new Emitter<AppEvents>();

  renderer: IRenderer | null = null;
  source: SourceImage | null = null;
  raw: RawAnalysis | null = null;
  scene: PreparedScene | null = null;
  isDemo = false;
  backendInfo: BackendInfo | null = null;

  private shell: Shell | null = null;
  private pipeline: IPipeline | null = null;
  private pipelineError: string | null = null;
  private _sceneName = 'Scene';
  private _busy = false;
  private projectId: string | null = null;

  /** Incremented whenever a job starts or is cancelled; stale async results are dropped. */
  private gen = 0;
  private analyzing = false;
  private suppress = false;

  private reconTimer: number | undefined;
  private reconRunning = false;
  private reconAgain = false;
  private autosaveTimer: number | undefined;
  private readonly lastIntensity = new Map<string, number>();

  constructor() {
    this.store = new SettingsStore(mergeSettings(getPref<unknown>('settings', null)));
    this.ops.bind(this);
    registerOperators(this.ops);
  }

  get busy(): boolean {
    return this._busy;
  }

  get sceneName(): string {
    return this._sceneName;
  }

  set sceneName(v: string) {
    if (v === this._sceneName) return;
    this._sceneName = v;
    this.events.emit('name', v);
    this.scheduleAutosave();
  }

  // ───────────────────────────────────────────── startup ─────────────────────────────────────────────

  start(root: HTMLElement): void {
    this.shell = createShell(this);
    root.appendChild(this.shell.root);

    try {
      this.renderer = createRenderer(this.shell.viewport.host);
    } catch (e) {
      const msg = errorMessage(e);
      this.reports.error(`3D renderer failed to start: ${msg}`, e);
      this.shell.viewport.showUnavailable(msg);
    }

    this.showDemo();
    this.store.subscribe((settings, changed) => this.onSettingsChanged(settings, changed));

    void this.refreshBackend();
    if (userPrefs.get('showSplash')) openSplash(this);
    void this.recentProjects()
      .then(() => this.events.emit('recents', undefined))
      .catch(() => undefined);
  }

  private showDemo(): void {
    try {
      const demo = createDemoScene();
      this.scene = demo;
      this.isDemo = true;
      this.renderer?.setScene(demo, cloneSettings(this.store.get()));
      this.events.emit('scene', demo);
    } catch (e) {
      this.reports.error(`Demo scene unavailable: ${errorMessage(e)}`, e);
    }
  }

  /** Lazily create the pipeline. Construction must not download models. */
  private getPipeline(): IPipeline | null {
    if (this.pipeline) return this.pipeline;
    if (this.pipelineError) return null;
    try {
      const p = createPipeline();
      p.onProgress((prog) => this.onProgress(prog));
      this.pipeline = p;
      return p;
    } catch (e) {
      this.pipelineError = errorMessage(e);
      this.reports.error(`AI pipeline unavailable: ${this.pipelineError}`, e);
      return null;
    }
  }

  private async refreshBackend(): Promise<void> {
    const p = this.getPipeline();
    if (!p) return;
    try {
      this.backendInfo = await p.getBackendInfo();
      this.events.emit('backend', this.backendInfo);
    } catch (e) {
      console.warn('getBackendInfo failed', e);
    }
  }

  private onProgress(p: PipelineProgress): void {
    if (p.stage === 'error') this.reports.error(p.message || 'Pipeline error');
    this.events.emit('progress', p);
  }

  private setBusy(b: boolean): void {
    this._busy = b;
    if (!b) this.events.emit('progress', null);
    else this.events.emit('progress', { stage: 'decode', progress: -1, message: 'Working…' });
  }

  // ───────────────────────────────────────────── settings flow ─────────────────────────────────────────────

  private onSettingsChanged(settings: Settings, changed: SettingsPath[]): void {
    try {
      this.renderer?.updateSettings(cloneSettings(settings));
    } catch (e) {
      this.reports.error(`Renderer update failed: ${errorMessage(e)}`, e);
    }
    this.scheduleAutosave();
    if (this.suppress) return;

    const inv = invalidation(changed);
    if (inv === 'analyze') {
      if (!this.source) return;
      if (changed.includes('runtime.workingResolution')) void this.reloadAndAnalyze();
      else this.startAnalysis();
    } else if (inv === 'reconstruct') {
      this.scheduleReconstruct();
    }
  }

  /** Apply settings without triggering invalidation (the caller runs the pipeline itself). */
  private async applySettingsSilently(next: Settings): Promise<void> {
    this.suppress = true;
    try {
      this.store.replace(next);
      // The store notifies in a microtask queued before this one, so the flag covers that notification.
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    } finally {
      this.suppress = false;
    }
  }

  private scheduleReconstruct(): void {
    if (!this.source || !this.raw || this.analyzing) return;
    window.clearTimeout(this.reconTimer);
    this.reconTimer = window.setTimeout(() => void this.pumpReconstruct(), RECONSTRUCT_DEBOUNCE_MS);
  }

  /** Latest-wins reconstruct loop: never runs two reconstructs concurrently. */
  private async pumpReconstruct(): Promise<void> {
    if (this.reconRunning) {
      this.reconAgain = true;
      return;
    }
    this.reconRunning = true;
    try {
      do {
        this.reconAgain = false;
        const pipeline = this.pipeline;
        const source = this.source;
        const raw = this.raw;
        const gen = this.gen;
        if (!pipeline || !source || !raw || this.analyzing) break;
        const scene = await pipeline.reconstruct(source, raw, cloneSettings(this.store.get()));
        if (gen !== this.gen || source !== this.source || this.reconAgain) continue;
        this.applyScene(scene);
      } while (this.reconAgain);
    } catch (e) {
      this.reports.error(`Reconstruction failed: ${errorMessage(e)}`, e);
    } finally {
      this.reconRunning = false;
    }
  }

  private applyScene(scene: PreparedScene): void {
    this.scene = scene;
    this.isDemo = false;
    try {
      this.renderer?.setScene(scene, cloneSettings(this.store.get()));
    } catch (e) {
      this.reports.error(`Renderer failed to build the scene: ${errorMessage(e)}`, e);
    }
    this.events.emit('scene', scene);
  }

  // ───────────────────────────────────────────── jobs ─────────────────────────────────────────────

  /** Run a cancellable job; later jobs and cancelJob() invalidate it. */
  private async job(label: string, fn: (gen: number) => Promise<void>): Promise<void> {
    const gen = ++this.gen;
    this.pipeline?.cancel();
    window.clearTimeout(this.reconTimer);
    this.analyzing = true;
    this.setBusy(true);
    try {
      await fn(gen);
    } catch (e) {
      if (gen === this.gen) this.reports.error(`${label}: ${errorMessage(e)}`, e);
    } finally {
      if (gen === this.gen) {
        this.analyzing = false;
        this.setBusy(false);
      }
    }
  }

  private async runAnalysis(gen: number, preset?: RawAnalysis): Promise<void> {
    const pipeline = this.getPipeline();
    const source = this.source;
    if (!pipeline || !source) throw new Error(this.pipelineError ?? 'No image loaded');
    const t0 = performance.now();
    const raw = preset ?? (await pipeline.analyze(source, cloneSettings(this.store.get())));
    if (gen !== this.gen) return;
    this.raw = raw;
    if (this.backendInfo) {
      this.backendInfo = { ...this.backendInfo, active: raw.backendUsed };
      this.events.emit('backend', this.backendInfo);
    }
    const scene = await pipeline.reconstruct(source, raw, cloneSettings(this.store.get()));
    if (gen !== this.gen) return;
    this.applyScene(scene);
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    this.reports.success(
      preset ? `Loaded "${source.name}"` : `Analysis complete in ${secs}s (${raw.backendUsed.toUpperCase()})`,
    );
    if (this.projectId && !preset) {
      void putAnalysis(this.projectId, this.store.get() as Settings, raw).catch((e: unknown) =>
        console.warn('Failed to cache analysis', e),
      );
    }
  }

  private startAnalysis(): void {
    void this.job('Analysis failed', (gen) => this.runAnalysis(gen));
  }

  /** Re-decode the original file at the current working resolution, then analyze. */
  private async reloadAndAnalyze(): Promise<void> {
    await this.job('Analysis failed', async (gen) => {
      const pipeline = this.getPipeline();
      const old = this.source;
      if (!pipeline || !old) return;
      const src = await pipeline.loadImage(old.blob, old.name, this.store.getValue('runtime.workingResolution'));
      if (gen !== this.gen) return;
      this.source = src;
      this.raw = null;
      this.events.emit('image', src);
      await this.runAnalysis(gen);
    });
  }

  // ───────────────────────────────────────────── AppContext: commands ─────────────────────────────────────────────

  async openImage(file: Blob, name?: string): Promise<void> {
    const fileName = name ?? (file instanceof File ? file.name : 'image');
    if (!file.type.startsWith('image/') && !IMAGE_NAME_RE.test(fileName)) {
      this.reports.error(`Unsupported file: ${fileName}. Open a JPG, PNG or WebP image.`);
      return;
    }
    const pipeline = this.getPipeline();
    if (!pipeline) return;
    await this.job('Could not open image', async (gen) => {
      const src = await pipeline.loadImage(file, fileName, this.store.getValue('runtime.workingResolution'));
      if (gen !== this.gen) return;
      this.source = src;
      this.raw = null;
      this.projectId = null;
      this.sceneName = stripExtension(fileName) || 'Scene';
      this.events.emit('image', src);
      await this.runAnalysis(gen);
    });
  }

  reanalyze(): void {
    if (!this.source) return;
    void this.reloadAndAnalyze();
  }

  cancelJob(): void {
    if (!this._busy) return;
    this.gen++;
    this.pipeline?.cancel();
    window.clearTimeout(this.reconTimer);
    this.analyzing = false;
    this.setBusy(false);
    this.reports.warn('Job cancelled');
  }

  newScene(): void {
    this.gen++;
    this.pipeline?.cancel();
    this.analyzing = false;
    this.setBusy(false);
    this.source = null;
    this.raw = null;
    this.projectId = null;
    this.sceneName = 'Scene';
    this.events.emit('image', null);
    void this.applySettingsSilently(cloneSettings(DEFAULT_SETTINGS)).then(() => this.showDemo());
  }

  resetSettings(): void {
    this.store.replace(cloneSettings(DEFAULT_SETTINGS));
    this.reports.info('Settings reset to defaults');
  }

  resetView(): void {
    this.renderer?.resetView();
  }

  setLayerVisible(layer: LayerId, visible: boolean): void {
    const s = this.store;
    const toggleIntensity = (path: 'lighting.keyIntensity' | 'lighting.rimIntensity'): void => {
      const cur = s.getValue(path);
      s.checkpoint();
      if (!visible) {
        if (cur > 0) this.lastIntensity.set(path, cur);
        s.set(path, 0);
      } else if (cur <= 0) {
        s.set(path, this.lastIntensity.get(path) ?? DEFAULT_SETTINGS.lighting[path === 'lighting.keyIntensity' ? 'keyIntensity' : 'rimIntensity']);
      }
    };
    switch (layer) {
      case 'keyLight':
        toggleIntensity('lighting.keyIntensity');
        break;
      case 'rimLight':
        toggleIntensity('lighting.rimIntensity');
        break;
      case 'depth':
      case 'mask': {
        const mode = layer === 'depth' ? 'depth' : 'mask';
        if (visible) s.set('view.mode', mode);
        else if (s.getValue('view.mode') === mode) s.set('view.mode', 'render');
        break;
      }
      case 'background':
      case 'foreground': {
        this.ui.setLayerVisible(layer, visible);
        this.renderer?.setLayerVisibility(layer, visible);
        break;
      }
      default:
        this.ui.setLayerVisible(layer, visible);
    }
  }

  // ───────────────────────────────────────────── models ─────────────────────────────────────────────

  async listModels(): Promise<ModelCacheEntry[]> {
    const p = this.getPipeline();
    return p ? p.listModels() : [];
  }

  async clearModelCache(): Promise<void> {
    const p = this.getPipeline();
    if (!p) return;
    try {
      await p.clearModelCache();
      this.reports.success('Model cache cleared');
    } catch (e) {
      this.reports.error(`Could not clear the model cache: ${errorMessage(e)}`, e);
    }
  }

  // ───────────────────────────────────────────── persistence ─────────────────────────────────────────────

  async saveProject(): Promise<void> {
    const source = this.source;
    if (!source) {
      this.reports.warn('Nothing to save: open an image first');
      return;
    }
    const id = this.projectId ?? newProjectId();
    const existing = this.projectId ? await getProject(this.projectId).catch(() => undefined) : undefined;
    const now = Date.now();
    await saveProject({
      id,
      name: this._sceneName,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      settings: cloneSettings(this.store.get()),
      sourceBlob: source.blob,
      thumbnailBlob: await this.makeThumbnail(),
    });
    if (this.raw) await putAnalysis(id, this.store.get() as Settings, this.raw);
    this.projectId = id;
    this.events.emit('recents', undefined);
    this.reports.success(`Saved "${this._sceneName}" to browser storage`);
  }

  async openProject(id: string): Promise<void> {
    const pipeline = this.getPipeline();
    if (!pipeline) return;
    const rec = await getProject(id);
    if (!rec) {
      this.reports.error('That project no longer exists');
      return;
    }
    const settings = mergeSettings(rec.settings);
    await this.job('Could not open project', async (gen) => {
      await this.applySettingsSilently(settings);
      const src = await pipeline.loadImage(rec.sourceBlob, rec.name, settings.runtime.workingResolution);
      if (gen !== this.gen) return;
      this.source = src;
      this.raw = null;
      this.projectId = rec.id;
      this.sceneName = rec.name;
      this.events.emit('image', src);
      const cached = await getAnalysis(rec.id, settings).catch(() => null);
      if (gen !== this.gen) return;
      await this.runAnalysis(gen, cached ?? undefined);
    });
  }

  recentProjects(): Promise<ProjectSummary[]> {
    return listProjects(12);
  }

  async deleteProject(id: string): Promise<void> {
    await deleteProject(id);
    if (this.projectId === id) this.projectId = null;
    this.events.emit('recents', undefined);
  }

  private scheduleAutosave(): void {
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      setPref('settings', this.store.get());
      if (this.projectId) {
        void updateProjectSettings(this.projectId, cloneSettings(this.store.get()), this._sceneName).catch((e: unknown) =>
          console.warn('Project autosave failed', e),
        );
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  private makeThumbnail(): Promise<Blob | null> {
    const scene = this.scene;
    if (!scene || this.isDemo) return Promise.resolve(null);
    const full = document.createElement('canvas');
    full.width = scene.source.width;
    full.height = scene.source.height;
    full.getContext('2d')?.putImageData(scene.source, 0, 0);
    const s = Math.min(1, 256 / Math.max(full.width, full.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(full.width * s));
    c.height = Math.max(1, Math.round(full.height * s));
    c.getContext('2d')?.drawImage(full, 0, 0, c.width, c.height);
    return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/jpeg', 0.8));
  }

  // ───────────────────────────────────────────── config import / export ─────────────────────────────────────────────

  async exportConfig(embedAssets: boolean): Promise<void> {
    let embed = embedAssets;
    if (embed && !this.source) {
      this.reports.warn('No image loaded: exporting settings only');
      embed = false;
    }
    const cfg = await buildConfig({
      name: this._sceneName,
      settings: cloneSettings(this.store.get()),
      source: this.source,
      raw: this.raw,
      scene: this.isDemo ? null : this.scene,
      embedAssets: embed,
    });
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${this.fileBase()}.pw3d.json`);
    this.reports.success(`Exported wallpaper config${embed ? ' with embedded assets' : ''}`);
  }

  async importConfig(file: File): Promise<void> {
    const parsed = parseConfig(await file.text());
    if (parsed.newer) this.reports.warn('This config was made by a newer version; unknown settings are ignored');
    const pipeline = this.getPipeline();
    await this.applySettingsSilently(parsed.settings);
    this.sceneName = parsed.name;

    const { source: srcUrl, mask: maskUrl, depth: depthUrl } = parsed.assets;
    if (srcUrl && pipeline) {
      await this.job('Could not import config', async (gen) => {
        const blob = await dataUrlToBlob(srcUrl);
        const src = await pipeline.loadImage(blob, parsed.name, parsed.settings.runtime.workingResolution);
        if (gen !== this.gen) return;
        this.source = src;
        this.raw = null;
        this.projectId = null;
        this.events.emit('image', src);
        let preset: RawAnalysis | undefined;
        if (maskUrl && depthUrl) {
          const [m, d] = await Promise.all([pngDataUrlToMap(maskUrl), pngDataUrlToMap(depthUrl)]);
          if (m.width === d.width && m.height === d.height && m.width === src.width && m.height === src.height) {
            preset = {
              width: m.width,
              height: m.height,
              rawMask: m.data,
              rawDepth: d.data,
              segmentationModel: parsed.settings.segmentation.enabled ? parsed.settings.segmentation.model : null,
              depthModel: parsed.settings.depth.model,
              backendUsed: 'cpu',
              timings: { embedded: 0 },
            };
          }
        }
        if (gen !== this.gen) return;
        await this.runAnalysis(gen, preset);
      });
    } else if (this.source) {
      this.reports.success(`Applied settings from "${parsed.name}"`);
      this.startAnalysis();
    } else {
      this.reports.success(`Loaded settings from "${parsed.name}". Open an image to apply them.`);
    }
  }

  // ───────────────────────────────────────────── export ─────────────────────────────────────────────

  async exportGLB(): Promise<void> {
    if (!this.renderer) throw new Error('Renderer unavailable');
    this.reports.info('Exporting GLB…');
    const blob = await this.renderer.exportGLB();
    downloadBlob(blob, `${this.fileBase()}.glb`);
    this.reports.success('Exported GLB');
  }

  async renderImage(width?: number, height?: number): Promise<void> {
    if (!this.renderer) throw new Error('Renderer unavailable');
    const blob = await this.renderer.screenshot(width, height);
    downloadBlob(blob, `${this.fileBase()}.png`);
    this.reports.success('Rendered image saved');
  }

  private fileBase(): string {
    return this._sceneName.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'paperwall3d';
  }
}
