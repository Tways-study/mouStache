import { defineContentScript } from 'wxt/utils/define-content-script';

/**
 * MAIN-world hook: sites like GitHub / ChatGPT / StackOverflow copy via
 * navigator.clipboard.writeText (no `copy` event). Wrap it and relay the text to
 * the isolated content script via window.postMessage.
 * NOTE: kept self-contained (no imports from shared modules) so it stays tiny.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'MAIN',
  allFrames: false,
  main() {
    const TAG = 'stash-hook'; // must match lib/content/hook-protocol.ts
    const post = (text: unknown) => {
      if (typeof text === 'string' && text.trim()) {
        try {
          window.postMessage({ source: TAG, text }, '*');
        } catch {
          /* ignore */
        }
      }
    };

    try {
      const proto = Clipboard.prototype;

      const origWriteText = proto.writeText;
      proto.writeText = function (this: Clipboard, data: string) {
        const result = origWriteText.call(this, data);
        // only relay after the write actually succeeded
        Promise.resolve(result).then(() => post(data), () => undefined);
        return result;
      };

      const origWrite = proto.write;
      proto.write = function (this: Clipboard, items: ClipboardItems) {
        const result = origWrite.call(this, items);
        Promise.resolve(result).then(
          async () => {
            try {
              for (const item of items) {
                if (item.types.includes('text/plain')) {
                  post(await (await item.getType('text/plain')).text());
                  break;
                }
              }
            } catch {
              /* ignore */
            }
          },
          () => undefined,
        );
        return result;
      };
    } catch {
      /* Clipboard API unavailable (insecure context) */
    }
  },
});
