// Focused b12 high-rise identity check build (separate output; shared harness configs untouched).
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
export default defineConfig({
  root, publicDir: false, envDir: false, logLevel: 'warn', cacheDir: resolve(root, '.vite-cache'),
  resolve: { alias: { '@': root } },
  ssr: { noExternal: true },
  build: { ssr: true, outDir: resolve(root, '.work/harness-dist-b12-highrise'), emptyOutDir: true,
    rolldownOptions: { input: { 'b12-highrise-identity-check': resolve(import.meta.dirname, 'b12-highrise-identity-check.ts') },
      output: { entryFileNames: '[name].mjs' } } },
});
