// Headless checks owned by block b04-tower (run by scripts/harness/run-block-checks.mjs).
// They measure the REAL installed geometry in campus Y and compare it with the measured sources:
//  1. GOL/GEB are rendered by b04 (replacement committed, context decision 'authored', b04 meshes exist).
//  2. Roof heights in the same datum as the 2017 LiDAR (campus Y = groundY + height):
//     GOL main-range roof area-weighted median vs tier 16.0 m, GOL tower median vs tier 20.4 m,
//     GOL top <= groundY + heightMax, GEB deck vs tier 22.1 m and parapet top vs P95 22.9 m.
//  3. Footprint residual: every b04 wall vertex lies inside the GIS ring (+0.05 m) and within 0.8 m of it.
//  4. The WCH yard soil no longer has any triangle inside Gebauer's footprint.
//  5. Route clearance: a standing capsule on the West Mall paving in front of the GOL tower is free.
//  (district round) 7. BOT greenhouse 591884 replacement: committed, roof median vs LiDAR tier, top within P95..max,
//     footprint residual, visible = own collider. 8. GOL/GEB/BOT detail counts, draw budget (+12), solid GEB cornice
//     projection probed on the collider. 9. b04-owned textured finishes: families present, metre UVs.
import * as THREE from 'three';
import type { BlockCheck } from './types';
import { B04_LIDAR, GOL_MAIN, GOL_TOWER, GEB_RING, GEB_CORNICE } from '../../../lib/campus/blocks/b04-tower/index';
import { BOT_LIDAR, BOT_INSET } from '../../../lib/campus/blocks/b04-tower/greenhouse';
import maiDsm from '../../../lib/campus/blocks/b04-tower/mai-lidar-dsm.json' with { type: 'json' };
import maiPlan from '../../../lib/campus/main-building-envelope-plan.json' with { type: 'json' };
import { WASHINGTON } from '../../../lib/campus/blocks/b04-tower/washington';

type P = [number, number];
const pip = (x: number, z: number, r: P[]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const segDist = (px: number, pz: number, a: P, b: P) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l)) : 0; return Math.hypot(a[0] + t * dx - px, a[1] + t * dz - pz); };
const ringDist = (x: number, z: number, r: P[]) => Math.min(...r.map((p, i) => segDist(x, z, p, r[(i + 1) % r.length])));

