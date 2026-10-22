// b13-north-perimeter: shared assembly engine for the authored D29-D33 bodies (b13-local; no cross-block import).
// A body is a FROZEN City footprint ring (+ courtyard holes) partitioned by convex plan CELLS; each cell carries a roof
// spec from roof.ts (flat deck, exact planar hip / shed, optional cross gables). Everything emitted is exact:
//  * roof: per cell, the ring clipped to the cell, lower envelope of its planes (roofFacesCut), minus the convex plan
//    footprints of every dormer / chimney / rooftop unit standing on it (so no roof triangle is buried);
//  * steps: vertical faces along internal cell boundaries wherever neighbouring roofs differ (profile breakpoints);
//  * walls: every ring edge split at cell boundaries, a relief Face from the body base to the lowest roof point of the
//    segment, infill above it following the exact roof profile; facade relief per segment (plinth, belt/cornice boxes,
//    pilasters, recessed windows with collided reveals, sills, balconies) from the caller's style function;
//  * flat parapets (single flat-cell bodies): an inset (miter-offset) deck, inner parapet faces and a coping cap;
//  * dormers (gabled, on a hip plane), chimneys / plant / penthouses (boxes on the roof) and exterior chimney breasts.
// All of it is SOLID except flush dormer glass (detail): the block collider is built from exactly these triangles.
import * as THREE from 'three';
import type { Point } from '../../types';
import { Kit, orient, edgesOf, edgesRaw, at, inRing, area, segDist, type Edge, type Face, type Mat, UP, DOWN } from './kit';
import { clipHalf, dedupe, profile, roofY, roofFacesCut, type Plane, type RoofSpec } from './roof';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---- plan frames, cells and roof specs ---------------------------------------------------------------------------
/** Orthonormal plan frame: s along `u`, t along v = (-u.z, u.x). */
export interface Frame { u: [number, number]; v: [number, number] }
export const frame = (dx: number, dz: number): Frame => { const L = Math.hypot(dx, dz), u: [number, number] = [dx / L, dz / L]; return { u, v: [-u[1], u[0]] }; };
export const toXZ = (f: Frame, s: number, t: number): Point => [s * f.u[0] + t * f.v[0], s * f.u[1] + t * f.v[1]];
export const toST = (f: Frame, p: Point): [number, number] => [p[0] * f.u[0] + p[1] * f.u[1], p[0] * f.v[0] + p[1] * f.v[1]];
/** Frame-aligned plan rectangle (oriented, positive area). */
export const fbox = (f: Frame, s0: number, s1: number, t0: number, t1: number): Point[] => orient([toXZ(f, s0, t0), toXZ(f, s1, t0), toXZ(f, s1, t1), toXZ(f, s0, t1)]);
/** Rotated plan rectangle about its centre (axis `ax`, half sizes). */
export const orect = (cx: number, cz: number, ax: [number, number], hl: number, hw: number): Point[] => {
  const [ux, uz] = ax, vx = -uz, vz = ux;
  return orient([[cx - ux * hl - vx * hw, cz - uz * hl - vz * hw], [cx + ux * hl - vx * hw, cz + uz * hl - vz * hw], [cx + ux * hl + vx * hw, cz + uz * hl + vz * hw], [cx - ux * hl + vx * hw, cz - uz * hl + vz * hw]]);
};
export const flat = (y: number): RoofSpec => ({ hips: [{ a: 0, b: 0, c: y }], gables: [] });
/** Shed plane y = y0 + slope * (t - t0) along the frame's t axis (one plane, no cap). */
export const shed = (f: Frame, t0: number, y0: number, slope: number): RoofSpec => ({ hips: [{ a: slope * f.v[0], b: slope * f.v[1], c: y0 - slope * t0 }], gables: [] });
/** Plane y = y0 + slope * (distance inward from the line a->c of an oriented convex plan), i.e. a hip / shed plane. */
export function edgePlane(a: Point, c: Point, y0: number, slope: number): Plane {
  const L = Math.hypot(c[0] - a[0], c[1] - a[1]), nx = -(c[1] - a[1]) / L, nz = (c[0] - a[0]) / L; // inward of a positive ring
  return { a: slope * nx, b: slope * nz, c: y0 - slope * (nx * a[0] + nz * a[1]) };
}
/** Hip spec over convex `rect`: one plane per edge rising inward from `eave` at `slope` (edges whose midpoint lies within
 * 0.05 m of an `open` segment's line are left out, i.e. the roof continues there), capped at `top`. */
export function hip(rect: Point[], eave: number, slope: number, top: number, open: [Point, Point][] = []): RoofSpec {
  const r = orient(rect), hips: Plane[] = [{ a: 0, b: 0, c: top }];
  for (let i = 0; i < r.length; i++) {
    const a = r[i], c = r[(i + 1) % r.length], m: Point = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    if (open.some(([p, q]) => lineDist(m, p, q) < 0.05)) continue;
    hips.push(edgePlane(a, c, eave, slope));
  }
  return { hips, gables: [] };
}
const lineDist = (m: Point, p: Point, q: Point) => { const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz); return Math.abs((m[0] - p[0]) * dz - (m[1] - p[1]) * dx) / L; };
/** Inward half-planes (A x + B z + K >= 0) of a convex polygon. */
const halfPlanes = (poly: Point[]) => { const r = orient(poly); return r.map((a, i) => { const c = r[(i + 1) % r.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]), nx = -(c[1] - a[1]) / L, nz = (c[0] - a[0]) / L; return [nx, nz, -(nx * a[0] + nz * a[1])] as [number, number, number]; }); };
export const inConvexPoly = (poly: Point[], x: number, z: number, tol = 1e-7) => halfPlanes(poly).every(([A, B, K]) => A * x + B * z + K >= -tol);

