// D10 Blanton plaza paving (round 5, block b05-southmall; private ground module composed by index.ts).
//
// Evidence (reference-interpreted, not 1:1):
//  - ut-bma-456 official directory photo: broad pale limestone slab paving between the petal stems, up to and under
//    the arcades, with planting beds (soil) and a lawn beyond; campus-12: pale paving in front of the BMS arcade and
//    portal, a central oval lawn with a low curved curb; campus-11: a curved pale walk around planting.
//  - Mapped geometry (campus.json / D10 packet): the BMS/BMA plaza facades and loggia depths of d10.ts, the footway
//    loop 1199982734/1199982735 around the oval lawn, the curved footway 1554396020 and the diagonal 375688846 around
//    a planting bed, the steps 1199982733 at the BMS south-east corner, the MLK-side footway 1049213430 (south edge).
//  - Trees: the CHM/TreeKeeper placements standing here in the frozen base (canopy-forest, 2026-10-21 probe) keep a
//    planting island of their crown radius (form radius x scale, >= 1.9 m), so tree placement sees no paving under
//    them and no shared tree moves.
// Estimates: the 1.5 m paved thresholds beyond the loggia ends, the 2.5 m paved band in front of each arcade, the
// planting bed outline, the south edge 1.25 m past the MLK-side footway centreline.
//
// Geometry: one paving outline (the two loggia floors, the wedge between the arcades and the south apron to the MLK
// footway) on a 0.5 m world grid, clipped exactly to the outline and with every hole subtracted exactly (convex
// polygons): arcade columns, piers, the BMS portal bay and petal stems (solid holes, 2 cm clear, paving abuts at full
// lift), and the lawn, planting and tree islands and the mapped steps (seam holes). Every vertex is draped on the
// visible baked ground: Y = ground + lift, lift = 0.035 m inside, ramping linearly over 0.45 m to 0.025 m BELOW the
// ground at every seam edge (no riser, the terrain and the mapped path finishes take over). Render and collider are the
// same triangles; the mesh is walkable ground (walkway.surfaces) and is kept out of the context coverage raster
// (localContext), so no generated building, road or tree decision changes.
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { BlockInstallContext } from '../types';
import type { B05Kit } from './pbr-kit';
import { Soup, V, bays, clipHalf, fp2, frames, offsetConvex, segDist, signedArea2, type Frame, type P2 } from './arch-kit';
import { BMA_SPEC, BMS_SPEC, PETALS, PETAL_STEM, type HallSpec } from './d10';
import { trimeshCollider } from './south-mall';

/** d10.ts arcade constants (module-private there; d10.ts stays unchanged): bay target, end pier, column radius, arch band. */
const BAY = 4.6, CP = 0.9, COL = 0.4, BAND = 0.7;
export const PLAZA = {
  /** Paving top above the visible ground, seam dip below it, seam ramp length, grid, loggia-end thresholds, solid clearance. */
  lift: 0.035, dip: 0.025, taper: 0.45, grid: 0.5, ext: 1.5, clear: 0.02,
  /** Construction cut added by the builder beyond `clear` at every solid hole and the inner loggia walls, so the emitted
   * Float32 triangles (rounding <= 6e-5 m at |z| ~ 600) stay strictly outside the original `clear` footprints. */
  cut: 0.001,
  /** Paved band kept in front of each arcade (campus-12) where an island would otherwise reach it. */
  arcadeBand: 2.5,
} as const;

export interface PlazaHole { name: string; kind: 'solid' | 'seam'; poly: P2[] }
export interface PlazaLayout { outline: P2[]; seam: boolean[]; holes: PlazaHole[] }

