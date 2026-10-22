// b05 South Mall (south of z 170) and the Littlefield Fountain (Pompeo Coppini / Paul Cret, 1933).
// Evidence: research/whole-campus-92/b05-southmall/EVIDENCE.md (round 2). Every walkable surface below is
// rendered and collided from the same triangles; heights follow the 2017 USGS LiDAR DTM (south-mall-lidar.json)
// and never drop below the visible baked ground (max(LiDAR, ground + 0.03)), so nothing is buried. Where the baked
// terrain is higher than the LiDAR (the fountain plaza, z 228-250), the surfaces follow the terrain and shared
// request b05-r3 asks for the re-bake; after it, the same code lands on the LiDAR levels.
// Frame: s along the South Mall axis (south), t across it (east); axis from central-malls.ts (b04).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { BlockInstallContext } from '../types';
import type { Point } from '../../types';
import lidar from './south-mall-lidar.json' with { type: 'json' };

const O: Point = [-217.36, 36.64];
const S: Point = [-0.0838766, 0.9964762];
const E: Point = [S[1], -S[0]];
export const toWorld = (s: number, t: number): Point => [O[0] + S[0] * s + E[0] * t, O[1] + S[1] * s + E[1] * t];
export const toLocal = (x: number, z: number): [number, number] => { const dx = x - O[0], dz = z - O[1]; return [dx * S[0] + dz * S[1], dx * E[0] + dz * E[1]]; };

/** Plan of the authored South Mall / fountain (local s,t metres; heights campus Y). Estimates are labelled. */
export const SM = {
  cell: 0.5,
  zMin: 170.0, // b04 owns z < 170
  lawn: { s0: 131.5, s1: 180.5, t0: -20.0, t1: 18.5 }, // walks' inner edges (OSM 126328774 / 206164862, 3.0 m width = estimate)
  walkW: { t0: -23.0, t1: -20.0 }, walkE: { t0: 18.5, t1: 21.5 },
  terrace: { s0: 180.5, s1: 187.5, t0: -24.0, t1: 22.5, y: 9.12, eastExt: { s1: 189.5, t0: 13.5 } }, // LiDAR DTM 9.1-9.2 plateau
  stairW: { s0: 187.5, t0: -24.0, t1: -21.0, risers: 7, tread: 0.4 }, // OSM steps 206164865; LiDAR 9.1 -> 8.1
  stairE: { s0: 189.5, t0: 18.0, t1: 21.0, risers: 7, tread: 0.4 }, // OSM steps 1512289450; LiDAR 9.1 -> 8.1
  plaza: { s0: 187.5, s1: 229.0, t0: -27.0, t1: 24.5 },
  tf: -0.5, // fountain axis offset (LiDAR water outline centre)
  backWall: { s0: 187.5, s1: 189.0, t0: -6.5, t1: 5.5, top: 10.6, pedestal: { t0: -2.5, t1: 1.5, top: 11.4 } }, // LiDAR DSM
  hedgeW: { s0: 187.5, s1: 189.0, t0: -18.5, t1: -6.5, top: 9.6 }, hedgeE: { s0: 187.5, s1: 189.0, t0: 5.5, t1: 13.5, top: 9.6 }, // atlas; height estimate
  upperPool: { s0: 189.0, s1: 203.5, t0: -5.75, t1: 4.75, coping: 0.4, water: 7.72, copingTop: 7.9 }, // LiDAR no-return region
  cascade: { s0: 203.5, s1: 205.29, mid: 204.5, halfA: 8.0, halfB: 11.0 }, // s1 = basin coping outer north edge // atlas overview (two curved tiers); widths estimated
  basinCoping: 0.45, basinWater: 6.5, basinCopingTop: 6.7, // LiDAR rim/plaza readings
  lawnRing: { north: -8.5, side: 20.5, south: 12.5 }, // atlas: grass crescent around the lower basin (estimate)
};
const C = lidar.lowerBasinWaterOutline.centre as Point;
const [sC] = toLocal(C[0], C[1]);