export interface CellDef { poly: Point[]; spec: number; name: string }
export interface BodyDef {
  key: string; ring: Point[]; holes?: Point[][];
  specs: RoofSpec[]; roofColor: THREE.Color[]; cells: CellDef[];
  /** Flat single-cell bodies only: parapet height above the deck, wall thickness (deck inset) and coping colour. */
  parapet?: { h: number; t: number; coping: THREE.Color };
  /** Wall bottom (absolute Y); default min ground along the ring - 1.0. */
  base?: number;
  /** Per courtyard hole: wall bottom of the court walls (a measured podium deck), default the body base. */
  holeBase?: (number | undefined)[];
  /** Outer rings of the OTHER footprints nearby (their generated / authored context must stay untouched). */
  others?: Point[][];
}
/** Outer rings of every other building within `pad` m of `ring`'s bounding box. */
export function neighbours(data: { buildings: { key?: string; rings: Point[][] }[] }, key: string, ring: Point[], pad = 20): Point[][] {
  const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]), x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, z0 = Math.min(...zs) - pad, z1 = Math.max(...zs) + pad;
  return data.buildings.filter(o => o.key !== key && o.rings[0]?.some(p => p[0] > x0 && p[0] < x1 && p[1] > z0 && p[1] < z1)).map(o => o.rings[0]);
}
/** A roof feature for the harness: a downward ray at (x, z) must hit the body at `top` (<= record LiDAR max + 0.6). */
export interface Feature { key: string; kind: string; x: number; z: number; top: number; lidarMax: number }
export interface Body extends BodyDef {
  outer: Point[]; holesO: Point[][]; grade: number; base: number; sections: Point[][];
  cellAt(x: number, z: number): number; roofAt(x: number, z: number): number; inside(x: number, z: number): boolean;
  cuts: Point[][][]; // per cell, convex plan footprints standing on that cell's roof
  exclusions: { edge: number; hole: number; s0: number; s1: number; keepBands?: boolean }[]; // wall ranges kept free of windows (and bands unless keepBands)
}

/** Ground datum along the ring (every <= 6 m + centre): median = grade, base = min - 1.0 (as b11). */
export function makeBody(def: BodyDef, ground: (x: number, z: number) => number): Body {
  const outer = orient(dedupe(def.ring)), holesO = (def.holes ?? []).map(h => orient(dedupe(h)));
  if (holesO.length && def.cells.length !== 1) throw new Error(`b13 ${def.key}: courtyard holes need a single cell`);
  const samples: number[] = [];
  for (const e of edgesOf(outer)) { const n = Math.max(1, Math.ceil(e.L / 6)); for (let i = 0; i < n; i++) { const p = at(e, e.L * i / n, 0); samples.push(ground(p.x, p.z)); } }
  samples.sort((p, q) => p - q);
  const grade = samples[Math.floor(samples.length / 2)], base = def.base ?? samples[0] - 1.0;
  const sections = def.cells.map(c => { let r = outer; for (const [A, B, K] of halfPlanes(c.poly)) { r = clipHalf(r, A, B, K); if (r.length < 3) break; } return r; });
  const inside = (x: number, z: number) => inRing(x, z, outer) && !holesO.some(h => inRing(x, z, h));
  const cellAt = (x: number, z: number) => { for (let i = 0; i < def.cells.length; i++) if (inConvexPoly(def.cells[i].poly, x, z, 1e-6)) return i; return -1; };
  const roofAt = (x: number, z: number) => { const i = cellAt(x, z); if (i < 0) throw new Error(`b13 ${def.key}: no cell at ${x.toFixed(2)},${z.toFixed(2)}`); return roofY(def.specs[def.cells[i].spec], x, z); };
  // Partition proof: every interior sample of the ring lies in exactly one cell (boundaries excluded by a 1e-3 margin).
  const xs = outer.map(p => p[0]), zs = outer.map(p => p[1]);
  for (let x = Math.min(...xs) + 0.25; x < Math.max(...xs); x += 0.5) for (let z = Math.min(...zs) + 0.25; z < Math.max(...zs); z += 0.5) {
    if (!inside(x, z)) continue;
    const n = def.cells.filter(c => inConvexPoly(c.poly, x, z, -1e-3)).length, any = def.cells.some(c => inConvexPoly(c.poly, x, z, 1e-3));
    if (!any || n > 1) throw new Error(`b13 ${def.key}: cells do not partition the footprint at ${x.toFixed(2)},${z.toFixed(2)} (${n})`);
  }
  return { ...def, outer, holesO, grade, base, sections, cellAt, roofAt, inside, cuts: def.cells.map(() => []), exclusions: [] };
}

