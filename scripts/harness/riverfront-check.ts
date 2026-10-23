// Focused riverfront extension check. Built by riverfront.vite.config.mjs, run by run-riverfront-check.mjs.
// Uses the shipped riverfront, downtown and backdrop assets and the real runtime modules with real Rapier; no browser.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { decodeDowntown, type StripSeamSource } from '../../lib/campus/extension/downtown/format';
import { buildDowntownGeometry, Downtown } from '../../lib/campus/extension/downtown';
import { decodeBackground, DowntownBackground } from '../../lib/campus/extension/downtown/background';
import { decodeRiverfront, fnvWords, RiverfrontAssetError } from '../../lib/campus/extension/riverfront/format';
import { buildRiverfrontGeometry, Riverfront, POND_BED_CLEARANCE, MAP_LABELS } from '../../lib/campus/extension/riverfront';
import { LC, RF_COLORS, palmerSurface } from '../../lib/campus/extension/riverfront/landmarks';
import { worldWalls, clampToWorld, mapBounds } from '../../lib/campus/extension/world-bounds';
import { combineTravelRegions, outdoorPoint, travelCandidates, travelLanding, travelProbe } from '../../lib/campus/map-travel';
import { findFlightLanding } from '../../lib/campus/flight-landing';
import { FlightMotion, FLIGHT_TUNING } from '../../lib/campus/flight-motion';
import { characterSupported } from '../../lib/campus/character-support';
import { guardDescent, isWaterbedTarget, overWater, waterHoverFeet, type WaterQuery } from '../../lib/campus/extension/downtown/water-safety';
import { ScooterClearance } from '../../lib/campus/scooter-clearance';
import { PFLUGER } from '../../lib/campus/extension/downtown/pfluger-bridge';
import { treeForms } from '../../lib/campus/vegetation/oak-forms';
import { loadTreeMaterials } from '../../lib/campus/vegetation/tree-materials';
import { headlessImpostors } from '../../lib/campus/vegetation/tree-batches';
import type { CampusData, Point } from '../../lib/campus/types';
import { RIVERFRONT_SHOTS, CAMERA_SHOTS, DOWNTOWN_SHOTS, EXTENSION_SHOTS, WEST_CAMPUS_SHOTS, findShot } from '../../lib/campus/render/camera-shots';

type Result = { name: string; pass: boolean; detail: unknown };
function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
/** Budgets (documented in result.md). */
export const BUDGETS = { gzipBytes: 600_000, drawCalls: 12, terrainTriangles: 60_000, landmarkTriangles: 60_000, colliders: 12, treeInstances: 400, decodeBuildMs: 4000 };

