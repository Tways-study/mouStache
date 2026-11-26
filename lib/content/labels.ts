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

export function previewLine(text: string, max = 140): string {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const t = first.trim().replace(/\s+/g, ' ');
  return t.length > max ? t.slice(0, max) + '…' : t;
}
