/**
 * 3D Viewport area: Blender-style area header, text/stats overlays, navigation gizmo, sidebar (N panel),
 * pointer -> renderer wiring, tool behaviour and drag-and-drop of images.
 */
import type { CameraMode, ViewMode } from '../core/types';
import type { AppContext } from './context';
import { clamp, h, lerp } from './dom';
import { icon, iconSvg } from './icons';
import { CAMERA_MODES, VIEW_MODES } from './viewmodes';
import { Fields } from './panels/fields';
import { panel } from './panels/panel';
import { settingsBinding } from './widgets/binding';
import { enumField, iconToggle, segmented } from './widgets/controls';
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

export function createViewport(ctx: AppContext): ViewportParts {
  const f = new Fields(ctx.store);

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
  tip(editorType, { desc: 'Editor type: 3D Viewport' });
  editorType.addEventListener('click', () =>
    openMenu(
      [
        { heading: 'Editor Type' },
        { label: '3D Viewport', icon: 'view3d', checked: true },
        { label: 'Image Editor', icon: 'imageEditor', disabled: true },
        { label: 'Outliner', icon: 'collection', disabled: true },
        { label: 'Properties', icon: 'wrench', disabled: true },
      ],
      { anchor: editorType },
    ),
  );
  const viewMenu = menuBtn('View', () => [
    op('view.toggle_sidebar', 'Sidebar', { checked: ctx.ui.sidebarOpen }),
    op('view.toggle_stats', 'Statistics', { checked: ctx.store.getValue('view.showStats') }),
    op('view.toggle_grid', 'Grid', { checked: ctx.store.getValue('view.showGrid') }),
    { separator: true },
    op('view.reset'),
    op('view.pie'),
    op('view.fullscreen_preview'),
  ]);
  const shadingMenu = menuBtn('Shading', () =>
    VIEW_MODES.map<MenuItem>((m) => ({
      label: m.label,
      icon: m.icon,
      checked: ctx.store.getValue('view.mode') === m.value,
      run: () => ctx.store.set('view.mode', m.value),
    })),
  );

  const cameraEnum = enumField<CameraMode>({
    bind: settingsBinding<CameraMode>(ctx.store, 'camera.mode'),
    options: CAMERA_MODES,
    flat: true,
    tip: f.tip('camera.mode', 'Camera behaviour: follow the cursor, orbit by dragging, animate automatically or stay static.'),
  });
  const modeSeg = segmented({
    bind: settingsBinding<ViewMode>(ctx.store, 'view.mode'),
    options: VIEW_MODES.map((m) => ({ ...m, shortcut: 'Z' })),
    iconOnly: true,
    noUndo: true,
  });
  modeSeg.el.classList.add('pw-vp-modes');
  const sidebarBtn = iconToggle({
    icon: 'sidebar',
    get: () => ctx.ui.sidebarOpen,
    onToggle: (v) => ctx.ui.setSidebar(v),
    tip: { desc: 'Toggle the sidebar', extra: 'N' },
    class: 'pw-hdr-toggle',
  });
  ctx.ui.on('sidebar', () => sidebarBtn.refresh());
  header.append(editorType, viewMenu, shadingMenu, h('div', { class: 'pw-header-spacer' }), cameraEnum.el, modeSeg.el, sidebarBtn.el);

  // ───────────── main area ─────────────
  const host = h('div', { class: 'pw-vp-host' });
  const info1 = h('div', { class: 'pw-vp-text strong', text: 'User Perspective' });
  const info2 = h('div', { class: 'pw-vp-text' });
  const stats = h('div', { class: 'pw-vp-stats' });
  const measure = h('div', { class: 'pw-vp-measure' });
  measure.hidden = true;
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

  // Gizmo
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
            svg: `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="7.5" fill="${a.c}"/><text x="${sx.toFixed(1)}" y="${(sy + 3.6).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#1a1a1a">${a.l}</text>`,
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

  // Sidebar (N panel)
  const sidebar = h(
    'div',
    { class: 'pw-vp-sidebar' },
    h('div', { class: 'pw-vp-sidebar-tabs' }, h('span', { class: 'active', text: 'Item' }), h('span', { text: 'View' })),
    h(
      'div',
      { class: 'pw-vp-sidebar-body' },
      panel(
        { id: 'vp.camera', title: 'Camera' },
        f.enum('camera.mode', 'Mode', CAMERA_MODES, 'Camera behaviour.'),
        f.num('camera.parallax', 'Parallax', { min: 0, max: 2, step: 0.01, slider: true, desc: 'Translation parallax amount.' }),
        f.num('camera.tilt', 'Tilt', { min: 0, max: 20, step: 0.5, precision: 1, unit: '°', desc: 'Maximum rotation tilt.' }),
        f.num('camera.zoom', 'Zoom', { min: 0.5, max: 2, step: 0.01, slider: true, desc: 'Dolly / zoom.' }),
      ),
      panel(
        { id: 'vp.relief', title: 'Depth' },
        f.num('geometry.backgroundRelief', 'Background', { min: 0, max: 2, step: 0.01, slider: true, desc: 'Background relief strength.' }),
        f.num('geometry.foregroundRelief', 'Foreground', { min: 0, max: 2, step: 0.01, slider: true, desc: 'Foreground relief strength.' }),
        f.num('geometry.objectElevation', 'Elevation', { min: 0, max: 2, step: 0.01, slider: true, desc: 'Foreground Z offset.' }),
      ),
      panel(
        { id: 'vp.light', title: 'Light' },
        f.num('lighting.keyIntensity', 'Key', { min: 0, max: 2, step: 0.01, slider: true, desc: 'Key light strength.' }),
        f.num('lighting.ambient', 'Ambient', { min: 0, max: 2, step: 0.01, slider: true, desc: 'Ambient light strength.' }),
      ),
    ),
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
    h('div', { class: 'pw-vp-topleft' }, info1, info2, stats),
    h('div', { class: 'pw-vp-topright' }, gizmo),
    sidebar,
    sidebarTab,
    measure,
    emptyHint,
    unavailable,
  );
  const main = h('div', { class: 'pw-vp-main' }, host, overlay, dropOverlay);

  // ───────────── overlays: text + stats ─────────────
  const syncInfo = (): void => {
    const name = ctx.source?.name ?? (ctx.isDemo ? 'Demo' : '—');
    info2.textContent = `(1) ${ctx.sceneName} | ${name}`;
    emptyHint.hidden = !ctx.isDemo || ctx.busy;
  };
  ctx.events.on('image', syncInfo);
  ctx.events.on('name', syncInfo);
  ctx.events.on('scene', syncInfo);
  ctx.events.on('progress', syncInfo);
  syncInfo();

  let statsTimer: number | undefined;
  const syncStats = (): void => {
    const on = ctx.store.getValue('view.showStats');
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
  ctx.store.subscribe((_s, changed) => {
    if (changed.includes('view.showStats')) syncStats();
  });
  syncStats();

  // ───────────── pointer -> renderer ─────────────
  const cur = { x: 0, y: 0 };
  const orbit = { x: 0, y: 0 };
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

  const norm = (e: PointerEvent): { x: number; y: number } => {
    const r = host.getBoundingClientRect();
    return {
      x: clamp(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -1, 1),
      y: clamp(-(((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1), -1, 1),
    };
  };
  const orbiting = (): boolean => ctx.ui.tool === 'orbit' || ctx.store.getValue('camera.mode') === 'orbit';

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let lightGesture = false;

  host.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const tool = ctx.ui.tool;
    if (tool === 'light' || orbiting()) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      lightGesture = false;
      host.setPointerCapture(e.pointerId);
      stopEase();
      main.classList.add('dragging');
    }
  });
  host.addEventListener('pointermove', (e) => {
    const p = norm(e);
    const tool = ctx.ui.tool;
    if (tool === 'measure') updateMeasure(e, p);
    if (dragging) {
      if (tool === 'light') {
        if (!lightGesture) {
          lightGesture = true;
          ctx.store.checkpoint();
        }
        ctx.store.set('lighting.keyAzimuth', Math.round(p.x * 180));
        ctx.store.set('lighting.keyElevation', Math.round(clamp(p.y, -1, 1) * 90));
      } else {
        const r = host.getBoundingClientRect();
        orbit.x = clamp(orbit.x + ((e.clientX - lastX) / Math.max(1, r.width)) * 2.5, -1, 1);
        orbit.y = clamp(orbit.y - ((e.clientY - lastY) / Math.max(1, r.height)) * 2.5, -1, 1);
        lastX = e.clientX;
        lastY = e.clientY;
        feed(orbit.x, orbit.y);
      }
      return;
    }
    if (orbiting()) return; // virtual orbit position is held between drags
    stopEase();
    feed(p.x, p.y);
  });
  const endDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    main.classList.remove('dragging');
    if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId);
  };
  host.addEventListener('pointerup', endDrag);
  host.addEventListener('pointercancel', endDrag);
  host.addEventListener('pointerleave', () => {
    measure.hidden = true;
    if (dragging || orbiting()) return;
    easeToZero();
  });

  // Measure tool: read depth under the cursor (assumes the image is shown "contain"-fitted).
  const updateMeasure = (e: PointerEvent, p: { x: number; y: number }): void => {
    const scene = ctx.scene;
    if (!scene || ctx.isDemo) {
      measure.hidden = true;
      return;
    }
    const r = host.getBoundingClientRect();
    const aspect = scene.width / scene.height;
    let dw = r.width;
    let dh = r.width / aspect;
    if (dh > r.height) {
      dh = r.height;
      dw = r.height * aspect;
    }
    const u = (e.clientX - r.left - (r.width - dw) / 2) / dw;
    const v = (e.clientY - r.top - (r.height - dh) / 2) / dh;
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      measure.hidden = true;
      return;
    }
    const x = Math.min(scene.width - 1, Math.floor(u * scene.width));
    const y = Math.min(scene.height - 1, Math.floor(v * scene.height));
    const i = y * scene.width + x;
    measure.hidden = false;
    measure.innerHTML = '';
    measure.append(
      h('div', {}, `Depth ${(scene.depth[i] ?? 0).toFixed(3)}`),
      h('div', { class: 'dim' }, `Mask ${(scene.mask[i] ?? 0).toFixed(2)} · ${x}, ${y}`),
    );
    measure.style.left = `${e.clientX - r.left + 14}px`;
    measure.style.top = `${e.clientY - r.top + 14}px`;
    void p;
  };

  ctx.ui.on('tool', () => {
    main.dataset.tool = ctx.ui.tool;
    measure.hidden = true;
    ctx.ui.setHint(hintsFor(ctx.ui.tool));
  });
  main.dataset.tool = ctx.ui.tool;

  // Keymap hints in the status bar while hovering the viewport.
  main.addEventListener('pointerenter', () => ctx.ui.setHint(hintsFor(ctx.ui.tool)));
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

function hintsFor(tool: string): { icon: 'mouseL' | 'mouseM' | 'mouseR' | 'mouseWheel'; label: string }[] {
  switch (tool) {
    case 'orbit':
      return [
        { icon: 'mouseL', label: 'Orbit' },
        { icon: 'mouseM', label: 'Pan' },
        { icon: 'mouseWheel', label: 'Zoom' },
      ];
    case 'light':
      return [
        { icon: 'mouseL', label: 'Aim Light' },
        { icon: 'mouseR', label: 'Context' },
      ];
    case 'measure':
      return [
        { icon: 'mouseL', label: 'Inspect Depth' },
        { icon: 'mouseR', label: 'Context' },
      ];
    default:
      return [
        { icon: 'mouseL', label: 'Select' },
        { icon: 'mouseM', label: 'Pan' },
        { icon: 'mouseR', label: 'Context' },
      ];
  }
}
