// Headless checks for lib/campus/blocks/b12-west-campus/retail-identity (four retail storefront identities).
// Used by scripts/harness/run-b12-retail-identity.mjs in two modes:
//  * standalone: real Rapier world with the offline terrain collider + ONLY the retail trimesh (independent of b12 index.ts);
//  * scene: the full headless game scene with the .work/INTEGRATION.json snippets applied by a Vite transform (no source edit).
// Checks (all bounded: fixed grids / sample spacings / frame caps):
//  R1 records: exact City rings (vs public/data/campus.json) and frozen massing tops (vs context.json) 8.2 / 7.5 / 7.4 / 8.2.
//  R2 roof parity: own-collider rays from above on a 1 m grid inside every ring hit the frozen top (+-5 mm); no retail
//     triangle above it.
//  R3 protrusions: no solid point (vertices, edge midpoints, centroid) outside the ring below ground + OVERHEAD_MIN - 0.05,
//     none farther out than the declared MAX_OVERHANG; detail at most 6 cm out below that height.
//  R4 no down-facing solid triangle within 5 cm of the ground; no up-facing triangle buried below the ground.
//  R5 finite positions, colours in [0,1]; render = collision (multiset of solid triangles == collider triangles).
//  R6 feature probes from the builder (recess depths, canopy / awning / coping tops, umbrella undersides, posts, open forecourt).
//  R7 headroom samples under every overhead feature / undercroft (own colliders, upward rays).
//  R8 standing capsules 0.75 m outside every ring edge and inside undercrofts are free of own colliders.
//  R10 generic G3 (as run-block-checks.mjs) on the retail triangles.
//  R9 scooter rides with the game's ScooterClearance: 1 m off every edge >= 3 m and along mapped paths near each site
//     (points >= 0.95 m outside the ring or inside an undercroft >= 0.9 m from walls / columns); any stop whose hull overlaps
//     an own collider fails. Mapped paths overlapping the 2023 City ring are reported (pre-existing data conflict).
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Point } from '../../../lib/campus/types';
import { RETAIL_FEATURES, RETAIL_KEYS, RETAIL_TOPS, OVERHEAD_MIN, MAX_OVERHANG, type RetailSite } from '../../../lib/campus/blocks/b12-west-campus/retail-identity';
import { inRing, ringDist } from '../../../lib/campus/blocks/b12-west-campus/kit';
import { ScooterClearance, SCOOTER_ENVELOPE } from '../../../lib/campus/scooter-clearance';
import { LocalGroundQuery } from '../../../lib/campus/local-ground-query';
import { RUN_SPEED } from '../../../lib/campus/map-travel';
import { SCOOTER_TUNING } from '../../../lib/campus/scooter-motion';

export interface RetailEnv {
  physics: RAPIER.World; RAPIER: typeof RAPIER; player: RAPIER.Collider;
  /** Own colliders (retail-only standalone; whole b12 block in the scene). */
  own: Set<number>;
  solids: THREE.Mesh[]; detail: THREE.Mesh[];
  /** Collider triangles of the own trimesh colliders (flat xyz), for render = collision. */
  colliderPositions: Float32Array[];
  g: (x: number, z: number) => number;
  groundRoots: THREE.Object3D[];
  paths: { id: number; kind: string; points: Point[]; width: number }[];
  /** campus.json rings by record key, and context.json massing by record key (as read from the source files). */
  sourceRings: Record<string, Point[]>; sourceMassing: Record<string, { datum?: { aboveY: number } | string; volumes: { bottom: number; top: number; role?: string }[] }>;
  trees?: { x: number; z: number }[];
}
type Tri = [THREE.Vector3, THREE.Vector3, THREE.Vector3];
const near = (p: Point, q: Point, e = 1e-6) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= e;

function triangles(meshes: THREE.Mesh[], box: [number, number, number, number]) {
  const out: { t: Tri; c: [number, number, number] }[] = [];
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    const p = m.geometry.getAttribute('position'), col = m.geometry.getAttribute('color');
    for (let i = 0; i + 2 < p.count; i += 3) {
      const t = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(p, i + k).applyMatrix4(m.matrixWorld)) as Tri;
      const cx = (t[0].x + t[1].x + t[2].x) / 3, cz = (t[0].z + t[1].z + t[2].z) / 3;
      if (cx < box[0] || cx > box[1] || cz < box[2] || cz > box[3]) continue;
      out.push({ t, c: col ? [col.getX(i), col.getY(i), col.getZ(i)] : [NaN, NaN, NaN] });
    }
  }
  return out;
}
const key9 = (t: number[]) => { const v = [0, 1, 2].map(k => t.slice(k * 3, k * 3 + 3).map(x => Math.round(x * 1000)).join(',')).sort(); return v.join('|'); };

