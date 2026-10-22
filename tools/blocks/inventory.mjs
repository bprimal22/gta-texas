// Per-record whole-campus ledger skeleton from the REAL headless scene (not from GIS assignment):
//   node tools/blocks/inventory.mjs [researchDir]      (needs the harness bundle: vite build --config scripts/harness/vite.harness.config.mjs)
// For every building record: owner block + review unit, the generated-context decision actually taken
// (generated / authored / route / stadium / invalid, with the classifier fractions behind a suppression),
// catalogue archetype + basis, GIS and LiDAR heights, and the authored meshes whose bounds cover it.
// For every block: authored meshes (name, triangles, bounds) whose centre lies in it.
// Writes <researchDir>/<block>/ledger.json (stage flags all false except `inventoried`; owners update
// them) and tools/blocks/decisions-baseline.json (compact, in-repo, for regression).
import '../../scripts/harness/stubs.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const ROOT = resolve(import.meta.dirname, '../..');
const outDir = resolve(process.argv[2] ?? resolve(ROOT, '../ut/research/whole-campus-92'));
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'tools/blocks/blocks.json'), 'utf8'));
const roofs = JSON.parse(readFileSync(resolve(ROOT, 'public/data/derived/roofs-lidar.json'), 'utf8')).buildings;
const { run, CATALOG } = await import(pathToFileURL(resolve(ROOT, '.work/harness-dist/context-check.mjs')).href);
const THREE = await import('three');
const scene = await run({ scan: true });
const { context, walkway, world } = scene;
const unitOf = {};
for (const b of manifest.blocks) for (const u of b.units) for (const key of u.buildings) unitOf[key] = u.id;
// authored meshes with world bounds
const meshes = [];
const box = new THREE.Box3();
const seen = new Set();
for (const [rootName, rootObj] of [['walkway.surfaces', walkway.surfaces], ['walkway.group', walkway.group], ['world.group', world.group]]) {
  rootObj.updateWorldMatrix(true, true);
  rootObj.traverse(o => {
    if (!o.isMesh || o.name === 'Offline local contour terrain' || seen.has(o)) return;
    seen.add(o);
    box.setFromObject(o); if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    meshes.push({ name: o.name || '(unnamed)', root: rootName, triangles: (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3,
      bounds: [box.min.x, box.max.x, box.min.z, box.max.z, box.min.y, box.max.y].map(v => +v.toFixed(1)), centre: [+c.x.toFixed(1), +c.z.toFixed(1)] });
  });
}
const blockOfPoint = (x, z) => { for (const b of manifest.blocks) for (const [x0, x1, z0, z1] of b.rects) if (x >= x0 && x < x1 && z >= z0 && z < z1) return b.id; return null; };
const planByKey = new Map(context.plans.map(p => [p.building.key, p]));
const ledgers = Object.fromEntries(manifest.blocks.map(b => [b.id, { block: b.id, name: b.name, generatedFrom: 'tools/blocks/inventory.mjs (real headless scene)', stages: ['inventoried', 'reference-reviewed', 'implemented', 'geometry-verified', 'visually-reviewed', 'still-inferred'], units: b.units.map(u => ({ id: u.id, rect: u.rect })), buildings: [], authoredMeshes: [], paths: { primary: b.counts.paths, spanning: b.counts.spanning } }]));
const decisions = {};
scene.world.data.buildings.forEach(b => {
  // Immutable record keys (registry.applyBlockData): excluded records never shift later keys; added ones end ":add".
  const key = b.key, added = key.endsWith(':add');
  const block = added ? scene.blockData.added.find(a => a.key === key)?.block : manifest.buildingIndex[b.id], plan = planByKey.get(key), lidar = roofs[String(b.id)], cat = CATALOG.buildings[String(b.id)];
  const xs = b.rings[0].map(p => p[0]), zs = b.rings[0].map(p => p[1]), bb = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const covering = meshes.filter(m => m.bounds[0] < bb[1] && m.bounds[1] > bb[0] && m.bounds[2] < bb[3] && m.bounds[3] > bb[2] && m.bounds[5] - m.bounds[4] > 2.5)
    .sort((p, q) => q.triangles - p.triangles).slice(0, 8).map(m => m.name);
  const rec = {
    key, id: b.id, abbr: b.abbr || undefined, name: b.name || undefined, unit: unitOf[key] ?? (added ? 'added' : undefined), added: added || undefined,
    gisHeight: b.h, lidar: lidar ? { status: lidar.status, heightP50: lidar.heightP50, heightP95: lidar.heightP95, heightMax: lidar.heightMax, tiers: lidar.tiers?.length ?? 0, groundY: lidar.groundY } : null,
    decision: plan?.decision ?? 'missing', replacedBy: scene.blocks.replacements.committed[key], classifier: plan ? { elevated: +plan.elevatedFraction.toFixed(3), perimeter: +plan.perimeterFraction.toFixed(3), ground: +plan.groundFraction.toFixed(3) } : null,
    catalog: cat ? { archetype: cat.archetype, basis: cat.basis } : null, authoredCovering: covering,
    stage: { inventoried: true, 'reference-reviewed': false, implemented: false, 'geometry-verified': false, 'visually-reviewed': false, 'still-inferred': true },
    evidence: [], corrections: [], gaps: [],
  };
  if (rec.decision === 'route') rec.gaps.push('suppressed: authored walkable ground inside the footprint (classifier "route") — verify the building is really drawn by authored work or restore it');
  if (rec.decision === 'authored' && !covering.length) rec.gaps.push('suppressed as "authored" but no authored mesh taller than 2.5 m overlaps its bounds');
  ledgers[block].buildings.push(rec);
  decisions[rec.key] = rec.decision;
});
for (const e of scene.blockData.excluded) { ledgers[e.block].buildings.push({ key: e.key, id: e.id, decision: 'excluded', evidence: [e.evidence], stage: { inventoried: true } }); decisions[e.key] = 'excluded'; }
for (const m of meshes) { const id = blockOfPoint(...m.centre); if (id) ledgers[id].authoredMeshes.push(m); }
for (const [id, l] of Object.entries(ledgers)) {
  const counts = {}; for (const r of l.buildings) counts[r.decision] = (counts[r.decision] ?? 0) + 1;
  l.summary = { records: l.buildings.length, decisions: counts, authoredMeshes: l.authoredMeshes.length, authoredTriangles: l.authoredMeshes.reduce((s, m) => s + m.triangles, 0) };
  const dir = resolve(outDir, id); mkdirSync(dir, { recursive: true });
  const file = resolve(dir, 'ledger.json');
  if (existsSync(file) && !process.argv.includes('--overwrite')) { writeFileSync(resolve(dir, 'ledger.baseline.json'), JSON.stringify(l, null, 1) + '\n'); console.log(id, 'ledger exists: wrote ledger.baseline.json', JSON.stringify(l.summary)); }
  else { writeFileSync(file, JSON.stringify(l, null, 1) + '\n'); writeFileSync(resolve(dir, 'ledger.baseline.json'), JSON.stringify(l, null, 1) + '\n'); console.log(id, JSON.stringify(l.summary)); }
}
writeFileSync(resolve(ROOT, 'tools/blocks/decisions-baseline.json'), JSON.stringify(decisions) + '\n');
