/** IPC contract shared by main, preload and renderers (no runtime deps, safe in every context). */

export const CH = {
  /** renderer -> main: runtime.sendMessage */
  send: 'shim:send',
  /** main -> renderer: a broadcast message from another window */
  message: 'shim:message',
  /** main -> engine: please run handleMessage */
  engineRequest: 'engine:request',
  /** engine -> main: result of an engine request */
  engineReply: 'engine:reply',
  /** engine -> main: engine finished booting and is serving */
  engineReady: 'engine:ready',
  /** renderer -> main: open an http(s) URL in the default browser */
  openExternal: 'shell:open-external',
} as const;

/** Messages that are fanned out to the other windows instead of being answered by the engine. */
export const BROADCAST_TYPES: ReadonlySet<string> = new Set([
  'items-changed',
  'show-toast',
  'open-palette',
  'start-region-select',
]);

export interface EngineRequest {
  id: number;
  msg: unknown;
}
export interface EngineReply {
  id: number;
  result: unknown;
}

/** What the preload exposes on `window.mouDesktop`. */
export interface DesktopApi {
  send(msg: unknown): Promise<unknown>;
  onMessage(cb: (msg: unknown) => void): () => void;
  /** Engine window only: answer requests. Also tells main the engine is ready. */
  serveEngine(handler: (msg: unknown) => Promise<unknown>): void;
  openExternal(url: string): Promise<void>;
}

declare global {
  interface Window {
    mouDesktop?: DesktopApi;
  }
}
