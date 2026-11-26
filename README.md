<p align="center">
  <img src="docs/banner.svg" alt="mouStache: your clipboard, well-groomed" width="100%">
</p>

<p align="center">
  <img src="public/logo.svg" alt="mouStache logo" width="72" height="72">
</p>

<h1 align="center">mouStache</h1>

<p align="center">
  <b>A clipboard manager for IT students: a Chrome / Edge side panel and a desktop app.</b><br>
  It saves what you copy, tags it automatically, previews code properly, and puts it back with one shortcut.
</p>

<p align="center">
  <img alt="Manifest V3" src="https://img.shields.io/badge/Chrome%20%2F%20Edge-Manifest%20V3-3458F0">
  <img alt="Local only" src="https://img.shields.io/badge/storage-local%20only-1FA34A">
  <img alt="React 18 and TypeScript" src="https://img.shields.io/badge/React%2018-TypeScript%20strict-5E5CE6">
  <img alt="Desktop app" src="https://img.shields.io/badge/desktop-Windows%20%C2%B7%20macOS%20untested-8E8E93">
  <img alt="Tests" src="https://img.shields.io/badge/tests-665%20unit%20%C2%B7%2014%20%2B%2055%20e2e-0A84FF">
</p>

<p align="center">
  <img src="docs/screenshots/panel-light.png" alt="The mouStache side panel in light mode" width="31%">
  <img src="docs/screenshots/panel-dark.png" alt="The mouStache side panel in dark mode" width="31%">
  <img src="docs/screenshots/panel-detail-light.png" alt="A code snippet opened in the detail sheet" width="31%">
</p>

---

## Contents

