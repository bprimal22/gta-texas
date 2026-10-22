// D24 / b11: John W. Hargis Hall (UT JHH; City record 633570:818), 1888-1900 masonry hall on Red River St.
// Evidence (research/whole-campus-92/district-agents-40/packets/D24.json):
//  * plan: the City 2023 ring unchanged (frozen footprint);
//  * roof: the frozen context.json massing — three hip-metal sections (north / middle / south, split at the massing's
//    section lines z 846 / 867), ridge tops 15.86 / 14.56 / 12.79 m campus Y, slope 0.6 — built as EXACT planar hips
//    (roof.ts) over each section; the eave (10.0 m) is an estimate between the massing main-volume top 9.0 and the
//    2017 LiDAR edge returns (~11 m) chosen so each section's roof P50 sits inside the LiDAR band;
//  * central cupola and north end tower: positions and tops MEASURED from local 2017 USGS 3DEP class-6 maxima
//    (cupola cells x 486.5-492.5, z 864-870, max 20.83; tower cells x 498-504, z 826-832, max 19.47), forms
//    reference-interpreted from the d24 orbit frames (NE/NW/SE: square cupola on the ridge, second roof feature at the
//    north end) and the UT directory photograph ut-jhh-568 (square lantern stage with arched openings, cornice, cap);
//  * facades reference-interpreted from the same photograph: cream masonry walls, red-brick corner pilasters and eave
//    frieze/cornice, two tall storeys of segmental-arched windows over a low basement row, blue-grey standing-seam metal
//    roofs (orbit frames). Bay spacing / storey heights are ESTIMATES (no measured elevation).
//  * west centre pediment: cross gable with red tympanum on the west front under the cupola (d24 NW frame; photo).
//  Not modelled (gaps): the east front pavilion, the north-end gables under the tower, porches, chimneys, entrances.
import * as THREE from 'three';
import type { CampusData, Point } from '../../types';
import { Kit, C, orient, edgesOf, at, along, inRing, ringDist, segDist, type Edge, type Face } from './kit';
import { clipHalf, dedupe, hipPlanes, roofFaces, profile, roofY, planeY, inConvex, type Plane, type RoofSpec, type Gable } from './roof';
import context from './context.json' with { type: 'json' };

export const HARGIS_KEY = '633570:818';
/** Estimated eave (campus Y), see header. */
export const HARGIS_EAVE = 10.0;
/** LiDAR-located roof features (campus x, z) and their modelled solid tops (campus Y). */
export const HARGIS_CUPOLA = { centre: [489.5, 867.0] as Point, apex: 20.5, lidarMax: 20.83 };
export const HARGIS_TOWER = { centre: [501.0, 829.0] as Point, apex: 19.4, lidarMax: 19.47 };

const COL = { wall: C('#dcd3bf'), brick: C('#8a5444'), tympanum: C('#9a4b38'), roof: C('#8d9eaa'), glass: C('#2d353b'), stone: C('#ece6d6'), plinth: C('#b9ae95'), opening: C('#24282c') };
/** West centre pediment (d24 NW frame: red-tympanum gable on the west front directly below the cupola; directory photo:
 * pedimented centre pavilion under the cupola). Width / pitch are ESTIMATES. */
export const HARGIS_PEDIMENT = { width: 8.0, slope: 0.65 };
type Vol = { ring?: Point[]; top: number; slope?: number };

