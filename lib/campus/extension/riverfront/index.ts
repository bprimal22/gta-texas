import * as THREE from 'three';
import { decodeRiverfront, type RiverfrontData } from './format';
import { RiverfrontBounds } from './bounds';
import { approach, dock, garage, gazebo, longCenter, palmer, Soup } from './landmarks';
import type { DowntownBuilding, DowntownData } from '../downtown/format';
import { buildingChunk, DowntownTerrain, rangeRaycast, terrainChunk, terrainRaycast } from '../downtown/geometry';
import { createFacadeMaterial, createGroundMaterial, createWaterMaterial } from '../downtown/materials';
import { pflugerCovers } from '../downtown/pfluger-bridge';
import type { Downtown } from '../downtown';
import type { DowntownBackground } from '../downtown/background';
import type { TreeForm } from '../../vegetation/oak-forms';
import type { TreeMaterials } from '../../vegetation/tree-materials';
import type { ImpostorSet, TreeBatches } from '../../vegetation/tree-batches';
import { deepWestTreeBatches, planDeepWestTrees, type DeepWestTreePlan } from '../west-campus/trees';
import type { TreeRecord } from '../west-campus/format';

/** Central riverfront extension: Lady Bird Lake's south bank between the Lamar and South First bridges (Auditorium
 * Shores / Vic Mathias Shores, Butler Metro Park, the Butler Trail), the Pfluger bridge crossing and the river reach
 * between the banks (flight only; water never lands). Layered on the downtown extension and bound to its asset; the
 * caller commits it transactionally after downtown (and the backdrop) and keeps the original world on any failure. */
export const RIVERFRONT_URL = '/assets/extension/riverfront-v1.bin.gz';
/** Pond barriers stand 1.2 m above the pond surface; a target-less descent over a pond holds above them. */
export const POND_BED_CLEARANCE = 1.5;
const WATER = 5;
/** Place keys drawn as map area labels. */
export const MAP_LABELS = ['auditorium-shores', 'butler-park'];

type Point = [number, number];
export interface RiverfrontMaterials {
  grass: THREE.MeshStandardMaterial; asphalt: THREE.MeshStandardMaterial; concrete: THREE.MeshStandardMaterial;
  envMap: THREE.Texture | null;
}
type Collider = { name: string; position: Float32Array; index: Uint32Array };

function inRing([x, z]: Point, ring: Point[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const inRings = (p: Point, rings: Point[][]) => inRing(p, rings[0]) && !rings.slice(1).some(r => inRing(p, r));
function nearFootprint(p: Point, rings: Point[][], d = .8) {
  if (inRings(p, rings)) return true;
  return rings.some(r => r.some((a, i) => {
    const b = r[(i + 1) % r.length], dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz;
    const t = L ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L)) : 0;
    return Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]) < d;
  }));
}

/** Grid view of the riverfront terrain in the shape the downtown chunk builder expects. */
function gridData(data: RiverfrontData) {
  return { meta: { grid: data.meta.grid, step: data.meta.step, rect: data.meta.rect }, heights: data.heights, cellFlags: data.cellFlags } as unknown as DowntownData;
}

export interface RiverfrontGeometry {
  data: RiverfrontData;
  bounds: RiverfrontBounds;
  terrain: DowntownTerrain;
  ground: ReturnType<typeof terrainChunk>;
  solids: { geometry: THREE.BufferGeometry; collider: Collider; triangles: number; colliderTriangles: number };
  ponds: THREE.BufferGeometry;
  buildings: ReturnType<typeof buildingChunk>;
  /** Footprints that are not open ground (travel arrivals avoid them): new models and west buildings. */
  footprints: Point[][][];
  models: { longCenter: ReturnType<typeof longCenter>; palmer: ReturnType<typeof palmer>; gazebo: ReturnType<typeof gazebo>; garage: ReturnType<typeof garage> };
}

