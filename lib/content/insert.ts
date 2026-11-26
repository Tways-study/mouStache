import { isTextControl } from './selection';

/**
 * Insert text at the caret of an editable element. Returns true if inserted.
 * input/textarea -> setRangeText + input event; contenteditable -> execCommand.
 */
export function insertAtCursor(el: Element | null, text: string): boolean {
  if (!el) return false;
  if (isTextControl(el)) {
    if (el.disabled || el.readOnly) return false;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    el.focus();
    try {
      el.setRangeText(text, start, end, 'end');
      const caret = start + text.length;
      el.setSelectionRange(caret, caret);
    } catch {
      // input types without selection support (email/number): append
      el.value = el.value + text;
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    return true;
  }
  const he = el as HTMLElement;
  if (he.isContentEditable) {
    he.focus();
    try {
      return document.execCommand('insertText', false, text);
    } catch {
      return false;
    }
  }
  return false;
}

export function isEditable(el: Element | null): boolean {
  if (!el) return false;
  if (isTextControl(el)) return !el.disabled && !el.readOnly;
  return (el as HTMLElement).isContentEditable === true;
}
