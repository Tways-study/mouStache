import { clipboard, ClipboardItem } from 'electron';
import { secretFormats, withSecretClear, type ClipboardPrimitives } from './secret-clipboard';

/** Electron 45 addresses raw OS formats through this MIME wrapper (see watcher.ts). */
const raw = (format: string) => `electron application/osclipboard;format="${format}"`;

/** The real OS clipboard, as the primitives the rest of main uses. */
export function electronClipboardPrimitives(platform: NodeJS.Platform = process.platform): ClipboardPrimitives {
  return {
    writeText: (t) => clipboard.writeText(t),
    writeSecretText(text) {
      const items: Record<string, string | Blob> = { 'text/plain': text };
      for (const [format, bytes] of Object.entries(secretFormats(platform))) items[raw(format)] = new Blob([new Uint8Array(bytes)]);
      return clipboard.write([new ClipboardItem(items)]);
    },
    writePng: (png) => clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]),
    readText: () => clipboard.readText(),
    clear: () => clipboard.clear(),
  };
}

/** Everything main writes to the clipboard goes through this: secrets get the exclusion formats and auto-clear. */
export function createClipboardOut(base: ClipboardPrimitives = electronClipboardPrimitives(), ttlMs?: number) {
  return withSecretClear(base, { ttlMs });
}

export type ClipboardOut = ReturnType<typeof createClipboardOut>;
