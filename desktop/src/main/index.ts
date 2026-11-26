import { app, BrowserWindow, ipcMain, Menu, net, protocol, session, shell, Tray, nativeImage, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import trayIcon from '../../../public/icon/32.png?asset';
import { CH, type EngineReply } from '../shared/api';
import { createEngineClient, isSafeExternalUrl, routeMessage } from './router';
import { APP_ORIGIN, APP_SCHEME, createEngineWindow, createPanelWindow, DEV_URL, type PanelHandle } from './windows';

// Tests (and power users) can point the app at a throwaway profile.
const profile = process.env['MOUSTACHE_USER_DATA'];
if (profile) app.setPath('userData', profile);

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

let quitting = false;
let panel: PanelHandle | undefined;
let engineWin: BrowserWindow | undefined;
let tray: Tray | undefined;

const engine = createEngineClient((id, msg) => engineWin?.webContents.send(CH.engineRequest, { id, msg }));

/** Only our own pages may talk to main. */
const trusted = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => {
  try {
    return new URL(e.senderFrame?.url ?? '').origin === APP_ORIGIN;
  } catch {
    return false;
  }
};
const fromEngine = (e: IpcMainEvent): boolean => trusted(e) && e.sender === engineWin?.webContents;

function serveRenderer(): void {
  const root = join(import.meta.dirname, '../renderer');
  protocol.handle(APP_SCHEME, (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname === '/' ? '/panel.html' : url.pathname);
    const file = normalize(join(root, rel));
    if (url.host !== 'app' || !file.startsWith(root + sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

/** Defence in depth next to the CSP: nothing but our own pages (and the dev server) may load. */
function lockSession(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'));
  ses.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    const ok =
      u.startsWith(`${APP_ORIGIN}/`) ||
      u.startsWith('devtools://') ||
      u.startsWith('data:') ||
      u.startsWith('blob:') ||
      (DEV_URL !== undefined && u.startsWith(`ws://${new URL(DEV_URL).host}`));
    cb({ cancel: !ok });
  });
}

function wireIpc(): void {
  ipcMain.handle(CH.send, (e, msg: unknown) => {
    if (!trusted(e)) return undefined;
    return routeMessage(msg, {
      engine,
      broadcast: (m) => {
        for (const w of BrowserWindow.getAllWindows()) {
          if (w.webContents.id !== e.sender.id && !w.isDestroyed()) w.webContents.send(CH.message, m);
        }
      },
    });
  });
  ipcMain.on(CH.engineReady, (e) => {
    if (fromEngine(e)) engine.markReady();
  });
  ipcMain.on(CH.engineReply, (e, reply: EngineReply) => {
    if (fromEngine(e)) engine.settle(reply.id, reply.result);
  });
  ipcMain.handle(CH.openExternal, async (e, url: unknown) => {
    if (trusted(e) && isSafeExternalUrl(url)) await shell.openExternal(url);
  });
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromPath(trayIcon));
  tray.setToolTip('mouStache');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open mouStache', click: () => panel?.show() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  tray.on('click', () => panel?.toggle());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => panel?.show());
  // closing the panel hides it; the app lives in the tray until Quit
  app.on('window-all-closed', () => undefined);
  app.on('before-quit', () => {
    quitting = true;
  });

  void app.whenReady().then(() => {
    serveRenderer();
    lockSession();
    wireIpc();
    engineWin = createEngineWindow();
    engineWin.webContents.on('did-start-loading', () => engine.reset());
    panel = createPanelWindow(() => quitting);
    createTray();
    // dev server / e2e: show right away; a normal launch starts hidden in the tray
    if (DEV_URL || process.env['MOUSTACHE_SHOW_PANEL'] === '1') panel.win.once('ready-to-show', () => panel?.show());
  });
}
