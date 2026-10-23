import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import towerMeta from '../../public/assets/scans/ut-tower.json' with { type: 'json' };
import fieldMeta from '../../public/assets/scans/dkr-field.json' with { type: 'json' };
import standMeta from '../../public/assets/scans/dkr-west-stand.json' with { type: 'json' };
import type { StadiumScanSector } from './stadium-bowl';

/**
 * Independent drone photogrammetry (seanhlewis/utimagery @13f08efe, MIT) aligned to campus
 * coordinates by tools/scans (facade-normal leveling + Umeyama similarity on GIS footprint
 * corners; stadium scale from yard lines). Assets are cropped, re-atlased and baked into
 * campus metres around `anchor`, so the recorded transform reduces to a translation here.
 *
 * Tower: the scan replaces the authored Tower (`buildTower`) above the Main Building
 * north-stack roof (Y 35.9). Its position is the measured one, ~28 m north of the MAI
 * landmark point used by the authored Tower. The photographed sun is swapped for the game sun once,
 * per vertex (COLOR_0, atlas texels untouched). The melted scanned belfry above the clock-block
 * roof, the clock rings and the shaft window strips (near LOD) are replaced by measured, authored
 * geometry flagged extras.authoredInfill (tools/scans/build-tower.mjs 6b-6f, ut-tower.json crown /
 * clocks / windowStrips). Collision is simplified: one tower-aligned shaft cuboid plus a 73×73
 * heightfield cap sampled from the visible tops (scan + authored crown stone; the roof rail and mast
 * are not landable) — never raw scan triangles.
 *
 * Field / west stand (DKR): diagnostic comparison only (`stadiumScanRequested`, `?stadiumscan=1`); the default stadium
 * is fully authored. Field: a flattened, visual-only decal of the scanned DKR turf (north end zone to the south
 * 20-yard line), laid 3 cm above the generated stadium field plane, whose collider is kept.
 *
 * Ownership: loaders decode without physics; every failure, timeout, abort or late arrival
 * disposes what was decoded (each geometry/material/texture once, ImageBitmaps closed).
 *
 * Known gap: GTAO screen-space darkening still applies to captured pixels at 30–65 m.
 */
type ScanLoad = (url: string) => Promise<GLTF>;
export interface ScanLoadOptions {
  /** Same-origin asset directory. */
  baseUrl?: string;
  /** Injected loader (headless harness/tests); defaults to GLTFLoader.loadAsync. */
  load?: ScanLoad;
  /** Give up and keep authored geometry after this long. */
  timeoutMs?: number;
  /** Lifetime of the caller (e.g. CampusGame.signal.signal). Aborting rejects a pending load
   * and disposes every decoded asset, including ones that resolve later. */
  signal?: AbortSignal;
}
export interface ScanTowerOptions extends ScanLoadOptions {
  /** 'baked' (default): unlit photographed colour, not tone mapped. 'lit': standard PBR. */
  shading?: 'baked' | 'lit';
  /** Linear multiplier on the baked colour. Default 1.1: a wall facing the sun is relit to sRGB
   * ~209-229 before gain, matching the sunlit limestone of the lit scene; walls facing away from the
   * game sun (north/west) are relit to the photographed shade level (~87), which matches the lit
   * scene's shaded stone (~90 in game). The relight itself is baked per vertex (ut-tower.json relight). */
  gain?: number;
  /** Distance (m) beyond which the approximately 15.5k-triangle far LOD is shown. */
  farDistance?: number;
}

const defaultLoad: ScanLoad = url => new GLTFLoader().loadAsync(url);
const assetUrl = (base: string, name: string) => {
  if (!base.startsWith('/') || base.startsWith('//')) throw new Error('Scan assets must use a same-origin absolute path');
  return `${base.replace(/\/?$/, '/')}${name}`;
};

