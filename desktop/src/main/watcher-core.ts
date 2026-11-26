/**
 * Pure clipboard-watching logic (no electron): change detection by hash, own-write guard,
 * concealed-entry detection, size caps and paused-app matching. `watcher.ts` wires it to Electron.
 */
import { createHash } from 'node:crypto';

export const MAX_TEXT_BYTES = 500_000;
export const MAX_IMAGE_BYTES = 20_000_000;
export const OWN_WRITE_TTL_MS = 5_000;

/** Formats password managers and the OS use to say "do not record this". */
export const CONCEALED_FORMATS = [
  'org.nspasteboard.ConcealedType', // macOS (1Password, Bitwarden, ...)
  'org.nspasteboard.TransientType', // macOS
  'ExcludeClipboardContentFromMonitorProcessing', // Windows
] as const;

/** Windows: a DWORD of 0 means "keep this out of clipboard history". */
export const WIN_HISTORY_FORMAT = 'CanIncludeInClipboardHistory';

export interface ImageSnapshot {
  /** Cheap fingerprint of the pixels (same function for own-write marks and reads). */
  key: string;
  png(): Buffer;
}

/** What the watcher needs from a clipboard (Electron's `clipboard` in the app, a fake in tests). */
export interface ClipboardReader {
  hasFormat(format: string): Promise<boolean>;
  readBuffer(format: string): Promise<Buffer | undefined>;
  readText(): Promise<string>;
  hasImage(): Promise<boolean>;
  readImage(): Promise<ImageSnapshot | undefined>;
}

const sha1 = (s: string | Buffer) => createHash('sha1').update(s).digest('hex');

/** CRLF differs between what an app writes and what the OS hands back. */
export const normalizeText = (t: string) => t.replace(/\r\n/g, '\n');
export const textKey = (t: string) => 't:' + sha1(normalizeText(t));
export const bytesKey = (width: number, height: number, bitmap: Buffer) => `i:${width}x${height}:${sha1(bitmap)}`;

export async function isConcealed(r: Pick<ClipboardReader, 'hasFormat' | 'readBuffer'>): Promise<boolean> {
  for (const f of CONCEALED_FORMATS) if (await safe(() => r.hasFormat(f))) return true;
  const hist = await safe(async () => ((await r.hasFormat(WIN_HISTORY_FORMAT)) ? r.readBuffer(WIN_HISTORY_FORMAT) : undefined));
  return !!hist && hist.length >= 4 && hist.readUInt32LE(0) === 0;
}

async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

const normApp = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.(exe|app)$/i, '')
    .trim();

/**
 * True when `appName` belongs to one of the listed apps. Substring match in the app name, so "KeePass"
 * covers KeePassXC and "1Password" covers "1Password 7 - Password Manager".
 */
export function isPausedApp(appName: string | undefined, paused: string[]): boolean {
  if (!appName) return false;
  const a = normApp(appName);
  return paused.some((p) => {
    const n = normApp(p);
    return n !== '' && a.includes(n);
  });
}

/** Remembers clipboard writes made by mouStache itself so the watcher does not re-capture them. */
export function createOwnWriteGuard(now: () => number = Date.now, ttlMs = OWN_WRITE_TTL_MS) {
  const marks = new Map<string, number>();
  const prune = () => {
    for (const [k, exp] of marks) if (exp <= now()) marks.delete(k);
  };
  return {
    mark(key: string) {
      prune();
      marks.set(key, now() + ttlMs);
    },
    /** True (once) if `key` was marked and has not expired. */
    consume(key: string): boolean {
      prune();
      return marks.delete(key);
    },
  };
}
export type OwnWriteGuard = ReturnType<typeof createOwnWriteGuard>;

export type Capture = { kind: 'text'; text: string } | { kind: 'image'; png: Buffer };

export type TickResult =
  | 'baseline'
  | 'unchanged'
  | 'paused'
  | 'empty'
  | 'concealed'
  | 'own-write'
  | 'too-large'
  | 'captured';

export interface WatcherCoreDeps {
  reader: ClipboardReader;
  isPaused(): boolean;
  guard: OwnWriteGuard;
  onCapture(c: Capture): void;
  maxTextBytes?: number;
  maxImageBytes?: number;
}

/**
 * One poll step per `tick()`. The first tick after start/resume only records a baseline, so whatever was
 * already on the clipboard is never captured retroactively.
 */
export function createWatcherCore(d: WatcherCoreDeps) {
  const maxText = d.maxTextBytes ?? MAX_TEXT_BYTES;
  const maxImage = d.maxImageBytes ?? MAX_IMAGE_BYTES;
  let last: string | undefined;
  let needBaseline = true;
  // Polls are async and may finish out of order (a slow clipboard read, or one the caller gave up waiting for).
  // Only the newest poll to finish may change state; an older read would be stale and could re-capture
  // whatever was on the clipboard BEFORE the copy we just handled.
  let started = 0;
  let applied = 0;
  const stale = (mine: number) => mine < applied;

  async function tick(): Promise<TickResult> {
    if (d.isPaused()) {
      needBaseline = true; // while paused we do not even look at the clipboard
      return 'paused';
    }
    const mine = ++started;
    const r = d.reader;

    if (await isConcealed(r)) {
      if (stale(mine) || d.isPaused()) return 'unchanged';
      applied = mine;
      const changed = last !== 'concealed' || needBaseline;
      needBaseline = false;
      last = 'concealed'; // content is never read
      return changed ? 'concealed' : 'unchanged';
    }

    let key: string;
    let text: string | undefined;
    let image: ImageSnapshot | undefined;
    const t = (await safe(() => r.readText())) ?? '';
    if (t.trim()) {
      text = t;
      key = textKey(t);
    } else if (await safe(() => r.hasImage())) {
      image = await safe(() => r.readImage());
      key = image ? image.key : '';
    } else {
      key = '';
    }

    if (stale(mine) || d.isPaused()) return 'unchanged';
    if (key === '') {
      applied = mine;
      needBaseline = false;
      last = '';
      return 'empty';
    }
    if (key === last) {
      applied = mine;
      needBaseline = false;
      return 'unchanged';
    }

    // A password manager may have replaced the clipboard between the first check and the read above: look again
    // before treating anything new as capturable (the content is dropped, never saved).
    if (await isConcealed(r)) {
      if (stale(mine) || d.isPaused()) return 'unchanged';
      applied = mine;
      needBaseline = false;
      last = 'concealed';
      return 'concealed';
    }
    if (stale(mine) || d.isPaused()) return 'unchanged';

    applied = mine;
    const baselineOnly = needBaseline;
    needBaseline = false;
    last = key;
    if (baselineOnly) return 'baseline';
    if (d.guard.consume(key)) return 'own-write';

    if (text !== undefined) {
      if (Buffer.byteLength(text) > maxText) return 'too-large';
      d.onCapture({ kind: 'text', text });
      return 'captured';
    }
    const png = image!.png();
    if (png.length > maxImage) return 'too-large';
    d.onCapture({ kind: 'image', png });
    return 'captured';
  }

  return { tick };
}
