import { hasExtension } from './ext';

/** What the panel remembers across close/reopen within a browser session. */
export interface PanelSession {
  filter: string;
  query: string;
  scrollTop: number;
  /** Section key -> collapsed (explicit user choice; absent = default). */
  collapsed: Record<string, boolean>;
}

export const EMPTY_SESSION: PanelSession = { filter: 'all', query: '', scrollTop: 0, collapsed: {} };

export interface SessionBackend {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

const KEY = 'stash:panel-session';
const RECENT_KEY = 'stash:recent-searches';

/** Coerce whatever was stored into a valid PanelSession (never throws). */
export function sanitizeSession(raw: unknown): PanelSession {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const collapsed: Record<string, boolean> = {};
  if (typeof r.collapsed === 'object' && r.collapsed !== null) {
    for (const [k, v] of Object.entries(r.collapsed as Record<string, unknown>)) {
      if (typeof v === 'boolean') collapsed[k] = v;
    }
  }
  return {
    filter: typeof r.filter === 'string' && r.filter ? r.filter : 'all',
    query: typeof r.query === 'string' ? r.query.slice(0, 200) : '',
    scrollTop: typeof r.scrollTop === 'number' && Number.isFinite(r.scrollTop) && r.scrollTop > 0 ? r.scrollTop : 0,
    collapsed,
  };
}

export async function loadSession(backend: SessionBackend | null = defaultBackend()): Promise<PanelSession> {
  if (!backend) return { ...EMPTY_SESSION };
  try {
    return sanitizeSession(await backend.get(KEY));
  } catch {
    return { ...EMPTY_SESSION };
  }
}

export async function saveSession(session: PanelSession, backend: SessionBackend | null = defaultBackend()): Promise<void> {
  if (!backend) return;
  try {
    await backend.set(KEY, session);
  } catch {
    /* quota / unavailable: the panel just forgets */
  }
}

/** chrome.storage.session when present (survives panel close), else sessionStorage (survives reload). */
export function defaultBackend(): SessionBackend | null {
  try {
    if (hasExtension()) {
      const area = (globalThis as unknown as { chrome?: { storage?: { session?: chrome.storage.StorageArea } } }).chrome?.storage?.session;
      if (area) {
        return {
          get: async (k) => (await area.get(k))[k],
          set: (k, v) => area.set({ [k]: v }),
        };
      }
    }
  } catch {
    /* fall through */
  }
  try {
    const ss = globalThis.sessionStorage;
    if (ss) {
      return {
        get: async (k) => {
          const s = ss.getItem(k);
          return s ? JSON.parse(s) : undefined;
        },
        set: async (k, v) => ss.setItem(k, JSON.stringify(v)),
      };
    }
  } catch {
    /* blocked */
  }
  return null;
}

/** Debounced writer so scroll events don't hammer storage. */
export function createSessionSaver(delay = 250, backend: SessionBackend | null = defaultBackend()) {
  let current: PanelSession = { ...EMPTY_SESSION };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    void saveSession(current, backend);
  };
  return {
    init(s: PanelSession) {
      current = s;
    },
    update(patch: Partial<PanelSession>) {
      current = { ...current, ...patch };
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
    flush,
  };
}

// ───────── recent searches (kept across sessions) ─────────
export const MAX_RECENT = 6;

/** Most recent first, case-insensitive de-dupe, capped. Blank or 1-char queries are ignored. */
export function pushRecent(list: string[], query: string, max = MAX_RECENT): string[] {
  const q = query.trim();
  if (q.length < 2) return list;
  const lower = q.toLowerCase();
  return [q, ...list.filter((x) => x.toLowerCase() !== lower)].slice(0, max);
}

export function loadRecent(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function saveRecent(list: string[]): void {
  try {
    if (list.length) localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    else localStorage.removeItem(RECENT_KEY);
  } catch {
    /* ignore */
  }
}
