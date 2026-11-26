import { describe, expect, it } from 'vitest';
import { BRIDGE_MAX_IMAGE_DATAURL, BRIDGE_MAX_TEXT_BYTES, validateCapture } from './bridge';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('validateCapture', () => {
  it('accepts text and image captures and defaults via to copy', () => {
    expect(validateCapture({ kind: 'text', text: 'hello' })).toEqual({ ok: true, value: { kind: 'text', text: 'hello', via: 'copy' } });
    expect(validateCapture({ kind: 'image', dataUrl: PNG, via: 'screenshot' })).toEqual({
      ok: true,
      value: { kind: 'image', dataUrl: PNG, via: 'screenshot' },
    });
  });

  it('strips query and hash from the page URL (they often carry tokens) and keeps title and favicon', () => {
    const r = validateCapture({
      kind: 'text',
      text: 'x1',
      source: { url: 'https://example.com/a/b?token=SECRET#frag', title: 'Page', favicon: 'https://example.com/f.ico' },
    });
    expect(r).toEqual({
      ok: true,
      value: { kind: 'text', text: 'x1', via: 'copy', source: { url: 'https://example.com/a/b', title: 'Page', favicon: 'https://example.com/f.ico' } },
    });
    expect(JSON.stringify(r)).not.toContain('SECRET');
  });

  it.each([
    [null, 'bad_body'],
    ['text', 'bad_body'],
    [[], 'bad_body'],
    [{}, 'bad_kind'],
    [{ kind: 'video' }, 'bad_kind'],
    [{ kind: 'text', text: 'x', extra: 1 }, 'unknown_field'],
    [{ kind: 'text', dataUrl: PNG }, 'unknown_field'],
    [{ kind: 'text' }, 'bad_text'],
    [{ kind: 'text', text: '' }, 'bad_text'],
    [{ kind: 'text', text: 5 }, 'bad_text'],
    [{ kind: 'text', text: 'x', via: 'drag' }, 'bad_via'],
    [{ kind: 'text', text: 'x', via: 7 }, 'bad_via'],
    [{ kind: 'image' }, 'bad_image'],
    [{ kind: 'image', dataUrl: 'data:text/html;base64,PGI+' }, 'bad_image'],
    [{ kind: 'image', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }, 'bad_image'],
    [{ kind: 'image', dataUrl: 'data:image/png;base64,@@@' }, 'bad_image'],
    [{ kind: 'image', dataUrl: 'https://evil.example/x.png' }, 'bad_image'],
    [{ kind: 'text', text: 'x', source: 'https://a.com' }, 'bad_source'],
    [{ kind: 'text', text: 'x', source: { url: 'javascript:alert(1)' } }, 'bad_source'],
    [{ kind: 'text', text: 'x', source: { url: 'file:///etc/passwd' } }, 'bad_source'],
    [{ kind: 'text', text: 'x', source: { url: 'chrome://settings' } }, 'bad_source'],
    [{ kind: 'text', text: 'x', source: { url: 'https://a.com/' + 'x'.repeat(2100) } }, 'bad_source'],
    [{ kind: 'text', text: 'x', source: { title: 'T'.repeat(301) } }, 'bad_source'],
    [{ kind: 'text', text: 'x', source: { title: 5 } }, 'bad_source'],
    [{ kind: 'text', text: 'x', source: { favicon: 'javascript:1' } }, 'bad_source'],
    [{ kind: 'text', text: 'x', source: { url: 'https://a.com', evil: 1 } }, 'bad_source'],
  ])('rejects %j with %s', (body, code) => {
    expect(validateCapture(body)).toEqual({ ok: false, error: code });
  });

  it('enforces the text size limit in bytes, not characters', () => {
    expect(validateCapture({ kind: 'text', text: 'a'.repeat(BRIDGE_MAX_TEXT_BYTES) }).ok).toBe(true);
    expect(validateCapture({ kind: 'text', text: 'a'.repeat(BRIDGE_MAX_TEXT_BYTES + 1) })).toEqual({ ok: false, error: 'text_too_large' });
    expect(validateCapture({ kind: 'text', text: 'é'.repeat(600_000) })).toEqual({ ok: false, error: 'text_too_large' }); // 1.2 MB of bytes
  });

  it('enforces the image size limit', () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(BRIDGE_MAX_IMAGE_DATAURL);
    expect(validateCapture({ kind: 'image', dataUrl: big })).toEqual({ ok: false, error: 'image_too_large' });
  });

  it('an empty source object is dropped', () => {
    expect(validateCapture({ kind: 'text', text: 'x1', source: {} })).toEqual({ ok: true, value: { kind: 'text', text: 'x1', via: 'copy' } });
  });
});
