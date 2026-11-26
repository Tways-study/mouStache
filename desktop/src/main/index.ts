import { app, BrowserWindow, globalShortcut, ipcMain, nativeImage, protocol, session, shell, systemPreferences, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { CH, type DesktopStats, type EngineReply } from '../shared/api';
import { createBlip, type BlipController } from './blip';
import type { CaptureOutcome } from './capture';
import { createBridge, type BridgeController } from './bridge';
import { createRecentIds, wantsFeedback } from './feedback';
import { createFakeClipboard } from './fake-clipboard';
import { createHotkeys, type Hotkeys } from './hotkeys';
import { createPalette, type PaletteController } from './palette';
import { createPasteExecutor, createRecordingPasteExecutor, type PasteRecord } from './paste';
import { createRegion, grabDisplay, syntheticGrabber, type RegionController } from './region';
import { createShortcutStub } from './shortcut-stub';
import { createForegroundDetector, withOverride } from './foreground';
import { createPresenceStore } from './presence-settings';
import { createEngineClient, isSafeExternalUrl, messageType, routeMessage } from './router';
import { createTray, type TrayController } from './tray';
import { createWatcher, imageKey, type WatcherController } from './watcher';
import { createOwnWriteGuard, normalizeText, textKey } from './watcher-core';
import { APP_ORIGIN, APP_SCHEME, createEngineWindow, createPanelWindow, DEV_URL, originOf, type PanelHandle } from './windows';

// Tests (and power users) can point the app at a throwaway profile.
const profile = process.env['MOUSTACHE_USER_DATA'];
if (profile) app.setPath('userData', profile);
const E2E = process.env['MOUSTACHE_E2E'] === '1';

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
const foreground = withOverride(createForegroundDetector());
const detector = foreground.detector;
/** In e2e nothing is ever typed into another window: paste commands are built and recorded, not sent. */
const pasteLog: PasteRecord[] = [];
const notifications: string[] = [];
const pasteExecutor = E2E ? createRecordingPasteExecutor(pasteLog) : createPasteExecutor();
/** Diagnostics for e2e (only exposed when MOUSTACHE_E2E=1): every non-trivial tick result and capture outcome, in order. */
const tickLog: string[] = [];
const outcomeLog: string[] = [];

/** Only our own pages may talk to main. */
const trusted = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => {
  try {
    return originOf(e.senderFrame?.url ?? '') === APP_ORIGIN;
  } catch {
    return false;
  }
};
const fromEngine = (e: IpcMainEvent): boolean => trusted(e) && e.sender === engineWin?.webContents;

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
  if (E2E) outcomeLog.push(o.status === 'skipped' ? `skipped:${o.reason}` : o.status === 'saved' ? `saved:${o.kind}` : 'error');
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
  if (E2E) outcomeLog.push(o.status === 'skipped' ? `bridge-skipped:${o.reason}` : o.status === 'saved' ? `bridge-saved:${o.deduped ? 'dup' : 'new'}` : 'bridge-error');
  if (o.status === 'saved') giveFeedback(o, 'bridge');
}

