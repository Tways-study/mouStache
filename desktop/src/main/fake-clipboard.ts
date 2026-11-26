/**
 * In-memory clipboard for e2e (MOUSTACHE_E2E=1 + MOUSTACHE_FAKE_CLIPBOARD=1 only).
 *
 * The real OS clipboard is a machine-wide shared resource: anything else running on the machine (another app,
 * another agent, the developer) can change it between a test's write and the watcher's next poll. Behavioural e2e
 * tests therefore drive the full pipeline (watcher core -> capture -> engine -> panel/tray/blip) through this
 * stand-in, and a small separate suite exercises the real Electron clipboard with retrying writes.
 */
import { nativeImage } from 'electron';
import type { ClipboardReader, ImageSnapshot } from './watcher-core';
import { CONCEALED_FORMATS } from './watcher-core';
import { imageKey } from './watcher';

export function createFakeClipboard() {
  const st = { text: '', formats: new Set<string>(), image: undefined as ImageSnapshot | undefined };
  const reader: ClipboardReader = {
    hasFormat: async (f) => st.formats.has(f),
    readBuffer: async () => undefined,
    readText: async () => st.text,
    hasImage: async () => st.image !== undefined,
    readImage: async () => st.image,
  };
  return {
    reader,
    writeText(text: string) {
      st.text = text;
      st.formats.clear();
      st.image = undefined;
    },
    writeConcealed(text: string) {
      st.text = text;
      st.image = undefined;
      st.formats = new Set([CONCEALED_FORMATS[2]]);
    },
    /** Palette output: a PNG written by mouStache itself. */
    writePng(png: Buffer) {
      const img = nativeImage.createFromBuffer(png);
      st.text = '';
      st.formats.clear();
      st.image = { key: imageKey(img), png: () => png };
    },
    /** What is on the fake clipboard now (tests assert on it). */
    snapshot: () => ({
      text: st.text,
      hasImage: st.image !== undefined,
      imageSize: st.image ? nativeImage.createFromBuffer(st.image.png()).getSize() : undefined,
    }),
    writeImage(shade: number) {
      const img = nativeImage.createFromBitmap(Buffer.alloc(16 * 16 * 4, shade), { width: 16, height: 16 });
      const png = img.toPNG();
      st.text = '';
      st.formats.clear();
      st.image = { key: imageKey(img), png: () => png };
    },
  };
}

export type FakeClipboard = ReturnType<typeof createFakeClipboard>;
