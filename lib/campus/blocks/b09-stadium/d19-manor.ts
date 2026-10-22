// D19 — Manor Garage + Mithoff Track/Soccer Fieldhouse (City union 463679:19, UT MAG 479 / MFH 527), replacing the generated
// garage / athletic boxes. The garage's east edge is the WEST grandstand of the Myers track:
//  - Measured: official UT rings (lidar-reference.json official MAG:479 / MFH:527); garage top deck Y 16.7, MFH roof Y 15.01,
//    garage bottom Y -2.0 (b09 context.json); 2017 USGS 3DEP DSM sections across the east edge: rake from Y ~11.9 at the edge
//    to ~17.5-17.9 about 14 m west, then the 16.7 deck; rake axis = the official east edge (slope -0.255, the same axis as the
//    Myers east stand); light-mast peaks Y 48.8 at (625.1, 310.7) and Y 48.7 at (594, 429) on the garage.
//  - Reference: ut-mag-479-directory-photo.jpg (official): buff precast open-deck garage, piers per bay, horizontal spandrels
//    with inset pink-red brick panels, dark open decks; a red-brick building with square punched windows (MFH); masts behind.
//    ut-mms-661-directory-photo.jpg: grey aluminium bleachers along the straights. d19 / d20 orbits: west stand from the field.
//  - Estimate: 6 parking levels, 7.6 m bay, spandrel / opening heights, rake row pitch, MFH window grid. The curved ramp tower
//    seen in the photograph is not placed (its location on the ring is not verified); the record's narrow vomitory notches are
//    not cut (the official ring has none).
// Revision 2: precast garage on the local precast PBR maps, MFH on brownBrick with limestone trim, inset spandrel panels on
//    brownBrick (visual), rake treads/risers on the metal (aluminium) maps, roofs on membrane; dark deck openings untextured.
import type { Point } from '../../types';
import type { BlockInstallContext } from '../types';
import { Kit, col, outward, unit, rakedStand, lightMast, V, UP, DOWN, type Mat } from './lane-kit';
import ref from './lidar-reference.json' with { type: 'json' };

export const MAG_KEY = '463679:19';
export const MANOR = { deck: 16.7, bottom: -2.0, mfhRoof: 15.01, rakeDepth: 14.4, rakeFront: 11.9, row: 0.8, rise: 0.33, levels: 6, bay: 7.6 } as const;
const C = {
  precast: col('#d9ccb3'), precastShade: col('#c8bba1'), brickPanel: col('#c98b78'), deckDark: col('#3b3a37'), roof: col('#a8a59d'),
  tread: col('#b7babd'), riser: col('#8d9093'), wall: col('#b9b2a4'), mfhBrick: col('#9c4f39'), mfhTrim: col('#cdbfa6'), glass: col('#283036'),
  steel: col('#8e9396'), lamp: col('#e9edf0'),
};

export function buildManor(kit: Kit, ctx: BlockInstallContext) {
  if (!ctx.data.buildings.some(x => x.key === MAG_KEY)) throw new Error(`D19: ${MAG_KEY} not in campus data`);
  const off = (ref as unknown as { official: Record<string, { ring: Point[] }> }).official;
  const G = off['MAG:479'].ring, M = off['MFH:527'].ring, g = ctx.groundHeight;
  // Official east edge (644.16,297.09)->(603.56,451.0); the field is to the east.
  const iE = G.findIndex(p => Math.abs(p[0] - 644.16) < 0.05 && Math.abs(p[1] - 297.09) < 0.05);
  if (iE < 0 || Math.hypot(G[iE + 1][0] - 603.56, G[iE + 1][1] - 451.0) > 0.05) throw new Error('D19: official MAG east edge not found');
  const F0 = G[iE], F1 = G[iE + 1], A = unit(F0, F1), Lr = Math.hypot(F1[0] - F0[0], F1[1] - F0[1]);
  const N: Point = [-outward(G, iE)[0], -outward(G, iE)[1]];   // into the garage (away from the field)
  const stand = rakedStand(kit, { F0, A, N, sections: [[0, Lr, MANOR.rakeDepth]], yFront: MANOR.rakeFront, row: MANOR.row, rise: MANOR.rise, ground: g,
    tread: C.tread, riser: C.riser, wall: C.wall, treadMat: 'alu', riserMat: 'alu', wallMat: 'concrete' });
  // Garage body: the official ring with its east strip replaced by the rake's back line.
  const Bn: Point = [F0[0] + N[0] * MANOR.rakeDepth, F0[1] + N[1] * MANOR.rakeDepth], Bs: Point = [F1[0] + N[0] * MANOR.rakeDepth, F1[1] + N[1] * MANOR.rakeDepth];
  const rest: Point[] = []; for (let k = 2; k < G.length; k++) rest.push(G[(iE + k) % G.length]);   // F1 -> ... -> F0 without them
  const P: Point[] = [Bs, ...rest, Bn];   // order: south back-line point, south edge .. west .. north edge, north back-line point
  // MFH shares the garage's south edge: below the MFH roof that wall is internal.
  const onMfh = (a: Point, b: Point) => M.some((p, i) => { const q = M[(i + 1) % M.length]; return near(a, p, q) && near(b, p, q); });
  let base = Infinity; for (const p of G) base = Math.min(base, g(p[0], p[1]));
  for (let i = 0; i < P.length - 1; i++) {        // last edge (Bn -> Bs) is the rake's back wall
    const a = P[i], b = P[(i + 1) % P.length], n = outward(P, i);
    garageFacade(kit, a, b, n, g, onMfh(a, b) ? MANOR.mfhRoof : null);
  }
  kit.cap('solid', 'concrete', [P], MANOR.deck, C.roof);
  // MFH: red brick with square punched windows; its edge on the garage line is internal.
  for (let i = 0; i < M.length; i++) {
    const a = M[i], b = M[(i + 1) % M.length];
    if (onLine(a, b, G)) continue;
    mfhFacade(kit, a, b, outward(M, i), g);
  }
  kit.cap('solid', 'membrane', [M], MANOR.mfhRoof, C.roof);
  // Light masts standing on the deck, lamp banks facing the field.
  const east: Point = [-N[0], -N[1]];
  for (const [at, top] of [[[625.1, 310.7], 48.8], [[594.0, 429.0], 48.7]] as [Point, number][]) lightMast(kit, at, MANOR.deck + 0.6, top, 9, A, east, C.steel, C.lamp);
  return { westStand: stand, deck: MANOR.deck, mfhRoof: MANOR.mfhRoof, masts: 2, base: +base.toFixed(2) };
}

