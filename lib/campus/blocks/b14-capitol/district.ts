// b14 Group 4 (district wave D34-D36, research/whole-campus-92/district-agents-40): three records rebuilt on their FROZEN
// City rings and heights with the articulation the actual orbit frames show, in a PBR-textured kit (pbr.ts). The Capitol,
// the Supreme Court union, the 262 City 2023 additions and the south-strip ground are not touched.
//  * 656265:920 (D34): FINAL correction after the root IAB review -> granite.ts (DSM-derived podium, west corner
//    pavilions with copper pyramids, broad central copper hip on a light attic, perimeter ledge, pale pink granite).
//  * 624194:789 (D35; d35 orbit frames): parking structure on the frozen massing (deck 23.9 m above groundY -13.1, stair
//    tower tier 32.3 m): continuous horizontal precast spandrels per level with dark open bays recessed 1.2 m between
//    flush columns; everything inside the City ring.
//  * 467902:75 (D36; d36 orbit frames): two-storey light-blue sided house on its City ring with the generator's height
//    (City 2023 h 10.82 m above the generator grade; the 2017 LiDAR has no roof returns there): exact gabled roof (ridge
//    E-W; west gable seen in the SW frame), eave fascia, white window trim, and an inset front porch on the west (street)
//    face with columns, railing and floor.
// Storeys, bay counts, arch sizes, porch depth and eave height are ESTIMATES from pixel proportions; rings and tops are
// the frozen measured / City values.
import * as THREE from 'three';
import type { CampusData, Point } from '../../types';
import { cleanRing, orientRings } from '../../context-geometry';
import { Kit, edgesOf, at, orient, type Edge } from './kit';
import { hipPlanes, roofFaces, profile, convexHull, type RoofSpec } from './roof';
import { col } from './pbr';
import { buildGranite } from './granite';
import context from './context.json' with { type: 'json' };

type G = (x: number, z: number) => number;
const UPV = new THREE.Vector3(0, 1, 0), DOWNV = new THREE.Vector3(0, -1, 0);
export const DISTRICT_KEYS = { granite: '656265:920', garage: '624194:789', blueHouse: '467902:75' } as const;
type Vol = { ring?: Point[]; bottom: number; top: number; role: string };
const MASSING = (context as unknown as { massing: Record<string, { datum?: { aboveY: number }; volumes: Vol[] }> }).massing;
const recordOf = (data: CampusData, key: string) => { const b = data.buildings.find(x => x.key === key); if (!b) throw new Error(`b14: record ${key} missing`); return b; };
/** The generator's ring (context-buildings prepareRings) and its ground samples: every <= 6 m along the ring + centre. */
export function groundOf(data: CampusData, key: string, g: G) {
  const b = recordOf(data, key), ring = orientRings([cleanRing(b.rings[0])])[0], s: number[] = [];
  for (let i = 0; i < ring.length; i++) { const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 6));
    for (let k = 0; k < n; k++) s.push(g(ax + (bx - ax) * k / n, az + (bz - az) * k / n)); }
  s.push(g(b.center[0], b.center[1])); s.sort((p, q) => p - q);
  return { ring: orient(ring), grade: s[Math.floor(s.length / 2)], low: s[0], base: s[0] - 1.2 };
}
export const massingOf = (key: string) => {
  const m = MASSING[key]; if (!m?.datum) throw new Error(`b14: no aboveY massing for ${key}`);
  const main = m.volumes.find(v => v.role === 'main'), tier = m.volumes.find(v => v.role === 'tier');
  if (!main || !tier?.ring) throw new Error(`b14: ${key} massing needs main + tier`);
  return { deck: m.datum.aboveY + main.top, tierTop: m.datum.aboveY + tier.top, tier: orient(tier.ring) };
};
/** Vertical quad on edge e: along [s0,s1], height [y0,y1], at offsets d0 (s0 end) / d1 (s1 end). */
const Q = (k: Kit, e: Edge, s0: number, s1: number, y0: number, y1: number, d0: number, d1: number, c: THREE.Color, hint: THREE.Vector3) =>
  k.S().quad(at(e, s0, y0, d0), at(e, s1, y0, d1), at(e, s1, y1, d1), at(e, s0, y1, d0), c, hint);