/** Every geometry, material and texture under `root`, each listed once. */
function resourcesOf(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(m);
      for (const value of Object.values(m)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  return { geometries, materials, textures };
}
/** Dispose each shared resource exactly once; close decoded ImageBitmaps. */
function disposeTree(...roots: THREE.Object3D[]) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  for (const root of roots) {
    root.removeFromParent();
    const r = resourcesOf(root);
    r.geometries.forEach(g => geometries.add(g)); r.materials.forEach(m => materials.add(m)); r.textures.forEach(t => textures.add(t));
  }
  geometries.forEach(g => g.dispose());
  materials.forEach(m => m.dispose());
  for (const t of textures) {
    const image = t.image as { close?: () => void } | undefined;
    t.dispose();
    if (image && typeof image.close === 'function') image.close();
  }
}
const disposeGltf = (gltf: GLTF) => disposeTree(...(gltf.scenes?.length ? gltf.scenes : [gltf.scene]));

/**
 * Load several GLTFs with explicit ownership. Resolves with all of them, or rejects on the
 * first failure/timeout/abort — and in that case disposes every value that has already
 * resolved and every value that resolves later, so nothing decoded is ever orphaned.
 */
function acquireAll(urls: string[], load: ScanLoad, timeoutMs: number, what: string, signal?: AbortSignal) {
  return new Promise<GLTF[]>((resolve, reject) => {
    const values: (GLTF | undefined)[] = urls.map(() => undefined);
    let settled = false, remaining = urls.length;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      for (const v of values) if (v) disposeGltf(v);
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const onAbort = () => fail(new Error(`${what} cancelled`));
    const timer = setTimeout(() => fail(new Error(`${what} timed out after ${timeoutMs} ms`)), timeoutMs);
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    urls.forEach((url, i) => {
      let pending: Promise<GLTF>;
      try { pending = load(url); } catch (error) { fail(error); return; }
      pending.then(value => {
        if (settled) { disposeGltf(value); return; } // late arrival after failure: we still own it
        values[i] = value;
        if (--remaining === 0) {
          settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
          resolve(values as GLTF[]);
        }
      }, fail);
    });
  });
}

function meshesOf(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  root.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  return meshes;
}

function finishMaterials(meshes: THREE.Mesh[], shading: 'baked' | 'lit', gain: number) {
  const replaced = new Map<THREE.Material, THREE.Material>();
  for (const mesh of meshes) {
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = list.map(m => {
      const done = replaced.get(m);
      if (done) return done; // shared material: finish once
      const src = m as THREE.MeshBasicMaterial;
      if (src.map) { src.map.colorSpace = THREE.SRGBColorSpace; src.map.anisotropy = 8; }
      if (shading === 'lit') {
        if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
        const lit = new THREE.MeshStandardMaterial({ map: src.map ?? null, color: src.color.clone(), roughness: 0.92, metalness: 0 });
        lit.name = `${src.name} (lit)`;
        src.dispose();
        replaced.set(m, lit);
        return lit;
      }
      // Photogrammetry texels already contain the captured light: show them unlit and
      // outside the ACES curve so the photographed stone colour is not darkened twice.
      // userData.capturedColor tells the render pipeline (lib/campus/render) not to relight it.
      // Authored infill (glTF extras.authoredInfill) is shown the same way but not labelled captured.
      // COLOR_0 (when present) is a normalised per-vertex multiplier stored divided by
      // extras.vertexColorScale (Tower: one-time relight of the photographed sun to the game sun).
      src.toneMapped = false;
      src.userData.capturedColor = !src.userData.authoredInfill;
      src.color.multiplyScalar(gain * (src.vertexColors && typeof src.userData.vertexColorScale === 'number' ? src.userData.vertexColorScale : 1));
      replaced.set(m, src);
      return src;
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0];
  }
}

/** Far LOD textures are the near ones downsampled with the same UV layout: near materials carry
 * glTF extras.textureKey, far ones extras.textureOfNear. Point each far material at the near texture
 * and release its own copy before anything is uploaded, so each atlas reaches the GPU once.
 * Returns the number of far materials switched. */
function shareNearTextures(nearMeshes: THREE.Mesh[], farMeshes: THREE.Mesh[]) {
  const materialsOf = (meshes: THREE.Mesh[]) => new Set(meshes.flatMap(m => [m.material].flat()) as THREE.MeshBasicMaterial[]);
  const byKey = new Map<string, THREE.Texture>();
  for (const m of materialsOf(nearMeshes)) if (m.map && typeof m.userData.textureKey === 'string') byKey.set(m.userData.textureKey, m.map);
  let shared = 0;
  for (const m of materialsOf(farMeshes)) {
    const nearMap = byKey.get(m.userData.textureOfNear);
    if (!nearMap || !m.map || m.map === nearMap) continue;
    const own = m.map, image = own.image as { close?: () => void } | undefined;
    m.map = nearMap;
    m.needsUpdate = true;
    own.dispose();
    if (image && typeof image.close === 'function') image.close();
    shared++;
  }
  return shared;
}

function assertFinite(meshes: THREE.Mesh[], what: string) {
  let triangles = 0;
  if (!meshes.length) throw new Error(`${what} contains no meshes`);
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position');
    if (!pos || !pos.count) throw new Error(`${what} has an empty mesh`);
    for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) throw new Error(`${what} has non-finite vertices`);
    triangles += (mesh.geometry.index?.count ?? pos.count) / 3;
  }
  return triangles;
}