const segD = (p: Point, a: Point, b: Point) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l)) : 0; return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dz - p[1]); };
const near = (p: Point, a: Point, b: Point) => segD(p, a, b) < 0.25;
const onLine = (a: Point, b: Point, ring: Point[]) => ring.some((p, i) => { const q = ring[(i + 1) % ring.length]; return near(a, p, q) && near(b, p, q); });

/** Open-deck garage facade: full-height piers per bay, a precast spandrel per level with an inset brick panel, dark open deck
 * openings recessed 0.6 m, coping band to the top deck. `from` = start height (internal below it). */
function garageFacade(kit: Kit, a: Point, b: Point, n: Point, g: (x: number, z: number) => number, from: number | null) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) return;
  const T = unit(a, b), P = (t: number, d: number, y: number) => V(a[0] + T[0] * t - n[0] * d, y, a[1] + T[1] * t - n[1] * d), out = V(n[0], 0, n[1]);
  const face = (t0: number, t1: number, d: number, y0: number, y1: number, c = C.precast, mat: Mat = 'concrete') => { if (t1 - t0 > 0.01 && y1 - y0 > 0.01) kit.quad('solid', mat, P(t0, d, y0), P(t1, d, y0), P(t1, d, y1), P(t0, d, y1), c, out); };
  const g0 = Math.min(g(a[0], a[1]), g(b[0], b[1])) - 0.6, top = MANOR.deck + 1.1;
  // Parapet: inner face (seen from the deck) and top, 0.25 m thick.
  kit.quad('solid', 'concrete', P(L, 0.25, MANOR.deck), P(0, 0.25, MANOR.deck), P(0, 0.25, top), P(L, 0.25, top), C.precastShade, V(-n[0], 0, -n[1]));
  kit.quad('solid', 'concrete', P(0, 0, top), P(L, 0, top), P(L, 0.25, top), P(0, 0.25, top), C.precastShade, UP);
  if (from !== null) { face(0, L, 0, from, top); return; }
  const bays = L < 6 ? 0 : Math.max(1, Math.round(L / MANOR.bay));
  if (!bays) { face(0, L, 0, g0, top); return; }
  // Horizontal floors on a fixed grid from the garage bottom (Y -2.0) to the top deck; on the uphill side the lower openings
  // fall below grade and the bay is solid there.
  const lev = (MANOR.deck - MANOR.bottom) / MANOR.levels, bw = L / bays, pier = 0.9, rec = 0.6, top0 = MANOR.deck - 0.2;
  face(0, L, 0, top0, top, C.precastShade);   // coping band
  for (let k = 0; k < bays; k++) {
    const s = k * bw, o0 = s + pier / 2, o1 = s + bw - pier / 2;
    face(s, o0, 0, g0, top0); face(o1, s + bw, 0, g0, top0);
    const mid = P((o0 + o1) / 2, 0, 0), gb = Math.max(g(mid.x, mid.z), g(P(o0, 0, 0).x, P(o0, 0, 0).z), g(P(o1, 0, 0).x, P(o1, 0, 0).z));
    const openings: [number, number][] = [];
    for (let j = 0; j < MANOR.levels; j++) {
      const y0 = MANOR.bottom + j * lev, a0 = Math.max(y0 + 1.1, gb + 0.9), a1 = Math.min(y0 + lev, top0);
      if (a1 - a0 >= 1.3) openings.push([a0, a1]);
    }
    let yPrev = g0;
    for (const [a0, a1] of openings) {
      face(o0, o1, 0, yPrev, a0);
      if (a0 - yPrev > 0.8 && yPrev > g0) {   // inset brick panel on the spandrel (visual)
        const q = (t: number, y: number) => P(t, -0.02, y);
        kit.quad('detail', 'redBrick', q(o0 + 0.5, yPrev + 0.2), q(o1 - 0.5, yPrev + 0.2), q(o1 - 0.5, a0 - 0.2), q(o0 + 0.5, a0 - 0.2), C.brickPanel, out);
      }
      face(o0, o1, rec, a0, a1, C.deckDark, 'matte');
      kit.quad('solid', 'concrete', P(o0, 0, a0), P(o0, rec, a0), P(o0, rec, a1), P(o0, 0, a1), C.precastShade, V(T[0], 0, T[1]));
      kit.quad('solid', 'concrete', P(o1, rec, a0), P(o1, 0, a0), P(o1, 0, a1), P(o1, rec, a1), C.precastShade, V(-T[0], 0, -T[1]));
      kit.quad('solid', 'concrete', P(o0, rec, a0), P(o1, rec, a0), P(o1, 0, a0), P(o0, 0, a0), C.precastShade, UP);
      kit.quad('solid', 'concrete', P(o0, 0, a1), P(o1, 0, a1), P(o1, rec, a1), P(o0, rec, a1), C.precastShade, DOWN);
      yPrev = a1;
    }
    face(o0, o1, 0, yPrev, top0);
  }
}