const dtm = lidar.dtm as { x0: number; z0: number; step: number; nx: number; nz: number; y: (number | null)[][] };
/** LiDAR ground (bilinear, 1 m), or null outside / missing. */
export function lidarGround(x: number, z: number): number | null {
  const fx = (x - dtm.x0) / dtm.step, fz = (z - dtm.z0) / dtm.step, i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= dtm.nx - 1 || j >= dtm.nz - 1) return null;
  const a = dtm.y[j][i], b = dtm.y[j][i + 1], c = dtm.y[j + 1][i], d = dtm.y[j + 1][i + 1];
  if (a === null || b === null || c === null || d === null) return null;
  const u = fx - i, v = fz - j;
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

const pip = (x: number, z: number, r: Point[]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > z) !== (r[j][1] > z) && x < (r[j][0] - r[i][0]) * (z - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };
function nearestOnRing(x: number, z: number, r: Point[]): Point {
  let best = Infinity, bx = x, bz = z;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz;
    const t = l ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l)) : 0, px = a[0] + dx * t, pz = a[1] + dz * t, d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < best) { best = d; bx = px; bz = pz; }
  }
  return [bx, bz];
}
function offsetOutline(r: Point[], d: number): Point[] { // outward offset for a CCW-or-CW ring via vertex normals
  const n = r.length, area = r.reduce((s, p, i) => s + p[0] * r[(i + 1) % n][1] - r[(i + 1) % n][0] * p[1], 0), sg = area > 0 ? 1 : -1;
  return r.map((p, i) => {
    const a = r[(i + n - 1) % n], b = r[(i + 1) % n], tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
    return [p[0] + sg * (tz / l) * d, p[1] - sg * (tx / l) * d] as Point;
  });
}
/** Local-frame parametric outline around the fountain centre (north cut, side half-width, south semi-ellipse). */
function crescent(north: number, side: number, south: number, northHalf: (s: number) => number): Point[] {
  const pts: Point[] = [], n = 40;
  for (let i = 0; i <= n; i++) { const s = north + (south - north) * i / n, h = s < 0 ? northHalf(s) : side * Math.sqrt(Math.max(0, 1 - (s / south) ** 2)); pts.push(toWorld(sC + s, SM.tf + h)); }
  for (let i = n - 1; i >= 1; i--) { const s = north + (south - north) * i / n, h = s < 0 ? northHalf(s) : side * Math.sqrt(Math.max(0, 1 - (s / south) ** 2)); pts.push(toWorld(sC + s, SM.tf - h)); }
  return pts;
}

class Tris {
  p: number[] = [];
  push(...v: THREE.Vector3[]) { for (const q of v) this.p.push(q.x, q.y, q.z); }
  /** Triangle with winding chosen so the normal points along `facing`. */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, facing: THREE.Vector3) {
    const n = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(c, a));
    if (n.lengthSq() < 1e-10) return;
    if (n.dot(facing) < 0) this.push(a, c, b); else this.push(a, b, c);
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, facing: THREE.Vector3) { this.tri(a, b, c, facing); this.tri(a, c, d, facing); }
  get count() { return this.p.length / 9; }
}
const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
const v3 = (p: Point, y: number) => new THREE.Vector3(p[0], y, p[1]);

/** Closed prism over a plan polygon (world) from per-vertex bottom to a flat top, outward walls + top cap. */
/** `edgeBottom(i)` raises the bottom of wall i where it touches a neighbouring solid (only the exposed part is
 * built, so no wall face sits inside another volume); return >= top to omit the wall. */