/** Base-scene tree placements around the plaza (x, z, crown radius = form radius x scale). */
export const PLAZA_TREES: [number, number, number][] = [
  [-70.4, 550.4, 4.0], [-72.79, 545.06, 2.47], [-65.93, 599.05, 1.33], [-62.22, 599.97, 5.6], [-58.59, 602.52, 7.07],
  [-54.04, 601.83, 2.99], [-96.39, 587.41, 2.98],
];
/** Mapped footway loop 1199982735 + 1199982734 around the central oval lawn. */
const OVAL_LOOP: P2[] = [
  [-79.7, 571.2], [-81.4, 570.7], [-82.1, 568.9], [-83.4, 564.8], [-83.4, 563.3], [-82.9, 561.6], [-81.9, 560.6], [-80.4, 560.0],
  [-70.5, 562.7], [-69.6, 563.4], [-69.1, 564.4], [-69.2, 566.1], [-76.3, 571.6], [-77.1, 571.8], [-78.6, 571.4],
];
/** Planting bed between the curved footway 1554396020 (west) and the diagonal 375688846 (east), ~1.2 m inside both,
 * 2.5 m off the BMA arcade; it holds the petal at (-74.5, 580.5). */
const PETAL_BED: P2[] = [[-74.8, 579.3], [-75.3, 582.9], [-71.8, 589.4], [-70.7, 589.4], [-70.3, 585.0]];
/** Steps 1199982733 (3.0 m wide). */
const STEPS: [P2, P2] = [[-87.2, 586.0], [-85.6, 581.4]];
/** South edge: the MLK-side footway 1049213430 offset 1.25 m south (half width 1.1 + 0.15), and the apron corners. */
const SOUTH: P2[] = [[-66.6, 596.5], [-67.0, 603.96], [-81.49, 599.29], [-90.8, 596.19]];

type Line = { p: P2; u: P2 };
const lineAt = (f: Frame, t: number): Line => ({ p: fp2(f, 0, t), u: f.u });
function meet(A: Line, B: Line): P2 {
  const den = A.u[0] * B.u[1] - A.u[1] * B.u[0];
  const t = ((B.p[0] - A.p[0]) * B.u[1] - (B.p[1] - A.p[1]) * B.u[0]) / den;
  return [A.p[0] + A.u[0] * t, A.p[1] + A.u[1] * t];
}
const ccw = (r: P2[]) => (signedArea2(r) > 0 ? r : r.slice().reverse());
/** Polygon circumscribing a circle of radius r (its edges never cut the circle). */
const circle = (c: P2, r: number, seg = 16): P2[] => {
  const R = r / Math.cos(Math.PI / seg);
  return Array.from({ length: seg }, (_, i) => [c[0] + R * Math.cos((i * 2 * Math.PI) / seg), c[1] + R * Math.sin((i * 2 * Math.PI) / seg)] as P2);
};
const frameRect = (f: Frame, s0: number, s1: number, t0: number, t1: number) => ccw([fp2(f, s0, t0), fp2(f, s1, t0), fp2(f, s1, t1), fp2(f, s0, t1)]);
/** Keep the left side (inside of a CCW ring) of a -> b, or the right side. */
const half = (poly: P2[], a: P2, b: P2, left: boolean) => {
  const A = -(b[1] - a[1]), B = b[0] - a[0], C = (b[1] - a[1]) * a[0] - (b[0] - a[0]) * a[1], s = left ? 1 : -1;
  return clipHalf(poly, s * A, s * B, s * C);
};
const area = (p: P2[]) => Math.abs(signedArea2(p));
const bbox = (p: P2[]) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return [x0, x1, z0, z1]; };
const overlap = (a: number[], b: number[]) => a[0] <= b[1] && b[0] <= a[1] && a[2] <= b[3] && b[2] <= a[3];

