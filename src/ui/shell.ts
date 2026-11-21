/**
 * Application shell: builds the Blender-style area layout (top bar, toolbar, viewport, image strip,
 * outliner, properties, status bar), wires splitters and global keyboard shortcuts.
 */
import type { AppContext } from './context';
import { clamp, h } from './dom';
import { createImageStrip } from './imagestrip';
import { createTopBar } from './menubar';
import { createOutliner } from './outliner';
import { createProperties } from './panels/properties';
import { createStatusBar } from './statusbar';
import { createToolbar } from './toolbar';
import { createViewport, type ViewportParts } from './viewport';
import { isMenuOpen } from './widgets/menu';

export interface Shell {
  root: HTMLElement;
  viewport: ViewportParts;
}

type Axis = 'col' | 'row';

/** Draggable splitter. `onDelta` receives the pointer delta along the axis (px) since the drag started. */
function splitter(axis: Axis, onStart: () => number, onSet: (start: number, delta: number) => void, onEnd: () => void): HTMLElement {
  const el = h('div', { class: `pw-splitter ${axis}`, attrs: { role: 'separator', 'aria-orientation': axis === 'col' ? 'vertical' : 'horizontal' } });
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const start = onStart();
    const origin = axis === 'col' ? e.clientX : e.clientY;
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    document.body.classList.add(axis === 'col' ? 'pw-resizing-col' : 'pw-resizing-row');
    const move = (ev: PointerEvent): void => {
      onSet(start, (axis === 'col' ? ev.clientX : ev.clientY) - origin);
    };
    const up = (): void => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      document.body.classList.remove('pw-resizing-col', 'pw-resizing-row');
      onEnd();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
  return el;
}

export function createShell(ctx: AppContext): Shell {
  const root = h('div', { class: 'pw-app' });

  const topbar = createTopBar(ctx);
  const toolbar = createToolbar(ctx);
  const viewport = createViewport(ctx);
  const strip = createImageStrip(ctx);
  const outliner = createOutliner(ctx);
  const properties = createProperties(ctx);
  const statusbar = createStatusBar(ctx);

  // ── geometry (CSS variables driven by persisted layout) ──
  const applyLayout = (): void => {
    const l = ctx.ui.layout;
    root.style.setProperty('--right-w', `${l.rightWidth}px`);
    root.style.setProperty('--outliner-h', `${l.outlinerHeight}px`);
    root.style.setProperty('--strip-h', l.stripOpen ? `${l.stripHeight}px` : '0px');
    root.classList.toggle('strip-collapsed', !l.stripOpen);
  };
  ctx.ui.on('layout', applyLayout);

  const center = h('div', { class: 'pw-center' });
  const right = h('div', { class: 'pw-right' });
  const main = h('div', { class: 'pw-main' });

  const stripArea = h('div', { class: 'pw-strip-area' }, strip);
  const vSplit = splitter(
    'row',
    () => ctx.ui.layout.stripHeight,
    (start, d) => ctx.ui.updateLayout({ stripHeight: clamp(start - d, 70, Math.max(120, window.innerHeight * 0.6)), stripOpen: true }),
    () => undefined,
  );
  vSplit.classList.add('pw-split-strip');
  center.append(h('div', { class: 'pw-viewport-area' }, viewport.el), vSplit, stripArea);

  const outlinerArea = h('div', { class: 'pw-outliner-area' }, outliner);
  const rSplit = splitter(
    'row',
    () => ctx.ui.layout.outlinerHeight,
    (start, d) => ctx.ui.updateLayout({ outlinerHeight: clamp(start + d, 70, Math.max(120, window.innerHeight - 260)) }),
    () => undefined,
  );
  right.append(outlinerArea, rSplit, h('div', { class: 'pw-properties-area' }, properties));

  const cSplit = splitter(
    'col',
    () => ctx.ui.layout.rightWidth,
    (start, d) => ctx.ui.updateLayout({ rightWidth: clamp(start - d, 240, Math.max(300, window.innerWidth * 0.6)) }),
    () => undefined,
  );
  cSplit.classList.add('pw-split-right');

  const drawerScrim = h('div', { class: 'pw-drawer-scrim' });
  drawerScrim.addEventListener('click', () => ctx.ui.setDrawer(false));
  main.append(toolbar, center, cSplit, right, drawerScrim);
  root.append(topbar, main, statusbar);

  ctx.ui.on('drawer', (open) => root.classList.toggle('drawer-open', open));
  ctx.ui.on('fullscreen', (on) => root.classList.toggle('fullscreen', on));
  ctx.ui.on('strip', applyLayout);
  applyLayout();

  // Keep UI state in sync when the user leaves browser fullscreen with Esc/F11.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && ctx.ui.fullscreen) ctx.ui.setFullscreen(false);
  });

  // ── global shortcuts ──
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ctx.ui.fullscreen && !isMenuOpen()) {
      e.preventDefault();
      ctx.ops.run('view.fullscreen_preview');
      return;
    }
    if (e.key === 'Escape' && ctx.ui.drawerOpen) {
      ctx.ui.setDrawer(false);
      return;
    }
    ctx.ops.handleKey(e);
  });

  // Right-click context menu in the viewport is replaced by the pie menu; suppress the browser menu there.
  viewport.el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    ctx.ops.run('view.pie');
  });

  return { root, viewport };
}