/** Window: surround (detail) + glass, flush at offset d. */
const win = (k: Kit, e: Edge, sc: number, w: number, y0: number, y1: number, d: number) => {
  k.panel(k.D(), e, sc - w / 2 - 0.1, sc + w / 2 + 0.1, y0 - 0.1, y1 + 0.1, d, col('frameLight'));
  k.panel(k.D(), e, sc - w / 2, sc + w / 2, y0, y1, d + 0.015, col('glass'));
};
/** Walls above `from` up to the exact roof line along every ring edge (gable / concave-edge infill). */
const roofWalls = (k: Kit, ring: Point[], spec: RoofSpec, from: number, c: THREE.Color) => {
  for (const e of edgesOf(ring)) { const pr = profile(e.a, e.c, [spec]);
    for (let q = 0; q + 1 < pr.t.length; q++) { const y0 = pr.y[0][q], y1 = pr.y[0][q + 1]; if (y0 - from > 1e-3 || y1 - from > 1e-3) k.wall(k.S(), pr.pt(pr.t[q]), pr.pt(pr.t[q + 1]), from, Math.max(from, y0), c, Math.max(from, y1)); } }
};

// ------------------------------------------------------------------ 624194:789 parking structure (D35)
export const GARAGE = { level: 3.0, spandrel: 1.05, recess: 1.2, cornerPier: 1.5, bay: 8.5, column: 0.6, minEdge: 6 };
function garage(k: Kit, data: CampusData, g: G, st: Record<string, unknown>) {
  const { ring, grade, base } = groundOf(data, DISTRICT_KEYS.garage, g), { deck, tierTop, tier } = massingOf(DISTRICT_KEYS.garage);
  const nl = Math.max(1, Math.round((deck - grade) / GARAGE.level)), hl = (deck - grade) / nl, R = GARAGE.recess, lvl = (i: number) => grade + i * hl;
  k.cap(k.S(), [ring, tier.slice().reverse()], deck, col('garageRoof'));
  for (const e of edgesOf(tier)) Q(k, e, 0, e.L, deck, tierTop, 0, 0, col('column'), e.n);       // stair / lift tower
  k.cap(k.S(), [tier], tierTop, col('garageRoof'));
  let bays = 0, columns = 0; const faces: { edge: number; open: [number, number][] }[] = [];
  for (const e of edgesOf(ring)) {
    if (e.L < GARAGE.minEdge) { Q(k, e, 0, e.L, base, deck, 0, 0, col('spandrel'), e.n); continue; }
    const n = Math.max(1, Math.round((e.L - 2 * GARAGE.cornerPier) / GARAGE.bay)), bw = (e.L - 2 * GARAGE.cornerPier) / n, c2 = GARAGE.column / 2;
    // along the edge: corner pier | bay | column | bay | ... | corner pier
    const segs: [number, number, boolean][] = [[0, GARAGE.cornerPier, false]];
    for (let i = 0; i < n; i++) { const s0 = GARAGE.cornerPier + i * bw, s1 = s0 + bw;
      segs.push([s0 + (i ? c2 : 0), s1 - (i < n - 1 ? c2 : 0), true]); if (i < n - 1) { segs.push([s1 - c2, s1 + c2, false]); columns++; } }
    segs.push([e.L - GARAGE.cornerPier, e.L, false]);
    faces.push({ edge: e.i, open: segs.filter(x => x[2]).map(x => [+x[0].toFixed(3), +x[1].toFixed(3)]) });
    for (let i = 0; i < nl; i++) {
      // each level: open bay below, spandrel band at its top (the last band is the top deck edge)
      const sp0 = lvl(i + 1) - GARAGE.spandrel, sp1 = lvl(i + 1), o0 = i === 0 ? base : lvl(i), o1 = sp0;
      Q(k, e, 0, e.L, sp0, sp1, 0, 0, col('spandrel'), e.n);
      for (const [a, b, open] of segs) {
        if (!open) { Q(k, e, a, b, o0, o1, 0, 0, col('column'), e.n); continue; }
        Q(k, e, a, b, o0, o1, -R, -R, col('deckGap'), e.n);                                                                    // dark deck void
        k.S().quad(at(e, a, o1, -R), at(e, b, o1, -R), at(e, b, o1, 0), at(e, a, o1, 0), col('spandrel'), DOWNV);                // spandrel soffit
        if (i > 0) k.S().quad(at(e, a, o0, -R), at(e, b, o0, -R), at(e, b, o0, 0), at(e, a, o0, 0), col('spandrel'), UPV);      // spandrel top / sill
        Q(k, e, a, a, o0, o1, 0, -R, col('column'), e.u); Q(k, e, b, b, o0, o1, -R, 0, col('column'), e.u.clone().negate());   // column returns
        bays++;
      }
    }
  }
  st.garage = { key: DISTRICT_KEYS.garage, grade: +grade.toFixed(3), deck: +deck.toFixed(3), tierTop: +tierTop.toFixed(3), levels: nl, levelHeight: +hl.toFixed(4), spandrel: GARAGE.spandrel, recess: R, openBays: bays, columns, faces };
  return DISTRICT_KEYS.garage;
}

