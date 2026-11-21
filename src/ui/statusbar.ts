/** Bottom status bar: keymap hints, job progress / reports, backend, memory and version. */
import { APP_NAME, APP_VERSION } from '../core/version';
import type { PipelineProgress } from '../core/types';
import type { AppContext } from './context';
import { formatBytes, h } from './dom';
import { icon, type IconName } from './icons';
import type { Report, ReportLevel } from './reports';
import type { HintItem } from './state';
import { openWindow } from './window';

const REPORT_ICON: Record<ReportLevel, IconName> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'error',
};
const REPORT_TTL: Record<ReportLevel, number> = { info: 5000, success: 5000, warning: 8000, error: 14000 };

const mb = (n: number): string => (n / 1024 / 1024).toFixed(1);

/** Human label for the progress bar, e.g. "Downloading Depth Anything V2 Small 12.4/26.1 MB". */
export function progressLabel(p: PipelineProgress): string {
  // The pipeline may already include sizes in its message ("… 3.7 MB / 4.4 MB").
  if (p.message.includes(' MB')) return p.message;
  if (p.totalBytes && p.loadedBytes !== undefined && p.stage.startsWith('download')) {
    return `${p.message} ${mb(p.loadedBytes)}/${mb(p.totalBytes)} MB`;
  }
  if (p.progress >= 0 && p.progress <= 1) return `${p.message} ${Math.round(p.progress * 100)}%`;
  return p.message;
}

export function createStatusBar(ctx: AppContext): HTMLElement {
  // ── left: hints ──
  const hints = h('div', { class: 'pw-status-hints' });
  const renderHints = (items: HintItem[]): void => {
    hints.replaceChildren(
      ...items.map((i) => h('span', { class: 'pw-hint' }, icon(i.icon, 14), h('span', { text: i.label }))),
    );
  };
  ctx.ui.on('hint', renderHints);
  renderHints([
    { icon: 'mouseL', label: 'Select' },
    { icon: 'mouseM', label: 'Pan' },
    { icon: 'mouseR', label: 'Context' },
  ]);

  // ── center: progress / report ──
  const fill = h('div', { class: 'pw-progress-fill' });
  const label = h('span', { class: 'pw-progress-label' });
  const cancel = h('button', { class: 'pw-progress-cancel', attrs: { type: 'button', title: 'Cancel' } }, icon('close', 10));
  cancel.addEventListener('click', () => ctx.cancelJob());
  const progress = h('div', { class: 'pw-progress' }, h('div', { class: 'pw-progress-bar' }, fill, label), cancel);
  progress.hidden = true;

  const reportIcon = h('span', { class: 'pw-report-icon' });
  const reportText = h('span', { class: 'pw-report-text' });
  const report = h('button', { class: 'pw-report', attrs: { type: 'button', title: 'Click to show the report log' } }, reportIcon, reportText);
  report.hidden = true;
  let reportTimer: number | undefined;
  const showReport = (r: Report): void => {
    report.hidden = false;
    report.className = `pw-report ${r.level}`;
    reportIcon.replaceChildren(icon(REPORT_ICON[r.level], 14));
    reportText.textContent = r.text;
    window.clearTimeout(reportTimer);
    reportTimer = window.setTimeout(() => {
      report.hidden = true;
    }, REPORT_TTL[r.level]);
  };
  ctx.reports.on('report', showReport);
  report.addEventListener('click', () => {
    const list = h('div', { class: 'pw-report-log' });
    const items = [...ctx.reports.history].reverse();
    if (!items.length) list.appendChild(h('div', { class: 'pw-note', text: 'No reports.' }));
    for (const r of items) {
      list.appendChild(
        h(
          'div',
          { class: `pw-report-line ${r.level}` },
          icon(REPORT_ICON[r.level], 14),
          h('span', { class: 'pw-report-time', text: new Date(r.time).toLocaleTimeString() }),
          h('span', { text: r.text }),
        ),
      );
    }
    openWindow({ title: 'Info — Reports', icon: 'info', width: 520, height: 320, content: list, resizable: true });
  });

  ctx.events.on('progress', (p) => {
    if (!p || p.stage === 'idle' || p.stage === 'done') {
      progress.hidden = true;
      return;
    }
    progress.hidden = false;
    progress.classList.toggle('indeterminate', p.progress < 0);
    progress.classList.toggle('error', p.stage === 'error');
    fill.style.width = p.progress < 0 ? '35%' : `${Math.round(Math.min(1, p.progress) * 100)}%`;
    label.textContent = progressLabel(p);
  });
  const center = h('div', { class: 'pw-status-center' }, progress, report);

  // ── right: backend, memory, version ──
  const backend = h('span', { class: 'pw-status-item', title: 'AI inference backend' });
  const mem = h('span', { class: 'pw-status-item', title: 'Memory' });
  const syncBackend = (): void => {
    const b = ctx.backendInfo;
    let text = '—';
    if (b) {
      const active = b.active ?? (b.webgpu ? 'webgpu' : 'wasm');
      if (active === 'webgpu') text = 'WebGPU';
      else if (active === 'wasm') {
        const threads = b.wasmThreads && b.crossOriginIsolated ? b.hardwareConcurrency : 1;
        text = `WASM ×${threads} thread${threads === 1 ? '' : 's'}`;
      } else text = 'CPU';
    }
    backend.replaceChildren(icon('cpu', 12), h('span', { text }));
  };
  const syncMem = (): void => {
    const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const dm = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    mem.textContent = m ? `Mem: ${formatBytes(m.usedJSHeapSize)}` : dm ? `RAM ≥ ${dm} GB` : '';
    mem.hidden = !mem.textContent;
  };
  ctx.events.on('backend', syncBackend);
  syncBackend();
  syncMem();
  window.setInterval(syncMem, 2500);
  const version = h('span', { class: 'pw-status-item version', text: `${APP_NAME} ${APP_VERSION}` });
  const right = h('div', { class: 'pw-status-right' }, backend, mem, version);

  return h('div', { class: 'pw-statusbar' }, hints, center, right);
}
