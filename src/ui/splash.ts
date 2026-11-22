/** Blender-style splash screen: hero banner, quick actions, recent projects and links. */
import { APP_NAME, APP_VERSION } from '../core/version';
import { whatsNewSummary } from '../core/releaseNotes';
import type { AppContext } from './context';
import { PRESETS } from '../core/presets';
import { h, pickFile } from './dom';
import { icon, iconSvg, type IconName } from './icons';
import { userPrefs } from './userprefs';
import { checkbox } from './widgets/controls';

/**
 * Hero banner: the logo artwork (three stacked photo cards with long diagonal shadows) redrawn as
 * separate parallax layers on black. Coordinates are the logo's own card space, cropped to the banner.
 */
const BANNER_SVG = `
<svg class="pw-splash-art" viewBox="-600 110 1600 546" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <clipPath id="pwCardPink"><rect x="258" y="328" width="702" height="592" rx="30"/></clipPath>
    <clipPath id="pwCardLime"><rect x="158" y="228" width="707" height="592" rx="30"/></clipPath>
    <clipPath id="pwCardBlue"><rect x="65" y="128" width="703" height="587" rx="30"/></clipPath>
  </defs>
  <g class="pw-parallax" data-depth="6"><g clip-path="url(#pwCardPink)">
    <path fill="#ff1f6b" d="M258 328h702v592H258z"/>
    <path d="M500 697h365l95 95v128H600l-80-100-20-25Z" fill="#9a0b36"/>
    <path d="m608 440 354.459 348.312L960 920H860L608 666z" fill="#6a0722"/>
  </g></g>
  <g class="pw-parallax" data-depth="13"><g clip-path="url(#pwCardLime)">
    <path fill="#e6ff3b" d="M158 228h707v592H158z"/>
    <path d="M423.548 701H869l-4-4v123H520z" fill="#ff8a2b"/>
    <path d="m512 344 354.639 350.132L865 820l-104.105.276L512 570z" fill="#7b2ee0"/>
  </g></g>
  <g class="pw-parallax" data-depth="22"><g clip-path="url(#pwCardBlue)">
    <path fill="#0a6cff" d="M65 128h703v587H65z"/>
    <circle cx="603" cy="285" r="58" fill="#ff3c9e"/>
    <path d="m345 530 121-25 89-75q15-14 29 0l184 170v115H345Z" fill="#14104a"/>
    <path d="M578.802 428.116 640 520l-11 29 83 166h56l.12-117.522-183.922-170.736c-5.378-4.485-7.757-2.202-5.396 1.374" fill="#00d6f0"/>
    <path d="M462.833 507.311 555 430q15-14 29 0l184 170" fill="none" stroke="#2fe6ff" stroke-width="5" stroke-linejoin="round"/>
    <path d="m65 535 203-173q12-12 24 0l78 108 25 62h-50l35 83 55 100H65Z" fill="#3d0d5e"/>
    <path d="m65 535 203-173q12-12 24 0" fill="none" stroke="#e61ee8" stroke-width="5" stroke-linejoin="round"/>
    <path d="m437 495 218 220h-17l-98-83-58-17 8-8 37 3Z" fill="#e61ee8"/>
    <path d="m312.282 391.323 130.805 100.131L527 610l13 22-58-17 8-8-95-75-25-62z" fill="#8c2be6"/>
    <path d="M266.079 361.129c8.667-10 23.254-10.796 35.921-4.129l160 146 195.739 213.541L646.206 715 437 495l-115-95z" fill="#e61ee8"/>
  </g></g>
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
    h('div', { class: 'pw-splash-title' }, h('span', { class: 'pw-splash-logo', html: iconSvg('logo', 40) }), h('span', { text: APP_NAME })),
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
  const presetBtns = PRESETS.map((p) =>
    linkRow('sparkle', `Open Image as ${p.label}…`, p.desc, act(() => void pickFile('image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp').then((file) => file && ctx.openImage(file, file.name, p.id)))),
  );
  const cfgBtn = linkRow('import', 'Load Config…', '.pw3d.json or 2.5dwallpp config.json', act(() => ctx.ops.run('file.import_config')));

  const left = h(
    'div',
    { class: 'pw-splash-col' },
    h('div', { class: 'pw-splash-h', text: 'New File' }),
    newBtn,
    openBtn,
    ...presetBtns,
    cfgBtn,
    h('div', { class: 'pw-splash-h', text: 'Recent Projects' }),
    recentList,
  );
  const right = h(
    'div',
    { class: 'pw-splash-col' },
    h('div', { class: 'pw-splash-h', text: 'Links' }),
    linkRow('shield', 'Privacy', 'All processing happens on your device', act(() => ctx.ops.run('window.about'))),
    linkRow('sparkle', "What's New", `${APP_VERSION}: ${whatsNewSummary()}`, act(() => ctx.ops.run('window.about'))),
    linkRow('keyboard', 'Shortcuts', 'F3 searches every operator, Z opens the view pie, P picks the object', act(() => ctx.ops.run('search.operators'))),
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
