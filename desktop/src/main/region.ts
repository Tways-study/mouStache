import { BrowserWindow, desktopCapturer, nativeImage, screen, type Display } from 'electron';
import { CH, type RegionShow } from '../shared/api';
import { processCapture, type CaptureDeps, type CaptureOutcome } from './capture';
import { createPlainWindow, pageUrl } from './windows';

export interface ScreenGrab {
  png: Buffer;
  /** Where the overlay window must go (the display's bounds, in DIP). */
  bounds: { x: number; y: number; width: number; height: number };
}

/** Takes a picture of the display under the mouse. Replaced by a synthetic image in e2e. */
export type ScreenGrabber = (opts?: { bounds?: ScreenGrab['bounds'] }) => Promise<ScreenGrab>;

/**
 * desktopCapturer thumbnail of the display with the mouse, at native pixel size. macOS asks for the Screen
 * Recording permission the first time (without it the picture is blank).
 */
export const grabDisplay: ScreenGrabber = async () => {
  const display: Display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const sf = display.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(display.bounds.width * sf), height: Math.round(display.bounds.height * sf) },
  });
  const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  if (!src || src.thumbnail.isEmpty()) throw new Error('could not capture the screen');
  return { png: src.thumbnail.toPNG(), bounds: display.bounds };
};

/** Solid-colour stand-in used when MOUSTACHE_E2E=1 so tests never photograph the developer's real screen. */
export const syntheticGrabber: ScreenGrabber = async (opts) => {
  const bounds = opts?.bounds ?? { x: 40, y: 40, width: 400, height: 300 };
  const buf = Buffer.alloc(bounds.width * bounds.height * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = 30; // B
    buf[i + 1] = 120; // G
    buf[i + 2] = 220; // R
    buf[i + 3] = 255;
  }
  return { png: nativeImage.createFromBitmap(buf, { width: bounds.width, height: bounds.height }).toPNG(), bounds };
};

export interface RegionDeps {
  grab: ScreenGrabber;
  /** Where the saved screenshot goes (engine) and how it is reported (blip/tray). */
  capture: CaptureDeps;
  onOutcome(o: CaptureOutcome): void;
  /** e2e: show without taking focus */
  inactive?: boolean;
  /** Called with each overlay window right after it is created (main registers its role). */
  onWindow?(win: BrowserWindow): void;
}

const PNG_PREFIX = 'data:image/png;base64,';

/** Region screenshot: freeze the display, let the user drag a rectangle, crop, save as an image item. */
export function createRegion(d: RegionDeps) {
  let win: BrowserWindow | undefined;
  let active = false;

  const close = () => {
    active = false;
    if (win && !win.isDestroyed()) win.destroy();
    win = undefined;
  };

  async function start(opts?: { bounds?: ScreenGrab['bounds'] }): Promise<boolean> {
    if (active) return false;
    active = true;
    try {
      // grab BEFORE the overlay exists, so the overlay is not in the picture
      const shot = await d.grab(opts);
      win = createPlainWindow({
        show: false,
        ...shot.bounds,
        frame: false,
        transparent: false,
        backgroundColor: '#000000',
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        hasShadow: false,
        enableLargerThanScreen: true,
        title: 'mouStache screenshot',
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      d.onWindow?.(win);
      const w = win;
      await w.loadURL(pageUrl('region'));
      w.webContents.send(CH.regionShow, { dataUrl: PNG_PREFIX + shot.png.toString('base64') } satisfies RegionShow);
      w.setBounds(shot.bounds);
      if (d.inactive) w.showInactive();
      else {
        w.show();
        w.focus();
      }
      return true;
    } catch (e) {
      close();
      d.onOutcome({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }

  async function done(dataUrl: unknown): Promise<void> {
    close();
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_PREFIX) || dataUrl.length > 80_000_000) return;
    const png = Buffer.from(dataUrl.slice(PNG_PREFIX.length), 'base64');
    // a screenshot the user asked for: no app lookup, never skipped as a "paused app"
    const outcome = await processCapture({ kind: 'image', png }, { ...d.capture, foregroundApp: async () => undefined }, 'screenshot');
    d.onOutcome(outcome);
  }

  return {
    start,
    done,
    cancel: close,
    get window() {
      return win;
    },
    get active() {
      return active;
    },
  };
}

export type RegionController = ReturnType<typeof createRegion>;
