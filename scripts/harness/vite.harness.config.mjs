import { defineConfig } from 'vite';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
export default defineConfig({
  root, publicDir: false, envDir: false, logLevel: 'warn', cacheDir: resolve(root, '.vite-cache'),
  resolve: { alias: { '@': root } },
  ssr: { noExternal: true },
  build: { ssr: true, outDir: resolve(root, '.work/harness-dist'), emptyOutDir: true,
    rolldownOptions: { input: { 'context-check': resolve(import.meta.dirname, 'context-check.ts'), 'travel-fixture': resolve(import.meta.dirname, 'travel-fixture.ts'), 'gdc-check': resolve(import.meta.dirname, 'gdc-check.ts'), 'ground-check': resolve(import.meta.dirname, 'ground-check.ts'), 'block-framework-test': resolve(import.meta.dirname, 'block-framework-test.ts') },
      output: { entryFileNames: '[name].mjs' } } },
});
