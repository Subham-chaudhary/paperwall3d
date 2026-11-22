/** Top bar: logo, dropdown menus, workspace tabs, scene name field. */
import type { AppContext } from './context';
import { h } from './dom';
import { icon } from './icons';
import { formatShortcut } from './operators';
import { WORKSPACES } from './state';
import { STAGES, VIEW_MODES } from './viewmodes';
import { customBinding } from './widgets/binding';
import { textField } from './widgets/controls';
import { closeMenus, isMenuOpenFor, openMenu, type MenuItem } from './widgets/menu';
import { tip } from './widgets/tooltip';
import type { ProjectSummary } from '../persistence/projects';

type MenuBuilder = () => MenuItem[];

export function createTopBar(ctx: AppContext): HTMLElement {
  let recents: ProjectSummary[] = [];
  const loadRecents = (): void => {
    void ctx.recentProjects().then((r) => (recents = r)).catch(() => (recents = []));
  };
  loadRecents();
  ctx.events.on('recents', loadRecents);

  /** Menu entry that dispatches an operator. Enabled state follows the operator's poll. */
  const op = (id: string, label?: string, extra?: Partial<MenuItem>): MenuItem => {
    const o = ctx.ops.get(id);
    return {
      label: label ?? o?.label ?? id,
      icon: o?.icon,
      shortcut: formatShortcut(o?.shortcut),
      disabled: !ctx.ops.enabled(id),
      run: () => ctx.ops.run(id),
      ...extra,
    };
  };
  const sep: MenuItem = { separator: true };

  const menus: [string, MenuBuilder][] = [
    [
      'File',
      () => [
        op('file.new'),
        op('file.open_image'),
        {
          label: 'Open Recent',
          icon: 'folder',
          submenu: () =>
            recents.length
              ? recents.map<MenuItem>((p) => ({ label: p.name, icon: 'image', run: () => void ctx.openProject(p.id) }))
              : [{ label: 'No recent projects', disabled: true }],
        },
        sep,
        op('file.save_project'),
        sep,
        op('file.import_config'),
        sep,
        op('view.preview_wallpaper', 'Preview Wallpaper & Export…'),
        op('file.export_html'),
        op('file.export_glb'),
        op('render.image'),
        op('file.export_config_json'),
        op('file.export_config'),
        op('file.export_config_embedded'),
      ],
    ],
    [
      'Edit',
      () => [
        op('edit.undo'),
        op('edit.redo'),
        sep,
        op('image.reanalyze'),
        op('edit.reset_settings'),
        sep,
        op('search.operators', 'Operator Search…'),
        op('window.preferences'),
      ],
    ],
    [
      'View',
      () => [
        op('view.toggle_sidebar', 'Sidebar', { checked: ctx.ui.sidebarOpen, icon: undefined }),
        op('view.toggle_strip', 'Image Editor Strip', { checked: ctx.ui.stripOpen, icon: undefined }),
        op('view.toggle_stats', 'Statistics', { checked: ctx.store.getValue('view.showStats'), icon: undefined }),
        sep,
        {
          label: 'View',
          icon: 'view3d',
          submenu: () =>
            VIEW_MODES.map<MenuItem>((m) => ({
              label: m.label,
              icon: m.icon,
              checked: ctx.store.getValue('view.mode') === m.value,
              run: () => ctx.showView(m.value),
            })),
        },
        {
          label: 'Show Stage',
          icon: 'layers',
          submenu: () =>
            STAGES.map<MenuItem>((m) => ({
              label: m.label,
              icon: m.icon,
              checked: ctx.store.getValue('view.stage') === m.value,
              run: () => ctx.showView('2d', m.value),
            })),
        },
        op('view.pick_object'),
        op('view.pie'),
        sep,
        op('view.reset'),
        op('view.preview_wallpaper'),
      ],
    ],
    [
      'Export',
      () => [
        op('view.preview_wallpaper', 'Preview Wallpaper…'),
        sep,
        op('file.export_html'),
        op('file.export_glb'),
        op('render.image'),
        op('file.export_config_json'),
        op('file.export_config'),
        op('file.export_config_embedded'),
        sep,
        op('image.reanalyze'),
        op('job.cancel'),
      ],
    ],
    [
      'Window',
      () => [
        ...WORKSPACES.map((w) => op(`window.workspace_${w.id}`, w.label, { checked: ctx.ui.workspace === w.id, icon: undefined })),
        sep,
        op('view.toggle_drawer'),
        op('window.splash'),
      ],
    ],
    ['Help', () => [op('search.operators', 'Operator Search (F3)…'), op('window.about'), op('window.splash')]],
  ];

  const bar = h('div', { class: 'pw-topbar', attrs: { role: 'menubar' } });
  const logo = h('button', { class: 'pw-logo-btn', attrs: { type: 'button' } }, icon('logo', 20));
  tip(logo, { desc: 'PaperWall3D', extra: 'Click for the splash screen' });
  logo.addEventListener('click', () => ctx.ops.run('window.splash'));
  bar.appendChild(logo);

  const buttons: HTMLElement[] = [];
  let anyOpen = false;
  const show = (btn: HTMLElement, build: MenuBuilder): void => {
    anyOpen = true;
    openMenu(build(), {
      anchor: btn,
      onClose: () => {
        anyOpen = false;
      },
    });
  };
  for (const [label, build] of menus) {
    const btn = h('button', { class: 'pw-menubtn', attrs: { type: 'button', 'aria-haspopup': 'menu' }, text: label });
    let toggledOff = false;
    btn.addEventListener('click', () => {
      if (toggledOff || isMenuOpenFor(btn)) {
        toggledOff = false;
        return;
      }
      show(btn, build);
    });
    btn.addEventListener('pointerdown', (e) => {
      // Clicking the already-open menu's button closes it (the document handler ignores anchor clicks).
      toggledOff = false;
      if (isMenuOpenFor(btn)) {
        e.preventDefault();
        toggledOff = true;
        closeMenus();
      }
    });
    btn.addEventListener('pointerenter', () => {
      if (anyOpen && !isMenuOpenFor(btn)) show(btn, build);
    });
    bar.appendChild(btn);
    buttons.push(btn);
  }

  // Workspace tabs
  const tabs = h('div', { class: 'pw-ws-tabs', attrs: { role: 'tablist' } });
  const wsButtons = new Map<string, HTMLElement>();
  for (const w of WORKSPACES) {
    const b = h('button', { class: 'pw-ws-tab', attrs: { type: 'button', role: 'tab' }, text: w.label });
    b.addEventListener('click', () => ctx.ops.run(`window.workspace_${w.id}`));
    tabs.appendChild(b);
    wsButtons.set(w.id, b);
  }
  const applyWs = (): void => wsButtons.forEach((b, id) => b.classList.toggle('active', id === ctx.ui.workspace));
  ctx.ui.on('workspace', applyWs);
  applyWs();
  bar.appendChild(tabs);

  bar.appendChild(h('div', { class: 'pw-topbar-spacer' }));

  // Right side: drawer toggle (narrow screens), undo/redo, scene name.
  const drawerBtn = h('button', { class: 'pw-topbtn drawer-toggle', attrs: { type: 'button' } }, icon('sidebar', 16));
  tip(drawerBtn, { desc: 'Toggle the Outliner / Properties drawer' });
  drawerBtn.addEventListener('click', () => ctx.ops.run('view.toggle_drawer'));
  bar.appendChild(drawerBtn);

  const undo = h('button', { class: 'pw-topbtn', attrs: { type: 'button' } }, icon('undo', 16));
  const redo = h('button', { class: 'pw-topbtn', attrs: { type: 'button' } }, icon('redo', 16));
  tip(undo, { desc: 'Undo the last settings change', extra: 'Ctrl Z' });
  tip(redo, { desc: 'Redo', extra: 'Ctrl Shift Z' });
  undo.addEventListener('click', () => ctx.ops.run('edit.undo'));
  redo.addEventListener('click', () => ctx.ops.run('edit.redo'));
  const syncUndo = (): void => {
    undo.toggleAttribute('disabled', !ctx.store.canUndo());
    redo.toggleAttribute('disabled', !ctx.store.canRedo());
  };
  ctx.store.subscribe(syncUndo);
  syncUndo();
  // Undo availability changes also when a checkpoint is recorded without a value change.
  window.setInterval(syncUndo, 600);
  bar.append(undo, redo);

  const name = textField({
    bind: customBinding(
      () => ctx.sceneName,
      (v) => {
        ctx.sceneName = v;
      },
      (fn) => ctx.events.on('name', fn),
    ),
    icon: 'scene',
    placeholder: 'Scene name',
    tip: { desc: 'Name of the scene. Used for saved projects and exported files.' },
  });
  name.el.classList.add('pw-scene-name');
  bar.appendChild(name.el);
  return bar;
}
