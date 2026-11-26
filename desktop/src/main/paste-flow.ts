/** What happens when the user picks an item in the palette. Pure orchestration; every side effect is injected. */
import { markdownFence } from '@/lib/panel/helpers';
import type { PasteExecutor, PasteTarget } from './paste';

export type PaletteChoice = 'paste' | 'copy' | 'code';

export interface ChooseRequest {
  id: string;
  mode: PaletteChoice;
  /** Fence language for `code` mode, e.g. "sql" (already derived from the item's language/tags in the renderer). */
  fence?: string;
}

export type Content = { kind: 'text'; text: string } | { kind: 'image'; png: Buffer };

export type ChooseOutcome =
  | { status: 'pasted'; kind: Content['kind'] }
  | { status: 'copied'; kind: Content['kind'] }
  /** macOS Accessibility not granted: copied, user presses the paste key themselves */
  | { status: 'copied-no-permission' }
  /** the keystroke helper failed: copied, user presses the paste key themselves */
  | { status: 'copied-paste-failed' }
  | { status: 'error'; error: string };

export interface PasteFlowDeps {
  platform: NodeJS.Platform;
  fetchItem(id: string): Promise<Content | undefined>;
  /** Writes the clipboard AND marks it as mouStache's own write (so the watcher ignores it). */
  writeClipboard(c: Content): void | Promise<void>;
  hidePalette(): void;
  executor: PasteExecutor;
  /** The window that was in front before the palette opened (undefined = could not tell; the OS then decides). */
  target: PasteTarget | undefined;
  /** False when the palette was opened from mouStache's own window: there is nothing sensible to paste into. */
  canPaste: boolean;
  /** macOS only. */
  accessibility?: { isTrusted(prompt: boolean): boolean; wasPrompted(): boolean; markPrompted(): void };
  /** Short, content-free message ("Copied", "Copied, press ⌘V"). */
  notify(text: string): void;
}

/** Only a plain language label may become the fence info string (it ends up in pasted text). */
export function safeFence(raw: unknown): string | undefined {
  return typeof raw === 'string' && /^[A-Za-z0-9+#.-]{1,24}$/.test(raw) ? raw : undefined;
}

export function wrapCodeBlock(text: string, fence?: string): string {
  return markdownFence(text, safeFence(fence));
}

export const pasteKeyLabel = (platform: NodeJS.Platform) => (platform === 'darwin' ? '⌘V' : 'Ctrl+V');

export async function choose(req: ChooseRequest, d: PasteFlowDeps): Promise<ChooseOutcome> {
  let content: Content | undefined;
  try {
    content = await d.fetchItem(req.id);
  } catch {
    content = undefined;
  }
  if (!content) {
    d.hidePalette();
    d.notify('Could not copy that item');
    return { status: 'error', error: 'item not found' };
  }
  if (content.kind === 'text' && req.mode === 'code') content = { kind: 'text', text: wrapCodeBlock(content.text, req.fence) };

  try {
    await d.writeClipboard(content);
  } catch {
    d.hidePalette();
    d.notify('Could not copy that item');
    return { status: 'error', error: 'clipboard write failed' };
  }
  d.hidePalette();

  if (req.mode === 'copy') {
    d.notify(content.kind === 'image' ? 'Image copied' : 'Copied');
    return { status: 'copied', kind: content.kind };
  }

  const key = pasteKeyLabel(d.platform);
  if (d.platform === 'darwin' && d.accessibility && !d.accessibility.isTrusted(false)) {
    // one guided system prompt, ever; afterwards just say what to do
    if (!d.accessibility.wasPrompted()) {
      d.accessibility.markPrompted();
      d.accessibility.isTrusted(true);
    }
    d.notify(`Copied, press ${key}`);
    return { status: 'copied-no-permission' };
  }
  if (!d.canPaste) {
    d.notify(`Copied, press ${key}`); // nothing to paste into (the palette was opened from mouStache itself)
    return { status: 'copied', kind: content.kind };
  }
  try {
    await d.executor.paste(d.target);
    return { status: 'pasted', kind: content.kind };
  } catch {
    d.notify(`Copied, press ${key}`);
    return { status: 'copied-paste-failed' };
  }
}