// ---- roofs and steps ----------------------------------------------------------------------------------------------
export function emitRoofs(k: Kit, b: Body, mat: Mat = 'matte') {
  let planes = 0, triangles = 0;
  b.cells.forEach((c, i) => {
    if (b.parapet) return; // flat parapet bodies emit their (inset) deck in emitParapet
    const rings = b.holesO.length ? [b.sections[i], ...b.holesO] : [b.sections[i]];
    const r = roofFacesCut(k, rings, b.specs[c.spec], b.roofColor[c.spec], mat, b.cuts[i]);
    planes += r.planes; triangles += r.triangles;
  });
  return { planes, triangles };
}
/** Vertical faces along internal cell boundaries where the two roofs differ (emitted once, from the lower cell index).
 * Each internal section edge is split wherever another cell boundary crosses it, so one edge may face several cells. */
export function emitSteps(k: Kit, b: Body, color: THREE.Color) {
  let faces = 0;
  const cellEdges = b.cells.map(c => edgesOf(c.poly)).flat();
  b.sections.forEach((sec, i) => {
    for (const e of edgesOf(sec)) {
      const ts = [0, 1];
      for (const ce of cellEdges) { const t = segCross(e.a, e.c, ce.a, ce.c); if (t !== null && t > 1e-6 && t < 1 - 1e-6) ts.push(t); }
      ts.sort((p, q) => p - q);
      for (let q0 = 0; q0 + 1 < ts.length; q0++) {
        if (ts[q0 + 1] - ts[q0] < 1e-6) continue;
        const m = at(e, e.L * (ts[q0] + ts[q0 + 1]) / 2, 0), probe: Point = [m.x + e.n.x * 0.05, m.z + e.n.z * 0.05];
        if (!b.inside(probe[0], probe[1])) continue; // on the ring: a wall, not a step
        const j = b.cellAt(probe[0], probe[1]); if (j <= i) continue;
        const si = b.specs[b.cells[i].spec], sj = b.specs[b.cells[j].spec];
        if (si === sj) continue;
        const pa = at(e, e.L * ts[q0], 0), pc = at(e, e.L * ts[q0 + 1], 0);
        const pr = profile([pa.x, pa.z], [pc.x, pc.z], [si, sj]);
        for (let q = 0; q + 1 < pr.t.length; q++) {
          const p0 = pr.pt(pr.t[q]), p1 = pr.pt(pr.t[q + 1]), a0 = pr.y[0][q], a1 = pr.y[0][q + 1], c0 = pr.y[1][q], c1 = pr.y[1][q + 1];
          if (Math.abs(a0 - c0) < 1e-3 && Math.abs(a1 - c1) < 1e-3) continue;
          const iHigher = a0 + a1 >= c0 + c1, hint = iHigher ? e.n.clone() : e.n.clone().negate();
          k.S().quad(V(p0[0], Math.min(a0, c0), p0[1]), V(p1[0], Math.min(a1, c1), p1[1]), V(p1[0], Math.max(a1, c1), p1[1]), V(p0[0], Math.max(a0, c0), p0[1]), color, hint);
          faces++;
        }
      }
    }
  });
  return faces;
}

// ---- walls --------------------------------------------------------------------------------------------------------
export interface Win {
  sill: number; head: number; w: number; bay: number; margin?: number; recess: number; reveal: THREE.Color; pane: THREE.Color; paneMat?: Mat;
  sillBox?: { h: number; d: number; color: THREE.Color }; lintel?: { h: number; d: number; color: THREE.Color };
}
export interface SegStyle {
  wall: THREE.Color;
  plinth?: { top: number; color: THREE.Color };
  /** Attached boxes (belts, cornices): absolute y0/y1, depth d; `ext` extends round convex corners of the ring. */
  bands?: { y0: number; y1: number; d: number; color: THREE.Color; ext?: boolean }[];
  windows?: Win[];
  pilasters?: { w: number; d: number; color: THREE.Color; y0: number; y1: number; bottom?: boolean };
  balconies?: { every: number; floors: number[]; depth: number; w: number; slab: THREE.Color; rail: THREE.Color; door: THREE.Color };
  /** No wall on this segment (open porch side): the caller provides posts instead. */
  open?: boolean;
}
/** party: the wall abuts another footprint (plain wall). near: another footprint lies within 3.0 m (the context coverage
 * raster's 0.8 m tolerance + one 2 m cell + margin): no up-facing relief below grade + 2.1 m and nothing projecting, so the
 * neighbour's generated building is never classified 'route' / 'authored' by this body. */
export interface Seg { e: Edge; s0: number; s1: number; cell: number; top: number; hole: number; edge: number; startConvex: boolean; endConvex: boolean; startConcave: boolean; endConcave: boolean; ground: number; party: boolean; near: boolean; startSharp: boolean; endSharp: boolean }
export interface WallStats { segments: number; windows: number; bands: number; pilasters: number; balconies: number; infill: number; party: number; near: number; tight?: number; close?: number; probes: { o: [number, number, number]; d: [number, number, number]; wall: number; recess: number }[] }

