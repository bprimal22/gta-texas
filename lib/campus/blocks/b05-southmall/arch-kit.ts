// Block b05-southmall geometry kit for the D08/D09/D10 authored architecture (b05-private; never imported by
// another block). Triangle soups per finish, split into SOLID (rendered + one trimesh collider from exactly the same
// triangles) and DETAIL (visual-only trim < 0.3 m: mullions, quoins, mouldings, beam undersides).
// UVs are in metres on each face's own plane (u along the horizontal tangent, v up the plane), so a facade reads
// continuously along an edge and the kit's textures (repeat = 1 / tile metres) are never stretched per face.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { B05Kit, FinishKey } from './pbr-kit';

export type P2 = [number, number];
export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

export class Soup {
  p: number[] = []; n: number[] = []; uv: number[] = [];
  get triangles() { return this.p.length / 9; }
  private basis(fn: THREE.Vector3) {
    if (Math.abs(fn.y) > 0.99999) return { t: V(1, 0, 0), b: V(0, 0, 1) };
    const t = V(fn.z, 0, -fn.x).normalize();
    return { t, b: new THREE.Vector3().crossVectors(fn, t).normalize() };
  }
  /** Flat triangle (face normal) with plane-projected metre UVs. Degenerate triangles are dropped. */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
    const fn = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(c, a));
    const l = fn.length(); if (l < 1e-8) return; fn.multiplyScalar(1 / l);
    const { t, b: bb } = this.basis(fn);
    for (const v of [a, b, c]) { this.p.push(v.x, v.y, v.z); this.n.push(fn.x, fn.y, fn.z); this.uv.push(v.dot(t), v.dot(bb)); }
  }
  /** Smooth triangle with explicit normals and UVs (lathes). Winding must already match the normals. */
  triNU(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, na: THREE.Vector3, nb: THREE.Vector3, nc: THREE.Vector3, ua: P2, ub: P2, uc: P2) {
    const fn = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(c, a));
    if (fn.lengthSq() < 1e-14) return;
    for (const [v, n, u] of [[a, na, ua], [b, nb, ub], [c, nc, uc]] as const) { this.p.push(v.x, v.y, v.z); this.n.push(n.x, n.y, n.z); this.uv.push(u[0], u[1]); }
  }
  /** Triangle wound so its normal faces `out`. */
  triF(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, out: THREE.Vector3) {
    const n = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(c, a));
    if (n.dot(out) < 0) this.tri(a, c, b); else this.tri(a, b, c);
  }
  /** Planar quad a-b-c-d (perimeter order) wound so its normal faces `out`. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, out: THREE.Vector3) {
    this.triF(a, b, c, out); this.triF(a, c, d, out);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

/** One building group: per-finish solid + detail soups, built into meshes and one trimesh collider. */
export class Group {
  solid = new Map<FinishKey, Soup>(); detail = new Map<FinishKey, Soup>();
  constructor(public name: string) {}
  s(k: FinishKey) { let x = this.solid.get(k); if (!x) this.solid.set(k, x = new Soup()); return x; }
  d(k: FinishKey) { let x = this.detail.get(k); if (!x) this.detail.set(k, x = new Soup()); return x; }
  build(kit: B05Kit, physics: RAPIER.World, opts: { localContext: boolean; record?: string }) {
    const solids: THREE.Mesh[] = [], detail: THREE.Mesh[] = [], geometries: THREE.BufferGeometry[] = [], pos: number[] = [];
    let solidTris = 0, detailTris = 0;
    const mk = (k: FinishKey, soup: Soup, solid: boolean) => {
      if (!soup.triangles) return;
      const g = soup.geometry(); geometries.push(g);
      const m = new THREE.Mesh(g, kit.material(k));
      m.name = `b05 ${this.name} ${k}${solid ? '' : ' (visual trim)'}`;
      m.castShadow = solid || k !== 'glass'; m.receiveShadow = true;
      m.userData.block = 'b05-southmall'; m.userData.b05Group = this.name; if (opts.record) m.userData.record = opts.record;
      // Additive geometry on a generated building must not enter the context coverage raster (it would suppress
      // the generated body it decorates); authored replacement bodies stay in it like every authored building.
      if (opts.localContext) m.userData.localContext = true;
      (solid ? solids : detail).push(m);
      if (solid) { for (const v of soup.p) pos.push(v); solidTris += soup.triangles; } else detailTris += soup.triangles;
    };
    for (const [k, soup] of this.solid) mk(k, soup, true);
    for (const [k, soup] of this.detail) mk(k, soup, false);
    let collider: RAPIER.Collider | null = null;
    if (pos.length) {
      const v = new Float32Array(pos), idx = new Uint32Array(v.length / 3).map((_, i) => i);
      collider = physics.createCollider(RAPIER.ColliderDesc.trimesh(v, idx).setFriction(0.8));
    }
    return { solids, detail, geometries, collider, solidTris, detailTris, colliderTris: pos.length / 9 };
  }
}

