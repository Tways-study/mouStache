import { describe, expect, it } from 'vitest';
import { createForegroundDetector, parseForegroundLine, withOverride } from './foreground';

describe('parseForegroundLine', () => {
  it('parses pid and process name', () => {
    expect(parseForegroundLine('FG|4242|Code\r')).toEqual({ pid: 4242, name: 'Code' });
    expect(parseForegroundLine('FG|1|1Password')).toEqual({ pid: 1, name: '1Password' });
    expect(parseForegroundLine('FG|4242|Code|197654\r')).toEqual({ pid: 4242, name: 'Code', handle: '197654' });
    expect(parseForegroundLine('FG|4242|Code|0')).toEqual({ pid: 4242, name: 'Code' });
    expect(parseForegroundLine('FG|4242|Code|not-a-number')).toBeNull();
  });
  it('a sample with no resolvable process is "no app" (undefined), noise lines are ignored (null)', () => {
    expect(parseForegroundLine('FG|0|')).toBeUndefined();
    expect(parseForegroundLine('')).toBeNull();
    expect(parseForegroundLine('READY')).toBeNull();
    expect(parseForegroundLine('garbage|1|x')).toBeNull();
  });
});

describe('withOverride (e2e seam)', () => {
  const inner = { warmUp() {}, dispose() {}, query: async () => ({ name: 'Real', pid: 7 }) };
  it('passes through until pinned, then returns the pinned app, and "real" unpins', async () => {
    const o = withOverride(inner);
    expect(await o.detector.query()).toEqual({ name: 'Real', pid: 7 });
    o.set({ name: 'Pinned' });
    expect(await o.detector.query()).toEqual({ name: 'Pinned' });
    o.set(undefined);
    expect(await o.detector.query()).toBeUndefined();
    o.set('real');
    expect((await o.detector.query())?.name).toBe('Real');
  });
});

describe('unsupported platforms', () => {
  it('resolve to undefined without spawning anything', async () => {
    expect(await createForegroundDetector('linux').query()).toBeUndefined();
  });
});
