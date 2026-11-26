# Handoff: finish Phase 4, then Phase 5 (mouStache Desktop)

Written 2026-11-26 when work was paused. Read `docs/desktop-roadmap.md` (the plan and per-phase status),
`docs/desktop-ambient-presence.md` (the "subtle but noticeable" requirement) and this file.

## Where things stand

| Phase | What | Status |
| --- | --- | --- |
| 1 | Electron scaffold, `chrome` shim, engine + panel windows | **Done, verified** |
| 2 | Clipboard watcher, tray, blip, presence settings | **Done, verified** (flakes fixed) |
| 3 | Global palette, paste into focused app, code-block paste, region screenshot, hotkeys | **Done, verified** |
| 4 | Extension to desktop bridge | **Partly built, not verified end to end** (details below) |
| 5 | Packaging, docs, security review | **Not started** |

Checks at the moment work stopped (run from `D:\Projects\clipboard-manager`, UPPERCASE drive letter):

- `npm test`: **432 passed** (28 files).
- `npm run typecheck`: **clean** (extension, `desktop/`, `tests/desktop`).
- `npm run e2e` (extension, 13 tests) and `npm run desktop:e2e` (32 tests) were green at the end of Phase 3. **They have NOT been re-run since Phase 4 edits began.** Run both first thing.

## Phase 4: what exists

Protocol and extension side (all with unit tests):

- `lib/bridge.ts`: constants (`BRIDGE_DEFAULT_PORT = 47821`, `BRIDGE_PORT_TRIES = 5`, size limits: text 1 MB, image data URL 15 MB), request/response types, `validateCapture()` strict validation.
- `lib/bridge-client.ts` (+ test): the extension's HTTP client for `/v1/ping` and `/v1/capture`.
- `lib/background/forward.ts` (+ test): fire-and-forget forwarder; called from `lib/background/save.ts` for non-secret text (`forwardText`) and images (`forwardImage`) after the local save.
- `lib/url.ts`: `stripUrl()` moved out of `save.ts` so the bridge server and extension share it.
- `lib/types.ts`: new settings `bridgeEnabled` (default false), `bridgeToken` (default ''), `bridgePort` (default 47821). Back-compat test in `lib/settings.test.ts`.
- `lib/db.ts`: `mergeSource()` plus its use in `addItem` dedupe, so a duplicate with a richer source (page URL/title/favicon) enriches the existing item and never replaces an existing URL. Tests in `lib/db.test.ts` ("mergeSource" block).

Desktop side, partly built:

- `desktop/src/main/bridge-core.ts` (about 300 lines): token generation and store (`newToken`, `createTokenStore`), constant-time compare (`tokensEqual`), `hostAllowed`, `originAllowed`, `bearer`, `createRateLimiter`, `createBridgeHandler`, and `startBridgeServer()` (binds `127.0.0.1` only, `exclusive`, tries the next ports if taken, request/header timeouts, returns `{server, port, close}`).

## Phase 4: what is still missing (do these in order)

1. **Tests for `bridge-core.ts`.** There is no `bridge-core.test.ts` yet. Cover every rejection path: no token, wrong token, wrong Host (DNS rebinding), bad Origin (anything except absent or `chrome-extension://`), CORS preflight (`OPTIONS`), non-JSON content type, oversize body (enforced while streaming), invalid JSON, bad schema, rate limit, URL sanitising (query and hash stripped, only http/https). Add an integration test that starts the real server on port `0` in Node and POSTs to it. Check the handler never logs captured content and never returns stack traces.
2. **Wire the server into the app.** `desktop/src/main/index.ts` has no bridge code yet. Start the server at launch with the stored token and `bridgePort`; on a verified capture send `save-text` / `save-image` to the engine (reuse the existing capture path so dedupe, tags, `skipSecrets` and paused hosts apply; secrets are never saved). Respect "pause capture". Expose status (listening on `127.0.0.1:PORT` or the error) and the token through IPC using the same "own pages only" sender check as the other handlers (`desktop/src/shared/api.ts`, `preload/index.ts`, `chrome-shim.ts`). The token must only ever reach the panel's settings.
3. **No double blip.** A browser copy is seen by both the OS watcher and the extension. A bridge capture that **dedupes** (even if it merges a source) must NOT trigger a second blip or tray flash. Only genuinely new items do. Add a unit/e2e check.
4. **Desktop Settings group "Browser extension"** in `components/panel/SettingsSheet.tsx` (desktop only, via `isDesktopApp()`): status, the pairing token with **Copy** and **Regenerate** (regenerate invalidates the old token immediately), and a short how-to.
5. **Extension Settings group "Desktop app"** (extension only): enable toggle, token field, port, **Test connection** (`GET /v1/ping` via `bridge-client.ts`), and status text (Connected / Not running / Wrong token). Confirm `127.0.0.1` fetch works from the MV3 service worker with the existing `<all_urls>` host permission and that **no new permissions** are needed.
6. **Electron e2e** in `tests/desktop/` (use the existing fake clipboard / pinned foreground helpers, `MOUSTACHE_E2E=1`): authenticated capture appears tagged with its source; unauthenticated, wrong-origin and wrong-host requests are rejected; regenerate invalidates the old token; a secret sent over the bridge is not saved; a deduped capture merges its source without a second blip.
7. **Optional extension e2e** (`tests/e2e/`): copy with a stub bridge server on `127.0.0.1`, assert the forwarded request (token present, no secret, stripped URL). If it can't be made reliable, say so and rely on the unit tests.
8. **Docs:** mark Phase 4 DONE (and its gaps) in `docs/desktop-roadmap.md`, update `desktop/README.md`, and keep the root README's "Roadmap: desktop app" section factual (the desktop app is not released).

