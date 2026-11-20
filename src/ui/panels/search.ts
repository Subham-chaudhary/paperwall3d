/** Properties-header search: filters property rows across the visible tab by label text. */
import { h } from '../dom';
import { icon } from '../icons';
import type { PropTab } from '../state';

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
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    for (const page of Object.values(pages)) {
      page.classList.toggle('searching', q.length > 0);
      for (const panelEl of Array.from(page.querySelectorAll<HTMLElement>('.pw-panel'))) {
        let any = false;
        for (const rowEl of Array.from(panelEl.querySelectorAll<HTMLElement>('.pw-prop'))) {
          const text = (rowEl.textContent ?? '').toLowerCase();
          const hit = !q || text.includes(q);
          rowEl.classList.toggle('filtered-out', !hit);
          if (hit) any = true;
        }
        const title = panelEl.querySelector('.pw-panel-title')?.textContent?.toLowerCase() ?? '';
        const titleHit = !!q && title.includes(q);
        if (titleHit) panelEl.querySelectorAll('.pw-prop').forEach((r) => r.classList.remove('filtered-out'));
        panelEl.classList.toggle('filtered-out', !!q && !any && !titleHit);
      }
    }
  });
}
