import { browser } from 'wxt/browser';
import type { ItemKind, StashItem, StashSource } from './types';

/** StashItem without Blobs (not structured-clone friendly across messaging); images carry a thumb data URL. */
export type StashItemLite = Omit<StashItem, 'imageBlob' | 'thumbBlob'> & {
  thumbDataUrl?: string;
};

export type SaveVia = StashItem['via'];

export type StashMessage =
  | { type: 'save-text'; text: string; source?: StashSource; via?: SaveVia }
  | { type: 'save-image'; dataUrl: string; source?: StashSource; via: SaveVia }
  | { type: 'search'; query: string; limit: number; tag?: string; kind?: ItemKind }
  | { type: 'copy-item'; id: string }
  | { type: 'badge-reset' }
  | { type: 'capture-visible' }
  | { type: 'capture-region'; rect: { x: number; y: number; w: number; h: number; dpr: number } }
  | { type: 'items-changed' } // broadcast
  | { type: 'show-toast'; text: string } // background -> content
  | { type: 'open-palette' } // background -> content
  | { type: 'start-region-select' }; // background -> content

export type MessageType = StashMessage['type'];

export interface SaveResult {
  ok: boolean;
  id?: string;
  deduped?: boolean;
  skipped?: 'paused' | 'secret' | 'disabled' | 'empty';
  error?: string;
}

/** Response payload for each message type. */
export interface MessageResponse {
  'save-text': SaveResult;
  'save-image': SaveResult;
  search: StashItemLite[];
  'copy-item': { ok: boolean; error?: string; kind?: ItemKind; text?: string; dataUrl?: string; mime?: string };
  'badge-reset': void;
  'capture-visible': SaveResult;
  'capture-region': SaveResult;
  'items-changed': void;
  'show-toast': void;
  'open-palette': void;
  'start-region-select': void;
}

export type ResponseFor<M extends StashMessage> = MessageResponse[M['type']];

/** Send to the extension runtime (background / other extension pages). */
export function send<M extends StashMessage>(msg: M): Promise<ResponseFor<M>> {
  return browser.runtime.sendMessage(msg) as Promise<ResponseFor<M>>;
}

/** Send to a specific tab's content script (background -> content). */
export function sendToTab<M extends StashMessage>(tabId: number, msg: M): Promise<ResponseFor<M>> {
  return browser.tabs.sendMessage(tabId, msg) as Promise<ResponseFor<M>>;
}

export function isStashMessage(m: unknown): m is StashMessage {
  return typeof m === 'object' && m !== null && typeof (m as { type?: unknown }).type === 'string';
}
