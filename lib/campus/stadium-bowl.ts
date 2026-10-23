import * as THREE from 'three';
import type { Building, Point } from './types';
import type { CoverageGrid } from './context-coverage';
import { MeshBuilder, ColliderBuilder, cleanRing, pointInRing } from './context-geometry';
import { BELLMONT_NORTH, inBellmontNorth, bellmontNorthUv } from './stadium-bellmont-north';

/** Darrell K Royal–Texas Memorial Stadium bowl, generated from the packaged
 * stadium footprints (North End Zone horseshoe 655373 and South End Zone
 * 504014). The field opening was measured from the horseshoe's inner edge.
 * Each side has its own section (STAND_PROFILES: east, north, west fallback, the 2021 SEZ centre and its open corner
 * stands), blended through the north corners; plus the SEZ longhorn club terraces, flank towers, west light gantry,
 * east rim poles and brick piers. Evidence per value: tools/scans/stadium-references.json + stadium-reference-notes.md;
 * row counts, level heights and detail spacing are estimates. The outer wall steps back wherever authored DKR
 * frontage already exists. */

export type StadiumMaterialKey = 'stadiumSeat' | 'stadiumClubSeat' | 'stadiumTerraceFascia' | 'stadiumSezSouth' | 'stadiumRiser' | 'stadiumFacade' | 'stadiumFacadePale' | 'stadiumFacadeBellmontNorth' | 'stadiumField' | 'stadiumSuite' | 'stadiumSezTower' | 'stadiumBrick' | 'trim';

/** Outer-wall texture repeat [metres along the wall, metres up] per facade key (authored, reference-guided;
 * context-textures.ts): buff = 9 m brick pier + recessed bay (north end / east side), pale = the 9.5 m Bellmont bay,
 * SEZ = 9 m brick pier + balcony/club levels (2021 South End Zone exterior); 12.5 m per band.
 * V is measured from the field plane, so the bands stay level all the way round the bowl. */
export const STADIUM_FACADE_TILE = { stadiumFacade: [9, 12.5], stadiumFacadePale: [9.5, 12.5], stadiumSezSouth: [9, 12.5] } as const;

/** Outer-wall treatment by side (field frame: +u east, +v south). North end and east side: warm buff brick with cream
 * cast-stone bands and dark recessed bays (ref-ut-dji0226 / ref-ut-pano0001); west side (Bellmont): pale concrete;
 * 2021 south end: brick piers framing balcony and club glazing levels (ref-commons-ajay-2025). Corners split at 45
 * degrees. The Bellmont north stretch (stadium-bellmont-north.ts) overrides this with its own ribbon material. */
export function stadiumFacadeKey(nu: number, nv: number): keyof typeof STADIUM_FACADE_TILE {
  return nv > Math.abs(nu) ? 'stadiumSezSouth' : -nu > Math.abs(nv) ? 'stadiumFacadePale' : 'stadiumFacade';
}

export const STADIUM_FIELD = {
  center: [444.3, 272.5] as Point,
  /** Long axis (south) direction; the opening narrows ~3.9° west going south. */
  angle: Math.atan2(-0.068, 1),
  halfWidth: 35.5,
  halfLength: 63,
  cornerRadius: 10,
};

/** Painted-markings frame for the generated turf texture. Measured from the aligned DKR
 * photogrammetry field (tools/scans/build-stadium.mjs: yard-line comb + footprint registration,
 * ±~1.5 m / ±~1° estimated), so the generated yard lines continue the scanned field decal
 * (public/assets/scans/dkr-field.glb) across its south 20-yard-line seam. Only turf UVs use it. */
export const STADIUM_MARKINGS = {
  center: [444.8, 273.0] as Point,
  /** Long axis toward the south: x changes -0.1164 per +1 z (−6.64°). */
  angle: Math.atan2(-0.1164, 1),
};

/** A stand sector replaced by aligned photogrammetry (lib/campus/scan-landmarks.ts). Heights are
 * metres above the field plane, sampled from the shipped scan collider surface; the bowl omits
 * its rows there and closes the sector with seam walls, a front collider strip and an outer wall. */
export interface StadiumScanSector {
  side: 'west';
  /** Field-frame v range (along the field, + south) of the replaced west straight. */
  vMin: number; vMax: number;
  /** Outward step (m) of the seam profiles. */
  step: number;
  /** Scanned surface height at t = k*step on v = vMin / v = vMax (null outside the crop). */
  seamMin: (number | null)[]; seamMax: (number | null)[];
  /** [v, height at the front edge t = 0]. */
  front: [number, number][];
  /** [v, outward depth t of the clean rim line (scan trimmed beyond it), rim height]. The bowl
   * closes the sector from the rim to its outer wall with an authored parapet + roof cap. */
  outer: [number, number, number][];
  /** Authored press-box massing fitted to the surviving scanned slab extents (field frame). */
  pressBox?: { vMin: number; vMax: number; t0: number; t1: number; top: number } | null;
  /** Rim parapet height above the cap (m). */
  parapet?: number;
}
export interface StadiumBowlOptions {
  scanSector?: StadiumScanSector | null;
  /** Called with the field height before any west rows are dropped (e.g. to create the scan's
   * colliders). The sector is replaced only if this returns without throwing; otherwise the full
   * generated bowl is built and the failure is reported in stats.scanSectorError. */
  commitScan?: (fieldY: number) => void;
}

interface Sample { x: number; z: number; nx: number; nz: number; s: number; u: number; v: number; nu: number; nv: number }

function perimeter(): Sample[] {
  const { center: [cx, cz], angle, halfWidth: hw, halfLength: hl, cornerRadius: r } = STADIUM_FIELD;
  // Long axis L = (sin a, cos a) in (x, z); width axis W = (cos a, -sin a).
  const L = [Math.sin(angle), Math.cos(angle)], W = [Math.cos(angle), -Math.sin(angle)];
  const local: { u: number; v: number; nu: number; nv: number }[] = [];
  const corners = [[hw - r, hl - r, 0], [-(hw - r), hl - r, 90], [-(hw - r), -(hl - r), 180], [hw - r, -(hl - r), 270]];
  for (let c = 0; c < 4; c++) {
    const [ou, ov, start] = corners[c];
    for (let d = 0; d < 90; d += 10) {
      const t = ((start + d) * Math.PI) / 180;
      local.push({ u: ou + r * Math.cos(t), v: ov + r * Math.sin(t), nu: Math.cos(t), nv: Math.sin(t) });
    }
    const [nu0, nv0] = [Math.cos(((start + 90) * Math.PI) / 180), Math.sin(((start + 90) * Math.PI) / 180)];
    const [nx, nz] = corners[(c + 1) % 4];
    const fromU = ou + r * nu0, fromV = ov + r * nv0, toU = nx + r * nu0, toV = nz + r * nv0;
    // The south straight is sampled at 1.5 m so the SEZ longhorn terrace outline (sezClub) resolves.
    const n = Math.max(1, Math.round(Math.hypot(toU - fromU, toV - fromV) / (c === 0 ? 1.5 : 3)));
    for (let k = 0; k < n; k++) local.push({ u: fromU + ((toU - fromU) * k) / n, v: fromV + ((toV - fromV) * k) / n, nu: nu0, nv: nv0 });
  }
  let s = 0;
  return local.map((p, i) => {
    if (i) s += Math.hypot(p.u - local[i - 1].u, p.v - local[i - 1].v);
    return {
      x: cx + p.u * W[0] + p.v * L[0], z: cz + p.u * W[1] + p.v * L[1],
      nx: p.nu * W[0] + p.nv * L[0], nz: p.nu * W[1] + p.nv * L[1], s, u: p.u, v: p.v, nu: p.nu, nv: p.nv,
    };
  });
}

