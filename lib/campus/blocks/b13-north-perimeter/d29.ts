// D29 / b13: the two mid-rise apartment blocks of the 2700 Rio Grande / Nueces corner (City 734784:1264, 654096:874).
// Evidence (research/whole-campus-92/district-agents-40/packets/D29.json; projections of the frozen rings into the actual
// orbit frames d29-orbit-{southwest,southeast,northeast,northwest}, work in .work/derived-b13):
//  * plan: the FROZEN City 2023 rings unchanged, including 654096's courtyard hole; their many 0.6-2 m jogs ARE the
//    projecting window bays seen in the NE / NW frames, so bay relief comes from the measured footprint itself;
//  * heights: the frozen context.json massing decks (734784: 17.5 + 18.5 = 36.0; 654096: 12.9 + 25 = 37.9, the
//    generator's P95-minus-parapet convention - raster roof P50 is 36.12, so the parapet top 38.9 = raster P95 38.89);
//  * 654096's City hole is NOT open ground: the 2017 class-6 raster covers 86 % of it at P50 19.27 (~4 m above grade),
//    a podium courtyard deck; the court walls stand on that measured podium (open to the sky, closed at 19.27);
//  * rooftop penthouses / plant: residual clusters of the raster above each deck (734784: three overruns to 41.0 / 40.1,
//    small units 37.3-37.4; 654096: stair/elevator tower 42.47, plant 40.26 / 39.61 / 38.97), boxes aligned to each ring;
//  * facades reference-interpreted: 734784 (NE / SW frames) light stucco upper floors over a red-brick ground storey,
//    regular punched-window grid, coping cornice; 654096 (NW / SE / NE frames) grey stone-like lower two storeys, pale
//    blue upper floors with white-framed windows and stacked balconies with railings. Storey heights (OSM: 5 levels for
//    734784; 6 counted for 654096), bay spacing and balcony positions (every third bay of long walls) are ESTIMATES;
//    hidden faces repeat the visible rhythm and are not claimed as observed.
import type { Point, CampusData } from '../../types';
import type { Kit } from './kit';
import { P } from './materials';
import { flat, makeBody, emitParapet, emitWalls, roofBox, orect, neighbours, type Seg, type SegStyle, type WallStats, type Feature } from './engine';

export const D29_KEYS = ['734784:1264', '654096:874'] as const;
type Unit = [number, number, number, number, number]; // x0, x1, z0, z1 (raster cluster bbox incl. 0.25 m cell pad), top
const UNITS: Record<string, { lidarMax: number; deck: number; units: Unit[]; kinds: string[] }> = {
  '734784:1264': { lidarMax: 41.04, deck: 36.0, kinds: ['penthouse', 'penthouse', 'penthouse', 'plant', 'plant', 'plant'], units: [
    [-669.14, -664.64, -709.15, -702.15, 41.0], [-628.14, -624.14, -681.15, -674.65, 40.1], [-618.14, -614.64, -704.15, -697.65, 41.0],
    [-663.14, -660.64, -684.65, -682.65, 37.3], [-627.64, -625.64, -685.15, -682.65, 37.4], [-637.64, -636.64, -701.65, -700.65, 37.4]] },
  '654096:874': { lidarMax: 42.47, deck: 37.9, kinds: ['penthouse', 'plant', 'plant', 'plant', 'plant'], units: [
    [-704.43, -696.43, -791.94, -785.44, 42.4], [-690.43, -683.93, -780.44, -776.44, 40.2], [-754.43, -748.43, -775.44, -772.44, 39.6],
    [-686.93, -683.93, -798.44, -792.44, 38.95], [-692.43, -689.93, -792.94, -788.94, 38.95]] },
};
const PODIUM_654096 = 19.27; // raster P50 inside the City hole

