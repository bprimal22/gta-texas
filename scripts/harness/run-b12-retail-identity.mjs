// b12 retail-identity harness runner (headless, no browser).
//   npx vite build --config scripts/harness/b12-retail-identity.vite.config.mjs
//   node scripts/harness/run-b12-retail-identity.mjs           standalone: real Rapier + offline terrain + retail trimesh only
//   node scripts/harness/run-b12-retail-identity.mjs --scene   full headless scene with .work/INTEGRATION.json applied in memory
// Writes .work/b12-retail-report-<mode>.json; exit code 1 on any failure.
import './stubs.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const root = resolve(import.meta.dirname, '../..');
const mod = await import(pathToFileURL(resolve(root, '.work/b12-retail-harness-dist/b12-retail-identity.mjs')).href);
const sceneMode = process.argv.includes('--scene');
const started = Date.now();
const res = sceneMode ? await mod.scene() : await mod.standalone();
res.seconds = Math.round((Date.now() - started) / 100) / 10;
const out = resolve(root, `.work/b12-retail-report-${sceneMode ? 'scene' : 'standalone'}.json`);
writeFileSync(out, JSON.stringify(res, null, 1));
const sites = res.mode === 'scene' ? res.report.retail : res.report;
for (const [id, r] of Object.entries(sites ?? {})) {
  if (!r || typeof r !== 'object' || !r.geometry) continue;
  const probes = (r.probes ?? []).filter(p => p.ok).length + '/' + (r.probes ?? []).length;
  console.log(`${id.padEnd(9)} ${r.key} top ${r.records?.frozenTop} ring ${r.records?.exactCityRing ? 'exact' : 'DIFF'} roof ${r.roof?.offTop}/${r.roof?.samples} off | tris ${r.geometry.solidTriangles}+${r.geometry.detailTriangles} maxOut ${r.geometry.maxOutsideRing} | probes ${probes} | headroom min ${r.headroom?.minClear} | capsules ${r.standing?.blocked}/${r.standing?.capsules} | scooter rides ${r.scooter?.rides?.length} ownStops ${(r.scooter?.rides ?? []).reduce((a, x) => a + x.ownStops, 0)} | warnings ${r.warnings?.length}`);
}
if (res.report?.renderEqualsCollision) console.log('render = collision', JSON.stringify(res.report.renderEqualsCollision));
if (res.report?.retail?.renderEqualsCollision) console.log('render = collision', JSON.stringify(res.report.retail.renderEqualsCollision));
if (res.report?.G3) console.log('G3', JSON.stringify(res.report.G3), 'G1', JSON.stringify(res.report.G1?.committed));
console.log(res.ok ? `RETAIL ${res.mode} PASS (${res.seconds}s) -> ${out}` : `RETAIL ${res.mode} FAIL (${res.failures.length}) -> ${out}\n  ` + res.failures.slice(0, 30).join('\n  '));
process.exit(res.ok ? 0 : 1);
