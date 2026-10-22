import * as THREE from "three";

type Position = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
type Node = { bounds: THREE.Box3; start: number; count: number; left: number; right: number };
type GeometryIndex = {
  position: Position;
  positionVersion: number;
  positionCount: number;
  index: THREE.BufferAttribute | null;
  indexVersion: number;
  indexCount: number;
  order: number[];
  nodes: Node[];
  bounds: THREE.Box3;
  valid: boolean;
};
type Range = { start: number; end: number; material: THREE.Material; order: number };
type Candidate = {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  bounds: THREE.Box3;
  inverse: THREE.Matrix4;
  tree: GeometryIndex | null;
  ranges: Range[];
  order: number;
};
type GroundHit = { point: THREE.Vector3; normal: THREE.Vector3 };
const axes = ["x", "y", "z"] as const;
const version = (a: Position) =>
  (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute
    ? (a as THREE.InterleavedBufferAttribute).data.version
    : (a as THREE.BufferAttribute).version;

/** Geometry-level BVH, independent of mesh transforms, groups and material state.
 * Keys are weak: removed meshes/geometry are not retained by the index cache.
 * A disposed record is invalid immediately; the next prepare never reuses it.
 */
function buildIndex(geometry: THREE.BufferGeometry): GeometryIndex | null {
  const p = geometry.getAttribute("position");
  if (!p) return null;
  const idx = geometry.index,
    count = idx?.count ?? p.count,
    triangles = Math.floor(count / 3);
  const box = new THREE.Box3(),
    a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const bounds = new Float64Array(triangles * 6),
    centers = new Float64Array(triangles * 3),
    order: number[] = [];
  for (let t = 0; t < triangles; t++) {
    const j = t * 3;
    a.fromBufferAttribute(p, idx ? idx.getX(j) : j);
    b.fromBufferAttribute(p, idx ? idx.getX(j + 1) : j + 1);
    c.fromBufferAttribute(p, idx ? idx.getX(j + 2) : j + 2);
    if (![a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z].every(Number.isFinite)) continue;
    box.setFromPoints([a, b, c]);
    for (let k = 0; k < 3; k++) {
      bounds[t * 6 + k] = box.min[axes[k]];
      bounds[t * 6 + k + 3] = box.max[axes[k]];
      centers[t * 3 + k] = (bounds[t * 6 + k] + bounds[t * 6 + k + 3]) / 2;
    }
    order.push(t);
  }
  const nodes: Node[] = [];
  function split(start: number, end: number): number {
    const boundsHere = new THREE.Box3();
    for (let n = start; n < end; n++) {
      const t = order[n];
      a.set(bounds[t * 6], bounds[t * 6 + 1], bounds[t * 6 + 2]);
      b.set(bounds[t * 6 + 3], bounds[t * 6 + 4], bounds[t * 6 + 5]);
      boundsHere.expandByPoint(a).expandByPoint(b);
    }
    // Inclusive triangle-edge queries must not be discarded by box roundoff.
    boundsHere.expandByScalar(1e-6);
    const node: Node = { bounds: boundsHere, start, count: end - start, left: -1, right: -1 },
      at = nodes.push(node) - 1;
    if (end - start <= 12) return at;
    const size = boundsHere.getSize(c),
      axis = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2;
    const sorted = order
      .slice(start, end)
      .sort((u, v) => centers[u * 3 + axis] - centers[v * 3 + axis]);
    for (let n = 0; n < sorted.length; n++) order[start + n] = sorted[n];
    const mid = (start + end) >>> 1;
    node.left = split(start, mid);
    node.right = split(mid, end);
    node.count = 0;
    return at;
  }
  if (order.length) split(0, order.length);
  return {
    position: p,
    positionVersion: version(p),
    positionCount: p.count,
    index: idx,
    indexVersion: idx?.version ?? -1,
    indexCount: idx?.count ?? -1,
    order,
    nodes,
    bounds: nodes[0]?.bounds.clone() ?? new THREE.Box3(),
    valid: true,
  };
}

// Keep this closure outside prepare's mesh callback: it captures geometry and
// the weak cache only, never the removed mesh or the query instance.
function observeDisposal(
  geometry: THREE.BufferGeometry,
  cache: WeakMap<THREE.BufferGeometry, GeometryIndex>,
) {
  geometry.addEventListener("dispose", () => {
    const record = cache.get(geometry);
    if (record) record.valid = false;
    cache.delete(geometry);
  });
}

function intersectsSegment(box: THREE.Box3, ray: THREE.Ray, far: number) {
  let lo = 0,
    hi = far;
  for (const axis of axes) {
    const direction = ray.direction[axis],
      origin = ray.origin[axis];
    if (direction === 0) {
      if (origin < box.min[axis] || origin > box.max[axis]) return false;
      continue;
    }
    let a = (box.min[axis] - origin) / direction,
      b = (box.max[axis] - origin) / direction;
    if (a > b) {
      const t = a;
      a = b;
      b = t;
    }
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
    if (hi < lo) return false;
  }
  return true;
}

export class LocalGroundQuery {
  private ray = new THREE.Raycaster();
  private localRay = new THREE.Ray();
  private candidates: Candidate[] = [];
  private cache = new WeakMap<THREE.BufferGeometry, GeometryIndex>();
  private listened = new WeakSet<THREE.BufferGeometry>();
  private region = new THREE.Box3();
  private scratch = new THREE.Box3();
  private memo = new Map<string, GroundHit | null>();
  private stack: number[] = [];
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private c = new THREE.Vector3();
  private localPoint = new THREE.Vector3();
  private worldPoint = new THREE.Vector3();
  private normal = new THREE.Vector3();
  private end = new THREE.Vector3();
  stats = {
    candidates: 0,
    prepares: 0,
    samples: 0,
    prepareMs: 0,
    indexBuilds: 0,
    indexBuildMs: 0,
    triangleTests: 0,
    memoHits: 0,
    fallbacks: 0,
  };
  prepare(
    roots: THREE.Object3D[],
    center: { x: number; y: number; z: number },
    include: (mesh: THREE.Mesh) => boolean,
  ) {
    const began = performance.now();
    this.candidates.length = 0;
    this.memo.clear();
    this.region.min.set(center.x - 2, center.y - 1.6, center.z - 2);
    this.region.max.set(center.x + 2, center.y + 0.6, center.z + 2);
    for (const root of roots) {
      root.updateWorldMatrix(true, true);
      root.traverse((o) => {
        if (
          !(o instanceof THREE.Mesh) ||
          !o.geometry ||
          !o.material ||
          o.userData.campusShadowReceiver ||
          !include(o) ||
          !o.layers.test(this.ray.layers)
        )
          return;
        const g: THREE.BufferGeometry = o.geometry;
        const p = g.getAttribute("position");
        if (!p) return;
        const fallback =
          o.raycast !== THREE.Mesh.prototype.raycast ||
          o.getVertexPosition !== THREE.Mesh.prototype.getVertexPosition ||
          !!o.morphTargetInfluences?.length;
        let tree: GeometryIndex | null = null;
        // These meshes can change vertices independently of geometry versions.
        // Preserve their own raycast implementation instead of indexing bind data.
        if (fallback) {
          this.scratch.copy(this.region);
        } else {
          const old = this.cache.get(g),
            valid =
              old?.valid &&
              old.position === p &&
              old.positionVersion === version(p) &&
              old.positionCount === p.count &&
              old.index === g.index &&
              old.indexVersion === (g.index?.version ?? -1) &&
              old.indexCount === (g.index?.count ?? -1);
          if (valid) tree = old!;
          else {
            // Cheap broad phase before first build; a changed cached geometry must
            // recompute its bounds because BufferAttribute updates do not do so.
            if (old || !g.boundingBox) g.computeBoundingBox();
            if (!g.boundingBox) return;
            this.scratch.copy(g.boundingBox).applyMatrix4(o.matrixWorld).expandByScalar(1e-5);
            if (!this.scratch.intersectsBox(this.region)) return;
            const t = performance.now();
            tree = buildIndex(g);
            this.stats.indexBuildMs += performance.now() - t;
            this.stats.indexBuilds++;
            if (!tree) return;
            this.cache.set(g, tree);
            if (!this.listened.has(g)) {
              this.listened.add(g);
              observeDisposal(g, this.cache);
            }
          }
          this.scratch.copy(tree.bounds).applyMatrix4(o.matrixWorld);
          if (!this.scratch.intersectsBox(this.region)) return;
        }
        const count = g.index?.count ?? p.count,
          ranges: Range[] = [];
        if (Array.isArray(o.material)) {
          g.groups.forEach((group, i) => {
            const material =
              o.material instanceof Array ? o.material[group.materialIndex ?? 0] : o.material;
            if (material)
              ranges.push({
                start: Math.max(group.start, g.drawRange.start),
                end: Math.min(
                  count,
                  group.start + group.count,
                  g.drawRange.start + g.drawRange.count,
                ),
                material,
                order: i,
              });
          });
        } else
          ranges.push({
            start: Math.max(0, g.drawRange.start),
            end: Math.min(count, g.drawRange.start + g.drawRange.count),
            material: o.material,
            order: 0,
          });
        // Three also accepts ranges starting between conventional triangle slots.
        // Rare unaligned ranges retain its exact loop behavior through fallback.
        if (ranges.some((r) => r.start % 3 !== 0)) tree = null;
        this.candidates.push({
          mesh: o,
          geometry: g,
          bounds: this.scratch.clone(),
          inverse: o.matrixWorld.clone().invert(),
          tree,
          ranges,
          order: this.candidates.length,
        });
      });
    }
    this.stats.candidates = this.candidates.length;
    this.stats.prepares++;
    this.stats.prepareMs = performance.now() - began;
  }
  sample(x: number, z: number, fromY: number, distance: number): GroundHit | null {
    this.stats.samples++;
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(z) ||
      !Number.isFinite(fromY) ||
      Number.isNaN(distance) ||
      distance === -Infinity ||
      distance < 0 ||
      x < this.region.min.x ||
      x > this.region.max.x ||
      z < this.region.min.z ||
      z > this.region.max.z
    )
      return null;
    const key = x + "," + z + "," + fromY + "," + distance;
    if (this.memo.has(key)) {
      this.stats.memoHits++;
      const hit = this.memo.get(key);
      return hit ? { point: hit.point.clone(), normal: hit.normal.clone() } : null;
    }
    this.ray.set(this.a.set(x, fromY, z), this.b.set(0, -1, 0));
    this.ray.near = 0;
    this.ray.far = distance;
    let best: GroundHit | null = null,
      bestDistance = Infinity,
      bestMesh = Infinity,
      bestRange = Infinity,
      bestStart = Infinity;
    const accept = (
      point: THREE.Vector3,
      normal: THREE.Vector3,
      d: number,
      mesh: number,
      range: number,
      start: number,
    ) => {
      if (normal.y <= 0.5) return;
      if (
        d < bestDistance ||
        (d === bestDistance &&
          (mesh < bestMesh ||
            (mesh === bestMesh &&
              (range < bestRange || (range === bestRange && start < bestStart)))))
      ) {
        best = { point: point.clone(), normal: normal.clone() };
        bestDistance = d;
        bestMesh = mesh;
        bestRange = range;
        bestStart = start;
      }
    };
    for (const candidate of this.candidates) {
      const { mesh, bounds, tree, inverse, ranges } = candidate;
      if (
        x < bounds.min.x - 1e-5 ||
        x > bounds.max.x + 1e-5 ||
        z < bounds.min.z - 1e-5 ||
        z > bounds.max.z + 1e-5 ||
        bounds.max.y < fromY - distance ||
        bounds.min.y > fromY
      )
        continue;
      if (!tree || !tree.valid) {
        this.stats.fallbacks++;
        let rank = 0;
        for (const h of this.ray.intersectObject(mesh, false)) {
          if (h.face) {
            this.normal.copy(h.face.normal).transformDirection(mesh.matrixWorld);
            accept(h.point, this.normal, h.distance, candidate.order, rank++, 0);
          }
        }
        continue;
      }
      if (!ranges.length) continue;
      this.localRay.copy(this.ray.ray).applyMatrix4(inverse);
      let localFar = Infinity;
      if (distance !== Infinity) {
        this.end.set(x, fromY - distance, z).applyMatrix4(inverse);
        localFar = this.end.distanceTo(this.localRay.origin);
      }
      this.stack.length = 0;
      if (tree.nodes.length) this.stack.push(0);
      while (this.stack.length) {
        const node = tree.nodes[this.stack.pop()!];
        if (!intersectsSegment(node.bounds, this.localRay, localFar)) continue;
        if (node.count === 0) {
          this.stack.push(node.right, node.left);
          continue;
        }
        for (let i = node.start; i < node.start + node.count; i++) {
          const start = tree.order[i] * 3;
          for (const range of ranges) {
            if (start < range.start || start >= range.end) continue;
            const index = tree.index,
              p = tree.position;
            this.a.fromBufferAttribute(p, index ? index.getX(start) : start);
            this.b.fromBufferAttribute(p, index ? index.getX(start + 1) : start + 1);
            this.c.fromBufferAttribute(p, index ? index.getX(start + 2) : start + 2);
            this.stats.triangleTests++;
            const side = range.material.side,
              hit =
                side === THREE.BackSide
                  ? this.localRay.intersectTriangle(this.c, this.b, this.a, true, this.localPoint)
                  : this.localRay.intersectTriangle(
                      this.a,
                      this.b,
                      this.c,
                      side === THREE.FrontSide,
                      this.localPoint,
                    );
            if (!hit) continue;
            this.worldPoint.copy(hit).applyMatrix4(mesh.matrixWorld);
            const d = this.ray.ray.origin.distanceTo(this.worldPoint);
            if (d > distance || d > bestDistance) continue;
            THREE.Triangle.getNormal(this.a, this.b, this.c, this.normal).transformDirection(
              mesh.matrixWorld,
            );
            accept(this.worldPoint, this.normal, d, candidate.order, range.order, start);
          }
        }
      }
    }
    this.memo.set(key, best);
    return best
      ? { point: (best as GroundHit).point.clone(), normal: (best as GroundHit).normal.clone() }
      : null;
  }
  clear() {
    this.candidates.length = 0;
    this.memo.clear();
    this.stats.candidates = 0;
  }
}
