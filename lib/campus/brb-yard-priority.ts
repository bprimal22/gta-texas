import * as T from 'three';
import plan from '../../public/data/mall-buildings-plan.json' with { type: 'json' };
import type { CutVolume } from './clip-volume';

/** Existing BRB planting cells have both visible and solid floors. These
 * ownership volumes remove only generic Speedway grass/seams above them; they
 * are never photographic source cuts. Use after all building datum queries. */
export function brbYardGroundPriority(): CutVolume[] {
  const building = plan.buildings.find(b => b.abbr === 'BRB');
  if (!building) throw new Error('BRB yard plan is unavailable');
  return building.yards.flatMap(rings => {
    const contours = rings.map(ring => ring.map(p => new T.Vector2(p[0], p[1])));
    const vertices = contours.flat();
    return T.ShapeUtils.triangulateShape(contours[0], contours.slice(1)).flatMap(ids => {
      const p = ids.map(i => new T.Vector3(Math.fround(vertices[i].x), 0, Math.fround(vertices[i].y)));
      if (new T.Triangle(p[0], p[1], p[2]).getArea() < 1e-10) return [];
      const center = p.reduce((sum, v) => sum.add(v), new T.Vector3()).multiplyScalar(1 / 3);
      const planes = p.map((a, i) => {
        const edge = p[(i + 1) % 3].clone().sub(a);
        const plane = new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(edge.z, 0, -edge.x).normalize(), a);
        if (plane.distanceToPoint(center) > 0) plane.negate();
        return plane;
      });
      const bounds = new T.Box3().setFromPoints(p);
      bounds.min.y = -1000; bounds.max.y = 1000;
      return [{ planes, bounds }];
    });
  });
}


function insideRing(x: number, z: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function inBrbYard(x: number, z: number): boolean {
  return plan.buildings.find(b => b.abbr === 'BRB')!.yards.some(rings =>
    insideRing(x, z, rings[0]) && !rings.slice(1).some(ring => insideRing(x, z, ring)));
}

/** The shared legacy callback switches to distant Central Mall at X<0. BRB's
 * small west strip belongs to the Speedway/MLK grade on BOTH sides of that
 * arbitrary axis. Change that strip after original building datums are fixed.
 * Every original triangle/UV/footprint is retained, including other buildings. */
export function correctBrbYardGround(source: T.BufferGeometry, height: (x: number, z: number) => number): T.BufferGeometry | null {
  const position = source.attributes.position;
  const count = source.index?.count ?? position.count;
  const faces: number[][] = [], vertices = new Set<number>();
  for (let i = 0; i < count; i += 3) {
    const ids = [0, 1, 2].map(j => source.index ? source.index.getX(i + j) : i + j);
    const x = ids.reduce((v, j) => v + position.getX(j), 0) / 3;
    const z = ids.reduce((v, j) => v + position.getZ(j), 0) / 3;
    if (x < -6 || x >= 0 || z < 77.34 || z > 120.07) continue;
    // EPS cells 549/550 and their northern neighbors survive immediately east
    // of the real paving mask. They share this connected strip and the same
    // obsolete X<0 datum; they must meet BRB rather than form a second wall.
    const easternEps = z <= 98.75 && plan.buildings.find(b => b.abbr === 'EPS')!.yards.some(rings =>
      insideRing(x, z, rings[0]) && !rings.slice(1).some(ring => insideRing(x, z, ring)));
    if (!inBrbYard(x, z) && !easternEps) continue;
    faces.push(ids);
    ids.forEach(j => { if (position.getX(j) < 0) vertices.add(j); });
  }
  if (!vertices.size) return null;
  const geometry = source.clone(), p = geometry.attributes.position, normals = geometry.attributes.normal;
  // This is one borrowed soil material. The accepted GAR replacement left a
  // stale group count; later region trims must see every retained triangle.
  geometry.clearGroups();
  for (const i of vertices) p.setY(i, height(p.getX(i), p.getZ(i)));
  for (const ids of faces) {
    const v = ids.map(i => new T.Vector3().fromBufferAttribute(p, i));
    const normal = new T.Triangle(v[0], v[1], v[2]).getNormal(new T.Vector3());
    ids.forEach(i => normals.setXYZ(i, normal.x, normal.y, normal.z));
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

/** Float32 cut intersections may collapse into vertical zero-area faces.
 * Remove only degeneracies in this new yard cut, preserving unrelated buffers. */
export function compactBrbGroundTriangles(geometry: T.BufferGeometry): void {
  const p = geometry.attributes.position, count = geometry.index?.count ?? p.count;
  const indices: number[] = [];
  for (let i = 0; i < count; i += 3) {
    const ids = [0, 1, 2].map(j => geometry.index ? geometry.index.getX(i + j) : i + j);
    const v = ids.map(j => new T.Vector3().fromBufferAttribute(p, j));
    const bounds = new T.Box3().setFromPoints(v);
    const withinCut = bounds.max.x >= -5.124 && bounds.min.x <= 87.546 &&
      bounds.max.z >= 77.344 && bounds.min.z <= 127.630;
    if (withinCut && v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).lengthSq() < 1e-14) continue;
    indices.push(...ids);
  }
  geometry.setIndex(indices);
  geometry.clearGroups();
}
