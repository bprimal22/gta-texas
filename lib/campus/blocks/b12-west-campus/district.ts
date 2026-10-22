// b12 Group 2 (district wave D25-D28, research/whole-campus-92/district-agents-40): five records rebuilt on their FROZEN
// City rings and context.json massing (massing.ts volumesOf: same rings, same measured / published heights), with the
// articulation the actual orbit frames show, built into a separate kit whose triangles are PBR-textured (pbr.ts).
//  * 571123:534 2529 Rio Grande townhouse rows (D25 correction; d25 SE / NE / NW / SW frames + 2017 class-6 raster): the
//    unchanged City ring partitioned into the measured rows / street strips / end rows / pavilions and the open raised
//    court decks (d25-rows.json), each roofed with exact planes fitted to the raster; window surrounds (detail).
//  * 549218:389 Delta Gamma (D25; d25 SE / SW frames): frozen flat tiers; the 8.8 m tier gets the dark sloped mansard band
//    (2.0 m, inward 0.9 m) seen under its roof edge.
//  * 528395:313 Twenty Two 15 (D26; d26 NW frame): frozen flat tiers; pink-red brick base on the street (west) faces,
//    a projecting red-brick bay on the north wing's west face, white stucco walls with framed punched windows, copings.
//  * 652834:858 red-brick block (D27; d27 SE frame, south face): frozen low hip (top 29.7 m, slope 0.251) as an exact
//    hip behind a 1.3 m brick parapet with stone coping; punched windows in an irregular stagger, each with a solid stone
//    frame (jambs, head, sill) and teal glass.
//  * 592244:630 Moody Bank Tower (D28; d28 SW / NW frames): frozen tiers; all articulation INSIDE the mass: continuous
//    piers with 0.5 m recessed window slots, top band, and on the west face a three-arch arcade (round arches through a
//    1 m screen) in front of a 3 m loggia.
// Dimensions not measurable from the frames (storey heights, bay widths, dormer / stack sizes, arch sizes) are ESTIMATES
// from pixel proportions; colours are rendered averages read from the frames (not textures).
import * as THREE from 'three';
import type { CampusData, Point } from '../../types';
import { Kit, edgesOf, at, inRing, ringDist, segDist, orient, area, type Edge } from './kit';
import { volumesOf, buildVolumes, ringGroundMin } from './massing';
import { hipPlanes, roofFaces, profile, type Plane, type RoofSpec } from './roof';
import d25Rows from './d25-rows.json' with { type: 'json' };
import { col } from './pbr';

type G = (x: number, z: number) => number;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UPV = V(0, 1, 0), DOWNV = V(0, -1, 0);
export const DISTRICT_KEYS = { townhouses: '571123:534', deltaGamma: '549218:389', twentyTwo15: '528395:313', redBrick: '652834:858', moody: '592244:630' } as const;
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const edgeOf = (a: Point, c: Point): Edge => { const L = Math.hypot(c[0] - a[0], c[1] - a[1]); return { a, c, L, u: V((c[0] - a[0]) / L, 0, (c[1] - a[1]) / L), n: V((c[1] - a[1]) / L, 0, -(c[0] - a[0]) / L), i: 0 }; };
/** Flush detail window: glass panel and optional surround (lighter frame panel just behind it). */
function win(k: Kit, e: Edge, sc: number, w: number, y0: number, y1: number, d: number, glass: THREE.Color, frame?: THREE.Color) {
  if (frame) k.panel(k.D(), e, sc - w / 2 - 0.12, sc + w / 2 + 0.12, y0 - 0.12, y1 + 0.12, d - 0.015, frame); // 15 mm layers (no z-fight)
  k.panel(k.D('glass'), e, sc - w / 2, sc + w / 2, y0, y1, d, glass);
}
/** Mitered inward offset; null when an offset edge collapses or flips (noisy rings). */
function insetRing(r0: Point[], dist: number): { outer: Point[]; inner: Point[] } | null {
  const r = r0.filter((p, i) => Math.hypot(p[0] - r0[(i + 1) % r0.length][0], p[1] - r0[(i + 1) % r0.length][1]) >= 0.05);
  const es = edgesOf(r); if (es.length !== r.length) return null;
  const out = es.map((e, i) => {
    const p = es[(i - 1 + es.length) % es.length], nx = -(e.n.x + p.n.x), nz = -(e.n.z + p.n.z), l = Math.hypot(nx, nz);
    const cos = (-e.n.x * nx - e.n.z * nz) / l; return [e.a[0] + nx / l * dist / Math.max(cos, 0.3), e.a[1] + nz / l * dist / Math.max(cos, 0.3)] as Point;
  });
  for (let i = 0; i < out.length; i++) { const a = out[i], c = out[(i + 1) % out.length], e = es[i]; if ((c[0] - a[0]) * e.u.x + (c[1] - a[1]) * e.u.z < 0.2 * e.L) return null; }
  return area(out) > 0 ? { outer: r, inner: out } : null;
}
/** Planar polygon (s, y) on the plane of edge e at offset d, triangulated, facing `hint`. */
function planar(k: Kit, e: Edge, poly: [number, number][], d: number, color: THREE.Color, hint: THREE.Vector3) {
  const v2 = poly.map(([s, y]) => new THREE.Vector2(s, y));
  for (const [i, j, l] of THREE.ShapeUtils.triangulateShape(v2, [])) k.S().tri(at(e, poly[i][0], poly[i][1], d), at(e, poly[j][0], poly[j][1], d), at(e, poly[l][0], poly[l][1], d), color, hint);
}

