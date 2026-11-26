import { comboText } from '@/lib/platform';
import { send } from '@/lib/messaging';
import type { StashItemLite } from '@/lib/messaging';
import { overlayStore } from '@/lib/content/store';
import { insertAtCursor, isEditable } from '@/lib/content/insert';
import { writeImageFromDataUrl, writeText } from '@/lib/content/clipboard';

/** How a palette choice should be applied. `code` (paste as a fenced code block) only exists on desktop. */
export type PaletteMode = 'paste' | 'copy' | 'code';

export interface PaletteSearch {
  query: string;
  limit: number;
  kind?: 'image';
}

/**
 * Everything the palette needs from its surroundings. The browser extension implements it with the page
 * overlay (`webPaletteHost`); the desktop app implements it with IPC to the main process.
 */
export interface PaletteHost {
  search(q: PaletteSearch): Promise<StashItemLite[]>;
  /** Apply the choice. Implementations close the palette themselves. */
  activate(item: StashItemLite, mode: PaletteMode): Promise<void>;
  close(): void;
  /** Enables Mod+Enter ("paste as code block") and its footer hint. */
  codeBlock?: boolean;
}

/** The extension's host: search through the background worker, copy/insert into the page. Behaviour unchanged. */
export function webPaletteHost(returnFocus: Element | null): PaletteHost {
  const close = () => overlayStore.closePalette();
  return {
    close,
    async search({ query, limit, kind }) {
      const res = await send({ type: 'search', query, limit, ...(kind ? { kind } : {}) });
      return Array.isArray(res) ? res : [];
    },
    async activate(item, mode) {
      try {
        const res = await send({ type: 'copy-item', id: item.id });
        if (!res?.ok) {
          overlayStore.showToast('Could not copy that item');
          return;
        }
        let pastedText: string | undefined;
        if (res.kind === 'image' && res.dataUrl) {
          await writeImageFromDataUrl(res.dataUrl);
          overlayStore.showToast(`Image copied — paste with ${comboText(['Mod', 'V'])}`);
        } else if (res.text !== undefined) {
          await writeText(res.text);
          pastedText = res.text;
          overlayStore.showToast('Copied');
        }
        close();
        if (mode === 'paste' && pastedText !== undefined && isEditable(returnFocus)) {
          // wait a tick so the palette unmounts and focus is restored first
          setTimeout(() => insertAtCursor(returnFocus, pastedText), 0);
        }
      } catch {
        overlayStore.showToast('Could not copy that item');
      }
    },
  };
}
