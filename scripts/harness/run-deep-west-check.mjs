// Focused deep-west extension (D37-D40) check: seam float identity, fail-closed decoding,
// render/collider parity, drape lip, seam walking, walls, travel, flight and review shots.
// Writes .work/deep-west-check.json. Exit code 1 on any failed check.
import './stubs.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
const root = resolve(import.meta.dirname, '../..');
const mod = await import(pathToFileURL(resolve(root, '.work/harness-dist-deep-west/deep-west-check.mjs')).href);
const report = await mod.run(root);
for (const r of report.results) {
  const detail = JSON.stringify(r.detail);
  console.log(r.pass ? 'PASS' : 'FAIL', r.name, process.argv.includes('--details') || !r.pass ? detail : detail.slice(0, 220));
}
mkdirSync(resolve(root, '.work'), { recursive: true });
writeFileSync(resolve(root, '.work/deep-west-check.json'), JSON.stringify(report, null, 1) + '\n');
console.log(report.pass ? 'DEEP WEST CHECK PASS' : 'DEEP WEST CHECK FAIL', report.results.filter(r => r.pass).length + '/' + report.results.length);
process.exit(report.pass ? 0 : 1);
