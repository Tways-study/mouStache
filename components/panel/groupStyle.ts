import type { TagGroup } from '@/lib/types';

/** Static class maps (Tailwind needs literal class names). */
export const GROUP_STYLE: Record<TagGroup, { tile: string; text: string; chip: string; active: string }> = {
  code: { tile: 'bg-tag-code-soft text-tag-code', text: 'text-tag-code', chip: 'bg-tag-code-soft text-tag-code', active: 'bg-tag-code-soft text-tag-code ring-tag-code/30' },
  prompt: { tile: 'bg-tag-prompt-soft text-tag-prompt', text: 'text-tag-prompt', chip: 'bg-tag-prompt-soft text-tag-prompt', active: 'bg-tag-prompt-soft text-tag-prompt ring-tag-prompt/30' },
  image: { tile: 'bg-tag-image-soft text-tag-image', text: 'text-tag-image', chip: 'bg-tag-image-soft text-tag-image', active: 'bg-tag-image-soft text-tag-image ring-tag-image/30' },
  link: { tile: 'bg-tag-link-soft text-tag-link', text: 'text-tag-link', chip: 'bg-tag-link-soft text-tag-link', active: 'bg-tag-link-soft text-tag-link ring-tag-link/30' },
  network: { tile: 'bg-tag-network-soft text-tag-network', text: 'text-tag-network', chip: 'bg-tag-network-soft text-tag-network', active: 'bg-tag-network-soft text-tag-network ring-tag-network/30' },
  error: { tile: 'bg-tag-error-soft text-tag-error', text: 'text-tag-error', chip: 'bg-tag-error-soft text-tag-error', active: 'bg-tag-error-soft text-tag-error ring-tag-error/30' },
  data: { tile: 'bg-tag-data-soft text-tag-data', text: 'text-tag-data', chip: 'bg-tag-data-soft text-tag-data', active: 'bg-tag-data-soft text-tag-data ring-tag-data/30' },
  other: { tile: 'bg-tag-other-soft text-tag-other', text: 'text-tag-other', chip: 'bg-tag-other-soft text-tag-other', active: 'bg-tag-other-soft text-tag-other ring-tag-other/30' },
};

export const ACCENT_ACTIVE = 'bg-accent-soft text-accent ring-accent/30';