export function emitWalls(k: Kit, b: Body, ground: (x: number, z: number) => number, style: (s: Seg) => SegStyle | null, st: WallStats) {
  const rings: { edges: Edge[]; hole: number }[] = [{ edges: edgesOf(b.outer), hole: -1 }, ...b.holesO.map((h, i) => ({ edges: edgesRaw(h.slice().reverse()), hole: i }))];
  const cellEdges = b.cells.map(c => edgesOf(c.poly));
  const allEdges = rings.flatMap(r => r.edges);
  for (const { edges, hole } of rings) {
    const n = edges.length, convex = (i: number) => { const e = edges[i], f = edges[(i + 1) % n]; return e.u.x * f.u.z - e.u.z * f.u.x > 1e-6; };
    const sharp = (i: number) => { const e = edges[i], f = edges[(i + 1) % n]; return e.u.x * f.u.x + e.u.z * f.u.z < Math.cos(Math.PI / 4); }; // turn >= 45 deg
    edges.forEach((e, ei) => {
      const ts = [0, 1];
      for (const ce of cellEdges.flat()) { const t = segCross(e.a, e.c, ce.a, ce.c); if (t !== null && t > 1e-6 && t < 1 - 1e-6) ts.push(t); }
      ts.sort((p, q) => p - q);
      for (let j = 0; j + 1 < ts.length; j++) {
        if (ts[j + 1] - ts[j] < 1e-6) continue;
        const s0 = ts[j] * e.L, s1 = ts[j + 1] * e.L, sm = (s0 + s1) / 2, mi = at(e, sm, 0, -0.02);
        const cell = b.cellAt(mi.x, mi.z); if (cell < 0) throw new Error(`b13 ${b.key}: wall segment outside every cell`);
        const pa: Point = [at(e, s0, 0).x, at(e, s0, 0).z], pc: Point = [at(e, s1, 0).x, at(e, s1, 0).z];
        const pr = profile(pa, pc, [b.specs[b.cells[cell].spec]]);
        const deckTop = b.parapet ? pr.y[0][0] + b.parapet.h : NaN;
        const top = b.parapet ? deckTop : Math.min(...pr.y[0]);
        let g = Infinity; for (let q = 0; q <= 4; q++) { const p = at(e, s0 + (s1 - s0) * q / 4, 0, 0.6); g = Math.min(g, ground(p.x, p.z)); }
        let party = false, near = false, close = false;
        if (hole < 0) for (let q = 0; q <= Math.max(1, Math.ceil((s1 - s0) / 0.5)); q++) {
          const sp = s0 + Math.min(s1 - s0, q * 0.5), p0 = at(e, sp, 0, 0.3), p1 = at(e, sp, 0, 0);
          for (const o of b.others ?? []) { if (inRing(p0.x, p0.z, o)) party = true; const dd = ringDistPoly([p1.x, p1.z], o); if (dd < 3.0) near = true; if (dd < 1.6) close = true; }
        }
        const seg: Seg = { e, s0, s1, cell, top, hole, edge: ei, startConvex: j === 0 && convex((ei - 1 + n) % n), endConvex: j + 2 === ts.length && convex(ei), startConcave: j === 0 && !convex((ei - 1 + n) % n), endConcave: j + 2 === ts.length && !convex(ei), ground: g, party, near, startSharp: j === 0 && sharp((ei - 1 + n) % n), endSharp: j + 2 === ts.length && sharp(ei) };
        const sy0 = style(seg); st.segments++;
        if (!sy0 || sy0.open) continue;
        // Front clearance to this body's other walls (notches / narrow courts): under 1.3 m no projecting relief at all.
        const mid = at(e, (s0 + s1) / 2, 0, 0.02), tight = allEdges.some(o => o !== e && rayHit([mid.x, mid.z], [e.n.x, e.n.z], o.a, o.c, 1.3));
        const strip = (x: SegStyle): SegStyle => ({ wall: x.wall, plinth: x.plinth, windows: x.windows?.map(w => ({ ...w, sillBox: undefined })) });
        // close (< 1.6 m to another footprint): no projecting relief at all - its elevated cells would count against the
        // neighbour's perimeter in the context coverage rule (perimeterFraction >= 0.4 suppresses a generated building).
        const sy: SegStyle = party ? { wall: sy0.wall, plinth: sy0.plinth } : tight || close ? strip(sy0) : near ? { ...sy0, balconies: undefined } : sy0;
        if (close) st.close = (st.close ?? 0) + 1;
        if (tight) st.tight = (st.tight ?? 0) + 1;
        if (party) st.party++; else if (near) st.near++;
        facade(k, b, seg, sy, ground, st);
        // Infill above the lowest roof point following the exact roof profile (hip ends, gables, jogs).
        if (!b.parapet) for (let q = 0; q + 1 < pr.t.length; q++) {
          const y0 = pr.y[0][q], y1 = pr.y[0][q + 1]; if (y0 - top < 1e-3 && y1 - top < 1e-3) continue;
          k.wall(k.S(), pr.pt(pr.t[q]), pr.pt(pr.t[q + 1]), top, Math.max(top, y0), sy.wall, Math.max(top, y1)); st.infill++;
        }
      }
    });
  }
}
/** Does the ray o + t d (t in (0, maxT]) cross segment p-q? */
function rayHit(o: Point, d: Point, p: Point, q: Point, maxT: number) {
  const sx = q[0] - p[0], sz = q[1] - p[1], den = d[0] * sz - d[1] * sx; if (Math.abs(den) < 1e-12) return false;
  const t = ((p[0] - o[0]) * sz - (p[1] - o[1]) * sx) / den, u = ((p[0] - o[0]) * d[1] - (p[1] - o[1]) * d[0]) / den;
  return t > 1e-3 && t <= maxT && u >= 0 && u <= 1;
}
function segCross(a: Point, c: Point, p: Point, q: Point): number | null {
  const rx = c[0] - a[0], rz = c[1] - a[1], sx = q[0] - p[0], sz = q[1] - p[1], d = rx * sz - rz * sx;
  if (Math.abs(d) < 1e-12) return null;
  const t = ((p[0] - a[0]) * sz - (p[1] - a[1]) * sx) / d, u = ((p[0] - a[0]) * rz - (p[1] - a[1]) * rx) / d;
  return u >= -1e-9 && u <= 1 + 1e-9 ? t : null;
}

