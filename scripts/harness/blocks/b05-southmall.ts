// Headless checks owned by block b05-southmall (run by scripts/harness/run-block-checks.mjs).
// Every height is compared in campus Y: LiDAR roof Y = groundY + height (public/data/derived/roofs-lidar.json,
// USGS 3DEP early 2017). Model heights are measured by downward rays on the built geometry, never read
// from context.json. Passing proves agreement with the cited measurements, not real-world resemblance.
//  S1 PCL (652349, authored): the closed roof deck exists over the PCL ring (was an open shell) and sits on
//     the LiDAR 26.2 m tier; the 30.2 m penthouse matches its tier.
//  S2 UTC (-501:add): regenerated (decision 'generated'), roof on the same LiDAR tier.
//  S3 Parlin/Calhoun/Rainey (732528): per-building roof median vs the LiDAR tier median inside each
//     building piece's polygon (same samples), and no roof above LiDAR max + 0.5 m.
//  S4 University Christian Church (610756): roof no longer at City h 37 m; ridge vs LiDAR.
//  S5 Austin / BMK (570651, 2018): top vs published 26 ft 4 in above LiDAR ground.
//  S6 Batts/Mezes/Benedict (714471) and CBA/GSB (733879): generated (b05-r1 applied), per piece vs LiDAR.
//  S7 Littlefield Fountain present: coping visual = own collider, water outline area, sculpture/back wall vs LiDAR DSM.
//  S8 South Mall lawn/walks/terrace/plaza: visible top = own collider, lawn-mesh coverage, residual vs LiDAR DTM.
//  S9 route clearance: no b05 collider in a standing capsule above mapped paths in the mall/fountain area.
//  S10 ATT/BMA/BMS/RRH/SZB (+HRC, D21) roof medians vs LiDAR after the round-2 datum fix.
//  S13 round 5 Blanton plaza paving (bounded): analytic triangle checks on the paving mesh (drape band, no risers,
//     inside D10, clipped out of BMA/BMS solid interiors, clear of stems/columns/piers), ~400 rays only against the
//     paving collider (visible = physical, seam transects, retained lawn/planting/tree islands), seam capsules vs b05
//     colliders, and the base-scene trees around the plaza unchanged.
//  S14 round 6 Dobie Twenty21 (484112:83, replaced by d21.ts; bounded, rays only against the D21 collider/meshes):
//     identity (replacement committed, no generated body left, b05 archetype, Dobie-only same-origin materials),
//     exact preservation of the measured City ring + LiDAR tier rings/heights (1 m grid: roof = the highest measured
//     tier containing the point, base = City ring at the 8.7 m tier; every sample roofed), render = collider (vertex
//     arrays, down rays, horizontal rays), visual-trim exemption limited to the tower bay fins, no bottom caps, walls
//     reach the ground on the whole perimeter, budgets, and the two D21 shots (clear camera, height above ground,
//     first collider on the sight line is D21). Facade estimates (band rhythm, colours, storefronts) are reported only.
// Reported: decisions of all 39 records.
import * as THREE from 'three';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BlockCheck } from './types';
import { PCL_ROOF_RING, PCL_PENTHOUSE, PCL_ROOF_Y } from '../../../lib/campus/blocks/b05-southmall/index';
import ctxData from '../../../lib/campus/blocks/b05-southmall/context.json' with { type: 'json' };
import lidarJson from '../../../lib/campus/blocks/b05-southmall/south-mall-lidar.json' with { type: 'json' };
import r3Json from '../../../lib/campus/blocks/b05-southmall/r3-lidar.json' with { type: 'json' };
import { toWorld as smWorld, lidarGround as smLidar } from '../../../lib/campus/blocks/b05-southmall/south-mall';
import { HRC_RING, HRC } from '../../../lib/campus/blocks/b05-southmall/d08';
import { BMA_SPEC, BMS_SPEC, PETALS, PETAL_STEM, petalRadius } from '../../../lib/campus/blocks/b05-southmall/d10';
import { PLAZA, plazaLayout } from '../../../lib/campus/blocks/b05-southmall/d10-plaza';
import { D21_KEY, D21_ARCHETYPE, D21_CITY_RING, D21_FINISHES, d21Tiers, sharedSegments } from '../../../lib/campus/blocks/b05-southmall/d21';
import shotsJson from '../../../lib/campus/blocks/b05-southmall/shots.json' with { type: 'json' };

type Pt = [number, number];
/** Round 4: records whose generated body the b05 install replaces (D08 HRC, D10 BMA/BMS; round 6 D08 Dobie Twenty21).
 * Their roof assertions are unchanged; only the expected decision is 'authored' and the model is measured on the b05
 * install geometry. */
