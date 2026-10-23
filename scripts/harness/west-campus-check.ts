// Focused West Campus pass check (west-campus extension + deep-west facade programme). Built by
// west-campus.vite.config.mjs, run by run-west-campus-check.mjs. Real runtime modules, shipped assets, Rapier; no browser.
// Root still owns the WebGL compile / screenshot / performance review.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { decodeDeepWest, SEAM_X } from '../../lib/campus/extension/deep-west/format';
import { buildDeepWestGeometry, DeepWest, DEEP_WEST_SHADER_EDITS } from '../../lib/campus/extension/deep-west';
import { worldBoundaryWalls } from '../../lib/campus/extension/deep-west/bounds';
import { applyFacadeShader } from '../../lib/campus/context/materials';
import { validateWestCampus, WestCampusAssetError, UNION_KEY, VILLAS_KEY } from '../../lib/campus/extension/west-campus/format';
import { WestCampus, buildWestCampusTowers, towerFootprints, type PreparedWestCampus } from '../../lib/campus/extension/west-campus';
import { UNION_PLAN, frameOf } from '../../lib/campus/extension/west-campus/towers';
import { Footprints } from '../../lib/campus/vegetation/tree-fit';
import { treeForms } from '../../lib/campus/vegetation/oak-forms';
import { headlessImpostors } from '../../lib/campus/vegetation/tree-batches';
import { Terrain } from '../../lib/campus/terrain';
import { combineTravelRegions, travelCandidates, travelLanding, travelProbe } from '../../lib/campus/map-travel';
import { CAMERA_SHOTS, EXTENSION_SHOTS, DOWNTOWN_SHOTS, WEST_CAMPUS_SHOTS, findShot } from '../../lib/campus/render/camera-shots';
import type { CampusData, Point, TerrainData } from '../../lib/campus/types';

type Result = { name: string; pass: boolean; detail: unknown };
const inRing = ([x, z]: Point, ring: Point[]) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; }
  return c;
};

