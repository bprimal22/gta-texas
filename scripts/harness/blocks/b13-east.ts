// Headless checks for the EAST half of block b13-north-perimeter (review units b13-r0-g1..j2, x 473.6..1296, z -864..-480).
// The integrator wires `checkEast` into the b13 block check next to the west worker's check.
// They measure the REAL scene in campus Y (downward rays on the physical colliders) against the 2017 USGS 3DEP 0.5 m
// building raster sampled inside the same rings (lib/campus/blocks/b13-north-perimeter/lidar-reference-east.json, written by
// research/whole-campus-92/b13-north-perimeter/east/derived/make_context_east.py; adapted from the b10/b11 checks):
//  1. Every east record restated in the LiDAR groundY datum: physical roof P50 within 2 m of the LiDAR P50 and roof P95
//     inside the measured upper band [LiDAR P90 - 2, LiDAR max + 0.6] (P50 only where a reason is recorded).
//  2. Per-volume tiers named in the reference (multi-wing / multi-tier records): P50 and top vs the raster in that ring.
//  3. City-h 'conflict' records corrected to the LiDAR (e.g. 719188, a 2-storey school drawn as a 35 m block): physical top
//     above the LiDAR groundY must be within tolerance of the measured target, and never the rejected City value.
//  4. Context decision of every east record (all expected generated; none suppressed or missing).
//  5. Probable post-2017 rebuilds (913 Duncan Lane): physical top above the terrain grade vs the City 2023 h.
import type { BlockCheck } from './types';
import ref from '../../../lib/campus/blocks/b13-north-perimeter/lidar-reference-east.json' with { type: 'json' };
import b13Context from '../../../lib/campus/blocks/b13-north-perimeter/context.json' with { type: 'json' };

/** District wave (root-approved narrow change): a record in b13's committed context.json `replaces` is expected
 * 'authored' and must be committed by b13-north-perimeter; its roof is then tested with the SAME LiDAR gates. Every
 * other record keeps the original 'generated' expectation. */
const REPLACED = new Set(Object.keys((b13Context as { replaces?: Record<string, unknown> }).replaces ?? {}));

type P = [number, number];
const pip = (x: number, z: number, r: P[]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const inRings = (x: number, z: number, rs: P[][]) => pip(x, z, rs[0]) && !rs.slice(1).some(h => pip(x, z, h));
const segDist = (px: number, pz: number, a: P, b: P) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l)) : 0; return Math.hypot(a[0] + t * dx - px, a[1] + t * dz - pz); };
const ringsDist = (x: number, z: number, rs: P[][]) => Math.min(...rs.flatMap(r => r.map((p, i) => segDist(x, z, p, r[(i + 1) % r.length]))));
const q = (v: number[], f: number) => v.length ? +v[Math.min(v.length - 1, Math.floor(v.length * f))].toFixed(2) : NaN;
type Stat = { roofY_P10: number; roofY_P50: number; roofY_P90: number; roofY_P95: number; roofY_max: number };
const R = ref as unknown as {
  records: Record<string, Stat & { unit: string; restated?: boolean; p50Only?: string; exempt?: string }>;
  volumes: Record<string, Stat & { ring: P[]; roof: string; targetY: number }>;
  conflicts: Record<string, { targetTopY: number; tol: number; rejectedCityTopY: number; basis: string }>;
  cityTop: Record<string, { targetTopAboveGrade: number; tol: number; basis: string }>;
};

