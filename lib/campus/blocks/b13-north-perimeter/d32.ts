// D32 / b13: two stuccoed houses with red clay-tile hips in the NE neighbourhood (City 614187:743, 569864:510).
// Evidence (research/whole-campus-92/district-agents-40/packets/D32.json; d32-orbit-northwest is the only usable frame,
// projections of the frozen rings into it and 0.5 m raster sections in the street frame axis (9.16, -15.86), work in
// .work/derived-b13):
//  * 614187:743 - NW part a red-tile hip (raster eave ~9.0, ridge 11.4-11.6, slope ~0.52) with a brick chimney (raster
//    13.3); SE part a flat deck at 10.8 (raster P50 10.81). The NW frame shows the long dark low porch roof along its NW
//    face: the raster has that roof at 7.40-7.50 m for A 807-816, B 174.0-175.5, i.e. OUTSIDE the City ring (B >= 177.24)
//    but inside the owner's 3 m clearance; it is modelled as a slab on posts (post positions are estimates, its full
//    length west of A 807 / east of A 816 is hidden by canopy and not extended);
//  * 569864:510 - main two-storey hip (raster eave ~8.2, ridge ~11.0, slope 0.55), east wing hip (eave 8.1, ridge 10.0),
//    one-storey flat wings on its NW side at 5.85 / 6.25 (raster P50 5.8 / 6.2) and a small flat bump at 7.8;
//  * walls: cream stucco with white-framed recessed sash windows, stucco sills, deep eave boxes under the tile hips
//    (frame). Only the NW faces are source-visible; the other facades repeat that rhythm as ESTIMATES, not observations.
//    Walls closer than 3 m to the other house carry no low relief (party / near rule in engine.ts).
import type { Point, CampusData } from '../../types';
import type { Kit } from './kit';
import { at, edgesOf } from './kit';
import { P } from './materials';
import { flat, hip, frame, fbox, toXZ, makeBody, emitRoofs, emitSteps, emitWalls, roofBox, neighbours, inConvexPoly, type Seg, type SegStyle, type WallStats, type Feature } from './engine';

export const D32_KEYS = ['614187:743', '569864:510'] as const;
const F = frame(9.16, -15.86);
const newStats = (): WallStats => ({ segments: 0, windows: 0, bands: 0, pilasters: 0, balconies: 0, infill: 0, party: 0, near: 0, probes: [] });

