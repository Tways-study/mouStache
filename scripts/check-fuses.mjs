// Reads the Electron fuse state of a packaged mouStache binary and fails if it is not what the build config promises.
//   node scripts/check-fuses.mjs [path-to-exe] [--test]
// Default target: the RELEASE unpacked build (release/win-unpacked/mouStache.exe). --test checks the packaged TEST
// build instead (release-test/...), which deliberately keeps the Node inspect / NODE_OPTIONS fuses ON for Playwright.
import fuses from '@electron/fuses'; // CommonJS package
const { FuseV1Options, getCurrentFuseWire } = fuses;
/** The wire holds the ASCII code of "1" (49, enabled) or "0" (48, disabled) per fuse. */
const ENABLED = 49;
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const test = process.argv.includes('--test');
const dir = test ? 'release-test' : 'release';
const guess =
  process.platform === 'win32'
    ? `${dir}/win-unpacked/mouStache.exe`
    : process.platform === 'darwin'
      ? `${dir}/mac${process.arch === 'arm64' ? '-arm64' : ''}/mouStache.app/Contents/MacOS/mouStache`
      : `${dir}/linux-unpacked/moustache`;
const exe = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? guess);

if (!existsSync(exe)) {
  console.error(`check-fuses: ${exe} not found. Build it first (npm run desktop:pack${test ? ':test' : ''}).`);
  process.exit(2);
}

const wire = await getCurrentFuseWire(exe);
const name = (id) => FuseV1Options[id];
const state = (id) => wire[id] === ENABLED;

const expected = {
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: test, // test build only
  [FuseV1Options.EnableNodeCliInspectArguments]: test, // test build only
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
};

let bad = 0;
for (const [id, want] of Object.entries(expected)) {
  const got = state(Number(id));
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name(Number(id))}: ${got ? 'enabled' : 'disabled'} (expected ${want ? 'enabled' : 'disabled'})`);
}
console.log(`check-fuses: ${exe} [${test ? 'TEST build' : 'RELEASE build'}] ${bad ? 'FAILED' : 'OK'}`);
process.exit(bad ? 1 : 0);
