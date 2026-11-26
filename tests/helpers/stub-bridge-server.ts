/**
 * A real HTTP server on 127.0.0.1 that behaves like the desktop bridge (or like a squatter that does not know the
 * token). It reuses the in-memory protocol implementation from fake-bridge-fetch.ts. For browser-level e2e tests of
 * the extension, which must make real network requests.
 */
import { createServer, type IncomingMessage } from 'node:http';
import { createFakeBridge, type FakeBridgeOptions } from './fake-bridge-fetch';

export async function startStubBridge(o: FakeBridgeOptions) {
  const fake = createFakeBridge(o);
  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
      const r = await fake.fetch(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body: Buffer.concat(chunks).toString('utf8') });
      res.statusCode = r.status;
      res.setHeader('Content-Type', 'application/json');
      res.end(await r.text());
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    seen: fake.seen,
    hellos: fake.hellos,
    captures: fake.captures,
    wire: fake.wire,
    close: () => new Promise<void>((resolve) => (server.listening ? server.close(() => resolve()) : resolve())),
  };
}
