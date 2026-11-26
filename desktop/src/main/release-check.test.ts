import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { findMarkers, MARKERS } from '../../../scripts/check-release-bundle.mjs';

const root = mkdtempSync(join(tmpdir(), 'mou-release-check-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('release bundle check (security review F2)', () => {
  it('passes a bundle without any test seam', () => {
    const dir = join(root, 'clean');
    mkdirSync(join(dir, 'chunks'), { recursive: true });
    writeFileSync(join(dir, 'index.js'), 'import { app } from "electron"; app.setName("mouStache"); const x = process.env["ELECTRON_RENDERER_URL"];');
    writeFileSync(join(dir, 'chunks', 'a.js'), 'export const ok = 1;');
    expect(findMarkers(dir)).toEqual([]);
  });

  it('fails a bundle that carries any hook, env switch or seam factory', () => {
    for (const marker of MARKERS) {
      const dir = join(root, `dirty-${marker}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'index.js'), `globalThis["${marker}"] = 1;`);
      expect(findMarkers(dir), marker).toEqual([{ file: join(dir, 'index.js'), marker }]);
    }
  });

  it('also scans nested chunks and html', () => {
    const dir = join(root, 'nested');
    mkdirSync(join(dir, 'chunks'), { recursive: true });
    writeFileSync(join(dir, 'chunks', 'deep.js'), 'const x = "MOUSTACHE_E2E";');
    expect(findMarkers(dir).map((h) => h.marker)).toEqual(['MOUSTACHE_E2E']);
  });

  it('the marker list covers every __mou* hook that testing.ts installs, so a new hook cannot slip into a release unnoticed', () => {
    const src = readFileSync(join(__dirname, 'testing.ts'), 'utf8');
    const hooks = [...src.matchAll(/g\['(__mou\w+)'\]/g)].map((m) => m[1]!);
    expect(hooks.length).toBeGreaterThan(8);
    for (const h of new Set(hooks)) expect(MARKERS, h).toContain(h);
    // and every MOUSTACHE_* switch testing.ts reads
    const envs = [...src.matchAll(/'(MOUSTACHE_[A-Z_]+)'/g)].map((m) => m[1]!);
    for (const e of new Set(envs)) expect(MARKERS, e).toContain(e);
  });

  it('index.ts only reaches the seams through the compile-time constant, never through a runtime condition alone', () => {
    const src = readFileSync(join(__dirname, 'index.ts'), 'utf8');
    expect(src).toMatch(/__MOU_TEST_BUILD__ \? createTestSeams\(process\.env\) : undefined/);
    expect(src).not.toMatch(/process\.env\['MOUSTACHE_E2E'\]/); // that switch is read only inside testing.ts
  });
});
