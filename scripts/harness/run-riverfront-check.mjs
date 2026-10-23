// Focused riverfront extension check: decode/fail-closed binding to downtown, ownership overlay, render/collider parity,
// Pfluger crossing, park paths, walls/barriers, flight over river and ponds, travel, LOD, disposal, budgets.
// Writes .work/riverfront-check.json. Exit code 1 on any failed check.
import './stubs.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
const root = resolve(import.meta.dirname, '../..');
const mod = await import(pathToFileURL(resolve(root, '.work/harness-dist-riverfront/riverfront-check.mjs')).href);
const report = await mod.run(root);
for (const r of report.results) {
  const detail = JSON.stringify(r.detail);
  console.log(r.pass ? 'PASS' : 'FAIL', r.name, process.argv.includes('--details') || !r.pass ? detail : detail.slice(0, 220));
}
mkdirSync(resolve(root, '.work'), { recursive: true });
writeFileSync(resolve(root, '.work/riverfront-check.json'), JSON.stringify(report, null, 1) + '\n');
console.log(report.pass ? 'RIVERFRONT CHECK PASS' : 'RIVERFRONT CHECK FAIL', report.results.filter(r => r.pass).length + '/' + report.results.length);
process.exit(report.pass ? 0 : 1);
