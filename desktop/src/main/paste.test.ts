import { describe, expect, it } from 'vitest';
import {
  createRecordingPasteExecutor,
  MAC_ACTIVATE_SCRIPT,
  MAC_PASTE_ARGS,
  macActivateArgs,
  winActorEncoded,
  winPasteLine,
  WIN_ACTOR_SCRIPT,
  type PasteRecord,
} from './paste';

describe('Windows paste commands', () => {
  it('builds a PASTE line from a numeric window handle, or 0 when unknown', () => {
    expect(winPasteLine('197654')).toBe('PASTE 197654');
    expect(winPasteLine(undefined)).toBe('PASTE 0');
    expect(winPasteLine('')).toBe('PASTE 0');
  });

  it.each(['12; calc', '1 2', '-1', '0x1F', '12\nPASTE 1', '$(calc)', "1'; Start-Process calc; '", '1'.repeat(20), 'abc', '१२३'])(
    'rejects the hostile handle %j (it never reaches the shell)',
    (bad) => {
      expect(() => winPasteLine(bad)).toThrow('invalid window handle');
    },
  );

  it('the script is a fixed constant that only accepts strict digit lines and sends Ctrl+V', () => {
    expect(WIN_ACTOR_SCRIPT).toContain("-match '^PASTE ([0-9]{1,19})$'");
    expect(WIN_ACTOR_SCRIPT).toContain("SendKeys('^v')");
    // the only interpolation-looking text in the script is PowerShell's own variables, none fed from JS
    expect(WIN_ACTOR_SCRIPT).not.toMatch(/\$\{/);
  });

  it('is passed as -EncodedCommand (UTF-16LE base64 of the fixed script) so stdin stays free for commands', () => {
    expect(Buffer.from(winActorEncoded(), 'base64').toString('utf16le')).toBe(WIN_ACTOR_SCRIPT);
  });
});

describe('macOS paste commands', () => {
  it('keystroke is a fixed osascript', () => {
    expect(MAC_PASTE_ARGS).toEqual(['-e', 'tell application "System Events" to keystroke "v" using command down']);
  });

  it('passes the app name as its own argv entry, never inside the script text', () => {
    const evil = 'Finder" to quit\nend tell\ndo shell script "rm -rf ~';
    const args = macActivateArgs(evil.replace(/\n/g, ' '));
    expect(args[0]).toBe('-e');
    expect(args[1]).toBe(MAC_ACTIVATE_SCRIPT);
    expect(args[1]).not.toContain('rm -rf');
    expect(args[2]).toContain('rm -rf'); // data stays data
    expect(args).toHaveLength(3);
  });

  it('rejects empty, huge and control-character names', () => {
    expect(() => macActivateArgs('')).toThrow('invalid app name');
    expect(() => macActivateArgs('x'.repeat(201))).toThrow('invalid app name');
    expect(() => macActivateArgs('a\nb')).toThrow('invalid app name');
    expect(() => macActivateArgs('a\u0000b')).toThrow('invalid app name');
  });
});

describe('recording executor (what e2e uses instead of real keystrokes)', () => {
  it('records the exact Windows command and target without sending anything', async () => {
    const log: PasteRecord[] = [];
    await createRecordingPasteExecutor(log, 'win32').paste({ name: 'Code', pid: 9, handle: '4242' });
    expect(log).toEqual([{ platform: 'win32', target: { name: 'Code', pid: 9, handle: '4242' }, command: { line: 'PASTE 4242' } }]);
  });

  it('records the exact macOS commands', async () => {
    const log: PasteRecord[] = [];
    await createRecordingPasteExecutor(log, 'darwin').paste({ name: 'Cursor' });
    expect(log[0]!.command).toEqual({ activate: ['-e', MAC_ACTIVATE_SCRIPT, 'Cursor'], keystroke: [...MAC_PASTE_ARGS] });
  });

  it('an unknown target records a paste into whatever is in front', async () => {
    const log: PasteRecord[] = [];
    await createRecordingPasteExecutor(log, 'win32').paste(undefined);
    expect(log[0]!.command).toEqual({ line: 'PASTE 0' });
  });

  it('refuses a hostile handle just like the real executor', async () => {
    await expect(createRecordingPasteExecutor([], 'win32').paste({ name: 'x1', handle: '1; calc' })).rejects.toThrow();
  });
});