function facade(k: Kit, b0: Body, s: Seg, sy: SegStyle, ground: (x: number, z: number) => number, st: WallStats) {
  const { e, s0, s1, top } = s;
  const b = s.hole >= 0 && b0.holeBase?.[s.hole] !== undefined ? { ...b0, base: b0.holeBase[s.hole]! } : b0;
  if (top - b.base < 0.05) return;
  const plinthTop = sy.plinth ? Math.max(b.base, Math.min(sy.plinth.top, top - 0.1)) : b.base;
  const faces: Face[] = [];
  if (sy.plinth && plinthTop > b.base + 0.05) faces.push(k.face(e, b.base, plinthTop, sy.plinth.color, { s0, s1 }));
  const main = k.face(e, plinthTop, top, sy.wall, { s0, s1 }); faces.push(main);
  const excl = b.exclusions.filter(x => x.edge === s.edge && x.hole === s.hole);
  const free = (a: number, c: number) => !excl.some(x => x.s0 < c && x.s1 > a);
  const L = s1 - s0;
  // Band y-ranges are known up front: a sill box is dropped when a band top lies within 1.05 m below it (generic check
  // G3 drops a 1 m ray onto every up-facing face), bands are split around window openings they would cross, and at
  // concave ring corners a band stops one band-depth short (the neighbouring wall's band covers the corner).
  const bandsY = (sy.bands ?? []).map(bd => [Math.max(bd.y0, b.base), Math.min(bd.y1, top)] as [number, number]).filter(([y0, y1]) => y1 - y0 >= 0.02);
  const openings: [number, number, number, number][] = [];
  const balc = sy.balconies;
  const bays = (w: Win) => { const m = w.margin ?? 0.9, usable = L - 2 * m; if (usable < w.w + 0.2) return [] as number[]; const nb = Math.max(1, Math.floor(usable / w.bay)); return Array.from({ length: nb }, (_, i) => s0 + m + (i + 0.5) * usable / nb); };
  for (const w of sy.windows ?? []) {
    const centres = bays(w);
    centres.forEach((sc, bi) => {
      const a = sc - w.w / 2, c = sc + w.w / 2; if (!free(a - 0.2, c + 0.2)) return;
      const out = at(e, sc, 0, 0.8), gl = b !== b0 ? b.base : ground(out.x, out.z); // court walls stand on their podium
      const isBalc = !!balc && bi % balc.every === Math.floor(balc.every / 2) && balc.floors.some(f => Math.abs(f - (w.sill - 0.9)) < 0.6) && L >= 6;
      let sill = w.sill, head = w.head;
      if (isBalc) { const f = balc!.floors.find(f => Math.abs(f - (w.sill - 0.9)) < 0.6)!; sill = f + 0.05; head = f + 2.3; }
      if (sill < gl + (s.near ? 2.1 : 0.25) || head > top - 0.3) return;
      const face = faces.find(f => sill >= f.y0 + 0.05 && head <= f.y1 - 0.05); if (!face) return;
      if (!k.recess(face, a, c, sill, head, w.recess, w.reveal, isBalc ? balc!.door : w.pane, isBalc ? 'matte' : (w.paneMat ?? 'glass'))) return;
      st.windows++; openings.push([a, c, sill, head]);
      if (st.probes.length < 400 && !isBalc) {
        const o = at(e, sc, (sill + head) / 2, 0.6), d = e.n.clone().negate(); // 0.6 m out: clear of any facing wall (tight < 1.3 m strips relief)
        st.probes.push({ o: [o.x, o.y, o.z], d: [d.x, d.y, d.z], wall: 0.6, recess: w.recess });
      }
      if (isBalc) {
        const B = balc!, f = sill - 0.05, bw = Math.min(B.w, L - 0.4), b0 = sc - bw / 2, b1 = sc + bw / 2;
        k.attach(faces, b0, b1, f - 0.22, f, B.depth, B.slab); // slab (its back opens the wall behind it)
        openings.push([b0, b1, f - 0.22, f + 1.1]);
        const R = k.S('metal');
        k.box(R, e, b0, b1, f, f + 1.05, B.depth - 0.06, B.depth, B.rail, true);          // front rail
        k.box(R, e, b0, b0 + 0.06, f, f + 1.05, 0.02, B.depth - 0.06, B.rail, true);       // side rails
        k.box(R, e, b1 - 0.06, b1, f, f + 1.05, 0.02, B.depth - 0.06, B.rail, true);
        st.balconies++;
      } else {
        const sb = w.sillBox;
        if (sb && !(s.near && sill - sb.h < s.ground + 2.1) && !bandsY.some(([, y1]) => sill - sb.h - y1 > -0.01 && sill - sb.h - y1 < 1.05) && !bandsY.some(([y0, y1]) => y0 < sill && y1 > sill - sb.h)) {
          k.attach(faces, a - 0.08, c + 0.08, sill - sb.h, sill, sb.d, sb.color);
          openings.push([a - 0.08, c + 0.08, sill - sb.h, sill]);
        }
        if (w.lintel && head + w.lintel.h < top - 0.2) k.panel(k.D(), e, a - 0.1, c + 0.1, head, head + w.lintel.h, 0.012, w.lintel.color); // flush (detail)
      }
    });
  }
  if (sy.pilasters && L >= 3) {
    const p = sy.pilasters, w0 = (sy.windows ?? [])[0], centres = w0 ? bays(w0) : [];
    const at0 = centres.length > 1 ? centres.slice(0, -1).map((c, i) => (c + centres[i + 1]) / 2) : [];
    // End piers only at convex corners / internal splits (at a concave corner a pier would stand in front of the adjacent wall).
    for (const sp of [...(s.startConcave || !s.startSharp ? [] : [s0 + p.w / 2 + 0.05]), ...at0, ...(s.endConcave || !s.endSharp ? [] : [s1 - p.w / 2 - 0.05])]) {
      if (!free(sp - p.w / 2, sp + p.w / 2) || openings.some(o => o[0] < sp + p.w / 2 && o[1] > sp - p.w / 2)) continue;
      // pilasters stop below bands so no band top has a pilaster above it within 1 m
      const pt = Math.min(p.y1, top, ...bandsY.filter(([y0]) => y0 > p.y0 + 0.5).map(([y0]) => y0));
      // A pilaster stopped by a band has no top face (the band, at least as deep, covers it; an exposed top 0.4 m below
      // the band's top would fail G3's 1 m drop ray).
      k.attach(faces, sp - p.w / 2, sp + p.w / 2, Math.max(p.y0, b.base), pt, p.d, p.color, 'matte', { top: pt >= Math.min(p.y1, top) - 1e-6, bottom: !!p.bottom });
      openings.push([sp - p.w / 2, sp + p.w / 2, Math.max(p.y0, b.base), pt]);
      st.pilasters++;
    }
  }
  for (const bd of L >= 1.0 ? sy.bands ?? [] : []) { // jogs < 1 m carry no band (their neighbours' bands cover the corner)
    const y0 = Math.max(bd.y0, b.base), y1 = Math.min(bd.y1, top); if (y1 - y0 < 0.02) continue;
    // At a concave ring corner the band runs to the corner but its end face is not emitted: it would lie buried inside
    // the neighbouring wall's band (and a trimmed end would stand 1 band-depth in front of the perpendicular wall).
    const a = s0 - (bd.ext && s.startConvex ? bd.d : 0), c = s1 + (bd.ext && s.endConvex ? bd.d : 0);
    if (c - a < 0.1) continue;
    const blocks = [...excl.filter(x => !x.keepBands).map(x => [x.s0, x.s1] as [number, number]), ...openings.filter(o => o[2] < y1 && o[3] > y0).map(o => [o[0] - 0.02, o[1] + 0.02] as [number, number])].sort((p, q) => p[0] - q[0]);
    const put = (x0: number, x1: number) => k.attach(faces, x0, x1, y0, y1, bd.d, bd.color, 'matte', { s0: !(s.startConcave && x0 === a), s1: !(s.endConcave && x1 === c) });
    let cur = a;
    for (const [x0, x1] of blocks) { if (x1 <= cur || x0 >= c) continue; if (x0 - cur > 0.05) put(cur, x0); cur = Math.max(cur, x1); }
    if (c - cur > 0.05) put(cur, c);
    st.bands++;
  }
}

