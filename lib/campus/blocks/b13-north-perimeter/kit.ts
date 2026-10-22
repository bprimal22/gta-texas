// b13-north-perimeter: authored-body kit, a LOCAL COPY of b11-south-medical/kit.ts (itself copied from b12 / b06), so this
// owner module never imports another block. b13 additions are marked "b13:" (recessed openings, raw ring edges).
// Original b11 header follows.
// (b11) authored-body kit, a LOCAL COPY of b12-west-campus/kit.ts (itself adapted from b06), so this
// owner module stays independent of other blocks. b11 additions: face masks on boxes (`box(..., mask)`, `attach(...,
// mask)`) so a relief never emits a face buried against an abutting relief (generic check G3 samples every exposed
// triangle), and `stack()` for square towers/cupolas whose stage transitions emit only the exposed annuli.
// Conventions: rings are oriented with positive shoelace area in (x, z) so an edge a->c has outward normal
// (dz, -dx)/L; heights are ABSOLUTE campus Y. Geometry is collected per material class ("matte", "glass",
// "metal") and per role (solid = rendered AND collided from the same triangles; detail = flush/visual-only).
// Colours are per-vertex (one vertex-coloured material per class keeps the draw calls at <= 6 for the whole
// block); every geometry carries a `color` attribute, so G6 (vertex colours without an attribute) cannot fail.
import * as THREE from 'three';
import type { Point } from '../../types';

export type Mat = 'matte' | 'glass' | 'metal' | 'paving';
export const area = (r: Point[]) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
export const orient = (r: Point[]) => (area(r) > 0 ? r.slice() : r.slice().reverse());
export const segDist = (px: number, pz: number, a: Point, b: Point) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l)) : 0;
  return Math.hypot(a[0] + t * dx - px, a[1] + t * dz - pz);
};
export const ringDist = (x: number, z: number, r: Point[]) => { let d = Infinity; for (let i = 0; i < r.length; i++) d = Math.min(d, segDist(x, z, r[i], r[(i + 1) % r.length])); return d; };
export const inRing = (x: number, z: number, r: Point[]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const UP = V(0, 1, 0), DOWN = V(0, -1, 0);
/** Deterministic hash in [0,1) for repeatable "irregular" facade rhythms. */
export const hash = (a: number, b = 0, c = 0) => { const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return s - Math.floor(s); };

export class Bucket {
  pos: number[] = []; col: number[] = [];
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color, hint?: THREE.Vector3) {
    if (hint) { const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)); if (n.dot(hint) < 0) [b, c] = [c, b]; }
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < 3; i++) this.col.push(color.r, color.g, color.b);
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color, hint: THREE.Vector3) { this.tri(a, b, c, color, hint); this.tri(a, c, d, color, hint); }
  get triangles() { return this.pos.length / 9; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

/** One wall edge of an oriented ring: origin a, unit along u, outward n, length L. */
export interface Edge { a: Point; c: Point; L: number; u: THREE.Vector3; n: THREE.Vector3; i: number }
export const edgesOf = (ring: Point[]): Edge[] => {
  const r = orient(ring), out: Edge[] = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i], c = r[(i + 1) % r.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 0.05) continue;
    out.push({ a, c, L, u: V((c[0] - a[0]) / L, 0, (c[1] - a[1]) / L), n: V((c[1] - a[1]) / L, 0, -(c[0] - a[0]) / L), i });
  }
  return out;
};
/** b13: edges of `ring` in its GIVEN order (no re-orientation). For a courtyard hole pass orient(hole).reverse(): the
 * outward normal (dz, -dx)/L then points into the court (away from the building mass). */
export const edgesRaw = (r: Point[]): Edge[] => {
  const out: Edge[] = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i], c = r[(i + 1) % r.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 0.05) continue;
    out.push({ a, c, L, u: V((c[0] - a[0]) / L, 0, (c[1] - a[1]) / L), n: V((c[1] - a[1]) / L, 0, -(c[0] - a[0]) / L), i });
  }
  return out;
};
/** Point on an edge: s metres along, y height, d metres outward. */
export const at = (e: Edge, s: number, y: number, d = 0) => V(e.a[0] + e.u.x * s + e.n.x * d, y, e.a[1] + e.u.z * s + e.n.z * d);
/** Position along the edge of the point on it closest to (x, z). */
export const along = (e: Edge, x: number, z: number) => (x - e.a[0]) * e.u.x + (z - e.a[1]) * e.u.z;