export function buildD32(k: Kit, data: CampusData, ground: (x: number, z: number) => number, stats: Record<string, unknown>) {
  const out: { key: string; probes: WallStats['probes']; features: Feature[]; courts: { key: string; ring: Point[] }[] }[] = [];
  // Window rows per house (absolute sill / head above grade, estimates fitted under the measured eaves): 614187 has 5.6 m
  // to its NW eave (two storeys); 569864's main eave is only 4.1 m above grade, so its upper row is a short attic row.
  const style = (G: number, tileCells: string[], names: string[], rows: [number, number][] = [[0.9, 2.6], [3.3, 5.0]]) => (s: Seg): SegStyle => {
    const tile = tileCells.includes(names[s.cell]);
    const win = (sill: number, w: number) => ({ sill: G + sill, head: G + sill + 1.7, w, bay: 3.0, recess: 0.16, reveal: P('trimWhite'), pane: P('glass'), sillBox: { h: 0.1, d: 0.07, color: P('stuccoWarm') }, lintel: { h: 0.16, d: 0.01, color: P('trimWhite') } });
    return {
      wall: P('stuccoCream'), plinth: { top: G + 0.5, color: P('stuccoWarm') },
      bands: [tile ? { y0: s.top - 0.3, y1: s.top, d: 0.55, color: P('stuccoWarm'), ext: true } : { y0: s.top - 0.28, y1: s.top, d: 0.12, color: P('castStone'), ext: true }],
      windows: rows.map(([a, h]) => ({ ...win(a, 1.0), head: G + h })),
    };
  };
  // ---- 614187:743
  {
    const key = '614187:743', b = data.buildings.find(x => x.key === key);
    if (!b) throw new Error(`b13: ${key} missing from the data`);
    const ring = b.rings[0] as Point[];
    const specs = [hip(fbox(F, 793.93, 805.37, 175.88, 185.2), 9.0, 0.52, 11.5), flat(10.8)];
    const names = ['nw', 'se'], cells = [{ name: 'nw', poly: fbox(F, 780, 805.86, 160, 200), spec: 0 }, { name: 'se', poly: fbox(F, 805.86, 840, 160, 200), spec: 1 }];
    const others = neighbours(data, key, ring);
    const body = makeBody({ key, ring, specs, roofColor: [P('tileRed'), P('membraneGrey')], cells, others }, ground);
    const features: Feature[] = [];
    const ch = roofBox(k, body, fbox(F, 800.0, 801.4, 179.0, 180.2), 13.3, P('redBrick'), P('castStone'));
    if (ch) features.push({ key, kind: 'chimney', x: ch.x, z: ch.z, top: 13.3, lidarMax: 14.57 });
    const roof = emitRoofs(k, body), steps = emitSteps(k, body, P('stuccoCream'));
    const G = body.grade, ws = newStats();
    // NW porch (raster 7.40-7.50, A 807-816, B 174.0-175.5): slab B [174.3, 177.2] (within 3 m of the ring), posts. The
    // house wall behind it is kept plain over the porch length (openings behind the porch are not visible: estimate).
    const slab = fbox(F, 806.9, 816.4, 174.3, 177.2);
    const behind = edgesOf(body.outer).findIndex(e => e.n.x * F.v[0] + e.n.z * F.v[1] < -0.99 && Math.abs((e.a[0] * F.v[0] + e.a[1] * F.v[1]) - 177.24) < 0.05);
    if (behind < 0) throw new Error(`b13: ${key} NW wall behind the porch not found`);
    { const e = edgesOf(body.outer)[behind], sOf = (A: number) => { const p = toXZ(F, A, 177.24); return (p[0] - e.a[0]) * e.u.x + (p[1] - e.a[1]) * e.u.z; }, [x0, x1] = [sOf(806.9), sOf(816.4)].sort((p, q) => p - q);
      body.exclusions.push({ edge: behind, hole: -1, s0: x0 - 0.3, s1: x1 + 0.3, keepBands: true }); }
    emitWalls(k, body, ground, style(G, ['nw'], names), ws);
    if (slab.some(p => others.some(o => inPoly(p, o)))) throw new Error(`b13: ${key} porch overlaps another footprint`);
    const pe = edgesOf(slab).find(e => Math.abs(e.n.x * F.v[0] + e.n.z * F.v[1] + 1) < 1e-6)!; // the edge facing -B (NW)
    const sb = k.S();
    k.box(sb, pe, 0, pe.L, 7.18, 7.45, -2.9, 0, P('metalPorch'), true); // slab: front at the NW edge, back at the house wall
    let posts = 0;
    for (const sPos of [0.25, pe.L / 3, (2 * pe.L) / 3, pe.L - 0.25]) {
      k.box(sb, pe, sPos - 0.14, sPos + 0.14, body.base, 7.18, -0.3, -0.02, P('trimWhite'), true, { top: false, bottom: false }); posts++;
    }
    const pc = toXZ(F, 811.6, 175.6);
    features.push({ key, kind: 'porch roof', x: pc[0], z: pc[1], top: 7.45, lidarMax: 14.57 });
    stats[`d32_${key}`] = { key, grade: +G.toFixed(2), sections: { nwHip: [9.0, 11.5, 0.52], seFlat: 10.8 }, porch: { roof: 7.45, posts, A: [806.9, 816.4], B: [174.3, 177.2] }, roofPlanes: roof.planes, stepFaces: steps, ...ws, probes: ws.probes.length };
    out.push({ key, probes: ws.probes, features, courts: [] });
  }
  // ---- 569864:510
  {
    const key = '569864:510', b = data.buildings.find(x => x.key === key);
    if (!b) throw new Error(`b13: ${key} missing from the data`);
    const ring = b.rings[0] as Point[];
    const specs = [flat(5.85), flat(6.25), hip(fbox(F, 804.5, 826.4, 194.0, 205.6), 8.2, 0.55, 11.0), hip(fbox(F, 819.97, 826.4, 205.6, 219.8), 8.1, 0.6, 10.0), flat(7.8)];
    const names = ['wing1', 'wing2', 'main1', 'main2', 'east', 'bump'];
    const cells = [
      { name: 'wing1', poly: fbox(F, 780, 797.55, 170, 230), spec: 0 },
      { name: 'wing2', poly: fbox(F, 797.55, 804.5, 170, 230), spec: 1 },
      { name: 'main1', poly: fbox(F, 804.5, 819.97, 170, 230), spec: 2 },
      { name: 'main2', poly: fbox(F, 819.97, 840, 170, 205.6), spec: 2 },
      { name: 'east', poly: fbox(F, 819.97, 826.4, 205.6, 230), spec: 3 },
      { name: 'bump', poly: fbox(F, 826.4, 840, 205.6, 230), spec: 4 },
    ];
    const body = makeBody({ key, ring, specs, roofColor: [P('metalPorch'), P('membraneGrey'), P('tileRed'), P('tileRed'), P('membraneGrey')], cells, others: neighbours(data, key, ring) }, ground);
    const roof = emitRoofs(k, body), steps = emitSteps(k, body, P('stuccoCream'));
    const G = body.grade, ws = newStats();
    emitWalls(k, body, ground, style(G, ['main1', 'main2', 'east'], names, [[0.8, 2.3], [2.7, 3.8]]), ws);
    stats[`d32_${key}`] = { key, grade: +G.toFixed(2), sections: { wings: [5.85, 6.25], main: [8.2, 11.0, 0.55], east: [8.1, 10.0, 0.6], bump: 7.8 }, roofPlanes: roof.planes, stepFaces: steps, ...ws, probes: ws.probes.length };
    out.push({ key, probes: ws.probes, features: [], courts: [] });
  }
  return out;
}
const inPoly = (p: Point, r: Point[]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > p[1]) !== (zj > p[1]) && p[0] < (xj - xi) * (p[1] - zi) / (zj - zi) + xi) c = !c; } return c; };
void at; void inConvexPoly;