export interface ScanTower {
  group: THREE.Group;
  colliders: RAPIER.Collider[];
  /** Authored builders the caller must NOT run while this scan is present. */
  hiddenAuthored: string[];
  stats: Record<string, unknown>;
  dispose(): void;
}
/** Decoded, validated Tower scan that has not touched physics yet. The caller owns it:
 * either `commit(physics)` (ownership moves to the returned ScanTower) or `dispose()`. */
export interface PreparedScanTower {
  group: THREE.Group;
  stats: Record<string, unknown>;
  commit(physics: RAPIER.World): ScanTower;
  dispose(): void;
}

/** Decode + validate the aligned Tower scan WITHOUT physics. Rejects (and disposes everything
 * it decoded) on failure, timeout or abort; the caller then keeps the authored Tower. */
export async function prepareScanTower(options: ScanTowerOptions = {}): Promise<PreparedScanTower> {
  const started = performance.now();
  const base = options.baseUrl ?? '/assets/scans/', load = options.load ?? defaultLoad;
  const gltfs = await acquireAll(towerMeta.files.map(f => assetUrl(base, f.name)), load, options.timeoutMs ?? 20000, 'Tower scan load', options.signal);
  const [near, far] = gltfs;
  const group = new THREE.Group();
  let triangles = 0, sharedAtlases = 0;
  try {
    group.name = 'UT Tower photogrammetry (aligned scan)';
    const [ax, ay, az] = towerMeta.anchor;
    group.position.set(ax, ay, az);
    const lod = new THREE.LOD();
    lod.name = 'UT Tower scan LOD';
    lod.addLevel(near.scene, 0);
    lod.addLevel(far.scene, options.farDistance ?? 380);
    group.add(lod);
    const meshes = [...meshesOf(near.scene), ...meshesOf(far.scene)];
    triangles = assertFinite(meshesOf(near.scene), 'Tower scan near LOD') + assertFinite(meshesOf(far.scene), 'Tower scan far LOD');
    for (const mesh of meshes) {
      mesh.castShadow = true;
      mesh.receiveShadow = options.shading === 'lit';
      mesh.matrixAutoUpdate = false;
      mesh.geometry.computeBoundingSphere();
    }
    finishMaterials(meshes, options.shading ?? 'baked', options.gain ?? 1.1);
    sharedAtlases = shareNearTextures(meshesOf(near.scene), meshesOf(far.scene));
    group.updateMatrixWorld(true);
  } catch (error) {
    disposeTree(group, ...gltfs.map(g => g.scene));
    throw error;
  }
  if (options.signal?.aborted) { disposeTree(group); throw new Error('Tower scan load cancelled'); }
  const [ax, , az] = towerMeta.anchor;
  const stats: Record<string, unknown> = {
    source: 'seanhlewis/utimagery@13f08efe tower.glb (MIT), aligned + cropped', centre: [ax, az], yawDeg: towerMeta.yawRad * 180 / Math.PI,
    cutY: towerMeta.cutY, topY: towerMeta.crown.roofY, triangles, lodTriangles: towerMeta.files.map(f => f.triangles + (f.authoredTriangles ?? 0)), sharedAtlases,
    shading: options.shading ?? 'baked', residuals: towerMeta.transform.residuals.cornerRms2D_m, loadMs: Math.round(performance.now() - started),
  };
  let state: 'prepared' | 'committed' | 'disposed' = 'prepared';
  return {
    group, stats,
    dispose() { if (state !== 'prepared') return; state = 'disposed'; disposeTree(group); },
    commit(physics) {
      if (state !== 'prepared') throw new Error(`Tower scan already ${state}`);
      const colliders: RAPIER.Collider[] = [];
      try {
        // Simplified collision measured from the scan (tools/scans/build-tower.mjs): one
        // tower-aligned shaft cuboid plus a 0.25 m heightfield of the visible tops.
        const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -towerMeta.yawRad);
        const q = { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w };
        const u = towerMeta.axes.u, v = towerMeta.axes.v;
        for (const p of towerMeta.proxies as { name: string; half?: number; halfU?: number; halfV?: number; centerU?: number; centerV?: number; y0: number; y1: number }[]) {
          const hu = p.halfU ?? p.half!, hv = p.halfV ?? p.half!, cu = p.centerU ?? 0, cv = p.centerV ?? 0;
          colliders.push(physics.createCollider(RAPIER.ColliderDesc.cuboid(hu, (p.y1 - p.y0) / 2, hv)
            .setTranslation(ax + cu * u[0] + cv * v[0], (p.y0 + p.y1) / 2, az + cu * u[1] + cv * v[1])
            .setRotation(q).setFriction(0.8)));
        }
        const hf = towerMeta.heightfield;
        colliders.push(physics.createCollider(RAPIER.ColliderDesc
          .heightfield(hf.nrows, hf.ncols, new Float32Array(hf.heightsColumnMajor), { x: hf.size, y: 1, z: hf.size })
          .setTranslation(ax, 0, az).setRotation(q).setFriction(0.8)));
      } catch (error) {
        // Roll back partial physics; the prepared visuals stay owned by the caller.
        for (const c of colliders) try { physics.removeCollider(c, false); } catch { /* world already gone */ }
        throw error;
      }
      state = 'committed';
      stats.colliders = colliders.length;
      let disposed = false;
      return {
        group, colliders, stats,
        hiddenAuthored: ['buildTower(world): authored Tower shaft, crown, clock faces and its box colliders at the MAI landmark (-215.27, 10.40)'],
        dispose() {
          if (disposed) return; disposed = true;
          // Call before physics.free(); a freed world is skipped instead of throwing.
          for (const c of colliders) try { if (physics.getCollider(c.handle)) physics.removeCollider(c, false); } catch { /* freed */ }
          disposeTree(group);
        },
      };
    },
  };
}

