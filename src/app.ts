/**
 * Application orchestrator.
 *
 * Flow
 *   openImage -> pipeline.loadImage -> pipeline.analyze (AI, expensive) -> pipeline.reconstruct -> renderer.setScene
 *   settings change -> invalidation():
 *       'analyze'     debounced (300 ms), then re-run analyze (+ reconstruct), cancelling any in-flight job
 *       'reconstruct' debounced (300 ms), latest-wins, never overlapping reconstruct -> renderer.setScene
 *       'render'      renderer.updateSettings only
 *   renderer.updateSettings is called on every change regardless.
 *
 * A monotonically increasing `gen` counter invalidates in-flight jobs: any async step that finishes
 * after a newer job started (or after cancel) drops its result.
 */
import { Emitter } from './core/events';
import { cloneSettings, DEFAULT_SETTINGS, mergeSettings } from './core/defaults';
import { PRESETS } from './core/presets';
import { sanitizeSettings } from './core/schema';
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
  StageView,
  ViewMode,
} from './core/types';
import { createPipeline } from './ai';
import { createDemoScene, createRenderer } from './render';
import { buildConfig, dataUrlToBlob, parseConfig, pngDataUrlToMap } from './persistence/config';
import { loadSettings, strictConfigJson } from './persistence/configJson';
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
import type { AppContext, AppEvents, PresetId } from './ui/context';
import { downloadBlob, stripExtension } from './ui/dom';
import { OperatorRegistry, registerOperators } from './ui/operators';
import { closeWallpaperPreview } from './ui/preview';
import { errorMessage, Reports } from './ui/reports';
import { createShell, type Shell } from './ui/shell';
import { openSplash } from './ui/splash';
import { UIState, type LayerId } from './ui/state';
import { userPrefs } from './ui/userprefs';

/** Mask/depth edits wait this long after the last change before the pipeline runs (latest request wins). */
const REBUILD_DEBOUNCE_MS = 300;
const AUTOSAVE_DEBOUNCE_MS = 500;
const IMAGE_NAME_RE = /\.(jpe?g|png|webp)$/i;

const UPLOAD_MSG = 'Running object mask → object depth… (first run loads the models)';
const REBUILD_MSG = 'Rebuilding… (changed models re-run, the rest is quick)';