const AUTHORED = new Set(['653897:869', '568540:484', '592266:632', '484112:83']);
/** Round 3 records and their P50 tolerance vs the LiDAR raster (null = no 2017 returns, reported only). */
const R3_CHECKED: [string, number | null][] = [
  ['463006:7', 1.0], ['466192:59', 0.5], ['488003:135', 1.0], ['506791:214', 1.0], ['507348:223', 0.5], ['525167:250', 1.0], ['526084:269', 1.0],
  ['567838:465', 0.5], ['612018:712', 0.5], ['633606:820', 0.5], ['715514:1119', 0.5], ['716915:1148', 1.0], ['575894:549', 1.0], ['591878:622', 1.0],
  ['593634:654', 1.0], ['624573:795', 1.0], ['652493:849', 1.0], ['697424:1020', 0.5], ['697591:1022', 1.0], ['699919:1069', 1.0], ['484112:83', 1.0],
  ['653897:869', 0.5], ['485466:100', 1.0], ['615315:754', null], ['464830:39', null], ['625710:811', null],
];
/** City ring of 718615:1179 (Dobie Garage, demolished 2024), from public/data/campus.json. */
const DOBIE_GARAGE_RING: Pt[] = [[-310.4, 384.7], [-302.6, 299.0], [-340.9, 295.5], [-348.7, 381.2]];
type Tier = { height: number; area: number; ring: Pt[] };
type Lidar = { groundY: number; heightP50: number; heightP95: number; heightMax: number; tiers: Tier[] };
const pip = (x: number, z: number, r: Pt[]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > z) !== (r[j][1] > z) && x < (r[j][0] - r[i][0]) * (z - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };
const segDist = (px: number, pz: number, a: Pt, b: Pt) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l)) : 0; return Math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz); };
const edgeDist = (x: number, z: number, r: Pt[]) => { let d = Infinity; for (let i = 0; i < r.length; i++) d = Math.min(d, segDist(x, z, r[i], r[(i + 1) % r.length])); return d; };
const median = (v: number[]) => { if (!v.length) return null; const s = v.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const r2 = (v: number | null) => (v === null ? null : +v.toFixed(2));
const SKIP = /oak|tree|canopy|Foreground|impostor|lamp|globe|banner|foliage|wood/i;

function lidar(): Record<string, Lidar> {
  for (const p of [resolve(import.meta.dirname ?? '.', '../../public/data/derived/roofs-lidar.json'), resolve(process.cwd(), 'public/data/derived/roofs-lidar.json')])
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')).buildings;
  throw new Error('roofs-lidar.json not found');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const check: BlockCheck = (scene: any) => {
  const failures: string[] = [];
  const report: Record<string, unknown> = {};
  const roofs = lidar();
  const { plans, walkway, world, context } = scene;
  const rc = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const top = (roots: THREE.Object3D[], x: number, z: number) => {
    rc.set(new THREE.Vector3(x, 160, z), down); rc.far = 220;
    const h = rc.intersectObjects(roots, true).find(q => !SKIP.test(q.object.name + '|' + (q.object.parent?.name ?? '')));
    return h ? { y: h.point.y, name: h.object.name } : null;
  };
  const plan = (key: string) => plans.find((p: { building: { key: string } }) => p.building.key === key);
  // Roof samples inside a ring (>= inset from its edges, 1 m grid): model first-hit Y and the LiDAR tier
  // raster value (highest tier containing the point, as the derived tiers are drawn), both in campus Y.
  const compare = (ring: Pt[], roots: THREE.Object3D[], l: Lidar, inset = 1.5) => {
    const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]); const model: number[] = [], meas: number[] = [];
    for (let x = Math.min(...xs) + 0.5; x < Math.max(...xs); x += 1) for (let z = Math.min(...zs) + 0.5; z < Math.max(...zs); z += 1) {
      if (!pip(x, z, ring) || edgeDist(x, z, ring) < inset) continue;
      const t = l.tiers.filter(q => pip(x, z, q.ring)).reduce((m, q) => Math.max(m, q.height), -1); if (t < 0) continue;
      const h = top(roots, x, z); if (!h) continue; model.push(h.y); meas.push(l.groundY + t);
    }
    const m = median(model), L = median(meas);
    return { samples: model.length, modelMedianY: r2(m), lidarMedianY: r2(L), residual: m !== null && L !== null ? r2(m - L) : null, modelMaxY: r2(model.length ? Math.max(...model) : null), lidarMaxY: r2(l.groundY + l.heightMax) };
  };
  const massing = (ctxData as unknown as { massing: Record<string, { volumes: { ring?: Pt[]; roof: string }[] }> }).massing;

  // S1 PCL closed roof + penthouse (authored root, own install geometry).
  {
    const l = roofs['652349'], roots = [walkway.surfaces, world.group];
    let n = 0, roofed = 0; const ys: number[] = [];
    const ring = PCL_ROOF_RING as Pt[];
    const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
    for (let x = Math.min(...xs) + 1; x < Math.max(...xs); x += 2) for (let z = Math.min(...zs) + 1; z < Math.max(...zs); z += 2) {
      if (!pip(x, z, ring) || edgeDist(x, z, ring) < 1 || pip(x, z, PCL_PENTHOUSE as Pt[])) continue;
      n++; const h = top(roots, x, z); if (h && h.y > 20) { roofed++; ys.push(h.y); }
    }
    const deck = median(ys), lidarDeck = l.groundY + 26.2;
    const pent = (() => { const v: number[] = []; for (const [x, z] of [[-92, 384], [-90, 388], [-95, 380]] as Pt[]) { const h = top(roots, x, z); if (h) v.push(h.y); } return median(v); })();
    report.pcl = { samples: n, roofed, roofedFraction: +(roofed / Math.max(1, n)).toFixed(3), deckMedianY: r2(deck), lidarDeckY: r2(lidarDeck), deckResidual: deck === null ? null : r2(deck - lidarDeck), authoredRoofStripY: PCL_ROOF_Y,
      penthouseY: r2(pent), lidarPenthouseY: r2(l.groundY + 30.2), before: 'open shell: top-down rays inside PCL hit the terrain (probe 2026-10-20)', decision: plan('652349:846')?.decision };
    if (roofed / Math.max(1, n) < 0.97) failures.push(`PCL roof covers only ${(100 * roofed / Math.max(1, n)).toFixed(1)}% of its ring`);
    if (deck === null || Math.abs(deck - lidarDeck) > 0.3) failures.push(`PCL deck Y ${deck} vs LiDAR ${lidarDeck.toFixed(2)}`);
    if (pent === null || Math.abs(pent - (l.groundY + 30.2)) > 0.3) failures.push(`PCL penthouse Y ${pent} vs LiDAR ${(l.groundY + 30.2).toFixed(2)}`);
  }
  const gen = context?.solid ? [context.solid] : [];
  const b05Inst = scene.blocks.installs.find((x: { id: string }) => x.id === 'b05-southmall')?.install;
  const b05Solids: THREE.Object3D[] = (b05Inst?.solids ?? []) as THREE.Object3D[];
  const rootsFor = (key: string) => (AUTHORED.has(key) ? b05Solids : gen);
  const wantDecision = (key: string) => (AUTHORED.has(key) ? 'authored' : 'generated');
  // S2 UTC regenerated.
  {
    const p = plan('-501:add'), l = roofs['652349'];
    const ring = p?.building.rings[0] as Pt[] | undefined;
    const cmp = ring ? compare(ring, gen, l, 2) : null;
    report.utc = { decision: p?.decision ?? null, style: p?.style, ...cmp, before: 'missing (inside the PCL City record, suppressed as authored)' };
    if (p?.decision !== 'generated') failures.push(`UTC -501 decision ${p?.decision}`);
    else if (!cmp || cmp.residual === null || Math.abs(cmp.residual) > 1.0) failures.push(`UTC roof residual ${cmp?.residual}`);
  }
  // S3 Parlin / Calhoun / Rainey: per building piece.
  {
    const l = roofs['732528'], p = plan('732528:1227');
    const names = ['PAR bar', 'PAR west wing', 'CAL', 'HRH north wing', 'HRH south bar'];
    const pieces = massing['732528'].volumes.map((v, i) => ({ piece: names[i], ...compare(v.ring!, gen, l, 1.5) }));
    report.parlinCalhounRainey = { decision: p?.decision, pieces, before: 'one hipped roof over the union at campus Y ~31.5' };
    if (p?.decision !== 'generated') failures.push(`732528 decision ${p?.decision}`);
    for (const q of pieces) {
      if (q.residual === null || Math.abs(q.residual) > 1.0) failures.push(`732528 ${q.piece}: roof median residual ${q.residual} (> 1.0 m)`);
      if (q.modelMaxY === null || q.modelMaxY > q.lidarMaxY! + 0.5) failures.push(`732528 ${q.piece}: model max ${q.modelMaxY} above LiDAR max ${q.lidarMaxY} + 0.5`);
    }
  }
  // S4 University Christian Church.
  {
    const l = roofs['610756'], p = plan('610756:683'); const ring = p.building.rings[0] as Pt[];
    let maxY = -Infinity; const xs = ring.map(q => q[0]), zs = ring.map(q => q[1]);
    for (let x = Math.min(...xs) + 0.5; x < Math.max(...xs); x += 1) for (let z = Math.min(...zs) + 0.5; z < Math.max(...zs); z += 1) if (pip(x, z, ring)) { const h = top(gen, x, z); if (h) maxY = Math.max(maxY, h.y); }
    const ridge = l.groundY + 18.6;
    report.church610756 = { decision: p.decision, modelMaxY: r2(maxY), modelledRidgeY: r2(ridge), lidarP95Y: r2(l.groundY + l.heightP95), lidarMaxY: r2(l.groundY + l.heightMax), before: 'City h 37.0 m box (campus Y ~41)' };
    if (p.decision !== 'generated' || Math.abs(maxY - ridge) > 0.5) failures.push(`610756 max Y ${maxY.toFixed(2)} vs ridge ${ridge.toFixed(2)}`);
  }
  // S5 BMK.
  {
    const l = roofs['570651'], p = plan('570651:526'); const h = top(gen, -62.6, 489);
    const want = l.groundY + 8.03;
    report.austinBmk = { decision: p.decision, modelTopY: r2(h?.y ?? null), publishedTopY: r2(want), note: '60 x 73 x 26 ft 4 in (Wikipedia); barrel vault modelled flat at the crown' };
    if (!h || Math.abs(h.y - want) > 0.3) failures.push(`BMK top ${h?.y} vs ${want.toFixed(2)}`);
  }
  // S6 Batts/Mezes/Benedict (714471) and CBA/GSB (733879): live generated (b05-r1 applied by root), per piece.
  {
    const out: Record<string, unknown> = {};
    for (const [key, id, names] of [['714471:1095', '714471', ['BAT', 'MEZ north bar', 'MEZ south bar', 'MEZ west wing', 'BEN']], ['733879:1251', '733879', ['CBA', 'CBA north-east low wing', 'CBA core', 'GSB']]] as const) {
      const p = plan(key), l = roofs[id];
      const pieces = massing[id].volumes.map((v, i) => ({ piece: names[i], roof: v.roof, ...compare(v.ring!, gen, l, 1.5) })).filter(q => q.samples > 0);
      out[id] = { decision: p.decision, pieces };
      if (p.decision !== 'generated') failures.push(`${id} decision ${p.decision} (expected generated after b05-r1)`);
      for (const q of pieces) if (q.residual === null || Math.abs(q.residual) > 1.0) failures.push(`${id} ${q.piece}: roof median residual ${q.residual}`);
    }
    report.sixPackAndMcCombs = out;
  }
  // S10 generated records fixed in round 2 (datum aboveY + per-tier massing) vs LiDAR, same measurement.
  {
    const rows: unknown[] = [];
    for (const [key, abbr, tol] of [['505680:201', 'ATT', 1.0], ['568540:484', 'BMA', 1.0], ['592266:632', 'BMS', 1.0], ['675538:965', 'RRH', 1.0], ['502161:149', 'SZB', 0.5], ['653897:869', 'HRC', 1.0], ['484112:83', 'D21', 2.0], ['485466:100', '485466', 1.0]] as const) {
      const p = plan(key); const l = roofs[key.split(':')[0]];
      const r = compare(p.building.rings[0], rootsFor(key), l, 2);
      rows.push({ abbr, decision: p.decision, ...r });
      if (p.decision !== wantDecision(key) || r.residual === null || Math.abs(r.residual) > tol) failures.push(`${abbr} roof median residual ${r.residual} (> ${tol} m)`);
      if (r.modelMaxY !== null && r.lidarMaxY !== null && r.modelMaxY > r.lidarMaxY + 1.0) failures.push(`${abbr} model max ${r.modelMaxY} above LiDAR max ${r.lidarMaxY} + 1.0`);
    }
    report.generatedVsLidar = rows;
  }
  const ownSet = new Set(((scene.blocks.installs.find((x: { id: string }) => x.id === 'b05-southmall')?.colliders ?? []) as { handle: number }[]).map(c => c.handle));
  const { physics: ph, RAPIER: R, player: pl } = scene;
  const ownHitY = (x: number, z: number, from: number, reach = 40) => { const h = ph.castRay(new R.Ray({ x, y: from, z }, { x: 0, y: -1, z: 0 }), reach, true, undefined, undefined, pl, undefined, (k: { handle: number }) => ownSet.has(k.handle)); return h ? from - h.timeOfImpact : null; };
  const allRoots = [walkway.surfaces, world.group];
  // S7 Littlefield Fountain: present, own colliders on the rim, levels vs LiDAR.
  {
    const meshes: Record<string, number> = {};
    for (const r of allRoots) r.traverse((o: THREE.Object3D) => { if ((o as THREE.Mesh).isMesh && /^b05 (Littlefield|South Mall)/.test(o.name)) meshes[o.name] = ((o as THREE.Mesh).geometry.getAttribute('position').count / 3); });
    const ring = (lidarJson as unknown as { lowerBasinWaterOutline: { ring: Pt[] } }).lowerBasinWaterOutline.ring;
    const ringArea = Math.abs(ring.reduce((s, p, i) => s + p[0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * p[1], 0) / 2);
    const c0 = ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length], [0, 0]);
    let copS = 0, copBad = 0; const copY: number[] = [];
    for (let i = 0; i < ring.length; i += 2) {
      const a = ring[i], b = ring[(i + 1) % ring.length], cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
      const d = Math.hypot(cx - c0[0], cz - c0[1]), x = cx + (cx - c0[0]) / d * 0.22, z = cz + (cz - c0[1]) / d * 0.22;
      const vis = top(allRoots, x, z), phys = ownHitY(x, z, 30);
      if (!vis || !/coping/.test(vis.name)) continue;
      copS++; if (phys === null || Math.abs(vis.y - phys) > 0.05) copBad++; copY.push(vis.y);
    }
    let sculpt = -Infinity; for (let s = 190; s <= 197; s += 0.25) for (let t = -2.5; t <= 1.5; t += 0.25) { const [x, z] = smWorld(s, t); const h = top(allRoots, x, z); if (h && /bronze/.test(h.name)) sculpt = Math.max(sculpt, h.y); }
    const [wx, wz] = smWorld(188.25, -4.5), wall = top(allRoots, wx, wz);
    report.fountain = { meshes, waterOutlineAreaM2: +ringArea.toFixed(1), copingSamples: copS, copingVisualPhysicalMismatch: copBad, copingMedianY: r2(median(copY)), lidarRimY: 6.7,
      install: scene.blocks.stats['b05-southmall']?.southMall ?? null, sculptureTopY: r2(sculpt), lidarSculptureTopY: 12.3, backWallTopY: r2(wall?.y ?? null), lidarBackWallTopY: 10.6 };
    for (const k of ['b05 Littlefield Fountain granite coping', 'b05 Littlefield Fountain bronze group', 'b05 Littlefield Fountain stone', 'b05 Littlefield Fountain water (visual)', 'b05 South Mall lawn', 'b05 South Mall terrace stairs']) if (!meshes[k]) failures.push(`fountain/mall mesh missing: ${k}`);
    if (copS < 10 || copBad) failures.push(`basin coping: ${copBad}/${copS} samples visual top != own collider (> 0.05 m)`);
    if (!(ringArea > 300 && ringArea < 450)) failures.push(`basin water outline area ${ringArea.toFixed(0)} m2 outside 300-450 (LiDAR no-return rows ~360 m2)`);
    if (!(Math.abs(sculpt - 12.3) < 0.3)) failures.push(`sculpture top ${sculpt.toFixed(2)} vs LiDAR 12.3`);
    if (!wall || Math.abs(wall.y - 10.6) > 0.1) failures.push(`back wall top ${wall?.y} vs LiDAR 10.6`);
  }
  // S8 South Mall lawn / walks / terrace / plaza: visible = own physical, coverage, vs LiDAR DTM.
  {
    const zones: Record<string, { n: number; hitOwn: number; visPhysBad: number; dy: number[]; mesh: Record<string, number> }> = {};
    const sample = (zone: string, s: number, t: number) => {
      const [x, z] = smWorld(s, t); if (z < 170.3) return;
      const e = zones[zone] ??= { n: 0, hitOwn: 0, visPhysBad: 0, dy: [], mesh: {} }; e.n++;
      const vis = top(allRoots, x, z); if (!vis) return;
      e.mesh[vis.name] = (e.mesh[vis.name] ?? 0) + 1;
      const y = ownHitY(x, z, vis.y + 1, 2);
      if (y !== null) { e.hitOwn++; if (Math.abs(y - vis.y) > 0.05) e.visPhysBad++; } else e.visPhysBad++;
      const L = smLidar(x, z); if (L !== null) e.dy.push(vis.y - L);
    };
    for (let s = 133.2; s < 180; s += 1.5) for (let t = -19.2; t < 18; t += 1.5) sample('lawn', s, t);
    for (let s = 133.2; s < 180; s += 2) { sample('walkW', s, -21.6); sample('walkE', s, 20.1); }
    for (let s = 181.1; s < 187; s += 1) for (let t = -23.1; t < 22; t += 2) sample('terrace', s, t);
    for (let s = 191.1; s < 228; s += 1.5) for (let t = -26.1; t < 24; t += 1.5) { const [x, z] = smWorld(s, t); if (!(x > -258 && x < -212 && z > 224 && z < 259)) sample('plaza', s, t); }
    const out: Record<string, unknown> = {};
    for (const [k, e] of Object.entries(zones)) {
      const d = e.dy.slice().sort((a, b) => a - b);
      out[k] = { samples: e.n, ownCollider: e.hitOwn, visPhysOver005: e.visPhysBad, medianMinusLidar: r2(median(d)), p95MinusLidar: d.length ? r2(d[Math.floor(d.length * 0.95)]) : null, topMesh: Object.entries(e.mesh).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null };
      if (e.visPhysBad) failures.push(`${k}: ${e.visPhysBad}/${e.n} samples without an own collider at the visible top (0.05 m)`);
      if (e.hitOwn < e.n * 0.98) failures.push(`${k}: only ${e.hitOwn}/${e.n} samples on b05 surfaces`);
    }
    const lawn = zones.lawn; if (lawn && (lawn.mesh['b05 South Mall lawn'] ?? 0) < lawn.n * 0.98) failures.push(`lawn panel: ${lawn.mesh['b05 South Mall lawn'] ?? 0}/${lawn.n} samples on the lawn mesh`);
    const terrace = zones.terrace; if (terrace) { const m = median(terrace.dy); if (m === null || Math.abs(m) > 0.15) failures.push(`terrace median vs LiDAR ${m}`); }
    report.southMallSurfaces = out;
  }
  // S9 route clearance: no b05 collider in a standing capsule above any mapped path in the South Mall / fountain area.
  {
    const paths = JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/campus.json'), 'utf8')).paths as { id: number; kind: string; points: Pt[] }[];
    const shape = new R.Capsule(0.5, 0.3); let n = 0, blocked = 0; const ex: unknown[] = [];
    for (const p of paths) for (let k = 1; k < p.points.length; k++) {
      const a = p.points[k - 1], b = p.points[k], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let d = 0; d < L; d += 1) {
        const x = a[0] + (b[0] - a[0]) * d / L, z = a[1] + (b[1] - a[1]) * d / L;
        if (!(x > -265 && x < -200 && z > 170 && z < 268)) continue;
        const vis = top(allRoots, x, z); if (!vis) continue; n++;
        let hit = false;
        ph.intersectionsWithShape({ x, y: vis.y + 1.15, z }, { x: 0, y: 0, z: 0, w: 1 }, shape, (k2: { handle: number }) => { if (ownSet.has(k2.handle)) { hit = true; return false; } return true; }, undefined, undefined, pl);
        if (hit) { blocked++; if (ex.length < 6) ex.push([p.id, +x.toFixed(1), +z.toFixed(1), +vis.y.toFixed(2), vis.name]); }
      }
    }
    report.routeClearance = { samples: n, blocked, examples: ex };
    if (blocked) failures.push(`${blocked} mapped path samples blocked by b05 colliders, e.g. ${JSON.stringify(ex)}`);
  }
  // S11 round 3: every remaining record vs the 0.5 m LiDAR raster sampled inside its City ring (r3-lidar.json,
  // absolute campus Y): built visual roof P50/P95 (downward rays on the generated geometry, 0.6 m inset, 0.5/1 m grid)
  // vs raster P50/P95, built max vs raster max; visual top = physical top (generated colliders) at the same samples.
  // The demolished Dobie Garage (718615) is excluded and its ring is open to the ground.
  {
    const R3 = (r3Json as unknown as { records: Record<string, { P50: number | null; P95: number | null; max: number | null; coverage: number; groundY: number | null; cityH: number }> }).records;
    const q = (v: number[], f: number) => { const s = v.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * f))] : null; };
    const physTop = (x: number, z: number) => { const h = ph.castRay(new R.Ray({ x, y: 160, z }, { x: 0, y: -1, z: 0 }), 220, true, undefined, undefined, pl); return h ? 160 - h.timeOfImpact : null; };
    const rows: Record<string, unknown> = {};
    for (const [key, tol] of R3_CHECKED) {
      const p = plan(key); if (!p) { failures.push(`${key} missing from plans`); continue; }
      const ring = p.building.rings[0] as Pt[], xs = ring.map(v => v[0]), zs = ring.map(v => v[1]);
      const area = Math.abs(ring.reduce((s, v, i) => s + v[0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * v[1], 0) / 2);
      const step = area < 400 ? 0.5 : 1, ys: number[] = []; let mism = 0, n = 0;
      for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) {
        if (!pip(x, z, ring) || edgeDist(x, z, ring) < 0.6) continue;
        const h = top(rootsFor(key), x, z); if (!h) continue; n++; ys.push(h.y);
        const py = physTop(x, z); if (py === null || Math.abs(py - h.y) > 0.1) mism++;
      }
      const L = R3[key], m50 = q(ys, 0.5), m95 = q(ys, 0.95), mx = ys.length ? Math.max(...ys) : null;
      const row = { decision: p.decision, samples: n, modelP50: r2(m50), lidarP50: L?.P50 ?? null, modelP95: r2(m95), lidarP95: L?.P95 ?? null, modelMax: r2(mx), lidarMax: L?.max ?? null,
        residualP50: m50 !== null && L?.P50 != null ? r2(m50 - L.P50) : null, residualP95: m95 !== null && L?.P95 != null ? r2(m95 - L.P95) : null, visualVsPhysicalOver01: mism };
      rows[key] = row;
      if (p.decision !== wantDecision(key)) failures.push(`${key} decision ${p.decision}`);
      if (tol === null) continue; // no 2017 LiDAR returns (post-2017 or unidentified): reported only
      if (row.residualP50 === null || Math.abs(row.residualP50) > tol) failures.push(`${key} roof P50 residual ${row.residualP50} m (> ${tol}) vs LiDAR raster`);
      if (mx !== null && L?.max != null && mx > L.max + 1.0) failures.push(`${key} model max ${r2(mx)} above LiDAR raster max ${L.max} + 1.0`);
      if (mism > Math.max(2, n * 0.05)) failures.push(`${key} ${mism}/${n} samples: visual roof != collider (> 0.1 m)`);
    }
    report.round3Records = rows;
    const ex: Record<string, unknown> = {};
    for (const key of ['718615:1179']) {
      const inData = scene.world.data.buildings.some((b: { key?: string }) => b.key === key);
      const rep = (scene.blockData?.excluded ?? []).some((e: { key: string }) => e.key === key);
      const ring = DOBIE_GARAGE_RING; let n = 0, open = 0; const xs = ring.map(v => v[0]), zs = ring.map(v => v[1]);
      for (let x = Math.min(...xs) + 2; x < Math.max(...xs); x += 4) for (let z = Math.min(...zs) + 2; z < Math.max(...zs); z += 4) {
        if (!pip(x, z, ring)) continue; n++; const h = top(gen, x, z); if (!h || h.y < 9) open++;
      }
      ex[key] = { inData, reportedExcluded: rep, samples: n, openToGround: open, before: 'generated 17.7 m flat garage (2017 LiDAR), demolished June-Oct 2024' };
      if (inData || !rep) failures.push(`${key} (Dobie Garage, demolished 2024) still in the data`);
      if (n && open < n * 0.9) failures.push(`${key}: only ${open}/${n} samples inside the demolished ring are free of generated building geometry`);
    }
    report.round3Excluded = ex;
  }
  // S12 round 4 (D08/D09/D10 authored architecture). Independent of the builders' code paths: roof planes recomputed
  // here from the published spec numbers, physical tops from the b05 colliders, routes from campus.json.
  {
    const own = (x: number, z: number, from: number, reach: number) => ownHitY(x, z, from, reach);
    const groupMeshes = (pred: (m: THREE.Mesh) => boolean) => { const out: THREE.Mesh[] = []; for (const o of b05Solids) o.traverse(q => { const m = q as THREE.Mesh; if (m.isMesh && pred(m)) out.push(m); }); return out; };
    const r4: Record<string, unknown> = {};
    // (a) Blanton roofs: every rendered tile vertex and triangle centroid on the analytic lower envelope of the eave
    // planes and the crown plane (1 mm), so hips/ridges/crown seams are straight creases (no sawtooth).
    for (const spec of [BMA_SPEC, BMS_SPEC]) {
      const ring = spec.ring as Pt[], n = ring.length, eaveY = spec.wallY - spec.slope * spec.overhang;
      const lines = ring.map((a, i) => { const b = ring[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); let nx = dz / l, nz = -dx / l;
        if (pip((a[0] + b[0]) / 2 + nx * 0.05, (a[1] + b[1]) / 2 + nz * 0.05, ring)) { nx = -nx; nz = -nz; }
        return { ax: a[0] + nx * spec.overhang, az: a[1] + nz * spec.overhang, nx, nz }; });
      const field = (x: number, z: number) => Math.min(spec.crownY, ...lines.map(L => eaveY + spec.slope * -((x - L.ax) * L.nx + (z - L.az) * L.nz)));
      const meshes = groupMeshes(m => m.name === `b05 ${spec.name} tile`);
      let nv = 0, worst = 0, onRidge = 0;
      for (const m of meshes) { const pos = m.geometry.getAttribute('position'); for (let t = 0; t < pos.count; t += 3) {
        const pts = [0, 1, 2].map(q => [pos.getX(t + q), pos.getY(t + q), pos.getZ(t + q)]);
        pts.push([0, 1, 2].map(c => (pts[0][c] + pts[1][c] + pts[2][c]) / 3));
        for (const [x, y, z] of pts) { nv++; const e = Math.abs(y - field(x, z)); worst = Math.max(worst, e); if (Math.abs(y - spec.crownY) < 1e-3) onRidge++; }
      } }
      // Physical: own collider tops on a 1.3 m grid inside the eave outline equal the same field (1 cm: float32 trimesh).
      const xs = ring.map(q => q[0]), zs = ring.map(q => q[1]); let pn = 0, pbad = 0, pworst = 0;
      for (let x = Math.min(...xs) - 1; x < Math.max(...xs) + 1; x += 1.3) for (let z = Math.min(...zs) - 1; z < Math.max(...zs) + 1; z += 1.3) {
        if (!pip(x, z, ring)) continue; const y = own(x, z, spec.crownY + 3, 30); if (y === null) { pbad++; continue; }
        pn++; const e = Math.abs(y - field(x, z)); pworst = Math.max(pworst, e); if (e > 0.01) pbad++;
      }
      r4[`${spec.name} roof facets`] = { meshes: meshes.length, verticesAndCentroids: nv, worstMm: +(worst * 1000).toFixed(3), crownPoints: onRidge, physicalSamples: pn, physicalOver1cm: pbad, physicalWorstMm: +(pworst * 1000).toFixed(2) };
      if (!meshes.length || nv < 30) failures.push(`${spec.name}: roof tile mesh missing`);
      if (worst > 0.001) failures.push(`${spec.name}: roof facet vertex ${(worst * 1000).toFixed(2)} mm off the analytic plane envelope (> 1 mm)`);
      if (pbad || pn < 200) failures.push(`${spec.name}: ${pbad}/${pn} physical roof samples off the analytic envelope by > 1 cm`);
    }
    // (b) Rebuilt bodies: visible top = own physical top on a 1 m grid (0.6 m inset), HRC deck on the LiDAR tier.
    for (const [name, ring] of [['HRC', HRC_RING], ['BMA', BMA_SPEC.ring], ['BMS', BMS_SPEC.ring]] as [string, Pt[]][]) {
      const xs = ring.map(q => q[0]), zs = ring.map(q => q[1]); let n = 0, bad = 0; const ex: unknown[] = [];
      for (let x = Math.min(...xs) + 0.5; x < Math.max(...xs); x += 1) for (let z = Math.min(...zs) + 0.5; z < Math.max(...zs); z += 1) {
        if (!pip(x, z, ring) || edgeDist(x, z, ring) < 0.6) continue; const v = top(b05Solids, x, z); if (!v) { bad++; continue; } n++;
        const y = own(x, z, v.y + 1, 3); if (y === null || Math.abs(y - v.y) > 0.05) { bad++; if (ex.length < 4) ex.push([x, z, r2(v.y), y === null ? null : r2(y), v.name]); }
      }
      r4[`${name} visible=physical`] = { samples: n, mismatched: bad, examples: ex };
      if (bad || n < 100) failures.push(`${name}: ${bad}/${n} roof samples without an own collider at the visible top (0.05 m)`);
    }
    {
      const v: number[] = []; for (const [x, z] of [[-390, 190], [-375, 210], [-400, 175], [-370, 180]] as Pt[]) { const h = top(b05Solids, x, z); if (h) v.push(h.y); }
      const lidarDeck = roofs['653897'].groundY + 31.4;
      r4.hrcDeck = { modelY: v.map(r2), lidarTierY: r2(lidarDeck), spec: HRC.deckY };
      if (v.length < 4 || v.some(y => Math.abs(y - lidarDeck) > 0.1)) failures.push(`HRC deck ${JSON.stringify(v)} vs LiDAR tier ${lidarDeck}`);
    }
    // (c) Petal canopies (2023, not in the 2017 LiDAR): own collider under the visible shell at 0.75 R in 8 directions,
    // shell height inside the analytic band of the published profile (lobes +-6 %), rim top = local ground + H.
    {
      const rows: unknown[] = []; let bad = 0;
      const petalMeshes = groupMeshes(m => m.userData.b05Group === 'Blanton petals');
      PETALS.forEach(p => {
        const gy = scene.ground.height(p.x, p.z); let hit = 0, out = 0, mis = 0; let rim = -Infinity;
        const hAt = (r: number) => { let lo = 0, hi = p.H; for (let q = 0; q < 40; q++) { const m = (lo + hi) / 2; if (petalRadius(p, m) < r) lo = m; else hi = m; } return gy + lo; };
        for (let a = 0; a < 8; a++) {
          const th = a * Math.PI / 4 + 0.2, x = p.x + Math.cos(th) * 0.75 * p.R, z = p.z + Math.sin(th) * 0.75 * p.R;
          const vis = top(petalMeshes, x, z); const phys = own(x, z, gy + p.H + 0.4, p.H + 0.4);
          if (!vis || phys === null) { mis++; continue; } hit++;
          if (Math.abs(vis.y - phys) > 0.05) mis++;
          const lo = hAt(0.75 * p.R / 1.065), hi = hAt(0.75 * p.R / 0.935); if (vis.y < lo - 0.08 || vis.y > hi + 0.08) out++;
        }
        for (let a = 0; a < 36; a++) { const th = a * Math.PI / 18, x = p.x + Math.cos(th) * 0.97 * p.R * 0.94, z = p.z + Math.sin(th) * 0.97 * p.R * 0.94; const h = top(petalMeshes, x, z); if (h) rim = Math.max(rim, h.y); }
        // Clearance above the rim where it reaches under a Blanton eave: nearest own collider above the rim line.
        let headroom = Infinity;
        for (let a = 0; a < 36; a++) { const th = a * Math.PI / 18, x = p.x + Math.cos(th) * p.R, z = p.z + Math.sin(th) * p.R;
          const up = ph.castRay(new R.Ray({ x, y: gy + p.H + 0.05, z }, { x: 0, y: 1, z: 0 }), 30, true, undefined, undefined, pl, undefined, (k2: { handle: number }) => ownSet.has(k2.handle));
          if (up) headroom = Math.min(headroom, up.timeOfImpact); }
        const wall = Math.min(edgeDist(p.x, p.z, BMA_SPEC.ring as Pt[]), edgeDist(p.x, p.z, BMS_SPEC.ring as Pt[])) - p.R * 1.06;
        rows.push({ x: p.x, z: p.z, R: p.R, H: p.H, groundY: r2(gy), samples: hit, visualPhysicalMismatch: mis, outsideProfileBand: out, rimMaxSampledY: r2(rim), designRimY: r2(gy + p.H), rimToWallM: r2(wall), headroomUnderEaveM: Number.isFinite(headroom) ? r2(headroom) : null, basis: 'estimate (photo-fitted, 2023)' });
        if (hit < 8 || mis || out || !(rim <= gy + p.H + 0.02 && rim > gy + p.H - 1.2) || wall < 0.4 || headroom < 2.0) bad++;
      });
      r4.petals = rows;
      if (bad) failures.push(`${bad} petal canopies fail the shell/collider/profile/clearance check`);
    }
    // (d) Pedestrian routes around D08-D10 work: standing capsule above every mapped walkway sample free of b05 colliders.
    // Samples inside another building's ring are skipped; inside a replaced ring they must be under a loggia/colonnade.
    {
      const paths = JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/campus.json'), 'utf8')).paths as { id: number; kind: string; points: Pt[] }[];
      const WALK = new Set(['footway', 'pedestrian', 'steps', 'path', 'cycleway', 'living_street']);
      const areas: [number, number, number, number][] = [[-432, -340, 145, 245], [-212, -135, 120, 255], [-372, -255, 395, 520], [-130, 25, 510, 615]];
      const others = (plans as { building: { key: string; rings: Pt[][] }; decision: string }[]).filter(q => !AUTHORED.has(q.building.key) && q.decision !== 'route');
      const replacedRings: [string, Pt[], (x: number, z: number) => boolean][] = [
        ['HRC', HRC_RING as Pt[], (x, z) => edgeDist(x, z, HRC_RING as Pt[]) < HRC.loggiaDepth - 0.35],
        ['BMA', BMA_SPEC.ring as Pt[], (x, z) => { const r = BMA_SPEC.ring as Pt[]; return segDist(x, z, r[0], r[1]) < BMA_SPEC.loggia.depth - 0.35; }],
        ['BMS', BMS_SPEC.ring as Pt[], (x, z) => { const r = BMS_SPEC.ring as Pt[]; return segDist(x, z, r[3], r[0]) < BMS_SPEC.loggia.depth - 0.35; }],
      ];
      const shape = new R.Capsule(0.5, 0.3); let n = 0, blocked = 0, inLoggia = 0, wallCrossings = 0, shifted = 0; const ex: unknown[] = [], crossings: unknown[] = [], shiftedEx: unknown[] = [];
      for (const p of paths) { if (!WALK.has(p.kind)) continue; for (let k = 1; k < p.points.length; k++) {
        const a = p.points[k - 1], b = p.points[k], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let d = 0; d < L; d += 0.75) {
          const x = a[0] + (b[0] - a[0]) * d / L, z = a[1] + (b[1] - a[1]) * d / L;
          if (!areas.some(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1)) continue;
          if (others.some(q => pip(x, z, q.building.rings[0]))) continue;
          const rep = replacedRings.find(([, r]) => pip(x, z, r));
          const loggia = rep ? rep[2](x, z) : false;
          const gy = scene.ground.height(x, z); n++; if (loggia) inLoggia++;
          let hit = false;
          ph.intersectionsWithShape({ x, y: gy + 1.15, z }, { x: 0, y: 0, z: 0, w: 1 }, shape, (k2: { handle: number }) => { if (ownSet.has(k2.handle)) { hit = true; return false; } return true; }, undefined, undefined, pl);
          if (!hit) continue;
          // A mapped line lying on a replaced facade line (within 0.9 m of it): walkers pass beside the supports, so
          // test the parallel lane 1.6 m inside (loggia) or 1.2 m outside; it must be free.
          const near = replacedRings.find(([, r]) => edgeDist(x, z, r) < 0.9);
          if (near) {
            const r = near[1]; let best: { d: number; nx: number; nz: number } | null = null;
            for (let i = 0; i < r.length; i++) { const a2 = r[i], b2 = r[(i + 1) % r.length], d2 = segDist(x, z, a2, b2); if (!best || d2 < best.d) { const l = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]); let nx = (b2[1] - a2[1]) / l, nz = -(b2[0] - a2[0]) / l; if (pip((a2[0] + b2[0]) / 2 + nx * 0.05, (a2[1] + b2[1]) / 2 + nz * 0.05, r)) { nx = -nx; nz = -nz; } best = { d: d2, nx, nz }; } }
            const inX = x - best!.nx * 1.6, inZ = z - best!.nz * 1.6, useIn = near[2](inX, inZ) && pip(inX, inZ, r);
            const sx = useIn ? inX : x + best!.nx * 1.2, sz = useIn ? inZ : z + best!.nz * 1.2;
            let hit2 = false;
            ph.intersectionsWithShape({ x: sx, y: scene.ground.height(sx, sz) + 1.15, z: sz }, { x: 0, y: 0, z: 0, w: 1 }, shape, (k2: { handle: number }) => { if (ownSet.has(k2.handle)) { hit2 = true; return false; } return true; }, undefined, undefined, pl);
            if (!hit2) { shifted++; if (shiftedEx.length < 6) shiftedEx.push([p.id, near[0], +x.toFixed(1), +z.toFixed(1), useIn ? 'inside lane' : 'outside lane']); continue; }
          }
          if (rep && !loggia) { wallCrossings++; if (crossings.length < 8) crossings.push([p.id, rep[0], +x.toFixed(1), +z.toFixed(1), r2(edgeDist(x, z, rep[1]))]); continue; }
          blocked++; if (ex.length < 8) ex.push([p.id, p.kind, +x.toFixed(1), +z.toFixed(1), r2(gy)]);
        }
      } }
      r4.routes = { samples: n, underLoggias: inLoggia, blocked, examples: ex, wallCrossingsInsideReplacedRings: wallCrossings, crossingExamples: crossings, onFacadeLineParallelLaneFree: shifted, shiftedExamples: shiftedEx,
        note: 'wall crossings: mapped lines within ~2.5 m inside a GIS ring outside the evidenced loggias (GIS registration / entrances; same as the generated walls they replace)' };
      if (blocked) failures.push(`${blocked} mapped walkway samples near D08-D10 blocked by b05 colliders, e.g. ${JSON.stringify(ex)}`);
    }
    // (e) Dormers sit on the rendered generated six-pack roof (gap at the dormer front centre <= 0.12 m).
    {
      const dormers = (scene.blocks.stats['b05-southmall']?.sixPackDormers ?? []) as { piece: string; x: number; z: number; seatY: number }[];
      let worst = 0, missing = 0;
      for (const d of dormers) { const h = top(gen, d.x, d.z); if (!h) { missing++; continue; } worst = Math.max(worst, Math.abs(h.y - d.seatY)); }
      r4.dormers = { count: dormers.length, worstSeatGapM: r2(worst), missingRoof: missing };
      if (dormers.length < 8 || missing || worst > 0.12) failures.push(`six-pack dormers: ${dormers.length}, missing roof ${missing}, worst seat gap ${worst.toFixed(3)} m`);
    }
    // (f) PBR + metre UVs + coverage flags + budgets on every round-4 mesh.
    {
      const all: THREE.Mesh[] = []; for (const r of [world.group]) r.traverse((o: THREE.Object3D) => { const m = o as THREE.Mesh; if (m.isMesh && m.userData.b05Group && m.userData.b05Group !== 'D21') all.push(m); }); // round-4 groups only; D21 has its own S14 budgets
      const bad: string[] = []; let tris = 0, uvTri = 0, uvBad = 0; const mats = new Set<THREE.Material>(), texs = new Set<THREE.Texture>();
      const additive = new Set(['Batts-Mezes-Benedict', 'ATT', 'Blanton petals']);
      const va = new THREE.Vector3(), vb = new THREE.Vector3();
      for (const m of all) {
        const mat = m.material as THREE.MeshStandardMaterial; mats.add(mat); tris += m.geometry.getAttribute('position').count / 3;
        if (mat.vertexColors) bad.push(`${m.name}: vertexColors`);
        const plain = /glass|gold/.test(mat.name);
        if (!plain && !(mat.map && mat.normalMap && mat.roughnessMap)) bad.push(`${m.name}: missing PBR maps`);
        for (const t of [mat.map, mat.normalMap, mat.roughnessMap]) if (t) texs.add(t);
        if (!m.geometry.getAttribute('uv')) bad.push(`${m.name}: no uv`);
        if (additive.has(m.userData.b05Group) !== (m.userData.localContext === true)) bad.push(`${m.name}: localContext flag ${m.userData.localContext}`);
        const pos = m.geometry.getAttribute('position'), nor = m.geometry.getAttribute('normal'), uv = m.geometry.getAttribute('uv');
        for (let t = 0; uv && t < pos.count; t += 3 * Math.max(1, Math.floor(pos.count / 3 / 300))) {
          if (nor.getX(t) !== nor.getX(t + 1) || nor.getY(t) !== nor.getY(t + 1) || nor.getZ(t) !== nor.getZ(t + 2)) continue; // smooth (lathe) faces
          for (const [i, j] of [[0, 1], [1, 2]]) {
            va.fromBufferAttribute(pos, t + i); vb.fromBufferAttribute(pos, t + j); const w = va.distanceTo(vb); if (w < 0.05) continue;
            const u = Math.hypot(uv.getX(t + i) - uv.getX(t + j), uv.getY(t + i) - uv.getY(t + j)); uvTri++; if (Math.abs(u / w - 1) > 0.01) uvBad++;
          }
        }
      }
      const stats = scene.blocks.stats['b05-southmall'];
      r4.pbr = { meshes: all.length, triangles: tris, materials: mats.size, textures: texs.size, kit: stats?.pbr, uvEdgesChecked: uvTri, uvNotMetre: uvBad, problems: bad.slice(0, 8) };
      if (bad.length) failures.push(`round-4 meshes: ${bad.length} PBR/flag problems, e.g. ${bad.slice(0, 3).join('; ')}`);
      if (uvTri < 500 || uvBad) failures.push(`metre UVs: ${uvBad}/${uvTri} flat edges with UV length != world length (1 %)`);
      if (all.length > 60 || tris > 400000 || texs.size > 15 || mats.size > 12) failures.push(`round-4 budget exceeded: ${all.length} meshes, ${tris} triangles, ${mats.size} materials, ${texs.size} textures`);
    }
    r4.shotsGround = (JSON.parse(readFileSync(resolve(process.cwd(), 'lib/campus/blocks/b05-southmall/shots.json'), 'utf8')) as { id: string; position: number[]; groundY: number }[])
      .filter(q => q.id.startsWith('b05-r4-')).map(q => ({ id: q.id, groundY: q.groundY, terrain: r2(scene.ground.height(q.position[0], q.position[2])) }));
    report.round4 = r4;
  }
  // S13 round 5: Blanton plaza paving.
  {
    const plaza = (scene.blocks.stats['b05-southmall']?.plaza ?? null) as { colliderHandle: number; triangles: number } | null;
    let mesh: THREE.Mesh | null = null;
    walkway.surfaces.traverse((o: THREE.Object3D) => { if (o.name === 'b05 Blanton plaza paving') mesh = o as THREE.Mesh; });
    const pc = (scene.blocks.installs.find((x: { id: string }) => x.id === 'b05-southmall')?.colliders ?? []).find((c: { handle: number }) => c.handle === plaza?.colliderHandle);
    const out: Record<string, unknown> = { install: plaza };
    if (!mesh || !plaza || !pc) failures.push(`plaza paving missing (mesh ${!!mesh}, stats ${!!plaza}, own collider ${!!pc})`);
    else {
      const m = mesh as THREE.Mesh, mat = m.material as THREE.MeshStandardMaterial, pos = m.geometry.getAttribute('position');
      const g = (x: number, z: number) => scene.ground.height(x, z) as number;
      const L = plazaLayout(), solids = L.holes.filter(h => h.kind === 'solid'), seamHoles = L.holes.filter(h => h.kind === 'seam' && h.name !== 'mapped steps');
      const flags = { localContext: m.userData.localContext === true, block: m.userData.block, pbr: !!(mat.map && mat.normalMap && mat.roughnessMap), vertexColors: !!mat.vertexColors, material: mat.name };
      if (!flags.localContext || flags.block !== 'b05-southmall' || !flags.pbr || flags.vertexColors) failures.push(`plaza paving flags ${JSON.stringify(flags)}`);
      // (a) Analytic, every triangle: drape band, slope (no risers), D10 rectangles, loggia-only inside BMA/BMS, solid clearance.
      const halls = [[BMA_SPEC, 0], [BMS_SPEC, 3]].map(([h, k]) => ({ ring: (h as typeof BMA_SPEC).ring as Pt[], k: k as number, depth: (h as typeof BMA_SPEC).loggia.depth }));
      const shoelace = (q: Pt[]) => q.reduce((s2, p, i) => s2 + p[0] * q[(i + 1) % q.length][1] - q[(i + 1) % q.length][0] * p[1], 0) / 2;
      const clipLeft = (q: Pt[], a: Pt, b: Pt) => { const o: Pt[] = [], sd = (p: Pt) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
        for (let i = 0; i < q.length; i++) { const p = q[i], r = q[(i + 1) % q.length], sp = sd(p), sr = sd(r); if (sp >= 0) o.push(p);
          if ((sp > 0 && sr < 0) || (sp < 0 && sr > 0)) { const t = sp / (sp - sr); o.push([p[0] + (r[0] - p[0]) * t, p[1] + (r[1] - p[1]) * t]); } } return o; };
      const ccwP = (q: Pt[]) => (shoelace(q) > 0 ? q : q.slice().reverse());
      const footprints = [...solids.map(h => ccwP(h.poly as Pt[])), ...halls.map(hl => { // interior beyond the loggia line (depth - clear)
        const r = ccwP(hl.ring), a = hl.ring[hl.k], b = hl.ring[(hl.k + 1) % hl.ring.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]), u: Pt = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
        const c = r.reduce((s2, p) => [s2[0] + p[0] / r.length, s2[1] + p[1] / r.length], [0, 0]); let n: Pt = [u[1], -u[0]];
        if ((c[0] - a[0]) * n[0] + (c[1] - a[1]) * n[1] < 0) n = [-n[0], -n[1]];
        const d = hl.depth - PLAZA.clear, q0: Pt = [a[0] + n[0] * d, a[1] + n[1] * d], q1: Pt = [q0[0] + u[0], q0[1] + u[1]];
        return (q1[0] - q0[0]) * (c[1] - q0[1]) - (q1[1] - q0[1]) * (c[0] - q0[0]) >= 0 ? clipLeft(r, q0, q1) : clipLeft(r, q1, q0); })]
        .map(poly => { const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]); return { poly, box: [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)] }; });
      let skins = 0, skinArea = 0, overlapMax = 0;
      const triPt = (px: number, pz: number, a: number[], b: number[], c: number[]) => { const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]); if (Math.abs(d) < 1e-12) return false;
        const u = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (pz - c[1])) / d, v = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (pz - c[1])) / d; return u > 1e-9 && v > 1e-9 && u + v < 1 - 1e-9; };
      const triDist = (px: number, pz: number, a: number[], b: number[], c: number[]) => (triPt(px, pz, a, b, c) ? 0 : Math.min(segDist(px, pz, a as Pt, b as Pt), segDist(px, pz, b as Pt, c as Pt), segDist(px, pz, c as Pt, a as Pt)));
      const stems = PETALS.map(p => [p.x, p.z] as Pt), cols = solids.filter(h => /column/.test(h.name)).map(h => { const c = h.poly.reduce((s, q) => [s[0] + q[0] / h.poly.length, s[1] + q[1] / h.poly.length], [0, 0]); return c as Pt; });
      let tris = 0, area = 0, bandBad = 0, minDy = Infinity, maxDy = -Infinity, steep = 0, slivers = 0, liftGrad = 0, minNy = 1, outside = 0, interior = 0, inLoggia = 0, solidHit = 0, stemMin = Infinity, colMin = Infinity; const ex: unknown[] = [];
      const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3();
      for (let t = 0; t < pos.count; t += 3) {
        A.fromBufferAttribute(pos, t); B.fromBufferAttribute(pos, t + 1); C.fromBufferAttribute(pos, t + 2); tris++;
        N.crossVectors(B.clone().sub(A), C.clone().sub(A)); const l = N.length(); area += l / 2; if (l < 1e-9) continue; const ny = N.y / l; minNy = Math.min(minNy, ny); if (ny < 0.9) slivers++;
        const v = [A, B, C].map(q => [q.x, q.z]);
        // No riser: the lift above the visible ground changes along every edge by at most the designed seam ramp.
        for (const [p, q] of [[A, B], [B, C], [C, A]]) { const h = Math.hypot(p.x - q.x, p.z - q.z); if (h < 0.02) continue;
          const gr = Math.abs((p.y - g(p.x, p.z)) - (q.y - g(q.x, q.z))) / h; liftGrad = Math.max(liftGrad, gr); if (gr > (PLAZA.lift + PLAZA.dip) / PLAZA.taper + 0.005) steep++; }
        for (const q of [A, B, C]) {
          const dy = q.y - g(q.x, q.z); minDy = Math.min(minDy, dy); maxDy = Math.max(maxDy, dy);
          if (dy < -PLAZA.dip - 0.004 || dy > PLAZA.lift + 0.004) { bandBad++; if (ex.length < 4) ex.push(['band', r2(q.x), r2(q.z), +dy.toFixed(3)]); }
          if (!(q.x >= -149.3 && q.x <= 0 && q.z >= 483.3 && q.z <= 640)) outside++;
        }
        const cx = (A.x + B.x + C.x) / 3, cz = (A.z + B.z + C.z) / 3;
        for (const hl of halls) if (pip(cx, cz, hl.ring)) { const a = hl.ring[hl.k], b = hl.ring[(hl.k + 1) % hl.ring.length], d = Math.abs((b[0] - a[0]) * (cz - a[1]) - (b[1] - a[1]) * (cx - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]); if (d > hl.depth - 0.01) { interior++; if (ex.length < 8) ex.push(['interior', r2(cx), r2(cz), r2(d)]); } else inLoggia++; }
        // Strict overlap AREA of the emitted Float32 triangle with each ORIGINAL (clear 0.02) convex solid footprint and the
        // BMA/BMS interiors beyond the loggia (epsilon-free float64 clip): > 1e-6 m2 fails, any positive area is reported.
        let worstA = 0;
        for (const h of footprints) {
          if (cx < h.box[0] - 3 || cx > h.box[1] + 3 || cz < h.box[2] - 3 || cz > h.box[3] + 3) continue;
          let q = v as Pt[]; for (let i = 0; i < h.poly.length && q.length >= 3; i++) q = clipLeft(q, h.poly[i], h.poly[(i + 1) % h.poly.length]);
          const a2 = q.length >= 3 ? Math.abs(shoelace(q)) : 0; if (a2 > 0) { skins++; skinArea += a2; worstA = Math.max(worstA, a2); }
        }
        overlapMax = Math.max(overlapMax, worstA);
        if (worstA > 1e-6) { solidHit++; if (ex.length < 8) ex.push(['solid', r2(cx), r2(cz), worstA]); }
        for (const s of stems) if (Math.abs(s[0] - cx) < 2 && Math.abs(s[1] - cz) < 2) stemMin = Math.min(stemMin, triDist(s[0], s[1], v[0], v[1], v[2]));
        for (const s of cols) if (Math.abs(s[0] - cx) < 2 && Math.abs(s[1] - cz) < 2) colMin = Math.min(colMin, triDist(s[0], s[1], v[0], v[1], v[2]));
      }
      out.analytic = { triangles: tris, areaM2: +area.toFixed(1), dyMin: +minDy.toFixed(4), dyMax: +maxDy.toFixed(4), outsideBand: bandBad, minNormalY: +minNy.toFixed(4), sliversBelowNy0_9: slivers, worstLiftGradient: +liftGrad.toFixed(4), risers: steep, outsideD10: outside,
        insideHallTriangles: inLoggia, insideHallBeyondLoggia: interior, onSolidFootprints: solidHit, footprintsChecked: footprints.length, positiveOverlapPairs: skins, overlapAreaTotalM2: skinArea, overlapAreaMaxM2: overlapMax, stemClearanceM: r2(stemMin), columnClearanceM: r2(colMin), examples: ex };
      if (tris < 5000 || tris > 60000) failures.push(`plaza paving triangles ${tris} outside 5k-60k`);
      if (bandBad) failures.push(`plaza paving: ${bandBad} vertices outside the drape band [-${PLAZA.dip}, +${PLAZA.lift}] m of the visible ground`);
      if (minNy < 0.6) failures.push(`plaza paving: wall-like triangle (normal.y ${minNy.toFixed(3)} < 0.6); ${slivers} below 0.9`);
      if (steep) failures.push(`plaza paving: ${steep} edges whose lift above the ground changes faster than the seam ramp (riser)`);
      if (outside) failures.push(`plaza paving: ${outside} vertices outside the D10 rectangles`);
      if (interior || solidHit) failures.push(`plaza paving inside BMA/BMS solid interior (${interior}) or overlapping original column/pier/stem/portal/interior footprints by > 1e-6 m2 (${solidHit}, max ${overlapMax})`);
      if (!(stemMin >= PETAL_STEM.r0 + 0.015) || !(colMin >= 0.4 + 0.015)) failures.push(`plaza paving clearance: stems ${stemMin.toFixed(3)} m, columns ${colMin.toFixed(3)} m`);
      // (b) Rays only against the paving collider.
      const only = (k: { handle: number }) => k.handle === plaza.colliderHandle;
      const pave = (x: number, z: number, from: number, reach: number) => { const h = ph.castRay(new R.Ray({ x, y: from, z }, { x: 0, y: -1, z: 0 }), reach, true, undefined, undefined, pl, undefined, only); return h ? from - h.timeOfImpact : null; };
      let vp = 0, vpBad = 0, vpWorst = 0, mid = 0; const stride = Math.max(1, Math.floor(pos.count / 3 / 120));
      for (let t = 0; t < pos.count; t += 3 * stride) {
        A.fromBufferAttribute(pos, t); B.fromBufferAttribute(pos, t + 1); C.fromBufferAttribute(pos, t + 2);
        const cx = (A.x + B.x + C.x) / 3, cy = (A.y + B.y + C.y) / 3, cz = (A.z + B.z + C.z) / 3, y = pave(cx, cz, cy + 0.5, 1); vp++;
        const e = y === null ? Infinity : Math.abs(y - cy); vpWorst = Math.max(vpWorst, Math.min(e, 9)); if (e > 0.01) vpBad++;
        if (Math.abs(cy - g(cx, cz) - PLAZA.lift) < 0.006) mid++;
      }
      out.visibleVsPhysical = { samples: vp, over1cm: vpBad, worstM: +vpWorst.toFixed(4), interiorAtFullLift: mid };
      if (vpBad || vp < 100) failures.push(`plaza paving: ${vpBad}/${vp} sampled triangles without the paving collider at the visible top (1 cm)`);
      if (mid < vp * 0.6) failures.push(`plaza paving: only ${mid}/${vp} sampled triangles at the full drape lift (ground continuity)`);
      // Seam transects (30 outline/island seam points, 7 samples over +-0.6 m): top = max(paving, ground) continuous.
      const seamPts: { p: Pt; n: Pt }[] = [];
      const addEdges = (r: Pt[], flag: (i: number) => boolean) => { for (let i = 0; i < r.length; i++) if (flag(i)) { const a = r[i], b = r[(i + 1) % r.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > 1.5) seamPts.push({ p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], n: [(b[1] - a[1]) / l, -(b[0] - a[0]) / l] }); } };
      addEdges(L.outline as Pt[], i => L.seam[i]); for (const h of seamHoles) addEdges(h.poly as Pt[], () => true);
      const pick = seamPts.filter((_, i) => i % Math.max(1, Math.ceil(seamPts.length / 30)) === 0);
      const shape = new R.Capsule(0.5, 0.3); let jumpWorst = 0, liftWorst = 0, capsBlocked = 0, rays = 0; const sx: unknown[] = [];
      for (const { p, n } of pick) {
        let prev: number | null = null;
        for (let k = -3; k <= 3; k++) {
          const x = p[0] + n[0] * 0.2 * k, z = p[1] + n[1] * 0.2 * k, gy = g(x, z), py = pave(x, z, gy + 0.3, 0.6); rays++;
          const top = Math.max(gy, py ?? -Infinity) - gy; liftWorst = Math.max(liftWorst, top);
          if (prev !== null) jumpWorst = Math.max(jumpWorst, Math.abs(top - prev)); prev = top;
        }
        let hit = false;
        ph.intersectionsWithShape({ x: p[0], y: g(p[0], p[1]) + 1.15, z: p[1] }, { x: 0, y: 0, z: 0, w: 1 }, shape, (k2: { handle: number }) => { if (ownSet.has(k2.handle)) { hit = true; return false; } return true; }, undefined, undefined, pl);
        if (hit) { capsBlocked++; if (sx.length < 4) sx.push([r2(p[0]), r2(p[1])]); }
      }
      out.seams = { seamEdgesSampled: pick.length, rays, worstStepPer0_2m: +jumpWorst.toFixed(4), worstLiftAboveGround: +liftWorst.toFixed(4), capsulesBlockedByB05: capsBlocked, examples: sx };
      if (pick.length < 20 || jumpWorst > 0.04 || liftWorst > PLAZA.lift + 0.005) failures.push(`plaza seams: ${pick.length} sampled, worst step ${jumpWorst.toFixed(3)} m / 0.2 m, worst lift ${liftWorst.toFixed(3)} m`);
      if (capsBlocked) failures.push(`plaza seams: ${capsBlocked} standing capsules blocked by b05 colliders ${JSON.stringify(sx)}`);
      // Retained islands: points 0.6 m inside each lawn/bed/tree island carry no paving.
      let isl = 0, paved = 0; const islEx: unknown[] = [];
      for (const h of seamHoles) {
        const r = h.poly as Pt[], c = r.reduce((s, q) => [s[0] + q[0] / r.length, s[1] + q[1] / r.length], [0, 0]);
        for (let k = 0; k < 9; k++) {
          const q: Pt = k === 0 ? [c[0], c[1]] : [c[0] + (r[(k * 2) % r.length][0] - c[0]) * 0.6, c[1] + (r[(k * 2) % r.length][1] - c[1]) * 0.6];
          if (edgeDist(q[0], q[1], r) < 0.6 || !pip(q[0], q[1], r) || !pip(q[0], q[1], L.outline as Pt[])) continue;
          isl++; const py = pave(q[0], q[1], g(q[0], q[1]) + 0.5, 1); if (py !== null) { paved++; if (islEx.length < 4) islEx.push([h.name, r2(q[0]), r2(q[1])]); }
        }
      }
      out.retainedIslands = { islands: seamHoles.length, samples: isl, paved, examples: islEx, lawnAreaKept: (scene.blocks.stats['b05-southmall']?.plaza as { islandAreaM2?: number })?.islandAreaM2 };
      if (isl < 20 || paved) failures.push(`plaza islands: ${paved}/${isl} samples inside lawn/planting/tree islands are paved`);
      // Base-scene trees around the plaza (CHM/TreeKeeper placements, probe 2026-10-21) unchanged: x, z, scale, rotation, form.
      const base: [number, number, number, number, number][] = [[-96.39, 587.41, 0.764, -0.167, 10], [-54.04, 601.83, 0.325, 5.244, 4], [-58.59, 602.52, 0.883, 2.408, 3],
        [-62.22, 599.97, 0.7, 3.76, 3], [-65.93, 599.05, 0.24, 6.16, 8], [-70.4, 550.4, 1.027, 2.32, 10], [-72.79, 545.057, 0.633, 4.761, 10]];
      const now = ((scene.vegetation?.canopy?.placed ?? []) as { x: number; z: number; scale: number; rotation: number; form: number }[]).filter(t => t.x > -100 && t.x < -45 && t.z > 515 && t.z < 612);
      const moved = base.filter(b => !now.some(t => Math.abs(t.x - b[0]) < 0.01 && Math.abs(t.z - b[1]) < 0.01 && Math.abs(t.scale - b[2]) < 0.002 && Math.abs(t.rotation - b[3]) < 0.002 && t.form === b[4]));
      out.trees = { baseline: base.length, now: now.length, changed: moved };
      if (moved.length || now.length !== base.length) failures.push(`plaza trees changed: ${now.length} placed vs ${base.length} baseline, changed ${JSON.stringify(moved)}`);
    }
    report.plaza = out;
  }
  // S14 round 6 Dobie Twenty21 (d21.ts). Bounded: Rapier rays filtered to the D21 collider, three rays only on D21 meshes.
  {
    const out: Record<string, unknown> = {};
    const T = d21Tiers(), city = D21_CITY_RING as Pt[], ringB = T.podiumB.ring as Pt[], ringT = T.tower.ring as Pt[], ringM = T.mech.ring as Pt[];
    const dSol = ((b05Inst?.solids ?? []) as THREE.Mesh[]).filter(m => m.userData?.b05Group === 'D21');
    const dDet = ((b05Inst?.detail ?? []) as THREE.Mesh[]).filter(m => m.userData?.b05Group === 'D21');
    const handle = dSol[0]?.userData.colliderHandle as number | undefined;
    const col = handle === undefined ? null : ph.getCollider(handle);
    const mine = (k: { handle: number }) => k.handle === handle;
    const dY = (x: number, z: number) => { const h = ph.castRay(new R.Ray({ x, y: 120, z }, { x: 0, y: -1, z: 0 }), 130, true, undefined, undefined, pl, undefined, mine); return h ? 120 - h.timeOfImpact : null; };
    const g = (x: number, z: number) => scene.ground.height(x, z) as number;
    if (!col || !dSol.length) failures.push('D21: Dobie meshes/collider not installed');
    else {
      // (a) Identity: replacement committed, no generated body inside the City ring, b05 archetype, Dobie finishes.
      const p = plan(D21_KEY), committed = scene.blocks.replacements.committed[D21_KEY];
      const cd = ctxData as unknown as { catalog: Record<string, { archetype: string }>; archetypes: Record<string, unknown>; massing: Record<string, unknown> };
      let genS = 0, genHit = 0;
      const xs = city.map(q => q[0]), zs = city.map(q => q[1]);
      for (let x = Math.min(...xs) + 2; x < Math.max(...xs); x += 4) for (let z = Math.min(...zs) + 2; z < Math.max(...zs); z += 4) {
        if (!pip(x, z, city) || edgeDist(x, z, city) < 1) continue;
        genS++; const h = top(gen, x, z); if (h && h.y > T.base.y - 4) genHit++;
      }
      const byName = Object.fromEntries(dSol.map(m => [m.name, m]));
      const need = ['b05 D21 podium walls', 'b05 D21 roofs', 'b05 D21 tower curtain-wall glass', 'b05 D21 tower bands and mechanical screen'];
      const hsl = (c: THREE.Color) => { const o = { h: 0, s: 0, l: 0 }; c.getHSL(o, THREE.SRGBColorSpace); return o; };
      const glassM = byName['b05 D21 tower curtain-wall glass']?.material as THREE.MeshStandardMaterial | undefined;
      const bandM = byName['b05 D21 tower bands and mechanical screen']?.material as THREE.MeshStandardMaterial | undefined;
      const gl = glassM ? hsl(glassM.color) : null, bl = bandM ? hsl(bandM.color) : null, podL = hsl(new THREE.Color(D21_FINISHES.podium.color));
      const mats = new Set<THREE.Material>(), owned = new Set<THREE.Material>(), maps = new Set<THREE.Texture>(), urls: string[] = [];
      for (const m of [...dSol, ...dDet]) { const mm = m.material as THREE.MeshStandardMaterial; mats.add(mm); if (mm.name.startsWith('b05 D21')) owned.add(mm);
        for (const t of [mm.map, mm.normalMap, mm.roughnessMap]) if (t) { maps.add(t); urls.push(String(t.userData?.url ?? t.name)); } }
      const ownedMaps = new Set([...owned].flatMap(m => { const s = m as THREE.MeshStandardMaterial; return [s.map, s.normalMap, s.roughnessMap].filter(Boolean); }));
      const badUrl = urls.filter(u => /online-photos|directory-photo|screenshot|https?:|\.webp/i.test(u) || (u.startsWith('/') && !u.startsWith('/assets/materials/context/')));
      out.identity = { decision: p?.decision ?? null, committed: committed ?? null, generatedSamplesInsideRing: genS, generatedBodyHits: genHit,
        catalogArchetype: cd.catalog['484112']?.archetype ?? null, archetypeDefined: Boolean(cd.archetypes[D21_ARCHETYPE]), massingKept: Boolean(cd.massing[D21_KEY]),
        meshes: dSol.map(m => m.name).concat(dDet.map(m => m.name)), towerGlassHSL: gl && { h: r2(gl.h), s: r2(gl.s), l: r2(gl.l) }, towerGlassMetalness: glassM?.metalness, towerGlassRoughness: glassM?.roughness,
        bandLightness: bl && r2(bl.l), podiumLightness: r2(podL.l), textureUrls: [...new Set(urls)] };
      if (p?.decision !== 'authored' || committed !== 'b05-southmall') failures.push(`D21 replacement not committed (decision ${p?.decision}, committed ${committed})`);
      if (!genS || genHit) failures.push(`D21: ${genHit}/${genS} samples inside the City ring still hit a generated body`);
      if (cd.catalog['484112']?.archetype !== D21_ARCHETYPE || !cd.archetypes[D21_ARCHETYPE] || !cd.massing[D21_KEY]) failures.push('D21: b05 catalog/archetype/massing entries missing');
      for (const k of need) if (!byName[k]) failures.push(`D21 mesh missing: ${k}`);
      if (!gl || gl.h < 0.40 || gl.h > 0.55 || gl.s < 0.25 || (glassM?.metalness ?? 0) < 0.5 || (glassM?.roughness ?? 1) > 0.25) failures.push(`D21 tower glass is not a reflective blue-green finish ${JSON.stringify(out.identity)}`);
      if (!bl || bl.l > 0.2) failures.push(`D21 bands not dark (lightness ${bl?.l})`);
      if (!(podL.l > 0.8 && gl && podL.l > gl.l + 0.3)) failures.push(`D21 podium finish not light against the glass (podium ${podL.l}, glass ${gl?.l})`);
      if (badUrl.length) failures.push(`D21 textures not same-origin context families: ${badUrl.join(', ')}`);

      // (b) Exact measured preservation + closure: 1 m grid in the City ring; roof = highest measured tier containing the point
      // (tower and mech tiers above tier B above the City-ring base at the 8.7 m tier), every sample roofed.
      const expect = (x: number, z: number) => (pip(x, z, ringM) ? T.mech.y : pip(x, z, ringT) ? T.tower.y : pip(x, z, ringB) ? T.podiumB.y : T.base.y);
      const rc2 = new THREE.Raycaster(); rc2.far = 130;
      let n = 0, unroofed = 0, wrong = 0, parS = 0, parBad = 0; const ex: unknown[] = [], levels: Record<string, number> = {};
      for (let x = Math.min(...xs) + 0.25; x < Math.max(...xs); x += 1) for (let z = Math.min(...zs) + 0.25; z < Math.max(...zs); z += 1) {
        if (!pip(x, z, city) || Math.min(edgeDist(x, z, city), edgeDist(x, z, ringB), edgeDist(x, z, ringT), edgeDist(x, z, ringM)) < 0.15) continue;
        n++; const y = dY(x, z), e = expect(x, z);
        if (y === null) { unroofed++; if (ex.length < 5) ex.push(['unroofed', x, z]); continue; }
        if (Math.abs(y - e) > 0.01) { wrong++; if (ex.length < 5) ex.push([x, z, r2(y), e]); }
        levels[e.toFixed(1)] = (levels[e.toFixed(1)] ?? 0) + 1;
        if (n % 7 === 0) { rc2.set(new THREE.Vector3(x, 120, z), down); const v = rc2.intersectObjects(dSol, false)[0]; parS++; if (!v || Math.abs(v.point.y - y) > 0.01) parBad++; }
      }
      out.preservation = { samples: n, unroofed, wrongLevel: wrong, examples: ex, samplesPerRoofY: levels,
        measured: { baseY: T.base.y, podiumBY: T.podiumB.y, towerY: T.tower.y, mechY: T.mech.y, cityRingVertices: city.length, tierRingVertices: [T.base.tierRing.length, ringB.length, ringT.length, ringM.length] } };
      if (n < 4000 || unroofed || wrong) failures.push(`D21 roof preservation: ${unroofed} unroofed and ${wrong} off the measured tier Y (0.01 m) of ${n} samples, e.g. ${JSON.stringify(ex)}`);

      // (c) Render = collider: identical vertex arrays, down-ray parity (above), horizontal-ray parity.
      const meshPos: number[] = []; for (const m of dSol) for (const v of (m.geometry.getAttribute('position').array as Float32Array)) meshPos.push(v);
      const cv = (col.shape as unknown as { vertices?: Float32Array }).vertices, ci = (col.shape as unknown as { indices?: Uint32Array }).indices;
      let arrDiff = Infinity;
      if (cv && ci && ci.length * 3 === meshPos.length) { arrDiff = 0; for (let k = 0; k < ci.length; k++) for (let a = 0; a < 3; a++) arrDiff = Math.max(arrDiff, Math.abs(cv[ci[k] * 3 + a] - meshPos[k * 3 + a])); }
      let hS = 0, hBad = 0; const hEx: unknown[] = []; const cx = -401.11, cz = 301.31;
      for (let k = 0; k < 16; k++) for (const y of [12, 17, 40, 70, 93]) {
        const a = (k / 16) * Math.PI * 2, o = new THREE.Vector3(cx + Math.cos(a) * 90, y, cz + Math.sin(a) * 90), d = new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a));
        rc2.set(o, d); rc2.far = 95; const v = rc2.intersectObjects(dSol, false)[0];
        const h = ph.castRay(new R.Ray({ x: o.x, y, z: o.z }, { x: d.x, y: 0, z: d.z }), 95, true, undefined, undefined, pl, undefined, mine);
        hS++; const dv = v ? v.distance : null, dp = h ? h.timeOfImpact : null;
        if ((dv === null) !== (dp === null) || (dv !== null && Math.abs(dv - dp!) > 0.02)) { hBad++; if (hEx.length < 4) hEx.push([k, y, dv && r2(dv), dp && r2(dp)]); }
      }
      out.parity = { meshTriangles: meshPos.length / 9, colliderTriangles: ci ? ci.length / 3 : null, vertexArrayMaxDiff: Number.isFinite(arrDiff) ? arrDiff : null, downRays: parS, downMismatch: parBad, horizontalRays: hS, horizontalMismatch: hBad, examples: hEx };
      if (!(arrDiff <= 1e-5)) failures.push(`D21 collider triangles != rendered solid triangles (${ci ? ci.length / 3 : '?'} vs ${meshPos.length / 9}, max diff ${arrDiff})`);
      if (parBad || hBad) failures.push(`D21 render/collider mismatch: ${parBad}/${parS} down rays, ${hBad}/${hS} horizontal rays ${JSON.stringify(hEx)}`);

      // (d) Visual-only exemption limited to the tower bay fins: named trim, within 0.3 m of the measured tower ring, inside its height band.
      let trimOut = 0, trimV = 0; const pv = new THREE.Vector3();
      for (const m of dDet) { const pa = m.geometry.getAttribute('position'); for (let i = 0; i < pa.count; i++) { pv.fromBufferAttribute(pa, i); trimV++; if (edgeDist(pv.x, pv.z, ringT) > 0.3 || pv.y < T.base.y || pv.y > T.tower.y) trimOut++; } }
      out.trims = { meshes: dDet.map(m => m.name), vertices: trimV, outsideTowerFinBand: trimOut };
      if (dDet.some(m => !m.name.endsWith('(visual trim)')) || trimOut) failures.push(`D21 visual-only geometry beyond the tower bay fins: ${trimOut}/${trimV} vertices`);

      // (d2) The measured tier B / tower rings share 9.58 m of collinear edge; that internal interface must carry no wall
      // between the podium base roof (14.7) and the tier B roof (19.1) (it would be coplanar opposite faces). Analytic, on
      // the D21 vertical solid triangles only.
      const vt: { nx: number; nz: number; d: number; u0: number; u1: number; y0: number; y1: number; cx: number; cy: number; cz: number }[] = [];
      { const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3();
        for (const m of dSol) { const pa = m.geometry.getAttribute('position'); for (let i = 0; i + 2 < pa.count; i += 3) {
          A.fromBufferAttribute(pa, i); B.fromBufferAttribute(pa, i + 1); C.fromBufferAttribute(pa, i + 2);
          N.crossVectors(B.clone().sub(A), C.clone().sub(A)); if (N.length() < 1e-6) continue; N.normalize(); if (Math.abs(N.y) > 0.01) continue;
          const nx = N.x / Math.hypot(N.x, N.z), nz = N.z / Math.hypot(N.x, N.z), us = [A, B, C].map(q => -nz * q.x + nx * q.z), ys = [A.y, B.y, C.y];
          vt.push({ nx, nz, d: nx * A.x + nz * A.z, u0: Math.min(...us), u1: Math.max(...us), y0: Math.min(...ys), y1: Math.max(...ys), cx: (A.x + B.x + C.x) / 3, cy: (A.y + B.y + C.y) / 3, cz: (A.z + B.z + C.z) / 3 });
        } } }
      const sh = sharedSegments(ringB, ringT), shSegs: [Pt, Pt][] = [];
      ringB.forEach((a, i) => { const b = ringB[(i + 1) % ringB.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (const [s0, s1] of sh.onA[i]) shSegs.push([[a[0] + (b[0] - a[0]) * s0 / L, a[1] + (b[1] - a[1]) * s0 / L], [a[0] + (b[0] - a[0]) * s1 / L, a[1] + (b[1] - a[1]) * s1 / L]]); });
      const onShared = vt.filter(t => t.cy > T.base.y + 0.01 && t.cy < T.podiumB.y - 0.01 && shSegs.some(([a, b]) => segDist(t.cx, t.cz, a, b) < 0.02)).length;
      // Contact probe at the measured 0.34 m slit between tier B edge 14 and tower edge 27 (generic G3 casts from 0.5 m and
      // first meets the facing tower wall there): from 0.1 m off the tier B face along its normal, the D21 collider is hit at 0.1 m.
      const slit = vt.filter(t => Math.hypot(t.cx + 404.7, t.cz - 309.3) < 1.5 && t.cy > T.base.y && t.cy < T.podiumB.y)
        .sort((p, q) => Math.hypot(p.cx + 404.7, p.cy - 16.2, p.cz - 309.3) - Math.hypot(q.cx + 404.7, q.cy - 16.2, q.cz - 309.3))[0];
      let slitRow: Record<string, unknown> | null = null;
      if (slit) {
        const cast = (sg: number, from: number, reach: number) => ph.castRay(new R.Ray({ x: slit.cx + slit.nx * from, y: slit.cy, z: slit.cz + slit.nz * from }, { x: slit.nx * sg, y: 0, z: slit.nz * sg }), reach, true, undefined, undefined, pl, undefined, mine);
        const back = cast(-1, 0.1, 0.2), across = cast(1, 0.001, 2);
        slitRow = { at: [r2(slit.cx), r2(slit.cy), r2(slit.cz)], contactToi: back ? +back.timeOfImpact.toFixed(3) : null, slitWidthM: across ? +across.timeOfImpact.toFixed(3) : null };
        if (!back || Math.abs(back.timeOfImpact - 0.1) > 0.01) failures.push(`D21 slit face has no own collider within 0.1 m ${JSON.stringify(slitRow)}`);
      }
      out.coplanar = { verticalTriangles: vt.length, sharedTierBTowerStretchM: r2(sh.total), wallTrianglesOnSharedStretchBelowTierBRoof: onShared, slitContactProbe: slitRow };
      if (onShared || !(sh.total > 9)) failures.push(`D21 internal tier B/tower interface carries ${onShared} wall triangles (${r2(sh.total)} m shared stretch)`);

      // (e) No bottom caps; podium walls reach the ground along the whole City ring (horizontal rays 1 m outside, 0.15 m above grade).
      let downTris = 0, buried = 0; const ta = new THREE.Vector3(), tb = new THREE.Vector3(), tc = new THREE.Vector3(), tn = new THREE.Vector3();
      for (const m of dSol) { const pa = m.geometry.getAttribute('position'); for (let i = 0; i + 2 < pa.count; i += 3) {
        ta.fromBufferAttribute(pa, i); tb.fromBufferAttribute(pa, i + 1); tc.fromBufferAttribute(pa, i + 2);
        tn.crossVectors(tb.clone().sub(ta), tc.clone().sub(ta)).normalize(); if (tn.y > -0.5) continue;
        downTris++; const mx = (ta.x + tb.x + tc.x) / 3, my = (ta.y + tb.y + tc.y) / 3, mz = (ta.z + tb.z + tc.z) / 3; if (my < g(mx, mz) + 0.3) buried++; } }
      const otherRings = (plans as { building: { key: string; rings: Pt[][] } }[]).filter(q => q.building.key !== D21_KEY).map(q => q.building.rings[0]);
      let wS = 0, wMiss = 0; const wEx: unknown[] = [];
      for (let i = 0; i < city.length; i++) {
        const a = city[i], b = city[(i + 1) % city.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1.2) continue;
        const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L; let nx = uz, nz = -ux;
        if (pip((a[0] + b[0]) / 2 + nx * 0.05, (a[1] + b[1]) / 2 + nz * 0.05, city)) { nx = -nx; nz = -nz; }
        for (let s = 0.5; s <= L - 0.5; s += 1.5) {
          const ox = a[0] + ux * s + nx, oz = a[1] + uz * s + nz;
          if (pip(ox, oz, city) || otherRings.some(r => pip(ox, oz, r))) continue;
          const y = g(ox, oz) + 0.15, h = ph.castRay(new R.Ray({ x: ox, y, z: oz }, { x: -nx, y: 0, z: -nz }), 1.6, true, undefined, undefined, pl, undefined, mine);
          wS++; if (!h || h.timeOfImpact > 1.05) { wMiss++; if (wEx.length < 5) wEx.push([r2(ox), r2(oz), r2(y), h ? r2(h.timeOfImpact) : null]); }
        }
      }
      out.ground = { downFacingTriangles: downTris, downFacingNearGround: buried, perimeterSamples: wS, wallMissingAtGrade: wMiss, examples: wEx, wallBottomMinY: (b05Inst?.stats?.districts?.['D08 D21'] as { wallBottomMinY?: number })?.wallBottomMinY };
      if (buried) failures.push(`D21: ${buried} down-facing triangles at/below grade (bottom caps)`);
      if (wS < 150 || wMiss) failures.push(`D21 podium wall does not reach grade at ${wMiss}/${wS} perimeter samples ${JSON.stringify(wEx)}`);

      // (f) Budgets (draws, Dobie-owned materials/textures, triangles).
      const tris = [...dSol, ...dDet].reduce((s2, m) => s2 + m.geometry.getAttribute('position').count / 3, 0);
      out.budgets = { meshes: dSol.length + dDet.length, materials: mats.size, dobieOwnedMaterials: owned.size, dobieOwnedTextures: ownedMaps.size, triangles: tris };
      if (dSol.length + dDet.length > 8 || owned.size > 3 || ownedMaps.size > 3 || tris > 40000) failures.push(`D21 budgets exceeded ${JSON.stringify(out.budgets)}`);

      // (g) The two D21 shots: camera clear (no ring, no collider within 0.5 m), height above harness ground, first collider on the sight line is D21.
      const shotRows: Record<string, unknown> = {};
      for (const [id, agl] of [['b05-d21-street-21st-guadalupe', 1.7], ['b05-d21-aerial-30m-northeast', 30]] as const) {
        const s = (shotsJson as { id: string; position: number[]; target: number[]; groundY: number }[]).find(q => q.id === id);
        if (!s) { failures.push(`D21 shot ${id} missing`); continue; }
        const [x, y, z] = s.position, [tx, ty, tz] = s.target, gy = g(x, z);
        const inRing = (plans as { building: { key: string; rings: Pt[][] } }[]).filter(q => q.building.rings.some(r => pip(x, z, r))).map(q => q.building.key);
        let near = 0; ph.intersectionsWithShape({ x, y, z }, { x: 0, y: 0, z: 0, w: 1 }, new R.Ball(0.5), () => { near++; return true; }, undefined, undefined, pl);
        const L = Math.hypot(tx - x, ty - y, tz - z), h = ph.castRay(new R.Ray({ x, y, z }, { x: (tx - x) / L, y: (ty - y) / L, z: (tz - z) / L }), L + 60, true, undefined, undefined, pl);
        const row = { position: s.position, groundY: r2(gy), shotGroundY: s.groundY, aboveGround: r2(y - gy), insideRings: inRing, collidersWithin05: near, firstHitIsD21: h ? h.collider.handle === handle : false, firstHitDistance: h ? r2(h.timeOfImpact) : null };
        shotRows[id] = row;
        if (inRing.length || near || !row.firstHitIsD21 || Math.abs(y - gy - agl) > 0.3 || Math.abs(s.groundY - gy) > 0.1) failures.push(`D21 shot ${id} not clear/at height ${JSON.stringify(row)}`);
      }
      out.shots = shotRows;
      out.estimatesReportedOnly = (b05Inst?.stats?.districts?.['D08 D21'] as { estimates?: unknown })?.estimates ?? null;
    }
    report.dobie = out;
  }
  {
    const keys = ['463006:7', '464830:39', '466192:59', '484112:83', '485466:100', '488003:135', '502161:149', '505680:201', '506791:214', '507348:223', '525167:250', '526084:269', '567838:465', '568540:484', '570651:526', '575894:549', '591878:622', '592266:632', '593634:654', '610756:683', '612018:712', '615315:754', '624573:795', '625710:811', '633606:820', '652349:846', '652493:849', '653897:869', '675538:965', '697424:1020', '697591:1022', '699919:1069', '714471:1095', '715514:1119', '716915:1148', '718615:1179', '732528:1227', '733879:1251', '-501:add'];
    report.decisions = Object.fromEntries(keys.map(k => [k, plan(k)?.decision ?? 'missing']));
  }
  return { ok: failures.length === 0, report, failures };
};
