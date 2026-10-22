import * as THREE from 'three';

export interface CutVolume {
  // Interior is the intersection of bounds and every negative half-space.
  // Bounds are a hard limit, including when footprint edges are degenerate.
  planes: THREE.Plane[];
  bounds: THREE.Box3;
}
type Vertex = { world: THREE.Vector3; attributes: number[][] };

function splitPolygon(polygon: Vertex[], plane: THREE.Plane) {
  const inside: Vertex[] = [],
    outside: Vertex[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    const distance = (v: Vertex) => {
      const d = plane.distanceToPoint(v.world);
      return Math.abs(d) < 1e-8 ? 0 : d;
    };
    const da = distance(a),
      db = distance(b);
    // A boundary vertex belongs to both output polygons. Dropping it from
    // either side creates cracks when adjacent cuts meet at a tile edge.
    if (da <= 0) inside.push(a);
    if (da >= 0) outside.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      const v = {
        world: a.world.clone().lerp(b.world, t),
        attributes: a.attributes.map((values, j) =>
          values.map((value, k) =>
            THREE.MathUtils.lerp(value, b.attributes[j][k], t),
          ),
        ),
      };
      inside.push(v);
      outside.push(v);
    }
  }
  return { inside, outside };
}

// Subtract a union of convex volumes without moving the remaining surfaces.
// Geometry and UVs are split at identical boundaries, so render and physics
// can consume the same result. No provider content is written to disk.
export function subtractVolumes(
  geometry: THREE.BufferGeometry,
  matrixWorld: THREE.Matrix4,
  volumes: CutVolume[],
): THREE.BufferGeometry | null {
  geometry.computeBoundingBox();
  const worldBounds = geometry.boundingBox!.clone().applyMatrix4(matrixWorld);
  const nearby = volumes.filter((v) => v.bounds.intersectsBox(worldBounds));
  if (!nearby.length) return null;
  const attributes = Object.entries(geometry.attributes);
  const output = attributes.map(() => [] as number[]);
  const groups: { start: number; count: number; materialIndex: number }[] = [];
  const count = geometry.index?.count ?? geometry.attributes.position.count;
  const sourceGroups = geometry.groups.length
    ? geometry.groups
    : [{ start: 0, count, materialIndex: 0 }];
  let changed = false;
  let outputCount = 0;
  const bounds = new THREE.Box3();
  const boundaryPlanes = [
    new THREE.Plane(new THREE.Vector3(-1, 0, 0)),
    new THREE.Plane(new THREE.Vector3(1, 0, 0)),
    new THREE.Plane(new THREE.Vector3(0, -1, 0)),
    new THREE.Plane(new THREE.Vector3(0, 1, 0)),
    new THREE.Plane(new THREE.Vector3(0, 0, -1)),
    new THREE.Plane(new THREE.Vector3(0, 0, 1)),
  ];
  const vertex = (index: number): Vertex => ({
    world: new THREE.Vector3()
      .fromBufferAttribute(geometry.attributes.position, index)
      .applyMatrix4(matrixWorld),
    attributes: attributes.map(([, attr]) =>
      Array.from({ length: attr.itemSize }, (_, component) =>
        attr.getComponent(index, component),
      ),
    ),
  });
  for (const group of sourceGroups) {
    const start = outputCount;
    for (
      let i = group.start;
      i < Math.min(count, group.start + group.count);
      i += 3
    ) {
      const triangle = [0, 1, 2].map((j) =>
        vertex(geometry.index ? geometry.index.getX(i + j) : i + j),
      );
      let polygons = [triangle];
      for (const volume of nearby) {
        const remainder: Vertex[][] = [];
        for (const polygon of polygons) {
          bounds.makeEmpty();
          for (const v of polygon) bounds.expandByPoint(v.world);
          if (!bounds.intersectsBox(volume.bounds)) {
            remainder.push(polygon);
            continue;
          }
          // A single separating plane proves the polygon misses this volume.
          if (
            volume.planes.some((plane) =>
              polygon.every((v) => plane.distanceToPoint(v.world) >= 0),
            )
          ) {
            remainder.push(polygon);
            continue;
          }
          let interior = polygon;
          const exterior: Vertex[][] = [];
          for (const plane of volume.planes) {
            if (interior.length < 3) break;
            const split = splitPolygon(interior, plane);
            if (split.outside.length >= 3) exterior.push(split.outside);
            interior = split.inside;
          }
          // The AABB above is only a broad-phase test. A triangle may span
          // both the intended cut and a distant building. Collinear footprint
          // edges can produce unbounded planes, so return any part outside
          // the declared box before removing the final interior. Valid bounded
          // cuts take the fast path and keep their existing triangulation.
          if (interior.length >= 3 && interior.some(v => !volume.bounds.containsPoint(v.world))) {
            const { min, max } = volume.bounds;
            const constants = [min.x, -max.x, min.y, -max.y, min.z, -max.z];
            for (let k = 0; k < boundaryPlanes.length; k++) {
              if (interior.length < 3) break;
              const plane = boundaryPlanes[k];
              plane.constant = constants[k];
              const split = splitPolygon(interior, plane);
              if (split.outside.length >= 3) exterior.push(split.outside);
              interior = split.inside;
            }
          }
          if (interior.length >= 3) changed = true;
          remainder.push(...exterior);
        }
        polygons = remainder;
        if (!polygons.length) break;
      }
      for (const polygon of polygons) {
        for (let j = 1; j < polygon.length - 1; j++) {
          const tri = [polygon[0], polygon[j], polygon[j + 1]];
          const ab = tri[1].world.clone().sub(tri[0].world),
            ac = tri[2].world.clone().sub(tri[0].world);
          if (ab.cross(ac).lengthSq() < 1e-14) continue;
          for (const v of tri)
            for (let k = 0; k < attributes.length; k++)
              output[k].push(...v.attributes[k]);
          outputCount += 3;
        }
      }
    }
    if (outputCount > start)
      groups.push({
        start,
        count: outputCount - start,
        materialIndex: group.materialIndex ?? 0,
      });
  }
  if (!changed) return null;
  const result = new THREE.BufferGeometry();
  for (let i = 0; i < attributes.length; i++) {
    const [name, attr] = attributes[i];
    result.setAttribute(
      name,
      new THREE.Float32BufferAttribute(output[i], attr.itemSize),
    );
  }
  result.groups = groups;
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}
