import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

// Whole-campus block data (every lib/campus/blocks/<id>/**.json) ships without its citation text: every `evidence.source` (URLs, page titles) is
// replaced by a pointer to the research ledger, so the runtime bundle carries no external URL strings. The
// headless harness (scripts/harness/vite.harness.config.mjs) keeps the full citations for its checks.
function stripBlockEvidence(): Plugin {
  const scrub = (v: unknown): unknown => {
    if (typeof v === 'string') return v.replace(/\b(?:https?|wss?):\/\/[^\s)"']+/g, '[cited]');
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === 'object') {
      const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]));
      if (typeof o.source === 'string' && typeof o.basis === 'string') o.source = 'cited in research/whole-campus-92 ledger';
      return o;
    }
    return v;
  };
  return {
    name: 'strip-block-evidence', enforce: 'pre',
    transform(code, id) {
      if (!/lib\/campus\/blocks\/[^/]+\/.*\.json$/.test(id.split('?')[0])) return null;
      return { code: JSON.stringify(scrub(JSON.parse(code))), map: null };
    },
  };
}

// Standalone static build. Everything the game loads at runtime is emitted into
// dist/ and served from the same origin by scripts/serve.mjs.
export default defineConfig({
  root: resolve(import.meta.dirname, 'web'),
  publicDir: resolve(import.meta.dirname, 'public'),
  envDir: false,
  // Per-checkout cache so isolated work copies never write into shared node_modules.
  cacheDir: resolve(import.meta.dirname, '.vite-cache'),
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname),
    },
  },
  plugins: [stripBlockEvidence(), react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 4096,
    // Inline nothing as data: URLs; every asset stays a same-origin file.
    assetsInlineLimit: 0,
  },
});