/** One seating tier: `rows` treads of `depth` m, each rising `rise` m. */
interface Tier { rows: number; depth: number; rise: number }
/** Section of one side, outward distance t from the field-plate edge, heights above the field plane.
 * front wall, lower tier, aisle, fascia, soffit back toward the field (upper-deck overhang), lip,
 * middle tier, aisle2, fascia2, soffit2, lip2, upper tier, flat roof run; then clamped to `cap`
 * and to the footprint reach. Every side uses the same template (unused rows collapse to zero size),
 * so corner sections loft point-by-point between the two adjacent sides. */
export interface StandProfile {
  front: number; lower: Tier; aisle: number; fascia: number; overhang: number; lip: number;
  middle: Tier; aisle2: number; fascia2: number; overhang2: number; lip2: number;
  upper: Tier; roof: number; cap: number; parapet: number;
  /** Concourse-building roof (m above the field) between the upper-deck rim and the footprint edge, or null (outer wall
   * at the rim). North/east: 2017 LiDAR median roof of the NEZ / STD rings (Y 30.79 / 31.28). */
  outerRoof: number | null;
  /** Open stand: no outer wall; the rear is the exposed raked underside down to grade. */
  open?: boolean;
}
const MAX_ROWS = { lower: 48, middle: 16, upper: 42 };
const NONE: Tier = { rows: 0, depth: 0, rise: 0 };
/** Per-side sections (tools/scans/stadium-references.json for every evidence id; values without a
 * measurement are labelled estimates). Rakes: first rows measured in the raw MIT capture
 * (tools/scans/stadium-rakes.mjs; the capture only reaches the front rows of the east/north stands) — east 0.23-0.30 m
 * rise per m (t 2-11 m) from a ~1.8 m wall, north 0.27-0.32 (t 2-8.5 m) behind a 2.3 m wall, west 0.30 steepening to
 * 0.45, 2021 south end 0.51; the generated rows keep those slopes over the full tier (extrapolated).
 * Rims: 2017 USGS 3DEP LiDAR (b09 shared request 1): east 43.0 m, north 40.5 m above the field. Tier layout: official
 * 2025 seating map (lower bowls, east suites 841-870 + 945-971 under a narrow upper deck 124-132,
 * north middle deck 9-23 + north upper deck 111-124, south end zone 36R-44) and the official 2022
 * aerials / field-level photos (ref-ut-dji0226, ref-ut-pano0009, ref-ut-dkr2). */
export const STAND_PROFILES: Record<'east' | 'north' | 'west' | 'south' | 'southSide', StandProfile> = {
  // East: one deep measured-slope lower rake, a two-level suite fascia (estimate 8.6 m) hidden under
  // a 3.5 m upper-deck overhang (estimate), narrow steep upper deck to the LiDAR rim.
  east: { front: 1.8, lower: { rows: 46, depth: 0.85, rise: 0.27 }, aisle: 2.5, fascia: 8.6, overhang: 3.5, lip: 1.4,
    middle: NONE, aisle2: 0, fascia2: 0, overhang2: 0, lip2: 0, upper: { rows: 34, depth: 0.85, rise: 0.52 }, roof: 0, cap: 43.0, parapet: 1.2, outerRoof: 34.2 },
  // North (2007-08 north end zone): lower bowl, club front, middle deck (red club seats), suite
  // glazing band under a 3 m overhang, upper deck to the LiDAR rim. Row counts/heights: estimates.
  north: { front: 2.3, lower: { rows: 30, depth: 0.85, rise: 0.24 }, aisle: 2.0, fascia: 3.0, overhang: 0, lip: 0,
    middle: { rows: 14, depth: 0.85, rise: 0.42 }, aisle2: 1.5, fascia2: 5.5, overhang2: 3.0, lip2: 1.2,
    upper: { rows: 30, depth: 0.85, rise: 0.52 }, roof: 0, cap: 40.5, parapet: 1.2, outerRoof: 33.7 },
  // West (the DEFAULT west stand since the partial capture became a ?stadiumscan=1 diagnostic): measured scan section —
  // lower bowl 1.74 -> 15.8 m over 40 m, upper-deck front at 28 m by t 42, upper deck ~0.6 m/m; overhang estimated.
  // The bounded west-straight closure below meets Bellmont without changing the adjoining corner profiles.
  west: { front: 1.74, lower: { rows: 47, depth: 0.85, rise: 0.3 }, aisle: 0.5, fascia: 11.8, overhang: 2.0, lip: 0.6,
    middle: NONE, aisle2: 0, fascia2: 0, overhang2: 0, lip2: 0, upper: { rows: 42, depth: 0.85, rise: 0.52 }, roof: 0, cap: 50, parapet: 1.2, outerRoof: null },
  // 2021 South End Zone, central (board) part of the south straight: steep measured lower terraces (0.51 m/m) with the
  // longhorn club rows, the loge-box level, three stepped loge-box rows, then ONE club level (Myers-Dodds Legacy Club) under
  // the board and the low premium-building roof back to the measured south wall (ref-ut-dkr2, ref-ut-pano0009; the board
  // stands on that roof). Level heights: estimates.
  south: { front: 1.2, lower: { rows: 18, depth: 0.85, rise: 0.43 }, aisle: 2.0, fascia: 4.0, overhang: 0, lip: 0,
    middle: { rows: 3, depth: 2.4, rise: 1.1 }, aisle2: 1.0, fascia2: 4.6, overhang2: 0, lip2: 0,
    upper: NONE, roof: 60, cap: 0, parapet: 0.6, outerRoof: null },
  // 2021 SEZ corner stands either side of the flank towers: open stepped seating wrapping into the east/west lower bowls,
  // no building behind (ref-ut-pano0009, ref-ut-dji0226); 30 rows (estimate) on the measured SEZ rake, open raked underside.
  southSide: { front: 1.2, lower: { rows: 30, depth: 0.85, rise: 0.45 }, aisle: 1.2, fascia: 0, overhang: 0, lip: 0,
    middle: NONE, aisle2: 0, fascia2: 0, overhang2: 0, lip2: 0, upper: NONE, roof: 0, cap: 16.0, parapet: 1.1, outerRoof: null, open: true },
};
// The central SEZ roof is the top of its club level, so the roof run is not clipped.
{ const p = STAND_PROFILES.south; p.cap = p.front + p.lower.rows * p.lower.rise + p.fascia + p.middle.rows * p.middle.rise + p.fascia2; }
/** Field-relative datum of the 2021 SEZ face: the building face (fascia2) stands at this outward
 * distance from the south plate edge; the videoboard (b09 exterior) is mounted on it. */
export const SEZ_FACE = (() => {
  const p = STAND_PROFILES.south;
  const t = p.lower.rows * p.lower.depth + p.aisle + p.middle.rows * p.middle.depth + p.aisle2;
  const terraceY = p.front + p.lower.rows * p.lower.rise + p.fascia + p.middle.rows * p.middle.rise;
  return { t, terraceY, roofY: p.cap };
})();

