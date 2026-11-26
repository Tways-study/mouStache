import { clipboard, nativeImage, type NativeImage } from 'electron';
import type { SaveResult } from '@/lib/messaging';
import { processCapture, type CaptureOutcome } from './capture';
import type { ForegroundDetector } from './foreground';
import type { PresenceSettings } from './presence-settings';
import type { EngineClient } from './router';
import { bytesKey, createOwnWriteGuard, createWatcherCore, type ClipboardReader, type TickResult, type ImageSnapshot, type OwnWriteGuard } from './watcher-core';

export const POLL_MS = 400;
/** A clipboard read that never returns (the OS clipboard can be held by another process) must not stop the watcher. */
export const TICK_TIMEOUT_MS = 4000;

export function imageKey(img: NativeImage): string {
  const { width, height } = img.getSize();
  return bytesKey(width, height, img.toBitmap());
}

/** Electron 45's clipboard is async; raw OS formats (Windows names, macOS UTIs) are addressed through this MIME wrapper. */
const raw = (format: string) => `electron application/osclipboard;format="${format}"`;

const electronReader: ClipboardReader = {
  hasFormat: (f) => clipboard.has(raw(f)),
  async readBuffer(f) {
    for (const item of await clipboard.read()) {
      if (item.types.includes(raw(f))) return Buffer.from(await ((await item.getType(raw(f))) as Blob).arrayBuffer());
    }
    return undefined;
  },
  readText: () => clipboard.readText(),
  hasImage: () => clipboard.has('image/png'),
  async readImage(): Promise<ImageSnapshot | undefined> {
    for (const item of await clipboard.read()) {
      if (!item.types.includes('image/png')) continue;
      const png = Buffer.from(await (await item.getType('image/png')).arrayBuffer());
      const img = nativeImage.createFromBuffer(png);
      if (img.isEmpty()) return undefined;
      return { key: imageKey(img), png: () => png };
    }
    return undefined;
  },
};

export interface WatcherOptions {
  engine: Pick<EngineClient, 'request'>;
  presence: { get(): PresenceSettings };
  detector: ForegroundDetector;
  onOutcome(o: CaptureOutcome): void;
  reader?: ClipboardReader;
  guard?: OwnWriteGuard;
  /** Called with every tick result except 'unchanged' (diagnostics / tests). */
  onTick?(r: TickResult): void;
}

/** Polls the system clipboard every ~400 ms and sends new text/images to the engine window to be saved. */
export function createWatcher(o: WatcherOptions) {
  const guard = o.guard ?? createOwnWriteGuard();
  let chain: Promise<unknown> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let pending = 0; // captures detected but not yet saved/reported (app lookup + engine round trip)

  const core = createWatcherCore({
    reader: o.reader ?? electronReader,
    guard,
    isPaused: () => !o.presence.get().autoCapture,
    onCapture(c) {
      // one at a time, in order, so a burst keeps its sequence
      pending++;
      chain = chain
        .then(() =>
          processCapture(c, {
            foregroundApp: () => o.detector.query(),
            pausedApps: () => o.presence.get().pausedApps,
            ownPid: process.pid,
            save: (msg) => o.engine.request(msg) as Promise<SaveResult | undefined>,
          }),
        )
        .then(o.onOutcome)
        .catch((e) => o.onOutcome({ status: 'error', error: e instanceof Error ? e.message : String(e) }))
        .finally(() => pending--);
    },
  });

  return {
    guard,
    /** In-flight captures (used by tests to know when the pipeline is idle). */
    pending: () => pending,
    start() {
      if (running) return;
      running = true;
      o.detector.warmUp();
      // One poll at a time: the next is scheduled only after the previous finished (or hit the watchdog), so
      // the very first poll (the baseline) can never overlap with the next one. The first poll is the baseline:
      // whatever is on the clipboard now is not captured.
      const loop = async () => {
        if (!running) return;
        let release: ReturnType<typeof setTimeout> | undefined;
        const watchdog = new Promise<'timeout'>((res) => (release = setTimeout(() => res('timeout'), TICK_TIMEOUT_MS)));
        try {
          const r = await Promise.race([core.tick(), watchdog]);
          if (r === 'timeout') console.error('[mouStache] clipboard read timed out; continuing');
          else if (r !== 'unchanged') o.onTick?.(r);
        } catch (e) {
          console.error('[mouStache] watcher tick failed', e);
        } finally {
          clearTimeout(release);
        }
        if (running) timer = setTimeout(() => void loop(), POLL_MS);
      };
      void loop();
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}

export type WatcherController = ReturnType<typeof createWatcher>;