function prism(t: Tris, ring: Point[], bottom: (p: Point) => number, top: number, cap = true, holes: Point[][] = [], edgeBottom: (i: number) => number | null = () => null) {
  const n = ring.length, cx = ring.reduce((s, p) => s + p[0], 0) / n, cz = ring.reduce((s, p) => s + p[1], 0) / n;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, eb = edgeBottom(i);
    if (eb !== null && eb >= top - 1e-3) continue;
    const out = new THREE.Vector3(b[1] - a[1], 0, -(b[0] - a[0])); if (out.x * (mx - cx) + out.z * (mz - cz) < 0) out.negate();
    t.quad(v3(a, eb ?? bottom(a)), v3(b, eb ?? bottom(b)), v3(b, top), v3(a, top), out);
  }
  if (cap) capPolygon(t, ring, top, UP, holes);
}
function capPolygon(t: Tris, ring: Point[], y: number, facing: THREE.Vector3, holes: Point[][] = []) {
  const all = [...ring, ...holes.flat()];
  const tris = THREE.ShapeUtils.triangulateShape(ring.map(p => new THREE.Vector2(p[0], p[1])), holes.map(h => h.map(p => new THREE.Vector2(p[0], p[1]))));
  for (const [i, j, k] of tris) t.tri(v3(all[i], y), v3(all[j], y), v3(all[k], y), facing);
}
/** Ring band between an inner and an outer outline (same vertex count), flat at y, plus inner/outer walls. */
function band(t: Tris, inner: Point[], outer: Point[], top: number, outerBottom: (p: Point) => number, innerBottom: number, skipOuter: Set<number> = new Set()) {
  const n = inner.length, cx = inner.reduce((s, p) => s + p[0], 0) / n, cz = inner.reduce((s, p) => s + p[1], 0) / n;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    t.quad(v3(inner[i], top), v3(inner[j], top), v3(outer[j], top), v3(outer[i], top), UP);
    if (skipOuter.has(i)) { const mi0: Point = [(inner[i][0] + inner[j][0]) / 2, (inner[i][1] + inner[j][1]) / 2]; t.quad(v3(inner[i], innerBottom), v3(inner[j], innerBottom), v3(inner[j], top), v3(inner[i], top), new THREE.Vector3(cx - mi0[0], 0, cz - mi0[1])); continue; }
    const mo: Point = [(outer[i][0] + outer[j][0]) / 2, (outer[i][1] + outer[j][1]) / 2];
    t.quad(v3(outer[i], outerBottom(outer[i])), v3(outer[j], outerBottom(outer[j])), v3(outer[j], top), v3(outer[i], top), new THREE.Vector3(mo[0] - cx, 0, mo[1] - cz));
    const mi: Point = [(inner[i][0] + inner[j][0]) / 2, (inner[i][1] + inner[j][1]) / 2];
    t.quad(v3(inner[i], innerBottom), v3(inner[j], innerBottom), v3(inner[j], top), v3(inner[i], top), new THREE.Vector3(cx - mi[0], 0, cz - mi[1]));
  }
}
/** Box in the local frame (s,t ranges) from bottom(p) to top. */
const rectRing = (s0: number, s1: number, t0: number, t1: number): Point[] => [toWorld(s0, t0), toWorld(s0, t1), toWorld(s1, t1), toWorld(s1, t0)];

export interface SouthMallBuild {
  walkable: Map<string, Tris>; solid: Map<string, Tris>; water: Tris;
  stats: Record<string, unknown>;
}

