import { beforeEach, describe, expect, it } from 'vitest';
import type { StashItem } from './types';
import { mergeSource, addItem, blobToDataUrl, clearAll, countItems, countOlderThan, db, deleteOlderThan, deleteItem, enforceMaxItems, exportAll, getItem, importAll, listItems, updateItem } from './db';
import { hashText } from './hash';

async function addText(text: string, extra: Partial<Parameters<typeof addItem>[0]> = {}) {
  return addItem({ kind: 'text', text, hash: await hashText(text), via: 'copy', ...extra });
}

beforeEach(async () => {
  await db.items.clear();
});

describe('db', () => {
  it('adds an item with defaults', async () => {
    const it1 = await addText('hello');
    expect(it1.id).toMatch(/[0-9a-f-]{36}/);
    expect(it1.pinned).toBe(false);
    expect(it1.tags).toEqual([]);
    expect(it1.deduped).toBe(false);
    expect((await getItem(it1.id))?.text).toBe('hello');
    expect(await countItems()).toBe(1);
  });

  it('dedupes by hash and bumps timestamps', async () => {
    const a = await addText('same', { createdAt: 1, updatedAt: 1 });
    const b = await addText('same');
    expect(b.deduped).toBe(true);
    expect(b.id).toBe(a.id);
    expect(b.createdAt).toBeGreaterThan(1);
    expect(await countItems()).toBe(1);
  });

  it('lists newest first and filters by query, tag, kind', async () => {
    await addText('select * from users', { tags: ['sql', 'code'], createdAt: 10 });
    await addText('ping 10.0.0.1', { tags: ['network'], createdAt: 20 });
    await addItem({ kind: 'link', text: 'https://example.com', hash: 'l1', via: 'copy', createdAt: 30, source: { title: 'Example Domain' } });

    expect((await listItems()).map((i) => i.createdAt)).toEqual([30, 20, 10]);
    expect((await listItems({ query: 'SELECT' })).map((i) => i.createdAt)).toEqual([10]);
    expect((await listItems({ query: 'network' })).length).toBe(1);
    expect((await listItems({ query: 'example domain' })).length).toBe(1);
    expect((await listItems({ tag: 'sql' })).length).toBe(1);
    expect((await listItems({ kind: 'link' })).length).toBe(1);
    expect((await listItems({ limit: 1, offset: 1 }))[0]!.createdAt).toBe(20);
  });

  it('pinnedFirst puts pinned items on top', async () => {
    await addText('old pinned', { pinned: true, createdAt: 1 });
    await addText('new', { createdAt: 2 });
    const res = await listItems({ pinnedFirst: true });
    expect(res.map((i) => i.text)).toEqual(['old pinned', 'new']);
  });

  it('updateItem and deleteItem', async () => {
    const a = await addText('x');
    const u = await updateItem(a.id, { pinned: true, tags: ['t'] });
    expect(u?.pinned).toBe(true);
    expect(u?.tags).toEqual(['t']);
    await deleteItem(a.id);
    expect(await getItem(a.id)).toBeUndefined();
  });

  it('clearAll can keep pinned', async () => {
    await addText('a', { pinned: true });
    await addText('b');
    await clearAll(true);
    expect((await listItems()).map((i) => i.text)).toEqual(['a']);
    await clearAll();
    expect(await countItems()).toBe(0);
  });

  it('enforceMaxItems deletes oldest unpinned and keeps pinned', async () => {
    await addText('pinned-oldest', { pinned: true, createdAt: 1 });
    await addText('b', { createdAt: 2 });
    await addText('c', { createdAt: 3 });
    await addText('d', { createdAt: 4 });
    const removed = await enforceMaxItems(2);
    expect(removed).toBe(2);
    expect((await listItems()).map((i) => i.text).sort()).toEqual(['d', 'pinned-oldest']);
    expect(await enforceMaxItems(5)).toBe(0);
  });

  it('export/import roundtrips text items', async () => {
    // distinct createdAt: items created in the same millisecond have no defined relative order after re-import
    await addText('one', { tags: ['a'], lang: 'ts', pinned: true, source: { url: 'https://x.dev', title: 'X' }, createdAt: 1_000 });
    await addText('two', { createdAt: 2_000 });
    const dump = await exportAll();
    expect(dump.items).toHaveLength(2);
    const json = JSON.parse(JSON.stringify(dump));
    const before = await listItems();
    await db.items.clear();
    const res = await importAll(json);
    expect(res).toEqual({ imported: 2, skipped: 0 });
    const strip = (xs: StashItem[]) => xs.map(({ id: _id, ...rest }) => rest);
    expect(strip(await listItems())).toEqual(strip(before));
    // re-import is a no-op
    expect(await importAll(json)).toEqual({ imported: 0, skipped: 2 });
  });

  it('export/import roundtrips image blobs as data URLs', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
    await addItem({ kind: 'image', imageBlob: blob, mime: 'image/png', hash: 'img1', via: 'paste' });
    const dump = await exportAll();
    expect(dump.items[0]!.imageDataUrl).toMatch(/^data:image\/png;base64,/);
    await db.items.clear();
    await importAll(JSON.stringify(dump));
    const [back] = (await listItems()) as [StashItem];
    expect(back.imageBlob?.type).toBe('image/png');
    // fake-indexeddb clones happy-dom Blobs imperfectly; compare content via data URL instead
    expect(await blobToDataUrl(back.imageBlob!)).toBe(dump.items[0]!.imageDataUrl);
  });

  it('importAll rejects foreign JSON', async () => {
    await expect(importAll({ nope: true } as never)).rejects.toThrow();
  });

  it('importAll validates and coerces malformed items', async () => {
    await addText('keep me', { createdAt: 5 });
    const existing = (await listItems())[0]!;
    const payload = {
      app: 'stash',
      version: 1,
      exportedAt: 0,
      items: [
        null,
        'str',
        { kind: 'weird', text: 'x', hash: 'h1' },
        { kind: 'text' },
        { kind: 'image', imageDataUrl: 'data:text/html;base64,AAAA' },
        { id: existing.id, kind: 'text', text: 'hijack', hash: 'h2', createdAt: NaN, tags: ['a', 5, 'b'.repeat(100)], pinned: 'yes', secret: 1 },
        { kind: 'text', text: 'keep me', hash: existing.hash },
        {
          kind: 'link', text: 'https://e.com', tags: Array.from({ length: 50 }, (_, i) => `t${i}`),
          source: { url: 'javascript:alert(1)', title: 7, favicon: 'https://e.com/f.ico' },
        },
      ],
    };
    const res = await importAll(payload as never);
    expect(res).toEqual({ imported: 2, skipped: 6 });
    const all = await listItems();
    expect(all).toHaveLength(3);
    expect((await getItem(existing.id))?.text).toBe('keep me');
    const hijack = all.find((i) => i.text === 'hijack')!;
    expect(hijack.id).not.toBe(existing.id);
    expect(hijack.pinned).toBe(false);
    expect(hijack.secret).toBe(false);
    expect(Number.isFinite(hijack.createdAt)).toBe(true);
    expect(hijack.tags).toEqual(['a', 'b'.repeat(40)]);
    const link = all.find((i) => i.kind === 'link')!;
    expect(link.tags).toHaveLength(20);
    expect(link.source).toEqual({ favicon: 'https://e.com/f.ico' });
    expect(link.hash).toBe(await hashText('https://e.com'));
  });

  it('listItems pages without filters and with early-stop filters', async () => {
    for (let i = 1; i <= 6; i++) await addText(`item ${i}`, { createdAt: i, pinned: i === 2 });
    expect((await listItems({ limit: 2, offset: 1 })).map((i) => i.createdAt)).toEqual([5, 4]);
    expect((await listItems({ query: 'item', limit: 2, offset: 1 })).map((i) => i.createdAt)).toEqual([5, 4]);
    expect((await listItems({ pinnedFirst: true, limit: 3 })).map((i) => i.createdAt)).toEqual([2, 6, 5]);
  });

  describe('deleteOlderThan', () => {
    const DAY = 86_400_000;
    const NOW = 1_000 * DAY;
    beforeEach(async () => {
      await addText('ancient', { createdAt: NOW - 100 * DAY });
      await addText('ancient pinned', { createdAt: NOW - 100 * DAY, pinned: true });
      await addText('old', { createdAt: NOW - 40 * DAY });
      await addText('recent', { createdAt: NOW - 2 * DAY });
      await addItem({ kind: 'image', imageBlob: new Blob(['x']), hash: 'img-old', via: 'screenshot', createdAt: NOW - 45 * DAY });
      await addItem({ kind: 'image', imageBlob: new Blob(['y']), hash: 'img-new', via: 'screenshot', createdAt: NOW - 1 * DAY });
    });

    it('removes unpinned items older than the age and keeps pinned by default', async () => {
      expect(await deleteOlderThan(30 * DAY, true, { now: NOW })).toBe(3);
      const left = (await listItems()).map((i) => i.text ?? i.hash).sort();
      expect(left).toEqual(['ancient pinned', 'img-new', 'recent']);
    });

    it('can include pinned items', async () => {
      expect(await deleteOlderThan(30 * DAY, false, { now: NOW })).toBe(4);
      expect(await countItems()).toBe(2);
    });

    it('is a no-op for a non-positive age (auto-cleanup "never")', async () => {
      expect(await deleteOlderThan(0, true, { now: NOW })).toBe(0);
      expect(await countItems()).toBe(6);
    });

    it('filters by kind and counts without deleting', async () => {
      expect(await countOlderThan(30 * DAY, { kind: 'image', now: NOW })).toBe(1);
      expect(await countItems()).toBe(6);
      expect(await deleteOlderThan(30 * DAY, true, { kind: 'image', now: NOW })).toBe(1);
      expect((await listItems({ kind: 'image' })).map((i) => i.hash)).toEqual(['img-new']);
      expect(await countItems()).toBe(5);
    });
  });
});

