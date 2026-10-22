// D33 / b13: the long buff-brick school on the eastern edge (City 587556:560).
// Evidence (research/whole-campus-92/district-agents-40/packets/D33.json; d33-orbit-{southwest,northeast,northwest}, the
// 0.5 m raster in the school's own rectilinear frame (axis (-5.73, -3.1)), work in .work/derived-b13):
//  * plan + heights: the FROZEN City ring and the FROZEN context.json massing volumes - main deck 6.0 + 5.9 = 11.9 over
//    the whole ring, tier 1 (the three-storey classroom spine and its east arm) 6.0 + 12.2 = 18.2 on the massing's own
//    tier ring, tier 2 (north block) 6.0 + 8.2 = 14.2 on its ring (raster tier P50 18.22 / 14.17). Each tier is a
//    separate parapeted body standing on the main deck (its walls continue the main walls where the rings coincide);
//    the authored tier rings drop LiDAR-snap spikes (< 35 deg, engine.ts despike) - the frozen rings stay untouched;
//  * rooftop plant ONLY where the 2017 raster has a return above the deck: the 4.5 x 6 m unit on tier 1 (top 20.36),
//    two small units on tier 1 (19.29, 19.45) and the 3.3 m vent stack on tier 2 (17.47). The newer frames show further
//    small units in a row on a roof (d33-orbit-northwest) that have no height support in the 2017 data: NOT modelled;
//  * facades reference-interpreted (SW / NE frames): buff brick, regular bays of large windows between brick piers,
//    cast-stone base and coping. Storey heights (ground 4.5 m, upper 3.4 m), bay width 4.2 m and pier depth are
//    ESTIMATES; hidden faces repeat the visible rhythm.
import type { Point, CampusData } from '../../types';
import type { Kit } from './kit';
import { P } from './materials';
import { flat, makeBody, emitRoofs, emitParapet, emitWalls, roofBox, orect, neighbours, despike, type Body, type Seg, type SegStyle, type WallStats, type Feature } from './engine';
import { hull } from './d29';
import context from './context.json' with { type: 'json' };

export const D33_KEY = '587556:560';
const newStats = (): WallStats => ({ segments: 0, windows: 0, bands: 0, pilasters: 0, balconies: 0, infill: 0, party: 0, near: 0, probes: [] });
type Vol = { rings?: Point[][]; bottom: number; top: number; role?: string };
/** Raster clusters above the tier decks: x0, x1, z0, z1 (incl. 0.25 m cell pad), top, tier. */
const UNITS: [number, number, number, number, number, 1 | 2][] = [
  [951.4, 955.9, -837.03, -831.03, 20.3, 1], [957.9, 958.9, -830.03, -828.53, 19.25, 1], [934.9, 935.9, -798.03, -797.03, 19.4, 1], [913.46, 914.46, -767.99, -766.49, 17.45, 2],
];
const LIDAR_MAX = 20.36;