**Done when:** `npm test`, `npm run typecheck`, `npm run e2e` (13) and `npm run desktop:e2e` all pass, with `desktop:e2e` green on **two consecutive full runs**.

## Phase 5: packaging, docs, review

- `electron-builder` config: Windows NSIS installer; macOS dmg (build on a Mac or a GitHub Actions macOS runner). Must bundle `desktop/resources/tray/*`. Unsigned macOS builds show a Gatekeeper warning until signed and notarised (needs an Apple Developer account; document, don't block).
- README: add a real "Desktop app" section (install, tray icon, palette, pairing with the extension), refreshed screenshots (tray, blip, palette, desktop panel), and the import path from the extension (Export JSON, then Import).
- **Security and code review pass** before calling it done: bridge (auth, Host/Origin, rate limit, body limits, error bodies), IPC surface and sender checks, CSP, preload API, `moustache://` protocol handler, the PowerShell and `osascript` helpers (fixed scripts, no user-data interpolation), concealed-clipboard handling, and secret handling. Use the `review` / `cso` skills or a review agent, then fix findings.
- Final verification matrix on Windows; ask the user to run the macOS checks below.

## Not verified by anyone yet (be honest about this in any release note)

- Real paste into Cursor, VS Code or a terminal; real focus restore. `SetForegroundWindow` can be refused by the OS. Elevated (admin) windows cannot be typed into.
- Tray icon, blip and palette appearance in the real app (tests check window flags and state, not looks).
- **macOS, everything:** template tray icons, `lsappinfo` foreground detection, `osascript` activate and keystroke, Accessibility permission flow, Screen Recording permission for `desktopCapturer`, the panel-type palette window, real password-manager UTIs, Electron's clipboard format wrapper.
- Fullscreen / Do Not Disturb detection is not implemented (Electron has no API); users can pick "Tray only".
- Identical text copied twice in a row is not detected as a new copy (no native clipboard sequence number).
- Real Chrome talking to the real desktop app over the bridge.

## How to resume

1. `Set-Location D:\Projects\clipboard-manager` (PowerShell, uppercase drive; a lowercase `/d/` path makes vitest fail with "failed to find the runner").
2. `npm install` if needed, then `npm test && npm run typecheck && npm run e2e && npm run desktop:e2e`. Fix anything red before adding code.
3. Do the Phase 4 list above in order, then Phase 5.
4. Working style used so far: one Sonnet subagent per phase with a detailed brief, then **independent verification** of its claims (re-run the checks yourself). Twice an agent's "all green" did not hold up on a re-run, so keep doing this. Diagnose root causes of flakes; don't add sleeps.
5. The Phase 1 to 4 agent (id `a27559594d5f98bdf`) was stopped, not finished; its transcript may still be resumable with `SendMessage`, otherwise start a new agent from this file.

## Gotchas

- `wxt/browser` is raw `globalThis.chrome`: `onMessage` handlers must use `sendResponse` plus `return true`.
- Internal ids stay `stash` (Dexie db name, `stash:*` keys, export `app:"stash"`); the product name is **mouStache**.
- Desktop e2e helpers only act under `MOUSTACHE_E2E=1`: fake clipboard (`MOUSTACHE_FAKE_CLIPBOARD=1`), stubbed global shortcuts, recorded (never sent) paste commands, pinned foreground app. Tests must never send real keystrokes.
- Production desktop pages are served from `moustache://app`, not `file://`, because `isDemo` is true for `file:` pages.
- Preview servers (ports 4173 and 5199) may need restarting. `.playwright-mcp/` screenshots are tracked in git from the first commit.
