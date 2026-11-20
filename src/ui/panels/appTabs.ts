/** Properties tabs backed by application state rather than a single Settings section. */
import type { Backend, ModelCacheEntry } from '../../core/types';
import { formatBytes, h } from '../dom';
import type { AppContext } from '../context';
import { userPrefs } from '../userprefs';
import { settingsBinding } from '../widgets/binding';
import { button, checkbox, enumField } from '../widgets/controls';
import { column, infoRow, propRow, spacedRow } from '../widgets/layout';
import { numberField } from '../widgets/number';
import type { Fields } from './fields';
import { panel } from './panel';

const page = (...panels: HTMLElement[]): HTMLElement => h('div', { class: 'pw-tab-page' }, ...panels);

/** Read-only row whose text is recomputed by `update()`. */
function dynRow(label: string, text: () => string, updaters: (() => void)[]): HTMLElement {
  const value = h('span', { class: 'pw-info-text' });
  const upd = (): void => {
    value.textContent = text();
  };
  updaters.push(upd);
  upd();
  return infoRow(label, value);
}

const dims = (w: number, hh: number): string => `${w} × ${hh} px`;

export function imageTab(ctx: AppContext, f: Fields): HTMLElement {
  const upd: (() => void)[] = [];
  const refresh = (): void => upd.forEach((u) => u());
  ctx.events.on('image', refresh);
  ctx.events.on('scene', refresh);
  ctx.events.on('name', refresh);

  const reanalyze = button({
    label: 'Re-analyze',
    icon: 'refresh',
    onClick: () => ctx.ops.run('image.reanalyze'),
    tip: { desc: 'Run the segmentation and depth models again on the current image.', extra: 'Shift R' },
  });
  const source = column(
    dynRow('Name', () => ctx.source?.name ?? (ctx.isDemo ? 'Demo scene' : '—'), upd),
    dynRow('Original', () => (ctx.source ? dims(ctx.source.originalWidth, ctx.source.originalHeight) : '—'), upd),
    dynRow('Working', () => (ctx.source ? dims(ctx.source.width, ctx.source.height) : '—'), upd),
    dynRow('Foreground', () => (ctx.scene ? (ctx.scene.hasForeground ? 'Detected' : 'None (single layer)') : '—'), upd),
    h('div', { class: 'pw-spacer' }),
    spacedRow(
      button({ label: 'Open Image…', icon: 'folder', variant: 'primary', onClick: () => ctx.ops.run('file.open_image'), tip: { desc: 'Open an image (JPG, PNG or WebP).', extra: 'Ctrl O' } }).el,
      reanalyze.el,
    ),
  );
  const timings = column(
    dynRow('AI backend', () => ctx.raw?.backendUsed.toUpperCase() ?? '—', upd),
    dynRow('Segmentation', () => ctx.raw?.segmentationModel ?? (ctx.raw ? 'disabled' : '—'), upd),
    dynRow('Depth', () => ctx.raw?.depthModel ?? '—', upd),
    dynRow(
      'Analysis',
      () => {
        const t = ctx.raw?.timings;
        if (!t) return '—';
        const total = Object.values(t).reduce((a, b) => a + b, 0);
        return `${Math.round(total)} ms`;
      },
      upd,
    ),
    dynRow('Post-process', () => {
      const t = ctx.scene?.timings;
      if (!t) return '—';
      return `${Math.round(Object.values(t).reduce((a, b) => a + b, 0))} ms`;
    }, upd),
  );
  const resolution = propRow(
    'Working Res.',
    enumField<number>({
      bind: settingsBinding<number>(ctx.store, 'runtime.workingResolution'),
      options: [512, 768, 1024, 1536, 2048].map((v) => ({ value: v, label: `${v} px` })),
      tip: f.tip('runtime.workingResolution', 'Long edge of the processed image. Higher = more detail but slower. Changing it re-runs analysis.'),
    }).el,
  );
  return page(
    panel({ id: 'img.source', title: 'Source Image' }, source),
    panel({ id: 'img.processing', title: 'Processing' }, resolution, timings),
  );
}

export function outputTab(ctx: AppContext): HTMLElement {
  const outW = numberField({
    bind: userPrefs.binding('outputWidth'),
    min: 0, max: 8192, integer: true, step: 64, label: 'W', unit: ' px',
    tip: { desc: 'Width of the rendered still. 0 = automatic (source aspect, 1920 px long edge).' },
  });
  const outH = numberField({
    bind: userPrefs.binding('outputHeight'),
    min: 0, max: 8192, integer: true, step: 64, label: 'H', unit: ' px',
    tip: { desc: 'Height of the rendered still. 0 = automatic.' },
  });
  return page(
    panel(
      { id: 'out.render', title: 'Render' },
      propRow('Resolution', spacedRow(outW.el, outH.el)),
      propRow(
        null,
        button({
          label: 'Render Image',
          icon: 'aperture',
          variant: 'primary',
          onClick: () => ctx.ops.run('render.image'),
          tip: { desc: 'Render a PNG still of the current view.', extra: 'F12' },
        }).el,
      ),
    ),
    panel(
      { id: 'out.export', title: 'Export' },
      propRow(null, button({ label: 'Export GLB', icon: 'cube', onClick: () => ctx.ops.run('file.export_glb'), tip: { desc: 'Export the layered meshes as a binary glTF.', extra: 'Ctrl E' } }).el),
      propRow(null, button({ label: 'Export Wallpaper Config', icon: 'export', onClick: () => ctx.ops.run('file.export_config'), tip: { desc: 'Save the settings as a reusable .pw3d.json file.', extra: 'Ctrl Shift S' } }).el),
      propRow(
        null,
        checkbox({
          bind: userPrefs.binding('embedAssets'),
          label: 'Embed Assets',
          tip: { desc: 'Embed the source image, mask and depth maps in the config as data URLs so it opens without running AI.' },
        }).el,
      ),
    ),
    panel(
      { id: 'out.preview', title: 'Live Wallpaper' },
      h('p', { class: 'pw-note', text: 'Fullscreen preview hides all interface elements. Keep this tab open full-screen to use the scene as a live wallpaper.' }),
      propRow(null, button({ label: 'Fullscreen Preview', icon: 'fullscreen', onClick: () => ctx.ops.run('view.fullscreen_preview'), tip: { desc: 'Maximize the viewport and hide all UI.', extra: 'F11 / Ctrl Space' } }).el),
    ),
  );
}

