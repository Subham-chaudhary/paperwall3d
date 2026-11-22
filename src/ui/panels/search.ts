/**
 * Properties-header search: filters property rows and action buttons across every tab by label text.
 * A row is also kept when the title of one of its panels matches, so "mask" shows the whole Subject Mask panel.
 */
import { h } from '../dom';
import { icon } from '../icons';
import type { PropTab } from '../state';

const ITEMS = '.pw-prop, .pw-actions';

export function appendHeaderSearch(header: HTMLElement, pages: Record<PropTab, HTMLElement>): void {
  const input = h('input', { class: 'pw-search-input', attrs: { type: 'search', placeholder: 'Search', spellcheck: 'false' } });
  header.appendChild(h('label', { class: 'pw-header-search' }, icon('search', 12), input));
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      input.value = '';
      input.dispatchEvent(new Event('input'));
      input.blur();
    }
  });

  const panelTitle = (p: HTMLElement): string => p.querySelector(':scope > .pw-panel-header .pw-panel-title')?.textContent?.toLowerCase() ?? '';

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    for (const page of Object.values(pages)) {
      page.classList.toggle('searching', q.length > 0);
      const panels = Array.from(page.querySelectorAll<HTMLElement>('.pw-panel'));
      const titleHit = new Map<HTMLElement, boolean>(panels.map((p) => [p, !!q && panelTitle(p).includes(q)]));
      const visibleIn = new Map<HTMLElement, number>(panels.map((p) => [p, 0]));
      for (const item of Array.from(page.querySelectorAll<HTMLElement>(`.pw-panel ${ITEMS}`))) {
        const chain: HTMLElement[] = [];
        for (let p = item.closest<HTMLElement>('.pw-panel'); p; p = p.parentElement?.closest<HTMLElement>('.pw-panel') ?? null) chain.push(p);
        const hit = !q || (item.textContent ?? '').toLowerCase().includes(q) || chain.some((p) => titleHit.get(p));
        item.classList.toggle('filtered-out', !hit);
        if (hit) for (const p of chain) visibleIn.set(p, (visibleIn.get(p) ?? 0) + 1);
      }
      for (const p of panels) p.classList.toggle('filtered-out', !!q && !visibleIn.get(p));
    }
  });
}
