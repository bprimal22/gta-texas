import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { CampusData } from './types';
import { BakedGround } from './baked-ground';
import { CoverageGrid, rasterizeMeshes } from './context-coverage';
import { planContextBuildings, buildContextGeometry, STADIUM_FOOTPRINTS, type ContextDecision } from './context-buildings';
import { buildStadiumBowl, type StadiumBowlOptions } from './stadium-bowl';
import { buildRoadInfill } from './road-infill';
import type { MeshBuilder, ColliderBuilder } from './context-geometry';
import type { RoofsLidar } from './context/massing';
import type { DetailSource, MaterialKey } from './context/architecture';
import { buildDetail, type DetailStats } from './context/detail';
import { Batch } from './context/batch';
import { contextUniforms } from './context/materials';
import { CATALOG } from './context/catalog';

export interface LocalContextOptions {
  data: CampusData;
  physics: RAPIER.World;
  /** Contour fallback for baked-terrain cutouts. */
  contourHeight: (x: number, z: number) => number;
  /** Baked terrain triangle positions (non-indexed). */
  bakedPositions: ArrayLike<number>;
  /** Authored architecture and walkable ground that must stay untouched. */
  authoredRoots: THREE.Object3D[];
  /** Visual road/path finishes. */
  finishRoots: THREE.Object3D[];
  /** Material lookup by key; omitted keys are skipped (headless checks). */
  material: (key: string) => THREE.Material | undefined;
  /** Measured roofs (lidar lane, public/data/derived/roofs-lidar.json); null falls back to campus.json heights. */
  roofs?: RoofsLidar | null;
  /** Stadium bowl options, e.g. a stand sector replaced by aligned photogrammetry. */
  stadium?: StadiumBowlOptions;
}

const SKIP_NAMES = ['Offline local contour terrain', 'Foreground broadleaf trees'];
/** Openings inside this radius are real recessed geometry; beyond it the wall shader draws them. */
export const DETAIL_RADIUS = 110;
const BUILD_RADIUS = 150, DROP_RADIUS = 210;

interface CellState { key: string; x0: number; z0: number; group?: THREE.Group; geometries?: THREE.BufferGeometry[]; triangles: number }

/** Lazily builds recessed opening geometry for detail cells around the camera
 * and keeps the wall shader's discard radius inside the built area, so a hole
 * is never shown without its reveal and glass behind it. */