// ---- flat parapet -------------------------------------------------------------------------------------------------
/** Authored clean-up of LiDAR-snapped massing rings: drops spike vertices (interior angle < minDeg with an adjacent edge
 * shorter than maxEdge), which would otherwise give two walls facing each other a few decimetres apart. */
export function despike(r: Point[], minDeg = 35, maxEdge = 4): Point[] {
  const out = r.slice(); let changed = true;
  while (changed && out.length > 4) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const p = out[(i - 1 + out.length) % out.length], q = out[i], s = out[(i + 1) % out.length];
      const ax = p[0] - q[0], az = p[1] - q[1], bx = s[0] - q[0], bz = s[1] - q[1], la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      if (Math.min(la, lb) < maxEdge && (ax * bx + az * bz) / (la * lb) > Math.cos(minDeg * Math.PI / 180)) { out.splice(i, 1); changed = true; break; }
    }
  }
  return out;
}
/** Miter offset of a positively oriented ring by t (inward for t > 0); null when the offset is not a clean simple ring. */
export function offsetRing(r: Point[], t: number): Point[] | null {
  const n = r.length, out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const p = r[(i - 1 + n) % n], q = r[i], s = r[(i + 1) % n];
    const n0 = inward(p, q), n1 = inward(q, s), d = 1 + n0[0] * n1[0] + n0[1] * n1[1];
    if (d < 0.2) return null;
    out.push([q[0] + t * (n0[0] + n1[0]) / d, q[1] + t * (n0[1] + n1[1]) / d]);
  }
  for (let i = 0; i < n; i++) { const a = r[i], c = r[(i + 1) % n], a2 = out[i], c2 = out[(i + 1) % n]; if ((c[0] - a[0]) * (c2[0] - a2[0]) + (c[1] - a[1]) * (c2[1] - a2[1]) <= 0) return null; }
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; if (segHit(out[i], out[(i + 1) % n], out[j], out[(j + 1) % n])) return null; }
  return Math.sign(area(out)) === Math.sign(area(r)) ? out : null;
}
const inward = (a: Point, c: Point): [number, number] => { const L = Math.hypot(c[0] - a[0], c[1] - a[1]); return [-(c[1] - a[1]) / L, (c[0] - a[0]) / L]; };
const segHit = (a: Point, b: Point, c: Point, d: Point) => { const o = (p: Point, q: Point, r: Point) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])); return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; };
/** Deck (inset by the wall thickness, minus plant cut-outs), inner parapet faces and the coping cap. */
export function emitParapet(k: Kit, b: Body, deckMat: Mat = 'matte') {
  const p = b.parapet!, spec = b.specs[b.cells[0].spec], deck = spec.hips[0].c;
  if (b.cells.length !== 1 || spec.hips.length !== 1 || spec.hips[0].a !== 0 || spec.hips[0].b !== 0) throw new Error(`b13 ${b.key}: parapet needs one flat cell`);
  const o = offsetRing(b.outer, p.t), hs = b.holesO.map(h => offsetRing(h, -p.t));
  if (!o || hs.some(h => !h)) throw new Error(`b13 ${b.key}: parapet offset of ${p.t} m is not a simple ring`);
  const r = roofFacesCut(k, [o, ...(hs as Point[][])], spec, b.roofColor[b.cells[0].spec], deckMat, b.cuts[0]);
  for (let i = 0; i < o.length; i++) k.wall(k.S(), o[(i + 1) % o.length], o[i], deck, deck + p.h, p.coping); // faces inward
  for (const h of hs as Point[][]) for (let i = 0; i < h.length; i++) k.wall(k.S(), h[i], h[(i + 1) % h.length], deck, deck + p.h, p.coping); // faces away from the court
  k.cap(k.S(), [b.outer, o], deck + p.h, p.coping);
  b.holesO.forEach((h, i) => k.cap(k.S(), [hs[i] as Point[], h], deck + p.h, p.coping));
  return { deckTriangles: r.triangles, inset: o };
}