function firstRunHint(): void {
  if (process.env['MOUSTACHE_NO_FIRST_RUN'] === '1') return;
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

function wireIpc(): void {
  ipcMain.handle(CH.send, (e, msg: unknown) => {
    if (!trusted(e)) return undefined;
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
  ipcMain.on(CH.engineReady, (e) => {
    if (fromEngine(e)) {
      engine.markReady();
      refreshStats();
    }
  });
  ipcMain.on(CH.engineReply, (e, reply: EngineReply) => {
    if (fromEngine(e)) engine.settle(reply.id, reply.result);
  });
  ipcMain.on(CH.settings, (e, s: unknown) => {
    if (fromEngine(e)) presence.update(s);
  });
  ipcMain.on(CH.ownWrite, (e, w: { text?: unknown; png?: unknown }) => {
    if (!trusted(e) || typeof w !== 'object' || w === null) return;
    if (typeof w.text === 'string') guard.mark(textKey(normalizeText(w.text)));
    else if ((w.png instanceof ArrayBuffer || ArrayBuffer.isView(w.png)) && w.png.byteLength < 50_000_000) {
      const bytes = w.png instanceof ArrayBuffer ? Buffer.from(w.png) : Buffer.from(w.png.buffer, w.png.byteOffset, w.png.byteLength);
      const img = nativeImage.createFromBuffer(bytes);
      if (!img.isEmpty()) guard.mark(imageKey(img));
    }
  });
  ipcMain.handle(CH.openExternal, async (e, url: unknown) => {
    if (trusted(e) && isSafeExternalUrl(url)) await shell.openExternal(url);
  });
  // palette / region windows: accepted only from the window they belong to
  const fromWindow = (e: IpcMainEvent, win: BrowserWindow | undefined) => trusted(e) && !!win && !win.isDestroyed() && e.sender === win.webContents;
  ipcMain.on(CH.paletteChoose, (e, req: { id?: unknown; mode?: unknown; fence?: unknown }) => {
    if (!fromWindow(e, palette?.win) || typeof req !== 'object' || req === null) return;
    if (typeof req.id !== 'string' || req.id.length > 100) return;
    if (req.mode !== 'paste' && req.mode !== 'copy' && req.mode !== 'code') return;
    void palette?.choose({ id: req.id, mode: req.mode, fence: typeof req.fence === 'string' ? req.fence : undefined });
  });
  ipcMain.on(CH.paletteReady, (e) => {
    if (fromWindow(e, palette?.win)) palette?.ready();
  });
  ipcMain.on(CH.paletteClose, (e) => {
    if (fromWindow(e, palette?.win)) palette?.hide();
  });
  ipcMain.on(CH.regionDone, (e, dataUrl: unknown) => {
    if (fromWindow(e, region?.window)) void region?.done(dataUrl);
  });
  ipcMain.on(CH.regionCancel, (e) => {
    if (fromWindow(e, region?.window)) region?.cancel();
  });
  ipcMain.handle(CH.hotkeyStatus, (e) => (trusted(e) ? hotkeys?.status() : undefined));
  // the pairing token: only the panel window (where Settings lives) may ever ask for it
  const fromPanel = (e: IpcMainInvokeEvent) => trusted(e) && !!panel && !panel.win.isDestroyed() && e.sender === panel.win.webContents;
  ipcMain.handle(CH.bridgeInfo, (e) => (fromPanel(e) ? bridge?.info() : undefined));
  ipcMain.handle(CH.bridgeRegenerate, (e) => (fromPanel(e) ? bridge?.regenerate() : undefined));
  ipcMain.handle(CH.getLogin, (e) => trusted(e) && app.getLoginItemSettings().openAtLogin);
  ipcMain.handle(CH.setLogin, (e, open: unknown) => {
    if (trusted(e) && typeof open === 'boolean') app.setLoginItemSettings({ openAtLogin: open, args: ['--hidden'] });
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
    serveRenderer();
    lockSession();
    wireIpc();
    engineWin = createEngineWindow();
    engineWin.webContents.on('did-start-loading', () => engine.reset());
    panel = createPanelWindow(() => quitting);

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
      exposeForTests: E2E,
    });
    // e2e can swap the machine-wide OS clipboard for an in-memory one (see fake-clipboard.ts)
    const fakeClipboard = E2E && process.env['MOUSTACHE_FAKE_CLIPBOARD'] === '1' ? createFakeClipboard() : undefined;
    watcher = createWatcher({ engine, presence, detector, onOutcome, guard, reader: fakeClipboard?.reader, onTick: (r) => void (E2E && tickLog.push(r)) });

    // quick palette: remembers the app you came from, pastes into it on Enter
    const accessibilityFlag = join(app.getPath('userData'), 'accessibility-prompted.json');
    palette = createPalette({
      engine,
      detector,
      executor: pasteExecutor,
      guard,
      notify: (text) => {
        if (E2E) notifications.push(text);
        blip?.announce(text, 1800, true);
      },
      clipboardOut: fakeClipboard && { writeText: (t) => fakeClipboard.writeText(t), writePng: (p) => fakeClipboard.writePng(p) },
      accessibility:
        process.platform === 'darwin'
          ? {
              isTrusted: (prompt) => systemPreferences.isTrustedAccessibilityClient(prompt),
              wasPrompted: () => existsSync(accessibilityFlag),
              markPrompted: () => writeFileSync(accessibilityFlag, JSON.stringify({ at: Date.now() })),
            }
          : undefined,
    });
    // region screenshot: freeze the display, drag, crop, save as an image item
    region = createRegion({
      grab: E2E ? syntheticGrabber : grabDisplay,
      inactive: E2E,
      onOutcome,
      capture: { foregroundApp: async () => undefined, pausedApps: () => [], save: (msg) => engine.request(msg) as never },
    });
    // global shortcuts (a recording stub in e2e: tests never grab real system-wide keys)
    const shortcutStub = E2E ? createShortcutStub() : undefined;
    hotkeys = createHotkeys(shortcutStub?.stub ?? globalShortcut, {
      palette: () => void palette?.open(),
      screenshot: () => void region?.start(),
    });

    // extension bridge: 127.0.0.1 only, token in userData; e2e may ask for a random free port
    const portEnv = process.env['MOUSTACHE_BRIDGE_PORT'];
    bridge = createBridge({
      userData: app.getPath('userData'),
      version: app.getVersion(),
      engine,
      presence,
      onOutcome: onBridgeOutcome,
      portOverride: E2E && portEnv !== undefined ? Number(portEnv) : undefined,
    });

    presence.onChange((s, first) => {
      if (first || (s.bridgePort !== bridge?.preferred && !(E2E && portEnv !== undefined))) void bridge?.start(s.bridgePort);
      hotkeys?.apply({ palette: s.hotkeyPalette, screenshot: s.hotkeyScreenshot });
      tray?.setPaused(!s.autoCapture);
      tray?.setShowCount(s.menuBarCount && process.platform === 'darwin');
      if (first) {
        watcher?.start(); // only once the engine has told us the real settings
        if (E2E) (globalThis as Record<string, unknown>)['__mouReady'] = true;
        firstRunHint();
      }
    });

    if (E2E) {
      (globalThis as Record<string, unknown>)['__mouTray'] = () => tray?.inspect();
      const g = globalThis as Record<string, unknown>;
      g['__mouPending'] = () => watcher?.pending() ?? 0;
      g['__mouTicks'] = () => [...tickLog];
      g['__mouOutcomes'] = () => [...outcomeLog];
      g['__mouPresence'] = () => presence.get();
      g['__mouForeground'] = foreground.set;
      g['__mouFake'] = fakeClipboard;
      g['__mouGS'] = shortcutStub;
      g['__mouBridge'] = { port: () => bridge?.port };
      g['__mouHotkeyStatus'] = () => hotkeys?.status();
      g['__mouPalette'] = {
        open: () => palette?.open(),
        window: palette?.win,
        flags: palette?.flags,
        pasteLog,
        notifications,
        last: () => palette?.lastTarget,
      };
      g['__mouRegion'] = {
        start: (bounds?: { x: number; y: number; width: number; height: number }) => region?.start(bounds ? { bounds } : undefined),
        window: () => region?.window,
      };
    }

    // dev server / e2e: show right away; a normal launch starts hidden in the tray
    if (DEV_URL || process.env['MOUSTACHE_SHOW_PANEL'] === '1') panel.win.once('ready-to-show', () => panel?.show());
  });
}
