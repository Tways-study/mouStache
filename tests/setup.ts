import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';

// Ensure SubtleCrypto + randomUUID exist regardless of the DOM env.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
