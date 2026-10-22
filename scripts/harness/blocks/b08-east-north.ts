// Headless checks owned by block b08-east-north (run by scripts/harness/run-block-checks.mjs).
// They measure the REAL scene in campus Y (downward rays on the physical colliders) against the 2017 USGS 3DEP 0.5 m
// building raster sampled inside the same rings (lib/campus/blocks/b08-east-north/lidar-reference.json, written by
// research/whole-campus-92/b08-east-north/derived/make_context.py):
//  1. Every b08 record restated in the LiDAR groundY datum: physical roof P50 within 2 m of the LiDAR P50 and roof P95
//     inside the measured upper band [LiDAR P90 - 2, LiDAR max + 0.6]; context decision `generated` for all records.
//  2. Law School split (City 568728 = TNH + JON + CCJ) and St. David's split (City 593681 = hospital + garage + Austin
//     Lakes): corrected/added footprints equal the official/OSM-derived rings; per-tier roof P50 vs LiDAR; hipped red-tile
//     blocks (TNH 1952 block, CCJ): ridge near the LiDAR max and a real slope (eave-band samples lower than the ridge).
//  3. Added official UT records (HS1/HS2/HS4) drawn at their raster roof.
//  4. Post-2017 484774 (no 2017 returns): top vs City 2023 h 20.0 m above grade.
// East-south lane: records the lane replaces (B08_REPLACED: SJG, JON, TS1, St. David's hospital and both garages) must be
// decision 'authored' instead of 'generated' and are held to the SAME roof P50/P95 and wing assertions on their physical
// replacement. Section 5 checks the lane install: replacements committed, every lane mesh coverage-exempt, textured meshes
// on explicit PBR families with the calibrated metre repeat and world-metre UVs, untextured glass/steel, and horizontal-ray
// family probes (hospital brick, SJG garage precast, JON precast, CCJ limestone relief on its still-generated body, 613563:735
// brick slot facade per the d16 source pixels).
import type { BlockCheck } from './types';
import * as THREE from 'three';
import { TEXTURES } from '../../../lib/campus/context/materials';
import { B08_REPLACED } from '../../../lib/campus/blocks/b08-east-north/index';
import ref from '../../../lib/campus/blocks/b08-east-north/lidar-reference.json' with { type: 'json' };

type P = [number, number];
const pip = (x: number, z: number, r: P[]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const inRings = (x: number, z: number, rs: P[][]) => pip(x, z, rs[0]) && !rs.slice(1).some(h => pip(x, z, h));
const segDist = (px: number, pz: number, a: P, b: P) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l)) : 0; return Math.hypot(a[0] + t * dx - px, a[1] + t * dz - pz); };
const ringsDist = (x: number, z: number, rs: P[][]) => Math.min(...rs.flatMap(r => r.map((p, i) => segDist(x, z, p, r[(i + 1) % r.length]))));
const q = (v: number[], f: number) => v.length ? +v[Math.min(v.length - 1, Math.floor(v.length * f))].toFixed(2) : NaN;
type Stat = { roofY_P10: number; roofY_P50: number; roofY_P90: number; roofY_P95: number; roofY_max: number };
const R = ref as unknown as {
  records: Record<string, Stat & { abbr: string | null; restated?: boolean; exempt?: string; p50Only?: string; officialRing?: P[] }>;
  volumes: Record<string, Stat & { ring: P[]; roof: string; targetY: number; eaveY?: number }>;
  officialTop: Record<string, { targetTopAboveGrade?: number }>;
};

