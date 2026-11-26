/**
 * Wire protocol between the browser extension and the desktop app ("the bridge"):
 * POST http://127.0.0.1:<port>/v1/capture with a bearer token. Pure, dependency-free, used by both sides.
 */
import { stripUrl } from './url';
import type { StashSource } from './types';

export const BRIDGE_DEFAULT_PORT = 47821;
export const BRIDGE_MAX_TEXT_BYTES = 1_000_000;
export const BRIDGE_MAX_IMAGE_DATAURL = 15_000_000;
/** Largest request body the server will ever buffer (image data URL plus JSON framing). */
export const BRIDGE_MAX_BODY = BRIDGE_MAX_IMAGE_DATAURL + 4096;

export type BridgeVia = 'copy' | 'context-menu' | 'screenshot' | 'paste';
const VIAS: readonly string[] = ['copy', 'context-menu', 'screenshot', 'paste'];

export type BridgeCapture =
  | { kind: 'text'; text: string; source?: StashSource; via: BridgeVia }
  | { kind: 'image'; dataUrl: string; source?: StashSource; via: BridgeVia };

export type BridgeErrorCode =
  | 'bad_json'
  | 'bad_body'
  | 'bad_kind'
  | 'unknown_field'
  | 'bad_text'
  | 'text_too_large'
  | 'bad_image'
  | 'image_too_large'
  | 'bad_source'
  | 'bad_via';

export type ValidateResult = { ok: true; value: BridgeCapture } | { ok: false; error: BridgeErrorCode };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const httpUrl = (s: string): boolean => {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

/** `undefined` = fine and absent, `null` = invalid. Page URLs are reduced to origin + path, like the extension does. */
function cleanSource(raw: unknown): StashSource | undefined | null {
  if (raw === undefined) return undefined;
  if (!isObj(raw)) return null;
  for (const k of Object.keys(raw)) if (k !== 'url' && k !== 'title' && k !== 'favicon') return null;
  const out: StashSource = {};
  if (raw['url'] !== undefined) {
    if (typeof raw['url'] !== 'string' || raw['url'].length > 2048 || !httpUrl(raw['url'])) return null;
    out.url = stripUrl(raw['url']);
  }
  if (raw['title'] !== undefined) {
    if (typeof raw['title'] !== 'string' || raw['title'].length > 300) return null;
    out.title = raw['title'];
  }
  if (raw['favicon'] !== undefined) {
    const f = raw['favicon'];
    const okData = typeof f === 'string' && /^data:image\/(png|jpeg|gif|webp|x-icon|svg\+xml)[;,]/i.test(f) && f.length <= 20_000;
    if (typeof f !== 'string' || !(okData || (f.length <= 2048 && httpUrl(f)))) return null;
    out.favicon = f;
  }
  return out.url || out.title || out.favicon ? out : undefined;
}

export function validateCapture(body: unknown): ValidateResult {
  if (!isObj(body)) return { ok: false, error: 'bad_body' };
  const kind = body['kind'];
  if (kind !== 'text' && kind !== 'image') return { ok: false, error: 'bad_kind' };
  const allowed = new Set(['kind', 'source', 'via', kind === 'text' ? 'text' : 'dataUrl']);
  for (const k of Object.keys(body)) if (!allowed.has(k)) return { ok: false, error: 'unknown_field' };

  let via: BridgeVia = 'copy';
  if (body['via'] !== undefined) {
    if (typeof body['via'] !== 'string' || !VIAS.includes(body['via'])) return { ok: false, error: 'bad_via' };
    via = body['via'] as BridgeVia;
  }
  const source = cleanSource(body['source']);
  if (source === null) return { ok: false, error: 'bad_source' };
  const withSource = source ? { source } : {};

  if (kind === 'text') {
    const text = body['text'];
    if (typeof text !== 'string' || text.length === 0) return { ok: false, error: 'bad_text' };
    if (text.length > BRIDGE_MAX_TEXT_BYTES || new TextEncoder().encode(text).length > BRIDGE_MAX_TEXT_BYTES) {
      return { ok: false, error: 'text_too_large' };
    }
    return { ok: true, value: { kind, text, via, ...withSource } };
  }
  const dataUrl = body['dataUrl'];
  if (typeof dataUrl !== 'string') return { ok: false, error: 'bad_image' };
  if (dataUrl.length > BRIDGE_MAX_IMAGE_DATAURL) return { ok: false, error: 'image_too_large' };
  if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) return { ok: false, error: 'bad_image' };
  return { ok: true, value: { kind, dataUrl, via, ...withSource } };
}

/** What the desktop app answers to GET /v1/ping. */
export interface BridgePing {
  ok: true;
  app: 'mouStache';
  version: string;
}
