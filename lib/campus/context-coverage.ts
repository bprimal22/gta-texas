import * as THREE from 'three';

/** A 2 m raster of where authored geometry already exists. Context scenery is
 * only generated where this raster is empty, so detailed facades, courtyards
 * and playable authored routes are never covered by generic masses. */
export class CoverageGrid {
  readonly w: number;
  readonly h: number;
  /** Authored geometry rising more than 3 m above the contour ground. */
  readonly elevated: Uint8Array;
  /** Highest authored point in the cell (only where elevated). */
  readonly top: Float32Array;
  /** Authored walkable ground (routes, plazas, courtyards). */
  readonly ground: Uint8Array;
  /** Visual road/path finishes, used only to avoid duplicating road ribbons. */
  readonly finish: Uint8Array;
  triangles = 0;
  constructor(readonly x0: number, readonly z0: number, x1: number, z1: number, readonly cell = 2) {
    this.w = Math.ceil((x1 - x0) / cell) + 1;
    this.h = Math.ceil((z1 - z0) / cell) + 1;
    const n = this.w * this.h;
    this.elevated = new Uint8Array(n);
    this.top = new Float32Array(n).fill(-Infinity);
    this.ground = new Uint8Array(n);
    this.finish = new Uint8Array(n);
  }
  index(x: number, z: number) {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
    return i < 0 || j < 0 || i >= this.w || j >= this.h ? -1 : j * this.w + i;
  }
  at(layer: Uint8Array, x: number, z: number) {
    const k = this.index(x, z);
    return k >= 0 && layer[k] === 1;
  }
  /** True if any cell within `radius` metres is set. */
  near(layer: Uint8Array, x: number, z: number, radius: number) {
    const r = Math.ceil(radius / this.cell);
    const ci = Math.floor((x - this.x0) / this.cell), cj = Math.floor((z - this.z0) / this.cell);
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
      if (layer[j * this.w + i]) return true;
    }
    return false;
  }
  mark(layer: Uint8Array, x: number, z: number) {
    const k = this.index(x, z);
    if (k >= 0) layer[k] = 1;
  }
}

type Layer = 'elevated' | 'ground' | 'finish';

/** Rasterize triangle footprints of every mesh under `roots`. `classify`
 * decides per triangle which layer, if any, it contributes to. */
export function rasterizeMeshes(grid: CoverageGrid, roots: THREE.Object3D[],
  groundY: (x: number, z: number) => number, mode: 'authored' | 'finish',
  skip: (object: THREE.Object3D) => boolean = () => false) {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  const tolerance = 0.8;
  const set = (layer: Layer, y: number) => {
    const target = grid[layer];
    const minX = Math.min(a.x, b.x, c.x) - tolerance, maxX = Math.max(a.x, b.x, c.x) + tolerance;
    const minZ = Math.min(a.z, b.z, c.z) - tolerance, maxZ = Math.max(a.z, b.z, c.z) + tolerance;
    const i0 = Math.max(0, Math.floor((minX - grid.x0) / grid.cell)), i1 = Math.min(grid.w - 1, Math.floor((maxX - grid.x0) / grid.cell));
    const j0 = Math.max(0, Math.floor((minZ - grid.z0) / grid.cell)), j1 = Math.min(grid.h - 1, Math.floor((maxZ - grid.z0) / grid.cell));
    if (i1 < i0 || j1 < j0) return;
    const small = (i1 - i0 + 1) * (j1 - j0 + 1) <= 4;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = grid.x0 + (i + 0.5) * grid.cell, z = grid.z0 + (j + 0.5) * grid.cell;
      if (!small && !nearTriangleXZ(x, z, a, b, c, tolerance)) continue;
      const k = j * grid.w + i;
      target[k] = 1;
      if (layer === 'elevated' && y > grid.top[k]) grid.top[k] = y;
    }
  };
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    root.traverse(object => {
      if (skip(object)) return;
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) return;
      const position = mesh.geometry.getAttribute('position');
      if (!position) return;
      const index = mesh.geometry.index;
      const count = index ? index.count : position.count;
      const m = mesh.matrixWorld;
      for (let t = 0; t + 2 < count; t += 3) {
        const ia = index ? index.getX(t) : t, ib = index ? index.getX(t + 1) : t + 1, ic = index ? index.getX(t + 2) : t + 2;
        a.fromBufferAttribute(position, ia).applyMatrix4(m);
        b.fromBufferAttribute(position, ib).applyMatrix4(m);
        c.fromBufferAttribute(position, ic).applyMatrix4(m);
        grid.triangles++;
        const cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3;
        const gy = groundY(cx, cz), maxY = Math.max(a.y, b.y, c.y);
        if (mode === 'finish') { set('finish', maxY); continue; }
        if (maxY > gy + 3) { set('elevated', maxY); continue; }
        n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
        const length = n.length();
        if (length > 1e-9 && Math.abs(n.y / length) > 0.6 && maxY < gy + 2) set('ground', maxY);
      }
    });
  }
}

function nearTriangleXZ(x: number, z: number, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, tolerance: number) {
  const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
  if (Math.abs(d) > 1e-9) {
    const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d;
    const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d;
    if (u >= 0 && v >= 0 && u + v <= 1) return true;
  }
  const t2 = tolerance * tolerance;
  return segmentDistanceSq(x, z, a.x, a.z, b.x, b.z) <= t2 ||
    segmentDistanceSq(x, z, b.x, b.z, c.x, c.z) <= t2 ||
    segmentDistanceSq(x, z, c.x, c.z, a.x, a.z) <= t2;
}

export function segmentDistanceSq(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz;
  const t = l > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l)) : 0;
  const x = ax + t * dx - px, z = az + t * dz - pz;
  return x * x + z * z;
}
