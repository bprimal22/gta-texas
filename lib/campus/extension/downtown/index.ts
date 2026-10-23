import * as THREE from 'three';
import { decodeDowntown, type DowntownBuilding, type DowntownData, type StripSeamSource } from './format';
import { DowntownBounds } from './bounds';
import { bridgeGeometry, buildingChunk, DowntownTerrain, rangeRaycast, terrainChunk, terrainRaycast, waterGeometry } from './geometry';
import { createFacadeMaterial, createGroundMaterial, createWaterMaterial } from './materials';
import type { TreeForm } from '../../vegetation/oak-forms';
import type { TreeMaterials } from '../../vegetation/tree-materials';
import type { ImpostorSet, TreeBatches } from '../../vegetation/tree-batches';
import { buildPflugerGeometry, createPflugerMaterials, pflugerCovers, type PflugerGeometry } from './pfluger-bridge';
import { downtownTreeBatches, planDowntownTrees, type DowntownTreePlan } from './trees';

/** Downtown Austin extension: Capitol strip seam (z = 1536) south to the Lady Bird Lake shoreline,
 * Lamar/Shoal Creek (x = -1760) east to the I-35 southbound frontage road. Same-origin, fail-closed:
 * the caller installs it only when decoding and the seam check pass; otherwise the original south wall stays. */
export const DOWNTOWN_URL = '/assets/extension/downtown-v1.bin.gz';
/** Render chunks (m): terrain, buildings and trees are grouped per 512 m square for frustum culling. */
export const RENDER_CHUNK = 512;
/** Low-rise batches are hidden beyond this camera distance (the skyline batches never are). Trees use the campus
 * canopy LODs (CANOPY_LODS: impostors out to 1.5 km). */
export const LOWRISE_DISTANCE = 1400;

export interface DowntownMaterials {
  /** Borrowed campus materials (never disposed here). */
  grass: THREE.MeshStandardMaterial; asphalt: THREE.MeshStandardMaterial; concrete: THREE.MeshStandardMaterial;
  envMap: THREE.Texture | null;
}
type Point = [number, number];

export interface DowntownGeometry {
  data: DowntownData;
  terrain: DowntownTerrain;
  bounds: DowntownBounds;
  chunks: { key: string; center: THREE.Vector3; terrain: ReturnType<typeof terrainChunk>; buildings: ReturnType<typeof buildingChunk> }[];
  bridges: ReturnType<typeof bridgeGeometry>;
  /** James D. Pfluger Pedestrian Bridge (pfluger-bridge.ts); its flat City polygon is removed from `bridges`. */
  pfluger: PflugerGeometry;
  /** Baked bridge-soup triangles dropped because the modelled Pfluger bridge replaces them. */
  pflugerReplacedTriangles: number;
  water: THREE.BufferGeometry;
}

/** Pure geometry (no materials, no GPU): the game and Node checks both use it. */
export function buildDowntownGeometry(data: DowntownData): DowntownGeometry {
  const m = data.meta, terrain = new DowntownTerrain(data);
  const bounds = new DowntownBounds(m.playable, m.walls, m.seam);
  const cells = RENDER_CHUNK / m.step, ncx = Math.ceil((m.grid.nx - 1) / cells), ncz = Math.ceil((m.grid.nz - 1) / cells);
  const groups = new Map<string, DowntownBuilding[]>();
  const [bx] = m.chunks;
  for (const b of m.buildings) {
    const cx = (b.c % bx) * m.chunk, cz = Math.floor(b.c / bx) * m.chunk;
    const key = `${Math.floor(cx / RENDER_CHUNK)},${Math.floor(cz / RENDER_CHUNK)}`;
    const l = groups.get(key); if (l) l.push(b); else groups.set(key, [b]);
  }
  const chunks: DowntownGeometry['chunks'] = [];
  for (let cz = 0; cz < ncz; cz++) for (let cx = 0; cx < ncx; cx++) {
    const key = `${cx},${cz}`;
    const t = terrainChunk(data, cx * cells, Math.min(m.grid.nx - 1, (cx + 1) * cells), cz * cells, Math.min(m.grid.nz - 1, (cz + 1) * cells));
    const center = new THREE.Vector3(m.rect.xmin + (cx + .5) * RENDER_CHUNK, 0, m.rect.zmin + (cz + .5) * RENDER_CHUNK);
    chunks.push({ key, center, terrain: t, buildings: buildingChunk(groups.get(key) ?? []) });
  }
  // The baked soup's flat Pfluger polygon (OID 9608) is replaced by the modelled bridge: drop those triangles.
  const src = data.bridges, keep: number[] = [];
  for (let t = 0; t < src.length / 9; t++) if (!pflugerCovers((src[t * 9] + src[t * 9 + 3] + src[t * 9 + 6]) / 3, (src[t * 9 + 2] + src[t * 9 + 5] + src[t * 9 + 8]) / 3)) keep.push(t);
  const soup = { ...data, bridges: Float32Array.from(keep.flatMap(t => Array.from(src.subarray(t * 9, t * 9 + 9)))), bridgeCollide: Uint8Array.from(keep.map(t => data.bridgeCollide[t])) };
  return { data, terrain, bounds, chunks, bridges: bridgeGeometry(soup), pfluger: buildPflugerGeometry(), pflugerReplacedTriangles: src.length / 9 - keep.length, water: waterGeometry(data) };
}