- [Why mouStache](#why-moustache)
- [What it does](#what-it-does)
- [Smart auto-tagging](#smart-auto-tagging)
- [The quick palette](#the-quick-palette)
- [Built for long sessions](#built-for-long-sessions)
- [Privacy and safety](#privacy-and-safety)
- [Shortcuts](#shortcuts)
- [Install](#install): [extension](#browser-extension), [desktop app](#desktop-app-windows), [pairing them](#pair-the-extension-with-the-desktop-app)
- [Uninstall and your data](#uninstall-and-your-data)
- [Troubleshooting](#troubleshooting)
- [Desktop app](#desktop-app)
- [Develop and test](#develop-and-test)
- [How it works](#how-it-works)
- [Brand](#brand)

## Why mouStache

Studying IT means copying all day: a `docker run` line, a subnet, a stack trace, a SQL query, a prompt you spent ten minutes on. The system clipboard remembers exactly one thing, and your browser history forgets the rest. mouStache keeps it, sorts it, and makes it easy to find again.

- **Hard to forget.** It lives in the browser side panel, shows a toolbar badge for new captures, and opens a Spotlight-style palette from anywhere with `Alt+Shift+V`.
- **Understands IT content.** It knows a Cisco command from a CIDR block from a Python function, and tags each one.
- **Quiet and private.** Everything stays on your device. Secrets and password-manager pages are skipped by default.

## What it does

| Capture | How |
| --- | --- |
| **Copies on web pages** | Select text and press `Ctrl/Cmd+C`. Sites' own "Copy" buttons (GitHub, docs, ChatGPT-style code blocks) are caught too. |
| **Right-click** | Save a selection, image, link or page link from the context menu. |
| **Screenshots** | Capture the visible tab, or drag a region with `Alt+Shift+S`. |
| **Paste into the panel** | Paste text or an image (for example from `Win+Shift+S`). A "Paste from clipboard" button does the same. |

Then you can **search** (text, tags, languages, source sites), **filter** by type, **pin** what matters, **delete with undo**, edit tags, and **copy back** as raw text or as a fenced Markdown code block.

<p align="center">
  <img src="docs/screenshots/comfort-compact.png" alt="Compact density with many items" width="31%">
  <img src="docs/screenshots/panel-empty-dark.png" alt="Empty state in dark mode" width="31%">
  <img src="docs/screenshots/mascot-noresults.png" alt="No results, with the drooping mascot" width="31%">
</p>

## Smart auto-tagging

Every capture is classified locally, with no network calls. Tags show as coloured chips and drive the filter bar.

| Group | Detected |
| --- | --- |
| **Code** | 15 languages (TypeScript, JavaScript, Python, Java, C#, C++, C, SQL, HTML, CSS, PowerShell, Bash, Go, Rust, PHP), shell commands, and JSON / YAML data |
| **Network** | IPv4 / IPv6, CIDR and subnet masks, MAC addresses, ports, Cisco IOS commands |
| **Errors** | Error messages and stack traces |
| **Prompts** | AI prompts (instructions such as "act as…", "you are…", "your task is…") |
| **Links** | URLs and email addresses |
| **Data** | Regex, hex colours, UUIDs, hashes, base64, Unix timestamps |
| **Secrets** | API keys, tokens and JWTs, flagged and blurred until you reveal them |

Code gets syntax highlighting (Shiki, loaded lazily per language), line numbers, "Copy raw" and "Copy as Markdown".

## The quick palette

Press `Alt+Shift+V` (`⌥⇧V` on Mac) on any page. Type to search, use the arrow keys, and press `Enter` to paste into the field you were in. It lives in a closed shadow root, so the page can't read your history.

<p align="center">
  <img src="docs/screenshots/overlay-palette-light.png" alt="The quick palette over a web page, light" width="48%">
  <img src="docs/screenshots/overlay-palette-dark.png" alt="The quick palette over a web page, dark" width="48%">
</p>

## Built for long sessions

Open **Settings > Comfort**. Everything applies live in the panel and on pages.

- **Theme** System / Light / Dark. **Text size** Small to Extra large. **Density** Comfortable cards or Compact rows.
- **Reduce motion** System / On / Off, and **Quiet mode** (no on-page toast, no badge count).
- A virtualised list that stays smooth with thousands of items. Sticky, collapsible date sections.
- The panel remembers your filter, search, scroll position and collapsed sections when you reopen it.
- Storage tools: auto-delete unpinned items older than 7 / 30 / 90 days (pinned items are never touched), "Clean up screenshots", and a live "N items, about X MB" line.

<p align="center">
  <img src="docs/screenshots/comfort-large-dark.png" alt="Large text in dark mode" width="31%">
  <img src="docs/screenshots/comfort-settings.png" alt="The Comfort settings" width="31%">
  <img src="docs/screenshots/comfort-scrolled-pill.png" alt="The 'Top' pill after scrolling" width="31%">
</p>

## Privacy and safety

- **Local only.** Items live in your browser's IndexedDB. Nothing is uploaded. Export and import as JSON from Settings.
- **Secrets are not auto-saved.** Copies that look like API keys, tokens or JWTs are skipped on automatic capture.
- **Password managers and sign-in pages are paused by default** (1Password, Bitwarden, LastPass, Dashlane, Proton Pass, Keeper, Google and Microsoft sign-in). You can edit the list in Settings.
- **Source URLs are trimmed** to the address without the query string or fragment.
- **Pages can't read your history.** The palette runs in a closed shadow root, and forged copy events from a page are ignored.
- **Abuse limits.** A page can add at most 10 items per 10 seconds, and untrusted events need a real user gesture.
- Exports are plain JSON. Treat an export file like any other file that contains your copied text.

## Shortcuts

| Windows / Linux | macOS | Action |
| --- | --- | --- |
| `Alt+Shift+V` | `⌥⇧V` | Open the quick palette |
| `Alt+Shift+S` | `⌥⇧S` | Screenshot a region to mouStache |

In the panel: `/` search (or just type), `J` / `K` move, `Enter` copy, `P` pin, `E` details, `Del` delete (4 s undo), `?` cheat sheet.

Hints adapt to your platform automatically, so macOS shows ⌘ ⌥ ⇧ instead of Ctrl, Alt and Shift. Change the shortcuts at `chrome://extensions/shortcuts`. Clicking the toolbar icon opens the side panel.

## Install

mouStache comes in two parts that work on their own or together:

| Part | Captures copies from | Platforms |
| --- | --- | --- |
| **Browser extension** | web pages in Chrome and Edge | Windows, macOS, Linux (Chrome / Edge 116 or newer) |
| **Desktop app** | every app: VS Code, Cursor, terminals, chat apps | Windows (tested); macOS (written, **untested**) |

Neither is on a store yet, so you build them from source (the desktop installer can also come from a CI run). Safari and Firefox are not supported.

### Before you start

You need [Git](https://git-scm.com/), and [Node.js](https://nodejs.org/) 24 with npm (the version development and CI use).

```bash
git clone https://github.com/Tways-study/mouStache.git
cd mouStache
npm install
```

### Browser extension

1. Build it: `npm run build`
2. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and select the `.output/chrome-mv3` folder.
4. Pin mouStache from the puzzle-piece menu so the toolbar badge stays visible.
5. Check it works: open any web page, select some text and copy it. The badge shows **1**, and clicking the toolbar icon opens the side panel with your copy in it.

**Update:** `git pull`, `npm install`, `npm run build`, then click the reload arrow on the mouStache card in `chrome://extensions`. Your history is kept. Reload any tabs that were already open so they pick up the new content script.

A store-ready zip is one command away: `npm run zip`.

### Desktop app (Windows)

The app lives in the system tray, watches the system clipboard, and opens a global palette on `Alt+Shift+V`. Pick one of these ways to get it:

| Way | Steps |
| --- | --- |
| **Build the installer** (recommended) | `npm run desktop:dist:win`, then run `release/mouStache-Setup-<version>.exe` (about 120 MB). |
| **Take it from CI** | On GitHub open **Actions > Desktop**, choose **Run workflow** (or push a `desktop-v*` tag), then download the **mouStache-windows** artifact from the finished run. |
| **Try it without installing** | `npm run desktop:pack`, then start `release/win-unpacked/mouStache.exe`. For development use `npm run desktop:dev`. |

**Running the installer**

- It installs per user, so **no administrator prompt**. You can choose the folder, and it adds Desktop and Start-menu shortcuts.
- The installer is **unsigned**, so Windows SmartScreen shows "Windows protected your PC". Choose **More info**, then **Run anyway**, but only for a build you made or downloaded yourself.

**First launch**

1. mouStache starts in the tray. If you can't see the moustache icon, open the `^` overflow menu next to the clock and drag it onto the taskbar so it stays visible. A small pill points at it the first time.
2. Copy text in any app. The tray icon curls for a moment and a small `Saved · SQL` pill appears in a screen corner (it never shows what you copied).
3. Press `Alt+Shift+V` for the quick palette. Type to search, then press `Enter` to paste into the app you came from. `Shift+Enter` only copies, `Ctrl+Enter` pastes as a fenced code block.
4. Click the tray icon to open the full panel. In **Settings > Desktop** you can turn on **Launch at login** and change the shortcuts, and **Settings > Presence** controls how noticeable the pill is.

### Pair the extension with the desktop app

Optional, and only needed if you want copies from web pages to arrive in the desktop app together with the page they came from.

1. In the desktop app open **Settings > Browser extension** and copy the token (use **Show** if you want to see it).
2. In the extension open **Settings > Desktop app**, turn it on and paste the token.
3. Leave the port at `47821` unless the app says it is in use, then press **Test connection**. It should say **Connected**.

The token never travels over the connection: the extension and the app prove to each other that they know it. Regenerating the token in the app stops the old one immediately.

### Desktop app (macOS)

The macOS build is written but **has never been run on a Mac**, so treat it as experimental.

1. On a Mac run `npm run desktop:dist:mac`, or download the **mouStache-macos** artifact from the CI run (both Apple Silicon and Intel).
2. The app is **unsigned and not notarized**, so Gatekeeper refuses it at first. Right-click the app and choose **Open**.
3. It is a tray-only app (menu bar, no Dock icon). Allow **Accessibility** when asked, so paste into other apps works, and **Screen Recording** for region screenshots. Without Accessibility the item is only copied and you press `⌘V` yourself.
4. Shortcuts use Option: `⌥⇧V` and `⌥⇧S`.

If you try it on a Mac, please report what works and what doesn't.

## Uninstall and your data

Everything is stored on your computer only. Export first if you want to keep your history: **Settings > Export JSON** in the extension or the desktop app, and **Import JSON** to load it elsewhere. This is also how you move history from the extension to the desktop app.

| | How to remove | What happens to your history |
| --- | --- | --- |
| **Extension** | Remove it on `chrome://extensions` | **Deleted** with the extension. Export first. |
| **Desktop app (Windows)** | Settings > Apps > mouStache > Uninstall | **Kept** in `%APPDATA%\mouStache` so a reinstall finds it. Delete that folder to wipe it. |
| **Desktop app (macOS)** | Drag the app to the Bin | Kept in `~/Library/Application Support/mouStache` (untested path). Delete it to wipe the history. |

## Troubleshooting

| Problem | Likely cause and fix |
| --- | --- |
| **Extension saves nothing from a page** | The site is on the paused list (**Settings**, default includes password managers and sign-in pages), or the text looks like a secret (skipped on purpose). If the tab was open before you installed or reloaded the extension, reload the tab. |
| **A shortcut does nothing** | Another program or the browser owns that combination. Extension: change it at `chrome://extensions/shortcuts`. Desktop app: **Settings > Desktop** shows an error if the system refused it; pick another combination. |
| **Desktop app doesn't save a copy** | Capture is paused (tray menu), the copy came from a paused app or a password manager (not saved on purpose), it looks like a secret, it is over 500 KB, or it was made while the mouStache panel was in front. Copying the exact same text twice in a row isn't seen as a new copy. |
| **Palette picks the item but nothing is pasted** | Windows doesn't allow typing into windows running as administrator. The item is still on the clipboard, so press `Ctrl+V`. On a Mac, grant the Accessibility permission. |
| **"Windows protected your PC"** | The installer is unsigned (no certificate yet). See [running the installer](#desktop-app-windows). |
| **Settings shows the bridge port is in use** | Another program uses `47821`. Close it, or choose a different port in **both** the desktop app (**Settings > Browser extension**) and the extension (**Settings > Desktop app**). |
| **Test connection says "Wrong token, or that port is not the mouStache app"** | The token was copied before it was regenerated, or something else listens on that port. Copy the current token from the app and paste it again. |
| **The `Saved` pill is distracting** | **Settings > Presence**, choose **Tray only** or **Off**. |
| **The tray icon is missing** | Windows hides new tray icons in the `^` overflow menu. Drag it out onto the taskbar. |
| **A build fails** | Use Node.js 24, run `npm install` again, and on Windows run commands from a normal PowerShell in the repo folder. `npm run typecheck` and `npm test` should both pass before you build. |

## Develop and test

Run everything from the repo root. On Windows use PowerShell with an **uppercase drive letter** (`D:\...`), because a lowercase `/d/...` path makes Vitest fail with "failed to find the runner".

```bash
# extension
npm run dev        # dev browser with the extension (HMR)
npm run build      # production build -> .output/chrome-mv3
npm run zip        # store-ready zip
npm test           # unit tests (Vitest, fake-indexeddb), includes the desktop unit tests
npm run typecheck  # extension + desktop
npm run e2e        # builds, then drives the real extension with Playwright
npm run icons      # regenerates the extension icons, tray frames and installer icons
node scripts/gen-brand.mjs   # regenerates docs/banner.svg and docs/mascot-moods.svg

# desktop app
npm run desktop:dev           # run the app with hot reload
npm run desktop:e2e           # builds with test hooks, then runs the Electron end-to-end tests
npm run desktop:pack          # release build as an unpacked app in release/
npm run desktop:dist:win      # Windows installer in release/
npm run desktop:e2e:packaged  # smoke-tests the packaged app
npm run desktop:dist:mac      # macOS dmg + zip (run on a Mac or in CI)
```

- **Unit tests** (665) cover the classifier fixtures (about 110 real IT snippets), the database, import validation, the content-script helpers, the panel logic, and the desktop clipboard watcher, paste helpers and extension bridge.
- **Extension end-to-end tests** (14) load the built extension into Playwright's Chromium and check capture, the Copy-button hook, secrets, paused sites, forged events, search, pin and delete with undo, the palette, screenshots, theme switching, export and the desktop bridge. Set `HEADED=1` to watch. The first run needs `npx playwright install chromium`.
- **Desktop end-to-end tests** (55, plus 7 for the packaged app) launch the real Electron app with a fake clipboard, pinned foreground app and recorded (never sent) paste commands, so they never touch your real clipboard or type into your windows. They cover capture, secrets and password-manager skips, the tray and pill, the palette, hotkeys, region screenshots, the extension bridge and its security checks.
- **Desktop builds:** `desktop:e2e` uses a *test* build that contains test-only hooks. Release builds (`desktop:pack`, `desktop:dist:*`) are checked to contain none of them. Details are in [desktop/README.md](desktop/README.md).
- Preview without installing: `sidepanel.html?demo=1` seeds sample items. Add `&many=1` for about 1,500 items, or `&theme=dark&density=compact&text=large&motion=on` to preset the comfort settings.

**Stack:** WXT, React 18, TypeScript (strict), Tailwind CSS v4, Dexie, Shiki, Vitest, Playwright.

## How it works

```mermaid
flowchart LR
  P["Web page<br/>copy events + site Copy buttons"] --> C["Content script<br/>(closed shadow root)"]
  C -->|save-text / save-image| B["Background service worker"]
  M["Right-click menu<br/>and shortcuts"] --> B
  B --> K["Classifier<br/>tags, language, secrets"]
  K --> D[("IndexedDB<br/>Dexie")]
  D --> S["Side panel<br/>React app"]
  D --> Q["Quick palette<br/>on any page"]
  B -. "badge count" .-> T["Toolbar icon"]
```

- The background service worker owns saving: it dedupes by content hash, classifies, applies the pause list and the secret guard, then writes to IndexedDB and updates the badge.
- The side panel reads the database directly and refreshes live when items change.
- A small script in the page's own context hooks `navigator.clipboard` so a site's "Copy" button is captured too, then hands the text to the content script.

The desktop app reuses the extension's classifier, database and panel, and adds the system clipboard watcher, the global palette and the optional bridge to the extension:

```mermaid
flowchart LR
  A["Any app<br/>VS Code, Cursor, terminal, chat"] -->|system clipboard| W["Clipboard watcher<br/>skips secrets and password managers"]
  W --> E["Engine window<br/>classifier + IndexedDB"]
  X["Browser extension<br/>(optional, paired)"] -->|"127.0.0.1, token handshake"| E
  E --> P["Panel"]
  E --> Q["Global palette<br/>Alt+Shift+V"]
  Q -->|"paste into the app you came from"| A
  W -. "tray icon + Saved pill" .-> T["Tray"]
```

```text
entrypoints/   background service worker, content script, side panel, page-context hook
components/    panel, overlay (palette, toast, region select) and shared UI (logo, mascot, icons)
lib/           types, Dexie db, classifier, settings, messaging, bridge protocol, thumbnails, platform hints
lib/brand/     the shared moustache shape used by the logo, icons and mascot
desktop/       the Electron desktop app: main process, preload, renderers, tray frames, installer assets
styles/        design tokens and the Tailwind theme
scripts/       icon, brand-graphics and release-check scripts
tests/e2e/     Playwright end-to-end suite for the extension
tests/desktop/ Electron end-to-end suites (app, bridge, security, packaged build)
.github/       the Desktop installer workflow (not run yet)
docs/          banner, screenshots, roadmap and handoff notes
```

## Brand

The mark is a handlebar moustache on a clipboard card: stacked bars for the "stash", a white card, and a moustache for the name. The same shape is used for the toolbar icons, the in-app logo and the mascot.

<p align="center">
  <img src="docs/logo-256.png" alt="mouStache logo, 256 px" width="128">
  &nbsp;&nbsp;
  <img src="public/icon/128.png" alt="128 px icon" width="96">
  &nbsp;&nbsp;
  <img src="public/icon/48.png" alt="48 px icon" width="48">
  &nbsp;&nbsp;
  <img src="public/icon/32.png" alt="32 px icon" width="32">
  &nbsp;&nbsp;
  <img src="public/icon/16.png" alt="16 px icon" width="16">
</p>

**Colour:** a blue to indigo gradient (`#0A84FF` to `#5E5CE6`) with a deeper blue ink (`#3458F0`) on a white card. **Type:** the system font (SF Pro on Apple devices, Segoe UI Variable on Windows) with JetBrains Mono for code.

The mascot is just the moustache. It has no face and shows how it feels by moving its two halves, and it holds still when Reduce motion is on:

<p align="center">
  <img src="docs/mascot-moods.svg" alt="The mouStache mascot: idle, happy and drooping" width="85%">
</p>

## Desktop app

> **Status: in development, pre-release.** It is not on any store and there is no public download yet. You can build the installer yourself or take it from a CI run (see below). It has only been tested on Windows 11; the macOS build is written but **untested**.

A browser extension can't see copies made in VS Code, Cursor, a terminal or an LLM desktop app. The desktop app (in [`desktop/`](desktop/README.md)) runs the same panel outside the browser and keeps one history across all of them.

<p align="center">
  <img src="docs/screenshots/desktop-panel.png" alt="The mouStache desktop panel with a made-up history" width="31%">
  <img src="docs/screenshots/desktop-palette.png" alt="The quick palette over another app" width="62%">
</p>

**What it adds**

- **System clipboard capture** for every app, with the same classification, tags and search. It never saves password-manager entries, secrets (API keys, tokens), text over 500 KB, its own clipboard writes, or copies made while a paused app (1Password, Bitwarden, KeePass, LastPass, Dashlane by default) is in front.
- **Tray icon** with a state that shows idle, just-captured, paused or needs-attention, a tooltip with the item count, and a menu (Open, Pause, Quick palette, Region screenshot, Settings, Launch at login, Quit). A small `Saved · SQL` pill (never the copied text) appears in a screen corner; choose Off, Tray only or Blip in Settings > Presence.
- **Quick palette on `Alt+Shift+V`** over whatever you are doing. `Enter` pastes into the app you came from, `Shift+Enter` only copies, `Ctrl+Enter` pastes as a fenced code block.
- **Region screenshot on `Alt+Shift+S`**: drag a region and it is saved as an image item. Both shortcuts can be changed in Settings > Desktop.
- **Pairing with the extension** (optional): in the app open Settings > Browser extension and copy the token; in the extension open Settings > Desktop app, turn it on and paste it. Copies made on web pages then reach the app together with the page they came from.

<p align="center">
  <img src="docs/screenshots/desktop-settings-presence.png" alt="Settings, Presence group" width="31%">
  <img src="docs/screenshots/desktop-settings-extension.png" alt="Settings, Browser extension pairing (token masked)" width="31%">
  <img src="docs/screenshots/desktop-blip.png" alt="The Saved pill" width="31%">
</p>

**Installing it:** see [Install > Desktop app (Windows)](#desktop-app-windows), [pairing with the extension](#pair-the-extension-with-the-desktop-app) and [macOS](#desktop-app-macos). To move your history over, use Settings > Export JSON in the extension, then Settings > Import JSON in the desktop app.

**Privacy.** Everything stays on your computer. The app makes no network requests. The only network listener is the extension bridge, bound to `127.0.0.1` (default port 47821). It answers only requests that carry your token and come from the extension. The extension sends nothing to it until you turn it on and paste the token.

**Limits you should know about**

- **macOS is untested.** The code exists (tray template icons, `osascript` paste, Accessibility permission flow, Screen Recording for screenshots) but nobody has run it on a Mac yet.
- **Windows:** paste cannot type into windows running as administrator (Windows blocks it); the item is still copied. Windows may refuse to give focus back to the previous app in rare cases.
- **Builds are unsigned**, there is no auto-update, and nothing is on a store.
- Fullscreen and Do Not Disturb are not detected (pick Tray only if the pill gets in the way). Copying the exact same text twice in a row is not seen as a new copy.
- Not yet verified by real use: pasting into Cursor, VS Code and terminals, and a real Chrome profile talking to an installed app.

Build and release details: [desktop/README.md](desktop/README.md). Plan and status: [docs/desktop-roadmap.md](docs/desktop-roadmap.md). What the desktop app protects and what it does not: "Security model and known limits" in [desktop/README.md](desktop/README.md).
