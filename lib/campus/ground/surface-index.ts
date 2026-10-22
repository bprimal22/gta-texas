import * as T from 'three';

/** Region box [minX, maxX, minZ, maxZ] in campus metres. */
export type Box2 = [number, number, number, number];

/** Set of square tiles (default 8 m) used to limit indexing to where it is needed. */
export class TileMask {
  private tiles = new Set<number>();
  constructor(readonly size = 8) {}
  private key(i: number, j: number) { return (i + 32768) * 65536 + (j + 32768); }
  addBox(x0: number, x1: number, z0: number, z1: number) {
    for (let i = Math.floor(x0 / this.size); i <= Math.floor(x1 / this.size); i++)
      for (let j = Math.floor(z0 / this.size); j <= Math.floor(z1 / this.size); j++) this.tiles.add(this.key(i, j));
  }
  overlaps(x0: number, x1: number, z0: number, z1: number) {
    const i0 = Math.floor(x0 / this.size), i1 = Math.floor(x1 / this.size), j0 = Math.floor(z0 / this.size), j1 = Math.floor(z1 / this.size);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 4096) return true;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (this.tiles.has(this.key(i, j))) return true;
    return false;
  }
  get count() { return this.tiles.size; }
}

export interface IndexedTriangle {
  /** a, b, c as x, y, z triples. */
  p: Float64Array;
  mesh: T.Mesh;
  /** 'authored' walkable ground or a visual-only 'overlay' finish lying on the terrain. */
  kind: 'authored' | 'overlay';
}

/**
 * Grid index of up-facing (n.y > 0.5) triangles below the given roots, limited
 * to region boxes. Pure geometry (no WebGL): identical in game and headless checks.
 */
export class SurfaceIndex {
  private cells = new Map<number, IndexedTriangle[]>();
  triangles = 0;
  constructor(private readonly cell = 2) {}
  private key(i: number, j: number) { return (i + 32768) * 65536 + (j + 32768); }

  add(root: T.Object3D, kind: IndexedTriangle['kind'], regions: Box2[] | TileMask, skip?: (mesh: T.Mesh) => boolean,
    /** Optional triangle filter by its lowest height and centroid (e.g. drop roofs high above ground). */
    keep?: (minY: number, x: number, z: number) => boolean) {
    root.updateWorldMatrix(true, true);
    const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), e1 = new T.Vector3(), e2 = new T.Vector3(), n = new T.Vector3();
    const box = new T.Box3();
    const overlaps = regions instanceof TileMask ? (x0: number, x1: number, z0: number, z1: number) => regions.overlaps(x0, x1, z0, z1)
      : (x0: number, x1: number, z0: number, z1: number) => regions.some(r => x1 >= r[0] && x0 <= r[1] && z1 >= r[2] && z0 <= r[3]);
    root.traverse(object => {
      const mesh = object as T.Mesh;
      if (!mesh.isMesh || (mesh as unknown as T.InstancedMesh).isInstancedMesh || (mesh as unknown as T.BatchedMesh).isBatchedMesh) return;
      if (skip?.(mesh)) return;
      const geometry = mesh.geometry, pos = geometry.getAttribute('position');
      if (!pos) return;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      box.copy(geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
      if (!overlaps(box.min.x, box.max.x, box.min.z, box.max.z)) return;
      const index = geometry.index, count = index ? index.count : pos.count;
      for (let t = 0; t + 2 < count; t += 3) {
        a.fromBufferAttribute(pos, index ? index.getX(t) : t).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(pos, index ? index.getX(t + 1) : t + 1).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(pos, index ? index.getX(t + 2) : t + 2).applyMatrix4(mesh.matrixWorld);
        const x0 = Math.min(a.x, b.x, c.x), x1 = Math.max(a.x, b.x, c.x), z0 = Math.min(a.z, b.z, c.z), z1 = Math.max(a.z, b.z, c.z);
        if (!overlaps(x0, x1, z0, z1)) continue;
        n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
        const l = n.length();
        if (l < 1e-9 || Math.abs(n.y) / l < .5) continue;
        if (keep && !keep(Math.min(a.y, b.y, c.y), (a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3)) continue;
        const i0 = Math.floor(x0 / this.cell), i1 = Math.floor(x1 / this.cell), j0 = Math.floor(z0 / this.cell), j1 = Math.floor(z1 / this.cell);
        if ((i1 - i0 + 1) * (j1 - j0 + 1) > 16384) continue;
        const tri: IndexedTriangle = { p: Float64Array.of(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z), mesh, kind };
        this.triangles++;
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
          const k = this.key(i, j);
          let list = this.cells.get(k);
          if (!list) this.cells.set(k, list = []);
          list.push(tri);
        }
      }
    });
    return this;
  }

  /** Every indexed surface height at (x, z), with its triangle. */
  at(x: number, z: number, visit: (y: number, tri: IndexedTriangle) => void) {
    const list = this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!list) return;
    for (const tri of list) {
      const p = tri.p;
      const d = (p[5] - p[8]) * (p[0] - p[6]) + (p[6] - p[3]) * (p[2] - p[8]);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((p[5] - p[8]) * (x - p[6]) + (p[6] - p[3]) * (z - p[8])) / d;
      const v = ((p[8] - p[2]) * (x - p[6]) + (p[0] - p[6]) * (z - p[8])) / d;
      const w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      visit(u * p[1] + v * p[4] + w * p[7], tri);
    }
  }

  /** Every indexed triangle whose cells overlap the plan box (each once). */
  inBox(x0: number, x1: number, z0: number, z1: number) {
    const found = new Set<IndexedTriangle>();
    for (let i = Math.floor(x0 / this.cell); i <= Math.floor(x1 / this.cell); i++)
      for (let j = Math.floor(z0 / this.cell); j <= Math.floor(z1 / this.cell); j++)
        for (const tri of this.cells.get(this.key(i, j)) ?? []) found.add(tri);
    return found;
  }

  /** Highest surface at (x, z) not above `below`. */
  under(x: number, z: number, below: number, filter?: (tri: IndexedTriangle) => boolean) {
    let best: { y: number; tri: IndexedTriangle } | null = null;
    this.at(x, z, (y, tri) => { if (y <= below && (!filter || filter(tri)) && (!best || y > best.y)) best = { y, tri }; });
    return best as { y: number; tri: IndexedTriangle } | null;
  }

  /** Lowest surface at (x, z) strictly between `from` and `to`. */
  above(x: number, z: number, from: number, to: number, filter?: (tri: IndexedTriangle) => boolean) {
    let best: number | null = null;
    this.at(x, z, (y, tri) => { if (y > from && y <= to && (!filter || filter(tri)) && (best === null || y < best)) best = y; });
    return best as number | null;
  }
}
