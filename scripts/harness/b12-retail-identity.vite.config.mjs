// Harness bundle for the b12 retail-identity lane: same shape as vite.harness.config.mjs, separate output / cache, plus an
// in-memory loader that applies .work/INTEGRATION.json (edits + context.json replaces / catalog patches) to the parent-owned
// files WITHOUT writing them. Every anchor must match exactly once, otherwise the build fails.
//   npx vite build --config scripts/harness/b12-retail-identity.vite.config.mjs
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const root = resolve(import.meta.dirname, '../..');
const applyHandoff = process.env.RETAIL_APPLY_HANDOFF === '1';
const spec = applyHandoff ? JSON.parse(readFileSync(resolve(root, '.work/INTEGRATION.json'), 'utf8')) : null;
const applied = [];
function integration() {
  const byFile = new Map();
  for (const e of spec.edits) { const f = resolve(root, e.file); if (!byFile.has(f)) byFile.set(f, []); byFile.get(f).push(e); }
  const ctxFile = resolve(root, spec.contextJson.file);
  return {
    name: 'b12-retail-integration', enforce: 'pre',
    load(id) {
      const file = id.split('?')[0];
      if (file === ctxFile) {
        const j = JSON.parse(readFileSync(file, 'utf8'));
        j.replaces ??= {};
        for (const [k, v] of Object.entries(spec.contextJson.replaces)) { if (j.replaces[k]) throw new Error(`replaces ${k} already present`); j.replaces[k] = v; }
        for (const [k, v] of Object.entries(spec.contextJson.catalog ?? {})) { if (!j.catalog?.[k]) throw new Error(`catalog ${k} missing`); j.catalog[k] = { ...j.catalog[k], ...v }; }
        applied.push(`${spec.contextJson.file}: +${Object.keys(spec.contextJson.replaces).length} replaces, ${Object.keys(spec.contextJson.catalog ?? {}).length} catalog patch(es)`);
        return JSON.stringify(j);
      }
      const edits = byFile.get(file); if (!edits) return null;
      let src = readFileSync(file, 'utf8');
      for (const e of edits) {
        const n = src.split(e.anchor).length - 1; if (n !== 1) throw new Error(`integration anchor found ${n}x in ${e.file}: ${e.anchor}`);
        src = e.kind === 'replace' ? src.replace(e.anchor, () => e.text) : e.kind === 'insertAfter' ? src.replace(e.anchor, () => e.anchor + e.text) : src.replace(e.anchor, () => e.text + e.anchor);
        applied.push(`${e.file}: ${e.kind}`);
      }
      return src;
    },
    buildEnd() { console.log('[b12-retail-integration] applied in memory:\n  ' + applied.join('\n  ')); },
  };
}
export default defineConfig({
  root, publicDir: false, envDir: false, logLevel: 'warn', cacheDir: resolve(root, '.work/b12-retail-vite-cache'),
  resolve: { alias: { '@': root } },
  plugins: applyHandoff ? [integration()] : [],
  ssr: { noExternal: true },
  build: { ssr: true, outDir: resolve(root, '.work/b12-retail-harness-dist'), emptyOutDir: true,
    rolldownOptions: { input: { 'b12-retail-identity': resolve(import.meta.dirname, 'b12-retail-identity-entry.ts') }, output: { entryFileNames: '[name].mjs' } } },
});
