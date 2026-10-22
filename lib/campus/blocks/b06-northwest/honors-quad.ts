// D12 Honors Quad (b06-northwest column b): Andrews + Blanton (one City record 549050:385), Carothers (551320:432) and
// Littlefield Residence Hall (654063:872), rebuilt from the OFFICIAL UT GIS polygons (objects 398 / 452 / 629 / 409)
// cut into wings at the steps of the USGS 3DEP 2017 0.5 m building raster (honors-quad.json, written by the lane-local
// .work/claude-district40/derive.py). Evidence and what stays estimated: HONORS-QUAD-EVIDENCE.md.
//  * Roofs: measured. Hipped wings take the raster P98 as ridge and an eave/slope fitted to the raster P50; an edge shared
//    with a TALLER wing is a party wall (the roof runs into it), every other edge gets an eave. Flat wings sit at the P50.
//    Hipped roofs are EXACT planar facets (honorsRoofs): per part, the lower envelope of the eave planes of its fitted
//    rectangle and a ridge cap, each plane's region cut out by convex clipping; the concave LTD U is three parts (two
//    hipped wings + a central range running into the wing ridge lines, capped no higher than them) joined by their upper
//    envelope, which forms the valleys. Facets are then clipped to the real eave outline, so creases are true lines.
//    LTD's wing ends are hipped in the LiDAR (no gable ridge reaches any end), so the photographed gable is not invented.
//  * Facades: reference-interpreted from the approved d12 orbit views, priority-01 and the UT LTD photograph: tan brick,
//    red clay tile, cream cornice under the eaves, limestone base course (Blanton: pale ground storey and pilaster bays),
//    LTD broad dark bracketed eaves, paired narrow windows and an arched quad loggia; stone entry surrounds on the quad.
//    Bay widths, storey heights and entrance positions are estimates. Windows are flush batched panels, not meshes.
import * as THREE from 'three';
import type { Point } from '../../types';
import { Bucket, Kit, orient, segDist } from './authored-bodies';
import data from './honors-quad.json' with { type: 'json' };

type Stat = { roofY_P50: number; roofY_P98: number; roofY_max: number };
type Piece = { record: string; kind: 'hip' | 'flat'; ring: Point[]; deck?: number; eave?: number; slope?: number; ridge?: number; overhang?: number; lidar: Stat;
  /** exact-plane refit (roof fix 2): explicit rectangle (main-body official long sides) and eave/slope fitted to the same P50/P98 */
  roofRect?: { u: Point; u0: number; u1: number; v0: number; v1: number; party: ('u0' | 'u1' | 'v0' | 'v1')[] }; roofFit?: { eave: number; slope: number; ridge: number } };
type Entrance = { record: string; name: string; at: Point; width: number; height: number; depth: number; style: 'stone' | 'arcade'; arches?: number; door: [number, number] };
export const HQ = data as unknown as { pieces: Record<string, Piece>; chimneys: { record: string; at: Point; size: [number, number]; top: number }[];
  entrances: Entrance[]; quadCourt: Point[]; nearPaths: number[]; omitted: { record: string; ring: Point[] }[] };
export const HONORS_REPLACED = ['549050:385', '551320:432', '654063:872'];
export const HONORS_MATERIALS: Record<string, [string, number, number?]> = {
  tanBrick: ['#c6a47a', 0.9], paleBase: ['#e3ddcf', 0.9], brickShade: ['#ad8d64', 0.92], eaveTrim: ['#5d4939', 0.85],
};

