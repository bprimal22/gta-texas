import * as T from 'three';

export interface GroundHit { y: number; paved: boolean }
export interface GroundQuery {
  /** Highest walkable surface at (x,z) whose height is ≤ below (+5 cm). */
  under(x: number, z: number, below: number): GroundHit | null;
  /** Lowest authored upward surface strictly above y (roofs, canopies, decks). */
  above?(x: number, z: number, y: number): number | null;
}
export interface GroundIndexOptions {
  /** Authored surfaces (walkways, lawns, stairs, plazas, roofs). */
  roots: T.Object3D[];
  /** Materials that count as lawn/planting rather than paving. */
  isLawn: (material: T.Material, mesh: T.Mesh) => boolean;
  /** Fallback ground (baked terrain), treated as lawn. */
  terrain?: (x: number, z: number) => number | null;
  /** Visual-only finishes lying on the terrain (mapped roads/paths): paved. */
  pavedOverlays?: T.Object3D[];
  /** Only index triangles touching these discs (x, z, radius). */
  regions?: { x: number; z: number; r: number }[];
  /** Ignore meshes by name (e.g. the contour terrain which `terrain` covers). */
  skip?: (mesh: T.Mesh) => boolean;
  cell?: number;
}

/**
 * Spatial index of upward-facing authored triangles (n·y > 0.5) for tree
 * clearance and placement. Pure geometry, no WebGL; identical in game and
 * headless checks. Lawn vs paved is decided by the triangle's material.
 */
export class GroundIndex implements GroundQuery {
  private cell: number;
  private tris: number[] = [];
  private flags: number[] = [];
  private cells = new Map<number, number[]>();
  private wanted: Set<number> | null = null;
  triangles = 0;
  buildMs = 0;
  constructor(private o: GroundIndexOptions) {
    const t0 = performance.now();
    this.cell = o.cell ?? 4;
    if (o.regions) {
      this.wanted = new Set();
      for (const r of o.regions) {
        const i0 = Math.floor((r.x - r.r) / this.cell), i1 = Math.floor((r.x + r.r) / this.cell);
        const j0 = Math.floor((r.z - r.r) / this.cell), j1 = Math.floor((r.z + r.r) / this.cell);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) this.wanted.add(this.key(i, j));
      }
    }
    for (const root of o.roots) this.add(root, null);
    for (const root of o.pavedOverlays ?? []) this.add(root, true);
    this.buildMs = performance.now() - t0;
  }
  private key(i: number, j: number) { return (i + 32768) * 65536 + (j + 32768); }
  private add(root: T.Object3D, forcePaved: boolean | null) {
    root.updateWorldMatrix(true, true);
    const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), e1 = new T.Vector3(), e2 = new T.Vector3(), n = new T.Vector3();
    const box = new T.Box3();
    root.traverse(object => {
      const mesh = object as T.Mesh;
      if (!mesh.isMesh || (mesh as unknown as T.InstancedMesh).isInstancedMesh || (mesh as unknown as T.BatchedMesh).isBatchedMesh) return;
      if (this.o.skip?.(mesh)) return;
      const geometry = mesh.geometry, pos = geometry.getAttribute('position');
      if (!pos) return;
      if (this.wanted) {
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        box.copy(geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
        // Cheap reject when the whole mesh is small and away from every region.
        const i0 = Math.floor(box.min.x / this.cell), i1 = Math.floor(box.max.x / this.cell);
        const j0 = Math.floor(box.min.z / this.cell), j1 = Math.floor(box.max.z / this.cell);
        if ((i1 - i0 + 1) * (j1 - j0 + 1) < 4096) {
          let any = false;
          for (let i = i0; i <= i1 && !any; i++) for (let j = j0; j <= j1; j++) if (this.wanted.has(this.key(i, j))) { any = true; break; }
          if (!any) return;
        }
      }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const groups = Array.isArray(mesh.material) && geometry.groups.length ? geometry.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
      const index = geometry.index, total = index ? index.count : pos.count;
      for (const group of groups) {
        const material = materials[group.materialIndex ?? 0] ?? materials[0];
        const flag = forcePaved !== null ? 1 : this.o.isLawn(material, mesh) ? 0 : 1;
        const end = Math.min(total, group.start + group.count);
        for (let t = group.start; t + 2 < end; t += 3) {
          a.fromBufferAttribute(pos, index ? index.getX(t) : t).applyMatrix4(mesh.matrixWorld);
          b.fromBufferAttribute(pos, index ? index.getX(t + 1) : t + 1).applyMatrix4(mesh.matrixWorld);
          c.fromBufferAttribute(pos, index ? index.getX(t + 2) : t + 2).applyMatrix4(mesh.matrixWorld);
          n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
          const l = n.length();
          if (l < 1e-9 || Math.abs(n.y) / l < .5) continue;
          const i0 = Math.floor(Math.min(a.x, b.x, c.x) / this.cell), i1 = Math.floor(Math.max(a.x, b.x, c.x) / this.cell);
          const j0 = Math.floor(Math.min(a.z, b.z, c.z) / this.cell), j1 = Math.floor(Math.max(a.z, b.z, c.z) / this.cell);
          if ((i1 - i0 + 1) * (j1 - j0 + 1) > 4096) continue;
          let id = -1;
          for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
            const k = this.key(i, j);
            if (this.wanted && !this.wanted.has(k)) continue;
            if (id < 0) { id = this.flags.length; this.tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); this.flags.push(flag); }
            let list = this.cells.get(k);
            if (!list) this.cells.set(k, list = []);
            list.push(id);
          }
        }
      }
    });
    this.triangles = this.flags.length;
  }
  above(x: number, z: number, y: number): number | null {
    const list = this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    let best: number | null = null;
    if (list) for (const id of list) {
      const h = this.at(id, x, z);
      if (h !== null && h > y + .05 && (best === null || h < best)) best = h;
    }
    return best;
  }
  private at(id: number, x: number, z: number) {
    const o = id * 9, p = this.tris;
    const ax = p[o], ay = p[o + 1], az = p[o + 2], bx = p[o + 3], by = p[o + 4], bz = p[o + 5], cx = p[o + 6], cy = p[o + 7], cz = p[o + 8];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) return null;
    const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, w = 1 - u - v;
    if (u < -1e-6 || v < -1e-6 || w < -1e-6) return null;
    return u * ay + v * by + w * cy;
  }
  under(x: number, z: number, below: number): GroundHit | null {
    const list = this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    let best: GroundHit | null = null;
    if (list) for (const id of list) {
      const o = id * 9, p = this.tris;
      const ax = p[o], ay = p[o + 1], az = p[o + 2], bx = p[o + 3], by = p[o + 4], bz = p[o + 5], cx = p[o + 6], cy = p[o + 7], cz = p[o + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      const y = u * ay + v * by + w * cy;
      if (y > below + .05) continue;
      // Highest surface wins; at equal height (overlay on terrain/lawn) paving wins.
      if (!best || y > best.y + .03 || (Math.abs(y - best.y) <= .03 && this.flags[id] === 1)) best = { y, paved: this.flags[id] === 1 || (best !== null && Math.abs(y - best.y) <= .03 && best.paved) };
    }
    const g = this.o.terrain?.(x, z);
    if (g !== null && g !== undefined && Number.isFinite(g) && g <= below + .05) {
      if (!best || g > best.y + .03) best = { y: g, paved: false };
    }
    return best;
  }
}
