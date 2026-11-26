/** Pure-ish helpers for extracting what the user just copied. */

export const MAX_COPY_LENGTH = 200_000;

type TextControl = HTMLInputElement | HTMLTextAreaElement;

/** Follow open shadow roots to the truly focused element. */
export function deepActiveElement(doc: Document = document): Element | null {
  let el: Element | null = doc.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

export function isTextControl(el: Element | null): el is TextControl {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

export function isPasswordLike(el: Element | null): boolean {
  if (!el) return false;
  if (el.tagName === 'INPUT') {
    const t = (el as HTMLInputElement).type?.toLowerCase();
    if (t === 'password') return true;
  }
  const ac = (el.getAttribute?.('autocomplete') ?? '').toLowerCase();
  if (ac.includes('password') || ac === 'one-time-code') return true;
  if ((el as HTMLElement).isContentEditable) {
    const hint = `${el.getAttribute('type') ?? ''} ${el.getAttribute('data-type') ?? ''} ${el.getAttribute('aria-label') ?? ''}`.toLowerCase();
    if (hint.includes('password')) return true;
  }
  return false;
}

function selectedInControl(el: TextControl): string {
  try {
    const { selectionStart: s, selectionEnd: e, value } = el;
    if (s == null || e == null || s === e) return '';
    return value.substring(s, e);
  } catch {
    return ''; // some input types (email, number) throw on selection access
  }
}

/**
 * Returns the text the user copied, or null when it should be ignored
 * (empty, password field, too large).
 */
export function extractCopiedText(win: Window = window): string | null {
  const doc = win.document;
  const active = deepActiveElement(doc);
  if (isPasswordLike(active)) return null;

  let text = win.getSelection()?.toString() ?? '';
  if (!text && isTextControl(active)) text = selectedInControl(active);
  if (!text.trim()) return null;
  if (text.length > MAX_COPY_LENGTH) return null;
  return text;
}

const SENSITIVE_FIELD = /otp|totp|one-time|2fa|mfa|secret|passw|cvv|card-?number|cc-/i;

/** True when the element's name/id/autocomplete (or password-like type) suggests a credential field. */
export function isSensitiveField(el: Element | null | undefined): boolean {
  if (!el || typeof el.getAttribute !== 'function') return false;
  if (isPasswordLike(el)) return true;
  return ['name', 'id', 'autocomplete'].some((a) => SENSITIVE_FIELD.test(el.getAttribute(a) ?? ''));
}

/** Transient user activation (click/keypress) is present; unknown => allowed. */
export function hasUserActivation(nav: { userActivation?: { isActive: boolean } } = navigator): boolean {
  const ua = nav.userActivation;
  return ua ? ua.isActive : true;
}
