import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'mouStache',
    description: 'Keep your clipboard well-groomed — built for IT students.',
    permissions: [
      'storage',
      'alarms',
      'unlimitedStorage',
      'contextMenus',
      'sidePanel',
      'clipboardRead',
      'clipboardWrite',
      'activeTab',
      'scripting',
      'tabs',
    ],
    minimum_chrome_version: '116',
    host_permissions: ['<all_urls>'],
    side_panel: { default_path: 'sidepanel.html' },
    action: {
      default_title: 'Open mouStache',
      default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    },
    commands: {
      'open-palette': {
        suggested_key: { default: 'Alt+Shift+V', mac: 'Alt+Shift+V' },
        description: 'Open mouStache quick palette',
      },
      'capture-region': {
        suggested_key: { default: 'Alt+Shift+S', mac: 'Alt+Shift+S' },
        description: 'Screenshot a region to mouStache',
      },
    },
  },
});
