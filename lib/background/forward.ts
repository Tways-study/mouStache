import { postCapture } from '../bridge-client';
import { BRIDGE_DEFAULT_PORT, type BridgeCapture, type BridgeVia } from '../bridge';
import { blobToDataUrl } from '../db';
import { getSettings } from '../settings';
import type { StashSource } from '../types';
import { stripUrl } from '../url';

/** After a failed send the bridge is left alone for this long, so a closed desktop app costs nothing. */
export const BACKOFF_MS = 30_000;
/** base64 inflates by about 4/3; keep the data URL under the bridge's 15 MB cap. */
const MAX_IMAGE_BYTES = 10_500_000;
const VIAS: readonly string[] = ['copy', 'context-menu', 'screenshot', 'paste'];

const MAX_TITLE = 300;
const MAX_URL = 2048;
const isHttp = (s: string): boolean => {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Make the page source fit the bridge's rules BEFORE sending, so one odd page can never make the app refuse a copy:
 * title cut to 300 characters, only http(s) URLs (query and hash removed, over-long ones omitted), favicons only as
 * plain http(s) URLs (data: favicons are dropped). Returns undefined when nothing usable is left.
 */
export function sanitizeSource(source: StashSource | undefined): StashSource | undefined {
  if (!source) return undefined;
  const out: StashSource = {};
  if (source.url && source.url.length <= MAX_URL && isHttp(source.url)) {
    const u = stripUrl(source.url);
    if (u) out.url = u;
  }
  if (typeof source.title === 'string' && source.title) out.title = source.title.slice(0, MAX_TITLE);
  if (source.favicon && source.favicon.length <= MAX_URL && isHttp(source.favicon)) out.favicon = source.favicon;
  return out.url || out.title || out.favicon ? out : undefined;
}

let downUntil = 0;
/** Test helper. */
export function _resetForward(): void {
  downUntil = 0;
}

async function forward(build: () => Promise<BridgeCapture | undefined>): Promise<void> {
  try {
    const s = await getSettings();
    if (!s.bridgeEnabled || !s.bridgeToken) return; // not paired: do nothing at all
    if (Date.now() < downUntil) return;
    const capture = await build();
    if (!capture) return;
    const result = await postCapture({ port: s.bridgePort || BRIDGE_DEFAULT_PORT, token: s.bridgeToken }, capture);
    // only an OUTAGE (not running, not our app, rate limited) backs off; a refused single capture is just dropped
    if (result === 'down') downUntil = Date.now() + BACKOFF_MS;
  } catch {
    /* forwarding must never affect the local save, and must never log */
  }
}

/**
 * Fire-and-forget copy of a LOCAL save to the desktop app. Callers must not pass secrets (saveText checks).
 * Returns nothing and never throws.
 */
export function forwardText(text: string, source: StashSource | undefined, via: string): void {
  if (!VIAS.includes(via)) return;
  void forward(async () => {
    const src = sanitizeSource(source);
    return { kind: 'text', text, via: via as BridgeVia, ...(src ? { source: src } : {}) };
  });
}

export function forwardImage(blob: Blob, source: StashSource | undefined, via: string): void {
  if (!VIAS.includes(via) || blob.size > MAX_IMAGE_BYTES) return;
  void forward(async () => {
    const src = sanitizeSource(source);
    return { kind: 'image', dataUrl: await blobToDataUrl(blob), via: via as BridgeVia, ...(src ? { source: src } : {}) };
  });
}
