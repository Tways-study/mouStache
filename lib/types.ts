export type ItemKind = 'text' | 'image' | 'link';

export interface StashSource {
  url?: string;
  title?: string;
  favicon?: string;
}

export interface StashItem {
  id: string;
  kind: ItemKind;
  text?: string;
  imageBlob?: Blob;
  thumbBlob?: Blob;
  width?: number;
  height?: number;
  mime?: string;
  tags: string[];
  lang?: string;
  source?: StashSource;
  pinned: boolean;
  secret: boolean;
  hash: string;
  createdAt: number;
  updatedAt: number;
  via: 'copy' | 'context-menu' | 'screenshot' | 'paste' | 'import';
}

export type TagGroup = 'code' | 'prompt' | 'image' | 'link' | 'network' | 'error' | 'data' | 'other';

export interface Classification {
  tags: string[];
  lang?: string;
  secret: boolean;
  group: TagGroup;
}

export type ThemeSetting = 'system' | 'light' | 'dark';
export type TextSize = 'small' | 'default' | 'large' | 'xlarge';
export type Density = 'comfortable' | 'compact';
export type ReduceMotion = 'system' | 'on' | 'off';
/** Delete unpinned items older than this many days; 0 = never. */
export type CleanupDays = 0 | 7 | 30 | 90;

/** Desktop app only (the extension ignores these): how the on-screen "Saved" confirmation behaves. */
export type BlipMode = 'off' | 'tray' | 'blip';
export type BlipPosition = 'bottom-right' | 'bottom-left' | 'top-right';
export type BlipDuration = 'short' | 'normal' | 'long';

export interface Settings {
  autoCapture: boolean;
  showToast: boolean;
  pausedHosts: string[];
  skipSecrets: boolean;
  maxItems: number;
  // comfort
  theme: ThemeSetting;
  textSize: TextSize;
  density: Density;
  reduceMotion: ReduceMotion;
  /** Count unseen captures on the toolbar badge. */
  badgeCount: boolean;
  autoCleanupDays: CleanupDays;
  // desktop app only (see docs/desktop-ambient-presence.md); harmless extra keys in the extension
  /** Apps whose copies are never captured (matched against the foreground app's name). */
  pausedApps: string[];
  blipMode: BlipMode;
  blipPosition: BlipPosition;
  blipDuration: BlipDuration;
  /** macOS menu-bar text with today's count. */
  menuBarCount: boolean;
  /** Stored only for now: a weekly summary notification. */
  weeklySummary: boolean;
  /** Global shortcuts (Electron accelerator syntax). Desktop app only. */
  hotkeyPalette: string;
  hotkeyScreenshot: string;
  /**
   * Extension: forward saves to the desktop app (off until paired). Desktop: `bridgePort` is the port to listen on.
   * See lib/bridge.ts.
   */
  bridgeEnabled: boolean;
  bridgeToken: string;
  bridgePort: number;
}

export const DEFAULT_SETTINGS: Settings = {
  autoCapture: true,
  showToast: true,
  pausedHosts: [
    '1password.com',
    'bitwarden.com',
    'vault.bitwarden.com',
    'lastpass.com',
    'dashlane.com',
    'pass.proton.me',
    'keepersecurity.com',
    'accounts.google.com',
    'login.microsoftonline.com',
    'login.live.com',
  ],
  skipSecrets: true,
  maxItems: 2000,
  theme: 'system',
  textSize: 'default',
  density: 'comfortable',
  reduceMotion: 'system',
  badgeCount: true,
  autoCleanupDays: 0,
  pausedApps: ['1Password', 'Bitwarden', 'KeePass', 'LastPass', 'Dashlane'],
  blipMode: 'blip',
  blipPosition: 'bottom-right',
  blipDuration: 'normal',
  menuBarCount: false,
  weeklySummary: false,
  hotkeyPalette: 'Alt+Shift+V',
  hotkeyScreenshot: 'Alt+Shift+S',
  bridgeEnabled: false,
  bridgeToken: '',
  bridgePort: 47821,
};
