import { browser } from 'wxt/browser';
import { sendToTab } from '../messaging';
import { captureVisible, sourceFromTab, type StashTab } from './router';
import { saveImageFromUrl, saveText } from './save';

export const MENU = {
  selection: 'stash-save-selection',
  image: 'stash-save-image',
  link: 'stash-save-link',
  page: 'stash-save-page',
  sep: 'stash-sep',
  visible: 'stash-shot-visible',
  region: 'stash-shot-region',
} as const;

export async function createMenus(): Promise<void> {
  await browser.contextMenus.removeAll();
  const mk = (id: string, title: string, contexts: string[], type?: 'separator') =>
    browser.contextMenus.create({ id, title, contexts, ...(type ? { type } : {}) } as never);
  mk(MENU.selection, 'Save selection to mouStache', ['selection']);
  mk(MENU.image, 'Save image to mouStache', ['image']);
  mk(MENU.link, 'Save link to mouStache', ['link']);
  mk(MENU.page, 'Save page link to mouStache', ['page']);
  mk(MENU.sep, '', ['page'], 'separator');
  mk(MENU.visible, 'Screenshot visible area', ['page']);
  mk(MENU.region, 'Screenshot a region…', ['page']);
}

export interface MenuClickInfo {
  menuItemId: string | number;
  selectionText?: string;
  srcUrl?: string;
  linkUrl?: string;
  pageUrl?: string;
}

export async function handleMenuClick(info: MenuClickInfo, tab?: StashTab): Promise<void> {
  const source = sourceFromTab(tab);
  const tabId = tab?.id;
  switch (info.menuItemId) {
    case MENU.selection:
      if (info.selectionText) await saveText(info.selectionText, source, 'context-menu', tabId);
      break;
    case MENU.image:
      if (info.srcUrl) await saveImageFromUrl(info.srcUrl, source, 'context-menu', tabId);
      break;
    case MENU.link:
      if (info.linkUrl) await saveText(info.linkUrl, source, 'context-menu', tabId);
      break;
    case MENU.page: {
      const url = info.pageUrl ?? tab?.url;
      if (url) await saveText(url, source, 'context-menu', tabId);
      break;
    }
    case MENU.visible:
      await captureVisible({ tab });
      break;
    case MENU.region:
      if (tabId !== undefined) await sendToTab(tabId, { type: 'start-region-select' }).catch(() => {});
      break;
  }
}
