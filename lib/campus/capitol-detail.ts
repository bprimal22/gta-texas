import * as THREE from 'three';

/** Projected from the same WGS84 origin as campus.json (east, up, south).
 * A ground-level 45 m loading sphere misses the Capitol's upper dome. This
 * separate focus encloses the whole landmark without refining all of Austin.
 */
export const CAPITOL_DETAIL_CENTER = new THREE.Vector3(-308, 42, 1266.5);
export const CAPITOL_DETAIL_RADIUS = 95;
export const CAPITOL_DETAIL_ERROR = .5;

/** Hysteresis avoids rebuilding tile priorities repeatedly at the boundary. */
export function capitolDetailNeeded(position: THREE.Vector3, active: boolean) {
  const distance = Math.hypot(position.x - CAPITOL_DETAIL_CENTER.x,
    position.z - CAPITOL_DETAIL_CENTER.z);
  return distance < (active ? 550 : 450);
}
