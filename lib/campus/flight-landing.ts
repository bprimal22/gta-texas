import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export type LandingSurface = (x: number, z: number, fromY: number, distance: number) => { point: { y: number } } | null;
const FOOT = .905, NORMAL_Y = Math.cos(Math.PI / 5);
const identity = { x: 0, y: 0, z: 0, w: 1 };

/** Find a real, visible, capsule-sized landing patch below the player. Roofs
 * can qualify; walls, narrow ledges and mismatched scan floors cannot.
 * This only proposes a target. The game's character sweep owns every move.
 */
export function findFlightLanding(world: RAPIER.World, player: RAPIER.Collider,
  position: { x: number; y: number; z: number }, surface?: LandingSurface,
  preferred?: { x: number; z: number } | null): THREE.Vector3 | null {
  const fromY = position.y + .1, distance = 265;
  const probe = (x: number, z: number, y: number, length: number) => {
    const hit = world.castRayAndGetNormal(new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 }),
      length, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, player);
    if (!hit || hit.normal.y < NORMAL_Y) return null;
    const height = y - hit.timeOfImpact;
    if (surface) {
      const shown = surface(x, z, y, length);
      if (!shown || Math.abs(shown.point.y - height) > .08) return null;
    }
    return height;
  };
  const offsets: [number, number][] = [[0, 0]];
  if (preferred && Math.hypot(preferred.x - position.x, preferred.z - position.z) <= 5)
    offsets.unshift([preferred.x - position.x, preferred.z - position.z]);
  for (const radius of [1.2, 2.4, 4.8]) for (let i = 0; i < 8; i++)
    offsets.push([Math.cos(i * Math.PI / 4) * radius, Math.sin(i * Math.PI / 4) * radius]);
  for (const [dx, dz] of offsets) {
    const x = position.x + dx, z = position.z + dz, height = probe(x, z, fromY, distance);
    if (height === null || height + FOOT > position.y + .08) continue;
    let supported = true;
    for (const [a, b] of [[.3, 0], [-.3, 0], [0, .3], [0, -.3]]) {
      const y = probe(x + a, z + b, height + .6, 1.2);
      if (y === null || Math.abs(y - height) > .22) { supported = false; break; }
    }
    if (!supported) continue;
    const target = new THREE.Vector3(x, height + FOOT, z);
    if (world.intersectionWithShape(target, identity, new RAPIER.Capsule(.54, .34),
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, player)) continue;
    return target;
  }
  return null;
}