/** Pure geometry (no materials, no GPU): the game and Node checks both use it. */
export function buildRiverfrontGeometry(data: RiverfrontData): RiverfrontGeometry {
  const m = data.meta, grid = gridData(data);
  const terrain = new DowntownTerrain(grid);
  const height = (x: number, z: number) => terrain.height(x, z) ?? m.water.y;
  const ground = terrainChunk(grid, 0, m.grid.nx - 1, 0, m.grid.nz - 1);
  const s = new Soup();
  const lc = longCenter(s, m.landmarks.longCenter, height);
  const pm = palmer(s, m.landmarks.palmer, height);
  const gz = gazebo(s, m.landmarks.gazebo, height);
  const ga = garage(s, m.landmarks.garage, height);
  for (const d of m.docks) dock(s, d);
  for (const a of m.pfluger.approaches) approach(s, a, height);
  const geometry = s.geometry();
  const position = geometry.getAttribute('position').array as Float32Array;
  // Ponds: static water surfaces (decor) over the lowered pond beds.
  const pos: number[] = [];
  for (const p of m.ponds) for (const rings of p.water) {
    const contour = rings[0].map(([x, z]) => new THREE.Vector2(x, z)), holes = rings.slice(1).map(r => r.map(([x, z]) => new THREE.Vector2(x, z)));
    const all = [contour, ...holes].flat();
    // XY -> XZ reverses the normal: wind the water toward +Y so the front-sided water material is visible above.
    for (const t of THREE.ShapeUtils.triangulateShape(contour, holes)) for (const k of [t[0], t[2], t[1]]) pos.push(all[k].x, p.surfaceY, all[k].y);
  }
  const ponds = new THREE.BufferGeometry();
  ponds.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  ponds.computeVertexNormals(); ponds.computeBoundingSphere();
  // West of x = -1760: City 2023 footprints (single MAX_HEIGHT), drawn with the downtown facade shader.
  const recs: DowntownBuilding[] = m.buildings.map(b => ({ k: b.k, src: 'coa2023', id: b.id, g: b.g, basis: 'coa', kind: '', name: '', visual: false, c: 0,
    tiers: [{ r: b.r, y: b.y, f: 'punched', w: [196, 186, 164], a: [44, 52, 58] }] }));
  const buildings = buildingChunk(recs);
  const lcRings: Point[][][] = [[lc.podium as Point[]], ...m.landmarks.longCenter.volumes.filter(v => v.name === 'hall' || v.name === 'stage').map(v => [v.r as Point[]])];
  const footprints: Point[][][] = [...lcRings, [pm.hall as Point[]], [m.landmarks.garage.r as Point[]], ...m.buildings.map(b => b.r as Point[][])];
  return { data, bounds: new RiverfrontBounds(m.edges), terrain, ground,
    solids: { geometry, collider: { name: 'Riverfront landmarks (Long Center, Palmer, garage, gazebo, docks, Pfluger approaches)', ...s.collider(position) },
      triangles: s.triangles, colliderTriangles: s.solid.length },
    ponds, buildings, footprints, models: { longCenter: lc, palmer: pm, gazebo: gz, garage: ga } };
}

/** Lawn variation for the open park lawns (root CUA reference: large, patchy, partly dry lawns rather than a uniform
 * dark green): a static low-frequency tint on lawn classes only. Same shader otherwise (one extra program). */
