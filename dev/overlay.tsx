import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import './harness.css';
import { overlayStore } from '../lib/content/store';
import { OverlayRoot } from '../components/overlay/OverlayRoot';

const p = new URLSearchParams(location.search);
if (p.get('theme') === 'dark') {
  document.documentElement.style.colorScheme = 'dark';
}
createRoot(document.getElementById('root')!).render(createElement(OverlayRoot));
const view = p.get('view') ?? 'palette';
setTimeout(() => {
  if (view === 'palette') overlayStore.openPalette(document.querySelector('textarea'));
  if (view === 'toast') overlayStore.showToast('Copied');
  if (view === 'region') overlayStore.startRegion();
}, 100);
(window as unknown as { overlayStore: typeof overlayStore }).overlayStore = overlayStore;
