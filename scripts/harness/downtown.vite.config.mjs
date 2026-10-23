// Focused downtown extension check build (separate output; the shared harness config is untouched).
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
export default defineConfig({
  root, publicDir: false, envDir: false, logLevel: 'warn', cacheDir: resolve(root, '.vite-cache'),
  resolve: { alias: { '@': root } },
  ssr: { noExternal: true },
  build: { ssr: true, outDir: resolve(root, '.work/harness-dist-downtown'), emptyOutDir: true,
    rolldownOptions: { input: { 'downtown-check': resolve(import.meta.dirname, 'downtown-check.ts') },
      output: { entryFileNames: '[name].mjs' } } },
});
