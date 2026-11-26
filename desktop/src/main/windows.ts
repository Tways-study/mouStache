import { BrowserWindow, shell, type BrowserWindowConstructorOptions } from 'electron';
import { join } from 'node:path';
import icon from '../../../public/icon/128.png?asset';
import { isSafeExternalUrl } from './router';

/** Renderer origin: the dev server while developing, the privileged `moustache://app` scheme otherwise. */
export const APP_SCHEME = 'moustache';
export const DEV_URL = process.env['ELECTRON_RENDERER_URL'];
/** `URL.origin` is "null" for custom schemes, so compare protocol + host ourselves. */
export const originOf = (url: string): string => {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
};
export const APP_ORIGIN = DEV_URL ? originOf(DEV_URL) : `${APP_SCHEME}://app`;

export const pageUrl = (name: 'engine' | 'panel' | 'blip' | 'palette' | 'region') => (DEV_URL ? `${DEV_URL}/${name}.html` : `${APP_ORIGIN}/${name}.html`);

const preload = join(import.meta.dirname, '../preload/index.cjs');

const secureWebPreferences: BrowserWindowConstructorOptions['webPreferences'] = {
  preload,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  spellcheck: false,
};

/** No popups, no navigation away from our own pages; web links open in the default browser. */
function lockDown(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (originOf(url) !== APP_ORIGIN) e.preventDefault();
  });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
}

/** A hardened BrowserWindow (same web preferences, popups and navigation locked) for small helper windows. */
export function createPlainWindow(opts: BrowserWindowConstructorOptions): BrowserWindow {
  const win = new BrowserWindow({ ...opts, webPreferences: { ...secureWebPreferences, backgroundThrottling: false } });
  lockDown(win);
  return win;
}

/** Hidden window that owns IndexedDB and answers messages with handleMessage(). Never throttled. */
export function createEngineWindow(): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: 400,
    height: 300,
    skipTaskbar: true,
    webPreferences: { ...secureWebPreferences, backgroundThrottling: false },
  });
  lockDown(win);
  void win.loadURL(pageUrl('engine'));
  return win;
}

export interface PanelHandle {
  win: BrowserWindow;
  show(): void;
  toggle(): void;
}

/** The main UI. Closing hides it; the app keeps running from the tray. */
export function createPanelWindow(isQuitting: () => boolean): PanelHandle {
  const win = new BrowserWindow({
    width: 460,
    height: 780,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: 'mouStache',
    icon,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: { ...secureWebPreferences, backgroundThrottling: false },
  });
  win.removeMenu();
  lockDown(win);
  win.on('close', (e) => {
    if (isQuitting()) return;
    e.preventDefault();
    win.hide();
  });
  win.webContents.on('page-title-updated', (e) => e.preventDefault()); // keep "mouStache"
  void win.loadURL(pageUrl('panel'));

  const show = () => {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };
  return { win, show, toggle: () => (win.isVisible() && win.isFocused() ? win.hide() : show()) };
}
