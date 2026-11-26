/** Pure message routing for the main process (no electron imports, unit-tested). */
import { BROADCAST_TYPES } from '../shared/api';

export function messageType(msg: unknown): string | undefined {
  if (typeof msg !== 'object' || msg === null) return undefined;
  const t = (msg as { type?: unknown }).type;
  return typeof t === 'string' ? t : undefined;
}

export function isBroadcast(msg: unknown): boolean {
  const t = messageType(msg);
  return t !== undefined && BROADCAST_TYPES.has(t);
}

/**
 * Request/response correlation for the engine window: `request` posts {id,msg} through `post` and resolves
 * when `settle(id, result)` is called. Requests queue until `markReady()`, and time out.
 */
export function createEngineClient(post: (id: number, msg: unknown) => void, timeoutMs = 30_000) {
  let nextId = 1;
  let ready = false;
  const waiting: Array<() => void> = [];
  const pending = new Map<number, { resolve: (v: unknown) => void; timer: ReturnType<typeof setTimeout> }>();

  const dispatch = (msg: unknown) =>
    new Promise<unknown>((resolve) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: 'mouStache engine timed out' });
      }, timeoutMs);
      pending.set(id, { resolve, timer });
      post(id, msg);
    });

  return {
    request(msg: unknown): Promise<unknown> {
      if (ready) return dispatch(msg);
      return new Promise((resolve) => waiting.push(() => void dispatch(msg).then(resolve)));
    },
    settle(id: number, result: unknown): boolean {
      const p = pending.get(id);
      if (!p) return false;
      clearTimeout(p.timer);
      pending.delete(id);
      p.resolve(result);
      return true;
    },
    markReady() {
      ready = true;
      for (const run of waiting.splice(0)) run();
    },
    /** Engine window reloaded/crashed: fail what was in flight and wait for the next ready. */
    reset() {
      ready = false;
      for (const [id, p] of pending) {
        clearTimeout(p.timer);
        p.resolve({ ok: false, error: 'mouStache engine restarted' });
        pending.delete(id);
      }
    },
    get isReady() {
      return ready;
    },
  };
}

export type EngineClient = ReturnType<typeof createEngineClient>;

/**
 * Route one renderer message: broadcasts go to every other window, everything else is answered by the engine.
 */
export function routeMessage(
  msg: unknown,
  deps: { engine: Pick<EngineClient, 'request'>; broadcast: (msg: unknown) => void },
): Promise<unknown> {
  if (isBroadcast(msg)) {
    deps.broadcast(msg);
    return Promise.resolve(undefined);
  }
  return deps.engine.request(msg);
}

/** Longest URL main will hand to the OS. */
export const MAX_EXTERNAL_URL = 2048;

/**
 * At most one external link per `minGapMs` (default 2 s): a compromised page must not be able to spray the
 * user's browser with tabs. `allow()` consumes the slot only when it returns true.
 */
export function createExternalLimiter(minGapMs = 2000, now: () => number = Date.now) {
  let last = -Infinity;
  return {
    allow(): boolean {
      const t = now();
      if (t - last < minGapMs) return false;
      last = t;
      return true;
    },
  };
}

/** Only plain, reasonably short web links may leave the app. */
export function isSafeExternalUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_EXTERNAL_URL) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
