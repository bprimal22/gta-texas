// Usage (from the lane root): node scripts/harness/run-capitol-shader-check.mjs
// Bundles capitol-shader-check.ts with vite (SSR) and runs it under Node; no GPU.
import './stubs.mjs';
import { build } from 'vite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../..');
const outDir = resolve(root, '.work/capitol-shader-dist');
await build({
  configFile: false, root, publicDir: false, envDir: false, logLevel: 'warn', cacheDir: resolve(root, '.vite-cache'),
  resolve: { alias: { '@': root } },
  ssr: { noExternal: true },
  build: { ssr: true, outDir, emptyOutDir: true,
    rolldownOptions: { input: { 'capitol-shader-check': resolve(import.meta.dirname, 'capitol-shader-check.ts') },
      output: { entryFileNames: '[name].mjs' } } },
});
const { runCapitolShaderCheck } = await import(pathToFileURL(resolve(outDir, 'capitol-shader-check.mjs')).href);
const result = runCapitolShaderCheck();
console.log(JSON.stringify(result, null, 1));
if (result.failures.length) { result.failures.forEach(f => console.error('FAIL:', f)); process.exit(1); }
console.log('capitol shader check passed: exterior blockwork forwards the renderer to the AO-wrapped granite hook; base, blockwork and AO injections present.');
