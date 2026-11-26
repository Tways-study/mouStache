import { describe, expect, it } from 'vitest';
import { createRecentIds, RECENT_MS, wantsFeedback } from './feedback';

describe('feedback for saved items (no second blip for the same browser copy)', () => {
  it('a new item always gives feedback, from either path', () => {
    const r = createRecentIds(() => 0);
    expect(wantsFeedback('watcher', { id: 'a', deduped: false }, r)).toBe(true);
    expect(wantsFeedback('bridge', { id: 'b', deduped: false }, r)).toBe(true);
  });

  it('watcher first, then the extension over the bridge: the bridge dedupe is silent', () => {
    const r = createRecentIds(() => 0);
    expect(wantsFeedback('watcher', { id: 'a', deduped: false }, r)).toBe(true);
    expect(wantsFeedback('bridge', { id: 'a', deduped: true }, r)).toBe(false);
  });

  it('bridge first, then the watcher dedupes the same item within seconds: the watcher is silent', () => {
    const r = createRecentIds(() => 1000);
    expect(wantsFeedback('bridge', { id: 'a', deduped: false }, r)).toBe(true);
    expect(wantsFeedback('watcher', { id: 'a', deduped: true }, r)).toBe(false);
  });

  it('a bridge dedupe is silent even when the item was not seen recently (it may only be merging a source)', () => {
    const r = createRecentIds(() => 0);
    expect(wantsFeedback('bridge', { id: 'old', deduped: true }, r)).toBe(false);
  });

  it('a deliberate re-copy long after the first still says "Already saved" (watcher only)', () => {
    let now = 0;
    const r = createRecentIds(() => now);
    wantsFeedback('watcher', { id: 'a', deduped: false }, r);
    now = RECENT_MS + 1;
    expect(wantsFeedback('watcher', { id: 'a', deduped: true }, r)).toBe(true);
  });

  it('different items are independent, and a missing id never suppresses', () => {
    const r = createRecentIds(() => 0);
    wantsFeedback('watcher', { id: 'a', deduped: false }, r);
    expect(wantsFeedback('watcher', { id: 'b', deduped: true }, r)).toBe(true);
    expect(wantsFeedback('watcher', { deduped: true }, r)).toBe(true);
  });
});