// ---- roof-standing boxes, dormers, chimney breasts -----------------------------------------------------------------
/** A box standing on cell `cell`'s roof (chimney, rooftop unit, penthouse, skylight monitor): walls from the exact roof
 * profile up to `top`, a cap, and its plan footprint cut out of that roof. Every corner must be inside the footprint
 * and the cell (else throws). */
export function roofBox(k: Kit, b: Body, quad: Point[], top: number, side: THREE.Color, cap: THREE.Color, mat: Mat = 'matte') {
  const q = orient(quad), cell = b.cellAt((q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2);
  if (cell < 0 || !q.every(p => b.inside(p[0], p[1]) && inConvexPoly(b.cells[cell].poly, p[0], p[1], 1e-6))) throw new Error(`b13 ${b.key}: roof box outside its cell`);
  if (b.parapet) { const o = offsetRing(b.outer, b.parapet.t)!; if (!q.every(p => inRing(p[0], p[1], o) && ringDistPoly(p, o) > 0.15)) throw new Error(`b13 ${b.key}: roof box over the parapet`); }
  if (b.cuts[cell].some(c => convexOverlap(c, q))) return null; // overlaps another roof feature: not emitted
  const spec = b.specs[b.cells[cell].spec];
  let low = Infinity;
  for (const e of edgesOf(q)) {
    const pr = profile(e.a, e.c, [spec]);
    for (let j = 0; j + 1 < pr.t.length; j++) {
      const p0 = pr.pt(pr.t[j]), p1 = pr.pt(pr.t[j + 1]); low = Math.min(low, pr.y[0][j], pr.y[0][j + 1]);
      k.S(mat).quad(V(p0[0], pr.y[0][j], p0[1]), V(p1[0], pr.y[0][j + 1], p1[1]), V(p1[0], top, p1[1]), V(p0[0], top, p0[1]), side, e.n);
    }
  }
  if (top <= low + 0.05) throw new Error(`b13 ${b.key}: roof box top ${top} not above the roof ${low}`);
  k.cap(k.S(mat), [q], top, cap);
  b.cuts[cell].push(q);
  const [cx, cz] = centroid(q);
  return { cell, low, top, x: cx, z: cz };
}
const ringDistPoly = (p: Point, r: Point[]) => { let d = Infinity; for (let i = 0; i < r.length; i++) d = Math.min(d, segDist(p[0], p[1], r[i], r[(i + 1) % r.length])); return d; };

/** Gabled dormer on the hip plane of eave line (a0, along u, outward n) of a cell: plan s along u, r inward from the eave.
 * Front wall at r = rf from the roof up to the dormer eave yE, gable to yR, cheeks down to where the main roof reaches
 * yE, two roof planes dying into the main plane, flush glass on the front. Returns false (nothing emitted) unless the
 * main roof under the whole dormer is exactly that plane (inside one hip face). */
export function dormer(k: Kit, b: Body, o: { a0: Point; u: [number, number]; eave: number; slope: number; s: number; w: number; rf: number; yE: number; yR: number; front: THREE.Color; cheek: THREE.Color; roof: THREE.Color; glass: THREE.Color }) {
  const { a0, u, eave, slope: sl, s: sc, w, rf, yE, yR } = o, s0 = sc - w / 2, s1 = sc + w / 2;
  const n: [number, number] = [u[1], -u[0]]; // outward normal of the eave edge (kit convention for a positive ring)
  const P = (s: number, r: number): Point => [a0[0] + u[0] * s - n[0] * r, a0[1] + u[1] * s - n[1] * r];
  const ym = (r: number) => eave + sl * r, re0 = (yE - eave) / sl, rR = (yR - eave) / sl;
  if (yE < ym(rf) + 0.6 || yR <= yE) return false;
  const plan = [P(s0, rf), P(s1, rf), P(s1, re0), P(sc, rR), P(s0, re0)];
  for (const p of plan) { if (!b.inside(p[0], p[1]) || Math.abs(b.roofAt(p[0], p[1]) - ym(rOf(p))) > 1e-4) return false; }
  function rOf(p: Point) { return -((p[0] - a0[0]) * n[0] + (p[1] - a0[1]) * n[1]); }
  const cell = b.cellAt(P(sc, (rf + rR) / 2)[0], P(sc, (rf + rR) / 2)[1]);
  if (!plan.every(p => b.cellAt(p[0], p[1]) === cell)) return false;
  const pieces = [orient([P(s0, rf), P(sc, rf), P(sc, rR), P(s0, re0)]), orient([P(sc, rf), P(s1, rf), P(s1, re0), P(sc, rR)])];
  if (pieces.some(pc => b.cuts[cell].some(c => convexOverlap(c, pc)))) return false; // a chimney / dormer already stands there
  const X = (s: number, r: number, y: number) => { const p = P(s, r); return V(p[0], y, p[1]); };
  const nn = V(n[0], 0, n[1]), uu = V(u[0], 0, u[1]), S = k.S();
  S.quad(X(s0, rf, ym(rf)), X(s1, rf, ym(rf)), X(s1, rf, yE), X(s0, rf, yE), o.front, nn);
  S.tri(X(s0, rf, yE), X(s1, rf, yE), X(sc, rf, yR), o.front, nn);
  S.tri(X(s0, rf, ym(rf)), X(s0, rf, yE), X(s0, re0, yE), o.cheek, uu.clone().negate());
  S.tri(X(s1, rf, ym(rf)), X(s1, re0, yE), X(s1, rf, yE), o.cheek, uu);
  S.quad(X(s0, rf, yE), X(sc, rf, yR), X(sc, rR, yR), X(s0, re0, yE), o.roof, UP);
  S.quad(X(sc, rf, yR), X(s1, rf, yE), X(s1, re0, yE), X(sc, rR, yR), o.roof, UP);
  const gw = w * 0.28, g0 = ym(rf) + 0.3, g1 = yE - 0.12;
  if (g1 - g0 > 0.4) k.D('glass').quad(X(sc - gw, rf - 0.02, g0), X(sc + gw, rf - 0.02, g0), X(sc + gw, rf - 0.02, g1), X(sc - gw, rf - 0.02, g1), o.glass, nn);
  b.cuts[cell].push(...pieces);
  const probe = P(sc + w * 0.02, rf + Math.min(0.4, (rR - rf) / 2));
  return { x: probe[0], z: probe[1], top: yR - (yR - yE) * 0.04 };
}

/** Exterior chimney breast standing on the ground against wall edge `edge` of the outer ring (plan s range, depth out
 * from the wall plane after a 0.02 m gap), base..top; its wall range is excluded from bands / windows. */
export function wallChimney(k: Kit, b: Body, edge: number, s0: number, s1: number, depth: number, top: number, color: THREE.Color) {
  const e = edgesOf(b.outer).find(x => x.i === edge); if (!e) throw new Error(`b13 ${b.key}: no edge ${edge}`);
  k.box(k.S(), e, s0, s1, b.base, top, 0.02, 0.02 + depth, color, true);
  b.exclusions.push({ edge: edgesOf(b.outer).indexOf(e), hole: -1, s0: s0 - 0.05, s1: s1 + 0.05 });
  return e;
}
/** Separating-axis overlap test of two convex plan polygons (touching counts as no overlap). */
export function convexOverlap(a: Point[], b: Point[]) {
  for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], nx = -(q[1] - p[1]), nz = q[0] - p[0];
    const pa = a.map(v => v[0] * nx + v[1] * nz), pb = b.map(v => v[0] * nx + v[1] * nz);
    if (Math.max(...pa) <= Math.min(...pb) + 1e-6 || Math.max(...pb) <= Math.min(...pa) + 1e-6) return false;
  }
  return true;
}
export const centroid = (q: Point[]): [number, number] => [q.reduce((s, p) => s + p[0], 0) / q.length, q.reduce((s, p) => s + p[1], 0) / q.length];
export { DOWN };
