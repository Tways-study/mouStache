/**
 * Putting a SECRET on the clipboard (security review F13): when mouStache itself writes an item flagged secret
 * (palette paste, copy in the panel) it (1) tags the clipboard with the "do not record / do not sync" formats so
 * clipboard history, cloud clipboard and other managers skip it, and (2) clears the clipboard after a while if it
 * still holds that value. Pure orchestration; the actual OS calls are injected.
 */
import { normalizeText } from './watcher-core';

export const SECRET_CLEAR_MS = 30_000;

/** Raw OS formats to attach to a secret write, per platform. Values are the bytes the format expects. */
export function secretFormats(platform: NodeJS.Platform): Record<string, Uint8Array> {
  if (platform === 'win32') {
    return {
      ExcludeClipboardContentFromMonitorProcessing: new Uint8Array([1, 0, 0, 0]),
      CanIncludeInClipboardHistory: new Uint8Array([0, 0, 0, 0]),
      CanUploadToCloudClipboard: new Uint8Array([0, 0, 0, 0]),
      'Clipboard Viewer Ignore': new Uint8Array([1]),
    };
  }
  if (platform === 'darwin') {
    return { 'org.nspasteboard.ConcealedType': new Uint8Array([]) };
  }
  return {};
}

export interface ClipboardPrimitives {
  writeText(text: string): void | Promise<void>;
  /** Text plus the do-not-record formats for this platform. */
  writeSecretText(text: string): void | Promise<void>;
  writePng(png: Buffer): void | Promise<void>;
  readText(): Promise<string> | string;
  clear(): void | Promise<void>;
}

export interface TimerApi {
  set(fn: () => void, ms: number): unknown;
  clear(t: unknown): void;
}

/** Wraps primitives so every secret write arms an auto-clear (a newer write replaces an older timer). */
export function withSecretClear(base: ClipboardPrimitives, o: { ttlMs?: number; timers?: TimerApi } = {}): ClipboardPrimitives & { cancelClear(): void } {
  const ttl = o.ttlMs ?? SECRET_CLEAR_MS;
  const timers: TimerApi = o.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };
  let timer: unknown;
  const cancel = () => {
    if (timer !== undefined) timers.clear(timer);
    timer = undefined;
  };
  return {
    ...base,
    cancelClear: cancel,
    async writeSecretText(text: string) {
      await base.writeSecretText(text);
      cancel();
      timer = timers.set(() => {
        timer = undefined;
        void (async () => {
          try {
            // only wipe what WE put there: if the user has copied something else since, leave it alone
            if (normalizeText(await base.readText()) === normalizeText(text)) await base.clear();
          } catch {
            /* clipboard busy: leave it */
          }
        })();
      }, ttl);
    },
    // any non-secret write supersedes a pending clear (the secret is no longer on the clipboard)
    async writeText(text: string) {
      cancel();
      await base.writeText(text);
    },
    async writePng(png: Buffer) {
      cancel();
      await base.writePng(png);
    },
  };
}