class DetailManager {
  readonly group = new THREE.Group();
  private cells = new Map<string, CellState>();
  readonly stats = { built: 0, dropped: 0, resident: 0, residentTriangles: 0, radius: 0 };
  constructor(private sources: Map<string, DetailSource[]>, private cell: number,
    private material: (key: string) => THREE.Material | undefined) {
    this.group.name = 'Generated local context facade detail';
    this.group.userData.localContext = true;
    for (const key of sources.keys()) {
      const [i, j] = key.split(',').map(Number);
      this.cells.set(key, { key, x0: i * cell, z0: j * cell, triangles: 0 });
    }
  }
  private distance(c: CellState, x: number, z: number) {
    const dx = Math.max(c.x0 - x, 0, x - (c.x0 + this.cell)), dz = Math.max(c.z0 - z, 0, z - (c.z0 + this.cell));
    return Math.hypot(dx, dz);
  }
  /** Build one cell's merged batches (one mesh per material). */
  build(c: CellState, detailStats?: DetailStats) {
    const batches = new Map<MaterialKey, Batch>();
    const stats = detailStats ?? { windows: 0, doors: 0, brackets: 0, triangles: 0 };
    buildDetail(this.sources.get(c.key) ?? [], key => {
      let b = batches.get(key);
      if (!b) batches.set(key, b = new Batch(key.startsWith('wall:')));
      return b;
    }, stats);
    const group = new THREE.Group();
    group.name = `Local context detail ${c.key}`;
    group.userData.localContext = true;
    c.geometries = [];
    c.triangles = 0;
    for (const [key, b] of batches) {
      if (!b.triangles) continue;
      c.triangles += b.triangles;
      stats.triangles += b.triangles;
      const material = this.material(key);
      if (!material) continue;
      const geometry = b.geometry();
      c.geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `Local context detail ${c.key} ${key}`;
      mesh.castShadow = false; mesh.receiveShadow = true;
      mesh.userData.localContext = true;
      group.add(mesh);
    }
    c.group = group;
    this.group.add(group);
    this.stats.built++;
    return c.triangles;
  }
  private drop(c: CellState) {
    if (!c.group) return;
    this.group.remove(c.group);
    c.geometries?.forEach(g => g.dispose());
    c.group = undefined; c.geometries = undefined;
    this.stats.dropped++;
  }
  update(camera: { x: number; y: number; z: number }, budgetMs = 3) {
    const started = performance.now();
    let nearestMissing = Infinity;
    const pending: [number, CellState][] = [];
    for (const c of this.cells.values()) {
      const d = this.distance(c, camera.x, camera.z);
      if (c.group) { if (d > DROP_RADIUS) this.drop(c); continue; }
      if (d < BUILD_RADIUS) pending.push([d, c]);
    }
    pending.sort((a, b) => a[0] - b[0]);
    let builtOne = false;
    for (const [d, c] of pending) {
      if (builtOne && performance.now() - started > budgetMs) { nearestMissing = Math.min(nearestMissing, d); continue; }
      this.build(c);
      builtOne = true;
    }
    let resident = 0, tris = 0;
    for (const c of this.cells.values()) if (c.group) { resident++; tris += c.triangles; }
    this.stats.resident = resident; this.stats.residentTriangles = tris;
    this.stats.radius = Math.max(0, Math.min(DETAIL_RADIUS, nearestMissing - 2));
    contextUniforms.uCtxDetailRadius.value = this.stats.radius;
    contextUniforms.uCtxEye.value.set(camera.x, camera.y, camera.z);
  }
  /** Headless: build every cell once to measure detail geometry. */
  measureAll() {
    const stats: DetailStats = { windows: 0, doors: 0, brackets: 0, triangles: 0 };
    let maxCell = 0, nonFinite = 0, maxMs = 0, totalMs = 0;
    for (const c of this.cells.values()) {
      const t0 = performance.now();
      const t = this.build(c, stats);
      const ms = performance.now() - t0;
      maxMs = Math.max(maxMs, ms); totalMs += ms;
      maxCell = Math.max(maxCell, t);
      c.group?.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh) for (const v of m.geometry.getAttribute('position').array as Float32Array) if (!Number.isFinite(v)) nonFinite++;
      });
      this.drop(c);
    }
    return { ...stats, cells: this.cells.size, maxCellTriangles: maxCell, maxCellMs: Math.round(maxMs), meanCellMs: +(totalMs / Math.max(1, this.cells.size)).toFixed(1), nonFinite };
  }
  dispose() {
    for (const c of this.cells.values()) this.drop(c);
    contextUniforms.uCtxDetailRadius.value = 0;
  }
}

/** Generated context for the parts of the campus that have no authored
 * package: GIS-footprint buildings, the DKR stadium bowl and bare mapped roads. */
