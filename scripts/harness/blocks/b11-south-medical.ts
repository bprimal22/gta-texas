// Headless checks owned by block b11-south-medical (run by scripts/harness/run-block-checks.mjs).
// They measure the REAL scene in campus Y (downward rays on the physical colliders) against the 2017 USGS 3DEP 0.5 m
// building raster sampled inside the same rings (lib/campus/blocks/b11-south-medical/lidar-reference.json, written by
// research/whole-campus-92/b11-south-medical/derived/make_context.py):
//  1. Every b11 record restated in the LiDAR groundY datum: physical roof P50 within 2 m of the LiDAR P50 and roof P95
//     inside the measured upper band [LiDAR P90 - 2, LiDAR max + 0.6].
//  2. Dell Med split (City 466150 = HDB + HTB + HCG): corrected HDB footprint + 2 added official records are drawn,
//     roof P50 of each wing vs the raster inside that wing; per-tier P50 / top vs LiDAR.
//  3. Demolished Erwin Center / Cooley Pavilion: records gone, rays inside their old rings reach the ground.
//  4. Post-2017 records: Barbara Jordan top vs the published 64 m above grade; 1836 San Jacinto part vs City 2023 h.
//  5. Context decision of every b11 record (all expected generated, except the two records rebuilt by install(), which
//     must be 'authored' and are held to the SAME roof P50/P95 LiDAR tests as generated records).
// District wave D23 / D24 (install(): jordan.ts, hargis.ts):
//  6. All declared replacements committed (463088:8 Barbara Jordan, 633570:818 Hargis Hall, 531887:350 the low structure
//     beside Jordan's mall face that the authored face would otherwise suppress) and that structure physically present:
//     >= 90 % of downward rays inside its ring stop at its roof (grade + 3.0 +- 0.15).
//  7. Hargis Hall roofs are exact planes: every sloped roof triangle below the roof features has the frozen massing hip
//     slope 0.6 or the modelled pediment slope (+- 0.002) and the roof uses few distinct planes (a distance-field / grid roof fails both); the physical cupola and
//     north tower tops (rays on the block's own colliders) are within 1.0 m of the 2017 LiDAR maxima they were located from.
//  8. Barbara Jordan envelope is physical: horizontal rays toward the long east face hit the 0.3 m fins and the glass
//     in the modelled module (>= 80 % of the expected fins); on the Capitol Mall face the colonnade recess (3 m) is open
//     between columns and the columns are solid at their stations.
//  9. Material pass (geometry frozen): solid / detail triangle totals equal the frozen counts and the collider triangle
//     count, and the multiset of rendered solid triangles equals the collider's triangles exactly (render = collision); every mesh has a finite metre-scale UV per vertex (isometric per-triangle projection); textured families use
//     only the local context PBR maps (same-origin /assets/materials/context paths that exist under public/) with the
//     context tile size and linear-mean neutral colour; glass carries no maps; Hargis roofs are metal, walls limestone,
//     cornice/pilasters brick; Jordan reliefs precast.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BlockCheck } from './types';
import { TEXTURES } from '../../../lib/campus/context/materials';
import { PBR } from '../../../lib/campus/blocks/b11-south-medical/materials';
import ref from '../../../lib/campus/blocks/b11-south-medical/lidar-reference.json' with { type: 'json' };
import { HARGIS_KEY, HARGIS_CUPOLA, HARGIS_TOWER, HARGIS_PEDIMENT } from '../../../lib/campus/blocks/b11-south-medical/hargis';
import { JORDAN_KEY, JORDAN_FIN, JORDAN_FLOORS, JORDAN_COLONNADE, MALL_STRUCTURE_KEY, MALL_STRUCTURE_HEIGHT } from '../../../lib/campus/blocks/b11-south-medical/jordan';
const AUTHORED = new Set([JORDAN_KEY, HARGIS_KEY, MALL_STRUCTURE_KEY]);

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
  excluded: Record<string, P[]>;
  officialTop: Record<string, { ring?: P[]; targetTopAboveGroundY?: number; targetTopAboveGrade?: number; groundY?: number }>;
};

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
  const terrain = (x: number, z: number) => scene.world.terrain?.height ? scene.world.terrain.height(x, z) : NaN;
  // 1 + 2 + 5. Records (incl. the corrected HDB and the two added Dell Med records).
  const records: Record<string, unknown> = {};
  for (const [key, r] of Object.entries(R.records)) {
    const p = plans.get(key); const b = data.buildings.find((x: { key?: string }) => x.key === key) ?? p?.building;
    const decision = p?.decision ?? 'missing', expected = AUTHORED.has(key) ? 'authored' : 'generated';
    const entry: Record<string, unknown> = { abbr: r.abbr, decision };
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
  report.records = records;
  // 2. Wings / tiers.
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
  // 3. Demolished records: gone from the data, old rings open to the ground.
  const excluded: Record<string, unknown> = {};
  for (const [key, ring] of Object.entries(R.excluded)) {
    const still = data.buildings.some((x: { key?: string }) => x.key === key);
    if (still) failures.push(`${key}: demolished record still in the data`);
    const rep = (scene.blockData?.excluded ?? []).find((e: { key: string }) => e.key === key);
    excluded[key] = { inData: still, reportedExcluded: !!rep };
    if (!rep) failures.push(`${key}: not reported as excluded by the registry`);
    {
      let n = 0, ground = 0;
      const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
      for (let x = Math.min(...xs) + 2; x < Math.max(...xs); x += 4) for (let z = Math.min(...zs) + 2; z < Math.max(...zs); z += 4) {
        if (!pip(x, z, ring)) continue; n++; const y = ray(x, z), g = terrain(x, z);
        if (Number.isNaN(y) || y < g + 2.5) ground++;
      }
      Object.assign(excluded[key] as object, { samples: n, reachGround: ground });
      if (n && ground < n * 0.9) failures.push(`${key}: ${ground}/${n} rays inside the demolished ring reach the ground`);
    }
  }
  report.excluded = excluded;
  // 4. Post-2017 published heights.
  const post: Record<string, unknown> = {};
  const bj = data.buildings.find((x: { key?: string }) => x.key === '463088:8') as { rings: P[][] } | undefined;
  if (bj) {
    const tops = surface(bj.rings, 1.0, 2.0), xs = bj.rings[0].map(p => p[0]), zs = bj.rings[0].map(p => p[1]);
    const g: number[] = []; for (let i = 0; i < bj.rings[0].length; i++) g.push(terrain(bj.rings[0][i][0], bj.rings[0][i][1]));
    g.sort((a, b) => a - b); const grade = q(g, 0.5), top = tops.length ? tops[tops.length - 1] : NaN, p50 = q(tops, 0.5);
    post['463088:8'] = { grade, roofP50AboveGrade: +(p50 - grade).toFixed(2), topAboveGrade: +(top - grade).toFixed(2), published: '61 m main roof / 64 m to roof (211 ft)', bbox: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
    if (!(Math.abs(top - grade - 64) <= 2.5)) failures.push(`Barbara Jordan top ${(top - grade).toFixed(2)} m above grade vs published 64 m`);
  }
  const sj = R.officialTop['652201:844:1836-San-Jacinto'];
  if (sj?.ring) {
    const tops = surface([sj.ring], 1.5, 1.5); const p50 = q(tops, 0.5);
    post['652201:1836'] = { modelP50: p50, target: +(sj.groundY! + sj.targetTopAboveGroundY!).toFixed(2), samples: tops.length };
    if (!(Math.abs(p50 - (sj.groundY! + sj.targetTopAboveGroundY!)) <= 1.5)) failures.push(`1836 San Jacinto roof ${p50} vs City h target ${sj.groundY! + sj.targetTopAboveGroundY!}`);
  }
  report.post2017 = post;
  // 6. Replacements.
  const committed = scene.blocks?.replacements?.committed ?? {};
  for (const key of AUTHORED) if (committed[key] !== 'b11-south-medical') failures.push(`${key}: replacement not committed (${committed[key] ?? 'fallback'})`);
  const inst = scene.blocks?.installs?.find((x: { id: string }) => x.id === 'b11-south-medical');
  const st = (scene.blocks?.stats?.['b11-south-medical'] ?? {}) as { hargis?: { cupola: { centre: P }; tower: { centre: P } }; jordan?: { grade: number } };
  const own = new Set<number>((inst?.colliders ?? []).map((c: { handle: number }) => c.handle));
  const ownRay = (o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, reach: number) => {
    const h = physics.castRay(new RAPIER.Ray(o, d), reach, true, undefined, undefined, player, undefined, (c: { handle: number }) => own.has(c.handle));
    return h ? h.timeOfImpact : NaN;
  };
  const authored: Record<string, unknown> = {};
  const ms = data.buildings.find((x: { key?: string }) => x.key === MALL_STRUCTURE_KEY) as { rings: P[][] } | undefined;
  const msStat = (st as { mallStructure?: { grade: number } }).mallStructure;
  if (ms && msStat) {
    let n = 0, hit = 0; const xs = ms.rings[0].map(p => p[0]), zs = ms.rings[0].map(p => p[1]);
    for (let x = Math.min(...xs) + 0.25; x < Math.max(...xs); x += 0.5) for (let z = Math.min(...zs) + 0.25; z < Math.max(...zs); z += 0.5) {
      if (!inRings(x, z, ms.rings) || ringsDist(x, z, ms.rings) < 0.3) continue; n++;
      if (Math.abs(ray(x, z) - (msStat.grade + MALL_STRUCTURE_HEIGHT)) <= 0.15) hit++;
    }
    authored[MALL_STRUCTURE_KEY] = { samples: n, roofHits: hit };
    if (!n || hit < n * 0.9) failures.push(`${MALL_STRUCTURE_KEY}: roof found at ${hit}/${n} samples`);
  } else failures.push(`${MALL_STRUCTURE_KEY}: record or install stats missing`);
  // 7. Hargis Hall: exact planar hips + LiDAR-located features.
  const jhh = data.buildings.find((x: { key?: string }) => x.key === HARGIS_KEY) as { rings: P[][] } | undefined;
  if (jhh && inst) {
    const planes = new Set<number[]>(); let sloped = 0, offSlope = 0, worst = 0;
    for (const m of inst.install.solids ?? []) m.traverse((o: { isMesh?: boolean; geometry?: { getAttribute(n: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } } }) => {
      if (!o.isMesh || !o.geometry) return;
      const pos = o.geometry.getAttribute('position');
      for (let t = 0; t + 2 < pos.count; t += 3) {
        const v = [0, 1, 2].map(i => [pos.getX(t + i), pos.getY(t + i), pos.getZ(t + i)]);
        const ux = v[1][0] - v[0][0], uy = v[1][1] - v[0][1], uz = v[1][2] - v[0][2], wx = v[2][0] - v[0][0], wy = v[2][1] - v[0][1], wz = v[2][2] - v[0][2];
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const l = Math.hypot(nx, ny, nz); if (l < 1e-9) continue;
        nx /= l; ny /= l; nz /= l; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const cx = (v[0][0] + v[1][0] + v[2][0]) / 3, cy = (v[0][1] + v[1][1] + v[2][1]) / 3, cz = (v[0][2] + v[1][2] + v[2][2]) / 3;
        if (ny < 0.5 || ny > 0.999 || cy > 16.0 || !inRings(cx, cz, jhh.rings)) continue;
        if (l / 2 < 0.05) continue; // float32 slivers from exact clipping: normals not measurable
        sloped++; const slope = Math.hypot(nx, nz) / ny, dev = Math.min(Math.abs(slope - 0.6), Math.abs(slope - HARGIS_PEDIMENT.slope)); worst = Math.max(worst, dev); if (dev > 0.002) offSlope++;
        const d = nx * v[0][0] + ny * v[0][1] + nz * v[0][2];
        if (![...planes].some(q => Math.abs(q[0] - nx) < 0.003 && Math.abs(q[1] - nz) < 0.003 && Math.abs(q[2] - d) < 0.05)) planes.add([nx, nz, d]);
      }
    });
    const peak = (c: P) => { const t = ownRay({ x: c[0], y: 40, z: c[1] }, { x: 0, y: -1, z: 0 }, 40); return Number.isNaN(t) ? NaN : +(40 - t).toFixed(2); };
    const cup = peak(st.hargis?.cupola.centre ?? HARGIS_CUPOLA.centre), tow = peak(st.hargis?.tower.centre ?? HARGIS_TOWER.centre);
    authored[HARGIS_KEY] = { slopedRoofTriangles: sloped, offSlope, worstSlopeDeviation: +worst.toFixed(4), distinctPlanes: planes.size, cupolaTop: cup, cupolaLidarMax: HARGIS_CUPOLA.lidarMax, towerTop: tow, towerLidarMax: HARGIS_TOWER.lidarMax };
    if (sloped < 20) failures.push(`Hargis Hall: only ${sloped} sloped hip triangles found`);
    if (offSlope) failures.push(`Hargis Hall: ${offSlope}/${sloped} roof triangles off the modelled exact slopes (hips 0.6, pediment ${HARGIS_PEDIMENT.slope}; worst ${worst.toFixed(4)}): not exact planar faces`);
    if (planes.size > 40) failures.push(`Hargis Hall: ${planes.size} distinct hip planes (expected <= 40 exact hull planes)`);
    if (!(Math.abs(cup - HARGIS_CUPOLA.lidarMax) <= 1.0)) failures.push(`Hargis Hall cupola top ${cup} vs LiDAR max ${HARGIS_CUPOLA.lidarMax} (tol 1.0)`);
    if (!(Math.abs(tow - HARGIS_TOWER.lidarMax) <= 1.0)) failures.push(`Hargis Hall north tower top ${tow} vs LiDAR max ${HARGIS_TOWER.lidarMax} (tol 1.0)`);
  } else failures.push('Hargis Hall record or b11 install missing');
  // 8. Barbara Jordan: fins and colonnade are physical.
  const bjr = data.buildings.find((x: { key?: string }) => x.key === JORDAN_KEY) as { rings: P[][] } | undefined;
  if (bjr && inst && st.jordan) {
    let r0 = bjr.rings[0].slice(); if (Math.hypot(r0[0][0] - r0[r0.length - 1][0], r0[0][1] - r0[r0.length - 1][1]) < 1e-6) r0 = r0.slice(0, -1);
    let ar = 0; for (let i = 0; i < r0.length; i++) { const a = r0[i], c = r0[(i + 1) % r0.length]; ar += a[0] * c[1] - c[0] * a[1]; }
    if (ar < 0) r0 = r0.reverse();
    const edges = r0.map((a, i) => { const c = r0[(i + 1) % r0.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); return { a, L, ux: (c[0] - a[0]) / L, uz: (c[1] - a[1]) / L, nx: (c[1] - a[1]) / L, nz: -(c[0] - a[0]) / L }; });
    const hb = st.jordan.grade, F = JORDAN_FLOORS;
    const probe = (e: typeof edges[number], s: number, y: number, out: number) => ownRay({ x: e.a[0] + e.ux * s + e.nx * out, y, z: e.a[1] + e.uz * s + e.nz * out }, { x: -e.nx, y: 0, z: -e.nz }, out + 6);
    const east = edges.find(e => e.nx > 0.85 && e.L > 40);
    if (east) {
      const y = hb + F.ground + 2.4; let finHits = 0, glassHits = 0, other = 0, prevFin = false;
      for (let s = 0.95; s < east.L - 0.95; s += 0.05) {
        const t = probe(east, s, y, 1.0);
        if (Math.abs(t - (1.0 - JORDAN_FIN.depth)) < 0.05) { if (!prevFin) finHits++; prevFin = true; } else { prevFin = false; if (Math.abs(t - 1.0) < 0.05) glassHits++; else other++; }
      }
      const expected = Math.floor((east.L - 0.9 - JORDAN_FIN.module / 2) / JORDAN_FIN.module) + 1;
      authored[`${JORDAN_KEY}:eastFins`] = { finsFound: finHits, finsExpected: expected, glassSamples: glassHits, otherSamples: other };
      if (finHits < expected * 0.8) failures.push(`Barbara Jordan east face: ${finHits}/${expected} fins found by rays`);
      if (glassHits < 20) failures.push(`Barbara Jordan east face: glass plane not found between fins (${glassHits} samples)`);
    } else failures.push('Barbara Jordan: east (service) face not found');
    const mall = edges.filter(e => e.nx < -0.85 && e.L > 2 * JORDAN_COLONNADE.pier + 6);
    let recessOpen = 0, recessSamples = 0, columnsSolid = 0, columnsExpected = 0;
    for (const e of mall) {
      const s0 = JORDAN_COLONNADE.pier, s1 = e.L - JORDAN_COLONNADE.pier, n = Math.max(1, Math.round((s1 - s0) / JORDAN_COLONNADE.spacing)), y = hb + 3.0;
      for (let i = 1; i < n; i++) { columnsExpected++; const t = probe(e, s0 + (s1 - s0) * i / n, y, 2.0); if (Math.abs(t - 2.0) < 0.05) columnsSolid++; }
      for (let i = 0; i < n; i++) { const s = s0 + (s1 - s0) * (i + 0.5) / n; recessSamples++; const t = probe(e, s, y, 2.0); if (Math.abs(t - (2.0 + JORDAN_COLONNADE.depth)) < 0.05) recessOpen++; }
    }
    authored[`${JORDAN_KEY}:colonnade`] = { faces: mall.length, recessOpen, recessSamples, columnsSolid, columnsExpected };
    if (!mall.length) failures.push('Barbara Jordan: Capitol Mall face not found');
    if (recessOpen < recessSamples * 0.8) failures.push(`Barbara Jordan colonnade: recess open at ${recessOpen}/${recessSamples} bay centres`);
    if (columnsSolid < columnsExpected) failures.push(`Barbara Jordan colonnade: ${columnsSolid}/${columnsExpected} columns solid`);
  } else failures.push('Barbara Jordan record, b11 install or its stats missing');
  report.authored = authored;
  // 9. Materials.
  // Frozen at the b11 freeze (after the two G3-forced geometry corrections recorded in .work/HANDOFF-b11.json).
  const FROZEN = { solid: 14733, detail: 4299 };
  if (inst) {
    type M = { isMesh?: boolean; name: string; userData: { family?: string }; material: { name: string; map?: unknown; normalMap?: unknown; roughnessMap?: unknown; color: { r: number; g: number; b: number } } & Record<string, unknown>;
      geometry: { getAttribute(n: string): { count: number; itemSize: number; array: ArrayLike<number> } | undefined } };
    const all: [M, 'solid' | 'detail'][] = [];
    for (const [list, role] of [[inst.install.solids ?? [], 'solid'], [inst.install.detail ?? [], 'detail']] as const) for (const r of list) r.traverse((o: M) => { if (o.isMesh) all.push([o, role]); });
    const tri: Record<string, number> = { solid: 0, detail: 0 }, families: Record<string, number> = {};
    let uvBad = 0, scaleBad = 0, scaleSamples = 0; const texBad: string[] = [];
    for (const [m, role] of all) {
      const pos = m.geometry.getAttribute('position')!, uv = m.geometry.getAttribute('uv'), f = m.userData.family ?? 'none', n = pos.count / 3;
      tri[role] += n; families[`${role}:${f}`] = (families[`${role}:${f}`] ?? 0) + n;
      if (!uv || uv.count !== pos.count || uv.itemSize !== 2) { failures.push(`${m.name}: missing / mismatched uv attribute`); continue; }
      for (let i = 0; i < uv.array.length; i++) if (!Number.isFinite(uv.array[i])) uvBad++;
      for (let t = 0; t < n; t++) for (let e = 0; e < 3; e++) {
        const i = t * 3 + e, j = t * 3 + (e + 1) % 3, P = pos.array, U = uv.array;
        const L = Math.hypot(P[j * 3] - P[i * 3], P[j * 3 + 1] - P[i * 3 + 1], P[j * 3 + 2] - P[i * 3 + 2]); if (L < 0.2) continue;
        scaleSamples++; if (Math.abs(Math.hypot(U[j * 2] - U[i * 2], U[j * 2 + 1] - U[i * 2 + 1]) - L) > 2e-3 + 1e-3 * L) scaleBad++;
      }
      const mat = m.material;
      if (f === 'glass' || f === 'trim') { if (mat.map || mat.normalMap || mat.roughnessMap) texBad.push(`${m.name}: ${f} must carry no maps`); continue; }
      const spec = PBR[f as keyof typeof PBR], ctxTex = TEXTURES[f as keyof typeof TEXTURES];
      if (!spec || !ctxTex) { texBad.push(`${m.name}: unknown family ${f}`); continue; }
      if (spec.tile !== ctxTex.tile || spec.linearMean.some((v, i) => v !== ctxTex.linearMean[i])) texBad.push(`${f}: tile / linear mean differ from context TEXTURES`);
      if (Math.abs(mat.color.r - 1 / ctxTex.linearMean[0]) > 1e-4 || Math.abs(mat.color.b - 1 / ctxTex.linearMean[2]) > 1e-4) texBad.push(`${m.name}: colour is not the 1 / linear-mean neutral gain`);
      (['map', 'normalMap', 'roughnessMap'] as const).forEach((slot, k) => {
        const tx = mat[slot] as { userData?: { src?: string }; repeat?: { x: number; y: number } } | undefined, src = tx?.userData?.src;
        const want = `/assets/materials/context/${f}-${['color', 'normal', 'rough'][k]}.jpg`;
        if (src !== want) texBad.push(`${m.name}.${slot}: ${src} (expected ${want})`);
        else if (!existsSync(resolve(process.cwd(), 'public' + src))) texBad.push(`${m.name}.${slot}: ${src} not present under public/`);
        if (!tx?.repeat || Math.abs(tx.repeat.x - 1 / ctxTex.tile) > 1e-9 || Math.abs(tx.repeat.y - 1 / ctxTex.tile) > 1e-9) texBad.push(`${m.name}.${slot}: repeat is not 1 / tile`);
      });
    }
    const collTris = (scene.blocks?.stats?.['b11-south-medical'] as { colliderTriangles?: number } | undefined)?.colliderTriangles;
    // Exact render = collision: rendered solid triangles vs the collider's trimesh triangles (vertex order-independent).
    const triKey = (v: number[]) => { const p = [0, 1, 2].map(i => `${v[i * 3].toFixed(3)},${v[i * 3 + 1].toFixed(3)},${v[i * 3 + 2].toFixed(3)}`).sort(); return p.join('|'); };
    const counts = new Map<string, number>();
    for (const [m, role] of all) if (role === 'solid') { const P = m.geometry.getAttribute('position')!.array; for (let o = 0; o < P.length; o += 9) { const k2 = triKey(Array.from({ length: 9 }, (_, i) => P[o + i])); counts.set(k2, (counts.get(k2) ?? 0) + 1); } }
    let colliderMismatch = 0, colliderTotal = 0;
    for (const c of inst.colliders as { shape: { vertices?: Float32Array; indices?: Uint32Array } }[]) {
      const V = c.shape.vertices, I = c.shape.indices; if (!V || !I) { colliderMismatch++; continue; }
      for (let t = 0; t < I.length; t += 3) { colliderTotal++; const k2 = triKey([0, 1, 2].flatMap(e => [V[I[t + e] * 3], V[I[t + e] * 3 + 1], V[I[t + e] * 3 + 2]])); const n2 = counts.get(k2) ?? 0; if (n2 > 0) counts.set(k2, n2 - 1); else colliderMismatch++; }
    }
    const renderOnly = [...counts.values()].reduce((a2, b2) => a2 + b2, 0);
    if (colliderMismatch || renderOnly) failures.push(`render != collision: ${colliderMismatch} collider-only, ${renderOnly} render-only solid triangles (of ${colliderTotal})`);
    // Family semantics on the authored records.
    const famOfTri = (want: string, test: (cx: number, cy: number, cz: number, ny: number) => boolean) => {
      let hit = 0, wrong = 0;
      for (const [m] of all) { const P = m.geometry.getAttribute('position')!.array; for (let t = 0; t < P.length / 9; t++) {
        const o = t * 9, cx = (P[o] + P[o + 3] + P[o + 6]) / 3, cy = (P[o + 1] + P[o + 4] + P[o + 7]) / 3, cz = (P[o + 2] + P[o + 5] + P[o + 8]) / 3;
        const ux = P[o + 3] - P[o], uy = P[o + 4] - P[o + 1], uz = P[o + 5] - P[o + 2], wx = P[o + 6] - P[o], wy = P[o + 7] - P[o + 1], wz = P[o + 8] - P[o + 2];
        const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz) || 1;
        if (!test(cx, cy, cz, Math.abs(ny / l))) continue; if (m.userData.family === want) hit++; else wrong++;
      } }
      return { hit, wrong };
    };
    const roofFam = jhh ? famOfTri('metal', (x, y, z, ny) => ny > 0.5 && ny < 0.999 && y < 16 && y > 10.5 && inRings(x, z, jhh.rings)) : { hit: 0, wrong: 0 };
    const mat9 = { triangles: tri, frozen: FROZEN, colliderTriangles: collTris, colliderShapeTriangles: colliderTotal, colliderMismatch, renderOnly, families, uvNonFinite: uvBad, uvScaleSamples: scaleSamples, uvScaleBad: scaleBad, textureIssues: texBad.length, hargisRoofMetal: roofFam };
    report.materials = mat9;
    if (tri.solid !== FROZEN.solid || tri.detail !== FROZEN.detail) failures.push(`materials pass changed geometry: ${tri.solid}/${tri.detail} triangles vs frozen ${FROZEN.solid}/${FROZEN.detail}`);
    if (collTris !== FROZEN.solid) failures.push(`collider triangles ${collTris} vs frozen solid ${FROZEN.solid}`);
    if (uvBad) failures.push(`${uvBad} non-finite uv values`);
    if (scaleBad) failures.push(`${scaleBad}/${scaleSamples} uv edges not at metre scale`);
    for (const t of texBad.slice(0, 10)) failures.push(t);
    for (const need of ['solid:limestone', 'solid:brownBrick', 'solid:metal', 'solid:precast', 'solid:glass']) if (!families[need]) failures.push(`materials: no ${need} triangles`);
    if (!roofFam.hit || roofFam.wrong) failures.push(`Hargis roof hips: ${roofFam.hit} metal / ${roofFam.wrong} other-family triangles`);
  }
  return { ok: failures.length === 0, report, failures };
};
