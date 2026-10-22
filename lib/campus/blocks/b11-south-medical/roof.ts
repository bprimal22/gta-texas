// b11-south-medical: exact planar hipped roofs (no distance-field grid, so no sawtooth facets).
// A section's roof is the lower envelope y = min_i P_i(x, z) of planes P_i: one per convex-hull edge of the section plan
// (rising inward from that edge line at the eave height with a fixed slope) plus an optional horizontal cap (the frozen
// massing top). Each plane's face is the part of the plan where it is the minimum: every plan triangle is clipped by the
// half-planes P_j - P_i >= 0 (exact, convex), so every emitted roof triangle lies ON its plane and neighbouring faces meet
// along the exact lines P_i = P_j. Wall tops / step faces along an edge are the same envelope evaluated per segment, split
// at every pairwise plane crossing, so roof and walls are watertight.
import * as THREE from 'three';
import type { Point } from '../../types';
import { area, orient, type Kit, type Mat, UP } from './kit';

/** y = a x + b z + c */
export interface Plane { a: number; b: number; c: number }
export const planeY = (p: Plane, x: number, z: number) => p.a * x + p.b * z + p.c;
export const envelope = (ps: Plane[], x: number, z: number) => ps.reduce((m, p) => Math.min(m, planeY(p, x, z)), Infinity);

/** Sutherland-Hodgman: the part of `poly` where A x + B z + K >= 0 (orientation preserved). */
export function clipHalf(poly: Point[], A: number, B: number, K: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], fp = A * p[0] + B * p[1] + K, fq = A * q[0] + B * q[1] + K;
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
  }
  return dedupe(out);
}
export function dedupe(r: Point[], eps = 1e-7): Point[] {
  const out: Point[] = [];
  for (const p of r) { const l = out[out.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > eps) out.push(p); }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps) out.pop();
  return out;
}
/** Convex hull, positive shoelace area (the kit's orientation: edge a->c has outward normal (dz, -dx)/L). */
export function convexHull(pts: Point[]): Point[] {
  const s = [...pts].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cr = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Point[] = [], up: Point[] = [];
  for (const p of s) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of s.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const h = [...lo.slice(0, -1), ...up.slice(0, -1)];
  return area(h) > 0 ? h : h.reverse();
}
/** Hip planes of a section: each hull edge not flagged `open` rises inward from `eave` at `slope`; plus a cap at `top`. */
export function hipPlanes(section: Point[], eave: number, slope: number, top: number, open: (a: Point, c: Point) => boolean): Plane[] {
  const h = convexHull(section), out: Plane[] = [{ a: 0, b: 0, c: top }];
  for (let i = 0; i < h.length; i++) {
    const a = h[i], c = h[(i + 1) % h.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (L < 1e-6 || open(a, c)) continue;
    const nx = -(c[1] - a[1]) / L, nz = (c[0] - a[0]) / L; // inward
    out.push({ a: slope * nx, b: slope * nz, c: eave - slope * (nx * a[0] + nz * a[1]) });
  }
  return out;
}
const same = (p: Plane, q: Plane) => Math.abs(p.a - q.a) < 1e-9 && Math.abs(p.b - q.b) < 1e-9 && Math.abs(p.c - q.c) < 1e-9;

/** A cross gable: inside the convex plan `rect` the roof is max(section envelope, min(planes)); outside it has no effect.
 * Built so that min(planes) equals the eave on the rect's two side lines and dies into the section roof before the
 * rect's inner edge, which keeps the max-surface continuous (no vertical step at the rect boundary). */
export interface Gable { rect: Point[]; planes: Plane[] }
/** A roof section: lower envelope of `hips`, raised by any cross gables. */
export interface RoofSpec { hips: Plane[]; gables: Gable[] }
const halfPlanes = (rect: Point[]) => { const r = orient(rect); return r.map((a, i) => { const c = r[(i + 1) % r.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]), nx = -(c[1] - a[1]) / L, nz = (c[0] - a[0]) / L; return [nx, nz, -(nx * a[0] + nz * a[1])]; }); };
export const inConvex = (rect: Point[], x: number, z: number) => halfPlanes(rect).every(([A, B, K]) => A * x + B * z + K >= -1e-9);
export function roofY(spec: RoofSpec, x: number, z: number) {
  let y = envelope(spec.hips, x, z);
  for (const g of spec.gables) if (inConvex(g.rect, x, z)) y = Math.max(y, envelope(g.planes, x, z));
  return y;
}
type Piece = { poly: Point[]; plane: Plane };
const big = (poly: Point[]) => poly.length >= 3 && Math.abs(area(poly)) > 1e-7;
/** Convex polygon split into the regions where each plane is the minimum (exact half-plane clipping). */
function minPieces(poly: Point[], planes: Plane[]): Piece[] {
  const ps = planes.filter((p, i) => !planes.slice(0, i).some(q => same(p, q))), out: Piece[] = [];
  ps.forEach((p, i) => {
    let reg = poly;
    for (let j = 0; j < ps.length && reg.length >= 3; j++) if (j !== i) reg = clipHalf(reg, ps[j].a - p.a, ps[j].b - p.b, ps[j].c - p.c);
    if (big(reg)) out.push({ poly: reg, plane: p });
  });
  return out;
}
/** Raise pieces by a gable: outside the rect unchanged (disjoint convex split), inside max(piece plane, gable min). */
function applyGable(pieces: Piece[], g: Gable): Piece[] {
  const hp = halfPlanes(g.rect), out: Piece[] = [];
  for (const pc of pieces) {
    let rest = pc.poly;
    for (const [A, B, K] of hp) { const outside = clipHalf(rest, -A, -B, -K); if (big(outside)) out.push({ poly: outside, plane: pc.plane }); rest = clipHalf(rest, A, B, K); if (rest.length < 3) break; }
    if (!big(rest)) continue;
    for (const gp of minPieces(rest, g.planes)) {
      const A = gp.plane.a - pc.plane.a, B = gp.plane.b - pc.plane.b, K = gp.plane.c - pc.plane.c;
      const hi = clipHalf(gp.poly, A, B, K), lo = clipHalf(gp.poly, -A, -B, -K);
      if (big(hi)) out.push({ poly: hi, plane: gp.plane }); if (big(lo)) out.push({ poly: lo, plane: pc.plane });
    }
  }
  return out;
}

