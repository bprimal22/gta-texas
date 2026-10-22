// b04-tower: authored bodies for two real buildings the generated context never drew.
//
//  * GOL Goldsmith Hall (GIS 734456) was classified "route" because a 2 m coverage cell on its
//    north edge touched the West Mall paving (which research/WEST_MALL.md already trims 0.15 m
//    off the footprint), so no body was emitted at all.
//  * GEB Gebauer Building (GIS 734466) was classified "authored" only because WCH yard planting
//    soil sits >3 m above the contour inside its south edge; no authored module draws Gebauer.
//
// Massing comes from the measured 2017 USGS LiDAR tiers in the SAME datum (campus Y =
// groundY + tier height, public/data/derived/roofs-lidar.json); footprints are the GIS rings.
// Hipped roofs use the straight-skeleton height function (rise = slope x distance to the eave
// line), with each eave solved so the roof's area-weighted median equals the LiDAR tier median.
// Facade rhythm (bay width, storey height, doors) is an estimate and is labelled as such in
// research/whole-campus-92/b04-tower/EVIDENCE.md. Walls/roofs: one trimesh collider per building
// built from exactly the rendered wall and roof triangles. Window panes, sills and door panels
// are flush visual trim (<=0.2 m proud) returned as detail. Round 3 (D06/D07): optional round-arched heads, string
// courses, gallery and greenhouse glazing bars (visual trim, <= 0.26 m proud), a stepped stone cornice that is SOLID
// (in the collider), and a curved glass eave; all are opt-in per volume (InfillVolume) and labelled as estimates.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Point } from '../../types';
import { offsetRing } from '../../context-geometry';

export interface InfillVolume {
  /** Outer ring first, then courtyard holes (campus x,z). */
  rings: Point[][];
  roof: 'hip' | 'flat';
  /** Hip roofs: target area-weighted median roof height (campus Y, LiDAR tier). */
  roofMedian?: number;
  /** Hip roofs: hard cap on the ridge (campus Y, LiDAR heightMax). */
  ridgeMax?: number;
  /** Flat roofs: deck height (campus Y) and parapet above it. */
  deck?: number;
  parapet?: number;
  slope?: number;
  overhang?: number;
  /** Lowest storey that gets windows starts at this height above local grade. */
  firstSill?: number;
  storey?: number;
  bay?: number;
  /** Highest row of windows ends below this campus Y (defaults to the eave/deck). */
  windowTop?: number;
  /** Windows only above this campus Y (tower shafts above a lower roof). */
  windowBottom?: number;
  /** Door centres (campus x,z) on a wall line (within 1 m); width 2.4 m, estimate. */
  doors?: Point[];
  /** Outset (m) to keep coplanar walls of a taller volume in front of a lower one. */
  outset?: number;
  /** Wall line inset from the GIS ring (m): keeps abutting authored paving outside the 0.3 m capsule. */
  inset?: number;
  /** Edges lying on these rings (a taller neighbouring volume) get no wall and are pushed out by
   * `inset` onto that volume's inset wall plane, so the two bodies meet without a slot. */
  abuts?: Point[][];
  /** Window rows with round-arched heads (opening height 0.72 storey, semicircular head, voussoir band + keystone):
   * `row` counted from the bottom row (0) or, with `fromTop`, from the top row; only on edges lying (both ends within
   * 1 m) on one of `edges` when given. Visual trim only. */
  arches?: { row: number; fromTop?: boolean; edges?: [Point, Point][] }[];
  /** Stone string course (0.28 m high, 0.1 m proud) at every storey line above the first window row. Visual trim. */
  stringCourses?: boolean;
  /** Flat roofs: stepped stone cornice whose top is `below` m under the wall (parapet) top, `height` m deep and
   * `projection` m proud, mitred at convex corners. It is SOLID (in the collider, same triangles); optional dentil
   * course (visual trim) under its corona. */
  cornice?: { below: number; height: number; projection: number; dentils?: boolean };
  /** Top-storey open gallery on every wall of the volume: band `height` m under the wall top with stone piers every
   * ~`bay` m, a dark recessed opening between them and a stone balustrade. Rows of punched windows in the band are
   * dropped. Visual trim (flush shadow panel, <= 0.24 m proud stone). */
  gallery?: { height: number; bay: number };
  /** Hip roofs: curved eave of radius R (m) replacing the soffit + fascia: the wall plane turns smoothly into the roof
   * pitch (greenhouse). The eave line is then INSIDE the wall line by (1 - cos t) R, t = 90 deg - pitch. */
  eaveCurve?: number;
  /** Glazing bars every `glazingBars` m on walls, eave curve and roof facets (greenhouse); disables punched windows
   * and doors on the volume. Visual trim. */
  glazingBars?: number;
}

