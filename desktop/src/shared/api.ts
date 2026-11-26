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
  /** engine -> main: the current Settings (on start and on every change) */
  settings: 'desktop:settings',
  /** renderer -> main: "I just wrote the clipboard, ignore it" */
  ownWrite: 'desktop:own-write',
  getLogin: 'desktop:get-login',
  setLogin: 'desktop:set-login',
  /** main -> blip window: render / hide the pill */
  blip: 'blip:render',
  /** palette window -> main: the user picked an item */
  paletteChoose: 'palette:choose',
  /** palette window -> main: Esc / click away */
  paletteClose: 'palette:close',
  /** main -> palette window: about to be shown (start fresh) */
  paletteShow: 'palette:show',
  /** palette window -> main: fresh palette is rendered, safe to show (so early typing is never lost) */
  paletteReady: 'palette:ready',
  /** main -> region window: the frozen screenshot to select from */
  regionShow: 'region:show',
  /** region window -> main: cropped PNG data URL / cancelled */
  regionDone: 'region:done',
  regionCancel: 'region:cancel',
  hotkeyStatus: 'desktop:hotkey-status',
  /** panel window only (Settings): bridge status + pairing token */
  bridgeInfo: 'bridge:info',
  bridgeRegenerate: 'bridge:regenerate',
} as const;

/** What Settings shows for the extension bridge. The token only ever goes to the panel window. */
export interface BridgeInfoDto {
  status: 'listening' | 'error';
  port?: number;
  preferredPort: number;
  error?: string;
  token: string;
  version: string;
}

export interface PaletteChooseRequest {
  id: string;
  mode: 'paste' | 'copy' | 'code';
  fence?: string;
}

export interface RegionShow {
  /** PNG of the whole display, taken before the overlay appeared. */
  dataUrl: string;
}

export interface HotkeyStatusDto {
  palette: { requested: string; active?: string; ok: boolean; error?: string };
  screenshot: { requested: string; active?: string; ok: boolean; error?: string };
}

/** Desktop-only requests the engine answers itself (before falling back to handleMessage). */
export type EngineDesktopMessage =
  | { type: 'desktop:set-settings'; partial: Record<string, unknown> }
  | { type: 'desktop:stats' };

export interface DesktopStats {
  count: number;
  /** items created since local midnight */
  today: number;
  last?: { label: string; at: number };
}

/** What the blip window is told to draw. Never contains copied content. */
export type BlipRender =
  | { op: 'show'; text: string; count: number; position: string; reduceMotion: 'system' | 'on' | 'off' }
  | { op: 'hide' };

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
  /** Engine window only. */
  pushSettings(settings: unknown): void;
  /** Tell main that this window just wrote the clipboard (text or PNG bytes), so the watcher ignores it. */
  markOwnWrite(w: { text?: string; png?: ArrayBuffer }): void;
  getLoginItem(): Promise<boolean>;
  setLoginItem(open: boolean): Promise<void>;
  /** Blip window only. */
  onBlip(cb: (r: BlipRender) => void): void;
  /** Palette window only. */
  paletteChoose(req: PaletteChooseRequest): void;
  paletteClose(): void;
  paletteReady(): void;
  onPaletteShow(cb: () => void): void;
  /** Region window only. */
  onRegionShow(cb: (r: RegionShow) => void): void;
  regionDone(dataUrl: string): void;
  regionCancel(): void;
  getHotkeyStatus(): Promise<HotkeyStatusDto>;
  /** Panel window only. */
  getBridgeInfo(): Promise<BridgeInfoDto | undefined>;
  regenerateBridgeToken(): Promise<BridgeInfoDto | undefined>;
}

declare global {
  interface Window {
    mouDesktop?: DesktopApi;
  }
}
