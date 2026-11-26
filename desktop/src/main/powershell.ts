import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Windows PowerShell by absolute path (security review F15): a bare "powershell.exe" is resolved through the
 * current directory and PATH, so a planted powershell.exe could be run instead. Falls back to the bare name only
 * when the system copy genuinely is not there.
 */
export function windowsPowerShellPath(
  env: Record<string, string | undefined> = process.env,
  exists: (p: string) => boolean = existsSync,
): string {
  const root = env['SystemRoot'] ?? env['SYSTEMROOT'] ?? env['windir'] ?? env['WINDIR'];
  if (root && /^[A-Za-z]:\\/.test(root)) {
    const full = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (exists(full)) return full;
  }
  return 'powershell.exe';
}
