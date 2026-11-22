/**
 * Viewport area: Blender-style area header (view switch, Show Stage, Pick Object, Preview Wallpaper), the renderer host
 * with text/stats overlays and navigation gizmo, the config.json editor, the sidebar (N panel), pointer -> renderer
 * wiring, Pick Object clicks and drag-and-drop of images.
 */
import type { StageView, ViewMode } from '../core/types';
import { createConfigEditor } from './configEditor';
import type { AppContext } from './context';
import { clamp, h, lerp } from './dom';
import { icon, iconSvg } from './icons';
import { STAGES, STAGE_SHORT, VIEW_MODES } from './viewmodes';
import { Fields } from './panels/fields';
import { panel } from './panels/panel';
import { settingsBinding } from './widgets/binding';
import { button, enumField, iconToggle, segmented } from './widgets/controls';
import { openMenu, isMenuOpenFor, closeMenus, type MenuItem } from './widgets/menu';
import { tip } from './widgets/tooltip';
import { formatShortcut } from './operators';

export interface ViewportParts {
  el: HTMLElement;
  /** Container handed to createRenderer(); the renderer appends its canvas here. */
  host: HTMLElement;
  showUnavailable(message: string): void;
}

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const VIEW_TITLES: Record<ViewMode, string> = { '2d': '2D Parallax', '3d': '3D Camera', config: 'config.json' };

