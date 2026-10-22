// Headless checks owned by block b12-west-campus (run by scripts/harness/run-block-checks.mjs).
// They measure the REAL scene in campus Y (downward rays on the physical colliders) against the 2017 USGS 3DEP 0.5 m
// building raster sampled inside the same rings (lib/campus/blocks/b12-west-campus/lidar-reference.json, written by
// research/whole-campus-92/b12-west-campus/derived/make_context.py). Adapted from b11-south-medical.
//  1. Every b12 record with a 2017 roof restated in the LiDAR groundY datum: physical roof P50 within 2 m of the LiDAR P50
//     and roof P95 inside the measured upper band [LiDAR P90 - 2, LiDAR max + 0.6] (exempt records carry a reason).
//  2. UT merged rings split per wing (GUG/UTA, NUG/N24): wing roof P50 vs the raster inside the wing.
//  3. Post-2017 records (LiDAR conflict): physical top vs City 2023 h above the 2017 DTM ground along the ring, and never
//     more than 0.6 m above City h (the generator's invented penthouse is gone).
//  4. Context decision of every b12 record (all expected generated).
//  5. Demolished record (old Cain & Abel's, 614399): gone from the data, rays inside its old ring reach the ground.
// Round 2 (West Campus / Guadalupe pass; records rebuilt by install(), decision 'authored'):
//  6. Every declared replacement committed; tier/mech ring regularisation (massing.ts) deletes no vertex farther than its
//     0.6 m tolerance from the neighbour chord (reported per record); the rebuilt records keep their massing: per volume, physical roof P50 (samples
//     not under a higher volume) within 0.15 m of the context.json massing top in campus Y (documented exceptions:
//     Torre's photo-interpreted terraces are checked against their own step tops; Moontower's frame recess is excluded).
//  7. Co-op: the storefront body lies inside City union 733792:1248's ring (body samples inside; solids protrude <= 0.45 m
//     below 3 m and <= 1.2 m above); sub-bay parapets vs the 2017 LiDAR frontage profile; UBC sanctuary ridges vs LiDAR.
//  8. Guadalupe sidewalk, STANDING check only (not scooter proof): 0.3 m standing capsules along the mapped west footways
//     and a shop-front walking line (0.75 m off the ring) along the union frontage are free of b12 colliders, with >= 2.1 m
//     head clearance under b12 colliders.
//  9. Guadalupe sidewalk, SCOOTER replay with the game's real ScooterClearance.traceMove (0.49 m half-width hull + rider
//     guard, LocalGroundQuery on the rendered ground, normal acceleration to scooter speed, one trace per 60 Hz frame),
//     both directions, along (a) the frontage edge line 0.9 m outside the outermost City-ring face, (b) the sidewalk
//     centre line (midway between that face and Guadalupe's mapped west edge: OSM centreline - 7 m of the 14 m width) and
//     (c) the mapped west footways (OSM 1120921416 -> 1120921412 -> 1120921409), z -30..113. Any stop where the hull
//     overlaps a b12 collider fails; stops caused by other colliders / ground are reported with their reason.
// Group 2 (district wave D25-D28, district.ts / pbr.ts):
// 11. The five district records are committed replacements held to the SAME LiDAR record tests (1); flat-tier records
//     (Delta Gamma, Twenty Two 15, Moody Bank) also to the strict rebuilt-massing P50 test (6). Articulation is physical:
//     Moody Bank solids stay inside the City ring (+2 cm), its three west arches are open to the loggia glass, the screen
//     is solid above the arches and at the arcade piers, and piers / 0.5 m slots alternate on its north face; the red-brick
//     block's window frames are found by rays and its parapet top along the whole ring; Delta Gamma's mansard slope is found between its base and the tier top; Twenty Two
//     15's brick bay and brick base protrude by their modelled depth. Every well-conditioned (smallest altitude >= 0.25 m)
//     sloped district roof triangle lies on one of the modelled exact slopes (red-brick hip 0.251, D25 fitted planes).
//     D25 correction (571123:534; the rejected hip cap and its dormer test are gone): T2 cells partition the unchanged City
//     ring; T3 per-cell physical P50 vs raster P50 (deck 0.15 m, roof 0.5 m) and per-sample residuals; T4 court decks are
//     the first surface from the sky with open sky above +2 m; T5 standing capsules on the decks; T6 raster court / roof
//     masks vs the physical class (court covered <= 1 %, roof as court <= 3 %, IoU >= 0.85); T7 nothing outside the ring;
//     T8 up-facing triangles on their cell's fitted planes; T9 ridges vs the raster P90 at the fitted ridge (0.35 m).
// 12. Materials and budget: district meshes have finite metre-scale UVs, only local context PBR maps (files present) at the
//     context tile size with the 1 / linear-mean neutral gain, clean glass / trim without maps, per-feature families
//     (red-brick walls brownBrick, townhouse roof shingle, Moody piers precast); draw calls <= 20, textures <= 21; and the
//     multiset of ALL rendered b12 solid triangles equals the collider's triangles exactly (render = collision).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import type { BlockCheck } from './types';
import { DISTRICT_KEYS, MANSARD, TF, RB, MOODY, D25, mansardTier } from '../../../lib/campus/blocks/b12-west-campus/district';
import { PBR } from '../../../lib/campus/blocks/b12-west-campus/pbr';
import { TEXTURES } from '../../../lib/campus/context/materials';
import { ScooterClearance, SCOOTER_ENVELOPE } from '../../../lib/campus/scooter-clearance';
import { LocalGroundQuery } from '../../../lib/campus/local-ground-query';
import { RUN_SPEED } from '../../../lib/campus/map-travel';
import { SCOOTER_TUNING } from '../../../lib/campus/scooter-motion';
import ref from '../../../lib/campus/blocks/b12-west-campus/lidar-reference.json' with { type: 'json' };
import ctxJson from '../../../lib/campus/blocks/b12-west-campus/context.json' with { type: 'json' };
import { COOP, COOP_KEY } from '../../../lib/campus/blocks/b12-west-campus/coop';
import { CHURCH, CHURCH_KEY } from '../../../lib/campus/blocks/b12-west-campus/church';
import { TOWER_KEYS, TORRE_STEPS, TORRE_AXIS, TORRE_NEIGHBOUR, TORRE_HOUSE } from '../../../lib/campus/blocks/b12-west-campus/towers';
import { SIMPLIFY_REPORT } from '../../../lib/campus/blocks/b12-west-campus/massing';
import { RETAIL_KEYS } from '../../../lib/campus/blocks/b12-west-campus/retail-identity';

type P = [number, number];
const pip = (x: number, z: number, r: P[]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const inRings = (x: number, z: number, rs: P[][]) => pip(x, z, rs[0]) && !rs.slice(1).some(h => pip(x, z, h));
const segDist = (px: number, pz: number, a: P, b: P) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l)) : 0; return Math.hypot(a[0] + t * dx - px, a[1] + t * dz - pz); };
const ringsDist = (x: number, z: number, rs: P[][]) => Math.min(...rs.flatMap(r => r.map((p, i) => segDist(x, z, p, r[(i + 1) % r.length]))));
const q = (v: number[], f: number) => v.length ? +v[Math.min(v.length - 1, Math.floor(v.length * f))].toFixed(2) : NaN;
type Stat = { roofY_P10: number; roofY_P50: number; roofY_P90: number; roofY_P95: number; roofY_max: number };
const R = ref as unknown as {
  records: Record<string, Stat & { abbr: string | null; restated?: boolean; officialRing?: P[] }>;
  volumes: Record<string, Stat & { ring: P[]; roof: string; targetY: number }>;
  post2017: Record<string, { ring: P[]; groundY: number; targetTop: number; cityH: number; name: string | null }>;
  excluded: Record<string, P[]>;
  d25: { cells: Record<string, { kind: string; n: number; inset?: number; dsmP50: number; dsmP90: number; ridgeP90?: number }>; samples: [number, number, number | null, number, string, number][] };
};

const REBUILT = new Set(Object.keys((ctxJson as unknown as { replaces?: Record<string, unknown> }).replaces ?? {}));
const EXPECTED_REBUILT = [COOP_KEY, CHURCH_KEY, ...Object.values(TOWER_KEYS), TORRE_NEIGHBOUR, TORRE_HOUSE, ...Object.values(DISTRICT_KEYS), ...Object.values(RETAIL_KEYS)];
/** 2017 LiDAR frontage profile (research/whole-campus-92/west-campus-dataset-pass/b12-implementation/frontage-profile.txt):
 * roof P50/P90 along the Guadalupe face, campus Y. */
const COOP_LIDAR = { north: { z: [-27, -20], p50: 19.03 }, centre: { z: [-15, 1], p50: 23.9, p90: 24.41 }, south: { z: [3, 13], p50: 21.66 } };
/** Ridge maxima read from the LiDAR grid (b12-implementation/church-grid.txt). */
const CHURCH_LIDAR = { naveRidge: 26.7, transeptRidge: 26.85, southRidge: 18.5 };
type Massing = { datum?: { aboveY: number } | string; volumes: { ring?: P[]; bottom: number; top: number; role?: string }[] };

