import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '..');
const alias = { '@': repoRoot };
const version = (JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as { version: string }).version;

/** Dev only: the Vite client needs a websocket, which the strict production CSP forbids. */
const devCsp = (): Plugin => ({
  name: 'mou-dev-csp',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace("connect-src 'self'", "connect-src 'self' ws://localhost:* http://localhost:*"),
});

export default defineConfig(({ mode }) => ({
  main: {
    root: here,
    resolve: { alias },
    // true ONLY with `--mode test` (desktop:build:test: e2e and packaged-test builds). Every release build gets the
    // literal false, which dead-code-eliminates all test seams (see desktop/src/main/testing.ts).
    define: { __MOU_TEST_BUILD__: JSON.stringify(mode === 'test') },
    build: {
      outDir: resolve(here, 'out/main'),
      rollupOptions: { input: resolve(here, 'src/main/index.ts') },
    },
  },
  preload: {
    root: here,
    resolve: { alias },
    build: {
      outDir: resolve(here, 'out/preload'),
      rollupOptions: {
        input: resolve(here, 'src/preload/index.ts'),
        // sandboxed preloads must be CommonJS
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  renderer: {
    root: resolve(here, 'src/renderer'),
    resolve: { alias },
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [tailwindcss(), devCsp()],
    // public/ (logo, icons) comes from the shared repo folder
    publicDir: resolve(repoRoot, 'public'),
    server: { fs: { allow: [repoRoot] } },
    build: {
      outDir: resolve(here, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          engine: resolve(here, 'src/renderer/engine.html'),
          panel: resolve(here, 'src/renderer/panel.html'),
          blip: resolve(here, 'src/renderer/blip.html'),
          palette: resolve(here, 'src/renderer/palette.html'),
          region: resolve(here, 'src/renderer/region.html'),
        },
      },
    },
  },
}));
