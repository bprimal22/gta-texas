// Focused West Campus pass check: new towers (H plan, street sides, heights, parity, travel, seam walking), Deep West
// canopy, deep-west facade programme / shader anchors, shots, budget and disposal. Writes .work/west-campus-check.json.
import './stubs.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
const root = resolve(import.meta.dirname, '../..');
const mod = await import(pathToFileURL(resolve(root, '.work/harness-dist-west-campus/west-campus-check.mjs')).href);
const report = await mod.run(root);
for (const r of report.results) {
  const detail = JSON.stringify(r.detail);
  console.log(r.pass ? 'PASS' : 'FAIL', r.name, process.argv.includes('--details') || !r.pass ? detail : detail.slice(0, 220));
}
mkdirSync(resolve(root, '.work'), { recursive: true });
writeFileSync(resolve(root, '.work/west-campus-check.json'), JSON.stringify(report, null, 1) + '\n');
console.log(report.pass ? 'WEST CAMPUS CHECK PASS' : 'WEST CAMPUS CHECK FAIL', report.results.filter(r => r.pass).length + '/' + report.results.length);
process.exit(report.pass ? 0 : 1);