type Style = { storey: number; bay: number; w: number; h: number; paired?: boolean; base: string; baseH: number; soffit: string; pilasterEvery?: number };
const STYLE: Record<string, Style> = {
  AND: { storey: 3.4, bay: 3.1, w: 1.0, h: 1.9, base: 'limestone', baseH: 1.1, soffit: 'limestone' },
  BLD: { storey: 3.05, bay: 3.25, w: 1.05, h: 1.7, base: 'paleBase', baseH: 3.6, soffit: 'limestone', pilasterEvery: 4 },
  CRD: { storey: 3.5, bay: 3.0, w: 1.0, h: 2.0, base: 'limestone', baseH: 1.0, soffit: 'limestone' },
  LTD: { storey: 3.4, bay: 3.4, w: 0.55, h: 1.7, paired: true, base: 'limestone', baseH: 1.4, soffit: 'eaveTrim' },
};
const styleOf = (name: string) => STYLE[name.split('-')[0]] ?? STYLE.AND;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0), DOWN = V(0, -1, 0), PARAPET = 0.5;
const mid = (a: Point, c: Point): Point => [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
const onRing = (a: Point, c: Point, r: Point[], tol = 0.3) => { const m = mid(a, c); return r.some((p, i) => segDist(m[0], m[1], p, r[(i + 1) % r.length]) < tol); };

/** Ring offset with a per-edge distance (outward for an orient()ed ring; 0 keeps a party edge in place). */
function offsetVar(r: Point[], d: number[]): Point[] {
  const n = r.length, line = r.map((a, i) => { const c = r[(i + 1) % n], L = Math.hypot(c[0] - a[0], c[1] - a[1]), nx = (c[1] - a[1]) / L, nz = -(c[0] - a[0]) / L;
    return { p: [a[0] + nx * d[i], a[1] + nz * d[i]] as Point, u: [(c[0] - a[0]) / L, (c[1] - a[1]) / L] as Point, nx, nz }; });
  return r.map((a, i) => {
    const A = line[(i + n - 1) % n], B = line[i], den = A.u[0] * B.u[1] - A.u[1] * B.u[0];
    const fallback: Point = [a[0] + B.nx * d[i], a[1] + B.nz * d[i]];
    if (Math.abs(den) < 0.1) return fallback;   // near-collinear official vertices: no far miter spike
    const t = ((B.p[0] - A.p[0]) * B.u[1] - (B.p[1] - A.p[1]) * B.u[0]) / den, q: Point = [A.p[0] + A.u[0] * t, A.p[1] + A.u[1] * t];
    return Math.hypot(q[0] - a[0], q[1] - a[1]) > 3 * Math.max(Math.abs(d[i]), Math.abs(d[(i + n - 1) % n])) + 0.05 ? fallback : q;
  });
}

// ---- exact piecewise-planar roofs ------------------------------------------------------------------------------
type Pl = [number, number, number];                       // h = a x + b z + c (campus Y)
type Cell = { poly: Point[]; pl: Pl };
const EPS = 1e-7;
const evalPl = (pl: Pl, x: number, z: number) => pl[0] * x + pl[1] * z + pl[2];
const sarea = (r: Point[]) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
/** Keep the part of a polygon where A x + B z + C >= 0 (Sutherland-Hodgman, one half plane). */
function clipHalf(poly: Point[], A: number, B: number, C: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], fp = A * p[0] + B * p[1] + C, fq = A * q[0] + B * q[1] + C;
    if (fp >= -EPS) out.push(p);
    if ((fp >= -EPS) !== (fq >= -EPS)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out.length >= 3 && Math.abs(sarea(out)) > 1e-6 ? out : [];
}
/** Inside half planes of a convex polygon's edges: [A, B, C] with A x + B z + C >= 0 inside. */
const edgesIn = (cvx: Point[]): Pl[] => { const sg = Math.sign(sarea(cvx)) || 1;
  return cvx.map((a, i) => { const c = cvx[(i + 1) % cvx.length], dx = c[0] - a[0], dz = c[1] - a[1]; return [-dz * sg, dx * sg, (dz * a[0] - dx * a[1]) * sg] as Pl; }); };
const clipConvex = (poly: Point[], cvx: Point[]) => { let r = poly; for (const [A, B, C] of edgesIn(cvx)) { if (!r.length) break; r = clipHalf(r, A, B, C); } return r; };
/** poly minus a convex polygon, as convex pieces. */
function subtract(poly: Point[], cvx: Point[]): Point[][] {
  const out: Point[][] = []; let cur = poly;
  for (const [A, B, C] of edgesIn(cvx)) { if (!cur.length) break; const o = clipHalf(cur, -A, -B, -C - 2 * EPS); if (o.length) out.push(o); cur = clipHalf(cur, A, B, C); }
  return out;
}
/** Lower envelope of planes over a convex domain: one convex cell per plane where it is minimal. */
function lowerEnvelope(domain: Point[], pls: Pl[]): Cell[] {
  const cells: Cell[] = [];
  pls.forEach((pi, i) => { let poly = domain;
    pls.forEach((pj, j) => { if (j === i || !poly.length) return; poly = clipHalf(poly, pj[0] - pi[0], pj[1] - pi[1], pj[2] - pi[2] + (j < i ? -1e-6 : 1e-6)); });
    if (poly.length) cells.push({ poly, pl: pi }); });
  return cells;
}
/** Upper envelope of several parts (each a list of cells): a cell keeps the region where no other part is higher. */
function upperEnvelope(parts: Cell[][]): Cell[] {
  if (parts.length === 1) return parts[0];
  const out: Cell[] = [];
  parts.forEach((cells, k) => { for (const A of cells) { let pieces = [A.poly];
    parts.forEach((other, m) => { if (m === k) return; for (const B of other) {
      const hi = clipHalf(B.poly, B.pl[0] - A.pl[0], B.pl[1] - A.pl[1], B.pl[2] - A.pl[2] + (m < k ? 1e-6 : -1e-6));   // where B is above A
      if (!hi.length) continue; pieces = pieces.flatMap(pc => clipConvex(pc, hi).length ? subtract(pc, hi) : [pc]); } });
    for (const pc of pieces) out.push({ poly: pc, pl: A.pl }); } });
  return out;
}
const hull = (pts: Point[]): Point[] => { const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Point[] = [], up: Point[] = []; for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); } return lo.slice(0, -1).concat(up.slice(0, -1)); };
/** Minimum-area enclosing rectangle (rotating calipers over the hull): frame u (long axis) / v, extents. */
function minRect(r: Point[]) {
  const h = hull(r); let best = { A: Infinity, u: [1, 0] as Point, u0: 0, u1: 0, v0: 0, v1: 0 };
  for (let i = 0; i < h.length; i++) { const a = h[i], c = h[(i + 1) % h.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 1e-6) continue;
    const u: Point = [(c[0] - a[0]) / L, (c[1] - a[1]) / L], us = h.map(q => q[0] * u[0] + q[1] * u[1]), vs = h.map(q => -q[0] * u[1] + q[1] * u[0]);
    const A = (Math.max(...us) - Math.min(...us)) * (Math.max(...vs) - Math.min(...vs)); if (A < best.A) best = { A, u, u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) }; }
  if (best.u1 - best.u0 < best.v1 - best.v0) { const { u, u0, u1, v0, v1 } = best; best = { A: best.A, u: [-u[1], u[0]], u0: v0, u1: v1, v0: -u1, v1: -u0 }; }
  return best;
}
type Rect = ReturnType<typeof minRect>;
const rectPt = (R: Rect, a: number, b: number): Point => [a * R.u[0] - b * R.u[1], a * R.u[1] + b * R.u[0]];
const rectPoly = (R: Rect, u0: number, u1: number, v0: number, v1: number): Point[] => [rectPt(R, u0, v0), rectPt(R, u1, v0), rectPt(R, u1, v1), rectPt(R, u0, v1)];
/** Eave plane of a rectangle side: zero rise on the line coordinate `at` of axis `ax` ('u'|'v'), rising by `s` inward (sign `dir`). */
function sidePlane(R: Rect, ax: 'u' | 'v', at: number, dir: 1 | -1, eave: number, s: number): Pl {
  const d: Point = ax === 'u' ? R.u : [-R.u[1], R.u[0]];       // coordinate along ax = d . p
  return [s * dir * d[0], s * dir * d[1], eave - s * dir * at];
}
export type HonorsRoof = { cells: Cell[]; planes: Pl[]; H: (x: number, z: number) => number };
function cellsAt(cells: Cell[], x: number, z: number) { let best = NaN;
  for (const c of cells) if (edgesIn(c.poly).every(([A, B, C]) => (A * x + B * z + C) / Math.hypot(A, B) >= -1e-4)) { const v = evalPl(c.pl, x, z); if (!(v <= best)) best = v; } return best; }