// ------------------------------------------------------------------ 571123:534 townhouse rows (D25)
// D25 correction (root IAB rejected the single hip cap over the whole union): the City ring (138 points, no holes,
// unchanged) is partitioned into the measured cells of d25-rows.json (.work/d25/derive.py: rows, street strips, end rows,
// pavilions, the raised podium court decks, pool surround, neck link), each roofed with its own exact planes fitted to the
// 2017 class-6 raster (gables along the rows, street cross-gables, sheds, flat strips, decks). Courts stay OPEN to the sky
// at the measured deck levels (3.3-3.7 m above the DTM); every step between neighbouring cells is a vertical wall from the
// lower roof to the higher one, so roofs + walls are watertight and render = collision.
type D25Plane = Plane;
export interface D25Cell { id: string; kind: 'gableV' | 'gableU' | 'shedU' | 'flat' | 'deck'; planes: D25Plane[]; pieces: Point[][]; crosses: { from: string; rect: Point[]; planes: D25Plane[] }[]; fit: Record<string, unknown>; evidence: string }
export const D25 = d25Rows as unknown as { theta: number; ring: { points: number; sumX: number; sumZ: number; area: number }; cells: D25Cell[]; unmeasured: string[] };
/** Roof spec of a D25 cell: lower envelope of its planes, raised by its street cross-gables (roof.ts Gable = max). */
export const d25Spec = (c: D25Cell): RoofSpec => ({ hips: c.planes, gables: c.crosses.map(x => ({ rect: x.rect, planes: x.planes })) });
const isCourt = (c: D25Cell) => c.kind === 'deck' || c.id === 'm-pool' || c.id === 'neck';
const d25Roof = (c: D25Cell) => (c.kind === 'deck' || c.id === 'm-pool' ? col('coping') : c.kind === 'flat' ? col('flatRoof') : col('townRoof'));
/** Vertical wall strip on segment a->c (outward normal n) between per-end bottoms / tops (no degenerate triangles). */
function strip(k: Kit, a: Point, c: Point, ya0: number, ya1: number, yc0: number, yc1: number, color: THREE.Color, n: THREE.Vector3) {
  const A0 = V(a[0], ya0, a[1]), A1 = V(a[0], ya1, a[1]), C0 = V(c[0], yc0, c[1]), C1 = V(c[0], yc1, c[1]), b = k.S();
  const big = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3) => new THREE.Vector3().crossVectors(q.clone().sub(p), r.clone().sub(p)).length() > 2e-6;
  if (big(A0, C0, C1)) b.tri(A0, C0, C1, color, n);
  if (big(A0, C1, A1)) b.tri(A0, C1, A1, color, n);
}
function townhouses(k: Kit, data: CampusData, g: G, st: Record<string, unknown>) {
  const rec = data.buildings.find(b => b.key === DISTRICT_KEYS.townhouses); if (!rec) throw new Error('b12: 571123:534 missing');
  let raw = rec.rings[0] as Point[]; if (Math.hypot(raw[0][0] - raw[raw.length - 1][0], raw[0][1] - raw[raw.length - 1][1]) < 1e-9) raw = raw.slice(0, -1);
  const sx = raw.reduce((s, p) => s + p[0], 0), sz = raw.reduce((s, p) => s + p[1], 0);
  if (raw.length !== D25.ring.points || Math.abs(sx - D25.ring.sumX) > 1e-6 || Math.abs(sz - D25.ring.sumZ) > 1e-6) throw new Error('b12: 571123:534 ring differs from the ring d25-rows.json was derived on');
  const ring = orient(raw), base = ringGroundMin(ring, g) - 1.0;
  const pieces = D25.cells.flatMap(c => c.pieces.map(p => ({ cell: c, poly: orient(p), spec: d25Spec(c) })));
  const cellAt = (x: number, z: number, not: unknown) => pieces.find(p => p !== not && inRing(x, z, p.poly));
  const verts = pieces.flatMap(p => p.poly);
  let planes = 0, roofTris = 0, outer = 0, steps = 0, windows = 0, courtWindows = 0;
  for (const p of pieces) { const r = roofFaces(k, p.poly, p.spec, d25Roof(p.cell), 'matte'); planes += r.planes; roofTris += r.triangles; }
  const wallC = col('townWall');
  for (const p of pieces) for (let i = 0; i < p.poly.length; i++) {
    const a = p.poly[i], c = p.poly[(i + 1) % p.poly.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 1e-4) continue;
    const n = V((c[1] - a[1]) / L, 0, -(c[0] - a[0]) / L);
    // split at every other piece's vertex on this edge (T-junctions), so each sub-segment has one neighbour
    const ts = [0, 1, ...verts.map(v => ((v[0] - a[0]) * (c[0] - a[0]) + (v[1] - a[1]) * (c[1] - a[1])) / (L * L)).filter((t, j) => t > 1e-9 && t < 1 - 1e-9 && segDist(verts[j][0], verts[j][1], a, c) < 1e-6)].sort((x, y) => x - y);
    for (let q = 0; q + 1 < ts.length; q++) {
      if ((ts[q + 1] - ts[q]) * L < 1e-4) continue;
      const pa: Point = [a[0] + (c[0] - a[0]) * ts[q], a[1] + (c[1] - a[1]) * ts[q]], pc: Point = [a[0] + (c[0] - a[0]) * ts[q + 1], a[1] + (c[1] - a[1]) * ts[q + 1]];
      const mx = (pa[0] + pc[0]) / 2, mz = (pa[1] + pc[1]) / 2;
      const onRing = ringDist(mx, mz, ring) < 1e-6 && ringDist(pa[0], pa[1], ring) < 1e-6 && ringDist(pc[0], pc[1], ring) < 1e-6;
      const nb = onRing ? undefined : cellAt(mx + n.x * 0.02, mz + n.z * 0.02, p);
      const pr = profile(pa, pc, nb ? [p.spec, nb.spec] : [p.spec]);
      for (let m = 0; m + 1 < pr.t.length; m++) {
        const A = pr.pt(pr.t[m]), C = pr.pt(pr.t[m + 1]), ta = pr.y[0][m], tc = pr.y[0][m + 1];
        if (!nb) { strip(k, A, C, base, ta, base, tc, wallC, n); outer++; continue; }
        const ba = pr.y[1][m], bc = pr.y[1][m + 1];
        if (ta - ba > 1e-4 || tc - bc > 1e-4) { strip(k, A, C, Math.min(ba, ta), ta, Math.min(bc, tc), tc, wallC, n); steps++; }
      }
      // facade detail (no physics): street faces of the rows / strips, court faces above the deck
      const segL = Math.hypot(pc[0] - pa[0], pc[1] - pa[1]); if (segL < 3 || isCourt(p.cell)) continue;
      const lo = Math.min(...pr.y[0]), e = edgeOf(pa, pc), bays = Math.floor(segL / 3.0);
      if (!nb) {
        const gy = g(mx - n.x * 0.8, mz - n.z * 0.8);
        for (const y0 of [gy + 1.0, gy + 4.2, gy + 7.4]) if (y0 + 1.6 < lo - 0.4) for (let j = 0; j < bays; j++) { win(k, e, (j + 0.5) * segL / bays, 1.1, y0, y0 + 1.6, 0.03, col('glass'), col('frameLight')); windows++; }
      } else if (isCourt(nb.cell)) {
        const dy = Math.max(...pr.y[1]);
        for (const y0 of [dy + 1.0, dy + 4.2]) if (y0 + 1.6 < lo - 0.4 && y0 > Math.max(...pr.y[1]) + 0.5) for (let j = 0; j < bays; j++) { win(k, e, (j + 0.5) * segL / bays, 1.1, y0, y0 + 1.6, 0.03, col('glass'), col('frameLight')); courtWindows++; }
      }
    }
  }
  st.townhouses = { key: DISTRICT_KEYS.townhouses, cells: D25.cells.length, pieces: pieces.length, roofPlanes: planes, roofTriangles: roofTris, outerWallStrips: outer, stepWallStrips: steps, windows, courtWindows,
    crosses: D25.cells.reduce((s, c) => s + c.crosses.length, 0), courts: D25.cells.filter(isCourt).map(c => c.id) };
  return DISTRICT_KEYS.townhouses;
}