/** Prepare + commit in one step (harness convenience). Prefer prepareScanTower in the game
 * so colliders are created only after the caller confirms it is still alive. */
export async function loadScanTower(options: ScanTowerOptions & { physics: RAPIER.World }): Promise<ScanTower> {
  const prepared = await prepareScanTower(options);
  if (options.signal?.aborted) { prepared.dispose(); throw new Error('Tower scan load cancelled'); }
  try { return prepared.commit(options.physics); } catch (error) { prepared.dispose(); throw error; }
}

export interface ScanField {
  group: THREE.Group;
  colliders: RAPIER.Collider[];
  hiddenAuthored: string[];
  stats: Record<string, unknown>;
  dispose(): void;
}

/** Visual-only scanned DKR field decal on the generated field plane (`fieldY` from the
 * generated stadium bowl stats). No collider: the generated field collider stays authoritative. */
export async function loadScanField(options: ScanLoadOptions & { fieldY: number; shading?: 'baked' | 'lit' }): Promise<ScanField> {
  if (!Number.isFinite(options.fieldY)) throw new Error('Scanned field needs the generated field height');
  const base = options.baseUrl ?? '/assets/scans/', load = options.load ?? defaultLoad;
  const [gltf] = await acquireAll([assetUrl(base, fieldMeta.file.name)], load, options.timeoutMs ?? 20000, 'Field scan load', options.signal);
  const group = new THREE.Group();
  try {
    group.name = 'DKR field photogrammetry decal (visual only)';
    const [ax, , az] = fieldMeta.anchor;
    group.position.set(ax, options.fieldY + fieldMeta.yOffsetAboveGeneratedField, az);
    group.add(gltf.scene);
    const meshes = meshesOf(gltf.scene);
    assertFinite(meshes, 'Field scan');
    for (const mesh of meshes) {
      const g = mesh.geometry, n = g.getAttribute('position').count;
      if (!g.getAttribute('normal')) g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
      mesh.receiveShadow = true; mesh.castShadow = false;
    }
    // Captured colour (unlit) by default per the render contract; 'lit' shades like the generated turf.
    finishMaterials(meshes, options.shading ?? 'baked', 1);
    for (const m of resourcesOf(group).materials) Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  } catch (error) {
    disposeTree(group, gltf.scene);
    throw error;
  }
  if (options.signal?.aborted) { disposeTree(group); throw new Error('Field scan load cancelled'); }
  let disposed = false;
  return {
    group, colliders: [], hiddenAuthored: [],
    stats: { source: 'seanhlewis/utimagery@13f08efe stadium.glb (MIT), field only, flattened', triangles: fieldMeta.file.triangles, y: group.position.y, coverageOfOpening: fieldMeta.crop.openingCoverage },
    dispose() { if (disposed) return; disposed = true; disposeTree(group); },
  };
}