// ---------- plan helpers ----------
export const signedArea2 = (r: P2[]) => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
export function pip(x: number, z: number, r: P2[]) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; }
  return c;
}
export function segDist(px: number, pz: number, a: P2, b: P2) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l)) : 0;
  return Math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz);
}
export const edgeDist = (x: number, z: number, r: P2[]) => { let d = Infinity; for (let i = 0; i < r.length; i++) d = Math.min(d, segDist(x, z, r[i], r[(i + 1) % r.length])); return d; };
/** Drop a closing duplicate vertex. */
export const open = (r: P2[]) => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r.slice());

/** Edge frame: u along a->b, n outward (away from the ring interior), length. */
export interface Frame { a: P2; b: P2; u: P2; n: P2; len: number }
export function frames(ring: P2[]): Frame[] {
  return ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    const u: P2 = [dx / len, dz / len]; let n: P2 = [u[1], -u[0]];
    const mx = (a[0] + b[0]) / 2 + n[0] * 0.05, mz = (a[1] + b[1]) / 2 + n[1] * 0.05;
    if (pip(mx, mz, ring)) n = [-n[0], -n[1]];
    return { a, b, u, n, len };
  });
}
/** Point on a frame: s along the edge, t outward of the edge line, at height y. */
export const fp = (f: Frame, s: number, t: number, y: number) => V(f.a[0] + f.u[0] * s + f.n[0] * t, y, f.a[1] + f.u[1] * s + f.n[1] * t);
export const fp2 = (f: Frame, s: number, t: number): P2 => [f.a[0] + f.u[0] * s + f.n[0] * t, f.a[1] + f.u[1] * s + f.n[1] * t];
export const outN = (f: Frame, sign = 1) => V(f.n[0] * sign, 0, f.n[1] * sign);
export const alongU = (f: Frame, sign = 1) => V(f.u[0] * sign, 0, f.u[1] * sign);

/** Offset every edge line of a convex ring by d (positive = outward), vertices at line intersections. */
export function offsetConvex(ring: P2[], d: number | ((i: number) => number)): P2[] {
  const F = frames(ring), dist = typeof d === 'number' ? () => d : d;
  const lines = F.map((f, i) => ({ p: [f.a[0] + f.n[0] * dist(i), f.a[1] + f.n[1] * dist(i)] as P2, u: f.u }));
  return ring.map((_, i) => {
    const A = lines[(i + ring.length - 1) % ring.length], B = lines[i], den = A.u[0] * B.u[1] - A.u[1] * B.u[0];
    if (Math.abs(den) < 1e-9) return B.p;
    const t = ((B.p[0] - A.p[0]) * B.u[1] - (B.p[1] - A.p[1]) * B.u[0]) / den;
    return [A.p[0] + A.u[0] * t, A.p[1] + A.u[1] * t] as P2;
  });
}

// ---------- solid primitives ----------
/** Vertical rectangle on a frame at offset t, facing +n (sign 1) or -n (sign -1). */
export function rect(s: Soup, f: Frame, s0: number, s1: number, t: number, y0: number, y1: number, sign = 1) {
  if (s1 - s0 < 1e-4 || y1 - y0 < 1e-4) return;
  s.quad(fp(f, s0, t, y0), fp(f, s1, t, y0), fp(f, s1, t, y1), fp(f, s0, t, y1), outN(f, sign));
}
/** Oriented box in frame coordinates [s0,s1] x [t0,t1] x [y0,y1]; `omit` skips hidden faces. */
export function box(s: Soup, f: Frame, s0: number, s1: number, t0: number, t1: number, y0: number, y1: number,
  omit: Partial<Record<'front' | 'back' | 'left' | 'right' | 'top' | 'bottom', boolean>> = {}) {
  const P = (ss: number, tt: number, yy: number) => fp(f, ss, tt, yy);
  if (!omit.front) s.quad(P(s0, t1, y0), P(s1, t1, y0), P(s1, t1, y1), P(s0, t1, y1), outN(f));
  if (!omit.back) s.quad(P(s0, t0, y0), P(s1, t0, y0), P(s1, t0, y1), P(s0, t0, y1), outN(f, -1));
  if (!omit.left) s.quad(P(s0, t0, y0), P(s0, t1, y0), P(s0, t1, y1), P(s0, t0, y1), alongU(f, -1));
  if (!omit.right) s.quad(P(s1, t0, y0), P(s1, t1, y0), P(s1, t1, y1), P(s1, t0, y1), alongU(f));
  if (!omit.top) s.quad(P(s0, t0, y1), P(s1, t0, y1), P(s1, t1, y1), P(s0, t1, y1), UP);
  if (!omit.bottom) s.quad(P(s0, t0, y0), P(s1, t0, y0), P(s1, t1, y0), P(s0, t1, y0), V(0, -1, 0));
}
/** Horizontal polygon at y (up or down). */
export function cap(s: Soup, ring: P2[], y: number, up: boolean) {
  const r = signedArea2(ring) > 0 ? ring : ring.slice().reverse();
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(r.map(([x, z]) => new THREE.Vector2(x, z)), []))
    s.triF(V(r[i][0], y, r[i][1]), V(r[j][0], y, r[j][1]), V(r[k][0], y, r[k][1]), up ? UP : V(0, -1, 0));
}

