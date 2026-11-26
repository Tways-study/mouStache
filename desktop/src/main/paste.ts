/**
 * Paste into the app that was in front before the palette opened.
 *
 * SAFETY RULES (tested in paste.test.ts):
 *  - Every script below is a FIXED constant. User data never gets spliced into script text.
 *  - The only data that crosses is (a) a window handle, validated as digits and sent as a line to a script that
 *    re-validates it with a strict regex, and (b) an app name, passed to osascript as a separate argv entry.
 *  - No native node modules: Windows uses one long-lived PowerShell (WScript.Shell.SendKeys), macOS uses osascript.
 */
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ForegroundApp } from './capture';

export type PasteTarget = Pick<ForegroundApp, 'name' | 'pid' | 'handle'>;

export interface PasteExecutor {
  /** Bring `target` back to the front (best effort) and send the paste keystroke to it. */
  paste(target: PasteTarget | undefined): Promise<void>;
  dispose(): void;
}

// ---------------------------------------------------------------- Windows

/** Fixed actor script. Reads `PASTE <digits>` lines from stdin; everything else is ignored. */
export const WIN_ACTOR_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
Add-Type -Namespace W -Name P -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);'
$sh = New-Object -ComObject WScript.Shell
[Console]::Out.WriteLine('READY')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line -match '^PASTE ([0-9]{1,19})$') {
    $h = [int64]$Matches[1]
    if ($h -ne 0 -and [W.P]::IsWindow([IntPtr]$h)) {
      if ([W.P]::IsIconic([IntPtr]$h)) { [void][W.P]::ShowWindow([IntPtr]$h, 9) }
      [void][W.P]::SetForegroundWindow([IntPtr]$h)
    }
    Start-Sleep -Milliseconds 90
    $sh.SendKeys('^v')
    [Console]::Out.WriteLine('DONE')
  }
}
`;

/** The line sent to the actor. Throws unless `handle` is plain decimal digits (or absent = paste into whatever is in front). */
export function winPasteLine(handle: string | undefined): string {
  if (handle === undefined || handle === '') return 'PASTE 0';
  if (!/^[0-9]{1,19}$/.test(handle)) throw new Error('invalid window handle');
  return `PASTE ${handle}`;
}

/** `-EncodedCommand` payload: lets stdin stay free for commands. Pure function of the fixed script. */
export const winActorEncoded = () => Buffer.from(WIN_ACTOR_SCRIPT, 'utf16le').toString('base64');

function windowsExecutor(): PasteExecutor {
  let ps: ChildProcessWithoutNullStreams | undefined;
  let buf = '';
  let waiter: (() => void) | undefined;

  const start = () => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', winActorEncoded()], {
      windowsHide: true,
    });
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d: string) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line === 'DONE' && waiter) {
          const w = waiter;
          waiter = undefined;
          w();
        }
      }
    });
    const gone = () => {
      if (ps === p) ps = undefined;
    };
    p.on('exit', gone);
    p.on('error', gone);
    p.stdin.on('error', () => undefined);
    ps = p;
  };
  start(); // warm: the first paste should not pay PowerShell's start-up

  return {
    paste(target) {
      const line = winPasteLine(target?.handle); // throws before anything is written
      return new Promise<void>((resolve, reject) => {
        if (!ps) start();
        const timer = setTimeout(() => {
          waiter = undefined;
          reject(new Error('paste helper timed out'));
        }, 4000);
        waiter = () => {
          clearTimeout(timer);
          resolve();
        };
        try {
          ps!.stdin.write(line + '\n');
        } catch (e) {
          clearTimeout(timer);
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    },
    dispose() {
      try {
        ps?.kill();
      } catch {
        /* gone */
      }
      ps = undefined;
    },
  };
}

// ---------------------------------------------------------------- macOS

export const MAC_PASTE_ARGS: readonly string[] = ['-e', 'tell application "System Events" to keystroke "v" using command down'];
export const MAC_ACTIVATE_SCRIPT = 'on run argv\ntell application (item 1 of argv) to activate\nend run';

/** osascript argv to re-activate an app. The name travels as its own argv entry, never inside the script text. */
export function macActivateArgs(appName: string): string[] {
  // eslint-disable-next-line no-control-regex
  if (appName.length === 0 || appName.length > 200 || /[\u0000-\u001f]/.test(appName)) throw new Error('invalid app name');
  return ['-e', MAC_ACTIVATE_SCRIPT, appName];
}

const osascript = (args: readonly string[]) =>
  new Promise<void>((resolve, reject) =>
    execFile('osascript', [...args], { timeout: 4000 }, (err) => (err ? reject(err) : resolve())),
  );

function macExecutor(): PasteExecutor {
  return {
    async paste(target) {
      if (target?.name) {
        await osascript(macActivateArgs(target.name)).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 150)); // let the app come to the front
      }
      await osascript(MAC_PASTE_ARGS);
    },
    dispose() {},
  };
}

// ---------------------------------------------------------------- selection

export function createPasteExecutor(platform: NodeJS.Platform = process.platform): PasteExecutor {
  if (platform === 'win32') return windowsExecutor();
  if (platform === 'darwin') return macExecutor();
  return {
    async paste() {
      throw new Error('paste is not supported on this platform');
    },
    dispose() {},
  };
}

/** One entry per intended paste: what WOULD have been sent, and to whom. */
export interface PasteRecord {
  platform: NodeJS.Platform;
  target: PasteTarget | undefined;
  /** Windows: the actor line. macOS: the osascript argument lists (activate then keystroke). */
  command: { line: string } | { activate?: string[]; keystroke: string[] };
}

/**
 * Executor used whenever MOUSTACHE_E2E=1: it builds exactly the commands the real executor would send, records
 * them, and sends NOTHING, so tests can never type into whatever window happens to be focused.
 */
export function createRecordingPasteExecutor(log: PasteRecord[], platform: NodeJS.Platform = process.platform): PasteExecutor {
  return {
    async paste(target) {
      if (platform === 'darwin') {
        log.push({
          platform,
          target,
          command: { ...(target?.name ? { activate: macActivateArgs(target.name) } : {}), keystroke: [...MAC_PASTE_ARGS] },
        });
      } else {
        log.push({ platform, target, command: { line: winPasteLine(target?.handle) } });
      }
    },
    dispose() {},
  };
}
