/** About and Preferences dialogs. */
import { APP_NAME, APP_VERSION } from '../core/version';
import type { AppContext } from './context';
import { h } from './dom';
import { iconSvg } from './icons';
import { userPrefs } from './userprefs';
import { button, checkbox } from './widgets/controls';
import { column, propRow } from './widgets/layout';
import { openWindow } from './window';

interface License {
  name: string;
  license: string;
  by: string;
}

const LICENSES: License[] = [
  { name: 'ONNX Runtime Web', license: 'MIT', by: 'Microsoft' },
  { name: 'Three.js', license: 'MIT', by: 'three.js authors' },
  { name: 'U²-Net / U²-Net-P', license: 'Apache-2.0', by: 'Xuebin Qin et al.' },
  { name: 'Depth Anything V2 Small', license: 'Apache-2.0', by: 'Lihe Yang et al.' },
];

function licenseTable(): HTMLElement {
  return h(
    'table',
    { class: 'pw-table' },
    h('thead', {}, h('tr', {}, h('th', { text: 'Component' }), h('th', { text: 'License' }), h('th', { text: 'Authors' }))),
    h(
      'tbody',
      {},
      ...LICENSES.map((l) => h('tr', {}, h('td', { text: l.name }), h('td', { text: l.license }), h('td', { text: l.by }))),
    ),
  );
}

export function openAbout(_ctx: AppContext): void {
  const content = h(
    'div',
    { class: 'pw-dialog pw-about' },
    h(
      'div',
      { class: 'pw-about-head' },
      h('span', { class: 'pw-about-logo', html: iconSvg('logo', 56) }),
      h(
        'div',
        {},
        h('div', { class: 'pw-about-name', text: APP_NAME }),
        h('div', { class: 'pw-about-version', text: `Version ${APP_VERSION}` }),
      ),
    ),
    h('p', { class: 'pw-note', text: 'Turn any image into a depth-aware 2.5D parallax 3D wallpaper using in-browser AI. Segmentation and depth estimation run on your device through ONNX Runtime Web (WebGPU with WASM fallback); the scene is rendered with Three.js.' }),
    h('p', { class: 'pw-note privacy', text: 'Privacy: all processing happens on your device. Your images are never uploaded.' }),
    h('h4', { class: 'pw-dialog-h', text: 'Third-party licenses' }),
    licenseTable(),
  );
  openWindow({ title: `About ${APP_NAME}`, icon: 'info', width: 460, content, modal: true });
}

export function openPreferences(ctx: AppContext): void {
  const content = h(
    'div',
    { class: 'pw-dialog' },
    h('h4', { class: 'pw-dialog-h', text: 'Interface' }),
    column(
      propRow(null, checkbox({ bind: userPrefs.binding('showSplash'), label: 'Show Splash Screen on Startup' }).el),
    ),
    h('h4', { class: 'pw-dialog-h', text: 'Export' }),
    column(
      propRow(null, checkbox({ bind: userPrefs.binding('embedAssets'), label: 'Embed Assets in Wallpaper Config by Default' }).el),
    ),
    h('h4', { class: 'pw-dialog-h', text: 'Storage' }),
    column(
      propRow(
        null,
        button({
          label: 'Clear Model Cache',
          icon: 'trash',
          variant: 'danger',
          onClick: () => void ctx.clearModelCache(),
          tip: { desc: 'Remove downloaded AI models from browser storage.' },
        }).el,
      ),
      propRow(
        null,
        button({
          label: 'Reset Settings to Defaults',
          icon: 'refresh',
          onClick: () => ctx.resetSettings(),
        }).el,
      ),
    ),
    h('h4', { class: 'pw-dialog-h', text: 'About' }),
    propRow(null, button({ label: 'About PaperWall3D', icon: 'info', onClick: () => ctx.ops.run('window.about') }).el),
  );
  openWindow({ title: 'Preferences', icon: 'gear', width: 420, content, modal: true });
}
