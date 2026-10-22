// Headless check of the generated local context against the real authored
// scene (walkway, Main envelope, Tower, baked terrain/surfaces). No browser,
// network or WebGL: textures are stubbed, geometry and Rapier are real.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { Terrain } from '../../lib/campus/terrain';
import { capitolGroundReference } from '../../lib/campus/capitol-area';
import { CampusWorld } from '../../lib/campus/world';
import { materials } from '../../lib/campus/materials';
import { SpeedwayWalkway } from '../../lib/campus/walkway';
import { buildTower } from '../../lib/campus/landmarks';
import { buildOfflineTowerBase } from '../../lib/campus/tower-offline-base';
import { buildMainBuildingEnvelope } from '../../lib/campus/main-building-envelope';
import { decodeOfflineTerrain } from '../../lib/campus/offline-terrain-loader';
import { decodeLocalSurfaces } from '../../lib/campus/local-surfaces';
import { buildLocalContext } from '../../lib/campus/local-context';
import { travelCandidates, travelLanding, travelProbe, overheadEnclosed } from '../../lib/campus/map-travel';
import { pointInPolygon, distanceToRings, cleanRing, orientRings } from '../../lib/campus/context-geometry';
import { BakedGround } from '../../lib/campus/baked-ground';
import { prepareScanTower, prepareScanStand, loadScanField, SCAN_STAND_SECTOR, type ScanTower, type ScanStand, type ScanField } from '../../lib/campus/scan-landmarks';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { CampusData, TerrainData } from '../../lib/campus/types';
import { installCampusVegetation } from '../../lib/campus/vegetation/install';
import { buildGroundTieIns } from '../../lib/campus/ground/tie-ins';
import { applyBlockData, installBlocks } from '../../lib/campus/blocks/registry';
import { heroRouteExtraGround } from '../../lib/campus/ground/hero-route';
import * as groundModule from '../../lib/campus/vegetation/ground-index';
import * as lawnModule from '../../lib/campus/vegetation/lawn';
import * as formsModule from '../../lib/campus/vegetation/oak-forms';
import type { CanopyData, TreeSitesData } from '../../lib/campus/vegetation/canopy-forest';
export { CATALOG } from '../../lib/campus/context/catalog';
export { poleOfInaccessibility, cleanRing, orientRings } from '../../lib/campus/context-geometry';
export * as THREE_NS from 'three';
export { buildStadiumBowl, STADIUM_FIELD } from '../../lib/campus/stadium-bowl';
export { findFlightLanding } from '../../lib/campus/flight-landing';
export { ScooterClearance } from '../../lib/campus/scooter-clearance';
export { LocalGroundQuery } from '../../lib/campus/local-ground-query';
export { OPEN_AIR_FOOTPRINTS, outdoorPoint } from '../../lib/campus/map-travel';
export { BLOCK_CHECKS } from './blocks/index';
export { BLOCK_MODULES, BLOCK_CONTEXT } from '../../lib/campus/blocks/registry';

