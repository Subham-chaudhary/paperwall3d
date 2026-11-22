/**
 * Blender-style pie menu (opened with Z): eight slots arranged radially around the cursor.
 * Hold the key and move toward a slice, then release to choose; a quick tap leaves the pie open
 * so a slice can be clicked.
 */
import type { AppContext } from './context';
import { clamp, h } from './dom';
import { icon, type IconName } from './icons';

interface Slice {
  label: string;
  icon: IconName;
  /** Math angle in degrees: 0 = right, 90 = up. */
  angle: number;
  active?: boolean;
  run: () => void;
}

const lastPointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
window.addEventListener('pointermove', (e) => {
  lastPointer.x = e.clientX;
  lastPointer.y = e.clientY;
});

let activeClose: (() => void) | null = null;

const RADIUS = 104;
const DEAD_ZONE = 26;

export function openPieMenu(ctx: AppContext): void {
  activeClose?.();
  const mode = ctx.store.getValue('view.mode');
  const stage = ctx.store.getValue('view.stage');
  const is2d = mode === '2d';
  const slices: Slice[] = [
    { label: '2D Parallax', icon: 'imageEditor', angle: 180, active: is2d, run: () => ctx.showView('2d') },
    { label: '3D Camera', icon: 'view3d', angle: 0, active: mode === '3d', run: () => ctx.showView('3d') },
    { label: 'Result', icon: 'aperture', angle: 90, active: is2d && stage === 'result', run: () => ctx.showView('2d', 'result') },
    { label: 'config.json', icon: 'file', angle: 270, active: mode === 'config', run: () => ctx.showView('config') },
    { label: 'Mask', icon: 'mask', angle: 135, active: is2d && stage === 'mask', run: () => ctx.showView('2d', 'mask') },
    { label: 'Object Depth', icon: 'depth', angle: 45, active: is2d && stage === 'objdepth', run: () => ctx.showView('2d', 'objdepth') },
    { label: 'Whole Depth', icon: 'shadedSphere', angle: 225, active: is2d && stage === 'depth', run: () => ctx.showView('2d', 'depth') },
    { label: 'Preview Wallpaper', icon: 'fullscreen', angle: 315, run: () => ctx.ops.run('view.preview_wallpaper') },
  ];

  const cx = clamp(lastPointer.x, RADIUS + 70, window.innerWidth - RADIUS - 70);
  const cy = clamp(lastPointer.y, RADIUS + 30, window.innerHeight - RADIUS - 30);
  const SVG = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'pw-pie-ring');
  svg.setAttribute('viewBox', '-130 -130 260 260');
  svg.setAttribute('width', '260');
  svg.setAttribute('height', '260');
  const circle = document.createElementNS(SVG, 'circle');
  circle.setAttribute('r', '64');
  circle.setAttribute('class', 'pw-pie-disc');
  const wedge = document.createElementNS(SVG, 'path');
  wedge.setAttribute('class', 'pw-pie-wedge');
  svg.append(circle, wedge);

  const pie = h('div', { class: 'pw-pie' }, svg);
  pie.style.left = `${cx}px`;
  pie.style.top = `${cy}px`;
  const buttons = slices.map((s) => {
    const rad = (s.angle * Math.PI) / 180;
    const b = h('div', { class: 'pw-pie-item' + (s.active ? ' current' : '') }, icon(s.icon, 16), h('span', { text: s.label }));
    b.style.left = `${Math.cos(rad) * RADIUS}px`;
    b.style.top = `${-Math.sin(rad) * RADIUS}px`;
    pie.appendChild(b);
    return b;
  });
  const layer = h('div', { class: 'pw-pie-layer' }, pie);
  document.body.appendChild(layer);

  let hover = -1;
  const openedAt = performance.now();

  const wedgePath = (angle: number): string => {
    const a0 = ((angle - 22.5) * Math.PI) / 180;
    const a1 = ((angle + 22.5) * Math.PI) / 180;
    const r0 = 30;
    const r1 = 66;
    const p = (r: number, a: number): string => `${(Math.cos(a) * r).toFixed(2)},${(-Math.sin(a) * r).toFixed(2)}`;
    return `M${p(r0, a0)} L${p(r1, a0)} A${r1},${r1} 0 0 0 ${p(r1, a1)} L${p(r0, a1)} A${r0},${r0} 0 0 1 ${p(r0, a0)} Z`;
  };

  const setHover = (i: number): void => {
    hover = i;
    buttons.forEach((b, j) => b.classList.toggle('hover', j === i));
    const s = slices[i];
    wedge.setAttribute('d', s ? wedgePath(s.angle) : '');
  };

  const close = (): void => {
    layer.remove();
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('keydown', onKeyDown, true);
    activeClose = null;
  };
  activeClose = close;

  const choose = (): void => {
    const s = slices[hover];
    close();
    s?.run();
  };

  function onMove(e: PointerEvent): void {
    const dx = e.clientX - cx;
    const dy = cy - e.clientY;
    if (Math.hypot(dx, dy) < DEAD_ZONE) {
      setHover(-1);
      return;
    }
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    let best = 0;
    let bestD = Infinity;
    slices.forEach((s, i) => {
      let d = Math.abs(((ang - s.angle + 540) % 360) - 180);
      d = Math.min(d, 360 - d);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best !== hover) setHover(best);
  }
  function onKeyUp(e: KeyboardEvent): void {
    if (e.key.toLowerCase() !== 'z') return;
    if (hover >= 0) choose();
    else if (performance.now() - openedAt > 350) close(); // long hold without selection cancels
  }
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('keydown', onKeyDown, true);
  layer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (hover >= 0) choose();
    else close();
  });
}
