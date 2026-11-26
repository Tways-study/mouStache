# Handoff: finish Phase 4, then Phase 5 (mouStache Desktop)

Written 2026-11-26 when work was paused. Read `docs/desktop-roadmap.md` (the plan and per-phase status),
`docs/desktop-ambient-presence.md` (the "subtle but noticeable" requirement) and this file.

## Where things stand

| Phase | What | Status |
| --- | --- | --- |
| 1 | Electron scaffold, `chrome` shim, engine + panel windows | **Done, verified** |
| 2 | Clipboard watcher, tray, blip, presence settings | **Done, verified** (flakes fixed) |
| 3 | Global palette, paste into focused app, code-block paste, region screenshot, hotkeys | **Done, verified** |
| 4 | Extension to desktop bridge | **Done, verified** (extension e2e now 14 tests) |
| 5a | Packaging (NSIS + dmg config), CI workflow, README/docs, screenshots | **Done** (Windows build verified; macOS and CI never run) |
| 5b | Security and code review, fixes | **Not done** |

Checks at the moment work stopped (run from `D:\Projects\clipboard-manager`, UPPERCASE drive letter):

- `npm test`: **432 passed** (28 files).
- `npm run typecheck`: **clean** (extension, `desktop/`, `tests/desktop`).
- `npm run e2e` (extension, 13 tests) and `npm run desktop:e2e` (32 tests) were green at the end of Phase 3. **They have NOT been re-run since Phase 4 edits began.** Run both first thing.

## Phase 4: DONE (see docs/desktop-roadmap.md "Phase 4" for the full list and gaps)

Built and verified: bridge server (`desktop/src/main/bridge-core.ts`, `bridge.ts`, `feedback.ts`), extension forwarder and client (`lib/bridge.ts`, `lib/bridge-client.ts`, `lib/background/forward.ts`), source merge (`lib/db.ts` `mergeSource`), desktop Settings > Browser extension and extension Settings > Desktop app, tests (bridge-core unit + real server, `tests/desktop/bridge.e2e.ts`, one extension e2e against a stub server). No new extension permissions. Not verified: a real installed Chrome profile talking to an installed desktop app, third-party port conflicts, macOS.

## Phase 5: packaging, docs, review

**5a is done** (see docs/desktop-roadmap.md "Phase 5a"): `electron-builder.yml`, Windows installer built (~116 MB) and the unpacked app smoke-tested by `tests/desktop/packaged.e2e.ts`, `.github/workflows/desktop.yml`, README "Desktop app" section, `desktop-*.png` screenshots, `desktop/README.md` packaging notes. **5b (security review) is done:** all findings F1-F19 were fixed or documented (see "Security model and known limits" in desktop/README.md and "Phase 5b" in the roadmap); the unit, extension e2e, desktop e2e and packaged e2e suites are green and the installer still builds. **Still to do:** macOS verification on a real Mac (build, Gatekeeper, Accessibility/Automation/Screen Recording prompts, `LSUIElement` choice), signing and notarization, real-world testing, NSIS install/uninstall/upgrade by hand, and the first CI run (never executed). The bullets below are the original brief; the packaging and README bullets are now done.

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
