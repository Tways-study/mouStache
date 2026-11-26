/** Short, content-free type label for a saved item ("SQL", "Command", "Image"). Used by the blip and tray tooltip. */
import { langLabel, tagLabel } from '@/lib/tags';
import type { ItemKind } from '@/lib/types';

export function typeLabel(item: { kind: ItemKind; tags: string[]; lang?: string; secret?: boolean }): string {
  if (item.secret) return 'Secret';
  if (item.kind === 'image') return 'Image';
  if (item.kind === 'link') return 'Link';
  const specific = item.tags.find((t) => t !== 'code');
  if (specific) return tagLabel(specific);
  if (item.lang) return langLabel(item.lang);
  return item.tags.includes('code') ? 'Code' : 'Text';
}