const root = resolve(process.cwd());
const json = <T>(p: string) => JSON.parse(readFileSync(resolve(root, p), 'utf8')) as T;
const bin = (p: string) => { const b = gunzipSync(readFileSync(resolve(root, p))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

/** Headless GLB load for the scan assets (textures are decoded by the stubbed createImageBitmap). */
export const loadLocalGltf = (url: string) => {
  const b = readFileSync(resolve(root, 'public' + url));
  return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
};

/** scan: aligned Tower + field decal as in the game. scanFailure: same code path with an injected
 * load failure, i.e. the game's authored-Tower fallback. */
/** Physics proxy whose createCollider throws: injects a stand-scan COMMIT failure after a
 * successful decode (counts attempted creations so the caller can prove nothing leaked). */
function failingColliderWorld(physics: RAPIER.World, counter: { attempts: number }) {
  return new Proxy(physics, {
    get(target, key) {
      if (key === 'createCollider') return () => { counter.attempts++; throw new Error('injected stand collider failure'); };
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

export async function run(options: { scan?: boolean; scanFailure?: boolean; standCommitFailure?: boolean } = {}) {
  await RAPIER.init();
  const physics = new RAPIER.World({ x: 0, y: -24, z: 0 });
  const data = json<CampusData>('public/data/campus.json');
  data.landmarks.CAP = { name: 'Texas State Capitol · North grounds', position: [-278.335, 1179.898] };
  data.bounds[3] = Math.max(data.bounds[3], 1536);
  // Whole-campus block data exactly as in CampusGame (before anything reads data.buildings).
  const blockData = applyBlockData(data);
  const renderer = { capabilities: { getMaxAnisotropy: () => 8 } } as unknown as THREE.WebGLRenderer;
  const world = new CampusWorld(data, new Terrain(json<TerrainData>('public/data/terrain.json'), capitolGroundReference), physics, () => materials(renderer), renderer);
  const walkway = new SpeedwayWalkway(data, world.terrain, physics, renderer, true, true);
  const terrain = decodeOfflineTerrain(bin('public/assets/campus/offline-terrain-61.bin.gz'), world.mat.grass);
  world.group.add(terrain.mesh);
  // Terrain colliders exactly as in CampusGame (game.ts: localTerrain.colliderGeometries).
  for (const g of terrain.colliderGeometries) world.collider(g);
  // Scan mode mirrors the game integration: the aligned Tower scan replaces buildTower.
  // Same lifecycle as CampusGame: decode without physics, then commit colliders.
  let scanTower: ScanTower | null = null, scanFallback = false;
  const beforeTower = new Set<number>(); physics.colliders.forEach(c => { beforeTower.add(c.handle); });
  if (options.scan || options.scanFailure) {
    const load = options.scanFailure ? () => Promise.reject(new Error('injected scan load failure')) : loadLocalGltf;
    const prepared = await prepareScanTower({ load }).catch(() => null);
    if (prepared) { scanTower = prepared.commit(physics); world.group.add(scanTower.group); }
    else { scanFallback = true; buildTower(world); }
  } else buildTower(world);
  // Colliders of whichever Tower is present (scan proxies or the authored fallback boxes).
  const towerColliderHandles = new Set<number>(); physics.colliders.forEach(c => { if (!beforeTower.has(c.handle)) towerColliderHandles.add(c.handle); });
  buildOfflineTowerBase(world); world.flush();
  const mat = (name: string) => walkway.materials.find(m => m.name === name)!.clone();
  const envelope = buildMainBuildingEnvelope({ groundHeight: (x, z) => world.terrain.height(x, z),
    stone: mat('Main Building warm limestone'), trim: mat('Main Building pale stone blocks'),
    glass: mat('Main Building bronze dark glazing'), frame: mat('Main Building bronze sash') });
  world.group.add(...envelope.meshes);
  // Main Building envelope colliders exactly as in CampusGame (game.ts: mainEnvelope.colliderGeometries).
  for (const g of envelope.colliderGeometries) world.collider(g);
  world.flush();
  const paving = walkway.materials.find(m => m.name === 'Speedway golden brick paving')!;
  const surfaces = decodeLocalSurfaces(bin('public/assets/campus/local-surfaces-61.bin.gz'),
    { asphalt: world.mat.asphalt, concrete: world.mat.concrete, speedway: paving });
  // Whole-campus block geometry exactly as in CampusGame: after local finishes, before tie-ins.
  const blockGround = new BakedGround(terrain.mesh.geometry.getAttribute('position').array, 8, (x, z) => world.terrain.height(x, z));
  const blocks = installBlocks({
    data, physics, renderer, terrainHeight: (x, z) => world.terrain.height(x, z), groundHeight: (x, z) => blockGround.height(x, z),
    authored: { surfaces: walkway.surfaces, world: world.group },
    material: name => walkway.materials.find(m => m.name === name) ?? Object.values(world.mat).find(m => (m as THREE.Material).name === name) as THREE.Material | undefined,
  }, walkway.surfaces, world.group);
  // Ground tie-ins exactly as in CampusGame (after local finishes, before the context).
  // GROUND_TIE_INS=off reproduces the scene before the tie-ins (comparison runs only).
  const tieIns = process.env.GROUND_TIE_INS === 'off' ? null : buildGroundTieIns({ sources: [walkway.surfaces], obstacles: [walkway.surfaces, world.group],
    overlays: [surfaces.group], terrainPositions: terrain.mesh.geometry.getAttribute('position').array, terrainFallback: (x, z) => world.terrain.height(x, z),
    isTerrain: mesh => mesh === terrain.mesh, buildings: data.buildings, lawn: world.mat.grass,
    wall: walkway.materials.find(m => m.name === 'East Mall limestone walls and steps') ?? world.mat.concrete, physics, extraSources: heroRouteExtraGround });
  if (tieIns) { walkway.surfaces.add(...tieIns.meshes); walkway.colliders.push(...tieIns.colliders); }
  const dummy = new THREE.MeshBasicMaterial();
  // DKR west stand, as in the game: decoded first; the bowl drops its west rows only if present.
  const standLoad = options.scan || options.scanFailure ? prepareScanStand({ load: options.scanFailure ? () => Promise.reject(new Error('injected scan load failure')) : loadLocalGltf }).catch(() => null) : Promise.resolve(null);
  const standPrepared = await standLoad;
  let scanStand: ScanStand | null = null;
  const standCommit = { injected: !!options.standCommitFailure, attempts: 0, preparedMeshes: 0, preparedDisposed: 0, collidersBefore: 0, collidersAfterCommit: 0 };
  const preparedGeometries: THREE.BufferGeometry[] = [];
  standPrepared?.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) preparedGeometries.push(m.geometry); });
  standCommit.preparedMeshes = preparedGeometries.length;
  for (const g of preparedGeometries) g.addEventListener('dispose', () => { standCommit.preparedDisposed++; });
  standCommit.collidersBefore = physics.colliders.len();
  const context = buildLocalContext({
    data, physics, contourHeight: (x, z) => world.terrain.height(x, z),
    bakedPositions: terrain.mesh.geometry.getAttribute('position').array,
    authoredRoots: [walkway.surfaces, world.group], finishRoots: [surfaces.group],
    material: () => dummy,
    // Measured roofs from the lidar lane when present (runtime fetch in the game).
    roofs: existsSync(resolve(root, 'public/data/derived/roofs-lidar.json')) ? json('public/data/derived/roofs-lidar.json') : null,
    // Transactional, exactly as in CampusGame: the bowl drops its west rows only after commit.
    stadium: standPrepared ? {
      scanSector: SCAN_STAND_SECTOR,
      commitScan: fieldY => {
        const target = options.standCommitFailure ? failingColliderWorld(physics, standCommit) : physics;
        scanStand = standPrepared.commit(target, fieldY);
        standCommit.collidersAfterCommit = physics.colliders.len();
      },
    } : {},
  });
  if (standPrepared) {
    if (scanStand) context.group.add((scanStand as ScanStand).group);
    else standPrepared.dispose();
  }
  // Vegetation exactly as in the game: authored trees (walkway.loadDetails),
  // then the campus install (fit, colliders, canopy, lawn finish).
  await walkway.loadDetails();
  const lidarCanopy = resolve(root, process.env.CANOPY_JSON ?? 'public/data/derived/canopy-trees.json');
  const treeSites = existsSync(resolve(root, 'public/assets/vegetation/tree-sites.json')) ? json<TreeSitesData>('public/assets/vegetation/tree-sites.json') : null;
  const canopy = existsSync(lidarCanopy) ? json<CanopyData>(lidarCanopy) : process.env.CANOPY_JSON === 'none' ? null : undefined;
  const vegetationStart = performance.now();
  const vegetation = await installCampusVegetation({ physics, renderer, data, foreground: walkway.trees, walkable: [walkway.surfaces, world.group],
    paved: [surfaces.group], terrainPositions: terrain.mesh.geometry.getAttribute('position').array, terrainFallback: (x, z) => world.terrain.height(x, z),
    canopy: canopy === undefined ? 'fetch' : canopy, treeSites, headlessImpostors: true });
  const vegetationMs = performance.now() - vegetationStart;
  // Worst case for the GDC travel checks below: the streamed (high) limb
  // colliders around the GDC are live, as when the player stands nearby.
  vegetation.canopy.streamAt(new THREE.Vector3(69.64, 0, -18.48));
  let scanField: ScanField | null = null;
  if (options.scan && !options.scanFailure) {
    scanField = await loadScanField({ fieldY: context.stats.stadium.fieldY, load: loadLocalGltf });
    context.group.add(scanField.group);
  }
  // Every generated vertex must be finite and every mesh non-empty.
  let bad = 0, vertices = 0;
  context.group.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const a = m.geometry.getAttribute('position').array as Float32Array;
    vertices += a.length / 3;
    for (const v of a) if (!Number.isFinite(v)) bad++;
  });
  // Player capsule exactly as in CampusGame, then one step so queries see every collider.
  const body = physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(114, 30, 64.4));
  const player = physics.createCollider(RAPIER.ColliderDesc.capsule(0.54, 0.34).setFriction(0), body);
  physics.step();
  const sanity = physics.castRay(new RAPIER.Ray({ x: 114, y: 60, z: 64.4 }, { x: 0, y: -1, z: 0 }), 200, true, undefined, undefined, player);
  if (!sanity) throw Error('physics sanity ray found no ground at spawn');

  // Independent route check from actual authored walkable triangles (not the raster).
  const ground = new BakedGround(terrain.mesh.geometry.getAttribute('position').array, 8, (x, z) => world.terrain.height(x, z));
  const generated = context.plans.filter(p => p.decision === 'generated').map(p => {
    const rings = orientRings(p.building.rings.map(r => cleanRing(r)).filter(r => r.length >= 3));
    const xs = rings[0].map(q => q[0]), zs = rings[0].map(q => q[1]);
    return { id: p.building.abbr || String(p.building.id), rings, box: [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)] };
  });
  const hash = new Map<string, typeof generated>();
  const key = (x: number, z: number) => `${Math.floor(x / 50)},${Math.floor(z / 50)}`;
  for (const g of generated) for (let x = Math.floor(g.box[0] / 50); x <= Math.floor(g.box[1] / 50); x++) for (let z = Math.floor(g.box[2] / 50); z <= Math.floor(g.box[3] / 50); z++) {
    const k = `${x},${z}`; if (!hash.has(k)) hash.set(k, []); hash.get(k)!.push(g);
  }
  const routeViolations: Record<string, { inside: number; deep: number }> = {};
  let walkableSamples = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const sample = (x: number, z: number) => {
    walkableSamples++;
    for (const g of hash.get(key(x, z)) ?? []) {
      if (x < g.box[0] || x > g.box[1] || z < g.box[2] || z > g.box[3] || !pointInPolygon(x, z, g.rings)) continue;
      const v = routeViolations[g.id] ??= { inside: 0, deep: 0 };
      v.inside++; if (distanceToRings(x, z, g.rings) > 0.25) v.deep++;
    }
  };
  for (const root of [walkway.surfaces, world.group]) {
    root.updateWorldMatrix(true, true);
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || o.name === 'Offline local contour terrain') return;
      const pos = m.geometry.getAttribute('position'), index = m.geometry.index, count = index ? index.count : pos.count;
      for (let t = 0; t + 2 < count; t += 3) {
        a.fromBufferAttribute(pos, index ? index.getX(t) : t).applyMatrix4(m.matrixWorld);
        b.fromBufferAttribute(pos, index ? index.getX(t + 1) : t + 1).applyMatrix4(m.matrixWorld);
        c.fromBufferAttribute(pos, index ? index.getX(t + 2) : t + 2).applyMatrix4(m.matrixWorld);
        n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
        const l = n.length();
        if (l < 1e-9 || Math.abs(n.y / l) < 0.6) continue;
        const cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3;
        if (Math.max(a.y, b.y, c.y) > ground.height(cx, cz) + 2) continue;
        // Barycentric samples about every metre across the triangle.
        const span = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)), k = Math.min(40, Math.max(1, Math.ceil(span)));
        for (let i = 0; i <= k; i++) for (let j = 0; j <= k - i; j++) {
          const u = i / k, v = j / k, w = 1 - u - v;
          sample(a.x * u + b.x * v + c.x * w, a.z * u + b.z * v + c.z * w);
        }
      }
    });
  }

  // Real-scene map travel, mirroring CampusGame.updateTravel's candidate order.
  // Same registered ground roots as CampusGame.groundRoots(): the stand's near-LOD visual only.
  const roots: THREE.Object3D[] = [world.group, walkway.surfaces, context.solid, ...(scanStand ? [(scanStand as ScanStand).groundSurface] : [])];
  const surface = (x: number, z: number, fromY: number, distance: number) =>
    new THREE.Raycaster(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0), 0, distance)
      .intersectObjects(roots, true).find(h => h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y > .5) ?? null;
  const travel = (requested: [number, number]) => {
    const candidates = travelCandidates(data, requested);
    let rejectedUnderRoof = 0;
    const began = performance.now();
    for (let i = 0; i < candidates.length; i++) {
      const point = candidates[i];
      const outcome = { enclosed: false };
      const landing = travelLanding(physics, player, point, world.terrain.height(...point), surface, outcome, travelProbe(data, point));
      if (landing) return { requested, index: i, candidates: candidates.length, landing: landing.toArray().map(v => +v.toFixed(3)), rejectedUnderRoof,
        offset: +Math.hypot(landing.x - requested[0], landing.z - requested[1]).toFixed(2),
        enclosed: overheadEnclosed(physics, player, landing), searchMs: Math.round(performance.now() - began) };
      if (outcome.enclosed) rejectedUnderRoof++;
    }
    return { requested, index: -1, candidates: candidates.length, landing: null, rejectedUnderRoof, offset: null, enclosed: null, searchMs: Math.round(performance.now() - began) };
  };
  return { stats: context.stats, vertices, nonFinite: bad, plans: context.plans, grid: context.grid, physics, world, walkway, context, RAPIER,
    player, routeViolations, walkableSamples, travel, scanTower, scanField, scanStand: scanStand as ScanStand | null, standCommit, blocks, blockData, standPrepared, groundRoots: roots, surface, scanFallback, towerColliderHandles, ground, vegetation, vegetationMs, surfaces, tieIns };
}

