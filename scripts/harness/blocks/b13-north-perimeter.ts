// Headless checks owned by block b13-north-perimeter, WEST half (units b13-r0-a1..f2; the east half g..j is a separate lane).
// They measure the REAL scene in campus Y (downward rays on the physical colliders) against the 2017 USGS 3DEP 0.5 m
// building raster sampled inside the same rings (lib/campus/blocks/b13-north-perimeter/lidar-reference.json, written by
// research/whole-campus-92/b13-north-perimeter/derived/make_context.py):
//  1. Every west record restated in the LiDAR groundY datum: physical roof P50 within 2 m of the LiDAR P50 and roof P95
//     inside the measured upper band [LiDAR P90 - 2, LiDAR max + 0.6]; context decision `generated`; per-unit tallies.
//  2. Splits: City 588195 = SWG garage + ASE (official UT polygons), City 465064 = apartment wrap + parking garage (OSM):
//     corrected/added footprints equal the derived rings; per-tier roof P50 vs LiDAR; hip ridges near target with a real slope.
//  3. Whitis Court LLA-LLF (demolished for UT CP1003754): records gone from the data and reported excluded; the added
//     under-construction hall (-1391, official Z20 footprint with court) is drawn and its court is open to the ground.
//  4. Post-2017 records (no / partial 2017 returns): deck above grade vs the City 2023 h (or the 7-floor estimate).
//  5. District wave D29-D33: records in context.json `replaces` must be 'authored' AND committed by this block; the
//     roof P50/P95 LiDAR gates of 1-2 apply to them unchanged (b13-authored.ts adds relief / courtyard / material checks).
import type { BlockCheck } from './types';
import ref from '../../../lib/campus/blocks/b13-north-perimeter/lidar-reference.json' with { type: 'json' };
import b13Context from '../../../lib/campus/blocks/b13-north-perimeter/context.json' with { type: 'json' };
import { checkEast } from './b13-east';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { PBR, PAL, FAMILY_OF } from '../../../lib/campus/blocks/b13-north-perimeter/materials';

/** District wave (D29-D33): records b13 explicitly REPLACES (context.json `replaces`) must be committed authored
 * replacements owned by b13 (registry commit), and are then held to the SAME LiDAR roof gates below as generated ones. */
export const B13_REPLACED = new Set(Object.keys((b13Context as { replaces?: Record<string, unknown> }).replaces ?? {}));
export const expectedDecision = (key: string) => (B13_REPLACED.has(key) ? 'authored' : 'generated');
export const replacementFailure = (scene: { blocks?: { replacements?: { committed?: Record<string, string> } } }, key: string) =>
  B13_REPLACED.has(key) && scene.blocks?.replacements?.committed?.[key] !== 'b13-north-perimeter' ? `${key}: authored replacement not committed by b13-north-perimeter` : null;

type P = [number, number];
const pip = (x: number, z: number, r: P[]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const inRings = (x: number, z: number, rs: P[][]) => pip(x, z, rs[0]) && !rs.slice(1).some(h => pip(x, z, h));
const segDist = (px: number, pz: number, a: P, b: P) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l)) : 0; return Math.hypot(a[0] + t * dx - px, a[1] + t * dz - pz); };
const ringsDist = (x: number, z: number, rs: P[][]) => Math.min(...rs.flatMap(r => r.map((p, i) => segDist(x, z, p, r[(i + 1) % r.length]))));
const q = (v: number[], f: number) => v.length ? +v[Math.min(v.length - 1, Math.floor(v.length * f))].toFixed(2) : NaN;
type Stat = { roofY_P10: number; roofY_P50: number; roofY_P90: number; roofY_P95: number; roofY_max: number };
const R = ref as unknown as {
  records: Record<string, Stat & { abbr: string | null; unit?: string; restated?: boolean; exempt?: string; p50Only?: string; officialRing?: P[] }>;
  volumes: Record<string, Stat & { ring: P[]; roof: string; targetY: number; eaveY?: number }>;
  excluded: Record<string, P[]>;
  officialTop: Record<string, { targetTopAboveGrade?: number }>;
};

