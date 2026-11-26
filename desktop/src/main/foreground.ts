/**
 * Best-effort "which app is in front" without native node modules.
 * Windows: one long-lived PowerShell that P/Invokes GetForegroundWindow and PUSHES a sample every ~300 ms;
 * `query()` just returns the newest sample. (An earlier request/response design could time out under load and
 * then pair a late reply with the next question, so a copy could be attributed to the wrong app or to none.)
 * macOS: `lsappinfo` (ships with the OS, no permission prompt). Written but NOT run on a real Mac.
 * Any failure resolves to undefined; capture then proceeds without an app name.
 */
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ForegroundApp } from './capture';
import { windowsPowerShellPath } from './powershell';

const MAX_AGE_MS = 2000; // a sample older than this is not trusted
const WAIT_MS = 1500; // how long query() waits for the first/next sample

/**
 * The sampler must never outlive the app (security review F17). It ends when (1) the app's process is gone (the pid
 * comes from the environment, not from the script text) or (2) writing to its stdout fails because the pipe closed.
 */
export const PS_SCRIPT = `
$ErrorActionPreference='SilentlyContinue'
$parent = 0
[void][int]::TryParse($env:MOU_PARENT_PID, [ref]$parent)
Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);'
while ($true) {
  if ($parent -le 0 -or -not (Get-Process -Id $parent)) { break }
  $p=[uint32]0
  $h=[W.U]::GetForegroundWindow()
  [void][W.U]::GetWindowThreadProcessId($h,[ref]$p)
  $n=(Get-Process -Id $p).ProcessName
  try { [Console]::Out.WriteLine("FG|$p|$n|" + $h.ToInt64()); [Console]::Out.Flush() } catch { break }
  Start-Sleep -Milliseconds 300
}
`;

/** Parse one line of the PowerShell sampler: `FG|<pid>|<process name>[|<hwnd>]`. */
export function parseForegroundLine(line: string): ForegroundApp | undefined | null {
  const m = /^FG\|(\d+)\|([^|]*)(?:\|(\d+))?$/.exec(line.trim());
  if (!m) return null; // not a sample line (noise)
  const name = (m[2] ?? '').trim();
  if (!name) return undefined; // a sample with no resolvable process
  return m[3] && m[3] !== '0' ? { pid: Number(m[1]), name, handle: m[3] } : { pid: Number(m[1]), name };
}

export interface ForegroundDetector {
  warmUp(): void;
  query(): Promise<ForegroundApp | undefined>;
  dispose(): void;
}

function windowsDetector(): ForegroundDetector {
  let ps: ChildProcessWithoutNullStreams | undefined;
  let buf = '';
  let latest: { app: ForegroundApp | undefined; at: number } | undefined;
  let waiters: Array<() => void> = [];
  let lastSpawn = 0;

  const start = () => {
    lastSpawn = Date.now();
    const p = spawn(windowsPowerShellPath(), ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', Buffer.from(PS_SCRIPT, 'utf16le').toString('base64')], { windowsHide: true, env: { ...process.env, MOU_PARENT_PID: String(process.pid) } });
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d: string) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        const app = parseForegroundLine(line);
        if (app === null) continue;
        latest = { app, at: Date.now() };
        const w = waiters;
        waiters = [];
        for (const r of w) r();
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

  const ensure = () => {
    if (!ps && Date.now() - lastSpawn > 2000) start(); // respawn, but not in a tight loop
  };
  const fresh = () => (latest && Date.now() - latest.at < MAX_AGE_MS ? latest : undefined);

  return {
    warmUp: ensure,
    async query() {
      ensure();
      let f = fresh();
      if (!f) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, WAIT_MS);
          waiters.push(() => {
            clearTimeout(t);
            resolve();
          });
        });
        f = fresh();
      }
      return f?.app;
    },
    dispose() {
      try {
        ps?.kill();
      } catch {
        /* already gone */
      }
      ps = undefined;
    },
  };
}

const run = (cmd: string, args: string[]) =>
  new Promise<string | undefined>((resolve) =>
    execFile(cmd, args, { timeout: WAIT_MS }, (err, out) => resolve(err ? undefined : String(out))),
  );

function macDetector(): ForegroundDetector {
  return {
    warmUp() {},
    async query(): Promise<ForegroundApp | undefined> {
      const asn = (await run('lsappinfo', ['front']))?.trim();
      if (!asn) return undefined;
      const info = await run('lsappinfo', ['info', '-only', 'name', asn]);
      const name = /"LSDisplayName"="([^"]*)"/.exec(info ?? '')?.[1];
      return name ? { name } : undefined;
    },
    dispose() {},
  };
}

export function createForegroundDetector(platform: NodeJS.Platform = process.platform): ForegroundDetector {
  if (platform === 'win32') return windowsDetector();
  if (platform === 'darwin') return macDetector();
  return { warmUp() {}, query: async () => undefined, dispose() {} };
}

/**
 * Test seam (only wired when MOUSTACHE_E2E=1): the real foreground window changes under a developer's hands
 * while a suite runs, so e2e pins the app name through this wrapper instead.
 */
export function withOverride(inner: ForegroundDetector) {
  let override: { app: ForegroundApp | undefined } | undefined;
  const det: ForegroundDetector = {
    warmUp: () => inner.warmUp(),
    query: async () => (override ? override.app : inner.query()),
    dispose: () => inner.dispose(),
  };
  return { detector: det, set: (app: ForegroundApp | undefined | 'real') => void (override = app === 'real' ? undefined : { app }) };
}
