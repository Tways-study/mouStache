import { BrowserWindow, clipboard, ClipboardItem, nativeImage, screen } from 'electron';
import { CH } from '../shared/api';
import type { ForegroundDetector } from './foreground';
import { choose, type ChooseOutcome, type ChooseRequest, type Content } from './paste-flow';
import type { PasteExecutor, PasteTarget } from './paste';
import { imageKey } from './watcher';
import { normalizeText, textKey, type OwnWriteGuard } from './watcher-core';
import { createPlainWindow, pageUrl } from './windows';

export const PALETTE_SIZE = { width: 640, height: 440 };
/** If the foreground lookup is not instant, open anyway: the palette must feel immediate. */
const TARGET_LOOKUP_MS = 150;
/** Show anyway if the renderer never acknowledges (it is still better than no palette). */
const READY_TIMEOUT_MS = 400;

export interface PaletteDeps {
  engine: { request(msg: unknown): Promise<unknown> };
  detector: ForegroundDetector;
  executor: PasteExecutor;
  guard: OwnWriteGuard;
  /** Short, content-free feedback ("Copied", "Copied, press Ctrl+V"). */
  notify(text: string): void;
  /** Replaces the OS clipboard in e2e (fake clipboard mode). */
  clipboardOut?: { writeText(t: string): void; writePng(png: Buffer): void };
  accessibility?: Parameters<typeof choose>[1]['accessibility'];
  platform?: NodeJS.Platform;
}

/** copy-item response -> clipboard content */
export function contentFromCopyItem(res: unknown): Content | undefined {
  const r = res as { ok?: boolean; kind?: string; text?: string; dataUrl?: string } | undefined;
  if (!r?.ok) return undefined;
  if (r.kind === 'image' && typeof r.dataUrl === 'string') {
    const m = /^data:image\/[a-z+.-]+;base64,(.*)$/i.exec(r.dataUrl);
    if (!m) return undefined;
    const png = nativeImage.createFromBuffer(Buffer.from(m[1]!, 'base64')).toPNG(); // always hand the clipboard a PNG
    return png.length ? { kind: 'image', png } : undefined;
  }
  return typeof r.text === 'string' ? { kind: 'text', text: r.text } : undefined;
}

/** The quick palette: a warm, hidden window that appears on the hotkey and pastes into the app you came from. */
export function createPalette(d: PaletteDeps) {
  const platform = d.platform ?? process.platform;
  const win: BrowserWindow = createPlainWindow({
    show: false,
    ...PALETTE_SIZE,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    title: 'mouStache palette',
    // toolbar windows stay out of Alt+Tab on Windows; `panel` is the NSPanel type on macOS
    type: platform === 'win32' ? 'toolbar' : platform === 'darwin' ? 'panel' : undefined,
  });
  win.setAlwaysOnTop(true, 'pop-up-menu');
  if (platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  void win.loadURL(pageUrl('palette'));

  let target: PasteTarget | undefined;
  let canPaste = true;
  let opening = false;
  let choosing = false;
  let onReady: (() => void) | undefined;

  const hide = () => {
    if (!win.isDestroyed() && win.isVisible()) win.hide();
  };

  // click away / alt-tab away closes it (not while we are mid-choice: the choice hides it itself)
  win.on('blur', () => {
    if (!choosing) hide();
  });

  async function writeClipboard(c: Content): Promise<void> {
    // mark BEFORE writing so the watcher can never see the write as a new copy
    if (c.kind === 'text') {
      d.guard.mark(textKey(normalizeText(c.text)));
      if (d.clipboardOut) d.clipboardOut.writeText(c.text);
      else await clipboard.writeText(c.text);
    } else {
      const img = nativeImage.createFromBuffer(c.png);
      d.guard.mark(imageKey(img));
      if (d.clipboardOut) d.clipboardOut.writePng(c.png);
      else await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(c.png)], { type: 'image/png' }) })]);
    }
  }

  async function open(): Promise<void> {
    if (opening) return;
    if (win.isVisible()) {
      hide();
      return;
    }
    opening = true;
    try {
      // remember who was in front BEFORE we take focus
      const app = await Promise.race([
        d.detector.query().catch(() => undefined),
        new Promise<undefined>((r) => setTimeout(() => r(undefined), TARGET_LOOKUP_MS)),
      ]);
      canPaste = !(app && app.pid === process.pid);
      target = canPaste && app ? { name: app.name, pid: app.pid, handle: app.handle } : undefined;

      const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      win.setBounds({
        width: PALETTE_SIZE.width,
        height: PALETTE_SIZE.height,
        x: Math.round(wa.x + (wa.width - PALETTE_SIZE.width) / 2),
        y: Math.round(wa.y + (wa.height - PALETTE_SIZE.height) / 3),
      });
      // let the renderer start a fresh palette FIRST; showing it only after that means keys typed right after
      // it appears can never land in an input that is about to be replaced
      const fresh = new Promise<void>((resolve) => {
        onReady = resolve;
        setTimeout(resolve, READY_TIMEOUT_MS);
      });
      win.webContents.send(CH.paletteShow);
      await fresh;
      onReady = undefined;
      win.show();
      win.focus();
    } finally {
      opening = false;
    }
  }

  async function onChoose(req: ChooseRequest): Promise<ChooseOutcome> {
    choosing = true;
    try {
      return await choose(req, {
        platform,
        target,
        canPaste,
        executor: d.executor,
        accessibility: d.accessibility,
        notify: d.notify,
        hidePalette: hide,
        writeClipboard,
        fetchItem: async (id) => contentFromCopyItem(await d.engine.request({ type: 'copy-item', id })),
      });
    } finally {
      choosing = false;
    }
  }

  return {
    win,
    /** Window options that matter for "never in the taskbar / Alt+Tab" (BrowserWindow has no getters for them). */
    flags: { skipTaskbar: true, frameless: true, windowType: platform === 'win32' ? 'toolbar' : platform === 'darwin' ? 'panel' : 'normal' },
    open,
    /** The palette renderer finished starting a fresh palette. */
    ready: () => onReady?.(),
    hide,
    choose: onChoose,
    /** The target remembered at the last open (tests inspect this). */
    get lastTarget() {
      return { target, canPaste };
    },
  };
}

export type PaletteController = ReturnType<typeof createPalette>;