/** Emit the roof of `spec` over the (possibly non-convex) plan `poly` as exact planar faces into `k.S(mat)`.
 * Returns the number of distinct planes that produced triangles and the triangle count. */
export function roofFaces(k: Kit, poly: Point[], spec: RoofSpec, color: THREE.Color, mat: Mat = 'metal') {
  const r = orient(poly), v2 = r.map(p => new THREE.Vector2(p[0], p[1]));
  const used: Plane[] = []; let tris = 0;
  for (const [i0, i1, i2] of THREE.ShapeUtils.triangulateShape(v2, [])) {
    let pieces = minPieces([r[i0], r[i1], r[i2]], spec.hips);
    for (const g of spec.gables) pieces = applyGable(pieces, g);
    for (const { poly: reg, plane: p } of pieces) {
      const lift = (q: Point) => new THREE.Vector3(q[0], planeY(p, q[0], q[1]), q[1]);
      for (let m = 1; m + 1 < reg.length; m++) { k.S(mat).tri(lift(reg[0]), lift(reg[m]), lift(reg[m + 1]), color, UP); tris++; }
      if (!used.some(q => same(q, p))) used.push(p);
    }
  }
  return { planes: used.length, triangles: tris };
}

/** Breakpoints of the roofs `specs` along segment a->c: t in [0,1] where every roof is linear between consecutive
 * entries (all pairwise plane crossings + gable rect boundary crossings); y[s][k] = roof of spec s at t[k]. */
export function profile(a: Point, c: Point, specs: RoofSpec[]) {
  const planes = specs.flatMap(s => [...s.hips, ...s.gables.flatMap(g => g.planes)]);
  const lines = planes.map(p => [planeY(p, a[0], a[1]), planeY(p, c[0], c[1]) - planeY(p, a[0], a[1])]); // y = y0 + t m
  const ts = [0, 1];
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const dm = lines[i][1] - lines[j][1]; if (Math.abs(dm) < 1e-12) continue;
    const t = (lines[j][0] - lines[i][0]) / dm; if (t > 1e-9 && t < 1 - 1e-9) ts.push(t);
  }
  for (const g of specs.flatMap(s => s.gables)) for (const [A, B, K] of halfPlanes(g.rect)) {
    const f0 = A * a[0] + B * a[1] + K, f1 = A * c[0] + B * c[1] + K;
    if ((f0 > 0) !== (f1 > 0) && Math.abs(f1 - f0) > 1e-12) { const t = f0 / (f0 - f1); if (t > 1e-9 && t < 1 - 1e-9) ts.push(t); }
  }
  ts.sort((p, q) => p - q);
  const t = ts.filter((v, i) => i === 0 || v - ts[i - 1] > 1e-9);
  const pt = (s: number): Point => [a[0] + (c[0] - a[0]) * s, a[1] + (c[1] - a[1]) * s];
  return { t, pt, y: specs.map(spec => t.map(s => { const p = pt(s); return roofY(spec, p[0], p[1]); })) };
}
