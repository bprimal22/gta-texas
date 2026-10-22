import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CutVolume } from './clip-volume';
import type { pclMaterials } from './pcl-materials';
import { pclEntryPlan as plan } from './pcl-entry-plan';

type Point = { x: number; z: number };
const a = new THREE.Vector3(plan.faceA[0], 0, plan.faceA[1]);
const b = new THREE.Vector3(plan.faceB[0], 0, plan.faceB[1]);
const length = a.distanceTo(b), u = b.clone().sub(a).normalize();
const out = new THREE.Vector3(u.z, 0, -u.x);
const world = (along: number, depth: number): Point => ({
  x: a.x + u.x * along + out.x * depth,
  z: a.z + u.z * along + out.z * depth,
});
const alongAt = (p: Point) => (p.x - a.x) * u.x + (p.z - a.z) * u.z;
const rearAt = (along: number) => THREE.MathUtils.lerp(plan.rearStart, plan.rearEnd,
  (along - plan.start) / (plan.end - plan.start));
const terraceY = (p: Point) => .22 - .012 * (p.x + 70);
const apronY = (p: Point) => .365 - .35 * alongAt(p) / length;
// Join both existing surfaces without coplanar shimmer. No global grade or
// furniture adjustments: the lift is eight millimetres within this porch only.
export const pclEntryFloorY = (x: number, z: number) =>
  Math.max(terraceY({ x, z }), apronY({ x, z })) + plan.floorLift;