/** DKR stadium scans (west stand + field decal) are a DIAGNOSTIC comparison only: the default game builds the complete
 * authored stadium and requests neither GLB. Opt in with `?stadiumscan=1` (or the legacy `?stand=scan`). */
export function stadiumScanRequested(search: string) {
  const q = new URLSearchParams(search);
  return q.get('stadiumscan') === '1' || q.get('stand') === 'scan';
}

/** The DKR west-stand sector replaced by the scan (pass to buildLocalContext({ stadium: { scanSector } })
 * only when a prepared stand is present). Heights are metres above the generated field plane. */
export const SCAN_STAND_SECTOR: StadiumScanSector = {
  side: 'west', vMin: standMeta.sector.vMin, vMax: standMeta.sector.vMax, step: standMeta.sector.step,
  seamMin: standMeta.sector.seamMin, seamMax: standMeta.sector.seamMax,
  front: standMeta.sector.front as [number, number][], outer: standMeta.sector.outer as [number, number, number][],
  pressBox: standMeta.sector.pressBox ?? null, parapet: standMeta.sector.parapet ?? 0,
};

export interface ScanStand {
  group: THREE.Group;
  /** The near-LOD visual meshes: the stand's visible floor for ground queries (map travel, scooter).
   * Not the far LOD (a second, coarser copy of the same surface) and not the collider. */
  groundSurface: THREE.Object3D;
  colliders: RAPIER.Collider[];
  hiddenAuthored: string[];
  stats: Record<string, unknown>;
  dispose(): void;
}
/** Decoded DKR west stand (visual + reduced collider surface), not yet in physics. */
export interface PreparedScanStand {
  group: THREE.Group;
  stats: Record<string, unknown>;
  sector: StadiumScanSector;
  /** fieldY: generated stadium field plane (localContext.stats.stadium.fieldY). */
  commit(physics: RAPIER.World, fieldY: number): ScanStand;
  dispose(): void;
}

/**
 * Aligned photogrammetry of the DKR west stand only (lower bowl, upper deck, press-box roof),
 * cropped to the generated bowl's west straight, texture re-baked from the scan. The east and
 * north/south stands stay generated; this is not a complete stadium scan.
 */