export const check: BlockCheck = scene => {
  const failures: string[] = [], report: Record<string, unknown> = {};
  const { physics, RAPIER, player } = scene;
  const data = scene.world.data;
  const plans = new Map<string, { decision: string; building: { id: number; key?: string; rings: P[][] } }>(
    scene.plans.map((p: { building: { id: number; key?: string } }) => [p.building.key ?? String(p.building.id), p]));
  const ray = (x: number, z: number) => { const h = physics.castRay(new RAPIER.Ray({ x, y: 160, z }, { x: 0, y: -1, z: 0 }), 220, true, undefined, undefined, player); return h ? 160 - h.timeOfImpact : NaN; };
  const surface = (rings: P[][], inset: number, step = 1.5) => {
    const xs = rings[0].map(p => p[0]), zs = rings[0].map(p => p[1]), tops: number[] = [];
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) {
      if (!inRings(x, z, rings) || ringsDist(x, z, rings) < inset) continue;
      const y = ray(x, z); if (!Number.isNaN(y)) tops.push(y);
    }
    return tops.sort((a, b) => a - b);
  };
  const terrain = (x: number, z: number) => scene.world.terrain?.height ? scene.world.terrain.height(x, z) : NaN;
  // 1 + 2 + 3. Records (incl. the corrected TNH/hospital footprints and the added records).
  const records: Record<string, unknown> = {};
  let checkedN = 0, okN = 0; const absP50: number[] = [];
  for (const [key, r] of Object.entries(R.records)) {
    const p = plans.get(key); const b = data.buildings.find((x: { key?: string }) => x.key === key) ?? p?.building;
    const decision = p?.decision ?? 'missing';
    const entry: Record<string, unknown> = { abbr: r.abbr, decision };
    const expected = (B08_REPLACED as readonly string[]).includes(key) ? 'authored' : 'generated';
    if (decision !== expected) failures.push(`${key} ${r.abbr ?? ''} decision ${decision} (expected ${expected})`);
    if (b && r.roofY_P50 !== undefined && r.roofY_P50 !== null) {
      const tops = surface(b.rings as P[][], 1.0);
      const tol = 2.0, p50 = q(tops, 0.5), p95 = q(tops, 0.95);
      Object.assign(entry, { samples: tops.length, modelP50: p50, lidarP50: r.roofY_P50, modelP95: p95, lidarP90: r.roofY_P90, lidarP95: r.roofY_P95, lidarMax: r.roofY_max,
        residual: { p50: +(p50 - r.roofY_P50).toFixed(2), p95: +(p95 - r.roofY_P95).toFixed(2) } });
      const upperOk = r.p50Only ? true : p95 >= r.roofY_P90 - tol && p95 <= r.roofY_max + 0.6;
      if (r.p50Only) entry.p50Only = r.p50Only;
      const checked = r.restated !== false && !r.exempt;
      entry.checked = checked; if (r.exempt) entry.exempt = r.exempt;
      if (checked && decision === expected) {
        checkedN++; absP50.push(Math.abs(p50 - r.roofY_P50));
        if (Math.abs(p50 - r.roofY_P50) <= tol && upperOk) okN++;
        else failures.push(`${key} ${r.abbr ?? ''} roof P50/P95 ${p50}/${p95} vs LiDAR P50 ${r.roofY_P50}, band P90 ${r.roofY_P90}..max ${r.roofY_max} (campus Y, tol ${tol})`);
      }
    }
    if (r.officialRing) {
      const same = !!b && b.rings[0].length === r.officialRing.length && (b.rings[0] as P[]).every((pt: P, i: number) => Math.hypot(pt[0] - r.officialRing![i][0], pt[1] - r.officialRing![i][1]) < 0.01);
      entry.correctedFootprint = same;
      if (!same) failures.push(`${key} ${r.abbr}: footprint is not the corrected (official/OSM-split) ring`);
    }
    records[key] = entry;
  }
  absP50.sort((a, b) => a - b);
  report.summary = { records: Object.keys(records).length, checked: checkedN, withinTolerance: okN, medianAbsP50: q(absP50, 0.5), maxAbsP50: absP50.length ? +absP50[absP50.length - 1].toFixed(2) : NaN };
  report.records = records;
  // 2. Wings / tiers / hips.
  const wings: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(R.volumes)) {
    const tops = surface([v.ring], 1.0, 1.0);
    const p50 = q(tops, 0.5), p10 = q(tops, 0.1), top = tops.length ? +tops[tops.length - 1].toFixed(2) : NaN;
    const hip = v.roof !== 'flat', tol = hip ? 2.0 : 1.5;
    wings[k] = { roof: v.roof, samples: tops.length, modelP10: p10, modelP50: p50, lidarP50: v.roofY_P50, targetY: v.targetY, modelTop: top, lidarMax: v.roofY_max, residualP50: +(p50 - v.roofY_P50).toFixed(2) };
    if (tops.length < 4) { failures.push(`${k}: only ${tops.length} roof samples`); continue; }
    if (!(Math.abs(p50 - v.roofY_P50) <= tol)) failures.push(`${k} roof P50 ${p50} vs LiDAR ${v.roofY_P50} (tol ${tol})`);
    if (!(top <= v.roofY_max + 1.2)) failures.push(`${k} top ${top} above LiDAR max ${v.roofY_max} + 1.2 (parapet)`);
    if (hip) {
      if (!(Math.abs(top - v.targetY) <= 1.0)) failures.push(`${k} hip ridge ${top} vs target ${v.targetY}`);
      if (!(top - p10 >= 2.0)) failures.push(`${k} hip has no real slope (top ${top}, P10 ${p10})`);
    }
  }
  report.wings = wings;
  // 4. Post-2017 484774: top above grade vs City 2023 h.
  const post: Record<string, unknown> = {};
  for (const [key, t] of Object.entries(R.officialTop)) {
    const b = data.buildings.find((x: { key?: string }) => x.key === key) as { rings: P[][] } | undefined;
    if (!b || t.targetTopAboveGrade === undefined) { failures.push(`${key}: post-2017 record missing`); continue; }
    const tops = surface(b.rings, 1.5, 2.0); const g: number[] = b.rings[0].map(p => terrain(p[0], p[1])).sort((a, c) => a - c);
    const grade = q(g, 0.5), p50 = q(tops, 0.5);
    post[key] = { grade, deckAboveGrade: +(p50 - grade).toFixed(2), target: t.targetTopAboveGrade };
    if (!(Math.abs(p50 - grade - t.targetTopAboveGrade) <= 1.5)) failures.push(`${key} deck ${(p50 - grade).toFixed(2)} m above grade vs ${t.targetTopAboveGrade}`);
  }
  report.post2017 = post;
  // 5. East-south lane install.
  const committed = Object.entries(scene.blocks.replacements.committed).filter(([, o]) => o === 'b08-east-north').map(([k]) => k);
  for (const k of B08_REPLACED) if (!committed.includes(k)) failures.push(`lane replacement ${k} not committed`);
  const entry = scene.blocks.installs.find((x: { id: string }) => x.id === 'b08-east-north');
  type Mm = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const lane: Mm[] = [];
  for (const root of [...(entry?.install.solids ?? []), ...(entry?.install.walkable ?? []), ...(entry?.install.detail ?? [])] as THREE.Object3D[])
    root.traverse(o => { const m = o as Mm; if (m.isMesh) lane.push(m); });
  if (!lane.length) failures.push('b08 lane install has no meshes');
  if (lane.some(m => m.userData.localContext !== true)) failures.push('b08 lane mesh not coverage-exempt (would reclassify neighbouring generated buildings)');
  const surf: Record<string, unknown> = {};
  for (const m of lane) {
    const fam = m.material.userData.pbrFamily as keyof typeof TEXTURES | undefined, map = m.material.map;
    if (!fam) { if (map) failures.push(`${m.name}: map without an explicit PBR family`); continue; }
    const tile = TEXTURES[fam].tile;
    if (!map || Math.abs(map.repeat.x - 1 / tile) > 1e-6 || Math.abs(map.repeat.y - 1 / tile) > 1e-6) failures.push(`${m.name}: ${fam} repeat != 1/${tile}`);
    const pos = m.geometry.getAttribute('position'), uv = m.geometry.getAttribute('uv'), stride = Math.max(1, Math.floor(pos.count / 3 / 400)), ratios: number[] = [];
    for (let t = 0; t < pos.count / 3; t += stride) for (const [i, j] of [[0, 1], [1, 2]]) {
      const a = t * 3 + i, b = t * 3 + j, d3 = Math.hypot(pos.getX(a) - pos.getX(b), pos.getY(a) - pos.getY(b), pos.getZ(a) - pos.getZ(b));
      if (d3 >= 0.3) ratios.push(Math.hypot(uv.getX(a) - uv.getX(b), uv.getY(a) - uv.getY(b)) / d3);
    }
    ratios.sort((a, b) => a - b);
    const med = ratios.length ? ratios[Math.floor(ratios.length / 2)] : NaN, bad = ratios.filter(r => r < 0.5 || r > 1.6).length;
    surf[m.name] = { family: fam, tileMetres: tile, uvSamples: ratios.length, medianUvPerMetre: +med.toFixed(3), outside05to16: bad };
    if (!(med >= 0.85 && med <= 1.15) || bad > ratios.length * 0.05) failures.push(`${m.name}: UV scale median ${med.toFixed(3)}, ${bad}/${ratios.length} outside [0.5, 1.6]`);
  }
  const famAt = (x: number, y: number, z: number, dx: number, dz: number) => {
    const h = new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(dx, 0, dz).normalize(), 0, 20).intersectObjects(lane, false)[0];
    return h ? ((h.object as Mm).material.userData.pbrFamily as string | undefined) ?? 'untextured' : null;
  };
  // Probes from 3 m outside the midpoint of each record's longest edge, horizontally inward ('a|b' = either: a brick spandrel
  // or ribbon glazing / deck opening at that height).
  const probe = (key: string, dy: (g: number) => number) => {
    const b = data.buildings.find((x: { key?: string }) => x.key === key) as { rings: P[][] } | undefined; if (!b) return 'missing';
    const r = b.rings[0], others = (data.buildings as { key?: string; rings: P[][] }[]).filter(x => x.key !== key);
    const order = r.map((_, i) => i).sort((i, j) => Math.hypot(r[(j + 1) % r.length][0] - r[j][0], r[(j + 1) % r.length][1] - r[j][1]) - Math.hypot(r[(i + 1) % r.length][0] - r[i][0], r[(i + 1) % r.length][1] - r[i][1]));
    for (const bi of order) {   // longest edge whose outside (3 m) is open ground, not another building
      const a = r[bi], c = r[(bi + 1) % r.length], bl = Math.hypot(c[0] - a[0], c[1] - a[1]), mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2, tx = (c[0] - a[0]) / bl, tz = (c[1] - a[1]) / bl;
      let nx = tz, nz = -tx; if (pip(mx + nx * 0.5, mz + nz * 0.5, r)) { nx = -nx; nz = -nz; }
      const ox = mx + nx * 3, oz = mz + nz * 3;
      if (others.some(o => pip(ox, oz, o.rings[0]) || pip(mx + nx * 0.5, mz + nz * 0.5, o.rings[0]))) continue;
      return famAt(ox, dy(terrain(ox, oz)), oz, -nx, -nz);
    }
    return 'no-open-edge';
  };
  const ccjTop = 4.7 + 10.9;
  const probes: Record<string, [string | null, string]> = {
    hospital: [probe('593681:655', g => g + 1.0), 'brownBrick|untextured'], sjg: [probe('655726:905', g => g + 2), 'precast|untextured'],
    jon: [probe('-801:add', g => g + 9), 'precast|untextured'], ccjCornice: [probe('-802:add', () => ccjTop - 0.3), 'limestone'],
    // 613563:735 (revision 2): the source pixels show a brick slot facade, not an open precast deck: brick pier or teal slot glass.
    garage1Slots: [probe('613563:735', g => g + 4), 'brownBrick|untextured'],
    garage1BrickBand: [probe('613563:735', () => 25.0), 'brownBrick'],   // brick band between slot heads (Y 23.6) and coping
  };
  for (const [k, [got, want]] of Object.entries(probes)) if (!want.split('|').includes(got ?? '')) failures.push(`surface probe ${k}: ${got} (expected ${want})`);
  const st = scene.blocks.stats['b08-east-north'] as { triangles?: number; districts?: unknown } | undefined;
  if (!st || (st.triangles ?? 0) > 120000) failures.push(`b08 lane triangles ${st?.triangles} (budget 120000)`);
  report.lane = { committed, districts: st?.districts, triangles: st?.triangles, surfaces: surf, probes: Object.fromEntries(Object.entries(probes).map(([k, [g]]) => [k, g])) };
  return { ok: failures.length === 0, report, failures };
};