export function buildPclEntry(materials: ReturnType<typeof pclMaterials>) {
  const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  let triangles = 0;
  const add = (g: THREE.BufferGeometry, material: THREE.Material) => {
    if (!parts.has(material)) parts.set(material, []);
    parts.get(material)!.push(g);
  };
  const prism = (ring: Point[], low: (p: Point) => number,
    high: (p: Point) => number, material: THREE.Material) => {
    const positions: number[] = [];
    const vector = (p: Point, y: number) => new THREE.Vector3(p.x, y, p.z);
    const tri = (v0: THREE.Vector3, v1: THREE.Vector3, v2: THREE.Vector3,
      desired: THREE.Vector3) => {
      if (v1.clone().sub(v0).cross(v2.clone().sub(v0)).dot(desired) < 0)
        [v1, v2] = [v2, v1];
      for (const v of [v0, v1, v2]) positions.push(v.x, v.y, v.z);
    };
    const faces = THREE.ShapeUtils.triangulateShape(ring.map(p => new THREE.Vector2(p.x, p.z)), []);
    for (const face of faces) {
      const [p0, p1, p2] = face.map(i => ring[i]);
      tri(vector(p0, high(p0)), vector(p1, high(p1)), vector(p2, high(p2)), new THREE.Vector3(0, 1, 0));
      tri(vector(p0, low(p0)), vector(p1, low(p1)), vector(p2, low(p2)), new THREE.Vector3(0, -1, 0));
    }
    const center = ring.reduce<THREE.Vector3>((sum, p) => sum.add(new THREE.Vector3(p.x, 0, p.z)), new THREE.Vector3()).divideScalar(ring.length);
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      const desired = new THREE.Vector3((p.x + q.x) / 2, 0, (p.z + q.z) / 2).sub(center);
      tri(vector(p, low(p)), vector(q, low(q)), vector(q, high(q)), desired);
      tri(vector(p, low(p)), vector(q, high(q)), vector(p, high(p)), desired);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const uv: number[] = [], pos = geometry.attributes.position, normal = geometry.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const p = { x: pos.getX(i), z: pos.getZ(i) };
      // Existing brick shader consumes half-metre UVs; concrete uses metre UVs.
      const scale = material === materials.brick ? .5 : 1;
      uv.push(alongAt(p) * scale,
        (Math.abs(normal.getY(i)) > .5 ? (p.x - a.x) * out.x + (p.z - a.z) * out.z : pos.getY(i)) * scale);
    }
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    add(geometry, material);
  };
  const localRing = (start: number, end: number, front: number,
    back: (s: number) => number) => [world(start, front), world(end, front), world(end, back(end)), world(start, back(start))];
  const flat = (value: number) => () => value;
  const height = (p: Point) => pclEntryFloorY(p.x, p.z);
  const outerStart = plan.start - plan.sideThickness / 2;
  const outerEnd = plan.end + plan.sideThickness / 2;
  const floorRing = localRing(outerStart, outerEnd, plan.floorFront, s => rearAt(s) - plan.rearThickness / 2);
  // Split on the equality of the existing terrace and facade apron planes.
  // Both capped slabs share an exact seam; neither creates a steeper ramp.
  const split = (ring: Point[], sign: number) => {
    const result: Point[] = [];
    const distance = (p: Point) => sign * (terraceY(p) - apronY(p));
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length], dp = distance(p), dq = distance(q);
      if (dp >= 0) result.push(p);
      if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
        const t = dp / (dp - dq);
        result.push({ x: THREE.MathUtils.lerp(p.x, q.x, t), z: THREE.MathUtils.lerp(p.z, q.z, t) });
      }
    }
    return result;
  };
  for (const sign of [-1, 1]) prism(split(floorRing, sign), p => height(p) - plan.floorThickness, height, materials.brick);
  const roofRing = localRing(outerStart, outerEnd, plan.front, s => rearAt(s) - plan.rearThickness / 2);
  prism(roofRing, flat(plan.soffitY), flat(plan.soffitY + plan.roofThickness), materials.concrete);
  for (const center of [plan.start, plan.end])
    prism(localRing(center - plan.sideThickness / 2, center + plan.sideThickness / 2, plan.front,
      s => rearAt(s) - plan.rearThickness / 2), p => height(p) - plan.floorThickness, flat(plan.soffitY), materials.concrete);
  const backRing = [world(outerStart, rearAt(outerStart) + plan.rearThickness / 2),
    world(outerEnd, rearAt(outerEnd) + plan.rearThickness / 2),
    world(outerEnd, rearAt(outerEnd) - plan.rearThickness / 2),
    world(outerStart, rearAt(outerStart) - plan.rearThickness / 2)];
  // Closed rear wall keeps this an exterior-only space. Opaque reflective
  // panes sit on its front, with no fake see-through interior or open doors.
  prism(backRing, p => height(p) - plan.floorThickness, flat(plan.soffitY), materials.recess);
  const strip = (start: number, end: number, depth: (s: number) => number,
    thickness: number, low: (p: Point) => number, high: (p: Point) => number, material: THREE.Material) =>
    prism([world(start, depth(start) + thickness / 2), world(end, depth(end) + thickness / 2),
      world(end, depth(end) - thickness / 2), world(start, depth(start) - thickness / 2)], low, high, material);
  for (const t of plan.pierFractions) {
    const center = THREE.MathUtils.lerp(plan.start, plan.end, t);
    strip(center - plan.pierWidth / 2, center + plan.pierWidth / 2, flat(-.42), plan.pierDepth,
      height, flat(plan.soffitY), materials.concrete);
  }
  const glassDepth = (s: number) => rearAt(s) + .18;
  const frameDepth = (s: number) => rearAt(s) + .235;
  const glazingStart = plan.start + .44, glazingEnd = plan.end - .44;
  const bays = 18, pitch = (glazingEnd - glazingStart) / bays;
  for (let i = 0; i < bays; i++) {
    const s0 = glazingStart + i * pitch, s1 = s0 + pitch;
    strip(s0 + .035, s1 - .035, glassDepth, .045, p => height(p) + .08, flat(plan.soffitY - .18), materials.glass);
  }
  for (let i = 0; i <= bays; i++) {
    const s = glazingStart + i * pitch;
    strip(s - .035, s + .035, frameDepth, .065, height, flat(plan.soffitY - .13), materials.frame);
  }
  for (const level of [.04, plan.doorHeight])
    strip(glazingStart, glazingEnd, frameDepth, .075, p => height(p) + level, p => height(p) + level + .07, materials.frame);
  for (const t of plan.doorFractions) {
    const center = THREE.MathUtils.lerp(glazingStart, glazingEnd, t), half = plan.doorPairWidth / 2;
    for (const offset of [-half, 0, half])
      strip(center + offset - .035, center + offset + .035, s => frameDepth(s) + .015,
        .075, height, p => height(p) + plan.doorHeight, materials.frame);
    for (const offset of [-.16, .16])
      strip(center + offset - .018, center + offset + .018, s => frameDepth(s) + .10,
        .035, p => height(p) + .90, p => height(p) + 1.20, materials.frame);
  }
  // Photo-visible ceiling grid, deliberately simplified. Exact pitch/count
  // and the rear door subdivision are inferred, not photogrammetric claims.
  for (let s = plan.start + .7; s < plan.end - .4; s += plan.cofferPitch)
    strip(s - plan.cofferWidth / 2, s + plan.cofferWidth / 2,
      s0 => (plan.front + rearAt(s0)) / 2,
      plan.front - rearAt(s), flat(plan.soffitY - plan.cofferDepth), flat(plan.soffitY), materials.recess);
  for (let depth = -.45; depth > Math.min(plan.rearStart, plan.rearEnd) + .3; depth -= plan.cofferPitch) {
    // Stop the transverse rib at the slanted rear boundary.
    const start = Math.max(plan.start, plan.start + (depth - plan.rearStart - .20) * (plan.end - plan.start) / (plan.rearEnd - plan.rearStart));
    if (start < plan.end)
      strip(start, plan.end, flat(depth), plan.cofferWidth,
        flat(plan.soffitY - plan.cofferDepth), flat(plan.soffitY), materials.recess);
  }
  // Source clearance lies entirely inside the floor, side/rear closures, and
  // solid soffit. The sloping floor is NOT replaced by a floating rectangle.
  const cutRing = localRing(plan.start, plan.end, plan.front, s => rearAt(s));
  const low = Math.min(...cutRing.map(height)) - .12, high = plan.soffitY + .12;
  const center = cutRing.reduce<THREE.Vector3>((sum, p) => sum.add(new THREE.Vector3(p.x, (low + high) / 2, p.z)), new THREE.Vector3()).divideScalar(cutRing.length);
  const planes: THREE.Plane[] = [];
  for (let i = 0; i < cutRing.length; i++) {
    const p = cutRing[i], q = cutRing[(i + 1) % cutRing.length];
    const normal = new THREE.Vector3(q.z - p.z, 0, p.x - q.x).normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(p.x, 0, p.z));
    if (plane.distanceToPoint(center) > 0) plane.negate();
    planes.push(plane);
  }
  planes.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), low), new THREE.Plane(new THREE.Vector3(0, 1, 0), -high));
  const bounds = new THREE.Box3().setFromPoints(cutRing.flatMap(p => [new THREE.Vector3(p.x, low, p.z), new THREE.Vector3(p.x, high, p.z)]));
  const volumes: CutVolume[] = [{ planes, bounds }];
  const meshes: THREE.Mesh[] = [];
  for (const [material, geometries] of parts) {
    const geometry = mergeGeometries(geometries)!;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'PCL recessed entrance'; mesh.castShadow = mesh.receiveShadow = true;
    meshes.push(mesh); triangles += geometry.attributes.position.count / 3;
    for (const g of geometries) g.dispose();
  }
  return { meshes, volumes, floorRing, cutRing, floorY: pclEntryFloorY,
    stats: { triangles, meshes: meshes.length, piers: plan.pierFractions.length, doorPairs: plan.doorFractions.length } };
}
