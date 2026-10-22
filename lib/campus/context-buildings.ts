import type { Building, Point, Path } from './types';
import { OPEN_AIR_FOOTPRINTS } from './map-travel';
import { CoverageGrid } from './context-coverage';
import { cleanRing, orientRings, signedArea, pointInPolygon, ColliderBuilder } from './context-geometry';
import { CATALOG, resolveSpec, type BuildingCatalog, type BuildingSpec } from './context/catalog';
import { buildMassing, type RoofsLidar, type Massing } from './context/massing';
import { buildArchitecture, type ArchStats, type DetailSource, type MaterialKey } from './context/architecture';
import { Batch } from './context/batch';
import { PathIndex } from './context/paths';
import { isReplaced, blockMassing } from './blocks/context-hooks';

/** Generated context architecture for GIS footprints that have no authored
 * package. Each footprint is assigned a real UT/Austin archetype from
 * public/data/building-catalog.json (with its basis: known / estimate /
 * district-default), massed from measured LiDAR roofs where available, and
 * built with catalogued storey heights, window modules, materials and roofs.
 * This is reference-guided context, not a survey of each facade. */
/** Footprints rebuilt by the dedicated stadium generator. */
/** DKR stadium footprints (bowl + field); the same open-air set map travel accepts. */
export const STADIUM_FOOTPRINTS = OPEN_AIR_FOOTPRINTS;

export type ContextDecision = 'generated' | 'authored' | 'route' | 'stadium' | 'invalid';

export interface ContextPlan {
  building: Building;
  decision: ContextDecision;
  /** Catalogue archetype (generated plans only). */
  style?: string;
  spec?: BuildingSpec;
  elevatedFraction: number;
  perimeterFraction: number;
  groundFraction: number;
}

/** Classify every footprint against the authored-coverage raster. */
export function planContextBuildings(buildings: Building[], grid: CoverageGrid, catalog: BuildingCatalog = CATALOG): ContextPlan[] {
  return buildings.map(building => {
    const base = { building, elevatedFraction: 0, perimeterFraction: 0, groundFraction: 0 };
    if (STADIUM_FOOTPRINTS.has(building.id)) return { ...base, decision: 'stadium' as const };
    // A whole-campus block's own authored geometry replaces this footprint (blocks/<id>/context.json).
    if (isReplaced(building)) return { ...base, decision: 'authored' as const };
    const rings = prepareRings(building.rings);
    if (!rings) return { ...base, decision: 'invalid' as const };
    let cells = 0, elevated = 0, ground = 0;
    const xs = rings[0].map(p => p[0]), zs = rings[0].map(p => p[1]);
    const step = grid.cell;
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step)
      for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) {
        if (!pointInPolygon(x, z, rings)) continue;
        cells++;
        if (grid.at(grid.elevated, x, z)) elevated++;
        if (grid.at(grid.ground, x, z)) ground++;
      }
    if (!cells) {
      const [cx, cz] = building.center;
      cells = 1;
      if (grid.at(grid.elevated, cx, cz)) elevated++;
      if (grid.at(grid.ground, cx, cz)) ground++;
    }
    let samples = 0, edge = 0;
    for (const ring of rings)
      for (let i = 0; i < ring.length; i++) {
        const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
        const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 2));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          samples++;
          if (grid.near(grid.elevated, ax + (bx - ax) * t, az + (bz - az) * t, 1.5)) edge++;
        }
      }
    const elevatedFraction = elevated / cells, groundFraction = ground / cells,
      perimeterFraction = samples ? edge / samples : 0;
    const measured = { ...base, elevatedFraction, perimeterFraction, groundFraction };
    // Any substantial authored body or facade: keep the authored work only.
    if (elevatedFraction >= 0.12 || perimeterFraction >= 0.4) return { ...measured, decision: 'authored' as const };
    // Any authored walkable ground inside the footprint (a route, court or a
    // path edge that crosses the GIS line) keeps the footprint empty: leaving a
    // background building out is preferable to a wall across a walkway.
    if (ground > 0) return { ...measured, decision: 'route' as const };
    const spec = resolveSpec(building, catalog);
    return { ...measured, decision: 'generated' as const, style: spec.archetype, spec };
  });
}

function prepareRings(source: Point[][]): Point[][] | null {
  const outer = cleanRing(source[0] ?? []);
  if (outer.length < 3 || Math.abs(signedArea(outer)) < 1) return null;
  const holes = source.slice(1).map(r => cleanRing(r)).filter(r => r.length >= 3 && Math.abs(signedArea(r)) > 1);
  return orientRings([outer, ...holes]);
}

