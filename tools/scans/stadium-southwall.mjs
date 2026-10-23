// Run after the harness build (node node_modules/vite/bin/vite.js build --config scripts/harness/vite.harness.config.mjs).
// Re-measure exterior-plan.json southWall [x, z, top] from the current generated bowl (no b09 meshes): first stadium solid hit
// of a south-to-north ray at Y 12.5 and the top of the bowl collider just inside it.
import '../../scripts/harness/stubs.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const LANE = resolve(import.meta.dirname, '../..');
const mod = await import(pathToFileURL(resolve(LANE, '.work/harness-dist/context-check.mjs')).href);
const THREE = await import('three');
const p = resolve(LANE, 'lib/campus/blocks/b09-stadium/exterior-plan.json'), ext = JSON.parse(readFileSync(p));
const r = await mod.run({ scan: true });
const all = []; r.context.solid.traverse(o => { if (o.isMesh && o.name.startsWith('Local context stadium ')) all.push(o); });
const out = [];
for (const [x, z0, y0] of ext.southWall) {
  const h = new THREE.Raycaster(new THREE.Vector3(x, 12.5, 470), new THREE.Vector3(0, 0, -1), 0, 160).intersectObjects(all, false)[0];
  if (!h) { out.push([x, z0, y0]); continue; }
  const t = new THREE.Raycaster(new THREE.Vector3(x, 120, h.point.z - 0.5), new THREE.Vector3(0, -1, 0), 0, 200).intersectObjects(all, false)[0];
  out.push([x, +h.point.z.toFixed(3), t ? Math.round(t.point.y * 4) / 4 : y0]);
}
ext.southWall = out;
ext.source.southWall = 'first generated-bowl surface of south-to-north rays at Y 12.5 (SEZ facade on the central block, open-stand underside at the corners) and the bowl top 0.5 m inside it; re-measured 2026-10-23 after the per-side DKR profiles (tools/scans/stadium-southwall.mjs)';
// Same layout as the file (', ' and ': ' separators, one line).
const fmt = v => Array.isArray(v) ? `[${v.map(fmt).join(', ')}]` : v && typeof v === 'object' ? `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${fmt(x)}`).join(', ')}}` : JSON.stringify(v);
writeFileSync(p, fmt(ext));
console.log(out.filter((_, i) => i % 15 === 0));
process.exit(0);