export function buildSouthMall(ctx: BlockInstallContext) {
  const g = (x: number, z: number) => ctx.groundHeight(x, z);
  const H = (x: number, z: number) => Math.max(lidarGround(x, z) ?? -Infinity, g(x, z) + 0.03);
  const T = (x: number, z: number) => Math.max(SM.terrace.y, g(x, z) + 0.03);
  const walkable = new Map<string, Tris>(), solid = new Map<string, Tris>(), water = new Tris();
  const W = (k: string) => { let x = walkable.get(k); if (!x) walkable.set(k, x = new Tris()); return x; };
  const Sd = (k: string) => { let x = solid.get(k); if (!x) solid.set(k, x = new Tris()); return x; };
  const tf = SM.tf;

  // ---- fountain outlines and dynamic water levels (never below the visible ground inside) ----
  const basinWater = lidar.lowerBasinWaterOutline.ring as Point[];
  const basinOuter = offsetOutline(basinWater, SM.basinCoping);
  const northHalf = (s: number) => 14 - 0.075 * s * s; // same as basin_fit.py
  const lawnRing = crescent(SM.lawnRing.north, SM.lawnRing.side, SM.lawnRing.south, s => northHalf(s) + 6.5);
  const maxGroundIn = (ring: Point[]) => { let m = -Infinity; const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.5) for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.5) if (pip(x, z, ring)) m = Math.max(m, g(x, z)); return m; };
  const up = SM.upperPool;
  const upperWaterRing = rectRing(up.s0, up.s1, tf + up.t0, tf + up.t1);
  const waterL = Math.max(SM.basinWater, maxGroundIn(basinWater) + 0.04);
  const copingL = Math.max(SM.basinCopingTop, waterL + 0.2);
  const waterU = Math.max(up.water, maxGroundIn(upperWaterRing) + 0.04, waterL + 0.5);
  const copingU = Math.max(up.copingTop, waterU + 0.18);

  // ---- ground grid (local s,t cells) ----
  type Zone = 'lawn' | 'walk' | 'terrace' | 'plaza' | 'plazaLawn' | `stairW${number}` | `stairE${number}`;
  const cs = SM.cell;
  const inR = (s: number, t: number, r: { s0: number; s1: number; t0: number; t1: number }) => s > r.s0 && s < r.s1 && t > r.t0 && t < r.t1;
  const excluded = (s: number, t: number) =>
    inR(s, t, { s0: SM.backWall.s0, s1: SM.backWall.s1, t0: tf + SM.backWall.t0, t1: tf + SM.backWall.t1 }) ||
    inR(s, t, { s0: SM.hedgeW.s0, s1: SM.hedgeW.s1, t0: tf + SM.hedgeW.t0, t1: tf + SM.hedgeW.t1 }) ||
    inR(s, t, { s0: SM.hedgeE.s0, s1: SM.hedgeE.s1, t0: tf + SM.hedgeE.t0, t1: tf + SM.hedgeE.t1 }) ||
    inR(s, t, { s0: up.s0, s1: up.s1, t0: tf + up.t0 - up.coping, t1: tf + up.t1 + up.coping }) ||
    inR(s, t, { s0: SM.cascade.s0, s1: SM.cascade.mid, t0: tf - SM.cascade.halfA - 0.4, t1: tf + SM.cascade.halfA + 0.4 }) ||
    inR(s, t, { s0: SM.cascade.mid, s1: SM.cascade.s1, t0: tf - SM.cascade.halfB - 0.4, t1: tf + SM.cascade.halfB + 0.4 });
  const zoneOf = (s: number, t: number): Zone | null => {
    const [x, z] = toWorld(s, t);
    if (z < SM.zMin) return null;
    const st = (r: typeof SM.stairW, tag: 'stairW' | 'stairE') => (t > r.t0 && t < r.t1 && s > r.s0 && s < r.s0 + r.risers * r.tread) ? `${tag}${Math.floor((s - r.s0) / r.tread)}` as Zone : null;
    const sw = st(SM.stairW, 'stairW') ?? st(SM.stairE, 'stairE'); if (sw) return sw;
    if (inR(s, t, SM.lawn)) return 'lawn';
    if ((s > SM.lawn.s0 && s < SM.lawn.s1) && ((t > SM.walkW.t0 && t < SM.walkW.t1) || (t > SM.walkE.t0 && t < SM.walkE.t1))) return 'walk';
    const tr = SM.terrace;
    if (inR(s, t, tr) || (s > tr.s1 && s < tr.eastExt.s1 && t > tr.eastExt.t0 && t < tr.t1)) return 'terrace';
    if (inR(s, t, SM.plaza)) {
      if (excluded(s, t) || pip(x, z, basinOuter)) return null;
      return pip(x, z, lawnRing) ? 'plazaLawn' : 'plaza';
    }
    return null;
  };
  const hGroup = (zn: Zone) => zn === 'terrace' ? 'T' : zn.startsWith('stair') ? zn : 'H';
  const stairY = new Map<string, number>();
  const treadY = (zn: Zone) => {
    let y = stairY.get(zn); if (y !== undefined) return y;
    const r = zn.startsWith('stairW') ? SM.stairW : SM.stairE, k = +zn.slice(6), s0 = r.s0 + k * r.tread;
    let m = -Infinity; for (let s = s0; s <= s0 + r.tread + 1e-6; s += r.tread / 2) for (let t = r.t0; t <= r.t1 + 1e-6; t += 0.5) { const [x, z] = toWorld(s, t); m = Math.max(m, g(x, z)); }
    y = Math.max(SM.terrace.y - (SM.terrace.y - 8.12) * (k + 1) / r.risers, m + 0.03); stairY.set(zn, y); return y;
  };
  const heightAt = (zn: Zone, p: Point) => { const gr = hGroup(zn); return gr === 'H' ? H(p[0], p[1]) : gr === 'T' ? T(p[0], p[1]) : treadY(zn); };
  const matOf = (zn: Zone) => zn === 'lawn' || zn === 'plazaLawn' ? 'lawn' : zn.startsWith('stair') ? 'stone' : 'paving';
  const s0 = SM.lawn.s0, s1 = SM.plaza.s1, t0 = SM.plaza.t0, t1 = SM.plaza.t1;
  const ns = Math.round((s1 - s0) / cs), nt = Math.round((t1 - t0) / cs);
  const zones: (Zone | null)[][] = [];
  for (let i = 0; i < ns; i++) { const row: (Zone | null)[] = []; for (let j = 0; j < nt; j++) row.push(zoneOf(s0 + (i + 0.5) * cs, t0 + (j + 0.5) * cs)); zones.push(row); }
  const zAt = (i: number, j: number) => (i < 0 || j < 0 || i >= ns || j >= nt ? null : zones[i][j]);
  let cells = 0, lawnCells = 0;
  const snapped = new Set<string>();
  for (let i = 0; i < ns; i++) for (let j = 0; j < nt; j++) {
    const zn = zones[i][j]; if (!zn) continue;
    const corners: Point[] = [toWorld(s0 + i * cs, t0 + j * cs), toWorld(s0 + (i + 1) * cs, t0 + j * cs), toWorld(s0 + (i + 1) * cs, t0 + (j + 1) * cs), toWorld(s0 + i * cs, t0 + (j + 1) * cs)];
    let poly: Point[] = corners;
    // Snap onto the basin coping outline / the lawn crescent so curved edges are smooth (no 0.5 m stair-step).
    if (zn === 'plaza' || zn === 'plazaLawn') poly = poly.map(p => {
      let q = p;
      const inL = pip(q[0], q[1], lawnRing);
      if ((zn === 'plaza') === inL) { q = nearestOnRing(q[0], q[1], lawnRing); snapped.add(`${i},${j}`); }
      if (pip(q[0], q[1], basinOuter)) { q = nearestOnRing(q[0], q[1], basinOuter); snapped.add(`${i},${j}`); }
      return q;
    });
    // Exact clip to the b04 boundary z >= 170 (convex cell, one half-plane).
    if (poly.some(p => p[1] < SM.zMin)) {
      const out: Point[] = [];
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length], ia = a[1] >= SM.zMin, ib = b[1] >= SM.zMin;
        if (ia) out.push(a);
        if (ia !== ib) { const u = (SM.zMin - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * u, SM.zMin]); }
      }
      poly = out; snapped.add(`${i},${j}`);
      if (poly.length < 3) continue;
    }
    const tr = W(matOf(zn));
    const pts = poly.map(p => v3(p, heightAt(zn, p)));
    for (let k = 1; k + 1 < pts.length; k++) tr.tri(pts[0], pts[k], pts[k + 1], UP);
    cells++; if (matOf(zn) === 'lawn') lawnCells++;
    if (snapped.has(`${i},${j}`)) continue;
    // Risers / skirts on the 4 grid edges: from this cell's edge down to the neighbour (or below the ground).
    const nb: [number, number, number, number][] = [[i - 1, j, 3, 0], [i + 1, j, 1, 2], [i, j - 1, 0, 1], [i, j + 1, 2, 3]];
    for (const [ni, nj, a, b] of nb) {
      const zn2 = zAt(ni, nj);
      if (zn2 && hGroup(zn2) === hGroup(zn)) continue;
      if (zn2 && snapped.has(`${ni},${nj}`)) continue;
      const pa = corners[a], pb = corners[b], ya = heightAt(zn, pa), yb = heightAt(zn, pb);
      const la = zn2 ? heightAt(zn2, pa) : g(pa[0], pa[1]) - 0.3, lb = zn2 ? heightAt(zn2, pb) : g(pb[0], pb[1]) - 0.3;
      if (ya - la < 0.005 && yb - lb < 0.005) continue;
      const [cxw, czw] = toWorld(s0 + (i + 0.5) * cs, t0 + (j + 0.5) * cs), mx = (pa[0] + pb[0]) / 2, mz = (pa[1] + pb[1]) / 2;
      tr.quad(v3(pa, Math.min(la, ya)), v3(pb, Math.min(lb, yb)), v3(pb, yb), v3(pa, ya), new THREE.Vector3(mx - cxw, 0, mz - czw));
    }
  }

  // ---- solids: back wall + pedestal, hedges, pool copings, cascade, basin coping, sculpture ----
  const below = (p: Point) => g(p[0], p[1]) - 0.3;
  const bw = SM.backWall, stone = Sd('stone');
  const pedRing = rectRing(bw.s0 + 0.2, bw.s1 - 0.2, tf + bw.pedestal.t0, tf + bw.pedestal.t1);
  const hedgeTop = Math.max(SM.hedgeW.top, SM.terrace.y + 0.45);
  // rectRing edges: 0 = north (s0), 1 = east (t1), 2 = south (s1), 3 = west (t0)
  prism(stone, rectRing(bw.s0, bw.s1, tf + bw.t0, tf + bw.t1), below, bw.top, true, [pedRing], i => (i === 1 || i === 3 ? hedgeTop : null));
  prism(stone, pedRing, () => bw.top, bw.pedestal.top);
  prism(Sd('hedge'), rectRing(SM.hedgeW.s0, SM.hedgeW.s1, tf + SM.hedgeW.t0, tf + SM.hedgeW.t1), below, hedgeTop, true, [], i => (i === 1 ? hedgeTop : null));
  prism(Sd('hedge'), rectRing(SM.hedgeE.s0, SM.hedgeE.s1, tf + SM.hedgeE.t0, tf + SM.hedgeE.t1), below, hedgeTop, true, [], i => (i === 3 ? hedgeTop : null));
  // Upper pool: coping on W and E (N is the back wall, S spills into the cascade).
  const copingSolid = Sd('coping'), cc = SM.cascade, yA = waterU - 0.15, yB = (waterU + waterL) / 2;
  for (const [a, b] of [[tf + up.t0 - up.coping, tf + up.t0], [tf + up.t1, tf + up.t1 + up.coping]] as const)
    prism(copingSolid, rectRing(up.s0, up.s1, a, b), below, copingU, true, [], i => (i === 0 ? copingU : i === 2 ? yA : null));
  capPolygon(water, rectRing(up.s0, up.s1, tf + up.t0, tf + up.t1), waterU, UP);
  // Cascade: two tiers (straight weirs in plan = estimate; the atlas shows curved lips), stone with a water film.
  const hA = cc.halfA + 0.4, hB = cc.halfB + 0.4;
  prism(copingSolid, rectRing(cc.s0, cc.mid, tf - hA, tf + hA), below, yA, true, [], i => (i === 2 ? yB : null));
  const ringB: Point[] = [toWorld(cc.mid, tf - hB), toWorld(cc.mid, tf - hA), toWorld(cc.mid, tf + hA), toWorld(cc.mid, tf + hB), toWorld(cc.s1, tf + hB), toWorld(cc.s1, tf - hB)];
  // ringB edges: 0,2 = north outer parts (exposed), 1 = under tier A (omitted), 3 = east, 4 = south (above the basin coping), 5 = west
  prism(copingSolid, ringB, below, yB, true, [], i => (i === 1 ? yB : i === 4 ? copingL : null));
  capPolygon(water, rectRing(cc.s0, cc.mid, tf - cc.halfA, tf + cc.halfA), yA + 0.02, UP);
  capPolygon(water, rectRing(cc.mid, cc.s1, tf - cc.halfB, tf + cc.halfB), yB + 0.02, UP);
  // Lower basin coping ring (granite) and water.
  // Outer wall bottom only 0.05 m under the visible ground (not 0.3 m), so no wall face sits under the walkable skin.
  band(copingSolid, basinWater, basinOuter, copingL, p => Math.min(H(p[0], p[1]), g(p[0], p[1])) - 0.05, waterL - 0.45, new Set([basinWater.length - 1])); // north edge meets tier B
  capPolygon(water, basinWater, waterL, UP);
  // Sculpture group (bronze, schematic): ship hull with its prow to the south, Columbia, two flanking figures,
  // three sea horses. Heights from the LiDAR DSM (top 12.3, front group ~8-9); forms are estimates.
  // No hidden caps or buried inner walls: each stacked prism starts on the top of the one below, whose cap is
  // triangulated with the upper footprint as a hole.
  const br = Sd('bronze'), deck = waterU + 1.75;
  const oct = (s: number, t: number, rad: number, n = 8): Point[] => Array.from({ length: n }, (_, k) => { const a = (k / n) * Math.PI * 2; return toWorld(s + Math.cos(a) * rad, t + Math.sin(a) * rad); });
  const figs: { s: number; t: number; h: number; r: number }[] = [
    { s: 192.1, t: tf, h: Math.max(1.5, lidar.levels.sculptureTop - deck), r: 0.6 }, { s: 193.4, t: tf - 0.85, h: 1.9, r: 0.42 }, { s: 193.4, t: tf + 0.85, h: 1.9, r: 0.42 }];
  const hull: Point[] = [toWorld(190.4, tf - 1.5), toWorld(190.4, tf + 1.5), toWorld(194.5, tf + 1.3), toWorld(196.8, tf), toWorld(194.5, tf - 1.3)];
  prism(br, hull, below, deck, true, figs.map(f => oct(f.s, f.t, f.r)));
  for (const f of figs) {
    const r0 = oct(f.s, f.t, f.r), r1 = oct(f.s, f.t, f.r * 0.55), r2 = oct(f.s, f.t, f.r * 0.32, 6);
    prism(br, r0, () => deck, deck + f.h * 0.62, true, [r1]);
    prism(br, r1, () => deck + f.h * 0.62, deck + f.h * 0.9, true, [r2]);
    prism(br, r2, () => deck + f.h * 0.9, deck + f.h);
  }
  for (const dt of [-2.3, 0, 2.3]) {
    const head = rectRing(198.9, 199.35, tf + dt - 0.3, tf + dt + 0.3);
    prism(br, rectRing(197.4, 199.4, tf + dt - 0.45, tf + dt + 0.45), below, waterU + 0.8, true, [head]);
    prism(br, head, () => waterU + 0.8, waterU + 1.25);
  }
  return {
    walkable, solid, water,
    stats: { cells, lawnCells, waterLower: +waterL.toFixed(2), copingLower: +copingL.toFixed(2), waterUpper: +waterU.toFixed(2), copingUpper: +copingU.toFixed(2),
      stairW: [...Array(SM.stairW.risers).keys()].map(k => +treadY(`stairW${k}` as Zone).toFixed(2)), stairE: [...Array(SM.stairE.risers).keys()].map(k => +treadY(`stairE${k}` as Zone).toFixed(2)) },
  };
}

/** Geometry with planar metre UVs (top-down for flat faces, along the face for walls). */
export function trisGeometry(t: Tris) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(t.p, 3));
  g.computeVertexNormals();
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), uv: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (Math.abs(nor.getY(i)) > 0.7) uv.push(x / 2, z / 2); else uv.push((Math.abs(nor.getX(i)) > Math.abs(nor.getZ(i)) ? z : x) / 2, y / 2);
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}
export function trimeshCollider(physics: RAPIER.World, positions: number[]) {
  const pos = new Float32Array(positions), idx = new Uint32Array(pos.length / 3).map((_, i) => i);
  return physics.createCollider(RAPIER.ColliderDesc.trimesh(pos, idx));
}
export { DOWN };
