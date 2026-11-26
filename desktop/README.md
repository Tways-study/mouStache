# mouStache Desktop

Electron app that runs the extension's side-panel UI (`entrypoints/sidepanel/App.tsx`) against real data, outside the browser.
It reuses `lib/` and `components/` through the `@` alias (repo root). Nothing is copied.

Run everything from the repo root (`D:\Projects\clipboard-manager`, uppercase drive letter on Windows).

| Command | What it does |
| --- | --- |
| `npm run desktop:dev` | electron-vite dev server + Electron (panel shows immediately) |
| `npm run desktop:build` | builds main, preload and renderers to `desktop/out/` |
| `npm run desktop:typecheck` | `tsc` for `desktop/` and `tests/desktop/` (also part of `npm run typecheck`) |
| `npm run desktop:e2e` | builds, then runs the Playwright-for-Electron smoke tests in `tests/desktop/` |
| `npm test` | Vitest, includes the shim and router unit tests in `desktop/src/**` |

Env: `MOUSTACHE_USER_DATA=<dir>` uses a throwaway profile; `MOUSTACHE_SHOW_PANEL=1` shows the panel on launch.

## How it fits together

- **Engine window** (hidden, never throttled): owns IndexedDB (Dexie) and answers messages with `handleMessage()` from `lib/background/router.ts`. Runs `registerCleanup()`.
- **Panel window** (460x780, hidden until shown from the tray; closing hides it): mounts the existing `App`.
- **chrome shim** (`src/renderer/chrome-shim.ts`, logic in `shim-core.ts`): installed first in every renderer, so `wxt/browser` (= `globalThis.chrome`) works unchanged. `runtime.id` is set, so the panel runs in real mode; `?demo=1` still gives demo mode.
- **Messaging**: `runtime.sendMessage` -> preload `invoke` -> main (`router.ts`) -> engine window -> `handleMessage` -> reply back. Broadcasts (`items-changed`, ...) are fanned out by main to every other window.
- **Storage**: `chrome.storage.local` is backed by localStorage, with `onChanged` fired locally and to other windows via BroadcastChannel. `storage.session` is per-window (sessionStorage).
- **Renderer origin**: production pages are served from the privileged `moustache://app` scheme (not `file:`, which the app would treat as demo mode). Dev uses the Vite server, so dev and prod data are separate.
- **Security**: contextIsolation, sandbox, no node integration, strict CSP meta tags, permission and request filtering, popups and navigation denied, IPC restricted to our own pages.

## Capture and presence (Phase 2)

mouStache polls the system clipboard (every 400 ms) in the main process and saves new text and images through the engine, so history works for every app, not just the browser. Design rules live in `docs/desktop-ambient-presence.md`.

- **Never saved**: password-manager / concealed entries, secrets (API keys, tokens), text over 500 KB, mouStache's own clipboard writes, copies while a paused app is in front (default: 1Password, Bitwarden, KeePass, LastPass, Dashlane), and anything while capture is paused. Skipped copies show no feedback.
- **Tray icon**: idle, curls briefly after a capture, dimmed when paused, a dot when something needs attention. Tooltip: `mouStache · 128 items · last: SQL, 2 min ago`. Menu: Open, Pause/Resume, Quick palette (Phase 3), Settings, Launch at login, Quit.
- **Blip**: a small `Saved · SQL` pill in a screen corner (never the copied text), click-through and never focused. Settings > Presence: Off / Tray only / Blip, position, duration. The first launch shows one pill pointing at the tray icon.
- Icons: `npm run icons` regenerates the extension icons and `desktop/resources/tray/*`.
- App-name detection: Windows via a persistent PowerShell (no native module), macOS via `lsappinfo` (untested on a Mac). If it fails the copy is captured without an app name.
- E2E hooks: `MOUSTACHE_E2E=1` exposes test-only globals in main; `MOUSTACHE_NO_FIRST_RUN=1` suppresses the first-run pill.

## Palette, paste and screenshots (Phase 3)

- **Alt+Shift+V** opens the quick palette over whatever you are doing (the same palette the extension shows on web pages). Type to search, Tab or Ctrl/Cmd+1..7 to filter. **Enter** pastes into the app you came from, **Shift+Enter** copies only, **Ctrl/Cmd+Enter** pastes as a fenced code block with the item's language, **Esc** (or clicking away) closes it. Secrets are masked in the list but still paste.
- **Alt+Shift+S** freezes the display under the mouse, you drag a region (Esc cancels), and the crop is saved as an image item (blip: `Saved · Image`).
- Both shortcuts can be changed in Settings > Desktop (press the new combination; Reset puts the default back). If the system refuses a combination the previous one keeps working and the field says why.
- Paste: Windows sends Ctrl+V through one long-lived PowerShell (`SendKeys`, fixed script, no user data in script text); it cannot type into elevated windows. macOS uses osascript and needs the Accessibility permission once (a guided prompt, then "Copied, press ⌘V" until granted). No native modules.
- Tests never press real shortcuts or send keystrokes: with `MOUSTACHE_E2E=1` paste commands are recorded instead of sent, `globalShortcut` is a stub, the screen image is synthetic, and the foreground app is pinned.