export async function run(root: string) {
  const results: Result[] = [];
  const check = (name: string, pass: boolean, detail: unknown) => { results.push({ name, pass, detail }); };
  const read = (p: string) => readFileSync(resolve(root, p));
  const strip = JSON.parse(read('lib/campus/blocks/b14-capitol/strip-ground.json').toString()) as StripSeamSource;
  const campus = JSON.parse(read('public/data/campus.json').toString()) as CampusData;
  campus.bounds[3] = Math.max(campus.bounds[3], 1536);
  const bounds = campus.bounds;
  const stub = (name: string) => Object.assign(new THREE.MeshStandardMaterial({ map: new THREE.Texture() }), { name });
  const mats = { grass: stub('grass'), asphalt: stub('asphalt'), concrete: stub('concrete'), envMap: null };
  const unzip = (p: string) => { const r = gunzipSync(read(p)); return () => r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength) as ArrayBuffer; };
  const dtBuf = unzip('public/assets/extension/downtown-v1.bin.gz');
  const dtData = decodeDowntown(dtBuf(), strip);
  const forms = treeForms(), treeMats = await loadTreeMaterials(), impostors = headlessImpostors(forms);
  const makeDowntown = () => { const d = new Downtown(buildDowntownGeometry(decodeDowntown(dtBuf(), strip)), mats, 0); d.installTrees({ forms, materials: treeMats, impostors }); return d; };
  const downtown = makeDowntown();
  const bg = new DowntownBackground(decodeBackground(unzip('public/assets/extension/downtown-background-v1.bin.gz')()), mats, 0);

  // ---------------------------------------------------------------- 1. decode + binding + fail closed
  const manifest = JSON.parse(read('public/assets/extension/riverfront-v1.manifest.json').toString());
  const gz = read('public/assets/extension/riverfront-v1.bin.gz');
  check('asset sha matches manifest; size within budget', createHash('sha256').update(gz).digest('hex') === manifest.sha256 && gz.length <= BUDGETS.gzipBytes, { gzipBytes: gz.length });
  const rfBuf = unzip('public/assets/extension/riverfront-v1.bin.gz');
  const t0 = performance.now();
  const data = decodeRiverfront(rfBuf(), downtown.source.data);
  const decodeMs = performance.now() - t0;
  const m = data.meta;
  check('decodes against the shipped downtown asset; shared lattice float-identical; ownership complete', data.sharedVertices > 15000 && data.ownedDowntownCells.length === m.counts.ownedDowntownCells,
    { decodeMs: +decodeMs.toFixed(1), sharedVertices: data.sharedVertices, owned: data.ownedDowntownCells.length, counts: m.counts });
  const metaLen = new DataView(rfBuf()).getUint32(8, true);
  const resign = (b: ArrayBuffer) => { new DataView(b).setUint32(12, fnvWords(new Uint8Array(b, 16)), true); return b; };
  const sec = (name: string) => m.sections.find(s => s.name === name)!;
  const rejects = (label: string, mutate: (b: ArrayBuffer) => ArrayBuffer, expect: RegExp, dd = downtown.source.data) => {
    try { decodeRiverfront(mutate(rfBuf()), dd); check(`fail closed: ${label}`, false, 'accepted'); }
    catch (e) { check(`fail closed: ${label}`, e instanceof RiverfrontAssetError && expect.test((e as Error).message), (e as Error).message); }
  };
  rejects('flipped payload byte', b => { new Uint8Array(b)[b.byteLength - 9] ^= 1; return b; }, /checksum/);
  rejects('truncated', b => b.slice(0, b.byteLength - 64), /./);
  rejects('bad magic', b => { new DataView(b).setUint32(0, 0, true); return b; }, /magic/);
  rejects('different downtown asset (checksum)', b => b, /different downtown/, { ...downtown.source.data, checksum: (downtown.source.data.checksum + 1) >>> 0 });
  const hs = sec('heights'), cf = sec('cellFlags'), ow = sec('ownedDowntownCells'), pe = sec('terrainEdits');
  rejects('re-signed: shared vertex moved 1 mm', b => {
    const h = new Float32Array(b, 16 + metaLen + hs.byteOffset, hs.count);
    const i = Math.round((m.seam.x - m.rect.xmin) / m.step) + 30, j = 120; h[j * m.grid.nx + i] += .001; return resign(b);
  }, /terrain differs|terrain edit/);
  rejects('re-signed: one owned downtown cell dropped (riverfront still renders it: double terrain)', b => {
    const o = new Uint32Array(b, 16 + metaLen + ow.byteOffset, ow.count);
    o.copyWithin(5, 6); o[o.length - 1] = o[o.length - 2] + 1; // still sorted; the dropped cell keeps flag 3 here
    return resign(b);
  }, /not owned|visual-only|outside/);
  rejects('re-signed: riverfront cell east of the seam flagged without ownership', b => {
    const f = new Uint8Array(b, 16 + metaLen + cf.byteOffset, cf.count);
    const ci0 = Math.round((m.seam.x - m.rect.xmin) / m.step);
    for (let k = 0; k < f.length; k++) if (f[k] === 0 && k % (m.grid.nx - 1) > ci0 + 5) { f[k] = 3; break; }
    return resign(b);
  }, /not owned/);
  rejects('re-signed: terrain edits unsorted', b => { const p = new Uint32Array(b, 16 + metaLen + pe.byteOffset, pe.count); [p[0], p[1]] = [p[1], p[0]]; return resign(b); }, /terrain edit/);
  rejects('re-signed: invalid cell flag value', b => { const f = new Uint8Array(b, 16 + metaLen + cf.byteOffset, cf.count); f[0] = 2; return resign(b); }, /flag value/);

  // ---------------------------------------------------------------- 2. geometry, budgets, models
  const t1 = performance.now();
  const geometry = buildRiverfrontGeometry(data);
  const rf = new Riverfront(geometry, mats, decodeMs);
  rf.installTrees({ forms, materials: treeMats, impostors });
  const buildMs = performance.now() - t1;
  const st = rf.stats as Record<string, number>;
  const draws = st.drawCalls + (rf.trees ? (rf.trees.impostor ? 3 : 2) : 0);
  check('budgets: draw calls, triangles, colliders, trees, decode+build time',
    draws <= BUDGETS.drawCalls && st.terrainTriangles <= BUDGETS.terrainTriangles && st.landmarkTriangles <= BUDGETS.landmarkTriangles && rf.colliders.length <= BUDGETS.colliders
      && data.trees.length / 6 <= BUDGETS.treeInstances && decodeMs + buildMs <= BUDGETS.decodeBuildMs,
    { draws, terrainTriangles: st.terrainTriangles, landmarkTriangles: st.landmarkTriangles, buildingTriangles: st.buildingTriangles, colliders: rf.colliders.length,
      trees: data.trees.length / 6, decodeMs: +decodeMs.toFixed(0), buildMs: +buildMs.toFixed(0), budgets: BUDGETS });
  const lcm = m.landmarks.longCenter, sol = geometry.solids.geometry.getAttribute('position').array as Float32Array;
  const col = geometry.solids.geometry.getAttribute('color').array as Float32Array, cream = RF_COLORS.cream;
  // Ring beam: the pale-cream band's triangles sit at the measured top and radius (pale band around the terrace).
  let ringTop = -Infinity; const ringR: number[] = [];
  for (let k = 0; k < sol.length; k += 3) {
    if (Math.abs(col[k] - cream.r) > 1e-6 || Math.abs(col[k + 1] - cream.g) > 1e-6 || Math.abs(col[k + 2] - cream.b) > 1e-6) continue;
    ringTop = Math.max(ringTop, sol[k + 1]); ringR.push(Math.hypot(sol[k] - lcm.ring.c[0], sol[k + 2] - lcm.ring.c[1]));
  }
  const lc = geometry.models.longCenter;
  check('Long Center: ring beam at the LiDAR circle (top, radius), slender columns standing on terrace/ground, terrace at the LiDAR level with a front stair',
    Math.abs(ringTop - lcm.ring.top) < 1e-3 && Math.abs(Math.min(...ringR) - (lcm.ring.r - LC.ringWidth / 2)) < .05 && Math.abs(Math.max(...ringR) - (lcm.ring.r + LC.ringWidth / 2)) < .05 && lc.columns.length >= 10 && lc.stairSlices > 20 && lc.terraceY === lcm.terrace,
    { ringTop, measuredTop: lcm.ring.top, radius: lcm.ring.r, fitResidualM: lcm.ring.medianResidual, columns: lc.columns.length, stairSlices: lc.stairSlices, maxStairDrop: +lc.maxStairDrop.toFixed(2), terrace: lc.terraceY,
      volumes: lcm.volumes.map(v => ({ name: v.name, top: v.top, areaM2: v.areaM2 })) });
  const pm = m.landmarks.palmer;
  check('Palmer: tented canopy spans the City footprint corners with eave heights from LiDAR, solar plateau, colonnade and enclosed hall',
    geometry.models.palmer.columns.length >= 12 && geometry.models.palmer.hall.length === 40 && pm.corners.length === 4,
    { corners: pm.corners, sags: pm.sags, eaves: pm.eaves, rim: pm.rim, plateau: pm.plateau, columns: geometry.models.palmer.columns.length });

  // Walkable model floors face up where a downward ray first meets them (local ground queries, scooter scans and flight
  // landing reject floors whose normal points down), and every pond water triangle faces up (front-sided water).
  {
    const probeMesh = new THREE.Mesh(geometry.solids.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    probeMesh.updateMatrixWorld();
    const rc = new THREE.Raycaster();
    const probe = (name: string, x: number, z: number, minY = .5) => {
      rc.set(new THREE.Vector3(x, 120, z), new THREE.Vector3(0, -1, 0));
      const h = rc.intersectObject(probeMesh)[0];
      return { name, y: h ? +h.point.y.toFixed(2) : null, normalY: h?.face ? +h.face.normal.y.toFixed(3) : null, ok: !!h?.face && h.face.normal.y > minY };
    };
    const L = m.landmarks, [lx, lz] = L.longCenter.ring.c, ld = geometry.models.longCenter.dir, sr = L.longCenter.ring.r + 1.8 + .1;
    const pc0 = palmerSurface(L.palmer).P(.5, .5), gz0 = L.gazebo, core0 = L.garage.cores[0]?.r;
    const ringPts = L.garage.r as Point[];
    let gx = 0, gzz = 0; for (const q of ringPts) { gx += q[0] / ringPts.length; gzz += q[1] / ringPts.length; }
    // a garage roof-deck point: a footprint vertex pulled 6 m toward the centroid, inside the footprint, clear of the cores
    const deckPt = ringPts.map(v => { const l = Math.hypot(gx - v[0], gzz - v[1]); return [v[0] + (gx - v[0]) / l * 6, v[1] + (gzz - v[1]) / l * 6] as Point; })
      .find(q => pointIn(q, ringPts) && !L.garage.cores.some(c => pointIn(q, c.r as Point[]) || Math.hypot(q[0] - c.r[0][0], q[1] - c.r[0][1]) < 25))!;
    const probes = [
      probe('Long Center City Terrace', lx - ld[0] * 25, lz - ld[1] * 25), probe('Long Center front stair tread', lx - ld[0] * sr, lz - ld[1] * sr),
      probe('Palmer solar plateau', pc0[0], pc0[1]), probe('gazebo canopy', gz0.c[0] + Math.cos(Math.PI / 8) * gz0.r * .6, gz0.c[1] + Math.sin(Math.PI / 8) * gz0.r * .6, .15),
      probe('garage roof deck', deckPt[0], deckPt[1]),
      ...(core0 ? [probe('garage core roof', core0.reduce((a, q) => a + q[0] / 4, 0), core0.reduce((a, q) => a + q[1] / 4, 0))] : []),
      ...m.pfluger.approaches.map(a => probe(`Pfluger approach ${a.arm}`, (a.from[0] + a.to[0]) / 2, (a.from[2] + a.to[2]) / 2, .8)),
      ...m.docks.map(d => { const r = d.r[0] as Point[]; return probe(`dock ${d.oid}`, r.reduce((a, q) => a + q[0] / r.length, 0), r.reduce((a, q) => a + q[1] / r.length, 0)); }),
    ];
    const pn = geometry.ponds.getAttribute('normal').array as Float32Array;
    let pondDown = 0; for (let k = 1; k < pn.length; k += 3) if (!(pn[k] > .99)) pondDown++;
    check('upward floors: terrace, stair tread, Palmer plateau, gazebo canopy, garage roof/core, both Pfluger approaches and all docks are hit from above with normal.y > 0; every pond water normal points up',
      probes.every(q => q.ok) && probes.length >= 10 && pondDown === 0 && probes.find(q => q.name === 'garage roof deck')!.y === L.garage.roof, { probes, pondVertices: pn.length / 3, pondDown });
    probeMesh.material.dispose();
    const ga = L.garage, gm = geometry.models.garage;
    check('garage (City 1329594) is a parking structure at the 2017 LiDAR bulk roof, not the City one-height peak: measured roof, compact cores only, < 3 k triangles; three City docks with LiDAR deck heights',
      gm.roof === ga.roof && ga.roof < ga.cityMaxHeightTop - 5 && gm.levels === ga.levels && ga.cores.length >= 1 && ga.cores.length <= 3 && ga.roofModeReturns > 2000
        && m.docks.length === 3 && m.docks.every(d => d.lidarReturns >= 15),
      { roof: ga.roof, ground: ga.ground, cityPeakTop: ga.cityMaxHeightTop, levels: ga.levels, cores: ga.cores.map(c => c.top), lidarReturns: ga.lidarReturns, roofModeReturns: ga.roofModeReturns,
        docks: m.docks.map(d => ({ oid: d.oid, y: d.y, returns: d.lidarReturns })) });
  }

  // Modelled water and floors sit above the terrain (no DEM poking through the terrace slab or the pond interiors).
  {
    const T = lcm.terrace, c0 = lcm.ring.c, dir0 = geometry.models.longCenter.dir;
    let terraceHits = 0, terraceN = 0, pondHits = 0, pondN = 0;
    for (let x = c0[0] - lcm.ring.r; x <= c0[0] + lcm.ring.r; x += .7) for (let z = c0[1] - lcm.ring.r; z <= c0[1] + lcm.ring.r; z += .7) {
      if (Math.hypot(x - c0[0], z - c0[1]) > lcm.ring.r + 1.5 || (x - c0[0]) * dir0[0] + (z - c0[1]) * dir0[1] > -6.5) continue;
      terraceN++; if (geometry.terrain.height(x, z)! > T - .05) terraceHits++;
    }
    for (const p of m.ponds) {
      const ring = p.ring as Point[], xs0 = ring.map(q => q[0]), zs0 = ring.map(q => q[1]);
      for (let x = Math.min(...xs0); x <= Math.max(...xs0); x += .7) for (let z = Math.min(...zs0); z <= Math.max(...zs0); z += .7) {
        if (!pointIn([x, z], ring, -2.5)) continue;
        pondN++; if (geometry.terrain.height(x, z)! > p.surfaceY - .02) pondHits++;
      }
    }
    check('modelled floors and water sit above the terrain: City Terrace slab (5 cm clear everywhere), pond interiors (2.5 m inside the outline)',
      terraceN > 1500 && terraceHits === 0 && pondN > 3000 && pondHits === 0, { terraceN, terraceHits, pondN, pondHits, terrainEdits: data.terrainEdits.length });
  }

  // ---------------------------------------------------------------- 3. overlay on downtown + backdrop (ownership)
  const dt = downtown.source;
  const before = downtown.terrainMeshes.map(t => t.mesh.geometry);
  const repRanges = m.downtownReplace.map(r => downtown.buildingRanges.get(r.k)!);
  const repSaved = repRanges.map(r => (r.mesh.geometry.getAttribute('position').array as Float32Array).slice(r.start * 9, (r.start + r.count) * 9));
  // A prepared but never applied overlay (failed commit) changes nothing.
  const dry = rf.prepareOverlay(downtown, bg); dry.discard();
  const untouched = downtown.terrainMeshes.every((t, i) => t.mesh.geometry === before[i]) && dt.terrain.excluded === null;
  const overlay = rf.prepareOverlay(downtown, bg);
  overlay.apply();
  let both = 0, neither = 0, sampled = 0;
  const pr = seeded(11);
  for (let i = 0; i < 4000; i++) {
    const x = Math.max(m.seam.x + .01, m.rect.xmin + pr() * (m.rect.xmax - m.rect.xmin)), z = m.rect.zmin + pr() * (m.rect.zmax - m.rect.zmin);
    const orig = (dt.data.cellFlags[dt.terrain.cell(x, z)] & 1) === 1;
    if (!orig) continue;
    sampled++;
    const a = dt.terrain.rendered(x, z), b = geometry.terrain.rendered(x, z);
    if (a && b) both++; if (!a && !b) neither++;
  }
  // Placeholders collapsed (zero area), backdrop cells cut.
  const area = (arr: Float32Array, s: number, n: number) => { let A = 0; for (let t = s; t < s + n; t++) { const o = t * 9; const ux = arr[o + 3] - arr[o], uy = arr[o + 4] - arr[o + 1], uz = arr[o + 5] - arr[o + 2], vx = arr[o + 6] - arr[o], vy = arr[o + 7] - arr[o + 1], vz = arr[o + 8] - arr[o + 2]; A += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2; } return A; };
  const collapsedArea = repRanges.reduce((s, r) => s + area(r.mesh.geometry.getAttribute('position').array as Float32Array, r.start, r.count), 0);
  check('ownership overlay: every originally-rendered downtown cell in the riverfront rectangle is drawn by exactly one extension; placeholders (Long Center, Palmer, gazebo, garage) have zero area; prepared-but-failed overlay changed nothing',
    untouched && sampled > 1500 && both === 0 && neither === 0 && collapsedArea === 0 && overlay.stats.downtownTerrainTrianglesRemoved === data.ownedDowntownCells.length * 2,
    { untouched, sampled, both, neither, collapsedArea, overlay: overlay.stats, backgroundCutCells: (rf.stats as Record<string, number>).backgroundCutCells });

  // The downtown canopy peak whose trunk point now lies inside Liz Carpenter Pond is hidden at every LOD (near, mid, far,
  // impostor distance), has no trunk capsule, and the rest of the population is untouched.
  const dTrees = downtown.trees!, dPlan = downtown.treePlan!;
  const lodSeen: Record<string, unknown> = {};
  let hiddenDrawn = 0;
  for (const dist of [5, 60, 400, 1200, 3000]) {
    for (const i of overlay.hiddenTrees) {
      const t = dPlan.placed[i], cam = new THREE.PerspectiveCamera(); cam.position.set(t.x + dist, t.y + 2, t.z); cam.updateMatrixWorld();
      dTrees.update(cam, true);
      const v = dTrees.instanceVisible(i); if (v.some(Boolean)) hiddenDrawn++;
      lodSeen[`${i}@${dist}`] = v;
    }
  }
  const inPondTrunk = overlay.capsules.some(c => m.ponds.some(p => pointIn([c.x, c.z], p.ring as Point[])));
  check('pond tree: the one downtown tree inside Liz Carpenter Pond is hidden at every LOD distance (wood, foliage, impostor) with no trunk capsule; no other tree hidden',
    overlay.hiddenTrees.length === 1 && hiddenDrawn === 0 && !inPondTrunk && dPlan.placed.filter((_, i) => dTrees.isHidden(i)).length === 1,
    { hidden: overlay.hiddenTrees.map(i => [+dPlan.placed[i].x.toFixed(1), +dPlan.placed[i].z.toFixed(1)]), lodSeen });

  // ---------------------------------------------------------------- 4. physics world
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -24, z: 0 });
  const rfHandles = new Set<number>(), allSolid = new Set<number>();
  const add = (c: { position: Float32Array; index: Uint32Array }, set?: Set<number>) => { const h = world.createCollider(RAPIER.ColliderDesc.trimesh(c.position, c.index).setFriction(.8)).handle; set?.add(h); allSolid.add(h); };
  for (const c of downtown.colliders) add(c);
  for (const t of downtown.treeTrunks) world.createCollider(RAPIER.ColliderDesc.capsule(t.height / 2, t.radius).setTranslation(t.x, t.y + t.height / 2, t.z));
  for (const c of [...rf.colliders, ...overlay.colliders]) add(c, rfHandles);
  for (const t of [...rf.treeTrunks, ...overlay.capsules]) world.createCollider(RAPIER.ColliderDesc.capsule(t.height / 2, t.radius).setTranslation(t.x, t.y + t.height / 2, t.z));
  const dEdges = { bounds: downtown.bounds, barriers: dtData.meta.barriers, barrierBottom: dtData.meta.water.y - 2, barrierTop: dtData.meta.barrierTop };
  const rEdges = { bounds: rf.bounds, walls: m.walls, downtownWalls: m.downtownWalls, barriers: m.barriers };
  const walls = worldWalls(bounds, null, dEdges, rEdges);
  for (const w of walls) {
    const d = RAPIER.ColliderDesc.cuboid(w.hx, w.hy, w.hz).setTranslation(w.cx, w.cy, w.cz);
    if (w.angle) d.setRotation({ x: 0, y: Math.sin(w.angle / 2), z: 0, w: Math.cos(w.angle / 2) });
    world.createCollider(d);
  }
  world.step();
  // Without the riverfront the walls are exactly the downtown world's.
  const dOnly = JSON.stringify(worldWalls(bounds, null, dEdges)), dNull = JSON.stringify(worldWalls(bounds, null, dEdges, null));
  // Replacement wall list: every full-height piece lies on an original downtown wall (subset), and the original walls
  // away from the riverfront region are untouched.
  const onOriginal = m.downtownWalls.every(([ax, az, bx, bz]) => dtData.meta.walls.some(([px, pz, qx, qz]) => {
    const L = Math.hypot(qx - px, qz - pz); if (L < 1e-6) return false;
    const d = (x: number, z: number) => Math.abs((qx - px) * (z - pz) - (qz - pz) * (x - px)) / L;
    const t = (x: number, z: number) => ((x - px) * (qx - px) + (z - pz) * (qz - pz)) / (L * L);
    return d(ax, az) < .02 && d(bx, bz) < .02 && t(ax, az) > -1e-3 && t(ax, az) < 1.001 && t(bx, bz) > -1e-3 && t(bx, bz) < 1.001;
  }));
  const len = (ws: number[][]) => ws.reduce((s, [ax, az, bx, bz]) => s + Math.hypot(bx - ax, bz - az), 0);
  const farOrig = dtData.meta.walls.filter(([ax, az, bx, bz]) => !rf.bounds.contains(ax, az) && !rf.bounds.contains(bx, bz) && Math.min(ax, bx) > m.rect.xmax + 20);
  const farNew = m.downtownWalls.filter(([ax, , bx]) => Math.min(ax, bx) > m.rect.xmax + 20);
  const underDeck = [...m.walls, ...m.downtownWalls].filter(w => w[6] === 1);
  check('walls: downtown-only world unchanged without the riverfront; replacement downtown walls are a subset of the originals, untouched east of the corridor; under-deck pieces stop below the Pfluger girders',
    dOnly === dNull && onOriginal && Math.abs(len(farOrig) - len(farNew)) < .5 && underDeck.length > 0 && underDeck.every(w => w[5] < -25.5),
    { downtownWalls: dtData.meta.walls.length, replacement: m.downtownWalls.length, onOriginal, farLength: [+len(farOrig).toFixed(1), +len(farNew).toFixed(1)], underDeck: underDeck.map(w => w[5]) });

  const down = (x: number, z: number, from = 400, filter?: (c: RAPIER.Collider) => boolean) => {
    const hit = world.castRay(new RAPIER.Ray({ x, y: from, z }, { x: 0, y: -1, z: 0 }), 600, true, undefined, undefined, undefined, undefined, filter);
    return hit ? from - hit.timeOfImpact : null;
  };
  rf.group.updateMatrixWorld(true); downtown.group.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  const visible = (x: number, z: number, from = 400) => {
    raycaster.set(new THREE.Vector3(x, from, z), new THREE.Vector3(0, -1, 0));
    return raycaster.intersectObjects([...rf.group.children, ...downtown.group.children], false).filter(h => {
      const g = (h.object as THREE.Mesh).geometry, p = g.getAttribute('position');
      if (h.faceIndex === undefined || h.faceIndex === null || !p || g.index) return true;   // indexed terrain: always real
      const f = h.faceIndex, a = new THREE.Vector3().fromBufferAttribute(p, f * 3), b = new THREE.Vector3().fromBufferAttribute(p, f * 3 + 1), c = new THREE.Vector3().fromBufferAttribute(p, f * 3 + 2);
      return b.sub(a).cross(c.sub(a)).lengthSq() > 1e-10;          // collapsed placeholders draw nothing
    }).sort((a, b) => a.distance - b.distance)[0];
  };
  const land = m.land as Point[][];
  const inLand = (x: number, z: number) => rf.travelRegion.contains([x, z]) || pointIn([x, z], land[0]);
  let parity = 0, parityN = 0, worst: number[] = [];
  const pp = seeded(5);
  for (let i = 0; i < 3000; i++) {
    const x = m.rect.xmin + pp() * (m.rect.xmax - m.rect.xmin), z = m.rect.zmin + pp() * (m.rect.zmax - m.rect.zmin);
    if (!pointIn([x, z], land[0]) || rf.isWater(x, z)) continue;
    const vis = visible(x, z), phys = down(x, z, 400, c => allSolid.has(c.handle));
    if (!vis || phys === null) { parity = Infinity; worst = [x, z]; continue; }
    const d = Math.abs(vis.point.y - phys);
    if (d > parity) { parity = d; worst = [x, z, vis.point.y, phys, (vis.object as THREE.Mesh).name as never]; }
    parityN++;
  }
  check('render/collider parity on the riverfront land (first visible hit == Rapier hit, random columns incl. roofs, terrace, docks)',
    parity < 2e-3 && parityN > 600, { samples: parityN, maxAbs: parity, worst });
  let underground = 0;
  for (let i = 0; i < 800; i++) {
    const x = m.rect.xmin + pp() * (m.rect.xmax - m.rect.xmin), z = m.rect.zmin + pp() * (m.rect.zmax - m.rect.zmin);
    const g = rf.height(x, z), p = g === null ? null : down(x, z, g + 60, c => allSolid.has(c.handle));
    if (g !== null && p !== null && p < g - 1e-3) underground++;
  }
  check('physical surface never below the riverfront terrain (no holes)', underground === 0, { underground });
  // Terrain fit: the 4 m surface vs the 2017 LiDAR-derived bare earth is the DEM itself; here: the riverfront grid equals
  // downtown's east of the seam (decoder) and the hill rises > 8 m above its surroundings (DEM, not a cone).
  const hill = m.places.find(p => p.key === 'doug-sahm-hill')!.p, hillTop = rf.height(hill[0], hill[1])!;
  const [sx, sy, sz] = m.landmarks.hill.summitLidar, summitHere = rf.height(sx, sz)!;
  const ringG = [0, 1, 2, 3, 4, 5, 6, 7].map(k => rf.height(hill[0] + Math.cos(k * Math.PI / 4) * 60, hill[1] + Math.sin(k * Math.PI / 4) * 60)!).sort((a, b) => a - b);
  check('Doug Sahm Hill follows the measured ground: rendered summit within 0.3 m of the highest 2017 LiDAR ground return, > 5 m above its surroundings (DEM, not a cone)',
    Math.abs(summitHere - sy) < .3 && summitHere - (ringG[3] + ringG[4]) / 2 > 5, { summitLidar: m.landmarks.hill.summitLidar, rendered: +summitHere.toFixed(2), around: ringG.map(v => +v.toFixed(2)) });

  // ---------------------------------------------------------------- 5. walking + scooter
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(-1500, 50, 2500));
  const player = world.createCollider(RAPIER.ColliderDesc.capsule(.54, .34).setFriction(0), body);
  const controller = world.createCharacterController(.025);
  controller.enableAutostep(.32, .2, false); controller.enableSnapToGround(.38);
  controller.setMaxSlopeClimbAngle(Math.PI * .25); controller.setMinSlopeSlideAngle(Math.PI * .28);
  const notMe = (c: RAPIER.Collider) => c.handle !== player.handle;
  const groundAt = (x: number, z: number) => rf.height(x, z) ?? downtown.height(x, z) ?? 0;
  const place = (x: number, z: number, y?: number) => { const yy = (y ?? (down(x, z, groundAt(x, z) + 6, notMe) ?? groundAt(x, z))) + .92; body.setTranslation({ x, y: yy, z }, true); body.setNextKinematicTranslation({ x, y: yy, z }); world.step(); };
  const W = m.water.y;
  const walk = (path: Point[], speed = 8, maxSeconds = 400) => {
    const dt = 1 / 60; let vy = 0, maxDy = 0, stuck = 0, k = 1, minAbove = Infinity, maxY = -Infinity;
    for (let i = 0; i < maxSeconds * 60 && k < path.length; i++) {
      const p = body.translation(), [tx, tz] = path[k], d = Math.hypot(tx - p.x, tz - p.z);
      if (d < 1.5) { k++; continue; }
      vy = Math.max(vy - 24 * dt, -30);
      controller.computeColliderMovement(player, { x: (tx - p.x) / d * speed * dt, y: vy * dt, z: (tz - p.z) / d * speed * dt });
      if (controller.computedGrounded()) vy = 0;
      const mv = controller.computedMovement(), next = { x: p.x + mv.x, y: p.y + mv.y, z: p.z + mv.z };
      body.setNextKinematicTranslation(next); world.step();
      maxDy = Math.max(maxDy, Math.abs(mv.y)); minAbove = Math.min(minAbove, next.y - .905 - W); maxY = Math.max(maxY, next.y - .905);
      if (Math.hypot(mv.x, mv.z) < speed * dt * .2) stuck++; else stuck = 0;
      if (stuck > 120) break;
    }
    const e = body.translation();
    return { reached: k >= path.length, waypoint: k, of: path.length, end: [+e.x.toFixed(1), +(e.y - .905).toFixed(2), +e.z.toFixed(1)], maxDy: +maxDy.toFixed(3), aboveWaterMin: +minAbove.toFixed(2), maxFeet: +maxY.toFixed(2) };
  };
  const sub = (pts: number[][], step: number): Point[] => { const out: Point[] = []; let acc = Infinity; let prev = pts[0];
    for (const p of pts) { acc += Math.hypot(p[0] - prev[0], p[2] - prev[2]); prev = p; if (acc >= step) { out.push([p[0], p[2]]); acc = 0; } }
    const l = pts[pts.length - 1]; out.push([l[0], l[2]]); return out; };
  const A = PFLUGER.paths!.A, B = PFLUGER.paths!.B;
  const apA = m.pfluger.approaches.find(a => a.arm === 'A')!, apB = m.pfluger.approaches.find(a => a.arm === 'B')!;
  // North connector (downtown, x > -1760) along branch A over the river to the south-west arm, down its approach slab.
  const north = PFLUGER.open.find(o => o.name === 'north')!;
  place(north.x, north.z);
  const crossA = walk([[north.x, north.z], ...sub(A, 8), [apA.to[0], apA.to[2]]], 6);
  place(apB.to[0], apB.to[2]);
  const crossB = walk([[apB.to[0], apB.to[2]], ...sub([...B].reverse(), 6), ...sub([...A].reverse().filter(p => p[2] < 2340), 8)], 6);
  check('walking: Pfluger bridge north connector -> main span -> south-west arm -> approach slab onto the south bank; and back from Riverside up the south arm to the north landing (never below water)',
    crossA.reached && crossB.reached && crossA.aboveWaterMin > 2 && crossB.aboveWaterMin > 2 && crossA.end[2] > 2360 && crossB.end[2] < 2200,
    { crossA, crossB, approaches: m.pfluger.approaches });
  const scooter = new ScooterClearance({ world, controller, collider: player });
  const ride = (path: Point[], maxM: number) => {
    place(...path[0]); let dist = 0, blocked = 0, k = 1;
    let heading = Math.atan2(path[1][0] - path[0][0], path[1][1] - path[0][1]);
    const mount = scooter.canMount(heading);
    for (let i = 0; i < 60 * 120 && k < path.length && dist < maxM; i++) {
      const p = body.translation(), [tx, tz] = path[k];
      if (Math.hypot(tx - p.x, tz - p.z) < 2) { k++; continue; }
      const nh = Math.atan2(tx - p.x, tz - p.z);
      const r = scooter.resolveMove({ fromHeading: heading, heading: nh, displacement: { x: Math.sin(nh) * 8 / 60, z: Math.cos(nh) * 8 / 60 } });
      heading = nh;
      if (r.blockedReason && r.fraction < .8) blocked++;
      body.setNextKinematicTranslation({ x: p.x + r.delta.x, y: p.y + r.delta.y, z: p.z + r.delta.z }); world.step(); dist += Math.hypot(r.delta.x, r.delta.z);
    }
    return { mounted: mount.allowed, reason: mount.blockedReason, ridden: +dist.toFixed(1), waypoint: k, of: path.length, blockedFrames: blocked };
  };
  const scootA = ride([[north.x, north.z], ...sub(A, 6), [apA.to[0], apA.to[2]]], 400);
  const scootB = ride([[apB.to[0], apB.to[2]], ...sub([...B].reverse(), 5), ...sub([...A].reverse().filter(p => p[2] < 2340), 6)], 400);
  check('scooter: rides the Pfluger crossing both ways (north connector <-> south arms, real clearance model)',
    scootA.mounted && scootB.mounted && scootA.waypoint >= scootA.of - 1 && scootB.waypoint >= scootB.of - 1, { scootA, scootB });

  // Butler Trail along the south shore: the City trail class nearest the water every 30 m, walked end to end.
  const cls = (x: number, z: number) => data.classMap[Math.floor(z - m.rect.zmin) * m.classMap.w + Math.floor(x - m.rect.xmin)];
  const trail: Point[] = [];
  let trailCols = 0, trailFound = 0;
  for (let x = -1880; x <= -1090; x += 30) {
    trailCols++;
    let shoreZ = -1;
    for (let z = 2330; z < 2800; z++) if (pointIn([x, z], land[0]) && !rf.isWater(x, z)) { shoreZ = z; break; }
    if (shoreZ < 0) continue;
    for (let z = shoreZ; z < shoreZ + 60; z++) if (cls(x, z) === 4 || cls(x, z) === 2) { trail.push([x, z + .5]); trailFound++; break; }
  }
  place(...trail[0]);
  const trailWalk = walk(trail, 6, 600);
  check('Butler Trail: a City trail/sidewalk surface lies within 60 m of the south shore at >= 85 % of 30 m stations from Lamar to South First, and the walk between them is continuous',
    trailFound >= trailCols * .85 && trailWalk.reached && trailWalk.aboveWaterMin > 0, { stations: trailCols, found: trailFound, walk: trailWalk });
  // Doug Sahm Hill summit, and up the Long Center front stair onto the City Terrace.
  const hillWalks = [0, 1, 2, 3, 4, 5, 6, 7].map(k => {
    const a = k * Math.PI / 4, start: Point = [hill[0] + Math.cos(a) * 60, hill[1] + Math.sin(a) * 60];
    place(...start); return walk([start, [hill[0] + Math.cos(a) * 25, hill[1] + Math.sin(a) * 25], hill], 5, 120);
  });
  const hillOk = hillWalks.filter(w => w.reached && Math.abs(w.end[1] - hillTop) < .6);
  const hillWalk = hillOk[0] ?? hillWalks[0];
  const t = lcm, dir = lc.dir, open: Point = [t.ring.c[0] - dir[0] * (t.ring.r + 16), t.ring.c[1] - dir[1] * (t.ring.r + 16)];
  place(...open);
  const terraceWalk = walk([open, [t.ring.c[0] - dir[0] * 12, t.ring.c[1] - dir[1] * 12]], 4, 120);
  check('park paths: walk up Doug Sahm Hill to the summit; climb the Long Center front stair onto the City Terrace',
    hillOk.length >= 4 && terraceWalk.reached && Math.abs(terraceWalk.end[1] - t.terrace) < .1,
    { hillWalksReached: hillOk.length, hillWalk, hillTop, terraceWalk, terrace: t.terrace });

  // Walls/barriers: south shore barrier, pond barrier, Lamar/Barton Springs/railroad edges.
  const push = (start: Point, dirv: Point, seconds = 6) => { place(...start); const p0 = body.translation(); return walk([start, [p0.x + dirv[0] * 300, p0.z + dirv[1] * 300]], 8, seconds); };
  const shoreBarriers = m.barriers.filter(b => b[5] === m.water.barrierTop && Math.hypot(b[2] - b[0], b[3] - b[1]) > 3 && pointIn([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2 + 4], land[0], 0));
  const shoreRes = shoreBarriers.filter((_, i) => i % Math.max(1, Math.floor(shoreBarriers.length / 6)) === 0).slice(0, 6).map(([ax, az, bx, bz]) => {
    const L = Math.hypot(bx - ax, bz - az), mx = (ax + bx) / 2, mz = (az + bz) / 2;
    let nx = -(bz - az) / L, nz = (bx - ax) / L;
    if (rf.isWater(mx + nx * 3, mz + nz * 3)) { nx = -nx; nz = -nz; }
    const r = push([mx + nx * 6, mz + nz * 6], [-nx, -nz], 4);
    return { at: [mx, mz], aboveWaterMin: r.aboveWaterMin, landSide: +((r.end[0] - mx) * nx + (r.end[2] - mz) * nz).toFixed(2) };
  });
  const pond = m.ponds[0], pc = pond.ring.reduce((s, p) => [s[0] + p[0] / pond.ring.length, s[1] + p[1] / pond.ring.length], [0, 0]) as Point;
  const pondEdge = pond.ring[0] as Point, pd = Math.hypot(pondEdge[0] - pc[0], pondEdge[1] - pc[1]);
  const pondPush = push([pondEdge[0] + (pondEdge[0] - pc[0]) / pd * 6, pondEdge[1] + (pondEdge[1] - pc[1]) / pd * 6], [(pc[0] - pondEdge[0]) / pd, (pc[1] - pondEdge[1]) / pd], 5);
  const lamarProbe = push([-1860, 2395], [-1, -.3]);
  const railProbe = push([-1740, 2700], [-1, -.5]);
  const bsProbe = push([-1500, 2930], [0, 1]);
  const legalEnd = (e: number[]) => rf.bounds.contains(e[0], e[2]) || downtown.bounds.contains(e[0], e[2]);
  check('walls/barriers: the south-shore barrier and the pond barrier keep walkers out of the water; Lamar, railroad and Barton Springs edges hold',
    shoreRes.length >= 4 && shoreRes.every(r => r.landSide > -.05 && r.aboveWaterMin > -.05) && !pointIn([pondPush.end[0], pondPush.end[2]], pond.ring as Point[])
      && legalEnd(lamarProbe.end) && legalEnd(railProbe.end) && legalEnd(bsProbe.end),
    { shoreRes, pondPush, pondSurface: pond.surfaceY, lamarProbe: lamarProbe.end, railProbe: railProbe.end, bsProbe: bsProbe.end });

  // ---------------------------------------------------------------- 6. flight
  const dtw = downtown.water;
  const water: WaterQuery = { surfaceY: dtw.surfaceY, bedTop: dtw.bedTop, isWater: (x, z) => rf.isWater(x, z) || dtw.isWater(x, z), bedTopAt: (x, z) => rf.bedTopAt(x, z, dtw.bedTop) };
  const surface = (x: number, z: number, fromY: number, distance: number) => {
    raycaster.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0)); raycaster.far = distance;
    const hit = raycaster.intersectObjects([...rf.group.children, ...downtown.group.children], false).sort((a, b) => a.distance - b.distance).find(h => h.face && h.face.normal.y > .5) ?? null;
    raycaster.far = Infinity; return hit;
  };
  const flyCtl = world.createCharacterController(.025);
  flyCtl.setMaxSlopeClimbAngle(Math.PI * .25); flyCtl.setMinSlopeSlideAngle(Math.PI * .28);
  const fly = (start: { x: number; feet: number; z: number }, seconds: number, mode: 'landing' | 'flying', heading: Point | null = null) => {
    const flight = new FlightMotion(); flight.start(); flight.mode = mode;
    body.setTranslation({ x: start.x, y: start.feet + .905, z: start.z }, true); body.setNextKinematicTranslation({ x: start.x, y: start.feet + .905, z: start.z }); world.step();
    const dt = 1 / 60; let target: THREE.Vector3 | null = null, landed = false, overWaterFrames = 0, clampHits = 0;
    for (let i = 0; i < seconds * 60 && !landed; i++) {
      const p = body.translation();
      if (mode === 'landing' && i % 12 === 0) target = findFlightLanding(world, player, p, overWater(water, p.x, p.z) ? surface : undefined, null, q => !isWaterbedTarget(water, q.x, q.y - .905, q.z));
      const yaw = heading ? Math.atan2(-(heading[0] - p.x), -(heading[1] - p.z)) : 0;
      const requested = flight.update(dt, { forward: heading && Math.hypot(heading[0] - p.x, heading[1] - p.z) > 2 ? 1 : 0, strafe: 0, climb: 0, boost: false, yaw, y: p.y, enabled: true, x: p.x, z: p.z, landingTarget: mode === 'landing' ? target : null });
      const delta = requested.clone().multiplyScalar(dt);
      const [cx, cz] = clampToWorld(bounds, null, downtown.bounds, p.x + delta.x, p.z + delta.z, rf.bounds);
      if (Math.hypot(cx - p.x - delta.x, cz - p.z - delta.z) > 1e-6) clampHits++;
      delta.x = cx - p.x; delta.z = cz - p.z;
      if (mode === 'landing' && overWater(water, cx, cz)) {
        const shown = surface(cx, cz, p.y, 300);
        const hover = waterHoverFeet(water, cx, cz, shown?.point.y ?? null);
        if (hover !== null) { overWaterFrames++; delta.y = guardDescent(delta.y, p.y - .905, hover, FLIGHT_TUNING.climbSpeed * dt); }
      }
      const terrainY = groundAt(p.x, p.z);
      delta.y = Math.min(delta.y, Math.max(0, terrainY + .905 + FLIGHT_TUNING.maxHeightAboveTerrain - p.y));
      flyCtl.computeColliderMovement(player, delta);
      const mv = flyCtl.computedMovement(), supported = characterSupported(flyCtl, p.y, requested.y);
      body.setNextKinematicTranslation({ x: p.x + mv.x, y: p.y + mv.y, z: p.z + mv.z }); world.step();
      if (requested.y < -.1 && supported) landed = true;
    }
    const e = body.translation();
    return { landed, feet: +(e.y - .905).toFixed(2), end: [+e.x.toFixed(1), +e.z.toFixed(1)], overWater: water.isWater(e.x, e.z), overWaterFrames, clampHits };
  };
  // Cross the river by air: from the downtown bank (Seaholm) to Auditorium Shores, low over the water.
  const across = fly({ x: -1500, feet: -20, z: 2290 }, 20, 'flying', [-1520, 2520]);
  const lawn = fly({ x: -1560, feet: 10, z: 2520 }, 15, 'landing');
  const riverHover = fly({ x: -1450, feet: 0, z: 2400 }, 12, 'landing');
  const pondHover = fly({ x: pc[0], feet: pond.surfaceY + 25, z: pc[1] }, 12, 'landing');
  const roof = fly({ x: pm.centre[0], feet: pm.plateau + 20, z: pm.centre[1] }, 12, 'landing');
  check('flight: crosses the river reach from the downtown bank to Auditorium Shores (no clamp), lands on the lawn and on the Palmer roof, hovers over the lake and over Liz Carpenter Pond (never lands on water)',
    across.end[1] > 2480 && across.clampHits === 0 && lawn.landed && !lawn.overWater && !riverHover.landed && riverHover.feet >= dtw.bedTop + 1.3 && riverHover.overWaterFrames > 30
      && !pondHover.landed && pondHover.feet >= pond.surfaceY + POND_BED_CLEARANCE + 1.3 && roof.landed && roof.feet > pm.ground + 6,
    { across, lawn, riverHover, pondHover, pondSurface: pond.surfaceY, roof });
  let clampIllegal = 0;
  const cr = seeded(9);
  for (let i = 0; i < 400; i++) {
    const x = m.rect.xmin - 100 + cr() * (m.rect.xmax - m.rect.xmin + 200), z = m.rect.zmin - 100 + cr() * (m.rect.zmax - m.rect.zmin + 200);
    const [cx, cz] = clampToWorld(bounds, null, downtown.bounds, x, z, rf.bounds);
    if (!(rf.bounds.legal(cx, cz, 1.9) || downtown.bounds.legal(cx, cz, 1.9) || rf.bounds.contains(cx, cz))) clampIllegal++;
  }
  const mb = mapBounds(bounds, null, downtown.bounds, rf.bounds);
  check('flight clamp always returns a legal point; map extent covers the riverfront', clampIllegal === 0 && mb[0] <= rf.bounds.box.xmin && mb[3] >= rf.bounds.box.zmax, { clampIllegal, mapBounds: mb });

  // ---------------------------------------------------------------- 7. travel
  const region = combineTravelRegions([rf.travelRegion, downtown.travelRegion]);
  const requests: Record<string, Point> = {
    'Auditorium Shores lawn': [-1560, 2520], 'Doug Sahm Hill': hill, 'Willie Wells Field': [-1650, 2760], 'Vic Mathias Shores': [-1235, 2640],
    'Pfluger south landing': m.places.find(p => p.key === 'pfluger-south')!.p, 'river (water click)': [-1450, 2400], 'Liz Carpenter Pond (water click)': pc,
    'Palmer hall (building click)': pm.centre, 'west of Lamar (outside)': [-1990, 2450],
  };
  const travel: Record<string, unknown> = {};
  let travelOk = true;
  for (const [name, req] of Object.entries(requests)) {
    const cands = travelCandidates(campus, req, region);
    let landing: THREE.Vector3 | null = null, tried = 0;
    for (const c of cands) { tried++; landing = travelLanding(world, player, c, groundAt(...c), surface, undefined, travelProbe(campus, c)); if (landing) break; }
    const off = landing ? Math.hypot(landing.x - req[0], landing.z - req[1]) : null;
    const onLand = landing ? !water.isWater(landing.x, landing.z) && (inLand(landing.x, landing.z) || downtown.bounds.legal(landing.x, landing.z, 1.9)) : null;
    travel[name] = { candidates: cands.length, tried, landing: landing?.toArray().map(v => +v.toFixed(1)) ?? null, offset: off && +off.toFixed(1), onLand };
    if (name.includes('outside')) { if (landing && off! < 40) travelOk = false; continue; }
    if (!(landing && onLand && off! < 80 && landing.y - .905 > W + .2)) travelOk = false;
  }
  check('map travel: lands outdoors on land at park destinations; water and building clicks resolve to the nearest safe shore/lawn; nothing west of Lamar',
    travelOk && !outdoorPoint(campus, [-1450, 2400], region) && !outdoorPoint(campus, pc, region), travel);

  // Review shots: unique ids (also across the other shot lists), resolvable, cameras above the ground they were authored on,
  // not inside water or a model footprint.
  const others = new Set([...CAMERA_SHOTS, ...EXTENSION_SHOTS, ...DOWNTOWN_SHOTS, ...WEST_CAMPUS_SHOTS].map(q => q.id));
  const shotRows = RIVERFRONT_SHOTS.map(q => {
    const [x, y, z] = q.position, g = down(x, z, y, notMe) ?? -Infinity, fp = geometry.footprints.some(f => pointIn([x, z], f[0] as Point[]));
    return { id: q.id, resolvable: findShot(q.id) === q, aboveGround: +(y - g).toFixed(2), inFootprint: fp,
      overWater: q.kind === 'street' && water.isWater(x, z) && !q.id.includes('deck') };
  });
  check('review shots: 10 riverfront poses, unique, resolvable, above ground, not in water or inside a model',
    shotRows.length >= 10 && new Set(shotRows.map(r => r.id)).size === shotRows.length && shotRows.every(r => r.resolvable && !others.has(r.id) && r.aboveGround > 1.5 && !r.inFootprint && !r.overWater), shotRows);

  // ---------------------------------------------------------------- 8. trees, LOD, revert, disposal
  const ownedTrees = overlay.capsules.length;
  check('trees: owned south-bank downtown trees get trunk capsules; west-of-seam LiDAR trees use campus forms as decor (never ground)',
    ownedTrees > 100 && !!rf.trees && rf.decor.children.includes(rf.trees.group) && !rf.group.children.includes(rf.trees.group) && rf.treeTrunks.length > 10,
    { ownedTreeCapsules: ownedTrees, westTrees: rf.treePlan?.placed.length, westTrunks: rf.treeTrunks.length });
  const disposeCount = new Map<THREE.BufferGeometry, number>();
  const watch = (g: THREE.BufferGeometry) => { if (!disposeCount.has(g)) { disposeCount.set(g, 0); g.addEventListener('dispose', () => disposeCount.set(g, disposeCount.get(g)! + 1)); } };
  for (const root of [rf.group, rf.decor]) root.traverse(o => { const mm = o as THREE.Mesh; if (mm.isMesh && !(o as THREE.InstancedMesh).isInstancedMesh && !(o as THREE.BatchedMesh).isBatchedMesh) watch(mm.geometry); });
  const swapped = downtown.terrainMeshes.filter((tm, i) => tm.mesh.geometry !== before[i]).map(tm => tm.mesh.geometry);
  swapped.forEach(watch);
  rf.dispose(); rf.dispose();
  const restored = downtown.terrainMeshes.every((tm, i) => tm.mesh.geometry === before[i]) && dt.terrain.excluded === null
    && repRanges.every((r, i) => { const a = r.mesh.geometry.getAttribute('position').array as Float32Array; return a.slice(r.start * 9, (r.start + r.count) * 9).every((v, k) => v === repSaved[i][k]); });
  const counts = [...disposeCount.values()];
  check('dispose: overlay reverted (downtown terrain, placeholders and backdrop restored exactly); every riverfront geometry released once; idempotent; queries null',
    restored && counts.length > 0 && counts.every(n => n === 1) && rf.height(-1560, 2520) === null && !rf.contains(-1560, 2520) && !rf.isWater(-1450, 2400),
    { restored, geometries: counts.length, notOnce: counts.filter(n => n !== 1).length, swappedReleased: swapped.length });
  {
    const i = overlay.hiddenTrees[0], t = downtown.treePlan!.placed[i], cam = new THREE.PerspectiveCamera();
    cam.position.set(t.x + 5, t.y + 2, t.z); cam.updateMatrixWorld(); downtown.trees!.update(cam);
    const v = downtown.trees!.instanceVisible(i);
    check('rollback: reverting the overlay shows the pond tree again (near LOD drawn) and clears the hide mask', !downtown.trees!.isHidden(i) && v[0] && v[1], { visible: v });
  }
  const labels = (() => { const d3 = makeDowntown(), r3 = new Riverfront(buildRiverfrontGeometry(decodeRiverfront(rfBuf(), d3.source.data)), mats, 0);
    const l = r3.mapLabels(); r3.dispose(); const after = r3.mapLabels(); d3.dispose(); return { l, after }; })();
  check('map labels: exactly "Auditorium Shores" and "Butler Park", placed on the park land; none after dispose',
    labels.l.length === 2 && labels.l.map(q => q.name).sort().join() === 'Auditorium Shores,Butler Park' && MAP_LABELS.length === 2
      && labels.l.every(q => pointIn(q.p as Point, m.land[0] as Point[])) && labels.after.length === 0, labels);
  downtown.dispose(); bg.dispose();
  // A fresh pair: the riverfront also validates and builds against a newly decoded downtown (no hidden state).
  const d2 = makeDowntown();
  const ok2 = (() => { try { decodeRiverfront(rfBuf(), d2.source.data); return true; } catch { return false; } })();
  d2.dispose();
  check('re-decodes against a fresh downtown instance', ok2, ok2);
  return { pass: results.every(r => r.pass), results };
}

function pointIn([x, z]: Point, ring: Point[], margin = 0) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  if (!inside || margin === 0) return inside;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz;
    const t = L ? Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / L)) : 0;
    if (Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z) < Math.abs(margin)) return false;
  }
  return true;
}
