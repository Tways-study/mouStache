import { beforeAll, describe, expect, it } from 'vitest';
import { db, listItems } from './db';
import type { StashItem } from './types';

const N = 5000;
const WORDS = ['docker', 'compose', 'select', 'join', 'nmap', 'subnet', 'regex', 'commit', 'rebase', 'stack', 'heap', 'socket'];

beforeAll(async () => {
  await db.items.clear();
  const now = Date.now();
  const items: StashItem[] = [];
  for (let i = 0; i < N; i++) {
    const w = WORDS[i % WORDS.length]!;
    items.push({
      id: `perf-${i}`,
      kind: 'text',
      text: `${w} snippet number ${i}\nsecond line of text for item ${i} with some filler words to make it realistic`,
      tags: i % 3 === 0 ? ['code'] : ['other'],
      pinned: i % 500 === 0,
      secret: false,
      hash: `perf-hash-${i}`,
      createdAt: now - i * 60_000,
      updatedAt: now - i * 60_000,
      via: 'copy',
    });
  }
  await db.items.bulkAdd(items);
}, 60_000);

/**
 * Fastest of a few runs. A real regression slows EVERY run past the budget; a one-off stall from a busy machine
 * (other test files and Electron e2e share the CPU) only slows one, so best-of-N keeps the test honest without flaking.
 */
async function bestOf<T>(runs: number, fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  let best = Infinity;
  let value!: T;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    value = await fn();
    best = Math.min(best, performance.now() - t0);
  }
  return { value, ms: best };
}

describe('search over 5,000 items (fastest of 3 runs)', () => {
  it('a typical query resolves in under 300ms', async () => {
    const { value: hits, ms } = await bestOf(3, () => listItems({ query: 'rebase' }));
    expect(hits.length).toBe(Math.ceil((N - WORDS.indexOf('rebase')) / WORDS.length));
    expect(ms).toBeLessThan(300);
  });

  it('a rare query that scans every row is still under 300ms', async () => {
    const { value: hits, ms } = await bestOf(3, () => listItems({ query: 'item 4999 with' }));
    expect(hits).toHaveLength(1);
    expect(ms).toBeLessThan(300);
  });

  it('a limited query stops early (fast first page)', async () => {
    const { value: hits, ms } = await bestOf(3, () => listItems({ query: 'docker', limit: 30, pinnedFirst: true }));
    expect(hits).toHaveLength(30);
    expect(ms).toBeLessThan(300);
  });
});
