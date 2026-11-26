# mouStache Desktop: roadmap and handoff

Status as of 2026-11-26. Resume from this file; the full approved plan is also at
`C:\Users\user\.claude\plans\zippy-chasing-cascade-of-fe636fe7-5e1e-4b9d-9873-612b3c03f723.md`.

## Why
Most copy/paste happens between agentic IDEs (Cursor, VS Code), LLM chats and other desktop apps, which a browser extension
cannot see. mouStache Desktop captures the **system clipboard** and offers a **global palette that pastes into the focused app**.

## Decisions (already made, do not re-ask)
- Desktop app is the **main app** (one history). The extension stays standalone and also forwards captures (with page context) to it.
- **Electron** + `electron-vite`; code lives in `desktop/` and **reuses** `lib/` and `components/` through the `@` alias.
- **Windows + macOS** first. Linux/Wayland out of scope.
- Picking an item **pastes straight into the focused app** (macOS needs Accessibility permission, once).
- Local only. No network except `127.0.0.1` for the extension bridge.
- Internal ids stay `stash` (Dexie db name, `stash:*` storage keys, export `app:"stash"`); product name is **mouStache**.

## Phase 1: scaffold + chrome shim (STATUS: DONE)

Built in `desktop/` (see `desktop/README.md`). Scripts: `desktop:dev`, `desktop:build`, `desktop:typecheck` (also chained into `npm run typecheck`), `desktop:e2e`.
- **Main** (`src/main/index.ts`, `windows.ts`, `router.ts`): single-instance lock, hidden engine window (backgroundThrottling off), hidden panel window 460x780 (close = hide), basic tray (Open / Quit, icon `public/icon/32.png`), `moustache://app` protocol serving the built renderer, request/permission lockdown, IPC accepted only from our own pages. `router.ts` is pure (broadcast vs engine routing, request correlation with timeout/reset).
- **Preload** (`src/preload/index.ts`): `window.mouDesktop` {send, onMessage, serveEngine, openExternal}.
- **Renderers**: `engine.html/ts` runs `handleMessage` + `registerCleanup`; `panel.html/ts` imports the shim first, then the existing `entrypoints/sidepanel/main`. `sources.css` points Tailwind at the shared folders.
- **Shim** (`chrome-shim.ts`, `shim-core.ts`): runtime (id `mou-stache-desktop`, sendMessage, onMessage, inert ports, getContexts, getManifest), storage.local (localStorage + BroadcastChannel onChanged) and storage.session (per window), alarms on timers (so auto-cleanup runs), stubs for tabs/sidePanel/action/scripting/contextMenus/commands. `tabs.create` opens the default browser (http/https only).
- **Tests**: 23 new Vitest tests (`shim-core.test.ts`, `main/router.test.ts`); 3 Playwright-Electron tests in `tests/desktop/desktop.e2e.ts` (renders empty state in real mode, save -> live list update through the engine, hardening + close-hides).
- **Known gaps for later phases**: panel copy is still extension-flavoured (pin to toolbar, Alt+Shift+V "on any tab", Win+Shift+S); `runtime.getContexts` returns [] and badge logic is a no-op; capture/screenshot messages are not implemented on desktop; `desktop:dev` was started and booted but its window was not visually inspected; no packaging yet.

## Phase 2: clipboard capture + ambient presence (STATUS: DONE)