/** A fresh editor session always starts in the 2D parallax view at the live Result. */
function withEditorView(s: Settings): Settings {
  const out = cloneSettings(s);
  out.view.mode = '2d';
  out.view.stage = 'result';
  return out;
}

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
  /** Status-bar message shown for the running job while the pipeline reports its stages (downloads keep their own text). */
  private jobMessage: string | null = null;

  private reconTimer: number | undefined;
  private analysisTimer: number | undefined;
  private reconRunning = false;
  private reconAgain = false;
  private autosaveTimer: number | undefined;

  constructor() {
    this.store = new SettingsStore(withEditorView(loadSettings(getPref<unknown>('settings', null)).settings));
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

  get viewportHost(): HTMLElement | null {
    return this.shell?.viewport.host ?? null;
  }

  // ───────────────────────────────────────────── startup ─────────────────────────────────────────────

  start(root: HTMLElement): void {
    this.shell = createShell(this);
    root.appendChild(this.shell.root);

    try {
      this.renderer = createRenderer(this.shell.viewport.host);
    } catch (e) {
      const msg = errorMessage(e);
      const noWebGL = e instanceof Error && e.name === 'WebGLUnavailableError';
      this.reports.error(noWebGL ? 'WebGL is unavailable in this browser. See the viewport for how to fix it.' : `3D renderer failed to start: ${msg}`, e);
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
    if (p.stage === 'error') {
      this.reports.error(p.message || 'Pipeline error');
      this.events.emit('progress', p);
      return;
    }
    // Model downloads keep the pipeline's own text; the other stages show the job's headline.
    if (this.jobMessage && !p.stage.startsWith('download')) {
      this.events.emit('progress', { ...p, message: this.jobMessage });
      return;
    }
    this.events.emit('progress', p);
  }

  private setBusy(b: boolean, message = 'Working…'): void {
    this._busy = b;
    if (!b) {
      this.jobMessage = null;
      this.events.emit('progress', null);
    } else {
      this.jobMessage = message;
      this.events.emit('progress', { stage: 'decode', progress: -1, message });
    }
  }

  // ───────────────────────────────────────────── settings flow ─────────────────────────────────────────────

  private onSettingsChanged(settings: Settings, changed: SettingsPath[]): void {
    try {
      this.renderer?.updateSettings(cloneSettings(settings));
    } catch (e) {
      this.reports.error(`Renderer update failed: ${errorMessage(e)}`, e);
    }
    this.scheduleAutosave();
    // Leaving the 2D view (a view tab was clicked) cancels Pick Object.
    if (this.ui.picking && changed.includes('view.mode') && settings.view.mode !== '2d') this.setPicking(false);
    if (this.suppress) return;

    const inv = invalidation(changed);
    if (inv === 'analyze') {
      if (!this.source) return;
      if (changed.includes('runtime.workingResolution')) void this.reloadAndAnalyze();
      else this.scheduleAnalysis();
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

  private scheduleAnalysis(): void {
    if (!this.source) return;
    window.clearTimeout(this.reconTimer);
    window.clearTimeout(this.analysisTimer);
    if (!this._busy) this.events.emit('progress', { stage: 'decode', progress: -1, message: REBUILD_MSG });
    this.analysisTimer = window.setTimeout(() => this.startAnalysis(), REBUILD_DEBOUNCE_MS);
  }

  private scheduleReconstruct(): void {
    if (!this.source || !this.raw || this.analyzing) return;
    window.clearTimeout(this.reconTimer);
    if (!this._busy) this.events.emit('progress', { stage: 'decode', progress: -1, message: REBUILD_MSG });
    this.reconTimer = window.setTimeout(() => void this.pumpReconstruct(), REBUILD_DEBOUNCE_MS);
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
        this.reports.success(this.doneMessage(null, scene));
      } while (this.reconAgain);
    } catch (e) {
      this.reports.error(`Reconstruction failed: ${errorMessage(e)}`, e);
    } finally {
      this.reconRunning = false;
      if (!this._busy) this.events.emit('progress', null);
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

  /** "Done · mask model N ms · depth model N ms · layers N ms · object covers N%" (model parts only when they ran). */
  private doneMessage(raw: RawAnalysis | null, scene: PreparedScene): string {
    const parts = ['Done'];
    const ms = (v: number | undefined): string | null => (typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v)} ms` : null);
    if (raw) {
      const mask = ms(raw.timings.segmentation);
      if (mask) parts.push(`mask model ${mask}`);
      const depth = ms(raw.timings.depth ?? raw.timings['depth-heuristic']);
      if (depth) parts.push(`depth model ${depth}`);
    }
    const layers = ms(scene.timings.total);
    if (layers) parts.push(`layers ${layers}`);
    parts.push(`object covers ${Math.round(scene.coverage * 100)}%`);
    return parts.join(' · ');
  }

  // ───────────────────────────────────────────── jobs ─────────────────────────────────────────────

  /** Run a cancellable job; later jobs and cancelJob() invalidate it. */
  private async job(label: string, message: string, fn: (gen: number) => Promise<void>): Promise<void> {
    const gen = ++this.gen;
    this.pipeline?.cancel();
    window.clearTimeout(this.reconTimer);
    window.clearTimeout(this.analysisTimer);
    this.analyzing = true;
    this.setBusy(true, message);
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
    this.reports.success(preset ? `Loaded "${source.name}"` : this.doneMessage(raw, scene));
    if (this.projectId && !preset) {
      void putAnalysis(this.projectId, this.store.get() as Settings, raw).catch((e: unknown) =>
        console.warn('Failed to cache analysis', e),
      );
    }
  }

  private startAnalysis(): void {
    void this.job('Analysis failed', REBUILD_MSG, (gen) => this.runAnalysis(gen));
  }

  /** Re-decode the original file at the current working resolution, then analyze. */
  private async reloadAndAnalyze(): Promise<void> {
    await this.job('Analysis failed', REBUILD_MSG, async (gen) => {
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

  /** Drop a picked object (its coordinates mean nothing on another image) without triggering the pipeline. */
  private async forgetPick(): Promise<void> {
    if (this.store.getValue('mask.click') === null) return;
    const next = cloneSettings(this.store.get());
    next.mask.click = null;
    await this.applySettingsSilently(next);
  }

  // ───────────────────────────────────────────── AppContext: commands ─────────────────────────────────────────────

  /** Settings with a preset's patch applied (merge + clamp). */
  private presetSettings(id: PresetId): { settings: Settings; label: string } | null {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return null;
    return { settings: sanitizeSettings(mergeSettings(preset.patch, this.store.get() as Settings)).settings, label: preset.label };
  }

  applyPreset(id: PresetId): void {
    const r = this.presetSettings(id);
    if (!r) return;
    this.store.replace(r.settings); // one undo checkpoint; the store's invalidation re-runs what changed
    this.reports.success(`Applied preset: ${r.label} (starting point)`);
  }

  async openImage(file: Blob, name?: string, presetId?: PresetId): Promise<void> {
    const fileName = name ?? (file instanceof File ? file.name : 'image');
    if (!file.type.startsWith('image/') && !IMAGE_NAME_RE.test(fileName)) {
      this.reports.error(`Unsupported file: ${fileName}. Open a JPG, PNG or WebP image.`);
      return;
    }
    const pipeline = this.getPipeline();
    if (!pipeline) return;
    this.setPicking(false);
    closeWallpaperPreview();
    await this.job('Could not open image', UPLOAD_MSG, async (gen) => {
      await this.forgetPick();
      const preset = presetId ? this.presetSettings(presetId) : null;
      if (preset) {
        await this.applySettingsSilently(preset.settings);
        this.reports.success(`Applied preset: ${preset.label} (starting point)`);
      }
      const src = await pipeline.loadImage(file, fileName, this.store.getValue('runtime.workingResolution'));
      if (gen !== this.gen) return;
      this.source = src;
      this.raw = null;
      this.projectId = null;
      this.sceneName = stripExtension(fileName) || 'Scene';
      this.events.emit('image', src);
      // Land in the 2D parallax view at the live Result.
      this.showView('2d', 'result');
      this.ui.setWorkspace('layout');
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
    window.clearTimeout(this.analysisTimer);
    this.analyzing = false;
    this.setBusy(false);
    this.reports.warn('Job cancelled');
  }

  newScene(): void {
    this.gen++;
    this.pipeline?.cancel();
    window.clearTimeout(this.reconTimer);
    window.clearTimeout(this.analysisTimer);
    this.analyzing = false;
    this.setBusy(false);
    this.setPicking(false);
    closeWallpaperPreview();
    this.source = null;
    this.raw = null;
    this.projectId = null;
    this.sceneName = 'Scene';
    this.events.emit('image', null);
    void this.applySettingsSilently(withEditorView(DEFAULT_SETTINGS)).then(() => this.showDemo());
  }

  resetSettings(): void {
    const next = cloneSettings(DEFAULT_SETTINGS);
    next.view = { ...next.view, mode: this.store.getValue('view.mode'), stage: this.store.getValue('view.stage') };
    this.store.replace(next);
    this.reports.info('Settings reset to defaults');
  }

  resetView(): void {
    this.renderer?.resetView();
  }

  showView(mode?: ViewMode, stage?: StageView): void {
    if (mode && this.store.getValue('view.mode') !== mode) this.store.set('view.mode', mode);
    if (stage && this.store.getValue('view.stage') !== stage) this.store.set('view.stage', stage);
  }

  setLayerVisible(layer: LayerId, visible: boolean): void {
    switch (layer) {
      case 'depth':
      case 'mask': {
        if (visible) this.showView('2d', layer);
        else if (this.store.getValue('view.stage') === layer) this.showView(undefined, 'result');
        break;
      }
      case 'background':
      case 'foreground':
        this.ui.setLayerVisible(layer, visible);
        this.renderer?.setLayerVisibility(layer, visible);
        break;
      default:
        this.ui.setLayerVisible(layer, visible);
    }
  }

  // ───────────────────────────────────────────── pick object ─────────────────────────────────────────────

  setPicking(on: boolean): void {
    if (on) {
      if (!this.source || !this.renderer) {
        this.reports.warn('Open an image first, then pick the object in it');
        return;
      }
      if (this.ui.previewOpen) return;
      this.showView('2d');
    }
    if (this.ui.picking === on) return;
    this.ui.setPicking(on);
    this.renderer?.setPicking(on);
    if (on) this.reports.info('Click the object you want as the main object');
  }

  pickAt(clientX: number, clientY: number): boolean {
    const p = this.renderer?.imagePointAt(clientX, clientY) ?? null;
    if (!p) return false;
    const point: [number, number] = [Number(p[0].toFixed(4)), Number(p[1].toFixed(4))];
    this.store.checkpoint();
    this.store.set('mask.click', point);
    this.setPicking(false);
    return true;
  }

  clearPick(): void {
    if (this.store.getValue('mask.click') === null) return;
    this.store.checkpoint();
    this.store.set('mask.click', null);
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
    const settings = withEditorView(loadSettings(rec.settings).settings);
    this.setPicking(false);
    closeWallpaperPreview();
    await this.job('Could not open project', UPLOAD_MSG, async (gen) => {
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
      embedAssets: embed,
    });
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${this.fileBase()}.pw3d.json`);
    this.reports.success(`Exported wallpaper config${embed ? ' with embedded assets' : ''}`);
  }

  async exportConfigJson(): Promise<void> {
    downloadBlob(new Blob([strictConfigJson(this.store.get() as Settings)], { type: 'application/json' }), 'config.json');
    this.reports.success('Exported config.json (plain JSON, 2.5dwallpp compatible)');
  }

  /** Accepts a `.pw3d.json` (v1/v2) or a bare 2.5dwallpp `config.json` (nested or flat, comments allowed). */
  async importConfig(file: File): Promise<void> {
    const parsed = parseConfig(await file.text(), this.store.get() as Settings);
    if (parsed.newer) this.reports.warn('This config was made by a newer version; unknown settings are ignored');
    if (parsed.legacy) this.reports.info('Version 1 config: only the settings that still exist were carried over; the image is analysed again');
    if (parsed.problems.length) {
      const shown = parsed.problems.slice(0, 4).join('; ');
      this.reports.warn(`Config problems: ${shown}${parsed.problems.length > 4 ? ` (+${parsed.problems.length - 4} more)` : ''}`);
    }

    if (parsed.kind === 'config') {
      // A bare config.json is merged onto the current settings; the store's invalidation re-runs what changed.
      this.store.checkpoint();
      this.store.replace(parsed.settings);
      this.reports.success('Applied config.json');
      return;
    }

    const settings = withEditorView(parsed.settings);
    const pipeline = this.getPipeline();
    await this.applySettingsSilently(settings);
    this.sceneName = parsed.name;

    const { source: srcUrl, mask: maskUrl, depth: depthUrl } = parsed.assets;
    if (srcUrl && pipeline) {
      this.setPicking(false);
      await this.job('Could not import config', UPLOAD_MSG, async (gen) => {
        const blob = await dataUrlToBlob(srcUrl);
        const src = await pipeline.loadImage(blob, parsed.name, settings.runtime.workingResolution);
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
              segmentationModel: settings.mask.use_subject ? settings.mask.mask_model : null,
              depthModel: settings.depth.model,
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
    this.reports.info('Preparing .glb…');
    const blob = await this.renderer.exportGLB();
    downloadBlob(blob, `${this.fileBase()}.glb`);
    this.reports.success('Exported GLB');
  }

  async exportHTML(): Promise<void> {
    if (!this.renderer) throw new Error('Renderer unavailable');
    this.reports.info('Preparing live wallpaper…');
    const blob = await this.renderer.exportHTML({ title: this._sceneName });
    downloadBlob(blob, `${this.fileBase()}.html`);
    this.reports.success('Exported live wallpaper (.html)');
  }

  async renderImage(width?: number, height?: number): Promise<void> {
    if (!this.renderer) throw new Error('Renderer unavailable');
    this.reports.info('Rendering PNG…');
    const blob = await this.renderer.screenshot(width, height);
    downloadBlob(blob, `${this.fileBase()}.png`);
    this.reports.success('Rendered image saved');
  }

  private fileBase(): string {
    return this._sceneName.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'paperwall3d';
  }
}