/**
 * Independent clearance check of every tree collider (authored + canopy):
 * a full (unregioned) index of authored walkable triangles + baked terrain.
 *  - limbViolations: a capsule more than the trunk-zone radius from its trunk
 *    whose underside is < 2.4 m above the walkable surface directly below.
 *  - pavedViolations: any capsule (trunks included) whose underside is < 2.4 m
 *    above PAVED walkable ground below it (trees must never block paths).
 * Hedge cuboids are excluded (unchanged authored hedge cells).
 */
export function treeClearance(r: Awaited<ReturnType<typeof run>>) {
  const { GroundIndex } = groundModule;
  const terrainPositions = r.world.group.getObjectByName('Offline local contour terrain') as THREE.Mesh;
  const baked = new BakedGround(terrainPositions.geometry.getAttribute('position').array, 8, (x, z) => r.world.terrain.height(x, z));
  const index = new GroundIndex({ roots: [r.walkway.surfaces, r.world.group], pavedOverlays: [r.surfaces.group], isLawn: lawnModule.isLawnMaterial,
    skip: m => m.name === 'Offline local contour terrain', terrain: (x, z) => baked.sample(x, z) ?? r.world.terrain.height(x, z) });
  const trees: { x: number; z: number; zone: number; capsules: { a: THREE.Vector3; b: THREE.Vector3; radius: number }[] }[] = [];
  const forms = formsModule.treeForms();
  const fits = r.walkway.trees?.fits ?? [];
  (r.walkway.trees?.placed ?? []).forEach((t, i) => trees.push({ x: t.x, z: t.z, zone: Math.max(1.1, forms[t.form].trunkRadius * t.scale * 2.6), capsules: fits[i].capsules }));
  // Canopy colliders are checked from the live physics shapes.
  const canopy = r.vegetation.canopy;
  let limb = 0, samples = 0, worstLimb = Infinity, penetration = 0;
  const trunkOnPaving = { authored: 0, canopy: 0 };
  const examples: string[] = [];
  let population: 'authored' | 'canopy' = 'authored';
  const test = (x0: number, z0: number, zone: number, a: THREE.Vector3, b: THREE.Vector3, radius: number) => {
    const n = Math.max(2, Math.ceil(a.distanceTo(b) / .1));
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n), bottom = p.y - radius;
      const g = index.under(p.x, p.z, bottom);
      samples++;
      if (!g) continue;
      const clear = bottom - g.y, far = Math.hypot(p.x - x0, p.z - z0) > zone;
      if (far && g.paved && clear < 2.4) { limb++; worstLimb = Math.min(worstLimb, clear); if (examples.length < 10) examples.push(`${population} limb over paving ${p.x.toFixed(1)},${p.z.toFixed(1)} clear ${clear.toFixed(2)}`); }
      else if (far && !g.paved && clear < .2) penetration++;
      else if (!far && g.paved && clear < 2.4) trunkOnPaving[population]++;
    }
  };
  for (const t of trees) for (const c of t.capsules) test(t.x, t.z, t.zone, c.a, c.b, c.radius);
  population = 'canopy';
  if (canopy) {
    // Exact collider capsules with their owning tree's trunk zone.
    canopy.capsules.forEach((c, i) => {
      const t = canopy.placed[canopy.owners[i]];
      test(t.x, t.z, Math.max(1.1, forms[t.form].trunkRadius * t.scale * 2.6), c.a, c.b, c.radius);
    });
  }
  // Trunk spacing: no two instantiated trunks closer than 1.5 m unless both authored.
  const all = [...(r.walkway.trees?.placed ?? []).map(t => ({ x: t.x, z: t.z, authored: true })), ...(canopy?.placed ?? []).map(t => ({ x: t.x, z: t.z, authored: false }))];
  const spacing = new Map<string, number[]>();
  all.forEach((t, i) => { const k = `${Math.floor(t.x / 4)},${Math.floor(t.z / 4)}`; if (!spacing.has(k)) spacing.set(k, []); spacing.get(k)!.push(i); });
  let closeTrunks = 0, closeAuthored = 0;
  all.forEach((t, i) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of spacing.get(`${Math.floor(t.x / 4) + a},${Math.floor(t.z / 4) + b}`) ?? []) {
      if (j <= i || Math.hypot(all[j].x - t.x, all[j].z - t.z) >= 1.5) continue;
      if (t.authored && all[j].authored) closeAuthored++; else { closeTrunks++; if (examples.length < 12) examples.push(`trunks ${t.x.toFixed(1)},${t.z.toFixed(1)} too close`); }
    }
  });
  return { trunkPairsUnder1_5m: closeTrunks, authoredPairsUnder1_5m: closeAuthored, trees: trees.length + (canopy?.placed.length ?? 0), capsules: trees.reduce((a, t) => a + t.capsules.length, 0) + (canopy?.capsules.length ?? 0), samples,
    limbViolations: limb, worstLimbClearance: Number.isFinite(worstLimb) ? +worstLimb.toFixed(2) : null,
    lawnPenetrationSamples: penetration, trunkZoneSamplesOverPaving: trunkOnPaving,
    examples, indexTriangles: index.triangles, indexMs: Math.round(index.buildMs) };
}