/** MFH brick facade with square punched windows (recessed 0.3 m) on four storeys up to the roof parapet. */
function mfhFacade(kit: Kit, a: Point, b: Point, n: Point, g: (x: number, z: number) => number) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) return;
  const T = unit(a, b), P = (t: number, d: number, y: number) => V(a[0] + T[0] * t - n[0] * d, y, a[1] + T[1] * t - n[1] * d), out = V(n[0], 0, n[1]);
  const face = (t0: number, t1: number, d: number, y0: number, y1: number, c = C.mfhBrick, mat: Mat = 'redBrick') => { if (t1 - t0 > 0.01 && y1 - y0 > 0.01) kit.quad('solid', mat, P(t0, d, y0), P(t1, d, y0), P(t1, d, y1), P(t0, d, y1), c, out); };
  const gr = Math.min(g(a[0], a[1]), g(b[0], b[1])), g0 = gr - 0.6, top = MANOR.mfhRoof + 0.8, w = 1.7, pitch = 4.2;
  const n0 = Math.floor((L - 1.2) / pitch);
  if (n0 < 1) { face(0, L, 0, g0, top); return; }
  const off0 = (L - n0 * pitch) / 2, rows: number[] = [];
  for (let y = gr + 2.0; y + w < MANOR.mfhRoof - 1.0; y += 3.8) rows.push(y);
  face(0, L, 0, MANOR.mfhRoof - 0.4, top, C.mfhTrim, 'stone');
  let yPrev = g0; const cols = Array.from({ length: n0 }, (_, k) => off0 + k * pitch + (pitch - w) / 2);
  for (const y of rows) {
    face(0, L, 0, yPrev, y);
    let tPrev = 0;
    for (const t of cols) {
      face(tPrev, t, 0, y, y + w);
      face(t, t + w, 0.3, y, y + w, C.glass, 'glass');
      kit.quad('solid', 'stone', P(t, 0, y), P(t, 0.3, y), P(t, 0.3, y + w), P(t, 0, y + w), C.mfhTrim, V(T[0], 0, T[1]));
      kit.quad('solid', 'stone', P(t + w, 0.3, y), P(t + w, 0, y), P(t + w, 0, y + w), P(t + w, 0.3, y + w), C.mfhTrim, V(-T[0], 0, -T[1]));
      kit.quad('solid', 'stone', P(t, 0.3, y), P(t + w, 0.3, y), P(t + w, 0, y), P(t, 0, y), C.mfhTrim, UP);
      kit.quad('solid', 'stone', P(t, 0, y + w), P(t + w, 0, y + w), P(t + w, 0.3, y + w), P(t, 0.3, y + w), C.mfhTrim, DOWN);
      tPrev = t + w;
    }
    face(tPrev, L, 0, y, y + w);
    yPrev = y + w;
  }
  face(0, L, 0, yPrev, MANOR.mfhRoof - 0.4);
}