// ------------------------------------------------------------------ 549218:389 Delta Gamma (D25)
export const MANSARD = { height: 2.0, inward: 0.9 };
function deltaGamma(k: Kit, data: CampusData, g: G, st: Record<string, unknown>) {
  const vols = volumesOf(DISTRICT_KEYS.deltaGamma, data);
  const mt = vols.filter(v => v.role === 'tier').reduce((a, b) => (b.top < a.top ? b : a)); // the 8.8 m tier (lower of the two)
  const y0 = mt.top - MANSARD.height, sl = MANSARD.height / MANSARD.inward;
  // walls of the mansard tier stop at the mansard base; its top is the exact envelope min(top, base + steep plane per edge
  // within a strip along that edge) — a mansard with exact planar faces on the noisy LiDAR tier ring (no inset needed)
  const faceOf = buildVolumes(k, vols, g, () => col('dgWall'), col('flatRoof'), { topOf: v => (v === mt ? y0 : v.top), noCap: v => v === mt });
  const cap = { a: 0, b: 0, c: mt.top };
  const dips = edgesOf(mt.ring).filter(e => e.L >= 0.3).map(e => {
    const P = (s: number, d: number): Point => { const p = at(e, s, 0, d); return [p.x, p.z]; };
    return { rect: [P(0, 0.05), P(e.L, 0.05), P(e.L, -MANSARD.inward - 0.05), P(0, -MANSARD.inward - 0.05)], planes: [{ a: -sl * e.n.x, b: -sl * e.n.z, c: y0 + sl * (e.n.x * e.a[0] + e.n.z * e.a[1]) }] };
  });
  const spec: RoofSpec = { hips: [cap], gables: [], dips };
  const roof = roofFaces(k, mt.ring, spec, col('flatRoof'), 'matte', p => (p === cap ? col('flatRoof') : col('dgMansard')));
  // where the exact envelope stands above the mansard base on the wall line (very short edges without a strip), close it
  let fills = 0;
  for (const e of edgesOf(mt.ring)) {
    if (!faceOf(mt, e)) continue;
    const pr = profile(e.a, e.c, [spec]);
    for (let q = 0; q + 1 < pr.t.length; q++) { const ya = pr.y[0][q], yb = pr.y[0][q + 1]; if (ya - y0 > 1e-3 || yb - y0 > 1e-3) { k.wall(k.S(), pr.pt(pr.t[q]), pr.pt(pr.t[q + 1]), y0, Math.max(y0, ya), col('dgMansard'), Math.max(y0, yb)); fills++; } }
  }
  let windows = 0;
  for (const v of vols) for (const e of edgesOf(v.ring)) {
    const fs = faceOf(v, e); if (!fs || e.L < 2.5) continue;
    const bays = Math.floor(e.L / 2.8), y1 = v === mt ? y0 : v.top;
    for (let y = Math.max(v.bottom, ringGroundMin(v.ring, g)) + 0.9; y + 1.6 < y1 - 0.4; y += 3.2) for (let j = 0; j < bays; j++) { win(k, e, (j + 0.5) * e.L / bays, 1.0, y, y + 1.6, 0.03, col('glass'), col('frameLight')); windows++; }
  }
  st.deltaGamma = { key: DISTRICT_KEYS.deltaGamma, mansard: { tierTop: +mt.top.toFixed(2), base: +y0.toFixed(2), height: MANSARD.height, inward: MANSARD.inward, strips: dips.length, roofPlanes: roof.planes, wallLineFills: fills }, windows };
  return DISTRICT_KEYS.deltaGamma;
}

