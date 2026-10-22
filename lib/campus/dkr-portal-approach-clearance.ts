import * as THREE from 'three';
import type { CutVolume } from './clip-volume';
import plan from './dkr-forecourt-plan.json' with { type: 'json' };

/** Join the bounded forecourt clearance to the existing recessed entrance.
 * This only clears retained source within the fully supported portal approach;
 * it creates no ground and leaves the tree-row clearance boundaries unchanged. */
export function buildDkrPortalApproachClearance(): CutVolume[] {
  const portal = plan.portal;
  const start = portal.leftZ + 0.10, end = portal.rightZ - 0.10;
  const westX = 318.30;
  const slope = (portal.frontXAtRight - portal.frontXAtLeft) / (portal.rightZ - portal.leftZ);
  // The +0.12 m overlaps the existing portal source cut beyond its actual
  // front floor edge, avoiding another knife-edge source strip at that seam.
  const eastAt = (z: number) => portal.frontXAtLeft + (z - portal.leftZ) * slope + 0.12;
  const ring = [
    new THREE.Vector3(westX, 0, start),
    new THREE.Vector3(eastAt(start), 0, start),
    new THREE.Vector3(eastAt(end), 0, end),
    new THREE.Vector3(westX, 0, end),
  ];
  // Matches the existing portal's backed source-clearance vertical envelope.
  const low = portal.groundY - 0.29, high = portal.groundY + 4.95 + 0.29;
  const bounds = new THREE.Box3().setFromPoints(ring);
  bounds.min.y = low; bounds.max.y = high;
  const planes = ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const normal = new THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize();
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, a);
  });
  planes.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), low), new THREE.Plane(new THREE.Vector3(0, 1, 0), -high));
  return [{ bounds, planes }];
}
