import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, protocol, session, systemPreferences, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { CH, type DesktopStats, type EngineReply } from '../shared/api';
import { createBlip, type BlipController } from './blip';
import { createBridge, type BridgeController } from './bridge';
import type { CaptureOutcome } from './capture';
import { createClipboardOut, electronClipboardPrimitives } from './clipboard-out';
import { createRecentIds, wantsFeedback } from './feedback';
import { createForegroundDetector } from './foreground';
import { createHotkeys, type Hotkeys } from './hotkeys';
import { isSafeImage } from './image-guard';
import { isAllowed, mayRoute, type RendererChannel, type WindowRole } from './ipc-policy';
import { createPalette, type PaletteController } from './palette';
import { createPasteExecutor } from './paste';
import { createPresenceStore } from './presence-settings';
import { createRegion, grabDisplay, type RegionController } from './region';
import { createEngineClient, messageType, routeMessage } from './router';
import { createTestSeams, type TestSeams } from './testing';
import { createTray, type TrayController } from './tray';
import { createWatcher, imageKey, type WatcherController } from './watcher';
import { createOwnWriteGuard, normalizeText, textKey } from './watcher-core';
import { APP_ORIGIN, APP_SCHEME, createEngineWindow, createPanelWindow, DEV_URL, openExternalLimited, originOf, type PanelHandle } from './windows';

// The app is "mouStache" everywhere (window titles, the userData folder, the login item). Must run before userData is used.
app.setName('mouStache');

/**
 * Developer/test environment switches (throwaway profile, show the panel, skip the first-run pill) are honoured only
 * in unpackaged runs and in test builds. A released, packaged app ignores them (security review F2).
 */
const devEnvAllowed = !app.isPackaged || __MOU_TEST_BUILD__;
const devEnv = (name: string): string | undefined => (devEnvAllowed ? process.env[name] : undefined);

const profile = devEnv('MOUSTACHE_USER_DATA');
if (profile) app.setPath('userData', profile);

/**
 * Test seams (fake clipboard, recorded paste, stubbed shortcuts, __mou* hooks). `__MOU_TEST_BUILD__` is the literal
 * false in release builds, so this expression and everything behind it is removed from the bundle.
 */
const seams: TestSeams | undefined = __MOU_TEST_BUILD__ ? createTestSeams(process.env) : undefined;

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

let quitting = false;
let panel: PanelHandle | undefined;
let engineWin: BrowserWindow | undefined;
let tray: TrayController | undefined;
let blip: BlipController | undefined;
let watcher: WatcherController | undefined;
let palette: PaletteController | undefined;
let region: RegionController | undefined;
let hotkeys: Hotkeys | undefined;
let bridge: BridgeController | undefined;
const recentIds = createRecentIds();

const engine = createEngineClient((id, msg) => engineWin?.webContents.send(CH.engineRequest, { id, msg }));
const presence = createPresenceStore();
const guard = createOwnWriteGuard();
const realDetector = createForegroundDetector();
const detector = seams ? seams.detector(realDetector) : realDetector;
const pasteExecutor = seams?.pasteExecutor ?? createPasteExecutor();
/** Every clipboard write main makes: secrets get the do-not-record formats and are wiped after ~30 s. */
const clipboardOut = createClipboardOut(seams?.clipboardPrimitives ?? electronClipboardPrimitives(), seams?.secretClearMs);

// ---------------------------------------------------------------- who is calling

/** webContents id -> the role of the window it belongs to (see ipc-policy.ts). */
const roles = new Map<number, WindowRole>();
const register = (win: BrowserWindow | undefined, role: WindowRole): void => {
  if (!win || win.isDestroyed()) return;
  const id = win.webContents.id;
  roles.set(id, role);
  win.once('closed', () => roles.delete(id));
};