/** Tree LOD counts / triangles / draw calls inside the view frustum for fixed
 * hero cameras (16:9, fov 55, as CampusGame), new system vs the former
 * per-tree island_tree_02 LOD clones (near 142,443 / mid 41,568 / far 11,366
 * triangles at 0/24/65 m, culled beyond 650 m, 3 draw calls per visible tree). */
export function heroViews(r: Awaited<ReturnType<typeof run>>) {
  const views: Record<string, { at: [number, number]; up: number; heading: number; pitch?: number }> = {
    spawnMlk: { at: [114, 64.4], up: 2.4, heading: 275 },
    speedwayCanopy: { at: [16, -95], up: 2.2, heading: 0 },
    towerArrival: { at: [-204.8, 46.67], up: 2.4, heading: 275 },
    stadiumAerial: { at: [377.3, 269.4], up: 97, heading: 90, pitch: -18 },
  };
  const forms = formsModule.treeForms();
  const out: Record<string, unknown> = {};
  const oldTris = [142443, 41568, 11366];
  for (const [name, v] of Object.entries(views)) {
    const y = r.world.terrain.height(v.at[0], v.at[1]) + v.up;
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, .12, 2100);
    camera.position.set(v.at[0], y, v.at[1]);
    const h = v.heading * Math.PI / 180, p = (v.pitch ?? -4) * Math.PI / 180;
    camera.lookAt(v.at[0] + Math.sin(h) * Math.cos(p), y + Math.sin(p), v.at[1] - Math.cos(h) * Math.cos(p));
    camera.updateMatrixWorld(); camera.updateProjectionMatrix();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const result: Record<string, unknown> = {};
    for (const [label, batches] of [['authored', r.walkway.trees?.batches], ['canopy', r.vegetation.canopy?.batches]] as const) {
      if (!batches) continue;
      batches.update(camera, true);
      const levels = (batches as unknown as { level: Int8Array }).level;
      const counts = [0, 0, 0, 0], tris = [0, 0, 0, 0];
      batches.trees.forEach((t, i) => {
        const l = levels[i]; if (l < 0 || l > 3) return;
        const f = forms[t.form];
        const sphere = new THREE.Sphere(new THREE.Vector3(t.x, t.y + f.spec.height * .5 * t.scale, t.z), Math.max(f.spec.radius, f.spec.height) * t.scale);
        if (!frustum.intersectsSphere(sphere)) return;
        counts[l]++; tris[l] += l === 3 ? 6 : f.triangles[l];
      });
      result[label] = { lodCounts: counts, lodTriangles: tris, triangles: tris.reduce((a, b) => a + b, 0),
        // wood + foliage (+ impostor) BatchedMesh draws, each one multi-draw call.
        drawCalls: (counts[0] + counts[1] + counts[2] ? 2 : 0) + (counts[3] ? 1 : 0) };
    }
    // Before: authored placements with the old LOD thresholds.
    const before = [0, 0, 0];
    for (const t of r.walkway.treePlacements) {
      const d = Math.hypot(t.x - v.at[0], t.y - y, t.z - v.at[1]);
      if (d >= 650) continue;
      const s = new THREE.Sphere(new THREE.Vector3(t.x, t.y + 4 * t.scale, t.z), 8 * t.scale);
      if (!frustum.intersectsSphere(s)) continue;
      before[d < 24 ? 0 : d < 65 ? 1 : 2]++;
    }
    result.before = { lodCounts: before, triangles: before.reduce((a, c, i) => a + c * oldTris[i], 0), drawCalls: before.reduce((a, c) => a + c * 3, 0) };
    out[name] = result;
  }
  return out;
}