export interface InfillSpec {
  id: number; abbr: string; name: string;
  volumes: InfillVolume[];
  /** `shadow`: dark recess panel of open galleries; `bars`: glazing bars (default `frame`). */
  materials: { wall: string; plinth: string; roof: string; glass: string; frame: string; door: string; trim: string; deck?: string; shadow?: string; bars?: string };
  plinthHeight: number;
}

export interface InfillResult {
  solids: THREE.Mesh[]; detail: THREE.Mesh[]; colliders: RAPIER.Collider[];
  stats: Record<string, unknown>; geometries: THREE.BufferGeometry[];
}

const area = (r: Point[]) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const orient = (r: Point[], positive: boolean) => (area(r) > 0) === positive ? r.slice() : r.slice().reverse();
const segDist = (px: number, pz: number, a: Point, b: Point) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l)) : 0;
  return Math.hypot(a[0] + t * dx - px, a[1] + t * dz - pz);
};
const ringsDist = (x: number, z: number, rings: Point[][]) => { let d = Infinity; for (const r of rings) for (let i = 0; i < r.length; i++) d = Math.min(d, segDist(x, z, r[i], r[(i + 1) % r.length])); return d; };

/** Collects positions/uvs per material; triangles are wound so the face normal agrees with `hint`. */
class Bucket {
  pos: number[] = []; uv: number[] = [];
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ua: [number, number], ub: [number, number], uc: [number, number], hint?: THREE.Vector3) {
    if (hint) {
      const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      if (n.dot(hint) < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; }
    }
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); this.uv.push(...ua, ...ub, ...uc);
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, ua: [number, number], ub: [number, number], uc: [number, number], ud: [number, number], hint: THREE.Vector3) {
    this.tri(a, b, c, ua, ub, uc, hint); this.tri(a, c, d, ua, uc, ud, hint);
  }
  /** Axis box in an edge frame (origin o, along u, out n): x along, y up, z out. */
  box(o: THREE.Vector3, u: THREE.Vector3, n: THREE.Vector3, x: number, y: number, z: number, w: number, h: number, d: number, faces: 'front' | 'all' | 'noTop' = 'all') {
    const P = (sx: number, sy: number, sz: number) => o.clone().addScaledVector(u, x + sx * w / 2).setY(y + sy * h / 2).addScaledVector(n, z + sz * d / 2);
    const up = new THREE.Vector3(0, 1, 0), down = up.clone().negate();
    const f = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, e: THREE.Vector3, hint: THREE.Vector3, uw: number, vh: number) => this.quad(a, b, c, e, [0, 0], [uw, 0], [uw, vh], [0, vh], hint);
    f(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), n, w, h);
    if (faces === 'front') return;
    if (faces !== 'noTop') f(P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1), up, w, d);
    f(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), down, w, d);
    f(P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), u.clone().negate(), d, h);
    f(P(1, -1, -1), P(1, -1, 1), P(1, 1, 1), P(1, 1, -1), u, d, h);
  }
  /** Flat ring sector band in an edge frame (origin o, along u, out n), centred (x, y), radii r0..r1, angles
   * a0..a1 (0 = along +u, PI/2 = up), at distance z in front of the wall; facing +n. Metre uvs (frame x, y). */
  arcBand(o: THREE.Vector3, u: THREE.Vector3, n: THREE.Vector3, x: number, y: number, z: number, r0: number, r1: number, a0: number, a1: number, seg: number) {
    const P = (r: number, a: number) => o.clone().addScaledVector(u, x + r * Math.cos(a)).setY(y + r * Math.sin(a)).addScaledVector(n, z);
    const U = (r: number, a: number): [number, number] => [x + r * Math.cos(a), y + r * Math.sin(a)];
    for (let k = 0; k < seg; k++) {
      const p = a0 + (a1 - a0) * k / seg, q = a0 + (a1 - a0) * (k + 1) / seg;
      if (r0 <= 1e-6) this.tri(P(0, p), P(r1, p), P(r1, q), U(0, p), U(r1, p), U(r1, q), n);
      else this.quad(P(r0, p), P(r1, p), P(r1, q), P(r0, q), U(r0, p), U(r1, p), U(r1, q), U(r0, q), n);
    }
  }
  /** Outer curved face of an arch band (radius r, from z0 to z1 in front of the wall), facing away from the centre. */
  arcRim(o: THREE.Vector3, u: THREE.Vector3, n: THREE.Vector3, x: number, y: number, z0: number, z1: number, r: number, a0: number, a1: number, seg: number) {
    for (let k = 0; k < seg; k++) {
      const p = a0 + (a1 - a0) * k / seg, q = a0 + (a1 - a0) * (k + 1) / seg, m = (p + q) / 2;
      const P = (a: number, z: number) => o.clone().addScaledVector(u, x + r * Math.cos(a)).setY(y + r * Math.sin(a)).addScaledVector(n, z);
      const hint = u.clone().multiplyScalar(Math.cos(m)).setY(Math.sin(m));
      this.quad(P(p, z0), P(q, z0), P(q, z1), P(p, z1), [r * p, z0], [r * q, z0], [r * q, z1], [r * p, z1], hint);
    }
  }
  /** Thin bar along a 3D polyline: top face (width w, normal ~ `up`) and two side faces (depth d below). */
  bar(points: THREE.Vector3[], side: THREE.Vector3, up: THREE.Vector3, w: number, d: number) {
    let s = 0;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i], b = points[i + 1], l = a.distanceTo(b); if (l < 1e-4) continue;
      const h = side.clone().multiplyScalar(w / 2), dn = up.clone().multiplyScalar(-d);
      const a0 = a.clone().sub(h), a1 = a.clone().add(h), b0 = b.clone().sub(h), b1 = b.clone().add(h);
      this.quad(a0, a1, b1, b0, [s, 0], [s, w], [s + l, w], [s + l, 0], up);
      this.quad(a0, b0, b0.clone().add(dn), a0.clone().add(dn), [s, 0], [s + l, 0], [s + l, d], [s, d], side.clone().negate());
      this.quad(a1, b1, b1.clone().add(dn), a1.clone().add(dn), [s, 0], [s + l, 0], [s + l, d], [s, d], side);
      s += l;
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

