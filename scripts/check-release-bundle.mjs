// Fails if a RELEASE bundle (desktop/out from `npm run desktop:build`) contains any test seam.
// Test seams only exist behind the compile-time constant __MOU_TEST_BUILD__ (see desktop/src/main/testing.ts); in a
// release build it is the literal `false` and everything behind it is dead-code-eliminated. This script is the check
// that this stays true, and runs automatically before desktop:pack / desktop:dist:*.
//
//   node scripts/check-release-bundle.mjs [dir]      (default desktop/out; pass desktop/out of a TEST build to see it fail)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Identifiers and strings that must never be in a release build. */
export const MARKERS = [
  '__mouReady', '__mouTray', '__mouPending', '__mouTicks', '__mouOutcomes', '__mouPresence', '__mouForeground',
  '__mouPolls', '__mouFake', '__mouGS', '__mouBridge', '__mouHotkeyStatus', '__mouBlip', '__mouPalette', '__mouRegion',
  'MOUSTACHE_E2E', 'MOUSTACHE_FAKE_CLIPBOARD', 'MOUSTACHE_BRIDGE_PORT', 'MOUSTACHE_SECRET_CLEAR_MS',
  'createTestSeams', 'createShortcutStub', 'createRecordingPasteExecutor', 'createFakeClipboard', 'syntheticGrabber',
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(js|cjs|mjs|html)$/.test(name)) out.push(p);
  }
  return out;
}

export function findMarkers(dir) {
  const hits = [];
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8');
    for (const m of MARKERS) if (text.includes(m)) hits.push({ file, marker: m });
  }
  return hits;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const dir = resolve(process.argv[2] ?? 'desktop/out');
  let hits;
  try {
    hits = findMarkers(dir);
  } catch (e) {
    console.error(`check-release-bundle: cannot read ${dir} (${e.message}). Run "npm run desktop:build" first.`);
    process.exit(2);
  }
  if (hits.length) {
    console.error(`RELEASE BUNDLE CONTAINS TEST SEAMS (${hits.length}):`);
    for (const h of hits) console.error(`  ${h.marker}  in  ${h.file}`);
    console.error('A release build must be made with "npm run desktop:build" (NOT desktop:build:test).');
    process.exit(1);
  }
  console.log(`check-release-bundle: OK, no test seams in ${dir}`);
}
