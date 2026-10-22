// Headless checks owned by block b01-eer (run by scripts/harness/run-block-checks.mjs).
// They measure the BUILT scene (physics colliders), never JSON numbers against each other:
//  1. roof Y of every corrected mass vs the 2017 LiDAR tier Y in the same campus-Y datum
//     (roofs-lidar: campus Y = NAVD88 - 165, terrain residual 0.02 m), ACS vs its official-floor estimate;
//  2. ECJ / EER plan edges vs the official UT GIS polygons (engineering s/t frame);
//  3. no solid within 2.1 m above any engineering route / court walk (no wall or roof over a route);
//  4. map travel to EER / PMA lands outdoors (not enclosed, not on the screened court deck);
//  5. PAT, GLT, ACS are generated (the City rings used to suppress PAT/GLT entirely).
// Round 2:
//  6. EER court walls: visible glass fraction of the inner elevations above the deck (render-mesh rays,
//     first hit material) and visible = physical on those walls (collider ray distance);
//  7. recess depths measured by horizontal collider rays: PMA tower ribs vs recessed glass, ECJ ribs vs
//     glass, PMA east wing blank-face fraction;
//  8. Speedway east-edge seam (b03-r4): engineering-side elevation at the shared brick edge vs the published
//     engineeringSpeedwayEdge() profile and the terrain just west of the edge;
//  9. 548643 roof vs LiDAR (report).
// Round 3 (Dean Keeton engineering bridge, OSM 25775199), all in the installed scene:
// 10. deck/landings visual vs physics (<= 0.08 m), real ScooterClearance replay N->S and S->N at normal
//     acceleration to scooter speed (centre and near-edge lines, both landings, a turn and a mount),
//     steps <= 0.12 m, slopes <= 15 deg; the road carriageways and sidewalks underneath both ways;
//     flight landings above and below; a low flight under the span with the game's ground-follow probe;
//     underside headroom and the asphalt finish below; map travel reported (no bridge probe exists).
import * as THREE from 'three';
import type { BlockCheck } from './types';
import { ScooterClearance, SCOOTER_ENVELOPE } from '../../../lib/campus/scooter-clearance';
import { LocalGroundQuery } from '../../../lib/campus/local-ground-query';
import { findFlightLanding } from '../../../lib/campus/flight-landing';
import { RUN_SPEED, WALK_SPEED } from '../../../lib/campus/map-travel';
import { characterSupported } from '../../../lib/campus/character-support';
import { pmaBridgeCourt } from '../../../lib/campus/pma-local-podium';
import { SCOOTER_TUNING } from '../../../lib/campus/scooter-motion';
import { bridgeWorld, bridgeDeckY, bridgeUV, DEAN_BRIDGE } from '../../../lib/campus/blocks/b01-eer/dean-keeton-bridge';
import { engineeringCourtPoint, engineeringCourtLocal } from '../../../lib/campus/engineering-courtyard';
import { engineeringSpeedwayEdge, speedwayNorthEastEdge } from '../../../lib/campus/engineering-courtyard';
import b01Context from '../../../lib/campus/blocks/b01-eer/context.json' with { type: 'json' };

const E = [1 / Math.hypot(1, 0.089), 0.089 / Math.hypot(1, 0.089)];
const xz = (s: number, t: number): [number, number] => [32.1 + s * E[0] - t * E[1], -252.35 + s * E[1] + t * E[0]];

