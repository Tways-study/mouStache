import { browser } from 'wxt/browser';
import { blobToDataUrl, dataUrlToBlob, getItem, listItems } from '../db';
import { isStashMessage, type MessageResponse, type SaveResult, type StashItemLite, type StashMessage } from '../messaging';
import { cropImage } from '../thumbs';
import type { StashSource } from '../types';
import { resetBadge } from './badge';
import { saveImage, saveText } from './save';

const PREVIEW_CHARS = 600;

export type StashTab = { id?: number; url?: string; title?: string; favIconUrl?: string; windowId?: number };
export type Sender = { tab?: StashTab };

export function sourceFromTab(tab?: StashTab): StashSource | undefined {
  if (!tab) return undefined;
  const s: StashSource = { url: tab.url, title: tab.title, favicon: tab.favIconUrl };
  return s.url || s.title ? s : undefined;
}

async function captureTab(sender: Sender): Promise<{ dataUrl: string; source?: StashSource; tabId?: number }> {
  let tab = sender.tab;
  if (!tab || tab.windowId === undefined) {
    const [active] = await browser.tabs.query({ active: true, currentWindow: true });
    tab = active ?? tab;
  }
  const capture = () => browser.tabs.captureVisibleTab(tab?.windowId as number, { format: 'png' });
  let dataUrl: string;
  try {
    dataUrl = await capture();
  } catch (e) {
    // captureVisibleTab is rate limited (MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND); retry once
    if (!/MAX_CAPTURE|quota|rate/i.test(String(e))) throw e;
    await new Promise((res) => setTimeout(res, 600));
    dataUrl = await capture();
  }
  return { dataUrl, source: sourceFromTab(tab), tabId: tab?.id };
}

export async function captureVisible(sender: Sender): Promise<SaveResult> {
  const { dataUrl, source, tabId } = await captureTab(sender);
  return saveImage(dataUrl, source, 'screenshot', tabId);
}

export async function captureRegion(
  rect: { x: number; y: number; w: number; h: number; dpr: number },
  sender: Sender,
): Promise<SaveResult> {
  const { dataUrl, source, tabId } = await captureTab(sender);
  const cropped = await cropImage(dataUrlToBlob(dataUrl), rect);
  return saveImage(cropped, source, 'screenshot', tabId);
}

async function dispatch(msg: StashMessage, sender: Sender): Promise<unknown> {
  switch (msg.type) {
    case 'save-text':
      return saveText(msg.text, msg.source ?? sourceFromTab(sender.tab), msg.via ?? 'copy', sender.tab?.id);
    case 'save-image':
      return saveImage(msg.dataUrl, msg.source ?? sourceFromTab(sender.tab), msg.via, sender.tab?.id);
    case 'search': {
      const items = await listItems({
        query: msg.query,
        tag: msg.tag,
        kind: msg.kind,
        limit: msg.limit || 50,
        pinnedFirst: true,
      });
      const out: StashItemLite[] = [];
      for (const { imageBlob: _img, thumbBlob, text, ...rest } of items) {
        const lite: StashItemLite = { ...rest };
        // preview only; secrets get no text at all (copy-item fetches the full item by id)
        if (text !== undefined && !rest.secret) lite.text = text.length > PREVIEW_CHARS ? text.slice(0, PREVIEW_CHARS) : text;
        if (thumbBlob) lite.thumbDataUrl = await blobToDataUrl(thumbBlob);
        out.push(lite);
      }
      return out;
    }
    case 'copy-item': {
      const item = await getItem(msg.id);
      if (!item) return { ok: false, error: 'Item not found' };
      if (item.kind === 'image') {
        if (!item.imageBlob) return { ok: false, error: 'Image data missing' };
        return {
          ok: true,
          kind: 'image',
          dataUrl: await blobToDataUrl(item.imageBlob),
          mime: item.mime ?? item.imageBlob.type,
        };
      }
      return { ok: true, kind: item.kind, text: item.text ?? '' };
    }
    case 'badge-reset':
      await resetBadge();
      return undefined;
    case 'capture-visible':
      return captureVisible(sender);
    case 'capture-region':
      return captureRegion(msg.rect, sender);
    default:
      return undefined;
  }
}

const HANDLED = new Set<StashMessage['type']>([
  'save-text',
  'save-image',
  'search',
  'copy-item',
  'badge-reset',
  'capture-visible',
  'capture-region',
]);

/** Dispatch a message; errors become {ok:false,error} (search returns []). */
export async function handleMessage<M extends StashMessage>(
  msg: M,
  sender: Sender,
): Promise<MessageResponse[M['type']]> {
  try {
    return (await dispatch(msg, sender)) as MessageResponse[M['type']];
  } catch (e) {
    console.error('[stash] message failed', msg.type, e);
    if (msg.type === 'search') return [] as unknown as MessageResponse[M["type"]];
    if (msg.type === 'badge-reset') return undefined as unknown as MessageResponse[M['type']];
    return { ok: false, error: e instanceof Error ? e.message : String(e) } as unknown as MessageResponse[M['type']];
  }
}

export function registerMessageRouter(): void {
  browser.runtime.onMessage.addListener(((msg: unknown, sender: Sender, sendResponse: (r?: unknown) => void) => {
    if (!isStashMessage(msg) || !HANDLED.has(msg.type)) return false;
    handleMessage(msg, sender).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
    return true; // keep the channel open for the async response
  }) as Parameters<typeof browser.runtime.onMessage.addListener>[0]);
}