/** Exact roofs for every hipped piece (exported for the b06 check). `party[i]` flags ring edges that abut a taller wing. */
export function honorsRoofs(): Map<string, HonorsRoof> {
  const P = Object.entries(HQ.pieces).map(([name, p]) => ({ name, ...p, ring: orient(p.ring) }));
  const topOf = (p: (typeof P)[number]) => p.kind === 'flat' ? p.deck! : p.ridge!;
  const out = new Map<string, HonorsRoof>();
  for (const p of P) {
    if (p.kind !== 'hip') continue;
    const r = p.ring, m = r.length, ov = p.overhang ?? 0.55, eave = p.roofFit?.eave ?? p.eave!, s = p.roofFit?.slope ?? p.slope!, ridge = p.roofFit?.ridge ?? p.ridge!, M = 3 * ov + 0.5;
    const party = r.map((a, i) => P.some(q => q !== p && q.record === p.record && topOf(q) > topOf(p) && onRing(a, r[(i + 1) % m], q.ring)));
    /** one hipped rectangle part: planes on its non-party sides, eave lines offset by the overhang; cap at `cap`. */
    const part = (sub: Point[], cap: number, ends: 'hip' | Pl[], extra: Pl[] = []) => {
      const RR = sub === r ? p.roofRect : undefined;
      const R = RR ? { A: (RR.u1 - RR.u0) * (RR.v1 - RR.v0), u: RR.u, u0: RR.u0, u1: RR.u1, v0: RR.v0, v1: RR.v1 } : minRect(sub), pls: Pl[] = [[0, 0, cap]];
      // a side is a party side when >50% of its length is covered by party ring edges lying on it
      const sideParty = (ax: 'u' | 'v', at: number, len: number) => { if (RR) return RR.party.includes(`${ax}${at === R[`${ax}0`] ? 0 : 1}` as 'u0'); let cov = 0;
        r.forEach((a, i) => { if (!party[i]) return; const c = r[(i + 1) % m], d: Point = ax === 'u' ? R.u : [-R.u[1], R.u[0]];
          const ca = a[0] * d[0] + a[1] * d[1], cc = c[0] * d[0] + c[1] * d[1]; if (Math.abs(ca - at) < 0.8 && Math.abs(cc - at) < 0.8) cov += Math.hypot(c[0] - a[0], c[1] - a[1]); });
        return cov > 0.5 * len; };
      const lu = R.u1 - R.u0, lv = R.v1 - R.v0;
      if (!sideParty('v', R.v0, lu)) pls.push(sidePlane(R, 'v', R.v0 - ov, 1, eave, s));
      if (!sideParty('v', R.v1, lu)) pls.push(sidePlane(R, 'v', R.v1 + ov, -1, eave, s));
      let dom: Point[]; const endPls: Pl[] = [];
      if (ends === 'hip') {
        if (!sideParty('u', R.u0, lv)) endPls.push(sidePlane(R, 'u', R.u0 - ov, 1, eave, s));
        if (!sideParty('u', R.u1, lv)) endPls.push(sidePlane(R, 'u', R.u1 + ov, -1, eave, s));
        pls.push(...endPls); dom = rectPoly(R, R.u0 - M, R.u1 + M, R.v0 - M, R.v1 + M);
      } else { dom = rectPoly(R, R.u0 - 60, R.u1 + 60, R.v0 - M, R.v1 + M); for (const [A, B, C] of ends) dom = clipHalf(dom, A, B, C); }
      pls.push(...extra);
      return { R, cells: lowerEnvelope(dom, pls), pls, endPls, natural: eave + s * (lv / 2 + ov) };
    };
    let parts: { cells: Cell[]; pls: Pl[] }[];
    if (p.name === 'LTD') {
      // concave U: wings cut at the official inner corners (UT 409 vertices (-261.6,-353.5) and (-230.9,-351.1)), frame-rotated
      const L1 = { p: [-261.6, -353.5] as Point, d: [-0.075, 1] as Point }, L2 = { p: [-230.9, -351.1] as Point, d: [-0.075, 1] as Point };
      const side = (L: typeof L1, keepWest: boolean) => { const A = L.d[1], B = -L.d[0], C = -(A * L.p[0] + B * L.p[1]); return keepWest ? [-A, -B, -C] as Pl : [A, B, C] as Pl; };
      const west = clipHalf(r, ...side(L1, true)), east = clipHalf(r, ...side(L2, false)), mid0 = clipHalf(clipHalf(r, ...side(L1, false)), ...side(L2, true));
      const W = part(west, ridge, 'hip'), E = part(east, ridge, 'hip');
      // the central range ends exactly on each wing's ridge line (wing axis through its centre) and never rises above the
      // wings' hip-end planes, so at both ends it meets the wing roofs continuously (no step), the valleys form inside
      const mc = (() => { const RC = minRect(mid0); return rectPt(RC, (RC.u0 + RC.u1) / 2, (RC.v0 + RC.v1) / 2); })();
      const ridgeLine = (Wg: typeof W): Pl => { const c = rectPt(Wg.R, (Wg.R.u0 + Wg.R.u1) / 2, (Wg.R.v0 + Wg.R.v1) / 2), d = Wg.R.u;
        const pl: Pl = [d[1], -d[0], -(d[1] * c[0] - d[0] * c[1])]; return pl[0] * mc[0] + pl[1] * mc[1] + pl[2] >= 0 ? pl : [-pl[0], -pl[1], -pl[2]]; };
      const C = part(mid0, Math.min(ridge, W.natural, E.natural), [ridgeLine(W), ridgeLine(E)], [...W.endPls, ...E.endPls]);
      parts = [W, C, E];
    } else parts = [part(r, ridge, 'hip')];
    const cells = upperEnvelope(parts.map(q => q.cells));
    out.set(p.name, { cells, planes: parts.flatMap(q => q.pls), H: (x, z) => cellsAt(cells, x, z) });
  }
  return out;
}
/** Exact roof profile along segment a->c: [t0, t1, plane] intervals from the convex cells. */
function profile(cells: Cell[], a: Point, c: Point): [number, number, Pl][] {
  const out: [number, number, Pl][] = [];
  for (const cl of cells) { let t0 = 0, t1 = 1;
    for (const [A, B, C] of edgesIn(cl.poly)) { const fa = A * a[0] + B * a[1] + C, fc = A * c[0] + B * c[1] + C;
      if (fa < -1e-9 && fc < -1e-9) { t0 = 1; t1 = 0; break; } if (fa < -1e-9) t0 = Math.max(t0, fa / (fa - fc)); else if (fc < -1e-9) t1 = Math.min(t1, fa / (fa - fc)); }
    if (t1 - t0 > 1e-6) out.push([t0, t1, cl.pl]); }
  return out.sort((x, y) => x[0] - y[0]);
}

