import { describe, expect, it } from 'vitest';
import { classify, tagGroup } from './classify';
import { FIXTURES } from './fixtures/snippets';
import { GROUP_META, GROUP_ORDER, TAG_META, langLabel, tagLabel } from './tags';

describe('classify fixtures', () => {
  it('has at least 60 fixtures', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(60);
  });

  for (const f of FIXTURES) {
    it(f.name, () => {
      const r = classify(f.text);
      for (const t of f.tags ?? []) expect(r.tags, `missing tag ${t}`).toContain(t);
      for (const t of f.notTags ?? []) expect(r.tags, `unexpected tag ${t}`).not.toContain(t);
      if (f.tags && f.tags.length === 0) expect(r.tags).toEqual([]);
      if (f.lang !== undefined) expect(r.lang).toBe(f.lang);
      expect(r.group).toBe(f.group);
      expect(r.secret).toBe(f.secret ?? false);
      expect(r.tags.length).toBeLessThanOrEqual(6);
      expect(new Set(r.tags).size).toBe(r.tags.length);
    });
  }
});

describe('classify misc', () => {
  it('is fast on 10KB input', () => {
    const big = 'def f(x):\n    return x + 1\n'.repeat(400);
    classify(big); // warm
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) classify(big);
    expect((performance.now() - t0) / 5).toBeLessThan(10); // generous bound for CI; target <2ms
  });

  it('caps analysis at 20k chars (secret beyond cap is ignored, no crash)', () => {
    const r = classify('x '.repeat(30000) + ' AKIAIOSFODNN7EXAMPLE');
    expect(r.secret).toBe(false);
  });

  it('tagGroup maps every emitted tag and special tags', () => {
    expect(tagGroup('image')).toBe('image');
    expect(tagGroup('screenshot')).toBe('image');
    expect(tagGroup('link')).toBe('link');
    expect(tagGroup('secret')).toBe('data');
    expect(tagGroup('cidr')).toBe('network');
    expect(tagGroup('unknown-thing')).toBe('other');
    for (const f of FIXTURES) {
      for (const t of classify(f.text).tags) expect(TAG_META[t], `no TAG_META for ${t}`).toBeDefined();
    }
  });
});

describe('tags metadata', () => {
  it('labels', () => {
    expect(tagLabel('cidr')).toBe('CIDR');
    expect(tagLabel('csharp')).toBe('C#');
    expect(tagLabel('cpp')).toBe('C++');
    expect(tagLabel('ip')).toBe('IP');
    expect(tagLabel('powershell')).toBe('PowerShell');
    expect(tagLabel('my-custom')).toBe('My Custom');
    expect(langLabel('csharp')).toBe('C#');
    expect(langLabel('python')).toBe('Python');
  });
  it('group order', () => {
    expect(GROUP_ORDER.map((g) => GROUP_META[g].label)).toEqual([
      'Code', 'Prompts', 'Images', 'Links', 'Network', 'Errors', 'Data', 'Other',
    ]);
  });
});
