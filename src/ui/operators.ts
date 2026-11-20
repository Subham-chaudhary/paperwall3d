/**
 * Operator registry in the spirit of Blender's bpy.ops: every user-visible action is an operator
 * with an id, label and optional shortcut. Menus, the F3 search popup, buttons and keyboard
 * shortcuts all dispatch through here.
 */
import { isTyping, pickFile } from './dom';
import type { AppContext } from './context';
import type { IconName } from './icons';
import { errorMessage } from './reports';
import { WORKSPACES, type Tool } from './state';
import { userPrefs } from './userprefs';
import { CAMERA_MODES, VIEW_MODES } from './viewmodes';
import { openAbout, openPreferences } from './dialogs';
import { openOperatorSearch } from './opsearch';
import { openPieMenu } from './pie';
import { openSplash } from './splash';

export interface Operator {
  id: string;
  label: string;
  category: string;
  /** Primary shortcut, e.g. "Ctrl+Shift+S". Displayed in menus as "Ctrl Shift S". */
  shortcut?: string;
  /** Additional bindings that are not displayed. */
  altShortcuts?: string[];
  icon?: IconName;
  /** Return false to disable the operator (greyed in menus, ignored by shortcuts). */
  poll?: (ctx: AppContext) => boolean;
  run: (ctx: AppContext) => void | Promise<void>;
}

/** "Ctrl+Shift+S" -> "Ctrl Shift S" (Blender style). */
export function formatShortcut(spec: string | undefined): string {
  return spec ? spec.split('+').join(' ') : '';
}

interface ParsedShortcut {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

function parseShortcut(spec: string): ParsedShortcut {
  const parts = spec.split('+');
  const key = parts.pop() ?? '';
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return { ctrl: mods.has('ctrl'), shift: mods.has('shift'), alt: mods.has('alt'), key };
}

function matches(e: KeyboardEvent, s: ParsedShortcut): boolean {
  if ((e.ctrlKey || e.metaKey) !== s.ctrl || e.shiftKey !== s.shift || e.altKey !== s.alt) return false;
  if (s.key === 'Numpad .') return e.code === 'NumpadDecimal';
  if (s.key === 'Space') return e.code === 'Space';
  if (/^[0-9]$/.test(s.key)) return e.code === `Digit${s.key}`;
  return e.key.toLowerCase() === s.key.toLowerCase();
}

export class OperatorRegistry {
  private ops = new Map<string, Operator>();
  private parsed = new Map<string, ParsedShortcut[]>();
  private ctx: AppContext | null = null;

  bind(ctx: AppContext): void {
    this.ctx = ctx;
  }

  register(op: Operator): void {
    this.ops.set(op.id, op);
    const specs = [op.shortcut, ...(op.altShortcuts ?? [])].filter((s): s is string => !!s);
    this.parsed.set(op.id, specs.map(parseShortcut));
  }

  get(id: string): Operator | undefined {
    return this.ops.get(id);
  }

  list(): Operator[] {
    return [...this.ops.values()];
  }

  /** Whether the operator can currently run. */
  enabled(id: string): boolean {
    const op = this.ops.get(id);
    return !!op && !!this.ctx && (op.poll ? op.poll(this.ctx) : true);
  }

  /** Run an operator by id; errors are reported in the status bar. */
  run(id: string): void {
    const ctx = this.ctx;
    const op = this.ops.get(id);
    if (!ctx || !op) return;
    if (op.poll && !op.poll(ctx)) return;
    try {
      const r = op.run(ctx);
      if (r instanceof Promise) {
        r.catch((e: unknown) => ctx.reports.error(`${op.label}: ${errorMessage(e)}`, e));
      }
    } catch (e) {
      ctx.reports.error(`${op.label}: ${errorMessage(e)}`, e);
    }
  }

