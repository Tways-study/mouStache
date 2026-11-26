/**
 * Decides when a saved item deserves feedback (tray curl + blip).
 *
 * A browser copy reaches mouStache twice: the OS watcher sees the clipboard change and the extension forwards the
 * same text over the bridge a moment later (or the other way round). Only the first sighting is news.
 *  - bridge captures: feedback only for genuinely NEW items (a dedupe, even one that merged a source, is silent);
 *  - watcher captures: a dedupe still gives feedback ("Already saved") UNLESS the other path saved that same item
 *    in the last few seconds.
 */
export const RECENT_MS = 3000;

export function createRecentIds(now: () => number = Date.now, ttlMs = RECENT_MS) {
  const seen = new Map<string, number>();
  const prune = () => {
    const t = now();
    for (const [id, at] of seen) if (t - at > ttlMs) seen.delete(id);
  };
  return {
    record(id: string | undefined) {
      if (!id) return;
      prune();
      seen.set(id, now());
    },
    has(id: string | undefined): boolean {
      if (!id) return false;
      prune();
      return seen.has(id);
    },
  };
}
export type RecentIds = ReturnType<typeof createRecentIds>;

export interface SavedInfo {
  id?: string;
  deduped: boolean;
}

export function wantsFeedback(source: 'watcher' | 'bridge', saved: SavedInfo, recent: RecentIds): boolean {
  const alreadySeen = recent.has(saved.id);
  recent.record(saved.id);
  if (!saved.deduped) return true;
  return source === 'watcher' && !alreadySeen;
}