export function buildHargis(k: Kit, data: CampusData, ground: (x: number, z: number) => number, stats: Record<string, unknown>) {
  const b = data.buildings.find(x => x.key === HARGIS_KEY);
  if (!b) throw new Error(`b11: ${HARGIS_KEY} (Hargis Hall) missing from the data`);
  const ring = orient(dedupe(b.rings[0]));
  const m = (context as unknown as { massing: Record<string, { volumes: Vol[] }> }).massing[HARGIS_KEY];
  const tiers = m.volumes.filter(v => v.ring).map(v => ({ ...v, zs: v.ring!.map(p => p[1]) })).sort((p, q) => Math.min(...p.zs) - Math.min(...q.zs));
  if (tiers.length !== 3) throw new Error('b11: Hargis massing must have 3 hip sections');
  const cuts = [0, 1].map(i => (Math.max(...tiers[i].zs) + Math.min(...tiers[i + 1].zs)) / 2);
  const E = HARGIS_EAVE, slope = tiers[0].slope ?? 0.6;
  // Open (no eave) hull edges: the section lines themselves and short plan jogs lying within 0.75 m of a section line and
  // near-parallel to it (e.g. the east jog (498.7, 867.08)-(500.46, 867.65)); as eaves those would pull a false valley
  // along the whole section line (found by generic check G3 on the step faces).
  const open = (a: Point, c: Point) => cuts.some(z => Math.abs(a[1] - z) < 0.75 && Math.abs(c[1] - z) < 0.75);
  const sections = [clipHalf(ring, 0, -1, cuts[0]), clipHalf(clipHalf(ring, 0, 1, -cuts[0]), 0, -1, cuts[1]), clipHalf(ring, 0, 1, -cuts[1])];
  const planes: Plane[][] = sections.map((s, i) => hipPlanes(s, E, slope, tiers[i].top, open));
  const sectionAt = (z: number) => (z < cuts[0] ? 0 : z < cuts[1] ? 1 : 2);
  // West centre pediment: a cross gable on the west wall opposite the cupola, as deep as needed to die into the hips.
  const edges0 = edgesOf(ring);
  const westWall = edges0.filter(e => e.n.x < -0.5 && e.L > HARGIS_PEDIMENT.width + 1)
    .reduce((p, q) => (segDist(...HARGIS_CUPOLA.centre, q.a, q.c) < segDist(...HARGIS_CUPOLA.centre, p.a, p.c) ? q : p));
  const sc = Math.min(Math.max(along(westWall, ...HARGIS_CUPOLA.centre), HARGIS_PEDIMENT.width / 2 + 0.5), westWall.L - HARGIS_PEDIMENT.width / 2 - 0.5);
  const s0 = sc - HARGIS_PEDIMENT.width / 2, s1 = sc + HARGIS_PEDIMENT.width / 2, sg = HARGIS_PEDIMENT.slope, u = westWall.u, a0 = westWall.a;
  const g1: Plane = { a: sg * u.x, b: sg * u.z, c: E + sg * (-a0[0] * u.x - a0[1] * u.z - s0) };
  const g2: Plane = { a: -sg * u.x, b: -sg * u.z, c: E + sg * (s1 + a0[0] * u.x + a0[1] * u.z) };
  const rectAt = (depth: number): Point[] => [s0, s1].flatMap((s, i) => (i ? [0, -depth] : [-depth, 0]).map(d => { const p = at(westWall, s, 0, d); return [p.x, p.z] as Point; }));
  let depth = sg * HARGIS_PEDIMENT.width / 2 / slope + 0.5;
  const hipAt = (x: number, z: number) => roofY({ hips: planes[sectionAt(z)], gables: [] }, x, z);
  const dies = (dp: number) => { for (let s = s0; s <= s1 + 1e-9; s += 0.25) { const p = at(westWall, s, 0, -dp); if (Math.min(planeY(g1, p.x, p.z), planeY(g2, p.x, p.z)) > hipAt(p.x, p.z) + 1e-4) return false; } return true; };
  while (!dies(depth) && depth < 14) depth += 0.25;
  if (!dies(depth)) throw new Error('b11: Hargis pediment does not die into the hip roof');
  const pediment: Gable = { rect: rectAt(depth), planes: [g1, g2] };
  const specs: RoofSpec[] = planes.map(hips => ({ hips, gables: [pediment] }));
  const roofAt = (x: number, z: number) => roofY(specs[sectionAt(z)], x, z);

  // Ground datum as the generator (median of baked ground along the ring every <= 6 m + centre; base = low - 1.2).
  const samples: number[] = [];
  for (const e of edgesOf(ring)) { const n = Math.max(1, Math.ceil(e.L / 6)); for (let i = 0; i < n; i++) { const p = at(e, e.L * i / n, 0); samples.push(ground(p.x, p.z)); } }
  samples.push(ground(b.center[0], b.center[1])); samples.sort((p, q) => p - q);
  const grade = samples[Math.floor(samples.length / 2)], base = samples[0] - 1.2, f0 = grade;

  // Roofs (exact planes) and the vertical steps where a higher section meets a lower one at a section line.
  let roofPlanes = 0, roofTris = 0;
  sections.forEach((s, i) => { const r = roofFaces(k, s, specs[i], COL.roof); roofPlanes += r.planes; roofTris += r.triangles; });
  let stepFaces = 0;
  // Emitted after the cupola is placed: parts of a step lying inside the cupola base square are buried in it (generic
  // check G3) and are left out (Cyrus-Beck clip of each linear interval against the convex square).
  const emitSteps = (hidden: Point[]) => cuts.forEach((c, ci) => {
    const north = sections[ci], hes = edgesOf(hidden);
    const insideRange = (p0: Point, p1: Point): [number, number] => {
      let lo = 0, hi = 1;
      for (const e of hes) {
        const f0 = e.n.x * (p0[0] - e.a[0]) + e.n.z * (p0[1] - e.a[1]), f1 = e.n.x * (p1[0] - e.a[0]) + e.n.z * (p1[1] - e.a[1]); // <= 0 inside
        if (f0 > 0 && f1 > 0) return [1, 0];
        if (f0 > 0) lo = Math.max(lo, f0 / (f0 - f1)); else if (f1 > 0) hi = Math.min(hi, f0 / (f0 - f1));
      }
      return [lo, hi];
    };
    for (let i = 0; i < north.length; i++) {
      const a = north[i], q = north[(i + 1) % north.length];
      if (!(Math.abs(a[1] - c) < 1e-6 && Math.abs(q[1] - c) < 1e-6)) continue;
      const pr = profile(a, q, [specs[ci], specs[ci + 1]]);
      for (let j = 0; j + 1 < pr.t.length; j++) {
        const P0 = pr.pt(pr.t[j]), P1 = pr.pt(pr.t[j + 1]), N0 = pr.y[0][j], N1 = pr.y[0][j + 1], S0 = pr.y[1][j], S1 = pr.y[1][j + 1];
        const northHigher = N0 + N1 >= S0 + S1;
        const [uin, uout] = insideRange(P0, P1);
        const parts: [number, number][] = uin < uout ? [[0, uin], [uout, 1]] : [[0, 1]];
        for (const [u0, u1] of parts) {
          if (u1 - u0 < 1e-6) continue;
          const L = (v0: number, v1: number, u: number) => v0 + (v1 - v0) * u, X = (u: number): Point => [L(P0[0], P1[0], u), L(P0[1], P1[1], u)];
          const p0 = X(u0), p1 = X(u1), n0 = L(N0, N1, u0), n1 = L(N0, N1, u1), s0 = L(S0, S1, u0), s1 = L(S0, S1, u1);
          const lo0 = Math.min(n0, s0), lo1 = Math.min(n1, s1), hi0 = Math.max(n0, s0), hi1 = Math.max(n1, s1);
          if (hi0 - lo0 < 1e-3 && hi1 - lo1 < 1e-3) continue;
          k.S().quad(new THREE.Vector3(p0[0], lo0, p0[1]), new THREE.Vector3(p1[0], lo1, p1[1]), new THREE.Vector3(p1[0], hi1, p1[1]), new THREE.Vector3(p0[0], hi0, p0[1]), COL.wall, new THREE.Vector3(0, 0, northHigher ? 1 : -1));
          stepFaces++;
        }
      }
    }
  });

  // Walls: the City ring, base to eave as a relief face (cornice frieze, corner pilasters), gable infill above the eave
  // wherever the exact roof stands above it (recessed plan jogs), windows as flush detail.
  const edges = edges0, n = edges.length;
  const convexEnd = (i: number) => { const e = edges[i], f = edges[(i + 1) % n]; return e.u.x * f.u.z - e.u.z * f.u.x > 1e-6; };
  const corniceY0 = E - 0.55;
  let windows = 0, pilasters = 0, gableQuads = 0;
  edges.forEach((e, i) => {
    const startConvex = convexEnd((i - 1 + n) % n), endConvex = convexEnd(i);
    const face: Face = k.face(e, base, E, COL.wall);
    // Eave frieze / cornice in red brick (photo): extended round convex corners so the corner reads closed.
    k.attach(face, startConvex ? -0.28 : 0, e.L + (endConvex ? 0.28 : 0), corniceY0, E, 0.28, COL.brick);
    if (e.L >= 3) {
      if (startConvex) { k.attach(face, -0.1, 0.6, base, corniceY0, 0.1, COL.brick, 'matte', { top: false, bottom: false }); pilasters++; }
      if (endConvex) { k.attach(face, e.L - 0.6, e.L + 0.1, base, corniceY0, 0.1, COL.brick, 'matte', { top: false, bottom: false }); pilasters++; }
    }
    // Plinth band (detail) and windows.
    k.panel(k.D(), e, 0, e.L, base, f0 + 0.2, 0.012, COL.plinth);
    const usable = e.L - 1.8;
    const bays = usable >= 2.2 ? Math.max(1, Math.round(usable / 3.3)) : 0;
    for (let w = 0; w < bays; w++) {
      const sc = 0.9 + (w + 0.5) * usable / bays, out = at(e, sc, 0, 0.8), gOut = ground(out.x, out.z);
      const head2 = Math.min(f0 + 7.55, corniceY0 - 0.45);
      const rows: [number, number, number, number][] = [[f0 + 0.3, f0 + 1.05, 0.9, 0.08], [f0 + 1.75, f0 + 4.05, 1.15, 0.22], [f0 + 5.35, head2, 1.15, 0.22]];
      for (const [sill, head, wd, rise] of rows) {
        if (sill < gOut + 0.1 || head - sill < 0.6) continue;
        archWindow(k, e, sc, wd, sill, head, rise);
        windows++;
      }
    }
    // Gable infill above the eave along this edge (per section: split at the section lines).
    const zs = cuts.filter(c => (e.a[1] - c) * (e.c[1] - c) < 0).map(c => (c - e.a[1]) / (e.c[1] - e.a[1])).sort((p, q) => p - q);
    const ts = [0, ...zs, 1];
    for (let j = 0; j + 1 < ts.length; j++) {
      const pa: Point = [e.a[0] + (e.c[0] - e.a[0]) * ts[j], e.a[1] + (e.c[1] - e.a[1]) * ts[j]];
      const pc: Point = [e.a[0] + (e.c[0] - e.a[0]) * ts[j + 1], e.a[1] + (e.c[1] - e.a[1]) * ts[j + 1]];
      const sec = sectionAt((pa[1] + pc[1]) / 2), pr = profile(pa, pc, [specs[sec]]);
      for (let q = 0; q + 1 < pr.t.length; q++) {
        const y0 = pr.y[0][q], y1 = pr.y[0][q + 1];
        if (y0 - E < 1e-3 && y1 - E < 1e-3) continue;
        const m = pr.pt((pr.t[q] + pr.t[q + 1]) / 2), tymp = inConvex(pediment.rect, m[0], m[1]);
        k.wall(k.S(), pr.pt(pr.t[q]), pr.pt(pr.t[q + 1]), E, Math.max(E, y0), tymp ? COL.tympanum : COL.wall, Math.max(E, y1)); gableQuads++;
      }
    }
  });

  // Roof features (axis = the hall's long west wall, measured from the ring).
  const west = edges.reduce((p, q) => (q.L > p.L ? q : p));
  const ax: [number, number] = [west.u.x, west.u.z];
  const inside = (c: Point, h: number) => [-1, 1].every(sa => [-1, 1].every(sb => {
    const x = c[0] + ax[0] * h * sa - ax[1] * h * sb, z = c[1] + ax[1] * h * sa + ax[0] * h * sb; return inRing(x, z, ring) && ringDist(x, z, ring) >= 0.3;
  }));
  // Nearest position (search disc <= 3 m, 0.1 m grid) at which the square's wall stage stands inside the walls (the LiDAR
  // maxima and the City ring are registered to ~1 m); the cornice may overhang the roof.
  const settle = (c: Point, h: number): Point => {
    if (inside(c, h)) return c;
    let best: Point = c, bd = Infinity;
    for (let dx = -3; dx <= 3; dx += 0.1) for (let dz = -3; dz <= 3; dz += 0.1) {
      const d = Math.hypot(dx, dz); if (d >= bd || d > 3) continue;
      const p: Point = [c[0] + dx, c[1] + dz]; if (inside(p, h)) { best = p; bd = d; }
    }
    if (bd === Infinity) throw new Error('b11: Hargis roof feature does not fit inside the ring');
    return best;
  };
  const minRoof = (c: Point, h: number) => { let y = Infinity; for (let a = -1; a <= 1; a += 0.25) for (let bb = -1; bb <= 1; bb += 0.25) y = Math.min(y, roofAt(c[0] + ax[0] * h * a - ax[1] * h * bb, c[1] + ax[1] * h * a + ax[0] * h * bb)); return y - 0.1; };
  const cup = settle(HARGIS_CUPOLA.centre, 2.5), cupBase = minRoof(cup, 2.5);
  emitSteps(orient([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sa, sb]) => [cup[0] + ax[0] * 2.5 * sa - ax[1] * 2.5 * sb, cup[1] + ax[1] * 2.5 * sa + ax[0] * 2.5 * sb] as Point)));
  // Lantern: base stage, cornice, belfry with arched openings, cornice, bell-shaped cap (frustum rings) to the apex.
  k.stack(cup[0], cup[1], ax, [
    { h: 2.5, y0: cupBase, y1: 16.4, color: COL.stone }, { h: 2.75, y0: 16.4, y1: 16.7, color: COL.stone },
    { h: 2.2, y0: 16.7, y1: 19.0, color: COL.stone }, { h: 2.45, y0: 19.0, y1: 19.25, color: COL.stone }], HARGIS_CUPOLA.apex, COL.roof, 'metal',
    [[2.25, 19.7], [1.75, 20.1], [1.0, 20.38]]);
  // Arched belfry openings (photo): one per side, as flush dark detail on the belfry stage.
  const bel = orient([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sa, sb]) => [cup[0] + ax[0] * 2.2 * sa - ax[1] * 2.2 * sb, cup[1] + ax[1] * 2.2 * sa + ax[0] * 2.2 * sb] as Point));
  for (const e of edgesOf(bel)) archWindow(k, e, e.L / 2, 1.1, 16.95, 18.3, 0.55, COL.opening, false);
  const tow = settle(HARGIS_TOWER.centre, 2.6), towBase = minRoof(tow, 2.6);
  k.stack(tow[0], tow[1], ax, [{ h: 2.6, y0: towBase, y1: 17.2, color: COL.stone }, { h: 2.85, y0: 17.2, y1: 17.5, color: COL.stone }], HARGIS_TOWER.apex, COL.roof);
  // Arched openings in the tower's upper stage (d24 NE / SE frames), one per side.
  const tsq = orient([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sa, sb]) => [tow[0] + ax[0] * 2.6 * sa - ax[1] * 2.6 * sb, tow[1] + ax[1] * 2.6 * sa + ax[0] * 2.6 * sb] as Point));
  for (const e of edgesOf(tsq)) archWindow(k, e, e.L / 2, 1.2, 15.2, 16.9, 0.6, COL.opening, false);

  stats.hargis = {
    key: HARGIS_KEY, grade: +grade.toFixed(2), eave: E, sectionLines: cuts.map(c => +c.toFixed(2)), sectionTops: tiers.map(t => t.top), slope,
    roofPlanes, roofTriangles: roofTris, stepFaces, gableQuads, windows, pilasters,
    pediment: { wallEdge: westWall.i, s0: +s0.toFixed(2), s1: +s1.toFixed(2), depth: +depth.toFixed(2), ridge: +(E + sg * HARGIS_PEDIMENT.width / 2).toFixed(2) },
    cupola: { centre: cup.map(v => +v.toFixed(2)), base: +cupBase.toFixed(2), apex: HARGIS_CUPOLA.apex, shiftedFromLidar: +Math.hypot(cup[0] - HARGIS_CUPOLA.centre[0], cup[1] - HARGIS_CUPOLA.centre[1]).toFixed(2) },
    tower: { centre: tow.map(v => +v.toFixed(2)), base: +towBase.toFixed(2), apex: HARGIS_TOWER.apex, shiftedFromLidar: +Math.hypot(tow[0] - HARGIS_TOWER.centre[0], tow[1] - HARGIS_TOWER.centre[1]).toFixed(2) },
  };
  return HARGIS_KEY;
}

