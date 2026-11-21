/** Blender-style splash screen: hero banner, quick actions, recent projects and links. */
import { APP_NAME, APP_VERSION } from '../core/version';
import type { AppContext } from './context';
import { h } from './dom';
import { icon, iconSvg, type IconName } from './icons';
import { userPrefs } from './userprefs';
import { checkbox } from './widgets/controls';

const BANNER_SVG = `
<svg class="pw-splash-art" viewBox="0 0 640 210" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="pwSky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1b2a4a"/><stop offset=".55" stop-color="#3b4f86"/><stop offset="1" stop-color="#d98a5b"/>
    </linearGradient>
    <filter id="pwShadow" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#000" flood-opacity=".5"/></filter>
  </defs>
  <rect width="640" height="210" fill="url(#pwSky)"/>
  <g class="pw-parallax" data-depth="2"><circle cx="470" cy="70" r="30" fill="#ffd9a0" opacity=".95"/><circle cx="470" cy="70" r="46" fill="#ffd9a0" opacity=".16"/></g>
  <g class="pw-parallax" data-depth="5" filter="url(#pwShadow)"><path d="M-20 150 L90 92 L170 128 L270 70 L380 130 L470 96 L560 140 L660 100 L660 230 L-20 230Z" fill="#5a6fae"/></g>
  <g class="pw-parallax" data-depth="9" filter="url(#pwShadow)"><path d="M-20 175 L60 138 L150 168 L250 122 L340 170 L450 130 L560 176 L660 146 L660 230 L-20 230Z" fill="#3b5894"/></g>
  <g class="pw-parallax" data-depth="15" filter="url(#pwShadow)"><path d="M-20 200 L110 168 L230 196 L340 160 L470 200 L660 170 L660 230 L-20 230Z" fill="#26416f"/></g>
  <g class="pw-parallax" data-depth="24" filter="url(#pwShadow)"><path d="M300 210 C300 150 340 120 372 96 C380 130 410 140 432 150 C412 160 406 188 430 210Z" fill="#ffa033"/><path d="M372 96 C376 130 372 170 366 210" stroke="#c4701a" stroke-width="2" fill="none"/></g>
</svg>`;

let activeClose: (() => void) | null = null;

function linkRow(ic: IconName, label: string, sub: string, onClick: () => void): HTMLElement {
  const el = h(
    'button',
    { class: 'pw-splash-link', attrs: { type: 'button' } },
    icon(ic, 16),
    h('span', { class: 'pw-splash-link-text' }, h('span', { class: 'pw-splash-link-title', text: label }), h('span', { class: 'pw-splash-link-sub', text: sub })),
  );
  el.addEventListener('click', onClick);
  return el;
}

export function openSplash(ctx: AppContext): void {
  activeClose?.();
  const layer = h('div', { class: 'pw-splash-layer' });
  const close = (): void => {
    layer.remove();
    document.removeEventListener('keydown', onKey, true);
    activeClose = null;
  };
  activeClose = close;
  const act = (fn: () => void) => (): void => {
    close();
    fn();
  };

  // Parallax banner reacting to the cursor.
  const banner = h('div', { class: 'pw-splash-banner', html: BANNER_SVG });
  banner.append(
    h('div', { class: 'pw-splash-title' }, h('span', { class: 'pw-splash-logo', html: iconSvg('logo', 34) }), h('span', { text: APP_NAME })),
    h('div', { class: 'pw-splash-version', text: APP_VERSION }),
  );
  banner.addEventListener('pointermove', (e) => {
    const r = banner.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    banner.querySelectorAll<SVGGElement>('.pw-parallax').forEach((g) => {
      const d = Number(g.dataset.depth ?? 0);
      g.style.transform = `translate(${(-nx * d).toFixed(2)}px, ${(-ny * d * 0.5).toFixed(2)}px)`;
    });
  });

  const recentList = h('div', { class: 'pw-splash-recents' }, h('div', { class: 'pw-note', text: 'Loading…' }));
  const urls: string[] = [];
  void ctx
    .recentProjects()
    .then((list) => {
      recentList.replaceChildren();
      if (!list.length) {
        recentList.appendChild(h('div', { class: 'pw-note', text: 'No saved projects yet. Press Ctrl S to save one.' }));
        return;
      }
      for (const p of list.slice(0, 6)) {
        const thumb = h('span', { class: 'pw-splash-thumb' });
        if (p.thumbnailBlob) {
          const u = URL.createObjectURL(p.thumbnailBlob);
          urls.push(u);
          thumb.style.backgroundImage = `url(${u})`;
        } else {
          thumb.appendChild(icon('image', 14));
        }
        const item = h(
          'button',
          { class: 'pw-splash-recent', attrs: { type: 'button' } },
          thumb,
          h('span', { class: 'pw-splash-recent-name', text: p.name }),
          h('span', { class: 'pw-splash-recent-date', text: new Date(p.updatedAt).toLocaleDateString() }),
        );
        item.addEventListener('click', act(() => void ctx.openProject(p.id)));
        recentList.appendChild(item);
      }
    })
    .catch(() => {
      recentList.replaceChildren(h('div', { class: 'pw-note', text: 'Saved projects are unavailable in this browser.' }));
    });

  const newBtn = linkRow('file', 'New', 'Start with the demo scene', act(() => ctx.newScene()));
  const openBtn = linkRow('folder', 'Open Image…', 'JPG, PNG or WebP', act(() => ctx.ops.run('file.open_image')));
  const cfgBtn = linkRow('import', 'Load Wallpaper Config…', '.pw3d.json', act(() => ctx.ops.run('file.import_config')));

  const left = h(
    'div',
    { class: 'pw-splash-col' },
    h('div', { class: 'pw-splash-h', text: 'New File' }),
    newBtn,
    openBtn,
    cfgBtn,
    h('div', { class: 'pw-splash-h', text: 'Recent Projects' }),
    recentList,
  );
  const right = h(
    'div',
    { class: 'pw-splash-col' },
    h('div', { class: 'pw-splash-h', text: 'Links' }),
    linkRow('shield', 'Privacy', 'All processing happens on your device', act(() => ctx.ops.run('window.about'))),
    linkRow('sparkle', "What's New", `PaperWall3D ${APP_VERSION}: Blender-style interface, live parallax, GLB export`, act(() => ctx.ops.run('window.about'))),
    linkRow('keyboard', 'Shortcuts', 'Press F3 to search every operator, Z for the view pie', act(() => ctx.ops.run('search.operators'))),
    linkRow('gear', 'Preferences', 'Startup, export and storage options', act(() => ctx.ops.run('window.preferences'))),
  );

  const footer = h(
    'div',
    { class: 'pw-splash-footer' },
    checkbox({ bind: userPrefs.binding('showSplash'), label: 'Show on Startup' }).el,
    h('span', { class: 'pw-splash-hint', text: 'Drop an image anywhere to begin' }),
  );
  const card = h('div', { class: 'pw-splash', attrs: { role: 'dialog', 'aria-label': 'Welcome' } }, banner, h('div', { class: 'pw-splash-body' }, left, right), footer);
  layer.appendChild(card);

  layer.addEventListener('pointerdown', (e) => {
    if (e.target === layer) close();
  });
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(layer);
  // Release object URLs once closed.
  const obs = new MutationObserver(() => {
    if (!layer.isConnected) {
      urls.forEach((u) => URL.revokeObjectURL(u));
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true });
}
