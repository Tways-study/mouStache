import { postCapture } from '../bridge-client';
import { BRIDGE_DEFAULT_PORT, type BridgeCapture, type BridgeVia } from '../bridge';
import { blobToDataUrl } from '../db';
import { getSettings } from '../settings';
import type { StashSource } from '../types';

/** After a failed send the bridge is left alone for this long, so a closed desktop app costs nothing. */
export const BACKOFF_MS = 30_000;
/** base64 inflates by about 4/3; keep the data URL under the bridge's 15 MB cap. */
const MAX_IMAGE_BYTES = 10_500_000;
const VIAS: readonly string[] = ['copy', 'context-menu', 'screenshot', 'paste'];

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
    const ok = await postCapture({ port: s.bridgePort || BRIDGE_DEFAULT_PORT, token: s.bridgeToken }, capture);
    if (!ok) downUntil = Date.now() + BACKOFF_MS;
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
  void forward(async () => ({ kind: 'text', text, via: via as BridgeVia, ...(source ? { source } : {}) }));
}

export function forwardImage(blob: Blob, source: StashSource | undefined, via: string): void {
  if (!VIAS.includes(via) || blob.size > MAX_IMAGE_BYTES) return;
  void forward(async () => ({ kind: 'image', dataUrl: await blobToDataUrl(blob), via: via as BridgeVia, ...(source ? { source } : {}) }));
}
