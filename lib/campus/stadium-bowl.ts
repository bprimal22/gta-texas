import * as THREE from 'three';
import type { Building, Point } from './types';
import type { CoverageGrid } from './context-coverage';
import { MeshBuilder, ColliderBuilder, cleanRing, pointInRing } from './context-geometry';
import { BELLMONT_NORTH, inBellmontNorth, bellmontNorthUv } from './stadium-bellmont-north';

/** Darrell K Royal–Texas Memorial Stadium bowl, generated from the packaged
 * stadium footprints (North End Zone horseshoe 655373 and South End Zone
 * 504014). The field opening was measured from the horseshoe's inner edge.
 * Rows, the concourse step, suite fascia and outer wall are approximations;
 * the outer wall steps back wherever authored DKR frontage already exists. */

export type StadiumMaterialKey = 'stadiumSeat' | 'stadiumRiser' | 'stadiumFacade' | 'stadiumFacadePale' | 'stadiumFacadeBellmontNorth' | 'stadiumField' | 'stadiumSuite' | 'trim';

/** Outer-wall texture repeat [metres along the wall, metres up] per facade key (authored
 * estimates, see context-textures.ts): buff = 9 m pier-box + two bays, pale = the 9.5 m Bellmont
 * bay; 12.5 m per concourse band, so the ~50 m rim reads as four deep bands, not eight storeys.
 * V is measured from the field plane, so the bands stay level all the way round the bowl. */
export const STADIUM_FACADE_TILE = { stadiumFacade: [9, 12.5], stadiumFacadePale: [9.5, 12.5] } as const;

/** Outer-wall treatment by side (field frame: +u east, +v south). North end and east side: buff
 * masonry (2008 north end / east side in the official 2022 aerials); west side (Bellmont) and the
 * 2021 south end: pale concrete with dark glazing. Corners split at 45 degrees. The Bellmont north
 * stretch of the west face (stadium-bellmont-north.ts) overrides this with its own ribbon material. */
export function stadiumFacadeKey(nu: number, nv: number): 'stadiumFacade' | 'stadiumFacadePale' {
  return nv > Math.abs(nu) || -nu > Math.abs(nv) ? 'stadiumFacadePale' : 'stadiumFacade';
}

export const STADIUM_FIELD = {
  center: [444.3, 272.5] as Point,
  /** Long axis (south) direction; the opening narrows ~3.9° west going south. */
  angle: Math.atan2(-0.068, 1),
  halfWidth: 35.5,
  halfLength: 63,
  cornerRadius: 10,
};

/** Painted-markings frame for the generated turf texture. Measured from the aligned DKR
 * photogrammetry field (tools/scans/build-stadium.mjs: yard-line comb + footprint registration,
 * ±~1.5 m / ±~1° estimated), so the generated yard lines continue the scanned field decal
 * (public/assets/scans/dkr-field.glb) across its south 20-yard-line seam. Only turf UVs use it. */
export const STADIUM_MARKINGS = {
  center: [444.8, 273.0] as Point,
  /** Long axis toward the south: x changes -0.1164 per +1 z (−6.64°). */
  angle: Math.atan2(-0.1164, 1),
};

/** A stand sector replaced by aligned photogrammetry (lib/campus/scan-landmarks.ts). Heights are
 * metres above the field plane, sampled from the shipped scan collider surface; the bowl omits
 * its rows there and closes the sector with seam walls, a front collider strip and an outer wall. */
export interface StadiumScanSector {
  side: 'west';
  /** Field-frame v range (along the field, + south) of the replaced west straight. */
  vMin: number; vMax: number;
  /** Outward step (m) of the seam profiles. */
  step: number;
  /** Scanned surface height at t = k*step on v = vMin / v = vMax (null outside the crop). */
  seamMin: (number | null)[]; seamMax: (number | null)[];
  /** [v, height at the front edge t = 0]. */
  front: [number, number][];
  /** [v, outward depth t of the clean rim line (scan trimmed beyond it), rim height]. The bowl
   * closes the sector from the rim to its outer wall with an authored parapet + roof cap. */
  outer: [number, number, number][];
  /** Authored press-box massing fitted to the surviving scanned slab extents (field frame). */
  pressBox?: { vMin: number; vMax: number; t0: number; t1: number; top: number } | null;
  /** Rim parapet height above the cap (m). */
  parapet?: number;
}
export interface StadiumBowlOptions {
  scanSector?: StadiumScanSector | null;
  /** Called with the field height before any west rows are dropped (e.g. to create the scan's
   * colliders). The sector is replaced only if this returns without throwing; otherwise the full
   * generated bowl is built and the failure is reported in stats.scanSectorError. */
  commitScan?: (fieldY: number) => void;
}