Spec: this section plus `docs/desktop-ambient-presence.md` (binding). Built in `desktop/`:
- **Watcher** (`src/main/watcher-core.ts` pure, `watcher.ts` Electron wiring, `capture.ts`, `foreground.ts`): polls every 400 ms (never overlapping), detects changes by SHA-1 of normalised text / decoded image pixels. The first tick and every resume only baseline (nothing already on the clipboard is captured). Skips: concealed entries (`org.nspasteboard.ConcealedType`, `TransientType`, `ExcludeClipboardContentFromMonitorProcessing`, `CanIncludeInClipboardHistory` = 0; the content is not even read), text over 500 KB, images over 20 MB, mouStache's own writes (the renderer marks them through `navigator.clipboard` wrappers in the shim; main keeps a 5 s guard), copies made inside mouStache's own window, and paused apps. Saves go to the engine as `save-text` / `save-image` with `via:'copy'` and `source:{title: appName}`, so dedupe, tags and `skipSecrets` come from the existing `saveText`/`saveImage`.
- **Paused apps**: `pausedApps` setting (defaults 1Password, Bitwarden, KeePass, LastPass, Dashlane), case-insensitive substring match on the foreground app name. Foreground detection needs no native module: Windows uses one long-lived PowerShell that P/Invokes `GetForegroundWindow`; macOS uses `lsappinfo` (written, NOT run on a Mac). A detection failure is non-fatal (the copy is captured with no app name).
- **Tray** (`src/main/tray.ts`, `tray-model.ts`): idle / captured (curl for 600 ms) / paused (dimmed + slash) / attention (dot, set after 3 consecutive engine failures). Tooltip `mouStache · N items · last: TYPE, X min ago` (`· Paused` when paused). Menu: Open, Pause/Resume, Quick palette (disabled until Phase 3), Settings (opens the panel's settings), Launch at login (`app.setLoginItemSettings`), Quit. Left click toggles the panel. macOS template icons, Windows onlight/ondark variants (chosen from `nativeTheme`). Frames are generated by `npm run icons` into `desktop/resources/tray/` from the shared shape (`lib/brand/moustache.mjs`); the extension icons are byte-identical to before.
- **Blip** (`src/main/blip.ts`, `blip-scheduler.ts` pure, `src/renderer/blip.html/tsx/css`): 380x44 transparent frameless window, `focusable:false`, `showInactive()`, `setIgnoreMouseEvents(true)`, `skipTaskbar`, always on top, toolbar window type on Windows (kept out of Alt+Tab). Placed bottom-right/left or top-right of the display with the mouse, 16 px inside the work area. The pill reads `Saved · SQL` (type label from the classifier, never the text) with the mini mascot (happy curl); fade in 120 ms, hold 0.8/1.2/2 s, fade out 200 ms, about 85% opaque. Bursts coalesce (`Saved · 3 items`); at most one new pill per 2 s (extra copies are deferred and merged, not dropped). Modes Off / Tray only / Blip. Reduce motion (system or setting) means a plain fade. Skipped items (secret, concealed, paused app, own app, paused capture) produce no feedback at all. Suppressed while the mouStache panel is focused.
- **First run**: one pill ("mouStache lives in your tray. Pin it so it stays visible." / menu bar on macOS), tracked by `first-run.json` in userData.
- **Settings** (`lib/types.ts`): `pausedApps`, `blipMode`, `blipPosition`, `blipDuration`, `menuBarCount`, `weeklySummary` (stored only). Pause capture is the existing `autoCapture`, inverted. `SettingsSheet` shows **Presence** and **Desktop** groups only when `isDesktopApp()` (shim `runtime.id`) and hides extension-only rows (toast, quiet mode, paused sites, shortcuts page). `EmptyStates.tsx` has desktop wording (any app, tray icon, palette hint); the extension text is unchanged. `App.tsx` listens for a `stash:open-settings` DOM event (tray > Settings).
- **Tests**: unit tests for watcher logic, capture pipeline, blip scheduler, tray model, presence settings and settings back-compat; Electron e2e in `tests/desktop/capture.e2e.ts` (text + image captured, tagged and deduped; API key, concealed entry, own write, paused app, paused capture and oversize text not saved; blip flags, content-free text, auto-hide, coalescing, no blip for skipped items, Tray only / Off, first-run hint once). Test-only hooks are exposed on `globalThis` only when `MOUSTACHE_E2E=1`.
- **Known gaps / limits**:
  1. Electron 45's clipboard API is async and has no `availableFormats`; raw formats are read through the `electron application/osclipboard;format="..."` MIME wrapper (write and detect verified on Windows only).
  2. Fullscreen / do-not-disturb detection is not implemented (Electron has no API; it needs native code). Users can choose Tray only.
  3. macOS is unverified: template icon look, `lsappinfo` app name, menu-bar count, NSPanel blip, concealed UTIs from real password managers.
  4. The Windows tray theme follows the app theme (`nativeTheme`), which can differ from the taskbar theme.
  5. Tray and blip appearance, and real-world focus behaviour (copying mid-typing in VS Code/Cursor, the Alt+Tab list), were not checked by eye.
  6. Weekly summary is stored but no notification is sent.
  7. `desktop/resources/tray` is read from disk next to the build; electron-builder must ship it (Phase 5).
  8. The empty-state palette hint says it arrives in the next update; update it in Phase 3.
  9. `lib/db.perf.test.ts` is timing based (300 ms); it now takes the fastest of 3 runs per query so a busy machine does not flake it.
  10. Change detection is by content hash (Chromium exposes no clipboard sequence number; that needs a native call), so copying the exact same text/image twice in a row is not seen as a new copy.
  11. Race fixes found while stabilising the e2e (all covered by unit tests): polls are strictly serialised and a poll that finishes out of order is discarded (before, a late stale read could capture whatever was on the clipboard before the copy); a clipboard that turns concealed between the check and the read is re-checked and dropped; a hung clipboard read has a 4 s watchdog; foreground-app detection is a pushed 300 ms sample stream instead of request/response (a timed-out reply used to be paired with the next question, so a copy could be attributed to the wrong app or none and slip past the paused-apps list).
  12. E2E design: `capture.e2e.ts` drives an in-memory clipboard (`MOUSTACHE_FAKE_CLIPBOARD=1`) and pins the foreground app, because the real OS clipboard is shared with everything else on the machine (another process copying text was the cause of the "extra item saved" flake); negative checks wait for a specific main-process verdict (tick/outcome log) instead of sleeping. `clipboard-real.e2e.ts` smoke-tests the real Electron clipboard with retrying writes.

## Phase 3: global palette + paste into the focused app + region screenshot (STATUS: DONE)

Built in `desktop/` (details in `desktop/README.md`):
- **Palette seam** (`components/overlay/paletteHost.ts`, `Palette.tsx`): `Palette` takes an optional `host` (`search`, `activate(item, mode)`, `close`, `codeBlock`) and `layout` (`overlay` | `window`). With no props the content script renders it exactly as before (`webPaletteHost` holds the old send/clipboard/insert logic). `RegionSelect` got optional `onSelect` / `onCancel` props the same way. The extension e2e (13) is unchanged and green.
- **Palette window** (`src/main/palette.ts`, `src/renderer/palette.html/tsx/css`): 640x440 frameless, transparent, always on top, skip taskbar (toolbar window type on Windows so it stays out of Alt+Tab, panel type on macOS), kept warm (hidden, loaded) so it opens instantly, centred on the display with the mouse, remounts fresh on each show, hides on Esc / blur / pressing the hotkey again. It is the only mouStache window that takes focus, and only because the user opened it. Footer hints are platform aware and include the desktop-only code block action.
- **Paste** (`src/main/paste.ts`, `paste-flow.ts`): before showing the palette the foreground window is remembered (Windows HWND from the existing 300 ms sampler; macOS app name via `lsappinfo`). On Enter, main writes the item (text or PNG) after marking it as an own write, hides the palette, brings the remembered window back and sends the keystroke. Shift+Enter copies only. Windows uses one long-lived PowerShell started with a FIXED script (`-EncodedCommand`) that reads `PASTE <digits>` lines and calls SetForegroundWindow + `WScript.Shell.SendKeys('^v')`; macOS uses osascript (fixed keystroke script; the app name travels as a separate argv entry). User data is never spliced into script text (unit-tested with hostile handles/names). macOS checks `isTrustedAccessibilityClient(false)`; if not trusted it shows the system prompt once, copies, and says "Copied, press ⌘V" in a pill. Any keystroke failure falls back to the same message. Palette opened from mouStache's own window copies only.
- **Code block paste**: Mod+Enter wraps the text with `markdownFence` and the language label from `fenceLang(item)` (shared with Copy as Markdown); only plain labels are accepted (`safeFence`).
- **Secrets** are masked in the palette list exactly like the extension palette and still paste.
- **Global shortcuts** (`src/main/hotkeys.ts`, `lib/accelerator.ts`): defaults Alt+Shift+V (palette) and Alt+Shift+S (region screenshot). Accelerators are validated (modifier required, one key, reserved combos like Ctrl+C / Alt+F4 refused), registered with `globalShortcut`, re-registered on change (the two can swap keys), a refused key keeps the previous working one and reports a readable error, everything is released on quit. Settings > Desktop has a "press the shortcut" field per shortcut with Reset and the error text.
- **Region screenshot** (`src/main/region.ts`, `src/renderer/region.html/tsx/css`): `desktopCapturer` grabs the display with the mouse BEFORE the overlay exists, a frozen-frame overlay window shows it, the shared `RegionSelect` drags the rectangle, `cropImage` cuts it, main saves it as `save-image` with `via:'screenshot'` (tags image + screenshot) and the blip says "Saved · Image". Esc cancels. Reuse of `RegionSelect` was clean (two optional props).
- **Settings**: `hotkeyPalette`, `hotkeyScreenshot` in `lib/types.ts` (back-compat tested). Tray menu: Quick palette and Region screenshot are enabled. Empty-state wording no longer says the palette is coming.
- **Tests**: unit tests for accelerator validation and key capture, hotkey manager (register, change, swap, conflict, invalid, quit), paste command builders (injection safety on both platforms, the recording executor), paste flow (order write -> hide -> paste, copy only, code block, image, failures, macOS prompt-once), the palette adapter seam (a host drives the same Palette; extension default unchanged), settings back-compat. Electron e2e in `tests/desktop/palette.e2e.ts` and one real-clipboard test in `clipboard-real.e2e.ts`. In e2e (`MOUSTACHE_E2E=1`) paste commands are built and RECORDED, never sent; `globalShortcut` is a stub; the screen image is synthetic; no real keystroke or shortcut is ever produced.
- **Known gaps / limits**:
  1. Real paste into Cursor / VS Code / a terminal, and real focus restore, were NOT verified end to end. Only the actor script start-up was probed (starts, prints READY in about 0.5 s, exits cleanly without sending any key).
  2. Windows `SetForegroundWindow` is best effort (the OS can refuse to hand focus to another process); when it fails the paste goes to whatever Windows re-activated after the palette hid, which is normally the previous window. SendKeys cannot type into elevated (admin) windows.
  3. macOS is unverified: the Accessibility prompt flow, osascript activate + keystroke, `lsappinfo`, the NSPanel palette window and Screen Recording permission for `desktopCapturer`.
  4. The palette is a transparent window with the extension's styling (no native vibrancy).
  5. Blur-to-hide cannot be triggered by Playwright without OS focus, so e2e emits `blur` on the window.
  6. The empty-state shortcut hints show the default keys even if the user changed them.
  7. Not implemented: a fullscreen-app check before opening the palette, and per-monitor region capture across displays (it captures the display under the mouse).

## Phase 4: extension bridge (STATUS: PARTLY BUILT, paused 2026-11-26)

**Continue from `docs/desktop-handoff-phase4-5.md`**, which lists exactly what exists (protocol, extension client and forwarder, `mergeSource`, `bridge-core.ts` server core) and what is still missing (bridge-core tests, wiring into the app, settings UIs, e2e, no-double-blip). Unit tests (432) and typecheck were green when paused; e2e suites were not re-run after Phase 4 edits began.

Files: `desktop/src/main/bridge.ts`; extension side `lib/background/save.ts` (forwarder) + a "Desktop app" group in `components/panel/SettingsSheet.tsx`; `lib/db.ts` (source merge).
- Desktop serves `POST http://127.0.0.1:<port>/v1/capture` (text/image + source). Pairing token generated in desktop Settings, pasted into the extension. Rules: loopback only, `Authorization: Bearer`, `Origin` must be `chrome-extension://…` or absent, body size limit, rate limit, constant-time token compare. App not running → the extension just keeps working locally.
- `addItem` dedupe (`lib/db.ts` ~line 37): when a duplicate arrives with a richer `source` (page URL/title), merge it into the existing item, so a browser copy seen by both the OS watcher and the extension keeps the URL. Add a `lib/db.test.ts` case.
- Tests: auth/origin/size/rate-limit unit tests; Electron e2e: unauthenticated and wrong-origin requests rejected, authenticated capture appears; extension e2e (existing 13) still green.

## Phase 5: packaging, docs, review
- `electron-builder`: Windows NSIS installer; macOS dmg built on a Mac (or a GitHub Actions macOS runner). Unsigned macOS builds show a Gatekeeper warning until signed/notarised (needs an Apple Developer account; document, do not block on it).
- README "Desktop app" section, refreshed screenshots (tray, palette, panel), import path from the extension (Export JSON → Import).
- Final review pass: security (bridge, IPC surface, CSP, preload API), then code review agent, then fixes.

## Known limits to state to the user
- Windows paste can fail into elevated windows. macOS needs Accessibility permission. macOS can only be verified on a real Mac; ask the user to test the Accessibility prompt, ⌥⇧V paste, tray and dmg.
- Existing extension tests that must stay green: 215 unit tests (`npm test`) and 13 e2e (`npm run e2e`).

## Gotchas
- Run npm/vitest from `D:\Projects\clipboard-manager` with an **uppercase** drive letter, or vitest fails with "failed to find the runner".
- `wxt/browser` is raw `globalThis.chrome` (no polyfill); `onMessage` handlers must use `sendResponse` + `return true`.
- Preview servers (ports 4173 and 5199) may need restarting.
- Last logo/mascot work is done and green; the logo is logo option 1 (card + moustache), mascot is "just the stache" (`components/shared/Mascot.tsx`, shared shape in `lib/brand/moustache.mjs`).
