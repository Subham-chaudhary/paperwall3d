/**
 * Wallpaper Preview: a full-window overlay shown before any export. The UI is hidden, the renderer is in its
 * `wallpaper` presentation (cover fit) inside a frame of the chosen aspect (letterboxed in black), driven by the live
 * cursor parallax, optionally with a desktop-like clock overlay. A slim bar at the bottom (auto-hides after 2 s)
 * holds the export buttons.
 */
import { MAX_OUTPUT_LONG_EDGE } from '../core/output';
import type { PreparedScene, WallpaperAspect } from '../core/types';
import type { AppContext } from './context';
import { clamp, h } from './dom';
import { icon } from './icons';
import { userPrefs } from './userprefs';
import { customBinding, settingsBinding } from './widgets/binding';
import { button, enumField } from './widgets/controls';
import { closeMenus, isMenuOpen } from './widgets/menu';
import { hideTooltip } from './widgets/tooltip';
import { SCHEMA } from '../core/schema';
import type { Workspace } from './state';
import type { ViewMode, StageView } from '../core/types';

export type ExportIntent = 'html' | 'glb' | 'png' | 'config' | 'pw3d';

export interface PreviewOptions {
  /** Export the user asked for before the preview opened: its button in the bar pulses. */
  intent?: ExportIntent;
  /** Also request browser fullscreen (F11 / Ctrl+Space). */
  browserFullscreen?: boolean;
}

let active: { close: () => void } | null = null;

export function closeWallpaperPreview(): void {
  active?.close();
}

/** Width / height of a frame aspect. `screen` is the user's real screen. */
export function frameAspect(aspect: WallpaperAspect): number {
  if (aspect === 'screen') return Math.max(1, screen.width) / Math.max(1, screen.height);
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect);
  return m ? Number(m[1]) / Number(m[2]) : 16 / 9;
}

/**
 * Pixel size of the exported still: the frame aspect, long edge = the output (colour-layer) long edge, at most 4K.
 * When the screen is larger than the output the still is at least 1920 px, but never above 3840.
 */
export function stillSize(aspect: WallpaperAspect, scene: PreparedScene | null): { width: number; height: number } {
  const outLong = scene ? Math.max(scene.colorWidth ?? scene.width, scene.colorHeight ?? scene.height) : 1920;
  const screenLong = Math.max(screen.width, screen.height);
  const floor = screenLong > outLong ? 1920 : 0;
  const long = Math.min(MAX_OUTPUT_LONG_EDGE, Math.max(outLong, floor));
  const a = frameAspect(aspect);
  return a >= 1 ? { width: long, height: Math.round(long / a) } : { width: Math.round(long * a), height: long };
}

export async function saveWallpaperPng(ctx: AppContext): Promise<void> {
  const { width, height } = stillSize(ctx.store.getValue('wallpaper.aspect'), ctx.isDemo ? null : ctx.scene);
  await ctx.renderImage(width, height);
}

const OVERLAY_OPTIONS = [
  { value: 'off', label: 'Overlay: Off' },
  { value: 'topleft', label: 'Overlay: Clock top-left' },
  { value: 'center', label: 'Overlay: Clock centred' },
];