export interface Opening { s0: number; s1: number; y0: number; y1: number }
/** Wall plane at offset t over [s0,s1] x [y0,y1] with rectangular openings: wall cells, jamb/sill/head reveals
 * of `depth` and glass at the back of each reveal. Openings must lie inside the wall and not overlap. */
export function punchedWall(wall: Soup, reveal: Soup, glass: Soup | null, f: Frame, s0: number, s1: number, y0: number, y1: number,
  openings: Opening[], depth: number, t = 0) {
  const ss = [...new Set([s0, s1, ...openings.flatMap(o => [o.s0, o.s1])])].filter(v => v >= s0 && v <= s1).sort((a, b) => a - b);
  const ys = [...new Set([y0, y1, ...openings.flatMap(o => [o.y0, o.y1])])].filter(v => v >= y0 && v <= y1).sort((a, b) => a - b);
  for (let j = 0; j + 1 < ys.length; j++) {
    const ym = (ys[j] + ys[j + 1]) / 2; let run: number | null = null;
    for (let i = 0; i + 1 < ss.length; i++) {
      const sm = (ss[i] + ss[i + 1]) / 2, hole = openings.some(o => sm > o.s0 && sm < o.s1 && ym > o.y0 && ym < o.y1);
      if (!hole && run === null) run = ss[i];
      if ((hole || i + 2 === ss.length) && run !== null) { rect(wall, f, run, hole ? ss[i] : ss[i + 1], t, ys[j], ys[j + 1]); run = null; }
    }
  }
  for (const o of openings) {
    const P = (s: number, tt: number, y: number) => fp(f, s, tt, y), tb = t - depth;
    reveal.quad(P(o.s0, t, o.y0), P(o.s0, tb, o.y0), P(o.s0, tb, o.y1), P(o.s0, t, o.y1), alongU(f));
    reveal.quad(P(o.s1, t, o.y0), P(o.s1, tb, o.y0), P(o.s1, tb, o.y1), P(o.s1, t, o.y1), alongU(f, -1));
    reveal.quad(P(o.s0, t, o.y0), P(o.s1, t, o.y0), P(o.s1, tb, o.y0), P(o.s0, tb, o.y0), UP);
    reveal.quad(P(o.s0, t, o.y1), P(o.s1, t, o.y1), P(o.s1, tb, o.y1), P(o.s0, tb, o.y1), V(0, -1, 0));
    if (glass) rect(glass, f, o.s0, o.s1, tb, o.y0, o.y1);
  }
}

/** Lathe around a vertical axis: profile [radius, y] bottom->top, outward normals, UV = (arc metres, profile metres).
 * `lobes` scales the radius by (1 + amp cos(k theta + phase)) proportionally to the profile parameter. */
