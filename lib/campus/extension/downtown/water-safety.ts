// Flight safety over downtown water (creek-mouth inlets lie inside the flight-legal polygon so street bridges over them
// stay open). Pure: the game and the Node checks use the same functions. No invisible floor is created: a landing target
// in mapped water below the inlet barrier tops is refused, and a descent with no target over open water stops at a hover
// height above those barriers instead of settling on the water bed.

/** Hover clearance (m) above `bedTop` where a target-less descent over water stops; clears the inlet barriers. */
export const WATER_HOVER_CLEARANCE = 1.5;
const RING: [number, number][] = [[0, 0], [.4, 0], [-.4, 0], [0, .4], [0, -.4]];

/** `bedTop`: feet below this over mapped water count as in the water/inlet (inside the low barriers, whose tops are at
 * the water surface + 3.2 m); a bridge deck above it is a real floor. */
export interface WaterQuery { surfaceY: number; bedTop: number; isWater: (x: number, z: number) => boolean;
  /** Optional local bed top (e.g. a park pond above the lake level); omitted, `bedTop` applies everywhere. */
  bedTopAt?: (x: number, z: number) => number }
const bedTopAt = (q: WaterQuery, x: number, z: number) => q.bedTopAt ? q.bedTopAt(x, z) : q.bedTop;

/** Water under any part of the capsule footprint (mapped water class at the point or within 0.4 m). */
export function overWater(q: WaterQuery, x: number, z: number) { return RING.some(([dx, dz]) => q.isWater(x + dx, z + dz)); }

/** A proposed landing (feet Y) in mapped water: on the bed or on banks inside the inlet barriers. Decks above are fine. */
export function isWaterbedTarget(q: WaterQuery, x: number, feetY: number, z: number) {
  return feetY < bedTopAt(q, x, z) && overWater(q, x, z);
}

/** Lowest feet Y allowed for a target-less descent at (x, z), or null when not over open water. `floorFeetY` is the
 * first physical floor below (null = none): a deck above `bedTop` is a real floor, so no hover limit applies. */
export function waterHoverFeet(q: WaterQuery, x: number, z: number, floorFeetY: number | null) {
  if (!overWater(q, x, z)) return null;
  const bed = bedTopAt(q, x, z);
  if (floorFeetY !== null && floorFeetY >= bed) return null;
  return bed + WATER_HOVER_CLEARANCE;
}

/** Vertical step limited by the hover height: descend no lower than it, rise back toward it at most `maxRise`. */
export function guardDescent(deltaY: number, feetY: number, hoverFeet: number | null, maxRise: number) {
  if (hoverFeet === null) return deltaY;
  return Math.max(deltaY, Math.min(hoverFeet - feetY, maxRise));
}
