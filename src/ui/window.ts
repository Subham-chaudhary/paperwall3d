/** Blender-style floating windows / popovers: title bar, drag to move, optional resize, Esc to close. */
import { clamp, h } from './dom';
import { icon, type IconName } from './icons';
import { isMenuOpen } from './widgets/menu';

export interface WindowOptions {
  title: string;
  icon?: IconName;
  width?: number;
  height?: number;
  content: Node;
  /** Dim the rest of the UI and close on outside click. */
  modal?: boolean;
  resizable?: boolean;
  onClose?: () => void;
}

export interface FloatingWindow {
  el: HTMLElement;
  close(): void;
}

let zCounter = 1000;
const open: FloatingWindow[] = [];

export function openWindow(o: WindowOptions): FloatingWindow {
  const closeBtn = h('button', { class: 'pw-win-close', attrs: { type: 'button', 'aria-label': 'Close' } }, icon('close', 12));
  const title = h(
    'div',
    { class: 'pw-win-title' },
    o.icon ? icon(o.icon, 14) : null,
    h('span', { class: 'pw-win-title-text', text: o.title }),
    closeBtn,
  );
  const body = h('div', { class: 'pw-win-body' }, o.content);
  const el = h('div', { class: 'pw-window' + (o.resizable ? ' resizable' : ''), attrs: { role: 'dialog', 'aria-label': o.title } }, title, body);
  const layer = h('div', { class: 'pw-win-layer' + (o.modal ? ' modal' : '') }, el);
  layer.style.zIndex = String(++zCounter);
  if (o.width) el.style.width = `${Math.min(o.width, window.innerWidth - 16)}px`;
  if (o.height) el.style.height = `${Math.min(o.height, window.innerHeight - 16)}px`;
  document.body.appendChild(layer);

  const place = (): void => {
    const x = Math.max(8, (window.innerWidth - el.offsetWidth) / 2 + open.length * 24);
    const y = Math.max(8, (window.innerHeight - el.offsetHeight) / 3 + open.length * 24);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };
  place();

  const handle: FloatingWindow = { el, close };
  open.push(handle);

  function close(): void {
    const i = open.indexOf(handle);
    if (i < 0) return;
    open.splice(i, 1);
    document.removeEventListener('keydown', onKey, true);
    layer.remove();
    o.onClose?.();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || isMenuOpen()) return;
    if (open[open.length - 1] !== handle) return;
    const t = e.target as HTMLElement | null;
    if (t instanceof HTMLInputElement && t.type === 'text') return; // let fields cancel edits first
    e.preventDefault();
    close();
  }
  document.addEventListener('keydown', onKey, true);

  closeBtn.addEventListener('click', close);
  if (o.modal) {
    layer.addEventListener('pointerdown', (e) => {
      if (e.target === layer) close();
    });
  }
  el.addEventListener('pointerdown', () => {
    layer.style.zIndex = String(++zCounter);
  });

  title.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('.pw-win-close') || e.button !== 0) return;
    const rect = el.getBoundingClientRect();
    const ox = e.clientX - rect.left;
    const oy = e.clientY - rect.top;
    title.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent): void => {
      el.style.left = `${clamp(ev.clientX - ox, -rect.width + 80, window.innerWidth - 80)}px`;
      el.style.top = `${clamp(ev.clientY - oy, 0, window.innerHeight - 28)}px`;
    };
    const up = (): void => {
      title.removeEventListener('pointermove', move);
      title.removeEventListener('pointerup', up);
    };
    title.addEventListener('pointermove', move);
    title.addEventListener('pointerup', up);
  });

  return handle;
}
