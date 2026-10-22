import * as THREE from 'three';
import type { CutVolume } from './clip-volume';

/** Actual authored paving buffers, not a reconstructed or padded path mask. */
export type SpeedwaySupportStrip = {
  positions: readonly number[];
  indices: readonly number[];
};

/** These masks trim only the obsolete EPS-owned planting-ground layer.
 * They are never registered as source/scan cuts. Every removed X/Z point is
 * vertically backed by a triangle of the existing paved route, unchanged.
 */
export function buildSpeedwayYardPriorityVolumes(strips: readonly SpeedwaySupportStrip[]) {
  const volumes: CutVolume[] = [];
  for (const strip of strips) for (let i = 0; i < strip.indices.length; i += 3) {
    const points = [0, 1, 2].map(j => {
      const index = strip.indices[i + j] * 3;
      return new THREE.Vector3(strip.positions[index], strip.positions[index + 1], strip.positions[index + 2]);
    });
    // Only walkable, finite top triangles provide ground support.
    if (points.some(p => !Number.isFinite(p.x + p.y + p.z))) throw new Error('Non-finite Speedway support triangle');
    const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
    if (normal.lengthSq() < 1e-14 || Math.abs(normal.normalize().y) < .95)
      throw new Error('Speedway yard priority requires supported paving top triangles');
    const center = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / 3);
    const planes = points.map((point, j) => {
      const next = points[(j + 1) % points.length];
      const n = new THREE.Vector3(next.z - point.z, 0, point.x - next.x).normalize();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, point);
      if (plane.distanceToPoint(center) > 0) plane.negate();
      return plane;
    });
    const bounds = new THREE.Box3().setFromPoints(points);
    // Bounded vertically around the pavement. The EPS yard is a heightfield;
    // these limits cannot change any building, planting prop or source tile.
    bounds.min.y -= 1; bounds.max.y += 10;
    planes.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), bounds.min.y),
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -bounds.max.y));
    volumes.push({ planes, bounds });
  }
  return volumes;
}
