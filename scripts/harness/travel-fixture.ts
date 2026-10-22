// Rapier fixture for map-travel arrivals: a capsule-safe floor under a roof is
// rejected, an open path is accepted as the fallback, an isolated overhead
// branch does not count as a roof, and flight can still land on the roof.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { travelLanding, overheadEnclosed, travelCandidates, outdoorPoint, TRAVEL_CANDIDATE_BUDGET } from '../../lib/campus/map-travel';
import type { CampusData } from '../../lib/campus/types';
import { findFlightLanding } from '../../lib/campus/flight-landing';
import type { Point } from '../../lib/campus/types';

export async function runTravelFixture() {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -24, z: 0 });
  const scene = new THREE.Group();
  // `ground` meshes join the visible support roots; tree parts are collider-only,
  // as in the game (tree LODs are not ground roots).
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, ground = true) => {
    world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y, z));
    if (!ground) return;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
    mesh.position.set(x, y, z);
    scene.add(mesh);
  };
  box(0, -0.5, 0, 80, 1, 80);          // floor, top at y = 0
  box(0, 5.2, 0, 20, 0.4, 20);         // closed atrium roof, 5 m clear headroom
  box(25, 4.2, 10, 6, 0.3, 0.3, false); // isolated branch over an open path
  scene.updateMatrixWorld(true);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(30, 20, -30));
  const player = world.createCollider(RAPIER.ColliderDesc.capsule(0.54, 0.34), body);
  world.step();
  const surface = (x: number, z: number, fromY: number, distance: number) =>
    new THREE.Raycaster(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0), 0, distance)
      .intersectObject(scene, true).find(h => h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y > .5) ?? null;
  const results: Record<string, unknown> = {};
  const fail: string[] = [];
  // 1. Under the roof: floor is found and the capsule fits, but the arrival is refused.
  const under = new THREE.Vector3(0, 0.905, 0);
  const fits = !world.intersectionWithShape(under, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Capsule(0.54, 0.34), undefined, undefined, player);
  const floorSeen = surface(0, 0, 5, 12)?.point.y;
  const outcome = { enclosed: false };
  const roofed = travelLanding(world, player, [0, 0], 0, surface, outcome);
  results.underRoof = { capsuleFits: fits, floorY: floorSeen, landing: roofed, enclosed: outcome.enclosed };
  if (!fits || floorSeen !== 0 || roofed || !outcome.enclosed) fail.push('roofed floor was not refused for the roof alone');
  // 2. Candidate order like CampusGame.updateTravel: first acceptable one wins.
  const candidates: Point[] = [[0, 0], [6, 2], [15, 0], [-3, 7]];
  const index = candidates.findIndex(p => travelLanding(world, player, p, 0, surface));
  results.fallback = { index, point: candidates[index] };
  if (index !== 2) fail.push(`expected open path candidate 2, got ${index}`);
  // 3. A branch overhead is not an enclosure.
  const branch = travelLanding(world, player, [25, 10], 0, surface);
  results.branch = { landing: branch?.toArray(), enclosed: overheadEnclosed(world, player, { x: 25, y: 0.905, z: 10 }) };
  if (!branch) fail.push('isolated branch wrongly blocked an open path');
  // 4. Flight still lands deliberately on the roof top.
  const roofLanding = findFlightLanding(world, player, { x: 0, y: 15, z: 0 });
  results.flightRoofLanding = roofLanding?.toArray();
  if (!roofLanding || Math.abs(roofLanding.y - (5.4 + 0.905)) > 0.05) fail.push('flight roof landing changed');
  // 5. No visible/physical ground: refused (the floor ends at |x| = 40).
  const noGround = travelLanding(world, player, [46, 0], 0, surface);
  results.noGround = noGround?.toArray() ?? null;
  if (noGround) fail.push('landed where there is no floor');
  // 6. Candidate search for a click inside an atrium whose nearest mapped
  // paths all run under the roof (GIS courtyard hole -8..8 inside a -12..12
  // building), with open floor beyond. Bounds clip the search.
  const square = (h: number): Point[] => [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]];
  const data = {
    bounds: [-40, -40, 40, 40], landmarks: {}, metadata: {}, origin: [0, 0],
    buildings: [{ id: 1, name: 'Atrium block', abbr: 'ATR', h: 12, center: [0, 0], rings: [square(12), square(8)] }],
    paths: [
      // A dense indoor corridor grid, as GDC's mapped footways run through its atrium.
      ...[-6, -3, 0, 3, 6].flatMap((c, i) => [
        { id: 10 + i, kind: 'footway', name: '', width: 2, area: false, points: [[-7, c], [7, c]] },
        { id: 20 + i, kind: 'footway', name: '', width: 2, area: false, points: [[c, -7], [c, 7]] },
      ]),
      { id: 3, kind: 'footway', name: '', width: 2, area: false, points: [[-30, 28], [30, 28]] },
    ],
  } as unknown as CampusData;
  const list = travelCandidates(data, [1, 1]);
  const legacy = list.slice(0, 24);
  const firstLanding = (points: Point[]) => {
    for (let i = 0; i < points.length; i++) { const l = travelLanding(world, player, points[i], 0, surface); if (l) return { i, l }; }
    return null;
  };
  const legacyLanding = firstLanding(legacy), found = firstLanding(list);
  results.atriumSearch = { candidates: list.length, legacyLanding: legacyLanding?.l.toArray() ?? null,
    landing: found?.l.toArray() ?? null, index: found?.i, offset: found ? Math.hypot(found.l.x - 1, found.l.z - 1) : null,
    enclosed: found ? overheadEnclosed(world, player, found.l) : null };
  if (legacyLanding) fail.push('fixture no longer reproduces the indoor-only nearest-candidate case');
  if (!found || overheadEnclosed(world, player, found.l) || Math.hypot(found.l.x - 1, found.l.z - 1) > 35) fail.push('broader search did not find a nearby open-sky landing');
  if (list.length > TRAVEL_CANDIDATE_BUDGET) fail.push('candidate budget exceeded');
  // 7. Bounds: nothing outside the campus bounds is offered or accepted.
  const outside = travelCandidates(data, [39, 39]).filter(p => !outdoorPoint(data, p));
  results.bounds = { offeredOutside: outside.length, outdoorFarPoint: outdoorPoint(data, [60, 0]) };
  if (outside.length || outdoorPoint(data, [60, 0])) fail.push('candidate outside bounds or a footprint');
  return { results, fail };
}