export function buildD29(k: Kit, data: CampusData, ground: (x: number, z: number) => number, stats: Record<string, unknown>) {
  const out: { key: string; probes: WallStats['probes']; features: Feature[]; courts: { key: string; ring: Point[]; floor?: number }[] }[] = [];
  for (const key of D29_KEYS) {
    const b = data.buildings.find(x => x.key === key);
    if (!b) throw new Error(`b13: ${key} missing from the data`);
    const u = UNITS[key], tall = key === '654096:874';
    const rings = b.rings as Point[][];
    const body = makeBody({
      key, ring: rings[0], holes: rings.slice(1), specs: [flat(u.deck)], roofColor: [P('membraneLight')],
      cells: [{ name: 'deck', poly: hull(rings[0]), spec: 0 }], parapet: { h: 1.0, t: 0.3, coping: P('castStone') },
      holeBase: tall ? [PODIUM_654096] : undefined, others: neighbours(data, key, rings[0]),
    }, ground);
    const G = body.grade;
    // Axis of the long street wall (first edge >= 8 m), for plant boxes.
    const ax = axisOf(rings[0]);
    const features: Feature[] = [];
    u.units.forEach(([x0, x1, z0, z1, top], i) => {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2 - 0.25, hz = (z1 - z0) / 2 - 0.25;
      const q = orect(cx, cz, ax, Math.max(0.35, hx), Math.max(0.35, hz)), pent = u.kinds[i] === 'penthouse';
      try {
        const r = roofBox(k, body, q, top, pent ? P('stuccoWhite') : P('metalLight'), pent ? P('membraneGrey') : P('metalLight'));
        if (r) features.push({ key, kind: u.kinds[i], x: r.x, z: r.z, top, lidarMax: u.lidarMax });
      } catch { /* a unit over the parapet / outside the deck is not emitted (counted below) */ }
    });
    const deck = emitParapet(k, body);
    if (tall) k.cap(k.S(), [rings[1]], PODIUM_654096, P('precastGrey')); // podium courtyard deck (measured)
    // Storeys (estimates): 734784 ground 4.1 + 4 x 3.3; 654096 ground 4.4 + 5 x 3.4.
    const g0 = tall ? 4.4 : 4.1, fl = tall ? 3.4 : 3.3, n = tall ? 5 : 4;
    const floors = Array.from({ length: n }, (_, i) => G + g0 + i * fl);
    const base = tall ? P('precastGrey') : P('redBrick'), upper = tall ? P('stuccoBlue') : P('stuccoWhite');
    const plinthTop = tall ? G + g0 + fl : G + g0;
    const ws: WallStats = { segments: 0, windows: 0, bands: 0, pilasters: 0, balconies: 0, infill: 0, party: 0, near: 0, probes: [] };
    const win = (sill: number, head: number, w: number, reveal: typeof base) => ({ sill, head, w, bay: 3.1, recess: 0.18, reveal, pane: P('glass'), sillBox: { h: 0.1, d: 0.06, color: P('castStone') }, lintel: { h: 0.2, d: 0.01, color: P('castStone') } });
    emitWalls(k, body, ground, (s: Seg): SegStyle => {
      const court = s.hole >= 0;
      const rows = [win(G + 1.0, G + (tall ? 3.3 : 3.1), 1.6, base), ...floors.map(f => win(f + 0.9, f + 2.6, 1.3, f + 0.9 < plinthTop ? base : P('trimWhite')))];
      return {
        wall: upper, plinth: { top: plinthTop, color: base },
        // Court walls keep only the thin belt: the court narrows below 1 m at its tips, where a 0.3 m cornice on facing walls
        // would stand in front of the opposite wall.
        bands: court ? [{ y0: plinthTop, y1: plinthTop + 0.25, d: 0.05, color: P('castStone') }] : [{ y0: plinthTop, y1: plinthTop + 0.25, d: 0.08, color: P('castStone'), ext: true }, { y0: s.top - 0.45, y1: s.top, d: 0.3, color: P('castStone'), ext: true }],
        windows: rows,
        balconies: tall && !court ? { every: 3, floors: floors.slice(0, n), depth: 1.4, w: 2.4, slab: P('castStone'), rail: P('metalBlue'), door: P('glassDark') } : undefined,
      };
    }, ws);
    stats[`d29_${key}`] = { key, grade: +G.toFixed(2), base: +body.base.toFixed(2), deck: u.deck, parapetTop: u.deck + 1.0, podium: tall ? PODIUM_654096 : null, floors: floors.map(f => +f.toFixed(2)), units: features.length, unitsDeclared: u.units.length, deckTriangles: deck.deckTriangles, ...ws, probes: ws.probes.length };
    out.push({ key, probes: ws.probes, features, courts: tall ? [{ key, ring: rings[1], floor: PODIUM_654096 }] : [] });
  }
  return out;
}

/** Convex hull of a ring (the single flat cell must contain the whole footprint). */
export function hull(r: Point[]): Point[] {
  const s = [...r].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cr = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Point[] = [], up: Point[] = [];
  for (const p of s) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of s.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const h = [...lo.slice(0, -1), ...up.slice(0, -1)];
  const c = h.reduce((m, p) => [m[0] + p[0] / h.length, m[1] + p[1] / h.length], [0, 0]);
  return h.map(p => { const dx = p[0] - c[0], dz = p[1] - c[1], l = Math.hypot(dx, dz); return [p[0] + dx / l, p[1] + dz / l] as Point; }); // +1 m margin
}
export function axisOf(r: Point[]): [number, number] {
  let best: [number, number] = [1, 0], bl = 0;
  for (let i = 0; i < r.length; i++) { const a = r[i], c = r[(i + 1) % r.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L > bl) { bl = L; best = [(c[0] - a[0]) / L, (c[1] - a[1]) / L]; } }
  return best;
}
