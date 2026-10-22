// Sequential, ownership-checked merge of a whole-campus worker lane into root.
//   node tools/blocks/merge-lane.mjs <block-id> [--apply] [--base .work/wc-base-1] [--lane <dir under .work/wc-lanes>] [--allow f1,f2 (explicit integrator grants)]
// Lists files the lane changed vs the frozen base, rejects any outside the block's allowed set
// (WORKER-CONTRACT.md), detects root drift since the base (conflict), and copies only with --apply.
import { readFileSync, existsSync, copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
const ROOT = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2), id = args[0], apply = args.includes('--apply');
const base = resolve(ROOT, args.includes('--base') ? args[args.indexOf('--base') + 1] : '.work/wc-base-1');
const lane = resolve(ROOT, '.work/wc-lanes', args.includes('--lane') ? args[args.indexOf('--lane') + 1] : id);
if (!id || !existsSync(lane)) { console.error('usage: merge-lane.mjs <block-id> [--apply]'); process.exit(2); }
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'tools/blocks/blocks.json'), 'utf8'));
const owned = Object.entries(manifest.moduleOwner).filter(([, o]) => o === id).map(([f]) => `lib/campus/${f}`);
const ownedPlans = owned.map(f => f.replace(/^lib\/campus\/(.*)\.ts$/, 'public/data/$1-plan.json'));
const grants = args.includes('--allow') ? args[args.indexOf('--allow') + 1].split(',') : [];
const allowed = f => grants.includes(f) || f.startsWith(`lib/campus/blocks/${id}/`) || f === `scripts/harness/blocks/${id}.ts` || f.startsWith(`public/assets/blocks/${id}/`)
  || owned.includes(f) || ownedPlans.includes(f);
const skip = /^(node_modules|\.work|dist|\.vite-cache|\.git)(\/|$)|(^|\/)\.DS_Store$|^HANDOFF\.md$/;
const walk = (dir, out = []) => { for (const e of readdirSync(dir)) { const p = resolve(dir, e), r = relative(lane, p); if (skip.test(r)) continue; const s = statSync(p, { throwIfNoEntry: false }); if (!s) continue; if (s.isDirectory() && !s.isSymbolicLink()) walk(p, out); else if (s.isFile()) out.push(r); } return out; };
const sha = p => existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null;
const changed = [], rejected = [], conflicts = [];
for (const f of walk(lane)) {
  const l = sha(resolve(lane, f)), b = sha(resolve(base, f));
  if (l === b) continue;
  if (!allowed(f)) { rejected.push(f); continue; }
  const r = sha(resolve(ROOT, f));
  if (r !== b) conflicts.push({ f, root: r?.slice(0, 12), base: b?.slice(0, 12) });
  changed.push({ f, status: b ? 'modified' : 'added' });
}
// deletions of allowed files
for (const f of [...owned, ...ownedPlans]) if (existsSync(resolve(base, f)) && !existsSync(resolve(lane, f))) changed.push({ f, status: 'deleted (not applied; review manually)' });
console.log(JSON.stringify({ block: id, changed, rejected, conflicts }, null, 1));
if (rejected.length || conflicts.length) { console.error(`NOT MERGEABLE: ${rejected.length} outside ownership, ${conflicts.length} root conflicts`); process.exit(1); }
if (apply) {
  for (const { f, status } of changed) { if (!/^(modified|added)$/.test(status)) continue; mkdirSync(dirname(resolve(ROOT, f)), { recursive: true }); copyFileSync(resolve(lane, f), resolve(ROOT, f)); }
  console.log(`applied ${changed.filter(c => /^(modified|added)$/.test(c.status)).length} files from ${id}`);
}
