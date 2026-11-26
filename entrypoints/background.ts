import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { registerBadgeSettings, registerPanelPorts } from '../lib/background/badge';
import { registerCleanup } from '../lib/background/cleanup';
import { handleCommand } from '../lib/background/commands';
import { createMenus, handleMenuClick, type MenuClickInfo } from '../lib/background/menus';
import { registerMessageRouter } from '../lib/background/router';

export default defineBackground(() => {
  const setup = () => {
    browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  };
  const init = () => {
    setup();
    createMenus().catch((e) => console.warn('[stash] menus', e));
  };
  setup();

  browser.runtime.onInstalled.addListener(init);
  browser.runtime.onStartup.addListener(init);

  browser.contextMenus.onClicked.addListener((info, tab) => {
    handleMenuClick(info as MenuClickInfo, tab).catch((e) => console.error('[stash] menu click', e));
  });
  browser.commands.onCommand.addListener((command, tab) => {
    handleCommand(command, tab).catch((e) => console.error('[stash] command', e));
  });

  registerPanelPorts();
  registerBadgeSettings();
  registerCleanup();
  registerMessageRouter();
});