export async function run(root: string) {
  const results: Result[] = [];
  const check = (name: string, pass: boolean, detail: unknown) => { results.push({ name, pass, detail }); };
  const read = (p: string) => readFileSync(resolve(root, p));
  const campus = JSON.parse(read('public/data/campus.json').toString()) as CampusData;
  const terrain = new Terrain(JSON.parse(read('public/data/terrain.json').toString()) as TerrainData);

  // ---------------------------------------------------------------- 1. asset + fail closed
  const assetText = read('public/assets/extension/west-campus-v1.json').toString();
  const asset = JSON.parse(assetText);
  const { data, trees } = validateWestCampus(asset, null);
  const union = data.towers.find(t => t.key === UNION_KEY)!, villas = data.towers.find(t => t.key === VILLAS_KEY)!;
  check('asset validates; exact tower set; tree records', trees.length > 1000, { bytes: assetText.length, trees: trees.length, counts: data.trees.counts });
  const rejects = (label: string, mutate: (d: Record<string, unknown>) => void) => {
    const d = JSON.parse(assetText); mutate(d);
    try { validateWestCampus(d, null); check(`fail closed: ${label}`, false, 'accepted'); } catch (e) { check(`fail closed: ${label}`, e instanceof WestCampusAssetError, (e as Error).message); }
  };
  rejects('extra tower', d => { (d.towers as unknown[]).push({ ...(d.towers as Record<string, unknown>[])[0], key: 'x' }); });
  rejects('inconsistent top', d => { (d.towers as { topY: number }[])[0].topY += 1; });
  rejects('clockwise ring', d => { (d.towers as { ring: Point[] }[])[1].ring.reverse(); });
  rejects('non-finite tree', d => { (d.trees as { data: unknown[] }).data[3] = null; });
  check('Union height basis: OSM community estimate 97.536 m (City 2023 89.79 m kept as an older bound), crown inside',
    Math.abs(union.heightM - 97.536) < 1e-6 && Math.abs((union.cityHeightM ?? 0) - 89.792) < .01 && union.cityTopY! < union.topY && /COMMUNITY-SOURCED/.test(union.height),
    { baseY: union.baseY, topY: union.topY, cityTopY: union.cityTopY, height: union.height });
  check('Villas height basis: published 312 ft = 95.1 m overall', Math.abs(villas.heightM - 95.1) < 1e-6 && /312 ft/.test(villas.height), { baseY: villas.baseY, topY: villas.topY });

  // ---------------------------------------------------------------- 2. deep-west extension (real decode) + facade programme
  const offlineBytes = gunzipSync(read('public/assets/campus/offline-terrain-61.bin.gz'));
  const ov = new DataView(offlineBytes.buffer, offlineBytes.byteOffset, offlineBytes.byteLength);
  const offlinePositions = new Float32Array(offlineBytes.buffer.slice(offlineBytes.byteOffset + 20, offlineBytes.byteOffset + 20 + ov.getUint32(8, true) * 12));
  const dwRaw = gunzipSync(read('public/assets/extension/deep-west-v1.bin.gz'));
  const dwData = decodeDeepWest(dwRaw.buffer.slice(dwRaw.byteOffset, dwRaw.byteOffset + dwRaw.byteLength) as ArrayBuffer, offlinePositions);
  const dwGeom = buildDeepWestGeometry(dwData);
  const stub = (name: string) => Object.assign(new THREE.MeshStandardMaterial(), { name });
  const ctxMats = new Map<string, THREE.Material>();
  const deepWest = new DeepWest(dwGeom, { terrain: stub('grass'), asphalt: stub('asphalt'), concrete: stub('concrete'),
    context: key => { if (!ctxMats.has(key)) ctxMats.set(key, stub(`Local context ${key}`)); return ctxMats.get(key); } }, 0);
  const wallTris = dwGeom.parts.filter(p => p.material.startsWith("wall:")).reduce((s, p) => s + p.geometry.index!.count / 3, 0);
  const allTris = dwGeom.parts.reduce((s, p) => s + (p.geometry.index ? p.geometry.index.count : p.geometry.getAttribute('position').count) / 3, 0);
  // Facade codes in use: glazed ground storeys (type 3), accent piers (vertex-coloured strips without openings), tints.
  const codes = new Map<number, number>();
  for (const p of dwGeom.parts) { const w = p.geometry.getAttribute('aWin'); if (!w) continue; for (let i = 0; i < w.count; i += 4) { const c = Math.round(w.getW(i)); codes.set(c, (codes.get(c) ?? 0) + 1); } }
  const types = new Set([...codes.keys()].filter(c => c > 0).map(c => c % 8)), tints = new Set([...codes.keys()].filter(c => c > 0).map(c => Math.floor(c / 512)));
  check('deep-west facade programme: punched / ribbon / storefront types, 4 glass tints, bounded triangles (baseline 3.19 M scene)',
    types.has(1) && types.has(2) && types.has(3) && tints.size === 4 && wallTris < 120000 && dwGeom.parts.length === deepWest.colliderGeometries.length,
    { types: [...types], tints: [...tints], wallTriangles: wallTris, extensionTriangles: allTris, drawCalls: dwGeom.parts.length });
  const shader = THREE.ShaderLib.physical.fragmentShader;
  const m = new THREE.MeshStandardMaterial(); applyFacadeShader(m);
  const sh = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: shader } as unknown as THREE.WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(sh, undefined as unknown as THREE.WebGLRenderer);
  const anchors = DEEP_WEST_SHADER_EDITS.map(([from]) => sh.fragmentShader.split(from).length - 1);
  let patched = sh.fragmentShader; for (const [from, to] of DEEP_WEST_SHADER_EDITS) patched = patched.replace(from, to);
  const glassAt = patched.indexOf('float dwTint'), declAt = patched.indexOf('float ctxGlass = 0.0;');
  check('deep-west glass shader edits: every anchor present exactly once; tint code after ctxGlass is declared (structure only, not a GLSL compile)',
    anchors.every(n => n === 1) && declAt > 0 && glassAt > declAt && (patched.match(/\{/g)!.length === patched.match(/\}/g)!.length), { anchors, declAt, glassAt });
  const profiled = dwData.meta.buildings.filter(b => ['coa-2023:726333', 'coa-2023:615176'].includes(b.key)).map(b => b.key);
  check('profiled D40 towers present (The Standard 726333, 615176)', profiled.length === 2, profiled);

  // ---------------------------------------------------------------- 3. physics world: offline terrain + deep west + walls + towers
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -24, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.trimesh(offlinePositions, Uint32Array.from({ length: offlinePositions.length / 3 }, (_, i) => i)).setFriction(.8));
  for (const g of deepWest.colliderGeometries) world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(g.attributes.position.array), g.index ? new Uint32Array(g.index.array) : Uint32Array.from({ length: g.attributes.position.count }, (_, i) => i)).setFriction(.8));
  const bounds = campus.bounds.slice(); bounds[3] = Math.max(bounds[3], 1536);
  for (const [cx, cz, hx, hz] of worldBoundaryWalls(bounds, deepWest.bounds)) world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 150, hz).setTranslation(cx, 0, cz));
  world.step();
  const ground = (x: number, z: number) => deepWest.height(x, z) ?? terrain.height(x, z);
  const forms = treeForms();
  const prepared: PreparedWestCampus = { data, trees, bytes: assetText.length, fetchMs: 0 };
  const before = world.colliders.len();
  const vegMats = { bark: stub('bark'), foliage: stub('foliage'), textures: [] };
  const wc = new WestCampus({ prepared, physics: world, ground, deepWest: { bounds: deepWest.bounds, height: (x, z) => deepWest.height(x, z) },
    vegetation: { forms, materials: vegMats, impostors: headlessImpostors(forms) } });
  world.step();
  const added = world.colliders.len() - before;

  // ---------------------------------------------------------------- 4. towers
  const solids = wc.group.children as THREE.Mesh[], detail = wc.decor.children.filter(c => c instanceof THREE.Mesh) as THREE.Mesh[];
  const solidPos = solids.flatMap(s => [...(s.geometry.getAttribute('position').array as Float32Array)]);
  check('render = collision: solid tower meshes are exactly the collider triangles; detail/trees are decor (not ground roots)',
    solidPos.length === wc.colliderPositions.length && solidPos.every((v, i) => v === wc.colliderPositions[i]) && solids.every(s => s.userData.westCampus.role === 'solid')
    && detail.every(d => d.userData.westCampus.role === 'detail') && !wc.group.getObjectByName(wc.trees!.group.name),
    { solidTriangles: solidPos.length / 9, colliderTriangles: wc.colliderPositions.length / 9, detailMeshes: detail.length });
  const solidTop = (ring: Point[]) => { let t = -Infinity; for (let i = 0; i < solidPos.length; i += 3) if (inRing([solidPos[i], solidPos[i + 2]], ring) || ringNear([solidPos[i], solidPos[i + 2]], ring, .05)) t = Math.max(t, solidPos[i + 1]); return t; };
  const uTop = solidTop(union.ring), vTop = solidTop(villas.ring);
  check('tower tops = evidence tops (overall height counts crown / plant inside it, nothing above)', Math.abs(uTop - union.topY) < .01 && Math.abs(vTop - villas.topY) < .01,
    { union: { solidTop: uTop, topY: union.topY, cityTopY: union.cityTopY }, villas: { solidTop: vTop, topY: villas.topY } });
  // Detail stays within 0.65 m of the footprints and below the tops.
  let detailOut = 0;
  for (const d of detail.filter(x => x.userData.westCampus)) {
    if (wc.trees && d.parent !== wc.decor) continue;
    const p = d.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const q: Point = [p.getX(i), p.getZ(i)], y = p.getY(i);
      const ok = data.towers.some(t => (inRing(q, t.ring) || ringNear(q, t.ring, .65)) && y <= t.topY + .05);
      if (!ok) detailOut++;
    }
  }
  check('facade detail within 0.65 m of the footprints and under the tops (visual skin only)', detailOut === 0, { detailOut, detailTriangles: (wc.stats as { detailTriangles: number }).detailTriangles });
  // H plan: open courts north (W 24th) and south of the bar, solid bar and legs, podium on the whole City ring.
  const f = frameOf(union.ring), L = (a: number, b: number): Point => [f.c[0] + f.u[0] * a + f.v[0] * b, f.c[1] + f.u[1] * a + f.v[1] * b];
  const down = (p: Point, filter?: (c: RAPIER.Collider) => boolean) => { const h = world.castRay(new RAPIER.Ray({ x: p[0], y: 250, z: p[1] }, { x: 0, y: -1, z: 0 }), 400, true, undefined, undefined, undefined, undefined, filter); return h ? 250 - h.timeOfImpact : null; };
  const podiumTop = union.baseY + UNION_PLAN.podium, A2 = f.hu - UNION_PLAN.endInset - UNION_PLAN.leg;
  const probes = { northCourt: down(L(0, -f.hv + 6)), southCourt: down(L(0, f.hv - 6)), bar: down(L(A2 - 3, 0)), westLeg: down(L(-f.hu + 14, -10)), eastLeg: down(L(f.hu - 14, 10)) };
  check('Union H plan: courts open to the podium deck north (W 24th) and south of the bar; legs and bar reach the roof',
    Math.abs(probes.northCourt! - podiumTop) < .8 && Math.abs(probes.southCourt! - podiumTop) < .8 && [probes.bar, probes.westLeg, probes.eastLeg].every(y => y! > union.topY - UNION_PLAN.mech - .05),
    { probes, podiumTop, frame: { u: f.u, hu: f.hu, hv: f.hv } });
  const vnorm = Math.hypot(f.v[0], f.v[1]);
  check('Union frame: v points south (+z), so the -v side is W 24th (north)', f.v[1] / vnorm > .99 && f.u[0] > .99, { u: f.u, v: f.v });
  // Street glazing on the north (W 24th) and the Rio Grande faces only.
  const shopNormals: Record<string, number> = { north: 0, south: 0, east: 0, west: 0 };
  for (const d of detail.filter(x => x.userData.westCampus?.material === 'glass')) {
    const p = d.geometry.getAttribute('position'), n = d.geometry.getAttribute('normal');
    for (let i = 0; i < p.count; i += 3) {
      const q: Point = [p.getX(i), p.getZ(i)];
      if (Math.abs(n.getY(i)) > .5) continue;
      const t = data.towers.find(tt => ringNear(q, tt.ring, .2)); if (!t) continue;
      if (p.getY(i) > ground(q[0], q[1]) + 5) continue;
      const nx = n.getX(i), nz = n.getZ(i);
      shopNormals[nz < -.7 ? 'north' : nz > .7 ? 'south' : nx > .7 ? 'east' : 'west']++;
    }
  }
  check('ground-storey glazing faces W 24th (north) and Rio Grande (Union east / Villas west), never the south lots', shopNormals.north > 0 && shopNormals.south === 0 && shopNormals.east > 0 && shopNormals.west > 0, shopNormals);
  // No overlap with existing buildings (old Cain & Abel's 614399 is demolished and excluded by b12).
  const overlaps: string[] = [];
  for (const t of data.towers) {
    for (const b of campus.buildings) if (b.id !== 614399 && b.rings[0].some(p => inRing(p as Point, t.ring) && !ringNear(p as Point, t.ring, .2))) overlaps.push(`${t.key}~campus:${b.id}`);
    for (const b of dwData.meta.buildings) if (b.rings[0].some(p => inRing(p as Point, t.ring) && !ringNear(p as Point, t.ring, .2))) overlaps.push(`${t.key}~${b.key}`);
  }
  check('no duplicated buildings: no campus.json or deep-west vertex inside the new rings', overlaps.length === 0, overlaps);
  // Campus canopy / foreground exclusion via the vegetation footprints.
  const canopy = JSON.parse(read('public/data/derived/canopy-trees.json').toString()).trees as { x: number; z: number }[];
  const inside = canopy.filter(t => data.towers.some(r => inRing([t.x, t.z], r.ring)));
  const fp = new Footprints([...campus.buildings, ...towerFootprints(prepared, true)]);
  check('campus LiDAR crowns inside the new towers are rejected by the vegetation footprints', inside.length > 0 && inside.every(t => fp.contains(t.x, t.z)), { inside: inside.length });

  // ---------------------------------------------------------------- 5. walking, travel, parity
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(-740, 50, -207));
  const player = world.createCollider(RAPIER.ColliderDesc.capsule(.54, .34).setFriction(0), body);
  const controller = world.createCharacterController(.025);
  controller.enableAutostep(.32, .2, false); controller.enableSnapToGround(.38);
  controller.setMaxSlopeClimbAngle(Math.PI * .25); controller.setMinSlopeSlideAngle(Math.PI * .28);
  const place = (x: number, z: number) => { const y = ground(x, z) + .92; body.setTranslation({ x, y, z }, true); body.setNextKinematicTranslation({ x, y, z }); world.step(); };
  const walk = (dx: number, dz: number, seconds: number, speed = 8) => {
    let vy = 0;
    for (let i = 0; i < seconds * 60; i++) {
      vy = Math.max(vy - 24 / 60, -30);
      controller.computeColliderMovement(player, { x: dx * speed / 60, y: vy / 60, z: dz * speed / 60 });
      if (controller.computedGrounded()) vy = 0;
      const mv = controller.computedMovement(), p = body.translation();
      body.setNextKinematicTranslation({ x: p.x + mv.x, y: p.y + mv.y, z: p.z + mv.z }); world.step();
    }
    const e = body.translation(); return [+e.x.toFixed(2), +e.y.toFixed(2), +e.z.toFixed(2)];
  };
  place(-735, -207); const west = walk(-1, 0, 8); const east = walk(1, 0, 8);
  check('W 24th St stays walkable across the seam past Union (north face z~-200)', west[0] < -790 && east[0] > -745, { west, east });
  place(-777, -215); const intoUnion = walk(0, 1, 4, 6);
  place(-697, -205); const intoVillas = walk(0, 1, 4, 6);
  check('new towers are solid (a capsule walking at them stops outside)', !inRing([intoUnion[0], intoUnion[2]], union.ring) && !inRing([intoVillas[0], intoVillas[2]], villas.ring), { intoUnion, intoVillas });
  // Render/collider parity on random columns over both footprints.
  const raycaster = new THREE.Raycaster();
  let parity = 0, n = 0;
  for (let i = 0; i < 120; i++) {
    const t = data.towers[i % 2], tf = frameOf(t.ring);
    const p: Point = [tf.c[0] + (Math.sin(i * 12.9) * .5) * tf.hu * 1.9 * tf.u[0] + (Math.cos(i * 7.3) * .5) * tf.hv * 1.9 * tf.v[0], tf.c[1] + (Math.sin(i * 12.9) * .5) * tf.hu * 1.9 * tf.u[1] + (Math.cos(i * 7.3) * .5) * tf.hv * 1.9 * tf.v[1]];
    if (!inRing(p, t.ring)) continue;
    raycaster.set(new THREE.Vector3(p[0], 250, p[1]), new THREE.Vector3(0, -1, 0));
    const vis = raycaster.intersectObjects(solids, false)[0], phys = down(p, c => c.handle !== player.handle);
    if (!vis || phys === null) { parity = Infinity; continue; }
    parity = Math.max(parity, Math.abs(vis.point.y - phys)); n++;
  }
  check('render/collider parity over the towers (first visible solid hit == Rapier hit)', parity < 1e-3 && n > 40, { samples: n, maxAbs: parity });
  // Travel: clicks on the towers land on nearby outdoor ground, never inside or on the new roofs.
  const visibleGround = [...deepWest.group.children as THREE.Mesh[], ...solids, new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(offlinePositions, 3)))];
  for (const v of visibleGround) v.updateMatrixWorld(true);
  const surface = (x: number, z: number, fromY: number, distance: number) => {
    raycaster.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0)); raycaster.far = distance;
    const hit = raycaster.intersectObjects(visibleGround, false).find(h => h.face && h.face.normal.y > .5) ?? null; raycaster.far = Infinity; return hit;
  };
  const region = combineTravelRegions([wc.travelRegion, deepWest.travelRegion]);
  const clicks: Record<string, Point> = { unionCentre: L(0, 0), unionWestHalf: L(-f.hu + 10, 0), unionEastHalf: L(f.hu - 8, 5), villasCentre: frameOf(villas.ring).c };
  const travel: Record<string, unknown> = {};
  let travelOk = true;
  for (const [k, req] of Object.entries(clicks)) {
    const cands = travelCandidates(campus, req, region);
    let landing: THREE.Vector3 | null = null;
    const tried: unknown[] = [];
    for (const c of cands) {
      const outcome = { enclosed: false };
      landing = travelLanding(world, player, c, ground(...c), surface, outcome, travelProbe(campus, c));
      if (tried.length < 12) { const hit = surface(c[0], c[1], ground(...c) + 5, 12); tried.push({ c: c.map(v => +v.toFixed(1)), ok: !!landing, enclosed: outcome.enclosed, surf: hit ? +hit.point.y.toFixed(2) : null, obj: hit?.object.name ?? null, g: +ground(...c).toFixed(2) }); }
      if (landing) break;
    }
    const lp: Point | null = landing ? [landing.x, landing.z] : null;
    const ok = !!lp && !data.towers.some(t => inRing(lp, t.ring)) && landing!.y - .905 < ground(lp[0], lp[1]) + 1.6 && Math.hypot(lp[0] - req[0], lp[1] - req[1]) < 45;
    travelOk &&= ok;
    travel[k] = { requested: req.map(v => +v.toFixed(1)), candidates: cands.length, tried: ok ? undefined : tried, landing: landing?.toArray().map(v => +v.toFixed(2)) ?? null, ok };
  }
  check('map travel on Union (centre, west half x<-760, east half) and Villas lands on nearby outdoor ground', travelOk, travel);

  // ---------------------------------------------------------------- 6. Deep West trees
  const plan = wc.treePlan!;
  const trunkBad = plan.placed.filter(t => t.x >= -762 || dwData.meta.buildings.some(b => inRing([t.x, t.z], b.rings[0] as Point[])) || data.towers.some(r => inRing([t.x, t.z], r.ring)));
  const groundErr = plan.placed.reduce((m2, t) => Math.max(m2, Math.abs(t.y + .02 - deepWest.height(t.x, t.z)!)), 0);
  const aerial = new THREE.PerspectiveCamera(); aerial.position.set(-700, 92, 60); aerial.updateMatrixWorld(true);
  wc.trees!.update(aerial, true);
  const lod = wc.trees!.counts.slice(), lodTris = wc.trees!.triangleEstimate();
  check('Deep West canopy: x < -762, no trunk in a footprint, trunks on the extension terrain, one trunk capsule each, LOD-bounded',
    plan.placed.length === trees.length && trunkBad.length === 0 && groundErr < 1e-3 && plan.capsules.length === plan.placed.length && lodTris.reduce((a, b) => a + b, 0) < 1.2e6,
    { placed: plan.placed.length, reducedScale: plan.reduced, trunkBad: trunkBad.length, groundErr, lodCounts: lod, lodTriangles: lodTris, aerialPose: [-700, 92, 60] });
  check('trees and facade detail are scene decor, not landing floors (no collider other than trunk capsules + one tower trimesh)',
    added === 1 + plan.capsules.length && wc.decor.children.includes(wc.trees!.group), { addedColliders: added, capsules: plan.capsules.length });

  // ---------------------------------------------------------------- 7. shots, budget, disposal
  const ids = new Set(WEST_CAMPUS_SHOTS.map(s => s.id));
  const shotRows = WEST_CAMPUS_SHOTS.map(s => {
    const g = ground(s.position[0], s.position[2]);
    const street = s.kind === 'street';
    return { id: s.id, kind: s.kind, resolvable: findShot(s.id) === s, groundErr: +Math.abs(s.groundY - g).toFixed(3), eye: +(s.position[1] - g).toFixed(2),
      inFootprint: [...campus.buildings.map(b => b.rings[0] as Point[]), ...dwData.meta.buildings.map(b => b.rings[0] as Point[]), ...data.towers.map(t => t.ring)].some(r => inRing([s.position[0], s.position[2]], r)), street };
  });
  const oldIds = new Set([...CAMERA_SHOTS, ...EXTENSION_SHOTS, ...DOWNTOWN_SHOTS].map(s => s.id));
  check('8-12 new fixed QA shots (street + aerial), resolvable, grounded, outside footprints; old shot sets unchanged',
    ids.size === WEST_CAMPUS_SHOTS.length && ids.size >= 8 && ids.size <= 12 && shotRows.every(r => r.resolvable && r.groundErr < .08 && !r.inFootprint && (r.street ? Math.abs(r.eye - 1.75) < .1 : r.eye > 50))
    && shotRows.some(r => r.street) && shotRows.some(r => !r.street) && ![...ids].some(i => oldIds.has(i)) && EXTENSION_SHOTS.length === 16,
    shotRows);
  const st = wc.stats as Record<string, number>;
  check('budget: tower draws <= 6, tower triangles < 160 k, trees 3 draws, asset < 200 kB',
    st.towerDraws <= 6 && st.solidTriangles + st.detailTriangles < 160000 && assetText.length < 200000, { towerDraws: st.towerDraws, solid: st.solidTriangles, detail: st.detailTriangles, assetBytes: assetText.length });
  const disposed = new Set<THREE.BufferGeometry>();
  for (const s of [...solids, ...detail]) s.geometry.addEventListener('dispose', () => disposed.add(s.geometry));
  const n0 = world.colliders.len();
  wc.dispose(); wc.dispose();
  check('dispose: removes every added collider and geometry once, detaches groups; idempotent',
    n0 - world.colliders.len() === added && disposed.size === solids.length + detail.length && !wc.group.parent && !wc.decor.parent, { removed: n0 - world.colliders.len(), geometries: disposed.size });
  // Without the deep-west extension only Villas is built (Union crosses the seam).
  const solo = buildWestCampusTowers(data, (x, z) => terrain.height(x, z), false);
  check('fallback without deep west: only Villas on 24th (never geometry west of the seam)', solo.towers.length === 1 && solo.towers[0].key === VILLAS_KEY
    && [...solo.kit.solid.values()].every(b => b.pos.every((v, i) => i % 3 !== 0 || v > SEAM_X)), solo.towers.map(t => t.key));
  deepWest.dispose();
  world.free();
  return { pass: results.every(r => r.pass), results };
}

function ringNear([x, z]: Point, ring: Point[], d: number) {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz;
    const t = l ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l)) : 0;
    if (Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z) <= d) return true;
  }
  return false;
}
