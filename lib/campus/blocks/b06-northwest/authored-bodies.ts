// b06-northwest: small authored-body kit (walls, flat decks with parapets, hipped / gabled / pyramidal roofs,
// punched windows) for the records b06's install() rebuilds. Adapted from b04-tower/historic-infill.ts (same
// conventions: outer rings counter-clockwise in x,z so offsetRing(+d) is outward; heights are ABSOLUTE campus Y).
// Everything solid goes into per-material buckets whose triangles also form the collider (G2/G3: visible = physical);
// window panes / trim bands are flush visual detail.
import * as THREE from 'three';
import type { Point } from '../../types';
import { offsetRing } from '../../context-geometry';

export const area = (r: Point[]) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
export const orient = (r: Point[], positive = true) => (area(r) > 0) === positive ? r.slice() : r.slice().reverse();
export const segDist = (px: number, pz: number, a: Point, b: Point) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l)) : 0;
  return Math.hypot(a[0] + t * dx - px, a[1] + t * dz - pz);
};
export const ringDist = (x: number, z: number, r: Point[]) => { let d = Infinity; for (let i = 0; i < r.length; i++) d = Math.min(d, segDist(x, z, r[i], r[(i + 1) % r.length])); return d; };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0), DOWN = V(0, -1, 0);

/** Positions + uvs for one material; triangles are wound so their normal agrees with `hint`. */
export class Bucket {
  pos: number[] = []; uv: number[] = [];
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, hint?: THREE.Vector3, ua: [number, number] = [a.x + a.z, a.y], ub: [number, number] = [b.x + b.z, b.y], uc: [number, number] = [c.x + c.z, c.y]) {
    if (hint) { const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)); if (n.dot(hint) < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; } }
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); this.uv.push(...ua, ...ub, ...uc);
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, hint: THREE.Vector3) { this.tri(a, b, c, hint); this.tri(a, c, d, hint); }
  /** Flat panel on a wall: edge origin o, along u, outward n; x along, y = centre height, z = offset out. */
  panel(o: THREE.Vector3, u: THREE.Vector3, n: THREE.Vector3, x: number, y: number, z: number, w: number, h: number) {
    const P = (sx: number, sy: number) => o.clone().addScaledVector(u, x + sx * w / 2).setY(y + sy * h / 2).addScaledVector(n, z);
    this.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), n);
  }
  get triangles() { return this.pos.length / 9; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

export class Kit {
  solid = new Map<string, Bucket>(); walk = new Map<string, Bucket>(); detail = new Map<string, Bucket>();
  windows = 0;
  S(k: string) { let b = this.solid.get(k); if (!b) this.solid.set(k, b = new Bucket()); return b; }
  W(k: string) { let b = this.walk.get(k); if (!b) this.walk.set(k, b = new Bucket()); return b; }
  D(k: string) { let b = this.detail.get(k); if (!b) this.detail.set(k, b = new Bucket()); return b; }

  /** Vertical wall on edge a->c of an outward-oriented ring, from y0 to y1 (or to per-end tops). */
  wall(key: string, a: Point, c: Point, y0: number, y1: number, y1c = y1) {
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 0.02 || (y1 - y0 < 0.01 && y1c - y0 < 0.01)) return;
    const n = V((c[1] - a[1]) / L, 0, -(c[0] - a[0]) / L);
    this.S(key).quad(V(a[0], y0, a[1]), V(c[0], y0, c[1]), V(c[0], y1c, c[1]), V(a[0], y1, a[1]), n);
  }
  /** Horizontal polygon (outer + holes) at y, facing up (walkable or solid) or down. */
  cap(bucket: Bucket, rings: Point[][], y: number, face: 'up' | 'down' = 'up') {
    const contour = rings[0].map(p => new THREE.Vector2(p[0], p[1])), holes = rings.slice(1).map(r => r.map(p => new THREE.Vector2(p[0], p[1])));
    const all = [contour, ...holes].flat();
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, holes))
      bucket.tri(V(all[i].x, y, all[i].y), V(all[j].x, y, all[j].y), V(all[k].x, y, all[k].y), face === 'up' ? UP : DOWN, [all[i].x, all[i].y], [all[j].x, all[j].y], [all[k].x, all[k].y]);
  }
  /** Punched windows on a wall edge: rows every `storey` from `first` while the head stays below `top`. */
  windowsOn(a: Point, c: Point, first: number, top: number, o: { storey: number; bay: number; w: number; h: number; glass: string; trim?: string; skip?: (x: number, y: number) => boolean }) {
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]), count = Math.floor(L / o.bay); if (count < 1) return;
    const u = V((c[0] - a[0]) / L, 0, (c[1] - a[1]) / L), n = V(u.z, 0, -u.x), org = V(a[0], 0, a[1]);
    for (let y = first; y + o.h <= top; y += o.storey) for (let j = 0; j < count; j++) {
      const x = (j + 0.5) * L / count, w = Math.min(o.w, L / count - 0.5); if (w < 0.5) continue;
      const p = org.clone().addScaledVector(u, x);
      if (o.skip?.(p.x, p.z) || o.skip?.(p.x, y)) continue;
      this.D(o.glass).panel(org, u, n, x, y + o.h / 2, 0.03, w, o.h);
      if (o.trim) { this.D(o.trim).panel(org, u, n, x, y - 0.08, 0.06, w + 0.3, 0.16); this.D(o.trim).panel(org, u, n, x, y + o.h + 0.1, 0.06, w + 0.3, 0.2); }
      this.windows++;
    }
  }
  /** Closed prism: walls on every edge from `bottom` to `top`, flat top (with optional parapet) at `top`. */
  flatBody(ring: Point[], bottom: number, deck: number, o: { wall: string; roof: string; parapet?: number; coping?: string; skipEdge?: (a: Point, c: Point) => boolean }) {
    const r = orient(ring), p = o.parapet ?? 0, top = deck + p;
    for (let i = 0; i < r.length; i++) if (!o.skipEdge?.(r[i], r[(i + 1) % r.length])) this.wall(o.wall, r[i], r[(i + 1) % r.length], bottom, top);
    if (p > 0) {
      const inner = offsetRing(r, -0.3);
      for (let i = 0; i < r.length; i++) {
        const j = (i + 1) % r.length;
        this.S(o.coping ?? o.wall).quad(V(r[i][0], top, r[i][1]), V(r[j][0], top, r[j][1]), V(inner[j][0], top, inner[j][1]), V(inner[i][0], top, inner[i][1]), UP);
        // inner parapet face looks inward
        const a = inner[i], c = inner[j], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 0.02) continue;
        this.S(o.wall).quad(V(a[0], deck, a[1]), V(c[0], deck, c[1]), V(c[0], top, c[1]), V(a[0], top, a[1]), V(-(c[1] - a[1]) / L, 0, (c[0] - a[0]) / L));
      }
      this.cap(this.S(o.roof), [inner], deck);
    } else this.cap(this.S(o.roof), [r], deck);
  }
  /** Walls to `eave`, then a pyramid / cone (polygon ring) to `apex` over the eave ring (overhang). */
  pyramidBody(ring: Point[], bottom: number, eave: number, apex: number, o: { wall: string; roof: string; overhang?: number }) {
    const r = orient(ring); for (let i = 0; i < r.length; i++) this.wall(o.wall, r[i], r[(i + 1) % r.length], bottom, eave);
    const ov = o.overhang ?? 0.35, e = offsetRing(r, ov), cx = r.reduce((s, p) => s + p[0], 0) / r.length, cz = r.reduce((s, p) => s + p[1], 0) / r.length;
    const span = Math.max(...r.map(p => Math.hypot(p[0] - cx, p[1] - cz))), eY = eave - (apex - eave) / span * ov;
    for (let i = 0; i < e.length; i++) {
      const j = (i + 1) % e.length;
      this.S(o.roof).tri(V(e[i][0], eY, e[i][1]), V(e[j][0], eY, e[j][1]), V(cx, apex, cz), UP);
      this.S(o.roof).quad(V(r[i][0], eave, r[i][1]), V(r[j][0], eave, r[j][1]), V(e[j][0], eY, e[j][1]), V(e[i][0], eY, e[i][1]), DOWN);
    }
  }
  /** Rectangular body (4-point ring) with a gable roof: ridge parallel to the long-axis edges named by `axisEdge`
   * (0 = edges 0-1 / 2-3 are the eave edges, 1 = edges 1-2 / 3-0). Gable end walls rise to the roof line. */
  gableBody(ring: Point[], bottom: number, eave: number, ridge: number, axisEdge: 0 | 1, o: { wall: string; roof: string; overhang?: number }) {
    const r = orient(ring); const k = axisEdge;
    const ov = o.overhang ?? 0.45, e = offsetRing(r, ov);
    // eave edges: (k, k+1) and (k+2, k+3); gable ends: (k+1, k+2) and (k+3, k)
    const I = (i: number) => (i + k) % 4;
    const mid = (p: Point, q: Point): Point => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const half = segDist(...mid(r[I(1)], r[I(2)]), r[I(0)], r[I(1)]), slope = (ridge - eave) / half, eY = eave - slope * ov;
    // gable walls and eave walls
    for (const [i0, i1, gable] of [[I(0), I(1), false], [I(1), I(2), true], [I(2), I(3), false], [I(3), I(0), true]] as [number, number, boolean][]) {
      this.wall(o.wall, r[i0], r[i1], bottom, eave);
      if (gable) {
        const m = mid(r[i0], r[i1]), L = Math.hypot(r[i1][0] - r[i0][0], r[i1][1] - r[i0][1]), n = V((r[i1][1] - r[i0][1]) / L, 0, -(r[i1][0] - r[i0][0]) / L);
        this.S(o.wall).tri(V(r[i0][0], eave, r[i0][1]), V(r[i1][0], eave, r[i1][1]), V(m[0], ridge, m[1]), n);
      }
    }
    // roof planes (eave ring corners, ridge points over the gable-end mid points extended by the overhang)
    const rg0 = mid(e[I(1)], e[I(2)]), rg1 = mid(e[I(3)], e[I(0)]);
    const RY = ridge;
    this.S(o.roof).quad(V(e[I(0)][0], eY, e[I(0)][1]), V(e[I(1)][0], eY, e[I(1)][1]), V(rg0[0], RY, rg0[1]), V(rg1[0], RY, rg1[1]), UP);
    this.S(o.roof).quad(V(e[I(2)][0], eY, e[I(2)][1]), V(e[I(3)][0], eY, e[I(3)][1]), V(rg1[0], RY, rg1[1]), V(rg0[0], RY, rg0[1]), UP);
    // soffits under the eave overhang (long sides) and barge undersides (gable ends)
    for (const [i0, i1] of [[I(0), I(1)], [I(2), I(3)]]) this.S(o.roof).quad(V(r[i0][0], eave, r[i0][1]), V(r[i1][0], eave, r[i1][1]), V(e[i1][0], eY, e[i1][1]), V(e[i0][0], eY, e[i0][1]), DOWN);
    return { slope };
  }
  /** Hipped roof over any ring (straight-skeleton height: rise = slope x distance to the eave line, capped at
   * ridgeMax), eave solved so the roof's area-weighted median equals `median` (b04 method). Returns the wall top. */
  hipBody(ring: Point[], bottom: number, median: number, ridgeMax: number, slope: number, o: { wall: string; roof: string; overhang?: number; exclude?: (x: number, z: number) => boolean }) {
    const r = orient(ring), ov = o.overhang ?? 0.5, e = offsetRing(r, ov);
    const tris = triangulate([e], 1.6);
    const rises = tris.map(t => { const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cz = (t[0][1] + t[1][1] + t[2][1]) / 3;
      return { r: slope * ringDist(cx, cz, e), a: Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) / 2 }; }).sort((p, q) => p.r - q.r);
    const total = rises.reduce((s, x) => s + x.a, 0); let acc = 0, med = 0;
    for (const x of rises) { acc += x.a; if (acc >= total / 2) { med = x.r; break; } }
    const eaveY = median - med, wallTop = eaveY + slope * ov;
    for (let i = 0; i < r.length; i++) this.wall(o.wall, r[i], r[(i + 1) % r.length], bottom, wallTop);
    const lift = (p: Point) => V(p[0], Math.min(ridgeMax, eaveY + slope * ringDist(p[0], p[1], e)), p[1]);
    for (const t of tris) { if (o.exclude?.((t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3)) continue; this.S(o.roof).tri(lift(t[0]), lift(t[1]), lift(t[2]), UP); }
    for (let i = 0; i < r.length; i++) { const j = (i + 1) % r.length; this.S(o.roof).quad(V(r[i][0], wallTop, r[i][1]), V(r[j][0], wallTop, r[j][1]), V(e[j][0], eaveY, e[j][1]), V(e[i][0], eaveY, e[i][1]), DOWN); }
    return { wallTop, eaveY };
  }
}

/** Triangulate rings (outer + holes) and subdivide to edges <= maxEdge (x,z). */
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