export function buildLocalContext(o: LocalContextOptions) {
  const started = performance.now();
  const ground = new BakedGround(o.bakedPositions, 8, o.contourHeight);
  const [west, north, east, south] = o.data.bounds;
  const grid = new CoverageGrid(west, north, east, south, 2);
  const skip = (object: THREE.Object3D) => SKIP_NAMES.includes(object.name) || object.userData.localContext === true;
  rasterizeMeshes(grid, o.authoredRoots, (x, z) => ground.height(x, z), 'authored', skip);
  rasterizeMeshes(grid, o.finishRoots, (x, z) => ground.height(x, z), 'finish', skip);
  const coverageMs = performance.now() - started;

  const plans = planContextBuildings(o.data.buildings, grid);
  const decisions: Record<ContextDecision, number> = { generated: 0, authored: 0, route: 0, stadium: 0, invalid: 0 };
  for (const p of plans) decisions[p.decision]++;
  const buildings = buildContextGeometry(plans, (x, z) => ground.height(x, z), { paths: o.data.paths, roofs: o.roofs });
  const stadium = buildStadiumBowl(o.data.buildings.filter(b => STADIUM_FOOTPRINTS.has(b.id)),
    (x, z) => ground.height(x, z), grid, o.stadium);
  const roads = buildRoadInfill(o.data.paths, grid, (x, z) => ground.height(x, z));

  const group = new THREE.Group();
  group.name = 'Generated local context';
  group.userData.localContext = true;
  // Solid geometry has matching colliders; finishes and facade detail are visual-only.
  const solid = new THREE.Group(), finish = new THREE.Group();
  solid.name = 'Generated local context solids'; finish.name = 'Generated local context road finishes';
  const detail = new DetailManager(buildings.detail, buildings.detailCell, o.material);
  group.add(solid, finish, detail.group);
  const geometries: THREE.BufferGeometry[] = [];
  const colliders: RAPIER.Collider[] = [];
  const drawCalls: Record<string, number> = {};
  const addMeshes = (builders: Map<string, MeshBuilder | Batch>, label: string, parent: THREE.Group, shadows = true) => {
    for (const [key, builder] of builders) {
      const material = o.material(key);
      if (!material || !builder.triangles) continue;
      const geometry = builder.geometry();
      geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `Local context ${label} ${key}`;
      mesh.castShadow = shadows; mesh.receiveShadow = true;
      mesh.userData.localContext = true;
      if (material.userData.facadeDepth) mesh.customDepthMaterial = material.userData.facadeDepth;
      parent.add(mesh);
      drawCalls[key] = (drawCalls[key] ?? 0) + 1;
    }
  };
  const addCollider = (collider: ColliderBuilder) => {
    if (!collider.triangles) return;
    const vertices = new Float32Array(collider.position);
    const indices = new Uint32Array(vertices.length / 3).map((_, i) => i);
    colliders.push(o.physics.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.8)));
  };
  for (const [key, chunk] of buildings.chunks) {
    addMeshes(chunk.builders as Map<string, Batch>, `buildings ${key}`, solid);
    addCollider(chunk.collider);
  }
  addMeshes(stadium.builders as Map<string, MeshBuilder>, 'stadium', solid);
  addCollider(stadium.collider);
  const roadBuilders = new Map<string, MeshBuilder>([['roadAsphalt', roads.asphalt]]);
  addMeshes(roadBuilders, 'roads', finish, false);
  for (const child of finish.children) child.renderOrder = 1;

  const generated = plans.filter(p => p.decision === 'generated');
  const stats = {
    decisions,
    styles: buildings.stats.byStyle,
    basis: buildings.stats.byBasis,
    catalogBasis: CATALOG.stats.basis,
    massing: buildings.stats.massing,
    roofsLidar: o.roofs ? 'loaded' : 'absent (campus.json heights)',
    buildingTriangles: buildings.stats.triangles,
    trianglesByArchetype: buildings.stats.trianglesByArchetype,
    storeyRange: buildings.stats.storeyRange,
    hipRoofs: buildings.stats.hipRoofs,
    flatRoofs: buildings.stats.flatRoofs,
    failedRoofs: buildings.stats.failedRoofs,
    volumes: buildings.stats.volumes,
    tierVolumes: buildings.stats.tierVolumes,
    mechVolumes: buildings.stats.mechVolumes,
    estimatedMech: buildings.stats.estimatedMech,
    openings: buildings.stats.openings,
    doors: buildings.stats.doors,
    storefrontEdges: buildings.stats.storefrontEdges,
    sunshades: buildings.stats.sunshades,
    detailCells: buildings.detail.size,
    stadium: stadium.stats,
    roads: roads.stats,
    meshes: solid.children.length + finish.children.length,
    drawCallsByMaterial: drawCalls,
    colliders: colliders.length,
    colliderTriangles: buildings.stats.colliderTriangles + stadium.stats.colliderTriangles,
    coverageTriangles: grid.triangles,
    coverageMs: Math.round(coverageMs),
    totalMs: Math.round(performance.now() - started),
    /** Named footprints left to authored packages (for review). */
    authoredNamed: plans.filter(p => p.decision === 'authored' && p.building.abbr).map(p => p.building.abbr),
    routeNamed: plans.filter(p => p.decision === 'route').map(p => p.building.abbr || p.building.id),
    generatedNamed: generated.filter(p => p.building.abbr).map(p => p.building.abbr),
  };
  let disposed = false;
  return {
    group, solid, detailGroup: detail.group, colliders, stats, grid, plans,
    /** Opening layout shared by the wall shader attributes and the detail geometry. */
    detailSources: buildings.detail,
    /** Call once per frame with the camera position (streams facade detail). */
    update(camera: { x: number; y: number; z: number }) { if (!disposed) detail.update(camera); },
    detailStats: () => ({ ...detail.stats }),
    /** Headless measurement of the full detail layer. */
    measureDetail: () => detail.measureAll(),
    dispose(physics?: RAPIER.World) {
      if (disposed) return;
      disposed = true;
      detail.dispose();
      geometries.forEach(g => g.dispose());
      if (physics) for (const c of colliders) if (physics.colliders.contains(c.handle)) physics.removeCollider(c, false);
    },
  };
}
