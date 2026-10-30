/*!
 * Intersection routines adapted from three.js r185 Mesh.js.
 *
 * The MIT License
 *
 * Copyright © 2010-2026 three.js authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
import * as THREE from 'three';

type Position = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
type Keys = {
  position: Position; positionVersion: number; positionCount: number;
  index: THREE.BufferAttribute | null; indexVersion: number; indexCount: number;
};
type Grid = {
  /** Local vertex bounds, expanded by eps. */
  min: THREE.Vector3; max: THREE.Vector3; eps: number;
  cell: number; nx: number; nz: number;
  /** Compressed rows: triangles of cell k are items[start[k]..start[k + 1]), ascending. */
  start: Uint32Array; items: Uint32Array;
  /** Triangles spanning too many cells; candidates for every query (ascending). */
  wide: Uint32Array;
  stamp: Uint32Array; epoch: number;
};

const version = (a: Position) =>
  (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute
    ? (a as THREE.InterleavedBufferAttribute).data.version : (a as THREE.BufferAttribute).version;
const MIN_TRIANGLES = 64, MAX_QUERY_CELLS = 64, MAX_TRIANGLE_CELLS = 256;
const sphere = new THREE.Sphere(), sphereHit = new THREE.Vector3(), inverse = new THREE.Matrix4(), localRay = new THREE.Ray(),
  vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), point = new THREE.Vector3(), pointWorld = new THREE.Vector3();
/** Mesh's per-geometry triangle loop (three r185 Mesh.js); public in JS, absent from @types/three. */
type MeshInternals = { _computeIntersections(raycaster: THREE.Raycaster, intersects: THREE.Intersection[], ray: THREE.Ray): void };
const internals = (mesh: THREE.Mesh) => mesh as unknown as MeshInternals;
const ascSort = (a: THREE.Intersection, b: THREE.Intersection) => a.distance - b.distance;

function buildGrid(geometry: THREE.BufferGeometry, position: Position): Grid | null {
  const index = geometry.index, count = index ? index.count : position.count, triangles = Math.floor(count / 3);
  if (triangles < MIN_TRIANGLES) return null;
  const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const bounds = new Float64Array(triangles * 4).fill(NaN);
  for (let t = 0; t < triangles; t++) {
    const j = t * 3;
    vA.fromBufferAttribute(position, index ? index.getX(j) : j);
    vB.fromBufferAttribute(position, index ? index.getX(j + 1) : j + 1);
    vC.fromBufferAttribute(position, index ? index.getX(j + 2) : j + 2);
    // A non-finite vertex never intersects (Ray.intersectTriangle returns null), so it gets no cell.
    if (![vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z].every(Number.isFinite)) continue;
    bounds[t * 4] = Math.min(vA.x, vB.x, vC.x); bounds[t * 4 + 1] = Math.max(vA.x, vB.x, vC.x);
    bounds[t * 4 + 2] = Math.min(vA.z, vB.z, vC.z); bounds[t * 4 + 3] = Math.max(vA.z, vB.z, vC.z);
    min.min(vA).min(vB).min(vC); max.max(vA).max(vB).max(vC);
  }
  if (!Number.isFinite(min.x)) return null;
  // Intersection points are rounded; never exclude a triangle by a box that is exact to the last bit.
  const eps = 1e-6 * Math.max(1, ...min.toArray().map(Math.abs), ...max.toArray().map(Math.abs));
  min.subScalar(eps); max.addScalar(eps);
  const n = Math.min(256, Math.max(1, Math.ceil(Math.sqrt(triangles / 2))));
  const cell = Math.max(max.x - min.x, max.z - min.z) / n;
  const nx = Math.floor((max.x - min.x) / cell) + 1, nz = Math.floor((max.z - min.z) / cell) + 1;
  const range = (t: number) => {
    const i0 = Math.floor((bounds[t * 4] - eps - min.x) / cell), i1 = Math.floor((bounds[t * 4 + 1] + eps - min.x) / cell);
    const j0 = Math.floor((bounds[t * 4 + 2] - eps - min.z) / cell), j1 = Math.floor((bounds[t * 4 + 3] + eps - min.z) / cell);
    return [Math.max(0, i0), Math.min(nx - 1, i1), Math.max(0, j0), Math.min(nz - 1, j1)];
  };
  const start = new Uint32Array(nx * nz + 1), wide: number[] = [];
  for (let pass = 0; pass < 2; pass++) {
    const fill = pass === 1 ? start.slice(0, -1) : null, items = pass === 1 ? new Uint32Array(start[nx * nz]) : null;
    for (let t = 0; t < triangles; t++) {
      if (Number.isNaN(bounds[t * 4])) continue;
      const [i0, i1, j0, j1] = range(t);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > MAX_TRIANGLE_CELLS) { if (pass === 0) wide.push(t); continue; }
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const k = i * nz + j;
        if (fill && items) items[fill[k]++] = t; else start[k + 1]++;
      }
    }
    if (pass === 0) for (let k = 0; k < nx * nz; k++) start[k + 1] += start[k];
    else return {
      min, max, eps, cell, nx, nz, start, items: items!, wide: Uint32Array.from(wide),
      stamp: new Uint32Array(triangles), epoch: 0,
    };
  }
  return null;
}

