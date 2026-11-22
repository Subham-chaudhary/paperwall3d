/** Ephemeral UI state (active workspace, tab, picking, preview, panel visibility) with change events. */
import type { CategoryId } from '../core/categories';
import { Emitter } from '../core/events';
import type { SettingsPath, StageView, ViewMode } from '../core/types';
import { DEFAULT_LAYOUT, getPref, setPref, type LayoutPrefs } from '../persistence/prefs';
import type { IconName } from './icons';

export type Workspace = 'layout' | 'mask' | 'depth' | 'camera3d' | 'config' | 'export';
export type PropTab = 'scene' | 'image' | 'system';
/** Collapsible panels of the Scene tab: one per settings category (src/core/categories.ts). */
export type ScenePanel = CategoryId;
export type LayerId = 'camera' | 'background' | 'foreground' | 'depth' | 'mask';
export type OutlinerId = 'scene' | LayerId;

export interface WorkspaceDef {
  id: Workspace;
  label: string;
  /** Scene-tab panel the workspace scrolls to / expands. */
  panel?: ScenePanel;
  /** View + stage the workspace switches to (undefined = unchanged). Export opens the wallpaper preview instead. */
  mode?: ViewMode;
  stage?: StageView;
}

export const WORKSPACES: readonly WorkspaceDef[] = [
  { id: 'layout', label: 'Layout', panel: 'motion', mode: '2d', stage: 'result' },
  { id: 'mask', label: '1 · Mask', panel: 'subject', mode: '2d', stage: 'mask' },
  { id: 'depth', label: '2 · Depth', panel: 'depthMap', mode: '2d', stage: 'objdepth' },
  { id: 'camera3d', label: '3D Camera', panel: 'camera3d', mode: '3d' },
  { id: 'config', label: 'Config', mode: 'config' },
  { id: 'export', label: 'Export' },
];

/** Which workspace best describes the current view/stage. */
export function workspaceFor(mode: ViewMode, stage: StageView, current: Workspace): Workspace {
  if (mode === '3d') return 'camera3d';
  if (mode === 'config') return 'config';
  if (stage === 'mask') return 'mask';
  if (stage === 'objdepth' || stage === 'depth') return 'depth';
  return current === 'mask' || current === 'depth' || current === 'camera3d' || current === 'config' ? 'layout' : current;
}

export interface HintItem {
  icon: IconName;
  label: string;
}

export interface UIEvents extends Record<string, unknown> {
  workspace: Workspace;
  tab: PropTab;
  /** Reveal (expand + scroll to) a Scene-tab panel. */
  reveal: ScenePanel;
  /** Jump to one setting: open its panels, scroll to it and flash it (F3 search). */
  revealField: SettingsPath;
  sidebar: boolean;
  strip: boolean;
  drawer: boolean;
  selection: OutlinerId;
  layers: Record<LayerId, boolean>;
  hint: HintItem[];
  layout: LayoutPrefs;
  /** Pick Object mode toggled. */
  picking: boolean;
  /** The wallpaper preview overlay opened or closed. */
  preview: boolean;
}

export class UIState extends Emitter<UIEvents> {
  workspace: Workspace = 'layout';
  tab: PropTab = 'scene';
  selection: OutlinerId = 'scene';
  drawerOpen = false;
  picking = false;
  previewOpen = false;
  layout: LayoutPrefs;
  /** UI-side visibility of scene layers (eye toggles in the outliner). */
  layers: Record<LayerId, boolean> = {
    camera: true,
    background: true,
    foreground: true,
    depth: false,
    mask: false,
  };

  constructor() {
    super();
    this.layout = { ...DEFAULT_LAYOUT, ...getPref<Partial<LayoutPrefs>>('layout', {}) };
  }

  get sidebarOpen(): boolean {
    return this.layout.sidebarOpen;
  }

  get stripOpen(): boolean {
    return this.layout.stripOpen;
  }

  setWorkspace(w: Workspace): void {
    if (this.workspace === w) return;
    this.workspace = w;
    this.emit('workspace', w);
  }

  setTab(t: PropTab): void {
    if (this.tab === t) return;
    this.tab = t;
    this.emit('tab', t);
  }

  reveal(p: ScenePanel): void {
    this.setTab('scene');
    this.emit('reveal', p);
  }

  revealField(path: SettingsPath): void {
    this.setTab('scene');
    this.emit('revealField', path);
  }

  select(id: OutlinerId): void {
    this.selection = id;
    this.emit('selection', id);
  }

  setSidebar(open: boolean): void {
    this.updateLayout({ sidebarOpen: open });
    this.emit('sidebar', open);
  }

  setStrip(open: boolean): void {
    this.updateLayout({ stripOpen: open });
    this.emit('strip', open);
  }

  setDrawer(open: boolean): void {
    this.drawerOpen = open;
    this.emit('drawer', open);
  }

  setPicking(on: boolean): void {
    if (this.picking === on) return;
    this.picking = on;
    this.emit('picking', on);
  }

  setPreview(on: boolean): void {
    if (this.previewOpen === on) return;
    this.previewOpen = on;
    this.emit('preview', on);
  }

  setLayerVisible(id: LayerId, visible: boolean): void {
    this.layers = { ...this.layers, [id]: visible };
    this.emit('layers', this.layers);
  }

  setHint(items: HintItem[]): void {
    this.emit('hint', items);
  }

  updateLayout(patch: Partial<LayoutPrefs>): void {
    this.layout = { ...this.layout, ...patch };
    setPref('layout', this.layout);
    this.emit('layout', this.layout);
  }
}
