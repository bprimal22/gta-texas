// Root-shared generator check (whole-campus-92, root-shared lane). NOT registered in the block aggregator;
// run with: node scripts/harness/run-root-shared-check.mjs
// It measures the REAL built geometry of the root-shared generators in campus Y and compares it with the
// 2017 LiDAR (public/data/derived/roofs-lidar.json, campus Y = groundY + height), sampled the same way as
// the LiDAR statistics (1 m grid inside the City footprint ring, >= 0.75 m from its edges):
//  1. per building: model roof P50 / P95 / max vs LiDAR, and per LiDAR tier (area >= 100 m2) the model
//     median vs the tier Y. Only meshes of the owning generator are measured (no trees, no other blocks).
//  2. visible = physical: at every sampled roof top a collider lies within 0.05 m.
//  3. JGB / LTH (b03-r2): no JGB horizontal triangle inside or within 0.5 m of the LTH City ring.
//  4. generated-context decisions for LTH, 613959, 698195, 714471, 733879 stay "generated".
//  5. mall-buildings-plan yard clips (plan.yardClips) are preserved (kept cell counts unchanged).
//  6. no generator solid 0.3-2.1 m above another authored walkable surface outside these footprints.
// Uses only erasable TypeScript so Node can strip the types (no bundling needed).
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type P = [number, number];
type Tier = { height: number; area: number; ring: P[] };
type Lidar = { status: string; groundY: number; heightP50: number; heightP95: number; heightMax: number; pitchDeg: number; tiers: Tier[] };
// reportOnly: metrics that are measured and reported but not failed, each with the reason the residual remains.
type Target = { abbr: string; id: number; generator: string; meshes: (name: string) => boolean; tolP50: number; tolP95: number; tolTier: number; note?: string; reportOnly?: Record<string, string> };

const historic = (abbr: string) => (name: string) => name.startsWith(`${abbr} `);
const west24 = (name: string) => name.startsWith('West 24th architecture:') && !name.includes('gravel');
const wch = (name: string) => name.startsWith('WCH ') && !name.includes('soil');
// Tolerances: the LiDAR has 0.6-0.9 m horizontal scatter and tier rings merge parts < 60 m2.
export const TARGETS: Target[] = [
  { abbr: 'JGB', id: 575728, generator: 'historic-central-buildings', meshes: historic('JGB'), tolP50: 0.6, tolP95: 1.0, tolTier: 0.8,
    reportOnly: { p95: 'P95/max sit 1.4/3.4 m above the highest tier: rooftop plant/penthouse returns smaller than a tier (< 60 m2); position and form unsourced, not built' } },
  { abbr: 'EPS', id: 591140, generator: 'historic-central-buildings', meshes: historic('EPS'), tolP50: 0.6, tolP95: 0.8, tolTier: 0.8 },
  { abbr: 'BRB', id: 657075, generator: 'historic-central-buildings', meshes: historic('BRB'), tolP50: 0.6, tolP95: 0.8, tolTier: 0.8 },
  { abbr: 'WAG', id: 551250, generator: 'historic-central-buildings', meshes: historic('WAG'), tolP50: 0.6, tolP95: 0.8, tolTier: 0.8 },
  { abbr: 'GAR', id: 587403, generator: 'historic-central-buildings', meshes: historic('GAR'), tolP50: 0.6, tolP95: 0.8, tolTier: 0.8 },
  { abbr: 'WCH', id: 528705, generator: 'wch-building', meshes: wch, tolP50: 0.6, tolP95: 0.8, tolTier: 0.8 },
  { abbr: 'BIO', id: 464845, generator: 'west24-buildings', meshes: west24, tolP50: 0.6, tolP95: 0.8, tolTier: 1.0,
    reportOnly: { 'tier:19.8': 'one hip at the measured 26.4 deg pitch cannot also reproduce the separate 22.6 m central tier; the central raised element is not identified' } },
  { abbr: 'PAI', id: 466687, generator: 'west24-buildings', meshes: west24, tolP50: 0.6, tolP95: 0.8, tolTier: 1.0,
    reportOnly: { 'tier:21.6': 'raised 180 m2 block on the rear wing (Y30.4) unidentified (observatory/penthouse?); not built', p95: 'includes the unbuilt rear raised block and the 37.1 max (dome/plant)' } },
  { abbr: 'GEA', id: 571451, generator: 'west24-buildings', meshes: west24, tolP50: 0.6, tolP95: 0.8, tolTier: 1.0,
    reportOnly: { p50: 'the one-storey court infill (LiDAR Y17.3, 211 m2) lies outside the official UT polygon and is not built, so the record P50 mixes in low court returns; zones are checked by tier', p95: 'central-range P90/P95 35.1/35.5 exceed a hip at the measured 23.7 deg pitch; the remainder (towers/roof elements, east-wing raised element) is not sourced' } },
  // west24 builds only Welch's north wing; the other wings belong to welch-*.ts (not root-shared).
  { abbr: 'WEL', id: 507353, generator: 'west24-buildings (north wing only)', meshes: west24, tolP50: 99, tolP95: 99, tolTier: 99, note: 'reported only: partial wing' },
];
const KEEP_GENERATED = [549259, 613959, 698195, 714471, 733879];

