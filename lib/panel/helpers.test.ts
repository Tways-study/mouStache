import { describe, expect, it } from 'vitest';
import {
  countFilters, dateBucket, exportFilename, formatJson, markdownFence, matchesFilter, normalizeTag, sectionize,
  shikiLang, splitVariables,
} from './helpers';
import { relativeTime, tagLabel, itemGroup, isMonoItem, hostname, previewLine } from '@/lib/content/labels';

const NOW = new Date(2026, 5, 15, 14, 0, 0).getTime();
const ago = (h: number) => NOW - h * 3_600_000;

describe('dateBucket', () => {
  it('buckets by calendar day', () => {
    expect(dateBucket(ago(1), NOW)).toBe('Today');
    expect(dateBucket(new Date(2026, 5, 15, 0, 0, 1).getTime(), NOW)).toBe('Today');
    expect(dateBucket(ago(15), NOW)).toBe('Yesterday');
    expect(dateBucket(ago(24 * 4), NOW)).toBe('This week');
    expect(dateBucket(ago(24 * 20), NOW)).toBe('Earlier');
  });
});

describe('sectionize', () => {
  it('puts pinned first and drops empty buckets', () => {
    const items = [
      { pinned: false, createdAt: ago(1) },
      { pinned: true, createdAt: ago(24 * 30) },
      { pinned: false, createdAt: ago(24 * 40) },
    ];
    const s = sectionize(items, NOW);
    expect(s.map((x) => x.title)).toEqual(['Pinned', 'Today', 'Earlier']);
    expect(s[0]?.items).toHaveLength(1);
  });
});

describe('markdownFence / formatJson', () => {
  it('builds fences, escaping inner fences', () => {
    expect(markdownFence('print(1)\n', 'python')).toBe('```python\nprint(1)\n```');
    expect(markdownFence('a ``` b')).toBe('````\na ``` b\n````');
  });
  it('pretty prints json or returns null', () => {
    expect(formatJson('{"a":1,"b":[1,2]}')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
    expect(formatJson('{nope')).toBeNull();
  });
});

describe('filters', () => {
  const items = [
    { pinned: true, kind: 'text' as const, tags: ['python', 'code'] },
    { pinned: false, kind: 'image' as const, tags: ['screenshot'] },
    { pinned: false, kind: 'text' as const, tags: ['ip'] },
    { pinned: false, kind: 'text' as const, tags: [] },
  ];
  it('counts per filter', () => {
    const c = countFilters(items);
    expect(c.all).toBe(4);
    expect(c.pinned).toBe(1);
    expect(c.code).toBe(1);
    expect(c.image).toBe(1);
    expect(c.network).toBe(1);
    expect(c.other).toBe(1);
  });
  it('matches', () => {
    expect(matchesFilter(items[0]!, 'pinned')).toBe(true);
    expect(matchesFilter(items[1]!, 'image')).toBe(true);
    expect(matchesFilter(items[1]!, 'code')).toBe(false);
  });
});

describe('misc helpers', () => {
  it('maps langs', () => {
    expect(shikiLang({ lang: 'bash', tags: [] })).toBe('shellscript');
    expect(shikiLang({ tags: ['command'] })).toBe('shellscript');
    expect(shikiLang({ tags: ['ip'] })).toBeUndefined();
  });
  it('splits prompt variables', () => {
    expect(splitVariables('Explain {{topic}} to me')).toEqual([
      { text: 'Explain ', variable: false },
      { text: '{{topic}}', variable: true },
      { text: ' to me', variable: false },
    ]);
  });
  it('normalizes tags and filenames', () => {
    expect(normalizeTag('  My Tag!  ')).toBe('my-tag');
    expect(exportFilename(NOW)).toBe('moustache-export-2026-06-15.json');
  });
});

describe('labels re-export (overlay compatibility)', () => {
  it('still exposes overlay helpers', () => {
    expect(tagLabel('python')).toBe('Python');
    expect(tagLabel('my-tag')).toBe('My Tag');
    expect(itemGroup({ kind: 'image', tags: [] })).toBe('image');
    expect(itemGroup({ kind: 'text', tags: ['ip'] })).toBe('network');
    expect(isMonoItem({ kind: 'text', tags: ['command'] })).toBe(true);
    expect(relativeTime(NOW - 120_000, NOW)).toBe('2m');
    expect(hostname('https://www.github.com/x')).toBe('github.com');
    expect(previewLine('\n a  b')).toBe('a b');
  });
});