/** 2021 SEZ longhorn ("steer-head") terraces: the lower SEZ seating rows [a, b) (row 0 = front) that are dark club seats
 * inside the burnt-orange outline, as a function of the field-frame u across the south straight. Shape read from the
 * official 2022 aerials (ref-ut-pano0009, ref-ut-dji0226) and the 2025 seating map (field club 37B-40B / 37C-40C inside
 * the head, loge-club horns 36R-41R): the head reaches the field at the central tunnel, the horns run across the back
 * rows and their tips turn back toward the SEZ building. Row extents are estimates fitted to those images. */
export function sezClub(u: number): [number, number] | null {
  const x = Math.abs(u);
  if (x <= 3) return [2, 16];
  if (x <= 7) return [Math.round(2 + (x - 3) * 2), 16];
  if (x <= 20) return [10, 15];
  if (x <= 25) return [Math.round(10 + (x - 20)), Math.round(15 + (x - 20) * 0.6)];
  return null;
}

type SegmentKind = 'front' | 'tread' | 'riser' | 'aisle' | 'fascia' | 'soffit' | 'lip' | 'roof' | 'back' | 'outer';
/** Profile points for one side plus the (side-independent) kind of the segment ending at each point. */
function profilePoints(p: StandProfile) {
  const pts: [number, number][] = [[0, 0]], kinds: SegmentKind[] = ['front'];
  let t = 0, y = 0;
  const push = (k: SegmentKind) => { pts.push([t, y]); kinds.push(k); };
  y = p.front; push('front');
  const tier = (T: Tier, max: number) => {
    for (let k = 0; k < max; k++) {
      if (k < T.rows) t += T.depth; push('tread');
      if (k < T.rows) y += T.rise; push('riser');
    }
  };
  tier(p.lower, MAX_ROWS.lower);
  t += p.aisle; push('aisle'); y += p.fascia; push('fascia'); t -= p.overhang; push('soffit'); y += p.lip; push('lip');
  tier(p.middle, MAX_ROWS.middle);
  t += p.aisle2; push('aisle'); y += p.fascia2; push('fascia'); t -= p.overhang2; push('soffit'); y += p.lip2; push('lip');
  tier(p.upper, MAX_ROWS.upper);
  t += p.roof; push('roof');
  // Back wall down to the concourse roof and the roof run to the footprint edge (resolved per sample in section()).
  push('back'); push('outer');
  return { pts, kinds };
}
const PROFILE_POINTS = Object.fromEntries(Object.entries(STAND_PROFILES).map(([k, p]) => [k, profilePoints(p)])) as Record<keyof typeof STAND_PROFILES, ReturnType<typeof profilePoints>>;
const SEGMENT_KINDS = PROFILE_POINTS.east.kinds;
/** Index of the 'back' point: the point before it is the upper-deck rim. */
const BACK_K = SEGMENT_KINDS.indexOf('back');

/** Side weights for a sample normal (field frame). Straights take their side (the south straight is the central SEZ);
 * the north corners blend linearly across the 90 degrees; the south corners become the open SEZ corner stands after the
 * first 20 degrees (the east/west upper decks end at the SEZ in ref-ut-dji0226 / ref-ut-pano0009). */
function sideBlend(nu: number, nv: number): [keyof typeof STAND_PROFILES, keyof typeof STAND_PROFILES, number] {
  const deg = ((Math.atan2(nv, nu) * 180) / Math.PI + 360) % 360; // 0 east, 90 south, 180 west, 270 north
  const ramp = (a: number) => Math.min(1, Math.max(0, a / 20));
  if (deg < 1e-6 || deg > 359.999) return ['east', 'east', 0];
  if (Math.abs(deg - 90) < 1e-6) return ['south', 'south', 0];
  if (deg < 90) return ['east', 'southSide', ramp(deg)];
  if (deg <= 180) return ['west', 'southSide', ramp(180 - deg)];
  if (deg <= 270) return ['west', 'north', (deg - 180) / 90];
  return ['north', 'east', (deg - 270) / 90];
}

