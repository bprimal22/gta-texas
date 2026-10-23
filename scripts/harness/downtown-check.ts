// Focused downtown extension check. Built by downtown.vite.config.mjs, run by run-downtown-check.mjs.
// Uses the shipped asset, the shipped Capitol strip patch and the real runtime modules with real Rapier; no browser.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { decodeDowntown, fnvWords, DowntownAssetError, type StripSeamSource } from '../../lib/campus/extension/downtown/format';
import { buildDowntownGeometry, Downtown, LOWRISE_DISTANCE } from '../../lib/campus/extension/downtown';
import { worldWalls, clampToWorld, mapBounds } from '../../lib/campus/extension/world-bounds';
import { clampToWorld as clampDeepWest, worldBoundaryWalls } from '../../lib/campus/extension/deep-west/bounds';
import { combineTravelRegions, outdoorPoint, travelCandidates, travelLanding, travelProbe } from '../../lib/campus/map-travel';
import { findFlightLanding } from '../../lib/campus/flight-landing';
import { FlightMotion, FLIGHT_TUNING } from '../../lib/campus/flight-motion';
import { characterSupported } from '../../lib/campus/character-support';
import { guardDescent, isWaterbedTarget, overWater, waterHoverFeet, WATER_HOVER_CLEARANCE } from '../../lib/campus/extension/downtown/water-safety';
import { ScooterClearance } from '../../lib/campus/scooter-clearance';
import { buildStripGroundGeometry, stripGroundHeight } from '../../lib/campus/blocks/b14-capitol/strip-ground';
import { applyBlockData } from '../../lib/campus/blocks/registry';
import { DOWNTOWN_SHOTS, CAMERA_SHOTS, EXTENSION_SHOTS, findShot } from '../../lib/campus/render/camera-shots';
import { CAMERA_FAR } from '../../lib/campus/game-constants';
import { AUSTIN_LATE_MORNING } from '../../lib/campus/render/lighting-presets';
import type { CampusData, Point, TerrainData } from '../../lib/campus/types';
import { decodeBackground, DowntownBackground, BackgroundAssetError, HORIZON_Y } from '../../lib/campus/extension/downtown/background';
import { Terrain } from '../../lib/campus/terrain';
import { createFacadeMaterial, createGroundMaterial, createWaterMaterial } from '../../lib/campus/extension/downtown/materials';
import { treeForms } from '../../lib/campus/vegetation/oak-forms';
import { loadTreeMaterials } from '../../lib/campus/vegetation/tree-materials';
import { headlessImpostors } from '../../lib/campus/vegetation/tree-batches';
import { buildPflugerGeometry, createPflugerMaterials, PFLUGER, pflugerCovers, profileRoughness, type PflugerData, type PflugerGeometry } from '../../lib/campus/extension/downtown/pfluger-bridge';

type Result = { name: string; pass: boolean; detail: unknown };
function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
/** Budgets (documented in result.md): download, draw calls, triangles, colliders, textures. */
export const BUDGETS = { gzipBytes: 2_500_000, drawCalls: 140, buildingTriangles: 600_000, terrainTriangles: 520_000, treeInstances: 8000,
  colliders: 120, classMapTexels: 5_000_000, decodeBuildMs: 6000 };