export const check: BlockCheck = async scene => {
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
  const find = (key: string) => data.buildings.find((x: { key?: string }) => x.key === key) as { rings: P[][] } | undefined;
  // 1 + 2. Records.
  const records: Record<string, unknown> = {}, units: Record<string, { records: number; checked: number; ok: number }> = {};
  let checkedN = 0, okN = 0; const absP50: number[] = [];
  for (const [key, r] of Object.entries(R.records)) {
    const p = plans.get(key); const b = find(key) ?? p?.building;
    const decision = p?.decision ?? 'missing';
    const entry: Record<string, unknown> = { abbr: r.abbr, decision };
    const u = units[r.unit ?? 'split/added'] ??= { records: 0, checked: 0, ok: 0 }; u.records++;
    const expected = expectedDecision(key);
    if (decision !== expected) failures.push(`${key} ${r.abbr ?? ''} decision ${decision} (expected ${expected})`);
    const rf = replacementFailure(scene, key); if (rf) failures.push(rf);
    if (B13_REPLACED.has(key)) entry.authored = true;
    if (b && r.roofY_P50 !== undefined && r.roofY_P50 !== null) {
      const tops = surface(b.rings as P[][], 1.0);
      const tol = 2.0, p50 = q(tops, 0.5), p95 = q(tops, 0.95);
      Object.assign(entry, { samples: tops.length, modelP50: p50, lidarP10: r.roofY_P10, lidarP50: r.roofY_P50, modelP95: p95, lidarP90: r.roofY_P90, lidarP95: r.roofY_P95, lidarMax: r.roofY_max,
        residual: { p50: +(p50 - r.roofY_P50).toFixed(2), p95: +(p95 - r.roofY_P95).toFixed(2) } });
      const upperOk = r.p50Only ? true : p95 >= r.roofY_P90 - tol && p95 <= r.roofY_max + 0.6;
      if (r.p50Only) entry.p50Only = r.p50Only;
      const checked = r.restated !== false && !r.exempt;
      entry.checked = checked; if (r.exempt) entry.exempt = r.exempt;
      if (checked && decision === expected) {
        checkedN++; u.checked++; absP50.push(Math.abs(p50 - r.roofY_P50));
        if (Math.abs(p50 - r.roofY_P50) <= tol && upperOk) { okN++; u.ok++; }
        else failures.push(`${key} ${r.abbr ?? ''} roof P50/P95 ${p50}/${p95} vs LiDAR P50 ${r.roofY_P50}, band P90 ${r.roofY_P90}..max ${r.roofY_max} (campus Y, tol ${tol})`);
      }
    } else if (r.exempt) entry.exempt = r.exempt;
    if (r.officialRing) {
      const same = !!b && b.rings[0].length === r.officialRing.length && (b.rings[0] as P[]).every((pt: P, i: number) => Math.hypot(pt[0] - r.officialRing![i][0], pt[1] - r.officialRing![i][1]) < 0.01);
      entry.correctedFootprint = same;
      if (!same) failures.push(`${key} ${r.abbr}: footprint is not the corrected (official/OSM-split) ring`);
    }
    records[key] = entry;
  }
  absP50.sort((a, b) => a - b);
  report.summary = { records: Object.keys(records).length, checked: checkedN, withinTolerance: okN, medianAbsP50: q(absP50, 0.5), maxAbsP50: absP50.length ? +absP50[absP50.length - 1].toFixed(2) : NaN };
  report.units = units;
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
  // 3. Demolished Whitis Court records.
  const excluded: Record<string, unknown> = {};
  for (const key of Object.keys(R.excluded)) {
    const still = !!find(key);
    const rep = (scene.blockData?.excluded ?? []).find((e: { key: string }) => e.key === key);
    excluded[key] = { inData: still, reportedExcluded: !!rep };
    if (still) failures.push(`${key}: demolished record still in the data`);
    if (!rep) failures.push(`${key}: not reported as excluded by the registry`);
  }
  report.excluded = excluded;
  const hall = find('-1391:add');
  if (!hall) failures.push('-1391 Whitis Court Residence Hall missing');
  else if (hall.rings.length > 1) {
    const court = hall.rings[1]; let n = 0, open = 0;
    const cx = court.map(p => p[0]), cz = court.map(p => p[1]);
    for (let x = Math.min(...cx) + 1; x < Math.max(...cx); x += 2) for (let z = Math.min(...cz) + 1; z < Math.max(...cz); z += 2) {
      if (!pip(x, z, court) || ringsDist(x, z, [court]) < 1.5) continue; n++;
      const y = ray(x, z); if (Number.isNaN(y) || y < terrain(x, z) + 2.5) open++;
    }
    report.whitisCourt = { courtSamples: n, openToGround: open };
    if (!n || open < n * 0.9) failures.push(`Whitis Court hall courtyard: ${open}/${n} rays reach the ground`);
  }
  // 4. Post-2017: deck above grade vs City 2023 h / estimate.
  const post: Record<string, unknown> = {};
  for (const [key, t] of Object.entries(R.officialTop)) {
    const b = find(key);
    if (!b || t.targetTopAboveGrade === undefined) { failures.push(`${key}: post-2017 record missing`); continue; }
    const tops = surface(b.rings, 1.5, 2.0); const g: number[] = b.rings[0].map(p => terrain(p[0], p[1])).sort((a, c) => a - c);
    const grade = q(g, 0.5), p50 = q(tops, 0.5);
    post[key] = { grade, deckAboveGrade: +(p50 - grade).toFixed(2), target: t.targetTopAboveGrade, samples: tops.length };
    if (!(Math.abs(p50 - grade - t.targetTopAboveGrade) <= 1.5)) failures.push(`${key} deck ${(p50 - grade).toFixed(2)} m above grade vs ${t.targetTopAboveGrade}`);
  }
  report.post2017 = post;
  // District-wave authored bodies (D29-D33): replacement ownership, relief, courtyards, roof features, materials.
  const auth = checkAuthored(scene);
  report.authored = auth.report;
  for (const f of auth.failures ?? []) failures.push(`authored: ${f}`);
  // East half (units g–j, separate worker lane): its own checks, merged by the integrator.
  const east = await checkEast(scene);
  report.east = east.report;
  for (const f of east.failures ?? []) failures.push(`east: ${f}`);
  if (!east.ok && !(east.failures ?? []).length) failures.push('east: check failed');
  return { ok: failures.length === 0, report, failures };
};