// ------------------------------------------------------------------ 528395:313 Twenty Two 15 (D26)
export const TF = { brickBase: 7.0, bay: { width: 5.6, endGap: 1.0, depth: 0.35 }, coping: 0.5 };
function twentyTwo15(k: Kit, data: CampusData, g: G, st: Record<string, unknown>) {
  const vols = volumesOf(DISTRICT_KEYS.twentyTwo15, data), main = vols[0];
  const faceOf = buildVolumes(k, vols, g, () => col('tfWall'), col('flatRoof'));
  const gy = ringGroundMin(main.ring, g) + 1.0;
  const westEdges = edgesOf(main.ring).filter(e => e.n.x < -0.9 && e.L > 20);
  const north = westEdges.reduce((b, e) => ((e.a[1] + e.c[1]) > (b.a[1] + b.c[1]) ? e : b)); // highest z mid (north wing)
  let windows = 0, bricks = 0;
  const westIdx = new Set(westEdges.map(e => e.i));
  for (const v of vols) for (const e of edgesOf(v.ring)) {
    const fs = faceOf(v, e); if (!fs) continue;
    k.attach(fs, 0, e.L, v.top - TF.coping, v.top, 0.1, col('coping'));
    const isWest = v === main && westIdx.has(e.i), isBay = v === main && e.i === north.i;
    let bay: [number, number] | null = null;
    if (isWest) { k.attach(fs, 0, e.L, ringGroundMin(v.ring, g) - 1, gy + TF.brickBase, 0.12, col('tfBrickBase')); bricks++; }
    if (isBay) { bay = [e.L - TF.bay.endGap - TF.bay.width, e.L - TF.bay.endGap]; k.attach(fs, bay[0], bay[1], gy + TF.brickBase, v.top - TF.coping, TF.bay.depth, col('tfBrickBay'), 'matte', { top: false }); }
    if (e.L < 2.5) continue;
    const bays = Math.floor(e.L / 2.8);
    for (let y = Math.max(v.bottom, gy - 1) + 1.2; y + 1.7 < v.top - TF.coping - 0.3; y += 3.1) for (let j = 0; j < bays; j++) {
      const sc = (j + 0.5) * e.L / bays, onBay = bay && sc > bay[0] - 0.8 && sc < bay[1] + 0.8 && y > gy + TF.brickBase;
      const d = onBay ? TF.bay.depth + 0.03 : isWest && y < gy + TF.brickBase ? 0.15 : 0.03;
      if (onBay && (sc < bay![0] + 0.9 || sc > bay![1] - 0.9)) continue;
      win(k, e, sc, 1.2, y, y + 1.7, d, col('glass'), onBay ? undefined : col('frameLight')); windows++;
    }
  }
  st.twentyTwo15 = { key: DISTRICT_KEYS.twentyTwo15, westEdges: westEdges.length, brickBaseEdges: bricks, bayEdge: north.i, windows };
  return DISTRICT_KEYS.twentyTwo15;
}

