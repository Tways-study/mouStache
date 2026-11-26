import { beforeEach, describe, expect, it } from 'vitest';
import type { StashItem } from './types';
import type { StashExport } from './db';
import { classify } from './classify';
import { dataUrlToBlob, isAllowedImageMime, mergeSource, addItem, blobToDataUrl, clearAll, countItems, countOlderThan, db, deleteOlderThan, deleteItem, enforceMaxItems, exportAll, getItem, importAll, listItems, updateItem } from './db';
import { hashBlob, hashText } from './hash';

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
    // tags/lang are recomputed on import, so the original uses what the classifier would say plus a user-made tag
    const c = classify('SELECT 1 FROM t;');
    await addText('SELECT 1 FROM t;', { tags: [...c.tags, 'a'], lang: c.lang, pinned: true, source: { url: 'https://x.dev', title: 'X' }, createdAt: 1_000 });
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

describe('import never trusts derived data in the file (security review F4, F11)', () => {
  const file = (items: unknown[]) => ({ app: 'stash', version: 1, exportedAt: 1, items }) as unknown as StashExport;
  const PNG = 'data:image/png;base64,iVBORw0KGgo=';

  it('recomputes the hash from the content, so a forged hash cannot make a later copy dedupe onto the wrong item', async () => {
    const forged = await hashText('something else entirely');
    await importAll(file([{ kind: 'text', text: 'alpha', hash: forged, tags: [], createdAt: 5 }]));
    const [imported] = await listItems();
    expect(imported!.hash).toBe(await hashText('alpha'));
    expect(imported!.hash).not.toBe(forged);

    // the text the forged hash pointed at is a NEW item, not a dedupe onto "alpha"
    const later = await addText('something else entirely');
    expect(later.deduped).toBe(false);
    expect(later.id).not.toBe(imported!.id);
    expect(await countItems()).toBe(2);
  });

  it('an imported item whose hash was forged to collide is still skipped when the real content already exists', async () => {
    await addText('already here');
    const r = await importAll(file([{ kind: 'text', text: 'already here', hash: 'totally-different', tags: [] }]));
    expect(r).toEqual({ imported: 0, skipped: 1 });
    expect(await countItems()).toBe(1);
  });

  it('flags a secret even when the file says secret:false, and recomputes tags and language', async () => {
    await importAll(
      file([
        { kind: 'text', text: 'aws_key = AKIAIOSFODNN7EXAMPLE', secret: false, tags: ['css', 'sql'], lang: 'css', hash: 'x' },
        { kind: 'text', text: 'SELECT name FROM students WHERE gpa > 3.5;', secret: true, tags: ['python', 'my-own-tag'], lang: 'python' },
      ]),
    );
    const items = await listItems();
    const key = items.find((i) => i.text?.includes('AKIA'))!;
    expect(key.secret).toBe(true);
    expect(key.tags).toContain('secret');
    expect(key.tags).not.toContain('css');
    expect(key.lang).not.toBe('css');
    const sql = items.find((i) => i.text?.startsWith('SELECT'))!;
    expect(sql.tags).toContain('sql');
    expect(sql.tags).not.toContain('python');
    expect(sql.tags).toContain('my-own-tag'); // a tag the user made up survives
    expect(sql.lang).toBe('sql');
    expect(sql.secret).toBe(true); // a file may mark more things secret, never fewer
  });

  it('keeps the user-owned fields: pinned, createdAt, source, via', async () => {
    await importAll(file([{ kind: 'text', text: 'docker ps', pinned: true, createdAt: 12345, via: 'context-menu', source: { url: 'https://a.com/x', title: 'A' } }]));
    const [i] = await listItems();
    expect(i).toMatchObject({ pinned: true, createdAt: 12345, via: 'context-menu', source: { url: 'https://a.com/x', title: 'A' } });
  });

  it('recomputes an image hash from its bytes and never imports an SVG or other non-raster image', async () => {
    const svg = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    const r = await importAll(
      file([
        { kind: 'image', imageDataUrl: PNG, hash: 'forged-image-hash', mime: 'text/html' },
        { kind: 'image', imageDataUrl: svg },
        { kind: 'image', imageDataUrl: 'data:text/html;base64,PGI+' },
        { kind: 'image', imageDataUrl: PNG, thumbDataUrl: svg, hash: 'again' },
      ]),
    );
    expect(r.imported).toBe(1); // the second PNG is a duplicate of the first once the real hash is computed
    const [img] = await listItems();
    expect(img!.hash).toBe(await hashBlob(dataUrlToBlob(PNG)));
    expect(img!.hash).not.toBe('forged-image-hash');
    expect(img!.mime).toBe('image/png'); // taken from the bytes' data URL, not from the file's "mime"
    expect(img!.thumbBlob).toBeUndefined();
    expect(img!.tags).toContain('image');
  });

  it('isAllowedImageMime accepts raster formats only', () => {
    for (const ok of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'IMAGE/PNG']) expect(isAllowedImageMime(ok), ok).toBe(true);
    for (const bad of ['image/svg+xml', 'text/html', 'application/pdf', '', undefined, 'image/']) expect(isAllowedImageMime(bad), String(bad)).toBe(false);
  });
});