export function buildD33(k: Kit, data: CampusData, ground: (x: number, z: number) => number, stats: Record<string, unknown>) {
  const b = data.buildings.find(x => x.key === D33_KEY);
  if (!b) throw new Error(`b13: ${D33_KEY} missing from the data`);
  const m = (context as unknown as { massing: Record<string, { datum: { aboveY: number }; volumes: Vol[] }> }).massing[D33_KEY];
  const y0 = m.datum.aboveY, main = m.volumes[0], tiers = m.volumes.slice(1);
  if (tiers.length !== 2 || main.top !== 5.9) throw new Error('b13: D33 frozen massing changed');
  const ring = b.rings[0] as Point[], others = neighbours(data, D33_KEY, ring);
  const mainDeck = y0 + main.top;
  const features: Feature[] = [], probes: WallStats['probes'] = [];
  // Tier 2's south edge faces tier 1 across only 0.44-0.61 m in the frozen (independently snapped) massing rings, while the
  // raster shows a ~3 m strip at main-deck height between the two roofs (school-frame rows W 1129-1131 at 12.0-12.75): the
  // authored tier-2 body moves that one edge 0.9 m into tier 2 (inside the 1 m inset the frozen-ring LiDAR gate samples).
  const tierRings = tiers.map((t, i) => despike(i === 1 ? moveEdge(t.rings![0], [919.64, -787.99], [936.29, -780.64], 0.9) : t.rings![0]));
  const nearTier = (s: Seg) => { const mx = s.e.a[0] + s.e.u.x * (s.s0 + s.s1) / 2, mz = s.e.a[1] + s.e.u.z * (s.s0 + s.s1) / 2; return tierRings.some(r => r.some((p, i) => segD([mx, mz], p, r[(i + 1) % r.length]) < 0.6)); };
  const brick = P('buffBrick'), stone = P('castStone');
  const win = (sill: number, head: number) => ({ sill, head, w: 2.4, bay: 4.2, margin: 1.0, recess: 0.2, reveal: brick, pane: P('glass'), sillBox: { h: 0.12, d: 0.08, color: stone } });
  // Main body (one storey + the ground storey of the tiers).
  const mb = makeBody({ key: D33_KEY, ring, specs: [flat(mainDeck)], roofColor: [P('membraneLight')], cells: [{ name: 'main', poly: hull(ring), spec: 0 }], others }, ground);
  const G = mb.grade;
  emitRoofs(k, mb);
  const ws = newStats();
  emitWalls(k, mb, ground, (s: Seg): SegStyle => ({
    wall: brick, plinth: { top: G + 0.6, color: stone },
    bands: nearTier(s) ? [] : [{ y0: s.top - 0.4, y1: s.top, d: 0.2, color: stone, ext: true }],
    windows: [win(G + 0.9, G + 3.3)],
    // Main walls under a tier carry no piers (the tier's own piers start at the main deck above them).
    pilasters: nearTier(s) ? undefined : { w: 0.6, d: 0.18, color: brick, y0: G + 0.6, y1: s.top },
  }), ws);
  probes.push(...ws.probes);
  const tierStats: unknown[] = [];
  tiers.forEach((t, ti) => {
    const deck = y0 + t.top, tr = tierRings[ti];
    let body: Body = makeBody({ key: D33_KEY, ring: tr, specs: [flat(deck)], roofColor: [P('membraneLight')], cells: [{ name: `tier${ti + 1}`, poly: hull(tr), spec: 0 }], base: mainDeck, parapet: { h: 0.6, t: 0.25, coping: stone } }, ground);
    for (const [x0, x1, z0, z1, top, tier] of UNITS) {
      if (tier !== ti + 1) continue;
      const q = orect((x0 + x1) / 2, (z0 + z1) / 2, [1, 0], Math.max(0.35, (x1 - x0) / 2 - 0.25), Math.max(0.35, (z1 - z0) / 2 - 0.25));
      try { const r = roofBox(k, body, q, top, P('metalLight'), P('metalLight')); if (r) features.push({ key: D33_KEY, kind: top - deck > 2.5 ? 'vent stack' : 'plant', x: r.x, z: r.z, top, lidarMax: LIDAR_MAX }); } catch { /* outside the inset deck: not emitted */ }
    }
    let parapet = true;
    try { emitParapet(k, body); } catch { parapet = false; body = { ...body, parapet: undefined }; emitRoofs(k, body); }
    const tws = newStats();
    // First tier sills > 1 m above the main deck (G3's 1 m drop ray from deck triangles near the tier walls).
    const rows = ti === 0 ? [win(mainDeck + 1.05, mainDeck + 2.9), win(mainDeck + 3.8, mainDeck + 5.85)] : [win(mainDeck + 1.05, mainDeck + 2.5)];
    emitWalls(k, body, ground, (s: Seg): SegStyle => ({
      wall: brick, bands: [{ y0: s.top - 0.35, y1: s.top, d: 0.2, color: stone, ext: true }],
      windows: rows, pilasters: { w: 0.6, d: 0.18, color: brick, y0: mainDeck, y1: s.top, bottom: true },
    }), tws);
    probes.push(...tws.probes);
    tierStats.push({ tier: ti + 1, deck, parapet, ...tws, probes: tws.probes.length });
  });
  stats.d33_school = { key: D33_KEY, grade: +G.toFixed(2), mainDeck, tiers: tierStats, main: { ...ws, probes: ws.probes.length }, units: features.length, unitsDeclared: UNITS.length };
  return { key: D33_KEY, probes, features, courts: [] as { key: string; ring: Point[] }[] };
}
const segD = (p: Point, a: Point, c: Point) => { const dx = c[0] - a[0], dz = c[1] - a[1], l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l)) : 0; return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dz - p[1]); };
/** Ring with the edge a->c (given by its exact vertices) moved `d` m towards the ring interior. */
function moveEdge(r: Point[], a: Point, c: Point, d: number): Point[] {
  const ia = r.findIndex(p => Math.hypot(p[0] - a[0], p[1] - a[1]) < 0.011), ic = r.findIndex(p => Math.hypot(p[0] - c[0], p[1] - c[1]) < 0.011);
  if (ia < 0 || ic < 0) throw new Error('b13: D33 tier-2 edge vertices missing (frozen massing changed?)');
  const L = Math.hypot(c[0] - a[0], c[1] - a[1]), n1: Point = [-(c[1] - a[1]) / L, (c[0] - a[0]) / L];
  const area2 = r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
  const ref = [(a[0] + c[0]) / 2 + n1[0] * 0.05, (a[1] + c[1]) / 2 + n1[1] * 0.05];
  const inside = (x: number, z: number) => { let k = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) k = !k; } return k; };
  const n: Point = inside(ref[0], ref[1]) ? n1 : [-n1[0], -n1[1]]; void area2;
  return r.map((p, i) => (i === ia || i === ic ? [p[0] + n[0] * d, p[1] + n[1] * d] as Point : p));
}
