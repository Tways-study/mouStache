// The shim MUST be evaluated first: `wxt/browser` reads globalThis.chrome when it is imported.
import './chrome-shim';
// Styles with Tailwind pointed at the shared folders (see sources.css).
import './sources.css';
// Reuse the extension's side panel verbatim (applies cached appearance, mounts <App/>).
import '@/entrypoints/sidepanel/main';

// Tray > Settings: main sends {type:'open-settings'}; the shared App listens for this DOM event.
(globalThis as unknown as { chrome?: { runtime?: { onMessage?: { addListener(l: (m: unknown) => void): void } } } }).chrome?.runtime?.onMessage?.addListener((m) => {
  if ((m as { type?: string } | null)?.type === 'open-settings') window.dispatchEvent(new CustomEvent('stash:open-settings'));
});