function createRiverfrontGround(options: Parameters<typeof createGroundMaterial>[0]) {
  const g = createGroundMaterial(options);
  const base = g.material.onBeforeCompile.bind(g.material);
  g.material.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    shader.fragmentShader = shader.fragmentShader
      // Pale concrete and warm decomposed granite keep the measured walks distinct from the lawn, with subdued grain.
      .replace('vec3 concrete = texture2D(dtConcrete, wuv).rgb * dtConcreteTint *', 'vec3 concrete = mix(vec3(.32, .30, .26), texture2D(dtConcrete, wuv).rgb * dtConcreteTint, .2) *')
      .replace('vec3 trail = texture2D(dtConcrete, wuv * .7).rgb * dtConcreteTint * vec3(1.02, .86, .64);', 'vec3 trail = mix(vec3(.35, .29, .20), texture2D(dtConcrete, wuv * .7).rgb * dtConcreteTint * vec3(1.02, .86, .64), .2);')
      .replace('float dtCls(ivec2 p)', `float rfN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5), b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7))) * 43758.5);
  float c = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7))) * 43758.5), d = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7))) * 43758.5);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
float dtCls(ivec2 p)`)
      .replace('diffuseColor.rgb = diffuseColor.rgb * s.x', `float rfDry = smoothstep(.42, .78, rfN(vDtWorld.xz / 38.) * .65 + rfN(vDtWorld.xz / 9.) * .35);
  vec3 rfLawn = mix(vec3(1.), vec3(1.32, 1.12, .72), rfDry * .55);
  diffuseColor.rgb = diffuseColor.rgb * rfLawn * s.x`);
  };
  g.material.customProgramCacheKey = () => 'riverfront-ground-v1';
  g.material.name = 'Riverfront ground';
  return g;
}

/** Changes the riverfront makes to downtown and the backdrop, prepared (pure) before commit, applied/reverted as one. */
export interface RiverfrontOverlay {
  colliders: Collider[];
  capsules: { x: number; y: number; z: number; height: number; radius: number }[];
  /** Downtown tree indices hidden while applied (trunks in modelled pond water). */
  hiddenTrees: number[];
  stats: Record<string, number>;
  apply(): void;
  revert(): void;
  /** Release prepared geometry that was never applied (failed commit). */
  discard(): void;
}

export class Riverfront {
  /** Ground and solids (terrain, landmark solids, west buildings): joins world.group. */
  readonly group = new THREE.Group();
  /** Ponds and trees: rendered, never ground. */
  readonly decor = new THREE.Group();
  readonly bounds: RiverfrontBounds;
  readonly colliders: Collider[] = [];
  readonly treeTrunks: { x: number; y: number; z: number; height: number; radius: number }[] = [];
  trees: TreeBatches | null = null;
  treePlan: DeepWestTreePlan | null = null;
  readonly travelRegion: { contains: (p: Point) => boolean; footprints: Point[][][]; outdoor: (p: Point) => boolean };
  readonly stats: Record<string, unknown>;
  private readonly ownMaterials: THREE.Material[] = [];
  private readonly ownTextures: THREE.Texture[] = [];
  private readonly lod: { object: THREE.Object3D; center: THREE.Vector3; distance: number }[] = [];
  private readonly land: Point[][];
  private overlay: RiverfrontOverlay | null = null;
  private mapImage: HTMLCanvasElement | null = null;
  private disposed = false;
  private extraFootprints: Point[][][] = [];
  get meta() { return this.built.data.meta; }
  get data() { return this.built.data; }
  get geometry() { return this.built; }