export function buildStadiumBowl(footprints: Building[], ground: (x: number, z: number) => number, grid?: CoverageGrid, options: StadiumBowlOptions = {}) {
  const rings = footprints.map(b => cleanRing(b.rings[0]));
  const inside = (x: number, z: number) => rings.some(r => pointInRing(x, z, r));
  const samples = perimeter();
  const { center: [fcx, fcz], angle, halfWidth: hw, halfLength: hl } = STADIUM_FIELD;
  // Field level: the highest baked ground across the opening, so turf never sinks.
  let fieldY = -Infinity;
  for (let u = -hw; u <= hw; u += 6) for (let v = -hl; v <= hl; v += 6)
    fieldY = Math.max(fieldY, ground(fcx + u * Math.cos(angle) + v * Math.sin(angle), fcz - u * Math.sin(angle) + v * Math.cos(angle)));
  fieldY += 0.05;

  // Stand depth along each outward normal, limited to the footprint union.
  let retracted = 0;
  const reach = samples.map(p => {
    let last = 0, outside = 0;
    for (let t = 0.75; t < 150; t += 0.75) {
      if (inside(p.x + p.nx * t, p.z + p.nz * t)) { last = t; outside = 0; }
      else if (last > 0 && ++outside > 4) break;
    }
    // Leave existing authored DKR frontage in front of the generated wall.
    while (grid && last > 14 && grid.near(grid.elevated, p.x + p.nx * last, p.z + p.nz * last, 2)) { last -= 1; retracted++; }
    return last;
  });
  const smooth = reach.map((_, i) => {
    const w = [-2, -1, 0, 1, 2].map(k => reach[(i + k + reach.length) % reach.length]).sort((a, b) => a - b);
    return w[2];
  });

  const builders = new Map<StadiumMaterialKey, MeshBuilder>();
  const builder = (k: StadiumMaterialKey) => { let b = builders.get(k); if (!b) builders.set(k, b = new MeshBuilder()); return b; };
  const collider = new ColliderBuilder();
  const white = new THREE.Color(1, 1, 1), UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
  // Per-sample section: the two adjacent side profiles blended point-by-point (sideBlend), then
  // clamped to the blended rim cap and to the footprint reach. A flat run (aisle/roof/tread) crossing
  // the reach is cut at it, so the SEZ roof closes onto its south wall.
  const blendOf = (p: Sample) => {
    const [a, b, w] = sideBlend(p.nu, p.nv), A = PROFILE_POINTS[a].pts, B = PROFILE_POINTS[b].pts, pa = STAND_PROFILES[a], pb = STAND_PROFILES[b];
    return { pts: A.map((q, k) => [q[0] + (B[k][0] - q[0]) * w, q[1] + (B[k][1] - q[1]) * w] as [number, number]),
      cap: pa.cap + (pb.cap - pa.cap) * w, parapet: pa.parapet + (pb.parapet - pa.parapet) * w,
      sez: (a === 'south' || b === 'south') && (a === b || w > 0.5), open: !!(w > 0.5 ? pb.open : pa.open),
      outerRoof: w < 0.5 ? pa.outerRoof : pb.outerRoof };
  };
  const blends = samples.map(p => blendOf(p));
  const section = (i: number) => {
    const p = samples[i], tmax = smooth[i], { pts, cap, outerRoof: profileRoof } = blends[i];
    const outerRoof = p.nu < -0.99 && Math.abs(p.v) <= 53 ? 35.1 : profileRoof;
    const points = pts.map(q => [q[0], q[1]] as [number, number]);
    for (let k = 1; k < points.length; k++)
      if (points[k][0] > tmax && points[k - 1][0] <= tmax + 1e-6 && Math.abs(points[k][1] - points[k - 1][1]) < 1e-9) points[k][0] = tmax;
    // Keep points in order while they stay inside the reach and under the cap; everything after the first one that does
    // not collapses onto the last kept point (the rim). The back/outer points then step down to the concourse roof and run
    // out to the footprint edge where the side has one.
    const out: [number, number][] = [points[0]];
    let last = 0, stopped = false;
    for (let k = 1; k < points.length; k++) {
      const kind = SEGMENT_KINDS[k], [lt, ly] = out[last];
      if (kind === 'back') { out.push(outerRoof !== null && outerRoof < ly && tmax > lt + 1 ? [lt, outerRoof] : [lt, ly]); continue; }
      if (kind === 'outer') { const b = out[k - 1]; out.push(outerRoof !== null && outerRoof < ly && tmax > lt + 1 ? [tmax, b[1]] : b); continue; }
      if (!stopped && points[k][0] <= tmax + 1e-6 && points[k][1] <= cap + 1e-6) { out.push(points[k]); last = k; }
      else { stopped = true; out.push([lt, ly]); }
    }
    return out.map(([t, y]) => new THREE.Vector3(p.x + p.nx * t, fieldY + y, p.z + p.nz * t));
  };
  const sections = samples.map((_, i) => section(i));
  const n = samples.length;
  // Scanned sector: west-straight samples inside [vMin, vMax] lose their generated rows, but only
  // once the replacement has committed (a failed commit keeps the generated west stand).
  let requested = options.scanSector ?? null, scanSectorError: string | null = null;
  if (requested && options.commitScan) {
    try { options.commitScan(fieldY); } catch (error) {
      requested = null;
      scanSectorError = error instanceof Error ? error.message : String(error);
      console.error('Stand scan commit failed; building the generated west stand instead.', error);
    }
  }
  const sector = requested;
  const replaced = (i: number) => !!sector && samples[i].nu < -0.99 && samples[i].v >= sector.vMin - 1e-6 && samples[i].v <= sector.vMax + 1e-6;
  const lerpBy = <T extends number[]>(rows: T[], v: number, k: number) => {
    const sorted = [...rows].sort((p, q) => p[0] - q[0]);
    if (v <= sorted[0][0]) return sorted[0][k];
    for (let r = 1; r < sorted.length; r++) if (v <= sorted[r][0]) { const a0 = sorted[r - 1], b0 = sorted[r], f = (v - a0[0]) / (b0[0] - a0[0]); return a0[k] + (b0[k] - a0[k]) * f; }
    return sorted[sorted.length - 1][k];
  };
  let replacedSections = 0, seamWalls = 0;
  let outerRun = 0;
  // Bellmont north (stadium-bellmont-north.ts): its outer-wall quads take a purpose-specific ribbon
  // material with absolute-height UVs; geometry, colliders and every other quad's UVs are unchanged.
  let northRun = 0, northQuads = 0, openQuads = 0;
  const north = (pi: Sample, pj: Sample, a: THREE.Vector3, b: THREE.Vector3) => inBellmontNorth(pi.nu + pj.nu, pi.nv + pj.nv, (a.x + b.x) / 2, (a.z + b.z) / 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = sections[i], b = sections[j];
    if (sector && replaced(i) && replaced(j)) {
      // Scanned sector: no generated rows/parapet. Keep a closed outer wall just outside the scan
      // crop edge (up to the scanned edge height), a cap over the gap, and a collider-only strip
      // closing the front edge down to the field.
      replacedSections++;
      const pi = samples[i], pj = samples[j];
      const at = (p: Sample, t: number, y: number) => new THREE.Vector3(p.x + p.nx * t, y, p.z + p.nz * t);
      const ei = lerpBy(sector.outer, pi.v, 2), ej = lerpBy(sector.outer, pj.v, 2);
      const ti = lerpBy(sector.outer, pi.v, 1), tj = lerpBy(sector.outer, pj.v, 1);
      const fi = smooth[i] + 0.35, fj = smooth[j] + 0.35, par = sector.parapet ?? 0;
      const outward = new THREE.Vector3(pi.nx + pj.nx, 0, pi.nz + pj.nz).normalize();
      // Outer wall up to the parapet top; the cap (roof deck) stays at rim height behind it.
      const oa = at(pi, fi, fieldY + ei + par), ob = at(pj, fj, fieldY + ej + par);
      const ga = Math.min(ground(oa.x, oa.z), fieldY) - 1.5, gb = Math.min(ground(ob.x, ob.z), fieldY) - 1.5;
      const fk = stadiumFacadeKey(pi.nu + pj.nu, pi.nv + pj.nv), [tu, tv] = STADIUM_FACADE_TILE[fk];
      const len = Math.hypot(ob.x - oa.x, ob.z - oa.z), u0 = outerRun / tu, u1 = (outerRun + len) / tu;
      outerRun += len;
      const qa = oa.clone().setY(ga), qb = ob.clone().setY(gb);
      if (north(pi, pj, oa, ob)) {
        const [w0, w1, w2, w3] = bellmontNorthUv(northRun, len, qa.y, qb.y, ob.y, oa.y);
        builder(BELLMONT_NORTH.key).quad(qa, qb, ob, oa, w0, w1, w2, w3, white, outward);
        northRun += len; northQuads++;
      } else builder(fk).quad(qa, qb, ob, oa, [u0, (ga - fieldY) / tv], [u1, (gb - fieldY) / tv], [u1, (ej + par) / tv], [u0, (ei + par) / tv], white, outward);
      collider.quad(qa, qb, ob, oa);
      // Roof cap at rim height from the clean rim line to the outer wall.
      const ca = at(pi, ti, fieldY + ei), cb = at(pj, tj, fieldY + ej), da = at(pi, fi, fieldY + ei), db = at(pj, fj, fieldY + ej);
      builder('trim').quad(ca, cb, db, da, [0, 0], [1, 0], [1, 0.2], [0, 0.2], white, UP);
      // The scan collider is a 0.5 m grid, so its edge can sit up to one cell inside the rim line:
      // the cap collider reaches 0.6 m under the scan edge to leave no slot.
      collider.quad(at(pi, ti - 0.6, fieldY + ei), at(pj, tj - 0.6, fieldY + ej), db, da);
      if (par > 0) {
        // Rim parapet (0.35 m thick) on the clean rim line, its inner face skirted 3 m down so the
        // scan's trimmed edge meets a closed face whatever its local height.
        const box = (t0: number, t1: number) => {
          const p0 = at(pi, t0, fieldY + ei - 3), p1 = at(pj, t0, fieldY + ej - 3), p2 = at(pj, t0, fieldY + ej + par), p3 = at(pi, t0, fieldY + ei + par);
          const q0 = at(pi, t1, fieldY + ei - 0.3), q1 = at(pj, t1, fieldY + ej - 0.3), q2 = at(pj, t1, fieldY + ej + par), q3 = at(pi, t1, fieldY + ei + par);
          builder('trim').quad(p0, p1, p2, p3, [0, 0], [1, 0], [1, 0.2], [0, 0.2], white, outward.clone().negate());
          builder('trim').quad(q1, q0, q3, q2, [0, 0], [1, 0], [1, 0.2], [0, 0.2], white, outward);
          builder('trim').quad(p3, p2, q2, q3, [0, 0], [1, 0], [1, 0.1], [0, 0.1], white, UP);
          collider.quad(p0, p1, p2, p3); collider.quad(q1, q0, q3, q2); collider.quad(p3, p2, q2, q3);
        };
        box(ti, ti + 0.35);
        // Outer coping on top of the outer wall.
        const ia = at(pi, fi - 0.35, fieldY + ei + par), ib = at(pj, fj - 0.35, fieldY + ej + par);
        builder('trim').quad(ia, ib, ob, oa, [0, 0], [1, 0], [1, 0.1], [0, 0.1], white, UP);
        const ka = at(pi, fi - 0.35, fieldY + ei), kb = at(pj, fj - 0.35, fieldY + ej);
        builder('trim').quad(kb, ka, ia, ib, [0, 0], [1, 0], [1, 0.2], [0, 0.2], white, outward.clone().negate());
        collider.quad(ia, ib, ob, oa); collider.quad(kb, ka, ia, ib);
      }
      const hfi = lerpBy(sector.front, pi.v, 1), hfj = lerpBy(sector.front, pj.v, 1);
      if (hfi > 0.02 || hfj > 0.02) {
        // Front wall from the turf up to the scanned front row (the scan's own front is ragged).
        const f0 = at(pi, 0, fieldY - 0.2), f1 = at(pj, 0, fieldY - 0.2), f2 = at(pj, 0, fieldY + hfj), f3 = at(pi, 0, fieldY + hfi);
        builder('stadiumRiser').quad(f0, f1, f2, f3, [pi.s / 2, 0], [pj.s / 2, 0], [pj.s / 2, hfj / 2], [pi.s / 2, hfi / 2], white, outward.clone().negate());
        collider.quad(f0, f1, f2, f3);
      }
      continue;
    }
    const s0 = samples[i].s, s1 = j ? samples[j].s : samples[i].s + Math.hypot(samples[0].x - samples[i].x, samples[0].z - samples[i].z);
    const inward = new THREE.Vector3(-(samples[i].nx + samples[j].nx), 0, -(samples[i].nz + samples[j].nz)).normalize();
    // Longhorn terraces: both ends of the quad on the south straight and inside the club rows.
    const southStraight = samples[i].nv > 0.99 && samples[j].nv > 0.99;
    const clubI = southStraight ? sezClub(samples[i].u) : null, clubJ = southStraight ? sezClub(samples[j].u) : null;
    const inClub = (row: number) => !!clubI && !!clubJ && row >= Math.max(clubI[0], clubJ[0]) && row < Math.min(clubI[1], clubJ[1]);
    const tunnel = southStraight && Math.abs(samples[i].u) < 3.1 && Math.abs(samples[j].u) < 3.1;
    for (let k = 0; k + 1 < a.length; k++) {
      const kind = SEGMENT_KINDS[k + 1], row = (k + 1 - 2) >> 1;
      const key: StadiumMaterialKey = kind === 'tread' ? (inClub(row) ? 'stadiumClubSeat' : 'stadiumSeat')
        : kind === 'fascia' ? 'stadiumSuite'
          : kind === 'front' && k === 0 && tunnel ? 'stadiumClubSeat'
            : kind === 'aisle' || kind === 'roof' || kind === 'soffit' || kind === 'outer' ? 'trim' : 'stadiumRiser';
      const pa = a[k], pb = b[k], pc = b[k + 1], pd = a[k + 1];
      if (pa.distanceToSquared(pd) < 1e-8 && pb.distanceToSquared(pc) < 1e-8) continue;
      const ta = Math.hypot(pa.x - samples[i].x, pa.z - samples[i].z), td = Math.hypot(pd.x - samples[i].x, pd.z - samples[i].z);
      const y0 = pa.y - fieldY, y1 = pd.y - fieldY;
      const flat = kind === 'tread' || kind === 'aisle' || kind === 'roof' || kind === 'soffit' || kind === 'outer';
      const uv: [Point, Point, Point, Point] = kind === 'tread'
        ? [[s0 / 0.5, ta / 0.85], [s1 / 0.5, ta / 0.85], [s1 / 0.5, td / 0.85], [s0 / 0.5, td / 0.85]]
        : flat ? [[s0 / 2, ta / 2], [s1 / 2, ta / 2], [s1 / 2, td / 2], [s0 / 2, td / 2]]
          // Suite/tower glazing: one 4 m level per texture tile, measured from the field plane.
          : kind === 'fascia' ? [[s0 / 4, y0 / 4], [s1 / 4, y0 / 4], [s1 / 4, y1 / 4], [s0 / 4, y1 / 4]]
            : [[s0 / 2, y0 / 2], [s1 / 2, y0 / 2], [s1 / 2, y1 / 2], [s0 / 2, y1 / 2]];
      builder(key).quad(pa, pb, pc, pd, uv[0], uv[1], uv[2], uv[3], white, kind === 'soffit' ? DOWN : flat ? UP : kind === 'back' ? inward.clone().negate() : inward);
      collider.quad(pa, pb, pc, pd);
    }
    // Rim parapet and the outer facade down to the ground.
    const ra = a[a.length - 1], rb = b[b.length - 1];
    const outward = inward.clone().negate();
    const top = (blends[i].parapet + blends[j].parapet) / 2;
    const ta = ra.clone().setY(ra.y + top), tb = rb.clone().setY(rb.y + top);
    builder('stadiumRiser').quad(ra, rb, tb, ta, [s0 / 2, 0], [s1 / 2, 0], [s1 / 2, 0.6], [s0 / 2, 0.6], white, inward);
    const oa = ra.clone().addScaledVector(outward, 0.35), ob = rb.clone().addScaledVector(outward, 0.35);
    const ota = oa.clone().setY(ta.y), otb = ob.clone().setY(tb.y);
    builder('trim').quad(ta, tb, otb, ota, [0, 0], [1, 0], [1, 0.2], [0, 0.2], white, UP);
    const ga = Math.min(ground(oa.x, oa.z), fieldY) - 1.5, gb = Math.min(ground(ob.x, ob.z), fieldY) - 1.5;
    // The SEZ exterior: the central premium building only (the corner stands are open).
    const fk = blends[i].sez && blends[j].sez ? 'stadiumSezSouth' : stadiumFacadeKey(samples[i].nu + samples[j].nu, samples[i].nv + samples[j].nv), [tu, tv] = STADIUM_FACADE_TILE[fk];
    const len = Math.hypot(ob.x - oa.x, ob.z - oa.z), u0 = outerRun / tu, u1 = (outerRun + len) / tu;
    outerRun += len;
    if (blends[i].open && blends[j].open) {
      // Open SEZ corner stand: a 1 m rim beam, then the exposed raked underside (parallel to the 0.53 m/m rake) down to grade.
      const foot = (o: THREE.Vector3, r: THREE.Vector3, p: Sample) => {
        const g = Math.min(ground(o.x, o.z), fieldY), tr = Math.hypot(r.x - p.x, r.z - p.z) + 0.35;
        const d = Math.min(tr - 1.5, Math.max(0, (r.y - 1.0 - g) / 0.53));
        return o.clone().addScaledVector(outward, -d).setY(g - 0.2);
      };
      const ua = oa.clone().setY(ra.y - 1.0), ub = ob.clone().setY(rb.y - 1.0), fa = foot(oa, ra, samples[i]), fb = foot(ob, rb, samples[j]);
      builder('stadiumRiser').quad(ua, ub, otb, ota, [s0 / 2, 0], [s1 / 2, 0], [s1 / 2, 0.6], [s0 / 2, 0.6], white, outward);
      const under = outward.clone().add(new THREE.Vector3(0, -1.9, 0)).normalize();
      builder('stadiumRiser').quad(fa, fb, ub, ua, [s0 / 2, 0], [s1 / 2, 0], [s1 / 2, ua.distanceTo(fa) / 2], [s0 / 2, ua.distanceTo(fa) / 2], white, under);
      collider.quad(ua, ub, otb, ota); collider.quad(fa, fb, ub, ua);
      openQuads++;
      continue;
    }
    if (north(samples[i], samples[j], oa, ob)) {
      const [w0, w1, w2, w3] = bellmontNorthUv(northRun, len, ga, gb, otb.y, ota.y);
      builder(BELLMONT_NORTH.key).quad(oa.clone().setY(ga), ob.clone().setY(gb), otb, ota, w0, w1, w2, w3, white, outward);
      northRun += len; northQuads++;
    } else builder(fk).quad(oa.clone().setY(ga), ob.clone().setY(gb), otb, ota,
      [u0, (ga - fieldY) / tv], [u1, (gb - fieldY) / tv], [u1, (otb.y - fieldY) / tv], [u0, (ota.y - fieldY) / tv], white, outward);
    collider.quad(oa.clone().setY(ga), ob.clone().setY(gb), otb, ota);
  }
  // ---- Rim details (authored; tools/scans/stadium-references.json) ----------------------------------------------------------
  const Lx = Math.sin(angle), Lz = Math.cos(angle), Wx = Math.cos(angle), Wz = -Math.sin(angle);
  /** Field-frame box: u0..u1 across, v0..v1 along, y0..y1 (absolute), into `key`; collider unless visualOnly. */
  const fbox = (key: StadiumMaterialKey, u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, visualOnly = false, skipBottom = true, uvm = 2.5) => {
    const P = (u: number, v: number, y: number) => new THREE.Vector3(fcx + u * Wx + v * Lx, y, fcz + u * Wz + v * Lz);
    const c = [P(u0, v0, y0), P(u1, v0, y0), P(u1, v1, y0), P(u0, v1, y0), P(u0, v0, y1), P(u1, v0, y1), P(u1, v1, y1), P(u0, v1, y1)];
    const nU = new THREE.Vector3(Wx, 0, Wz), nV = new THREE.Vector3(Lx, 0, Lz);
    const faces: [number[], THREE.Vector3, number, number][] = [
      [[0, 3, 7, 4], nU.clone().negate(), v1 - v0, y1 - y0], [[1, 2, 6, 5], nU, v1 - v0, y1 - y0],
      [[0, 1, 5, 4], nV.clone().negate(), u1 - u0, y1 - y0], [[3, 2, 6, 7], nV, u1 - u0, y1 - y0], [[4, 5, 6, 7], UP, u1 - u0, v1 - v0]];
    if (!skipBottom) faces.push([[0, 1, 2, 3], DOWN, u1 - u0, v1 - v0]);
    for (const [q, facing, w, h] of faces) {
      const [a, b, cc, d] = q.map(k => c[k]);
      const vy0 = (y0 - fieldY) / uvm, vy1 = (y0 + h - fieldY) / uvm;
      builder(key).quad(a, b, cc, d, [0, vy0], [w / uvm, vy0], [w / uvm, vy1], [0, vy1], white, facing);
      if (!visualOnly) collider.quad(a, b, cc, d);
    }
  };
  let westRim: ((v: number) => [number, number]) | null = null;
  const detail = { gantryColumns: 0, flagpoles: 0, lightStandards: 0, eastPiers: 0, northPiers: 0, sezTower: 0, sezFlankTowers: 0, sezOutline: 0 };
  // West light gantry: the colonnade + beam over the upper-deck rear (ref-ut-dkr2, ref-ut-dji0226). Beam top 67.5 m above the
  // field = the continuous scanned top at t 74-81 for v -51..-7 (raw MIT capture,
  // tools/scans/stadium-rakes.mjs); the photographs show it continuing over the south half. Column pitch 12 m and sizes: estimates.
  {
    const rimAt = (v: number): [number, number] => {
      if (sector) return [lerpBy(sector.outer, v, 1), lerpBy(sector.outer, v, 2)];
      let best = 0; for (let i = 1; i < n; i++) if (samples[i].nu < -0.99 && Math.abs(samples[i].v - v) < Math.abs(samples[best].v - v)) best = i;
      // Upper-deck rim (the point before the drop to the Bellmont roof).
      const r = sections[best][BACK_K - 1]; return [Math.hypot(r.x - samples[best].x, r.z - samples[best].z), r.y - fieldY];
    };
    westRim = rimAt;
    const beamTop = fieldY + 67.5, beamBottom = beamTop - 1.8;
    for (let v = -51; v <= 52; v += 12) {
      const [t, h] = rimAt(v), u = -hw - t;
      fbox('trim', u - 1.4, u - 0.4, v - 0.5, v + 0.5, fieldY + h - 0.6, beamBottom); detail.gantryColumns++;
    }
    for (let v = -52; v < 52; v += 8) {
      const [ta, ] = rimAt(v), [tb, ] = rimAt(v + 8), t = (ta + tb) / 2, u = -hw - t;
      fbox('trim', u - 1.6, u - 0.2, v, v + 8, beamBottom, beamTop, false, false);
    }
  }
  // East rim: a row of flagpoles and two light standards on the rim (ref-ut-r4-2016, ref-ut-dji0226, ref-ut-pano0001);
  // counts, spacing and heights are estimates. Visual only (thin), no colliders.
  // East outer wall: projecting buff-brick pier towers with pale caps (ref-ut-dji0226 / ref-ut-pano0001; 16 m pitch estimate).
  {
    const east = samples.map((p, i) => ({ p, i })).filter(({ p }) => p.nu > 0.99);
    const rimOf = (v: number) => { let best = east[0]; for (const e of east) if (Math.abs(e.p.v - v) < Math.abs(best.p.v - v)) best = e;
      const r = sections[best.i][BACK_K - 1], o = sections[best.i][sections[best.i].length - 1];
      return { t: Math.hypot(r.x - best.p.x, r.z - best.p.z), y: r.y, tOut: Math.hypot(o.x - best.p.x, o.z - best.p.z), yOut: o.y }; };
    for (let v = -50; v <= 50; v += 11) {
      const { t, y } = rimOf(v), u = hw + t - 0.6;
      fbox('trim', u, u + 0.28, v - 0.14, v + 0.14, y, y + 13.5, true); detail.flagpoles++;
    }
    for (const v of [-27, 6]) {
      const { t, y } = rimOf(v), u = hw + t - 1.2;
      fbox('trim', u, u + 0.9, v - 0.45, v + 0.45, y, y + 21, true);
      fbox('stadiumSuite', u - 1.6, u + 0.9, v - 2.6, v + 2.6, y + 21, y + 24.5, true, false); detail.lightStandards++;
    }
    for (let v = -48; v <= 48; v += 16) {
      const { tOut: t, yOut: y } = rimOf(v), u = hw + t + 0.35, x = fcx + u * Wx + v * Lx, z = fcz + u * Wz + v * Lz;
      const g0 = Math.min(ground(x, z), ground(x + 2.2 * Wx, z + 2.2 * Wz), fieldY) - 1.0;
      fbox('stadiumBrick', u - 0.05, u + 2.2, v - 4, v + 4, g0, y + 2.4);
      fbox('trim', u - 0.05, u + 2.5, v - 4.3, v + 4.3, y + 2.4, y + 3.1); detail.eastPiers++;
    }
  }
  // North end outer wall: the same projecting brick pier towers with cream caps (ref-ut-dji0226 north elevation), 12 m pitch
  // across the north straight (estimate); the measured round corner towers (b09 exterior) stand beyond them.
  {
    const north = samples.map((p, i) => ({ p, i })).filter(({ p }) => p.nv < -0.99);
    for (let u = -24; u <= 24; u += 12) {
      let best = north[0]; for (const e of north) if (Math.abs(e.p.u - u) < Math.abs(best.p.u - u)) best = e;
      const r = sections[best.i][sections[best.i].length - 1], t = Math.hypot(r.x - best.p.x, r.z - best.p.z), v = -hl - t - 0.35;
      const x = fcx + u * Wx + v * Lx, z = fcz + u * Wz + v * Lz, g0 = Math.min(ground(x, z), ground(x - 2.2 * Lx, z - 2.2 * Lz), fieldY) - 1.0;
      fbox('stadiumBrick', u - 4, u + 4, v - 2.2, v + 0.05, g0, r.y + 2.4);
      fbox('trim', u - 4.3, u + 4.3, v - 2.5, v + 0.05, r.y + 2.4, r.y + 3.1); detail.northPiers++;
    }
  }
  // SEZ flank towers either side of the board (ref-ut-dkr2, ref-ut-pano0009, ref-ut-dji0226): narrow white-framed suite
  // towers with glass balustrades, the south-east one with burnt-orange/brick edge frames, rising from grade between the
  // board block and the open corner stands to the City 2023 SEZ top (Y 35.0). They step 1.5 m proud of the SEZ face.
  // Spans/depths are estimates from the aerials.
  {
    const face = hl + SEZ_FACE.t, top = 35.0;
    for (const [u0, u1, frame] of [[24.8, 37, true], [-35, -24.8, false]] as [number, number, boolean][]) {
      let g = Infinity; for (const [uu, vv] of [[u0, face - 1.5], [u1, face - 1.5], [u0, face + 13], [u1, face + 13]]) g = Math.min(g, ground(fcx + uu * Wx + vv * Lx, fcz + uu * Wz + vv * Lz));
      const base = Math.min(g, fieldY) - 0.5;
      fbox('stadiumSezTower', u0, u1, face - 1.5, face + 13, base, top, false, true, 4);
      fbox('trim', u0 - 0.3, u1 + 0.3, face - 1.8, face + 13.3, top, top + 0.8, true);
      if (frame) for (const uf of [u0, u1 - 1.0]) fbox('stadiumTerraceFascia', uf, uf + 1.0, face - 2.1, face - 1.4, base, top + 0.8, true);
      detail.sezFlankTowers++;
    }
  }
  // SEZ south-west stair tower: buff-brick octagonal shaft with a round glazed drum and pale cornice standing behind (south of) the
  // SW flank tower (ref-commons-ajay-2025: Dec 2025 photograph from the south; ref-ut-dji0226 from above). Position, radius and heights
  // are estimates; collider only up to the SEZ roof (the drum above it is visual), so the SEZ stays under the City top.
  {
    const cu = -31, cv = hl + 41, r = 5.4, seg = 8, shaftTop = fieldY + 33.5, drumTop = fieldY + 37.9, roof = fieldY + STAND_PROFILES.south.cap;
    const at = (a: number, rad: number, y: number) => { const u = cu + Math.cos(a) * rad, v = cv + Math.sin(a) * rad; return new THREE.Vector3(fcx + u * Wx + v * Lx, y, fcz + u * Wz + v * Lz); };
    const base = Math.min(ground(at(0, 0, 0).x, at(0, 0, 0).z), fieldY) - 1;
    const ring = (key: StadiumMaterialKey, rad: number, y0: number, y1: number, n: number, solid: boolean, vScale: number) => {
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2 + Math.PI / n, a1 = ((k + 1) / n) * Math.PI * 2 + Math.PI / n, out = at((a0 + a1) / 2, 1, 0).sub(at(0, 0, 0)).setY(0).normalize();
        const q = [at(a0, rad, y0), at(a1, rad, y0), at(a1, rad, y1), at(a0, rad, y1)], w = q[0].distanceTo(q[1]);
        builder(key).quad(q[0], q[1], q[2], q[3], [0, (y0 - fieldY) / vScale], [w / vScale, (y0 - fieldY) / vScale], [w / vScale, (y1 - fieldY) / vScale], [0, (y1 - fieldY) / vScale], white, out);
        if (solid) collider.quad(q[0], q[1], q[2], q[3]);
      }
    };
    ring('stadiumBrick', r, base, shaftTop, seg, true, 2.5);
    ring('trim', r + 0.25, shaftTop, shaftTop + 0.9, seg, shaftTop + 0.9 <= roof, 2.5);
    ring('stadiumSuite', r - 0.4, shaftTop + 0.9, drumTop, 20, false, 4);
    ring('trim', r + 0.5, drumTop, drumTop + 0.9, 20, false, 2.5);
    const c = at(0, 0, drumTop + 0.9);
    for (let k = 0; k < 20; k++) builder('trim').tri(c, at(((k + 1) / 20) * Math.PI * 2 + Math.PI / 20, r + 0.5, drumTop + 0.9), at((k / 20) * Math.PI * 2 + Math.PI / 20, r + 0.5, drumTop + 0.9), [0, 0], [1, 0], [0, 1], white, UP);
    detail.sezTower = 1;
  }
  // Authored press-box massing on the west rim. Scan mode: fitted to the surviving scanned slab extents (sector.pressBox).
  // Default (generated west): preserve the existing authored box's along-field extent from dkr-west-stand.json,
  // placing its front on the generated rim. Only the replaced west-stand region changes.
  const pressBox = sector ? sector.pressBox ?? null : { vMin: -49, vMax: -10.5, t0: westRim!(0)[0], t1: westRim!(0)[0] + 7, top: 66.0 };
  if (pressBox) {
    const Lx = Math.sin(angle), Lz = Math.cos(angle), Wx = Math.cos(angle), Wz = -Math.sin(angle);
    const fp = (t: number, v: number, y: number) => { const u = -hw - t; return new THREE.Vector3(fcx + u * Wx + v * Lx, y, fcz + u * Wz + v * Lz); };
    let base = Infinity; for (let v = pressBox.vMin; v <= pressBox.vMax; v += 1) base = Math.min(base, sector ? lerpBy(sector.outer, v, 2) : westRim!(v)[1]);
    const y0 = fieldY + base - 0.3, y1 = fieldY + pressBox.top, { t0, t1, vMin: va, vMax: vb } = pressBox;
    const c = [fp(t0, va, y0), fp(t0, vb, y0), fp(t0, vb, y1), fp(t0, va, y1), fp(t1, va, y0), fp(t1, vb, y0), fp(t1, vb, y1), fp(t1, va, y1)];
    const toField = new THREE.Vector3(-Wx, 0, -Wz).negate(); // +u: toward the field
    const faces: [number[], StadiumMaterialKey, THREE.Vector3][] = [
      [[0, 1, 2, 3], 'stadiumSuite', toField], [[5, 4, 7, 6], 'trim', toField.clone().negate()],
      [[4, 0, 3, 7], 'trim', new THREE.Vector3(-Lx, 0, -Lz)], [[1, 5, 6, 2], 'trim', new THREE.Vector3(Lx, 0, Lz)], [[3, 2, 6, 7], 'trim', UP],
    ];
    for (const [q, key, facing] of faces) {
      const w = q.map(k => c[k]), span = w[0].distanceTo(w[1]), hgt = w[0].distanceTo(w[3]);
      builder(key).quad(w[0], w[1], w[2], w[3], [0, 0], [span / 4, 0], [span / 4, key === 'stadiumSuite' ? Math.max(1, hgt / 4) : hgt / 2], [0, key === 'stadiumSuite' ? Math.max(1, hgt / 4) : hgt / 2], white, facing);
      collider.quad(w[0], w[1], w[2], w[3]);
    }
  }
  // Burnt-orange outline wall (0.9 m) around the SEZ longhorn club rows: front edge (row a), back edge (row b) and the two
  // horn-tip ends; visual only (the seating collider stays the rows).
  {
    const southIdx = samples.map((p, i) => i).filter(i => samples[i].nv > 0.99 && sezClub(samples[i].u));
    const rowPoint = (i: number, row: number) => sections[i][Math.min(sections[i].length - 1, 1 + 2 * row)];
    const wall = (p: THREE.Vector3, q: THREE.Vector3, facing: THREE.Vector3) => {
      const len = p.distanceTo(q);
      builder('stadiumTerraceFascia').quad(p, q, q.clone().setY(q.y + 0.9), p.clone().setY(p.y + 0.9), [0, 0], [len / 2, 0], [len / 2, 0.45], [0, 0.45], white, facing);
    };
    for (let s = 0; s + 1 < southIdx.length; s++) {
      const i = southIdx[s], j = southIdx[s + 1];
      if (j !== i + 1) continue;
      const toField = new THREE.Vector3(-samples[i].nx, 0, -samples[i].nz);
      const [ai, bi] = sezClub(samples[i].u)!, [aj, bj] = sezClub(samples[j].u)!;
      wall(rowPoint(i, ai), rowPoint(j, aj), toField); wall(rowPoint(i, bi), rowPoint(j, bj), toField.clone().negate());
      detail.sezOutline++;
    }
    for (const i of [southIdx[0], southIdx[southIdx.length - 1]]) {
      const [a0, b0] = sezClub(samples[i].u)!, side = new THREE.Vector3(samples[i].nz, 0, -samples[i].nx);
      for (let r = a0; r < b0; r++) { wall(rowPoint(i, r), rowPoint(i, r + 1), side); wall(rowPoint(i, r + 1), rowPoint(i, r), side.clone().negate()); }
    }
  }
  // Seam walls on the two boundary sections of the scanned sector: from below the field up to the
  // higher of the generated profile and the scanned surface, so no gap opens between them.
  if (sector) for (let i = 0; i < n; i++) {
    if (!replaced(i)) continue;
    const prev = (i - 1 + n) % n, next = (i + 1) % n;
    if (replaced(prev) && replaced(next)) continue;
    const p = samples[i], profileScan = Math.abs(p.v - sector.vMin) < Math.abs(p.v - sector.vMax) ? sector.seamMin : sector.seamMax;
    const sec = sections[i].map(q => [Math.hypot(q.x - p.x, q.z - p.z), q.y - fieldY] as [number, number]);
    const gen = (t: number) => { let y = -Infinity; for (const [tt, yy] of sec) if (tt <= t + 1e-6) y = Math.max(y, yy); return t <= sec[sec.length - 1][0] + 1e-6 ? y : -Infinity; };
    const scanAt = (t: number) => { const k = Math.round(t / sector.step); const h = profileScan[k]; return h ?? -Infinity; };
    const tEnd = smooth[i] + 0.35, step = sector.step;
    const along = new THREE.Vector3(-p.nz, 0, p.nx); // in-plane normal of the section wall
    for (let t = 0; t < tEnd - 1e-6; t += step) {
      const t1 = Math.min(tEnd, t + step);
      const top0 = Math.max(gen(t), scanAt(t), 0), top1 = Math.max(gen(t1), scanAt(t1), 0);
      const w = (tt: number, y: number) => new THREE.Vector3(p.x + p.nx * tt, y, p.z + p.nz * tt);
      const b0 = Math.min(ground(w(t, 0).x, w(t, 0).z), fieldY) - 1.5, b1 = Math.min(ground(w(t1, 0).x, w(t1, 0).z), fieldY) - 1.5;
      const q = [w(t, b0), w(t1, b1), w(t1, fieldY + top1), w(t, fieldY + top0)] as const;
      builder('stadiumRiser').quad(q[0], q[1], q[2], q[3], [t / 2, b0 / 2], [t1 / 2, b1 / 2], [t1 / 2, top1 / 2], [t / 2, top0 / 2], white, along);
      builder('stadiumRiser').quad(q[1], q[0], q[3], q[2], [t1 / 2, b1 / 2], [t / 2, b0 / 2], [t / 2, top0 / 2], [t1 / 2, top1 / 2], white, along.clone().negate());
      collider.quad(q[0], q[1], q[2], q[3]);
    }
    seamWalls++;
  }
  // Turf with local field UVs (0..1 across the full sideline-to-sideline plate).
  const field = builder('stadiumField');
  const ring = samples.map(p => new THREE.Vector2(p.x, p.z));
  const faces = THREE.ShapeUtils.triangulateShape(ring, []);
  const { center: [mcx, mcz], angle: ma } = STADIUM_MARKINGS;
  const local = (x: number, z: number): Point => {
    const dx = x - mcx, dz = z - mcz;
    const u = dx * Math.cos(ma) - dz * Math.sin(ma), v = dx * Math.sin(ma) + dz * Math.cos(ma);
    return [(u + hw) / (2 * hw), (v + hl) / (2 * hl)];
  };
  for (const [i, j, k] of faces) {
    const a = new THREE.Vector3(ring[i].x, fieldY, ring[i].y), b = new THREE.Vector3(ring[j].x, fieldY, ring[j].y), c = new THREE.Vector3(ring[k].x, fieldY, ring[k].y);
    field.tri(a, b, c, local(a.x, a.z), local(b.x, b.z), local(c.x, c.z), white, UP);
    collider.tri(a, b, c);
  }
  let triangles = 0;
  for (const b of builders.values()) triangles += b.triangles;
  return {
    builders, collider,
    /** Per perimeter sample: field-frame position/normal and the stand depth actually built. */
    sectionInfo: samples.map((p, i) => ({ x: p.x, z: p.z, u: p.u, v: p.v, nu: p.nu, nv: p.nv, reach: smooth[i] })),
    stats: { fieldY, sections: n, rimMaxHeight: Math.max(...sections.map(s => s[s.length - 1].y)) - fieldY,
      meanDepth: smooth.reduce((a, b) => a + b, 0) / n, retractedMetres: retracted, triangles, colliderTriangles: collider.triangles,
      scanSector: sector ? { side: sector.side, vMin: sector.vMin, vMax: sector.vMax, replacedSections, seamWalls, pressBox: !!pressBox } : null, scanSectorError,
      bellmontNorth: { quads: northQuads, wallMetres: +northRun.toFixed(2) }, rimDetail: detail, sezOpenUndersideQuads: openQuads },
  };
}
