/** F3 operator search popup (Blender's menu search): fuzzy-filter every operator and run it. */
import { CATEGORIES } from '../core/categories';
import { fieldSchema } from '../core/schema';
import type { AppContext } from './context';
import { h } from './dom';
import { icon, type IconName } from './icons';
import { formatShortcut, type Operator } from './operators';

interface Scored {
  op: Operator;
  score: number;
  positions: number[];
}

/** Subsequence match with bonuses for consecutive characters and word starts. Returns null on no match. */
export function fuzzy(query: string, text: string): { score: number; positions: number[] } | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const positions: number[] = [];
  let ti = 0;
  let score = 0;
  let prev = -2;
  for (const ch of q) {
    if (ch === ' ') continue;
    const idx = t.indexOf(ch, ti);
    if (idx < 0) return null;
    positions.push(idx);
    score += 1;
    if (idx === prev + 1) score += 3;
    if (idx === 0 || t[idx - 1] === ' ' || t[idx - 1] === ':') score += 4;
    prev = idx;
    ti = idx + 1;
  }
  score -= text.length * 0.02;
  return { score, positions };
}

function highlight(label: string, positions: number[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  const set = new Set(positions);
  let buf = '';
  let hit = false;
  const flush = (): void => {
    if (!buf) return;
    frag.appendChild(hit ? h('b', { text: buf }) : document.createTextNode(buf));
    buf = '';
  };
  [...label].forEach((ch, i) => {
    const isHit = set.has(i);
    if (isHit !== hit) {
      flush();
      hit = isHit;
    }
    buf += ch;
  });
  flush();
  return frag;
}

/**
 * Every categorized setting as a pseudo-operator ("Setting: Motion ▸ Parallax strength"): picking one opens its
 * panel in the Properties editor, scrolls to the field and flashes it. Listed only while a query is typed.
 */
const SETTING_PREFIX = 'setting:';
const SETTING_OPS: Operator[] = CATEGORIES.flatMap((c) =>
  c.groups.flatMap((g) =>
    g.fields.map<Operator>((path) => ({
      id: SETTING_PREFIX + path,
      label: `${c.title} ▸ ${fieldSchema(path).label}`,
      category: 'Setting',
      icon: c.icon as IconName,
      run: (ctx) => ctx.ui.revealField(path),
    })),
  ),
);
const isSetting = (op: Operator): boolean => op.id.startsWith(SETTING_PREFIX);

let activeClose: (() => void) | null = null;

export function openOperatorSearch(ctx: AppContext): void {
  activeClose?.();
  const input = h('input', { class: 'pw-opsearch-input', attrs: { type: 'text', placeholder: 'Search operators…', spellcheck: 'false', autocomplete: 'off' } });
  const list = h('div', { class: 'pw-opsearch-list', attrs: { role: 'listbox' } });
  const card = h('div', { class: 'pw-opsearch' }, h('div', { class: 'pw-opsearch-bar' }, icon('search', 14), input), list);
  const layer = h('div', { class: 'pw-opsearch-layer' }, card);
  document.body.appendChild(layer);

  let results: Scored[] = [];
  let sel = 0;

  const close = (): void => {
    layer.remove();
    activeClose = null;
  };
  activeClose = close;

  const run = (op: Operator): void => {
    if (isSetting(op)) {
      close();
      void op.run(ctx);
      return;
    }
    if (!ctx.ops.enabled(op.id)) return;
    close();
    ctx.ops.run(op.id);
  };

  const render = (): void => {
    list.replaceChildren();
    results.slice(0, 14).forEach((r, i) => {
      const enabled = isSetting(r.op) || ctx.ops.enabled(r.op.id);
      const label = r.op.label;
      const labelEl = h('span', { class: 'pw-opsearch-label' });
      // positions are computed on "category: label"; shift into the label part.
      const offset = r.op.category.length + 2;
      labelEl.appendChild(highlight(label, r.positions.map((p) => p - offset).filter((p) => p >= 0)));
      const row = h(
        'div',
        { class: 'pw-opsearch-row' + (i === sel ? ' active' : '') + (enabled ? '' : ' disabled'), attrs: { role: 'option' } },
        r.op.icon ? icon(r.op.icon, 14) : h('span', { class: 'pw-opsearch-noicon' }),
        h('span', { class: 'pw-opsearch-cat', text: r.op.category }),
        labelEl,
        h('span', { class: 'pw-opsearch-shortcut', text: formatShortcut(r.op.shortcut) }),
      );
      row.addEventListener('pointermove', () => {
        if (sel !== i) {
          sel = i;
          list.querySelectorAll('.pw-opsearch-row').forEach((x, j) => x.classList.toggle('active', j === i));
        }
      });
      row.addEventListener('click', () => run(r.op));
      list.appendChild(row);
    });
    if (!results.length) list.appendChild(h('div', { class: 'pw-opsearch-empty', text: 'No matching operators' }));
  };

  const filter = (): void => {
    const q = input.value.trim();
    const all = ctx.ops.list();
    if (!q) {
      results = all.map((op) => ({ op, score: 0, positions: [] }));
    } else {
      results = [];
      for (const op of [...all, ...SETTING_OPS]) {
        const m = fuzzy(q, `${op.category}: ${op.label}`);
        if (m) results.push({ op, score: m.score, positions: m.positions });
      }
      results.sort((a, b) => b.score - a.score);
    }
    sel = 0;
    render();
  };

  input.addEventListener('input', filter);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    const n = Math.min(results.length, 14);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      sel = (sel + 1) % Math.max(1, n);
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      sel = (sel - 1 + Math.max(1, n)) % Math.max(1, n);
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[sel];
      if (r) run(r.op);
    } else if (e.key === 'Escape' || e.key === 'F3') {
      e.preventDefault();
      close();
    }
  });
  layer.addEventListener('pointerdown', (e) => {
    if (e.target === layer) close();
  });

  filter();
  input.focus();
}
