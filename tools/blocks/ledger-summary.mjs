// Whole-campus coverage summary from every block ledger (research/whole-campus-92/<block>/ledger.json [+ ledger-east.json]).
//   node tools/blocks/ledger-summary.mjs [researchDir]  → prints a table and writes <researchDir>/LEDGER-SUMMARY.{json,md}
// Counts stage flags per block exactly as recorded by the owners; it does not upgrade anything. "visually-reviewed" stays a
// Codex gate; "still-inferred" true means the record still contains estimated elements.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const ROOT = resolve(import.meta.dirname, '../..');
const dir = resolve(process.argv[2] ?? resolve(ROOT, '../ut/research/whole-campus-92'));
const manifest = JSON.parse(readFileSync(resolve(dir, 'blocks.json'), 'utf8'));
const STAGES = ['inventoried', 'reference-reviewed', 'implemented', 'geometry-verified', 'visually-reviewed', 'still-inferred'];
const rows = [], totals = Object.fromEntries([...STAGES, 'records', 'sourceRecords', 'added', 'excluded'].map(k => [k, 0]));
for (const b of manifest.blocks) {
  const recs = [];
  for (const f of ['ledger.json', 'ledger-east.json']) {
    const p = resolve(dir, b.id, f);
    if (existsSync(p)) recs.push(...(JSON.parse(readFileSync(p, 'utf8')).buildings ?? []));
  }
  const byKey = new Map(); for (const r of recs) if (r?.key) byKey.set(r.key, r);
  const list = [...byKey.values()];
  const row = { block: b.id, sourceRecords: b.counts.buildings, records: list.length, added: list.filter(r => String(r.key).endsWith(':add')).length,
    excluded: list.filter(r => r.decision === 'excluded').length, missingFromLedger: 0 };
  for (const s of STAGES) row[s] = list.filter(r => r.stage?.[s]).length;
  const keys = new Set(list.map(r => r.key));
  for (const u of b.units) for (const k of u.buildings) if (!keys.has(k)) row.missingFromLedger++;
  rows.push(row);
  for (const k of Object.keys(totals)) totals[k] += row[k] ?? 0;
}
const md = ['# Whole-campus ledger summary (owner-recorded stages; not a 1:1 claim)', '',
  '| Block | Source records | Ledger records | Added | Excluded | Missing from ledger | Reference-reviewed | Implemented | Geometry-verified | Visually reviewed | Still inferred |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...rows.map(r => `| ${r.block} | ${r.sourceRecords} | ${r.records} | ${r.added} | ${r.excluded} | ${r.missingFromLedger} | ${r['reference-reviewed']} | ${r.implemented} | ${r['geometry-verified']} | ${r['visually-reviewed']} | ${r['still-inferred']} |`),
  `| **total** | ${totals.sourceRecords} | ${totals.records} | ${totals.added} | ${totals.excluded} | ${rows.reduce((s, r) => s + r.missingFromLedger, 0)} | ${totals['reference-reviewed']} | ${totals.implemented} | ${totals['geometry-verified']} | ${totals['visually-reviewed']} | ${totals['still-inferred']} |`, ''].join('\n');
writeFileSync(resolve(dir, 'LEDGER-SUMMARY.json'), JSON.stringify({ rows, totals }, null, 1) + '\n');
writeFileSync(resolve(dir, 'LEDGER-SUMMARY.md'), md);
console.log(md);
