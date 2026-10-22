import { defineConfig } from 'vite';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../../../..');
export default defineConfig({
  root, publicDir: false, envDir: false, logLevel: 'warn', cacheDir: resolve(root, '.vite-cache-render'),
  resolve: { alias: { '@': root } },
  ssr: { noExternal: true },
  build: { ssr: true, outDir: resolve(root, '.work/render-checks-dist'), emptyOutDir: true,
    rolldownOptions: { input: { 'render-checks': resolve(import.meta.dirname, 'render-checks.ts') },
      output: { entryFileNames: '[name].mjs' } } },
});
