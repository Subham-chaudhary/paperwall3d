/** Properties tabs backed by application state (image info, system). Settings fields live in the Scene tab categories. */
import type { ModelCacheEntry } from '../../core/types';
import { formatBytes, h } from '../dom';
import type { AppContext } from '../context';
import { button } from '../widgets/controls';
import { column, infoRow, propRow, spacedRow } from '../widgets/layout';
import { panel } from './panel';
import { page } from './settingsTabs';

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

export function imageTab(ctx: AppContext): HTMLElement {
  const upd: (() => void)[] = [];
  const refresh = (): void => upd.forEach((u) => u());
  ctx.events.on('image', refresh);
  ctx.events.on('scene', refresh);
  ctx.events.on('name', refresh);

  const source = column(
    dynRow('Name', () => ctx.source?.name ?? (ctx.isDemo ? 'Demo scene' : '—'), upd),
    dynRow('Original', () => (ctx.source ? dims(ctx.source.originalWidth, ctx.source.originalHeight) : '—'), upd),
    dynRow('Working', () => (ctx.source ? dims(ctx.source.width, ctx.source.height) : '—'), upd),
    dynRow('Main Object', () => (ctx.scene ? (ctx.scene.hasForeground ? `${(ctx.scene.coverage * 100).toFixed(1)} % of the image` : 'None (single layer)') : '—'), upd),
    h('div', { class: 'pw-spacer' }),
    spacedRow(
      button({ label: 'Open Image…', icon: 'folder', variant: 'primary', onClick: () => ctx.ops.run('file.open_image'), tip: { desc: 'Open an image (JPG, PNG or WebP).', extra: 'Ctrl O' } }).el,
      button({ label: 'Re-analyze', icon: 'refresh', onClick: () => ctx.ops.run('image.reanalyze'), tip: { desc: 'Run the object-mask and depth models again on the current image.', extra: 'Shift R' } }).el,
    ),
  );
  const analysis = column(
    dynRow('AI backend', () => ctx.raw?.backendUsed.toUpperCase() ?? '—', upd),
    dynRow('Mask model', () => ctx.raw?.segmentationModel ?? (ctx.raw ? 'off' : '—'), upd),
    dynRow('Depth model', () => ctx.raw?.depthModel ?? '—', upd),
    dynRow(
      'Analysis',
      () => {
        const t = ctx.raw?.timings;
        if (!t) return '—';
        return `${Math.round(Object.values(t).reduce((a, b) => a + b, 0))} ms`;
      },
      upd,
    ),
    dynRow(
      'Post-process',
      () => {
        const t = ctx.scene?.timings;
        if (!t) return '—';
        return `${Math.round(Object.values(t).reduce((a, b) => a + b, 0))} ms`;
      },
      upd,
    ),
  );
  return page(
    panel({ id: 'img.source', title: 'Source Image' }, source),
    panel({ id: 'img.analysis', title: 'Last Analysis' }, analysis),
  );
}

export function systemTab(ctx: AppContext): HTMLElement {
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
    spacedRow(clearBtn.el, button({ iconOnly: true, icon: 'refresh', onClick: () => void refreshModels(), tip: { desc: 'Refresh model list' } }).el),
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
    panel({ id: 'sys.models', title: 'Models' }, modelsPanel),
    panel({ id: 'sys.memory', title: 'Memory', defaultOpen: false }, memory),
    panel(
      { id: 'sys.privacy', title: 'Privacy' },
      h('p', { class: 'pw-note', text: 'All processing happens on your device. Images are never uploaded; AI models are downloaded once from a public CDN and cached in your browser.' }),
      propRow(null, button({ label: 'About PaperWall3D', icon: 'info', onClick: () => ctx.ops.run('window.about') }).el),
    ),
  );
}
