import * as THREE from 'three';
import type { CutVolume } from './clip-volume';
import { dkrWallX } from './dkr-frontage';
import plan from './dkr-frontage-plan.json' with { type: 'json' };

function boxVolume(min: number[], max: number[]): CutVolume {
  return {
    bounds: new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)),
    planes: [
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), min[0]),
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -max[0]),
      new THREE.Plane(new THREE.Vector3(0, -1, 0), min[1]),
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -max[1]),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), min[2]),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -max[2]),
    ],
  };
}

/** Complete the narrow solid jamb between the existing portal return and pier,
 * and clear the measured first foreground tree envelope above retained ground.
 * Borrows the existing DKR concrete material; the existing simple tree remains.
 */
export function buildDkrEntranceFinish(concrete: THREE.Material) {
  const nextPier = plan.piers[plan.portalBay + 1];
  const portalCentre = (plan.piers[plan.portalBay].z + nextPier.z) / 2;
  const gapStart = portalCentre + plan.portalWidth / 2 + .28;
  const gapEnd = nextPier.z - nextPier.width / 2;
  const gap = gapEnd - gapStart;
  if (gap <= 0 || gap > .20) throw new Error('DKR jamb calibration changed');

  // The 11.5 cm interval is a modeling gap outside the 7.5 m clear entrance.
  // Match the next pier web's front and overlap the old return at the rear.
  const front = -.635, back = .18;
  const bottom = plan.groundY - .60, top = plan.groundY + plan.portalHeight + .28;
  const start = gapStart - .008, end = gapEnd + .008;
  const geometry = new THREE.BoxGeometry(back - front, top - bottom, end - start);
  geometry.translate((front + back) / 2, (bottom + top) / 2, (start + end) / 2);
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) p.setX(i, dkrWallX(p.getZ(i)) + p.getX(i));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, concrete);
  mesh.name = 'DKR continuous south entrance jamb';
  mesh.castShadow = mesh.receiveShadow = true;

  // Fresh grid: X306 has no raised canopy; every Z288 column has only floor,
  // with the next tree appearing at Z291. Keep this first-tree envelope local.
  // Its base is above all measured street/apron floors, so no floor is removed.
  const canopy = boxVolume([306.25, -8.30, 277.5], [318.38, .50, 288.5]);
  // Source side-face remaining immediately above the portal cut. The existing
  // continuous pale/aggregate facade backs this entire small upper envelope.
  const upper = boxVolume([319.05, -3.80, 281.50], [319.70, 11.10, 282.84]);

  // Clear only within the new solid. Follow the measured wall shear instead of
  // cutting through the neighboring portal side or inferring a wider opening.
  const a = gapStart - .003, b = gapEnd + .003;
  const slope = (dkrWallX(b) - dkrWallX(a)) / (b - a);
  const at = (z: number, depth: number) => new THREE.Vector3(dkrWallX(a) + (z - a) * slope + depth, 0, z);
  const low = bottom + .004, high = top - .004;
  const west = front + .004, east = back - .004;
  const bounds = new THREE.Box3().setFromPoints([at(a, west), at(a, east), at(b, west), at(b, east)]);
  bounds.min.y = low; bounds.max.y = high;
  const westNormal = new THREE.Vector3(-1, 0, slope).normalize();
  const jamb: CutVolume = { bounds, planes: [
    new THREE.Plane().setFromNormalAndCoplanarPoint(westNormal, at(a, west)),
    new THREE.Plane().setFromNormalAndCoplanarPoint(westNormal.clone().negate(), at(a, east)),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), low),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -high),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), a),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -b),
  ] };

  const stats = {
    scope: 'DKR first foreground tree and entrance jamb only',
    triangles: 12, batches: 1, ownedGeometries: 1,
    ownedMaterials: 0, ownedTextures: 0, borrowedMaterials: 1,
    sourceVolumes: 3, retainedSimpleTrees: 1,
    jambGapWidth: gap, clearPortalWidth: plan.portalWidth,
    canopyFootprintM2: (318.38 - 306.25) * (288.5 - 277.5),
  };
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; mesh.removeFromParent(); geometry.dispose();
  };
  return { meshes: [mesh], colliderGeometries: [geometry], volumes: [canopy, upper, jamb], stats, dispose };
}
