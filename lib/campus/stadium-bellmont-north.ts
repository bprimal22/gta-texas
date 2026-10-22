import type { Point } from './types';

/** Bellmont north (D19 root correction): the generated bowl's existing west outer wall from the
 * north-west corner to the GIS pier at z 216.63, where the reviewed full-map capture priority-07
 * (pose camera (295, 23.13, 170) -> target (390, 6.93, 260), 60 deg vertical FOV, 1280x720) shows
 * continuous stacked dark horizontal ribbon windows on pale spandrels between tall piers, topped at
 * the block datum, with the set-back upper-deck rear above it (pale deck-edge beam and support posts
 * on a shaded back wall). Measured by casting that pose's pixel rays onto this bowl wall plane
 * (reference-interpreted, no photo pixels used):
 *  - ribbon pitch 3.77 m (mean of 35 floor intervals in 4 pixel columns, spread 3.59-3.88),
 *    ribbon ~1.05 m (dark runs 0.27-0.30 of the pitch: 12-19 px of 47-60 px);
 *  - block top Y 30.8-31.0 at z 182-210 (the b09 lane measured 31.6-32.6 further south);
 *  - first ribbon centre 0.5-2.3 m under the top (phase uncertain, mean 1.4 m used);
 *  - piers 10.6 m apart along this wall's chords: reference pier pixels 270/435/570 cast onto the
 *    built quads land at run 38.24/27.68/17.04 m from the zone's south end (fit residual < 0.05 m);
 *  - deck-edge beam Y 35.2-36.6 with a dark shadow line under it, posts above it one per bay.
 * Only the outer-wall render quads change material/UV here; positions, triangle counts, colliders,
 * scan sector, seating and field are untouched. No openings are painted: the upper zone is a closed
 * shaded wall with painted framing (actual 3D deck framing / voids are deferred: they would change
 * the collider and scan envelope). */
export const BELLMONT_NORTH = {
  key: 'stadiumFacadeBellmontNorth',
  /** Outer-wall segments whose midpoint lies in this z range on the west face (campus metres). The
   * south edge is the GIS pier at z 216.63 (ribbon -> fin-panel transition in priority-07) rounded to
   * the bowl's 3 m section spacing; the north edge keeps the corner chord whose midpoint is z 174.5
   * (the last ribbon bay visible in the frame is at z ~175). */
  zMin: 172, zMax: 217.5,
  /** Along-wall bay (pier spacing projected onto this wall) and the run (m from the zone's south
   * end) of a measured pier centre. */
  bay: 10.6, pierRun: 6.45,
  /** Absolute campus Y mapped onto the clamped texture (bottom/top of the atlas). */
  yBottom: -12, yTop: 52,
  blockTop: 31.0,
  ribbonPitch: 3.77, ribbonHeight: 1.05, firstRibbonBelowTop: 1.4,
  /** Pier as a fraction of the bay (reference ~13 %). */
  pier: 0.13,
  beam: [35.0, 36.3] as [number, number],
} as const;

/** True for a west-facing outer-wall segment (summed sample normals nu/nv, field frame) whose
 * world-space midpoint lies in the Bellmont north zone. */
export function inBellmontNorth(nu: number, nv: number, mx: number, mz: number) {
  return -nu > Math.abs(nv) && mx < 400 && mz >= BELLMONT_NORTH.zMin && mz <= BELLMONT_NORTH.zMax;
}

/** Texture V for an absolute campus Y (the atlas is clamped vertically, so the floor rhythm stays
 * anchored to the measured heights rather than to the field plane). */
export function bellmontNorthV(y: number) {
  return (y - BELLMONT_NORTH.yBottom) / (BELLMONT_NORTH.yTop - BELLMONT_NORTH.yBottom);
}

/** UVs for the outer-wall quad (bottom a, bottom b, top b, top a) given the running length along
 * the zone (m) and this segment's length. */
export function bellmontNorthUv(run: number, len: number, ya: number, yb: number, ytb: number, yta: number): [Point, Point, Point, Point] {
  const { bay, pierRun, pier } = BELLMONT_NORTH, u = (r: number) => (r - pierRun) / bay + pier / 2;
  const u0 = u(run), u1 = u(run + len);
  return [[u0, bellmontNorthV(ya)], [u1, bellmontNorthV(yb)], [u1, bellmontNorthV(ytb)], [u0, bellmontNorthV(yta)]];
}