export const check: BlockCheck = scene => {
  const failures: string[] = [], report: Record<string, unknown> = {};
  const { physics, RAPIER, player } = scene;
  const data = scene.world.data;
  const plans = new Map<string, { decision: string; building: { id: number; key?: string; rings: P[][] }; spec?: { roof: string } }>(
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
  // 1 + 4. Records.
  const records: Record<string, unknown> = {};
  for (const [key, r] of Object.entries(R.records)) {
    const p = plans.get(key); const b = data.buildings.find((x: { key?: string }) => x.key === key) ?? p?.building;
    const decision = p?.decision ?? 'missing';
    const entry: Record<string, unknown> = { abbr: r.abbr, decision };
    const expected = REBUILT.has(key) ? 'authored' : 'generated';
    if (decision !== expected) failures.push(`${key} ${r.abbr ?? ''} decision ${decision} (expected ${expected})`);
    if (b && r.roofY_P50 !== undefined && r.roofY_P50 !== null) {
      const tops = surface(b.rings as P[][], 1.0);
      const tol = 2.0, p50 = q(tops, 0.5), p95 = q(tops, 0.95);
      Object.assign(entry, { samples: tops.length, modelP50: p50, lidarP50: r.roofY_P50, modelP95: p95, lidarP90: r.roofY_P90, lidarP95: r.roofY_P95, lidarMax: r.roofY_max,
        residual: { p50: +(p50 - r.roofY_P50).toFixed(2), p95: +(p95 - r.roofY_P95).toFixed(2) } });
      const upperOk = p95 >= r.roofY_P90 - tol && p95 <= r.roofY_max + 0.6;
      const checked = r.restated !== false;
      entry.checked = checked;
      if (checked && decision === expected && !(Math.abs(p50 - r.roofY_P50) <= tol && upperOk))
        failures.push(`${key} ${r.abbr ?? ''} roof P50/P95 ${p50}/${p95} vs LiDAR P50 ${r.roofY_P50}, band P90 ${r.roofY_P90}..max ${r.roofY_max} (campus Y, tol ${tol})`);
    }
    if (r.officialRing && b) {
      const same = b.rings[0].length === r.officialRing.length && (b.rings[0] as P[]).every((pt: P, i: number) => Math.hypot(pt[0] - r.officialRing![i][0], pt[1] - r.officialRing![i][1]) < 0.01);
      entry.officialFootprint = same;
      if (!same) failures.push(`${key} ${r.abbr}: footprint is not the official-polygon ring`);
    }
    records[key] = entry;
  }
  const res = Object.values(records).map(e => (e as { residual?: { p50: number }; checked?: boolean })).filter(e => e.checked && e.residual).map(e => Math.abs(e.residual!.p50)).sort((a, b) => a - b);
  report.summary = { checked: res.length, medianAbsP50: q(res, 0.5), p90AbsP50: q(res, 0.9), over2m: res.filter(r => r > 2).length };
  report.records = records;
  // 2. UT wings / tiers.
  const wings: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(R.volumes)) {
    const tops = surface([v.ring], 1.0, 1.0);
    const p50 = q(tops, 0.5), top = tops.length ? +tops[tops.length - 1].toFixed(2) : NaN;
    const tol = v.roof === 'flat' ? 1.5 : 2.0;
    wings[k] = { samples: tops.length, modelP50: p50, lidarP50: v.roofY_P50, targetY: v.targetY, modelTop: top, lidarMax: v.roofY_max, residualP50: +(p50 - v.roofY_P50).toFixed(2) };
    if (tops.length < 4) failures.push(`${k}: only ${tops.length} roof samples`);
    else {
      if (!(Math.abs(p50 - v.roofY_P50) <= tol)) failures.push(`${k} roof P50 ${p50} vs LiDAR ${v.roofY_P50} (tol ${tol})`);
      if (!(top <= v.roofY_max + 1.2)) failures.push(`${k} top ${top} above LiDAR max ${v.roofY_max} + 1.2 (parapet)`);
    }
  }
  report.wings = wings;
  // 3. Post-2017 records: City 2023 h above the 2017 DTM ground along the ring.
  const post: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(R.post2017)) {
    const tops = surface([v.ring], 1.0, 1.5); const p50 = q(tops, 0.5), p95 = q(tops, 0.95), top = tops.length ? +tops[tops.length - 1].toFixed(2) : NaN;
    const cityTop = +(v.groundY + v.cityH).toFixed(2);
    const decision = plans.get(key)?.decision ?? 'missing';
    const expected = REBUILT.has(key) ? 'authored' : 'generated';
    if (decision !== expected) failures.push(`${key} post-2017 decision ${decision} (expected ${expected})`);
    post[key] = { name: v.name, decision, samples: tops.length, modelP50: p50, modelP95: p95, modelTop: top, targetTop: v.targetTop, cityTopY: cityTop };
    // Rings under ~60 m2 (sheds/kiosks) give too few 1.5 m samples inside a 1 m inset: reported, not judged.
    if (tops.length < 3) { (post[key] as Record<string, unknown>).note = 'too small to sample'; continue; }
    if (!(Math.abs(p95 - v.targetTop) <= 1.5)) failures.push(`${key} post-2017 roof P95 ${p95} vs target ${v.targetTop} (City h ${v.cityH} above ground ${v.groundY})`);
    if (!(top <= cityTop + 0.6)) failures.push(`${key} post-2017 top ${top} above City h top ${cityTop} + 0.6`);
  }
  report.post2017 = post;
  // 5. Demolished record(s): gone from the data, old rings open to the ground.
  const terrain = (x: number, z: number) => scene.world.terrain?.height ? scene.world.terrain.height(x, z) : NaN;
  const excluded: Record<string, unknown> = {};
  for (const [key, ring] of Object.entries(R.excluded ?? {})) {
    const still = data.buildings.some((x: { key?: string }) => x.key === key);
    const rep = (scene.blockData?.excluded ?? []).find((e: { key: string }) => e.key === key);
    let n = 0, ground = 0;
    const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
    for (let x = Math.min(...xs) + 1; x < Math.max(...xs); x += 2) for (let z = Math.min(...zs) + 1; z < Math.max(...zs); z += 2) {
      if (!pip(x, z, ring)) continue; n++; const y = ray(x, z), g = terrain(x, z);
      if (Number.isNaN(y) || y < g + 2.5) ground++;
    }
    excluded[key] = { inData: still, reportedExcluded: !!rep, samples: n, reachGround: ground };
    if (still) failures.push(`${key}: demolished record still in the data`);
    if (!rep) failures.push(`${key}: not reported as excluded by the registry`);
    if (n && ground < n * 0.9) failures.push(`${key}: only ${ground}/${n} rays inside the demolished ring reach the ground`);
  }
  report.excluded = excluded;
  // 6. Replacements committed + rebuilt massing kept.
  const committed = Object.entries(scene.blocks.replacements.committed).filter(([, o]) => o === 'b12-west-campus').map(([k]) => k);
  for (const k of EXPECTED_REBUILT) if (!committed.includes(k)) failures.push(`replacement ${k} not committed`);
  for (const k of REBUILT) if (!EXPECTED_REBUILT.includes(k)) failures.push(`context.json replaces ${k} is not built by install()`);
  const massing = (ctxJson as unknown as { massing: Record<string, Massing> }).massing, rebuilt: Record<string, unknown> = {};
  const moon = data.buildings.find((b: { key?: string }) => b.key === TOWER_KEYS.moontower);
  for (const key of [COOP_KEY, ...Object.values(TOWER_KEYS), TORRE_NEIGHBOUR, DISTRICT_KEYS.deltaGamma, DISTRICT_KEYS.twentyTwo15, DISTRICT_KEYS.moody]) {
    const m = massing[key], base = typeof m.datum === 'object' ? m.datum.aboveY : 0, rec = data.buildings.find((b: { key?: string }) => b.key === key);
    const vols = m.volumes.map(v => ({ ring: (v.ring ?? rec.rings[0]) as P[], top: base + v.top, role: v.role }));
    const per = vols.map((v, i) => {
      if (key === TOWER_KEYS.torre) return null; // stepped by design, checked below
      const tops: number[] = [], xs = v.ring.map(p => p[0]), zs = v.ring.map(p => p[1]);
      for (let x = Math.min(...xs) + 0.75; x < Math.max(...xs); x += 1.5) for (let z = Math.min(...zs) + 0.75; z < Math.max(...zs); z += 1.5) {
        if (!pip(x, z, v.ring) || ringsDist(x, z, [v.ring]) < 1.5 || vols.some((o, j) => j !== i && o.top > v.top + 0.05 && pip(x, z, o.ring))) continue;
        if (key === TOWER_KEYS.moontower && moon && ringsDist(x, z, [moon.rings[0] as P[]]) < 9.5 && x > -560) continue; // frame recess
        const y = ray(x, z); if (!Number.isNaN(y)) tops.push(y);
      }
      tops.sort((a, b) => a - b);
      const p50 = q(tops, 0.5);
      if (tops.length >= 4 && Math.abs(p50 - v.top) > 0.15) failures.push(`${key} volume ${i} roof P50 ${p50} vs massing top ${v.top.toFixed(2)}`);
      return { samples: tops.length, p50, massingTop: +v.top.toFixed(2) };
    });
    rebuilt[key] = per;
  }
  // Torre terraces: each step's physical top = its documented step top (City h roof for the north 2/3).
  { const o = TORRE_AXIS.o, d = [TORRE_AXIS.to[0] - o[0], TORRE_AXIS.to[1] - o[1]], L = Math.hypot(d[0], d[1]), u = [d[0] / L, d[1] / L];
    const ring = data.buildings.find((b: { key?: string }) => b.key === TOWER_KEYS.torre).rings[0] as P[], top = (massing[TOWER_KEYS.torre].datum as { aboveY: number }).aboveY + massing[TOWER_KEYS.torre].volumes[0].top;
    rebuilt[TOWER_KEYS.torre] = TORRE_STEPS.map(st => { const tops: number[] = [];
      for (let x = -712; x < -670; x += 1.5) for (let z = 243; z < 309; z += 1.5) { const t = (x - o[0]) * u[0] + (z - o[1]) * u[1];
        if (t < st.t0 + 1 || t > st.t1 - 1 || !pip(x, z, ring) || ringsDist(x, z, [ring]) < 1.5) continue; const y = ray(x, z); if (!Number.isNaN(y)) tops.push(y); }
      tops.sort((a, b) => a - b); const want = top - st.drop, p50 = q(tops, 0.5);
      if (tops.length >= 4 && Math.abs(p50 - want) > 0.15) failures.push(`Torre step ${st.t0}-${st.t1}: roof P50 ${p50} vs ${want.toFixed(2)}`);
      return { t: [st.t0, st.t1], samples: tops.length, p50, stepTop: +want.toFixed(2) }; }); }
  report.rebuiltMassing = rebuilt;
  // 6b. Tier/mech ring regularisation stays within its tolerance (no footprint distortion beyond 0.6 m per deleted vertex).
  report.ringRegularisation = SIMPLIFY_REPORT;
  for (const [key, r] of Object.entries(SIMPLIFY_REPORT)) for (const [i, v] of Object.entries(r.volumes))
    if (v.maxDeletedDeviation > r.tolerance + 1e-6) failures.push(`${key} volume ${i}: deleted vertex ${v.maxDeletedDeviation} m off its chord (> ${r.tolerance})`);
  // 7. Co-op subset inside the union ring; parapets vs LiDAR; UBC ridges.
  const union = data.buildings.find((b: { key?: string }) => b.key === COOP_KEY).rings[0] as P[];
  const faceX = (z: number) => { let best = -Infinity; for (let i = 0; i < union.length; i++) { const a = union[i], b = union[(i + 1) % union.length]; if ((a[1] - z) * (b[1] - z) <= 0 && a[1] !== b[1]) best = Math.max(best, a[0] + (z - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); } return best; };
  let inside = 0, bodySamples = 0;
  for (let z = COOP.z0 + 0.6; z < COOP.z1; z += 1) for (const dIn of [0.3, 1.0, 1.4]) { bodySamples++; if (pip(faceX(z) - dIn, z, union)) inside++; }
  if (inside !== bodySamples) failures.push(`Co-op body: ${bodySamples - inside}/${bodySamples} samples outside union ${COOP_KEY}`);
  // protrusion of b12 solids beyond the union's Guadalupe face along the Co-op extent
  const inst = scene.blocks.installs.find((x: { id: string }) => x.id === 'b12-west-campus');
  let lowOut = 0, highOut = 0; let worstHigh: number[] = [];
  for (const s of inst.install.solids) s.traverse((o: { isMesh?: boolean; geometry?: { getAttribute(n: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } } }) => {
    if (!o.isMesh || !o.geometry) return; const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); if (z < COOP.z0 - 0.5 || z > COOP.z1 + 0.5 || x < -470) continue;
      const out = x - faceX(Math.max(COOP.z0 + 0.31, Math.min(COOP.z1, z))), gy = terrain(x, z); if (y < gy + 3.0) lowOut = Math.max(lowOut, out); else if (out > highOut) { highOut = out; worstHigh = [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)]; } }
  });
  if (lowOut > 0.45) failures.push(`Co-op solids protrude ${lowOut.toFixed(2)} m beyond the ring below 3 m`);
  if (highOut > 1.2) failures.push(`Co-op solids protrude ${highOut.toFixed(2)} m beyond the ring above 3 m`); // hoods 0.97 m; +0.2 for the ring's 0.48 m jog at z -15
  const bay: Record<string, unknown> = {};
  for (const [name, L] of Object.entries(COOP_LIDAR)) {
    const tops: number[] = []; for (let z = L.z[0]; z <= L.z[1]; z += 1) { const y = ray(faceX(z) - 0.08, z); if (!Number.isNaN(y)) tops.push(y); }
    tops.sort((a, b) => a - b); const p50 = q(tops, 0.5), want = name === 'centre' ? (L as { p90: number }).p90 : L.p50;
    bay[name] = { samples: tops.length, parapetP50: p50, lidar: want };
    if (!(Math.abs(p50 - want) <= 0.5)) failures.push(`Co-op ${name} parapet ${p50} vs LiDAR ${want} (tol 0.5)`);
  }
  report.coop = { bodySamples, inside, protrusionBelow3m: +lowOut.toFixed(2), protrusionAbove3m: +highOut.toFixed(2), worstAbove3m: worstHigh, bays: bay };
  const ridgeMax = (ring: P[]) => { const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]); let m = -Infinity; for (let x = Math.min(...xs); x < Math.max(...xs); x += 0.5) for (let z = Math.min(...zs); z < Math.max(...zs); z += 0.5) if (pip(x, z, ring)) { const y = ray(x, z); if (y > m) m = y; } return +m.toFixed(2); };
  const southPart = (CHURCH.south.ring as P[]).map(p => [p[0], Math.max(p[1], 157)] as P); // clear of the base wall / nave eave
  const ch = { nave: ridgeMax(CHURCH.nave.ring as P[]), transept: ridgeMax(CHURCH.transept.ring as P[]), south: ridgeMax(southPart) };
  report.church = { ridges: ch, lidar: CHURCH_LIDAR };
  for (const [k, want] of [['nave', CHURCH_LIDAR.naveRidge], ['transept', CHURCH_LIDAR.transeptRidge], ['south', CHURCH_LIDAR.southRidge]] as const)
    if (!(Math.abs(ch[k] - want) <= 0.5 || (k !== 'south' && ch[k] <= Math.max(CHURCH_LIDAR.naveRidge, CHURCH_LIDAR.transeptRidge) + 0.3 && ch[k] >= want - 0.5))) failures.push(`UBC ${k} ridge ${ch[k]} vs LiDAR ${want}`);
  // 8. Guadalupe sidewalk capsules.
  const blockColliders = new Set(inst.colliders.map((c: { handle: number }) => c.handle));
  const shape = new RAPIER.Capsule(0.5, 0.3);
  const lines: P[][] = [1120921416, 1120921412, 1120921409].map(id => (data.paths.find((p: { id: number }) => p.id === id)?.points ?? []) as P[]);
  // shop-front walking line 0.75 m outside the outermost face within +-1.2 m (it does not enter the 1.7 m notch at z 76.7-78.6)
  const walkLine: P[] = []; for (let z = -29.5; z <= 112; z += 1) walkLine.push([Math.max(faceX(z - 1.2), faceX(z), faceX(z + 1.2)) + 0.75, z]);
  let capS = 0, capBad = 0, headBad = 0; const capEx: unknown[] = [];
  for (const line of [...lines, walkLine]) for (let i = 0; i + 1 < line.length; i++) {
    const [a, b] = [line[i], line[i + 1]], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.75));
    for (let k = 0; k <= n; k++) { const x = a[0] + (b[0] - a[0]) * k / n, z = a[1] + (b[1] - a[1]) * k / n; if (z < -31 || z > 113.5) continue;
      const gy = terrain(x, z); capS++; let hit = false;
      physics.intersectionsWithShape({ x, y: gy + 1.1, z }, { x: 0, y: 0, z: 0, w: 1 }, shape, (c: { handle: number }) => { if (blockColliders.has(c.handle)) { hit = true; return false; } return true; }, undefined, undefined, player);
      if (hit) { capBad++; if (capEx.length < 5) capEx.push([+x.toFixed(2), +gy.toFixed(2), +z.toFixed(2)]); }
      const up = physics.castRay(new RAPIER.Ray({ x, y: gy + 0.1, z }, { x: 0, y: 1, z: 0 }), 2.0, true, undefined, undefined, player, undefined, (c: { handle: number }) => blockColliders.has(c.handle));
      if (up) headBad++;
    }
  }
  report.guadalupeSidewalk = { samples: capS, blocked: capBad, headClearanceUnder2_1m: headBad, examples: capEx };
  if (capBad) failures.push(`${capBad}/${capS} Guadalupe sidewalk capsules blocked by b12 colliders, e.g. ${JSON.stringify(capEx)}`);
  if (headBad) failures.push(`${headBad}/${capS} Guadalupe sidewalk samples with < 2.1 m head clearance under b12 colliders`);
  // 9. Scooter replay along the Drag frontage (real ScooterClearance).
  {
    const controller = physics.createCharacterController(0.025);
    controller.enableAutostep(0.32, 0.2, false); controller.enableSnapToGround(0.38);
    controller.setMaxSlopeClimbAngle(Math.PI * 0.25); controller.setMinSlopeSlideAngle(Math.PI * 0.28);
    const query = new LocalGroundQuery(), roots = scene.groundRoots as THREE.Object3D[]; for (const r of roots) r.updateMatrixWorld(true);
    const clearance = new ScooterClearance({ world: physics, controller, collider: player, renderedGround: (x, z, fromY, distance) => query.sample(x, z, fromY, distance) });
    const vmax = RUN_SPEED * SCOOTER_TUNING.speedMultiplier, dt = 1 / 60, E = SCOOTER_ENVELOPE;
    const down = { x: 0, y: -1, z: 0 };
    const phys = (x: number, z: number, fromY: number, far = 6) => { const h = physics.castRay(new RAPIER.Ray({ x, y: fromY, z }, down), far, true, undefined, undefined, player); return h ? fromY - h.timeOfImpact : null; };
    const hull = new RAPIER.Cuboid(E.halfWidth + 0.02, (E.riderGuardMaxY - E.minY) / 2, (E.maxZ - E.minZ) / 2 + 0.02);
    /** Does the scooter hull (+2 cm) at this pose overlap a b12 collider? */
    const b12Overlap = (c: { x: number; y: number; z: number }, heading: number) => {
      const fwd = (E.maxZ + E.minZ) / 2, feet = c.y - E.riderCenterToFeet, q = { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) };
      let hit = false;
      physics.intersectionsWithShape({ x: c.x + Math.sin(heading) * fwd, y: feet + (E.riderGuardMaxY + E.minY) / 2, z: c.z + Math.cos(heading) * fwd }, q, hull,
        (k: { handle: number }) => { if (blockColliders.has(k.handle)) { hit = true; return false; } return true; }, undefined, undefined, player);
      return hit;
    };
    const roadway = [655414277, 201680476, 1354456442].flatMap(id => (data.paths.find((p: { id: number }) => p.id === id)?.points ?? []) as P[]);
    const roadX = (z: number) => { let best = NaN, bd = Infinity; for (let i = 0; i + 1 < roadway.length; i++) { const a = roadway[i], b = roadway[i + 1]; if ((a[1] - z) * (b[1] - z) <= 0 && a[1] !== b[1]) { const x = a[0] + (z - a[1]) / (b[1] - a[1]) * (b[0] - a[0]), d = Math.abs(x + 440); if (d < bd) { bd = d; best = x; } } } return best; };
    // outermost frontage face: the three east-facing City-ring edges extended as lines (each within 3 m of its own z range),
    // so the edge line passes straight across the 1.7 m notch and the 0.5 m jogs instead of turning into them
    const fr = union.map((a, i) => [a, union[(i + 1) % union.length]] as [P, P]).filter(([a, b]) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]), mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      return L > 2.5 && Math.abs(b[1] - a[1]) / L > 0.85 && mx > -466 && faceX(mz) - mx < 0.6; });
    const outerFace = (z: number) => Math.max(...fr.filter(([a, b]) => z >= Math.min(a[1], b[1]) - 3 && z <= Math.max(a[1], b[1]) + 3).map(([a, b]) => a[0] + (z - a[1]) / (b[1] - a[1]) * (b[0] - a[0])));
    const edgeLine: P[] = [], centreLine: P[] = [];
    // smoothed: moving max over +-4 m, then moving mean over +-3 m (never closer than 0.9 m to any frontage face; gentle headings)
    const zs: number[] = []; for (let z = -29.5; z <= 112.01; z += 1) zs.push(z);
    const raw = zs.map(outerFace), mx = zs.map((_z, i) => Math.max(...raw.slice(Math.max(0, i - 4), i + 5))), sm = zs.map((_z, i) => { const w = mx.slice(Math.max(0, i - 3), i + 4); return w.reduce((p, q) => p + q, 0) / w.length; });
    zs.forEach((z, i) => { const curb = roadX(z) - 7; edgeLine.push([sm[i] + 0.9, z]); centreLine.push([(sm[i] + curb) / 2, z]); });
    const edgeMin = Math.min(...zs.map((z, i) => sm[i] + 0.9 - raw[i]));
    const footway: P[] = [[-446.576, -38.776], [-449.576, -2.383], [-450.296, 6.418], [-452.2, 29.331], [-458.756, 113.511]];
    const rideRoute = (label: string, pts: P[]) => {
      const out: { label: string; stops: unknown[] } = { label, stops: [] };
      let start = 0, travelled = 0, frames = 0, b12Stops = 0, otherStops = 0, total = 0;
      for (let k = 0; k + 1 < pts.length; k++) total += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
      let restartAt: P | null = pts[0];
      while (restartAt && frames < 40000) {
        const y0 = phys(restartAt[0], restartAt[1], terrain(restartAt[0], restartAt[1]) + 2.5);
        if (y0 === null) { out.stops.push({ at: restartAt, reason: 'no start support' }); otherStops++; break; }
        let center: { x: number; y: number; z: number } = { x: restartAt[0], y: y0 + E.riderCenterToFeet, z: restartAt[1] }, speed = 0; restartAt = null;
        for (let k = start; k + 1 < pts.length; k++) {
          const to = pts[k + 1], seg = new THREE.Vector3(to[0] - center.x, 0, to[1] - center.z), dist = seg.length(); if (dist < 1e-6) continue; seg.normalize();
          const heading = Math.atan2(seg.x, seg.z); let done = 0, blocked = false;
          while (done < dist - 1e-6 && frames < 40000) {
            speed = Math.min(vmax, speed + SCOOTER_TUNING.acceleration * dt); const stepLen = Math.min(speed * dt, dist - done);
            query.prepare(roots, center, () => true);
            const t = clearance.traceMove({ center, heading }, { x: seg.x * stepLen, z: seg.z * stepLen }, heading); frames++;
            if (t.fraction < 0.999 || t.blockedReason || !t.support) {
              const probe = { x: center.x + seg.x * 0.12, y: center.y, z: center.z + seg.z * 0.12 }, mine = b12Overlap(probe, heading) || b12Overlap(center, heading);
              out.stops.push({ at: [+center.x.toFixed(2), +center.y.toFixed(2), +center.z.toFixed(2)], reason: t.blockedReason, fraction: +t.fraction.toFixed(3), speed: +speed.toFixed(2), b12Collider: mine });
              if (mine) b12Stops++; else otherStops++;
              // continue 1.5 m further along the line (so one foreign obstacle does not hide the rest of the frontage)
              const adv = Math.min(dist, done + 1.5); restartAt = [center.x + seg.x * (adv - done), center.z + seg.z * (adv - done)]; start = k; blocked = true; break;
            }
            center = { ...t.center }; done += stepLen; travelled += stepLen;
          }
          if (blocked) break;
        }
      }
      return { ...out, metres: +travelled.toFixed(1), of: +total.toFixed(1), frames, b12Stops, otherStops };
    };
    const rides = [['frontage edge line (0.9 m off the ring)', edgeLine], ['sidewalk centre line', centreLine], ['mapped west footways OSM 1120921416/1120921412/1120921409', footway]] as [string, P[]][];
    const results = rides.flatMap(([label, pts]) => [rideRoute(`${label} N->S`, pts), rideRoute(`${label} S->N`, [...pts].reverse())]);
    report.scooterFrontage = { speed: +vmax.toFixed(2), halfWidth: E.halfWidth, frontEdges: fr, edgeLineMinOffsetFromFace: +edgeMin.toFixed(2), rides: results };
    for (const r of results) {
      if (r.b12Stops) failures.push(`scooter ${r.label}: ${r.b12Stops} stop(s) with the hull on a b12 collider, e.g. ${JSON.stringify(r.stops.slice(0, 2))}`);
      if (r.metres < r.of * 0.9) failures.push(`scooter ${r.label}: only ${r.metres}/${r.of} m ridden`);
    }
  }
  // 10. Visual-finish pass (build-11 review): the draped Co-op/Drag sidewalk paving is VISUAL ONLY and must sit on the
  //     physical ground. At every paving triangle centroid a downward physics ray (all colliders) must find support
  //     within 0.03 m of the drawn surface, or a HIGHER surface (a mapped footway / road over it): never a void or a
  //     step below the paving. The finish adds no collider. Sign letters must exist.
  {
    type Pos = { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number };
    let pos: Pos | null = null;
    for (const d of inst.install.detail ?? []) d.traverse((o: { isMesh?: boolean; name?: string; geometry?: { getAttribute(n: string): Pos } }) => { if (o.isMesh && /sidewalk paving/.test(o.name ?? '') && o.geometry) pos = o.geometry.getAttribute('position'); });
    if (!pos) failures.push('Co-op sidewalk paving mesh missing');
    else {
      const p: Pos = pos;
      let samples = 0, match = 0, covered = 0, floating = 0, worst = 0; const bad: number[][] = [];
      for (let t = 0; t + 2 < p.count; t += 3) {
        const x = (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3, y = (p.getY(t) + p.getY(t + 1) + p.getY(t + 2)) / 3, z = (p.getZ(t) + p.getZ(t + 1) + p.getZ(t + 2)) / 3;
        const h = physics.castRay(new RAPIER.Ray({ x, y: y + 3, z }, { x: 0, y: -1, z: 0 }), 6, true, undefined, undefined, player);
        samples++; const py = h ? y + 3 - h.timeOfImpact : -Infinity, dy = py - y;
        if (Math.abs(dy) <= 0.03) { match++; worst = Math.max(worst, Math.abs(dy)); }
        else if (dy > 0.03) covered++;
        else { floating++; if (bad.length < 5) bad.push([+x.toFixed(2), +y.toFixed(3), +z.toFixed(2), Number.isFinite(py) ? +py.toFixed(3) : NaN]); }
      }
      report.coopPavingSupport = { samples, supportWithin003: match, worstMatchedOffsetM: +worst.toFixed(3), coveredByHigherSurface: covered, floatingOverVoidOrStep: floating, examples: bad };
      if (floating) failures.push(`Co-op paving: ${floating}/${samples} samples float > 0.03 m above physical support, e.g. ${JSON.stringify(bad)}`);
      if (match < samples * 0.5) failures.push(`Co-op paving: only ${match}/${samples} samples rest on physical support within 0.03 m`);
    }
    const sign = inst.install.stats?.coopSign as { triangles?: number } | undefined;
    if (!sign?.triangles) failures.push('Co-op sign letters missing');
  }
  // 11. District articulation (physical, own colliders only).
  {
    const own = new Set<number>(inst.colliders.map((c: { handle: number }) => c.handle));
    const ownRay = (o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, reach: number) => { const h = physics.castRay(new RAPIER.Ray(o, d), reach, true, undefined, undefined, player, undefined, (c: { handle: number }) => own.has(c.handle)); return h ? h.timeOfImpact : NaN; };
    const down = (x: number, z: number, from = 140) => { const t = ownRay({ x, y: from, z }, { x: 0, y: -1, z: 0 }, from + 40); return Number.isNaN(t) ? NaN : from - t; };
    const st = inst.install.stats as Record<string, Record<string, unknown>>;
    const ringOf = (key: string) => { let r = (data.buildings.find((b: { key?: string }) => b.key === key).rings[0] as P[]).slice(); if (Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < 1e-6) r = r.slice(0, -1); let a = 0; for (let i = 0; i < r.length; i++) a += r[i][0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * r[i][1]; return a < 0 ? r.reverse() : r; };
    const edgesP = (r: P[]) => r.map((a, i) => { const c = r[(i + 1) % r.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); return { a, c, L, ux: (c[0] - a[0]) / L, uz: (c[1] - a[1]) / L, nx: (c[1] - a[1]) / L, nz: -(c[0] - a[0]) / L }; });
    type EP = ReturnType<typeof edgesP>[number];
    const probe = (e: EP, sAlong: number, y: number, out: number, reach = 8) => ownRay({ x: e.a[0] + e.ux * sAlong + e.nx * out, y, z: e.a[1] + e.uz * sAlong + e.nz * out }, { x: -e.nx, y: 0, z: -e.nz }, reach);
    const d11: Record<string, unknown> = {};
    // Moody Bank
    { const ring = ringOf(DISTRICT_KEYS.moody), es = edgesP(ring), m = st.moody as { grade: number; baseTop: number; topBand: [number, number] };
      const west = es.reduce((b, e) => (e.nx < b.nx ? e : b)), north = es.reduce((b, e) => (e.nz < b.nz ? e : b));
      let outside = 0, worst = 0; const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
      for (const sol of inst.install.solids) sol.traverse((o: { isMesh?: boolean; name?: string; geometry?: { getAttribute(n: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } } }) => {
        if (!o.isMesh || !o.geometry || !/district/.test(o.name ?? '')) return; const pos = o.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); if (x < Math.min(...xs) - 3 || x > Math.max(...xs) + 3 || z < Math.min(...zs) - 3 || z > Math.max(...zs) + 3) continue;
          if (!pip(x, z, ring)) { const dd = ringsDist(x, z, [ring]); worst = Math.max(worst, dd); if (dd > 0.02) outside++; } }
      });
      const A = MOODY.arcade, p = (west.L - 3 * A.arch) / 4, D2 = A.screen + A.loggia;
      let open = 0, piersSolid = 0, screenSolid = 0;
      for (let i = 0; i < 3; i++) { const sc = p + i * (A.arch + p) + A.arch / 2;
        if (Math.abs(probe(west, sc, m.grade + 3, 2) - (2 + D2)) < 0.05) open++;
        if (Math.abs(probe(west, sc, m.grade + A.spring + A.arch / 2 + 0.8, 2) - 2) < 0.05) screenSolid++; }
      for (let i = 0; i < 4; i++) if (Math.abs(probe(west, p / 2 + i * (A.arch + p), m.grade + 3, 2) - 2) < 0.05) piersSolid++;
      let pierRuns = 0, slotRuns = 0, prev = ''; const ym = (m.baseTop + m.topBand[0]) / 2;
      for (let s = 0.2; s < north.L - 0.2; s += 0.1) { const t = probe(north, s, ym, 1); const k2 = Math.abs(t - 1) < 0.03 ? 'p' : Math.abs(t - 1 - MOODY.recess) < 0.03 ? 's' : 'x'; if (k2 !== prev) { if (k2 === 'p') pierRuns++; if (k2 === 's') slotRuns++; prev = k2; } }
      d11.moody = { verticesOutsideRing: outside, worstOutside: +worst.toFixed(3), archesOpen: open, screenSolidAboveArches: screenSolid, arcadePiersSolid: piersSolid, northPierRuns: pierRuns, northSlotRuns: slotRuns };
      if (outside) failures.push(`Moody Bank: ${outside} district vertices outside the City ring (worst ${worst.toFixed(3)} m)`);
      if (open !== 3 || screenSolid !== 3 || piersSolid !== 4) failures.push(`Moody Bank arcade: open ${open}/3, screen ${screenSolid}/3, piers ${piersSolid}/4`);
      if (slotRuns < 6 || pierRuns < slotRuns) failures.push(`Moody Bank north face: ${pierRuns} pier / ${slotRuns} slot runs`); }
    // Red-brick block
    { const ring = ringOf(DISTRICT_KEYS.redBrick), es = edgesP(ring), r = st.redBrick as { parapetTop: number; southRows: number[] }, south = es.filter(e => e.L > 10).reduce((b, e) => (e.nz > b.nz ? e : b));
      let jambs = 0, prevF = false, wallHits = 0; const hist: Record<string, number> = {};
      for (const y of r.southRows ?? []) { prevF = false;
        for (let s = 0.3; s < south.L - 0.3; s += 0.03) { const t = probe(south, s, y, 1); const key = Number.isNaN(t) ? 'none' : t.toFixed(2); hist[key] = (hist[key] ?? 0) + 1;
          const fr = Math.abs(t - (1 - RB.frame.depth)) < 0.02; if (fr && !prevF) jambs++; if (Math.abs(t - 1) < 0.02) wallHits++; prevF = fr; } }
      (d11 as Record<string, unknown>).redBrickProbeHistogram = Object.fromEntries(Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 6));
      let par = 0, parN = 0; for (const e of es) for (let s = 0.5; s < e.L - 0.5; s += 1) { parN++; const y = down(e.a[0] + e.ux * s - e.nx * 0.15, e.a[1] + e.uz * s - e.nz * 0.15); if (Math.abs(y - r.parapetTop) < 0.05) par++; }
      d11.redBrick = { southFrameJambsFirst4Storeys: jambs, wallSamples: wallHits, parapetTopHits: par, parapetSamples: parN };
      if (jambs < 16) failures.push(`red-brick block: only ${jambs} window frame jambs found on the south face`);
      if (par < parN * 0.9) failures.push(`red-brick block: parapet top found at ${par}/${parN}`); }
    // D25 correction (571123:534 townhouse rows, root IAB rejected the single hip cap): T2-T9 on the PHYSICAL colliders
    // against the raw 2017 class-6 raster samples in lidar-reference.json d25 (classes from the raster only, never from
    // the model): partition of the unchanged City ring, per-cell heights, open court decks (sky / standing), court vs
    // roof masks, nothing outside the ring, exact fitted planes, ridges.
    { const ring = ringOf(DISTRICT_KEYS.townhouses), D = R.d25, cells = D25.cells, t: Record<string, unknown> = {};
      const shoelace = (r: P[]) => { let a = 0; for (let i = 0; i < r.length; i++) a += r[i][0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * r[i][1]; return Math.abs(a) / 2; };
      const pieces = cells.flatMap(c => c.pieces.map(poly => ({ c, poly: poly as P[] })));
      const pieceAt = (x: number, z: number) => pieces.filter(p => pip(x, z, p.poly));
      const others = [...REBUILT].filter(k => k !== DISTRICT_KEYS.townhouses).map(k => data.buildings.find((b: { key?: string }) => b.key === k)?.rings[0] as P[] | undefined).filter((r): r is P[] => !!r);
      const nearOther = (x: number, z: number) => others.some(r => pip(x, z, r) || ringsDist(x, z, [r]) < 0.5);
      // T2 partition: cells cover the City ring exactly once (0.5 m grid, 5 cm boundary tolerance), the ring is the City ring
      { const ringA = shoelace(ring), cellA = pieces.reduce((s, p) => s + shoelace(p.poly), 0); let n = 0, holes = 0, overlaps = 0, spill = 0;
        const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
        for (let x = Math.min(...xs) - 1; x < Math.max(...xs) + 1; x += 0.5) for (let z = Math.min(...zs) - 1; z < Math.max(...zs) + 1; z += 0.5) {
          if (ringsDist(x, z, [ring]) < 0.05 || pieces.some(p => ringsDist(x, z, [p.poly]) < 0.05)) continue; n++;
          const k2 = pieceAt(x, z).length, inside = pip(x, z, ring);
          if (inside && k2 === 0) holes++; if (k2 > 1) overlaps++; if (!inside && k2 > 0) spill++; }
        t.T2 = { ringVertices: ring.length, ringArea: +ringA.toFixed(2), cellArea: +cellA.toFixed(2), gridSamples: n, uncovered: holes, overlaps, outsideRing: spill, sameAsDerivedRing: ring.length === D25.ring.points };
        if (Math.abs(cellA - ringA) > ringA * 0.005 || holes || overlaps || spill || ring.length !== D25.ring.points) failures.push(`D25 T2 partition: ${JSON.stringify(t.T2)}`); }
      // physical surface at the raster samples (own colliders, from above everything)
      const S = D.samples.map(([x, z, y, g, k, h]) => ({ x, z, y, g, k, h: h === 1, phys: down(x, z, 140) }));
      // T3 per cell: physical P50 at the raster samples inside the cell (>= 0.3 m from its edges) vs the raster P50 of the
      //    SAME samples (cells with < 5 samples: 0.5 m grid vs the cell's raster P50); per-sample residuals per class
      { const per: Record<string, unknown> = {}; let bad = 0;
        for (const c of cells) { const polys = c.pieces as P[][], inCell = (x: number, z: number) => polys.some(poly => pip(x, z, poly) && ringsDist(x, z, [poly]) >= 0.3);
          const own2 = S.filter(s => s.y !== null && s.k !== 'void' && !Number.isNaN(s.phys) && inCell(s.x, s.z));
          let model: number[], lidar: number[] | number;
          if (own2.length >= 5) { model = own2.map(s => s.phys).sort((x, y) => x - y); lidar = own2.map(s => s.y as number).sort((x, y) => x - y); }
          else { model = []; for (const poly of polys) { const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
              for (let x = Math.min(...xs) + 0.25; x < Math.max(...xs); x += 0.5) for (let z = Math.min(...zs) + 0.25; z < Math.max(...zs); z += 0.5)
                if (pip(x, z, poly) && ringsDist(x, z, [poly]) >= Math.min(0.75, D.cells[c.id]?.inset ?? 0.75)) { const y = down(x, z, 140); if (!Number.isNaN(y)) model.push(y); } }
            model.sort((x, y) => x - y); lidar = D.cells[c.id].dsmP50; }
          const p50 = q(model, 0.5), l50 = typeof lidar === 'number' ? lidar : q(lidar, 0.5), court = c.kind === 'deck' || c.id === 'm-pool' || c.id === 'neck', tol = court ? 0.15 : 0.5;
          per[c.id] = { kind: c.kind, samples: model.length, at: own2.length >= 5 ? 'raster samples' : 'grid', modelP50: p50, lidarP50: l50, tol };
          if (!model.length || !(Math.abs(p50 - l50) <= tol)) { bad++; failures.push(`D25 T3 ${c.id}: model P50 ${p50} vs raster P50 ${l50} (tol ${tol}, ${model.length} samples)`); } }
        const res = (k: string) => S.filter(s => s.h && s.k === k && s.y !== null).map(s => Math.abs(s.phys - (s.y as number))).sort((a, b) => a - b);
        const rr = res('roof'), rc = res('court'), far = rr.filter(v => v > 1.0).length;
        t.T3 = { cells: per, badCells: bad, roofSamples: rr.length, roofMedAbs: q(rr, 0.5), roofOver1m: far, courtSamples: rc.length, courtMedAbs: q(rc, 0.5) };
        if (!(q(rr, 0.5) <= 0.3) || far > rr.length * 0.05 || !(q(rc, 0.5) <= 0.1)) failures.push(`D25 T3 residuals vs raster: roof median ${q(rr, 0.5)} (<= 0.3), > 1 m ${far}/${rr.length} (<= 5 %), court median ${q(rc, 0.5)} (<= 0.1)`); }
      // T4 courts: from the sky the first physical surface is the measured deck (0.6 m: unmodelled planters / steps on the
      //    deck; the deck level itself is held to 0.1 m by T3), at court level (< 5 m above the DTM); open sky above +2 m
      { const C = S.filter(s => s.h && s.k === 'court' && s.y !== null); let deck = 0, sky = 0; const ex: unknown[] = [];
        for (const s of C) { if (Math.abs(s.phys - (s.y as number)) <= 0.6 && s.phys - s.g < 5.0) deck++; else if (ex.length < 5) ex.push([s.x, s.z, s.y, +s.phys.toFixed(2)]);
          if (Number.isNaN(ownRay({ x: s.x, y: (s.y as number) + 2.0, z: s.z }, { x: 0, y: 1, z: 0 }, 140))) sky++; }
        t.T4 = { courtSamples: C.length, firstHitIsDeck: deck, openSkyAbove2m: sky, examples: ex };
        if (C.length < 200 || deck < C.length * 0.98 || sky < C.length * 0.99) failures.push(`D25 T4 courts: ${deck}/${C.length} first hits on the measured deck (>= 98 %), ${sky} open above +2 m (>= 99 %), e.g. ${JSON.stringify(ex)}`); }
      // T5 standing capsule (0.3 m radius, 1.6 m) on the court deck is free of b12 colliders
      { const C = S.filter(s => s.h && s.k === 'court' && !Number.isNaN(s.phys)), cap = new RAPIER.Capsule(0.5, 0.3); let free = 0;
        for (const s of C) { let hit = false; physics.intersectionsWithShape({ x: s.x, y: s.phys + 1.1, z: s.z }, { x: 0, y: 0, z: 0, w: 1 }, cap, (c: { handle: number }) => { if (own.has(c.handle)) { hit = true; return false; } return true; }, undefined, undefined, player); if (!hit) free++; }
        t.T5 = { samples: C.length, free };
        if (free < C.length * 0.95) failures.push(`D25 T5 court standing capsules free ${free}/${C.length} (>= 95 %)`); }
      // T6 masks: raster court / roof classes vs the physical class (court < 5.0 m above the DTM)
      { const M = S.filter(s => s.y !== null && (s.k === 'court' || s.k === 'roof') && !Number.isNaN(s.phys)), mc = (s: typeof M[number]) => s.phys - s.g < 5.0;
        const H = M.filter(s => s.h), cc = H.filter(s => s.k === 'court'), rf = H.filter(s => s.k === 'roof');
        const covered = cc.filter(s => !mc(s)).length, filled = rf.filter(s => mc(s)).length;
        const iou = (A: typeof M) => { const i = A.filter(s => s.k === 'court' && mc(s)).length, u = A.filter(s => s.k === 'court' || mc(s)).length; return u ? +(i / u).toFixed(3) : NaN; };
        t.T6 = { homogeneous: H.length, courtCoveredByModelRoof: covered, of: cc.length, roofModelledAsCourt: filled, ofRoof: rf.length, courtIoU: iou(H), courtIoUAllSamples: iou(M) };
        if (covered > cc.length * 0.01 || filled > rf.length * 0.03 || !(iou(H) >= 0.85)) failures.push(`D25 T6 masks: ${JSON.stringify(t.T6)}`); }
      // T7 nothing of the record outside the City ring: rays 0.3-4 m outside reach no b12 collider above the terrain;
      //    no district vertex outside the ring by > 2 cm (other rebuilt records' rings excluded)
      { let n = 0, hit = 0, verts = 0, worst = 0; const ex: unknown[] = []; const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
        for (let x = Math.min(...xs) - 4; x < Math.max(...xs) + 4; x += 1) for (let z = Math.min(...zs) - 4; z < Math.max(...zs) + 4; z += 1) {
          if (pip(x, z, ring)) continue; const d = ringsDist(x, z, [ring]); if (d < 0.3 || d > 4 || nearOther(x, z)) continue; n++;
          const y = down(x, z, 140); if (!Number.isNaN(y) && y > terrain(x, z) + 0.3) { hit++; if (ex.length < 5) ex.push([x, z, +y.toFixed(2)]); } }
        for (const sol of inst.install.solids) sol.traverse((o: { isMesh?: boolean; name?: string; geometry?: { getAttribute(n: string): { count: number; getX(i: number): number; getZ(i: number): number } } }) => {
          if (!o.isMesh || !o.geometry || !/district/.test(o.name ?? '')) return; const pos = o.geometry.getAttribute('position');
          for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); if (pip(x, z, ring) || nearOther(x, z)) continue; const d = ringsDist(x, z, [ring]); if (d > 6) continue; worst = Math.max(worst, d); if (d > 0.02) verts++; } });
        t.T7 = { outsideSamples: n, outsideHits: hit, examples: ex, verticesOutside: verts, worstVertexOutside: +worst.toFixed(4) };
        if (hit || verts) failures.push(`D25 T7 outside the City ring: ${hit}/${n} ray hits, ${verts} vertices (worst ${worst.toFixed(3)} m), e.g. ${JSON.stringify(ex)}`); }
      // T8 every up-facing district solid triangle inside the ring lies on ONE plane of the cell containing it (fitted
      //    planes / cross-gable planes from d25-rows.json), all three vertices within 5 mm
      { let n = 0, off = 0, worst = 0, worstAt: number[][] = [], worstCells: string[] = [];
        for (const sol of inst.install.solids) sol.traverse((o: { isMesh?: boolean; name?: string; geometry?: { getAttribute(n: string): { array: ArrayLike<number> } } }) => {
          if (!o.isMesh || !o.geometry || !/district/.test(o.name ?? '')) return; const A = o.geometry.getAttribute('position').array;
          for (let i = 0; i < A.length; i += 9) { const cx = (A[i] + A[i + 3] + A[i + 6]) / 3, cz = (A[i + 2] + A[i + 5] + A[i + 8]) / 3;
            const ux = A[i + 3] - A[i], uy = A[i + 4] - A[i + 1], uz = A[i + 5] - A[i + 2], wx = A[i + 6] - A[i], wy = A[i + 7] - A[i + 1], wz = A[i + 8] - A[i + 2];
            const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz); if (l < 1e-6 || ny / l < 0.5 || !pip(cx, cz, ring) || ringsDist(cx, cz, [ring]) < 0.02) continue;
            // cells whose piece contains the centroid or passes within 1 cm of it (slivers along a shared cut)
            const cand = pieces.filter(p => pip(cx, cz, p.poly) || ringsDist(cx, cz, [p.poly]) < 0.01); n++; if (!cand.length) { off++; continue; }
            const pls = cand.flatMap(pc => [...pc.c.planes, ...pc.c.crosses.flatMap(x => x.planes)]);
            const dev = Math.min(...pls.map(pl => Math.max(...[0, 3, 6].map(j => Math.abs(pl.a * A[i + j] + pl.b * A[i + j + 2] + pl.c - A[i + j + 1])))));
            if (dev > worst) { worst = dev; worstAt = [0, 3, 6].map(j => [+A[i + j].toFixed(3), +A[i + j + 1].toFixed(3), +A[i + j + 2].toFixed(3)]); worstCells = cand.map(pc => pc.c.id); }
            if (dev > 0.005) off++; } });
        t.T8 = { upFacingTriangles: n, offFittedPlanes: off, worst: +worst.toFixed(4), worstTriangle: worstAt, worstCells };
        if (!n || off) failures.push(`D25 T8 ${off}/${n} up-facing triangles off their cell's fitted planes (worst ${worst.toFixed(4)} at ${JSON.stringify(worstAt)} cells ${worstCells.join(",")})`); }
      // T9 ridges: physical ridge max of every gable cell vs the raster P90 within 1 m of its fitted ridge line
      { const per: Record<string, unknown> = {}; let bad = 0;
        for (const c of cells.filter(c => c.kind === 'gableV' || c.kind === 'gableU')) { let m = -Infinity;
          for (const poly of c.pieces as P[][]) { const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
            for (let x = Math.min(...xs); x < Math.max(...xs); x += 0.25) for (let z = Math.min(...zs); z < Math.max(...zs); z += 0.25) if (pip(x, z, poly) && ringsDist(x, z, [poly]) > 0.3) { const y = down(x, z, 140); if (y > m) m = y; } }
          const want = D.cells[c.id].ridgeP90 as number; per[c.id] = { modelRidge: +m.toFixed(2), lidarRidgeP90: want };
          if (!(Math.abs(m - want) <= 0.35)) { bad++; failures.push(`D25 T9 ${c.id}: ridge ${m.toFixed(2)} vs raster ridge P90 ${want} (tol 0.35)`); } }
        t.T9 = { cells: per, bad }; }
      d11.d25 = t; }
    // Delta Gamma mansard
    { const mt = mansardTier(data); let hit = 0, n = 0;
      const ring = mt.ring, es = edgesP(ring);
      for (const e of es) { if (e.L < 2) continue; n++; const y = down(e.a[0] + e.ux * e.L / 2 - e.nx * 0.45, e.a[1] + e.uz * e.L / 2 - e.nz * 0.45, mt.top + 5); if (y > mt.top - MANSARD.height + 0.3 && y < mt.top - 0.3) hit++; }
      d11.deltaGamma = { edges: n, mansardSlopeHits: hit };
      if (hit < n * 0.6) failures.push(`Delta Gamma mansard: slope found at ${hit}/${n} edge midpoints`); }
    // Twenty Two 15 brick bay / base
    { const main = edgesP(ringOf(DISTRICT_KEYS.twentyTwo15)), west = main.filter(e => e.nx < -0.9 && e.L > 20), nw = west.reduce((b, e) => ((e.a[1] + e.c[1]) > (b.a[1] + b.c[1]) ? e : b));
      const gy = Math.min(...ringOf(DISTRICT_KEYS.twentyTwo15).map(p => terrain(p[0], p[1])));
      const bayT = probe(nw, nw.L - TF.bay.endGap - TF.bay.width / 2, gy + TF.brickBase + 6, 1), baseT = west.map(e => probe(e, e.L / 2, gy + 3.5, 1));
      d11.twentyTwo15 = { bayHit: +bayT.toFixed(3), baseHits: baseT.map(t => +t.toFixed(3)) };
      if (!(Math.abs(bayT - (1 - TF.bay.depth)) < 0.03)) failures.push(`Twenty Two 15 brick bay: ray hit ${bayT} (expected ${1 - TF.bay.depth})`);
      if (baseT.some(t => !(Math.abs(t - 0.88) < 0.03))) failures.push(`Twenty Two 15 brick base: ray hits ${JSON.stringify(baseT)}`); }
    // exact slopes of sloped district roofs (red-brick hip 0.251; D25: the fitted slopes of d25-rows.json)
    const D25_SLOPES = D25.cells.flatMap(c => [...c.planes, ...c.crosses.flatMap(x => x.planes)]).map(pl => Math.hypot(pl.a, pl.b)).filter(v => v > 1e-6);
    { let sloped = 0, off = 0, worst = 0;
      for (const sol of inst.install.solids) sol.traverse((o: { isMesh?: boolean; name?: string; geometry?: { getAttribute(n: string): { count: number; array: ArrayLike<number> } } }) => {
        if (!o.isMesh || !o.geometry || !/district/.test(o.name ?? '')) return; const P2 = o.geometry.getAttribute('position').array;
        for (let i = 0; i < P2.length; i += 9) { const ux = P2[i + 3] - P2[i], uy = P2[i + 4] - P2[i + 1], uz = P2[i + 5] - P2[i + 2], wx = P2[i + 6] - P2[i], wy = P2[i + 7] - P2[i + 1], wz = P2[i + 8] - P2[i + 2];
          let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const l = Math.hypot(nx, ny, nz); if (l / 2 < 0.05) continue;
          // conditioning: a sliver's float32 normal is noise; judge triangles whose smallest altitude is >= 0.25 m
          const Lmax = Math.max(Math.hypot(ux, uy, uz), Math.hypot(wx, wy, wz), Math.hypot(wx - ux, wy - uy, wz - uz)); if (l / Lmax < 0.25) continue;
          nx /= l; ny /= l; nz /= l; // down-facing soffits (arch intrados) are not roofs: only up-facing triangles are judged
          if (ny < 0.5 || ny > 0.999) continue; sloped++; const sl = Math.hypot(nx, nz) / ny, dev = Math.min(...[0.251, ...D25_SLOPES].map(v => Math.abs(sl - v))); worst = Math.max(worst, dev); if (dev > 0.003) off++; }
      });
      d11.slopes = { sloped, offModelledSlopes: off, worst: +worst.toFixed(4) };
      if (!sloped || off) failures.push(`district roofs: ${off}/${sloped} sloped triangles off the modelled exact slopes (worst ${worst.toFixed(4)})`); }
    report.district = d11;
  }
  // 12. Materials, budget, exact render = collision.
  {
    type M = { isMesh?: boolean; name: string; userData: { family?: string }; material: Record<string, unknown> & { color: { r: number; g: number; b: number } }; geometry: { getAttribute(n: string): { count: number; itemSize: number; array: ArrayLike<number> } | undefined } };
    const all: [M, 'solid' | 'detail'][] = [];
    for (const [list, role] of [[inst.install.solids ?? [], 'solid'], [inst.install.detail ?? [], 'detail']] as const) for (const r of list) r.traverse((o: M) => { if (o.isMesh) all.push([o, role]); });
    let uvBad = 0, scaleBad = 0, scaleN = 0; const texIssues: string[] = [], fam: Record<string, number> = {}; const textures = new Set<unknown>();
    for (const [m, role] of all) {
      if (!/district/.test(m.name)) continue;
      const pos = m.geometry.getAttribute('position')!, uv = m.geometry.getAttribute('uv'), f = m.userData.family ?? 'none', n = pos.count / 3; fam[`${role}:${f}`] = n;
      if (!uv || uv.count !== pos.count) { texIssues.push(`${m.name}: uv missing`); continue; }
      for (let i = 0; i < uv.array.length; i++) if (!Number.isFinite(uv.array[i])) uvBad++;
      for (let t = 0; t < n; t++) for (let e = 0; e < 3; e++) { const i = t * 3 + e, j = t * 3 + (e + 1) % 3, P2 = pos.array, U = uv.array, L = Math.hypot(P2[j * 3] - P2[i * 3], P2[j * 3 + 1] - P2[i * 3 + 1], P2[j * 3 + 2] - P2[i * 3 + 2]); if (L < 0.2) continue; scaleN++; if (Math.abs(Math.hypot(U[j * 2] - U[i * 2], U[j * 2 + 1] - U[i * 2 + 1]) - L) > 2e-3 + 1e-3 * L) scaleBad++; }
      const mat = m.material;
      if (f === 'glass' || f === 'trim') { if (mat.map || mat.normalMap || mat.roughnessMap) texIssues.push(`${m.name}: ${f} must carry no maps`); continue; }
      const spec = PBR[f as keyof typeof PBR], ct = TEXTURES[f as keyof typeof TEXTURES];
      if (!spec || !ct) { texIssues.push(`${m.name}: unknown family ${f}`); continue; }
      if (spec.tile !== ct.tile || spec.linearMean.some((v, i) => v !== ct.linearMean[i])) texIssues.push(`${f}: tile / linear mean differ from context TEXTURES`);
      if (Math.abs(mat.color.r - 1 / ct.linearMean[0]) > 1e-4 || Math.abs(mat.color.g - 1 / ct.linearMean[1]) > 1e-4) texIssues.push(`${m.name}: colour is not the 1 / linear-mean gain`);
      (['map', 'normalMap', 'roughnessMap'] as const).forEach((slot, k) => {
        const tx = mat[slot] as { userData?: { src?: string }; repeat?: { x: number; y: number } } | undefined, src = tx?.userData?.src, want = `/assets/materials/context/${f}-${['color', 'normal', 'rough'][k]}.jpg`;
        textures.add(tx);
        if (src !== want) texIssues.push(`${m.name}.${slot}: ${src} (expected ${want})`);
        else if (!existsSync(resolve(process.cwd(), 'public' + src))) texIssues.push(`${m.name}.${slot}: ${src} missing under public/`);
        if (!tx?.repeat || Math.abs(tx.repeat.x - 1 / ct.tile) > 1e-9) texIssues.push(`${m.name}.${slot}: repeat is not 1 / tile`);
      });
    }
    // per-feature families: dominant family of district wall triangles inside the red-brick and Moody rings, townhouse roof
    const famIn = (key: string, test: (ny: number, y: number) => boolean) => { const ring = (data.buildings.find((b: { key?: string }) => b.key === key).rings[0]) as P[], counts: Record<string, number> = {};
      for (const [m, role] of all) { if (role !== 'solid' || !/district/.test(m.name)) continue; const P2 = m.geometry.getAttribute('position')!.array;
        for (let i = 0; i < P2.length; i += 9) { const cx = (P2[i] + P2[i + 3] + P2[i + 6]) / 3, cy = (P2[i + 1] + P2[i + 4] + P2[i + 7]) / 3, cz = (P2[i + 2] + P2[i + 5] + P2[i + 8]) / 3;
          if (ringsDist(cx, cz, [ring]) > 0.6 && !pip(cx, cz, ring)) continue;
          const ux = P2[i + 3] - P2[i], uy = P2[i + 4] - P2[i + 1], uz = P2[i + 5] - P2[i + 2], wx = P2[i + 6] - P2[i], wy = P2[i + 7] - P2[i + 1], wz = P2[i + 8] - P2[i + 2], ny = (uz * wx - ux * wz) / (Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) || 1);
          if (test(Math.abs(ny), cy)) counts[m.userData.family ?? 'none'] = (counts[m.userData.family ?? 'none'] ?? 0) + 1; } }
      return counts; };
    const dom = (c: Record<string, number>) => Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0];
    const rbWalls = famIn(DISTRICT_KEYS.redBrick, ny => ny < 0.1), mbWalls = famIn(DISTRICT_KEYS.moody, (ny, y) => ny < 0.1 && y > (inst.install.stats.moody as { baseTop: number }).baseTop + 1), thRoof = famIn(DISTRICT_KEYS.townhouses, ny => ny > 0.5 && ny < 0.999);
    // exact render = collision over ALL b12 solids
    const triKey = (v: number[]) => [0, 1, 2].map(i => `${v[i * 3].toFixed(3)},${v[i * 3 + 1].toFixed(3)},${v[i * 3 + 2].toFixed(3)}`).sort().join('|');
    const counts = new Map<string, number>();
    for (const [m, role] of all) if (role === 'solid') { const P2 = m.geometry.getAttribute('position')!.array; for (let o = 0; o < P2.length; o += 9) { const k2 = triKey(Array.from({ length: 9 }, (_, i) => P2[o + i])); counts.set(k2, (counts.get(k2) ?? 0) + 1); } }
    let collOnly = 0, collN = 0;
    for (const c of inst.colliders as { shape: { vertices?: Float32Array; indices?: Uint32Array } }[]) { const Vv = c.shape.vertices, I = c.shape.indices; if (!Vv || !I) { collOnly++; continue; }
      for (let t = 0; t < I.length; t += 3) { collN++; const k2 = triKey([0, 1, 2].flatMap(e => [Vv[I[t + e] * 3], Vv[I[t + e] * 3 + 1], Vv[I[t + e] * 3 + 2]])); const n2 = counts.get(k2) ?? 0; if (n2 > 0) counts.set(k2, n2 - 1); else collOnly++; } }
    const renderOnly = [...counts.values()].reduce((a, b) => a + b, 0);
    const draws = all.length;
    report.materials = { districtFamilies: fam, uvNonFinite: uvBad, uvScaleSamples: scaleN, uvScaleBad: scaleBad, textureIssues: texIssues.slice(0, 5), textures: textures.size, draws,
      featureFamilies: { redBrickWalls: rbWalls, moodyUpperWalls: mbWalls, townhouseRoof: thRoof }, colliderTriangles: collN, colliderOnly: collOnly, renderOnly };
    if (uvBad) failures.push(`${uvBad} non-finite district uv values`);
    if (scaleBad) failures.push(`${scaleBad}/${scaleN} district uv edges not at metre scale`);
    for (const t of texIssues.slice(0, 8)) failures.push(t);
    if (dom(rbWalls) !== 'brownBrick') failures.push(`red-brick walls family ${dom(rbWalls)} (expected brownBrick)`);
    if (dom(mbWalls) !== 'precast') failures.push(`Moody Bank upper walls family ${dom(mbWalls)} (expected precast)`);
    if (dom(thRoof) !== 'shingle') failures.push(`townhouse roof family ${dom(thRoof)} (expected shingle)`);
    if (draws > 20) failures.push(`b12 draw calls ${draws} > budget 20`);
    if (textures.size > 21) failures.push(`b12 textures ${textures.size} > budget 21`);
    if (collOnly || renderOnly) failures.push(`render != collision: ${collOnly} collider-only, ${renderOnly} render-only solid triangles (of ${collN})`);
  }
  return { ok: failures.length === 0, report, failures };
};
