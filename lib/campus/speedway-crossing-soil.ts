import * as THREE from 'three';
import type { CutVolume } from './clip-volume';

/** Existing paving, not a new terrain/source replacement. The East Mall's
 * temporary planting skirt crosses Speedway's northern entry at Z48. Remove
 * only the planting batch where actual, already-solid paving backs it.
 * The bounds enclose the two planting margins of this one mall crossing. */
export function speedwayCrossingSoilTrim(paving: readonly { positions: number[]; indices: number[] }[]): CutVolume[] {
  const volumes: CutVolume[] = [];
  const minZ = 46, maxZ = 79;
  for (const strip of paving) for (let i = 0; i < strip.indices.length; i += 3) {
    // Float32 is the actual rendered/native collider footprint. Never expand
    // it into the adjacent planting bed or infer support from a bounding box.
    const points = strip.indices.slice(i, i + 3).map(index => new THREE.Vector3(
      Math.fround(strip.positions[index * 3]), 0, Math.fround(strip.positions[index * 3 + 2]),
    ));
    const bounds = new THREE.Box3().setFromPoints(points);
    if (bounds.max.z < minZ || bounds.min.z > maxZ) continue;
    bounds.min.z = Math.max(bounds.min.z, minZ);
    bounds.max.z = Math.min(bounds.max.z, maxZ);
    bounds.min.y = -1000; bounds.max.y = 1000;
    const center = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / 3);
    const planes = points.map((p, j) => {
      const edge = points[(j + 1) % 3].clone().sub(p);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(edge.z, 0, -edge.x).normalize(), p);
      if (plane.distanceToPoint(center) > 0) plane.negate();
      return plane;
    });
    planes.push(new THREE.Plane(new THREE.Vector3(0, 0, -1), minZ),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -maxZ));
    volumes.push({ planes, bounds });
  }
  return volumes;
}