export async function run(root: string) {
  const results: Result[] = [];
  const check = (name: string, pass: boolean, detail: unknown) => { results.push({ name, pass, detail }); };
  const read = (p: string) => readFileSync(resolve(root, p));
  const manifest = JSON.parse(read('public/assets/extension/downtown-v1.manifest.json').toString());
  const strip = JSON.parse(read('lib/campus/blocks/b14-capitol/strip-ground.json').toString()) as StripSeamSource;
  const campus = JSON.parse(read('public/data/campus.json').toString()) as CampusData;
  campus.bounds[3] = Math.max(campus.bounds[3], 1536); // game.ts boot mutation
  const bounds = campus.bounds;

  // ---------------------------------------------------------------- 1. decode + fail closed
  const gz = read('public/assets/extension/downtown-v1.bin.gz');
  check('asset sha matches manifest; size within budget', createHash('sha256').update(gz).digest('hex') === manifest.sha256 && gz.length <= BUDGETS.gzipBytes,
    { gzipBytes: gz.length, budget: BUDGETS.gzipBytes });
  const raw = gunzipSync(gz);
  const buffer = () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  const t0 = performance.now();
  const data = decodeDowntown(buffer(), strip);
  const decodeMs = performance.now() - t0;
  check('asset decodes; seam row float-identical to the Capitol strip patch', data.seam.matched === data.meta.seam.seamVertices && data.seam.maxAbsDelta === 0,
    { decodeMs: +decodeMs.toFixed(1), seam: data.seam, counts: data.meta.counts });
  const rejects = (label: string, mutate: (b: ArrayBuffer) => ArrayBuffer, s: StripSeamSource = strip, expect = /./) => {
    try { decodeDowntown(mutate(buffer()), s); check(`fail closed: ${label}`, false, 'accepted'); }
    catch (e) { check(`fail closed: ${label}`, e instanceof DowntownAssetError && expect.test((e as Error).message), (e as Error).message); }
  };
  rejects('flipped payload byte', b => { new Uint8Array(b)[b.byteLength - 9] ^= 1; return b; }, strip, /checksum/);
  rejects('truncated', b => b.slice(0, b.byteLength - 64), strip);
  rejects('bad magic', b => { new DataView(b).setUint32(0, 0, true); return b; }, strip, /magic/);
  const metaLen = new DataView(buffer()).getUint32(8, true);
  const hSec = data.meta.sections.find(s => s.name === 'heights')!;
  rejects('re-signed asset with one seam vertex moved 1 mm', b => {
    const h = new Float32Array(b, 16 + metaLen + hSec.byteOffset, hSec.count);
    h[Math.round((-400 - data.meta.rect.xmin) / data.meta.step)] += .001;
    new DataView(b).setUint32(12, fnvWords(new Uint8Array(b, 16)), true); return b;
  }, strip, /seam/);
  const movedStrip = { ...strip, heights: (() => { const bin = Buffer.from(strip.heights, 'base64'); const k = ((strip.nz - 1) * strip.nx + 100) * 2; bin.writeInt16LE(bin.readInt16LE(k) + 1, k); return bin.toString('base64'); })() };
  rejects('Capitol strip seam row differs by 1 mm', b => b, movedStrip, /seam/);

  // ---------------------------------------------------------------- 2. geometry, extension object, budgets
  const t1 = performance.now();
  const geometry = buildDowntownGeometry(data);
  const stub = (name: string, map = true) => Object.assign(new THREE.MeshStandardMaterial({ map: map ? new THREE.Texture() : null }), { name });
  const downtown = new Downtown(geometry, { grass: stub('grass'), asphalt: stub('asphalt'), concrete: stub('concrete'), envMap: null }, decodeMs);
  const buildMs = performance.now() - t1;
  // Trees: the campus forms / materials / impostors, exactly as CampusGame.commitDowntown passes them.
  const forms = treeForms(), treeMats = await loadTreeMaterials();
  downtown.installTrees({ forms, materials: treeMats, impostors: headlessImpostors(forms) });
  const st = downtown.stats as Record<string, number>;
  const trees = data.trees.length / 6;
  check('budgets: draw calls, triangles, colliders, trees, class map, decode+build time',
    st.drawCalls <= BUDGETS.drawCalls && st.buildingTriangles <= BUDGETS.buildingTriangles && st.terrainTriangles <= BUDGETS.terrainTriangles
      && downtown.colliders.length <= BUDGETS.colliders && trees <= BUDGETS.treeInstances
      && data.meta.classMap.w * data.meta.classMap.h <= BUDGETS.classMapTexels && decodeMs + buildMs <= BUDGETS.decodeBuildMs,
    { drawCalls: st.drawCalls, buildingTriangles: st.buildingTriangles, terrainTriangles: st.terrainTriangles, colliders: downtown.colliders.length,
      trees, treeColliders: downtown.treeTrunks.length, classMap: [data.meta.classMap.w, data.meta.classMap.h], decodeMs: +decodeMs.toFixed(0), buildMs: +buildMs.toFixed(0), budgets: BUDGETS });
  // Camera/fog: the skyline is inside the far plane and the far fade from every campus point.
  const wl = data.meta.buildings.find(b => b.lm === 'waterline')!;
  const farthest = Math.hypot(wl.tiers[0].r[0][0][0] - -760, wl.tiers[0].r[0][0][1] - -864);
  check('camera far plane and fog far-fade reach the skyline from the far corner of campus', CAMERA_FAR > farthest + 400 && AUSTIN_LATE_MORNING.fog.edgeFar < CAMERA_FAR && AUSTIN_LATE_MORNING.fog.edgeNear > farthest - 600,
    { cameraFar: CAMERA_FAR, farthestCampusToWaterline: +farthest.toFixed(0), fogEdge: [AUSTIN_LATE_MORNING.fog.edgeNear, AUSTIN_LATE_MORNING.fog.edgeFar] });

  // ---------------------------------------------------------------- 3. landmark tops measured on the built triangles
  const tops: Record<string, unknown> = {};
  let topsOk = true;
  for (const lm of data.meta.landmarks) {
    let best = -Infinity, g0 = 0;
    for (const c of geometry.chunks) for (const batch of [c.buildings.major, c.buildings.minor]) {
      const pos = batch.position;
      batch.ranges.forEach((r, i) => {
        const b = buildingsOf(c, batch)[i];
        if (b.lm !== lm.key || !(b.src === 'landmark' || b.heightPolicy)) return;
        let y = -Infinity;
        for (let k = r.start * 9 + 1; k < (r.start + r.count) * 9; k += 3) y = Math.max(y, pos[k]);
        if (y > best) { best = y; g0 = b.g[0]; }
      });
    }
    const top = best - g0;
    tops[lm.key] = { renderedTopM: +top.toFixed(2), publishedOverallM: lm.heightM, roofM: lm.roofM ?? null, crown: lm.crown?.type ?? null };
    if (!(Math.abs(top - lm.heightM) <= .3)) topsOk = false;
  }
  check('landmark rendered tops (tiers + crowns, measured on mesh triangles) equal the published overall heights (+-0.3 m)', topsOk, tops);
  const seen = new Set(data.meta.buildings.filter(b => b.lm).map(b => b.lm));
  check('every landmark profile is present in the asset', data.meta.landmarks.every(l => seen.has(l.key)), [...seen]);

  // ---------------------------------------------------------------- 4. seam terrain continuity + stitched buildings
  let seamMax = 0;
  for (let x = data.meta.seam.x0; x <= data.meta.seam.x1; x += 0.7) {
    const a = downtown.height(x, 1536.0001), b = stripGroundHeight(x, 1535.9999);
    if (a === null || b === null) continue;
    seamMax = Math.max(seamMax, Math.abs(a - b));
  }
  check('seam: downtown terrain just south of z=1536 equals the strip patch just north (<= 2 mm over the span)', seamMax < .002, { maxAbs: +seamMax.toFixed(5) });
  const blocks = applyBlockData(campus);
  const keys = new Map(campus.buildings.map(b => [b.key, b]));
  const stitched = data.meta.buildings.filter(b => b.replaces);
  const b14 = JSON.parse(read('lib/campus/blocks/b14-capitol/context.json').toString()) as { add: { id: number; rings: number[][][]; evidence: { source: string } }[] };
  const stitchRows = stitched.map(b => {
    const add = b14.add.find(a => `${a.id}:add` === b.replaces)!;
    const ys = b.tiers.flatMap(t => t.r[0].map(p => p[1]));
    return { key: b.k, replaces: b.replaces, inData: keys.has(b.replaces), cityIdMatches: add?.evidence.source.includes(`OBJECTID ${b.id} `), spansSeam: Math.min(...ys) < 1536 - 1 && Math.max(...ys) > 1536 + 1,
      fragmentInside: add ? add.rings[0].every(([x, z]) => pointIn([x, z], b.tiers[0].r[0] as Point[], 0.2)) : false };
  });
  check('seam-stitched buildings: whole City footprints replace each clipped b14 fragment (key, City id, spans seam, contains fragment)',
    !!blocks && stitched.length >= 5 && stitchRows.every(r => r.inData && r.cityIdMatches && r.spansSeam && r.fragmentInside), stitchRows);
  const stripGeo = buildStripGroundGeometry();
  let stripInside = 0;
  for (let t = 0; t < stripGeo.indices.length; t += 3) {
    let cx = 0, cz = 0;
    for (let k = 0; k < 3; k++) { cx += stripGeo.positions[stripGeo.indices[t + k] * 3] / 3; cz += stripGeo.positions[stripGeo.indices[t + k] * 3 + 2] / 3; }
    if (stitched.some(b => pointIn([cx, cz], b.tiers[0].r[0] as Point[], -0.3))) stripInside++;
  }
  check('no strip terrain triangle inside a stitched building (strip holes match the whole footprints)', stripInside === 0, { stripTrianglesInside: stripInside });

  // ---------------------------------------------------------------- 5. physics world: downtown + strip + walls
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -24, z: 0 });
  const dtHandles = new Set<number>();
  for (const c of downtown.colliders) dtHandles.add(world.createCollider(RAPIER.ColliderDesc.trimesh(c.position, c.index).setFriction(.8)).handle);
  for (const t of downtown.treeTrunks) dtHandles.add(world.createCollider(RAPIER.ColliderDesc.capsule(t.height / 2, t.radius).setTranslation(t.x, t.y + t.height / 2, t.z)).handle);
  world.createCollider(RAPIER.ColliderDesc.trimesh(stripGeo.positions, stripGeo.indices).setFriction(.8));
  const edges = { bounds: downtown.bounds, barriers: data.meta.barriers, barrierBottom: data.meta.water.y - 2, barrierTop: data.meta.barrierTop };
  const walls = worldWalls(bounds, null, edges);
  for (const w of walls) {
    const d = RAPIER.ColliderDesc.cuboid(w.hx, w.hy, w.hz).setTranslation(w.cx, w.cy, w.cz);
    if (w.angle) d.setRotation({ x: 0, y: Math.sin(w.angle / 2), z: 0, w: Math.cos(w.angle / 2) });
    world.createCollider(d);
  }
  world.step();
  const fallbackWalls = worldWalls(bounds, null, null).map(w => [w.cx, w.cz, w.hx, w.hz]);
  check('without downtown the walls are exactly the original four', JSON.stringify(fallbackWalls) === JSON.stringify(worldBoundaryWalls(bounds, null)), fallbackWalls.length);
  const down = (x: number, z: number, from = 400, filter?: (c: RAPIER.Collider) => boolean) => {
    const hit = world.castRay(new RAPIER.Ray({ x, y: from, z }, { x: 0, y: -1, z: 0 }), 600, true, undefined, undefined, undefined, undefined, filter);
    return hit ? from - hit.timeOfImpact : null;
  };
  downtown.group.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  let parity = 0, parityN = 0;
  const pr = seeded(5), box = downtown.bounds.box;
  for (let i = 0; i < 900; i++) {
    const x = box.xmin + pr() * (box.xmax - box.xmin), z = 1537 + pr() * (box.zmax - 1537);
    if (!downtown.bounds.contains(x, z)) continue;
    raycaster.set(new THREE.Vector3(x, 400, z), new THREE.Vector3(0, -1, 0));
    const vis = raycaster.intersectObjects(downtown.group.children, false).sort((a, b) => a.distance - b.distance)[0];
    const phys = down(x, z, 400, c => dtHandles.has(c.handle));
    if (!vis || phys === null) { parity = Infinity; continue; }
    parity = Math.max(parity, Math.abs(vis.point.y - phys)); parityN++;
  }
  check('render/collider parity in the playable area: first visible hit == Rapier hit (random columns)', parity < 2e-3 && parityN > 250, { samples: parityN, maxAbs: parity });
  let underground = 0;
  for (let i = 0; i < 600; i++) {
    const x = box.xmin + pr() * (box.xmax - box.xmin), z = 1537 + pr() * (box.zmax - 1537);
    if (!downtown.bounds.contains(x, z)) continue;
    const g = downtown.height(x, z), p = down(x, z, 400, c => dtHandles.has(c.handle));
    if (g !== null && p !== null && p < g - 1e-3) underground++;
  }
  check('physical surface never below the terrain height query (no holes to fall through)', underground === 0, { underground });
  // Visual-only context buildings (south bank, I-35 band) are rendered but have no collider triangles.
  const visualOnly = data.meta.buildings.filter(b => b.visual && b.tiers[0].y - b.g[0] > 8);
  let visualHits = 0, visualTested = 0;
  for (const b of visualOnly.slice(0, 400)) {
    const ring = b.tiers[0].r[0] as Point[];
    const c = ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length], [0, 0]) as Point;
    if (!pointIn(c, ring, -1)) continue;
    visualTested++;
    const y = down(c[0], c[1], 400, h => dtHandles.has(h.handle));
    if (y !== null && y > b.g[0] + 3) visualHits++;
  }
  check('visual-only context buildings have no colliders (Rapier rays through their roofs reach no building)', visualTested > 50 && visualHits === 0 && st.visualOnlyBuildingTriangles > 0,
    { visualTested, visualHits, visualOnlyBuildingTriangles: st.visualOnlyBuildingTriangles, colliderTriangles: st.colliderTriangles });

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(-470, 50, 1510));
  const player = world.createCollider(RAPIER.ColliderDesc.capsule(.54, .34).setFriction(0), body);
  const controller = world.createCharacterController(.025);
  controller.enableAutostep(.32, .2, false); controller.enableSnapToGround(.38);
  controller.setMaxSlopeClimbAngle(Math.PI * .25); controller.setMinSlopeSlideAngle(Math.PI * .28);
  const groundAt = (x: number, z: number) => downtown.height(x, z) ?? stripGroundHeight(x, z) ?? down(x, z, 400, c => c.handle !== player.handle)!;
  const place = (x: number, z: number) => { const y = (down(x, z, groundAt(x, z) + 6, c => c.handle !== player.handle) ?? groundAt(x, z)) + .92; body.setTranslation({ x, y, z }, true); body.setNextKinematicTranslation({ x, y, z }); world.step(); };
  const walk = (path: Point[], speed = 8, maxSeconds = 400) => {
    const dt = 1 / 60; let vy = 0, maxDy = 0, stuck = 0, k = 1, minAbove = Infinity;
    for (let i = 0; i < maxSeconds * 60 && k < path.length; i++) {
      const p = body.translation(), [tx, tz] = path[k], d = Math.hypot(tx - p.x, tz - p.z);
      if (d < 1.5) { k++; continue; }
      vy = Math.max(vy - 24 * dt, -30);
      controller.computeColliderMovement(player, { x: (tx - p.x) / d * speed * dt, y: vy * dt, z: (tz - p.z) / d * speed * dt });
      if (controller.computedGrounded()) vy = 0;
      const m = controller.computedMovement(), next = { x: p.x + m.x, y: p.y + m.y, z: p.z + m.z };
      body.setNextKinematicTranslation(next); world.step();
      maxDy = Math.max(maxDy, Math.abs(m.y)); minAbove = Math.min(minAbove, next.y - .905 - data.meta.water.y);
      if (Math.hypot(m.x, m.z) < speed * dt * .2) stuck++; else stuck = 0;
      if (stuck > 120) break;
    }
    const e = body.translation();
    return { reached: k >= path.length, waypoint: k, of: path.length, end: [+e.x.toFixed(1), +e.y.toFixed(2), +e.z.toFixed(1)], maxDy: +maxDy.toFixed(3), aboveWaterMin: +minAbove.toFixed(2) };
  };
  // Congress Avenue axis from the Capitol strip (capitol-area.ts frame: rotation 0.315 about (-308, 1266.5)).
  const C = Math.cos(.315), S = Math.sin(.315), congress = (v: number): Point => [-308 - S * v, 1266.5 + C * v];
  const shoreAt = (x: number) => { // first shoreline wall south of downtown core at x
    let best = Infinity;
    for (const [ax, az, bx, bz] of data.meta.walls) if (Math.min(ax, bx) <= x && x <= Math.max(ax, bx) && Math.abs(bx - ax) > 1e-6 && az > 2000) best = Math.min(best, az + (bz - az) * (x - ax) / (bx - ax));
    return best;
  };
  const routes: Record<string, unknown> = {};
  place(...congress(250));
  routes.congressCapitolToRiver = walk([congress(250), congress(400), congress(800), congress(1150), congress(1270)]);
  const congressEnd = body.translation();
  routes.congressEndNearShore = { end: [congressEnd.x, congressEnd.z], shoreZ: shoreAt(congressEnd.x) };
  place(...congress(300));
  routes.congressReturnNorth = walk([congress(300), congress(200), congress(120)]);
  check('walking: Capitol strip -> Congress Avenue -> riverbank (seam crossing, no stalls, never below water)',
    (routes.congressCapitolToRiver as { reached: boolean; aboveWaterMin: number }).reached && (routes.congressCapitolToRiver as { aboveWaterMin: number }).aboveWaterMin > -.05
      && (routes.congressReturnNorth as { reached: boolean }).reached, routes);
  // Walls: river shoreline, west edge, north edge west of the seam, I-35 edge, old south wall east of the seam, inlet barrier.
  const push = (start: Point, dir: Point, seconds = 6) => { place(...start); const p0 = body.translation(); return walk([start, [p0.x + dir[0] * 300, p0.z + dir[1] * 300]], 8, seconds); };
  // Shoreline: walk perpendicular into 8 shoreline wall segments (no trunk within 10 m); the walker must stop at the
  // wall line on the land side (never past it, never below the water surface).
  const shoreSegs = data.meta.walls.filter(([ax, az, bx, bz]) => az > 2000 && bz > 2000 && Math.hypot(bx - ax, bz - az) > 8)
    .filter(([ax, az, bx, bz]) => !downtown.treeTrunks.some(t => Math.hypot(t.x - (ax + bx) / 2, t.z - (az + bz) / 2) < 10));
  const shore = shoreSegs.filter((_, i) => i % Math.max(1, Math.floor(shoreSegs.length / 8)) === 0).slice(0, 8).map(([ax, az, bx, bz]) => {
    const len = Math.hypot(bx - ax, bz - az), mx = (ax + bx) / 2, mz = (az + bz) / 2;
    let nx = -(bz - az) / len, nz = (bx - ax) / len;
    if (!downtown.bounds.contains(mx + nx * 2, mz + nz * 2)) { nx = -nx; nz = -nz; }
    const r = push([mx + nx * 8, mz + nz * 8], [-nx, -nz], 4);
    const signed = (r.end[0] - mx) * nx + (r.end[2] - mz) * nz; // > 0 = land side of the wall line
    return { seg: [ax, az, bx, bz], endFromWall: +signed.toFixed(2), aboveWaterMin: r.aboveWaterMin, end: r.end };
  });
  const shoreOk = shore.length >= 5 && shore.every(r => r.endFromWall > -.05 && r.aboveWaterMin > -.05) && shore.filter(r => r.endFromWall < 1.2).length >= Math.ceil(shore.length * .6);
  const westProbe = push([-1745, 1900], [-1, 0]);
  const northProbe = push([-1200, 1550], [0, -1]);
  const eastProbe = push([200, 2300], [1, .2]);
  const oldSouth = push([800, 1520], [0, 1]);
  const legal = (p: number[]) => downtown.bounds.contains(p[0], p[2]) || (p[2] <= 1536.5 && p[0] >= -760 && p[0] <= 1296);
  check('walls: shoreline stops the walker on land above the water; west/north/I-35 edges and the old south wall east of the seam hold',
    shoreOk && westProbe.end[0] > -1761 && northProbe.end[2] > 1534.9 && legal(eastProbe.end) && oldSouth.end[2] < 1537,
    { shore, westProbe, northProbe, eastProbe, oldSouth });
  const inlet = data.meta.barriers[Math.floor(data.meta.barriers.length / 2)];
  let inletRes: unknown = 'no inlets';
  if (inlet) {
    const [ax, az, bx, bz] = inlet, mx = (ax + bx) / 2, mz = (az + bz) / 2, len = Math.hypot(bx - ax, bz - az);
    let nx = -(bz - az) / len, nz = (bx - ax) / len;
    if (downtown.bounds.contains(mx + nx * 3, mz + nz * 3) && data.classMap[Math.floor(mz + nz * 3 - data.meta.rect.zmin) * data.meta.classMap.w + Math.floor(mx + nx * 3 - data.meta.rect.xmin)] === 5) { nx = -nx; nz = -nz; }
    const r = push([mx + nx * 4, mz + nz * 4], [-nx, -nz], 4);
    inletRes = { ...r, barrierTop: data.meta.barrierTop };
    check('creek-mouth inlet barrier keeps walkers out of the inlet water', r.aboveWaterMin > -.05, inletRes);
  }

  // Seam crossings at several x: columns whose z 1500..1580 line is clear of every campus and downtown footprint
  // (streets crossing the Capitol strip seam). Walk south across z=1536 and back north at each.
  const allFeet: Point[][] = [...campus.buildings.map(b => b.rings[0] as Point[]), ...data.meta.buildings.flatMap(b => b.tiers.map(t => t.r[0] as Point[]))];
  const clearColumn = (x: number) => { for (let z = 1500; z <= 1580; z += 1) if (allFeet.some(r => pointIn([x, z], r, 1.2)) || !(stripGroundHeight(x, Math.min(z, 1535.9)) !== null)) return false; return true; };
  const columns: number[] = [];
  for (let x = data.meta.seam.x0 + 4; x <= data.meta.seam.x1 - 4; x += 2) if (clearColumn(x) && columns.every(c => Math.abs(c - x) > 60)) columns.push(x);
  const seamWalks = columns.slice(0, 8).map(x => {
    place(x, 1505); const south = walk([[x, 1505], [x, 1575]], 8, 30);
    const back = walk([[x, 1575], [x, 1505]], 8, 30);
    return { x, south: { reached: south.reached, end: south.end, maxDy: south.maxDy }, north: { reached: back.reached, end: back.end, maxDy: back.maxDy } };
  });
  check('walking crosses the open seam (z=1536) both ways at every clear street column (>= 5 x positions)',
    seamWalks.length >= 5 && seamWalks.every(w => w.south.reached && w.north.reached && w.south.maxDy < .35 && w.north.maxDy < .35), seamWalks);
  const scooterSeam = columns.slice(0, 3).map(x => {
    place(x, 1515);
    const hdg = 0, m = new ScooterClearance({ world, controller, collider: player }).canMount(hdg);
    let dist = 0;
    for (let i = 0; i < 600 && dist < 45; i++) {
      const r = new ScooterClearance({ world, controller, collider: player }).resolveMove({ fromHeading: hdg, heading: hdg, displacement: { x: 0, z: 9.6 / 60 } });
      const p = body.translation(); body.setNextKinematicTranslation({ x: p.x + r.delta.x, y: p.y + r.delta.y, z: p.z + r.delta.z }); world.step(); dist += Math.hypot(r.delta.x, r.delta.z);
    }
    return { x, mounted: m.allowed, ridden: +dist.toFixed(1), endZ: +body.translation().z.toFixed(1) };
  });
  check('scooter rides south across the seam at 3 street columns', scooterSeam.length === 3 && scooterSeam.every(r => r.mounted && r.endZ > 1556), scooterSeam);

  // Scooter along Congress (real clearance model, rendered == physical ground).
  const scooter = new ScooterClearance({ world, controller, collider: player });
  place(...congress(420));
  const heading = Math.atan2(-S, C);
  const mount = scooter.canMount(heading);
  let rideDist = 0, blocked = 0;
  for (let i = 0; i < 60 * 60 && rideDist < 380; i++) {
    const r = scooter.resolveMove({ fromHeading: heading, heading, displacement: { x: -S * 9.6 / 60, z: C * 9.6 / 60 } });
    if (r.blockedReason && r.fraction < .8) blocked++;
    const p = body.translation(), n = { x: p.x + r.delta.x, y: p.y + r.delta.y, z: p.z + r.delta.z };
    body.setNextKinematicTranslation(n); world.step(); rideDist += Math.hypot(r.delta.x, r.delta.z);
  }
  check('scooter: mounts on Congress Avenue and rides 380 m south with the real clearance model', mount.allowed && rideDist >= 380 && blocked < 30,
    { mount: mount.allowed, mountReason: mount.blockedReason, rideDist: +rideDist.toFixed(1), blockedFrames: blocked });

  // ---------------------------------------------------------------- 6. flight clamp + landing
  let clampIllegal = 0, crossings = 0;
  for (const x0 of [-700, -500, -300, 0, 300, 420]) {
    let x = x0, z = 1300;
    for (let i = 0; i < 400; i++) {
      [x, z] = clampToWorld(bounds, null, downtown.bounds, x, z + 48 / 60 * 4);
      if (z > 1540) { crossings++; break; }
    }
  }
  const rnd = seeded(9);
  for (let i = 0; i < 3000; i++) {
    const x = -2100 + rnd() * 3600, z = -1000 + rnd() * 4600;
    const [cx, cz] = clampToWorld(bounds, null, downtown.bounds, x, z);
    const inBase = cx >= bounds[0] + 2 - 1e-9 && cx <= bounds[2] - 2 + 1e-9 && cz >= bounds[1] + 2 - 1e-9 && cz <= bounds[3] - 2 + 1e-9;
    const onSeam = cx >= downtown.bounds.seam.x0 + 2 && cx <= downtown.bounds.seam.x1 - 2 && cz <= 1538.01 && cz >= 1530;
    if (!(inBase || onSeam || downtown.bounds.legal(cx, cz, 1.99))) clampIllegal++;
  }
  let fallbackClamp = 0;
  for (let i = 0; i < 1000; i++) {
    const x = -2100 + rnd() * 3600, z = -1000 + rnd() * 4600;
    const a = clampToWorld(bounds, null, null, x, z), b = clampDeepWest(bounds, null, x, z);
    fallbackClamp = Math.max(fallbackClamp, Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
  }
  check('flight clamp: crosses the seam at 6 x positions, never returns an illegal point (3000 random), unchanged without downtown',
    crossings === 6 && clampIllegal === 0 && fallbackClamp === 0, { crossings, clampIllegal, fallbackClamp, mapBounds: mapBounds(bounds, null, downtown.bounds) });
  // Flight is capped 100 m above terrain (flight-motion.ts): land from the cap onto mid-rise roofs and onto streets.
  const flights = [];
  const midrise = data.meta.buildings.filter(b => !b.visual && b.tiers.length === 1 && b.tiers[0].r[0].length >= 4).map(b => ({ b, top: b.tiers[0].y - b.g[0] }))
    .filter(r => r.top > 20 && r.top < 70).sort((p, q) => p.b.k < q.b.k ? -1 : 1).filter((_, i) => i % 12 === 0).slice(0, 5);
  for (const { b, top } of midrise) {
    const ring = b.tiers[0].r[0] as Point[];
    const c = ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length], [0, 0]) as Point;
    if (!pointIn(c, ring)) continue;
    body.setTranslation({ x: c[0], y: (downtown.height(c[0], c[1]) ?? 0) + 100 + .905, z: c[1] }, true); world.step();
    const t = findFlightLanding(world, player, body.translation());
    flights.push({ key: b.k, roofY: +b.tiers[0].y.toFixed(1), top: +top.toFixed(1), target: t?.toArray().map(v => +v.toFixed(1)) ?? null, onRoof: !!t && Math.abs(t.y - .905 - b.tiers[0].y) < .6 });
  }
  body.setTranslation({ x: -560, y: (downtown.height(-560, 2000) ?? 0) + 100.9, z: 2000 }, true); world.step();
  const streetLanding = findFlightLanding(world, player, body.translation());
  check('flight landing from the 100 m cap finds mid-rise roofs and downtown street ground', flights.length >= 3 && flights.every(f => f.onRoof) && !!streetLanding, { flights, streetLanding: streetLanding?.toArray() });

  const surface = (x: number, z: number, fromY: number, distance: number) => {
    raycaster.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0)); raycaster.far = distance;
    const hit = raycaster.intersectObjects(downtown.group.children, false).sort((a, b) => a.distance - b.distance).find(h => h.face && h.face.normal.y > .5) ?? null;
    raycaster.far = Infinity; return hit;
  };

  // ---------------------------------------------------------------- 6b. flight over water (root review item 9)
  // Simulates CampusGame.stepFlight: landing probe every 200 ms (water-bed veto), FlightMotion intent, horizontal clamp,
  // water hover guard, 100 m cap, the real capsule sweep, and "landed" when descending and supported.
  const water = downtown.water;
  const flyCtl = world.createCharacterController(.025);
  flyCtl.setMaxSlopeClimbAngle(Math.PI * .25); flyCtl.setMinSlopeSlideAngle(Math.PI * .28);
  const fly = (start: { x: number; feet: number; z: number }, seconds: number, mode: 'landing' | 'flying', heading: Point | null = null, guard = true) => {
    const flight = new FlightMotion(); flight.start(); flight.mode = mode;
    body.setTranslation({ x: start.x, y: start.feet + .905, z: start.z }, true); body.setNextKinematicTranslation({ x: start.x, y: start.feet + .905, z: start.z }); world.step();
    const dt = 1 / 60; let target: THREE.Vector3 | null = null, minFeet = Infinity, landed = false, overWaterFrames = 0;
    for (let i = 0; i < seconds * 60 && !landed; i++) {
      const p = body.translation();
      if (mode === 'landing' && i % 12 === 0) target = findFlightLanding(world, player, p, guard && overWater(water, p.x, p.z) ? surface : undefined, null, guard ? t => !isWaterbedTarget(water, t.x, t.y - .905, t.z) : undefined);
      const yaw = heading ? Math.atan2(-(heading[0] - p.x), -(heading[1] - p.z)) : 0;
      const requested = flight.update(dt, { forward: heading ? 1 : 0, strafe: 0, climb: 0, boost: false, yaw, y: p.y, enabled: true, x: p.x, z: p.z, landingTarget: mode === 'landing' ? target : null });
      const delta = requested.clone().multiplyScalar(dt);
      const [cx, cz] = clampToWorld(bounds, null, downtown.bounds, p.x + delta.x, p.z + delta.z); delta.x = cx - p.x; delta.z = cz - p.z;
      if (guard && mode === 'landing' && overWater(water, cx, cz)) {
        const shown = surface(cx, cz, p.y, 300);
        const hover = waterHoverFeet(water, cx, cz, shown?.point.y ?? null);
        if (hover !== null) { overWaterFrames++; delta.y = guardDescent(delta.y, p.y - .905, hover, FLIGHT_TUNING.climbSpeed * dt); }
      }
      const terrainY = downtown.height(p.x, p.z) ?? 0;
      delta.y = Math.min(delta.y, Math.max(0, terrainY + .905 + FLIGHT_TUNING.maxHeightAboveTerrain - p.y));
      flyCtl.computeColliderMovement(player, delta);
      const m = flyCtl.computedMovement(), supported = characterSupported(flyCtl, p.y, requested.y);
      const next = { x: p.x + m.x, y: p.y + m.y, z: p.z + m.z };
      body.setNextKinematicTranslation(next); world.step();
      minFeet = Math.min(minFeet, next.y - .905);
      if (requested.y < -.1 && supported) landed = true;
    }
    const e = body.translation();
    return { landed, feet: +(e.y - .905).toFixed(3), minFeet: +minFeet.toFixed(3), end: [+e.x.toFixed(1), +e.z.toFixed(1)], overWater: water.isWater(e.x, e.z), overWaterFrames };
  };
  // Root review counterexamples (real Rapier + findFlightLanding landed on the Shoal Creek inlet bed, 2026-10-23).
  const rootReport = { examples: ([[-1286, 2164], [-1284, 2164], [-1282, 2164], [-1288, 2166], [-1286, 2166], [-1284, 2166], [-1282, 2166], [-1288, 2168]] as Point[]).map(point => ({ point })) };
  const vetoRows = rootReport.examples.map(({ point }) => {
    const pos = { x: point[0], y: data.meta.water.surfaceY + 30 + .905, z: point[1] };
    body.setTranslation(pos, true); world.step();
    const before = findFlightLanding(world, player, pos), after = findFlightLanding(world, player, pos, undefined, null, t => !isWaterbedTarget(water, t.x, t.y - .905, t.z));
    return { point, oldTargetOnWaterbed: !!before && isWaterbedTarget(water, before.x, before.y - .905, before.z),
      newTarget: after ? [+after.x.toFixed(1), +(after.y - .905).toFixed(2), +after.z.toFixed(1)] : null, newOnWaterbed: !!after && isWaterbedTarget(water, after.x, after.y - .905, after.z) };
  });
  check('flight water bed: the root counterexamples are water-bed targets without the veto and never with it',
    vetoRows.length >= 8 && vetoRows.every(r => r.oldTargetOnWaterbed && !r.newOnWaterbed), vetoRows);
  const inlet0 = rootReport.examples[1].point, surf = data.meta.water.surfaceY;
  const unguarded = fly({ x: inlet0[0], feet: surf + 30, z: inlet0[1] }, 8, 'landing', null, false);
  const descent = fly({ x: inlet0[0], feet: surf + 30, z: inlet0[1] }, 8, 'landing');
  const p0 = body.translation();
  const released = fly({ x: p0.x, feet: p0.y - .905, z: p0.z }, 3, 'flying');
  // Recovery: steer (holding Down) to the nearest mapped land that is playable, outdoors and not water.
  let shoreTarget: Point | null = null;
  for (let r = 4; r < 80 && !shoreTarget; r += 2) for (let k = 0; k < 24 && !shoreTarget; k++) {
    const q: Point = [inlet0[0] + Math.cos(k * Math.PI / 12) * r, inlet0[1] + Math.sin(k * Math.PI / 12) * r];
    if (downtown.travelRegion.outdoor(q) && !water.isWater(q[0], q[1]) && ![[3, 0], [-3, 0], [0, 3], [0, -3]].some(([a, b]) => water.isWater(q[0] + a, q[1] + b))) shoreTarget = q;
  }
  const recovery = shoreTarget ? fly({ x: p0.x, feet: p0.y - .905, z: p0.z }, 20, 'landing', shoreTarget) : null;
  // A collidable bridge deck over inlet water: hold Down above it and land on the deck.
  let deck: { x: number; z: number; y: number } | null = null;
  for (let t = 0; t < data.bridges.length / 9 && !deck; t++) {
    if (!data.bridgeCollide[t]) continue;
    const o = t * 9, cx = (data.bridges[o] + data.bridges[o + 3] + data.bridges[o + 6]) / 3, cz = (data.bridges[o + 2] + data.bridges[o + 5] + data.bridges[o + 8]) / 3;
    const cy = (data.bridges[o + 1] + data.bridges[o + 4] + data.bridges[o + 7]) / 3;
    if (!water.isWater(cx, cz) || cy < surf + 3) continue;
    const top = down(cx, cz, cy + 5, c => c.handle !== player.handle);
    if (top !== null && Math.abs(top - cy) < .5 && [[.8, 0], [-.8, 0], [0, .8], [0, -.8]].every(([a, b]) => Math.abs((down(cx + a, cz + b, cy + 5, c => c.handle !== player.handle) ?? -99) - top) < .3)) deck = { x: cx, z: cz, y: top };
  }
  const bridgeLanding = deck ? fly({ x: deck.x, feet: deck.y + 25, z: deck.z }, 8, 'landing') : null;
  check('flight over creek-mouth water: unguarded descent reached the water bed; guarded Down stops at hover, release holds, steering lands on shore, bridge deck landing still works',
    !!unguarded.landed && unguarded.feet < surf + .5
      && !descent.landed && descent.minFeet >= water.bedTop + WATER_HOVER_CLEARANCE - .15 && descent.overWaterFrames > 30
      && !released.landed && Math.abs(released.feet - descent.feet) < .15
      && !!recovery && recovery.landed && !isWaterbedTarget(water, recovery.end[0], recovery.feet, recovery.end[1])
      && !!bridgeLanding && bridgeLanding.landed && Math.abs(bridgeLanding.feet - deck!.y) < .3,
    { surfaceY: surf, bedTop: water.bedTop, unguarded, descent, released, shoreTarget, recovery, deck, bridgeLanding });

  // ---------------------------------------------------------------- 6c. James D. Pfluger pedestrian bridge (pfluger-bridge.ts)
  {
    const pf = geometry.pfluger, ps = pf.stats, H = PFLUGER.helix, rm = (H.rIn + H.rOut) / 2;
    const notPlayer = (c: RAPIER.Collider) => c.handle !== player.handle;
    const hY = (phi: number) => H.yTop + H.slope * (phi - H.phiTop);
    const hP = (phi: number, r = rm): Point => [H.c[0] + Math.cos(phi * Math.PI / 180) * r, H.c[1] + Math.sin(phi * Math.PI / 180) * r];
    const pfStats = downtown.stats.pfluger as { drawCalls: number; colliders: number; replacedSoupTriangles: number };
    // a) identity, soup suppression, budget
    const bp = geometry.bridges.render.getAttribute('position');
    let ghost = 0;
    for (let t = 0; t < bp.count / 3; t++) if (pflugerCovers((bp.getX(t * 3) + bp.getX(t * 3 + 1) + bp.getX(t * 3 + 2)) / 3, (bp.getZ(t * 3) + bp.getZ(t * 3 + 1) + bp.getZ(t * 3 + 2)) / 3, .5)) ghost++;
    const pfTris = ps.deckTriangles + ps.structureTriangles + ps.infillTriangles;
    check('Pfluger bridge: CoA OID 9608 modelled; its flat soup polygon removed (no ghost triangles); 3 draw calls, 2 colliders, <= 40k triangles',
      PFLUGER.oid === 9608 && pfStats.replacedSoupTriangles > 0 && ghost === 0 && pfStats.drawCalls === 3 && pfStats.colliders === 2 && pfTris <= 40_000,
      { ...ps, triangles: pfTris, replacedSoupTriangles: pfStats.replacedSoupTriangles, ghost, keptSoupTriangles: geometry.bridges.triangles });
    // b) walkable deck height (Rapier, top surface) vs the LiDAR class-13 reference returns
    const lid = PFLUGER.lidar.map(([x, z, y, path]) => { const top = down(x, z, y + 15, c => dtHandles.has(c.handle)); return { path, x, z, lidar: y, d: top === null ? 99 : +(top - y).toFixed(2) }; });
    const ad = lid.map(r => Math.abs(r.d)).sort((a, b) => a - b);
    check('Pfluger deck: walkable top (Rapier ray) matches LiDAR deck returns of the smooth structural profile (median <= 0.1 m, max <= 0.3 m)',
      lid.length >= 30 && ad[Math.floor(ad.length / 2)] <= .1 && ad[ad.length - 1] <= .3,
      { samples: lid.length, median: ad[Math.floor(ad.length / 2)], max: ad[ad.length - 1], worst: lid.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 4) });
    // c) continuity: 1 m samples between consecutive LiDAR references of each path and every 2 deg along the helix
    let gaps = 0, maxStep = 0, samples = 0, helixMax = 0, stepAt: number[] = [];
    const gapAt: number[][] = [];
    const dtOnly = (c: RAPIER.Collider) => dtHandles.has(c.handle); // downtown trimeshes only (not the world walls)
    for (let i = 0; i + 1 < PFLUGER.lidar.length; i++) {
      const [ax, az, ay, ap] = PFLUGER.lidar[i], [bx, bz, by, bpth] = PFLUGER.lidar[i + 1];
      if (ap !== bpth || ap === 'helix') continue;
      const n = Math.ceil(Math.hypot(bx - ax, bz - az)); let prev: number | null = null;
      for (let k = 0; k <= n; k++) {
        const t = k / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t, ey = ay + (by - ay) * t, y = down(x, z, ey + 3, dtOnly);
        samples++;
        if (y === null || Math.abs(y - ey) > 1) { gaps++; prev = null; if (gapAt.length < 6) gapAt.push([+x.toFixed(1), +z.toFixed(1), +ey.toFixed(2), y === null ? NaN : +y.toFixed(2)]); continue; }
        if (prev !== null && Math.abs(y - prev) > maxStep) { maxStep = Math.abs(y - prev); stepAt = [+x.toFixed(1), +z.toFixed(1)]; }
        prev = y;
      }
    }
    for (let phi = H.phiTop - 1; phi > H.phiEnd + 1; phi -= 2) {
      const [x, z] = hP(phi), y = down(x, z, hY(phi) + 1.2, notPlayer);
      helixMax = Math.max(helixMax, y === null ? 99 : Math.abs(y - hY(phi)));
    }
    check('Pfluger deck continuous: no gaps and no step > 0.25 m between 1 m samples along every path and the helix surface follows its fitted grade at every level',
      samples > 150 && gaps === 0 && maxStep < .25 && helixMax < .06, { gapAt, stepAt, samples, gaps, maxStepPerMetre: +maxStep.toFixed(3), helixMaxDev: +helixMax.toFixed(3), helixTurns: ps.helixTurns });
    // d) walk: main deck at the helix junction -> 2 turns down the helix -> off the bottom onto the shore trail
    const oz = PFLUGER.open.find(o => o.kind === 'helix')!, od = Math.hypot(oz.x - H.c[0], oz.z - H.c[1]);
    const start: Point = [oz.x + (oz.x - H.c[0]) / od * 1.5, oz.z + (oz.z - H.c[1]) / od * 1.5];
    const setOn = ([x, z]: Point, y: number) => { body.setTranslation({ x, y: y + .93, z }, true); body.setNextKinematicTranslation({ x, y: y + .93, z }); world.step(); };
    setOn(start, down(start[0], start[1], H.yTop + 5, notPlayer)!);
    const hPath: Point[] = [start];
    for (let phi = H.phiTop - 10; phi > H.phiEnd + 3; phi -= 15) hPath.push(hP(phi));
    hPath.push(hP(H.phiEnd + 2), hP(H.phiEnd - 6), hP(H.phiEnd - 12));
    const helixWalk = walk(hPath, 5, 120);
    const exitGround = downtown.height(helixWalk.end[0], helixWalk.end[2]);
    // e) railings: push outward/inward on the upper helix turn and across the north connector
    const radial = (phi: number, sign: number) => {
      const [x, z] = hP(phi); setOn([x, z], hY(phi));
      const r = walk([[x, z], [H.c[0] + (x - H.c[0]) * (1 + sign * 2), H.c[1] + (z - H.c[1]) * (1 + sign * 2)]], 6, 5), e = r.end;
      return { phi, sign, endR: +Math.hypot(e[0] - H.c[0], e[2] - H.c[1]).toFixed(2), dy: +(e[1] - .905 - hY(phi)).toFixed(2) };
    };
    const ext = PFLUGER.piers.find(p => p.path === 'A' && !p.water)!; // north connector bent (over land)
    const across = [1, -1].map(sign => {
      const y0 = down(ext.x, ext.z, ext.deck + 5, notPlayer)!; setOn([ext.x, ext.z], y0);
      const r = walk([[ext.x, ext.z], [ext.x + ext.dir[0] * sign * 30, ext.z + ext.dir[1] * sign * 30]], 6, 5);
      return { sign, off: +Math.hypot(r.end[0] - ext.x, r.end[2] - ext.z).toFixed(2), half: ext.half, dy: +(r.end[1] - .905 - y0).toFixed(2) };
    });
    const rails = [radial(-100, 1), radial(-100, -1), radial(-190, 1), radial(-450, -1)];
    check('Pfluger walking: junction -> down the double helix -> shore trail; railings hold the walker on the deck (helix edges, north connector)',
      helixWalk.reached && exitGround !== null && Math.abs(helixWalk.end[1] - .905 - exitGround) < .35 && helixWalk.maxDy < .4
        && rails.every(r => r.endR < H.rOut - .1 && r.endR > H.rIn + .1 && Math.abs(r.dy) < .25) && across.every(a => a.off < a.half && Math.abs(a.dy) < .3)
        && ps.railLengthM > 600 && ps.lamps >= 20 && ps.planters >= 2 && ps.piers >= 10,
      { helixWalk, exitGround, rails, across, railLengthM: ps.railLengthM, railSegments: ps.railSegments, lamps: ps.lamps, planters: ps.planters, piers: ps.piers });
    // f) flight: hold Down from 25 m above the deck and land on it (north connector and the upper helix turn)
    const landOn = ([x, z]: Point, y: number) => { const r = fly({ x, feet: y + 25, z }, 10, 'landing'); return { at: [x, z], deckY: +y.toFixed(2), landed: r.landed, feet: r.feet }; };
    const landings = [landOn([ext.x, ext.z], down(ext.x, ext.z, ext.deck + 5, notPlayer)!), landOn(hP(-100), hY(-100))];
    check('Pfluger flight: landing from above settles on the bridge deck (connector and helix)', landings.every(l => l.landed && Math.abs(l.feet - l.deckY) < .3), landings);
    // g) smoothness (root review: the LiDAR-per-vertex deck waved and kinked): deck surface along every branch
    // centreline (raycast, 0.5 m), every deck edge and every railing top; negative controls on the previous noisy heights.
    type P3 = [number, number, number];
    const tipsXZ = PFLUGER.open.filter(o => o.kind === 'ground').map(o => [o.x, o.z]);
    const LIMITS = { main: { grade: .08, second: .02 }, ramp: { grade: .10, second: .02 }, helix: { grade: .06, second: .02 } };
    const nearTip = (p: P3) => tipsXZ.some(([x, z]) => Math.hypot(p[0] - x, p[2] - z) < 16);
    const runsOf = (pts: P3[]) => { // split a polyline into main / ramp runs (ramps: within 16 m of a ground landing)
      const out: { kind: 'main' | 'ramp'; pts: P3[] }[] = [];
      for (const p of pts) { const kind = nearTip(p) ? 'ramp' : 'main'; const last = out[out.length - 1]; if (last && last.kind === kind) last.pts.push(p); else out.push({ kind, pts: last ? [last.pts[last.pts.length - 1], p] : [p] }); }
      return out.filter(r => r.pts.length > 4);
    };
    const smoothness = (d: PflugerData, g: PflugerGeometry) => {
      const mesh = new THREE.Mesh(g.deck, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.updateMatrixWorld(true);
      const rc = new THREE.Raycaster(), dn = new THREE.Vector3(0, -1, 0);
      const worst: Record<string, { grade: number; second: number; where: string }> = {};
      let violations = 0;
      const bad: unknown[] = [];
      const take = (kind: 'main' | 'ramp' | 'helix', where: string, pts: P3[]) => {
        const r = profileRoughness(pts), w = (worst[kind] ??= { grade: 0, second: 0, where: '' });
        if (r.maxGrade > w.grade) { w.grade = r.maxGrade; w.where = where; }
        w.second = Math.max(w.second, r.maxSecondDiff);
        if (r.maxGrade > LIMITS[kind].grade || r.maxSecondDiff > LIMITS[kind].second) { violations++; if (bad.length < 8) bad.push({ kind, where, ...r, start: pts[0].map(v => +v.toFixed(1)) }); }
      };
      for (const [k, path] of Object.entries(PFLUGER.paths!)) {
        const pts: P3[] = [];
        for (let i = 0; i + 1 < path.length; i++) for (let t = 0; t < 1; t += .5) {
          const x = path[i][0] + (path[i + 1][0] - path[i][0]) * t, z = path[i][2] + (path[i + 1][2] - path[i][2]) * t, y0 = path[i][1];
          rc.set(new THREE.Vector3(x, y0 + 2, z), dn);
          const hit = rc.intersectObject(mesh, false).find(h => Math.abs(h.point.y - y0) < 2);
          if (hit) pts.push([x, hit.point.y, z]);
        }
        for (const r of runsOf(pts)) take(r.kind, `centreline ${k}`, r.pts);
      }
      // Edges and railing tops are profiled per plan-straight-ish run: split where the outline turns > 35 deg (deck-end
      // corners), so a corner between a sloping side and a level end edge is not read as a kink.
      const bends = (pts: P3[]) => {
        const out: P3[][] = [[pts[0]]];
        for (let i = 1; i < pts.length; i++) {
          const cur = out[out.length - 1]; cur.push(pts[i]);
          if (i + 1 < pts.length) {
            const a1 = Math.atan2(pts[i][2] - pts[i - 1][2], pts[i][0] - pts[i - 1][0]), a2 = Math.atan2(pts[i + 1][2] - pts[i][2], pts[i + 1][0] - pts[i][0]);
            const turn = Math.abs(((a2 - a1 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
            if (turn > 35 * Math.PI / 180) out.push([pts[i]]);
          }
        }
        return out;
      };
      d.deck.forEach((ring, i) => { for (const b of bends([...ring, ring[0]] as P3[])) for (const r of runsOf(b)) take(r.kind, `deck edge ring ${i}`, r.pts); });
      g.railTops.forEach((rt, i) => { for (const b of bends(rt as P3[])) for (const r of runsOf(b)) take(r.kind, `railing top ${i}`, r.pts); });
      const H2 = d.helix, hp: P3[] = [];
      for (let phi = H2.phiTop; phi >= H2.phiEnd; phi -= 1) { const t = phi * Math.PI / 180, rr = (H2.rIn + H2.rOut) / 2; hp.push([H2.c[0] + Math.cos(t) * rr, H2.yTop + H2.slope * (phi - H2.phiTop), H2.c[1] + Math.sin(t) * rr]); }
      take('helix', 'helix centreline', hp);
      return { violations, worst, bad };
    };
    const now = smoothness(PFLUGER, pf);
    let noisyPrev: unknown = 'previous JSON not present (.work)';
    let noisyPrevFails = true;
    try {
      const old = JSON.parse(read('.work/claude-controls-downtown/pfluger/pfluger-bridge-noisy.json').toString()) as PflugerData;
      const r = smoothness(old, buildPflugerGeometry(old)); noisyPrev = r; noisyPrevFails = r.violations > 0;
    } catch { /* optional local fixture */ }
    const rnd2 = seeded(31);
    const jitter = { ...PFLUGER, deck: PFLUGER.deck.map(r => r.map(p => [p[0], p[1] + (rnd2() - .5) * .24, p[2]] as P3)) } as PflugerData;
    const synthetic = smoothness(jitter, buildPflugerGeometry(jitter));
    check('Pfluger smoothness: centrelines, deck edges and railing tops grade <= 0.08 (ramps <= 0.10, helix <= 0.06) over 1.5 m and second difference <= 0.02 per 1 m; FAILS on the previous LiDAR-per-vertex heights and on +-0.12 m vertex noise',
      now.violations === 0 && noisyPrevFails && synthetic.violations > 0,
      { limits: LIMITS, now, previousNoisy: noisyPrev, syntheticNoise: { violations: synthetic.violations, worst: synthetic.worst }, profileFit: PFLUGER.profile });
  }

  // ---------------------------------------------------------------- 7. map travel
  const region = combineTravelRegions([downtown.travelRegion]);

  const frost = data.meta.buildings.find(b => b.lm === 'frost' && b.heightPolicy)!;
  const frostC = frost.tiers[0].r[0].reduce((s, p) => [s[0] + p[0] / frost.tiers[0].r[0].length, s[1] + p[1] / frost.tiers[0].r[0].length], [0, 0]) as Point;
  const requests: Record<string, Point> = {
    'Republic Square': [-905, 2075], 'Congress at 6th': [-505, 1880], 'riverbank by Congress bridge': [-600, shoreAt(-600) - 12],
    'Rainey Street': [-170, 2990], 'Waterloo Park': [140, 1700], 'Frost Bank Tower (building click)': frostC,
    'river (water click)': [-700, 2700], 'south bank (outside playable)': [-1100, 2900],
  };
  const travel: Record<string, unknown> = {};
  let travelOk = true;
  for (const [name, req] of Object.entries(requests)) {
    const cands = travelCandidates(campus, req, region);
    let landing: THREE.Vector3 | null = null, tried = 0;
    for (const c of cands) { tried++; landing = travelLanding(world, player, c, groundAt(...c), surface, undefined, travelProbe(campus, c)); if (landing) break; }
    const off = landing ? Math.hypot(landing.x - req[0], landing.z - req[1]) : null;
    const inside = landing ? downtown.bounds.legal(landing.x, landing.z, 1.9) : null;
    travel[name] = { candidates: cands.length, tried, landing: landing?.toArray().map(v => +v.toFixed(1)) ?? null, offset: off && +off.toFixed(1), inside };
    const expectLanding = !name.includes('outside') && !name.includes('water');
    if (expectLanding && !(landing && inside && off! < 60 && landing.y - .905 > data.meta.water.y)) travelOk = false;
    if (name.includes('outside') && landing) travelOk = false;
    if (name.includes('water') && landing && !(inside && landing.y - .905 > data.meta.water.y)) travelOk = false;
  }
  const outsideDowntown = !outdoorPoint(campus, [-1100, 2900], region) && !outdoorPoint(campus, [-700, 2700], region);
  check('map travel: lands outdoors on land at downtown destinations; refuses the river and the south bank', travelOk && outsideDowntown, travel);

  // ---------------------------------------------------------------- 7b. trees: campus forms, decor only, trunks collide
  {
    const plan = downtown.treePlan!, tb = downtown.trees!;
    const inGroup = (o: THREE.Object3D) => { let hit = false; downtown.group.traverse(c => { if (c === o) hit = true; }); return hit; };
    const formKinds = new Map<string, number>();
    for (const t of plan.placed) { const k = forms[t.form].spec.kind; formKinds.set(k, (formKinds.get(k) ?? 0) + 1); }
    // Heights: rendered form height x scale vs the LiDAR peak (only clearance-limited trees may be shorter).
    const lidarH = new Map<string, number>();
    for (let k = 0; k < data.trees.length; k += 6) lidarH.set(`${data.trees[k]},${data.trees[k + 2]}`, data.trees[k + 3]);
    let tooTall = 0, matched = 0, overhang = 0;
    for (const t of plan.placed) {
      const h = lidarH.get(`${t.x},${t.z}`)!, drawn = forms[t.form].spec.height * t.scale;
      if (drawn > h + .05 && t.scale > .3501) tooTall++; // the shared 0.35 minimum scale may exceed tiny LiDAR peaks
      if (Math.abs(drawn - h) <= .05) matched++;
    }
    const view = new THREE.PerspectiveCamera(); view.position.set(-600, 2, 2100); view.updateMatrixWorld();
    downtown.update(view.position, view);
    const lod = tb.counts.slice();
    for (const t of plan.placed) overhang += forms[t.form].spec.radius * t.scale > 30 ? 1 : 0;
    const playableTrunks = plan.playable.filter(Boolean).length;
    check('trees: every baked canopy peak drawn with campus oak/upright forms in one TreeBatches population (<= 3 draws, scene decor, never ground); only playable trunks collide',
      plan.placed.length + plan.skipped.noGround === trees && formKinds.size === 2 && !inGroup(tb.group) && downtown.decor.children.includes(tb.group)
        && (tb.impostor ? 3 : 2) <= 3 && downtown.treeTrunks.length === playableTrunks && playableTrunks > 0
        && downtown.treeTrunks.every(t => t.height > .4 && t.height <= 3.35 && t.radius >= .12 && t.radius < 1.2) && overhang === 0
        && lod[0] + lod[1] + lod[2] > 0 && lod[3] > 0 && tooTall === 0 && matched > plan.placed.length * .5,
      { placed: plan.placed.length, skipped: plan.skipped, kinds: Object.fromEntries(formKinds), reducedByClearance: plan.reduced,
        conditions: { counted: plan.placed.length + plan.skipped.noGround === trees, kinds: formKinds.size === 2, notGround: !inGroup(tb.group), inDecor: downtown.decor.children.includes(tb.group),
          trunks: downtown.treeTrunks.length === playableTrunks, trunkShape: downtown.treeTrunks.every(t => t.height > .4 && t.height <= 3.35 && t.radius >= .12 && t.radius < 1.2), overhang: overhang === 0 },
        trunkRange: [Math.min(...downtown.treeTrunks.map(t => t.height)), Math.max(...downtown.treeTrunks.map(t => t.height)), Math.min(...downtown.treeTrunks.map(t => t.radius)), Math.max(...downtown.treeTrunks.map(t => t.radius))],
        drawnTallerThanLidar: tooTall, drawnAtLidarHeight: matched, trunkColliders: downtown.treeTrunks.length, lodCounts: lod, draws: tb.impostor ? 3 : 2 });
  }

  // ---------------------------------------------------------------- 8. LOD, disposal
  downtown.update(new THREE.Vector3(-60, 10, 120)); // campus South Mall
  const fromCampus = downtown.visibleLod();
  downtown.update(new THREE.Vector3(-600, 2, 2100));
  const inCore = downtown.visibleLod();
  const skylineAlways = downtown.group.children.filter(o => o.name.startsWith('Downtown skyline')).every(o => o.visible);
  check('distance LOD: low-rise batches hidden from campus, shown downtown; skyline always drawn',
    fromCampus < inCore && skylineAlways, { visibleFromCampus: fromCampus, visibleDowntown: inCore, lowriseDistance: LOWRISE_DISTANCE, lodObjects: st.lodObjects });
  const disposeCount = new Map<THREE.BufferGeometry, number>();
  const watch = (g: THREE.BufferGeometry) => { if (!disposeCount.has(g)) { disposeCount.set(g, 0); g.addEventListener('dispose', () => disposeCount.set(g, disposeCount.get(g)! + 1)); } };
  for (const root of [downtown.group, downtown.decor]) root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) watch(m.geometry); });
  downtown.dispose(); downtown.dispose();
  const counts = [...disposeCount.values()];
  check('dispose: every rendered geometry (terrain, buildings, decks, water, tree batches) released exactly once; height/contains null; idempotent',
    counts.length > 0 && counts.every(n => n === 1) && downtown.height(-500, 2000) === null && !downtown.contains(-500, 2000) && downtown.isDisposed,
    { geometries: counts.length, notOnce: counts.filter(n => n !== 1).length });

  // ---------------------------------------------------------------- 9. shots
  const ids = new Set(DOWNTOWN_SHOTS.map(s => s.id));
  const shotRows = DOWNTOWN_SHOTS.map(s => {
    const inFootprint = data.meta.buildings.some(b => b.tiers.some(t => pointIn([s.position[0], s.position[2]], t.r[0] as Point[], .3)));
    const g = s.position[2] > 1536 ? geometryHeight(geometry, s.position[0], s.position[2]) : s.groundY;
    return { id: s.id, aboveGround: +(s.position[1] - (g ?? NaN)).toFixed(2), inFootprint, resolvable: findShot(s.id) === s };
  });
  check('downtown review shots: unique ids, resolvable, cameras above their ground, street cameras outdoors, existing shots untouched',
    ids.size === DOWNTOWN_SHOTS.length && DOWNTOWN_SHOTS.length >= 16 && shotRows.every(r => r.resolvable && r.aboveGround > 1.5 && !r.inFootprint)
      && !CAMERA_SHOTS.some(s => ids.has(s.id)) && !EXTENSION_SHOTS.some(s => ids.has(s.id)), shotRows);

  // ---------------------------------------------------------------- 9b. shader structure lint (NOT a GLSL compiler)
  // Runs each downtown material's onBeforeCompile on three's real MeshStandardMaterial source and lints only the
  // injected code: every anchor replaced, balanced (){}, each declaration ends before the next statement, and every
  // assigned identifier declared. A WebGL compile in the browser remains the authority (root CUA console audit).
  const TYPES = /^(float|vec2|vec3|vec4|ivec2|int|bool|mat3)$/;
  const KNOWN = new Set(['diffuseColor', 'roughnessFactor', 'metalnessFactor', 'normal', 'gl_FragColor', 'vDtGlass', 'vDtFac', 'vDtWorld', 'vDtW', 'dtGlassMask', 'transformed']);
  const lint = (label: string, m: THREE.Material, markers: string[]) => {
    const src = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} as Record<string, unknown> };
    (m.onBeforeCompile as (s: typeof src, r: unknown) => void)(src, {});
    const problems: string[] = [];
    for (const mk of markers) if (!src.fragmentShader.includes(mk) && !src.vertexShader.includes(mk)) problems.push(`anchor not applied: ${mk}`);
    for (const [stage, out, orig] of [['vertex', src.vertexShader, THREE.ShaderLib.standard.vertexShader], ['fragment', src.fragmentShader, THREE.ShaderLib.standard.fragmentShader]] as const) {
      const injected = out.split('\n').filter(l => !orig.includes(l) && !/^\s*#include/.test(l)).join('\n').replace(/\/\/[^\n]*/g, '');
      const count = (c: string) => injected.split(c).length - 1;
      if (count('{') !== count('}')) problems.push(`${stage}: unbalanced braces`);
      if (count('(') !== count(')')) problems.push(`${stage}: unbalanced parentheses`);
      const declared = new Set<string>();
      const statements = injected.split(/[;{}]/);
      for (const st of statements) {
        const fn = st.match(/\b(?:float|vec2|vec3|vec4|int|void)\s+\w+\s*\(([^)]*)\)\s*$/);
        if (fn) { for (const arg of fn[1].split(',')) { const n = arg.trim().split(/\s+/)[1]; if (n) declared.add(n); } continue; }
        const loop = st.match(/\bfor\s*\(\s*(?:int|float)\s+(\w+)/);
        if (loop) { declared.add(loop[1]); continue; }
        const toks = st.trim().split(/\s+/);
        const i = toks.findIndex(t => TYPES.test(t));
        if (i === 0 || (i > 0 && /^(uniform|attribute|varying|in|out|const)$/.test(toks[i - 1]))) {
          const decl = st.slice(st.indexOf(toks[i]) + toks[i].length);
          if (/\b(if|for|return|float|vec2|vec3|vec4|int)\b/.test(decl.replace(/\b(float|vec2|vec3|vec4|int|ivec2)\s*\(/g, '')))
            problems.push(`${stage}: declaration runs into another statement: "${st.trim().slice(0, 60)}"`);
          for (const part of decl.split(/,(?![^()]*\))/)) { const n = part.trim().match(/^([A-Za-z_]\w*)/); if (n) declared.add(n[1]); }
        }
      }
      for (const m2 of injected.matchAll(/(?:^|[^\w.])([A-Za-z_]\w*)(?:\.[xyzrgb]+)?\s*(?:[-+*/]?=)(?!=)/g)) {
        const id = m2[1];
        if (!declared.has(id) && !KNOWN.has(id) && !/^(cs|fam|s|wq)$/.test(id) && !orig.includes(` ${id} `)) problems.push(`${stage}: assigns undeclared ${id}`);
      }
    }
    return { label, problems };
  };
  const gm = createGroundMaterial({ grass: stub('g'), asphalt: stub('a'), concrete: stub('c'), classMap: new Uint8Array(4), width: 2, height: 2, origin: [0, 0], res: 1 });
  const lints = [
    lint('facade', createFacadeMaterial(null), ['dtArea', 'dtGlassMask = mask', 'roughnessFactor = mix(roughnessFactor, .18', 'vDtFac = aFac']),
    lint('ground', gm.material, ['dtCls', 'vDtWorld =']),
    lint('water', createWaterMaterial(null), ['vDtW =', 'reflectedLight.indirectSpecular *=']),
    lint('pfluger infill', createPflugerMaterials().infill, ['pfFade = smoothstep', 'diffuseColor.a = mix']),
  ];
  // Negative control: the exact preview-v2 slip ("float mask = 0.," with shade's declaration lost) must be reported.
  const broken = createFacadeMaterial(null), good = broken.onBeforeCompile.bind(broken);
  broken.onBeforeCompile = (sh, r) => { good(sh, r); sh.fragmentShader = sh.fragmentShader.replace('float mask = 0., shade = 1.;', 'float mask = 0.,'); };
  const control = lint('negative control', broken, []);
  lints.push({ label: 'negative control detected', problems: control.problems.length ? [] : ['the lint missed the known preview-v2 slip'] });
  check('shader structure lint of every downtown material (anchors applied, balanced, declarations terminated, assigned identifiers declared; not a compiler)',
    lints.every(l => l.problems.length === 0), lints);

  // ---------------------------------------------------------------- 10. visual-only backdrop
  const bgGz = read('public/assets/extension/downtown-background-v1.bin.gz');
  const bgManifest = JSON.parse(read('public/assets/extension/downtown-background-v1.manifest.json').toString());
  const bgRaw = gunzipSync(bgGz), bgBuf = () => bgRaw.buffer.slice(bgRaw.byteOffset, bgRaw.byteOffset + bgRaw.byteLength) as ArrayBuffer;
  const bg = decodeBackground(bgBuf());
  let bgReject = '';
  try { const b = bgBuf(); new Uint8Array(b)[b.byteLength - 5] ^= 1; decodeBackground(b); } catch (e) { bgReject = e instanceof BackgroundAssetError ? (e as Error).message : 'wrong error'; }
  const background = new DowntownBackground(bg, { grass: stub('grass'), asphalt: stub('asphalt'), concrete: stub('concrete'), envMap: null }, 0);
  const bs = background.stats as Record<string, number>;
  check('backdrop: sha matches manifest, fails closed, within budget (<= 1.5 MB, <= 16 draw calls), no colliders',
    createHash('sha256').update(bgGz).digest('hex') === bgManifest.sha256 && /checksum/.test(bgReject) && bgGz.length <= 1_500_000 && bs.drawCalls <= 16 && bs.colliders === 0,
    { gzipBytes: bgGz.length, drawCalls: bs.drawCalls, triangles: bs.triangles, buildings: bs.buildings, reject: bgReject });
  // Ownership: rendered backdrop cells reach at most one 8 m cell into a playable world; no footprint inside one.
  const cov = bg.meta.covered, insideCov = (x: number, z: number, inset: number) => cov.some(([x0, z0, x1, z1]) => x > x0 + inset && x < x1 - inset && z > z0 + inset && z < z1 - inset);
  let deepCells = 0, footInside = 0;
  const bm = bg.meta;
  for (let j = 0; j < bm.grid.nz - 1; j++) for (let i = 0; i < bm.grid.nx - 1; i++)
    if (bg.cellFlags[j * (bm.grid.nx - 1) + i] & 1 && insideCov(bm.rect.xmin + (i + .5) * bm.step, bm.rect.zmin + (j + .5) * bm.step, bm.step + .01)) deepCells++;
  for (const b of bm.buildings) for (const [x, z] of b.r[0]) if (insideCov(x, z, .05)) { footInside++; break; }
  // Where it tucks under, the backdrop stays below the playable terrain (never pokes through it).
  const terrainJson = JSON.parse(read('public/data/terrain.json').toString()) as TerrainData;
  const campusTerrain = new Terrain(terrainJson, stripGroundHeight);
  const bgHeight = (x: number, z: number) => geometryHeight({ terrain: { height: (xx: number, zz: number) => {
    const fx = (xx - bm.rect.xmin) / bm.step, fz = (zz - bm.rect.zmin) / bm.step, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, nx = bm.grid.nx, k = j * nx + i, h = bg.heights;
    return u + v <= 1 ? h[k] + (h[k + 1] - h[k]) * u + (h[k + nx] - h[k]) * v : h[k + nx + 1] + (h[k + nx] - h[k + nx + 1]) * (1 - u) + (h[k + 1] - h[k + nx + 1]) * (1 - v);
  } } } as never, x, z)!;
  let poke = -Infinity, pokeAt: number[] = [];
  const track = (d: number, x: number, z: number, who: string) => { if (d > poke) { poke = d; pokeAt = [x, z, who as never]; } };
  const geo2 = buildDowntownGeometry(data);
  for (let z = 1540; z < 3500; z += 3) { const x = -1757; track(bgHeight(x, z) - geo2.terrain.height(x, z)!, x, z, 'downtown west'); }
  for (let z = 575; z < 1530; z += 3) { const x = -757; track(bgHeight(x, z) - campusTerrain.height(x, z), x, z, 'campus west'); }
  for (let x = -1755; x < -765; x += 3) { const z = 1539; track(bgHeight(x, z) - geo2.terrain.height(x, z)!, x, z, 'downtown north'); }
  let minSurface = Infinity;
  // Above-water rendered terrain (river-bed vertices sit under the opaque water surface, which is itself checked).
  for (const h of bg.heights) if (h > data.meta.water.surfaceY) minSurface = Math.min(minSurface, h);
  for (const c of geo2.chunks) if (c.terrain.render) { const p = c.terrain.render.getAttribute('position'); for (let i = 0; i < p.count; i++) if (p.getY(i) > data.meta.water.surfaceY) minSurface = Math.min(minSurface, p.getY(i)); }
  minSurface = Math.min(minSurface, data.meta.water.surfaceY);
  check('backdrop ownership: <= one 8 m cell under playable worlds, no footprint inside them, never above their terrain at the edges, horizon below every rendered surface',
    deepCells === 0 && footInside === 0 && poke <= 0 && HORIZON_Y < minSurface - .5,
    { deepCells, footInside, maxPokeAboveNeighbourM: +poke.toFixed(3), pokeAt, horizonY: HORIZON_Y, minRenderedAboveWaterOrWater: +minSurface.toFixed(2) });
  const bgCount = new Map<THREE.BufferGeometry, number>();
  background.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !bgCount.has(m.geometry)) { bgCount.set(m.geometry, 0); m.geometry.addEventListener('dispose', () => bgCount.set(m.geometry, bgCount.get(m.geometry)! + 1)); } });
  const visualFlag = (() => { let all = true; background.group.traverse(o => { if (!o.userData.visualOnly) all = false; }); return all; })();
  background.dispose(); background.dispose();
  check('backdrop: every object flagged visual-only, every geometry disposed exactly once, idempotent',
    visualFlag && [...bgCount.values()].every(n => n === 1) && background.isDisposed, { geometries: bgCount.size });

  world.free();
  return { pass: results.every(r => r.pass), results, stats: { ...downtown.stats, decodeMs, buildMs } };
}

function buildingsOf(chunk: ReturnType<typeof buildDowntownGeometry>['chunks'][number], batch: { ranges: unknown[] }) {
  return batch === chunk.buildings.major ? chunk.buildings.majorBuildings : chunk.buildings.minorBuildings;
}
function geometryHeight(g: ReturnType<typeof buildDowntownGeometry>, x: number, z: number) { return g.terrain.height(x, z); }
function pointIn([x, z]: Point, ring: Point[], margin = 0) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  if (!margin) return inside;
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz;
    const t = l ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l)) : 0;
    d = Math.min(d, Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z));
  }
  return margin > 0 ? inside || d < margin : inside && d > -margin;
}
