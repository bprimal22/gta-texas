import * as THREE from 'three';
import type { Point } from './types';
import { segmentDistanceSq } from './context-coverage';

/** Shoelace sum in (x, z). Positive rings use the exterior normal (dz, -dx). */
export function signedArea(ring: Point[]) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    s += ax * bz - bx * az;
  }
  return s / 2;
}

/** Drop the closing duplicate, near-coincident and collinear vertices. */
export function cleanRing(input: Point[], minEdge = 0.3): Point[] {
  let ring = input.slice();
  if (ring.length > 1) {
    const [fx, fz] = ring[0], [lx, lz] = ring[ring.length - 1];
    if (Math.hypot(fx - lx, fz - lz) < 1e-6) ring.pop();
  }
  for (let pass = 0; pass < 3 && ring.length > 3; pass++) {
    const out: Point[] = [];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], prev = out.length ? out[out.length - 1] : ring[ring.length - 1];
      if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) < minEdge) continue;
      out.push(p);
    }
    const kept: Point[] = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]);
      if (l > 0 && Math.abs(cross) / l < 0.02) continue;
      kept.push(b);
    }
    if (kept.length < 3) break;
    ring = kept;
  }
  return ring;
}

/** Outer rings positive, holes negative, so (dz, -dx) always faces away from solid. */
export function orientRings(rings: Point[][]) {
  return rings.map((ring, i) => {
    const area = signedArea(ring);
    return (i === 0) === area > 0 ? ring : ring.slice().reverse();
  });
}

/** Offset every edge along its exterior normal; negative distances inset.
 * Miters are clamped so sharp GIS spikes do not shoot out. */
export function offsetRing(ring: Point[], distance: number): Point[] {
  const n = ring.length, normals: Point[] = [];
  for (let i = 0; i < n; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % n];
    const l = Math.hypot(bx - ax, bz - az) || 1;
    normals.push([(bz - az) / l, -(bx - ax) / l]);
  }
  return ring.map(([x, z], i) => {
    const n0 = normals[(i + n - 1) % n], n1 = normals[i];
    let mx = n0[0] + n1[0], mz = n0[1] + n1[1];
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) return [x + n1[0] * distance, z + n1[1] * distance] as Point;
    mx /= ml; mz /= ml;
    const cos = mx * n1[0] + mz * n1[1];
    const scale = Math.min(2.5, 1 / Math.max(cos, 0.4));
    return [x + mx * distance * scale, z + mz * distance * scale] as Point;
  });
}

export function pointInRing(x: number, z: number, ring: Point[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(x: number, z: number, rings: Point[][]) {
  if (!pointInRing(x, z, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(x, z, rings[i])) return false;
  return true;
}

export function distanceToRings(x: number, z: number, rings: Point[][]) {
  let best = Infinity;
  for (const ring of rings)
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const d = segmentDistanceSq(x, z, ax, az, bx, bz);
      if (d < best) best = d;
    }
  return Math.sqrt(best);
}

/** Interior point farthest from the boundary, searched on a coarse then fine grid. */
export function poleOfInaccessibility(rings: Point[][]) {
  const xs = rings[0].map(p => p[0]), zs = rings[0].map(p => p[1]);
  let minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  let best = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, d: -1 };
  for (let pass = 0; pass < 3; pass++) {
    const step = Math.max(0.5, Math.max(maxX - minX, maxZ - minZ) / 14);
    for (let x = minX; x <= maxX; x += step) for (let z = minZ; z <= maxZ; z += step) {
      if (!pointInPolygon(x, z, rings)) continue;
      const d = distanceToRings(x, z, rings);
      if (d > best.d) best = { x, z, d };
    }
    if (best.d < 0) break;
    minX = best.x - step; maxX = best.x + step; minZ = best.z - step; maxZ = best.z + step;
  }
  return best;
}

export function triangulate(rings: Point[][]) {
  const outer = rings[0].map(([x, z]) => new THREE.Vector2(x, z));
  const holes = rings.slice(1).map(r => r.map(([x, z]) => new THREE.Vector2(x, z)));
  const faces = THREE.ShapeUtils.triangulateShape(outer, holes);
  const points = [...outer, ...holes.flat()];
  return { points, faces };
}

const up = new THREE.Vector3(0, 1, 0);

/** Accumulates flat-shaded triangles with uv and vertex color. */
export class MeshBuilder {
  position: number[] = [];
  normal: number[] = [];
  uv: number[] = [];
  color: number[] = [];
  private e1 = new THREE.Vector3();
  private e2 = new THREE.Vector3();
  private n = new THREE.Vector3();
  get triangles() { return this.position.length / 9; }
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ua: Point, ub: Point, uc: Point,
    color: THREE.Color, facing?: THREE.Vector3) {
    this.n.crossVectors(this.e1.subVectors(b, a), this.e2.subVectors(c, a));
    const length = this.n.length();
    if (length < 1e-9) return;
    this.n.divideScalar(length);
    if (facing && this.n.dot(facing) < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; this.n.negate(); }
    for (const [p, t] of [[a, ua], [b, ub], [c, uc]] as const) {
      this.position.push(p.x, p.y, p.z);
      this.normal.push(this.n.x, this.n.y, this.n.z);
      this.uv.push(t[0], t[1]);
      this.color.push(color.r, color.g, color.b);
    }
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3,
    ua: Point, ub: Point, uc: Point, ud: Point, color: THREE.Color, facing?: THREE.Vector3) {
    this.tri(a, b, c, ua, ub, uc, color, facing);
    this.tri(a, c, d, ua, uc, ud, color, facing);
  }
  /** Horizontal polygon (with holes) at height y, planar world UVs. */
  cap(rings: Point[][], y: number, color: THREE.Color, scale: number, facing = up) {
    const { points, faces } = triangulate(rings);
    const v = (i: number) => new THREE.Vector3(points[i].x, y, points[i].y);
    const t = (i: number): Point => [points[i].x / scale, points[i].y / scale];
    for (const [i, j, k] of faces) this.tri(v(i), v(j), v(k), t(i), t(j), t(k), color, facing);
    return faces.length;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/** Collision triangles only (positions). */
export class ColliderBuilder {
  position: number[] = [];
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) { this.position.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) { this.tri(a, b, c); this.tri(a, c, d); }
  get triangles() { return this.position.length / 9; }
}

/** Deterministic 0..1 hash for per-building variation. */
export function hash01(seed: number, salt = 0) {
  let h = (seed ^ (salt * 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