interface Sample { x: number; z: number; nx: number; nz: number; s: number; u: number; v: number; nu: number; nv: number }

function perimeter(): Sample[] {
  const { center: [cx, cz], angle, halfWidth: hw, halfLength: hl, cornerRadius: r } = STADIUM_FIELD;
  // Long axis L = (sin a, cos a) in (x, z); width axis W = (cos a, -sin a).
  const L = [Math.sin(angle), Math.cos(angle)], W = [Math.cos(angle), -Math.sin(angle)];
  const local: { u: number; v: number; nu: number; nv: number }[] = [];
  const corners = [[hw - r, hl - r, 0], [-(hw - r), hl - r, 90], [-(hw - r), -(hl - r), 180], [hw - r, -(hl - r), 270]];
  for (let c = 0; c < 4; c++) {
    const [ou, ov, start] = corners[c];
    for (let d = 0; d < 90; d += 10) {
      const t = ((start + d) * Math.PI) / 180;
      local.push({ u: ou + r * Math.cos(t), v: ov + r * Math.sin(t), nu: Math.cos(t), nv: Math.sin(t) });
    }
    const [nu0, nv0] = [Math.cos(((start + 90) * Math.PI) / 180), Math.sin(((start + 90) * Math.PI) / 180)];
    const [nx, nz] = corners[(c + 1) % 4];
    const fromU = ou + r * nu0, fromV = ov + r * nv0, toU = nx + r * nu0, toV = nz + r * nv0;
    const n = Math.max(1, Math.round(Math.hypot(toU - fromU, toV - fromV) / 3));
    for (let k = 0; k < n; k++) local.push({ u: fromU + ((toU - fromU) * k) / n, v: fromV + ((toV - fromV) * k) / n, nu: nu0, nv: nv0 });
  }
  let s = 0;
  return local.map((p, i) => {
    if (i) s += Math.hypot(p.u - local[i - 1].u, p.v - local[i - 1].v);
    return {
      x: cx + p.u * W[0] + p.v * L[0], z: cz + p.u * W[1] + p.v * L[1],
      nx: p.nu * W[0] + p.nv * L[0], nz: p.nu * W[1] + p.nv * L[1], s, u: p.u, v: p.v, nu: p.nu, nv: p.nv,
    };
  });
}

/** Seating section profile in (outward distance, height above the field). */
function profile() {
  const points: [number, number][] = [[0, 0], [0, 1.8]];
  let t = 0, y = 1.8;
  const rows = (depth: number, rise: number, until: number) => {
    while (t + depth <= until + 1e-6) { t += depth; points.push([t, y]); y += rise; points.push([t, y]); }
  };
  rows(0.85, 0.4, 27.2);
  // Lower concourse, then the suite/club fascia lifting the upper deck.
  t += 3; points.push([t, y]);
  y += 6.5; points.push([t, y]);
  const suite = points.length - 1;
  rows(0.85, 0.52, 140);
  return { points, suite };
}