export async function prepareScanStand(options: ScanLoadOptions & { shading?: 'baked' | 'lit'; farDistance?: number } = {}): Promise<PreparedScanStand> {
  const base = options.baseUrl ?? '/assets/scans/', load = options.load ?? defaultLoad;
  const gltfs = await acquireAll(standMeta.files.map(f => assetUrl(base, f.name)), load, options.timeoutMs ?? 20000, 'Stand scan load', options.signal);
  const [near, far] = gltfs;
  const group = new THREE.Group();
  let colliderPositions: Float32Array, colliderIndices: Uint32Array, triangles = 0, sharedAtlases = 0;
  try {
    group.name = 'DKR west stand photogrammetry (aligned scan)';
    const [ax, , az] = standMeta.anchor;
    group.position.set(ax, 0, az);
    // The reduced collider surface ships inside the near GLB; extract it and drop its mesh.
    const colliderMesh = meshesOf(near.scene).find(m => m.name.includes('collider') || m.parent?.name.includes('collider'));
    if (!colliderMesh) throw new Error('Stand scan collider surface missing');
    const cp = colliderMesh.geometry.getAttribute('position'), ci = colliderMesh.geometry.index;
    if (!ci || !cp.count) throw new Error('Stand scan collider surface is empty');
    colliderPositions = new Float32Array(cp.array as ArrayLike<number>);
    colliderIndices = Uint32Array.from(ci.array as ArrayLike<number>);
    for (const v of colliderPositions) if (!Number.isFinite(v)) throw new Error('Stand scan collider has non-finite vertices');
    for (const i of colliderIndices) if (i >= cp.count) throw new Error('Stand scan collider index out of range');
    disposeTree(colliderMesh);
    const lod = new THREE.LOD();
    lod.name = 'DKR west stand scan LOD';
    lod.addLevel(near.scene, 0);
    lod.addLevel(far.scene, options.farDistance ?? 420);
    group.add(lod);
    const meshes = [...meshesOf(near.scene), ...meshesOf(far.scene)];
    triangles = assertFinite(meshesOf(near.scene), 'Stand scan near LOD') + assertFinite(meshesOf(far.scene), 'Stand scan far LOD');
    for (const mesh of meshes) { mesh.castShadow = true; mesh.receiveShadow = options.shading === 'lit'; mesh.matrixAutoUpdate = false; mesh.geometry.computeBoundingSphere(); }
    finishMaterials(meshes, options.shading ?? 'baked', 1);
    // One atlas on the GPU for both LODs (tools/scans/stand-share-atlas.mjs: the far GLB carries a small placeholder).
    sharedAtlases = shareNearTextures(meshesOf(near.scene), meshesOf(far.scene));
  } catch (error) {
    disposeTree(group, ...gltfs.map(g => g.scene));
    throw error;
  }
  if (options.signal?.aborted) { disposeTree(group); throw new Error('Stand scan load cancelled'); }
  const stats: Record<string, unknown> = {
    source: 'seanhlewis/utimagery@13f08efe stadium.glb (MIT), west stand only, aligned + cropped, source photo charts re-packed',
    sector: [standMeta.sector.vMin, standMeta.sector.vMax], triangles, lodTriangles: standMeta.files.map(f => f.triangles),
    colliderTriangles: colliderIndices.length / 3, texelsPerMetreSource: standMeta.crop.texelsPerMetre, sharedAtlases,
  };
  let state: 'prepared' | 'committed' | 'disposed' = 'prepared';
  return {
    group, stats, sector: SCAN_STAND_SECTOR,
    dispose() { if (state !== 'prepared') return; state = 'disposed'; disposeTree(group); },
    commit(physics, fieldY) {
      if (state !== 'prepared') throw new Error(`Stand scan already ${state}`);
      if (!Number.isFinite(fieldY)) throw new Error('Stand scan needs the generated field height');
      const [ax, , az] = standMeta.anchor;
      const world = new Float32Array(colliderPositions.length);
      for (let k = 0; k < world.length; k += 3) { world[k] = colliderPositions[k] + ax; world[k + 1] = colliderPositions[k + 1] + fieldY; world[k + 2] = colliderPositions[k + 2] + az; }
      const colliders: RAPIER.Collider[] = [];
      try {
        colliders.push(physics.createCollider(RAPIER.ColliderDesc.trimesh(world, colliderIndices).setFriction(0.8)));
      } catch (error) {
        for (const c of colliders) try { physics.removeCollider(c, false); } catch { /* freed */ }
        throw error;
      }
      group.position.y = fieldY;
      group.updateMatrixWorld(true);
      state = 'committed';
      stats.colliders = colliders.length; stats.fieldY = fieldY;
      let disposed = false;
      return {
        group, colliders, stats, groundSurface: near.scene,
        hiddenAuthored: ['generated DKR bowl rows/parapet on the west straight (field-frame v -53..53); replaced by seam walls, rim parapet + roof cap, press-box massing and outer wall in stadium-bowl.ts'],
        dispose() {
          if (disposed) return; disposed = true;
          for (const c of colliders) try { if (physics.getCollider(c.handle)) physics.removeCollider(c, false); } catch { /* freed */ }
          disposeTree(group);
        },
      };
    },
  };
}
