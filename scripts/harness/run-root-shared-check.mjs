// Root-shared generator check (not part of the block aggregator).
//   node scripts/harness/run-root-shared-check.mjs [--no-scan] [--json out.json] [--baseline before.json]
// Builds the real headless scene from the harness bundle (like run-block-checks.mjs) and runs
// scripts/harness/blocks/root-shared.ts (Node strips its types; it imports only three + node:fs).
import './stubs.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync, readFileSync } from 'node:fs';
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const { run } = await import(pathToFileURL(resolve(root, '.work/harness-dist/context-check.mjs')).href);
const { check } = await import(pathToFileURL(resolve(import.meta.dirname, 'blocks/root-shared.ts')).href);
const began = performance.now();
const scene = await run({ scan: !args.includes('--no-scan') });
const sceneMs = Math.round(performance.now() - began);
// --baseline <json>: a previous --json output of the UNMODIFIED generators (route-headroom keys).
const bi = args.indexOf('--baseline');
// Default: the in-repo copy of the unmodified-generator run (scripts/harness/blocks/root-shared-baseline.json), so the check is
// self-contained in the isolation sandbox.
const baselinePath = bi >= 0 ? resolve(args[bi + 1]) : resolve(import.meta.dirname, 'blocks/root-shared-baseline.json');
const headroomBaseline = JSON.parse(readFileSync(baselinePath, 'utf8')).report.routeHeadroom.keys;
const result = await check(scene, { headroomBaseline });
const out = args.indexOf('--json');
if (out >= 0) writeFileSync(resolve(args[out + 1]), JSON.stringify({ sceneMs, ...result }, null, 1));
for (const [abbr, r] of Object.entries(result.report.roofs ?? {})) {
  console.log('ROOF', abbr, JSON.stringify({ lidarY: r.lidarY, modelY: r.modelY, residual: r.residual, coverage: r.coverage, tiers: r.tiers.map(t => [t.tierHeight, t.lidarY, t.modelMedianY, t.residual, t.samples]), visPhys: r.visPhys }));
}
for (const k of Object.keys(result.report).filter(k => k !== 'roofs')) console.log('REPORT', k, JSON.stringify(result.report[k], (key, v) => key === 'keys' ? `[${v.length}]` : v));
for (const f of result.failures ?? []) console.error('FAIL', f);
console.log(result.ok ? 'ROOT-SHARED OK' : 'ROOT-SHARED FAILED', `scene ${sceneMs} ms`);
process.exit(result.ok ? 0 : 1);