export class Downtown {
  /** Ground and solids (terrain, buildings, bridge decks): joins world.group so travel/scooter/flight see it. */
  readonly group = new THREE.Group();
  /** Water and trees: rendered, never treated as walkable ground. */
  readonly decor = new THREE.Group();
  readonly bounds: DowntownBounds;
  /** Trimesh sources: exactly rendered triangles (terrain/bridge collidable subsets, building batches). */
  readonly colliders: { name: string; position: Float32Array; index: Uint32Array }[] = [];
  /** Trunk capsules for trees inside the playable area (visible trunks); filled by installTrees. */
  readonly treeTrunks: { x: number; y: number; z: number; height: number; radius: number }[] = [];
  /** Campus-form tree population (scene decor, never ground); null until installTrees with campus vegetation. */
  trees: TreeBatches | null = null;
  treePlan: DowntownTreePlan | null = null;
  readonly travelRegion: { contains: (p: Point) => boolean; footprints: Point[][][]; outdoor: (p: Point) => boolean };
  readonly stats: Record<string, unknown>;
  private readonly ownMaterials: THREE.Material[] = [];
  private readonly ownTextures: THREE.Texture[] = [];
  private readonly lod: { object: THREE.Object3D; center: THREE.Vector3; distance: number }[] = [];
  private readonly footprintCells = new Map<number, number[]>();
  private readonly footprints: Point[][][];
  private mapImage: HTMLCanvasElement | null = null;
  private disposed = false;
  /** Extension hooks (riverfront): terrain chunk meshes with their cell ranges, and each building's triangle range. */
  readonly terrainMeshes: { mesh: THREE.Mesh; i0: number; i1: number; j0: number; j1: number }[] = [];
  readonly buildingRanges = new Map<string, { mesh: THREE.Mesh; start: number; count: number; visual: boolean }>();
  /** Building keys whose footprints another extension draws on the map instead (riverfront replacements). */
  readonly mapHidden = new Set<string>();
  get meta() { return this.built.data.meta; }
  /** Decoded data and exact terrain (read-only for extensions layered on downtown). */
  get source() { return { data: this.built.data, terrain: this.built.terrain }; }
  /** Mapped water (DEM lake + creek-mouth inlets) and its surface, for flight water safety (water-safety.ts). */
  get water() {
    const data = this.built.data, m = data.meta;
    return this.waterQuery ??= {
      surfaceY: m.water.surfaceY, bedTop: m.barrierTop + .3,
      isWater: (x: number, z: number) => {
        const i = Math.floor((x - m.rect.xmin) / m.classMap.res), j = Math.floor((z - m.rect.zmin) / m.classMap.res);
        return !this.disposed && i >= 0 && j >= 0 && i < m.classMap.w && j < m.classMap.h && data.classMap[j * m.classMap.w + i] === 5;
      },
    };
  }
  private waterQuery?: { surfaceY: number; bedTop: number; isWater: (x: number, z: number) => boolean };
  /** Capitol-strip (b14) record keys whose whole City footprints this extension renders (seam stitching). */
  get replacedKeys() { return this.built.data.meta.buildings.flatMap(b => b.replaces ? [b.replaces] : []); }