/** Exact drop-in for Raycaster.intersectObject(s) (three r185) for repeated ground probes over large, mostly static
 * meshes: the same traversal (layers, recursion), Mesh.raycast early-outs, groups/drawRange, material sides, hit records
 * and distance sort. A plain mesh only runs the identical triangle test on the triangles whose local XZ bounds can
 * contain the ray's local footprint (a per-geometry grid, rebuilt when its position or index attribute is replaced,
 * resized or flagged needsUpdate). Other objects, morphs, unaligned groups and non-near-vertical local rays use three. */
export class VerticalRaycast {
  private grids = new WeakMap<THREE.BufferGeometry, Keys & { grid: Grid | null }>();
  readonly stats = { meshes: 0, accelerated: 0, gridBuilds: 0, gridBuildMs: 0, triangleTests: 0 };

  intersectObject(raycaster: THREE.Raycaster, object: THREE.Object3D, recursive = true, intersects: THREE.Intersection[] = []) {
    this.intersect(object, raycaster, intersects, recursive);
    return intersects.sort(ascSort);
  }

  intersectObjects(raycaster: THREE.Raycaster, objects: THREE.Object3D[], recursive = true, intersects: THREE.Intersection[] = []) {
    for (let i = 0, l = objects.length; i < l; i++) this.intersect(objects[i], raycaster, intersects, recursive);
    return intersects.sort(ascSort);
  }

  private intersect(object: THREE.Object3D, raycaster: THREE.Raycaster, intersects: THREE.Intersection[], recursive: boolean) {
    let propagate = true;
    if (object.layers.test(raycaster.layers)) {
      const mesh = object as THREE.Mesh;
      const result = mesh.isMesh && mesh.raycast === THREE.Mesh.prototype.raycast ? this.raycastMesh(mesh, raycaster, intersects)
        : object.raycast(raycaster, intersects);
      if ((result as unknown) === false) propagate = false;
    }
    if (propagate && recursive) {
      const children = object.children;
      for (let i = 0, l = children.length; i < l; i++) this.intersect(children[i], raycaster, intersects, true);
    }
  }

  private grid(geometry: THREE.BufferGeometry) {
    const position = geometry.getAttribute('position') as Position | undefined, index = geometry.index;
    if (!position) return null;
    const keys: Keys = { position, positionVersion: version(position), positionCount: position.count,
      index, indexVersion: index?.version ?? -1, indexCount: index?.count ?? -1 };
    const old = this.grids.get(geometry);
    if (old && (Object.keys(keys) as (keyof Keys)[]).every(k => old[k] === keys[k])) return old.grid;
    const began = performance.now();
    const grid = buildGrid(geometry, position);
    this.stats.gridBuilds++;
    this.stats.gridBuildMs += performance.now() - began;
    this.grids.set(geometry, { ...keys, grid });
    return grid;
  }

