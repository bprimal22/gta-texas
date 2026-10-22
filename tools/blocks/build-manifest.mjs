// Builds the machine-readable whole-campus block manifest from the local map data:
//   node tools/blocks/build-manifest.mjs [outDir]
// Checks that the block rectangles tile the campus bounds exactly (2 m sampling, no gaps, no
// overlaps), then assigns every GIS building (by centre, with OVERRIDE_ABBR) and every mapped path
// (primary block = most length; all spanned blocks listed), and every authored module file.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { BOUNDS, BLOCKS, OVERRIDE_ABBR, MODULE_OWNERS, ROOT_SHARED_MODULES, UNIT, inRect } from './partition.mjs';
const ROOT = resolve(import.meta.dirname, '../..');
const outDir = resolve(process.argv[2] ?? resolve(ROOT, '../ut/research/whole-campus-92'));
const data = JSON.parse(readFileSync(resolve(ROOT, 'public/data/campus.json'), 'utf8'));
const [W, N, E, S] = BOUNDS;
const clampX = x => Math.min(E - 1e-6, Math.max(W, x)), clampZ = z => Math.min(S - 1e-6, Math.max(N, z));
const owners = (x, z) => BLOCKS.filter(b => b.rects.some(r => inRect(clampX(x), clampZ(z), r))).map(b => b.id);
// 1. exact tiling
let gaps = 0, overlaps = 0, samples = 0;
for (let x = W + 1; x < E; x += 2) for (let z = N + 1; z < S; z += 2) { samples++; const o = owners(x, z).length; if (o === 0) gaps++; if (o > 1) overlaps++; }
if (gaps || overlaps) { console.error(`partition invalid: ${gaps} gap / ${overlaps} overlap samples of ${samples}`); process.exit(1); }
const area = b => b.rects.reduce((s, [x0, x1, z0, z1]) => s + (x1 - x0) * (z1 - z0), 0);
if (Math.abs(BLOCKS.reduce((s, b) => s + area(b), 0) - (E - W) * (S - N)) > 1e-6) { console.error('partition area mismatch'); process.exit(1); }
// 2. buildings
const byId = Object.fromEntries(BLOCKS.map(b => [b.id, { ...b, areaM2: area(b), buildings: [], paths: [], spanningPaths: [], landmarks: [], modules: [] }]));
const buildingIndex = {}, outOfBounds = [];
for (const b of data.buildings) {
  const [x, z] = b.center, inside = x >= W && x <= E && z >= N && z <= S;
  if (!inside) outOfBounds.push(b.id);
  const id = OVERRIDE_ABBR[b.abbr] ?? owners(x, z)[0];
  buildingIndex[b.id] = id;
  byId[id].buildings.push({ id: b.id, abbr: b.abbr || undefined, name: b.name || undefined, h: b.h, center: b.center.map(v => +v.toFixed(1)), ...(OVERRIDE_ABBR[b.abbr] ? { override: 'footprint owner (ground rect belongs to ' + owners(x, z)[0] + ')' } : {}) });
}
// 2b. review units (cells <= UNIT m inside each rectangle) and whole-ring owners across zone edges
const units = {};
for (const b of BLOCKS) {
  units[b.id] = [];
  b.rects.forEach(([x0, x1, z0, z1], ri) => {
    const nx = Math.ceil((x1 - x0) / UNIT), nz = Math.ceil((z1 - z0) / UNIT), dx = (x1 - x0) / nx, dz = (z1 - z0) / nz;
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++)
      units[b.id].push({ id: `${b.id.split('-')[0]}-r${ri}-${String.fromCharCode(97 + i)}${k + 1}`, rect: [+(x0 + i * dx).toFixed(1), +(x0 + (i + 1) * dx).toFixed(1), +(z0 + k * dz).toFixed(1), +(z0 + (k + 1) * dz).toFixed(1)], buildings: [] });
  });
}
const crossBoundary = [];
data.buildings.forEach((b, recordIndex) => {
  const owner = buildingIndex[b.id], [x, z] = b.center;
  const u = units[owner].find(u => inRect(clampX(x), clampZ(z), u.rect)) ?? units[owner][0];
  u.buildings.push(`${b.id}:${recordIndex}`);
  const xs = b.rings[0].map(p => p[0]), zs = b.rings[0].map(p => p[1]);
  const touched = new Set(); for (const px of [Math.min(...xs), (Math.min(...xs) + Math.max(...xs)) / 2, Math.max(...xs)]) for (const pz of [Math.min(...zs), (Math.min(...zs) + Math.max(...zs)) / 2, Math.max(...zs)]) for (const o of owners(px, pz)) touched.add(o);
  if (touched.size > 1) crossBoundary.push({ id: b.id, recordIndex, abbr: b.abbr || undefined, ringOwner: owner, bboxTouches: [...touched].sort((p, q) => p.localeCompare(q)) });
});
// 3. paths: length per block by 2 m sampling along segments
const pathIndex = {};
for (const p of data.paths) {
  const len = {};
  for (let i = 1; i < p.points.length; i++) {
    const [ax, az] = p.points[i - 1], [bx, bz] = p.points[i], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 2));
    for (let k = 0; k < n; k++) { const t = (k + 0.5) / n, id = owners(ax + (bx - ax) * t, az + (bz - az) * t)[0]; len[id] = (len[id] ?? 0) + L / n; }
  }
  const ranked = Object.entries(len).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) { pathIndex[p.id] = { primary: null }; continue; }
  const primary = ranked[0][0];
  pathIndex[p.id] = { primary, spans: ranked.map(([id, l]) => [id, +l.toFixed(1)]) };
  const entry = { id: p.id, kind: p.kind, name: p.name || undefined, width: p.width, length: +ranked.reduce((s, r) => s + r[1], 0).toFixed(1) };
  byId[primary].paths.push(entry);
  for (const [id] of ranked.slice(1)) byId[id].spanningPaths.push({ id: p.id, name: p.name || undefined, primary });
}
for (const [k, v] of Object.entries(data.landmarks)) byId[owners(...v.position)[0]].landmarks.push({ id: k, name: v.name, position: v.position });
// 4. authored modules
const files = readdirSync(resolve(ROOT, 'lib/campus')).filter(f => /\.(ts|json)$/.test(f));
const moduleOwner = {};
for (const f of files) { if (ROOT_SHARED_MODULES.includes(f)) { moduleOwner[f] = 'root-shared'; continue; } const hit = MODULE_OWNERS.find(([re]) => re.test(f)); if (hit) { moduleOwner[f] = hit[1]; byId[hit[1]].modules.push(f); } }
const manifest = {
  version: 1, generatedBy: 'tools/blocks/build-manifest.mjs', source: 'public/data/campus.json (City of Austin 2023 footprints, OSM paths)',
  bounds: BOUNDS, tiling: { samples, gaps, overlaps, method: '2 m grid, half-open rectangles' },
  coverage: { buildings: data.buildings.length, buildingsAssigned: Object.keys(buildingIndex).length, paths: data.paths.length, pathsAssigned: Object.values(pathIndex).filter(p => p.primary).length,
    buildingsWithCentreOutsideBounds: outOfBounds, exclusions: [],
    dataIssues: Object.entries(data.buildings.reduce((m, b) => ((m[b.id] = (m[b.id] ?? 0) + 1), m), {})).filter(([, n]) => n > 1)
      .map(([id, n]) => ({ id: +id, footprints: n, block: buildingIndex[id], issue: 'GIS id shared by several footprints (all assigned to this block)' })) },
  sharedEdges: 'A path or ground feature crossing a block edge is owned by its primary block (most length); the neighbour must not move it and coordinates elevations at the edge. Footprint overrides own their ring + 3 m.',
  rootSharedModules: ROOT_SHARED_MODULES, crossBoundaryBuildings: crossBoundary,
  ringOwnershipRule: 'The block owning a building record owns its whole footprint ring + 3 m clearance, even where the ring crosses a zone edge; neighbours must not build inside it.',
  blocks: Object.values(byId).map(b => ({ ...b, units: units[b.id].filter(u => u.buildings.length || true), counts: { buildings: b.buildings.length, named: b.buildings.filter(x => x.abbr).length, paths: b.paths.length, spanning: b.spanningPaths.length, modules: b.modules.length } })),
  buildingIndex, pathIndex, moduleOwner,
};
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'blocks.json'), JSON.stringify(manifest, null, 1) + '\n');
// Runtime ownership table for blocks/registry.ts validation (record key -> block, block rectangles, ambiguous ids).
{
  const recordOwner = {}; data.buildings.forEach((b, i) => { recordOwner[`${b.id}:${i}`] = buildingIndex[b.id]; });
  const counts = {}; for (const b of data.buildings) counts[b.id] = (counts[b.id] ?? 0) + 1;
  writeFileSync(resolve(ROOT, 'lib/campus/blocks/ownership.json'), JSON.stringify({ generatedBy: 'tools/blocks/build-manifest.mjs', recordOwner,
    rects: Object.fromEntries(BLOCKS.map(b => [b.id, b.rects])), ambiguousIds: Object.keys(counts).filter(k => counts[k] > 1).map(Number) }) + '\n');
}
// In-repo copy for headless checks (the isolation sandbox cannot read the research folder).
writeFileSync(resolve(ROOT, 'tools/blocks/blocks.json'), JSON.stringify(manifest) + '\n');
console.log('tiling OK', samples, 'samples');
for (const b of manifest.blocks) console.log(b.id.padEnd(20), JSON.stringify(b.counts), b.landmarks.map(l => l.id).join(','));
console.log('coverage', JSON.stringify(manifest.coverage));
console.log('units', manifest.blocks.reduce((n, b) => n + b.units.length, 0), 'crossBoundary', crossBoundary.length);
