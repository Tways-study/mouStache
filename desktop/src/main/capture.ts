/** Turns a raw clipboard capture into a save request and an outcome the UI layers (blip, tray) can use. */
import { classify } from '@/lib/classify';
import type { SaveResult } from '@/lib/messaging';
import { typeLabel } from '../shared/labels';
import { isPausedApp, type Capture } from './watcher-core';

export interface ForegroundApp {
  name: string;
  pid?: number;
  /** Windows: the window handle (HWND) as a decimal string, used to bring the window back before pasting. */
  handle?: string;
}

export interface CaptureDeps {
  /** Best effort; undefined when unknown. */
  foregroundApp(): Promise<ForegroundApp | undefined>;
  pausedApps(): string[];
  /** The pid of this app: copies made inside mouStache's own windows are not re-captured. */
  ownPid?: number;
  /** Sends a message to the engine window (handleMessage). */
  save(msg: unknown): Promise<SaveResult | undefined>;
}

export type CaptureOutcome =
  | { status: 'saved'; label: string; deduped: boolean; kind: 'text' | 'image'; id?: string }
  | { status: 'skipped'; reason: 'paused-app' | 'own-app' | 'secret' | 'paused' | 'disabled' | 'empty' }
  | { status: 'error'; error: string };

/** Content-free label: derived from the classifier's tags, never from the text itself. */
export function labelFor(c: Capture): string {
  if (c.kind === 'image') return 'Image';
  const cls = classify(c.text);
  return typeLabel({ kind: 'text', tags: cls.tags, lang: cls.lang, secret: cls.secret });
}

export async function processCapture(c: Capture, d: CaptureDeps, via: 'copy' | 'screenshot' = 'copy'): Promise<CaptureOutcome> {
  let app: ForegroundApp | undefined;
  try {
    app = await d.foregroundApp();
  } catch {
    app = undefined; // detection failing must never block capture
  }
  if (app && d.ownPid !== undefined && app.pid === d.ownPid) return { status: 'skipped', reason: 'own-app' };
  if (isPausedApp(app?.name, d.pausedApps())) return { status: 'skipped', reason: 'paused-app' };

  const source = app?.name ? { title: app.name } : undefined;
  const msg =
    c.kind === 'text'
      ? { type: 'save-text', text: c.text, source, via }
      : { type: 'save-image', dataUrl: `data:image/png;base64,${c.png.toString('base64')}`, source, via };

  const res = await d.save(msg);
  if (!res) return { status: 'error', error: 'no response from engine' };
  if (res.skipped) return { status: 'skipped', reason: res.skipped };
  if (!res.ok) return { status: 'error', error: res.error ?? 'save failed' };
  return { status: 'saved', label: labelFor(c), deduped: !!res.deduped, kind: c.kind, id: res.id };
}
