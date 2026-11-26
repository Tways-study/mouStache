import { describe, expect, it } from 'vitest';
import { windowsPowerShellPath } from './powershell';

describe('windowsPowerShellPath (security review F15)', () => {
  const full = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const exists = (p: string) => p.toLowerCase() === full.toLowerCase();

  it('builds the absolute System32 path from %SystemRoot%', () => {
    expect(windowsPowerShellPath({ SystemRoot: 'C:\\Windows' }, exists).toLowerCase()).toBe(full.toLowerCase());
    expect(windowsPowerShellPath({ windir: 'C:\\Windows' }, exists).toLowerCase()).toBe(full.toLowerCase());
  });

  it('never returns a relative or PATH-resolved name while the system copy exists', () => {
    const p = windowsPowerShellPath({ SystemRoot: 'C:\\Windows', PATH: 'C:\\evil' }, exists);
    expect(p).toMatch(/^[A-Za-z]:[\\/]/);
    expect(p.toLowerCase()).toContain('system32');
  });

  it('falls back to the bare name only when the system copy is missing or the root looks wrong', () => {
    expect(windowsPowerShellPath({ SystemRoot: 'C:\\Windows' }, () => false)).toBe('powershell.exe');
    expect(windowsPowerShellPath({}, exists)).toBe('powershell.exe');
    expect(windowsPowerShellPath({ SystemRoot: '..\\evil' }, () => true)).toBe('powershell.exe');
    expect(windowsPowerShellPath({ SystemRoot: '\\\\server\\share' }, () => true)).toBe('powershell.exe');
  });

  it('on this machine (Windows) it finds the real thing', () => {
    if (process.platform !== 'win32') return;
    expect(windowsPowerShellPath().toLowerCase()).toContain('system32');
    expect(windowsPowerShellPath().toLowerCase()).toMatch(/powershell\.exe$/);
  });
});