export function buildStadiumBowl(footprints: Building[], ground: (x: number, z: number) => number, grid?: CoverageGrid, options: StadiumBowlOptions = {}) {
  const rings = footprints.map(b => cleanRing(b.rings[0]));
  const inside = (x: number, z: number) => rings.some(r => pointInRing(x, z, r));
  const samples = perimeter();
  const { center: [fcx, fcz], angle, halfWidth: hw, halfLength: hl } = STADIUM_FIELD;
  // Field level: the highest baked ground across the opening, so turf never sinks.
  let fieldY = -Infinity;
  for (let u = -hw; u <= hw; u += 6) for (let v = -hl; v <= hl; v += 6)
    fieldY = Math.max(fieldY, ground(fcx + u * Math.cos(angle) + v * Math.sin(angle), fcz - u * Math.sin(angle) + v * Math.cos(angle)));
  fieldY += 0.05;

  // Stand depth along each outward normal, limited to the footprint union.
  let retracted = 0;
  const reach = samples.map(p => {
    let last = 0, outside = 0;
    for (let t = 0.75; t < 150; t += 0.75) {
      if (inside(p.x + p.nx * t, p.z + p.nz * t)) { last = t; outside = 0; }
      else if (last > 0 && ++outside > 4) break;
    }
    // Leave existing authored DKR frontage in front of the generated wall.
    while (grid && last > 14 && grid.near(grid.elevated, p.x + p.nx * last, p.z + p.nz * last, 2)) { last -= 1; retracted++; }
    return last;
  });
  const smooth = reach.map((_, i) => {
    const w = [-2, -1, 0, 1, 2].map(k => reach[(i + k + reach.length) % reach.length]).sort((a, b) => a - b);
    return w[2];
  });

  const { points, suite } = profile();
  const builders = new Map<StadiumMaterialKey, MeshBuilder>();
  const builder = (k: StadiumMaterialKey) => { let b = builders.get(k); if (!b) builders.set(k, b = new MeshBuilder()); return b; };
  const collider = new ColliderBuilder();
  const white = new THREE.Color(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
  // Rim cap (m above the field) per side, from the 2017 LiDAR (both stands predate it; b09 shared request 1):
  // east top campus Y 40.1 → 43.0 above the field; north end P95 37.5 → 40.5, also used on the corners.
  // West (seams to the captured stand) and south (limited by its corrected SEZ footprint) keep the generic 50 m.
  const capFor = (p: Sample) => p.nu > 0.7 ? 43.0 : p.nv < -0.7 ? 40.5 : (Math.abs(p.nu) <= 0.7 && Math.abs(p.nv) <= 0.7) ? 40.5 : 50;
  const section = (i: number) => {
    const p = samples[i], tmax = smooth[i], cap = capFor(p);
    let rimIndex = 0;
    for (let k = 0; k < points.length; k++) if (points[k][0] <= tmax && points[k][1] <= cap) rimIndex = k;
    const rimY = points[rimIndex][1];
    return points.map(([t, y], k) => {
      const tt = k <= rimIndex ? t : Math.min(tmax, points[rimIndex][0]), yy = k <= rimIndex ? y : rimY;
      return new THREE.Vector3(p.x + p.nx * tt, fieldY + yy, p.z + p.nz * tt);
    });
  };
  const sections = samples.map((_, i) => section(i));
  const n = samples.length;
  // Scanned sector: west-straight samples inside [vMin, vMax] lose their generated rows, but only
  // once the replacement has committed (a failed commit keeps the generated west stand).
  let requested = options.scanSector ?? null, scanSectorError: string | null = null;
  if (requested && options.commitScan) {
    try { options.commitScan(fieldY); } catch (error) {
      requested = null;
      scanSectorError = error instanceof Error ? error.message : String(error);
      console.error('Stand scan commit failed; building the generated west stand instead.', error);
    }
  }
  const sector = requested;
  const replaced = (i: number) => !!sector && samples[i].nu < -0.99 && samples[i].v >= sector.vMin - 1e-6 && samples[i].v <= sector.vMax + 1e-6;
  const lerpBy = <T extends number[]>(rows: T[], v: number, k: number) => {
    const sorted = [...rows].sort((p, q) => p[0] - q[0]);
    if (v <= sorted[0][0]) return sorted[0][k];
    for (let r = 1; r < sorted.length; r++) if (v <= sorted[r][0]) { const a0 = sorted[r - 1], b0 = sorted[r], f = (v - a0[0]) / (b0[0] - a0[0]); return a0[k] + (b0[k] - a0[k]) * f; }
    return sorted[sorted.length - 1][k];
  };
  let replacedSections = 0, seamWalls = 0;
  let outerRun = 0;
  // Bellmont north (stadium-bellmont-north.ts): its outer-wall quads take a purpose-specific ribbon
  // material with absolute-height UVs; geometry, colliders and every other quad's UVs are unchanged.
  let northRun = 0, northQuads = 0;
  const north = (pi: Sample, pj: Sample, a: THREE.Vector3, b: THREE.Vector3) => inBellmontNorth(pi.nu + pj.nu, pi.nv + pj.nv, (a.x + b.x) / 2, (a.z + b.z) / 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = sections[i], b = sections[j];
    if (sector && replaced(i) && replaced(j)) {
      // Scanned sector: no generated rows/parapet. Keep a closed outer wall just outside the scan
      // crop edge (up to the scanned edge height), a cap over the gap, and a collider-only strip
      // closing the front edge down to the field.
      replacedSections++;
      const pi = samples[i], pj = samples[j];
      const at = (p: Sample, t: number, y: number) => new THREE.Vector3(p.x + p.nx * t, y, p.z + p.nz * t);
      const ei = lerpBy(sector.outer, pi.v, 2), ej = lerpBy(sector.outer, pj.v, 2);
      const ti = lerpBy(sector.outer, pi.v, 1), tj = lerpBy(sector.outer, pj.v, 1);
      const fi = smooth[i] + 0.35, fj = smooth[j] + 0.35, par = sector.parapet ?? 0;
      const outward = new THREE.Vector3(pi.nx + pj.nx, 0, pi.nz + pj.nz).normalize();
      // Outer wall up to the parapet top; the cap (roof deck) stays at rim height behind it.
      const oa = at(pi, fi, fieldY + ei + par), ob = at(pj, fj, fieldY + ej + par);
      const ga = Math.min(ground(oa.x, oa.z), fieldY) - 1.5, gb = Math.min(ground(ob.x, ob.z), fieldY) - 1.5;
      const fk = stadiumFacadeKey(pi.nu + pj.nu, pi.nv + pj.nv), [tu, tv] = STADIUM_FACADE_TILE[fk];
      const len = Math.hypot(ob.x - oa.x, ob.z - oa.z), u0 = outerRun / tu, u1 = (outerRun + len) / tu;
      outerRun += len;
      const qa = oa.clone().setY(ga), qb = ob.clone().setY(gb);
      if (north(pi, pj, oa, ob)) {
        const [w0, w1, w2, w3] = bellmontNorthUv(northRun, len, qa.y, qb.y, ob.y, oa.y);
        builder(BELLMONT_NORTH.key).quad(qa, qb, ob, oa, w0, w1, w2, w3, white, outward);
        northRun += len; northQuads++;
      } else builder(fk).quad(qa, qb, ob, oa, [u0, (ga - fieldY) / tv], [u1, (gb - fieldY) / tv], [u1, (ej + par) / tv], [u0, (ei + par) / tv], white, outward);
      collider.quad(qa, qb, ob, oa);
      // Roof cap at rim height from the clean rim line to the outer wall.
      const ca = at(pi, ti, fieldY + ei), cb = at(pj, tj, fieldY + ej), da = at(pi, fi, fieldY + ei), db = at(pj, fj, fieldY + ej);
      builder('trim').quad(ca, cb, db, da, [0, 0], [1, 0], [1, 0.2], [0, 0.2], white, UP);
      // The scan collider is a 0.5 m grid, so its edge can sit up to one cell inside the rim line:
      // the cap collider reaches 0.6 m under the scan edge to leave no slot.
      collider.quad(at(pi, ti - 0.6, fieldY + ei), at(pj, tj - 0.6, fieldY + ej), db, da);
      if (par > 0) {
        // Rim parapet (0.35 m thick) on the clean rim line, its inner face skirted 3 m down so the
        // scan's trimmed edge meets a closed face whatever its local height.
        const box = (t0: number, t1: number) => {
          const p0 = at(pi, t0, fieldY + ei - 3), p1 = at(pj, t0, fieldY + ej - 3), p2 = at(pj, t0, fieldY + ej + par), p3 = at(pi, t0, fieldY + ei + par);
          const q0 = at(pi, t1, fieldY + ei - 0.3), q1 = at(pj, t1, fieldY + ej - 0.3), q2 = at(pj, t1, fieldY + ej + par), q3 = at(pi, t1, fieldY + ei + par);
          builder('trim').quad(p0, p1, p2, p3, [0, 0], [1, 0], [1, 0.2], [0, 0.2], white, outward.clone().negate());
          builder('trim').quad(q1, q0, q3, q2, [0, 0], [1, 0], [1, 0.2], [0, 0.2], white, outward);
          builder('trim').quad(p3, p2, q2, q3, [0, 0], [1, 0], [1, 0.1], [0, 0.1], white, UP);
          collider.quad(p0, p1, p2, p3); collider.quad(q1, q0, q3, q2); collider.quad(p3, p2, q2, q3);
        };
        box(ti, ti + 0.35);
        // Outer coping on top of the outer wall.
        const ia = at(pi, fi - 0.35, fieldY + ei + par), ib = at(pj, fj - 0.35, fieldY + ej + par);
        builder('trim').quad(ia, ib, ob, oa, [0, 0], [1, 0], [1, 0.1], [0, 0.1], white, UP);
        const ka = at(pi, fi - 0.35, fieldY + ei), kb = at(pj, fj - 0.35, fieldY + ej);
        builder('trim').quad(kb, ka, ia, ib, [0, 0], [1, 0], [1, 0.2], [0, 0.2], white, outward.clone().negate());
        collider.quad(ia, ib, ob, oa); collider.quad(kb, ka, ia, ib);
      }
      const hfi = lerpBy(sector.front, pi.v, 1), hfj = lerpBy(sector.front, pj.v, 1);
      if (hfi > 0.02 || hfj > 0.02) {
        // Front wall from the turf up to the scanned front row (the scan's own front is ragged).
        const f0 = at(pi, 0, fieldY - 0.2), f1 = at(pj, 0, fieldY - 0.2), f2 = at(pj, 0, fieldY + hfj), f3 = at(pi, 0, fieldY + hfi);
        builder('stadiumRiser').quad(f0, f1, f2, f3, [pi.s / 2, 0], [pj.s / 2, 0], [pj.s / 2, hfj / 2], [pi.s / 2, hfi / 2], white, outward.clone().negate());
        collider.quad(f0, f1, f2, f3);
      }
      continue;
    }
    const s0 = samples[i].s, s1 = j ? samples[j].s : samples[i].s + Math.hypot(samples[0].x - samples[i].x, samples[0].z - samples[i].z);
    const inward = new THREE.Vector3(-(samples[i].nx + samples[j].nx), 0, -(samples[i].nz + samples[j].nz)).normalize();
    for (let k = 0; k + 1 < points.length; k++) {
      const horizontal = points[k][1] === points[k + 1][1];
      const key: StadiumMaterialKey = horizontal ? 'stadiumSeat' : k === suite - 1 ? 'stadiumSuite' : 'stadiumRiser';
      const [t0, y0] = points[k], [t1, y1] = points[k + 1];
      const uv: [Point, Point, Point, Point] = horizontal
        ? [[s0 / 0.5, t0 / 0.85], [s1 / 0.5, t0 / 0.85], [s1 / 0.5, t1 / 0.85], [s0 / 0.5, t1 / 0.85]]
        : key === 'stadiumSuite' ? [[s0 / 4, 0], [s1 / 4, 0], [s1 / 4, 1], [s0 / 4, 1]]
          : [[s0 / 2, y0 / 2], [s1 / 2, y0 / 2], [s1 / 2, y1 / 2], [s0 / 2, y1 / 2]];
      const pa = a[k], pb = b[k], pc = b[k + 1], pd = a[k + 1];
      if (pa.distanceToSquared(pd) < 1e-8 && pb.distanceToSquared(pc) < 1e-8) continue;
      builder(key).quad(pa, pb, pc, pd, uv[0], uv[1], uv[2], uv[3], white, horizontal ? UP : inward);
      collider.quad(pa, pb, pc, pd);
    }
    // Rim parapet and the outer facade down to the ground.
    const ra = a[a.length - 1], rb = b[b.length - 1];
    const outward = inward.clone().negate();
    const top = 1.2;
    const ta = ra.clone().setY(ra.y + top), tb = rb.clone().setY(rb.y + top);
    builder('stadiumRiser').quad(ra, rb, tb, ta, [s0 / 2, 0], [s1 / 2, 0], [s1 / 2, 0.6], [s0 / 2, 0.6], white, inward);
    const oa = ra.clone().addScaledVector(outward, 0.35), ob = rb.clone().addScaledVector(outward, 0.35);
    const ota = oa.clone().setY(ta.y), otb = ob.clone().setY(tb.y);
    builder('trim').quad(ta, tb, otb, ota, [0, 0], [1, 0], [1, 0.2], [0, 0.2], white, UP);
    const ga = Math.min(ground(oa.x, oa.z), fieldY) - 1.5, gb = Math.min(ground(ob.x, ob.z), fieldY) - 1.5;
    const fk = stadiumFacadeKey(samples[i].nu + samples[j].nu, samples[i].nv + samples[j].nv), [tu, tv] = STADIUM_FACADE_TILE[fk];
    const len = Math.hypot(ob.x - oa.x, ob.z - oa.z), u0 = outerRun / tu, u1 = (outerRun + len) / tu;
    outerRun += len;
    if (north(samples[i], samples[j], oa, ob)) {
      const [w0, w1, w2, w3] = bellmontNorthUv(northRun, len, ga, gb, otb.y, ota.y);
      builder(BELLMONT_NORTH.key).quad(oa.clone().setY(ga), ob.clone().setY(gb), otb, ota, w0, w1, w2, w3, white, outward);
      northRun += len; northQuads++;
    } else builder(fk).quad(oa.clone().setY(ga), ob.clone().setY(gb), otb, ota,
      [u0, (ga - fieldY) / tv], [u1, (gb - fieldY) / tv], [u1, (otb.y - fieldY) / tv], [u0, (ota.y - fieldY) / tv], white, outward);
    collider.quad(oa.clone().setY(ga), ob.clone().setY(gb), otb, ota);
  }
  // Authored press-box massing on the cap, fitted to the surviving scanned slab extents.
  const pressBox = sector?.pressBox ?? null;
  if (sector && pressBox) {
    const Lx = Math.sin(angle), Lz = Math.cos(angle), Wx = Math.cos(angle), Wz = -Math.sin(angle);
    const fp = (t: number, v: number, y: number) => { const u = -hw - t; return new THREE.Vector3(fcx + u * Wx + v * Lx, y, fcz + u * Wz + v * Lz); };
    let base = Infinity; for (let v = pressBox.vMin; v <= pressBox.vMax; v += 1) base = Math.min(base, lerpBy(sector.outer, v, 2));
    const y0 = fieldY + base - 0.3, y1 = fieldY + pressBox.top, { t0, t1, vMin: va, vMax: vb } = pressBox;
    const c = [fp(t0, va, y0), fp(t0, vb, y0), fp(t0, vb, y1), fp(t0, va, y1), fp(t1, va, y0), fp(t1, vb, y0), fp(t1, vb, y1), fp(t1, va, y1)];
    const toField = new THREE.Vector3(-Wx, 0, -Wz).negate(); // +u: toward the field
    const faces: [number[], StadiumMaterialKey, THREE.Vector3][] = [
      [[0, 1, 2, 3], 'stadiumSuite', toField], [[5, 4, 7, 6], 'trim', toField.clone().negate()],
      [[4, 0, 3, 7], 'trim', new THREE.Vector3(-Lx, 0, -Lz)], [[1, 5, 6, 2], 'trim', new THREE.Vector3(Lx, 0, Lz)], [[3, 2, 6, 7], 'trim', UP],
    ];
    for (const [q, key, facing] of faces) {
      const w = q.map(k => c[k]), span = w[0].distanceTo(w[1]), hgt = w[0].distanceTo(w[3]);
      builder(key).quad(w[0], w[1], w[2], w[3], [0, 0], [span / 4, 0], [span / 4, key === 'stadiumSuite' ? Math.max(1, hgt / 4) : hgt / 2], [0, key === 'stadiumSuite' ? Math.max(1, hgt / 4) : hgt / 2], white, facing);
      collider.quad(w[0], w[1], w[2], w[3]);
    }
  }
  // Seam walls on the two boundary sections of the scanned sector: from below the field up to the
  // higher of the generated profile and the scanned surface, so no gap opens between them.
  if (sector) for (let i = 0; i < n; i++) {
    if (!replaced(i)) continue;
    const prev = (i - 1 + n) % n, next = (i + 1) % n;
    if (replaced(prev) && replaced(next)) continue;
    const p = samples[i], profileScan = Math.abs(p.v - sector.vMin) < Math.abs(p.v - sector.vMax) ? sector.seamMin : sector.seamMax;
    const sec = sections[i].map(q => [Math.hypot(q.x - p.x, q.z - p.z), q.y - fieldY] as [number, number]);
    const gen = (t: number) => { let y = -Infinity; for (const [tt, yy] of sec) if (tt <= t + 1e-6) y = Math.max(y, yy); return t <= sec[sec.length - 1][0] + 1e-6 ? y : -Infinity; };
    const scanAt = (t: number) => { const k = Math.round(t / sector.step); const h = profileScan[k]; return h ?? -Infinity; };
    const tEnd = smooth[i] + 0.35, step = sector.step;
    const along = new THREE.Vector3(-p.nz, 0, p.nx); // in-plane normal of the section wall
    for (let t = 0; t < tEnd - 1e-6; t += step) {
      const t1 = Math.min(tEnd, t + step);
      const top0 = Math.max(gen(t), scanAt(t), 0), top1 = Math.max(gen(t1), scanAt(t1), 0);
      const w = (tt: number, y: number) => new THREE.Vector3(p.x + p.nx * tt, y, p.z + p.nz * tt);
      const b0 = Math.min(ground(w(t, 0).x, w(t, 0).z), fieldY) - 1.5, b1 = Math.min(ground(w(t1, 0).x, w(t1, 0).z), fieldY) - 1.5;
      const q = [w(t, b0), w(t1, b1), w(t1, fieldY + top1), w(t, fieldY + top0)] as const;
      builder('stadiumRiser').quad(q[0], q[1], q[2], q[3], [t / 2, b0 / 2], [t1 / 2, b1 / 2], [t1 / 2, top1 / 2], [t / 2, top0 / 2], white, along);
      builder('stadiumRiser').quad(q[1], q[0], q[3], q[2], [t1 / 2, b1 / 2], [t / 2, b0 / 2], [t / 2, top0 / 2], [t1 / 2, top1 / 2], white, along.clone().negate());
      collider.quad(q[0], q[1], q[2], q[3]);
    }
    seamWalls++;
  }
  // Turf with local field UVs (0..1 across the full sideline-to-sideline plate).
  const field = builder('stadiumField');
  const ring = samples.map(p => new THREE.Vector2(p.x, p.z));
  const faces = THREE.ShapeUtils.triangulateShape(ring, []);
  const { center: [mcx, mcz], angle: ma } = STADIUM_MARKINGS;
  const local = (x: number, z: number): Point => {
    const dx = x - mcx, dz = z - mcz;
    const u = dx * Math.cos(ma) - dz * Math.sin(ma), v = dx * Math.sin(ma) + dz * Math.cos(ma);
    return [(u + hw) / (2 * hw), (v + hl) / (2 * hl)];
  };
  for (const [i, j, k] of faces) {
    const a = new THREE.Vector3(ring[i].x, fieldY, ring[i].y), b = new THREE.Vector3(ring[j].x, fieldY, ring[j].y), c = new THREE.Vector3(ring[k].x, fieldY, ring[k].y);
    field.tri(a, b, c, local(a.x, a.z), local(b.x, b.z), local(c.x, c.z), white, UP);
    collider.tri(a, b, c);
  }
  let triangles = 0;
  for (const b of builders.values()) triangles += b.triangles;
  return {
    builders, collider,
    /** Per perimeter sample: field-frame position/normal and the stand depth actually built. */
    sectionInfo: samples.map((p, i) => ({ x: p.x, z: p.z, u: p.u, v: p.v, nu: p.nu, nv: p.nv, reach: smooth[i] })),
    stats: { fieldY, sections: n, rimMaxHeight: Math.max(...sections.map(s => s[s.length - 1].y)) - fieldY,
      meanDepth: smooth.reduce((a, b) => a + b, 0) / n, retractedMetres: retracted, triangles, colliderTriangles: collider.triangles,
      scanSector: sector ? { side: sector.side, vMin: sector.vMin, vMax: sector.vMax, replacedSections, seamWalls, pressBox: !!pressBox } : null, scanSectorError,
      bellmontNorth: { quads: northQuads, wallMetres: +northRun.toFixed(2) } },
  };
}
