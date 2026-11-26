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
};
