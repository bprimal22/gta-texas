import * as THREE from 'three';
import type { CutVolume } from './clip-volume';

// Northeast PCL lightwell edge. Plan alignment follows the mapped diagonal
// façade and the live scan's parapet ridge, checked against atlas L115/L118.
// Heights are local source-surface samples, not a measured architectural survey.
// This bounded repair does not cover the Speedway stair opening. Access to the
// recessed lower level is not validated by this repair.
export const pclParapetPoints = [
  [-117.64, 1.8, 302.97],
  [-111.55, 1.8, 301.31],
  [-104.49, 1.3, 309.51],
  [-97.43, 0.98, 317.72],
  [-90.37, 0.56, 325.92],
  [-87.6, 0.35, 330.64],
  [-84.83, 0.35, 335.39],
  [-86.57, 0.35, 339.08],
] as const;

export function buildPclParapet() {
  const points = pclParapetPoints.map((p) => new THREE.Vector3(...p));
  const walls: THREE.BufferGeometry[] = [];
  const paving: THREE.BufferGeometry[] = [];
  const coping: THREE.BufferGeometry[] = [];
  const volumes: CutVolume[] = [];
  const normals = points.map((p, i) => {
    const a = p.clone().sub(points[Math.max(0, i - 1)]).setY(0).normalize();
    const b = points[Math.min(points.length - 1, i + 1)]
      .clone().sub(p).setY(0).normalize();
    if (!a.lengthSq()) a.copy(b);
    if (!b.lengthSq()) b.copy(a);
    const n = new THREE.Vector3(a.z + b.z, 0, -a.x - b.x).normalize();
    return n.multiplyScalar(1 / Math.max(0.35, n.dot(new THREE.Vector3(b.z, 0, -b.x))));
  });
  let chainage = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const corner = (atEnd: boolean, offset: number, raise: number) =>
      (atEnd ? b : a).clone()
        .addScaledVector(normals[i + Number(atEnd)], offset)
        .add(new THREE.Vector3(0, raise, 0));
    const prism = (left: number, right: number, bottom: number, top: number) => {
      const c = [
        corner(false, left, bottom), corner(false, right, bottom),
        corner(true, right, bottom), corner(true, left, bottom),
        corner(false, left, top), corner(false, right, top),
        corner(true, right, top), corner(true, left, top),
      ];
      const positions: number[] = [], uv: number[] = [], indices: number[] = [];
      const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4],
        [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
      for (const face of faces) {
        const base = positions.length / 3;
        const facePoints = face.map((index) => c[index]);
        const width = facePoints[0].distanceTo(facePoints[1]);
        const height = facePoints[1].distanceTo(facePoints[2]);
        facePoints.forEach((p) => positions.push(...p.toArray()));
        uv.push(chainage / 2, 0, (chainage + width) / 2, 0,
          (chainage + width) / 2, height / 2, chainage / 2, height / 2);
        indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      return geometry;
    };
    // A real solid parapet prevents the scan's rounded wall from becoming a ramp.
    // The lower portion closes the retaining face rather than floating over it.
    walls.push(prism(-0.32, 0.32, -6, 0.94));
    coping.push(prism(-0.35, 0.35, 0.94, 1.04));
    paving.push(prism(0.32, 2.2, -0.25, 0.015));
    const outline = [corner(false, -1.65, 0), corner(false, 2.2, 0),
      corner(true, 2.2, 0), corner(true, -1.65, 0)];
    const center = a.clone().lerp(b, 0.5);
    const planes = outline.map((p, j) => {
      const edge = outline[(j + 1) % 4].clone().sub(p);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        new THREE.Vector3(edge.z, 0, -edge.x).normalize(), p);
      if (plane.distanceToPoint(center) > 0) plane.negate();
      // Overlap adjacent cuts slightly so no thin scan fence survives at joins.
      if (j === 0 || j === 2) plane.constant -= 0.04;
      return plane;
    });
    const bounds = new THREE.Box3().setFromPoints(outline).expandByScalar(0.06);
    bounds.min.y = Math.min(a.y, b.y) - 6.1;
    bounds.max.y = Math.max(a.y, b.y) + 1.6;
    planes.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), bounds.min.y),
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -bounds.max.y));
    volumes.push({ planes, bounds });
    chainage += length;
  }
  return { walls, paving, coping, volumes, length: chainage };
}
