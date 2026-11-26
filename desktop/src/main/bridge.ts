/** Electron-side glue for the extension bridge: token, server lifecycle, and handing captures to the engine. */
import { classify } from '@/lib/classify';
import { BRIDGE_DEFAULT_PORT, type BridgeCapture } from '@/lib/bridge';
import type { SaveResult } from '@/lib/messaging';
import type { BridgeInfoDto } from '../shared/api';
import { createBridgeHandler, createTokenStore, startBridgeServer, type BridgeListenError, type RunningBridge } from './bridge-core';
import type { CaptureOutcome } from './capture';
import { labelFor } from './capture';
import type { PresenceSettings } from './presence-settings';

export interface BridgeDeps {
  userData: string;
  version: string;
  engine: { request(msg: unknown): Promise<unknown> };
  presence: { get(): PresenceSettings };
  /** Called for every accepted capture so the app can update the tray / blip / stats. Never receives content. */
  onOutcome(o: CaptureOutcome): void;
  /** Port override (e2e uses 0 = any free port). */
  portOverride?: number;
}

/**
 * Turn a validated bridge capture into engine messages. Secrets are never saved over the bridge, whatever `via`
 * says (the engine itself only skips them for plain copies), and "pause capture" pauses the bridge too.
 */
export async function saveBridgeCapture(
  c: BridgeCapture,
  d: Pick<BridgeDeps, 'engine' | 'presence'>,
): Promise<{ body: Record<string, unknown>; outcome: CaptureOutcome }> {
  const s = d.presence.get();
  const skipped = (reason: 'paused' | 'secret' | 'disabled' | 'empty') => ({
    body: { ok: true, skipped: reason },
    outcome: { status: 'skipped', reason } satisfies CaptureOutcome,
  });
  if (!s.autoCapture) return skipped('paused');
  if (c.kind === 'text' && s.skipSecrets && classify(c.text).secret) return skipped('secret');

  const msg =
    c.kind === 'text'
      ? { type: 'save-text', text: c.text, source: c.source, via: c.via }
      : { type: 'save-image', dataUrl: c.dataUrl, source: c.source, via: c.via };
  const res = (await d.engine.request(msg)) as SaveResult | undefined;
  if (!res || (!res.ok && !res.skipped)) throw new Error('save failed');
  if (res.skipped) return skipped(res.skipped);
  return {
    body: { ok: true, id: res.id, deduped: !!res.deduped },
    outcome: {
      status: 'saved',
      label: c.kind === 'image' ? 'Image' : labelFor({ kind: 'text', text: c.text }),
      deduped: !!res.deduped,
      kind: c.kind,
      id: res.id,
    },
  };
}

export function createBridge(d: BridgeDeps) {
  const tokens = createTokenStore(d.userData);
  let running: RunningBridge | undefined;
  let error: BridgeListenError | undefined;
  let preferred = d.portOverride ?? BRIDGE_DEFAULT_PORT;
  let generation = 0;

  const handler = createBridgeHandler({
    getToken: tokens.get,
    getPort: () => running?.port ?? 0,
    version: d.version,
    onCapture: async (c) => {
      const { body, outcome } = await saveBridgeCapture(c, d);
      d.onOutcome(outcome);
      return body;
    },
  });

  const info = (): BridgeInfoDto => ({
    status: running ? 'listening' : 'error',
    port: running?.port,
    preferredPort: preferred,
    error: error?.message,
    token: tokens.get(),
    version: d.version,
  });

  async function start(port: number): Promise<void> {
    const mine = ++generation;
    preferred = d.portOverride ?? port;
    const old = running;
    running = undefined;
    await old?.close();
    try {
      const next = await startBridgeServer(handler, { port: preferred });
      if (mine !== generation) return void (await next.close()); // a newer start() won
      running = next;
      error = undefined;
    } catch (e) {
      if (mine !== generation) return;
      error = e as BridgeListenError;
    }
  }

  return {
    start,
    info,
    /** New token; the old one stops working on the very next request. */
    regenerate: () => {
      tokens.regenerate();
      return info();
    },
    async stop() {
      generation++;
      const r = running;
      running = undefined;
      await r?.close();
    },
    get port() {
      return running?.port;
    },
    get preferred() {
      return preferred;
    },
  };
}

export type BridgeController = ReturnType<typeof createBridge>;
