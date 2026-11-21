/** Ephemeral UI state (active workspace, tab, tool, panel visibility) with change events. */
import { Emitter } from '../core/events';
import type { ViewMode } from '../core/types';
import { DEFAULT_LAYOUT, getPref, setPref, type LayoutPrefs } from '../persistence/prefs';
import type { IconName } from './icons';

export type Workspace = 'layout' | 'segmentation' | 'depth' | 'shading' | 'export';
export type PropTab =
  | 'image'
  | 'segmentation'
  | 'depth'
  | 'reconstruction'
  | 'geometry'
  | 'lighting'
  | 'camera'
  | 'view'
  | 'output'
  | 'system';
export type Tool = 'select' | 'orbit' | 'light' | 'brush' | 'measure';
export type LayerId = 'camera' | 'keyLight' | 'rimLight' | 'background' | 'foreground' | 'depth' | 'mask';
export type OutlinerId = 'scene' | LayerId;

export interface WorkspaceDef {
  id: Workspace;
  label: string;
  tab: PropTab;
  mode: ViewMode;
}

export const WORKSPACES: readonly WorkspaceDef[] = [
  { id: 'layout', label: 'Layout', tab: 'image', mode: 'render' },
  { id: 'segmentation', label: 'Segmentation', tab: 'segmentation', mode: 'mask' },
  { id: 'depth', label: 'Depth', tab: 'depth', mode: 'depth' },
  { id: 'shading', label: 'Shading', tab: 'lighting', mode: 'render' },
  { id: 'export', label: 'Export', tab: 'output', mode: 'render' },
];

export interface HintItem {
  icon: IconName;
  label: string;
}

export interface UIEvents extends Record<string, unknown> {
  workspace: Workspace;
  tab: PropTab;
  tool: Tool;
  sidebar: boolean;
  strip: boolean;
  fullscreen: boolean;
  drawer: boolean;
  selection: OutlinerId;
  layers: Record<LayerId, boolean>;
  hint: HintItem[];
  layout: LayoutPrefs;
}

export class UIState extends Emitter<UIEvents> {
  workspace: Workspace = 'layout';
  tab: PropTab = 'image';
  tool: Tool = 'select';
  selection: OutlinerId = 'scene';
  fullscreen = false;
  drawerOpen = false;
  layout: LayoutPrefs;
  /** UI-side visibility of scene layers (eye toggles in the outliner). */
  layers: Record<LayerId, boolean> = {
    camera: true,
    keyLight: true,
    rimLight: true,
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

  setTool(t: Tool): void {
    if (this.tool === t) return;
    this.tool = t;
    this.emit('tool', t);
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

  setFullscreen(on: boolean): void {
    if (this.fullscreen === on) return;
    this.fullscreen = on;
    this.emit('fullscreen', on);
  }

  setDrawer(open: boolean): void {
    this.drawerOpen = open;
    this.emit('drawer', open);
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
