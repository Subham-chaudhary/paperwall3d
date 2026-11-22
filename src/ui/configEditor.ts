/**
 * config.json view: a Blender Text-Editor-styled code editor showing the 2.5dwallpp-compatible settings document
 * (commented JSON generated from SCHEMA). Edits apply live (debounced), two-way synced with the sliders.
 * Syntax errors show line:column and change nothing; out-of-range values are clamped and reported by path.
 */
import { DEFAULT_SETTINGS } from '../core/defaults';
import type { AppContext } from './context';
import { downloadBlob, h } from './dom';
import { icon } from './icons';
import { applyConfigObject, buildConfigText, snapshotShared, strictConfigJson } from '../persistence/configJson';
import { formatJsoncError, parseJsonc } from '../persistence/jsonc';
import { button } from './widgets/controls';

const APPLY_DEBOUNCE_MS = 300;

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;

/** Colour tokens: comments, keys, strings, numbers, keywords. */
export function highlightJsonc(src: string): string {
  let out = '';
  let last = 0;
  for (const m of src.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    out += esc(src.slice(last, at));
    if (m[1] !== undefined) out += `<span class="c">${esc(m[1])}</span>`;
    else if (m[2] !== undefined) out += m[3] ? `<span class="k">${esc(m[2])}</span>${esc(m[3])}` : `<span class="s">${esc(m[2])}</span>`;
    else if (m[4] !== undefined) out += `<span class="n">${esc(m[4])}</span>`;
    else out += `<span class="w">${esc(m[5] ?? '')}</span>`;
    last = at + m[0].length;
  }
  return out + esc(src.slice(last));
}

export interface ConfigEditor {
  el: HTMLElement;
  /** Rewrite the text from the current settings (no-op while the editor has focus or unsent edits). */
  refresh(): void;
  /** Called when the view becomes visible. */
  show(): void;
}

