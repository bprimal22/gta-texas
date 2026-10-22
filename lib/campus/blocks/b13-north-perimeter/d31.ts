// D31 / b13: two Speedway-area records whose identity the archetypes miss (City 717036:1152, 529398:335).
// Evidence (research/whole-campus-92/district-agents-40/packets/D31.json; projections of the frozen rings into
// d31-orbit-{northeast,northwest,southeast}, work in .work/derived-b13):
//  * 717036:1152 - two-storey courtyard apartments (NE / NW frames: flat tan roof with a dark overhanging fascia around
//    the outside and around the open court, white stucco walls, punched windows). Plan: the FROZEN City ring with its
//    courtyard hole. The hole is MEASURED open: only 2 % of the 2017 class-6 raster cells inside it return a building
//    and DSM - DTM is 0.03 m there (open ground with a tree in the frames), so the court stays open to the ground.
//    Deck = frozen massing 4.4 + 10.5 = 14.9 (raster P50 14.93); one small unit at the raster cluster (top 15.96);
//  * 529398:335 - two-storey red-tile house (NE / SE frames: red clay-tile hips, cream stucco, white flat roof strip on
//    the east). Raster sections in the street frame (axis (9.74, -16.09)): main hip eave 24.4 / ridge 27.9 (P10 24.47,
//    P95 27.94; cross-section slope ~0.52), a shed strip falling east 24.6 -> 23.5 (drawn 24.4 -> 23.3, flush with the main eave), a flat strip at 20.2 (P50 20.17) and
//    the south annex flat at 23.5 (P50 23.53). The 33.0 raster max is a single edge cell (tree), not modelled.
//  * Storey heights, window bays and the fascia / eave depths are ESTIMATES; hidden faces repeat the visible rhythm.
import type { Point, CampusData } from '../../types';
import type { Kit } from './kit';
import { P } from './materials';
import { flat, hip, shed, frame, fbox, makeBody, emitRoofs, emitSteps, emitWalls, roofBox, orect, neighbours, type Seg, type SegStyle, type WallStats, type Feature } from './engine';
import { hull, axisOf } from './d29';

export const D31_KEYS = ['717036:1152', '529398:335'] as const;
const newStats = (): WallStats => ({ segments: 0, windows: 0, bands: 0, pilasters: 0, balconies: 0, infill: 0, party: 0, near: 0, probes: [] });

export function buildD31(k: Kit, data: CampusData, ground: (x: number, z: number) => number, stats: Record<string, unknown>) {
  const out: { key: string; probes: WallStats['probes']; features: Feature[]; courts: { key: string; ring: Point[]; floor?: number }[] }[] = [];
  // ---- 717036:1152 courtyard apartments
  {
    const key = '717036:1152', b = data.buildings.find(x => x.key === key);
    if (!b) throw new Error(`b13: ${key} missing from the data`);
    const rings = b.rings as Point[][];
    if (rings.length < 2) throw new Error(`b13: ${key} lost its measured courtyard hole`);
    const deck = 14.9;
    const body = makeBody({ key, ring: rings[0], holes: rings.slice(1), specs: [flat(deck)], roofColor: [P('membraneTan')], cells: [{ name: 'deck', poly: hull(rings[0]), spec: 0 }], others: neighbours(data, key, rings[0]) }, ground);
    const features: Feature[] = [];
    const unit = roofBox(k, body, orect(354.27, -831.76, axisOf(rings[0]), 0.5, 0.5), 15.9, P('metalLight'), P('metalLight'));
    if (unit) features.push({ key, kind: 'plant', x: unit.x, z: unit.z, top: 15.9, lidarMax: 15.96 });
    const roof = emitRoofs(k, body);
    const G = body.grade, ws = newStats();
    const win = (sill: number) => ({ sill: G + sill, head: G + sill + 1.7, w: 1.4, bay: 3.6, recess: 0.16, reveal: P('stuccoWhite'), pane: P('glass'), sillBox: { h: 0.1, d: 0.06, color: P('stuccoWarm') } });
    emitWalls(k, body, ground, (s: Seg): SegStyle => ({
      wall: P('stuccoWhite'),
      // Overhanging flat-roof fascia (frames: dark band proud of the walls, outside and round the court).
      bands: [{ y0: deck - 0.55, y1: deck + 0.12, d: s.hole >= 0 ? 0.45 : 0.6, color: P('fasciaBrown'), ext: true }],
      windows: [win(0.9), win(4.6)],
    }), ws);
    stats[`d31_${key}`] = { key, grade: +G.toFixed(2), deck, courtyardOpen: true, roofTriangles: roof.triangles, ...ws, probes: ws.probes.length };
    out.push({ key, probes: ws.probes, features, courts: [{ key, ring: rings[1] }] });
  }
  // ---- 529398:335 red-tile house
  {
    const key = '529398:335', b = data.buildings.find(x => x.key === key);
    if (!b) throw new Error(`b13: ${key} missing from the data`);
    const F = frame(9.74, -16.09), ring = b.rings[0] as Point[];
    const specs = [
      hip(fbox(F, 874.07, 905.91, -38.5, -25.86), 24.4, 0.52, 27.9),
      shed(F, -25.86, 24.4, -0.285), // raster 24.6 -> 23.5; started at the main eave so the hip and shed meet without a step
      flat(20.2), flat(23.5),
    ];
    const cells = [
      { name: 'main', poly: fbox(F, 860, 920, -50, -25.86), spec: 0 },
      { name: 'shed', poly: fbox(F, 860, 893.8, -25.86, -22.0), spec: 1 },
      { name: 'flat', poly: fbox(F, 860, 893.8, -22.0, -5), spec: 2 },
      { name: 'annex', poly: fbox(F, 893.8, 920, -25.86, -5), spec: 3 },
    ];
    const body = makeBody({ key, ring, specs, roofColor: [P('tileRed'), P('tileRed'), P('membraneLight'), P('membraneLight')], cells, others: neighbours(data, key, ring) }, ground);
    const roof = emitRoofs(k, body), steps = emitSteps(k, body, P('stuccoCream'));
    const G = body.grade, ws = newStats();
    const win = (sill: number, w: number) => ({ sill: G + sill, head: G + sill + 1.8, w, bay: 3.2, recess: 0.18, reveal: P('trimWhite'), pane: P('glass'), sillBox: { h: 0.1, d: 0.06, color: P('stuccoWarm') }, lintel: { h: 0.18, d: 0.01, color: P('stuccoWarm') } });
    emitWalls(k, body, ground, (s: Seg): SegStyle => {
      const tile = body.cells[s.cell].name === 'main' || body.cells[s.cell].name === 'shed';
      return {
        wall: P('stuccoCream'), plinth: { top: G + 0.6, color: P('stuccoWarm') },
        // Tile hips: a deep eave box under the roof edge; flat parts: a thin coping band.
        bands: [tile ? { y0: s.top - 0.32, y1: s.top, d: 0.5, color: P('stuccoWarm'), ext: true } : { y0: s.top - 0.3, y1: s.top, d: 0.12, color: P('castStone'), ext: true }],
        windows: [win(1.0, 1.2), win(4.4, 1.1)],
      };
    }, ws);
    stats[`d31_${key}`] = { key, grade: +G.toFixed(2), sections: { main: [24.4, 27.9, 0.52], shed: [24.4, 23.3], flat: 20.2, annex: 23.5 }, roofPlanes: roof.planes, stepFaces: steps, ...ws, probes: ws.probes.length };
    out.push({ key, probes: ws.probes, features: [], courts: [] });
  }
  return out;
}