export function lathe(s: Soup, cx: number, cz: number, profile: [number, number][], seg: number,
  lobe: { k: number; amp: number; phase: number; from: number } | null = null) {
  const prof = profile.map(([r, y], i) => ({ r, y, w: i / (profile.length - 1) }));
  let acc = 0; const arc = prof.map((p, i) => (i ? (acc += Math.hypot(p.r - prof[i - 1].r, p.y - prof[i - 1].y)) : 0));
  const radius = (j: number, th: number) => {
    const p = prof[j], g = lobe && p.w > lobe.from ? ((p.w - lobe.from) / (1 - lobe.from)) : 0;
    return p.r * (1 + (lobe ? lobe.amp * g * Math.cos(lobe.k * th + lobe.phase) : 0));
  };
  const pt = (j: number, i: number) => { const th = (i / seg) * Math.PI * 2, r = radius(j, th); return V(cx + Math.cos(th) * r, prof[j].y, cz + Math.sin(th) * r); };
  const nor = (j: number, i: number) => {
    const th = (i / seg) * Math.PI * 2, j0 = Math.max(0, j - 1), j1 = Math.min(prof.length - 1, j + 1);
    const dr = radius(j1, th) - radius(j0, th), dy = prof[j1].y - prof[j0].y;
    return V(Math.cos(th) * dy, -dr, Math.sin(th) * dy).normalize();
  };
  for (let j = 0; j + 1 < prof.length; j++) for (let i = 0; i < seg; i++) {
    const a = pt(j, i), b = pt(j, i + 1), c = pt(j + 1, i + 1), d = pt(j + 1, i);
    const na = nor(j, i), nb = nor(j, i + 1), nc = nor(j + 1, i + 1), nd = nor(j + 1, i);
    const ua: P2 = [(i / seg) * 2 * Math.PI * prof[j].r, arc[j]], ub: P2 = [((i + 1) / seg) * 2 * Math.PI * prof[j].r, arc[j]];
    const uc: P2 = [((i + 1) / seg) * 2 * Math.PI * prof[j + 1].r, arc[j + 1]], ud: P2 = [(i / seg) * 2 * Math.PI * prof[j + 1].r, arc[j + 1]];
    // Outward winding: (a, c, b) has normal pointing away from the axis for an increasing-theta ring order.
    s.triNU(a, c, b, na, nc, nb, ua, uc, ub); s.triNU(a, d, c, na, nd, nc, ua, ud, uc);
  }
}
export const cylinder = (s: Soup, cx: number, cz: number, r: number, y0: number, y1: number, seg = 12) => lathe(s, cx, cz, [[r, y0], [r, y1]], seg);

