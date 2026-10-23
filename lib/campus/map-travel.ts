import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { CampusData, Point } from './types';

export const WALK_SPEED = 1.65;
export const RUN_SPEED = 8;
export type MapView = { x: number; z: number; scale: number; size: number };

export function mapView(bounds: number[], position: { x: number; z: number }, expanded: boolean): MapView {
  if (!expanded) return { x: position.x, z: position.z, scale: .43, size: 220 };
  const [west, north, east, south] = bounds;
  return { x: (west + east) / 2, z: (north + south) / 2,
    scale: 820 / Math.max(east - west, south - north), size: 900 };
}

export function mapPoint(view: MapView, u: number, v: number): Point {
  return [view.x + (u - .5) * view.size / view.scale,
    view.z + (v - .5) * view.size / view.scale];
}

function inRing([x, z]: Point, ring: Point[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function nearestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b[0] - a[0], dz = b[1] - a[1], d = dx * dx + dz * dz;
  const t = d ? THREE.MathUtils.clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / d, 0, 1) : 0;
  return [a[0] + dx * t, a[1] + dz * t];
}

/** Mapped footprints that are open to the sky: the DKR stadium (one GIS ring covers bowl and
 * field). Points inside count as outdoor here; travelLanding still requires a visible floor matching
 * the physical one, capsule clearance and open sky, so covered concourses and suites stay refused. */
export const OPEN_AIR_FOOTPRINTS: ReadonlySet<number> = new Set([655373, 504014]);

/** Vertical reach of the landing probe: from `above` metres over the contour terrain down
 * `distance` metres. Ordinary ground stays near the terrain (a roof above it is found by the
 * open-sky test, never landed on). Inside the open-air stadium the stands rise up to ~70 m and
 * the generated field sits above the contour terrain, so the probe starts above the press box. */
export interface TravelProbe { above: number; distance: number }
export const TRAVEL_PROBE: TravelProbe = { above: 5, distance: 12 };
export const OPEN_AIR_TRAVEL_PROBE: TravelProbe = { above: 85, distance: 100 };
export function travelProbe(data: CampusData, p: Point): TravelProbe {
  return data.buildings.some(b => OPEN_AIR_FOOTPRINTS.has(b.id) && inRing(p, b.rings[0])) ? OPEN_AIR_TRAVEL_PROBE : TRAVEL_PROBE;
}

/** An optional walkable region beyond `data.bounds` (the deep-west and downtown extensions): points it contains
 * are judged against its own footprints only (or its own `outdoor` test when given, e.g. a spatially indexed
 * one). Omitted, every result is exactly as before. */
export interface TravelRegion { contains: (p: Point) => boolean; footprints: Point[][][]; outdoor?: (p: Point) => boolean }

/** Several extension regions as one: each point is judged by the first region that contains it. */
export function combineTravelRegions(regions: (TravelRegion | undefined | null)[]): TravelRegion | undefined {
  const list = regions.filter((r): r is TravelRegion => !!r);
  if (list.length < 2) return list[0];
  return {
    contains: p => list.some(r => r.contains(p)),
    footprints: list.flatMap(r => r.footprints),
    outdoor: p => {
      const r = list.find(q => q.contains(p));
      return !!r && (r.outdoor ? r.outdoor(p) : !r.footprints.some(rings => nearFootprint(p, rings)));
    },
  };
}

function nearFootprint(p: Point, rings: Point[][]) {
  if (inRing(p, rings[0]) && !rings.slice(1).some(r => inRing(p, r))) return true;
  return rings.some(r => r.some((a, i) => {
    const q = nearestOnSegment(p, a, r[(i + 1) % r.length]);
    return Math.hypot(q[0] - p[0], q[1] - p[1]) < .8;
  }));
}

export function outdoorPoint(data: CampusData, p: Point, region?: TravelRegion) {
  if (region && p.every(Number.isFinite) && region.contains(p))
    return region.outdoor ? region.outdoor(p) : !region.footprints.some(rings => nearFootprint(p, rings));
  const [west, north, east, south] = data.bounds;
  if (!p.every(Number.isFinite) || p[0] < west + 2 || p[0] > east - 2 || p[1] < north + 2 || p[1] > south - 2) return false;
  return !data.buildings.some(b => {
    if (OPEN_AIR_FOOTPRINTS.has(b.id)) return false;
    return nearFootprint(p, b.rings);
  });
}

