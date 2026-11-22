/**
 * Release notes for the running version, parsed from CHANGELOG.md at build time (Vite `?raw` import),
 * so the splash/About "What's New" text can never drift from the changelog.
 */
import changelog from '../../CHANGELOG.md?raw';
import { APP_VERSION } from './version';

export interface ReleaseNotes {
  version: string;
  date: string;
  /** Bullet texts (markdown emphasis/code stripped), in changelog order. */
  items: string[];
}

const plain = (s: string): string =>
  s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();

/** Parse one version's section ("## [x.y.z] - date") from the changelog. */
export function parseReleaseNotes(text: string, version: string): ReleaseNotes | null {
  const lines = text.split(/\r?\n/);
  const head = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (head < 0) return null;
  const date = (lines[head]!.match(/-\s*(\d{4}-\d{2}-\d{2})/) ?? [])[1] ?? '';
  const items: string[] = [];
  for (let i = head + 1; i < lines.length && !lines[i]!.startsWith('## '); i++) {
    const m = lines[i]!.match(/^- (.+)/);
    if (m) items.push(plain(m[1]!));
  }
  return { version, date, items };
}

export const RELEASE_NOTES: ReleaseNotes | null = parseReleaseNotes(changelog, APP_VERSION);

/** One-line summary for the splash: the first bullet's lead phrase (before ":" or "."), max ~90 chars. */
export function whatsNewSummary(notes: ReleaseNotes | null = RELEASE_NOTES): string {
  if (!notes || !notes.items.length) return `${APP_VERSION}`;
  const lead = (s: string): string => s.split(/:\s|\.\s/)[0]!.trim();
  const parts = notes.items.slice(0, 3).map(lead);
  let out = parts.join(', ');
  if (out.length > 90) out = out.slice(0, 87).replace(/[ ,]+\S*$/, '') + '…';
  return out;
}
