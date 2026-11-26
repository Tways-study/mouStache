import { describe, expect, it, vi } from 'vitest';
import type { SaveResult } from '@/lib/messaging';
import { labelFor, processCapture, type CaptureDeps } from './capture';

function deps(over: Partial<CaptureDeps> & { result?: SaveResult | undefined } = {}) {
  const save = vi.fn(async (_m: unknown) => ('result' in over ? over.result : ({ ok: true, id: 'x', deduped: false } as SaveResult)));
  const d: CaptureDeps = {
    foregroundApp: over.foregroundApp ?? (async () => ({ name: 'Code', pid: 1 })),
    pausedApps: over.pausedApps ?? (() => ['1Password', 'Bitwarden']),
    ownPid: over.ownPid ?? 999,
    save,
  };
  return { d, save };
}

describe('processCapture', () => {
  it('sends save-text with via copy and the app name as source title', async () => {
    const { d, save } = deps();
    const r = await processCapture({ kind: 'text', text: 'SELECT name FROM students WHERE gpa > 3.5;' }, d);
    expect(save).toHaveBeenCalledWith({ type: 'save-text', text: 'SELECT name FROM students WHERE gpa > 3.5;', source: { title: 'Code' }, via: 'copy' });
    expect(r).toEqual({ status: 'saved', label: 'SQL', deduped: false, kind: 'text', id: 'x' });
  });

  it('sends images as a PNG data URL', async () => {
    const { d, save } = deps();
    const r = await processCapture({ kind: 'image', png: Buffer.from('abc') }, d);
    expect(save.mock.calls[0]![0]).toMatchObject({ type: 'save-image', via: 'copy', dataUrl: 'data:image/png;base64,YWJj' });
    expect(r).toMatchObject({ status: 'saved', label: 'Image', kind: 'image' });
  });

  it('source is undefined when the app is unknown', async () => {
    const { d, save } = deps({ foregroundApp: async () => undefined });
    await processCapture({ kind: 'text', text: 'hello' }, d);
    expect((save.mock.calls[0]![0] as { source?: unknown }).source).toBeUndefined();
  });

  it('never sends a copy from a paused app to the engine', async () => {
    const { d, save } = deps({ foregroundApp: async () => ({ name: '1Password 7 - Password Manager' }) });
    expect(await processCapture({ kind: 'text', text: 'hunter2' }, d)).toEqual({ status: 'skipped', reason: 'paused-app' });
    expect(save).not.toHaveBeenCalled();
  });

  it('ignores copies made inside mouStache itself', async () => {
    const { d, save } = deps({ foregroundApp: async () => ({ name: 'electron', pid: 999 }), ownPid: 999 });
    expect(await processCapture({ kind: 'text', text: 'x1' }, d)).toEqual({ status: 'skipped', reason: 'own-app' });
    expect(save).not.toHaveBeenCalled();
  });

  it('a failing app detector does not block capture', async () => {
    const { d } = deps({
      foregroundApp: async () => {
        throw new Error('powershell missing');
      },
    });
    expect((await processCapture({ kind: 'text', text: 'ok' }, d)).status).toBe('saved');
  });

  it('engine "skipped" results (secret, paused, disabled) become skipped outcomes, not saves', async () => {
    for (const skipped of ['secret', 'paused', 'disabled', 'empty'] as const) {
      const { d } = deps({ result: { ok: true, skipped } });
      expect(await processCapture({ kind: 'text', text: 'AKIAIOSFODNN7EXAMPLE' }, d)).toEqual({ status: 'skipped', reason: skipped });
    }
  });

  it('engine failure or no reply is an error outcome', async () => {
    expect((await processCapture({ kind: 'text', text: 'a b' }, deps({ result: { ok: false, error: 'db' } }).d)).status).toBe('error');
    expect((await processCapture({ kind: 'text', text: 'a b' }, deps({ result: undefined }).d)).status).toBe('error');
  });

  it('reports dedupes', async () => {
    const { d } = deps({ result: { ok: true, deduped: true, id: 'y' } });
    expect(await processCapture({ kind: 'text', text: 'ls -la' }, d)).toMatchObject({ status: 'saved', deduped: true });
  });
});

describe('labelFor', () => {
  it.each([
    ['SELECT name FROM students WHERE gpa > 3.5;', 'SQL'],
    ['docker run -d -p 8080:80 nginx', 'Command'],
    ['https://example.com/a', 'URL'],
    ['{"a":1}', 'JSON'],
    ['hello world', 'Text'],
  ])('%s -> %s', (text, label) => {
    expect(labelFor({ kind: 'text', text })).toBe(label);
  });

  it('never contains the copied text', () => {
    const text = 'password=correct-horse-battery-staple';
    expect(labelFor({ kind: 'text', text })).not.toContain('horse');
  });
});