describe('source merge on dedupe (a browser copy is seen by both the OS watcher and the extension)', () => {
  it('a duplicate that arrives with a page source enriches an item that only had an app name', async () => {
    const a = await addText('SELECT 1;', { createdAt: 1, updatedAt: 1, source: { title: 'chrome' } });
    const b = await addText('SELECT 1;', { source: { url: 'https://example.com/page', title: 'Example page', favicon: 'https://example.com/f.ico' } });
    expect(b.deduped).toBe(true);
    expect(b.id).toBe(a.id);
    expect(b.source).toEqual({ url: 'https://example.com/page', title: 'Example page', favicon: 'https://example.com/f.ico' });
    expect((await getItem(a.id))?.source?.url).toBe('https://example.com/page');
    expect(await countItems()).toBe(1);
  });

  it('works the other way round: the extension copy first, then the OS watcher (app name only)', async () => {
    const a = await addText('docker ps', { source: { url: 'https://docs.docker.com/', title: 'Docker docs' } });
    const b = await addText('docker ps', { source: { title: 'chrome' } });
    expect(b.source).toEqual({ url: 'https://docs.docker.com/', title: 'Docker docs' }); // nothing lost, app name not mixed in
    expect(b.id).toBe(a.id);
  });

  it('adds a source to an item that had none', async () => {
    await addText('ls -la', { createdAt: 5, updatedAt: 5 });
    const b = await addText('ls -la', { source: { url: 'https://example.com/', title: 'Ex' } });
    expect(b.source).toEqual({ url: 'https://example.com/', title: 'Ex' });
  });

  it('never overwrites an existing URL, but fills a missing title or favicon', async () => {
    await addText('pwd', { source: { url: 'https://a.com/one' } });
    const b = await addText('pwd', { source: { url: 'https://b.com/two', title: 'B', favicon: 'https://b.com/f.ico' } });
    expect(b.source).toEqual({ url: 'https://a.com/one', title: 'B', favicon: 'https://b.com/f.ico' });
    const c = await addText('pwd', { source: { url: 'https://c.com/three', title: 'C' } });
    expect(c.source?.url).toBe('https://a.com/one');
    expect(c.source?.title).toBe('B'); // existing title kept too
  });

  it('keeps the existing bump semantics: newer createdAt, same id, no new item', async () => {
    const a = await addText('git status', { createdAt: 1, updatedAt: 1 });
    const b = await addText('git status', { source: { url: 'https://example.com/' } });
    expect(b.createdAt).toBeGreaterThan(1);
    expect(b.id).toBe(a.id);
    expect(await countItems()).toBe(1);
  });

  it('a duplicate without a source leaves the stored source exactly as it was', async () => {
    await addText('uname -a', { source: { url: 'https://a.com/x', title: 'A' } });
    const b = await addText('uname -a');
    expect(b.source).toEqual({ url: 'https://a.com/x', title: 'A' });
  });
});

describe('mergeSource', () => {
  it('returns the very same object when nothing changes', () => {
    const existing = { url: 'https://a.com/', title: 'A', favicon: 'https://a.com/f' };
    expect(mergeSource(existing, { title: 'B' })).toBe(existing);
    expect(mergeSource(existing, undefined)).toBe(existing);
    expect(mergeSource(existing, {})).toBe(existing);
    expect(mergeSource(undefined, undefined)).toBeUndefined();
  });
  it('takes the incoming source when there is none, and ignores empty strings', () => {
    expect(mergeSource(undefined, { url: 'https://a.com/' })).toEqual({ url: 'https://a.com/' });
    expect(mergeSource({ url: '', title: '' }, { url: 'https://a.com/', title: 'A' })).toEqual({ url: 'https://a.com/', title: 'A', favicon: undefined });
  });
});
