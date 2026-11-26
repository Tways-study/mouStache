// Dev-only harness for the in-page overlay (not bundled by WXT).
// Run: npx vite --config dev/vite.config.ts   ->  http://localhost:5199/overlay.html?theme=dark&view=palette
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dev = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: dev,
  plugins: [react(), tailwindcss()],
  server: { port: 5199, fs: { allow: [root] } },
  resolve: {
    alias: [
      { find: /^@\/lib\/messaging$/, replacement: `${dev}mock-messaging.ts` },
      { find: /^@\//, replacement: `${root}` },
    ],
  },
});