/** Triangulate rings (outer + holes), subdivide to <= maxEdge and return triangles in x,z. */
function triangulate(rings: Point[][], maxEdge: number): [Point, Point, Point][] {
  const contour = rings[0].map(p => new THREE.Vector2(p[0], p[1])), holes = rings.slice(1).map(r => r.map(p => new THREE.Vector2(p[0], p[1])));
  const all = [contour, ...holes].flat();
  const out: [Point, Point, Point][] = [];
  const split = (t: [Point, Point, Point], depth: number) => {
    const l = [0, 1, 2].map(i => Math.hypot(t[(i + 1) % 3][0] - t[i][0], t[(i + 1) % 3][1] - t[i][1]));
    const m = l.indexOf(Math.max(...l));
    if (l[m] <= maxEdge || depth > 14) { out.push(t); return; }
    const a = t[m], c = t[(m + 1) % 3], o = t[(m + 2) % 3], mid: Point = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    split([a, mid, o], depth + 1); split([mid, c, o], depth + 1);
  };
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, holes)) split([[all[i].x, all[i].y], [all[j].x, all[j].y], [all[k].x, all[k].y]], 0);
  return out;
}

/** Offset each edge outward (+) / inward (-) by its own distance; vertices = adjacent offset-line intersections. */
function offsetEdges(ring: Point[], d: number[]): Point[] {
  const n = ring.length, N = ring.map((p, i) => { const q = ring[(i + 1) % n], l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return [(q[1] - p[1]) / l, -(q[0] - p[0]) / l] as Point; });
  return ring.map((p, i) => {
    const j = (i + n - 1) % n, n0 = N[j], n1 = N[i];
    const a0: Point = [p[0] + n0[0] * d[j], p[1] + n0[1] * d[j]], a1: Point = [p[0] + n1[0] * d[i], p[1] + n1[1] * d[i]];
    const t0: Point = [-n0[1], n0[0]], t1: Point = [-n1[1], n1[0]], den = t0[0] * t1[1] - t0[1] * t1[0];
    if (Math.abs(den) < 1e-3) return a1;
    const s0 = ((a1[0] - a0[0]) * t1[1] - (a1[1] - a0[1]) * t1[0]) / den;
    const x: Point = [a0[0] + t0[0] * s0, a0[1] + t0[1] * s0];
    return Math.hypot(x[0] - p[0], x[1] - p[1]) > 3 * Math.max(Math.abs(d[i]), Math.abs(d[j]), 0.01) ? a1 : x;
  });
}

