// b12 high-rise identity check: frozen-baseline integration plan (valid in BOTH the baseline and the fully applied owner
// contexts; partial / tampered / drifted contexts fail), generator glass / opening character vs the prior archetype, source
// colours / families, body envelope + render = collider + trim topology, root-patch anchors, deep-West profile parity, shots,
// no remote deps. Writes .work/b12-highrise-identity-check.json, .work/INTEGRATION.json, .work/HIGHRISE-LEDGER.json;
// --emit also writes the owned ledger.json / shots.json; --freeze-baseline writes the owned baseline.json (refused if the
// contexts already carry profile values). Exit 1 on any failed check.
import './stubs.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const root = resolve(import.meta.dirname, '../..');
const mod = await import(pathToFileURL(resolve(root, '.work/harness-dist-b12-highrise/b12-highrise-identity-check.mjs')).href);
const report = await mod.run(root, { emit: process.argv.includes('--emit'), freeze: process.argv.includes('--freeze-baseline') });
for (const r of report.results) {
  const detail = JSON.stringify(r.detail);
  console.log(r.pass ? 'PASS' : 'FAIL', r.name, process.argv.includes('--details') || !r.pass ? detail : detail.slice(0, 240));
}
writeFileSync(resolve(root, '.work/b12-highrise-identity-check.json'), JSON.stringify(report, null, 1) + '\n');
console.log(report.pass ? 'B12 HIGHRISE IDENTITY CHECK PASS' : 'B12 HIGHRISE IDENTITY CHECK FAIL', report.results.filter(r => r.pass).length + '/' + report.results.length, `(${report.ms} ms, contexts: ${report.mode})`);
process.exit(report.pass ? 0 : 1);