const colors = new Map<string, THREE.Color>();
export const C = (hex: string) => { let c = colors.get(hex); if (!c) colors.set(hex, c = new THREE.Color(hex)); return c; };

/** A wall plane on an edge (offset d) whose solid quads are emitted as the COMPLEMENT of the footprints of the solid
 * boxes attached to it: no wall triangle ever lies behind a collidable relief, so render = collision holds per face
 * and every wall triangle is directly visible (generic check G3 samples triangle centroids). */
/** Faces of a relief box to emit (default all); a face abutting another relief or wall is buried and must be omitted. */
export interface BoxMask { front?: boolean; s0?: boolean; s1?: boolean; top?: boolean; bottom?: boolean }
export interface Face { e: Edge; d: number; s0: number; s1: number; y0: number; y1: number; color: THREE.Color; mat: Mat; holes: [number, number, number, number][] }

export class Kit {
  solid = new Map<Mat, Bucket>(); detail = new Map<Mat, Bucket>(); faces: Face[] = [];
  face(e: Edge, y0: number, y1: number, color: THREE.Color, o: { d?: number; s0?: number; s1?: number; mat?: Mat } = {}): Face {
    const f: Face = { e, d: o.d ?? 0, s0: o.s0 ?? 0, s1: o.s1 ?? e.L, y0, y1, color, mat: o.mat ?? 'matte', holes: [] }; this.faces.push(f); return f;
  }
  /** Solid box standing on face(s) `fs` (its back at the face plane, `depth` outward); opens the faces behind it. */
  attach(fs: Face | (Face | Face[] | undefined)[] | undefined, s0: number, s1: number, y0: number, y1: number, depth: number, color: THREE.Color, mat: Mat = 'matte', mask: BoxMask = {}) {
    const list = (Array.isArray(fs) ? fs.flat() : [fs]).filter((f): f is Face => !!f); if (!list.length || s1 - s0 < 0.01 || y1 - y0 < 0.01) return; // no wall here (interior)
    const sc = (s0 + s1) / 2, yc = (y0 + y1) / 2;
    if (!list.some(f => sc >= f.s0 - 1e-6 && sc <= f.s1 + 1e-6 && yc >= f.y0 - 0.5 && yc <= f.y1 + 0.5)) return; // centre on a hidden (covered) part
    this.box(this.S(mat), list[0].e, s0, s1, y0, y1, list[0].d, list[0].d + depth, color, false, mask);
    for (const f of list) { const h: [number, number, number, number] = [Math.max(s0, f.s0), Math.min(s1, f.s1), Math.max(y0, f.y0), Math.min(y1, f.y1)]; if (h[1] - h[0] > 0.005 && h[3] - h[2] > 0.005) f.holes.push(h); }
  }
  /** Emit every face as the complement of its openings. */
  flushFaces() {
    for (const f of this.faces) {
      const xs = [...new Set([f.s0, f.s1, ...f.holes.flatMap(h => [h[0], h[1]])])].filter(x => x >= f.s0 - 1e-6 && x <= f.s1 + 1e-6).sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i++) {
        const xa = xs[i], xb = xs[i + 1]; if (xb - xa < 0.005) continue;
        const cov = f.holes.filter(h => h[0] <= xa + 1e-6 && h[1] >= xb - 1e-6).map(h => [h[2], h[3]]).sort((p, q) => p[0] - q[0]);
        let y = f.y0;
        for (const [c0, c1] of cov) { if (c0 > y + 0.005) this.panel(this.S(f.mat), f.e, xa, xb, y, Math.min(c0, f.y1), f.d, f.color); y = Math.max(y, c1); }
        if (f.y1 > y + 0.005) this.panel(this.S(f.mat), f.e, xa, xb, y, f.y1, f.d, f.color);
      }
    }
    this.faces = [];
  }
  S(m: Mat = 'matte') { let b = this.solid.get(m); if (!b) this.solid.set(m, b = new Bucket()); return b; }
  D(m: Mat = 'matte') { let b = this.detail.get(m); if (!b) this.detail.set(m, b = new Bucket()); return b; }

  /** Vertical wall on edge a->c of an oriented ring from y0 to y1 (per-end tops allowed). */
  wall(b: Bucket, a: Point, c: Point, y0: number, y1: number, color: THREE.Color, y1c = y1) {
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 0.02 || (y1 - y0 < 0.01 && y1c - y0 < 0.01)) return;
    const n = V((c[1] - a[1]) / L, 0, -(c[0] - a[0]) / L);
    b.quad(V(a[0], y0, a[1]), V(c[0], y0, c[1]), V(c[0], y1c, c[1]), V(a[0], y1, a[1]), color, n);
  }
  /** Horizontal polygon (outer + holes) at y facing up or down. */
  cap(b: Bucket, rings: Point[][], y: number, color: THREE.Color, face: 'up' | 'down' = 'up') {
    const contour = rings[0].map(p => new THREE.Vector2(p[0], p[1])), holes = rings.slice(1).map(r => r.map(p => new THREE.Vector2(p[0], p[1])));
    const all = [contour, ...holes].flat();
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, holes))
      b.tri(V(all[i].x, y, all[i].y), V(all[j].x, y, all[j].y), V(all[k].x, y, all[k].y), color, face === 'up' ? UP : DOWN);
  }
  /** Closed flat prism (walls on every edge, deck on top). Returns the oriented ring. */
  prism(ring: Point[], bottom: number, top: number, wall: THREE.Color, roof: THREE.Color, o: { skipEdge?: (e: Edge) => boolean; holes?: Point[][]; bottomCap?: boolean } = {}) {
    const r = orient(ring);
    for (const e of edgesOf(r)) if (!o.skipEdge?.(e)) this.wall(this.S(), e.a, e.c, bottom, top, wall);
    this.cap(this.S(), [r, ...(o.holes ?? [])], top, roof);
    if (o.bottomCap) this.cap(this.S(), [r], bottom, wall, 'down');
    return r;
  }
  /** Oriented box on an edge: along [s0,s1], height [y0,y1], outward [d0,d1]; faces outward/sides/top/bottom
   * (the back face only when `back`: boxes attached to a Face sit in that face's opening, so their back is never seen). */
  box(b: Bucket, e: Edge, s0: number, s1: number, y0: number, y1: number, d0: number, d1: number, color: THREE.Color, back = false, mask: BoxMask = {}) {
    if (s1 - s0 < 0.01 || y1 - y0 < 0.01 || d1 - d0 < 0.005) return;
    const P = (s: number, y: number, d: number) => at(e, s, y, d), u = e.u, n = e.n, mu = u.clone().negate(), mn = n.clone().negate();
    if (mask.front !== false) b.quad(P(s0, y0, d1), P(s1, y0, d1), P(s1, y1, d1), P(s0, y1, d1), color, n);  // front
    if (mask.s0 !== false) b.quad(P(s0, y0, d0), P(s0, y0, d1), P(s0, y1, d1), P(s0, y1, d0), color, mu);     // side s0
    if (mask.s1 !== false) b.quad(P(s1, y0, d1), P(s1, y0, d0), P(s1, y1, d0), P(s1, y1, d1), color, u);      // side s1
    if (mask.top !== false) b.quad(P(s0, y1, d1), P(s1, y1, d1), P(s1, y1, d0), P(s0, y1, d0), color, UP);    // top
    if (mask.bottom !== false) b.quad(P(s0, y0, d0), P(s1, y0, d0), P(s1, y0, d1), P(s0, y0, d1), color, DOWN); // bottom
    if (back) b.quad(P(s1, y0, d0), P(s0, y0, d0), P(s0, y1, d0), P(s1, y1, d0), color, mn); // back (only for free-standing boxes)
  }
  /** Square tower/cupola about centre (cx, cz) with plan axes `ax` (unit, along) and its perpendicular: each stage is a
   * square prism of half-size h from y0 to y1 (stage i+1 starts at stage i's top). Only exposed faces are emitted: the
   * walls, the up-facing annulus where a stage narrows, the down-facing soffit annulus where it widens, and a pyramid
   * cap from the last stage's top to `apex` (no cap when apex <= top). No bottom face (the base stands in a roof). */
  stack(cx: number, cz: number, ax: [number, number], stages: { h: number; y0: number; y1: number; color: THREE.Color; mat?: Mat }[], apex: number, capColor: THREE.Color, capMat: Mat = 'metal', taper: [number, number][] = []) {
    const [ux, uz] = ax, vx = -uz, vz = ux;
    const corner = (h: number, i: number): Point => { const sa = i === 0 || i === 3 ? -1 : 1, sb = i < 2 ? -1 : 1; return [cx + ux * h * sa + vx * h * sb, cz + uz * h * sa + vz * h * sb]; };
    const sq = (h: number) => orient([0, 1, 2, 3].map(i => corner(h, i)));
    stages.forEach((st, i) => {
      const r = sq(st.h);
      for (const e of edgesOf(r)) this.wall(this.S(st.mat ?? 'matte'), e.a, e.c, st.y0, st.y1, st.color);
      const next = stages[i + 1];
      if (next && Math.abs(next.h - st.h) > 1e-3) {
        const outer = sq(Math.max(st.h, next.h)), inner = sq(Math.min(st.h, next.h));
        this.cap(this.S(next.h < st.h ? st.mat ?? 'matte' : next.mat ?? 'matte'), [outer, inner.slice().reverse()], st.y1, next.h < st.h ? st.color : next.color, next.h < st.h ? 'up' : 'down');
      }
    });
    // Cap: optional concentric square frustums `taper` ([half-size, y] rings, e.g. a bell/dome profile), then a pyramid.
    const last = stages[stages.length - 1];
    let ring = sq(last.h), y = last.y1;
    for (const [h, ty] of taper) {
      const nr = sq(h), es = edgesOf(ring), ne = edgesOf(nr);
      es.forEach((e, i) => this.S(capMat).quad(V(e.a[0], y, e.a[1]), V(e.c[0], y, e.c[1]), V(ne[i].c[0], ty, ne[i].c[1]), V(ne[i].a[0], ty, ne[i].a[1]), capColor, UP));
      ring = nr; y = ty;
    }
    if (apex > y + 1e-3) for (const e of edgesOf(ring)) this.S(capMat).tri(V(e.a[0], y, e.a[1]), V(e.c[0], y, e.c[1]), V(cx, apex, cz), capColor, UP);
    else this.cap(this.S(capMat), [ring], y, capColor);
    return sq(last.h);
  }
  /** b13: recessed opening in face `f` over [s0,s1] x [y0,y1]: opens the face and emits the four reveal planes (jambs,
   * head soffit, sill) `depth` deep plus the glass (or door) pane at the back, all SOLID (rendered and collided), so the
   * window is real relief rather than a flush decal. Openings must be > 0.6 m wide and > 1.05 m tall (generic check
   * G3 casts 0.5 m side rays and 1 m drop rays inside the reveal). Returns false when no visible wall carries it. */
  recess(f: Face | undefined, s0: number, s1: number, y0: number, y1: number, depth: number, reveal: THREE.Color, pane: THREE.Color, paneMat: Mat = 'glass') {
    if (!f || s0 < f.s0 + 0.05 || s1 > f.s1 - 0.05 || y0 < f.y0 + 0.05 || y1 > f.y1 - 0.05 || s1 - s0 < 0.6 || y1 - y0 < 1.05) return false;
    if (f.holes.some(h => h[0] < s1 && h[1] > s0 && h[2] < y1 && h[3] > y0)) return false;
    f.holes.push([s0, s1, y0, y1]);
    const e = f.e, d0 = f.d, d1 = f.d - depth, b = this.S(f.mat), mu = e.u.clone().negate();
    b.quad(at(e, s0, y0, d0), at(e, s0, y0, d1), at(e, s0, y1, d1), at(e, s0, y1, d0), reveal, e.u);   // jamb s0 faces +u
    b.quad(at(e, s1, y0, d1), at(e, s1, y0, d0), at(e, s1, y1, d0), at(e, s1, y1, d1), reveal, mu);    // jamb s1 faces -u
    b.quad(at(e, s0, y1, d0), at(e, s1, y1, d0), at(e, s1, y1, d1), at(e, s0, y1, d1), reveal, DOWN);  // head soffit
    b.quad(at(e, s0, y0, d1), at(e, s1, y0, d1), at(e, s1, y0, d0), at(e, s0, y0, d0), reveal, UP);    // sill reveal
    this.S(paneMat).quad(at(e, s0, y0, d1), at(e, s1, y0, d1), at(e, s1, y1, d1), at(e, s0, y1, d1), pane, e.n);
    return true;
  }
  /** Flat panel facing outward at offset d (visual skin). */
  panel(b: Bucket, e: Edge, s0: number, s1: number, y0: number, y1: number, d: number, color: THREE.Color) {
    if (s1 - s0 < 0.01 || y1 - y0 < 0.01) return;
    b.quad(at(e, s0, y0, d), at(e, s1, y0, d), at(e, s1, y1, d), at(e, s0, y1, d), color, e.n);
  }
  /** Rectangular gabled body: ring of 4 points; eave edges are (k,k+1) and (k+2,k+3). Walls to the eave,
   * gable triangles to the ridge, roof planes with overhang `ov`, soffits underneath. */
  gable(ring: Point[], bottom: number, eave: number, ridge: number, k: 0 | 1, wall: THREE.Color, roof: THREE.Color, ov = 0.5, o: { gableColor?: THREE.Color; skipWall?: (a: Point, c: Point) => boolean } = {}) {
    const r = orient(ring), I = (i: number) => (i + k) % 4, mid = (p: Point, q: Point): Point => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const half = segDist(...mid(r[I(1)], r[I(2)]), r[I(0)], r[I(1)]), slope = (ridge - eave) / half;
    const grow = (p: Point, cx: number, cz: number, d: number): Point => { const dx = p[0] - cx, dz = p[1] - cz, l = Math.hypot(dx, dz); return [p[0] + dx / l * d * 1.414, p[1] + dz / l * d * 1.414]; };
    const cx = r.reduce((s, p) => s + p[0], 0) / 4, cz = r.reduce((s, p) => s + p[1], 0) / 4, e = r.map(p => grow(p, cx, cz, ov));
    const eY = eave - slope * ov;
    for (const [i0, i1, isGable] of [[I(0), I(1), false], [I(1), I(2), true], [I(2), I(3), false], [I(3), I(0), true]] as [number, number, boolean][]) {
      if (o.skipWall?.(r[i0], r[i1])) continue;
      this.wall(this.S(), r[i0], r[i1], bottom, eave, wall);
      if (isGable) { const m = mid(r[i0], r[i1]), L = Math.hypot(r[i1][0] - r[i0][0], r[i1][1] - r[i0][1]), n = V((r[i1][1] - r[i0][1]) / L, 0, -(r[i1][0] - r[i0][0]) / L);
        this.S().tri(V(r[i0][0], eave, r[i0][1]), V(r[i1][0], eave, r[i1][1]), V(m[0], ridge, m[1]), o.gableColor ?? wall, n); }
    }
    const g0 = mid(e[I(1)], e[I(2)]), g1 = mid(e[I(3)], e[I(0)]);
    this.S().quad(V(e[I(0)][0], eY, e[I(0)][1]), V(e[I(1)][0], eY, e[I(1)][1]), V(g0[0], ridge, g0[1]), V(g1[0], ridge, g1[1]), roof, UP);
    this.S().quad(V(e[I(2)][0], eY, e[I(2)][1]), V(e[I(3)][0], eY, e[I(3)][1]), V(g1[0], ridge, g1[1]), V(g0[0], ridge, g0[1]), roof, UP);
    for (const [i0, i1] of [[I(0), I(1)], [I(2), I(3)]]) this.S().quad(V(r[i0][0], eave, r[i0][1]), V(r[i1][0], eave, r[i1][1]), V(e[i1][0], eY, e[i1][1]), V(e[i0][0], eY, e[i0][1]), roof, DOWN);
    // barge undersides at the gable ends (between wall top line and the overhanging roof edge)
    for (const [i0, i1] of [[I(1), I(2)], [I(3), I(0)]]) { const m = mid(r[i0], r[i1]), me = mid(e[i0], e[i1]);
      this.S().quad(V(r[i0][0], eave, r[i0][1]), V(m[0], ridge, m[1]), V(me[0], ridge, me[1]), V(e[i0][0], eY, e[i0][1]), roof, DOWN);
      this.S().quad(V(m[0], ridge, m[1]), V(r[i1][0], eave, r[i1][1]), V(e[i1][0], eY, e[i1][1]), V(me[0], ridge, me[1]), roof, DOWN); }
    return { r, slope, ridgeEnds: [mid(r[I(1)], r[I(2)]), mid(r[I(3)], r[I(0)])] as [Point, Point] };
  }
}

