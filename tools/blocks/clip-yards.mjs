// Root-shared request tool: drop generated mall-yard soil cells (public/data/mall-buildings-plan.json,
// buildings[].yards, consumed by lib/campus/mall-buildings.ts) whose centroid lies inside, or within MARGIN of,
// given building rings. The yard band has no survey basis; real buildings inside it were being suppressed as
// "route" by the generated-context classifier (shared requests b03-r1, b05-r1). Nothing else moves.
//   node tools/blocks/clip-yards.mjs [--apply]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const ROOT = resolve(import.meta.dirname, '../..');
// 2 m: the context classifier rasterises authored ground conservatively on a 2 m grid, so soil within one cell of a
// footprint still flags it.
const MARGIN = 2.9; // half-diagonal of a 4 m yard cell (2.83 m) so no kept cell can touch the ring
const plan = JSON.parse(readFileSync(resolve(ROOT, 'public/data/mall-buildings-plan.json'), 'utf8'));
const campus = JSON.parse(readFileSync(resolve(ROOT, 'public/data/campus.json'), 'utf8'));
const ctx = id => JSON.parse(readFileSync(resolve(ROOT, `lib/campus/blocks/${id}/context.json`), 'utf8'));
// Targets: b03-r1 = City outer rings of records 549259:390 (LTH), 613959:738, 698195:1031;
// b05-r1 = official UT polygons BAT/MEZ/BEN (714471 massing) and CBA/GSB (733879 massing) from b05 context.json.
const targets = [];
for (const key of ['549259:390', '613959:738', '698195:1031']) {
  const [id, idx] = key.split(':').map(Number), b = campus.buildings[idx];
  if (b.id !== id) throw new Error(`record ${key} mismatch`);
  targets.push({ request: 'b03-r1', key, ring: b.rings[0] });
}
// b05-r1: the classifier tests the City record rings (b05 corrects massing, not footprints), so clip against them.
for (const key of ['714471:1095', '733879:1251']) {
  const [id, idx] = key.split(':').map(Number), b = campus.buildings[idx];
  if (b.id !== id) throw new Error(`record ${key} mismatch`);
  targets.push({ request: 'b05-r1', key, ring: b.rings[0] });
}
void ctx;
const inRing = (x, z, r) => { let o = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) o = !o; } return o; };
const segDist = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz, t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L)) : 0; return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t); };
const near = (x, z, r) => inRing(x, z, r) || r.some((a, i) => segDist(x, z, a, r[(i + 1) % r.length]) <= MARGIN);
const report = {};
for (const b of plan.buildings) {
  const before = b.yards.length;
  b.yards = b.yards.filter(cell => {
    const pts = cell[0], cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const hit = targets.find(t => near(cx, cz, t.ring));
    if (hit) { (report[b.abbr] ??= {})[hit.request + ' ' + hit.key] = ((report[b.abbr] ?? {})[hit.request + ' ' + hit.key] ?? 0) + 1; return false; }
    return true;
  });
  if (before !== b.yards.length) report[b.abbr].kept = b.yards.length;
}
console.log(JSON.stringify({ targets: targets.map(t => `${t.request} ${t.key}`), dropped: report }, null, 1));
if (process.argv.includes('--apply')) {
  plan.yardClips = [...(plan.yardClips ?? []), { date: '2026-10-20', tool: 'tools/blocks/clip-yards.mjs', margin: MARGIN, requests: ['b03-r1', 'b05-r1'], dropped: report }];
  writeFileSync(resolve(ROOT, 'public/data/mall-buildings-plan.json'), JSON.stringify(plan) + '\n');
  console.log('applied');
}