/** Prefer the clicked area, then nearby clear ground and paths; never a mapped roof. */
export function travelCandidates(data: CampusData, requested: Point, region?: TravelRegion): Point[] {
  if (!requested.every(Number.isFinite)) return [];
  const candidates: Point[] = [requested];
  const kinds = new Set(['footway', 'path', 'pedestrian', 'steps', 'service', 'living_street', 'residential', 'unclassified']);
  for (const path of data.paths) {
    if (!kinds.has(path.kind) || path.area) continue;
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1], b = path.points[i], p = nearestOnSegment(requested, a, b);
      if (Math.hypot(p[0] - requested[0], p[1] - requested[1]) > 120) continue;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < .1) continue;
      candidates.push(p);
      for (const offset of [-2, 2]) candidates.push([p[0] + (b[0] - a[0]) / length * offset, p[1] + (b[1] - a[1]) / length * offset]);
    }
  }
  candidates.sort((a, b) => Math.hypot(a[0] - requested[0], a[1] - requested[1]) - Math.hypot(b[0] - requested[0], b[1] - requested[1]));
  const result: Point[] = [];
  for (const p of candidates) {
    if (result.some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1.2) || !outdoorPoint(data, p, region)) continue;
    result.push(p);
    if (result.length === 24) break;
  }
  // A stair edge or trunk can invalidate the exact click even when usable
  // ground is less than a metre away. Mapped path centerlines alone can skip
  // that ground entirely. Reserve at most half the existing 24-candidate
  // budget for local probes, leaving the other half for path fallbacks.
  const nearby: Point[] = [];
  for (const radius of [.75, 1.5, 3]) {
    for (let direction = 0; direction < 8; direction++) {
      const angle = direction * Math.PI / 4;
      const p: Point = [requested[0] + Math.cos(angle) * radius,
        requested[1] + Math.sin(angle) * radius];
      if (!outdoorPoint(data, p, region) || nearby.some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < .5)) continue;
      nearby.push(p);
      if (nearby.length === 12) break;
    }
    if (nearby.length === 12) break;
  }
  const distance = (p: Point) => Math.hypot(p[0] - requested[0], p[1] - requested[1]);
  const primary = [...result.slice(0, 24 - nearby.length), ...nearby]
    .sort((a, b) => distance(a) - distance(b))
    .filter((p, i, points) => !points.slice(0, i).some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < .5));
  // Broader fallbacks for clicks on or inside a building, where the nearest
  // mapped centerlines can all run indoors: path points spread at least 4 m
  // apart, plus outdoor radial probes, nearest first. The primary list keeps
  // its original order, so clicks it can serve resolve exactly as before.
  const spread: Point[] = [];
  const add = (p: Point, spacing: number) => {
    if ([...primary, ...spread].some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < spacing) || !outdoorPoint(data, p, region)) return;
    spread.push(p);
  };
  for (const p of candidates) add(p, 4);
  for (const radius of [6, 10, 15, 22, 30, 42, 60])
    for (let direction = 0; direction < 12; direction++) {
      const angle = direction * Math.PI / 6;
      add([requested[0] + Math.cos(angle) * radius, requested[1] + Math.sin(angle) * radius], 4);
    }
  spread.sort((a, b) => distance(a) - distance(b));
  return [...primary, ...spread].slice(0, TRAVEL_CANDIDATE_BUDGET);
}

/** Candidates tried per trip: the original 24 nearby, then broader fallbacks. */
export const TRAVEL_CANDIDATE_BUDGET = 96;

export function travelLanding(
  world: RAPIER.World, player: RAPIER.Collider, point: Point, terrainHeight: number,
  surface: (x: number, z: number, fromY: number, distance: number) => THREE.Intersection | null,
  /** Set when the only objection is a roof overhead; that will not change on retry. */
  outcome?: { enclosed: boolean },
  probe: TravelProbe = TRAVEL_PROBE,
) {
  const [x, z] = point, down = { x: 0, y: -1, z: 0 };
  const center = surface(x, z, terrainHeight + probe.above, probe.distance);
  if (!center) return null;
  const height = center.point.y;
  for (const [dx, dz] of [[0, 0], [.3, 0], [-.3, 0], [0, .3], [0, -.3]]) {
    const visible = surface(x + dx, z + dz, height + 1, 2);
    const tile = visible?.object.userData.tile;
    if (!visible || (tile && tile.geometricError > 4) || Math.abs(visible.point.y - height) > .22) return null;
    const physical = world.castRay(new RAPIER.Ray({ x: x + dx, y: height + 1, z: z + dz }, down),
      2, true, undefined, undefined, player);
    if (!physical || Math.abs(height + 1 - physical.timeOfImpact - visible.point.y) > .06) return null;
  }
  const position = new THREE.Vector3(x, height + .905, z);
  if (world.intersectionWithShape(position, { x: 0, y: 0, z: 0, w: 1 },
    new RAPIER.Capsule(.54, .34), undefined, undefined, player)) return null;
  // Map travel arrives outdoors. A GIS courtyard hole can still lie under an
  // authored atrium roof, so require open sky physically, not just in 2D.
  if (overheadEnclosed(world, player, position)) { if (outcome) outcome.enclosed = true; return null; }
  return position;
}

const OVERHEAD_REACH = 120;
const COLUMN: Point[] = [[0, 0], [.3, 0], [-.3, 0], [0, .3], [0, -.3]];
const RING: Point[] = Array.from({ length: 8 }, (_, i) => [2.5 * Math.cos(i * Math.PI / 4), 2.5 * Math.sin(i * Math.PI / 4)]);

/** True when solid collision geometry covers the standing capsule's column
 * and most of a 2.5 m ring around it: a roof, atrium or covered enclosure.
 * Isolated overhead solids (a tree branch, sign or lamp arm) leave the ring
 * open and do not count. Queries only; the player collider is excluded. */
export function overheadEnclosed(world: RAPIER.World, player: RAPIER.Collider | undefined, position: { x: number; y: number; z: number }) {
  const up = { x: 0, y: 1, z: 0 }, fromY = position.y + .95;
  const blocked = (dx: number, dz: number) => !!world.castRay(
    new RAPIER.Ray({ x: position.x + dx, y: fromY, z: position.z + dz }, up),
    OVERHEAD_REACH, true, undefined, undefined, player);
  if (!COLUMN.some(([dx, dz]) => blocked(dx, dz))) return false;
  return RING.filter(([dx, dz]) => blocked(dx, dz)).length >= 5;
}