/** Flush panel with a semicircular head (arched opening / trim) on wall o + u*x, centred bottom at y0. */
function archPanel(b: Bucket, o: THREE.Vector3, u: THREE.Vector3, n: THREE.Vector3, x: number, y0: number, w: number, h: number, z: number) {
  const r = w / 2, spring = y0 + h - r, P = (sx: number, y: number) => o.clone().addScaledVector(u, x + sx).setY(y).addScaledVector(n, z);
  b.quad(P(-r, y0), P(r, y0), P(r, spring), P(-r, spring), n);
  const c = P(0, spring), seg = 8;
  for (let i = 0; i < seg; i++) { const a0 = Math.PI * i / seg, a1 = Math.PI * (i + 1) / seg; b.tri(c, P(r * Math.cos(a0), spring + r * Math.sin(a0)), P(r * Math.cos(a1), spring + r * Math.sin(a1)), n); }
}

export function buildHonorsQuad(k: Kit, g: (x: number, z: number) => number) {
  const P = Object.entries(HQ.pieces).map(([name, p]) => ({ name, ...p, ring: orient(p.ring) }));
  const topOf = (p: (typeof P)[number]) => p.kind === 'flat' ? p.deck! : p.ridge!;
  const stats: Record<string, unknown> = { pieces: P.length, windows: 0, entrances: 0, chimneys: 0, roofFacets: 0 };
  const roofs = honorsRoofs();
  const ground = (r: Point[]) => { const v = r.map(q => g(q[0], q[1])).sort((a, b) => a - b); return { min: v[0], med: v[v.length >> 1] }; };
  const walls: { name: string; a: Point; c: Point; top: number; above: number; st: Style; gMed: number }[] = [];
  for (const p of P) {
    const r = p.ring, m = r.length, gr = ground(r), bottom = gr.min - 1.0, st = styleOf(p.name);
    // neighbour across each edge (same record): taller -> party wall (hip roofs run into it); any -> no windows below its top
    const nb = r.map((a, i) => P.find(q => q !== p && q.record === p.record && onRing(a, r[(i + 1) % m], q.ring)));
    // a wall facing a LOWER neighbour starts at that neighbour's top (below it the neighbour's own wall closes the gap)
    const from = nb.map(q => q && topOf(q) < topOf(p) ? (q.kind === 'flat' ? q.deck! + PARAPET : bottom) : bottom);
    let wallTop: number;
    if (p.kind === 'flat') {   // flat deck with a 0.5 m parapet, limestone coping (as Kit.flatBody, per-edge wall bottoms)
      const top = p.deck! + PARAPET, inner = offsetVar(r, r.map(() => -0.3));
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m; k.wall('tanBrick', r[i], r[j], from[i], top);
        k.S('limestone').quad(V(r[i][0], top, r[i][1]), V(r[j][0], top, r[j][1]), V(inner[j][0], top, inner[j][1]), V(inner[i][0], top, inner[i][1]), UP);
        const L = Math.hypot(inner[j][0] - inner[i][0], inner[j][1] - inner[i][1]);
        if (L > 0.02) k.S('tanBrick').quad(V(inner[i][0], p.deck!, inner[i][1]), V(inner[j][0], p.deck!, inner[j][1]), V(inner[j][0], top, inner[j][1]), V(inner[i][0], top, inner[i][1]), V(-(inner[j][1] - inner[i][1]) / L, 0, (inner[j][0] - inner[i][0]) / L));
      }
      k.cap(k.S('membrane'), [inner], p.deck!);
      wallTop = top;
    } else {
      const ov = p.overhang ?? 0.55, party = nb.map(q => !!q && topOf(q) > topOf(p));
      const e = offsetVar(r, party.map(x => x ? 0 : ov)), eave = p.roofFit?.eave ?? p.eave!, s = p.roofFit?.slope ?? p.slope!, roof = roofs.get(p.name)!;
      wallTop = eave + s * ov;
      // roof facets: every triangle of the eave outline clipped to every exact planar cell, lifted onto that cell's plane
      const ec = e.map(q => new THREE.Vector2(q[0], q[1]));
      for (const [i0, i1, i2] of THREE.ShapeUtils.triangulateShape(ec, [])) {
        const tri: Point[] = [e[i0], e[i1], e[i2]];
        for (const cl of roof.cells) { const f = clipConvex(tri, cl.poly); if (!f.length) continue; stats.roofFacets = (stats.roofFacets as number) + 1;
          for (let q = 1; q + 1 < f.length; q++) k.S('tile').tri(V(f[0][0], evalPl(cl.pl, ...f[0]), f[0][1]), V(f[q][0], evalPl(cl.pl, ...f[q]), f[q][1]), V(f[q + 1][0], evalPl(cl.pl, ...f[q + 1]), f[q + 1][1]), UP); }
      }
      const lerp = (a: Point, c: Point, t: number): Point => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
      for (let i = 0; i < m; i++) {
        const a = r[i], c = r[(i + 1) % m], j = (i + 1) % m;
        if (!party[i]) {   // eave: wall to the wall top, soffit out to the exact roof edge along the eave outline
          k.wall('tanBrick', a, c, from[i], wallTop);
          for (const [t0, t1, pl] of profile(roof.cells, e[i], e[j])) { const e0 = lerp(e[i], e[j], t0), e1 = lerp(e[i], e[j], t1), w0 = lerp(a, c, t0), w1 = lerp(a, c, t1);
            k.S(st.soffit).quad(V(w0[0], wallTop, w0[1]), V(w1[0], wallTop, w1[1]), V(e1[0], evalPl(pl, ...e1), e1[1]), V(e0[0], evalPl(pl, ...e0), e0[1]), DOWN); }
        } else {           // party wall up to the exact roof line (closes the roof end inside the taller neighbour)
          for (const [t0, t1, pl] of profile(roof.cells, a, c)) { const p0 = lerp(a, c, t0), p1 = lerp(a, c, t1);
            k.wall('tanBrick', p0, p1, bottom, evalPl(pl, ...p0) - 0.02, evalPl(pl, ...p1) - 0.02); }
        }
      }
    }
    for (let i = 0; i < m; i++) walls.push({ name: p.name, a: r[i], c: r[(i + 1) % m], top: wallTop, above: nb[i] ? topOf(nb[i]!) + 0.6 : -Infinity, st, gMed: gr.med });
  }
  // Entrances: stone surround / brick arcade projecting from the nearest wall of the record (solid, collider-backed).
  const zones: { a: Point; c: Point; x: number; half: number; top: number }[] = [];
  for (const en of HQ.entrances) {
    let best = walls[0], bd = Infinity;
    for (const w of walls) { if (w.above > -Infinity || !HQ.pieces[w.name] || HQ.pieces[w.name].record !== en.record) continue; const d = segDist(en.at[0], en.at[1], w.a, w.c); if (d < bd) { bd = d; best = w; } }
    const { a, c } = best, L = Math.hypot(c[0] - a[0], c[1] - a[1]), u = V((c[0] - a[0]) / L, 0, (c[1] - a[1]) / L), n = V(u.z, 0, -u.x);
    const x = Math.max(en.width / 2 + 0.3, Math.min(L - en.width / 2 - 0.3, (en.at[0] - a[0]) * u.x + (en.at[1] - a[1]) * u.z));
    const gx: Point = [a[0] + u.x * x, a[1] + u.z * x], gl = g(gx[0], gx[1]), top = gl + en.height, bot = gl - 0.8;
    const pt = (sx: number, d: number): Point => [a[0] + u.x * (x + sx) + n.x * d, a[1] + u.z * (x + sx) + n.z * d];
    const box = [pt(-en.width / 2, 0), pt(en.width / 2, 0), pt(en.width / 2, en.depth), pt(-en.width / 2, en.depth)];
    const mat = en.style === 'arcade' ? 'tanBrick' : 'limestone', ob = orient(box);
    for (let i = 0; i < 4; i++) { const p0 = ob[i], p1 = ob[(i + 1) % 4], mm = mid(p0, p1);   // cheeks + front; the back sits on the wall
      if (segDist(mm[0], mm[1], a, c) > 0.05) k.wall(mat, p0, p1, bot, top); }
    k.cap(k.S('limestone'), [ob], top);
    const o = V(a[0] + n.x * en.depth, 0, a[1] + n.z * en.depth);
    if (en.style === 'arcade') {
      const cnt = en.arches ?? 3, pitch = en.width / cnt;
      for (let i = 0; i < cnt; i++) { const xi = x - en.width / 2 + pitch * (i + 0.5);
        archPanel(k.D('limestone'), o, u, n, xi, gl + 0.25, en.door[0] + 0.4, en.door[1] + 0.3, 0.02);
        archPanel(k.D('doorGlass'), o, u, n, xi, gl + 0.25, en.door[0], en.door[1], 0.04); }
      k.D('limestone').panel(o, u, n, x, top - 0.25, 0.03, en.width, 0.3);
    } else {
      k.D('doorGlass').panel(o, u, n, x, gl + 0.25 + en.door[1] / 2, 0.03, en.door[0], en.door[1]);
      k.D('limestone').panel(o, u, n, x, gl + en.door[1] + 0.75, 0.05, en.door[0] + 0.9, 0.5);    // entablature over the door
    }
    zones.push({ a, c, x, half: en.width / 2 + 0.4, top }); stats.entrances = (stats.entrances as number) + 1;
  }
  // Facade rhythm on exterior faces: base course, cornice band, (BLD) pilasters, punched / paired windows.
  for (const w of walls) {
    const { a, c, st } = w, L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 2.5) continue;
    const u = V((c[0] - a[0]) / L, 0, (c[1] - a[1]) / L), n = V(u.z, 0, -u.x), o = V(a[0], 0, a[1]);
    const ga = g(a[0], a[1]), gc = g(c[0], c[1]), lo = Math.min(ga, gc) - 0.3, first = w.gMed + 1.2;
    const exterior = w.above === -Infinity;
    if (exterior) {
      const bt = Math.max(ga, gc) + st.baseH; if (bt > lo + 0.3) k.D(st.base).panel(o, u, n, L / 2, (lo + bt) / 2, 0.02, L, bt - lo);
      k.D(st.soffit === 'eaveTrim' ? 'eaveTrim' : 'limestone').panel(o, u, n, L / 2, w.top - 0.28, 0.025, L, 0.5);
    }
    const count = Math.floor(L / st.bay); if (count < 1) continue;
    const zone = zones.find(zn => zn.a === a && zn.c === c);
    for (let j = 0; j < count; j++) {
      const x = (j + 0.5) * L / count, px = a[0] + u.x * x, pz = a[1] + u.z * x, gl = g(px, pz);
      const ph = w.top - 0.55 - Math.max(ga, gc) - st.baseH;
      if (exterior && st.pilasterEvery && j % st.pilasterEvery === 0 && j > 0 && ph > 1) k.D('brickShade').panel(o, u, n, j * L / count, (Math.max(ga, gc) + st.baseH + w.top - 0.55) / 2, 0.025, 0.6, ph);
      for (let y = first; y + st.h <= w.top - 0.75; y += st.storey) {
        if (y < gl + 0.45 || y < w.above) continue;
        if (zone && Math.abs(x - zone.x) < zone.half && y < zone.top + 0.3) continue;
        if (st.paired) { for (const sx of [-0.42, 0.42]) k.D('glass').panel(o, u, n, x + sx, y + st.h / 2, 0.035, st.w, st.h); k.D('limestone').panel(o, u, n, x, y - 0.08, 0.06, 1.7, 0.16); }
        else { k.D('glass').panel(o, u, n, x, y + st.h / 2, 0.035, st.w, st.h); k.D('limestone').panel(o, u, n, x, y - 0.08, 0.06, st.w + 0.3, 0.16); }
        stats.windows = (stats.windows as number) + 1;
      }
    }
  }
  // Chimneys (LiDAR peaks): a peak within 1 m of a wall is an exterior stack against that wall (1.6 m wide, 0.9 m deep,
  // from the ground); interior ones rise from below the eave.
  for (const ch of HQ.chimneys) {
    const [x, z] = ch.at, [sx, sz] = ch.size, p = P.find(q => HQ.pieces[q.name].record === ch.record && q.kind === 'hip')!;
    const ei = p.ring.findIndex((q, i) => segDist(x, z, q, p.ring[(i + 1) % p.ring.length]) < 1.0);
    let ring: Point[] = [[x - sx / 2, z - sz / 2], [x + sx / 2, z - sz / 2], [x + sx / 2, z + sz / 2], [x - sx / 2, z + sz / 2]];
    if (ei >= 0) {
      const a = p.ring[ei], c = p.ring[(ei + 1) % p.ring.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]), ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L, nx = uz, nz = -ux;
      const t = (x - a[0]) * ux + (z - a[1]) * uz, at = (s2: number, d: number): Point => [a[0] + ux * (t + s2) + nx * d, a[1] + uz * (t + s2) + nz * d];
      ring = [at(-0.8, 0), at(0.8, 0), at(0.8, 0.9), at(-0.8, 0.9)];
    }
    k.flatBody(ring, ei >= 0 ? ground(ring).min - 1.0 : p.eave! - 0.5, ch.top, { wall: 'tanBrick', roof: 'limestone' });
    stats.chimneys = (stats.chimneys as number) + 1;
  }
  return stats;
}