// ---------- hipped roof (exact planar facets) ----------
/** Roof plane Y = A x + B z + C. */
export type Plane = [number, number, number];
/** Keep the part of a convex polygon where A x + B z + C >= 0 (Sutherland-Hodgman, one half plane). */
export function clipHalf(poly: P2[], A: number, B: number, C: number): P2[] {
  const out: P2[] = [], f = (p: P2) => A * p[0] + B * p[1] + C;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], fp0 = f(p), fq = f(q);
    if (fp0 >= 0) out.push(p);
    if ((fp0 >= 0) !== (fq >= 0)) { const t = fp0 / (fp0 - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out.filter((p, i) => Math.hypot(p[0] - out[(i + 1) % out.length][0], p[1] - out[(i + 1) % out.length][1]) > 1e-6);
}
export interface HipRoof { roofY: (x: number, z: number) => number; planes: Plane[]; eave: P2[]; eaveY: number; wallY: number; crownY: number; slope: number; facets: number }
/** Eave planes of a convex ring: plane i rises by `slope` per metre inward from edge i of `eave`, starting at eaveY. */
export function eavePlanes(eave: P2[], eaveY: number, slope: number): Plane[] {
  return frames(eave).map(f => [-slope * f.n[0], -slope * f.n[1], eaveY + slope * (f.a[0] * f.n[0] + f.a[1] * f.n[1])] as Plane);
}
/** Hipped roof over a convex ring as the EXACT lower envelope of the eave planes and a flat crown plane: each plane's
 * cell is the eave outline clipped to plane_i <= plane_j for every j, triangulated as its own convex polygon and set
 * on plane i, so hips, ridges and the crown boundary are straight creases (no lifted grid, no sawtooth). Plus the
 * sloped soffit under the overhang and the fascia. The same triangles are the collider. */
export function hipRoof(roof: Soup, soffit: Soup, fascia: Soup, ring: P2[], o: { wallY: number; slope: number; overhang: number; crownY: number; thick: number }): HipRoof {
  const eave = offsetConvex(ring, o.overhang), eaveY = o.wallY - o.slope * o.overhang;
  const planes: Plane[] = [...eavePlanes(eave, eaveY, o.slope), [0, 0, o.crownY]];
  const Y = (pl: Plane, x: number, z: number) => pl[0] * x + pl[1] * z + pl[2];
  const roofY = (x: number, z: number) => Math.min(...planes.map(pl => Y(pl, x, z)));
  let facets = 0;
  planes.forEach((pi, i) => {
    let poly = eave.slice();
    planes.forEach((pj, j) => { if (j !== i && poly.length) poly = clipHalf(poly, pj[0] - pi[0], pj[1] - pi[1], pj[2] - pi[2] + (j < i ? -1e-7 : 1e-7)); });
    if (poly.length < 3) return;
    facets++;
    for (let k = 1; k + 1 < poly.length; k++) {
      const [a, b, c] = [poly[0], poly[k], poly[k + 1]].map(p => V(p[0], Y(pi, p[0], p[1]), p[1]));
      roof.triF(a, b, c, UP);
    }
  });
  const F = frames(ring);
  F.forEach((f, i) => {
    const j = (i + 1) % ring.length, a = ring[i], b = ring[j], ea = eave[i], eb = eave[j];
    soffit.quad(V(a[0], o.wallY - o.thick, a[1]), V(b[0], o.wallY - o.thick, b[1]), V(eb[0], eaveY - o.thick, eb[1]), V(ea[0], eaveY - o.thick, ea[1]), V(0, -1, 0));
    fascia.quad(V(ea[0], eaveY - o.thick, ea[1]), V(eb[0], eaveY - o.thick, eb[1]), V(eb[0], eaveY, eb[1]), V(ea[0], eaveY, ea[1]), outN(f));
  });
  return { roofY, planes, eave, eaveY, wallY: o.wallY, crownY: o.crownY, slope: o.slope, facets };
}

/** Arch-topped wall band over one bay: rectangle [s0,s1] x [ys,ytop] at offsets t (front) and t - thick (back), minus
 * a semicircular opening of radius r centred at sc on the springing height ys; with the intrados strip. */
export function archBay(wall: Soup, f: Frame, s0: number, s1: number, sc: number, r: number, ys: number, ytop: number, t: number, thick: number, seg = 10) {
  const contour: P2[] = [];
  if (sc - r - s0 > 1e-3) contour.push([s0, ys]);
  for (let k = seg; k >= 0; k--) { const th = (k / seg) * Math.PI; contour.push([sc + Math.cos(th) * r, ys + Math.sin(th) * r]); }
  if (s1 - (sc + r) > 1e-3) contour.push([s1, ys]);
  contour.push([s1, ytop], [s0, ytop]);
  const faces = THREE.ShapeUtils.triangulateShape(contour.map(([a, b]) => new THREE.Vector2(a, b)), []);
  for (const [tt, sign] of [[t, 1], [t - thick, -1]] as const)
    for (const [i, j, k] of faces) wall.triF(fp(f, contour[i][0], tt, contour[i][1]), fp(f, contour[j][0], tt, contour[j][1]), fp(f, contour[k][0], tt, contour[k][1]), outN(f, sign));
  for (let k = 0; k < seg; k++) {
    const t0 = (k / seg) * Math.PI, t1 = ((k + 1) / seg) * Math.PI, m = (t0 + t1) / 2;
    const p = (th: number, tt: number) => fp(f, sc + Math.cos(th) * r, tt, ys + Math.sin(th) * r);
    const inward = V(-f.u[0] * Math.cos(m), -Math.sin(m), -f.u[1] * Math.cos(m));
    wall.quad(p(t0, t), p(t1, t), p(t1, t - thick), p(t0, t - thick), inward);
  }
  // Short flats at the springing between the bay edge and the arch (column heads sit under them).
  if (sc - r - s0 > 1e-3) wall.quad(fp(f, s0, t, ys), fp(f, sc - r, t, ys), fp(f, sc - r, t - thick, ys), fp(f, s0, t - thick, ys), V(0, -1, 0));
  if (s1 - (sc + r) > 1e-3) wall.quad(fp(f, sc + r, t, ys), fp(f, s1, t, ys), fp(f, s1, t - thick, ys), fp(f, sc + r, t - thick, ys), V(0, -1, 0));
}

/** Mapped walkway segments (footway/pedestrian/steps/path/cycleway) near a box, for keeping supports off routes. */
export function walkSegments(paths: { kind: string; points: P2[] }[], x0: number, x1: number, z0: number, z1: number) {
  const W = new Set(['footway', 'pedestrian', 'steps', 'path', 'cycleway', 'living_street']), out: [P2, P2][] = [];
  for (const p of paths) if (W.has(p.kind)) for (let k = 1; k < p.points.length; k++) {
    const a = p.points[k - 1], b = p.points[k];
    if (Math.max(a[0], b[0]) < x0 || Math.min(a[0], b[0]) > x1 || Math.max(a[1], b[1]) < z0 || Math.min(a[1], b[1]) > z1) continue;
    out.push([a, b]);
  }
  return (x: number, z: number) => out.reduce((m, [a, b]) => Math.min(m, segDist(x, z, a, b)), Infinity);
}

/** Evenly divide a length into n >= 1 bays of about `target` metres. */
export const bays = (len: number, target: number) => { const n = Math.max(1, Math.round(len / target)); return Array.from({ length: n + 1 }, (_, i) => (i * len) / n); };
