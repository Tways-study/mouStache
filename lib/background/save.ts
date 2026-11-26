import { classify } from '../classify';
import { addItem, dataUrlToBlob, enforceMaxItems } from '../db';
import { hashBlob, hashText } from '../hash';
import { sendToTab, type SaveResult, type SaveVia } from '../messaging';
import { getSettings } from '../settings';
import { makeThumb } from '../thumbs';
import type { ItemKind, StashSource } from '../types';
import { incrementUnseen } from './badge';
import { broadcastItemsChanged } from './broadcast';

export const MAX_TEXT_LENGTH = 200_000;

export function hostOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Drop query string and hash from a page URL (they often carry tokens). */
export function stripUrl(url?: string): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'file:') return url;
    return u.origin === 'null' ? `${u.protocol}//${u.pathname}` : u.origin + u.pathname;
  } catch {
    return undefined;
  }
}

function cleanSource(source?: StashSource): StashSource | undefined {
  if (!source) return source;
  return { ...source, url: stripUrl(source.url) };
}

export function isPausedHost(host: string | undefined, paused: string[]): boolean {
  if (!host) return false;
  return paused.some((p) => {
    const h = p.trim().toLowerCase().replace(/^\*\./, '');
    return h !== '' && (host === h || host.endsWith('.' + h));
  });
}

export function isSingleUrl(text: string): boolean {
  if (/\s/.test(text)) return false;
  try {
    const u = new URL(text);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'ftp:';
  } catch {
    return false;
  }
}

async function toast(tabId: number | undefined, text: string): Promise<void> {
  if (tabId === undefined) return;
  try {
    await sendToTab(tabId, { type: 'show-toast', text });
  } catch {
    /* no content script in tab */
  }
}

export async function saveText(
  rawText: string,
  source: StashSource | undefined,
  via: SaveVia,
  tabId?: number,
): Promise<SaveResult> {
  const text = rawText.trim().slice(0, MAX_TEXT_LENGTH);
  if (!text) return { ok: true, skipped: 'empty' };
  source = cleanSource(source);
  const settings = await getSettings();
  if (via === 'copy' && !settings.autoCapture) return { ok: true, skipped: 'disabled' };
  if (isPausedHost(hostOf(source?.url), settings.pausedHosts)) return { ok: true, skipped: 'paused' };

  const c = classify(text);
  if (c.secret && settings.skipSecrets && via === 'copy') return { ok: true, skipped: 'secret' };

  const kind: ItemKind = isSingleUrl(text) ? 'link' : 'text';
  const item = await addItem({
    kind,
    text,
    hash: await hashText(text),
    tags: c.tags,
    lang: c.lang,
    secret: c.secret,
    source,
    via,
  });
  await enforceMaxItems(settings.maxItems);
  if (!item.deduped) await incrementUnseen();
  await broadcastItemsChanged();
  if (settings.showToast) {
    await toast(tabId, item.deduped ? 'Already in mouStache — moved to top' : 'Saved to mouStache');
  }
  return { ok: true, id: item.id, deduped: !!item.deduped };
}

export async function saveImage(
  input: Blob | string,
  source: StashSource | undefined,
  via: SaveVia,
  tabId?: number,
): Promise<SaveResult> {
  try {
    const blob = typeof input === 'string' ? dataUrlToBlob(input) : input;
    source = cleanSource(source);
    const settings = await getSettings();
    if (via === 'copy' && !settings.autoCapture) return { ok: true, skipped: 'disabled' };
    if (isPausedHost(hostOf(source?.url), settings.pausedHosts)) return { ok: true, skipped: 'paused' };

    const mime = blob.type || 'image/png';
    const hash = await hashBlob(blob);
    const { thumbBlob, width, height } = await makeThumb(blob);
    const tags = via === 'screenshot' ? ['image', 'screenshot'] : ['image'];
    const item = await addItem({
      kind: 'image',
      imageBlob: blob,
      thumbBlob,
      width,
      height,
      mime,
      hash,
      tags,
      source,
      via,
    });
    await enforceMaxItems(settings.maxItems);
    if (!item.deduped) await incrementUnseen();
    await broadcastItemsChanged();
    if (settings.showToast) {
      await toast(tabId, item.deduped ? 'Already in mouStache — moved to top' : 'Saved to mouStache');
    }
    return { ok: true, id: item.id, deduped: !!item.deduped };
  } catch (e) {
    await toast(tabId, "Couldn't save that image");
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Fetch an image URL (data: or http(s)) and save it. */
export async function saveImageFromUrl(
  srcUrl: string,
  source: StashSource | undefined,
  via: SaveVia,
  tabId?: number,
): Promise<SaveResult> {
  try {
    let blob: Blob;
    if (srcUrl.startsWith('data:')) {
      blob = dataUrlToBlob(srcUrl);
    } else {
      const res = await fetch(srcUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      blob = await res.blob();
    }
    return await saveImage(blob, source, via, tabId);
  } catch (e) {
    await toast(tabId, "Couldn't save that image");
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