export function createViewport(ctx: AppContext): ViewportParts {
  const f = new Fields(ctx);
  const store = ctx.store;

  // ───────────── header ─────────────
  const header = h('div', { class: 'pw-area-header pw-vp-header' });

  const menuBtn = (label: string, items: () => MenuItem[]): HTMLElement => {
    const b = h('button', { class: 'pw-hdr-menu', attrs: { type: 'button' }, text: label });
    let toggledOff = false;
    b.addEventListener('pointerdown', () => {
      toggledOff = isMenuOpenFor(b);
      if (toggledOff) closeMenus();
    });
    b.addEventListener('click', () => {
      if (toggledOff) {
        toggledOff = false;
        return;
      }
      openMenu(items(), { anchor: b });
    });
    return b;
  };
  const op = (id: string, label?: string, extra?: Partial<MenuItem>): MenuItem => {
    const o = ctx.ops.get(id);
    return {
      label: label ?? o?.label ?? id,
      shortcut: formatShortcut(o?.shortcut),
      disabled: !ctx.ops.enabled(id),
      run: () => ctx.ops.run(id),
      ...extra,
    };
  };

  const editorType = h('button', { class: 'pw-editor-btn', attrs: { type: 'button' } }, icon('view3d', 16), icon('chevDown', 10));
  tip(editorType, { desc: 'Editor type: Viewport' });
  editorType.addEventListener('click', () =>
    openMenu(
      [
        { heading: 'Editor Type' },
        { label: 'Viewport', icon: 'view3d', checked: true },
        { label: 'Image Editor', icon: 'imageEditor', disabled: true },
        { label: 'Outliner', icon: 'collection', disabled: true },
        { label: 'Properties', icon: 'wrench', disabled: true },
      ],
      { anchor: editorType },
    ),
  );
  const viewMenu = menuBtn('View', () => [
    op('view.toggle_sidebar', 'Sidebar', { checked: ctx.ui.sidebarOpen }),
    op('view.toggle_stats', 'Statistics', { checked: store.getValue('view.showStats') }),
    { separator: true },
    ...VIEW_MODES.map<MenuItem>((m) => ({ label: m.label, icon: m.icon, checked: store.getValue('view.mode') === m.value, run: () => ctx.showView(m.value) })),
    { separator: true },
    op('view.reset'),
    op('view.pie'),
    op('view.preview_wallpaper'),
  ]);

  // View switch: 2D Parallax | 3D Camera | config.json
  const modeSeg = segmented<ViewMode>({
    bind: settingsBinding<ViewMode>(store, 'view.mode'),
    options: VIEW_MODES.map((m) => ({ ...m, icon: undefined, tip: { desc: m.label === 'config.json' ? 'Edit every setting as commented JSON (2.5dwallpp compatible).' : `Switch to the ${m.label} view.` } })),
    noUndo: true,
  });
  modeSeg.el.classList.add('pw-vp-modes');

  // Show Stage (2D only)
  const stageEnum = enumField<StageView>({
    bind: settingsBinding<StageView>(store, 'view.stage'),
    options: STAGES,
    flat: true,
    tip: f.tip('view.stage'),
  });
  const stageWrap = h('div', { class: 'pw-vp-stage' }, h('span', { class: 'pw-vp-lbl', text: 'Show Stage' }), stageEnum.el);

  // Pick Object…
  const pickBtn = button({
    label: 'Pick Object…',
    icon: 'eyedropper',
    onClick: () => ctx.ops.run('view.pick_object'),
    tip: { title: 'Pick Object', desc: 'Click the object you want as the main object. The image is shown untilted. Esc cancels.', extra: 'P' },
  });
  const clearBtn = button({ iconOnly: true, icon: 'close', onClick: () => ctx.clearPick(), tip: { desc: 'Clear the picked object (back to automatic)' } });
  const pickWrap = h('div', { class: 'pw-vp-pick' }, pickBtn.el, clearBtn.el);

  // 3D: reset camera + auto-rotate
  const resetCam = button({ label: 'Reset Camera', icon: 'refresh', onClick: () => ctx.ops.run('view.reset'), tip: { desc: 'Reset the 3D orbit camera.', extra: 'Home' } });
  const rotateBtn = iconToggle({
    icon: 'orbit',
    get: () => store.getValue('camera3d.rotate'),
    onToggle: (v) => {
      store.checkpoint();
      store.set('camera3d.rotate', v);
    },
    tip: { title: 'Auto-Rotate', desc: 'Auto-rotate the 3D camera.' },
    class: 'pw-hdr-toggle',
  });
  const camWrap = h('div', { class: 'pw-vp-cam' }, resetCam.el, rotateBtn.el);

  const previewBtn = button({
    label: 'Preview Wallpaper',
    icon: 'fullscreen',
    variant: 'primary',
    onClick: () => ctx.ops.run('view.preview_wallpaper'),
    tip: { title: 'Preview Wallpaper', desc: 'Full-window preview in a desktop frame. Exports go through it.', extra: 'F · Ctrl Shift P' },
  });
  previewBtn.el.classList.add('pw-vp-preview');

  const sidebarBtn = iconToggle({
    icon: 'sidebar',
    get: () => ctx.ui.sidebarOpen,
    onToggle: (v) => ctx.ui.setSidebar(v),
    tip: { desc: 'Toggle the sidebar', extra: 'N' },
    class: 'pw-hdr-toggle',
  });
  ctx.ui.on('sidebar', () => sidebarBtn.refresh());
  header.append(editorType, viewMenu, modeSeg.el, stageWrap, pickWrap, camWrap, h('div', { class: 'pw-header-spacer' }), previewBtn.el, sidebarBtn.el);

  // ───────────── main area ─────────────
  const host = h('div', { class: 'pw-vp-host' });
  const info1 = h('div', { class: 'pw-vp-text strong' });
  const info2 = h('div', { class: 'pw-vp-text' });
  const stats = h('div', { class: 'pw-vp-stats' });
  const flowText = h('span', { class: 'pw-vp-flow-text' });
  const flowClose = h('button', { class: 'pw-vp-flow-x', attrs: { type: 'button', title: 'Dismiss' } }, icon('close', 9));
  const flow = h('div', { class: 'pw-vp-flow' }, flowText, flowClose);
  flow.hidden = true;
  const banner = h('div', { class: 'pw-vp-banner' });
  banner.hidden = true;
  const emptyHint = h(
    'div',
    { class: 'pw-vp-empty' },
    h('div', { class: 'pw-vp-empty-title', text: 'Drop an image here' }),
    h('div', { class: 'pw-vp-empty-sub', text: 'or press Ctrl O to open one' }),
  );
  const unavailable = h('div', { class: 'pw-vp-unavailable' });
  unavailable.hidden = true;
  const dropOverlay = h(
    'div',
    { class: 'pw-vp-drop' },
    h('div', { class: 'pw-vp-drop-inner' }, icon('import', 28), h('span', { text: 'Drop image to open' })),
  );

  // Gizmo (2D view only: it leans with the cursor like the parallax)
  const gizmo = h('div', { class: 'pw-gizmo' });
  tip(gizmo, { desc: 'Navigation gizmo. Click to reset the view.' });
  gizmo.addEventListener('click', () => ctx.ops.run('view.reset'));
  const drawGizmo = (yaw: number, pitch: number): void => {
    const axes = [
      { v: [1, 0, 0], c: '#ff3352', l: 'X' },
      { v: [0, 1, 0], c: '#8bdc00', l: 'Y' },
      { v: [0, 0, 1], c: '#2f84ff', l: 'Z' },
    ] as const;
    const project = (x: number, y: number, z: number): [number, number, number] => {
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const x1 = x * cy + z * sy;
      const z1 = -x * sy + z * cy;
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const y2 = y * cp - z1 * sp;
      const z2 = y * sp + z1 * cp;
      return [x1, y2, z2];
    };
    const R = 22;
    const parts: { z: number; svg: string }[] = [];
    for (const a of axes) {
      for (const sign of [1, -1]) {
        const [px, py, pz] = project(a.v[0] * sign, a.v[1] * sign, a.v[2] * sign);
        const sx = 40 + px * R;
        const sy = 40 - py * R;
        if (sign === 1) {
          parts.push({ z: pz - 0.01, svg: `<line x1="40" y1="40" x2="${sx.toFixed(1)}" y2="${sy.toFixed(1)}" stroke="${a.c}" stroke-width="2"/>` });
          parts.push({
            z: pz,
            svg: `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="7.5" fill="${a.c}"/><text x="${sx.toFixed(1)}" y="${(sy + 3.6).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#0d0c14">${a.l}</text>`,
          });
        } else {
          parts.push({
            z: pz,
            svg: `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="5.5" fill="${a.c}" fill-opacity=".28" stroke="${a.c}" stroke-opacity=".7"/>`,
          });
        }
      }
    }
    parts.sort((a, b) => a.z - b.z);
    gizmo.innerHTML = `<svg viewBox="0 0 80 80" width="80" height="80"><circle cx="40" cy="40" r="36" fill="#ffffff" fill-opacity=".05"/>${parts.map((p) => p.svg).join('')}</svg>`;
  };
  drawGizmo(-0.5, 0.35);

  // Sidebar (N panel): quick controls for the current view
  const sidebar2d = [
    panel(
      { id: 'vp.parallax', title: 'Parallax' },
      ...f.rows('parallax.strength', 'parallax.focus', 'parallax.tilt', 'parallax.lighting'),
    ),
    panel({ id: 'vp.layers', title: 'Object' }, ...f.rows('layers.scope', 'layers.backgroundDepth', 'layers.objectSize', 'layers.objectRelief')),
  ];
  const sidebar3d = [
    panel({ id: 'vp.cam3d', title: '3D camera' }, ...f.rows('camera3d.zscale', 'camera3d.tear', 'camera3d.segs', 'camera3d.wire', 'camera3d.depthcol', 'camera3d.rotate')),
    panel({ id: 'vp.layers3', title: 'Object' }, ...f.rows('layers.scope', 'layers.backgroundDepth', 'layers.objectRelief')),
  ];
  const sbBody2d = h('div', { class: 'pw-vp-sidebar-body' }, ...sidebar2d);
  const sbBody3d = h('div', { class: 'pw-vp-sidebar-body' }, ...sidebar3d);
  const sidebar = h(
    'div',
    { class: 'pw-vp-sidebar' },
    h('div', { class: 'pw-vp-sidebar-tabs' }, h('span', { class: 'active', text: 'Item' }), h('span', { text: 'View' })),
    sbBody2d,
    sbBody3d,
  );
  const syncSidebar = (): void => {
    sidebar.classList.toggle('open', ctx.ui.sidebarOpen);
  };
  ctx.ui.on('sidebar', syncSidebar);
  syncSidebar();
  const sidebarTab = h('button', { class: 'pw-vp-sidebar-handle', attrs: { type: 'button' } }, icon('chevRight', 10));
  tip(sidebarTab, { desc: 'Toggle the sidebar', extra: 'N' });
  sidebarTab.addEventListener('click', () => ctx.ui.setSidebar(!ctx.ui.sidebarOpen));
  const syncHandle = (): void => {
    sidebarTab.classList.toggle('open', ctx.ui.sidebarOpen);
  };
  ctx.ui.on('sidebar', syncHandle);
  syncHandle();

  const overlay = h(
    'div',
    { class: 'pw-vp-overlay' },
    h('div', { class: 'pw-vp-topleft' }, info1, info2, flow, stats),
    h('div', { class: 'pw-vp-topright' }, gizmo),
    sidebar,
    sidebarTab,
    banner,
    emptyHint,
    unavailable,
  );

  const cfg = createConfigEditor(ctx);
  const main = h('div', { class: 'pw-vp-main' }, host, overlay, cfg.el, dropOverlay);

  // ───────────── view-dependent chrome ─────────────
  const hintFor = (mode: ViewMode, picking: boolean): void => {
    if (picking) ctx.ui.setHint([{ icon: 'mouseL', label: 'Pick Object' }, { icon: 'mouseR', label: 'Esc Cancel' }]);
    else if (mode === '3d') ctx.ui.setHint([{ icon: 'mouseL', label: 'Orbit' }, { icon: 'mouseM', label: 'Pan' }, { icon: 'mouseWheel', label: 'Zoom' }]);
    else if (mode === 'config') ctx.ui.setHint([{ icon: 'mouseL', label: 'Edit' }, { icon: 'mouseR', label: 'Context' }]);
    else ctx.ui.setHint([{ icon: 'mouseL', label: 'Select' }, { icon: 'mouseM', label: 'Pan' }, { icon: 'mouseR', label: 'Pie Menu' }]);
  };

  const syncChrome = (): void => {
    const mode = store.getValue('view.mode');
    const stage = store.getValue('view.stage');
    const picking = ctx.ui.picking;
    main.dataset.view = mode;
    main.classList.toggle('picking', picking);
    cfg.el.hidden = mode !== 'config';
    host.style.visibility = mode === 'config' ? 'hidden' : '';
    camWrap.hidden = mode !== '3d';
    gizmo.hidden = mode !== '2d';
    sbBody2d.hidden = mode === '3d';
    sbBody3d.hidden = mode !== '3d';
    clearBtn.el.hidden = !store.getValue('mask.click');
    pickBtn.el.classList.toggle('active', picking);
    pickBtn.setLabel(picking ? 'Picking…' : 'Pick Object…');
    rotateBtn.refresh();
    info1.textContent = VIEW_TITLES[mode] + (mode === '2d' && stage !== 'result' ? ` · ${STAGE_SHORT[stage]}` : '');
    if (picking) {
      banner.hidden = false;
      banner.textContent = 'Click the object you want as the main object (Esc to cancel)';
    } else if (mode === '3d') {
      banner.hidden = false;
      banner.textContent = 'Drag to orbit · Shift/right-drag to pan · Wheel to zoom';
    } else banner.hidden = true;
    if (mode === 'config') cfg.show();
    hintFor(mode, picking);
  };
  store.subscribe((_s, changed) => {
    if (changed.some((p) => p === 'view.mode' || p === 'view.stage' || p === 'mask.click' || p === 'camera3d.rotate')) syncChrome();
  });
  ctx.ui.on('picking', syncChrome);

  // ───────────── workflow hint (first image of the session) ─────────────
  let flowActive = false;
  let flowSeenImage = false;
  let previewed = false;
  const visited = new Set<StageView>(['result']);
  const syncFlow = (): void => {
    let text = '';
    if (flowActive && ctx.source) {
      const stage = store.getValue('view.stage');
      if (!visited.has('mask')) text = 'Next: check the mask (Show stage ▸ 1 · Main object mask)';
      else if (!visited.has('objdepth')) text = 'Next: check the object depth (Show stage ▸ 2 · Object depth)';
      else if (stage !== 'result') text = 'Next: back to Result, then tune Parallax';
      else if (!previewed) text = 'Next: judge the parallax in all four corners, then Preview Wallpaper (F)';
    }
    flow.hidden = !text;
    flowText.textContent = text;
  };
  flowClose.addEventListener('click', () => {
    flowActive = false;
    syncFlow();
  });
  ctx.events.on('image', (src) => {
    if (src && !flowSeenImage) {
      flowSeenImage = true;
      flowActive = true;
    }
    syncFlow();
  });
  ctx.ui.on('preview', (on) => {
    if (on) previewed = true;
    syncFlow();
  });
  store.subscribe((_s, c) => {
    if (!c.includes('view.stage')) return;
    visited.add(store.getValue('view.stage'));
    syncFlow();
  });

  // ───────────── overlays: text + stats ─────────────
  const syncInfo = (): void => {
    const name = ctx.source?.name ?? (ctx.isDemo ? 'Demo' : '—');
    info2.textContent = `(1) ${ctx.sceneName} | ${name}`;
    emptyHint.hidden = !ctx.isDemo || ctx.busy || store.getValue('view.mode') === 'config';
  };
  ctx.events.on('image', syncInfo);
  ctx.events.on('name', syncInfo);
  ctx.events.on('scene', syncInfo);
  ctx.events.on('progress', syncInfo);
  store.subscribe((_s, c) => c.includes('view.mode') && syncInfo());
  syncInfo();

  let statsTimer: number | undefined;
  const syncStats = (): void => {
    const on = store.getValue('view.showStats');
    stats.hidden = !on;
    window.clearInterval(statsTimer);
    statsTimer = undefined;
    if (!on) return;
    const draw = (): void => {
      const r = ctx.renderer;
      if (!r) {
        stats.textContent = 'Renderer unavailable';
        return;
      }
      const s = r.getStats();
      const row = (k: string, v: string): HTMLElement => h('div', { class: 'pw-stat' }, h('span', { text: k }), h('span', { text: v }));
      stats.replaceChildren(
        row('FPS', s.fps.toFixed(1)),
        row('Triangles', s.triangles.toLocaleString()),
        row('Draw Calls', String(s.drawCalls)),
        row('Textures', String(s.textures)),
        row('GPU', s.gpu || '—'),
      );
    };
    draw();
    statsTimer = window.setInterval(draw, 250);
  };
  store.subscribe((_s, changed) => {
    if (changed.includes('view.showStats')) syncStats();
  });
  syncStats();

  // ───────────── pointer -> renderer (2D parallax) ─────────────
  const cur = { x: 0, y: 0 };
  let ease = 0;
  const feed = (x: number, y: number): void => {
    cur.x = x;
    cur.y = y;
    ctx.renderer?.setPointer(x, y);
    drawGizmo(-0.5 + x * 0.6, 0.35 - y * 0.4);
  };
  const stopEase = (): void => {
    if (ease) cancelAnimationFrame(ease);
    ease = 0;
  };
  const easeToZero = (): void => {
    stopEase();
    const tick = (): void => {
      const nx = lerp(cur.x, 0, 0.12);
      const ny = lerp(cur.y, 0, 0.12);
      if (Math.abs(nx) < 0.002 && Math.abs(ny) < 0.002) {
        feed(0, 0);
        ease = 0;
        return;
      }
      feed(nx, ny);
      ease = requestAnimationFrame(tick);
    };
    ease = requestAnimationFrame(tick);
  };
  const is2d = (): boolean => store.getValue('view.mode') === '2d';

  host.addEventListener('pointermove', (e) => {
    if (!is2d() || ctx.ui.picking) return; // 3D: the renderer owns the pointer (orbit); picking: parallax frozen
    const r = host.getBoundingClientRect();
    stopEase();
    feed(
      clamp(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -1, 1),
      clamp(-(((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1), -1, 1),
    );
  });
  host.addEventListener('pointerleave', () => {
    if (is2d() && !ctx.ui.picking) easeToZero();
  });
  // Gyro (touch devices): device tilt drives the parallax in the 2D view; a mouse, when present, wins.
  let mouseSeen = false;
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') mouseSeen = true;
  });
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (hasTouch && typeof DeviceOrientationEvent !== 'undefined') {
    let base: number | null = null;
    let listening = false;
    const onOrient = (e: DeviceOrientationEvent): void => {
      if (mouseSeen || ctx.ui.picking || e.gamma === null || e.beta === null) return;
      if (!(is2d() || ctx.ui.previewOpen)) return;
      base ??= e.beta;
      const x = clamp(e.gamma / 25, -1, 1);
      const y = clamp(-(e.beta - base) / 25, -1, 1);
      stopEase();
      feed(x, y);
    };
    const listen = (): void => {
      if (listening) return;
      listening = true;
      window.addEventListener('deviceorientation', onOrient);
    };
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> };
    if (typeof DOE.requestPermission === 'function') {
      // iOS: the permission prompt needs a user gesture; ask on the first tap.
      const ask = (): void => {
        window.removeEventListener('touchend', ask);
        void DOE.requestPermission?.().then((r) => r === 'granted' && listen()).catch(() => undefined);
      };
      window.addEventListener('touchend', ask);
    } else listen();
  }

  // Pick Object: the click maps to image coordinates in the renderer.
  host.addEventListener('click', (e) => {
    if (ctx.ui.picking && is2d() && e.button === 0) ctx.pickAt(e.clientX, e.clientY);
  });

  // Keymap hints in the status bar while hovering the viewport.
  main.addEventListener('pointerenter', () => hintFor(store.getValue('view.mode'), ctx.ui.picking));
  main.addEventListener('pointerleave', () =>
    ctx.ui.setHint([
      { icon: 'mouseL', label: 'Select' },
      { icon: 'mouseM', label: 'Pan' },
      { icon: 'mouseR', label: 'Context' },
    ]),
  );

  // ───────────── drag & drop ─────────────
  let dragDepth = 0;
  const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  main.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    main.classList.add('drop-active');
  });
  main.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  main.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) main.classList.remove('drop-active');
  });
  main.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    main.classList.remove('drop-active');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (/\.json$/i.test(file.name)) void ctx.importConfig(file);
    else if (file.type.startsWith('image/') || IMAGE_RE.test(file.name)) void ctx.openImage(file, file.name);
    else ctx.reports.error(`Unsupported file type: ${file.name}. Drop a JPG, PNG or WebP image.`);
  });

  syncChrome();

  const el = h('div', { class: 'pw-area pw-viewport' }, header, main);
  return {
    el,
    host,
    showUnavailable: (message) => {
      unavailable.hidden = false;
      unavailable.replaceChildren(h('span', { html: iconSvg('warning', 28) }), h('div', { class: 'pw-vp-unavailable-title', text: '3D viewport unavailable' }), h('div', { class: 'pw-vp-unavailable-sub', text: message }));
    },
  };
}
