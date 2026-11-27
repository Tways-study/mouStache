# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Product: Chrome / Edge Manifest V3 extension (WXT, React 18, TypeScript, Tailwind) and an Electron desktop app (`desktop/`). Marketing site: static HTML/CSS with small vanilla JS in `docs/`, served by GitHub Pages.

## Users

IT students who copy all day while studying: a `docker run` line, a subnet, a stack trace, a SQL query, a prompt they spent ten minutes on. They work across browser tutorials, docs, labs (Cisco, Hack The Box), editors (VS Code, Cursor), terminals and LLM chat apps, often in long sessions.

## Product Purpose

A clipboard manager that saves what you copy, tags it automatically, previews code properly, and puts it back with one shortcut. Success: a student finds and re-pastes something they copied hours or days ago in seconds, without hunting through tabs.

## Positioning

It understands IT content: it tells a Cisco command from a CIDR block from a Python function and tags each one, locally, with no network calls. A Spotlight-style palette (`Alt+Shift+V`) pastes back into the field or app you came from. Everything stays on the device.

## Operating Context

Browser side panel (Chrome / Edge), toolbar badge, in-page quick palette in a closed shadow root, right-click capture, region screenshots (`Alt+Shift+S`). Desktop app: system clipboard capture for every app, tray icon with states, a small `Saved · SQL` pill, global palette, optional loopback bridge to the extension.

## Capabilities and Constraints

- Auto-tagging groups: Code (15 languages, shell, JSON/YAML), Network (IPv4/IPv6, CIDR, subnet masks, MAC, ports, Cisco IOS), Errors (messages, stack traces), Prompts, Links, Data (regex, hex colours, UUIDs, hashes, base64, Unix timestamps), Secrets (API keys, tokens, JWTs, blurred until revealed).
- Search, type filters, pin, delete with undo, tag editing, copy raw or as fenced Markdown, syntax highlighting with line numbers.
- Privacy: local only; secrets and password-manager pages skipped by default; secrets copied by mouStache are wiped from the clipboard after about 30 s; export / import JSON.
- Status: version 0.2.0, pre-release. Not on any store. Install by building from source (GitHub). Desktop app tested on Windows 11 only; macOS build untested; builds unsigned. Safari and Firefox unsupported.

## Brand Commitments

- Name is written `mouStache` (capital S).
- Mark: a handlebar moustache on a clipboard card (stacked bars, white card, moustache) on a blue to indigo gradient `#0A84FF` to `#5E5CE6`, ink `#3458F0`. Files: `public/logo.svg`, `docs/logo-256.png`.
- Mascot is just the moustache, no face; it emotes by moving its two halves (idle, happy, droop). `docs/mascot-moods.svg`, `lib/brand/moustache.mjs`.
- Type in product: the system font plus JetBrains Mono for code. Tagline from the README banner: "your clipboard, well-groomed".

## Evidence on Hand

- Real screenshots: `docs/screenshots/*.png` (panel light/dark, detail sheet, quick palette over a page light/dark, desktop panel and palette, Saved blip, settings, empty and no-results states).
- 15 s promo video: `video/renders/moustache-15s.mp4`.
- Test counts in README badges (665 unit, 14 + 55 e2e).
- Absent, must not be fabricated: testimonials, user counts, ratings, store listings, pricing, press, download numbers.

## Product Principles

1. Understands IT content first; generic clipboard features are table stakes.
2. Local and quiet: privacy is a default, not a setting.
3. One shortcut to get it back, wherever you are.
4. Honest about status: pre-release, build from source.
