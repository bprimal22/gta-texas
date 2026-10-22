// Focused deep-west extension check (D37-D40). Built by deep-west.vite.config.mjs, run by run-deep-west-check.mjs.
// Uses the shipped asset, the shipped offline-terrain-61 buffer and the real runtime modules; no browser.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { decodeDeepWest, fnvWords, DeepWestAssetError, SEAM_X } from '../../lib/campus/extension/deep-west/format';
import { buildDeepWestGeometry, DeepWest } from '../../lib/campus/extension/deep-west';
import { clampToWorld, mapBounds, worldBoundaryWalls, type ExtensionBounds } from '../../lib/campus/extension/deep-west/bounds';
import { outdoorPoint, travelCandidates, travelLanding, travelProbe } from '../../lib/campus/map-travel';
import { findFlightLanding } from '../../lib/campus/flight-landing';
import { CAMERA_SHOTS, EXTENSION_SHOTS, findShot } from '../../lib/campus/render/camera-shots';
import type { CampusData, Point } from '../../lib/campus/types';

type Result = { name: string; pass: boolean; detail: unknown };

function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export async function run(root: string) {
  const results: Result[] = [];
  const check = (name: string, pass: boolean, detail: unknown) => { results.push({ name, pass, detail }); };
  const sha = (p: string) => createHash('sha256').update(readFileSync(resolve(root, p))).digest('hex');
  const manifest = JSON.parse(readFileSync(resolve(root, 'public/assets/extension/deep-west-v1.manifest.json'), 'utf8'));
  const ownership = JSON.parse(readFileSync(resolve(root, 'lib/campus/extension/deep-west/ownership.json'), 'utf8'));
  const campus = JSON.parse(readFileSync(resolve(root, 'public/data/campus.json'), 'utf8')) as CampusData;

  // ---------------------------------------------------------------- 1. old world untouched
  const oldFiles = { 'offline-terrain-61.bin.gz': 'public/assets/campus/offline-terrain-61.bin.gz', 'campus.json': 'public/data/campus.json', 'terrain.json': 'public/data/terrain.json' };
  const hashDiffs = Object.entries(oldFiles).filter(([k, p]) => manifest.inputs[k].sha256 !== sha(p)).map(([k]) => k);
  check('old-world source files identical to the baked inputs', hashDiffs.length === 0, { changed: hashDiffs, offlineTerrain: sha(oldFiles['offline-terrain-61.bin.gz']) });
  const bounds = campus.bounds.slice(); bounds[3] = Math.max(bounds[3], 1536); // game.ts boot mutation
  const original = [
    [bounds[0] - 1, (bounds[1] + bounds[3]) / 2, 1, (bounds[3] - bounds[1]) / 2],
    [bounds[2] + 1, (bounds[1] + bounds[3]) / 2, 1, (bounds[3] - bounds[1]) / 2],
    [(bounds[0] + bounds[2]) / 2, bounds[1] - 1, (bounds[2] - bounds[0]) / 2, 1],
    [(bounds[0] + bounds[2]) / 2, bounds[3] + 1, (bounds[2] - bounds[0]) / 2, 1],
  ];
  check('fallback walls are exactly the original four', JSON.stringify(worldBoundaryWalls(bounds, null)) === JSON.stringify(original), worldBoundaryWalls(bounds, null));
  const rnd = seeded(7);
  let clampDiff = 0;
  for (let i = 0; i < 2000; i++) {
    const x = -2000 + rnd() * 3600, z = -1200 + rnd() * 3000;
    const [cx, cz] = clampToWorld(bounds, null, x, z);
    clampDiff = Math.max(clampDiff, Math.abs(cx - THREE.MathUtils.clamp(x, bounds[0] + 2, bounds[2] - 2)), Math.abs(cz - THREE.MathUtils.clamp(z, bounds[1] + 2, bounds[3] - 2)));
  }
  check('fallback flight clamp equals the original clamp', clampDiff === 0 && mapBounds(bounds, null) === bounds, { clampDiff });

  // ---------------------------------------------------------------- 2. decode + fail closed
  const offlineBytes = gunzipSync(readFileSync(resolve(root, oldFiles['offline-terrain-61.bin.gz'])));
  const offlineView = new DataView(offlineBytes.buffer, offlineBytes.byteOffset, offlineBytes.byteLength);
  const offlineCount = offlineView.getUint32(8, true);
  const offlinePositions = new Float32Array(offlineBytes.buffer.slice(offlineBytes.byteOffset + 20, offlineBytes.byteOffset + 20 + offlineCount * 12));
  const assetGz = readFileSync(resolve(root, 'public/assets/extension/deep-west-v1.bin.gz'));
  check('asset sha matches manifest', createHash('sha256').update(assetGz).digest('hex') === manifest.assetSha256, manifest.assetSha256);
  const raw = gunzipSync(assetGz);
  const buffer = () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  const t0 = performance.now();
  const data = decodeDeepWest(buffer(), offlinePositions);
  const decodeMs = performance.now() - t0;
  check('asset decodes and validates against the shipped offline seam', true, { decodeMs: +decodeMs.toFixed(1), seam: data.seam, counts: data.meta.counts });
  const rejects = (label: string, mutate: (b: ArrayBuffer) => ArrayBuffer, positions: ArrayLike<number> = offlinePositions, expect = /./) => {
    try { decodeDeepWest(mutate(buffer()), positions); check(`fail closed: ${label}`, false, 'accepted'); }
    catch (e) { check(`fail closed: ${label}`, e instanceof DeepWestAssetError && expect.test((e as Error).message), (e as Error).message); }
  };
  rejects('flipped payload byte', b => { new Uint8Array(b)[b.byteLength - 7] ^= 1; return b; }, offlinePositions, /checksum/);
  rejects('truncated', b => b.slice(0, b.byteLength - 16), offlinePositions, /length/);
  rejects('bad magic', b => { new DataView(b).setUint32(0, 0, true); return b; }, offlinePositions, /magic/);
  const resign = (b: ArrayBuffer) => { new DataView(b).setUint32(16, fnvWords(new Uint8Array(b, 20)), true); return b; };
  const metaLen = new DataView(buffer()).getUint32(8, true);
  const terrainSection = data.meta.sections.find(s => s.name === 'terrain.position')!;
  rejects('re-signed asset with a vertex east of the seam', b => {
    const p = new Float32Array(b, 20 + metaLen + terrainSection.byteOffset, terrainSection.count);
    p[0] = -759.5; return resign(b);
  }, offlinePositions, /east of the seam/);
  const movedSeam = offlinePositions.slice();
  for (let i = 0; i < movedSeam.length; i += 3) if (movedSeam[i] === SEAM_X && movedSeam[i + 2] === 0) movedSeam[i + 1] += 0.001;
  rejects('old seam differs by 1 mm', b => b, movedSeam, /seam/);

  // ---------------------------------------------------------------- 3. build with stub (borrowed) materials
  const geometry = buildDeepWestGeometry(data);
  const stub = (name: string) => Object.assign(new THREE.MeshStandardMaterial(), { name });
  const contextMats = new Map<string, THREE.Material>();
  const extension = new DeepWest(geometry, {
    terrain: stub('grass'), asphalt: stub('asphalt'), concrete: stub('concrete'),
    context: key => { if (!contextMats.has(key)) contextMats.set(key, stub(`Local context ${key}`)); return contextMats.get(key); },
  }, decodeMs);
  const ext: ExtensionBounds = extension.bounds;
  let maxX = -Infinity;
  for (const p of geometry.parts) { p.geometry.computeBoundingBox(); maxX = Math.max(maxX, p.geometry.boundingBox!.max.x); }
  check('no extension geometry east of x=-760', maxX <= SEAM_X, { maxX, parts: geometry.parts.length });
  check('collider geometries are the rendered geometries (shared buffers)',
    extension.colliderGeometries.length === geometry.parts.length && extension.colliderGeometries.every((g, i) => g === geometry.parts[i].geometry), extension.colliderGeometries.length);
  const keys = new Set(data.meta.buildings.map(b => b.key));
  const owned = Object.values(ownership.districts as Record<string, { buildings: string[] }>).flatMap(d => d.buildings);
  const excludedKeys = (ownership.excludedBuildings as { key: string; reason: string }[]);
  check('ownership: every included key owned once, excluded keys disjoint with reasons, 562 source records accounted',
    owned.length === keys.size && owned.every(k => keys.has(k)) && excludedKeys.every(e => !keys.has(e.key) && e.reason.length > 10) && owned.length + excludedKeys.length === 562,
    { included: owned.length, excluded: excludedKeys.length });
  const campusIds = new Set(campus.buildings.map(b => b.id));
  check('no duplicate of an existing campus.json record', data.meta.buildings.every(b => !campusIds.has(b.sourceId)), { overlapping: data.meta.buildings.filter(b => campusIds.has(b.sourceId)).map(b => b.key) });
  check('holes preserved: rendered ring count equals source ring count', data.meta.buildings.every(b => b.rings.length === b.sourceRingCount),
    { withHoles: data.meta.buildings.filter(b => b.rings.length > 1).length, holes: geometry.stats.holes });
  // Projected up-facing area of building parts == footprint area (roof/deck/coping close every footprint).
  const ringArea = (r: number[][]) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
  const footprintArea = data.meta.buildings.reduce((s, b) => s + ringArea(b.rings[0]) - b.rings.slice(1).reduce((h, r) => h + ringArea(r), 0), 0);
  let upArea = 0;
  for (const p of geometry.parts) {
    if (!p.material.startsWith('wall:') && !p.material.startsWith('roof:')) continue;
    const pos = p.geometry.getAttribute('position'), idx = p.geometry.index!;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
      const ux = pos.getX(b) - pos.getX(a), uz = pos.getZ(b) - pos.getZ(a), vx = pos.getX(c) - pos.getX(a), vz = pos.getZ(c) - pos.getZ(a);
      const cross = uz * vx - ux * vz; // y of (b-a) x (c-a)
      if (cross > 1e-9) upArea += cross / 2;
    }
  }
  check('roofs close every footprint (projected up-facing area == footprint area)', Math.abs(upArea - footprintArea) / footprintArea < 0.002,
    { footprintArea: +footprintArea.toFixed(1), upArea: +upArea.toFixed(1) });
  const wallParts = geometry.parts.filter(p => p.material.startsWith('wall:'));
  const families = new Set(wallParts.map(p => p.material));
  const byDistrict = Object.fromEntries(['D37', 'D38', 'D39', 'D40'].map(d => [d, wallParts.filter(p => p.district === d).map(p => p.material)]));
  check('per-district architectural treatment (wall families + windows + roof forms)',
    families.size >= 4 && Object.values(byDistrict).every(v => v.length >= 1) && geometry.stats.windowsEdges > 5000 && geometry.stats.gable > 50 && geometry.stats.flatParapet > 200,
    { byDistrict, stats: geometry.stats });

  // ---------------------------------------------------------------- 4. seam continuity and drape
  const old = new Map<number, number>();
  for (let i = 0; i < offlinePositions.length; i += 3) if (offlinePositions[i] === SEAM_X) old.set(offlinePositions[i + 2], offlinePositions[i + 1]);
  const oldAt = (z: number) => { const z0 = Math.floor(z / 8) * 8, a = old.get(z0)!, b = old.get(z0 + 8)!; return a + (b - a) * (z - z0) / 8; };
  let seamMax = 0;
  for (let i = 0; i <= 2000; i++) {
    const z = ext.zmin + (ext.zmax - ext.zmin) * i / 2000;
    const h = extension.height(SEAM_X - 1e-6, z);
    seamMax = Math.max(seamMax, h === null ? Infinity : Math.abs(h - oldAt(z)));
  }
  check('seam: extension height at x=-760^- equals the offline-61 edge (2001 samples)', seamMax < 2e-4, { maxAbs: seamMax });
  let missing = 0;
  for (let x = ext.xmin; x < SEAM_X; x += 1.7) for (let z = ext.zmin; z <= ext.zmax; z += 1.7) if (extension.height(x, z) === null) missing++;
  check('extension height defined across the whole owned union (flight/travel datum)', missing === 0, { missing });
  let drapeMin = Infinity, drapeMax = -Infinity, drapeVerts = 0;
  for (const [, p] of data.surfaces) for (let i = 0; i < p.length; i += 3) {
    const x = Math.min(p[i], SEAM_X - 1e-4), h = extension.height(x, p[i + 2]);
    if (h === null) { drapeMin = -Infinity; continue; }
    const expected = data.meta.drape * Math.min(1, Math.max(0, (SEAM_X - p[i]) / data.meta.drapeFade));
    const d = p[i + 1] - h - expected; drapeMin = Math.min(drapeMin, d); drapeMax = Math.max(drapeMax, d); drapeVerts++;
  }
  check('surfaces follow terrain + 0.04 m (fading to 0 at the seam) at every vertex: no lip, no gap', drapeMin > -5e-4 && drapeMax < 5e-4, { drapeVerts, drapeMin, drapeMax })
  let blendSlope = 0;
  for (let z = ext.zmin + 1; z < ext.zmax - 1; z += 2) {
    const a = extension.height(-809, z)!, b = extension.height(-760.001, z)!;
    blendSlope = Math.max(blendSlope, Math.abs(b - a) / 49);
  }
  check('blend band [-808,-760] mean grade stays walkable (< 25 %)', blendSlope < 0.25, { maxMeanGrade: +blendSlope.toFixed(4) });

  // ---------------------------------------------------------------- 5. physics: parity, seam rays, movement, walls
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -24, z: 0 });
  const trimesh = (g: THREE.BufferGeometry) => world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(g.attributes.position.array),
    new Uint32Array(g.index?.array ?? Uint32Array.from({ length: g.attributes.position.count }, (_, i) => i))).setFriction(0.8));
  const extHandles = new Set(extension.colliderGeometries.map(g => trimesh(g).handle));
  world.createCollider(RAPIER.ColliderDesc.trimesh(offlinePositions, Uint32Array.from({ length: offlinePositions.length / 3 }, (_, i) => i)).setFriction(0.8));
  for (const [cx, cz, hx, hz] of worldBoundaryWalls(bounds, ext)) world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 150, hz).setTranslation(cx, 0, cz));
  world.step();
  const down = (x: number, z: number, from = 220, filter?: (c: RAPIER.Collider) => boolean) => {
    const hit = world.castRay(new RAPIER.Ray({ x, y: from, z }, { x: 0, y: -1, z: 0 }), 400, true, undefined, undefined, undefined, undefined, filter);
    return hit ? from - hit.timeOfImpact : null;
  };
  extension.group.updateMatrixWorld(true);
  const meshes = extension.group.children as THREE.Mesh[];
  const raycaster = new THREE.Raycaster();
  let parityMax = 0, parityN = 0;
  const pr = seeded(11);
  for (let i = 0; i < 160; i++) {
    const x = ext.xmin + 1 + pr() * (SEAM_X - ext.xmin - 2), z = ext.zmin + 1 + pr() * (ext.zmax - ext.zmin - 2);
    raycaster.set(new THREE.Vector3(x, 220, z), new THREE.Vector3(0, -1, 0));
    const vis = raycaster.intersectObjects(meshes, false)[0];
    const phys = down(x, z, 220, c => extHandles.has(c.handle));
    if (!vis || phys === null) { parityMax = Infinity; continue; }
    parityMax = Math.max(parityMax, Math.abs(vis.point.y - phys)); parityN++;
  }
  check('render/collider parity: first visible hit == Rapier hit (160 random columns)', parityMax < 1e-3, { samples: parityN, maxAbs: parityMax });
  let seamRay = 0, seamSamples = 0;
  for (let z = ext.zmin + 0.25; z < ext.zmax; z += 1.3) {
    const w = down(-760.002, z, 220, c => extHandles.has(c.handle)), e = down(-759.998, z, 220, c => !extHandles.has(c.handle));
    if (w === null || e === null) { seamRay = Infinity; continue; }
    seamRay = Math.max(seamRay, Math.abs(w - e)); seamSamples++;
  }
  check('physical seam: extension collider (x=-760.002) vs offline-61 collider (x=-759.998) agree (no step)', seamRay < 0.003, { samples: seamSamples, maxAbs: seamRay });

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(-740, 50, 0));
  const player = world.createCollider(RAPIER.ColliderDesc.capsule(0.54, 0.34).setFriction(0), body);
  const controller = world.createCharacterController(0.025);
  controller.enableAutostep(0.32, 0.2, false);
  controller.enableSnapToGround(0.38);
  controller.setMaxSlopeClimbAngle(Math.PI * 0.25);
  controller.setMinSlopeSlideAngle(Math.PI * 0.28);
  const ground = (x: number, z: number) => extension.height(x, z) ?? down(x, z, 220, c => c.handle !== player.handle && !c.isSensor() && c.shape.type === RAPIER.ShapeType.TriMesh)!;
  const place = (x: number, z: number) => { const y = ground(x, z) + 0.92; body.setTranslation({ x, y, z }, true); body.setNextKinematicTranslation({ x, y, z }); world.step(); };
  const walk = (dirX: number, dirZ: number, seconds: number, speed = 8) => {
    const dt = 1 / 60; let vy = 0, maxDy = 0, stuck = 0;
    const start = body.translation();
    let prev = { ...start };
    for (let i = 0; i < seconds * 60; i++) {
      vy = Math.max(vy - 24 * dt, -30);
      controller.computeColliderMovement(player, { x: dirX * speed * dt, y: vy * dt, z: dirZ * speed * dt });
      if (controller.computedGrounded()) vy = 0;
      const m = controller.computedMovement(), p = body.translation();
      const next = { x: p.x + m.x, y: p.y + m.y, z: p.z + m.z };
      body.setNextKinematicTranslation(next); world.step();
      maxDy = Math.max(maxDy, Math.abs(next.y - prev.y));
      if (Math.hypot(next.x - prev.x, next.z - prev.z) < speed * dt * 0.2) stuck++;
      prev = next;
    }
    const end = body.translation();
    return { start: [+start.x.toFixed(2), +start.z.toFixed(2)], end: [+end.x.toFixed(2), +end.y.toFixed(2), +end.z.toFixed(2)], maxDy: +maxDy.toFixed(3), stuckFrames: stuck,
      aboveGround: +(end.y - 0.905 - ground(end.x, end.z)).toFixed(3) };
  };
  const roadZ = new Set<number>();
  const road = data.surfaces.get('Paved Road')!;
  for (let i = 0; i < road.length; i += 3) if (road[i] > -761) roadZ.add(Math.round(road[i + 2] / 4) * 4);
  const crossings = [...new Set([...[...roadZ].sort((a, b) => a - b).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 6)) === 0), -236, 0, 337, 551])];
  const routes = [];
  for (const z of crossings) {
    if (z <= ext.zmin + 2 || z >= ext.zmax - 2) continue;
    place(-745, z);
    const west = walk(-1, 0, 7);
    const east = walk(1, 0, 7);
    // Attribute a stall: the nearest included footprint edge to where the west walk stopped.
    let blockedBy: string | null = null;
    if (west.end[0] > -790) for (const bld of data.meta.buildings) for (const ring of bld.rings) for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length], dx = q[0] - p[0], dz = q[1] - p[1], l = dx * dx + dz * dz;
      const t = l ? Math.max(0, Math.min(1, ((west.end[0] - p[0]) * dx + (west.end[2] - p[1]) * dz) / l)) : 0;
      if (Math.hypot(p[0] + dx * t - west.end[0], p[1] + dz * t - west.end[2]) < 0.6) blockedBy = bld.key;
    }
    routes.push({ z, west, east, blockedBy });
  }
  // A crossing is accepted when the capsule ends >= 40 m west then back east without long stalls;
  // stalls at a mapped building or kerb near the seam are reported, not hidden.
  // Every route must either cross >= 30 m west or be stopped by an included building wall (named), then return east past the seam.
  const routeOk = routes.every(r => (r.west.end[0] < -790 || r.blockedBy) && r.east.end[0] > -760 && Math.abs(r.west.aboveGround) < 0.2 && r.west.maxDy < 0.3 && r.east.maxDy < 0.3);
  check('walking across the seam (old offline-61 terrain <-> extension), stalls attributed to building walls', routeOk && routes.some(r => !r.blockedBy), routes);
  place(-1540, 0); const westWall = walk(-1, 0, 6);
  place(-1000, -490); const northWall = walk(0, -1, 5);
  place(-1000, 550); const southWall = walk(0, 1, 5);
  place(-740, -700); const oldWestNorth = walk(-1, 0, 5);
  place(-740, 800); const oldWestSouth = walk(-1, 0, 5);
  check('extension walls close x=-1570, z=-510, z=570', westWall.end[0] >= ext.xmin - 0.05 && northWall.end[2] >= ext.zmin - 0.05 && southWall.end[2] <= ext.zmax + 0.05,
    { westWall, northWall, southWall });
  check('original west wall still closed outside the seam span', oldWestNorth.end[0] >= -760.05 && oldWestSouth.end[0] >= -760.05, { oldWestNorth, oldWestSouth });
  // Buildings are solid: run at an included building's centre from 25 m away; must stop outside it.
  const solid = [];
  for (const d of ['D37', 'D38', 'D39', 'D40']) {
    const b = data.meta.buildings.filter(x => x.district === d && x.rings.length === 1).sort((p, q) => q.heightMeters - p.heightMeters)[0];
    const cx = b.rings[0].reduce((s, p) => s + p[0], 0) / b.rings[0].length, cz = b.rings[0].reduce((s, p) => s + p[1], 0) / b.rings[0].length;
    let start: Point | null = null;
    for (let a = 0; a < 16 && !start; a++) {
      const p: Point = [cx + Math.cos(a * Math.PI / 8) * 28, cz + Math.sin(a * Math.PI / 8) * 28];
      if (outdoorPoint(campus, p, extension.travelRegion)) start = p;
    }
    if (!start) continue;
    place(start[0], start[1]);
    const len = Math.hypot(cx - start[0], cz - start[1]);
    const r = walk((cx - start[0]) / len, (cz - start[1]) / len, 6, 6);
    const inside = pointInRing([r.end[0], r.end[2]], b.rings[0]);
    solid.push({ key: b.key, district: d, height: b.heightMeters, inside, end: r.end });
  }
  check('included buildings are solid (capsule stops outside the footprint)', solid.length === 4 && solid.every(s => !s.inside), solid);

  // ---------------------------------------------------------------- 6. travel + flight
  const surface = (x: number, z: number, fromY: number, distance: number) => {
    raycaster.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0)); raycaster.far = distance;
    const hit = raycaster.intersectObjects(meshes, false).find(h => h.face && h.face.normal.y > .5) ?? null;
    raycaster.far = Infinity; return hit;
  };
  const travel = [];
  for (const s of EXTENSION_SHOTS.filter(s => s.id.endsWith('southwest'))) {
    const requested: Point = [s.target[0], s.target[2]];
    const candidates = travelCandidates(campus, requested, extension.travelRegion);
    const legacy = travelCandidates(campus, requested);
    let landing: THREE.Vector3 | null = null, tried = 0;
    for (const c of candidates) { tried++; landing = travelLanding(world, player, c, ground(...c), surface, undefined, travelProbe(campus, c)); if (landing) break; }
    travel.push({ district: s.district, requested, candidates: candidates.length, tried, landing: landing?.toArray().map(v => +v.toFixed(2)) ?? null,
      offset: landing ? +Math.hypot(landing.x - requested[0], landing.z - requested[1]).toFixed(2) : null,
      legacyCandidatesWest: legacy.filter(p => p[0] < SEAM_X).length });
  }
  check('map travel lands inside each extension district; legacy travel never targets x<-760',
    travel.every(t => t.landing && t.landing[0] < SEAM_X && t.offset! < 30 && t.legacyCandidatesWest === 0), travel);
  const flight = [];
  for (const s of EXTENSION_SHOTS.filter(s => s.id.endsWith('northeast'))) {
    const g = ground(s.target[0], s.target[2]);
    const p = { x: s.target[0], y: g + 60, z: s.target[2] };
    body.setTranslation(p, true); world.step();
    const t = findFlightLanding(world, player, p);
    flight.push({ district: s.district, target: t?.toArray().map(v => +v.toFixed(2)) ?? null });
  }
  check('flight landing finds extension ground/roofs in each district', flight.every(f => f.target && f.target[0] < SEAM_X), flight);
  const crossing = clampToWorld(bounds, ext, -770, 0), blockedNorth = clampToWorld(bounds, ext, -770, -700), extWest = clampToWorld(bounds, ext, -1580, 0);
  check('flight clamp: open across the seam span only', crossing[0] === -770 && blockedNorth[0] === bounds[0] + 2 && extWest[0] === ext.xmin + 2,
    { crossing, blockedNorth, extWest, mapBounds: mapBounds(bounds, ext) });

  // ---------------------------------------------------------------- 7. shots
  const shotErrors = EXTENSION_SHOTS.filter(s => {
    const gc = extension.height(s.position[0], s.position[2]), gt = extension.height(s.target[0], s.target[2]);
    return gc === null || gt === null || Math.abs(s.position[1] - gc - 30) > 0.02 || Math.abs(s.target[1] - gt - 8) > 0.02 || findShot(s.id) !== s;
  }).map(s => s.id);
  check('16 named review shots at reference poses, camera = extension terrain + 30 m, resolvable, not in CAMERA_SHOTS',
    EXTENSION_SHOTS.length === 16 && shotErrors.length === 0 && !CAMERA_SHOTS.some(s => EXTENSION_SHOTS.includes(s as never)),
    { ids: EXTENSION_SHOTS.map(s => s.id), errors: shotErrors });

  extension.dispose();
  world.free();
  return { pass: results.every(r => r.pass), results, decodeMs, stats: extension.stats };
}

function pointInRing([x, z]: Point, ring: [number, number][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