  /** THREE.Mesh.prototype.raycast with a narrowed triangle loop. */
  private raycastMesh(mesh: THREE.Mesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
    const geometry = mesh.geometry, material = mesh.material, matrixWorld = mesh.matrixWorld;
    this.stats.meshes++;
    if (material === undefined) return;
    if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
    sphere.copy(geometry.boundingSphere!).applyMatrix4(matrixWorld);
    localRay.copy(raycaster.ray).recast(raycaster.near);
    if (sphere.containsPoint(localRay.origin) === false) {
      if (localRay.intersectSphere(sphere, sphereHit) === null) return;
      if (localRay.origin.distanceToSquared(sphereHit) > (raycaster.far - raycaster.near) ** 2) return;
    }
    inverse.copy(matrixWorld).invert();
    localRay.copy(raycaster.ray).applyMatrix4(inverse);
    if (geometry.boundingBox !== null && localRay.intersectsBox(geometry.boundingBox) === false) return;
    const candidates = this.plainMesh(mesh) ? this.candidates(geometry, localRay) : undefined;
    if (!candidates) { internals(mesh)._computeIntersections(raycaster, intersects, localRay); return; }
    this.stats.accelerated++;
    const index = geometry.index, position = geometry.attributes.position;
    const count = index ? index.count : position.count, drawRange = geometry.drawRange;
    const ranges = Array.isArray(material)
      ? geometry.groups.map(group => ({ start: Math.max(group.start, drawRange.start),
        end: Math.min(count, Math.min(group.start + group.count, drawRange.start + drawRange.count)),
        material: material[group.materialIndex!], materialIndex: group.materialIndex as number | undefined }))
      : [{ start: Math.max(0, drawRange.start), end: Math.min(count, drawRange.start + drawRange.count), material, materialIndex: undefined }];
    // three steps j = start, start + 3, ...: only triangle-aligned starts map onto whole cached triangles.
    if (ranges.some(r => r.start % 3 !== 0)) { internals(mesh)._computeIntersections(raycaster, intersects, localRay); return; }
    const uv = geometry.attributes.uv, uv1 = geometry.attributes.uv1, normal = geometry.attributes.normal;
    for (const range of ranges) {
      for (const t of candidates) {
        const j = t * 3;
        if (j < range.start || j >= range.end) continue;
        const a = index ? index.getX(j) : j, b = index ? index.getX(j + 1) : j + 1, c = index ? index.getX(j + 2) : j + 2;
        this.stats.triangleTests++;
        const hit = this.checkGeometryIntersection(mesh, range.material, raycaster, localRay, uv, uv1, normal, a, b, c);
        if (!hit) continue;
        hit.faceIndex = Math.floor(j / 3);
        if (range.materialIndex !== undefined) hit.face!.materialIndex = range.materialIndex;
        intersects.push(hit);
      }
    }
  }

  private plainMesh(mesh: THREE.Mesh) {
    return internals(mesh)._computeIntersections === (THREE.Mesh.prototype as unknown as MeshInternals)._computeIntersections
      && mesh.getVertexPosition === THREE.Mesh.prototype.getVertexPosition
      && !mesh.geometry.morphAttributes.position;
  }

