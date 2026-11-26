import { afterEach, describe, expect, it, vi } from 'vitest';
import { bridgeUrl, pingBridge, postCapture, validPort } from './bridge-client';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
afterEach(() => fetchMock.mockReset());

const T = { port: 47821, token: 'tok' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('bridge client', () => {
  it('only ever talks to 127.0.0.1', () => {
    expect(bridgeUrl(47821, '/v1/ping')).toBe('http://127.0.0.1:47821/v1/ping');
    expect(bridgeUrl(99 as number, '/v1/ping')).toBe('http://127.0.0.1:47821/v1/ping'); // a bad port falls back to the default
    expect(validPort(47821)).toBe(true);
    expect(validPort(80)).toBe(false);
    expect(validPort('47821')).toBe(false);
  });

  it('ping: connected, with the bearer token and no cookies', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true, app: 'mouStache', version: '1.2.3' }));
    expect(await pingBridge(T)).toEqual({ status: 'connected', version: '1.2.3' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:47821/v1/ping');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
  });

  it('ping: wrong token (401), not running (network error), unexpected answer', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { ok: false }));
    expect((await pingBridge(T)).status).toBe('wrong-token');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect((await pingBridge(T)).status).toBe('not-running');
    fetchMock.mockResolvedValueOnce(json(200, { hello: 'someone else on this port' }));
    expect((await pingBridge(T)).status).toBe('error');
    fetchMock.mockResolvedValueOnce(json(500, {}));
    expect((await pingBridge(T)).status).toBe('error');
  });

  it('ping without a token does not even call the network', async () => {
    expect((await pingBridge({ port: 47821, token: '' })).status).toBe('wrong-token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('postCapture sends JSON and reports acceptance; failures never throw', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    expect(await postCapture(T, { kind: 'text', text: 'hi', via: 'copy' })).toBe(true);
    const init = fetchMock.mock.calls[0]![1];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ kind: 'text', text: 'hi', via: 'copy' });

    fetchMock.mockResolvedValueOnce(json(401, {}));
    expect(await postCapture(T, { kind: 'text', text: 'hi', via: 'copy' })).toBe(false);
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    expect(await postCapture(T, { kind: 'text', text: 'hi', via: 'copy' })).toBe(false);
  });

  it('times out instead of hanging', async () => {
    fetchMock.mockImplementationOnce((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))));
    expect(await postCapture(T, { kind: 'text', text: 'hi', via: 'copy' }, 30)).toBe(false);
  });
});
