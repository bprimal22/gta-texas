// Usage (from the lane root, Node 25): node scripts/harness/run-ground-paving-overlap-test.mjs
// Bundles ground-paving-overlap-test.ts with vite (SSR) and runs it under Node; no GPU.
import './stubs.mjs';
import { build } from 'vite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../..');
const outDir = resolve(root, '.work/ground-paving-overlap-dist');
await build({
  configFile: false, root, publicDir: false, envDir: false, logLevel: 'warn', cacheDir: resolve(root, '.vite-cache'),
  resolve: { alias: { '@': root } },
  ssr: { noExternal: true },
  build: { ssr: true, outDir, emptyOutDir: true,
    rolldownOptions: { input: { 'ground-paving-overlap-test': resolve(import.meta.dirname, 'ground-paving-overlap-test.ts') },
      output: { entryFileNames: '[name].mjs' } } },
});
const { runGroundPavingOverlapTest } = await import(pathToFileURL(resolve(outDir, 'ground-paving-overlap-test.mjs')).href);
const result = await runGroundPavingOverlapTest();
console.log(JSON.stringify(result, null, 1));
if (result.failures.length) { result.failures.forEach(f => console.error('FAIL:', f)); process.exit(1); }
console.log('ground paving overlap test passed: clipped tie-ins leave hard ground uncovered; contacts, copings and originals unchanged.');