// ------------------------------------------------------------------ 652834:858 red-brick block (D27)
export const RB = { hipRiseCap: 4.2, parapet: 1.3, wallT: 0.3, storey: 3.1, bay: 3.3, win: { w: 1.4, h: 1.75 }, frame: { w: 0.14, depth: 0.14 } }; // storey gap between stacked frames 1.07 m
function redBrick(k: Kit, data: CampusData, g: G, st: Record<string, unknown>) {
  const [v] = volumesOf(DISTRICT_KEYS.redBrick, data), ring = v.ring, top = v.top, slope = 0.251; // frozen massing
  const E = top - RB.hipRiseCap, P = E + RB.parapet, base = ringGroundMin(ring, g) - 1.0;
  const hips = hipPlanes(ring, E, slope, top, () => false), spec: RoofSpec = { hips, gables: [] };
  const ins = insetRing(ring, RB.wallT); if (!ins) throw new Error('b12: 652834 parapet inset failed');
  const { outer, inner } = ins;
  const roof = roofFaces(k, inner, spec, col('rbRoof'), 'matte');
  // parapet: inner face from the roof up to the parapet top, coping cap
  for (const ie of edgesOf(inner)) {
    const pr = profile(ie.c, ie.a, [spec]); // reversed: faces inward
    const inward = V(-ie.n.x, 0, -ie.n.z);
    for (let q = 0; q + 1 < pr.t.length; q++) {
      const y0 = Math.min(pr.y[0][q], P), y1 = Math.min(pr.y[0][q + 1], P), a = pr.pt(pr.t[q]), c = pr.pt(pr.t[q + 1]);
      if (P - y0 > 0.01 || P - y1 > 0.01) k.S().quad(V(a[0], y0, a[1]), V(c[0], y1, c[1]), V(c[0], P, c[1]), V(a[0], P, a[1]), col('rbParapet'), inward);
    }
  }
  // coping: exact per-edge trapezoids between the ring edge and its mitered inset edge (no annulus triangulation)
  outer.forEach((a, i) => { const c = outer[(i + 1) % outer.length], ia = inner[i], ic = inner[(i + 1) % inner.length];
    k.S().quad(V(a[0], P, a[1]), V(c[0], P, c[1]), V(ic[0], P, ic[1]), V(ia[0], P, ia[1]), col('rbFrame'), UPV); });
  // facades: brick to the parapet top, solid stone window frames, teal glass
  let windows = 0, frames = 0;
  const F = RB.frame, southRows: number[] = [];
  const southI = edgesOf(ring).filter(e => e.L > 10).reduce((b, e) => (e.n.z > b.n.z ? e : b)).i;
  for (const e of edgesOf(ring)) {
    const face = k.face(e, base, P, col('rbWall'));
    if (e.L < 3.0) continue;
    const gy = g(...((p => [p.x, p.z] as [number, number])(at(e, e.L / 2, 0, 0.8)))), n = Math.floor(e.L / RB.bay);
    if (e.i === southI) for (let f = 0, y = gy + 1.0; f < 4 && y + RB.win.h + 0.4 < E - 0.2; f++, y += RB.storey) southRows.push(+(y + RB.win.h / 2).toFixed(3));
    for (let f = 0, y = gy + 1.0; y + RB.win.h + 0.4 < E - 0.2; f++, y += RB.storey) for (let j = 0; j < n; j++) {
      // irregular stagger (d27 SE frame): every other storey shifts by a third of a bay, some bays left blank
      const sc = (j + 0.5) * e.L / n + (f % 2 ? 1 : -1) * RB.bay / 6;
      if ((j * 7 + f * 3) % 5 === 4) continue;
      const s0 = sc - RB.win.w / 2, s1 = sc + RB.win.w / 2, y0 = y, y1 = y + RB.win.h;
      if (s0 - F.w < 0.4 || s1 + F.w > e.L - 0.4) continue;
      k.attach(face, s0 - F.w, s0, y0 - F.w, y1 + F.w, F.depth, col('rbFrame'));                                   // jambs
      k.attach(face, s1, s1 + F.w, y0 - F.w, y1 + F.w, F.depth, col('rbFrame'));
      k.attach(face, s0, s1, y1, y1 + F.w, F.depth, col('rbFrame'), 'matte', { s0: false, s1: false });             // head
      k.attach(face, s0, s1, y0 - F.w, y0, F.depth, col('rbFrame'), 'matte', { s0: false, s1: false });             // sill
      k.panel(k.D('glass'), e, s0, s1, y0, y1, 0.03, col('tealGlass')); windows++; frames += 4;
    }
  }
  st.redBrick = { key: DISTRICT_KEYS.redBrick, eave: +E.toFixed(2), parapetTop: +P.toFixed(2), ridgeTop: +top.toFixed(2), slope, roofPlanes: roof.planes, windows, frameBoxes: frames, southRows };
  return DISTRICT_KEYS.redBrick;
}

