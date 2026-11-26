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

describe('search over 5,000 items', () => {
  it('a typical query resolves in under 300ms', async () => {
    const t0 = performance.now();
    const hits = await listItems({ query: 'rebase' });
    const ms = performance.now() - t0;
    expect(hits.length).toBe(Math.ceil((N - WORDS.indexOf('rebase')) / WORDS.length));
    expect(ms).toBeLessThan(300);
  });

  it('a rare query that scans every row is still under 300ms', async () => {
    const t0 = performance.now();
    const hits = await listItems({ query: 'item 4999 with' });
    const ms = performance.now() - t0;
    expect(hits).toHaveLength(1);
    expect(ms).toBeLessThan(300);
  });

  it('a limited query stops early (fast first page)', async () => {
    const t0 = performance.now();
    const hits = await listItems({ query: 'docker', limit: 30, pinnedFirst: true });
    const ms = performance.now() - t0;
    expect(hits).toHaveLength(30);
    expect(ms).toBeLessThan(300);
  });
});