/** One hall's loggia corners and the solids standing on its paving (d10.ts arcade(): same bays, piers, portal bay). */
function hall(h: HallSpec, cut: number) {
  const ring = h.ring, n = ring.length, k = h.loggia.edge, prev = (k + n - 1) % n, next = (k + 1) % n, F = frames(ring);
  const K = F[k], P = F[prev], N = F[next], C = PLAZA.clear + cut, din = -(h.loggia.depth - C);
  const k0 = lineAt(K, 0), kin = lineAt(K, din);
  const pts = {
    pOut: meet(k0, lineAt(P, PLAZA.ext)), pIn: meet(kin, lineAt(P, PLAZA.ext)), pFace: meet(kin, lineAt(P, 0)),
    nOut: meet(k0, lineAt(N, PLAZA.ext)), nIn: meet(kin, lineAt(N, PLAZA.ext)), nFace: meet(kin, lineAt(N, 0)),
  };
  const inner = offsetConvex(ring, i => (i === k ? -h.loggia.depth : 0)), Pa = inner[k], Pb = inner[next];
  const proj = (f: Frame, p: P2) => (p[0] - f.a[0]) * f.u[0] + (p[1] - f.a[1]) * f.u[1];
  const sPa = proj(P, Pa), sPb = proj(N, Pb), solids: PlazaHole[] = [];
  const arcade = (f: Frame, a: number, b: number, portal?: number, piers: [boolean, boolean] = [true, true]) => {
    const bb = bays(b - a - 2 * CP, BAY).map(x => x + a + CP);
    for (let j = 1; j + 1 < bb.length; j++) solids.push({ name: `${h.name} column`, kind: 'solid', poly: circle(fp2(f, bb[j], -BAND / 2), COL + C) });
    if (portal !== undefined) {
      // Glazed "Check In" bay: glass in the band plane, gold posts 0.12 m proud (d10.ts).
      const lo = bb[portal] + (portal === 0 ? 0 : COL), hi = bb[portal + 1] - (portal + 2 === bb.length ? 0 : COL);
      solids.push({ name: `${h.name} portal bay`, kind: 'solid', poly: frameRect(f, lo - C, hi + C, -BAND / 2 - 0.05 - cut, 0.12 + C) });
    }
    ([[a, a + CP], [b - CP, b]] as const).forEach(([p0, p1], e) => { if (piers[e]) solids.push({ name: `${h.name} pier`, kind: 'solid', poly: frameRect(f, p0 - C, p1 + C, -CP - C, C) }); });
  };
  arcade(K, 0, K.len, h.portalBay);
  arcade(P, sPa - CP, P.len, undefined, [true, false]);
  arcade(N, 0, sPb + CP, undefined, [false, true]);
  return { pts, solids, K };
}

/** Plaza outline, its seam flags (edge i -> i+1) and the holes; pure function of the d10 specs and the mapped data.
 * Default (cut 0): the original layout, solid holes and inner walls at `clear`. The builder passes PLAZA.cut. */
export function plazaLayout(cut = 0): PlazaLayout {
  const B = hall(BMS_SPEC, cut), A = hall(BMA_SPEC, cut);
  // BMS: prev edge = south face, next = north face; BMA: prev = north face, next = south face.
  const ring: [P2, boolean][] = [
    [B.pts.nIn, true], [B.pts.nOut, true], [A.pts.pOut, true], [A.pts.pIn, true], [A.pts.pFace, false], // BMA inner wall
    [A.pts.nFace, true], [A.pts.nIn, true], [A.pts.nOut, true], ...SOUTH.map(p => [p, true] as [P2, boolean]),
    [B.pts.pIn, true], [B.pts.pFace, false], // BMS inner wall
    [B.pts.nFace, true],
  ];
  let outline = ring.map(r => r[0]), seam = ring.map(r => r[1]);
  if (signedArea2(outline) < 0) { // keep edge flags attached to their edges when reversing
    outline = outline.slice().reverse(); seam = seam.slice().reverse(); seam = [...seam.slice(1), seam[0]];
  }
  const holes: PlazaHole[] = [...B.solids, ...A.solids];
  for (const p of PETALS) holes.push({ name: 'petal stem', kind: 'solid', poly: circle([p.x, p.z], PETAL_STEM.r0 + PLAZA.clear + cut) });
  // Central oval lawn: the loop inset by the footway half width, and kept 2.5 m off the BMS arcade line.
  let oval = ccw(offsetConvex(ccw(OVAL_LOOP), -1.1));
  const bk = B.K, a0 = fp2(bk, 0, PLAZA.arcadeBand), a1 = fp2(bk, bk.len, PLAZA.arcadeBand);
  oval = half(oval, a0, a1, signedArea2([a0, a1, fp2(bk, bk.len / 2, PLAZA.arcadeBand + 5)]) > 0);
  holes.push({ name: 'oval lawn', kind: 'seam', poly: oval });
  holes.push({ name: 'petal planting bed', kind: 'seam', poly: ccw(PETAL_BED) });
  for (const [x, z, r] of PLAZA_TREES) holes.push({ name: 'tree island', kind: 'seam', poly: circle([x, z], Math.max(1.9, r)) });
  {
    const [a, b] = STEPS, L = Math.hypot(b[0] - a[0], b[1] - a[1]), u: P2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n: P2 = [-u[1], u[0]], w = 1.6, e = 0.3;
    const P = (s: number, t: number): P2 => [a[0] + u[0] * s + n[0] * t, a[1] + u[1] * s + n[1] * t];
    holes.push({ name: 'mapped steps', kind: 'seam', poly: ccw([P(-e, -w), P(L + e, -w), P(L + e, w), P(-e, w)]) });
  }
  return { outline, seam, holes };
}

