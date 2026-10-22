import * as THREE from 'three';
import type { CutVolume } from './clip-volume';

/** Source-only removal of measured protrusions in front of the already built
 * DKR apron, portal return and pier. The unbacked 11.5 cm lower jamb gap is
 * intentionally excluded; this does not substitute a whole facade cut. */
export function buildDkrEntranceFragmentClearance(): CutVolume[] {
  const boxes = [
    // Low wedge over the existing apron, in front of the south glazing bay.
    { min: [318.45, -8.65, 283.95], max: [319.58, -7.80, 286.12] },
    // Upper obsolete source column, with the existing continuous facade behind.
    { min: [319.08, -3.80, 281.62], max: [319.32, 11.10, 282.83] },
    // Lower sections separately backed by the portal return and the next pier.
    { min: [319.08, -8.40, 281.62], max: [319.32, -3.79, 282.020] },
    { min: [319.08, -8.40, 282.137], max: [319.32, -3.79, 282.83] },
  ];
  return boxes.map(({ min, max }) => ({
    bounds: new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)),
    planes: [
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), min[0]),
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -max[0]),
      new THREE.Plane(new THREE.Vector3(0, -1, 0), min[1]),
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -max[1]),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), min[2]),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -max[2]),
    ],
  }));
}
