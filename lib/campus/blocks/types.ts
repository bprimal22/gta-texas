// Whole-campus block contract (research/whole-campus-92/BLOCKS.md).
//
// The campus is partitioned into non-overlapping geographic blocks
// (tools/blocks/partition.mjs). Each block owner works ONLY inside
// lib/campus/blocks/<id>/, scripts/harness/blocks/<id>.ts, public/assets/blocks/<id>/ and the
// existing authored modules the manifest assigns to that block. Shared files (game.ts,
// walkway.ts, context catalog/materials, scans, vegetation, ground tie-ins) stay with the root
// integrator; this registry is the one place they meet, so parallel owners never edit them.
//
// Two ways a block changes the scene:
//  1. data (context.json, applied before anything is built): correct a GIS footprint, exclude a
//     demolished one, add a missing one, set its catalogue entry/archetype or explicit massing,
//     or declare that the block's own geometry replaces it;
//  2. geometry (index.ts install(), run after the authored walkway and before the generated
//     context, tie-ins and trees): authored buildings, ground, stairs and walls with colliders
//     built from the same triangles. Because block solids join world.group and block walkable
//     surfaces join walkway.surfaces, map travel, the scooter ground query, the context's
//     authored-coverage raster (no duplicate footprint) and tree placement all see them.
import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { CampusData, Point } from '../types';
import type { CatalogEntry, Archetype, RoofForm } from '../context/catalog';

export interface BlockInstallContext {
  data: CampusData;
  physics: RAPIER.World;
  /** Contour terrain height (same as world.terrain.height). */
  terrainHeight: (x: number, z: number) => number;
  /** Visible baked terrain height where the baked mesh covers (x, z), else the contour. */
  groundHeight: (x: number, z: number) => number;
  /** Existing authored roots, read-only: query them, never mutate other blocks' meshes. */
  authored: { surfaces: THREE.Object3D; world: THREE.Object3D };
  /** Existing named materials (walkway + world); reuse before creating new ones. */
  material: (name: string) => THREE.Material | undefined;
  renderer?: THREE.WebGLRenderer;
}

export interface BlockInstall {
  /** Solid authored bodies (walls, buildings, stairs) — each mesh must have a matching collider. */
  solids?: THREE.Object3D[];
  /** Walkable ground the player stands on (visible = physical). */
  walkable?: THREE.Object3D[];
  /** Visual-only detail that is never reachable (small trim inside solids, far roofs). */
  detail?: THREE.Object3D[];
  colliders: RAPIER.Collider[];
  /** Record keys ("<id>:<recordIndex>") or unambiguous ids whose generated building this geometry
   * actually rebuilt. Only these `replaces` entries are committed (the generated fallback stays otherwise). */
  replaced?: string[];
  /** Pre-existing colliders this block's surfaces intentionally rely on (named explicitly; checks accept only these). */
  reusedColliders?: RAPIER.Collider[];
  stats: Record<string, unknown>;
  /** Remove this block's own colliders (physics is still alive) and dispose its geometries. */
  dispose(): void;
}

export interface BlockModule {
  id: string;
  install(ctx: BlockInstallContext): BlockInstall | null;
}

export interface BlockMassingVolume {
  /** Plan ring [[x,z],...] in campus metres; omit (with `rings`) to use the (corrected) footprint. */
  ring?: Point[];
  /** Plan rings with holes: [outer, hole, ...] (courtyards). Takes precedence over `ring`. */
  rings?: Point[][];
  bottom: number; top: number; roof: RoofForm;
  role?: 'main' | 'tier' | 'mech';
  /** Facade composition for this wing: an existing catalogue archetype or one of this block's "<block>:name" archetypes. */
  archetype?: string;
  /** Hip rise per horizontal metre (hipped roofs). */
  slope?: number;
}

/** Evidence fields are mandatory: every change says what it rests on. */
export interface BlockEvidence { source: string; basis: 'measured' | 'official' | 'reference-interpreted' | 'estimate'; note?: string }

/** lib/campus/blocks/<id>/context.json */
export interface BlockContextData {
  block: string;
  /** GIS footprint replaced by a corrected outer ring (holes dropped unless given). */
  footprints?: Record<string, { rings: Point[][]; h?: number; evidence: BlockEvidence }>;
  /** Footprints that no longer exist (demolished) or are not buildings. */
  exclude?: Record<string, BlockEvidence>;
  /** Buildings missing from the GIS data, owned by this block. ids negative and unique (e.g. -101 for b01);
   * every vertex inside this block's rectangles. Keys in the other maps: numeric id only when unambiguous,
   * else the record key "<id>:<recordIndex>". */
  add?: { id: number; name: string; abbr: string; h: number; rings: Point[][]; evidence: BlockEvidence }[];
  /** Footprints the block's own install() geometry replaces (context skips them explicitly). */
  replaces?: Record<string, BlockEvidence>;
  /** Catalogue entry overrides for generated buildings (archetype must exist or be defined below). */
  catalog?: Record<string, Partial<CatalogEntry> & { evidence: BlockEvidence }>;
  /** New archetypes; keys must start with "<block id>:". */
  archetypes?: Record<string, Archetype>;
  /** Explicit massing for generated buildings (overrides LiDAR / campus.json height). */
  massing?: Record<string, { volumes: BlockMassingVolume[]; evidence: BlockEvidence;
    /** Height basis of top/bottom: "grade" (default; metres above the generator's median baked grade around
     * the footprint), "campusY" (absolute campus Y) or { aboveY } (metres above a stated campus-Y base). */
    datum?: 'grade' | 'campusY' | { aboveY: number } }>;
}