export function runRetailChecks(env: RetailEnv) {
  const { physics, RAPIER: R, player, own, g } = env;
  const failures: string[] = [], report: Record<string, unknown> = {};
  const accept = (c: { handle: number }) => own.has(c.handle);
  const cast = (o: THREE.Vector3 | number[], d: THREE.Vector3 | number[], reach: number) => {
    const O = Array.isArray(o) ? { x: o[0], y: o[1], z: o[2] } : o, D = Array.isArray(d) ? { x: d[0], y: d[1], z: d[2] } : d;
    const h = physics.castRay(new R.Ray(O, D), reach, true, undefined, undefined, player, undefined, accept); return h ? h.timeOfImpact : null;
  };
  const sites = Object.keys(RETAIL_KEYS) as RetailSite[];
  for (const id of sites) {
    const info = RETAIL_FEATURES[id], key = RETAIL_KEYS[id], rep: Record<string, unknown> = { key };
    report[id] = rep;
    if (!info) { failures.push(`${id}: not built`); continue; }
    const ring = info.ring, xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
    const box: [number, number, number, number] = [Math.min(...xs) - 2.5, Math.max(...xs) + 2.5, Math.min(...zs) - 2.5, Math.max(...zs) + 2.5];
    // R1
    const src = env.sourceRings[key] ?? [];
    const srcClean = src.filter((p, i) => i === 0 || !near(p, src[i - 1])).filter((p, i, a) => !(i === a.length - 1 && near(p, a[0])));
    const ringOk = srcClean.length === ring.length && srcClean.every(p => ring.some(q => near(p, q, 1e-9)));
    const m = env.sourceMassing[key], topSrc = m && typeof m.datum === 'object' && m.volumes.length === 1 ? m.datum.aboveY + m.volumes[0].top : NaN;
    rep.records = { ringVertices: ring.length, exactCityRing: ringOk, frozenTop: info.top, sourceTop: +topSrc.toFixed(4), expectedTop: RETAIL_TOPS[id] };
    if (!ringOk) failures.push(`${id}: ring differs from the City ring in campus.json`);
    if (!(Math.abs(topSrc - RETAIL_TOPS[id]) < 1e-6 && Math.abs(info.top - RETAIL_TOPS[id]) < 1e-6)) failures.push(`${id}: frozen top ${info.top} / context ${topSrc} != ${RETAIL_TOPS[id]}`);
    // R2 roof parity
    let roofN = 0, roofBad = 0; const roofEx: unknown[] = [];
    for (let x = Math.min(...xs) + 0.5; x < Math.max(...xs); x += 1.0) for (let z = Math.min(...zs) + 0.5; z < Math.max(...zs); z += 1.0) {
      if (!inRing(x, z, ring) || ringDist(x, z, ring) < 0.25) continue;
      const t = cast([x, info.top + 3, z], [0, -1, 0], 6); roofN++;
      if (t === null || Math.abs(info.top + 3 - t - info.top) > 0.005) { roofBad++; if (roofEx.length < 3) roofEx.push([+x.toFixed(1), +z.toFixed(1), t === null ? null : +(info.top + 3 - t).toFixed(3)]); }
    }
    const sol = triangles(env.solids, box), det = triangles(env.detail, box);
    const maxY = Math.max(...sol.flatMap(s => s.t.map(v => v.y)));
    rep.roof = { samples: roofN, offTop: roofBad, examples: roofEx, maxSolidY: +maxY.toFixed(4) };
    if (roofN < 20 || roofBad) failures.push(`${id}: roof parity ${roofBad}/${roofN} rays off the frozen top ${JSON.stringify(roofEx)}`);
    if (maxY > info.top + 0.005) failures.push(`${id}: solid geometry reaches ${maxY.toFixed(3)} above the frozen top ${info.top}`);
    // R3 protrusions, R4 caps, R5 finite
    let prot = 0, overhang = 0, detProt = 0, downLow = 0, buried = 0, nonFinite = 0, badCol = 0, maxOut = 0; const protEx: unknown[] = [];
    const pts = (t: Tri) => [...t, t[0].clone().add(t[1]).multiplyScalar(0.5), t[1].clone().add(t[2]).multiplyScalar(0.5), t[2].clone().add(t[0]).multiplyScalar(0.5), t[0].clone().add(t[1]).add(t[2]).multiplyScalar(1 / 3)];
    const nrm = new THREE.Vector3(), tri3 = new THREE.Triangle();
    for (const { t, c } of sol) {
      if (!t.every(v => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z))) { nonFinite++; continue; }
      if (!c.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) badCol++;
      for (const p of pts(t)) {
        if (inRing(p.x, p.z, ring)) continue; const d = ringDist(p.x, p.z, ring); if (d <= 0.02) continue;
        maxOut = Math.max(maxOut, d);
        if (d > MAX_OVERHANG[id] + 0.02) overhang++;
        if (p.y < g(p.x, p.z) + OVERHEAD_MIN - 0.05) { prot++; if (protEx.length < 4) protEx.push([+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +d.toFixed(2), +(p.y - g(p.x, p.z)).toFixed(2)]); }
      }
      tri3.set(t[0], t[1], t[2]); if (tri3.getArea() < 1e-6) continue; tri3.getNormal(nrm);
      if (nrm.y < -0.3 && t.some(v => v.y <= g(v.x, v.z) + 0.05)) downLow++;
      if (nrm.y > 0.3 && t.every(v => v.y < g(v.x, v.z) - 0.05)) buried++;
    }
    for (const { t } of det) for (const p of pts(t)) { if (inRing(p.x, p.z, ring)) continue; const d = ringDist(p.x, p.z, ring); if (d > 0.06 && p.y < g(p.x, p.z) + OVERHEAD_MIN - 0.05) detProt++; if (d > MAX_OVERHANG[id] + 0.05) overhang++; }
    rep.geometry = { solidTriangles: sol.length, detailTriangles: det.length, maxOutsideRing: +maxOut.toFixed(3), lowProtrusions: prot, beyondOverhang: overhang, detailLowProtrusions: detProt, downFacingNearGround: downLow, buriedUpFacing: buried, nonFinite, badColours: badCol, examples: protEx };
    if (prot) failures.push(`${id}: ${prot} solid points outside the ring below ground + ${OVERHEAD_MIN} m, e.g. ${JSON.stringify(protEx)}`);
    if (overhang) failures.push(`${id}: ${overhang} points beyond the declared ${MAX_OVERHANG[id]} m overhang`);
    if (detProt) failures.push(`${id}: ${detProt} detail points protrude > 6 cm at walking height`);
    if (downLow) failures.push(`${id}: ${downLow} down-facing solid triangles within 5 cm of the ground`);
    if (buried) failures.push(`${id}: ${buried} buried up-facing triangles`);
    if (nonFinite || badCol) failures.push(`${id}: ${nonFinite} non-finite triangles, ${badCol} bad colours`);
    // R10 generic G3 (run-block-checks.mjs): up-facing tops have an own collider within 0.1 m from 1 m above; side faces
    // (|n.y| <= 0.3, area >= 0.05) are hit within 0.15 m by a ray from 0.5 m out along their normal
    let g3t = 0, g3tBad = 0, g3s = 0, g3sBad = 0; const g3Ex: unknown[] = [];
    for (const { t } of sol) {
      tri3.set(t[0], t[1], t[2]); const area = tri3.getArea(); tri3.getNormal(nrm);
      const cx = (t[0].x + t[1].x + t[2].x) / 3, cy = (t[0].y + t[1].y + t[2].y) / 3, cz = (t[0].z + t[1].z + t[2].z) / 3;
      if (nrm.y >= 0.5 && area >= 1e-4) { g3t++; const h = cast([cx, cy + 1, cz], [0, -1, 0], 2), span = (Math.max(t[0].y, t[1].y, t[2].y) - Math.min(t[0].y, t[1].y, t[2].y)) / 2;
        if (h === null || Math.abs(1 - h) > 0.1 + span) { g3tBad++; if (g3Ex.length < 8) g3Ex.push(['top', +cx.toFixed(2), +cy.toFixed(2), +cz.toFixed(2), h === null ? null : +(cy + 1 - h).toFixed(2)]); } }
      else if (Math.abs(nrm.y) <= 0.3 && area >= 0.05) { g3s++; const h = cast([cx + nrm.x * 0.5, cy + nrm.y * 0.5, cz + nrm.z * 0.5], [-nrm.x, -nrm.y, -nrm.z], 1);
        if (h === null || Math.abs(h - 0.5) > 0.15) { g3sBad++; if (g3Ex.length < 8) g3Ex.push(['side', +cx.toFixed(2), +cy.toFixed(2), +cz.toFixed(2), h === null ? null : +h.toFixed(2), +nrm.x.toFixed(2), +nrm.z.toFixed(2)]); } }
    }
    rep.genericG3 = { tops: g3t, topsBad: g3tBad, sides: g3s, sidesBad: g3sBad, examples: g3Ex };
    if (g3tBad || g3sBad) failures.push(`${id}: generic G3 ${g3tBad}/${g3t} tops, ${g3sBad}/${g3s} sides without an own collider at the rule distance ${JSON.stringify(g3Ex.slice(0, 4))}`);
    // R6 probes
    const probeRep: unknown[] = []; let probeBad = 0;
    for (const p of info.probes) {
      const t = cast(p.o, p.d, p.reach), ok = p.expect === null ? t === null : t !== null && Math.abs(t - p.expect) <= p.tol;
      if (!ok) probeBad++;
      probeRep.push({ label: p.label, expect: p.expect === null ? 'open' : +p.expect.toFixed(3), got: t === null ? 'open' : +t.toFixed(3), ok });
    }
    rep.probes = probeRep;
    if (probeBad) failures.push(`${id}: ${probeBad}/${info.probes.length} feature probes failed: ${JSON.stringify(probeRep.filter(x => !(x as { ok: boolean }).ok).slice(0, 4))}`);
    // R7 headroom
    let clrBad = 0; const clrEx: unknown[] = []; let clrMin = Infinity;
    for (const c of info.clearance) {
      const gy = g(c.x, c.z), t = cast([c.x, gy + 0.05, c.z], [0, 1, 0], 8), clr = t === null ? Infinity : t + 0.05;
      clrMin = Math.min(clrMin, clr);
      if (clr < c.minClear) { clrBad++; if (clrEx.length < 4) clrEx.push([c.label, +c.x.toFixed(2), +c.z.toFixed(2), +clr.toFixed(2), c.minClear]); }
    }
    rep.headroom = { samples: info.clearance.length, belowMinimum: clrBad, minClear: Number.isFinite(clrMin) ? +clrMin.toFixed(2) : null, examples: clrEx };
    if (clrBad) failures.push(`${id}: ${clrBad} headroom samples below their minimum ${JSON.stringify(clrEx)}`);
    // R8 standing capsules
    const shape = new R.Capsule(0.55, 0.3); let capN = 0, capBad = 0; const capEx: unknown[] = [];
    const standAt = (x: number, z: number, label: string) => { capN++; let hit = false; physics.intersectionsWithShape({ x, y: g(x, z) + 0.05 + 0.85, z }, { x: 0, y: 0, z: 0, w: 1 }, shape, c => { if (own.has(c.handle)) { hit = true; return false; } return true; }, undefined, undefined, player); if (hit) { capBad++; if (capEx.length < 4) capEx.push([label, +x.toFixed(2), +z.toFixed(2)]); } };
    for (let i = 0; i < ring.length; i++) { const a = ring[i], c = ring[(i + 1) % ring.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 1) continue;
      const nx = (c[1] - a[1]) / L, nz = -(c[0] - a[0]) / L;
      for (let s = 0.5; s < L - 0.4; s += 1.0) { const x = a[0] + (c[0] - a[0]) * s / L + nx * 0.75, z = a[1] + (c[1] - a[1]) * s / L + nz * 0.75; if (!inRing(x, z, ring) && ringDist(x, z, ring) > 0.7) standAt(x, z, 'ring +0.75 m'); } }
    for (const u of info.undercrofts) for (const c of info.clearance) if (inRing(c.x, c.z, u.poly) && ringDist(c.x, c.z, u.poly) >= 0.45 && !info.columns.some(k => Math.hypot(k.x - c.x, k.z - c.z) < k.hw + 0.5)) standAt(c.x, c.z, 'undercroft');
    rep.standing = { capsules: capN, blocked: capBad, examples: capEx };
    if (capBad) failures.push(`${id}: ${capBad}/${capN} standing capsules blocked by own colliders ${JSON.stringify(capEx)}`);
    // R9 scooter
    rep.scooter = scooterRides(env, id, accept);
    for (const r of (rep.scooter as { rides: { label: string; ownStops: number; stops: unknown[] }[] }).rides) if (r.ownStops) failures.push(`${id}: scooter ${r.label}: ${r.ownStops} stop(s) on own colliders ${JSON.stringify(r.stops.slice(0, 2))}`);
    // trees
    if (env.trees) { const bad = env.trees.filter(t => inRing(t.x, t.z, ring) || ringDist(t.x, t.z, ring) < 0.4); rep.trees = { nearby: env.trees.filter(t => ringDist(t.x, t.z, ring) < 8).length, insideOrWithin0_4m: bad.length }; if (bad.length) failures.push(`${id}: ${bad.length} tree trunks inside / within 0.4 m of the ring`); }
    rep.features = info.features; rep.warnings = info.warnings;
  }
  // R5 render = collision over all own solid triangles near the sites
  const boxes = sites.map(id => RETAIL_FEATURES[id]).filter(Boolean).map(i => { const xs = i!.ring.map(p => p[0]), zs = i!.ring.map(p => p[1]); return [Math.min(...xs) - 2.5, Math.max(...xs) + 2.5, Math.min(...zs) - 2.5, Math.max(...zs) + 2.5]; });
  const inBox = (x: number, z: number) => boxes.some(b => x >= b[0] && x <= b[1] && z >= b[2] && z <= b[3]);
  const rendered = new Map<string, number>(), collided = new Map<string, number>();
  for (const b of boxes) for (const { t } of triangles(env.solids, b as [number, number, number, number])) { const k = key9(t.flatMap(v => [v.x, v.y, v.z])); rendered.set(k, (rendered.get(k) ?? 0) + 1); }
  for (const arr of env.colliderPositions) for (let i = 0; i + 8 < arr.length; i += 9) { const cx = (arr[i] + arr[i + 3] + arr[i + 6]) / 3, cz = (arr[i + 2] + arr[i + 5] + arr[i + 8]) / 3; if (!inBox(cx, cz)) continue; const k = key9(Array.from(arr.subarray(i, i + 9))); collided.set(k, (collided.get(k) ?? 0) + 1); }
  let diff = 0; for (const [k, n] of rendered) diff += Math.abs(n - (collided.get(k) ?? 0)); for (const [k, n] of collided) if (!rendered.has(k)) diff += n;
  report.renderEqualsCollision = { renderedTriangles: [...rendered.values()].reduce((a, b) => a + b, 0), colliderTriangles: [...collided.values()].reduce((a, b) => a + b, 0), multisetDifference: diff };
  if (diff) failures.push(`render != collision near the retail sites: multiset difference ${diff}`);
  return { ok: failures.length === 0, failures, report };
}