export const check: BlockCheck = (scene) => {
  const { physics, RAPIER, player, plans, walkway, travel } = scene;
  const failures: string[] = [];
  const report: Record<string, unknown> = {};
  const down = { x: 0, y: -1, z: 0 }, up = { x: 0, y: 1, z: 0 };
  const top = (x: number, z: number) => {
    const h = physics.castRay(new RAPIER.Ray({ x, y: 200, z }, down), 400, true, undefined, undefined, player);
    return h ? 200 - h.timeOfImpact : null;
  };
  const topST = (s: number, t: number) => top(...xz(s, t));
  const belowScreen = (s: number, t: number) => { const [x, z] = xz(s, t); const h = physics.castRay(new RAPIER.Ray({ x, y: 37.5, z }, down), 40, true, undefined, undefined, player); return h ? 37.5 - h.timeOfImpact : null; };

  // 1. Roof Y vs measured LiDAR tier Y (same datum).
  type Target = [string, number, number, number, number, 'world' | 'st'];
  const targets: Target[] = [
    ['EER 715399 north tower roof (LiDAR 2125 m2 tier)', 144, -22, 45.0, 0.6, 'st'],
    // (130,21): clear of the measured rooftop plant (eer-dataset-pass; the old probe (144,22) is inside the south plant block).
    ['EER 715399 south tower roof (LiDAR 2025 m2 tier)', 130, 21, 45.0, 0.6, 'st'],
    // eer-dataset-pass: rooftop plant blobs and parapet edges in the 2017 DSM (derived/eer_roof_dsm.json).
    ['EER north tower rooftop plant (LiDAR blob P50, 104 m2)', 128, -18, 48.22, 0.6, 'st'],
    ['EER south tower rooftop plant (LiDAR blob P50, 79 m2)', 145, 23, 48.13, 0.6, 'st'],
    ['EER north tower west parapet (LiDAR edge Y46.1-46.3)', 104, -25, 46.2, 0.6, 'st'],
    ['EER south tower outer parapet (LiDAR edge Y46.1-46.3)', 140, 33.5, 46.2, 0.6, 'st'],
    ['EER court roof screen (LiDAR 1429 m2 tier)', 150.4, 3, 38.6, 0.6, 'st'],
    ['EER west entry terrace (LiDAR 156 m2 tier; ray from below the screen)', 108, 3, 12.5, 0.6, 'st'],
    ['EER north low podium (LiDAR 908 m2 tier)', 134, -46, 12.1, 0.6, 'st'],
    ['ECJ main roof (716056 LiDAR 1909 m2 tier)', 130, -65, 46.8, 0.6, 'st'],
    ['ECJ penthouse (716056 LiDAR 849 m2 tier)', 130, -80, 51.9, 0.6, 'st'],
    ['PMA east wing (716056 LiDAR 1115 m2 tier)', 60, -40, 51.1, 0.6, 'st'],
    ['PMA service core (716056 LiDAR 155 m2 tier)', 53, -70, 74.2, 0.6, 'st'],
    ['PAT 698987 main roof', 40, 50, 30.5, 0.6, 'st'],
    ['PAT 698987 upper tier', 40, 36, 35.1, 0.6, 'st'],
    ['ETC 506548 main roof', 120, -152, 40.7, 0.6, 'st'],
    ['ETC 506548 upper tier', 120, -180, 45.1, 0.6, 'st'],
    ['CPE 732885 main roof', 40, -230, 25.5, 0.6, 'st'],
    ['EER low south 655276 roof', 131, 52, 6.0, 0.6, 'st'],
  ];
  const roofs: Record<string, unknown>[] = [];
  for (const [label, a, b, want, tol, frame] of targets) {
    const y = label.includes('from below the screen') ? belowScreen(a, b) : frame === 'st' ? topST(a, b) : top(a, b);
    const residual = y === null ? null : +(y - want).toFixed(2);
    roofs.push({ label, targetY: want, builtY: y === null ? null : +y.toFixed(2), residual });
    if (residual === null || Math.abs(residual) > tol) failures.push(`${label}: built Y ${y} vs LiDAR Y ${want}`);
  }
  // PMA west tower (round 2: roof raised to the LiDAR tier, east edge to s48.1) and the east wing's
  // north extension around the core (LiDAR Y51.1 tier).
  for (const [label, a, b, want] of [['PMA west tower roof (716056 LiDAR 1354 m2 tier)', 25, -75, 68.1],
    ['PMA east wing north extension (LiDAR Y51.1 tier, north of the core)', 63, -78, 51.1],
    ['PMA east wing north extension east of the core (LiDAR Y51.1 tier)', 68, -66, 51.1]] as [string, number, number, number][]) {
    const y = topST(a, b), residual = y === null ? null : +(y - want).toFixed(2);
    roofs.push({ label, targetY: want, builtY: y === null ? null : +y.toFixed(2), residual });
    if (residual === null || Math.abs(residual) > 0.6) failures.push(`${label}: built Y ${y} vs LiDAR Y ${want}`);
  }
  // ACS: official 7 floors (Sept 2026); estimate, not the 2017 LiDAR 13.5 m building.
  const acs = top(240, -165);
  roofs.push({ label: 'ACS 507893 (estimate from official 7 floors)', targetY: 29.4, builtY: acs, basis: 'estimate' });
  if (acs === null || acs < 27 || acs > 32) failures.push(`ACS roof Y ${acs} outside the 7-floor estimate band 27..32`);
  report.roofs = roofs;

  // 2. Plan edges along scan lines vs official polygons (first/last sample above a threshold).
  const edge = (fixed: number, from: number, to: number, alongS: boolean, above: number) => {
    let first: number | null = null, last: number | null = null;
    const step = 0.1 * Math.sign(to - from);
    for (let v = from; (to - v) * Math.sign(step) >= 0; v += step) {
      const y = alongS ? topST(v, fixed) : topST(fixed, v);
      if (y !== null && y > above) { if (first === null) first = v; last = v; }
    }
    return [first, last].map(v => v === null ? null : +v.toFixed(2));
  };
  const [ecjW, ecjE] = edge(-80, 95, 165, true, 40);
  const [ecjN, ecjS] = edge(130, -105, -55, false, 40);
  const [eerN, eerNi] = edge(108, -45, 0, false, 40);
  const [eerSi, eerS] = edge(108, 0, 45, false, 40);
  const plan = {
    ecj: { official: { s: [108.75, 150.44], t: [-95.49, -63.53] }, built: { s: [ecjW, ecjE], t: [ecjN, ecjS] } },
    eerWestFace: { official: { northWing: [-33.5, -11.3] }, lidar: { northWing: [-34.5, -10.8], southWing: [9.6, 33.5] }, built: { northWing: [eerN, eerNi], southWing: [eerSi, eerS] } },
  };
  report.plan = plan;
  const close = (v: number | null, want: number, tol: number, what: string) => { if (v === null || Math.abs(v - want) > tol) failures.push(`${what}: built ${v} vs ${want}`); };
  close(ecjW, 108.75, 0.8, 'ECJ west edge (official GIS 430)'); close(ecjE, 150.44, 0.8, 'ECJ east edge');
  close(ecjN, -95.49, 0.8, 'ECJ north edge'); close(ecjS, -63.53, 0.8, 'ECJ south edge');
  close(eerN, -34.5, 1.2, 'EER north wing north face'); close(eerNi, -10.8, 0.8, 'EER north wing court face');
  close(eerSi, 9.6, 0.8, 'EER south wing court face'); close(eerS, 33.5, 1.2, 'EER south wing south face');
  // PMA west tower east edge (north of the core, where only the tower reaches Y60+): LiDAR tier edge s48.1.
  const [pmaW, pmaE] = edge(-88, 0, 60, true, 60);
  (plan as Record<string, unknown>).pmaWestTower = { lidar: { s: [8.0, 48.1] }, built: { s: [pmaW, pmaE] } };
  close(pmaE, 48.1, 0.6, 'PMA west tower east edge (LiDAR tier)');
  // The former generic "second PMA tower" reached s81.8; between PMA and ECJ must now be podium only.
  const gap = topST(100, -80);
  report.betweenPmaAndEcj = gap;
  if (gap === null || gap > 11) failures.push(`s100,t-80 (between official PMA and ECJ) built ${gap}, expected podium <= 11`);
  // The court is open: between the towers the first hit below the screen line is the deck.
  const court = belowScreen(130, -5);
  report.courtDeckBelowScreen = court;
  if (court === null || Math.abs(court - 12.5) > 0.6) failures.push(`EER court below the screen hits ${court}, expected the open deck ~12.5-13.3`);

  // 3. Route clearance: no collider 0.3..2.1 m above engineering walk tops (hits < 0.3 m are
  //    stacked stair treads / overlapping walk pieces, as in generic rule G4).
  const names = /^(Engineering connected walks and stair|Engineering courtyard: Engineering courtyard concrete|Engineering courtyard: Engineering central lawn|Engineering north contour connection: paved walk|PMA supported clear southwest forecourt)$/;
  let samples = 0, blocked = 0, vegetation = 0, buried = 0; const examples: unknown[] = [];
  const v = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  walkway.surfaces.traverse((o: { isMesh?: boolean; name: string; geometry: { getAttribute(n: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number }; index: { count: number; getX(i: number): number } | null }; updateWorldMatrix(a: boolean, b: boolean): void; matrixWorld: { elements: number[] } }) => {
    if (!o.isMesh || !names.test(o.name)) return;
    o.updateWorldMatrix(true, false);
    const e = o.matrixWorld.elements, pos = o.geometry.getAttribute('position'), idx = o.geometry.index, n = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      for (let k = 0; k < 3; k++) {
        const j = idx ? idx.getX(i + k) : i + k, x = pos.getX(j), y = pos.getY(j), z = pos.getZ(j);
        v[k * 3] = e[0] * x + e[4] * y + e[8] * z + e[12]; v[k * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; v[k * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
      const ux = v[3] - v[0], uy = v[4] - v[1], uz = v[5] - v[2], wx = v[6] - v[0], wy = v[7] - v[1], wz = v[8] - v[2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz);
      if (l < 1e-6 || ny / l < 0.7) continue; // up-facing walk tops only
      const cx = (v[0] + v[3] + v[6]) / 3, cy = (v[1] + v[4] + v[7]) / 3, cz = (v[2] + v[5] + v[8]) / 3;
      if (cx < 35 || cx > 340 || cz < -490 || cz > -140) continue;
      // Faces buried under the visible baked terrain (internal stair/foundation tops) are not walkable routes
      // (integrator, after the harness gained the game's terrain colliders).
      if (cy < scene.ground.height(cx, cz) - 0.3) { buried++; continue; }
      samples++;
      const h = physics.castRay(new RAPIER.Ray({ x: cx, y: cy + 0.3, z: cz }, up), 1.8, true, undefined, undefined, player);
      if (!h) continue;
      // Tree limb/trunk capsules belong to the vegetation install (not this block's geometry).
      if (h.collider.shape.type === RAPIER.ShapeType.Capsule) { vegetation++; continue; }
      blocked++; if (examples.length < 6) examples.push([+cx.toFixed(1), +cy.toFixed(2), +cz.toFixed(1), o.name, +h.timeOfImpact.toFixed(2)]);
    }
  });
  report.routeClearance = { samples, blocked, vegetationCapsuleHits: vegetation, buriedFacesSkipped: buried, examples };
  if (!samples) failures.push('route clearance: no engineering walk samples found');
  if (blocked) failures.push(`route clearance: ${blocked}/${samples} walk samples have a collider < 2.1 m overhead, e.g. ${JSON.stringify(examples)}`);

  // 4. Map travel lands outdoors.
  const trips: Record<string, unknown> = {};
  for (const [label, p] of [['EER', [175.796, -241.488]], ['PMA', [66.73, -325.58]]] as [string, [number, number]][]) {
    const r = travel(p); trips[label] = r;
    if (!r.landing) failures.push(`travel to ${label}: no landing`);
    else if (r.enclosed) failures.push(`travel to ${label}: landing enclosed under a roof`);
  }
  report.travel = trips;

  // 5. Restored / corrected generated records.
  const decisions: Record<string, string> = {};
  for (const id of [698987, 704813, 507893, 506548, 732885, 655276, 548643, 715399, 716056]) {
    const p = plans.find((q: { building: { id: number } }) => q.building.id === id); decisions[id] = p?.decision ?? 'missing';
  }
  report.decisions = decisions;
  for (const id of [698987, 704813, 507893]) if (decisions[id] !== 'generated') failures.push(`record ${id} is ${decisions[id]}, expected generated`);

  // 6. EER court curtain walls. Rays from the court centre line toward each inner elevation; the first
  //    render-mesh hit within 0.7 m of the wall line is classified by material. Frames in front of the
  //    wall (end frames, screen girders) are skipped, not counted.
  const courtMeshes: THREE.Mesh[] = [];
  walkway.surfaces.traverse((o: THREE.Object3D) => { const m = o as THREE.Mesh; if (m.isMesh && m.name.startsWith('Engineering courtyard: ')) { m.updateWorldMatrix(true, false); courtMeshes.push(m); } });
  const ray = new THREE.Raycaster();
  const S = new THREE.Vector3(-0.089, 0, 1).normalize();
  const courtWalls: Record<string, unknown> = {};
  for (const [face, tWall, dir] of [['north wing inner face', -10.8, -1], ['south wing inner face', 9.6, 1]] as [string, number, number][]) {
    let glassHits = 0, wallHits = 0, skipped = 0, physicalBad = 0; const other: Record<string, number> = {};
    for (let sv = 107; sv <= 183; sv += 3) for (let y = 13.2; y < 44.3; y += 2) {
      const [x, z] = xz(sv, -0.6), o = new THREE.Vector3(x, y, z), d = S.clone().multiplyScalar(dir);
      ray.set(o, d); ray.far = 16;
      const hit = ray.intersectObjects(courtMeshes, false)[0];
      if (!hit) { skipped++; continue; }
      const tHit = -0.6 + dir * hit.distance;
      if (Math.abs(tHit - tWall) > 0.7) { skipped++; continue; }
      const name = (hit.object as THREE.Mesh).name.replace('Engineering courtyard: ', '');
      if (/court curtain wall glass/.test(name)) glassHits++; else { wallHits++; other[name] = (other[name] ?? 0) + 1; }
      const ph = physics.castRay(new RAPIER.Ray({ x, y, z }, { x: d.x, y: 0, z: d.z }), 16, true, undefined, undefined, player);
      if (!ph || Math.abs(ph.timeOfImpact - hit.distance) > 0.05) physicalBad++;
    }
    const fraction = glassHits / Math.max(1, glassHits + wallHits);
    courtWalls[face] = { glassHits, nonGlassHits: wallHits, glassFraction: +fraction.toFixed(3), nonGlassByMaterial: other, skippedFramesInFront: skipped, visibleVsColliderOver005: physicalBad };
    if (fraction < 0.75) failures.push(`EER ${face}: visible glass fraction ${fraction.toFixed(2)} < 0.75 (curtain wall expected)`);
    if (physicalBad) failures.push(`EER ${face}: ${physicalBad} wall samples where the collider is > 0.05 m from the visible surface`);
  }
  report.eerCourtWalls = courtWalls;

  // 6b. EER west elevation (eer-dataset-pass; ut-eer-547-engineering-2 / -directory-photo). Eastward render rays
  //     from s100, classified by the first hit's material, plus the matching physics ray:
  //     - wing faces: single-storey slots staggered between storeys, a blank top storey, the north wing's
  //       outer 45 % of the panelled field blank;
  //     - centre bay: white diagrid with an X crossing at each of the three crossing points of all four bands,
  //       and the terrace storey open (no lattice member in front of the court).
  {
    const Ev = new THREE.Vector3(E[0], 0, E[1]);
    const base = 7.15, floor = (45.0 - 0.52 - base) / 7, aN = -10.8, aS = 9.6, aW = aS - aN;
    const firstHit = (s: number, t: number, y: number) => {
      const [x, z] = xz(s, t); ray.set(new THREE.Vector3(x, y, z), Ev); ray.far = 10;
      const hit = ray.intersectObjects(courtMeshes, false)[0];
      if (!hit) return null;
      const ph = physics.castRay(new RAPIER.Ray({ x, y, z }, { x: Ev.x, y: 0, z: Ev.z }), 10, true, undefined, undefined, player);
      return { s: s + hit.distance, name: (hit.object as THREE.Mesh).name.replace('Engineering courtyard: ', ''), physicalOff: !ph || Math.abs(ph.timeOfImpact - hit.distance) > 0.05, physS: ph ? +(s + ph.timeOfImpact).toFixed(3) : null };
    };
    const west: Record<string, unknown> = {}; let faceBad = 0; const faceBadEx: unknown[] = [];
    for (const [wing, t0, t1, inner] of [['north', -34.5, aN, aN], ['south', aS, 33.5, aS]] as [string, number, number, number][]) {
      const storeys: { slots: number[]; strip: boolean }[] = [];
      for (let f = 0; f < 7; f++) {
        const y = base + (f + 0.5) * floor, runs: number[][] = []; let strip = false, cur: number[] | null = null;
        // Offset grid: rays exactly on a box edge graze a side face (render) vs the front face (physics).
        for (let t = t0 + 0.0537; t < t1; t += 0.1) {
          const h = firstHit(100, t, y), glass = !!h && h.s < 104.7 && /photo-study glass/.test(h.name);
          if (h && h.s < 104.7 && h.physicalOff) { faceBad++; if (faceBadEx.length < 8) faceBadEx.push([wing, f, +t.toFixed(2), +y.toFixed(2), h.name, +h.s.toFixed(3), h.physS]); }
          if (glass && Math.abs(t - inner) < 2.6) { strip = true; continue; }
          if (glass) { if (cur) cur[1] = t; else runs.push(cur = [t, t]); } else cur = null;
        }
        storeys.push({ slots: runs.filter(r => r[1] - r[0] > 0.3).map(r => +((r[0] + r[1]) / 2).toFixed(2)), strip });
      }
      const top = storeys[6], identical = storeys.slice(0, 5).filter((s, i) => s.slots.length === storeys[i + 1].slots.length && s.slots.every((c, k) => Math.abs(c - storeys[i + 1].slots[k]) < 0.3)).length;
      const outerLimit = t0 + 0.6 + 0.45 * (t1 - 3.2 - (t0 + 0.6));
      const outerSlots = wing === 'north' ? storeys.flatMap(s => s.slots).filter(c => c < outerLimit).length : 0;
      west[wing] = { slotsPerStorey: storeys.map(s => s.slots.length), innerStrip: storeys.map(s => s.strip), identicalAdjacentStoreys: identical, outerFieldSlots: outerSlots };
      if (top.slots.length || top.strip) failures.push(`EER ${wing} wing: top storey has glazing (expected the blank plant band)`);
      if (storeys.slice(0, 6).some(s => !s.slots.length || !s.strip)) failures.push(`EER ${wing} wing: a lower storey lacks slots or the inner glass strip`);
      if (identical > 1) failures.push(`EER ${wing} wing: ${identical} adjacent storeys have identical slot positions (staggered expected)`);
      if (outerSlots) failures.push(`EER north wing: ${outerSlots} slots in the blank outer field`);
    }
    // Diagrid: crossings at the band mid-heights; open terrace storey.
    const y0 = base + 2 * floor, y1 = 38.6 - 1, bandH = (y1 - y0) / 4, nodes = [0, 1, 2, 3].map(j => aN + 0.5 + j * (aW - 1) / 3);
    let crossings = 0, latticeBad = 0; const misses: unknown[] = [];
    for (let k = 0; k < 4; k++) for (let j = 0; j < 3; j++) {
      const t = (nodes[j] + nodes[j + 1]) / 2, y = y0 + (k + 0.5) * bandH, h = firstHit(100, t, y);
      if (h && /white diagrid/.test(h.name) && Math.abs(h.s - 105.7) < 0.5) { crossings++; if (h.physicalOff) latticeBad++; } else misses.push([k, j, h?.name ?? null, h ? +h.s.toFixed(2) : null]);
    }
    const terrace = firstHit(100, (aN + aS) / 2, 12.5 + 2.6);
    west.diagrid = { crossings, expected: 12, latticeVisibleVsCollider: latticeBad, misses, terraceStoreyFirstHit: terrace ? { name: terrace.name, s: +terrace.s.toFixed(2) } : null };
    west.faceVisibleVsColliderOver005 = faceBad; west.faceMismatchExamples = faceBadEx;
    if (crossings !== 12) failures.push(`EER west diagrid: ${crossings}/12 band crossings hit the white diagrid (${JSON.stringify(misses)})`);
    if (latticeBad || faceBad) failures.push(`EER west elevation: ${latticeBad + faceBad} samples where the collider is > 0.05 m from the visible surface`);
    if (terrace && /diagrid/.test(terrace.name) && terrace.s < 106.5) failures.push('EER west terrace storey is closed by the diagrid (open storey expected)');
    report.eerWestElevation = west;
  }

  // 7. Recess depths by horizontal collider rays (positive t = south). hitT(s, y, fromT, dir).
  const hitT = (sv: number, y: number, fromT: number, dir: number) => {
    const [x, z] = xz(sv, fromT); const h = physics.castRay(new RAPIER.Ray({ x, y, z }, { x: S.x * dir, y: 0, z: S.z * dir }), 30, true, undefined, undefined, player);
    return h ? +(fromT + dir * h.timeOfImpact).toFixed(3) : null;
  };
  const profile = (s0: number, s1: number, y: number, fromT: number, dir: number) => { const v: number[] = []; for (let sv = s0; sv <= s1; sv += 0.2) { const t = hitT(sv, y, fromT, dir); if (t !== null) v.push(t); } return v; };
  // PMA west tower south face (t -56.9): ribs proud, window groups recessed (window band y 40.4..42.1).
  const pmaS = profile(11, 47, 41.2, -45, -1), pmaRib = Math.max(...pmaS), pmaGlass = Math.min(...pmaS);
  // ECJ south face (t -63.53): rib faces vs the recessed glazing plane (mid-floor y 30.7).
  const ecjSouthProfile = profile(110, 149, 30.7, -50, -1), ecjRib = Math.max(...ecjSouthProfile), ecjGlass = Math.min(...ecjSouthProfile);
  // PMA east wing south face (t -20.1, s55.2..66.5): fraction of the face that is blank wall.
  let blank = 0, recessed = 0;
  for (let y = 12; y < 50; y += 1) for (let sv = 55.6; sv < 66.2; sv += 0.4) { const t = hitT(sv, y, -12, -1); if (t === null) continue; if (t > -20.2) blank++; else recessed++; }
  const recesses = {
    pmaTowerSouth: { ribFaceT: pmaRib, recessedGlassT: pmaGlass, depthM: +(pmaRib - pmaGlass).toFixed(2), samples: pmaS.length },
    ecjSouth: { ribFaceT: ecjRib, recessedGlassT: ecjGlass, depthM: +(ecjRib - ecjGlass).toFixed(2), samples: ecjSouthProfile.length },
    pmaEastWingSouth: { blankFraction: +(blank / Math.max(1, blank + recessed)).toFixed(3), samples: blank + recessed },
  };
  report.recesses = recesses;
  if (!(recesses.pmaTowerSouth.depthM > 1.0)) failures.push(`PMA tower south recess depth ${recesses.pmaTowerSouth.depthM} m (ribs + recessed glass expected > 1.0)`);
  if (!(recesses.ecjSouth.depthM > 0.8)) failures.push(`ECJ south recess depth ${recesses.ecjSouth.depthM} m (deep egg-crate expected > 0.8)`);
  if (!(recesses.pmaEastWingSouth.blankFraction > 0.8)) failures.push(`PMA east wing south face blank fraction ${recesses.pmaEastWingSouth.blankFraction} (mostly blank service face expected)`);

  // 8. Speedway east-edge seam (shared request b03-r4). Engineering side = first collider top just east of
  //    the 30 ft brick edge (else the visible terrain); west side = terrain just west of it.
  const terrainY = (x: number, z: number) => scene.world.terrain.height(x, z) as number;
  const seam: unknown[] = []; let seamWorst = 0, seamStepWorst = 0;
  for (let z = -244; z >= -364; z -= 4) {
    const [ex, ez] = speedwayNorthEastEdge(z);
    const own = top(ex + 0.5, ez), eng = own !== null && own < 12 ? own : terrainY(ex + 0.5, ez), west = terrainY(ex - 0.5, ez);
    const published = engineeringSpeedwayEdge(z), dev = +(eng - published).toFixed(3), step = +(eng - west).toFixed(3);
    seamWorst = Math.max(seamWorst, Math.abs(dev)); seamStepWorst = Math.max(seamStepWorst, Math.abs(step));
    seam.push([z, +ex.toFixed(2), +eng.toFixed(2), own === null ? 'terrain' : 'collider', published, dev, +west.toFixed(2), step]);
  }
  report.speedwaySeam = { columns: ['z', 'edgeX', 'engineeringY', 'surface', 'publishedY', 'deviation', 'terrainWestY', 'stepToTerrainWest'], rows: seam, worstDeviation: seamWorst, worstStepToTerrain: seamStepWorst };
  if (seamWorst > 0.05) failures.push(`Speedway seam: engineering edge deviates ${seamWorst} m from the published engineeringSpeedwayEdge() profile`);

  // 9. 548643 (generated; LiDAR pitched roof, tier Y4.9, P95 Y6.5).
  report.record548643 = { builtTopAtCentroid: top(...xz(252, -224)), lidarTierY: 4.9, lidarP95Y: 6.5 };

  // 10. Dean Keeton engineering bridge.
  {
    const st = scene.blocks.stats['b01-eer']?.deanKeetonBridge;
    if (!st) failures.push('Dean Keeton bridge: install stats missing (block install did not run)');
    else {
      const bridge: Record<string, unknown> = { install: st };
      const roots = scene.groundRoots as THREE.Object3D[]; for (const r of roots) r.updateMatrixWorld(true);
      const rc = new THREE.Raycaster(), dn = new THREE.Vector3(0, -1, 0);
      const vis = (x: number, z: number, fromY: number, far = 30) => { rc.set(new THREE.Vector3(x, fromY, z), dn); rc.far = far; return rc.intersectObjects(roots, true).find(h => (h.face?.normal.y ?? 0) > -2) ?? null; };
      const phys = (x: number, z: number, fromY: number, far = 30) => { const h = physics.castRay(new RAPIER.Ray({ x, y: fromY, z }, down), far, true, undefined, undefined, player); return h ? fromY - h.timeOfImpact : null; };
      const uEnd = st.landingEndU as number, uFace = st.uFace as number;
      // A. visible deck vs physical deck.
      let vS = 0, vBad = 0, vWorst = 0, notDeck = 0; const vEx: unknown[] = [];
      for (let u = uFace + 0.4; u < uEnd - 0.3; u += 1) for (const v of [-2.5, -1.25, 0, 1.25, 2.5]) {
        const p = bridgeWorld(u, v), y0 = (u <= 58 ? bridgeDeckY(u) : 6.5) + 2, h = vis(p.x, p.z, y0), y = phys(p.x, p.z, y0);
        vS++; if (!h || !/Dean Keeton engineering bridge: deck/.test(h.object.name)) { notDeck++; if (vEx.length < 4) vEx.push([+u.toFixed(1), v, h?.object.name ?? null]); continue; }
        const d = y === null ? 99 : Math.abs(y - h.point.y); vWorst = Math.max(vWorst, d); if (d > 0.08) vBad++;
      }
      bridge.deckVisualVsPhysics = { samples: vS, over008: vBad, worst: +vWorst.toFixed(3), firstHitNotDeck: notDeck, examples: vEx };
      if (vBad || notDeck) failures.push(`bridge deck: ${vBad} samples visual vs physics > 0.08 m, ${notDeck} samples where the first visible surface is not the deck`);
      // Scooter replay with the game's real clearance code.
      const controller = physics.createCharacterController(0.025);
      controller.enableAutostep(0.32, 0.2, false); controller.enableSnapToGround(0.38);
      controller.setMaxSlopeClimbAngle(Math.PI * 0.25); controller.setMinSlopeSlideAngle(Math.PI * 0.28);
      const query = new LocalGroundQuery();
      const clearance = new ScooterClearance({ world: physics, controller, collider: player, renderedGround: (x, z, fromY, distance) => query.sample(x, z, fromY, distance) });
      const vmax = RUN_SPEED * SCOOTER_TUNING.speedMultiplier, dt = 1 / 60;
      // Continuous replay along a polyline: normal acceleration from rest to scooter speed, one traceMove per
      // 60 Hz frame from the previous validated centre (support layer carried frame to frame).
      const rideRoute = (label: string, pts: THREE.Vector3[], expectY0: number) => {
        const y0 = phys(pts[0].x, pts[0].z, expectY0 + 1.5, 4);
        if (y0 === null) return { label, error: 'no start support' };
        let center = { x: pts[0].x, y: y0 + 0.905, z: pts[0].z }, speed = 0, travelled = 0, frames = 0, maxStep = 0, maxSlopeDeg = 0, lastY = y0, minY = y0, maxY = y0, total = 0;
        let blocked: unknown = null;
        for (let k = 0; k + 1 < pts.length && !blocked; k++) {
          const to = pts[k + 1], seg = new THREE.Vector3(to.x - center.x, 0, to.z - center.z), dist = seg.length(); total += dist; seg.normalize();
          const heading = Math.atan2(seg.x, seg.z); let done = 0;
          while (done < dist - 1e-6 && frames < 8000) {
            speed = Math.min(vmax, speed + SCOOTER_TUNING.acceleration * dt); const stepLen = Math.min(speed * dt, dist - done);
            query.prepare(roots, center, () => true);
            const t = clearance.traceMove({ center, heading }, { x: seg.x * stepLen, z: seg.z * stepLen }, heading);
            frames++;
            if (t.fraction < 0.999 || t.blockedReason || !t.support) { blocked = { at: [+center.x.toFixed(2), +center.y.toFixed(2), +center.z.toFixed(2)], segment: k, u: +bridgeUV(center.x, center.z).u.toFixed(1), reason: t.blockedReason, fraction: +t.fraction.toFixed(3), speed: +speed.toFixed(2) }; break; }
            const g = t.support.groundY; maxStep = Math.max(maxStep, Math.abs(g - lastY)); lastY = g; minY = Math.min(minY, g); maxY = Math.max(maxY, g);
            maxSlopeDeg = Math.max(maxSlopeDeg, Math.abs(t.support.pitch) * 180 / Math.PI, Math.abs(t.support.roll) * 180 / Math.PI);
            center = { ...t.center }; done += stepLen; travelled += stepLen;
          }
        }
        return { label, metres: +travelled.toFixed(1), of: +total.toFixed(1), frames, topSpeed: +speed.toFixed(2), maxFrameStepM: +maxStep.toFixed(3), maxSlopeDeg: +maxSlopeDeg.toFixed(2), supportY: [+minY.toFixed(2), +maxY.toFixed(2)], blocked };
      };
      const ride = (label: string, from: THREE.Vector3, to: THREE.Vector3, expectY0: number) => rideRoute(label, [from, to], expectY0);
      // EER west court walks (Codex build-10 normal-control replay: 'rider-clearance' stop on the north walk at
      // t-8.16 beside the station-48 north oak). Full ScooterClearance rides along the edge line and the centre
      // line of BOTH walk strips, both directions, with the game's tree capsule colliders installed.
      const courtWalks: Record<string, unknown>[] = [];
      for (const t of [-8.156, -9.16, 8.156, 9.16]) for (const east of [true, false]) {
        const a = engineeringCourtPoint(east ? 4 : 77, t), b = engineeringCourtPoint(east ? 77 : 4, t);
        const r = rideRoute(`EER court walk t${t} ${east ? 'eastbound' : 'westbound'}`, [a, b], 6.5) as { blocked?: unknown; error?: string; metres?: number };
        courtWalks.push(r);
        if (r.error || r.blocked) failures.push(`EER court walk scooter ride: ${JSON.stringify(r)}`);
      }
      report.eerCourtWalkScooter = courtWalks;
      const rides: Record<string, unknown>[] = [];
      // Full pedestrian route, starting OUTSIDE the court on the south engineering walk: OSM footway 573368327
      // from the engineering court (s93.7,t-9.3) north through the podium court to the bridge's south node,
      // across the deck and landing, then OSM 126020364 onto the north plaza (139.8,-414.5); and back.
      const southWalk = ([[93.7, -9.3], [94.0, -27.7], [93.5, -55.4], [93.5, -58.6], [93.4, -67.2], [93.3, -99.5]] as [number, number][]).map(([a, b]) => engineeringCourtPoint(a, b));
      const north = [new THREE.Vector3(138.734, 0, -401.026), new THREE.Vector3(139.8, 0, -414.5)];
      const full = [...southWalk, ...north];
      rides.push(rideRoute('route south walk -> court -> deck -> north plaza (OSM 573368327 / 25775199 / 126020364)', full, phys(full[0].x, full[0].z, 20, 30) ?? 7));
      const back = [...full].reverse();
      rides.push(rideRoute('route north plaza -> deck -> court -> south walk', back, phys(back[0].x, back[0].z, 20, 30) ?? 6));
      // Near-edge lines on the deck (v +-2.0), from inside the court to the plaza and back.
      const courtStart = (v: number) => bridgeWorld(uFace - 8, v), plazaEnd = (v: number) => bridgeWorld(uEnd + 4, v);
      for (const v of [-2.0, 2.0]) {
        rides.push(ride(`deck S->N v${v}`, courtStart(v), plazaEnd(v), DEAN_BRIDGE.southY));
        const pe = plazaEnd(v); rides.push(ride(`deck N->S v${v}`, pe, courtStart(v), phys(pe.x, pe.z, 20, 30) ?? 6));
      }
      // Road and sidewalks underneath (lines parallel to the engineering s axis through the OSM crossings at x136).
      const lines: [string, number][] = [['south sidewalk 1425959533', -353.4], ['carriageway 656122483', -360.4], ['carriageway 1359557180', -369.6], ['north sidewalk 992752054', -377.3]];
      const under: Record<string, unknown>[] = [];
      for (const [name, zc] of lines) {
        const { t } = engineeringCourtLocal(136, zc), a = engineeringCourtPoint(75, t), b = engineeringCourtPoint(112, t);
        for (const [p, q, dirName] of [[a, b, 'E'], [b, a, 'W']] as [THREE.Vector3, THREE.Vector3, string][]) {
          const r = ride(`${name} ->${dirName}`, p, q, phys(p.x, p.z, 5, 10) ?? 1) as Record<string, unknown>;
          // Rider headroom at the crossing.
          const c = engineeringCourtPoint(93.2, t); // the bridge axis is at s ~93.0-93.3
          const g = phys(c.x, c.z, 4, 6), upHit = g === null ? null : physics.castRayAndGetNormal(new RAPIER.Ray({ x: c.x, y: g + 0.05, z: c.z }, { x: 0, y: 1, z: 0 }), 20, true, undefined, undefined, player);
          r.headroomM = g === null || !upHit ? null : +(upHit.timeOfImpact + 0.05).toFixed(2); r.undersideNormalY = upHit ? +upHit.normal.y.toFixed(2) : null; r.groundY = g;
          under.push(r);
        }
      }
      const bad = [...rides, ...under].filter(r => r.blocked || r.error || (r.maxFrameStepM as number) > SCOOTER_ENVELOPE.maxStep || (r.maxSlopeDeg as number) > 15);
      for (const r of bad) failures.push(`bridge ride ${String(r.label)}: ${JSON.stringify({ blocked: r.blocked, error: r.error, step: r.maxFrameStepM, slope: r.maxSlopeDeg })}`);
      for (const r of under) if (r.headroomM === null || (r.headroomM as number) < SCOOTER_ENVELOPE.riderGuardMaxY + 0.2 || (r.undersideNormalY as number) > -0.5) failures.push(`bridge underside over ${String(r.label)}: ${JSON.stringify({ headroom: r.headroomM, normal: r.undersideNormalY })}`);
      bridge.deckRides = rides; bridge.roadAndSidewalksUnder = under;
      // Committed locomotion replays (the game's per-frame loop shape): the player body is moved each frame by
      // the KCC result. Walking: computeColliderMovement with gravity 24 m/s2, autostep 0.32 / snap 0.38 (game
      // settings). Scooter: ScooterClearance.resolveMove (KCC-committed, re-validated) from the body position.
      const bodyRef = player.parent();
      const savedBody = bodyRef ? { ...bodyRef.translation() } : null;
      const commit = (q: { x: number; y: number; z: number }) => { bodyRef!.setTranslation(q, true); physics.propagateModifiedBodyPositionsToColliders(); };
      const replay = (label: string, pts: THREE.Vector3[], mode: 'walk' | 'scooter') => {
        const y0 = phys(pts[0].x, pts[0].z, 20, 30);
        if (!bodyRef || y0 === null) return { label, mode, error: 'no body or start support' };
        commit({ x: pts[0].x, y: y0 + 0.905, z: pts[0].z });
        let vertical = 0, speed = 0, frames = 0, travelled = 0, stuck = 0, maxDrop = 0, ungrounded = 0, heading = 0, lastY = y0 + 0.905;
        const reasons: Record<string, number> = {};
        for (let k = 1; k < pts.length; k++) {
          const target = pts[k];
          for (let guard = 0; guard < 6000; guard++) {
            const p = bodyRef.translation(), to = new THREE.Vector3(target.x - p.x, 0, target.z - p.z), dist = to.length();
            if (dist < 0.25) break;
            to.normalize(); frames++;
            if (mode === 'walk') {
              const v = Math.min(WALK_SPEED, dist / dt);
              vertical = Math.max(-35, vertical - 24 * dt);
              controller.computeColliderMovement(player, { x: to.x * v * dt, y: vertical * dt, z: to.z * v * dt });
              const m = controller.computedMovement(), grounded = characterSupported(controller, p.y, vertical);
              if (grounded && vertical < 0) vertical = 0; if (!grounded) ungrounded++;
              const moved = Math.hypot(m.x, m.z); travelled += moved; if (moved < 0.3 * v * dt) stuck++; else stuck = 0;
              commit({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z });
            } else {
              const want = Math.atan2(to.x, to.z);
              speed = Math.min(RUN_SPEED * SCOOTER_TUNING.speedMultiplier, speed + SCOOTER_TUNING.acceleration * dt);
              const stepLen = Math.min(speed * dt, dist);
              query.prepare(roots, p, () => true);
              const r = clearance.resolveMove({ fromHeading: heading, heading: want, displacement: { x: to.x * stepLen, z: to.z * stepLen } });
              if (r.blockedReason) reasons[r.blockedReason] = (reasons[r.blockedReason] ?? 0) + 1;
              const moved = Math.hypot(r.center.x - p.x, r.center.z - p.z); travelled += moved;
              if (moved < 0.3 * stepLen) { stuck++; speed = 0; } else stuck = 0;
              heading = r.allowedHeading; commit(r.center);
            }
            const y = bodyRef.translation().y; maxDrop = Math.max(maxDrop, lastY - y); lastY = y;
            if (stuck > 45) break;
          }
          if (stuck > 45) break;
        }
        const end = bodyRef.translation(), last = pts[pts.length - 1];
        const reached = Math.hypot(end.x - last.x, end.z - last.z) < 0.6;
        return { label, mode, reached, metres: +travelled.toFixed(1), frames, ungroundedFrames: ungrounded, maxFrameDropM: +maxDrop.toFixed(3), blockedReasons: reasons,
          end: [+end.x.toFixed(2), +end.y.toFixed(2), +end.z.toFixed(2)] };
      };
      const committed = [
        replay('walk: south walk -> court -> deck -> north plaza', full, 'walk'), replay('walk: north plaza -> deck -> court -> south walk', back, 'walk'),
        replay('scooter (resolveMove): south walk -> north plaza', full, 'scooter'), replay('scooter (resolveMove): north plaza -> south walk', back, 'scooter'),
      ];
      for (const r of committed) if (!(r as { reached?: boolean }).reached || (r as { ungroundedFrames?: number }).ungroundedFrames! > 3 || (r as { maxFrameDropM?: number }).maxFrameDropM! > 0.3)
        failures.push(`bridge committed replay ${r.label}: ${JSON.stringify(r)}`);
      bridge.committedReplays = committed;
      if (bodyRef && savedBody) commit(savedBody);
      // Court exits: horizontal rays at standing centre height from the former terrace centre (Codex probe point).
      const exits: Record<string, unknown> = {};
      { const o = engineeringCourtPoint(94.6, -93), y = phys(o.x, o.z, 12, 8)! + 0.905;
        for (const [name, ds, dtt] of [['west', -1, 0], ['east', 1, 0], ['south', 0, 1], ['north', 0, -1]] as [string, number, number][]) {
          const a = engineeringCourtPoint(94.6, -93), b = engineeringCourtPoint(94.6 + ds, -93 + dtt), d = b.sub(a).normalize();
          const h = physics.castRay(new RAPIER.Ray({ x: o.x, y, z: o.z }, { x: d.x, y: 0, z: d.z }), 60, true, undefined, undefined, player);
          if (!h) { exits[name] = 'open (60 m)'; continue; }
          const q = { x: o.x + d.x * h.timeOfImpact, z: o.z + d.z * h.timeOfImpact }, l = engineeringCourtLocal(q.x, q.z);
          exits[name] = { distanceM: +h.timeOfImpact.toFixed(2), st: [+l.s.toFixed(2), +l.t.toFixed(2)] };
        }
      }
      exits.court = { s: [pmaBridgeCourt.s0, pmaBridgeCourt.s1], t: [pmaBridgeCourt.tN, pmaBridgeCourt.tS] };
      bridge.courtExitsFromFormerTerraceCentre = exits;
      const south = exits.south as { st?: number[] } | string;
      if (typeof south !== 'string' && south.st && south.st[1] < pmaBridgeCourt.tS - 0.5) failures.push(`bridge court: south exit blocked at ${JSON.stringify(south)}`);
      // Headroom over the full carriageway widths (2 lanes, ~3.3 m each side of the OSM line) and both sidewalks,
      // across the whole bridge footprint, vs the posted maxheight 14 ft 6 in (4.42 m) on 656122483 / 1359557180.
      const headroom: Record<string, unknown> = {};
      for (const [name, zc, half, posted] of [['carriageway 656122483', -360.4, 3.3, 4.4196], ['carriageway 1359557180', -369.6, 3.3, 4.4196], ['south sidewalk 1425959533', -353.4, 1.1, 0], ['north sidewalk 992752054', -377.3, 1.1, 0]] as [string, number, number, number][]) {
        const { t } = engineeringCourtLocal(136, zc); let min = Infinity, at: number[] = [], n = 0;
        for (let dtt = -half; dtt <= half + 1e-6; dtt += 0.55) for (let sv = 89.8; sv <= 96.8; sv += 0.5) {
          const p = engineeringCourtPoint(sv, t + dtt), g = phys(p.x, p.z, 4, 6); if (g === null) continue;
          const h = physics.castRay(new RAPIER.Ray({ x: p.x, y: g + 0.05, z: p.z }, { x: 0, y: 1, z: 0 }), 12, true, undefined, undefined, player); if (!h) continue;
          n++; const hr = h.timeOfImpact + 0.05; if (hr < min) { min = hr; at = [+p.x.toFixed(1), +g.toFixed(2), +p.z.toFixed(1)]; }
        }
        headroom[name] = { samples: n, minHeadroomOverBakedGroundM: +min.toFixed(2), at, postedM: posted || null };
        if (min < SCOOTER_ENVELOPE.riderGuardMaxY + 0.2) failures.push(`bridge headroom over ${name} ${min.toFixed(2)} m below the rider envelope`);
      }
      // Posted maxheight 14'6" (4.42 m, OSM 656122483 / 1359557180) vs the built underside over the REAL road: 2017
      // USGS DTM centreline +-4 m samples (user-landmarks/engineering-bridge-lidar-probe.json; dx-0.23, dz-1.07).
      // The baked game ground there is up to ~0.65 m above that DTM near the south curb (reported above).
      const dtm: [number, number, number[]][] = [[-360, 135.277, [1.17, 1.07, 0.97, 0.88, 0.82]], [-370, 136.12, [1.23, 1.14, 1.04, 0.94, 0.87]]];
      const posted: unknown[] = []; let postedMin = Infinity;
      for (const [z, cx, ys] of dtm) [-4, -2, 0, 2, 4].forEach((o, i) => {
        const h = physics.castRayAndGetNormal(new RAPIER.Ray({ x: cx + o, y: 2.5, z }, { x: 0, y: 1, z: 0 }), 10, true, undefined, undefined, player);
        const under = h ? 2.5 + h.timeOfImpact : null, clear = under === null ? null : +(under - ys[i]).toFixed(2);
        if (clear !== null) postedMin = Math.min(postedMin, clear);
        posted.push([z, +(cx + o).toFixed(2), ys[i], under === null ? null : +under.toFixed(2), clear, h ? +h.normal.y.toFixed(2) : null]);
      });
      headroom.vsPostedOverLidarDtm = { columns: ['z', 'x', 'dtmY', 'undersideY', 'clearanceM', 'undersideNormalY'], rows: posted, minClearanceM: +postedMin.toFixed(2), postedM: 4.4196, marginM: +(postedMin - 4.4196).toFixed(2),
        note: 'estimated underside (deck - 1.0 m) is consistent with a sign posted at or below the real clearance; not a surveyed height' };
      if (!(postedMin >= 4.4196)) failures.push(`bridge underside over the LiDAR road ${postedMin.toFixed(2)} m < posted 14'6" (4.42 m)`);
      bridge.headroomFullWidth = headroom;
      // The estimated median pier vs the carriageway lane envelopes (OSM line +-3.3 m).
      { const pc = bridgeWorld(DEAN_BRIDGE.pierU, 0), l = engineeringCourtLocal(pc.x, pc.z), t1 = engineeringCourtLocal(136, -360.4).t, t2 = engineeringCourtLocal(136, -369.6).t;
        const pierT = [l.t - DEAN_BRIDGE.pierSize / 2, l.t + DEAN_BRIDGE.pierSize / 2], lanes = [[t1 - 3.3, t1 + 3.3], [t2 - 3.3, t2 + 3.3]];
        const gap = Math.min(...lanes.map(([a, b]) => Math.max(a - pierT[1], pierT[0] - b)));
        bridge.pierVsLanes = { pierT: pierT.map(v => +v.toFixed(2)), lanesT: lanes.map(r => r.map(v => +v.toFixed(2))), minGapM: +gap.toFixed(2) };
        if (gap < 0.3) failures.push(`bridge pier within 0.3 m of a carriageway lane envelope (${gap.toFixed(2)} m)`);
      }
      // Mount and a 90-degree turn on the deck (player body moved temporarily, then restored).
      const body = player.parent(); const saved = body ? { ...body.translation() } : null;
      const mid = bridgeWorld(30, 0), midY = phys(mid.x, mid.z, 12, 10)!;
      let mount: unknown = null, turn: unknown = null;
      if (body) {
        body.setTranslation({ x: mid.x, y: midY + 0.905, z: mid.z }, true); physics.propagateModifiedBodyPositionsToColliders();
        query.prepare(roots, body.translation(), () => true);
        const m = clearance.canMount(0); mount = { allowed: m.allowed, reason: m.blockedReason, groundY: m.support?.groundY ?? null };
        const tr = clearance.traceMove({ center: { x: mid.x, y: midY + 0.905, z: mid.z }, heading: 0 }, { x: 0, z: 0 }, Math.PI / 2); turn = { fraction: tr.fraction, reason: tr.blockedReason };
        if (!m.allowed) failures.push(`bridge: scooter mount on the deck refused (${m.blockedReason})`);
        if (tr.fraction < 0.999) failures.push(`bridge: 90 deg turn on the deck blocked (${tr.blockedReason})`);
      }
      bridge.mountAndTurn = { at: [+mid.x.toFixed(1), +midY.toFixed(2), +mid.z.toFixed(1)], mount, turn };
      // Flight landings above and below; low flight under the span (the game's ground-follow probe + KCC sweep).
      const roadUnder = (() => { const { t } = engineeringCourtLocal(136, -369.6); return engineeringCourtPoint(93.2, t); })();
      const roadY = phys(roadUnder.x, roadUnder.z, 4, 6)!;
      const deckP = bridgeWorld(30, 0), deckY = phys(deckP.x, deckP.z, 12, 10)!;
      const above = findFlightLanding(physics, player, { x: deckP.x, y: deckY + 15, z: deckP.z }), below = findFlightLanding(physics, player, { x: roadUnder.x, y: roadY + 2.6, z: roadUnder.z });
      const landings = { aboveDeck: { from: +(deckY + 15).toFixed(2), target: above?.toArray().map(v => +v.toFixed(2)) ?? null, expectY: +(deckY + 0.905).toFixed(2) },
        belowSpan: { from: +(roadY + 2.6).toFixed(2), target: below?.toArray().map(v => +v.toFixed(2)) ?? null, expectY: +(roadY + 0.905).toFixed(2) } };
      if (!above || Math.abs(above.y - (deckY + 0.905)) > 0.12) failures.push(`bridge: flight landing above the deck ${JSON.stringify(landings.aboveDeck)}`);
      if (!below || Math.abs(below.y - (roadY + 0.905)) > 0.12) failures.push(`bridge: flight landing below the span ${JSON.stringify(landings.belowSpan)}`);
      bridge.flightLandings = landings;
      let lowFlight: Record<string, unknown> = { skipped: 'no player body' };
      const ownBridge = new Set<number>((scene.blocks.installs.find((x: { id: string }) => x.id === 'b01-eer')?.colliders ?? []).map((k: { handle: number }) => k.handle));
      if (body) {
        const { t } = engineeringCourtLocal(136, -369.6), start = engineeringCourtPoint(70, t), end = engineeringCourtPoint(116, t);
        const g0 = phys(start.x, start.z, 6, 10)!; body.setTranslation({ x: start.x, y: g0 + 0.905 + 3, z: start.z }, true); physics.propagateModifiedBodyPositionsToColliders();
        const dir = end.clone().sub(start).setY(0).normalize(), speed = 28;
        let maxY = -Infinity, liftUnder = 0, blockedFrames = 0, frames = 0, passed = false, penetrations = 0;
        for (; frames < 400; frames++) {
          const p = body.translation(), delta = { x: dir.x * speed * dt, y: 0, z: dir.z * speed * dt };
          let floorY = -Infinity;
          for (const distance of [0, 5.6, 11.2]) {
            const x = p.x + dir.x * distance, z = p.z + dir.z * distance, fromY = p.y + 2;
            const h = physics.castRayAndGetNormal(new RAPIER.Ray({ x, y: fromY, z }, down), 18, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, player, body);
            if (h && h.normal.y > 0.65) floorY = Math.max(floorY, fromY - h.timeOfImpact);
          }
          if (Number.isFinite(floorY)) { const lift = THREE.MathUtils.clamp((floorY + 0.905 + 3 - p.y) * 4, 0, 20); delta.y = Math.max(delta.y, lift * dt); }
          const uv = bridgeUV(p.x, p.z), underSpan = Math.abs(uv.v) < 4 && uv.u > 0 && uv.u < 53;
          if (underSpan && delta.y > 0.01) liftUnder++;
          controller.computeColliderMovement(player, delta, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
          const m = controller.computedMovement(), ratio = Math.hypot(m.x, m.z) / Math.hypot(delta.x, delta.z);
          if (ratio < 0.5) blockedFrames++;
          body.setTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z }, true); physics.propagateModifiedBodyPositionsToColliders();
          maxY = Math.max(maxY, p.y + m.y);
          let inside = false;
          physics.intersectionsWithShape(body.translation(), { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Capsule(0.54, 0.33), (k: { handle: number }) => { if (ownBridge.has(k.handle)) { inside = true; return false; } return true; }, undefined, undefined, player);
          if (inside) penetrations++;
          if (bridgeUV(p.x + m.x, p.z + m.z).v > 8) { passed = true; break; }
          if (blockedFrames > 30) break;
        }
        const end2 = body.translation(), deckHere = bridgeDeckY(22);
        lowFlight = { hoverCentreAboveRoad: 3.905, startY: +(g0 + 3.905).toFixed(2), maxCentreY: +maxY.toFixed(2), deckYHere: +deckHere.toFixed(2), undersideYHere: +(deckHere - DEAN_BRIDGE.structure).toFixed(2),
          passedUnder: passed, framesWithLiftUnderSpan: liftUnder, blockedFrames, frames, end: [+end2.x.toFixed(1), +end2.y.toFixed(2), +end2.z.toFixed(1)],
          note: 'game.ts ground-follow probe (from Y+2, normal.y>0.65, target floor+0.905+3) + KCC sweep. Capsule top at hover = road+4.79 vs underside road+~4.7: the span is a real obstacle at that hover height.' };
        lowFlight.capsuleInsideBridgeFrames = penetrations;
        lowFlight.outcome = !passed ? 'stopped' : (maxY > deckHere + 0.905 ? 'auto-lifted over the deck (ground-follow saw the deck ahead)' : 'flew under the span');
        // Never allowed: the capsule inside the bridge structure, or stuck under it.
        if (penetrations || !passed) failures.push(`bridge: low flight ${JSON.stringify(lowFlight)}`);
      }
      bridge.lowFlightUnder = lowFlight;
      if (body && saved) { body.setTranslation(saved, true); physics.propagateModifiedBodyPositionsToColliders(); }
      controller.free?.();
      // Asphalt / finish under the bridge vs 15 m east on the same carriageway (first visible surface below Y5).
      const finishes: unknown[] = [];
      for (const [name, zc] of lines.slice(1, 3)) {
        const { t } = engineeringCourtLocal(136, zc);
        for (const sv of [93.2, 108.2]) { const p = engineeringCourtPoint(sv, t), h = vis(p.x, p.z, 5, 10); finishes.push({ line: name, s: sv, underBridge: sv === 93.2, first: h?.object.name ?? null, y: h ? +h.point.y.toFixed(2) : null }); }
      }
      bridge.finishBelow = finishes;
      // Map travel to the deck midpoint: reported only (map-travel's terrain+5 probe has no bridge layer).
      bridge.mapTravelToDeck = travel([deckP.x, deckP.z]);
      report.deanKeetonBridge = bridge;
    }
  }

  // 11. District D01 (petroleum.ts): CPE 732885:1230 / ETC 506548:211 authored bodies.
  //     a) both replacements committed (otherwise the generated massing fallback is drawn);
  //     b) every petroleum SOLID vertex lies inside its own measured ring (CPE record ring; ETC massing tier rings)
  //        within 0.05 m: nothing projects outward over walks;
  //     c) absolute heights vs the 2017 LiDAR (independent of the code constants): CPE parapet rim (DSM edge cells
  //        26.0–27.0), CPE west / east plant tiers (DSM 29–30), ETC upper tier (45.1, probe above);
  //     d) standing capsules 0.45 m outside every CPE / ETC wall at local grade: no petroleum collider;
  //     e) facade content present (punched windows, notch glazing, ETC bands).
  {
    const d01: Record<string, unknown> = {};
    const install = scene.blocks.installs.find((x: { id: string }) => x.id === 'b01-eer');
    const committed = (scene.blocks.replacements?.committed ?? {}) as Record<string, string>;
    for (const key of ['732885:1230', '506548:211']) if (committed[key] !== 'b01-eer') failures.push(`D01: replacement ${key} not committed (fallback massing drawn)`);
    const pst = install?.install?.stats?.petroleum as { cpe?: { punched: number; notchGlazing: number; attic: number }; etc?: { bands: number; columns: number }; solidTriangles?: number; detailTriangles?: number; draws?: number; ms?: number } | undefined;
    d01.stats = pst;
    if (!pst?.cpe || pst.cpe.punched < 100 || pst.cpe.notchGlazing < 2 || !pst.etc || pst.etc.bands < 40) failures.push(`D01: facade content missing ${JSON.stringify({ cpe: pst?.cpe, etc: pst?.etc })}`);
    type R2 = [number, number][];
    const cpeRing = (scene.world.data.buildings.find((b: { key?: string }) => b.key === '732885:1230')?.rings[0] ?? []) as R2;
    const etcRings = ((b01Context as unknown as { massing: Record<string, { volumes: { ring?: R2 }[] }> }).massing['506548'].volumes.map(v => v.ring).filter(Boolean)) as R2[];
    const inR = (x: number, z: number, r: R2) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
    const segD = (px: number, pz: number, a: number[], b: number[]) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l)) : 0; return Math.hypot(a[0] + t * dx - px, a[1] + t * dz - pz); };
    const near = (x: number, z: number, r: R2) => inR(x, z, r) || r.some((p, i) => segD(x, z, p, r[(i + 1) % r.length]) <= 0.05);
    let verts = 0, outside = 0; const outEx: number[][] = [];
    for (const s of (install?.install?.solids ?? []) as THREE.Mesh[]) {
      if (!/petroleum/.test(s.name)) continue;
      const p = s.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); verts++;
        if (!near(x, z, cpeRing) && !etcRings.some(r => near(x, z, r))) { outside++; if (outEx.length < 5) outEx.push([+x.toFixed(2), +p.getY(i).toFixed(2), +z.toFixed(2)]); } }
    }
    d01.footprint = { solidVertices: verts, outsideRings: outside, examples: outEx };
    if (!verts || outside) failures.push(`D01: ${outside}/${verts} petroleum solid vertices outside the measured rings, e.g. ${JSON.stringify(outEx)}`);
    // c) absolute heights (rays from above, all colliders)
    const southMid = [(59.58 + 130.21) / 2, (-434.76 + -428.38) / 2], inward = [0.0899, -0.996]; // unit normal into the ring
    const probes: [string, number, number, number, number][] = [
      ['CPE parapet rim (LiDAR DSM edge cells 26.0–27.0)', southMid[0] + inward[0] * 0.15, southMid[1] + inward[1] * 0.15, 26.5, 0.6],
      ['CPE west plant tier (LiDAR 29–30; massing 29.4)', 72, -455, 29.4, 0.6],
      ['CPE east plant tier (LiDAR 30–31; massing 30.2)', 126, -452, 30.2, 0.6],
    ];
    d01.heights = probes.map(([label, x, z, want, tol]) => { const y = top(x, z); if (y === null || Math.abs(y - want) > tol) failures.push(`D01 ${label}: built ${y} vs ${want}`); return { label, builtY: y === null ? null : +y.toFixed(2), targetY: want }; });
    // d) walk clearance along every wall
    const pet = new Set<number>(((install?.colliders ?? []) as { handle: number }[]).slice(-1).map(k => k.handle)); // petroleum collider is the last one
    const shape = new RAPIER.Capsule(0.5, 0.3); let caps = 0, hit = 0; const hitEx: number[][] = [];
    for (const r of [cpeRing, ...etcRings.slice(0, 2)]) {
      const area = r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) > 0 ? 1 : -1;
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1) continue;
        const nx = area * (b[1] - a[1]) / L, nz = area * -(b[0] - a[0]) / L;
        for (let s = 0.5; s < L - 0.5; s += 2) {
          const x = a[0] + (b[0] - a[0]) * s / L + nx * 0.45, z = a[1] + (b[1] - a[1]) * s / L + nz * 0.45;
          if (inR(x, z, cpeRing) || etcRings.some(rr => inR(x, z, rr))) continue; // concave corner: sample inside another part
          const h = physics.castRay(new RAPIER.Ray({ x, y: 80, z }, down), 100, true, undefined, undefined, player, undefined, (k: { handle: number }) => !pet.has(k.handle));
          if (!h) continue; const gy = 80 - h.timeOfImpact; caps++;
          let blocked = false;
          physics.intersectionsWithShape({ x, y: gy + 0.85, z }, { x: 0, y: 0, z: 0, w: 1 }, shape, (k: { handle: number }) => { if (pet.has(k.handle)) { blocked = true; return false; } return true; }, undefined, undefined, player);
          if (blocked) { hit++; if (hitEx.length < 5) hitEx.push([+x.toFixed(2), +gy.toFixed(2), +z.toFixed(2)]); }
        }
      }
    }
    d01.wallClearance = { capsules: caps, blockedByPetroleum: hit, examples: hitEx };
    if (caps < 50 || hit) failures.push(`D01: ${hit}/${caps} standing capsules beside CPE/ETC walls blocked by the petroleum collider ${JSON.stringify(hitEx)}`);
    report.d01Petroleum = d01;
  }
  return { ok: failures.length === 0, report, failures };
};
