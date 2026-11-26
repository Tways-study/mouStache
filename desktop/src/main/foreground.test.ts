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

import { spawn } from 'node:child_process';
import { PS_SCRIPT } from './foreground';
import { windowsPowerShellPath } from './powershell';

describe('Windows sampler script (security review F17: it must not outlive the app)', () => {
  it('is a fixed script that checks its parent every loop and stops when its output pipe breaks', () => {
    expect(PS_SCRIPT).toContain('$env:MOU_PARENT_PID');
    expect(PS_SCRIPT).toMatch(/Get-Process -Id \$parent/);
    expect(PS_SCRIPT).toMatch(/catch \{ break \}/);
    expect(PS_SCRIPT).not.toContain('while ($true) {\n  $p=[uint32]0'); // the parent check comes first in the loop
    expect(PS_SCRIPT).not.toMatch(/\$\{|`\$/); // nothing from JS is interpolated into it
  });

  const run = (parentPid: string, ms: number) =>
    new Promise<{ exited: boolean; out: string }>((resolve) => {
      const p = spawn(windowsPowerShellPath(), ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', Buffer.from(PS_SCRIPT, 'utf16le').toString('base64')], {
        windowsHide: true,
        env: { ...process.env, MOU_PARENT_PID: parentPid },
      });
      let out = '';
      p.stdout.on('data', (d: Buffer) => (out += d.toString()));
      const timer = setTimeout(() => {
        p.kill();
        resolve({ exited: false, out });
      }, ms);
      p.on('exit', () => {
        clearTimeout(timer);
        resolve({ exited: true, out });
      });
    });

  it.skipIf(process.platform !== 'win32')('exits by itself, printing nothing, when the parent process does not exist', async () => {
    const r = await run('2147483000', 20_000);
    expect(r.exited).toBe(true);
    expect(r.out.trim()).toBe('');
  }, 30_000);

  it.skipIf(process.platform !== 'win32')('exits at once when no parent pid is given at all', async () => {
    const r = await run('', 20_000);
    expect(r.exited).toBe(true);
  }, 30_000);

  it.skipIf(process.platform !== 'win32')('keeps sampling while the parent is alive (then we stop it)', async () => {
    const r = await run(String(process.pid), 6_000);
    expect(r.out).toMatch(/FG\|\d+\|/);
  }, 30_000);
});
