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

## Phase 1: scaffold + chrome shim (STATUS: PARTIAL. The agent was stopped before finishing)

Partial files exist under `desktop/src/` (`main/index.ts`, `main/router.ts`, `main/windows.ts`, `preload/index.ts`, `renderer/chrome-shim.ts`, `renderer/shim-core.ts`, `shared/api.ts`). There is no `desktop` entry in `package.json`, no electron dependency, no electron-vite config, no renderer HTML and no tests yet. Review these files, then finish Phase 1 (or restart it) per the list below.
A Sonnet subagent was asked to: create `desktop/` (main, preload, renderer), an engine window that owns Dexie and runs
`handleMessage()` from `lib/background/router.ts`, a `chrome` shim so the existing side-panel `App` runs unchanged, a tray stub,
unit tests for the shim, a Playwright `_electron` smoke test (`tests/desktop/`), and scripts `desktop:dev`, `desktop:build`,
`desktop:e2e`.

**First thing tomorrow:** check whether it finished.
1. `git status`-style check: does `desktop/` exist with `src/main`, `src/preload`, `src/renderer`?
2. From `D:\Projects\clipboard-manager` (UPPERCASE drive letter): `npm test`, `npm run typecheck`, `npm run e2e` (extension, expect 13/13), then `npm run desktop:build && npm run desktop:e2e`.
3. If the agent did not finish or failed, re-run Phase 1 with the brief in the plan file (Architecture + Phase 1), or finish by hand.
Do not start Phase 2 until Phase 1 is green.

## Phase 2: clipboard capture
Files: `desktop/src/main/watcher.ts`, `index.ts` (tray, autostart), settings additions in `lib/types.ts` + `components/panel/SettingsSheet.tsx`.
- Poll `clipboard` in the main process (~400 ms). Detect changes by hashing text / image bytes (`lib/hash.ts` style). Send new content to the engine window, which calls `saveText(text, {title: appName}, 'copy')` / `saveImage` (dedupe, classify and secret handling come free).
- **Own-write guard:** when mouStache writes the clipboard (palette paste, "copy" in the panel) mark it so the watcher ignores it (same idea as `isStashWriting` in `lib/content/clipboard.ts`).
- **Privacy (must-have):** skip clipboard entries flagged concealed by password managers: macOS `org.nspasteboard.ConcealedType` / `TransientType`; Windows format `ExcludeClipboardContentFromMonitorProcessing`. Keep `skipSecrets` for API keys/JWTs. New setting `pausedApps` (defaults: 1Password, Bitwarden, KeePass, LastPass, Dashlane). Text size cap (~500 KB). Pause toggle in tray.
- Tray menu: open panel, pause/resume capture, launch at login (`app.setLoginItemSettings`), quit. Tray click opens the panel.
- Optional: record source app name (needs an `active-win`/`get-windows` style dependency; macOS needs Screen Recording permission for window titles, so app name only unless the user agrees).
- Tests: pure unit tests for change detection, own-write guard, concealed-format skip, size cap, paused apps. Electron e2e: write text and an image to the clipboard from a helper, assert items appear tagged and deduped; assert an API key and a concealed-format entry are NOT saved.

## Phase 3: global palette + paste into the focused app
Files: `desktop/src/main/hotkeys.ts`, `paste.ts`, `windows.ts` (palette window), `desktop/src/renderer/palette.*`.
- Global shortcut **Alt+Shift+V** (user-changeable in desktop Settings) shows a frameless, always-on-top palette window rendering the reused `components/overlay/Palette.tsx` with a desktop adapter (replace `overlayStore` / `send` calls; `Palette` currently inserts into a page via `lib/content/insert.ts`, so the desktop adapter must call main instead).
- Enter: main writes the item to the clipboard (mark as own write), hides the palette, restores focus to the previous app, then sends the paste keystroke. Shift+Enter = copy only.
  - Windows: `powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys('^v')"` (known limit: fails into elevated/admin windows).
  - macOS: `osascript -e 'tell application "System Events" to keystroke "v" using command down'`. Check `systemPreferences.isTrustedAccessibilityClient(true)`; show a one-time guided prompt; fall back to "Copied, press ⌘V".
  - No native node modules.
- Extra for IDE/LLM use: "paste as fenced code block" (reuse the Copy-as-Markdown logic in `components/panel/DetailSheet.tsx`).
- Region screenshot (Alt+Shift+S): `desktopCapturer` + overlay window reusing `components/overlay/RegionSelect.tsx` and `cropImage` in `lib/thumbs.ts`.
- Tests: Electron e2e driving IPC (open palette, search, select, assert clipboard content; can't press global shortcuts in Playwright). Manual: paste into a Cursor chat box and a terminal.

## Phase 4: extension bridge
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