/** Bounded scooter replays with the game's ScooterClearance (as scripts/harness/blocks/b12-west-campus.ts). */
function scooterRides(env: RetailEnv, id: RetailSite, accept: (c: { handle: number }) => boolean) {
  const { physics, RAPIER: R, player, g } = env, info = RETAIL_FEATURES[id]!, ring = info.ring, E = SCOOTER_ENVELOPE;
  const controller = physics.createCharacterController(0.025);
  controller.enableAutostep(0.32, 0.2, false); controller.enableSnapToGround(0.38);
  controller.setMaxSlopeClimbAngle(Math.PI * 0.25); controller.setMinSlopeSlideAngle(Math.PI * 0.28);
  const query = new LocalGroundQuery(); for (const r of env.groundRoots) r.updateMatrixWorld(true);
  const clearance = new ScooterClearance({ world: physics, controller, collider: player, renderedGround: (x, z, fromY, distance) => query.sample(x, z, fromY, distance) });
  const vmax = RUN_SPEED * SCOOTER_TUNING.speedMultiplier, dt = 1 / 60, down = { x: 0, y: -1, z: 0 };
  const hull = new R.Cuboid(E.halfWidth + 0.02, (E.riderGuardMaxY - E.minY) / 2, (E.maxZ - E.minZ) / 2 + 0.02);
  const overlap = (c: { x: number; y: number; z: number }, heading: number) => {
    const fwd = (E.maxZ + E.minZ) / 2, feet = c.y - E.riderCenterToFeet, q = { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }; let hit = false;
    physics.intersectionsWithShape({ x: c.x + Math.sin(heading) * fwd, y: feet + (E.riderGuardMaxY + E.minY) / 2, z: c.z + Math.cos(heading) * fwd }, q, hull, k => { if (accept(k)) { hit = true; return false; } return true; }, undefined, undefined, player);
    return hit;
  };
  const support = (x: number, z: number) => { const y0 = g(x, z) + 2.5, h = physics.castRay(new R.Ray({ x, y: y0, z }, down), 6, true, undefined, undefined, player, undefined, k => !accept(k) || true); return h ? y0 - h.timeOfImpact : null; };
  const ride = (label: string, pts: Point[]) => {
    const stops: unknown[] = []; let travelled = 0, frames = 0, own = 0, other = 0, total = 0, start = 0;
    for (let k = 0; k + 1 < pts.length; k++) total += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
    let restart: Point | null = pts[0];
    while (restart && frames < 6000) {
      const y0 = support(restart[0], restart[1]); if (y0 === null) { stops.push({ at: restart, reason: 'no start support' }); other++; break; }
      let c: { x: number; y: number; z: number } = { x: restart[0], y: y0 + E.riderCenterToFeet, z: restart[1] }, speed = 0; restart = null;
      for (let k = start; k + 1 < pts.length; k++) {
        const to = pts[k + 1], seg = new THREE.Vector3(to[0] - c.x, 0, to[1] - c.z), dist = seg.length(); if (dist < 1e-6) continue; seg.normalize();
        const heading = Math.atan2(seg.x, seg.z); let done = 0, blocked = false;
        while (done < dist - 1e-6 && frames < 6000) {
          speed = Math.min(vmax, speed + SCOOTER_TUNING.acceleration * dt); const step = Math.min(speed * dt, dist - done);
          query.prepare(env.groundRoots, c, () => true);
          const t = clearance.traceMove({ center: c, heading }, { x: seg.x * step, z: seg.z * step }, heading); frames++;
          if (t.fraction < 0.999 || t.blockedReason || !t.support) {
            const mine = overlap({ x: c.x + seg.x * 0.12, y: c.y, z: c.z + seg.z * 0.12 }, heading) || overlap(c, heading);
            stops.push({ at: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)], reason: t.blockedReason, own: mine }); if (mine) own++; else other++;
            const adv = Math.min(dist, done + 1.5); restart = [c.x + seg.x * (adv - done), c.z + seg.z * (adv - done)]; start = k; blocked = true; break;
          }
          c = { ...t.center }; done += step; travelled += step;
        }
        if (blocked) break;
      }
    }
    return { label, metres: +travelled.toFixed(1), of: +total.toFixed(1), frames, ownStops: own, otherStops: other, stops: stops.slice(0, 6) };
  };
  const free = (x: number, z: number) => (!inRing(x, z, ring) && ringDist(x, z, ring) >= 0.95) ||
    info.undercrofts.some(u => inRing(x, z, u.poly) && ringDist(x, z, u.poly) >= 0.9 && !info.columns.some(k => Math.hypot(k.x - x, k.z - z) < k.hw + 0.9));
  const routes: [string, Point[]][] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 3) continue;
    const nx = (c[1] - a[1]) / L, nz = -(c[0] - a[0]) / L, P = (s: number): Point => [a[0] + (c[0] - a[0]) * s / L + nx * 1.0, a[1] + (c[1] - a[1]) * s / L + nz * 1.0];
    const line = [P(0.3), P(L - 0.3)]; if (line.every(p => free(p[0], p[1])) && [0.25, 0.5, 0.75].every(f => { const p = P(L * f); return free(p[0], p[1]); })) routes.push([`edge ${i} +1 m`, line]);
  }
  let overlapping = 0; const overlapIds = new Set<number>();
  for (const p of env.paths) {
    let run: Point[] = [];
    const flush = () => { if (run.length >= 7) routes.push([`${p.kind} ${p.id}`, run]); run = []; };
    for (let k = 0; k + 1 < p.points.length; k++) {
      const a = p.points[k], b = p.points[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 0.5));
      for (let j = 0; j <= n; j++) {
        const x = a[0] + (b[0] - a[0]) * j / n, z = a[1] + (b[1] - a[1]) * j / n;
        if (ringDist(x, z, ring) > 25 && !inRing(x, z, ring)) { flush(); continue; }
        if (inRing(x, z, ring) || ringDist(x, z, ring) < p.width / 2) { overlapIds.add(p.id); }
        if (free(x, z)) run.push([x, z]); else { if (inRing(x, z, ring)) overlapping++; flush(); }
      }
    }
    flush();
  }
  const capped = routes.slice(0, 24), rides = capped.flatMap(([l, pts]) => [ride(`${l} fwd`, pts), ride(`${l} rev`, [...pts].reverse())]);
  return { speed: +vmax.toFixed(2), routes: routes.length, ridden: capped.length, pathPointsInsideRing: overlapping, pathsTouchingRing: [...overlapIds], rides };
}