  constructor(private readonly built: DowntownGeometry, materials: DowntownMaterials, decodeMs: number) {
    const data = built.data, meta = data.meta;
    this.bounds = built.bounds;
    this.group.name = 'Downtown extension (CoA 2023 + USGS 3DEP)';
    this.decor.name = 'Downtown water and trees';
    const ground = createGroundMaterial({ grass: materials.grass, asphalt: materials.asphalt, concrete: materials.concrete,
      classMap: data.classMap, width: meta.classMap.w, height: meta.classMap.h, origin: [meta.rect.xmin, meta.rect.zmin], res: meta.classMap.res });
    const facade = createFacadeMaterial(materials.envMap);
    const water = createWaterMaterial(materials.envMap);
    const deck = materials.concrete.clone(); deck.name = 'Downtown bridge decks'; deck.side = THREE.DoubleSide;
    this.ownMaterials.push(ground.material, facade, water, deck);
    this.ownTextures.push(ground.texture);
    let terrainTriangles = 0, buildingTriangles = 0, drawCalls = 0, colliderTriangles = 0, visualOnlyTriangles = 0;
    for (const c of built.chunks) {
      if (c.terrain.render) {
        const mesh = new THREE.Mesh(c.terrain.render, ground.material);
        mesh.name = `Downtown terrain ${c.key}`; mesh.receiveShadow = true;
        terrainRaycast(mesh, built.terrain);
        const [ci, cj] = c.key.split(',').map(Number), cells = RENDER_CHUNK / meta.step;
        this.terrainMeshes.push({ mesh, i0: ci * cells, i1: Math.min(meta.grid.nx - 1, (ci + 1) * cells), j0: cj * cells, j1: Math.min(meta.grid.nz - 1, (cj + 1) * cells) });
        this.group.add(mesh); drawCalls++; terrainTriangles += c.terrain.triangles;
        if (c.terrain.collider) { this.colliders.push({ name: mesh.name, ...c.terrain.collider }); colliderTriangles += c.terrain.colliderTriangles; }
      }
      for (const [kind, batch, owners] of [['skyline', c.buildings.major, c.buildings.majorBuildings], ['lowrise', c.buildings.minor, c.buildings.minorBuildings]] as const) {
        if (!batch.triangles) continue;
        const g = batch.geometry();
        const mesh = new THREE.Mesh(g, facade);
        mesh.name = `Downtown ${kind} ${c.key}`; mesh.castShadow = true; mesh.receiveShadow = true;
        rangeRaycast(mesh, batch.ranges);
        batch.ranges.forEach((r, i) => this.buildingRanges.set(owners[i].k, { mesh, start: r.start, count: r.count, visual: owners[i].visual }));
        this.group.add(mesh); drawCalls++; buildingTriangles += batch.triangles;
        const position = g.getAttribute('position').array as Float32Array;
        // Physics gets only the playable buildings' triangles (same shared positions); visual-only context
        // (south bank, I-35 band: building.visual) is rendered but never collidable.
        const index: number[] = [];
        batch.ranges.forEach((r, i) => { if (!owners[i].visual) for (let v = r.start * 3; v < (r.start + r.count) * 3; v++) index.push(v); });
        if (index.length) this.colliders.push({ name: mesh.name, position, index: Uint32Array.from(index) });
        colliderTriangles += index.length / 3; visualOnlyTriangles += batch.triangles - index.length / 3;
        if (kind === 'lowrise') this.lod.push({ object: mesh, center: c.center, distance: LOWRISE_DISTANCE });
      }
    }
    const b = built.bridges;
    if (b.triangles) {
      const mesh = new THREE.Mesh(b.render, deck);
      mesh.name = 'Downtown bridge decks (CoA 2023 outlines, LiDAR decks)'; mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh); drawCalls++;
      const position = b.collider.getAttribute('position').array as Float32Array;
      if (position.length) this.colliders.push({ name: 'Downtown bridge decks', position, index: Uint32Array.from({ length: position.length / 3 }, (_, i) => i) });
      colliderTriangles += b.colliderTriangles;
    }
    // Pfluger bridge: walkable deck (+ land supports) in the ground group == its collider; railings collide (no walking
    // off over the water); girders, water piers, rails, lamps, planters and the mesh infill are decor.
    const pf = built.pfluger, pfm = createPflugerMaterials();
    this.ownMaterials.push(pfm.solid, pfm.infill); this.ownTextures.push(...pfm.textures);
    const pfDeck = new THREE.Mesh(pf.deck, pfm.solid);
    pfDeck.name = 'Pfluger bridge deck (CoA OID 9608, LiDAR)'; pfDeck.castShadow = true; pfDeck.receiveShadow = true;
    this.group.add(pfDeck);
    const pfStructure = new THREE.Mesh(pf.structure, pfm.solid);
    pfStructure.name = 'Pfluger bridge girders, piers, railings, lamps'; pfStructure.castShadow = true; pfStructure.receiveShadow = true;
    const pfInfill = new THREE.Mesh(pf.infill, pfm.infill);
    pfInfill.name = 'Pfluger bridge railing mesh infill';
    this.decor.add(pfStructure, pfInfill); drawCalls += 3;
    this.lod.push({ object: pfInfill, center: pf.infill.boundingSphere!.center.clone(), distance: 700 });
    this.colliders.push({ name: 'Pfluger bridge deck', ...pf.deckCollider }, { name: 'Pfluger bridge railings', ...pf.railCollider });
    colliderTriangles += pf.deckCollider.index.length / 3 + pf.railCollider.index.length / 3;
    const waterMesh = new THREE.Mesh(built.water, water);
    waterMesh.name = 'Lady Bird Lake (static water)'; waterMesh.receiveShadow = true;
    this.decor.add(waterMesh); drawCalls++;
    const nTrees = data.trees.length / 6;
    // Travel: inside the playable polygon, 2 m from walls, not within 0.8 m of a footprint, not in inlet water.
    this.footprints = meta.buildings.filter(bb => !bb.visual).map(bb => bb.tiers[0].r as Point[][]);
    this.footprints.forEach((rings, i) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of rings[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      for (let cz = Math.floor((z0 - 1) / 32); cz <= Math.floor((z1 + 1) / 32); cz++)
        for (let cx = Math.floor((x0 - 1) / 32); cx <= Math.floor((x1 + 1) / 32); cx++) {
          const k = cz * 100003 + cx, l = this.footprintCells.get(k);
          if (l) l.push(i); else this.footprintCells.set(k, [i]);
        }
    });
    // All tiers of a building (setbacks/cantilevers included) count as its footprint for travel.
    meta.buildings.forEach(bb => { if (!bb.visual) for (const t of bb.tiers.slice(1)) this.extraFootprint(t.r as Point[][]); });
    this.travelRegion = {
      contains: ([x, z]) => Number.isFinite(x) && Number.isFinite(z) && this.bounds.legal(x, z, 2),
      footprints: this.footprints,
      outdoor: p => this.outdoor(p),
    };
    this.stats = {
      loaded: true, rect: meta.rect, playableAreaM2: Math.round(polygonArea(meta.playable)), buildings: meta.buildings.length,
      landmarks: meta.buildings.filter(bb => bb.lm).map(bb => bb.lm), trees: nTrees, treeColliders: 0, treeForms: false,
      terrainTriangles, buildingTriangles, bridgeTriangles: b.triangles,
      pfluger: { ...pf.stats, replacedSoupTriangles: built.pflugerReplacedTriangles, drawCalls: 3, colliders: 2 }, waterTriangles: built.water.getAttribute('position').count / 3,
      drawCalls, colliderTriangles, visualOnlyBuildingTriangles: visualOnlyTriangles, colliders: this.colliders.length, walls: meta.walls.length, barriers: meta.barriers.length,
      lodObjects: this.lod.length,
      seam: { z: meta.seam.z, x0: meta.seam.x0, x1: meta.seam.x1, matchedStripVertices: data.seam.matched, maxAbsDelta: data.seam.maxAbsDelta },
      asset: { url: DOWNTOWN_URL, bytes: data.bytes, checksum: data.checksum }, decodeMs, buildMs: 0,
      claims: meta.claims,
    };
  }
  private readonly ownGeometries: THREE.BufferGeometry[] = [];

  private extraFootprint(rings: Point[][]) { this.footprints.push(rings); const i = this.footprints.length - 1;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of rings[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let cz = Math.floor((z0 - 1) / 32); cz <= Math.floor((z1 + 1) / 32); cz++)
      for (let cx = Math.floor((x0 - 1) / 32); cx <= Math.floor((x1 + 1) / 32); cx++) {
        const k = cz * 100003 + cx, l = this.footprintCells.get(k);
        if (l) l.push(i); else this.footprintCells.set(k, [i]);
      }
  }

  private outdoor([x, z]: Point) {
    if (!this.travelRegion.contains([x, z])) return false;
    if (this.built.data.classMap[Math.floor(z - this.built.data.meta.rect.zmin) * this.built.data.meta.classMap.w + Math.floor(x - this.built.data.meta.rect.xmin)] === 5) return false;
    const l = this.footprintCells.get(Math.floor(z / 32) * 100003 + Math.floor(x / 32)) ?? [];
    return !l.some(i => nearFootprint([x, z], this.footprints[i]));
  }

  /** Street/park trees with the campus forms, materials and impostors (borrowed; owned by the campus vegetation).
   * Call once before the game creates colliders from treeTrunks. Without campus vegetation no trees are drawn and
   * none collide (an invisible trunk would be worse than a missing tree). */
  installTrees(vegetation: { forms: TreeForm[]; materials: TreeMaterials; impostors: ImpostorSet | null } | null) {
    if (this.disposed || this.trees || !vegetation) return;
    const plan = planDowntownTrees(this.built.data, vegetation.forms, (x, z) => this.built.terrain.height(x, z));
    this.treePlan = plan;
    this.trees = downtownTreeBatches(plan, vegetation.forms, vegetation.materials, vegetation.impostors);
    this.decor.add(this.trees.group);
    for (const c of plan.capsules) this.treeTrunks.push({ x: c.a.x, y: c.a.y, z: c.a.z, height: c.b.y - c.a.y, radius: c.radius });
    Object.assign(this.stats, { treeColliders: this.treeTrunks.length, treeForms: true, treePlaced: plan.placed.length,
      treeReducedScale: plan.reduced, treeSkipped: plan.skipped, treeDraws: this.trees.impostor ? 3 : 2 });
  }

  /** Terrain height where downtown owns (x, z): inside its rectangle south of the seam; null elsewhere. */
  height(x: number, z: number) { return this.disposed ? null : this.built.terrain.height(x, z); }
  contains(x: number, z: number) { return !this.disposed && this.bounds.contains(x, z); }

  /** Distance LOD: low-rise batches and trees beyond their distance are hidden (skyline batches always draw). */
  update(camera: THREE.Vector3, view?: THREE.Camera) {
    for (const l of this.lod) l.object.visible = Math.hypot(camera.x - l.center.x, camera.z - l.center.z) < l.distance;
    if (view && !this.disposed) this.trees?.update(view);
  }
  visibleLod() { return this.lod.filter(l => l.object.visible).length; }

  drawMap(ctx: CanvasRenderingContext2D) {
    if (typeof document === 'undefined') return;
    const m = this.built.data.meta;
    if (!this.mapImage) {
      const S = 2, w = Math.floor(m.classMap.w / S), h = Math.floor(m.classMap.h / S);
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const c = canvas.getContext('2d'); if (!c) return;
      const img = c.createImageData(w, h);
      const pal: Record<number, number[]> = { 0: [39, 53, 43], 1: [92, 97, 94], 2: [143, 141, 127], 3: [150, 140, 120], 4: [130, 118, 92], 5: [54, 92, 128], 6: [52, 82, 52], 7: [193, 188, 166], 8: [96, 99, 96] };
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const v = this.built.data.classMap[(j * S) * m.classMap.w + i * S], p = pal[v] ?? pal[0], o = (j * w + i) * 4;
        img.data[o] = p[0]; img.data[o + 1] = p[1]; img.data[o + 2] = p[2]; img.data[o + 3] = 255;
      }
      c.putImageData(img, 0, 0);
      this.mapImage = canvas;
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.mapImage, m.rect.xmin, m.rect.zmin, m.classMap.w * m.classMap.res, m.classMap.h * m.classMap.res);
    ctx.fillStyle = '#c1bca6';
    ctx.beginPath();
    for (const bb of m.buildings) if (!this.mapHidden.has(bb.k)) for (const r of bb.tiers[0].r) { r.forEach(([x, z], i) => i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)); ctx.closePath(); }
    ctx.fill('evenodd');
    ctx.restore();
  }

  /** Name for the HUD: nearest landmark within 140 m, else the district. */
  locationName(x: number, z: number) {
    let best = '', d = 140;
    for (const bb of this.built.data.meta.buildings) {
      if (!bb.lm) continue;
      const [cx, cz] = bb.tiers[0].r[0][0];
      const dd = Math.hypot(cx - x, cz - z);
      if (dd < d) { d = dd; best = bb.name; }
    }
    return best ? `Downtown · ${best}` : 'Downtown Austin';
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent(); this.decor.removeFromParent();
    // Tree batches own only their BatchedMesh buffers; forms, materials and impostors belong to the campus vegetation.
    this.trees?.dispose(); this.trees = null;
    // Each geometry has exactly one owner: ground meshes (terrain/buildings/decks) and the water mesh own theirs; the
    // shared tree templates are disposed once via ownGeometries; instanced meshes only release instance buffers.
    this.group.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
    this.decor.traverse(o => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); else if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
    this.built.bridges.collider.dispose();
    for (const g of this.ownGeometries) g.dispose();
    for (const m of this.ownMaterials) m.dispose();
    for (const t of this.ownTextures) t.dispose();
    this.mapImage = null;
  }
  get isDisposed() { return this.disposed; }
}

