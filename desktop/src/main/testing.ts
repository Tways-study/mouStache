/**
 * Test seams for e2e (security review F2). This module is imported by index.ts only behind the compile-time constant
 * `__MOU_TEST_BUILD__`, which is the literal `false` in every release build: the call sites are dead code, the
 * bundler drops them and this whole file, so none of it (the fake clipboard, the recorded paste executor, the
 * stubbed global shortcuts, the `__mou*` hooks) exists in a released app. Even in a test build nothing activates
 * unless MOUSTACHE_E2E=1 is set in the environment. `npm run desktop:check-release` fails if any marker below
 * appears in a release bundle.
 */
import type { BlipController } from './blip';
import type { BridgeController } from './bridge';
import type { CaptureOutcome } from './capture';
import { createFakeClipboard, type FakeClipboard } from './fake-clipboard';
import { withOverride, type ForegroundDetector } from './foreground';
import type { Hotkeys } from './hotkeys';
import type { PaletteController } from './palette';
import { createRecordingPasteExecutor, type PasteExecutor, type PasteRecord } from './paste';
import type { PresenceSettings } from './presence-settings';
import type { RegionController, ScreenGrabber } from './region';
import { syntheticGrabber } from './region';
import type { ClipboardPrimitives } from './secret-clipboard';
import { createShortcutStub } from './shortcut-stub';
import type { TrayController } from './tray';
import type { TickResult } from './watcher-core';
import type { WatcherController } from './watcher';

export interface TestParts {
  tray?: TrayController;
  blip?: BlipController;
  watcher?: WatcherController;
  presence: { get(): PresenceSettings };
  bridge?: BridgeController;
  hotkeys?: Hotkeys;
  palette?: PaletteController;
  region?: RegionController;
}

export interface TestSeams {
  readonly pasteExecutor: PasteExecutor;
  readonly clipboard?: FakeClipboard;
  readonly clipboardPrimitives?: ClipboardPrimitives;
  readonly secretClearMs?: number;
  readonly shortcut: ReturnType<typeof createShortcutStub>;
  readonly grabber: ScreenGrabber;
  readonly portOverride?: number;
  /** Wraps the real foreground detector so tests can pin the "app in front". */
  detector(real: ForegroundDetector): ForegroundDetector;
  onOutcome(o: CaptureOutcome): void;
  onBridgeOutcome(o: CaptureOutcome): void;
  onTick(r: TickResult): void;
  onPoll(r: TickResult): void;
  onNotify(text: string): void;
  markReady(): void;
  install(p: TestParts): void;
}

/** Undefined unless MOUSTACHE_E2E=1: a test build started normally (e.g. by a developer) behaves like a normal app. */
export function createTestSeams(env: Record<string, string | undefined>): TestSeams | undefined {
  if (env['MOUSTACHE_E2E'] !== '1') return undefined;
  const g = globalThis as Record<string, unknown>;
  const pasteLog: PasteRecord[] = [];
  const notifications: string[] = [];
  const tickLog: string[] = [];
  const outcomeLog: string[] = [];
  const fake = env['MOUSTACHE_FAKE_CLIPBOARD'] === '1' ? createFakeClipboard() : undefined;
  const shortcut = createShortcutStub();
  let override: ReturnType<typeof withOverride> | undefined;
  const portRaw = env['MOUSTACHE_BRIDGE_PORT'];
  const clearRaw = Number(env['MOUSTACHE_SECRET_CLEAR_MS']);
  let polls = 0;

  return {
    pasteExecutor: createRecordingPasteExecutor(pasteLog),
    clipboard: fake,
    clipboardPrimitives: fake?.primitives(),
    secretClearMs: Number.isFinite(clearRaw) && clearRaw > 0 ? clearRaw : undefined,
    shortcut,
    grabber: syntheticGrabber,
    portOverride: portRaw !== undefined ? Number(portRaw) : undefined,
    detector(real) {
      override = withOverride(real);
      return override.detector;
    },
    onOutcome: (o) => void outcomeLog.push(o.status === 'skipped' ? `skipped:${o.reason}` : o.status === 'saved' ? `saved:${o.kind}` : 'error'),
    onBridgeOutcome: (o) =>
      void outcomeLog.push(o.status === 'skipped' ? `bridge-skipped:${o.reason}` : o.status === 'saved' ? `bridge-saved:${o.deduped ? 'dup' : 'new'}` : 'bridge-error'),
    onTick: (r) => void tickLog.push(r),
    onPoll: () => void polls++,
    onNotify: (t) => void notifications.push(t),
    markReady: () => void (g['__mouReady'] = true),
    install(p) {
      g['__mouTray'] = () => p.tray?.inspect();
      g['__mouPending'] = () => p.watcher?.pending() ?? 0;
      g['__mouTicks'] = () => [...tickLog];
      g['__mouPolls'] = () => polls;
      g['__mouOutcomes'] = () => [...outcomeLog];
      g['__mouPresence'] = () => p.presence.get();
      g['__mouForeground'] = override?.set;
      g['__mouFake'] = fake;
      g['__mouGS'] = shortcut;
      g['__mouBridge'] = { port: () => p.bridge?.port };
      g['__mouHotkeyStatus'] = () => p.hotkeys?.status();
      g['__mouBlip'] = p.blip && {
        window: p.blip.win,
        flags: { ignoreMouseEvents: true, focusable: p.blip.win.isFocusable() },
        idle: () => p.blip!.idle,
        get shows() {
          return p.blip!.stats.shows;
        },
        get notifies() {
          return p.blip!.stats.notifies;
        },
      };
      g['__mouPalette'] = p.palette && {
        open: () => p.palette!.open(),
        window: p.palette.win,
        flags: p.palette.flags,
        pasteLog,
        notifications,
        last: () => p.palette!.lastTarget,
      };
      g['__mouRegion'] = p.region && {
        start: (bounds?: { x: number; y: number; width: number; height: number }) => p.region!.start(bounds ? { bounds } : undefined),
        window: () => p.region!.window,
      };
    },
  };
}
