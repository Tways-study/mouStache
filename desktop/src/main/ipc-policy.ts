/**
 * IPC least privilege (security review F7). "Is the sender one of our own pages?" is not enough: the blip pill and the
 * screenshot overlay have no business calling set-login, open-external or the engine channels. Every renderer -> main
 * channel is therefore bound to the window ROLES that legitimately use it, and messages routed to the engine are
 * limited per role too. Pure table + functions so the policy itself is unit-tested; index.ts enforces it.
 */
import { CH } from '../shared/api';

export type WindowRole = 'panel' | 'engine' | 'blip' | 'palette' | 'region';

/** Channels a renderer can invoke (main -> renderer pushes are not listed). */
export type RendererChannel =
  | typeof CH.send
  | typeof CH.engineReady
  | typeof CH.engineReply
  | typeof CH.settings
  | typeof CH.ownWrite
  | typeof CH.openExternal
  | typeof CH.getLogin
  | typeof CH.setLogin
  | typeof CH.paletteChoose
  | typeof CH.paletteClose
  | typeof CH.paletteReady
  | typeof CH.regionDone
  | typeof CH.regionCancel
  | typeof CH.hotkeyStatus
  | typeof CH.bridgeInfo
  | typeof CH.bridgeRegenerate
  | typeof CH.writeSecret;

export const IPC_POLICY: Readonly<Record<RendererChannel, readonly WindowRole[]>> = {
  // runtime.sendMessage: the panel and palette talk to the engine; the engine broadcasts items-changed
  [CH.send]: ['panel', 'palette', 'engine'],
  // the engine's own plumbing
  [CH.engineReady]: ['engine'],
  [CH.engineReply]: ['engine'],
  [CH.settings]: ['engine'],
  // everything the Settings / main UI does
  [CH.ownWrite]: ['panel'],
  [CH.writeSecret]: ['panel'],
  [CH.openExternal]: ['panel'],
  [CH.getLogin]: ['panel'],
  [CH.setLogin]: ['panel'],
  [CH.hotkeyStatus]: ['panel'],
  [CH.bridgeInfo]: ['panel'],
  [CH.bridgeRegenerate]: ['panel'],
  // the palette and the screenshot overlay only get their own channels
  [CH.paletteChoose]: ['palette'],
  [CH.paletteClose]: ['palette'],
  [CH.paletteReady]: ['palette'],
  [CH.regionDone]: ['region'],
  [CH.regionCancel]: ['region'],
};

export function isAllowed(channel: string, role: WindowRole | undefined): boolean {
  if (!role) return false;
  const roles = (IPC_POLICY as Record<string, readonly WindowRole[] | undefined>)[channel];
  return !!roles && roles.includes(role);
}

/** Engine messages a role may send through `shim:send` (undefined = any message type). */
export const SEND_TYPES: Readonly<Partial<Record<WindowRole, readonly string[]>>> = {
  panel: undefined,
  engine: ['items-changed'],
  palette: ['search', 'copy-item'],
};

export function mayRoute(role: WindowRole | undefined, type: string | undefined): boolean {
  if (!isAllowed(CH.send, role)) return false;
  const types = SEND_TYPES[role!];
  return types === undefined || (type !== undefined && types.includes(type));
}