// ------------------------------------------------------------------ 592244:630 Moody Bank Tower (D28)
export const MOODY = { base: 12.0, topBand: 3.6, recess: 0.5, cornerPier: 1.6, bayTarget: 4.3, slotShare: 0.38, storey: 3.9,
  arcade: { pier: 2.87, arch: 8.61, spring: 6.0, screen: 1.0, loggia: 3.0 } };
function moody(k: Kit, data: CampusData, g: G, st: Record<string, unknown>) {
  const vols = volumesOf(DISTRICT_KEYS.moody, data), main = vols[0], tiers = vols.slice(1);
  const ring = main.ring, T = main.top, base = ringGroundMin(ring, g) - 1.0, gg = median(ring.map(p => g(p[0], p[1])));
  const yB = gg + MOODY.base, yT = T - MOODY.topBand, R = MOODY.recess;
  // deck + upper tier (same massing; tier walls from buildVolumes, light band colour)
  k.cap(k.S(), [ring], T, col('flatRoof'));
  buildVolumes(k, tiers, g, () => col('mbBand'), col('flatRoof'));
  const west = edgesOf(ring).reduce((b, e) => (e.n.x < b.n.x ? e : b)), isWest = (e: Edge) => e.i === west.i;
  let piers = 0, slots = 0, arches = 0;
  const Q = (e: Edge, s0: number, s1: number, y0: number, y1: number, d0: number, d1: number, c: THREE.Color, hint: THREE.Vector3) =>
    k.S().quad(at(e, s0, y0, d0), at(e, s1, y0, d1), at(e, s1, y1, d1), at(e, s0, y1, d0), c, hint);
  for (const e of edgesOf(ring)) {
    const mu = e.u.clone().negate(), back = e.n.clone().negate();
    // top band (flush)
    Q(e, 0, e.L, yT, T - 2.2, 0, 0, col('mbBand'), e.n);
    Q(e, 0, e.L, T - 2.2, T, 0, 0, col('mbCrown'), e.n); // black crown sign band (linden-architect-aerial background)
    // pier zone: corner piers flush, slots recessed by R between continuous piers
    const cw = MOODY.cornerPier, n = Math.max(1, Math.round((e.L - 2 * cw) / MOODY.bayTarget)), bw = (e.L - 2 * cw) / n, sw = bw * MOODY.slotShare;
    let s = 0;
    const segs: [number, number, boolean][] = [];
    for (let i = 0; i < n; i++) { const c = cw + (i + 0.5) * bw; segs.push([s, c - sw / 2, false], [c - sw / 2, c + sw / 2, true]); s = c + sw / 2; }
    segs.push([s, e.L, false]);
    for (const [a, b, slot] of segs) {
      if (!slot) { Q(e, a, b, yB, yT, 0, 0, col('mbPier'), e.n); piers++; continue; }
      Q(e, a, b, yB, yT, -R, -R, col('mbSpandrel'), e.n);                                          // slot back
      k.S().quad(at(e, a, yT, -R), at(e, b, yT, -R), at(e, b, yT, 0), at(e, a, yT, 0), col('mbBand'), DOWNV); // soffit
      k.S().quad(at(e, a, yB, -R), at(e, b, yB, -R), at(e, b, yB, 0), at(e, a, yB, 0), col('mbPier'), UPV);   // sill
      k.S().quad(at(e, a, yB, 0), at(e, a, yB, -R), at(e, a, yT, -R), at(e, a, yT, 0), col('mbPier'), e.u);    // pier sides
      k.S().quad(at(e, b, yB, -R), at(e, b, yB, 0), at(e, b, yT, 0), at(e, b, yT, -R), col('mbPier'), mu);
      for (let y = yB + 0.6; y + 2.5 < yT; y += MOODY.storey) k.panel(k.D('glass'), e, a + 0.08, b - 0.08, y, y + 2.5, -R + 0.02, col('glass'));
      slots++;
    }
    // base zone
    if (!isWest(e)) {
      Q(e, 0, e.L, base, yB, 0, 0, col('mbArch'), e.n);
      for (const [a, b, slot] of segs) if (slot) k.panel(k.D('glass'), e, a - 0.3, b + 0.3, gg + 0.3, gg + 4.6, 0.03, col('storefront'));
      continue;
    }
    // west arcade: 1 m screen with three round-arched openings, 3 m loggia behind (all inside the City ring)
    const A = MOODY.arcade, p = (e.L - 3 * A.arch) / 4, r = A.arch / 2, spring = gg + A.spring, ceil = spring + r + 0.3, sa = p / 2, sb = e.L - p / 2, D1 = A.screen, D2 = A.screen + A.loggia;
    const opening = (i: number) => { const s0 = p + i * (A.arch + p); return [s0, s0 + A.arch] as const; };
    const arc = (sc: number) => Array.from({ length: 13 }, (_, j) => { const th = Math.PI - Math.PI * j / 12; return [sc + r * Math.cos(th), spring + r * Math.sin(th)] as [number, number]; });
    const screenPoly = (s0: number, s1: number, yTop: number): [number, number][] => {
      const out: [number, number][] = [[s0, base]];
      for (let i = 0; i < 3; i++) { const [o0, o1] = opening(i); out.push([o0, base], ...arc((o0 + o1) / 2), [o1, base]); }
      out.push([s1, base], [s1, yTop], [s0, yTop]);
      return out;
    };
    planar(k, e, screenPoly(0, e.L, yB), 0, col('mbArch'), e.n);                       // front
    planar(k, e, screenPoly(sa, sb, ceil), -D1, col('mbArch'), back);                  // back (facing the loggia)
    for (let i = 0; i < 3; i++) {
      const [o0, o1] = opening(i), pts = arc((o0 + o1) / 2);
      Q(e, o0, o0, base, spring, 0, -D1, col('mbArch'), e.u); Q(e, o1, o1, base, spring, -D1, 0, col('mbArch'), mu); // jambs
      for (let j = 0; j + 1 < pts.length; j++) { const tm = Math.PI - Math.PI * (j + 0.5) / 12, hint = e.u.clone().multiplyScalar(-Math.cos(tm)).add(V(0, -Math.sin(tm), 0));
        k.S().quad(at(e, pts[j][0], pts[j][1], 0), at(e, pts[j][0], pts[j][1], -D1), at(e, pts[j + 1][0], pts[j + 1][1], -D1), at(e, pts[j + 1][0], pts[j + 1][1], 0), col('mbSoffit'), hint); }
      arches++;
    }
    Q(e, sa, sb, base, ceil, -D2, -D2, col('storefront'), e.n);                              // loggia glazing
    k.S().quad(at(e, sa, ceil, -D2), at(e, sb, ceil, -D2), at(e, sb, ceil, -D1), at(e, sa, ceil, -D1), col('mbSoffit'), DOWNV); // loggia ceiling
    k.S().quad(at(e, sa, base, -D1), at(e, sa, base, -D2), at(e, sa, ceil, -D2), at(e, sa, ceil, -D1), col('mbArch'), e.u);    // loggia ends
    k.S().quad(at(e, sb, base, -D2), at(e, sb, base, -D1), at(e, sb, ceil, -D1), at(e, sb, ceil, -D2), col('mbArch'), mu);
  }
  st.moody = { key: DISTRICT_KEYS.moody, grade: +gg.toFixed(2), baseTop: +yB.toFixed(2), topBand: [+yT.toFixed(2), +T.toFixed(2)], piers, slots, arches, westEdge: west.i,
    arcade: { pier: +((west.L - 3 * MOODY.arcade.arch) / 4).toFixed(2), arch: MOODY.arcade.arch, springY: +(gg + MOODY.arcade.spring).toFixed(2), crownY: +(gg + MOODY.arcade.spring + MOODY.arcade.arch / 2).toFixed(2) } };
  return DISTRICT_KEYS.moody;
}

/** Delta Gamma's mansard tier (as rebuilt) for checks. */
export function mansardTier(data: CampusData) { return volumesOf(DISTRICT_KEYS.deltaGamma, data).filter(v => v.role === 'tier').reduce((a, b) => (b.top < a.top ? b : a)); }

export function buildDistrict(k: Kit, data: CampusData, g: G, st: Record<string, unknown>) {
  return [townhouses(k, data, g, st), deltaGamma(k, data, g, st), twentyTwo15(k, data, g, st), redBrick(k, data, g, st), moody(k, data, g, st)];
}