  /** Ascending candidate triangles whose bounds may contain the local ray inside the geometry, or undefined (use three). */
  private candidates(geometry: THREE.BufferGeometry, ray: THREE.Ray): number[] | undefined {
    const grid = this.grid(geometry);
    if (!grid) return undefined;
    // Segment of the (forward) ray inside the expanded vertex bounds: any hit lies on it.
    let t0 = 0, t1 = Infinity;
    for (const axis of ['x', 'y', 'z'] as const) {
      const o = ray.origin[axis], d = ray.direction[axis], lo = grid.min[axis], hi = grid.max[axis];
      if (d === 0) { if (o < lo || o > hi) return []; continue; }
      let a = (lo - o) / d, b = (hi - o) / d;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t1 < t0) return [];
    }
    const x0 = ray.origin.x + ray.direction.x * t0, x1 = ray.origin.x + ray.direction.x * t1;
    const z0 = ray.origin.z + ray.direction.z * t0, z1 = ray.origin.z + ray.direction.z * t1;
    const cell = (v: number, lo: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor((v - lo) / grid.cell)));
    const i0 = cell(Math.min(x0, x1) - grid.eps, grid.min.x, grid.nx), i1 = cell(Math.max(x0, x1) + grid.eps, grid.min.x, grid.nx);
    const j0 = cell(Math.min(z0, z1) - grid.eps, grid.min.z, grid.nz), j1 = cell(Math.max(z0, z1) + grid.eps, grid.min.z, grid.nz);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > MAX_QUERY_CELLS) return undefined;
    // Union of the touched cells and the wide list, ascending and without repeats (three's triangle order).
    const out: number[] = [];
    if (++grid.epoch === 0xffffffff) { grid.stamp.fill(0); grid.epoch = 1; }
    const take = (t: number) => { if (grid.stamp[t] !== grid.epoch) { grid.stamp[t] = grid.epoch; out.push(t); } };
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = i * grid.nz + j;
      for (let n = grid.start[k], end = grid.start[k + 1]; n < end; n++) take(grid.items[n]);
    }
    for (const t of grid.wide) take(t);
    return out.sort((a, b) => a - b);
  }

  /** three r185 checkGeometryIntersection / checkIntersection (Mesh.js), unchanged. */
  private checkGeometryIntersection(object: THREE.Mesh, material: THREE.Material, raycaster: THREE.Raycaster, ray: THREE.Ray,
    uv: Position | undefined, uv1: Position | undefined, normal: Position | undefined, a: number, b: number, c: number) {
    object.getVertexPosition(a, vA);
    object.getVertexPosition(b, vB);
    object.getVertexPosition(c, vC);
    const hit = material.side === THREE.BackSide ? ray.intersectTriangle(vC, vB, vA, true, point)
      : ray.intersectTriangle(vA, vB, vC, material.side === THREE.FrontSide, point);
    if (hit === null) return null;
    pointWorld.copy(point).applyMatrix4(object.matrixWorld);
    const distance = raycaster.ray.origin.distanceTo(pointWorld);
    if (distance < raycaster.near || distance > raycaster.far) return null;
    const intersection: THREE.Intersection = { distance, point: pointWorld.clone(), object };
    const barycoord = new THREE.Vector3();
    THREE.Triangle.getBarycoord(point, vA, vB, vC, barycoord);
    if (uv) intersection.uv = THREE.Triangle.getInterpolatedAttribute(uv as THREE.BufferAttribute, a, b, c, barycoord, new THREE.Vector2()) as THREE.Vector2;
    if (uv1) intersection.uv1 = THREE.Triangle.getInterpolatedAttribute(uv1 as THREE.BufferAttribute, a, b, c, barycoord, new THREE.Vector2()) as THREE.Vector2;
    if (normal) {
      intersection.normal = THREE.Triangle.getInterpolatedAttribute(normal as THREE.BufferAttribute, a, b, c, barycoord, new THREE.Vector3()) as THREE.Vector3;
      if (intersection.normal.dot(ray.direction) > 0) intersection.normal.multiplyScalar(-1);
    }
    const face = { a, b, c, normal: new THREE.Vector3(), materialIndex: 0 };
    THREE.Triangle.getNormal(vA, vB, vC, face.normal);
    intersection.face = face;
    intersection.barycoord = barycoord;
    return intersection;
  }
}