function inRing([x, z]: Point, ring: Point[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function nearFootprint(p: Point, rings: Point[][]) {
  if (inRing(p, rings[0]) && !rings.slice(1).some(r => inRing(p, r))) return true;
  return rings.some(r => r.some((a, i) => {
    const b = r[(i + 1) % r.length], dx = b[0] - a[0], dz = b[1] - a[1], d = dx * dx + dz * dz;
    const t = d ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / d)) : 0;
    return Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]) < .8;
  }));
}
function polygonArea(rings: number[][][]) {
  const a = (r: number[][]) => { let s = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; s += p[0] * q[1] - q[0] * p[1]; } return Math.abs(s / 2); };
  return a(rings[0]) - rings.slice(1).reduce((s, r) => s + a(r), 0);
}

async function fetchBytes(url: string, signal?: AbortSignal) {
  if (!url.startsWith('/') || url.startsWith('//')) throw new Error('Downtown asset must be same-origin');
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Downtown asset load failed: ${response.status}`);
  const zipped = await response.arrayBuffer();
  const bytes = new Uint8Array(zipped);
  return bytes[0] === 0x1f && bytes[1] === 0x8b
    ? await new Response(new Blob([zipped]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : zipped;
}

/** Fetch, validate against the Capitol strip seam, and build. Throws (fail closed). */
export async function loadDowntown(options: { materials: DowntownMaterials; strip: StripSeamSource; signal?: AbortSignal; url?: string }) {
  const start = performance.now();
  const buffer = await fetchBytes(options.url ?? DOWNTOWN_URL, options.signal);
  const data = decodeDowntown(buffer, options.strip);
  const decodeMs = performance.now() - start;
  const built = buildDowntownGeometry(data);
  try {
    const d = new Downtown(built, options.materials, decodeMs);
    d.stats.buildMs = performance.now() - start - decodeMs;
    return d;
  } catch (error) {
    for (const c of built.chunks) c.terrain.render?.dispose();
    built.bridges.render.dispose(); built.bridges.collider.dispose(); built.water.dispose();
    built.pfluger.deck.dispose(); built.pfluger.structure.dispose(); built.pfluger.infill.dispose();
    throw error;
  }
}
