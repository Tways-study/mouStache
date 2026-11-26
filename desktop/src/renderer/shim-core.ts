/**
 * Pure, DOM-light logic for the `chrome` shim: storage areas (+ onChanged across windows),
 * runtime messaging over an injectable transport, alarms, and harmless stubs.
 * Everything here takes its I/O as parameters so it can be unit-tested without Electron.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn<A extends unknown[] = any[]> = (...args: A) => unknown;

export interface ShimEvent<A extends unknown[]> {
  addListener(l: Fn<A>): void;
  removeListener(l: Fn<A>): void;
  hasListener(l: Fn<A>): boolean;
  dispatch(...args: A): void;
}

export function createEvent<A extends unknown[]>(): ShimEvent<A> {
  const ls = new Set<Fn<A>>();
  return {
    addListener: (l) => void ls.add(l),
    removeListener: (l) => void ls.delete(l),
    hasListener: (l) => ls.has(l),
    dispatch: (...args) => {
      for (const l of [...ls]) {
        try {
          l(...args);
        } catch (e) {
          console.error('[shim] listener threw', e);
        }
      }
    },
  };
}

// ---------------------------------------------------------------- storage

/** The subset of the Web Storage API the shim needs (localStorage / sessionStorage / a Map wrapper). */
export interface KV {
  readonly length: number;
  key(i: number): string | null;
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function memoryKV(): KV {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

export type Change = { oldValue?: unknown; newValue?: unknown };
export type Changes = Record<string, Change>;
export type AreaName = 'local' | 'session';

export interface StorageArea {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
}

function parse(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createStorageArea(kv: KV, prefix: string, onChange: (changes: Changes) => void): StorageArea {
  const ownKeys = (): string[] => {
    const out: string[] = [];
    for (let i = 0; i < kv.length; i++) {
      const k = kv.key(i);
      if (k?.startsWith(prefix)) out.push(k.slice(prefix.length));
    }
    return out;
  };
  const read = (k: string) => parse(kv.getItem(prefix + k));

  return {
    async get(keys) {
      const out: Record<string, unknown> = {};
      if (keys === undefined || keys === null) {
        for (const k of ownKeys()) {
          const v = read(k);
          if (v !== undefined) out[k] = v;
        }
      } else if (typeof keys === 'string' || Array.isArray(keys)) {
        for (const k of typeof keys === 'string' ? [keys] : keys) {
          const v = read(k);
          if (v !== undefined) out[k] = v;
        }
      } else {
        for (const [k, def] of Object.entries(keys)) out[k] = read(k) ?? def;
      }
      return out;
    },
    async set(items) {
      const changes: Changes = {};
      for (const [k, v] of Object.entries(items)) {
        if (v === undefined) continue;
        const oldValue = read(k);
        const raw = JSON.stringify(v);
        const newValue = JSON.parse(raw) as unknown; // detach from the caller's object
        kv.setItem(prefix + k, raw);
        if (!sameJson(oldValue, newValue)) changes[k] = { oldValue, newValue };
      }
      if (Object.keys(changes).length) onChange(changes);
    },
    async remove(keys) {
      const changes: Changes = {};
      for (const k of typeof keys === 'string' ? [keys] : keys) {
        const oldValue = read(k);
        if (kv.getItem(prefix + k) === null) continue;
        kv.removeItem(prefix + k);
        changes[k] = { oldValue };
      }
      if (Object.keys(changes).length) onChange(changes);
    },
    async clear() {
      const changes: Changes = {};
      for (const k of ownKeys()) {
        changes[k] = { oldValue: read(k) };
        kv.removeItem(prefix + k);
      }
      if (Object.keys(changes).length) onChange(changes);
    },
  };
}

/** Cross-window fan-out for storage changes (BroadcastChannel in the app, a fake in tests). */
export interface Bus {
  post(m: unknown): void;
  listen(cb: (m: unknown) => void): void;
}

interface StorageNote {
  stashShim: 'storage';
  area: AreaName;
  changes: Changes;
}

const isNote = (m: unknown): m is StorageNote =>
  typeof m === 'object' && m !== null && (m as { stashShim?: unknown }).stashShim === 'storage';

/**
 * chrome.storage: `local` + `session` areas and one `onChanged`. Like Chrome, onChanged also fires in the
 * context that made the write; other windows get it through the bus.
 */
export function createStorage(backends: { local: KV; session: KV }, bus: Bus) {
  const onChanged = createEvent<[Changes, AreaName]>();
  const make = (area: AreaName) =>
    createStorageArea(backends[area], `stash-shim:${area}:`, (changes) => {
      onChanged.dispatch(changes, area);
      // `session` is per-window (backed by sessionStorage), so other windows must not hear about it
      if (area === 'local') bus.post({ stashShim: 'storage', area, changes } satisfies StorageNote);
    });
  bus.listen((m) => {
    if (isNote(m)) onChanged.dispatch(m.changes, m.area);
  });
  return { local: make('local'), session: make('session'), onChanged };
}

// ---------------------------------------------------------------- runtime

export interface Transport {
  send(msg: unknown): Promise<unknown>;
  onMessage(cb: (msg: unknown) => void): () => void;
}

export type MessageListener = (msg: unknown, sender: object, sendResponse: (r?: unknown) => void) => unknown;

export function createRuntime(transport: Transport, opts: { id: string; version: string; name: string }) {
  const onMessage = createEvent<Parameters<MessageListener>>();
  transport.onMessage((msg) => onMessage.dispatch(msg, {}, () => undefined));

  const noopPort = (name: string) => ({
    name,
    postMessage: () => undefined,
    disconnect: () => undefined,
    onMessage: createEvent<[unknown]>(),
    onDisconnect: createEvent<[]>(),
  });

  return {
    id: opts.id,
    onMessage,
    onConnect: createEvent<[unknown]>(),
    sendMessage: (msg: unknown) => transport.send(msg),
    connect: (info?: { name?: string }) => noopPort(info?.name ?? ''),
    getContexts: async () => [] as unknown[],
    getManifest: () => ({ name: opts.name, version: opts.version, manifest_version: 3 }),
    getURL: (path: string) => path,
    lastError: undefined as unknown,
  };
}

// ---------------------------------------------------------------- alarms

export interface Alarm {
  name: string;
  scheduledTime: number;
  periodInMinutes?: number;
}
export interface AlarmInfo {
  delayInMinutes?: number;
  periodInMinutes?: number;
  when?: number;
}

/** chrome.alarms on timers. Only lives as long as the window, which is fine for the hidden engine. */
export function createAlarms(
  timers: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval'> = globalThis,
  now: () => number = Date.now,
) {
  const onAlarm = createEvent<[Alarm]>();
  const live = new Map<string, { alarm: Alarm; stop: () => void }>();
  const MIN = 60_000;

  const clear = (name: string) => {
    live.get(name)?.stop();
    return live.delete(name);
  };

  return {
    onAlarm,
    create(name: string, info: AlarmInfo = {}) {
      clear(name);
      const delay =
        info.when !== undefined
          ? Math.max(0, info.when - now())
          : (info.delayInMinutes ?? info.periodInMinutes ?? 0) * MIN;
      const alarm: Alarm = { name, scheduledTime: now() + delay, periodInMinutes: info.periodInMinutes };
      let interval: ReturnType<typeof setInterval> | undefined;
      const fire = () => {
        onAlarm.dispatch({ ...alarm });
        if (info.periodInMinutes) {
          const period = info.periodInMinutes * MIN;
          alarm.scheduledTime = now() + period;
          interval = timers.setInterval(() => {
            alarm.scheduledTime = now() + period;
            onAlarm.dispatch({ ...alarm });
          }, period);
        } else live.delete(name);
      };
      const t = timers.setTimeout(fire, delay);
      live.set(name, {
        alarm,
        stop: () => {
          timers.clearTimeout(t);
          if (interval !== undefined) timers.clearInterval(interval);
        },
      });
    },
    get: async (name: string) => live.get(name)?.alarm,
    getAll: async () => [...live.values()].map((l) => l.alarm),
    clear: async (name: string) => clear(name),
    clearAll: async () => {
      for (const n of [...live.keys()]) clear(n);
      return true;
    },
  };
}

// ---------------------------------------------------------------- assembly

export interface ShimOptions {
  transport: Transport;
  bus: Bus;
  local: KV;
  session: KV;
  openExternal: (url: string) => void;
  version?: string;
}

/** Build the whole `chrome` object the extension code expects. */
export function createChromeShim(o: ShimOptions) {
  const storage = createStorage({ local: o.local, session: o.session }, o.bus);
  const runtime = createRuntime(o.transport, {
    id: 'mou-stache-desktop',
    version: o.version ?? '0.1.0',
    name: 'mouStache',
  });
  const unavailable = (what: string) => async () => {
    throw new Error(`${what} is not available in the desktop app`);
  };
  return {
    runtime,
    storage,
    alarms: createAlarms(),
    tabs: {
      query: async () => [] as unknown[],
      create: async (p: { url?: string }) => {
        if (p.url) o.openExternal(p.url);
        return {};
      },
      sendMessage: unavailable('tabs.sendMessage'),
      captureVisibleTab: unavailable('tabs.captureVisibleTab'),
    },
    sidePanel: { open: async () => undefined, setPanelBehavior: async () => undefined, setOptions: async () => undefined },
    action: { setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined },
    scripting: { executeScript: unavailable('scripting.executeScript') },
    contextMenus: {
      create: () => undefined,
      removeAll: async () => undefined,
      onClicked: createEvent<[unknown]>(),
    },
    commands: { onCommand: createEvent<[string]>() },
  };
}

export type ChromeShim = ReturnType<typeof createChromeShim>;