// ---- 5. District-wave authored bodies (D29-D33) -------------------------------------------------------------------
type Mesh = { isMesh?: boolean; name: string; material: { name: string; map?: { userData: { src?: string } } | null; normalMap?: { userData: { src?: string } } | null; roughnessMap?: { userData: { src?: string } } | null; color: { r: number; g: number; b: number }; userData: { family?: string } }; geometry: { getAttribute(n: string): { count: number; array: ArrayLike<number> } | undefined }; userData: { family?: string }; traverse(f: (o: Mesh) => void): void };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function checkAuthored(scene: any): { report: Record<string, unknown>; failures: string[] } {
  const failures: string[] = [], report: Record<string, unknown> = {};
  const entry = scene.blocks?.installs?.find((x: { id: string }) => x.id === 'b13-north-perimeter');
  if (!B13_REPLACED.size) return { report: { replaced: 0 }, failures };
  if (!entry) return { report, failures: ['b13 install missing although context.json declares replacements'] };
  const st = entry.install.stats as Record<string, unknown> & { records: string[]; probes: { key: string; o: number[]; d: number[]; wall: number; recess: number }[]; features?: { key: string; kind: string; x: number; z: number; top: number; lidarMax: number }[]; courts?: { key: string; ring: P[]; floor?: number }[]; solidTriangles: number; colliderTriangles: number; draws: number; materials: number; textures: number; textureUrls: string[] };
  const { physics, RAPIER, player } = scene;
  const own = new Set(entry.colliders.map((c: { handle: number }) => c.handle));
  const accept = (c: { handle: number }) => own.has(c.handle);
  // 5a. Ownership: every declared replacement is built by install() and committed to b13 (registry), and nothing else is claimed.
  const missing = [...B13_REPLACED].filter(k => !st.records.includes(k)), extra = st.records.filter(k => !B13_REPLACED.has(k));
  report.replacements = { declared: [...B13_REPLACED], built: st.records, committed: [...B13_REPLACED].filter(k => scene.blocks.replacements.committed[k] === 'b13-north-perimeter') };
  if (missing.length) failures.push(`replacements declared but not built: ${missing.join(', ')}`);
  if (extra.length) failures.push(`install claims undeclared records: ${extra.join(', ')}`);
  // 5b. Render = collision: the collider holds exactly the solid triangles.
  report.collision = { solidTriangles: st.solidTriangles, colliderTriangles: st.colliderTriangles };
  if (st.solidTriangles !== st.colliderTriangles) failures.push(`collider triangles ${st.colliderTriangles} != solid triangles ${st.solidTriangles}`);
  // 5c. Facade relief: rays toward recessed window centres hit the glass `recess` metres behind the wall plane.
  let pOk = 0; const pBad: unknown[] = [];
  for (const p of st.probes) {
    const h = physics.castRay(new RAPIER.Ray({ x: p.o[0], y: p.o[1], z: p.o[2] }, { x: p.d[0], y: p.d[1], z: p.d[2] }), 10, true, undefined, undefined, player, undefined, accept);
    const want = p.wall + p.recess, got = h ? h.timeOfImpact : NaN;
    if (Math.abs(got - want) <= 0.03) pOk++; else if (pBad.length < 6) pBad.push({ key: p.key, got: +got.toFixed(3), want: +want.toFixed(3) });
  }
  const perKey: Record<string, number> = {}; for (const p of st.probes) perKey[p.key] = (perKey[p.key] ?? 0) + 1;
  report.windowRelief = { probes: st.probes.length, recessedHits: pOk, perRecord: perKey, bad: pBad };
  if (st.probes.length && pOk < st.probes.length * 0.98) failures.push(`window relief: only ${pOk}/${st.probes.length} probes hit the recessed glass, e.g. ${JSON.stringify(pBad)}`);
  for (const k of B13_REPLACED) if (!perKey[k]) failures.push(`${k}: no recessed window built`);
  // 5d. Roof features (chimneys / dormers / plant / penthouses) physically at their modelled tops, never above LiDAR max + 0.6.
  const feats = st.features ?? []; let fOk = 0; const fBad: unknown[] = [];
  for (const f of feats) {
    const h = physics.castRay(new RAPIER.Ray({ x: f.x, y: 160, z: f.z }, { x: 0, y: -1, z: 0 }), 220, true, undefined, undefined, player, undefined, accept);
    const y = h ? 160 - h.timeOfImpact : NaN;
    if (Math.abs(y - f.top) <= 0.05 && f.top <= f.lidarMax + 0.6) fOk++; else if (fBad.length < 6) fBad.push({ ...f, physical: +y.toFixed(2) });
  }
  const kinds: Record<string, number> = {}; for (const f of feats) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
  report.roofFeatures = { features: feats.length, ok: fOk, kinds, bad: fBad };
  if (fOk !== feats.length) failures.push(`roof features off their modelled / LiDAR tops: ${JSON.stringify(fBad)}`);
  // 5e. Measured courtyard holes stay open to the ground (rays through the court reach the terrain).
  const terrain = (x: number, z: number) => (scene.world.terrain?.height ? scene.world.terrain.height(x, z) : NaN);
  const courts: Record<string, unknown> = {};
  for (const c of st.courts ?? []) {
    const xs = c.ring.map(p => p[0]), zs = c.ring.map(p => p[1]); let n = 0, open = 0;
    for (let x = Math.min(...xs) + 0.5; x < Math.max(...xs); x += 1) for (let z = Math.min(...zs) + 0.5; z < Math.max(...zs); z += 1) {
      if (!pip(x, z, c.ring) || ringsDist(x, z, [c.ring]) < 1.2) continue; n++;
      const h = physics.castRay(new RAPIER.Ray({ x, y: 160, z }, { x: 0, y: -1, z: 0 }), 220, true, undefined, undefined, player, undefined, accept);
      // Open courts reach the ground; a measured podium court (raster P50 inside the City hole) stops exactly at its deck.
      const y = h ? 160 - h.timeOfImpact : -Infinity;
      if (c.floor !== undefined ? Math.abs(y - c.floor) <= 0.05 : y < terrain(x, z) + 1.0) open++;
    }
    courts[c.key] = { samples: n, open, to: c.floor !== undefined ? `podium ${c.floor}` : 'ground' };
    if (!n || open < n) failures.push(`${c.key} courtyard: ${open}/${n} rays pass the authored body to the ${c.floor !== undefined ? 'podium' : 'ground'}`);
  }
  report.courtyards = courts;
  // 5f. Materials: offline CC0 PBR maps (local, same-origin, present on disk) for every textured family, linear-mean
  // neutralised tint, clean glass / trim, metre-scale isometric UVs, finite normals, per-feature family assignment.
  const palette = Object.entries(PAL).map(([name, hex]) => { const c = new THREE.Color(hex); return { c: [c.r, c.g, c.b], family: FAMILY_OF[name as keyof typeof PAL] as string }; });
  const familyOf = (r: number, g: number, b: number) => { const m = palette.find(p => Math.abs(p.c[0] - r) < 2e-6 && Math.abs(p.c[1] - g) < 2e-6 && Math.abs(p.c[2] - b) < 2e-6); return m?.family; };
  const mats: Record<string, unknown> = {}; let meshes = 0;
  const urls = new Set<string>();
  for (const root of [...(entry.install.solids ?? []), ...(entry.install.detail ?? [])] as Mesh[]) root.traverse((o: Mesh) => {
    if (!o.isMesh) return; meshes++;
    const fam = o.userData.family ?? '?', m = o.material, issues: string[] = [];
    const pos = o.geometry.getAttribute('position')!, uv = o.geometry.getAttribute('uv'), nor = o.geometry.getAttribute('normal'), col = o.geometry.getAttribute('color');
    if (fam in PBR) {
      const spec = PBR[fam as keyof typeof PBR];
      for (const [slot, t] of [['map', m.map], ['normalMap', m.normalMap], ['roughnessMap', m.roughnessMap]] as const) {
        const src = t?.userData?.src;
        if (!src || !src.startsWith('/assets/materials/context/') || !spec.urls.includes(src)) issues.push(`${slot} ${src}`);
        else { urls.add(src); if (!existsSync(resolve(process.cwd(), 'public' + src))) issues.push(`${slot} missing on disk ${src}`); }
      }
      const want = spec.linearMean.map(v => 1 / v), got = [m.color.r, m.color.g, m.color.b];
      if (got.some((v, i) => Math.abs(v - want[i]) > 1e-4 * want[i])) issues.push(`tint ${got.map(v => v.toFixed(3)).join(',')} != 1/linearMean`);
    } else if (fam === 'glass' || fam === 'trim') { if (m.map) issues.push('glass/trim must be untextured'); }
    else issues.push(`unknown family ${fam}`);
    if (!uv || uv.count !== pos.count) issues.push('uv missing');
    let nonFinite = 0, aniso = 0, wrongFamily = 0;
    const P3 = pos.array, U = uv?.array ?? [], N = nor?.array ?? [], C3 = col?.array ?? [];
    for (let i = 0; i < pos.count * 3; i++) if (!Number.isFinite(N[i] as number)) nonFinite++;
    for (let i = 0; i < pos.count * 2; i++) if (!Number.isFinite(U[i] as number)) nonFinite++;
    const triN = pos.count / 3, stride = Math.max(1, Math.floor(triN / 300));
    for (let t = 0; t < triN; t += stride) {
      const a = t * 3, b2 = a + 1;
      const d3 = Math.hypot(P3[b2 * 3] - P3[a * 3], P3[b2 * 3 + 1] - P3[a * 3 + 1], P3[b2 * 3 + 2] - P3[a * 3 + 2]), d2 = Math.hypot((U[b2 * 2] as number) - (U[a * 2] as number), (U[b2 * 2 + 1] as number) - (U[a * 2 + 1] as number));
      if (d3 > 0.05 && Math.abs(d2 / d3 - 1) > 2e-3) aniso++;
      const f = familyOf(C3[a * 3] as number, C3[a * 3 + 1] as number, C3[a * 3 + 2] as number);
      if (f !== fam) wrongFamily++;
    }
    if (nonFinite) issues.push(`${nonFinite} non-finite normal/uv components`);
    if (aniso) issues.push(`${aniso} sampled edges whose UV length is not their metre length`);
    if (wrongFamily) issues.push(`${wrongFamily} sampled triangles whose palette colour belongs to another family`);
    mats[o.name] = { family: fam, triangles: triN, material: m.name, issues };
    if (issues.length) failures.push(`${o.name}: ${issues.join('; ')}`);
  });
  report.materials = { meshes, draws: st.draws, materials: st.materials, textures: st.textures, textureUrls: [...urls].sort(), detail: mats };
  // Explicit budget for the whole b13 authored set (all districts): <= 24 draws, <= 12 materials, <= 30 textures.
  if (st.draws > 24 || st.materials > 12 || st.textures > 30) failures.push(`budget: ${st.draws} draws / ${st.materials} materials / ${st.textures} textures (max 24 / 12 / 30)`);
  report.extra = Object.fromEntries(Object.entries(st).filter(([k]) => !['probes', 'features', 'courts', 'families', 'textureUrls'].includes(k)));
  return { report, failures };
}