  constructor(private readonly built: RiverfrontGeometry, materials: RiverfrontMaterials, decodeMs: number) {
    const data = built.data, meta = data.meta;
    this.bounds = built.bounds;
    this.land = meta.land as Point[][];
    this.group.name = 'Riverfront extension (CoA 2023 + USGS 3DEP + 2017 LiDAR)';
    this.decor.name = 'Riverfront ponds and trees';
    const ground = createRiverfrontGround({ grass: materials.grass, asphalt: materials.asphalt, concrete: materials.concrete,
      classMap: data.classMap, width: meta.classMap.w, height: meta.classMap.h, origin: [meta.rect.xmin, meta.rect.zmin], res: meta.classMap.res });
    const solid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .78, metalness: .02, side: THREE.DoubleSide, envMap: materials.envMap, envMapIntensity: .35 });
    solid.name = 'Riverfront landmarks';
    const water = createWaterMaterial(materials.envMap); water.name = 'Riverfront ponds';
    const facade = createFacadeMaterial(materials.envMap); facade.name = 'Riverfront west buildings';
    this.ownMaterials.push(ground.material, solid, water, facade); this.ownTextures.push(ground.texture);
    let drawCalls = 0;
    if (!built.ground.render) throw new Error('Riverfront terrain is empty');
    const terrainMesh = new THREE.Mesh(built.ground.render, ground.material);
    terrainMesh.name = 'Riverfront terrain'; terrainMesh.receiveShadow = true;
    terrainRaycast(terrainMesh, built.terrain);
    this.group.add(terrainMesh); drawCalls++;
    if (built.ground.collider) this.colliders.push({ name: 'Riverfront terrain', ...built.ground.collider });
    const solids = new THREE.Mesh(built.solids.geometry, solid);
    solids.name = 'Riverfront landmarks (Long Center, Palmer, garage, gazebo, docks, Pfluger approaches)'; solids.castShadow = true; solids.receiveShadow = true;
    this.group.add(solids); drawCalls++;
    this.colliders.push(built.solids.collider);
    let buildingTriangles = 0;
    for (const batch of [built.buildings.major, built.buildings.minor]) {
      if (!batch.triangles) continue;
      const g = batch.geometry();
      const mesh = new THREE.Mesh(g, facade); mesh.name = 'Riverfront west buildings (CoA 2023)'; mesh.castShadow = true; mesh.receiveShadow = true;
      rangeRaycast(mesh, batch.ranges);
      this.group.add(mesh); drawCalls++; buildingTriangles += batch.triangles;
      const position = g.getAttribute('position').array as Float32Array;
      this.colliders.push({ name: mesh.name, position, index: Uint32Array.from({ length: position.length / 3 }, (_, i) => i) });
    }
    const pondMesh = new THREE.Mesh(built.ponds, water);
    pondMesh.name = 'Riverfront ponds (Liz Carpenter Pond, Palmer pond)'; pondMesh.receiveShadow = true;
    this.decor.add(pondMesh); drawCalls++;
    this.lod.push({ object: pondMesh, center: built.ponds.boundingSphere!.center.clone(), distance: 1800 });
    this.travelRegion = {
      contains: ([x, z]) => Number.isFinite(x) && Number.isFinite(z) && inRings([x, z], this.land) && this.bounds.legal(x, z, 2),
      footprints: built.footprints,
      outdoor: p => this.outdoor(p),
    };
    this.stats = {
      loaded: true, rect: meta.rect, landAreaM2: Math.round(ringsArea(this.land)), cells: meta.counts.cells, ownedDowntownCells: data.ownedDowntownCells.length,
      sharedVerticesFloatIdentical: data.sharedVertices, terrainTriangles: built.ground.triangles, terrainColliderTriangles: built.ground.colliderTriangles,
      landmarkTriangles: built.solids.triangles, landmarkColliderTriangles: built.solids.colliderTriangles, buildingTriangles,
      pondTriangles: built.ponds.getAttribute('position').count / 3, drawCalls, colliders: this.colliders.length,
      walls: meta.walls.length, downtownWalls: meta.downtownWalls.length, barriers: meta.barriers.length,
      asset: { url: RIVERFRONT_URL, bytes: data.bytes, checksum: data.checksum }, decodeMs, buildMs: 0, claims: meta.claims,
    };
  }

  /** Park/trail outdoors for map travel: on the land, off water (lake and ponds) and away from footprints. */
  private outdoor([x, z]: Point) {
    if (!this.travelRegion.contains([x, z]) || this.isWater(x, z)) return false;
    return ![...this.built.footprints, ...this.extraFootprints].some(f => nearFootprint([x, z], f));
  }

  /** Mapped water (lake reach and ponds) in this extension's rectangle. */
  isWater(x: number, z: number) {
    const m = this.meta, i = Math.floor((x - m.rect.xmin) / m.classMap.res), j = Math.floor((z - m.rect.zmin) / m.classMap.res);
    return !this.disposed && i >= 0 && j >= 0 && i < m.classMap.w && j < m.classMap.h && this.data.classMap[j * m.classMap.w + i] === WATER;
  }
  /** Water bed top for flight water safety: a pond's own level, else the lake's (downtown bedTop). */
  bedTopAt(x: number, z: number, lakeBedTop: number) {
    for (const p of this.meta.ponds) if (inRing([x, z], p.ring as Point[])) return p.surfaceY + POND_BED_CLEARANCE;
    return lakeBedTop;
  }

  /** Terrain height where the riverfront renders (owned cells); null elsewhere. */
  height(x: number, z: number) { return !this.disposed && this.built.terrain.rendered(x, z) ? this.built.terrain.height(x, z) : null; }
  contains(x: number, z: number) { return !this.disposed && this.bounds.contains(x, z); }

  /** West-of-Lamar-seam LiDAR canopy trees with the campus forms (scene decor; trunks collide). */
  installTrees(vegetation: { forms: TreeForm[]; materials: TreeMaterials; impostors: ImpostorSet | null } | null) {
    if (this.disposed || this.trees || !vegetation) return;
    const t = this.data.trees, records: TreeRecord[] = [];
    for (let i = 0; i < t.length / 6; i++) records.push([t[i * 6], t[i * 6 + 2], t[i * 6 + 3], t[i * 6 + 4], 14]);
    const plan = planDeepWestTrees(records, vegetation.forms, (x, z) => this.height(x, z));
    this.treePlan = plan;
    this.trees = deepWestTreeBatches(plan, vegetation.forms, vegetation.materials, vegetation.impostors);
    this.trees.group.name = 'Riverfront trees (LiDAR canopy, campus forms)';
    this.decor.add(this.trees.group);
    for (const c of plan.capsules) this.treeTrunks.push({ x: c.a.x, y: c.a.y, z: c.a.z, height: c.b.y - c.a.y, radius: c.radius });
    Object.assign(this.stats, { trees: plan.placed.length, treeColliders: this.treeTrunks.length, treeDraws: this.trees.impostor ? 3 : 2 });
  }

  /** Pure preparation of the downtown/backdrop overlay: ownership cut, placeholder removal, extra colliders. Throws on any
   * contract mismatch (nothing is changed until apply()). */
  prepareOverlay(downtown: Downtown, background: DowntownBackground | null): RiverfrontOverlay {
    const data = this.data, meta = this.meta, src = downtown.source, dd = src.data;
    const owned = new Uint8Array(dd.cellFlags.length);
    for (const c of data.ownedDowntownCells) owned[c] = 1;
    const dnx1 = dd.meta.grid.nx - 1;
    // 1. Downtown terrain chunks without the owned cells (render only; owned cells were never downtown-collidable).
    const flags = Uint8Array.from(dd.cellFlags);
    for (const c of data.ownedDowntownCells) { if (flags[c] & 2) throw new Error('owned cell is downtown-collidable'); flags[c] &= ~1; }
    const cut = { ...dd, cellFlags: flags } as DowntownData;
    const swaps: { mesh: THREE.Mesh; old: THREE.BufferGeometry; next: THREE.BufferGeometry }[] = [];
    let removedTriangles = 0;
    for (const t of downtown.terrainMeshes) {
      let any = false;
      for (let j = t.j0; j < t.j1 && !any; j++) for (let i = t.i0; i < t.i1; i++) if (owned[j * dnx1 + i]) { any = true; break; }
      if (!any) continue;
      const chunk = terrainChunk(cut, t.i0, t.i1, t.j0, t.j1);
      const next = chunk.render ?? new THREE.BufferGeometry();
      removedTriangles += (t.mesh.geometry.index?.count ?? 0) / 3 - chunk.triangles;
      swaps.push({ mesh: t.mesh, old: t.mesh.geometry, next });
    }
    if (removedTriangles !== data.ownedDowntownCells.length * 2) throw new Error(`downtown terrain cut removed ${removedTriangles} triangles, expected ${data.ownedDowntownCells.length * 2}`);
    // 2. Placeholders replaced by the modelled landmarks: collapse their triangles (restorable).
    const collapses: { attr: THREE.BufferAttribute; start: number; saved: Float32Array }[] = [];
    const collapse = (r: { mesh: THREE.Mesh; start: number; count: number }) => {
      const attr = r.mesh.geometry.getAttribute('position') as THREE.BufferAttribute, arr = attr.array as Float32Array;
      collapses.push({ attr, start: r.start * 9, saved: arr.slice(r.start * 9, (r.start + r.count) * 9) });
    };
    for (const rep of meta.downtownReplace) {
      const r = downtown.buildingRanges.get(rep.k);
      if (!r || !r.visual) throw new Error(`downtown placeholder ${rep.k} missing or collidable`);
      collapse(r);
    }
    // 3. Extra colliders: visual-only downtown buildings and bridge-soup triangles on the land; owned visual trees.
    const colliders: Collider[] = [];
    for (const k of meta.downtownCollide) {
      const r = downtown.buildingRanges.get(k);
      if (!r || !r.visual) throw new Error(`downtown building ${k} missing or already collidable`);
      const arr = r.mesh.geometry.getAttribute('position').array as Float32Array;
      const position = arr.slice(r.start * 9, (r.start + r.count) * 9);
      colliders.push({ name: `Riverfront: downtown building ${k}`, position, index: Uint32Array.from({ length: position.length / 3 }, (_, i) => i) });
      const ring = dd.meta.buildings.find(b => b.k === k)!.tiers[0].r as Point[][];
      this.extraFootprints.push(ring);
    }
    const bt: number[] = [];
    for (const t of meta.downtownBridgeTriangles) {
      const b = dd.bridges;
      if (dd.bridgeCollide[t]) continue;
      if (pflugerCovers((b[t * 9] + b[t * 9 + 3] + b[t * 9 + 6]) / 3, (b[t * 9 + 2] + b[t * 9 + 5] + b[t * 9 + 8]) / 3)) continue;
      bt.push(...b.subarray(t * 9, t * 9 + 9));
    }
    if (bt.length) colliders.push({ name: 'Riverfront: bridge decks over the land', position: Float32Array.from(bt), index: Uint32Array.from({ length: bt.length / 3 }, (_, i) => i) });
    const capsules: RiverfrontOverlay['capsules'] = [];
    const plan = downtown.treePlan;
    // Downtown trees whose trunk point falls inside a modelled pond (a 2017 canopy peak of a bank tree overhanging the
    // LiDAR water void): hidden at every LOD while the riverfront is applied. Crowns of shore trees stay.
    const inPond = (x: number, z: number) => meta.ponds.some(p => inRing([x, z], p.ring as Point[]));
    const pondTrees = plan ? plan.placed.flatMap((t, i) => inPond(t.x, t.z) ? [i] : []) : [];
    if (pondTrees.length && !downtown.trees) throw new Error('downtown tree batches missing');
    if (plan) plan.placed.forEach((t, i) => {
      if (plan.playable[i] || !inRings([t.x, t.z], this.land) || this.isWater(t.x, t.z) || inPond(t.x, t.z)) return;
      const c = plan.allCapsules[i];
      capsules.push({ x: c.a.x, y: c.a.y, z: c.a.z, height: c.b.y - c.a.y, radius: c.radius });
    });
    // 4. Backdrop: terrain cells fully under the riverfront terrain, and the building boxes on the land.
    const bgSwaps: typeof swaps = [];
    if (background) {
      const g = background.grid, bm = g.meta, bflags = Uint8Array.from(g.cellFlags), bnx1 = bm.grid.nx - 1;
      let cutCells = 0;
      for (let j = 0; j < bm.grid.nz - 1; j++) for (let i = 0; i < bnx1; i++) {
        const k = j * bnx1 + i;
        if (!(bflags[k] & 1)) continue;
        const x0 = bm.rect.xmin + i * bm.step, z0 = bm.rect.zmin + j * bm.step;
        if (x0 + bm.step > meta.seam.x || x0 < meta.rect.xmin || z0 < meta.rect.zmin || z0 + bm.step > meta.rect.zmax) continue;
        const pts: Point[] = [[x0, z0], [x0 + bm.step, z0], [x0, z0 + bm.step], [x0 + bm.step, z0 + bm.step], [x0 + bm.step / 2, z0 + bm.step / 2]];
        if (pts.every(([x, z]) => this.height(x, z) !== null)) { bflags[k] &= ~1; cutCells++; }
      }
      const bcut = { ...g, cellFlags: bflags } as DowntownData;
      for (const t of background.terrainMeshes) {
        const chunk = terrainChunk(bcut, t.i0, t.i1, t.j0, t.j1);
        if (chunk.triangles === (t.mesh.geometry.index?.count ?? 0) / 3) { chunk.render?.dispose(); continue; }
        bgSwaps.push({ mesh: t.mesh, old: t.mesh.geometry, next: chunk.render ?? new THREE.BufferGeometry() });
      }
      for (const k of meta.backgroundSuppress) { const r = background.buildingRanges.get(k); if (r) collapse(r); }
      Object.assign(this.stats, { backgroundCutCells: cutCells });
    }
    const excluded = owned;
    let applied = false;
    const overlay: RiverfrontOverlay = {
      colliders, capsules,
      hiddenTrees: pondTrees,
      stats: { hiddenPondTrees: pondTrees.length, downtownTerrainTrianglesRemoved: removedTriangles, collapsedRanges: collapses.length, extraColliders: colliders.length, ownedTreeCapsules: capsules.length, backgroundSwaps: bgSwaps.length },
      apply: () => {
        if (applied) return;
        applied = true;
        for (const s of [...swaps, ...bgSwaps]) s.mesh.geometry = s.next;
        src.terrain.excluded = excluded;
        for (const c of collapses) {
          // Every vertex of the range onto its first vertex: zero-area triangles, nothing drawn or hit.
          const a = c.attr.array as Float32Array;
          for (let k = c.start + 3; k < c.start + c.saved.length; k += 3) { a[k] = a[c.start]; a[k + 1] = a[c.start + 1]; a[k + 2] = a[c.start + 2]; }
          c.attr.needsUpdate = true;
        }
        for (const rep of meta.downtownReplace) downtown.mapHidden.add(rep.k);
        for (const i of pondTrees) downtown.trees!.setHidden(i, true);
        this.overlay = overlay;
      },
      revert: () => {
        if (!applied) return;
        applied = false;
        for (const s of [...swaps, ...bgSwaps]) { s.mesh.geometry = s.old; s.next.dispose(); }
        src.terrain.excluded = null;
        for (const c of collapses) { (c.attr.array as Float32Array).set(c.saved, c.start); c.attr.needsUpdate = true; }
        for (const rep of meta.downtownReplace) downtown.mapHidden.delete(rep.k);
        for (const i of pondTrees) downtown.trees?.setHidden(i, false);
      },
      discard: () => { if (!applied) for (const s of [...swaps, ...bgSwaps]) s.next.dispose(); },
    };
    return overlay;
  }

  update(camera: THREE.Vector3, view?: THREE.Camera) {
    for (const l of this.lod) l.object.visible = Math.hypot(camera.x - l.center.x, camera.z - l.center.z) < l.distance;
    if (view && !this.disposed) this.trees?.update(view);
  }

  drawMap(ctx: CanvasRenderingContext2D) {
    if (typeof document === 'undefined') return;
    const m = this.meta;
    if (!this.mapImage) {
      const S = 2, w = Math.floor(m.classMap.w / S), h = Math.floor(m.classMap.h / S);
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const c = canvas.getContext('2d'); if (!c) return;
      const img = c.createImageData(w, h);
      const pal: Record<number, number[]> = { 0: [39, 53, 43], 1: [92, 97, 94], 2: [143, 141, 127], 3: [150, 140, 120], 4: [130, 118, 92], 5: [54, 92, 128], 6: [52, 82, 52], 7: [193, 188, 166], 8: [96, 99, 96] };
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const x = m.rect.xmin + (i + .5) * S, z = m.rect.zmin + (j + .5) * S, o = (j * w + i) * 4;
        const owned = this.built.terrain.rendered(x, z) || this.isWater(x, z) && this.bounds.contains(x, z);
        const p = pal[this.data.classMap[(j * S) * m.classMap.w + i * S]] ?? pal[0];
        img.data[o] = p[0]; img.data[o + 1] = p[1]; img.data[o + 2] = p[2]; img.data[o + 3] = owned ? 255 : 0;
      }
      c.putImageData(img, 0, 0);
      this.mapImage = canvas;
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.mapImage, m.rect.xmin, m.rect.zmin, m.classMap.w * m.classMap.res, m.classMap.h * m.classMap.res);
    ctx.fillStyle = '#c1bca6';
    ctx.beginPath();
    for (const f of this.built.footprints) for (const r of f) { r.forEach(([x, z], i) => i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)); ctx.closePath(); }
    ctx.fill('evenodd');
    ctx.restore();
  }

  /** Area names for the travel map: Auditorium Shores and Butler Park only (the other places stay HUD names). */
  mapLabels() {
    return this.disposed ? [] : this.meta.places.filter(p => MAP_LABELS.includes(p.key)).map(p => ({ name: p.name, p: p.p }));
  }

  /** HUD name: nearest named place within 130 m, else the riverfront. */
  locationName(x: number, z: number) {
    let best = '', d = 130;
    for (const p of this.meta.places) { const dd = Math.hypot(p.p[0] - x, p.p[1] - z); if (dd < d) { d = dd; best = p.name; } }
    return best ? `Riverfront · ${best}` : 'Lady Bird Lake riverfront';
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.overlay?.revert(); this.overlay = null;
    this.group.removeFromParent(); this.decor.removeFromParent();
    this.trees?.dispose(); this.trees = null;
    this.group.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
    this.decor.traverse(o => { if ((o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.Mesh).geometry.dispose(); });
    for (const m of this.ownMaterials) m.dispose();
    for (const t of this.ownTextures) t.dispose();
    this.mapImage = null;
  }
  get isDisposed() { return this.disposed; }
}

