/** Detection + typed access to the desktop app's bridge. Everything is a no-op in the extension. */

export interface BridgeInfo {
  status: 'listening' | 'error';
  port?: number;
  preferredPort: number;
  error?: string;
  token: string;
  version: string;
}

export const DESKTOP_RUNTIME_ID = 'mou-stache-desktop';

/** Desktop OS integration exposed by the Electron preload as `window.mouDesktop`. */
export interface DesktopBridge {
  getLoginItem(): Promise<boolean>;
  setLoginItem(open: boolean): Promise<void>;
  /** Extension bridge status and pairing token (only the panel window gets an answer). */
  getBridgeInfo(): Promise<BridgeInfo | undefined>;
  regenerateBridgeToken(): Promise<BridgeInfo | undefined>;
  /** Result of the last attempt to register the global shortcuts (Settings shows the error, if any). */
  getHotkeyStatus(): Promise<{
    palette: { requested: string; active?: string; ok: boolean; error?: string };
    screenshot: { requested: string; active?: string; ok: boolean; error?: string };
  }>;
}

/** True inside the Electron app: the chrome shim gives `runtime.id` a fixed value (no user-agent sniffing). */
export function isDesktopApp(): boolean {
  try {
    return (globalThis as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime?.id === DESKTOP_RUNTIME_ID;
  } catch {
    return false;
  }
}

export function desktopBridge(): DesktopBridge | undefined {
  if (!isDesktopApp()) return undefined;
  return (globalThis as { mouDesktop?: DesktopBridge }).mouDesktop;
}