/** Rotated rectangle: centre, unit axis (along), half-lengths along / across. */
export const rect = (cx: number, cz: number, ax: [number, number], hl: number, hw: number): Point[] => {
  const [ux, uz] = ax, vx = -uz, vz = ux;
  return [[cx - ux * hl - vx * hw, cz - uz * hl - vz * hw], [cx + ux * hl - vx * hw, cz + uz * hl - vz * hw], [cx + ux * hl + vx * hw, cz + uz * hl + vz * hw], [cx - ux * hl + vx * hw, cz - uz * hl + vz * hw]];
};

/** Triangulate rings (outer + holes) and subdivide to edges <= maxEdge (x,z) (from b06 authored-bodies.ts). */
export function triangulate(rings: Point[][], maxEdge: number): [Point, Point, Point][] {
  const contour = rings[0].map(p => new THREE.Vector2(p[0], p[1])), holes = rings.slice(1).map(r => r.map(p => new THREE.Vector2(p[0], p[1])));
  const all = [contour, ...holes].flat(), out: [Point, Point, Point][] = [];
  const split = (t: [Point, Point, Point], depth: number) => {
    const l = [0, 1, 2].map(i => Math.hypot(t[(i + 1) % 3][0] - t[i][0], t[(i + 1) % 3][1] - t[i][1])), m = l.indexOf(Math.max(...l));
    if (l[m] <= maxEdge || depth > 14) { out.push(t); return; }
    const a = t[m], c = t[(m + 1) % 3], o = t[(m + 2) % 3], mid: Point = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    split([a, mid, o], depth + 1); split([mid, c, o], depth + 1);
  };
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, holes)) split([[all[i].x, all[i].y], [all[j].x, all[j].y], [all[k].x, all[k].y]], 0);
  return out;
}
/** Hipped body without overhang: walls to the eave, roof rise = slope x distance to the eave line, eave chosen so the
 * highest point reaches `ridge` (the generator's hip massing semantics: top = ridge, slope = rise per metre). */
export function hipBody(k: Kit, ring: Point[], bottom: number, ridge: number, slope: number, wall: THREE.Color, roof: THREE.Color) {
  const r = orient(ring), tris = triangulate([r], 0.8);
  const maxD = Math.max(...tris.flat().map(p => ringDist(p[0], p[1], r))), eave = ridge - slope * maxD;
  for (const e of edgesOf(r)) k.wall(k.S(), e.a, e.c, bottom, eave, wall);
  const lift = (p: Point) => new THREE.Vector3(p[0], eave + slope * ringDist(p[0], p[1], r), p[1]);
  for (const t of tris) k.S().tri(lift(t[0]), lift(t[1]), lift(t[2]), roof, UP);
  return { eave };
}