export const checkEast: BlockCheck = scene => {
  const failures: string[] = [], report: Record<string, unknown> = {};
  const { physics, RAPIER, player } = scene;
  const data = scene.world.data;
  const plans = new Map<string, { decision: string; building: { id: number; key?: string; rings: P[][] } }>(
    scene.plans.map((p: { building: { id: number; key?: string } }) => [p.building.key ?? String(p.building.id), p]));
  const byKey = new Map<string, { rings: P[][] }>(data.buildings.map((b: { key?: string; rings: P[][] }) => [b.key, b]));
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
  const residuals: number[] = [];
  let checkedN = 0, failedN = 0;
  for (const [key, r] of Object.entries(R.records)) {
    const p = plans.get(key); const b = byKey.get(key) ?? p?.building;
    const decision = p?.decision ?? 'missing';
    const entry: Record<string, unknown> = { unit: r.unit, decision };
    const expected = REPLACED.has(key) ? 'authored' : 'generated';
    if (decision !== expected) failures.push(`${key} decision ${decision} (expected ${expected})`);
    if (REPLACED.has(key)) { entry.authored = true; if (scene.blocks?.replacements?.committed?.[key] !== 'b13-north-perimeter') failures.push(`${key}: authored replacement not committed by b13-north-perimeter`); }
    if (b && typeof r.roofY_P50 === 'number') {
      let tops = surface(b.rings, 1.0);
      if (tops.length < 4) tops = surface(b.rings, 0.3, 0.5); // small sheds (< 20 m2)
      const tol = 2.0, p50 = q(tops, 0.5), p95 = q(tops, 0.95);
      Object.assign(entry, { samples: tops.length, modelP50: p50, lidarP50: r.roofY_P50, modelP95: p95, lidarP90: r.roofY_P90, lidarP95: r.roofY_P95, lidarMax: r.roofY_max,
        residual: { p50: +(p50 - r.roofY_P50).toFixed(2), p95: +(p95 - r.roofY_P95).toFixed(2) } });
      const upperOk = !!r.p50Only || (p95 >= r.roofY_P90 - tol && p95 <= r.roofY_max + 0.6);
      const checked = r.restated === true;
      entry.checked = checked;
      if (r.exempt) entry.exempt = r.exempt;
      if (r.p50Only) entry.p50Only = r.p50Only;
      if (checked) { checkedN++; residuals.push(Math.abs(p50 - r.roofY_P50)); }
      if (checked && decision === expected && !(Math.abs(p50 - r.roofY_P50) <= tol && upperOk)) {
        failedN++;
        failures.push(`${key} roof P50/P95 ${p50}/${p95} vs LiDAR P50 ${r.roofY_P50}, band P90 ${r.roofY_P90}..max ${r.roofY_max} (campus Y, tol ${tol})`);
      }
    }
    records[key] = entry;
  }
  residuals.sort((a, b) => a - b);
  report.summary = { records: Object.keys(R.records).length, checked: checkedN, failed: failedN, medianAbsP50: q(residuals, 0.5), p90AbsP50: q(residuals, 0.9), over2m: residuals.filter(v => v > 2).length };
  report.records = records;
  // 2. Tiers / wings.
  const wings: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(R.volumes ?? {})) {
    const tops = surface([v.ring], 1.0, 1.0);
    const p50 = q(tops, 0.5), top = tops.length ? +tops[tops.length - 1].toFixed(2) : NaN;
    wings[k] = { samples: tops.length, modelP50: p50, lidarP50: v.roofY_P50, targetY: v.targetY, modelTop: top, lidarMax: v.roofY_max, residualP50: +(p50 - v.roofY_P50).toFixed(2) };
    if (tops.length < 4) failures.push(`${k}: only ${tops.length} roof samples`);
    else if (!(Math.abs(p50 - v.roofY_P50) <= 2.0)) failures.push(`${k} roof P50 ${p50} vs LiDAR ${v.roofY_P50} (tol 2)`);
  }
  report.wings = wings;
  // 3. City-h conflicts resolved to the LiDAR.
  const conflicts: Record<string, unknown> = {};
  for (const [key, o] of Object.entries(R.conflicts ?? {})) {
    const b = byKey.get(key);
    if (!b) { failures.push(`${key}: conflict record missing`); continue; }
    const tops = surface(b.rings, 1.0, 1.5); const top = tops.length ? tops[tops.length - 1] : NaN;
    conflicts[key] = { topY: +top.toFixed(2), targetTopY: o.targetTopY, rejectedCityTopY: o.rejectedCityTopY, basis: o.basis, samples: tops.length };
    if (!(Math.abs(top - o.targetTopY) <= o.tol)) failures.push(`${key}: top Y ${top.toFixed(2)} vs target ${o.targetTopY} ±${o.tol} (${o.basis})`);
    if (top > o.rejectedCityTopY - 3) failures.push(`${key}: top Y ${top.toFixed(2)} still near the rejected City height ${o.rejectedCityTopY}`);
  }
  report.conflicts = conflicts;
  // 5. Probable post-2017 rebuilds (stale 2017 LiDAR): physical top above the local terrain grade vs the City 2023 h.
  const terrain = (x: number, z: number) => scene.world.terrain?.height ? scene.world.terrain.height(x, z) : NaN;
  const cityTop: Record<string, unknown> = {};
  for (const [key, o] of Object.entries(R.cityTop ?? {})) {
    const b = byKey.get(key);
    if (!b) { failures.push(`${key}: post-2017 record missing`); continue; }
    const tops = surface(b.rings, 1.0, 1.0); const g = b.rings[0].map(([x, z]) => terrain(x, z)).sort((a, c) => a - c);
    const grade = q(g, 0.5), top = tops.length ? tops[tops.length - 1] : NaN, above = +(top - grade).toFixed(2);
    cityTop[key] = { grade, topAboveGrade: above, target: o.targetTopAboveGrade, basis: o.basis, samples: tops.length };
    if (!(Math.abs(above - o.targetTopAboveGrade) <= o.tol + 0.6)) failures.push(`${key}: top ${above} m above grade vs ${o.targetTopAboveGrade} (${o.basis})`);
  }
  report.cityTop = cityTop;
  return { ok: failures.length === 0, report, failures };
};
