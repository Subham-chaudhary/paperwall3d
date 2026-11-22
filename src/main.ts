import './ui/styles/theme.css';
import './ui/styles/layout.css';
import './ui/styles/widgets.css';
import './ui/styles/menus.css';
import './ui/styles/panels.css';
import './ui/styles/viewport.css';
import './ui/styles/statusbar.css';
import './ui/styles/splash.css';
import './ui/styles/editor.css';

import { App } from './app';

// Dropping a file outside a drop target must never navigate the tab away from the app.
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (e) => e.preventDefault());
}

const root = document.getElementById('app');
if (!root) throw new Error('#app root element is missing');

const app = new App();

// Surface unexpected errors in the status bar instead of failing silently.
window.addEventListener('unhandledrejection', (e) => {
  const reason: unknown = e.reason;
  app.reports.error(`Unhandled error: ${reason instanceof Error ? reason.message : String(reason)}`, reason);
});
window.addEventListener('error', (e) => {
  if (e.message) app.reports.error(`Error: ${e.message}`, e.error);
});

try {
  app.start(root);
} catch (e) {
  // Last-resort fallback so the page is never blank.
  console.error(e);
  root.textContent = `PaperWall3D failed to start: ${e instanceof Error ? e.message : String(e)}`;
  root.className = 'pw-fatal';
}

// Expose for debugging in the dev console.
if (import.meta.env.DEV) (window as unknown as { pw3d: App }).pw3d = app;