/** Subtract a convex CCW polygon from a convex piece: convex pieces outside it. */
function subtract(piece: P2[], hole: P2[]): P2[][] {
  const out: P2[][] = []; let rest = piece;
  for (let i = 0; i < hole.length && rest.length >= 3; i++) {
    const a = hole[i], b = hole[(i + 1) % hole.length], o = half(rest, a, b, false);
    if (o.length >= 3 && area(o) > 1e-7) out.push(o);
    rest = half(rest, a, b, true);
  }
  return out;
}

export function buildPlazaPaving(ctx: BlockInstallContext, kit: B05Kit) {
  const began = performance.now();
  const L = plazaLayout(PLAZA.cut), g = ctx.groundHeight, { lift, dip, taper, grid } = PLAZA;
  const outline = L.outline, n = outline.length;
  // Seam edges (outline seams + seam-hole rings), hashed on a 2 m grid for the ramp distance.
  const seams: [P2, P2][] = [];
  for (let i = 0; i < n; i++) if (L.seam[i]) seams.push([outline[i], outline[(i + 1) % n]]);
  for (const h of L.holes) if (h.kind === 'seam') for (let i = 0; i < h.poly.length; i++) seams.push([h.poly[i], h.poly[(i + 1) % h.poly.length]]);
  const HC = 2, hash = new Map<string, number[]>();
  seams.forEach(([a, b], idx) => {
    for (let i = Math.floor((Math.min(a[0], b[0]) - taper) / HC); i <= Math.floor((Math.max(a[0], b[0]) + taper) / HC); i++)
      for (let j = Math.floor((Math.min(a[1], b[1]) - taper) / HC); j <= Math.floor((Math.max(a[1], b[1]) + taper) / HC); j++) {
        const key = `${i},${j}`; let l = hash.get(key); if (!l) hash.set(key, l = []); l.push(idx);
      }
  });
  const seamDist = (x: number, z: number) => {
    let d = Infinity;
    for (const idx of hash.get(`${Math.floor(x / HC)},${Math.floor(z / HC)}`) ?? []) d = Math.min(d, segDist(x, z, seams[idx][0], seams[idx][1]));
    return d;
  };
  const liftAt = (x: number, z: number) => -dip + (lift + dip) * Math.min(1, seamDist(x, z) / taper);
  const Y = (x: number, z: number) => g(x, z) + liftAt(x, z);
  // Outline triangulated into convex pieces; holes as convex CCW rings with boxes.
  const tris = THREE.ShapeUtils.triangulateShape(outline.map(([x, z]) => new THREE.Vector2(x, z)), []).map(t => ccw(t.map(i => outline[i])));
  const triBoxes = tris.map(bbox);
  const holes = L.holes.map(h => ({ ...h, poly: ccw(h.poly), box: bbox(h.poly) }));
  const soup = new Soup(), up = V(0, 1, 0);
  const [X0, X1, Z0, Z1] = bbox(outline);
  const vy = new Map<string, { y: number; n: THREE.Vector3 }>();
  const vertex = (p: P2) => {
    const key = `${p[0].toFixed(5)},${p[1].toFixed(5)}`; let v = vy.get(key);
    if (!v) {
      const e = 0.1, y = Y(p[0], p[1]);
      const nrm = V(-(Y(p[0] + e, p[1]) - Y(p[0] - e, p[1])) / (2 * e), 1, -(Y(p[0], p[1] + e) - Y(p[0], p[1] - e)) / (2 * e)).normalize();
      vy.set(key, v = { y, n: nrm });
    }
    return v;
  };
  let pavedArea = 0, pieces = 0;
  const emit = (poly: P2[]) => {
    pavedArea += area(poly); pieces++;
    const vs = poly.map(p => ({ p, ...vertex(p) }));
    for (let i = 1; i + 1 < vs.length; i++) {
      const a = vs[0], b = vs[i], c = vs[i + 1];
      // Plan-degenerate fan triangles at the emitted Float32 precision (collinear or coincident in x/z) would be vertical
      // slivers: drop them (< 1e-7 m2 in plan).
      const f = Math.fround, ax = f(a.p[0]), az = f(a.p[1]);
      if (Math.abs((f(b.p[0]) - ax) * (f(c.p[1]) - az) - (f(b.p[1]) - az) * (f(c.p[0]) - ax)) < 2e-7) continue;
      const A = V(a.p[0], a.y, a.p[1]), Bv = V(b.p[0], b.y, b.p[1]), Cv = V(c.p[0], c.y, c.p[1]);
      const fn = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(Bv, A), new THREE.Vector3().subVectors(Cv, A));
      if (fn.lengthSq() < 1e-12) continue;
      const order = fn.dot(up) > 0 ? [a, b, c] : [a, c, b];
      soup.triNU(...(order.map(q => V(q.p[0], q.y, q.p[1])) as [THREE.Vector3, THREE.Vector3, THREE.Vector3]),
        ...(order.map(q => q.n) as [THREE.Vector3, THREE.Vector3, THREE.Vector3]), ...(order.map(q => q.p) as [P2, P2, P2]));
    }
  };
  for (let x = Math.floor(X0 / grid) * grid; x < X1; x += grid) for (let z = Math.floor(Z0 / grid) * grid; z < Z1; z += grid) {
    const c: P2[] = [[x, z], [x + grid, z], [x + grid, z + grid], [x, z + grid]], cb = [x, x + grid, z, z + grid];
    for (const t of [[c[0], c[1], c[2]], [c[0], c[2], c[3]]] as P2[][]) {
      const cell = ccw(t);
      tris.forEach((o, oi) => {
        if (!overlap(cb, triBoxes[oi])) return;
        let poly = cell;
        for (let i = 0; i < 3 && poly.length >= 3; i++) poly = half(poly, o[i], o[(i + 1) % 3], true);
        if (poly.length < 3 || area(poly) < 1e-7) return;
        let parts = [poly];
        for (const h of holes) {
          if (!overlap(cb, h.box)) continue;
          parts = parts.flatMap(p => (overlap(bbox(p), h.box) ? subtract(p, h.poly) : [p]));
          if (!parts.length) break;
        }
        for (const p of parts) emit(p);
      });
    }
  }
  const geometry = soup.geometry();
  const mesh = new THREE.Mesh(geometry, kit.material('mallStone'));
  mesh.name = 'b05 Blanton plaza paving';
  mesh.receiveShadow = true; mesh.castShadow = false;
  // Walkable ground draped on the terrain: never enters the context coverage raster (no generated decision changes).
  mesh.userData.block = 'b05-southmall'; mesh.userData.localContext = true; mesh.userData.b05Plaza = true;
  const collider: RAPIER.Collider = trimeshCollider(ctx.physics, soup.p);
  const count = (k: PlazaHole['kind'], name?: string) => L.holes.filter(h => h.kind === k && (!name || h.name.includes(name))).length;
  const islandArea = L.holes.filter(h => h.kind === 'seam' && h.name !== 'mapped steps').reduce((s, h) => s + area(h.poly), 0);
  return {
    mesh, geometry, collider,
    stats: {
      triangles: soup.triangles, vertices: vy.size, pieces, pavedAreaM2: +pavedArea.toFixed(1), outlineAreaM2: +area(outline).toFixed(1),
      islandAreaM2: +islandArea.toFixed(1), holes: { columns: count('solid', 'column'), piers: count('solid', 'pier'), portal: count('solid', 'portal'), stems: count('solid', 'stem'),
        trees: count('seam', 'tree'), lawn: count('seam', 'lawn'), beds: count('seam', 'bed'), steps: count('seam', 'steps') },
      seamEdges: seams.length, lift, dip, taper, grid, colliderHandle: collider.handle, material: 'b05 mallStone (limestone PBR)', buildMs: +(performance.now() - began).toFixed(1),
    },
  };
}
