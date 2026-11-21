/** Left tool column (Blender's toolbar). */
import type { AppContext } from './context';
import { h } from './dom';
import { icon, type IconName } from './icons';
import type { Tool } from './state';
import { tip } from './widgets/tooltip';

interface ToolDef {
  id: Tool;
  icon: IconName;
  label: string;
  desc: string;
  disabled?: boolean;
}

const TOOLS: (ToolDef | 'sep')[] = [
  { id: 'select', icon: 'cursor', label: 'Select / Pan View', desc: 'Move the pointer over the viewport to look around (parallax).' },
  { id: 'orbit', icon: 'orbit', label: 'Orbit', desc: 'Drag in the viewport to orbit the camera.' },
  'sep',
  { id: 'light', icon: 'lightDir', label: 'Light Direction', desc: 'Drag in the viewport to aim the key light.' },
  { id: 'measure', icon: 'eyedropper', label: 'Measure Depth', desc: 'Hover the viewport to read the depth value under the cursor.' },
  'sep',
  { id: 'brush', icon: 'brush', label: 'Mask Brush', desc: 'Paint corrections onto the segmentation mask. Coming soon.', disabled: true },
];

export function createToolbar(ctx: AppContext): HTMLElement {
  const el = h('div', { class: 'pw-toolbar', attrs: { role: 'toolbar', 'aria-orientation': 'vertical' } });
  const buttons = new Map<Tool, HTMLElement>();
  for (const t of TOOLS) {
    if (t === 'sep') {
      el.appendChild(h('div', { class: 'pw-toolbar-sep' }));
      continue;
    }
    const b = h('button', { class: 'pw-tool' + (t.disabled ? ' disabled' : ''), attrs: { type: 'button' } }, icon(t.icon, 18));
    tip(b, { title: t.label, desc: t.desc });
    if (!t.disabled) b.addEventListener('click', () => ctx.ui.setTool(t.id));
    else b.setAttribute('aria-disabled', 'true');
    el.appendChild(b);
    buttons.set(t.id, b);
  }
  const apply = (): void => buttons.forEach((b, id) => b.classList.toggle('active', id === ctx.ui.tool));
  ctx.ui.on('tool', apply);
  apply();
  return el;
}
