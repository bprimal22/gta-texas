// b04-tower (round 3, D07): the Biological Greenhouse (BOT, GIS/City record 591884:623), a full measured replacement
// of the generated box. Built by the same infill builder as GOL/GEB (one trimesh collider from exactly the rendered
// knee-wall, glass-wall, curved-eave and roof triangles).
//
// MEASURED
//  - plan: the GIS ring below (campus.json 591884, identical to packet D07; L-shaped south range + north block),
//    walls 0.15 m inside it (no authored paving abuts the greenhouse);
//  - heights: USGS 3DEP 2017 LiDAR (public/data/derived/roofs-lidar.json 591884): groundY 15.6, single tier 4.8 m
//    (its ring is the GIS ring within 0.5 m), P95 6.4 m, max 6.7 m, roof pitch 29.4 deg, roofType pitched.
//    The roof's area-weighted median is solved to groundY + tier (as GOL/GEB), the ridge is capped at groundY + max.
// REFERENCE-INTERPRETED (UT directory photograph ut-bot-577, facade direction not verified):
//  - white-painted masonry knee wall (~1.1 m), glass walls on slender white bars (~0.6 m module), a curved glass
//    eave turning into the pitched glass roof, glazing bars on the roof facets.
// NOT MODELLED (unverified): the glazed entrance gable, its door and the steps in the photograph. No mapped footway
//  ends at the ring (nearest path vertex > 6 m, packet D07 paths), so the door side cannot be placed from evidence;
//  the red-tile shed in the photograph is not part of this record. Hipped glass ends stand in for the real gable ends.
import type { Point } from '../../types';
import type { InfillSpec } from './historic-infill';

export const BOT_LIDAR = { groundY: 15.6, tier: 4.8, p50: 4.9, p95: 6.4, max: 6.7, pitchDeg: 29.4 } as const;
/** GIS ring 591884 (source order, closing duplicate dropped). */
export const BOT_RING: Point[] = [[-268.81, -101.74], [-268.09, -111.23], [-279.23, -112.08], [-281.11, -87.39], [-279.82, -87.29], [-279.96, -85.43],
  [-282.39, -85.61], [-282.98, -77.89], [-272.66, -77.1], [-272.06, -84.87], [-277.13, -85.26], [-277.0, -87.06], [-275.52, -86.95], [-274.36, -102.17]];
export const BOT_INSET = 0.15;
/** Curved eave radius and glazing-bar module (reference-interpreted). */
export const BOT_EAVE_R = 0.7, BOT_BAR = 0.62;

export const BOT_MATERIALS = {
  glazing: 'b04 BOT greenhouse glazing',
  knee: 'b04 BOT white painted knee wall',
  steel: 'b04 BOT white painted glazing bars',
} as const;

export const BOT_SPEC: InfillSpec = {
  id: 591884, abbr: 'BOT', name: 'Biological Greenhouse', plinthHeight: 1.1,
  materials: { wall: BOT_MATERIALS.glazing, roof: BOT_MATERIALS.glazing, glass: BOT_MATERIALS.glazing, plinth: BOT_MATERIALS.knee,
    trim: BOT_MATERIALS.steel, frame: BOT_MATERIALS.steel, door: BOT_MATERIALS.steel, bars: BOT_MATERIALS.steel },
  volumes: [{
    rings: [BOT_RING], roof: 'hip', slope: Math.tan(BOT_LIDAR.pitchDeg * Math.PI / 180),
    roofMedian: BOT_LIDAR.groundY + BOT_LIDAR.tier, ridgeMax: BOT_LIDAR.groundY + BOT_LIDAR.max,
    inset: BOT_INSET, eaveCurve: BOT_EAVE_R, glazingBars: BOT_BAR,
  }],
};
