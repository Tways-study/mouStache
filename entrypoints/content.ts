import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { browser } from 'wxt/browser';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import '@/styles/app.css';
import { isStashMessage, send } from '@/lib/messaging';
import { getSettings, onSettingsChanged } from '@/lib/settings';
import type { Appearance } from '@/lib/appearance';
import { overlayStore } from '@/lib/content/store';
import { createDedupe, createRateLimit } from '@/lib/content/debounce';
import { deepActiveElement, extractCopiedText, hasUserActivation, isSensitiveField } from '@/lib/content/selection';
import { isStashWriting } from '@/lib/content/clipboard';
import { OverlayRoot } from '@/components/overlay/OverlayRoot';
import { HOOK_SOURCE } from '@/lib/content/hook-protocol';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: false,
  cssInjectionMode: 'ui',
  main(ctx) {
    // double-injection guard (isolated world: expandos here are invisible to the page)
    const w = window as unknown as { __stashLoaded?: boolean };
    if (w.__stashLoaded) return;
    w.__stashLoaded = true;

    let overlayHost: HTMLElement | null = null;
    let overlayRoot: Root | null = null;
    let appearance: Appearance = { theme: 'system', textSize: 'default', reduceMotion: 'system' };
    const renderOverlay = () => overlayRoot?.render(createElement(OverlayRoot, { appearance }));
    const setAppearance = (s: Appearance) => {
      if (s.theme === appearance.theme && s.textSize === appearance.textSize && s.reduceMotion === appearance.reduceMotion) return;
      appearance = { theme: s.theme, textSize: s.textSize, reduceMotion: s.reduceMotion };
      renderOverlay();
    };
    // keep the overlay's look live with Settings (theme, text size, reduce motion)
    void getSettings().then(setAppearance, () => undefined);
    const offSettings = onSettingsChanged(setAppearance);
    // ---------- lazy shadow-root overlay ----------
    let mounting: Promise<void> | null = null;
    const ensureMounted = (): Promise<void> => {
      mounting ??= (async () => {
        const ui = await createShadowRootUi<Root>(ctx, {
          name: 'stash-overlay',
          mode: 'closed',
          position: 'inline',
          anchor: 'body',
          append: 'last',
          // keep keystrokes typed in the palette away from host-page (bubbling) shortcuts
          isolateEvents: ['keydown', 'keyup', 'keypress'],
          onMount(container) {
            const root = createRoot(container);
            overlayRoot = root;
            renderOverlay();
            return root;
          },
          onRemove(root) {
            root?.unmount();
          },
        });
        overlayHost = ui.shadowHost;
        ui.shadowHost.style.cssText =
          'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;display:block!important;';
        ui.mount();
      })().catch((err) => {
        mounting = null;
        throw err;
      });
      return mounting;
    };

    const withOverlay = (fn: () => void) => {
      void ensureMounted().then(fn, () => undefined);
    };

    // ---------- copy capture ----------
    const shouldSave = createDedupe(1000);
    const withinLimit = createRateLimit(10, 10_000);
    const inOverlay = (el: Element | null | undefined) =>
      !!el && (el === overlayHost || el.tagName?.toLowerCase() === 'stash-overlay');
    const save = (text: string) => {
      if (!shouldSave(text)) return;
      if (!withinLimit()) return; // anti-flood: drop silently
      void send({
        type: 'save-text',
        text,
        source: { url: location.href, title: document.title },
      }).catch(() => undefined); // extension reloaded / context invalidated
    };

    const onCopy = (e: Event) => {
      if (!e.isTrusted) return;
      if (isStashWriting()) return;
      // ignore copies from our own palette (closed shadow root retargets to the host)
      const t = e.target as Element | null;
      if (inOverlay(t) || e.composedPath().some((n) => inOverlay(n as Element))) return;
      if (isSensitiveField(t) || isSensitiveField(deepActiveElement())) return;
      // read synchronously: for "cut" the selection is gone right after the event
      const text = extractCopiedText(window);
      if (text) save(text);
    };
    document.addEventListener('copy', onCopy, true);
    document.addEventListener('cut', onCopy, true);

    // programmatic copies relayed from the MAIN-world hook (clipboard-hook.content.ts)
    const onHookMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as { source?: unknown; text?: unknown } | null;
      if (!data || data.source !== HOOK_SOURCE || typeof data.text !== 'string') return;
      if (isStashWriting()) return;
      if (!hasUserActivation()) return;
      if (inOverlay(document.activeElement) || isSensitiveField(deepActiveElement())) return;
      const text = data.text;
      if (!text.trim() || text.length > 200_000) return;
      save(text);
    };
    window.addEventListener('message', onHookMessage);

    // ---------- background -> content ----------
    const onMessage = (msg: unknown, _sender: unknown, sendResponse: (r?: unknown) => void): boolean => {
      if (!isStashMessage(msg)) return false;
      switch (msg.type) {
        case 'show-toast': {
          const text = msg.text;
          withOverlay(() => overlayStore.showToast(text));
          sendResponse({ ok: true });
          break;
        }
        case 'open-palette': {
          // capture focus before React/our input steals it
          const prev = deepActiveElement();
          withOverlay(() => overlayStore.togglePalette(prev));
          sendResponse({ ok: true });
          break;
        }
        case 'start-region-select':
          withOverlay(() => overlayStore.startRegion());
          sendResponse({ ok: true });
          break;
      }
      return false; // responded synchronously (or nothing to respond to)
    };
    browser.runtime.onMessage.addListener(onMessage as Parameters<typeof browser.runtime.onMessage.addListener>[0]);

    ctx.onInvalidated(() => {
      offSettings();
      document.removeEventListener('copy', onCopy, true);
      document.removeEventListener('cut', onCopy, true);
      window.removeEventListener('message', onHookMessage);
      browser.runtime.onMessage.removeListener(onMessage as Parameters<typeof browser.runtime.onMessage.removeListener>[0]);
    });
  },
});