export function buildInfill(spec: InfillSpec, ground: (x: number, z: number) => number, material: (name: string) => THREE.Material | undefined, physics: RAPIER.World): InfillResult {
  const mat = (name: string) => { const m = material(name); if (!m) throw new Error(`${spec.abbr}: material "${name}" missing`); return m; };
  const M = spec.materials;
  const solid = new Map<string, Bucket>(), trim = new Map<string, Bucket>();
  const S = (k: string) => { let b = solid.get(k); if (!b) solid.set(k, b = new Bucket()); return b; };
  const D = (k: string) => { let b = trim.get(k); if (!b) trim.set(k, b = new Bucket()); return b; };
  const up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0);
  let windows = 0, doors = 0, arched = 0, courses = 0, galleryBays = 0, corniceM = 0, dentils = 0, bars = 0;
  const report: Record<string, unknown>[] = [];
  const barKey = M.bars ?? M.frame;
  for (const vol of spec.volumes) {
    const shift = (vol.outset ?? 0) - (vol.inset ?? 0);
    const onAbut = (a: Point, c: Point) => (vol.abuts ?? []).some(r => r.some((p, i) => { const q = r[(i + 1) % r.length]; return segDist(a[0], a[1], p, q) < 0.05 && segDist(c[0], c[1], p, q) < 0.05; }));
    const src = vol.rings.map((r, k) => orient(r, k === 0));
    const shared = src.map(r => r.map((p, i) => onAbut(p, r[(i + 1) % r.length])));
    const rings = src.map((r, k) => shift ? offsetEdges(r, r.map((_, i) => shared[k][i] ? (vol.inset ?? 0) : shift)) : r);
    const all = rings.flat();
    const bottom = Math.min(...all.map(p => ground(p[0], p[1]))) - 1.5;
    const slope = vol.slope ?? 0.48, R = vol.eaveCurve ?? 0, theta = Math.PI / 2 - Math.atan(slope);
    // Curved eave: the eave line sits (1 - cos t) R inside the wall and R sin t above the wall top.
    const overhang = R > 0 ? -(1 - Math.cos(theta)) * R : vol.overhang ?? 0.55, fascia = R > 0 ? R * Math.sin(theta) : 0.22;
    let wallTop: number, ridge = 0, medianRise = 0;
    const eaveRings = vol.roof === 'hip' ? rings.map(r => offsetRing(r, overhang)) : rings;
    const roofTris = vol.roof === 'hip' ? triangulate(eaveRings, 2.2) : [];
    if (vol.roof === 'hip') {
      // Solve the eave from the LiDAR median: rise(p) = slope * distance-to-eave, capped at the ridge.
      const rises = roofTris.map(t => {
        const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cz = (t[0][1] + t[1][1] + t[2][1]) / 3;
        const a = Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) / 2;
        return { r: slope * ringsDist(cx, cz, eaveRings), a };
      }).sort((p, q) => p.r - q.r);
      const total = rises.reduce((s, x) => s + x.a, 0); let acc = 0;
      for (const x of rises) { acc += x.a; if (acc >= total / 2) { medianRise = x.r; break; } }
      const maxRise = rises.length ? rises[rises.length - 1].r : 0;
      wallTop = vol.roofMedian! - medianRise - fascia;
      ridge = Math.min(vol.ridgeMax ?? Infinity, wallTop + fascia + maxRise);
    } else wallTop = vol.deck! + (vol.parapet ?? 0);
    const roofBase = wallTop + fascia;
    // Walls (+ plinth band) on every ring edge, outward-facing.
    const onEdges = (a: Point, c: Point, edges?: [Point, Point][]) => !edges || edges.some(([p, q]) => segDist(a[0], a[1], p, q) < 1 && segDist(c[0], c[1], p, q) < 1);
    const gal = vol.gallery ? { y0: wallTop - vol.gallery.height, y1: wallTop - 0.3 } : null;
    rings.forEach((ring, k) => {
      let run = 0;
      const dir = (i: number) => { const a = ring[(i + ring.length) % ring.length], c = ring[(i + 1) % ring.length], l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1; return [(c[0] - a[0]) / l, (c[1] - a[1]) / l] as Point; };
      // Building interior lies left of every oriented edge, so a left turn (cross > 0) is a convex corner of the solid.
      const convex = (i: number) => { const p = dir(i - 1), q = dir(i); return p[0] * q[1] - p[1] * q[0] > 1e-3; };
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], c = ring[(i + 1) % ring.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (L < 0.05) continue;
        if (shared[k][i]) { run += L; continue; }
        const u = new THREE.Vector3((c[0] - a[0]) / L, 0, (c[1] - a[1]) / L), n = new THREE.Vector3(u.z, 0, -u.x);
        const o = new THREE.Vector3(a[0], 0, a[1]);
        const gMid = Math.min(ground(a[0], a[1]), ground(c[0], c[1]), ground((a[0] + c[0]) / 2, (a[1] + c[1]) / 2));
        const plinthTop = Math.max(gMid + spec.plinthHeight, bottom + 0.5);
        const wall = (y0: number, y1: number, key: string) => {
          if (y1 - y0 < 0.01) return;
          S(key).quad(new THREE.Vector3(a[0], y0, a[1]), new THREE.Vector3(c[0], y0, c[1]), new THREE.Vector3(c[0], y1, c[1]), new THREE.Vector3(a[0], y1, a[1]),
            [run, y0], [run + L, y0], [run + L, y1], [run, y1], n);
        };
        const top = vol.roof === 'flat' ? wallTop : wallTop;
        wall(bottom, Math.min(plinthTop, top), M.plinth); wall(Math.min(plinthTop, top), top, M.wall);
        // Water-table course over the plinth.
        D(M.trim).box(o, u, n, L / 2, plinthTop, 0.06, L, 0.24, 0.12);
        // Solid stepped cornice (collider = these triangles), mitred by running past convex corners.
        if (vol.cornice) {
          const C = vol.cornice, e0 = convex(i) ? C.projection : 0, e1 = convex(i + 1) ? C.projection : 0;
          const yTop = wallTop - C.below, yMid = yTop - C.height * 0.42, yBot = yTop - C.height;
          const box = (ext0: number, ext1: number, y0: number, y1: number, d: number, faces: 'all' | 'noTop') =>
            S(M.trim).box(o, u, n, (L + ext1 - ext0) / 2, (y0 + y1) / 2, d / 2 - 0.05, L + ext0 + ext1, y1 - y0, d + 0.1, faces);
          box(e0 * 0.6, e1 * 0.6, yBot, yMid, C.projection * 0.6, 'noTop'); // fascia band (its top is hidden under the corona)
          box(e0, e1, yMid, yTop, C.projection, 'all');                     // corona
          corniceM += L;
          if (C.dentils) for (let x = 0.3; x < L - 0.2; x += 0.5) { D(M.trim).box(o, u, n, x, yMid - 0.11, C.projection * 0.6 + 0.08, 0.2, 0.22, 0.16); dentils++; }
        }
        if (vol.glazingBars) {
          // Greenhouse: mullions from the knee-wall sill to the eave, sill/mid/head rails; no punched openings.
          const s = vol.glazingBars, nb = Math.max(1, Math.round(L / s)), side = u.clone();
          for (let j = 1; j < nb; j++) { const x = L * j / nb, p = o.clone().addScaledVector(u, x); bars++;
            D(barKey).bar([p.clone().setY(plinthTop).addScaledVector(n, 0.04), p.clone().setY(wallTop).addScaledVector(n, 0.04)], side, n, 0.06, 0.04); }
          for (const y of [plinthTop + 0.06, (plinthTop + wallTop) / 2, wallTop - 0.04]) D(barKey).box(o, u, n, L / 2, y, 0.03, L, 0.07, 0.06);
          run += L; continue;
        }
        // Windows: storey rows of punched openings (estimate rhythm), flush panes + sill + head.
        const storey = vol.storey ?? 4.2, bay = vol.bay ?? 3.6, first = gMid + (vol.firstSill ?? 1.1);
        const winTop = Math.min(vol.windowTop ?? Infinity, vol.roof === 'hip' ? wallTop - 0.6 : vol.deck! - 0.6, gal ? gal.y0 - 0.5 : Infinity);
        const count = Math.floor(L / bay);
        const doorTs = (vol.doors ?? []).filter(d => segDist(d[0], d[1], a, c) < 1)
          .map(d => ((d[0] - a[0]) * u.x + (d[1] - a[1]) * u.z) / L).filter(t => t > 0.1 && t < 0.9);
        for (const t of doorTs) {
          const x = L * t, w = 2.4, h = 3.4;
          D(M.door).box(o, u, n, x, gMid + h / 2 + 0.05, 0.03, w, h, 0.06, 'front');
          D(M.trim).box(o, u, n, x, gMid + h + 0.35, 0.08, w + 0.9, 0.5, 0.16);
          for (const s of [-1, 1]) D(M.trim).box(o, u, n, x + s * (w / 2 + 0.22), gMid + h / 2 + 0.2, 0.08, 0.44, h + 0.4, 0.16);
          doors++;
        }
        const rows: number[] = [];
        for (let y = first; y + 2.0 <= winTop; y += storey) if (vol.windowBottom === undefined || y >= vol.windowBottom) rows.push(y);
        const archedRow = new Set((vol.arches ?? []).filter(r => onEdges(a, c, r.edges)).map(r => r.fromTop ? rows.length - 1 - r.row : r.row));
        if (vol.stringCourses) for (let r = 1; r < rows.length; r++) { D(M.trim).box(o, u, n, L / 2, rows[r] - 0.5, 0.05, L, 0.28, 0.1); courses++; }
        if (count >= 1) rows.forEach((y, r) => {
          const arch = archedRow.has(r), h = arch ? Math.min(storey * 0.72, winTop - y) : Math.min(storey * 0.56, winTop - y);
          for (let j = 0; j < count; j++) {
            const x = (j + 0.5) * L / count, w = Math.min(1.5, L / count - 0.9);
            if (w < 0.6 || doorTs.some(t => Math.abs(L * t - x) < 2.4) && y < first + storey) continue;
            if (arch) {
              // Round-arched opening: rectangle up to the springing line + semicircular glass head, voussoir band, keystone, imposts.
              const rr = w / 2, hr = h - rr, ys = y + hr;
              D(M.glass).box(o, u, n, x, y + hr / 2, 0.02, w, hr, 0.02, 'front');
              D(M.glass).arcBand(o, u, n, x, ys, 0.03, 0, rr, 0, Math.PI, 10);
              D(M.frame).box(o, u, n, x, y + hr / 2, 0.045, 0.06, hr, 0.03, 'front');
              D(M.frame).box(o, u, n, x, ys, 0.045, w, 0.06, 0.03, 'front');
              D(M.trim).arcBand(o, u, n, x, ys, 0.09, rr + 0.02, rr + 0.26, 0, Math.PI, 10);
              D(M.trim).arcRim(o, u, n, x, ys, 0.0, 0.09, rr + 0.26, 0, Math.PI, 10);
              D(M.trim).box(o, u, n, x, ys + rr + 0.16, 0.1, 0.34, 0.44, 0.2);
              for (const s of [-1, 1]) D(M.trim).box(o, u, n, x + s * (rr + 0.14), ys - 0.07, 0.08, 0.34, 0.14, 0.16);
              D(M.trim).box(o, u, n, x, y - 0.07, 0.08, w + 0.3, 0.14, 0.16);
              arched++; windows++;
              continue;
            }
            D(M.glass).box(o, u, n, x, y + h / 2, 0.02, w, h, 0.02, 'front');
            D(M.frame).box(o, u, n, x, y + h * 0.62, 0.045, w, 0.06, 0.03, 'front');
            D(M.frame).box(o, u, n, x, y + h / 2, 0.045, 0.06, h, 0.03, 'front');
            D(M.trim).box(o, u, n, x, y - 0.07, 0.08, w + 0.3, 0.14, 0.16);
            D(M.trim).box(o, u, n, x, y + h + 0.11, 0.05, w + 0.24, 0.22, 0.1, 'front');
            windows++;
          }
        });
        if (gal) {
          // Open gallery: stone piers, dark recess between them, bottom/top rails with balusters, lintel band above.
          const nb = Math.max(1, Math.round(L / vol.gallery!.bay)), pw = 0.5, gh = gal.y1 - gal.y0, shadow = M.shadow ?? M.glass;
          for (let j = 0; j <= nb; j++) D(M.trim).box(o, u, n, Math.min(L - pw / 2, Math.max(pw / 2, L * j / nb)), gal.y0 + gh / 2, 0.07, pw, gh, 0.14);
          for (let j = 0; j < nb; j++) {
            const x0 = L * j / nb + pw / 2, x1 = L * (j + 1) / nb - pw / 2, cx = (x0 + x1) / 2, ow = x1 - x0; if (ow < 0.4) continue;
            D(shadow).box(o, u, n, cx, gal.y0 + gh / 2, 0.015, ow, gh, 0.02, 'front');
            D(M.trim).box(o, u, n, cx, gal.y0 + 0.09, 0.11, ow, 0.18, 0.22);
            D(M.trim).box(o, u, n, cx, gal.y0 + 1.0, 0.12, ow, 0.12, 0.24);
            for (let b = x0 + 0.2; b < x1 - 0.1; b += 0.3) D(M.trim).box(o, u, n, b, gal.y0 + 0.59, 0.11, 0.09, 0.7, 0.09);
            galleryBays++;
          }
          D(M.trim).box(o, u, n, L / 2, gal.y1 + 0.13, 0.06, L, 0.26, 0.12);
        }
        run += L;
      }
    });
    if (vol.roof === 'hip') {
      if (R > 0) {
        // Curved eave (solid, same material as the roof): arcs from the wall top (vertical tangent) to the roof pitch.
        const K = 5, rs = Array.from({ length: K + 1 }, (_, j) => { const f = theta * j / K; return { y: wallTop + R * Math.sin(f), ring: rings.map(r => j === 0 ? r : offsetRing(r, -(1 - Math.cos(f)) * R)) }; });
        rs[K].ring = eaveRings;
        rings.forEach((ring, k) => {
          for (let i = 0; i < ring.length; i++) {
            const j = (i + 1) % ring.length, L = Math.hypot(ring[j][0] - ring[i][0], ring[j][1] - ring[i][1]);
            if (L < 0.05 || shared[k][i]) continue;
            const n = new THREE.Vector3((ring[j][1] - ring[i][1]) / L, 0, -(ring[j][0] - ring[i][0]) / L);
            for (let s = 0; s < K; s++) {
              const A = rs[s].ring[k], B = rs[s + 1].ring[k], f = theta * (s + 0.5) / K, hint = n.clone().multiplyScalar(Math.cos(f)).setY(Math.sin(f));
              const v0 = R * theta * s / K, v1 = R * theta * (s + 1) / K;
              S(M.roof).quad(new THREE.Vector3(A[i][0], rs[s].y, A[i][1]), new THREE.Vector3(A[j][0], rs[s].y, A[j][1]), new THREE.Vector3(B[j][0], rs[s + 1].y, B[j][1]), new THREE.Vector3(B[i][0], rs[s + 1].y, B[i][1]),
                [0, v0], [L, v0], [L, v1], [0, v1], hint);
            }
            // Glazing bars over the curve, continuing the wall mullions.
            if (vol.glazingBars) {
              const nb = Math.max(1, Math.round(L / vol.glazingBars)), u = new THREE.Vector3((ring[j][0] - ring[i][0]) / L, 0, (ring[j][1] - ring[i][1]) / L);
              for (let m = 1; m < nb; m++) {
                const x = L * m / nb; if (x < R || x > L - R) continue;
                const pts = Array.from({ length: K + 1 }, (_, s) => { const f = theta * s / K, out = 0.04 - (1 - Math.cos(f)) * R;
                  return new THREE.Vector3(ring[i][0] + u.x * x + n.x * out, wallTop + R * Math.sin(f) + 0.04 * Math.sin(f), ring[i][1] + u.z * x + n.z * out); });
                D(barKey).bar(pts, u, n.clone().multiplyScalar(Math.cos(theta / 2)).setY(Math.sin(theta / 2)).normalize(), 0.06, 0.04); bars++;
              }
            }
          }
        });
      } else {
        // Soffit + fascia between wall top and eave line, then the hipped tile surface.
        rings.forEach((ring, k) => {
          const e = eaveRings[k];
          for (let i = 0; i < ring.length; i++) {
            const j = (i + 1) % ring.length, a = ring[i], c = ring[j], oa = e[i], ob = e[j], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
            if (L < 0.05 || shared[k][i]) continue;
            const n = new THREE.Vector3((c[1] - a[1]) / L, 0, -(c[0] - a[0]) / L);
            S(M.trim).quad(new THREE.Vector3(a[0], wallTop, a[1]), new THREE.Vector3(c[0], wallTop, c[1]), new THREE.Vector3(ob[0], wallTop, ob[1]), new THREE.Vector3(oa[0], wallTop, oa[1]),
              [0, 0], [L, 0], [L, overhang], [0, overhang], down);
            S(M.trim).quad(new THREE.Vector3(oa[0], wallTop, oa[1]), new THREE.Vector3(ob[0], wallTop, ob[1]), new THREE.Vector3(ob[0], roofBase, ob[1]), new THREE.Vector3(oa[0], roofBase, oa[1]),
              [0, 0], [L, 0], [L, fascia], [0, fascia], n);
          }
        });
      }
      const lift = (p: Point) => new THREE.Vector3(p[0], Math.min(ridge, roofBase + slope * ringsDist(p[0], p[1], eaveRings)), p[1]);
      for (const t of roofTris) {
        const [a, b, c] = t.map(lift);
        const nn = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)); if (nn.y < 0) nn.negate();
        const h = Math.hypot(nn.x, nn.z), dx = h > 1e-6 ? nn.x / h : 1, dz = h > 1e-6 ? nn.z / h : 0, kk = Math.sqrt(1 + slope * slope);
        const uv = (p: THREE.Vector3): [number, number] => [p.x * -dz + p.z * dx, (p.x * dx + p.z * dz) * kk];
        S(M.roof).tri(a, b, c, uv(a), uv(b), uv(c), up);
      }
      if (vol.glazingBars) {
        // Roof glazing bars: rafters from each eave edge straight up its own facet to the hip/ridge (where another
        // edge becomes nearer or the ridge cap is reached), 0.03 m over the glass.
        const step = 0.35, gs = vol.glazingBars;
        eaveRings.forEach((e, k) => {
          for (let i = 0; i < e.length; i++) {
            const p = e[i], q = e[(i + 1) % e.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
            if (L < 0.6 || shared[k]?.[i]) continue;
            const ux = (q[0] - p[0]) / L, uz = (q[1] - p[1]) / L, inx = -uz, inz = ux; // left of the edge = inside
            const nb = Math.max(1, Math.round(L / gs));
            for (let m = 1; m < nb; m++) {
              const x0 = p[0] + ux * L * m / nb, z0 = p[1] + uz * L * m / nb, pts: THREE.Vector3[] = [];
              for (let s = 0; s < 80; s++) {
                const d = Math.max(0.02, s * step), x = x0 + inx * d, z = z0 + inz * d;
                if (ringsDist(x, z, eaveRings) < d - 1e-3) break;     // crossed the hip/valley into another facet
                const y = roofBase + slope * d; if (y > ridge - 0.02) break;
                pts.push(new THREE.Vector3(x, y + 0.03, z));
              }
              if (pts.length >= 2) { D(barKey).bar(pts, new THREE.Vector3(ux, 0, uz), new THREE.Vector3(-inx * slope, 1, -inz * slope).normalize(), 0.05, 0.03); bars++; }
            }
          }
        });
      }
    } else {
      // Flat deck inside a parapet: inner parapet face, coping, deck.
      const inner = rings.map(r => offsetRing(r, -0.35));
      const deck = vol.deck!, deckKey = M.deck ?? M.roof;
      rings.forEach((ring, k) => {
        const e = inner[k];
        for (let i = 0; i < ring.length; i++) {
          const j = (i + 1) % ring.length, a = ring[i], c = ring[j], ia = e[i], ib = e[j], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
          if (L < 0.05 || shared[k][i]) continue;
          const n = new THREE.Vector3((c[1] - a[1]) / L, 0, -(c[0] - a[0]) / L);
          S(M.trim).quad(new THREE.Vector3(a[0], wallTop, a[1]), new THREE.Vector3(c[0], wallTop, c[1]), new THREE.Vector3(ib[0], wallTop, ib[1]), new THREE.Vector3(ia[0], wallTop, ia[1]),
            [0, 0], [L, 0], [L, 0.35], [0, 0.35], up);
          S(M.wall).quad(new THREE.Vector3(ia[0], deck, ia[1]), new THREE.Vector3(ib[0], deck, ib[1]), new THREE.Vector3(ib[0], wallTop, ib[1]), new THREE.Vector3(ia[0], wallTop, ia[1]),
            [0, deck], [L, deck], [L, wallTop], [0, wallTop], n.clone().negate());
        }
      });
      for (const t of triangulate(inner, 6)) {
        const [a, b, c] = t.map(p => new THREE.Vector3(p[0], deck, p[1]));
        S(deckKey).tri(a, b, c, [a.x, a.z], [b.x, b.z], [c.x, c.z], up);
      }
    }
    report.push({ roof: vol.roof, bottom: +bottom.toFixed(2), wallTop: +wallTop.toFixed(2), ridge: vol.roof === 'hip' ? +ridge.toFixed(2) : undefined,
      medianTarget: vol.roofMedian ?? vol.deck, medianRise: +medianRise.toFixed(2) });
  }
  const solids: THREE.Mesh[] = [], detail: THREE.Mesh[] = [], geometries: THREE.BufferGeometry[] = [];
  const colliderParts: THREE.BufferGeometry[] = [];
  for (const [key, b] of solid) {
    const g = b.geometry(); geometries.push(g); colliderParts.push(g);
    const m = new THREE.Mesh(g, mat(key)); m.name = `${spec.abbr} ${key}`; m.castShadow = m.receiveShadow = true; m.userData.b04 = spec.abbr; m.userData.block = 'b04-tower'; solids.push(m);
  }
  for (const [key, b] of trim) {
    const g = b.geometry(); geometries.push(g);
    const m = new THREE.Mesh(g, mat(key)); m.name = `${spec.abbr} trim ${key}`; m.castShadow = false; m.receiveShadow = true; m.userData.b04 = spec.abbr; detail.push(m);
  }
  const merged = mergeGeometries(colliderParts.map(g => { const c = new THREE.BufferGeometry(); c.setAttribute('position', g.getAttribute('position')); return c; }));
  if (!merged) throw new Error(`${spec.abbr}: collider merge failed`);
  const vertices = new Float32Array(merged.getAttribute('position').array);
  merged.dispose();
  const indices = new Uint32Array(vertices.length / 3).map((_, i) => i);
  const collider = physics.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.8));
  const tris = (ms: THREE.Mesh[]) => ms.reduce((s, m) => s + m.geometry.getAttribute('position').count / 3, 0);
  return { solids, detail, colliders: [collider], geometries,
    stats: { id: spec.id, abbr: spec.abbr, volumes: report, windows, doors, arched, stringCourses: courses, galleryBays, corniceM: +corniceM.toFixed(1), dentils, glazingBars: bars, solidTriangles: tris(solids), detailTriangles: tris(detail), colliderTriangles: indices.length / 3, draws: solids.length + detail.length } };
}