/** Window with a segmental head (rise < w/2) or round head (rise = w/2) as flush detail on edge `e` at s = sc: glass
 * (rectangle to the springing line head - rise, then the arc to the crown at `head`), and when `dressed` a 0.2 m brick
 * voussoir ring and a stone sill. A convex polygon, fanned from its centre. */
function archWindow(k: Kit, e: Edge, sc: number, w: number, sill: number, head: number, rise: number, glass = COL.glass, dressed = true) {
  const P = (s: number, y: number, d: number) => at(e, s, y, d);
  const R = (w * w / 4 + rise * rise) / (2 * rise), yC = head - R, th0 = Math.acos(Math.min(1, w / 2 / R));
  const arc = (rad: number, steps = 6) => Array.from({ length: steps + 1 }, (_, i) => { const th = th0 + (Math.PI - 2 * th0) * i / steps; return [sc + rad * Math.cos(th), yC + rad * Math.sin(th)] as [number, number]; });
  const pts: [number, number][] = [[sc - w / 2, sill], [sc + w / 2, sill], ...arc(R)];
  const g = k.D('glass'), cy = (sill + head) / 2;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], c = pts[(i + 1) % pts.length]; g.tri(P(sc, cy, 0.02), P(a[0], a[1], 0.02), P(c[0], c[1], 0.02), glass, e.n); }
  if (!dressed) return;
  const inner = arc(R), outer = arc(R + 0.2), d = k.D();
  for (let i = 0; i + 1 < inner.length; i++) d.quad(P(inner[i][0], inner[i][1], 0.025), P(outer[i][0], outer[i][1], 0.025), P(outer[i + 1][0], outer[i + 1][1], 0.025), P(inner[i + 1][0], inner[i + 1][1], 0.025), COL.brick, e.n);
  k.panel(k.D(), e, sc - w / 2 - 0.08, sc + w / 2 + 0.08, sill - 0.12, sill, 0.035, COL.stone);
}
