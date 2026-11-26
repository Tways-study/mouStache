/** Tiny external store bridging the content script and the lazily-mounted React overlay. */

export interface OverlayState {
  toast: { id: number; text: string } | null;
  paletteOpen: boolean;
  /** Element focused before the palette opened (for paste + focus restore). */
  returnFocus: Element | null;
  regionActive: boolean;
}

let state: OverlayState = { toast: null, paletteOpen: false, returnFocus: null, regionActive: false };
const listeners = new Set<() => void>();
let toastId = 0;

function set(patch: Partial<OverlayState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const overlayStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  showToast(text: string) {
    set({ toast: { id: ++toastId, text } });
  },
  clearToast(id: number) {
    if (state.toast?.id === id) set({ toast: null });
  },
  openPalette(returnFocus: Element | null) {
    set({ paletteOpen: true, returnFocus, regionActive: false });
  },
  closePalette() {
    set({ paletteOpen: false });
  },
  togglePalette(returnFocus: Element | null) {
    if (state.paletteOpen) set({ paletteOpen: false });
    else set({ paletteOpen: true, returnFocus, regionActive: false });
  },
  startRegion() {
    set({ regionActive: true, paletteOpen: false });
  },
  endRegion() {
    set({ regionActive: false });
  },
};