export function systemTab(ctx: AppContext, f: Fields): HTMLElement {
  const upd: (() => void)[] = [];
  const refresh = (): void => upd.forEach((u) => u());
  ctx.events.on('backend', refresh);
  ctx.events.on('scene', refresh);

  const yesNo = (v: boolean | undefined): string => (v === undefined ? '—' : v ? 'Yes' : 'No');
  const backendPanel = column(
    dynRow('WebGPU', () => yesNo(ctx.backendInfo?.webgpu), upd),
    dynRow('WASM Threads', () => yesNo(ctx.backendInfo?.wasmThreads), upd),
    dynRow('Isolated', () => yesNo(ctx.backendInfo?.crossOriginIsolated), upd),
    dynRow('CPU Cores', () => String(ctx.backendInfo?.hardwareConcurrency ?? navigator.hardwareConcurrency ?? '—'), upd),
    dynRow('Active', () => ctx.backendInfo?.active?.toUpperCase() ?? 'Idle', upd),
  );
  const runtime = column(
    propRow(
      'Backend',
      enumField<Backend>({
        bind: settingsBinding<Backend>(ctx.store, 'runtime.backend'),
        options: [
          { value: 'auto', label: 'Auto (WebGPU, fallback WASM)' },
          { value: 'webgpu', label: 'WebGPU' },
          { value: 'wasm', label: 'WebAssembly (CPU)' },
        ],
        tip: f.tip('runtime.backend', 'Inference backend for the AI models. Changing it re-runs analysis.'),
      }).el,
    ),
    propRow(
      'Working Res.',
      enumField<number>({
        bind: settingsBinding<number>(ctx.store, 'runtime.workingResolution'),
        options: [512, 768, 1024, 1536, 2048].map((v) => ({ value: v, label: `${v} px` })),
        tip: f.tip('runtime.workingResolution', 'Long edge of the processed image.'),
      }).el,
    ),
  );

  const list = h('div', { class: 'pw-model-list' });
  let models: ModelCacheEntry[] = [];
  const renderModels = (): void => {
    list.replaceChildren();
    if (!models.length) list.appendChild(h('div', { class: 'pw-note', text: 'No model information available.' }));
    for (const m of models) {
      list.appendChild(
        h(
          'div',
          { class: 'pw-model' + (m.cached ? ' cached' : ''), title: m.url },
          h('span', { class: 'pw-model-dot' }),
          h('span', { class: 'pw-model-name', text: m.label }),
          h('span', { class: 'pw-model-size', text: formatBytes(m.sizeBytes) }),
          h('span', { class: 'pw-model-state', text: m.cached ? 'Cached' : 'Not downloaded' }),
        ),
      );
    }
  };
  const refreshModels = async (): Promise<void> => {
    try {
      models = await ctx.listModels();
    } catch {
      models = [];
    }
    renderModels();
  };
  const clearBtn = button({
    label: 'Clear Model Cache',
    icon: 'trash',
    variant: 'danger',
    onClick: async () => {
      await ctx.clearModelCache();
      await refreshModels();
    },
    tip: { desc: 'Delete downloaded AI models from browser storage. They are downloaded again on the next analysis.' },
  });
  const modelsPanel = column(
    list,
    spacedRow(
      clearBtn.el,
      button({ iconOnly: true, icon: 'refresh', onClick: () => void refreshModels(), tip: { desc: 'Refresh model list' } }).el,
    ),
  );
  ctx.ui.on('tab', (t) => {
    if (t === 'system') void refreshModels();
  });
  ctx.events.on('scene', () => void refreshModels());
  void refreshModels();

  const memory = column(
    dynRow(
      'JS Heap',
      () => {
        const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
        return m ? formatBytes(m.usedJSHeapSize) : 'n/a';
      },
      upd,
    ),
    dynRow(
      'Device RAM',
      () => {
        const d = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
        return d ? `≥ ${d} GB` : 'n/a';
      },
      upd,
    ),
  );
  window.setInterval(() => {
    if (ctx.ui.tab === 'system') refresh();
  }, 2000);

  return page(
    panel({ id: 'sys.backend', title: 'Backend' }, backendPanel),
    panel({ id: 'sys.runtime', title: 'Runtime' }, runtime),
    panel({ id: 'sys.models', title: 'Models' }, modelsPanel),
    panel({ id: 'sys.memory', title: 'Memory', defaultOpen: false }, memory),
    panel(
      { id: 'sys.privacy', title: 'Privacy' },
      h('p', { class: 'pw-note', text: 'All processing happens on your device. Images are never uploaded; AI models are downloaded once from a public CDN and cached in your browser.' }),
      propRow(null, button({ label: 'About PaperWall3D', icon: 'info', onClick: () => ctx.ops.run('window.about') }).el),
    ),
  );
}