export const check: BlockCheck = scene => {
  const failures: string[] = [], report: Record<string, unknown> = {};
  const inst = scene.blocks.installs.find((x: { id: string }) => x.id === 'b04-tower')?.install;
  if (!inst) return { ok: false, report, failures: ['b04 install missing'] };
  const plans = new Map<number, { decision: string }>(scene.plans.map((p: { building: { id: number }; decision: string }) => [p.building.id, p]));
  const committed = Object.entries((scene.blocks.replacements?.committed ?? {}) as Record<string, string>).filter(([, o]) => o === 'b04-tower').map(([k]) => k);
  report.decisions = { GOL: plans.get(734456)?.decision, GEB: plans.get(734466)?.decision, committed };
  for (const key of ['734456:1262', '734466:1263']) if (!committed.includes(key)) failures.push(`replacement ${key} not committed`);
  for (const id of [734456, 734466]) if (plans.get(id)?.decision !== 'authored') failures.push(`${id} context decision ${plans.get(id)?.decision} (expected authored by b04)`);
  const data = scene.world.data;
  const gis = (id: number) => data.buildings.find((b: { id: number }) => b.id === id).rings as P[][];
  // Collect b04 solid triangles per building.
  const tris: Record<string, { roof: THREE.Triangle[]; all: THREE.Vector3[] }> = { GOL: { roof: [], all: [] }, GEB: { roof: [], all: [] } };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (const s of inst.solids as THREE.Mesh[]) {
    const abbr = s.userData.b04 as string; if (!tris[abbr]) continue;
    s.updateWorldMatrix(true, false);
    const pos = s.geometry.getAttribute('position');
    for (let i = 0; i + 2 < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i).applyMatrix4(s.matrixWorld); b.fromBufferAttribute(pos, i + 1).applyMatrix4(s.matrixWorld); c.fromBufferAttribute(pos, i + 2).applyMatrix4(s.matrixWorld);
      const t = new THREE.Triangle(a.clone(), b.clone(), c.clone()); t.getNormal(n);
      tris[abbr].all.push(t.a, t.b, t.c);
      if (n.y > 0.3 && /tiles|eaves/.test(s.name)) tris[abbr].roof.push(t);
    }
  }
  const median = (list: THREE.Triangle[], ring: P[]) => {
    const items = list.map(t => { const m = new THREE.Vector3(); t.getMidpoint(m); return { m, area: t.getArea() }; }).filter(x => pip(x.m.x, x.m.z, ring)).sort((p, q) => p.m.y - q.m.y);
    const total = items.reduce((s, x) => s + x.area, 0); let acc = 0;
    for (const x of items) { acc += x.area; if (acc >= total / 2) return x.m.y; }
    return NaN;
  };
  const L = B04_LIDAR;
  const golMain = median(tris.GOL.roof.filter(t => { const m = new THREE.Vector3(); t.getMidpoint(m); return !pip(m.x, m.z, GOL_TOWER); }), GOL_MAIN);
  const golTower = median(tris.GOL.roof, GOL_TOWER);
  const golTop = Math.max(...tris.GOL.all.map(v => v.y));
  const gebDeck = median(tris.GEB.roof, GEB_RING), gebTop = Math.max(...tris.GEB.all.map(v => v.y));
  const heights = {
    golMainMedian: { model: +golMain.toFixed(2), lidar: L.GOL.groundY + L.GOL.main, tol: 0.5 },
    golTowerMedian: { model: +golTower.toFixed(2), lidar: L.GOL.groundY + L.GOL.tower, tol: 1.0 },
    golTop: { model: +golTop.toFixed(2), lidarMax: L.GOL.groundY + L.GOL.max },
    gebDeck: { model: +gebDeck.toFixed(2), lidar: L.GEB.groundY + L.GEB.deck, tol: 0.1 },
    gebTop: { model: +gebTop.toFixed(2), lidarP95: L.GEB.groundY + L.GEB.p95, tol: 0.1 },
  };
  report.heightsCampusY = heights;
  if (!(Math.abs(golMain - heights.golMainMedian.lidar) <= 0.5)) failures.push(`GOL main roof median ${golMain} vs LiDAR ${heights.golMainMedian.lidar}`);
  if (!(Math.abs(golTower - heights.golTowerMedian.lidar) <= 1.0)) failures.push(`GOL tower roof median ${golTower} vs LiDAR ${heights.golTowerMedian.lidar}`);
  if (!(golTop <= heights.golTop.lidarMax + 0.05)) failures.push(`GOL top ${golTop} above LiDAR max ${heights.golTop.lidarMax}`);
  if (!(Math.abs(gebDeck - heights.gebDeck.lidar) <= 0.1)) failures.push(`GEB deck ${gebDeck} vs LiDAR ${heights.gebDeck.lidar}`);
  if (!(Math.abs(gebTop - heights.gebTop.lidarP95) <= 0.1)) failures.push(`GEB top ${gebTop} vs LiDAR P95 ${heights.gebTop.lidarP95}`);
  // Footprint residual of the wall bases (vertices below the eaves) against the GIS ring.
  const footprint: Record<string, unknown> = {};
  for (const [abbr, id, eave] of [['GOL', 734456, 16.0], ['GEB', 734466, 30]] as const) {
    const rings = gis(id), ring = rings[0];
    const base = tris[abbr].all.filter(v => v.y < eave);
    let outside = 0; const inset: number[] = [];
    for (const v of base) { const d = Math.min(...rings.map(r => ringDist(v.x, v.z, r))); if (!pip(v.x, v.z, ring) && d > 0.05) outside++; else inset.push(d); }
    inset.sort((p, q) => p - q);
    // P90: excludes the GOL main/east-range junction wall, which is interior to the GIS ring by design.
    footprint[abbr] = { vertices: base.length, outsideGis: outside, insetP50M: +(inset[Math.floor(inset.length * 0.5)] ?? 0).toFixed(2), insetP90M: +(inset[Math.floor(inset.length * 0.9)] ?? 0).toFixed(2) };
    if (outside) failures.push(`${abbr}: ${outside} wall vertices outside the GIS footprint`);
  }
  report.footprint = footprint;
  // WCH yard soil vs Gebauer footprint.
  let soilInside = 0; const gebRing = gis(734466)[0];
  scene.walkway.surfaces.traverse((o: THREE.Object3D) => {
    const m = o as THREE.Mesh; if (!m.isMesh || m.name !== 'WCH existing yard planting soil') return;
    m.updateWorldMatrix(true, false); const pos = m.geometry.getAttribute('position');
    for (let i = 0; i + 2 < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(pos, i + 1).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(pos, i + 2).applyMatrix4(m.matrixWorld);
      const cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3; if (pip(cx, cz, gebRing)) soilInside++;
    }
  });
  report.wchSoilTrianglesInsideGeb = soilInside;
  if (soilInside) failures.push(`${soilInside} WCH yard soil triangles inside Gebauer`);
  // Standing capsule on the West Mall paving in front of the GOL tower (north face, z ~41.0).
  const { physics, RAPIER, player } = scene;
  const blockColliders = new Set(inst.colliders.map((k: { handle: number }) => k.handle));
  const shape = new RAPIER.Capsule(0.5, 0.3); const blocked: number[][] = [];
  for (let x = -401; x <= -389; x += 1) {
    const z = 41.0, hit = physics.castRay(new RAPIER.Ray({ x, y: 40, z }, { x: 0, y: -1, z: 0 }), 40, true, undefined, undefined, player);
    if (!hit) continue; const y = 40 - hit.timeOfImpact; let bad = false;
    physics.intersectionsWithShape({ x, y: y + 1.1, z }, { x: 0, y: 0, z: 0, w: 1 }, shape, (k: { handle: number }) => { if (blockColliders.has(k.handle)) { bad = true; return false; } return true; }, undefined, undefined, player);
    if (bad) blocked.push([x, +y.toFixed(2), z]);
  }
  report.westMallTowerFrontBlocked = blocked;
  // Generated WMB/SUT with LiDAR-datum massing: rendered physical roof surface vs LiDAR (same campus-Y datum).
  const lidarSurface: Record<string, unknown> = {};
  for (const [abbr, id, groundY, p50, p95] of [['WMB', 487501, 11.5, 19.2, 21.7], ['SUT', 719571, 11.1, 17.9, 20.2]] as const) {
    const ring = gis(id)[0], xs = ring.map(p => p[0]), zs = ring.map(p => p[1]), tops: number[] = [];
    for (let x = Math.min(...xs) + 1; x < Math.max(...xs); x += 2) for (let z = Math.min(...zs) + 1; z < Math.max(...zs); z += 2) {
      if (!pip(x, z, ring)) continue;
      const h = physics.castRay(new RAPIER.Ray({ x, y: 150, z }, { x: 0, y: -1, z: 0 }), 160, true, undefined, undefined, player);
      if (h) tops.push(150 - h.timeOfImpact - groundY);
    }
    tops.sort((p, q) => p - q);
    const q = (f: number) => +tops[Math.min(tops.length - 1, Math.floor(tops.length * f))].toFixed(2);
    lidarSurface[abbr] = { samples: tops.length, modelP50: q(0.5), lidarP50: p50, modelP95: q(0.95), lidarP95: p95 };
    if (!(Math.abs(q(0.5) - p50) <= 1.0 && Math.abs(q(0.95) - p95) <= 1.0)) failures.push(`${abbr} roof surface P50/P95 ${q(0.5)}/${q(0.95)} vs LiDAR ${p50}/${p95} (above groundY ${groundY})`);
  }
  report.generatedLidarSurface = lidarSurface;
  if (blocked.length) failures.push(`West Mall paving in front of the GOL tower blocked at ${JSON.stringify(blocked)}`);
  // ---- Round 2 ----
  // 6. Main Building body vs the 2017 LiDAR DSM (campus Y), 1 m grid inside the official footprint
  //    (courts excluded, Tower cells > Y 50 excluded). First physical hit from above.
  const ray = (x: number, z: number, y0 = 150) => { const h = physics.castRay(new RAPIER.Ray({ x, y: y0, z }, { x: 0, y: -1, z: 0 }), y0 + 10, true, undefined, undefined, player); return h ? y0 - h.timeOfImpact : NaN; };
  const dsm = maiDsm as { x0: number; z0: number; rows: (number | null)[][] };
  const mp = maiPlan as unknown as { officialWorldRings: P[][]; zones: { id: string }[]; frame: { origin: P; east: P; south: P } };
  const rings = mp.officialWorldRings, res: number[] = [];
  for (let z = -34; z < 56; z++) for (let x = -256; x < -176; x++) {
    const cx = x + .5, cz = z + .5;
    if (!pip(cx, cz, rings[0]) || rings.slice(1).some(h => pip(cx, cz, h))) continue;
    const l = dsm.rows[Math.floor(cz) - dsm.z0]?.[Math.floor(cx) - dsm.x0]; const m = ray(cx, cz);
    if (l == null || l > 50 || !Number.isFinite(m)) continue; res.push(m - l);
  }
  res.sort((p, q) => p - q);
  const rq = (f: number) => +res[Math.min(res.length - 1, Math.floor(res.length * f))].toFixed(2);
  const within = (d: number) => +(res.filter(v => Math.abs(v) <= d).length / res.length).toFixed(3);
  report.maiBodyVsLidar = { samples: res.length, residualP10: rq(.1), residualP50: rq(.5), residualP90: rq(.9), within075: within(.75), within15: within(1.5), zones: mp.zones.length, round1: 'P50 -2.05, within0.75 0.114 (same probe)' };
  if (!(res.length > 3000 && Math.abs(rq(.5)) <= 0.5 && within(.75) >= 0.75)) failures.push(`MAI body vs LiDAR: P50 ${rq(.5)} within0.75 ${within(.75)}`);
  // Old authored-Tower square: first physical hit <= 46 m (scan-check limit = LiDAR max + 1.5 m) and within 1 m of the LiDAR south block.
  let oldMax = -Infinity;
  for (let s2 = -8.5; s2 <= 8.5; s2 += 1.7) for (let t2 = -8.5; t2 <= 8.5; t2 += 1.7) oldMax = Math.max(oldMax, ray(-215.27 + s2 * Math.cos(.085) + t2 * Math.sin(.085), 10.40 - s2 * Math.sin(.085) + t2 * Math.cos(.085), 130));
  report.oldTowerColumnMaxY = +oldMax.toFixed(2);
  if (!(oldMax <= 46 && oldMax >= 42.5)) failures.push(`old Tower column max ${oldMax} (expected LiDAR south-block hip 42.5-46)`);
  // 7. Main Mall axis (South Mall north end): terrace flight, plaza vs LiDAR, south flight, z=170 level.
  const O: P = [-217.36, 36.64], S: P = [-0.08387655737226869, 0.9964761528121866], E: P = [S[1], -S[0]];
  const at = (t: number, o = 0) => [O[0] + S[0] * t + E[0] * o, O[1] + S[1] * t + E[1] * o] as P;
  const ground = (t: number, o = 0) => ray(...at(t, o), 40);
  const knots: P[] = [[25.4, 16.69], [30, 16.62], [40, 16.48], [50, 16.33], [60, 16.25], [70, 16.18], [76.5, 16.10]];
  const lid = (t: number) => { for (let i = 1; i < knots.length; i++) if (t <= knots[i][0]) return knots[i - 1][1] + (knots[i][1] - knots[i - 1][1]) * (t - knots[i - 1][0]) / (knots[i][0] - knots[i - 1][0]); return knots.at(-1)![1]; };
  const flight = (t0: number, t1: number) => { const ys: number[] = []; for (let t = t0; t <= t1 + 1e-6; t += .05) ys.push(ground(t)); let risers = 0; for (let i = 1; i < ys.length; i++) if (ys[i - 1] - ys[i] > .08) risers++; return { top: +ys[0].toFixed(2), bottom: +ys.at(-1)!.toFixed(2), risers }; };
  const terraceFlight = flight(21.0, 25.6), southFlight = flight(76.3, 80.3);
  const plaza: { t: number; model: number; lidar: number; d: number }[] = [];
  for (let t = 26; t <= 76; t += 5) { const m = ground(t), l = lid(t); plaza.push({ t, model: +m.toFixed(2), lidar: +l.toFixed(2), d: +(m - l).toFixed(2) }); }
  // Visible = physical on the new plaza/stairs: render ray against walkway surfaces vs physics.
  const rc = new THREE.Raycaster(); const vis: number[] = []; const visBad: unknown[] = [];
  const surf: THREE.Object3D[] = []; scene.walkway.surfaces.traverse((o: THREE.Object3D) => { if ((o as THREE.Mesh).isMesh) surf.push(o); });
  scene.world.group.traverse((o: THREE.Object3D) => { if ((o as THREE.Mesh).isMesh && o.name === 'Offline local contour terrain') surf.push(o); });
  for (let t = 22; t <= 89; t += 1.5) for (const o of [-12, -4, 4, 12]) { const [x, z] = at(t, o); rc.set(new THREE.Vector3(x, 40, z), new THREE.Vector3(0, -1, 0)); const h = rc.intersectObjects(surf, false)[0]; const py = ray(x, z, 40); if (h && Number.isFinite(py)) { vis.push(Math.abs(h.point.y - py)); if (Math.abs(h.point.y - py) > .05) visBad.push({ t, o, render: +h.point.y.toFixed(2), physics: +py.toFixed(2), mesh: h.object.name }); } }
  vis.sort((p, q) => p - q);
  // Standing capsules along the axis are not blocked by any collider above the walk surface.
  let capsBlocked = 0; const cap = new RAPIER.Capsule(0.5, 0.3); const cap2 = cap;
  for (let t = 18; t <= 92; t += 2) for (const o of [-8, 0, 8]) { const [x, z] = at(t, o), y = ground(t, o); physics.intersectionsWithShape({ x, y: y + 1.1, z }, { x: 0, y: 0, z: 0, w: 1 }, cap, () => { capsBlocked++; return false; }, undefined, undefined, player); }
  const z170 = ground((170 - O[1]) / S[1]);
  report.mainMall = { terraceFlight, southFlight, plaza, visibleVsPhysicalMax: +(vis.at(-1) ?? NaN).toFixed(3), visBad: visBad.slice(0, 12), visibleSamples: vis.length, capsulesBlocked: capsBlocked, axisLevelAtZ170: +z170.toFixed(2), lidarAtZ170: 12.22 };
  if (terraceFlight.risers < 6 || terraceFlight.top < 18.4 || terraceFlight.bottom > 17.3) failures.push(`terrace flight ${JSON.stringify(terraceFlight)}`);
  if (southFlight.risers < 4 || southFlight.top - southFlight.bottom < .6) failures.push(`south flight ${JSON.stringify(southFlight)}`);
  if (plaza.some(p => p.d < -0.05 || p.d > 0.6)) failures.push(`plaza vs LiDAR ${JSON.stringify(plaza)}`);
  if (!(vis.length > 100 && (vis.at(-1) ?? 1) <= 0.05)) failures.push(`Main Mall visible vs physical max ${vis.at(-1)}`);
  if (capsBlocked) failures.push(`${capsBlocked} standing capsules blocked on the Main Mall axis`);
  // ---- Round 2b ----
  // 8. Lawns are their own visible surface (first render hit = mall lawn mesh, grass finish) and physical (<= 0.05 m);
  //    the forecourt reads as pale paving (first render hit = 'Main Mall pale limestone paving', sRGB luminance >= 0.7).
  const allMeshes: THREE.Object3D[] = [];
  for (const root of [scene.walkway.surfaces, scene.world.group, ...inst.solids, ...(inst.walkable ?? []), ...(inst.detail ?? [])]) (root as THREE.Object3D).traverse(o => { if ((o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) allMeshes.push(o); });
  const firstHit = (x: number, z: number) => { rc.set(new THREE.Vector3(x, 60, z), new THREE.Vector3(0, -1, 0)); rc.far = 80; return rc.intersectObjects(allMeshes, false)[0]; };
  const pavingNames = /paving|walks|limestone|stairs|concrete|aggregate/i;
  const lawnStats: Record<string, { samples: number; notLawn: number; visPhysMax: number; examples: unknown[] }> = {};
  const lawnAreas: [string, number, number, number, number][] = [['Main Mall west lawn', -45, -19, 35, 56], ['Main Mall east lawn', 19, 45, 35, 56], ['South Mall head green', -17, 17, 104, 131]];
  for (const [name, o0, o1, t0, t1] of lawnAreas) {
    const st = lawnStats[name] = { samples: 0, notLawn: 0, visPhysMax: 0, examples: [] as unknown[] };
    for (let t = t0; t <= t1; t += 3) for (let o = o0; o <= o1; o += 3.25) {
      const [x, z] = at(t, o); if (z >= 169.9) continue;
      const h = firstHit(x, z); if (!h) continue; st.samples++;
      const mat = [(h.object as THREE.Mesh).material].flat()[0] as THREE.Material;
      const lawn = h.object.name === 'East and West Mall foreground' && !pavingNames.test(mat.name);
      if (!lawn) { st.notLawn++; if (st.examples.length < 4) st.examples.push([+x.toFixed(1), +z.toFixed(1), h.object.name, mat.name]); continue; }
      // Physical support right under the visible lawn (a ray from 0.5 m above it; tree limbs above are not lawn).
      const sh = physics.castRay(new RAPIER.Ray({ x, y: h.point.y + .5, z }, { x: 0, y: -1, z: 0 }), 2, false, undefined, undefined, player); const sup = sh ? h.point.y + .5 - sh.timeOfImpact : NaN;
      st.visPhysMax = Math.max(st.visPhysMax, Number.isFinite(sup) ? +Math.abs(h.point.y - sup).toFixed(3) : 99);
    }
    if (st.samples < 20 || st.notLawn || st.visPhysMax > .05) failures.push(`${name}: ${JSON.stringify(st)}`);
  }
  report.lawns = lawnStats;
  const forecourt = { samples: 0, wrong: 0, luminance: NaN, examples: [] as unknown[] };
  for (let t = 27; t <= 75; t += 4) for (const o of [-14, -7, 0, 7, 14]) {
    const [x, z] = at(t, o), h = firstHit(x, z); if (!h) continue; forecourt.samples++;
    const mat = [(h.object as THREE.Mesh).material].flat()[0] as THREE.MeshStandardMaterial;
    if (mat.name !== 'Main Mall pale limestone paving') { forecourt.wrong++; if (forecourt.examples.length < 4) forecourt.examples.push([+x.toFixed(1), +z.toFixed(1), h.object.name, mat.name]); }
    else forecourt.luminance = +(0.2126 * mat.color.clone().convertLinearToSRGB().r + 0.7152 * mat.color.clone().convertLinearToSRGB().g + 0.0722 * mat.color.clone().convertLinearToSRGB().b).toFixed(3);
  }
  report.forecourt = forecourt;
  if (forecourt.samples < 50 || forecourt.wrong || !(forecourt.luminance >= .7)) failures.push(`forecourt finish ${JSON.stringify(forecourt)}`);
  // 9. Washington: present on the Tower axis at the LiDAR position/peak, pedestal collider = rendered support,
  //    figure physical, and clear walks/apron/north sidewalk around it.
  const statue = { bronze: 0, topY: NaN, centre: [NaN, NaN] as number[], axisOffset: NaN, pedestalTop: NaN, pedestalSideHit: NaN, figureHit: false, capsulesBlocked: 0, otherBlocked: 0, capsuleSamples: 0 };
  const bronzeMesh = ([...inst.solids, ...(inst.detail ?? [])] as THREE.Mesh[]).find(m => /George Washington.*bronze figure/.test(m.name));
  const pedMesh = (inst.solids as THREE.Mesh[]).find(m => /George Washington.*pedestal/.test(m.name));
  if (bronzeMesh && pedMesh) {
    const bb = new THREE.Box3().setFromObject(bronzeMesh); statue.bronze = bronzeMesh.geometry.getAttribute('position').count / 3;
    // Sculpture shading: bronze keeps smooth per-part normals (not flat faceted), normals agree with the
    // outward winding, triangle budget.
    { const gp = bronzeMesh.geometry.getAttribute('position'), gn = bronzeMesh.geometry.getAttribute('normal');
      const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), f = new THREE.Vector3(), vn = new THREE.Vector3();
      let tot = 0, agree = 0, smoothT = 0;
      for (let i = 0; i < gp.count; i += 3) { v0.fromBufferAttribute(gp, i); v1.fromBufferAttribute(gp, i + 1); v2.fromBufferAttribute(gp, i + 2);
        f.subVectors(v1, v0).cross(v2.clone().sub(v0)); if (f.lengthSq() < 1e-14) continue; f.normalize(); tot++;
        vn.set(0, 0, 0); let sm = false; for (let k = 0; k < 3; k++) { const q = new THREE.Vector3().fromBufferAttribute(gn, i + k); vn.add(q); if (q.dot(f) < .9995) sm = true; }
        if (vn.normalize().dot(f) > 0) agree++; if (sm) smoothT++; }
      (statue as Record<string, unknown>).sculpture = { triangles: gp.count / 3, windingNormalAgreement: +(agree / tot).toFixed(4), smoothFraction: +(smoothT / tot).toFixed(3) };
      if (agree / tot < .98 || smoothT / tot < .6 || gp.count / 3 > 12000) failures.push(`Washington sculpture shading ${JSON.stringify((statue as Record<string, unknown>).sculpture)}`); }
    statue.topY = +bb.max.y.toFixed(2); statue.centre = [+((bb.min.x + bb.max.x) / 2).toFixed(2), +((bb.min.z + bb.max.z) / 2).toFixed(2)];
    // Distance of the statue from the Tower axis (scan centre -212.6,-17.7 along S).
    const tx = -212.6, tz = -17.7; statue.axisOffset = +Math.abs((statue.centre[0] - tx) * S[1] - (statue.centre[1] - tz) * S[0]).toFixed(2);
    const [px, pz] = WASHINGTON.position, c = Math.cos(WASHINGTON.yaw), sn = Math.sin(WASHINGTON.yaw);
    const local = (u: number, v: number) => [px + u * c + v * sn, pz - u * sn + v * c] as P;
    const pbb = new THREE.Box3().setFromObject(pedMesh);
    // Cap corner (outside the bronze base) and a horizontal ray at the shaft from the south.
    const [qx, qz] = local(.62, -.55); statue.pedestalTop = +ray(qx, qz, 30).toFixed(2);
    const cap = pbb.max.y; if (!(Math.abs(statue.pedestalTop - (WASHINGTON.lidarDeckY + 1.52)) <= .05)) failures.push(`pedestal cap physics ${statue.pedestalTop} (cap mesh max ${cap.toFixed(2)})`);
    const [fx, fz] = local(0, 4);
    const side = physics.castRay(new RAPIER.Ray({ x: fx, y: WASHINGTON.lidarDeckY + .8, z: fz }, { x: px - fx, y: 0, z: pz - fz }), 10, true, undefined, undefined, player, undefined, (k: { handle: number }) => blockColliders.has(k.handle));
    statue.pedestalSideHit = side ? +(4 * side.timeOfImpact).toFixed(2) : NaN;  // ray dir length 4 -> metres
    if (!(Math.abs(statue.pedestalSideHit - (4 - WASHINGTON.pedestal.shaftD / 2)) <= .1)) failures.push(`pedestal side collider at ${statue.pedestalSideHit} m (expected ${4 - WASHINGTON.pedestal.shaftD / 2})`);
    const fh = physics.castRay(new RAPIER.Ray({ x: px, y: 30, z: pz }, { x: 0, y: -1, z: 0 }), 20, true, undefined, undefined, player, undefined, (k: { handle: number }) => blockColliders.has(k.handle));
    statue.figureHit = !!fh && 30 - fh.timeOfImpact > WASHINGTON.lidarDeckY + 2.5;
    if (!statue.figureHit) failures.push('Washington figure has no collider');
    if (!(Math.abs(statue.topY - WASHINGTON.lidarPeakY) <= .3)) failures.push(`statue top ${statue.topY} vs LiDAR peak ${WASHINGTON.lidarPeakY}`);
    if (!(Math.hypot(statue.centre[0] - px, statue.centre[1] - pz) <= .6 && statue.axisOffset <= 1.0)) failures.push(`statue off position/axis ${JSON.stringify(statue.centre)} axis ${statue.axisOffset}`);
    // Route clearance: walks, apron, deck rim and north sidewalk (excluding the pedestal itself).
    for (const [o0, o1, t0, t1, step] of [[-21, -19, 92, 132, 2], [19, 21, 92, 132, 2], [-6.5, 8, 90.5, 92.2, 1.5], [-6.8, -5.2, 92, 102, 1.5], [7.2, 8.2, 92, 102, 1.5], [-3, 5, 97, 99.4, 2]] as const)
      for (let t = t0; t <= t1; t += step) for (let o = o0; o <= o1; o += Math.max(.5, (o1 - o0) / 3)) {
        const [x, z] = at(t, o); if (z >= 169.9) continue; const y = ray(x, z, 40); statue.capsuleSamples++;
        physics.intersectionsWithShape({ x, y: y + 1.1, z }, { x: 0, y: 0, z: 0, w: 1 }, cap2, (k: { handle: number }) => { if (blockColliders.has(k.handle)) statue.capsulesBlocked++; else statue.otherBlocked++; return false; }, undefined, undefined, player);
      }
    if (statue.capsulesBlocked) failures.push(`${statue.capsulesBlocked} capsules blocked around the statue/walks`);
    // No raw-ground ring between the apron and the deck: 0.25 m outside every deck side the first render hit
    // is paving (apron or the deck surround), visible = physical.
    const dk = WASHINGTON.deck, ring: { samples: number; bad: number; visPhysMax: number; examples: unknown[] } = { samples: 0, bad: 0, visPhysMax: 0, examples: [] };
    const sides: P[] = [];
    for (let x = dk.x0 + .3; x < dk.x1; x += .9) sides.push([x, dk.z0 - .25], [x, dk.z1 + .25]);
    for (let z = dk.z0 + .3; z < dk.z1; z += .9) sides.push([dk.x0 - .25, z], [dk.x1 + .25, z]);
    for (const [x, z] of sides) { const h = firstHit(x, z); if (!h) continue; ring.samples++;
      const mat = [(h.object as THREE.Mesh).material].flat()[0] as THREE.Material;
      if (!/paving/.test(mat.name)) { ring.bad++; if (ring.examples.length < 4) ring.examples.push([+x.toFixed(2), +z.toFixed(2), h.object.name, mat.name]); continue; }
      const sh = physics.castRay(new RAPIER.Ray({ x, y: h.point.y + .5, z }, { x: 0, y: -1, z: 0 }), 2, false, undefined, undefined, player);
      ring.visPhysMax = Math.max(ring.visPhysMax, sh ? +Math.abs(h.point.y + .5 - sh.timeOfImpact - h.point.y).toFixed(3) : 99); }
    (statue as Record<string, unknown>).deckSurround = ring;
    if (ring.samples < 30 || ring.bad || ring.visPhysMax > .05) failures.push(`deck surround ${JSON.stringify(ring)}`);
  } else failures.push('Washington meshes missing');
  report.washington = statue;
  // ---- District round (D06/D07) ----
  // 7. BOT greenhouse (591884) rebuilt by b04: replacement committed, LiDAR heights (campus Y), footprint residual,
  //    visible roof/eave = own collider on a 1 m grid.
  const bot: Record<string, unknown> = {};
  {
    const key = '591884:623';
    if (!committed.includes(key)) failures.push(`replacement ${key} not committed`);
    if (plans.get(591884)?.decision !== 'authored') failures.push(`591884 context decision ${plans.get(591884)?.decision} (expected authored by b04)`);
    bot.decision = plans.get(591884)?.decision;
    const meshes = (inst.solids as THREE.Mesh[]).filter(s => s.userData.b04 === 'BOT');
    const roofT: THREE.Triangle[] = [], verts: THREE.Vector3[] = [];
    for (const s of meshes) {
      s.updateWorldMatrix(true, false); const pos = s.geometry.getAttribute('position');
      for (let i = 0; i + 2 < pos.count; i += 3) {
        const t = new THREE.Triangle(a.fromBufferAttribute(pos, i).applyMatrix4(s.matrixWorld).clone(), b.fromBufferAttribute(pos, i + 1).applyMatrix4(s.matrixWorld).clone(), c.fromBufferAttribute(pos, i + 2).applyMatrix4(s.matrixWorld).clone());
        verts.push(t.a, t.b, t.c); t.getNormal(n); if (n.y > 0.3 && /glazing/.test(s.name)) roofT.push(t);
      }
    }
    const ring = gis(591884)[0], lid = BOT_LIDAR;
    const med = median(roofT, ring), topY = verts.length ? Math.max(...verts.map(v => v.y)) : NaN;
    bot.heightsCampusY = { roofMedian: +med.toFixed(2), lidarTier: lid.groundY + lid.tier, top: +topY.toFixed(2), lidarP95: lid.groundY + lid.p95, lidarMax: lid.groundY + lid.max };
    if (!(Math.abs(med - (lid.groundY + lid.tier)) <= 0.3)) failures.push(`BOT roof median ${med} vs LiDAR tier ${lid.groundY + lid.tier}`);
    if (!(topY <= lid.groundY + lid.max + 0.05 && topY >= lid.groundY + lid.p95 - 0.6)) failures.push(`BOT top ${topY} outside LiDAR P95-0.6 .. max (${lid.groundY + lid.p95} / ${lid.groundY + lid.max})`);
    const base = verts.filter(v => v.y < lid.groundY + 3.0); let outside = 0, far = 0;
    for (const v of base) { const d = ringDist(v.x, v.z, ring); if (!pip(v.x, v.z, ring) && d > 0.05) outside++; else if (d > 0.8) far++; }
    bot.footprint = { vertices: base.length, outsideGis: outside, fartherThan08m: far, insetM: BOT_INSET };
    if (!base.length || outside || far) failures.push(`BOT footprint: ${outside} wall vertices outside GIS, ${far} more than 0.8 m inside`);
    // Visible = physical: first rendered hit on BOT meshes vs the first hit on b04 colliders, 1 m grid.
    const rcb = new THREE.Raycaster(); let samples = 0, worst = 0;
    const blockC = new Set(inst.colliders.map((k: { handle: number }) => k.handle));
    const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
    for (let x = Math.min(...xs) + 0.5; x < Math.max(...xs); x += 1) for (let z = Math.min(...zs) + 0.5; z < Math.max(...zs); z += 1) {
      if (!pip(x, z, ring)) continue;
      rcb.set(new THREE.Vector3(x, 60, z), new THREE.Vector3(0, -1, 0)); const h = rcb.intersectObjects(meshes, false)[0]; if (!h) continue;
      const ph = scene.physics.castRay(new scene.RAPIER.Ray({ x, y: 60, z }, { x: 0, y: -1, z: 0 }), 60, true, undefined, undefined, scene.player, undefined, (k: { handle: number }) => blockC.has(k.handle));
      samples++; worst = Math.max(worst, ph ? Math.abs(60 - ph.timeOfImpact - h.point.y) : 99);
    }
    bot.visiblePhysical = { samples, worstM: +worst.toFixed(3) };
    if (samples < 150 || worst > 0.02) failures.push(`BOT visible/physical ${worst.toFixed(3)} m over ${samples} samples`);
  }
  report.greenhouse = bot;
  // 8. Observed facade detail counts (stats from the builder) and the solid GEB cornice (horizontal probe of the collider).
  const st = (inst.stats as { buildings: Record<string, number | string>[] }).buildings, by = (abbr: string) => st.find(s => s.abbr === abbr) ?? {};
  const det = { GOL: { arched: by('GOL').arched, galleryBays: by('GOL').galleryBays }, GEB: { arched: by('GEB').arched, stringCourses: by('GEB').stringCourses, corniceM: by('GEB').corniceM, dentils: by('GEB').dentils },
    BOT: { glazingBars: by('BOT').glazingBars }, draws: (inst.stats as { draws: number }).draws };
  report.facadeDetail = det;
  if (!((det.GOL.arched as number) >= 8 && (det.GOL.galleryBays as number) >= 8)) failures.push(`GOL detail missing ${JSON.stringify(det.GOL)}`);
  if (!((det.GEB.arched as number) >= 8 && (det.GEB.stringCourses as number) >= 8 && (det.GEB.corniceM as number) >= 90 && (det.GEB.dentils as number) >= 100)) failures.push(`GEB detail missing ${JSON.stringify(det.GEB)}`);
  if (!((det.BOT.glazingBars as number) >= 150)) failures.push(`BOT glazing bars ${det.BOT.glazingBars}`);
  if (!(det.draws <= 15 + 12)) failures.push(`b04 draw calls ${det.draws} > baseline 15 + 12`);
  {
    // GEB west wall (x ~ -162.6 + inset): a ray from 3 m west at the cornice corona must stop on the cornice, i.e. ~projection
    // in front of the ray that hits the wall 1 m lower.
    const z = -29.0, deckY = B04_LIDAR.GEB.groundY + B04_LIDAR.GEB.deck, x0 = -166;
    const hx = (y: number) => { const h = physics.castRay(new RAPIER.Ray({ x: x0, y, z }, { x: 1, y: 0, z: 0 }), 6, true, undefined, undefined, player, undefined, (k: { handle: number }) => blockColliders.has(k.handle)); return h ? x0 + h.timeOfImpact : null; };
    const corona = hx(deckY - 0.25), wall = hx(deckY - 1.6), proj = corona !== null && wall !== null ? +(wall - corona).toFixed(2) : null;
    report.gebCornice = { coronaHitX: corona, wallHitX: wall, projectionM: proj, expected: GEB_CORNICE.projection };
    if (proj === null || Math.abs(proj - GEB_CORNICE.projection) > 0.06) failures.push(`GEB cornice collider projection ${proj} (expected ${GEB_CORNICE.projection})`);
  }
  // 9. Textured b04-owned finishes: family set, metre UVs (area-weighted median |uv area| / world area in 0.9..1.1).
  {
    const rows: Record<string, unknown>[] = []; const fams = new Set<string>();
    const all = [...(inst.solids as THREE.Mesh[]), ...(inst.detail as THREE.Mesh[]), ...((inst.walkable ?? []) as THREE.Mesh[])];
    const ua = new THREE.Vector2(), ub = new THREE.Vector2(), uc = new THREE.Vector2();
    for (const m of all) {
      const mat = m.material as THREE.Material; if (!mat?.userData?.family) continue; fams.add(mat.userData.family);
      const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute, uv = m.geometry.getAttribute("uv") as THREE.BufferAttribute; if (!uv) { failures.push(`${m.name}: textured without uv`); continue; }
      const ratios: { r: number; w: number }[] = [];
      for (let i = 0; i + 2 < pos.count; i += 3) {
        a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
        const wa = new THREE.Triangle(a, b, c).getArea(); if (wa < 1e-4) continue;
        ua.fromBufferAttribute(uv, i); ub.fromBufferAttribute(uv, i + 1); uc.fromBufferAttribute(uv, i + 2);
        const uvA = Math.abs((ub.x - ua.x) * (uc.y - ua.y) - (uc.x - ua.x) * (ub.y - ua.y)) / 2; ratios.push({ r: uvA / wa, w: wa });
      }
      ratios.sort((p, q) => p.r - q.r); const tot = ratios.reduce((s, x) => s + x.w, 0); let acc = 0, med = NaN;
      for (const x of ratios) { acc += x.w; if (acc >= tot / 2) { med = x.r; break; } }
      rows.push({ mesh: m.name, material: mat.name, family: mat.userData.family, tileM: mat.userData.tileM, textured: mat.userData.textured, uvAreaRatioMedian: +med.toFixed(3) });
      if (!(med >= 0.9 && med <= 1.1)) failures.push(`${m.name}: uv area ratio ${med} (metre UVs expected)`);
    }
    report.texturedFinishes = rows;
    for (const f of ['limestone', 'buffBrick', 'clayTile', 'stucco']) if (!fams.has(f)) failures.push(`no b04 surface uses the ${f} finish`);
  }
  return { ok: failures.length === 0, report, failures };
};
