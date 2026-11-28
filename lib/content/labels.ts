import type { TagGroup } from '@/lib/types';
import { TAG_META } from '@/lib/tags';
import type { StashItemLite } from '@/lib/messaging';

// Tag labels/groups live in lib/tags.ts so the overlay and side panel stay in sync.
export { tagLabel, langLabel, TAG_META, GROUP_ORDER, GROUP_META } from '@/lib/tags';

function tagGroup(tag: string): TagGroup {
  return TAG_META[tag]?.group ?? 'other';
}

export function itemGroup(item: Pick<StashItemLite, 'kind' | 'tags'>): TagGroup {
  if (item.kind === 'image') return 'image';
  for (const t of item.tags) {
    const g = tagGroup(t);
    if (g !== 'other') return g;
  }
  return item.kind === 'link' ? 'link' : 'other';
}

export function isMonoItem(item: Pick<StashItemLite, 'kind' | 'tags'>): boolean {
  const g = itemGroup(item);
  return g === 'code' || g === 'data' || g === 'network' || g === 'error' || item.tags.includes('command');
}

export function relativeTime(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.round(mo / 12)}y`;
}

export function hostname(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

/** Short, human-recognisable title for a text item (derived, never stored). */
export function textTitle(item: { text?: string; secret?: boolean }, max = 48): string {
  if (item.secret) return 'Secret';
  const lines = (item.text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return 'Untitled text';

  // Prefer a declaration name for code-ish text.
  const head = lines.slice(0, 6).join('\n');
  const decl =
    /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?(function|class|interface|type|enum|def|fn|func|struct)\s+\*?\s*([A-Za-z_$][\w$]*)/.exec(head) ??
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/.exec(head);
  if (decl) {
    const t = decl.length === 3 ? `${decl[1]} ${decl[2]}` : `const ${decl[1]}`;
    return clipTitle(t, max);
  }
  const first = lines[0] ?? '';
  const verb = /^(select|insert|update|delete|create)\b/i.exec(first);
  if (verb) {
    const m = /\b(?:from|into|table|update)\s+([A-Za-z_][\w.]*)/i.exec(lines.join(' '));
    if (m) return clipTitle(`${(verb[1] ?? '').toUpperCase()} · ${m[1]}`, max);
  }

  const cleaned = first
    .replace(/^(?:#{1,6}\s*|\/\/+\s*|\/\*+\s*|\*+\s*|--+\s*|>+\s*|[-*+•]\s+|\d+[.)]\s+)/, '')
    .replace(/\s*\*\/\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clipTitle(cleaned || first, max);
}

function clipTitle(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–—]+$/, '') + '…';
}

export function previewLine(text: string, max = 140): string {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const t = first.trim().replace(/\s+/g, ' ');
  return t.length > max ? t.slice(0, max) + '…' : t;
}