export interface ContextChunk {
  builders: Map<MaterialKey, Batch>;
  collider: ColliderBuilder;
}

export interface ContextBuildStats extends ArchStats {
  buildings: number;
  byStyle: Record<string, number>;
  byBasis: Record<string, number>;
  trianglesByArchetype: Record<string, number>;
  massing: Record<Massing['source'], number>;
  /** Fitted storey heights per archetype [min, max] (m). */
  storeyRange: Record<string, [number, number]>;
}

export interface ContextGeometryOptions {
  paths: Path[];
  roofs?: RoofsLidar | null;
  chunkSize?: number;
  detailCell?: number;
}

/** Build shell geometry (+ colliders) for every generated plan, grouped into
 * spatial chunks, and collect near-detail sources grouped by detail cell. */
export function buildContextGeometry(plans: ContextPlan[], ground: (x: number, z: number) => number, options: ContextGeometryOptions) {
  const chunkSize = options.chunkSize ?? 560, detailCell = options.detailCell ?? 120;
  const chunks = new Map<string, ContextChunk>();
  const detail = new Map<string, DetailSource[]>();
  const paths = new PathIndex(options.paths);
  const stats: ContextBuildStats = {
    buildings: 0, byStyle: {}, byBasis: {}, trianglesByArchetype: {}, triangles: 0, colliderTriangles: 0,
    massing: { lidar: 0, 'lidar-tiers': 0, 'campus-h': 0, 'campus-h-conflict': 0, block: 0 }, storeyRange: {},
    hipRoofs: 0, flatRoofs: 0, failedRoofs: 0, volumes: 0, tierVolumes: 0, mechVolumes: 0, estimatedMech: 0,
    doors: 0, storefrontEdges: 0, sunshades: 0, openings: 0,
  };
  for (const plan of plans) {
    if (plan.decision !== 'generated' || !plan.spec) continue;
    const rings = prepareRings(plan.building.rings);
    if (!rings) continue;
    const b = plan.building, spec = plan.spec;
    const key = `${Math.floor(b.center[0] / chunkSize)},${Math.floor(b.center[1] / chunkSize)}`;
    let chunk = chunks.get(key);
    if (!chunk) { chunk = { builders: new Map(), collider: new ColliderBuilder() }; chunks.set(key, chunk); }
    const target = chunk;
    const batch = (k: MaterialKey) => {
      let x = target.builders.get(k);
      if (!x) { x = new Batch(k.startsWith('wall:')); target.builders.set(k, x); }
      return x;
    };
    const before = [...target.builders.values()].reduce((s, x) => s + x.triangles, 0);
    const massing = blockMassing(b, rings) ?? buildMassing(b, rings, spec, options.roofs?.buildings[String(b.id)]);
    const source = buildArchitecture(b, rings, spec, massing, { batch, collider: target.collider, stats, ground, paths });
    const after = [...target.builders.values()].reduce((s, x) => s + x.triangles, 0);
    stats.trianglesByArchetype[spec.archetype] = (stats.trianglesByArchetype[spec.archetype] ?? 0) + after - before;
    stats.massing[massing.source]++;
    if (source.runs.length || source.eaves.length) {
      const cell = `${Math.floor(b.center[0] / detailCell)},${Math.floor(b.center[1] / detailCell)}`;
      let list = detail.get(cell);
      if (!list) detail.set(cell, list = []);
      list.push(source);
      const upper = source.runs.filter(r => r.type !== 'door' && r.floors.length > 1);
      for (const r of upper) {
        const h = r.floors[1] - r.floors[0];
        const range = stats.storeyRange[spec.archetype] ??= [h, h];
        range[0] = Math.min(range[0], h); range[1] = Math.max(range[1], h);
      }
    }
    stats.buildings++;
    stats.byStyle[spec.archetype] = (stats.byStyle[spec.archetype] ?? 0) + 1;
    stats.byBasis[spec.basis] = (stats.byBasis[spec.basis] ?? 0) + 1;
  }
  for (const chunk of chunks.values()) {
    for (const b of chunk.builders.values()) stats.triangles += b.triangles;
    stats.colliderTriangles += chunk.collider.triangles;
  }
  return { chunks, detail, detailCell, stats };
}