export function openWallpaperPreview(ctx: AppContext, opts: PreviewOptions = {}): void {
  if (active) return;
  const renderer = ctx.renderer;
  const maybeHost = ctx.viewportHost;
  if (!renderer || !maybeHost || !maybeHost.parentElement) {
    ctx.reports.error('The wallpaper preview needs the 3D renderer, which is unavailable');
    return;
  }
  const host: HTMLElement = maybeHost;
  hideTooltip();
  closeMenus();
  if (ctx.ui.picking) ctx.setPicking(false);

  const prevView: { mode: ViewMode; stage: StageView } = {
    mode: ctx.store.getValue('view.mode'),
    stage: ctx.store.getValue('view.stage'),
  };
  const prevWorkspace: Workspace = ctx.ui.workspace;
  ctx.showView('2d', 'result');
  ctx.ui.setWorkspace('export');
  ctx.ui.setPreview(true);

  // Move the renderer host (canvas + its resize observer) into the frame.
  const marker = document.createComment('viewport-host');
  host.parentElement?.insertBefore(marker, host);

  const frame = h('div', { class: 'pw-wp-frame' });
  const clockTime = h('div', { class: 'pw-wp-time' });
  const clockDate = h('div', { class: 'pw-wp-date' });
  const overlay = h('div', { class: 'pw-wp-overlay' }, clockTime, clockDate);
  frame.append(host, overlay);

  // ── export bar ──
  const aspectSel = enumField<string>({
    bind: settingsBinding<string>(ctx.store, 'wallpaper.aspect'),
    options: (SCHEMA.wallpaper.fields.aspect as { options: { value: string; label: string }[] }).options,
    flat: true,
    icon: 'imageEditor',
    tip: { title: 'Frame', desc: 'Aspect ratio of the wallpaper frame. "This screen" is your actual screen aspect.' },
  });
  const overlaySel = enumField<string>({
    bind: customBinding<string>(
      () => (ctx.store.getValue('wallpaper.overlay') ? userPrefs.get('overlayStyle') : 'off'),
      (v) => {
        if (v === 'off') ctx.store.set('wallpaper.overlay', false);
        else {
          userPrefs.set('overlayStyle', v as 'topleft' | 'center');
          ctx.store.set('wallpaper.overlay', true);
        }
      },
      (fn) => {
        const a = ctx.store.subscribe((_s, c) => c.includes('wallpaper.overlay') && fn());
        const b = userPrefs.subscribe(fn);
        return () => {
          a();
          b();
        };
      },
    ),
    options: OVERLAY_OPTIONS,
    flat: true,
    icon: 'layers',
    tip: { title: 'Desktop overlay', desc: 'Show a clock and date like a desktop or lock screen to judge the wallpaper in context.' },
  });

  const mk = (label: string, ic: Parameters<typeof button>[0]['icon'], desc: string, run: () => void | Promise<void>, intent?: ExportIntent, variant?: 'primary'): HTMLElement => {
    const b = button({
      label,
      icon: ic,
      variant,
      onClick: () => {
        void Promise.resolve(run()).catch((e: unknown) => ctx.reports.error(`${label}: ${e instanceof Error ? e.message : String(e)}`, e));
      },
      tip: { desc },
    });
    if (intent) b.el.dataset.intent = intent;
    return b.el;
  };
  const exportBtns = [
    mk('Save Live Wallpaper (.html)', 'sparkle', 'Self-contained web wallpaper for Wallpaper Engine / Lively / any browser', () => ctx.exportHTML(), 'html', 'primary'),
    mk('Export GLB', 'cube', 'Export the layered meshes as a binary glTF (uses the 3D camera settings).', () => ctx.exportGLB(), 'glb'),
    mk('Save PNG', 'aperture', 'Render a PNG at output resolution (up to 4K)', () => saveWallpaperPng(ctx), 'png'),
    mk('Save config.json', 'file', 'Save a plain 2.5dwallpp-compatible config.json.', () => ctx.exportConfigJson(), 'config'),
    mk('Save .pw3d.json', 'export', 'Save a reusable wallpaper config with the image and maps embedded.', () => ctx.exportConfig(true), 'pw3d'),
  ];
  const fsBtn = button({
    iconOnly: true,
    icon: 'fullscreen',
    onClick: () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      else void document.documentElement.requestFullscreen?.().catch(() => undefined);
    },
    tip: { desc: 'Toggle browser fullscreen', extra: 'F11' },
  });
  const back = button({ label: 'Back', icon: 'close', onClick: () => close(), tip: { desc: 'Return to the editor', extra: 'Esc' } });
  const bar = h(
    'div',
    { class: 'pw-wp-bar' },
    h('span', { class: 'pw-wp-bar-title' }, icon('fullscreen', 14), h('span', { text: 'Wallpaper Preview' })),
    aspectSel.el,
    overlaySel.el,
    h('span', { class: 'pw-wp-bar-sep' }),
    ...exportBtns,
    h('span', { class: 'pw-wp-bar-sep' }),
    fsBtn.el,
    back.el,
  );

  const layer = h('div', { class: 'pw-wp-layer' }, frame, bar);
  document.body.appendChild(layer);
  document.body.classList.add('pw-wp-open');
  renderer.setPresentation('wallpaper');

  if (opts.intent) {
    const target = bar.querySelector<HTMLElement>(`[data-intent="${opts.intent}"]`);
    target?.classList.add('pulse');
    window.setTimeout(() => target?.classList.remove('pulse'), 4000);
    const label = { html: 'Save Live Wallpaper', glb: 'Export GLB', png: 'Save PNG', config: 'Save config.json', pw3d: 'Save .pw3d.json' }[opts.intent];
    ctx.reports.info(`Check the wallpaper, then press ${label}`);
  }

  // ── frame sizing ──
  const fit = (): void => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const a = frameAspect(ctx.store.getValue('wallpaper.aspect'));
    let w = W;
    let hh = W / a;
    if (hh > H) {
      hh = H;
      w = H * a;
    }
    frame.style.width = `${Math.round(w)}px`;
    frame.style.height = `${Math.round(hh)}px`;
    frame.style.setProperty('--wp-h', `${Math.round(hh)}px`);
    renderer.resize(Math.max(1, Math.round(w)), Math.max(1, Math.round(hh)));
  };
  const syncOverlay = (): void => {
    const on = ctx.store.getValue('wallpaper.overlay');
    overlay.hidden = !on;
    overlay.dataset.style = userPrefs.get('overlayStyle');
  };
  const tick = (): void => {
    const d = new Date();
    clockTime.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    clockDate.textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  };
  tick();
  syncOverlay();
  fit();
  requestAnimationFrame(fit);
  const clockTimer = window.setInterval(tick, 1000);
  const unsubStore = ctx.store.subscribe((_s, changed) => {
    if (changed.includes('wallpaper.aspect')) fit();
    if (changed.includes('wallpaper.overlay')) syncOverlay();
  });
  const unsubPrefs = userPrefs.subscribe(syncOverlay);

  // ── parallax from the cursor, bar auto-hide ──
  let idleTimer = 0;
  const wake = (): void => {
    bar.classList.remove('idle');
    layer.style.cursor = '';
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      if (isMenuOpen() || bar.matches(':hover')) {
        wake();
        return;
      }
      bar.classList.add('idle');
      layer.style.cursor = 'none';
    }, 2000);
  };
  const onMove = (e: PointerEvent): void => {
    const r = frame.getBoundingClientRect();
    renderer.setPointer(
      clamp(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -1, 1),
      clamp(-(((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1), -1, 1),
    );
    wake();
  };
  wake();
  window.addEventListener('pointermove', onMove);
  window.addEventListener('resize', fit);
  layer.addEventListener('pointerdown', wake);

  let enteredFullscreen = false;
  const onFsChange = (): void => {
    if (!document.fullscreenElement && enteredFullscreen) close();
    fit();
    requestAnimationFrame(fit);
  };
  document.addEventListener('fullscreenchange', onFsChange);
  if (opts.browserFullscreen) {
    void document.documentElement
      .requestFullscreen?.()
      .then(() => {
        enteredFullscreen = true;
      })
      .catch(() => undefined);
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || isMenuOpen()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  };
  window.addEventListener('keydown', onKey, true);

  function close(): void {
    if (active?.close !== close) return;
    active = null;
    window.clearInterval(clockTimer);
    window.clearTimeout(idleTimer);
    unsubStore();
    unsubPrefs();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('resize', fit);
    window.removeEventListener('keydown', onKey, true);
    document.removeEventListener('fullscreenchange', onFsChange);
    hideTooltip();
    closeMenus();
    marker.replaceWith(host);
    renderer?.setPresentation('editor');
    layer.remove();
    document.body.classList.remove('pw-wp-open');
    if (enteredFullscreen && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    ctx.ui.setPreview(false);
    ctx.ui.setWorkspace(prevWorkspace === 'export' ? 'layout' : prevWorkspace);
    ctx.showView(prevView.mode, prevView.stage);
    renderer?.setPointer(0, 0);
    requestAnimationFrame(() => {
      // The renderer follows its host's size; nudge it in case no observer fires.
      const r = host.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) renderer?.resize(Math.round(r.width), Math.round(r.height));
    });
  }
  active = { close };
}
