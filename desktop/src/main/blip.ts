import { BrowserWindow, screen } from 'electron';
import type { BlipRender } from '../shared/api';
import { CH } from '../shared/api';
import { blipBounds, createBlipScheduler, type BlipCommand } from './blip-scheduler';
import type { PresenceSettings } from './presence-settings';
import { createPlainWindow, pageUrl } from './windows';

const SIZE = { width: 380, height: 44 };

/**
 * The on-screen "Saved · SQL" pill. The window never takes focus (focusable:false + showInactive), is
 * click-through, hidden from the taskbar / Alt+Tab, and only ever receives a type label.
 */
export function createBlip(o: { getSettings(): PresenceSettings; isSuppressed(): boolean; exposeForTests?: boolean }) {
  const win: BrowserWindow = createPlainWindow({
    show: false,
    ...SIZE,
    frame: false,
    transparent: true,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    title: 'mouStache blip',
    // toolbar windows are left out of Alt+Tab on Windows; `panel` is the non-activating NSPanel on macOS
    type: process.platform === 'win32' ? 'toolbar' : process.platform === 'darwin' ? 'panel' : undefined,
  });
  win.setIgnoreMouseEvents(true, { forward: false });
  win.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  void win.loadURL(pageUrl('blip'));

  let loaded = false;
  const queue: BlipRender[] = [];
  win.webContents.once('did-finish-load', () => {
    loaded = true;
    for (const r of queue.splice(0)) win.webContents.send(CH.blip, r);
  });
  const send = (r: BlipRender) => (loaded ? win.webContents.send(CH.blip, r) : void queue.push(r));

  function place() {
    const cursor = screen.getCursorScreenPoint();
    const wa = screen.getDisplayNearestPoint(cursor).workArea;
    win.setBounds(blipBounds(o.getSettings().blipPosition, wa, SIZE));
  }

  const scheduler = createBlipScheduler({
    getConfig: () => ({ mode: o.getSettings().blipMode, duration: o.getSettings().blipDuration }),
    isSuppressed: o.isSuppressed,
    emit(cmd: BlipCommand) {
      const s = o.getSettings();
      if (cmd.op === 'show' || cmd.op === 'update') {
        if (cmd.op === 'show') {
          place();
          const t = (globalThis as unknown as Record<string, { shows?: number } | undefined>)['__mouBlip'];
          if (t) t.shows = (t.shows ?? 0) + 1;
        }
        send({
          op: 'show',
          text: cmd.payload.text,
          count: cmd.payload.count,
          position: s.blipPosition,
          reduceMotion: s.reduceMotion,
        });
        if (cmd.op === 'show' && !win.isVisible()) win.showInactive();
      } else if (cmd.op === 'hide') send({ op: 'hide' });
      else win.hide();
    },
  });

  if (o.exposeForTests) {
    (globalThis as Record<string, unknown>)['__mouBlip'] = {
      window: win,
      flags: { ignoreMouseEvents: true, focusable: win.isFocusable() },
      idle: () => scheduler.idle,
      shows: 0, // how many pills have been shown (tests assert a skipped copy never adds one)
      notifies: 0, // how many captures asked for feedback at all (a coalesced update is not a new pill)
    };
  }

  return {
    win,
    notify: (e: Parameters<typeof scheduler.notify>[0]) => {
      const t = (globalThis as unknown as Record<string, { notifies?: number } | undefined>)['__mouBlip'];
      if (t && o.exposeForTests) t.notifies = (t.notifies ?? 0) + 1;
      return scheduler.notify(e);
    },
    announce: scheduler.announce,
    get idle() {
      return scheduler.idle;
    },
    dispose() {
      scheduler.dispose();
      if (!win.isDestroyed()) win.destroy();
    },
  };
}

export type BlipController = ReturnType<typeof createBlip>;