// ------------------------------------------------------------------ 467902:75 blue house (D36)
export const HOUSE = { cityH: 10.82, rise: 3.2, porch: { depth: 2.0, endWall: 1.0, height: 3.0, floor: 0.5, column: 0.3, colInset: 0.9, rail: 0.9 } };
/** Eave edges of the gable: hull / ring edges running E-W (north and south walls). */
export const houseEave = (a: Point, c: Point) => Math.abs(c[0] - a[0]) / Math.hypot(c[0] - a[0], c[1] - a[1]) > 0.7;
/** Exact gable: the two eave planes from the north / south hull edges, slope chosen so the highest point of
 * min(plane N, plane S) over the plan (a plan vertex or a crossing of the ridge line dN = dS with a plan edge) reaches
 * the City-h top exactly; cap plane at the top. */
export function houseRoof(data: CampusData, g: G) {
  const { ring, grade, low, base } = groundOf(data, DISTRICT_KEYS.blueHouse, g), top = grade + HOUSE.cityH, E = top - HOUSE.rise;
  const hull = convexHull(ring), lines: { nx: number; nz: number; k: number }[] = [];
  for (let i = 0; i < hull.length; i++) { const a = hull[i], c = hull[(i + 1) % hull.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 1e-6 || !houseEave(a, c)) continue;
    const nx = -(c[1] - a[1]) / L, nz = (c[0] - a[0]) / L; lines.push({ nx, nz, k: -(nx * a[0] + nz * a[1]) }); }
  if (lines.length !== 2) throw new Error(`b14: blue house needs 2 eave hull edges (${lines.length})`);
  const dist = (l: typeof lines[number], x: number, z: number) => l.nx * x + l.nz * z + l.k, f = (x: number, z: number) => Math.min(dist(lines[0], x, z), dist(lines[1], x, z));
  let best = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i], c = ring[(i + 1) % ring.length]; best = Math.max(best, f(a[0], a[1]));
    const h0 = dist(lines[0], a[0], a[1]) - dist(lines[1], a[0], a[1]), h1 = dist(lines[0], c[0], c[1]) - dist(lines[1], c[0], c[1]);
    if ((h0 > 0) !== (h1 > 0) && Math.abs(h1 - h0) > 1e-12) { const t = h0 / (h0 - h1); best = Math.max(best, f(a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t)); } }
  const slope = HOUSE.rise / best, spec: RoofSpec = { hips: hipPlanes(ring, E, slope, top, (a, c) => !houseEave(a, c)), gables: [] };
  return { ring, grade, low, base, top, E, slope, spec };
}
function blueHouse(k: Kit, data: CampusData, g: G, st: Record<string, unknown>) {
  const { ring, grade, base, top, E, slope, spec } = houseRoof(data, g), H = HOUSE.porch;
  const roof = roofFaces(k, ring, spec, col('houseRoof'), 'matte');
  roofWalls(k, ring, spec, E, col('blueSiding'));                                                     // gable infill to the exact roof line
  const west = edgesOf(ring).reduce((b, e) => (e.n.x < b.n.x ? e : b));
  let windows = 0, porchInfo: Record<string, unknown> | null = null;
  for (const e of edgesOf(ring)) {
    const porch = e.i === west.i && e.L > 2 * H.endWall + 4, eave = houseEave(e.a, e.c);
    const s0 = H.endWall, s1 = e.L - H.endWall, pt = grade + H.height, fl = grade + H.floor;
    const faces = porch ? [k.face(e, base, E, col('blueSiding'), { s1: s0 }), k.face(e, pt, E, col('blueSiding'), { s0, s1 }), k.face(e, base, E, col('blueSiding'), { s0: s1 })] : [k.face(e, base, E, col('blueSiding'))];
    if (eave && e.L >= 1) k.attach(faces, -0.3, e.L + 0.3, E - 0.25, E, 0.3, col('houseTrim'));       // eave fascia
    if (e.L < 2.5) continue;
    const nb = Math.max(1, Math.floor(e.L / 3.0));
    for (let j = 0; j < nb; j++) { const sc = (j + 0.5) * e.L / nb;
      if (!porch) { win(k, e, sc, 0.95, grade + 1.0, grade + 2.6, 0.03); windows++; }
      win(k, e, sc, 0.95, grade + 4.3, grade + 5.8, 0.03); windows++; }
    if (!eave && e.L > 6) { win(k, e, e.L / 2, 0.9, E + 0.4, E + 1.4, 0.03); windows++; }        // gable window
    if (porch) {
      const D = H.depth, mid = (s0 + s1) / 2, w = s1 - s0;
      Q(k, e, s0, s1, fl, pt, -D, -D, col('blueSiding'), e.n);                                                       // porch back wall
      k.S().quad(at(e, s0, pt, -D), at(e, s1, pt, -D), at(e, s1, pt, 0), at(e, s0, pt, 0), col('houseTrim'), DOWNV);    // porch ceiling
      Q(k, e, s0, s0, base, pt, 0, -D, col('blueSiding'), e.u); Q(k, e, s1, s1, base, pt, -D, 0, col('blueSiding'), e.u.clone().negate());
      k.box(k.S(), e, s0, s1, base, fl, -D, 0, col('porchFloor'), false, { s0: false, s1: false, bottom: false });     // porch floor
      const cols = [s0 + H.colInset, s0 + w * 0.36, s0 + w * 0.64, s1 - H.colInset];
      for (const c of cols) k.box(k.S(), e, c - H.column / 2, c + H.column / 2, fl, pt, -H.column, 0, col('houseTrim'), true, { top: false, bottom: false });
      // 5 cm railing between the posts, ends buried in the posts, off the posts' side-face sample lines (d -0.1 / -0.2)
      for (const [a, b] of [[cols[0], cols[1]], [cols[2], cols[3]]]) k.box(k.S(), e, a + H.column / 2, b - H.column / 2, fl, fl + H.rail, -0.17, -0.12, col('houseTrim'), true, { bottom: false, s0: false, s1: false });
      win(k, e, mid, 1.0, fl, fl + 2.1, -D + 0.03); win(k, e, s0 + w * 0.18, 0.95, grade + 1.0, grade + 2.6, -D + 0.03); win(k, e, s1 - w * 0.18, 0.95, grade + 1.0, grade + 2.6, -D + 0.03); windows += 3;
      porchInfo = { edge: e.i, s: [+s0.toFixed(3), +s1.toFixed(3)], depth: D, floorY: +fl.toFixed(3), ceilingY: +pt.toFixed(3), columns: cols.map(c => +c.toFixed(3)), railTop: +(fl + H.rail).toFixed(3) };
    }
  }
  st.blueHouse = { key: DISTRICT_KEYS.blueHouse, grade: +grade.toFixed(3), ridgeTop: +top.toFixed(3), eave: +E.toFixed(3), gableSlope: +slope.toFixed(5), roofPlanes: roof.planes, westEdge: west.i, windows, porch: porchInfo };
  return DISTRICT_KEYS.blueHouse;
}

export function buildDistrict(k: Kit, data: CampusData, g: G, st: Record<string, unknown>) {
  const main = MASSING[DISTRICT_KEYS.granite]?.volumes.find(v => v.role === 'main'), datum = MASSING[DISTRICT_KEYS.granite]?.datum;
  if (!main || !datum) throw new Error('b14: 656265:920 main massing missing');
  return [buildGranite(k, data, groundOf(data, DISTRICT_KEYS.granite, g), datum.aboveY + main.top, st), garage(k, data, g, st), blueHouse(k, data, g, st)];
}