/** Only our own pages may talk to main. */
const trusted = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => {
  try {
    return originOf(e.senderFrame?.url ?? '') === APP_ORIGIN;
  } catch {
    return false;
  }
};
/** Our own page AND a window role that is allowed to use this channel (least privilege). */
const allowed = (e: IpcMainEvent | IpcMainInvokeEvent, channel: RendererChannel): boolean =>
  trusted(e) && isAllowed(channel, roles.get(e.sender.id));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function serveRenderer(): void {
  const root = join(import.meta.dirname, '../renderer');
  protocol.handle(APP_SCHEME, async (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname === '/' ? '/panel.html' : url.pathname);
    const file = normalize(join(root, rel));
    if (url.host !== 'app' || !file.startsWith(root + sep)) return new Response('Not found', { status: 404 });
    try {
      const body = await readFile(file);
      return new Response(new Uint8Array(body), { headers: { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
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

/** No menu bar in a released app (so no View > Toggle Developer Tools, no reload accelerators). macOS keeps Edit so Cmd+C/V work. */
function lockMenu(): void {
  if (!app.isPackaged) return;
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'editMenu' }]) : null);
}

// ---------------------------------------------------------------- stats / tray

let statsTimer: ReturnType<typeof setTimeout> | undefined;
/** Ask the engine for the item count + last capture (debounced; also drives the tooltip). */
function refreshStats(): void {
  if (statsTimer) return;
  statsTimer = setTimeout(async () => {
    statsTimer = undefined;
    const s = (await engine.request({ type: 'desktop:stats' })) as DesktopStats | undefined;
    if (s && typeof s.count === 'number') tray?.setStats(s);
  }, 250);
}

let engineErrors = 0;
function onOutcome(o: CaptureOutcome): void {
  seams?.onOutcome(o);
  if (o.status === 'error') {
    if (++engineErrors >= 3) tray?.setAttention(true); // the "needs attention" dot
    return;
  }
  engineErrors = 0;
  tray?.setAttention(false);
  // Skipped copies (secrets, paused apps, concealed, own app) produce NO feedback at all.
  if (o.status !== 'saved') return;
  giveFeedback(o, 'watcher');
}

/** Tray curl + blip for a saved item, unless it is the same browser copy we were already told about. */
function giveFeedback(o: Extract<CaptureOutcome, { status: 'saved' }>, source: 'watcher' | 'bridge'): void {
  refreshStats();
  if (!wantsFeedback(source, { id: o.id, deduped: o.deduped }, recentIds)) return;
  if (presence.get().blipMode !== 'off') tray?.flash();
  blip?.notify({ label: o.label, deduped: o.deduped });
}

/** A capture that arrived over the extension bridge. Skipped ones (secret, paused) show nothing at all. */
function onBridgeOutcome(o: CaptureOutcome): void {
  seams?.onBridgeOutcome(o);
  if (o.status === 'saved') giveFeedback(o, 'bridge');
}

function firstRunHint(): void {
  if (devEnv('MOUSTACHE_NO_FIRST_RUN') === '1') return;
  const flag = join(app.getPath('userData'), 'first-run.json');
  if (existsSync(flag)) return;
  const text =
    process.platform === 'darwin'
      ? 'mouStache lives in your menu bar.'
      : 'mouStache lives in your tray. Pin it so it stays visible.';
  if (blip?.announce(text)) {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(flag, JSON.stringify({ shownAt: Date.now() }));
  }
}

// ---------------------------------------------------------------- ipc

/** ipcMain.on that silently ignores senders whose window role may not use the channel. */
function onIpc<A extends unknown[]>(channel: RendererChannel, fn: (e: IpcMainEvent, ...args: A) => void): void {
  ipcMain.on(channel, (e, ...args) => {
    if (allowed(e, channel)) fn(e, ...(args as A));
  });
}
/** ipcMain.handle that answers `denied` to senders whose window role may not use the channel. */
function handleIpc<A extends unknown[], R, D = undefined>(channel: RendererChannel, fn: (e: IpcMainInvokeEvent, ...args: A) => R, denied?: D): void {
  ipcMain.handle(channel, (e, ...args) => (allowed(e, channel) ? fn(e, ...(args as A)) : denied));
}

function wireIpc(): void {
  handleIpc(CH.send, (e, msg: unknown) => {
    // the engine may only broadcast, the palette may only search/copy; the panel talks to everything
    if (!mayRoute(roles.get(e.sender.id), messageType(msg))) return undefined;
    return routeMessage(msg, {
      engine,
      broadcast: (m) => {
        for (const w of BrowserWindow.getAllWindows()) {
          if (w.webContents.id !== e.sender.id && !w.isDestroyed()) w.webContents.send(CH.message, m);
        }
        if (messageType(m) === 'items-changed') refreshStats();
      },
    });
  });
  onIpc(CH.engineReady, () => {
    engine.markReady();
    refreshStats();
  });
  onIpc(CH.engineReply, (_e, reply: EngineReply) => engine.settle(reply.id, reply.result));
  onIpc(CH.settings, (_e, s: unknown) => presence.update(s));

  onIpc(CH.ownWrite, (_e, w: { text?: unknown; png?: unknown }) => {
    if (typeof w !== 'object' || w === null) return;
    if (typeof w.text === 'string') guard.mark(textKey(normalizeText(w.text)));
    else if ((w.png instanceof ArrayBuffer || ArrayBuffer.isView(w.png)) && w.png.byteLength < 50_000_000) {
      const bytes = w.png instanceof ArrayBuffer ? Buffer.from(w.png) : Buffer.from(w.png.buffer, w.png.byteOffset, w.png.byteLength);
      if (!isSafeImage(bytes)) return; // a header claiming an absurd size never reaches the decoder
      const img = nativeImage.createFromBuffer(bytes);
      if (!img.isEmpty()) guard.mark(imageKey(img));
    }
  });
  // the panel copied a SECRET item: write it with the do-not-record formats and wipe it after ~30 s
  handleIpc(
    CH.writeSecret,
    async (_e, text: unknown) => {
      if (typeof text !== 'string' || text.length === 0 || text.length > 1_000_000) return false;
      guard.mark(textKey(normalizeText(text)));
      await clipboardOut.writeSecretText(text);
      return true;
    },
    false,
  );
  handleIpc(CH.openExternal, (_e, url: unknown) => void openExternalLimited(url));

  // palette / screenshot overlay: their own channels only (ipc-policy.ts)
  onIpc(CH.paletteChoose, (_e, req: { id?: unknown; mode?: unknown; fence?: unknown }) => {
    if (typeof req !== 'object' || req === null) return;
    if (typeof req.id !== 'string' || req.id.length > 100) return;
    if (req.mode !== 'paste' && req.mode !== 'copy' && req.mode !== 'code') return;
    void palette?.choose({ id: req.id, mode: req.mode, fence: typeof req.fence === 'string' ? req.fence : undefined });
  });
  onIpc(CH.paletteReady, () => palette?.ready());
  onIpc(CH.paletteClose, () => palette?.hide());
  onIpc(CH.regionDone, (_e, dataUrl: unknown) => void region?.done(dataUrl));
  onIpc(CH.regionCancel, () => region?.cancel());

  // panel-only: Settings
  handleIpc(CH.hotkeyStatus, () => hotkeys?.status());
  handleIpc(CH.bridgeInfo, () => bridge?.info()); // the pairing token: only the panel's Settings ever receives it
  handleIpc(CH.bridgeRegenerate, () => bridge?.regenerate());
  handleIpc(CH.getLogin, () => app.getLoginItemSettings().openAtLogin, false);
  handleIpc(CH.setLogin, (_e, open: unknown) => {
    if (typeof open === 'boolean') app.setLoginItemSettings({ openAtLogin: open, args: ['--hidden'] });
  });
}

// ---------------------------------------------------------------- start

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => panel?.show());
  // closing the panel hides it; the app lives in the tray until Quit
  app.on('window-all-closed', () => undefined);
  app.on('before-quit', () => {
    quitting = true;
    watcher?.stop();
    hotkeys?.unregisterAll();
    void bridge?.stop();
    pasteExecutor.dispose();
    detector.dispose();
  });

  void app.whenReady().then(() => {
    lockMenu();
    serveRenderer();
    lockSession();
    wireIpc();
    engineWin = createEngineWindow();
    engineWin.webContents.on('did-start-loading', () => engine.reset());
    panel = createPanelWindow(() => quitting);
    register(engineWin, 'engine');
    register(panel.win, 'panel');

    const setPause = (pause: boolean) =>
      void engine.request({ type: 'desktop:set-settings', partial: { autoCapture: !pause } });
    tray = createTray({
      onOpen: () => panel?.show(),
      onToggle: () => panel?.toggle(),
      onSettings: () => {
        panel?.show();
        panel?.win.webContents.send(CH.message, { type: 'open-settings' });
      },
      onTogglePause: () => setPause(presence.get().autoCapture),
      onQuit: () => app.quit(),
      onPalette: () => void palette?.open(),
      onScreenshot: () => void region?.start(),
    });
    blip = createBlip({
      getSettings: presence.get,
      isSuppressed: () => !!panel && panel.win.isVisible() && panel.win.isFocused(),
    });
    register(blip.win, 'blip');
    watcher = createWatcher({
      engine,
      presence,
      detector,
      onOutcome,
      guard,
      reader: seams?.clipboard?.reader,
      onTick: (r) => seams?.onTick(r),
      onPoll: (r) => seams?.onPoll(r),
    });

    // quick palette: remembers the app you came from, pastes into it on Enter
    const accessibilityFlag = join(app.getPath('userData'), 'accessibility-prompted.json');
    palette = createPalette({
      engine,
      detector,
      executor: pasteExecutor,
      guard,
      clipboardOut,
      notify: (text) => {
        seams?.onNotify(text);
        blip?.announce(text, 1800, true);
      },
      accessibility:
        process.platform === 'darwin'
          ? {
              isTrusted: (prompt) => systemPreferences.isTrustedAccessibilityClient(prompt),
              wasPrompted: () => existsSync(accessibilityFlag),
              markPrompted: () => writeFileSync(accessibilityFlag, JSON.stringify({ at: Date.now() })),
            }
          : undefined,
    });
    register(palette.win, 'palette');
    // region screenshot: freeze the display, drag, crop, save as an image item
    region = createRegion({
      grab: seams?.grabber ?? grabDisplay,
      inactive: !!seams,
      onOutcome,
      onWindow: (w) => register(w, 'region'),
      capture: { foregroundApp: async () => undefined, pausedApps: () => [], save: (msg) => engine.request(msg) as never },
    });
    // global shortcuts (a recording stub in test builds: tests never grab real system-wide keys)
    hotkeys = createHotkeys(seams?.shortcut.stub ?? globalShortcut, {
      palette: () => void palette?.open(),
      screenshot: () => void region?.start(),
    });

    // extension bridge: 127.0.0.1 only, token in userData
    bridge = createBridge({
      userData: app.getPath('userData'),
      version: app.getVersion(),
      engine,
      presence,
      onOutcome: onBridgeOutcome,
      portOverride: seams?.portOverride,
    });

    presence.onChange((s, first) => {
      if (first || (s.bridgePort !== bridge?.preferred && seams?.portOverride === undefined)) void bridge?.start(s.bridgePort);
      hotkeys?.apply({ palette: s.hotkeyPalette, screenshot: s.hotkeyScreenshot });
      tray?.setPaused(!s.autoCapture);
      tray?.setShowCount(s.menuBarCount && process.platform === 'darwin');
      if (first) {
        watcher?.start(); // only once the engine has told us the real settings
        seams?.markReady();
        firstRunHint();
      }
    });

    seams?.install({ tray, blip, watcher, presence, bridge, hotkeys, palette, region });

    // dev server / test builds: show right away; a normal launch starts hidden in the tray
    if (DEV_URL || devEnv('MOUSTACHE_SHOW_PANEL') === '1') panel.win.once('ready-to-show', () => panel?.show());
  });
}
