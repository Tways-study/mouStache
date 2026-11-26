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

  it('caps the structural analysis at 20k chars but still finds a secret beyond it (no crash)', () => {
    const r = classify('x '.repeat(30000) + ' AKIAIOSFODNN7EXAMPLE');
    expect(r.secret).toBe(true); // was ignored before the security review (F3)
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

describe('secret detection covers the whole text (security review F3)', () => {
  const filler = (n: number) => 'INFO request handled in 12ms\n'.repeat(Math.ceil(n / 28)).slice(0, n);

  it('flags a key that sits after 25,000 characters', () => {
    const text = filler(25_000) + 'aws_key = AKIAIOSFODNN7EXAMPLE\n' + filler(1000);
    expect(text.indexOf('AKIA')).toBeGreaterThan(25_000);
    expect(classify(text).secret).toBe(true);
    expect(classify(text).tags).toContain('secret');
  });

  it.each([
    ['a GitHub token', 'ghp_' + 'a1B2c3D4e5'.repeat(4)],
    ['a JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-xyz'],
    ['a password assignment', 'password=Tr0ub4dor&3xyz\n'],
    ['a private key header', '-----BEGIN RSA PRIVATE KEY-----'],
    ['credentials in a URL', 'postgres://admin:hunter2pw@db.internal:5432/app'],
  ])('flags %s at 600 KB into the text', (_n, secret) => {
    const text = filler(600_000) + '\n' + secret + '\n';
    expect(classify(text).secret).toBe(true);
  });

  it('does not flag a long text with nothing secret in it', () => {
    expect(classify(filler(900_000)).secret).toBe(false);
  });

  // Every pattern must stay linear on hostile input: 1 MB of repeated near-matches.
  it.each([
    ['sk- repeated', 'sk-'.repeat(333_333)],
    ['sk- then letters', 'sk-aaaaaaaaaaaaaaaaaaaaaaaa'.repeat(37_000)],
    ['eyJ repeated', 'eyJ'.repeat(333_333)],
    ['eyJ tokens without dots', 'eyJabcdefghij'.repeat(76_000)],
    ['api_key= repeated', 'api_key='.repeat(125_000)],
    ['password= repeated', 'password='.repeat(111_000)],
    ['secret_key=value repeated', 'secret_key=abcdefghijklm_'.repeat(40_000)],
    ['scheme:// repeated', 'a://'.repeat(250_000)],
    ['user:pass@ almost', 'x://u:' + 'p'.repeat(999_000)],
    ['AKIA repeated', 'AKIA'.repeat(250_000)],
    ['BEGIN repeated', '-----BEGIN A '.repeat(77_000)],
    ['ghp_ repeated', 'ghp_'.repeat(250_000)],
  ])('stays fast on a 1 MB adversarial string (%s)', (_n, text) => {
    const t0 = performance.now();
    classify(text);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(2500);
  });
});
