/** Bottom image-editor strip: 2D thumbnails of every pipeline layer; click one to open it larger. */
import type { PreparedScene, StageView } from '../core/types';
import type { AppContext } from './context';
import { h } from './dom';
import { icon, type IconName } from './icons';
import { openWindow } from './window';
import { tip } from './widgets/tooltip';

type LayerKind = 'source' | 'mask' | 'objdepth' | 'depth' | 'background' | 'object';

interface KindDef {
  id: LayerKind;
  label: string;
  icon: IconName;
  /** Transparent layers get a checkerboard backdrop. */
  checker?: boolean;
  /** Clicking shows this stage in the 2D view instead of opening a window. */
  stage?: StageView;
}

const KINDS: KindDef[] = [
  { id: 'source', label: 'Source', icon: 'image' },
  { id: 'mask', label: 'Mask', icon: 'mask', stage: 'mask' },
  { id: 'objdepth', label: 'Object Depth', icon: 'depth', stage: 'objdepth' },
  { id: 'depth', label: 'Whole Depth', icon: 'shadedSphere', stage: 'depth' },
  { id: 'background', label: 'Background', icon: 'mesh' },
  { id: 'object', label: 'Object', icon: 'mesh', checker: true },
];

function makeCanvas(w: number, hh: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hh;
  return c;
}

/** Render a layer of the scene into a full-resolution canvas. */
export function renderLayer(scene: PreparedScene, kind: LayerKind): HTMLCanvasElement {
  const { width: w, height: hh } = scene;
  const c = makeCanvas(w, hh);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const putImage = (img: ImageData): void => ctx.putImageData(img, 0, 0);
  const putMap = (map: Float32Array): void => {
    const img = ctx.createImageData(w, hh);
    for (let i = 0; i < w * hh; i++) {
      const v = Math.max(0, Math.min(255, Math.round((map[i] ?? 0) * 255)));
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  };
  switch (kind) {
    case 'source':
      putImage(scene.source);
      break;
    case 'mask':
      putMap(scene.mask);
      break;
    case 'objdepth': {
      // Object depth, shown only inside the object (black elsewhere).
      const m = new Float32Array(w * hh);
      for (let i = 0; i < m.length; i++) m[i] = (scene.objDepth[i] ?? 0) * Math.min(1, (scene.mask[i] ?? 0) * 4);
      putMap(m);
      break;
    }
    case 'depth':
      putMap(scene.depth);
      break;
    case 'background':
      putImage(scene.bgColor);
      break;
    case 'object':
      putImage(scene.fg);
      break;
  }
  return c;
}

/** Downscale a canvas so its long edge is at most `max` pixels. */
function downscale(src: HTMLCanvasElement, max: number): HTMLCanvasElement {
  const s = Math.min(1, max / Math.max(src.width, src.height));
  if (s >= 1) return src;
  const c = makeCanvas(Math.max(1, Math.round(src.width * s)), Math.max(1, Math.round(src.height * s)));
  const g = c.getContext('2d');
  if (g) {
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c.width, c.height);
  }
  return c;
}

export function createImageStrip(ctx: AppContext): HTMLElement {
  const toggleIcon = h('span', { class: 'pw-strip-toggle' });
  const header = h(
    'div',
    { class: 'pw-area-header pw-strip-header', attrs: { role: 'button', tabindex: 0 } },
    toggleIcon,
    h('span', { class: 'pw-editor-type' }, icon('imageEditor', 14), h('span', { text: 'Image Editor' })),
    h('span', { class: 'pw-strip-sub', text: 'Pipeline layers · click Mask / Depth to show the stage' }),
  );
  tip(header, { desc: 'Show or hide the layer thumbnails', extra: 'Ctrl T' });
  const toggle = (): void => ctx.ui.setStrip(!ctx.ui.stripOpen);
  header.addEventListener('click', toggle);
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });

  const body = h('div', { class: 'pw-strip-body' });
  const canvases = new Map<LayerKind, HTMLElement>();
  const cards = new Map<LayerKind, HTMLElement>();
  const empty = h('div', { class: 'pw-strip-empty', text: 'Open an image to see its layers' });

  for (const k of KINDS) {
    const holder = h('div', { class: 'pw-thumb-img' + (k.checker ? ' checker' : '') });
    const card = h(
      'button',
      { class: 'pw-thumb', attrs: { type: 'button' } },
      h('div', { class: 'pw-thumb-header' }, icon(k.icon, 12), h('span', { text: k.label })),
      holder,
    );
    tip(card, { desc: k.stage ? `Show ${k.label} as the stage in the 2D view` : `Open ${k.label} in a larger window` });
    cards.set(k.id, card);
    card.addEventListener('click', () => {
      const scene = ctx.scene;
      if (!scene || ctx.isDemo) return;
      if (k.stage) {
        ctx.showView('2d', k.stage);
        return;
      }
      const full = renderLayer(scene, k.id);
      const view = h('div', { class: 'pw-imgwin' + (k.checker ? ' checker' : '') }, full);
      openWindow({
        title: `${k.label} — ${scene.width} × ${scene.height}`,
        icon: k.icon,
        width: Math.min(900, Math.max(360, Math.round(window.innerWidth * 0.6))),
        height: Math.min(700, Math.max(300, Math.round(window.innerHeight * 0.65))),
        content: view,
        resizable: true,
      });
    });
    body.appendChild(card);
    canvases.set(k.id, holder);
  }
  body.appendChild(empty);

  const refresh = (): void => {
    const scene = ctx.scene;
    const show = !!scene && !ctx.isDemo;
    body.classList.toggle('has-scene', show);
    if (!scene || !show) {
      canvases.forEach((holder) => holder.replaceChildren());
      return;
    }
    for (const k of KINDS) {
      const holder = canvases.get(k.id);
      if (!holder) continue;
      const small = downscale(renderLayer(scene, k.id), 320);
      holder.replaceChildren(small);
    }
  };
  // Thumbnails are throttled and skipped while the strip is collapsed (re-rendered when reopened).
  let dirty = false;
  let timer: number | undefined;
  const schedule = (): void => {
    dirty = true;
    if (!ctx.ui.stripOpen || timer !== undefined) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      dirty = false;
      refresh();
    }, 150);
  };
  const syncOpen = (): void => {
    toggleIcon.replaceChildren(icon(ctx.ui.stripOpen ? 'triDown' : 'triRight', 12));
    if (ctx.ui.stripOpen && dirty) schedule();
  };
  const syncActive = (): void => {
    const on = ctx.store.getValue('view.mode') === '2d' ? ctx.store.getValue('view.stage') : null;
    for (const k of KINDS) cards.get(k.id)?.classList.toggle('active', !!k.stage && k.stage === on);
  };
  ctx.store.subscribe((_s, c) => c.some((p) => p === 'view.mode' || p === 'view.stage') && syncActive());
  syncActive();
  ctx.ui.on('strip', syncOpen);
  ctx.events.on('scene', schedule);
  syncOpen();
  refresh();

  return h('div', { class: 'pw-area pw-strip' }, header, body);
}
