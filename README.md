# mouStache

Your clipboard, well-groomed — a Chrome/Edge (MV3) extension for IT students. mouStache collects what you copy (text, code, prompts, images, screenshots), auto-tags it, and keeps it searchable in a side panel. Everything is stored locally in IndexedDB; export/import as JSON.

Stack: WXT, React 18, TypeScript (strict), Tailwind CSS v4, Dexie, Vitest.

## Develop

```bash
npm install
npm run dev        # launches a dev browser with the extension (HMR)
npm run build      # production build -> .output/chrome-mv3
npm run zip        # store-ready zip
npm test           # vitest (fake-indexeddb)
npm run typecheck
```

## Load unpacked (Chrome / Edge)

1. `npm run build`
2. Open `chrome://extensions` (or `edge://extensions`), enable Developer mode.
3. Click "Load unpacked" and select `.output/chrome-mv3`.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| Alt+Shift+V (Option+Shift+V on Mac) | Open the quick palette |
| Alt+Shift+S (Option+Shift+S on Mac) | Screenshot a region to mouStache |

In the panel: `/` search (or just type), `J`/`K` move, `Enter` copy, `P` pin, `E` details, `Del` delete (4 s undo), `?` cheat sheet.

On macOS the same shortcuts use Option (⌥⇧V and ⌥⇧S), hints in the panel and palette show ⌘/⌥/⇧ symbols automatically, and the "paste a screenshot" tip becomes ⌘⌃⇧4 (macOS copies the selected region to the clipboard). Works in Chrome and Edge on macOS, Windows and Linux; Safari is not supported.

Change them at `chrome://extensions/shortcuts`. Clicking the toolbar icon opens the side panel.

## Comfort (built for long sessions)

Open Settings > Comfort. Everything applies live in the panel and on pages.

- Theme (System / Light / Dark), text size (Small to Extra large), density (Comfortable cards or Compact one-line rows), reduce motion (System / On / Off), and Quiet mode (no on-page toast, no toolbar badge count).
- The list is virtualised, so thousands of items stay smooth. Date sections are sticky and collapsible (click the title; a large "Earlier" starts collapsed).
- mouStache remembers your filter, search, scroll position and collapsed sections when the panel closes and reopens (browser session only). A "Top" / "N new" pill appears when you scroll far down.
- Just start typing to search; recent searches show under the search field. Long cards have an inline "Show more".
- Storage: auto-delete unpinned items older than 7 / 30 / 90 days (daily alarm, never touches pinned), "Clean up screenshots" (unpinned images older than 30 days), and a live "N items, ~X MB" line.
- Demo/preview URLs: `sidepanel.html?demo=1&many=1` seeds ~1,500 items; `&density=compact&text=large&theme=dark&motion=on` preset the comfort settings.

## Layout

- `entrypoints/` background service worker, content script, side panel
- `lib/` types, Dexie db, settings, hashing, typed messaging
- `styles/tokens.css` design tokens; `styles/app.css` Tailwind theme wired to them
- `scripts/gen-icons.mjs` regenerates placeholder icons (`npm run icons`)

## Testing

- `npm test` runs the unit tests (Vitest).
- `npm run e2e` builds the extension and runs the end-to-end suite: it loads `.output/chrome-mv3` into Playwright's Chromium and drives real pages, the side panel and the palette. Set `HEADED=1` to watch it, and open `playwright-report/` or `test-results/` after a failure. First run needs `npx playwright install chromium`.