const pip = (x: number, z: number, r: P[]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const segDist = (px: number, pz: number, a: P, b: P) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l)) : 0; return Math.hypot(a[0] + t * dx - px, a[1] + t * dz - pz); };
const ringDist = (x: number, z: number, r: P[]) => Math.min(...r.map((p, i) => segDist(x, z, p, r[(i + 1) % r.length])));
const quantile = (sorted: number[], f: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))] : NaN;
const r2 = (v: number) => Number.isFinite(v) ? +v.toFixed(2) : null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function check(scene: any, options: { headroomBaseline?: string[] } = {}) {
  const failures: string[] = [], report: Record<string, unknown> = {};
  const { physics, RAPIER, player, walkway } = scene;
  const root = resolve(import.meta.dirname, '../../..');
  const lidar = JSON.parse(readFileSync(resolve(root, 'public/data/derived/roofs-lidar.json'), 'utf8')).buildings as Record<string, Lidar>;
  const buildings = scene.world.data.buildings as { id: number; rings: P[][] }[];
  const all: THREE.Mesh[] = [];
  walkway.surfaces.updateWorldMatrix(true, true);
  walkway.surfaces.traverse((o: THREE.Object3D) => { if ((o as THREE.Mesh).isMesh) all.push(o as THREE.Mesh); });
  const ray = new THREE.Raycaster();
  const top = (meshes: THREE.Mesh[], x: number, z: number) => {
    ray.set(new THREE.Vector3(x, 200, z), new THREE.Vector3(0, -1, 0)); ray.far = 260;
    return ray.intersectObjects(meshes, false)[0] ?? null;
  };
  const physTop = (x: number, y: number, z: number) => {
    const h = physics.castRay(new RAPIER.Ray({ x, y: y + 0.3, z }, { x: 0, y: -1, z: 0 }), 0.6, true, undefined, undefined, player);
    return h ? y + 0.3 - h.timeOfImpact : null;
  };

  // 1-2. roof surface vs LiDAR
  const roofs: Record<string, unknown> = {};
  for (const t of TARGETS) {
    const L = lidar[String(t.id)], b = buildings.find(q => q.id === t.id);
    if (!L || !b) { failures.push(`${t.abbr}: LiDAR or footprint ${t.id} missing`); continue; }
    const meshes = all.filter(m => t.meshes(m.name));
    if (!meshes.length) { failures.push(`${t.abbr}: no ${t.generator} meshes`); continue; }
    const ring = b.rings[0], xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
    const samples: { x: number; z: number; y: number }[] = [];
    let grid = 0, visPhysBad = 0, visPhysWorst = 0;
    for (let x = Math.ceil(Math.min(...xs)) + 0.5; x < Math.max(...xs); x += 1) for (let z = Math.ceil(Math.min(...zs)) + 0.5; z < Math.max(...zs); z += 1) {
      if (!pip(x, z, ring) || ringDist(x, z, ring) < 0.75) continue;
      grid++;
      const h = top(meshes, x, z);
      if (!h || h.point.y < L.groundY + 2) continue;
      samples.push({ x, z, y: h.point.y });
      const py = physTop(x, h.point.y, z), d = py === null ? 9 : Math.abs(py - h.point.y);
      // A higher collider (e.g. a tree canopy capsule) only matters if none sits at the visible top.
      if (d > 0.05) { visPhysBad++; visPhysWorst = Math.max(visPhysWorst, d); }
    }
    const ys = samples.map(s => s.y).sort((p, q) => p - q);
    const lp50 = L.groundY + L.heightP50, lp95 = L.groundY + L.heightP95, lmax = L.groundY + L.heightMax;
    const m50 = quantile(ys, 0.5), m95 = quantile(ys, 0.95), mmax = ys.at(-1) ?? NaN;
    const tiers = L.tiers.filter(q => q.area >= 100).map(q => {
      const inside = samples.filter(s => pip(s.x, s.z, q.ring)).map(s => s.y).sort((p, r) => p - r);
      const ly = L.groundY + q.height, med = quantile(inside, 0.5);
      return { tierHeight: q.height, area: q.area, lidarY: r2(ly), samples: inside.length, modelMedianY: r2(med), residual: r2(med - ly) };
    });
    const entry = {
      generator: t.generator, groundY: L.groundY, pitchDeg: L.pitchDeg, gridPoints: grid, roofSamples: samples.length, coverage: r2(samples.length / Math.max(1, grid)),
      lidarY: { p50: r2(lp50), p95: r2(lp95), max: r2(lmax) }, modelY: { p50: r2(m50), p95: r2(m95), max: r2(mmax) },
      residual: { p50: r2(m50 - lp50), p95: r2(m95 - lp95), max: r2(mmax - lmax) }, tiers, visPhys: { bad: visPhysBad, worst: r2(visPhysWorst) }, note: t.note, reportOnly: t.reportOnly,
    };
    roofs[t.abbr] = entry;
    const strict = (k: string) => !t.reportOnly?.[k];
    if (strict('p50') && !(Math.abs(m50 - lp50) <= t.tolP50)) failures.push(`${t.abbr} roof P50 Y${r2(m50)} vs LiDAR Y${r2(lp50)} (> ${t.tolP50} m)`);
    if (strict('p95') && !(Math.abs(m95 - lp95) <= t.tolP95)) failures.push(`${t.abbr} roof P95 Y${r2(m95)} vs LiDAR Y${r2(lp95)} (> ${t.tolP95} m)`);
    for (const q of tiers) if (strict(`tier:${q.tierHeight}`) && q.samples >= 20 && q.residual !== null && Math.abs(q.residual) > t.tolTier) failures.push(`${t.abbr} tier ${q.tierHeight} m: model median Y${q.modelMedianY} vs LiDAR Y${q.lidarY} (> ${t.tolTier} m)`);
    if (visPhysBad) failures.push(`${t.abbr}: ${visPhysBad} roof samples without a collider within 0.05 m of the visible top`);
  }
  report.roofs = roofs;

  // 3. JGB horizontal triangles inside / near the LTH ring (b03-r2)
  {
    const lth = buildings.find(q => q.id === 549259)!.rings[0];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    let near = 0; const examples: number[][] = [];
    for (const m of all.filter(q => q.name.startsWith('JGB '))) {
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i + 2 < pos.count; i += 3) {
        a.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(pos, i + 1).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(pos, i + 2).applyMatrix4(m.matrixWorld);
        n.crossVectors(b.clone().sub(a), c.clone().sub(a)); const l = n.length(); if (l < 1e-9 || Math.abs(n.y / l) <= 0.6) continue;
        const pts = [a, b, c, a.clone().add(b).add(c).multiplyScalar(1 / 3)];
        if (pts.some(p => pip(p.x, p.z, lth) || ringDist(p.x, p.z, lth) < 0.5)) { near++; if (examples.length < 5) examples.push([r2(pts[3].x)!, r2(Math.max(a.y, b.y, c.y))!, r2(pts[3].z)!]); }
      }
    }
    report.jgbHorizontalNearLTH = { triangles: near, examples };
    if (near) failures.push(`${near} JGB horizontal triangles inside/within 0.5 m of the LTH ring`);
  }

  // 4. generated-context decisions
  {
    const plans = scene.plans as { building: { id: number }; decision: string; groundFraction: number; perimeterFraction: number }[];
    const decisions: Record<string, unknown> = {};
    for (const id of KEEP_GENERATED) {
      const p = plans.find(q => q.building.id === id);
      decisions[id] = p ? { decision: p.decision, ground: r2(p.groundFraction), perimeter: r2(p.perimeterFraction) } : null;
      if (p?.decision !== 'generated') failures.push(`${id} context decision ${p?.decision} (must stay generated)`);
    }
    report.generatedDecisions = decisions;
  }

  // 5. yard clips preserved
  {
    const plan = JSON.parse(readFileSync(resolve(root, 'public/data/mall-buildings-plan.json'), 'utf8')) as { buildings: { abbr: string; yards: unknown[] }[]; yardClips?: { dropped: Record<string, { kept: number }> }[] };
    const clips = plan.yardClips ?? [], kept: Record<string, unknown> = {};
    if (!clips.length) failures.push('mall-buildings-plan yardClips missing');
    for (const clip of clips) for (const [abbr, d] of Object.entries(clip.dropped)) {
      const n = plan.buildings.find(q => q.abbr === abbr)?.yards.length;
      kept[abbr] = { expected: d.kept, actual: n };
      if (n !== d.kept) failures.push(`${abbr} yard cells ${n} != clipped count ${d.kept}`);
    }
    report.yardClips = kept;
  }

  // 6. no generator solid within 2.1 m above other authored walkable ground near these buildings
  {
    const mine = all.filter(m => TARGETS.some(t => t.meshes(m.name)) && !/soil|gravel|stairs/.test(m.name));
    const mineSet = new Set(mine);
    const boxes = TARGETS.map(t => { const r = buildings.find(q => q.id === t.id)!.rings[0]; return [Math.min(...r.map(p => p[0])) - 6, Math.max(...r.map(p => p[0])) + 6, Math.min(...r.map(p => p[1])) - 6, Math.max(...r.map(p => p[1])) + 6]; });
    const rings = TARGETS.map(t => buildings.find(q => q.id === t.id)!.rings[0]);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    let samples = 0, blocked = 0; const examples: unknown[] = [], keys: string[] = [];
    const up = new THREE.Raycaster();
    for (const m of all) {
      // Generator-owned yards/gravel are the generators' own foundations, not other routes.
      if (mineSet.has(m) || TARGETS.some(t => t.meshes(m.name)) || /^West 24th architecture:|^WCH /.test(m.name)) continue;
      const pos = m.geometry.getAttribute('position'), idx = m.geometry.index, count = idx ? idx.count : pos.count;
      for (let i = 0; i + 2 < count; i += 3) {
        a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(m.matrixWorld);
        n.crossVectors(b.clone().sub(a), c.clone().sub(a)); const l = n.length(); if (l < 1e-6 || n.y / l < 0.7) continue;
        const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3, cz = (a.z + b.z + c.z) / 3;
        if (!boxes.some(q => cx >= q[0] && cx <= q[1] && cz >= q[2] && cz <= q[3])) continue;
        if (rings.some(r => pip(cx, cz, r))) continue;
        samples++;
        // Overhead only: a wall foot resting on the surface (< 0.3 m) is not a solid over a route.
        up.set(new THREE.Vector3(cx, cy + 0.3, cz), new THREE.Vector3(0, 1, 0)); up.far = 1.8;
        const h = up.intersectObjects(mine, false)[0];
        if (h) { blocked++; keys.push(`${cx.toFixed(1)},${cz.toFixed(1)}`); if (examples.length < 6) examples.push([r2(cx), r2(cy), r2(cz), m.name, h.object.name, r2(h.distance)]); }
      }
    }
    // Pre-existing contacts (generator walls/sills over the edge of mall planting soil, unchanged walls) are
    // compared with the baseline run of the unmodified generators; only NEW blocked samples fail.
    const base = options.headroomBaseline ? new Set(options.headroomBaseline) : null, added = base ? keys.filter(k => !base.has(k)) : keys;
    report.routeHeadroom = { samples, blocked, baselineBlocked: base?.size ?? null, newBlocked: added.length, newExamples: added.slice(0, 8), examples, keys };
    if (added.length) failures.push(`${added.length} other walkable samples newly have a root-shared solid 0.3-2.1 m above (${base ? 'vs baseline' : 'no baseline given'}), e.g. ${JSON.stringify(added.slice(0, 6))}`);
  }
  return { ok: failures.length === 0, report, failures };
}