export function createConfigEditor(ctx: AppContext): ConfigEditor {
  const store = ctx.store;

  const ta = h('textarea', {
    class: 'pw-cfg-ta',
    attrs: { spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', wrap: 'off', 'aria-label': 'config.json' },
  });
  const hl = h('pre', { class: 'pw-cfg-hl', attrs: { 'aria-hidden': 'true' } });
  const errLine = h('div', { class: 'pw-cfg-errline' });
  errLine.hidden = true;
  hl.appendChild(errLine);
  const back = h('div', { class: 'pw-cfg-back' }, hl);
  const gutNums = h('span', { class: 'pw-cfg-nums' });
  const gutErr = h('div', { class: 'pw-cfg-gerr' });
  gutErr.hidden = true;
  const gutterInner = h('div', { class: 'pw-cfg-gutter-inner' }, gutNums, gutErr);
  const gutter = h('div', { class: 'pw-cfg-gutter', attrs: { 'aria-hidden': 'true' } }, gutterInner);
  const code = h('div', { class: 'pw-cfg-code' }, back, ta);
  const msg = h('div', { class: 'pw-cfg-msg ok' });
  const say = (cls: 'ok' | 'warn' | 'err', text: string): void => {
    msg.className = `pw-cfg-msg ${cls}`;
    msg.replaceChildren(icon(cls === 'err' ? 'error' : cls === 'warn' ? 'warning' : 'success', 14), h('span', { text }));
  };

  let errorLineNo = 0;
  let lineCount = 0;
  const renderText = (): void => {
    const text = ta.value;
    // A trailing space keeps the backdrop as tall as the textarea when the text ends with a newline.
    const hlNode = document.createElement('span');
    hlNode.innerHTML = highlightJsonc(text) + ' ';
    hl.replaceChildren(hlNode, errLine);
    const n = text.split('\n').length;
    if (n !== lineCount) {
      lineCount = n;
      gutNums.textContent = Array.from({ length: n }, (_, i) => String(i + 1)).join('\n');
    }
    markError(errorLineNo);
  };
  const markError = (line: number): void => {
    errorLineNo = line;
    errLine.hidden = !line;
    gutErr.hidden = !line;
    if (line) {
      errLine.style.top = `calc(var(--cfg-pad) + ${(line - 1) * 18}px)`;
      gutErr.style.top = `calc(var(--cfg-pad) + ${(line - 1) * 18}px)`;
    }
  };
  const syncScroll = (): void => {
    hl.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    gutterInner.style.transform = `translateY(${-ta.scrollTop}px)`;
  };
  ta.addEventListener('scroll', syncScroll);

  const setText = (t: string): void => {
    ta.value = t;
    errorLineNo = 0;
    renderText();
    syncScroll();
  };

  const build = (): string => buildConfigText(store.get());

  // ── live apply ──
  let dirty = false;
  let timer = 0;
  /** true when the text was valid and has been applied */
  const run = (): boolean => {
    const r = parseJsonc(ta.value);
    if (!r.ok) {
      markError(r.error.line);
      say('err', `Not applied, ${formatJsoncError(r.error)}`);
      return false;
    }
    markError(0);
    const res = applyConfigObject(r.value, store.get());
    if (res.changed.length) store.replace(res.settings);
    const head = res.changed.length ? `Applied ${res.changed.length} change${res.changed.length > 1 ? 's' : ''}` : 'No changes';
    if (res.problems.length) say('warn', `${head}. ${res.problems.join('; ')}`);
    else say('ok', head);
    dirty = false;
    return true;
  };

  ta.addEventListener('input', () => {
    dirty = true;
    renderText();
    syncScroll();
    window.clearTimeout(timer);
    timer = window.setTimeout(run, APPLY_DEBOUNCE_MS);
  });
  ta.addEventListener('blur', () => {
    window.clearTimeout(timer);
    // Tidy valid text; never throw away a draft that has an error.
    if (run()) setText(build());
  });
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') ta.blur();
    else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    }
  });

  // ── toolbar ──
  const copy = button({
    label: 'Copy',
    icon: 'file',
    onClick: async () => {
      if (document.activeElement !== ta) setText(build());
      try {
        await navigator.clipboard.writeText(ta.value);
        say('ok', 'Copied to the clipboard (with comments)');
      } catch {
        ta.select();
        say('warn', 'Press Ctrl+C: the browser blocked clipboard access');
      }
    },
    tip: { desc: 'Copy the whole document, with comments, to the clipboard.' },
  });
  const download = button({
    label: 'Download',
    icon: 'download',
    onClick: () => {
      downloadBlob(new Blob([strictConfigJson(store.get())], { type: 'application/json' }), 'config.json');
      say('ok', 'Downloaded config.json (plain JSON, without comments)');
    },
    tip: { desc: 'Download config.json as plain JSON (no comments). It also loads in 2.5dwallpp.' },
  });
  const defaults = button({
    label: 'Defaults',
    icon: 'refresh',
    onClick: () => {
      store.checkpoint();
      const res = applyConfigObject(snapshotShared(DEFAULT_SETTINGS, true), store.get());
      if (res.changed.length) store.replace(res.settings);
      setText(build());
      dirty = false;
      say('ok', res.changed.length ? `Reset ${res.changed.length} setting${res.changed.length > 1 ? 's' : ''} to the defaults` : 'Already at the defaults');
    },
    tip: { desc: 'Reset every setting in this document to its default.' },
  });
  const bar = h(
    'div',
    { class: 'pw-cfg-bar' },
    h('span', { class: 'pw-cfg-file' }, icon('file', 14), h('span', { text: 'config.json' })),
    h('span', { class: 'pw-cfg-hint', text: 'Edit and the changes apply live. // comments and trailing commas are fine; nested or flat keys work.' }),
    h('span', { class: 'pw-header-spacer' }),
    copy.el,
    download.el,
    defaults.el,
  );

  const el = h('div', { class: 'pw-cfg' }, bar, h('div', { class: 'pw-cfg-body' }, gutter, code), msg);

  const refresh = (): void => {
    if (document.activeElement === ta || dirty) return;
    setText(build());
  };
  store.subscribe(() => refresh());

  setText(build());
  say('ok', 'Ready');
  return {
    el,
    refresh,
    show: () => {
      dirty = false;
      setText(build());
    },
  };
}