function ringsArea(rings: Point[][]) {
  const a = (r: Point[]) => { let s = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; s += p[0] * q[1] - q[0] * p[1]; } return Math.abs(s / 2); };
  return a(rings[0]) - rings.slice(1).reduce((s, r) => s + a(r), 0);
}

async function fetchBytes(url: string, signal?: AbortSignal) {
  if (!url.startsWith('/') || url.startsWith('//')) throw new Error('Riverfront asset must be same-origin');
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Riverfront asset load failed: ${response.status}`);
  const zipped = await response.arrayBuffer(), bytes = new Uint8Array(zipped);
  return bytes[0] === 0x1f && bytes[1] === 0x8b
    ? await new Response(new Blob([zipped]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : zipped;
}

/** Fetch, validate against the loaded downtown data, and build (no side effects on downtown). Throws (fail closed). */
export async function loadRiverfront(options: { materials: RiverfrontMaterials; downtown: DowntownData; signal?: AbortSignal; url?: string }) {
  const start = performance.now();
  const buffer = await fetchBytes(options.url ?? RIVERFRONT_URL, options.signal);
  const data = decodeRiverfront(buffer, options.downtown);
  const decodeMs = performance.now() - start;
  const built = buildRiverfrontGeometry(data);
  try {
    const r = new Riverfront(built, options.materials, decodeMs);
    r.stats.buildMs = performance.now() - start - decodeMs;
    return r;
  } catch (error) {
    built.ground.render?.dispose(); built.solids.geometry.dispose(); built.ponds.dispose();
    throw error;
  }
}