  /** Keyboard dispatch. Returns true when a shortcut was consumed. */
  handleKey(e: KeyboardEvent): boolean {
    if (e.isComposing || e.repeat || isTyping(e.target)) return false;
    for (const op of this.ops.values()) {
      const specs = this.parsed.get(op.id);
      if (!specs?.some((s) => matches(e, s))) continue;
      if (!this.enabled(op.id)) continue;
      e.preventDefault();
      this.run(op.id);
      return true;
    }
    return false;
  }
}

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';

/** Register the built-in operator set. */
export function registerOperators(reg: OperatorRegistry): void {
  const hasImage = (c: AppContext): boolean => c.source !== null;
  const hasRenderer = (c: AppContext): boolean => c.renderer !== null;

  // ── File ──
  reg.register({
    id: 'file.new', label: 'New', category: 'File', icon: 'file', shortcut: 'Ctrl+N',
    run: (c) => c.newScene(),
  });
  reg.register({
    id: 'file.open_image', label: 'Open Image…', category: 'File', icon: 'folder', shortcut: 'Ctrl+O',
    run: async (c) => {
      const file = await pickFile(IMAGE_ACCEPT);
      if (file) await c.openImage(file, file.name);
    },
  });
  reg.register({
    id: 'file.save_project', label: 'Save Project to Browser', category: 'File', icon: 'save', shortcut: 'Ctrl+S',
    poll: hasImage,
    run: (c) => c.saveProject(),
  });
  reg.register({
    id: 'file.import_config', label: 'Import Wallpaper Config…', category: 'File', icon: 'import', shortcut: 'Ctrl+Shift+O',
    run: async (c) => {
      const file = await pickFile('.json,application/json,.pw3d.json');
      if (file) await c.importConfig(file);
    },
  });
  reg.register({
    id: 'file.export_config', label: 'Export Wallpaper Config…', category: 'File', icon: 'export', shortcut: 'Ctrl+Shift+S',
    run: (c) => c.exportConfig(userPrefs.get('embedAssets')),
  });
  reg.register({
    id: 'file.export_config_embedded', label: 'Export Wallpaper Config (Embed Assets)…', category: 'File', icon: 'export',
    poll: hasImage,
    run: (c) => c.exportConfig(true),
  });
  reg.register({
    id: 'file.export_glb', label: 'Export GLB…', category: 'File', icon: 'cube', shortcut: 'Ctrl+E',
    poll: hasRenderer,
    run: (c) => c.exportGLB(),
  });
  reg.register({
    id: 'render.image', label: 'Render Image', category: 'Render', icon: 'aperture', shortcut: 'F12',
    poll: hasRenderer,
    run: (c) => c.renderImage(userPrefs.get('outputWidth') || undefined, userPrefs.get('outputHeight') || undefined),
  });

  // ── Edit ──
  reg.register({
    id: 'edit.undo', label: 'Undo', category: 'Edit', icon: 'undo', shortcut: 'Ctrl+Z',
    poll: (c) => c.store.canUndo(),
    run: (c) => void c.store.undo(),
  });
  reg.register({
    id: 'edit.redo', label: 'Redo', category: 'Edit', icon: 'redo', shortcut: 'Ctrl+Shift+Z', altShortcuts: ['Ctrl+Y'],
    poll: (c) => c.store.canRedo(),
    run: (c) => void c.store.redo(),
  });
  reg.register({
    id: 'edit.reset_settings', label: 'Reset Settings to Defaults', category: 'Edit', icon: 'refresh',
    run: (c) => c.resetSettings(),
  });
  reg.register({
    id: 'image.reanalyze', label: 'Re-analyze Image', category: 'Image', icon: 'refresh', shortcut: 'Shift+R',
    poll: hasImage,
    run: (c) => c.reanalyze(),
  });
  reg.register({
    id: 'job.cancel', label: 'Cancel Running Job', category: 'Image', icon: 'close',
    poll: (c) => c.busy,
    run: (c) => c.cancelJob(),
  });

  // ── View ──
  reg.register({
    id: 'view.reset', label: 'Reset View', category: 'View', icon: 'view3d', shortcut: 'Home', altShortcuts: ['Numpad .'],
    poll: hasRenderer,
    run: (c) => c.resetView(),
  });
  reg.register({
    id: 'view.fullscreen_preview', label: 'Toggle Fullscreen Preview', category: 'View', icon: 'fullscreen', shortcut: 'F11', altShortcuts: ['Ctrl+Space'],
    run: (c) => {
      const on = !c.ui.fullscreen;
      c.ui.setFullscreen(on);
      if (on) {
        c.reports.info('Fullscreen preview: press Esc, F11 or Ctrl+Space to return');
        void document.documentElement.requestFullscreen?.().catch(() => undefined);
      } else if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
    },
  });
  reg.register({
    id: 'view.toggle_sidebar', label: 'Toggle Sidebar', category: 'View', icon: 'sidebar', shortcut: 'N',
    run: (c) => c.ui.setSidebar(!c.ui.sidebarOpen),
  });
  reg.register({
    id: 'view.toggle_strip', label: 'Toggle Image Editor Strip', category: 'View', icon: 'imageEditor', shortcut: 'Ctrl+T',
    run: (c) => c.ui.setStrip(!c.ui.stripOpen),
  });
  reg.register({
    id: 'view.toggle_stats', label: 'Toggle Statistics Overlay', category: 'View', icon: 'info',
    run: (c) => {
      c.store.checkpoint();
      c.store.set('view.showStats', !c.store.getValue('view.showStats'));
    },
  });
  reg.register({
    id: 'view.toggle_grid', label: 'Toggle Grid', category: 'View', icon: 'grid',
    run: (c) => {
      c.store.checkpoint();
      c.store.set('view.showGrid', !c.store.getValue('view.showGrid'));
    },
  });
  reg.register({
    id: 'view.toggle_drawer', label: 'Toggle Right Panel Drawer', category: 'View', icon: 'sidebar',
    run: (c) => c.ui.setDrawer(!c.ui.drawerOpen),
  });
  reg.register({
    id: 'view.pie', label: 'View Mode Pie Menu', category: 'View', icon: 'aperture', shortcut: 'Z',
    run: (c) => openPieMenu(c),
  });
  for (const m of VIEW_MODES) {
    reg.register({
      id: `view.mode_${m.value}`, label: `View Mode: ${m.label}`, category: 'View', icon: m.icon,
      run: (c) => c.store.set('view.mode', m.value),
    });
  }
  for (const m of CAMERA_MODES) {
    reg.register({
      id: `camera.mode_${m.value}`, label: `Camera Mode: ${m.label}`, category: 'View', icon: m.icon,
      run: (c) => {
        c.store.checkpoint();
        c.store.set('camera.mode', m.value);
      },
    });
  }

  // ── Window / workspaces / tools ──
  WORKSPACES.forEach((w, i) => {
    reg.register({
      id: `window.workspace_${w.id}`, label: `Workspace: ${w.label}`, category: 'Window', icon: 'view3d',
      shortcut: `Alt+${i + 1}`, // Ctrl+digit is reserved by browsers for tab switching
      run: (c) => {
        c.ui.setWorkspace(w.id);
        c.ui.setTab(w.tab);
        c.store.set('view.mode', w.mode);
      },
    });
  });
  const tools: [Tool, string, IconName][] = [
    ['select', 'Select / Pan View', 'cursor'],
    ['orbit', 'Orbit', 'orbit'],
    ['light', 'Light Direction', 'lightDir'],
    ['measure', 'Measure Depth', 'eyedropper'],
  ];
  for (const [t, label, ic] of tools) {
    reg.register({ id: `tool.${t}`, label: `Tool: ${label}`, category: 'Tool', icon: ic, run: (c) => c.ui.setTool(t) });
  }
  reg.register({ id: 'window.about', label: 'About PaperWall3D', category: 'Help', icon: 'info', run: (c) => openAbout(c) });
  reg.register({ id: 'window.preferences', label: 'Preferences…', category: 'Edit', icon: 'gear', shortcut: 'Ctrl+,', run: (c) => openPreferences(c) });
  reg.register({ id: 'window.splash', label: 'Splash Screen', category: 'Help', icon: 'logo', run: (c) => openSplash(c) });
  reg.register({
    id: 'help.shortcuts', label: 'Keyboard Shortcuts (F3 Search)', category: 'Help', icon: 'keyboard',
    run: (c) => openOperatorSearch(c),
  });
  reg.register({ id: 'search.operators', label: 'Operator Search', category: 'Window', icon: 'search', shortcut: 'F3', run: (c) => openOperatorSearch(c) });
}
