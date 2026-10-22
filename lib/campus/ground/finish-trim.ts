import * as T from 'three';
import { plane, subtractLayers, area, type Point2 } from './clip';

/**
 * Trim the visual-only mapped finishes (local-surfaces: roads/paths lying on the
 * terrain) out from under generated paving that supersedes them, e.g. a tie-in
 * ramp that repaves an old mapped path beside an authored plaza. The finish
 * keeps a polygon offset towards the camera, so a finish left a few centimetres
 * under the new paving can still win the depth test at aerial distances
 * (24-bit depth, near 0.12 m: about 4 cm per depth step at 290 m). Removing it
 * leaves exactly one visible surface there: the paving, which is also the
 * physical ground (its own trimesh). Finishes carry no colliders, so physics is
 * unchanged; the terrain collider stays below.
 *
 * Exact plan clipping (ground/clip.ts): a finish triangle loses the region lying
 * from `below` under to `above` over any cover triangle; partly covered triangles
 * keep their convex remainders with interpolated UVs. Only meshes that change get
 * a new geometry; `dispose()` restores the originals.
 */
export function trimFinishesUnder(roots: T.Object3D[], cover: Float64Array[], below: number, above: number) {
  const stats = { meshes: 0, trianglesRemoved: 0, trianglesClipped: 0, removedM2: 0 };
  const swaps: { mesh: T.Mesh; original: T.BufferGeometry; trimmed: T.BufferGeometry }[] = [];
  const dispose = () => { for (const s of swaps) { s.mesh.geometry = s.original; s.trimmed.dispose(); } swaps.length = 0; };
  if (!cover.length) return { stats, dispose };
  const CELL = 2, grid = new Map<number, Float64Array[]>(), key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);
  for (const c of cover) for (let i = Math.floor(Math.min(c[0], c[3], c[6]) / CELL); i <= Math.floor(Math.max(c[0], c[3], c[6]) / CELL); i++)
    for (let j = Math.floor(Math.min(c[2], c[5], c[8]) / CELL); j <= Math.floor(Math.max(c[2], c[5], c[8]) / CELL); j++) {
      const k = key(i, j); let list = grid.get(k); if (!list) grid.set(k, list = []); list.push(c);
    }
  const near = (x0: number, x1: number, z0: number, z1: number) => {
    const found = new Set<Float64Array>();
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++)
      for (const c of grid.get(key(i, j)) ?? []) if (Math.max(c[0], c[3], c[6]) >= x0 && Math.min(c[0], c[3], c[6]) <= x1 && Math.max(c[2], c[5], c[8]) >= z0 && Math.min(c[2], c[5], c[8]) <= z1) found.add(c);
    return found;
  };
  const meshes: T.Mesh[] = [];
  for (const root of roots) { root.updateWorldMatrix(true, true); root.traverse(o => { const m = o as T.Mesh; if (m.isMesh && !(m as unknown as T.InstancedMesh).isInstancedMesh) meshes.push(m); }); }
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), inverse = new T.Matrix4();
  for (const mesh of meshes) {
    const geometry = mesh.geometry, pos = geometry.getAttribute('position'), uv = geometry.getAttribute('uv'), index = geometry.index;
    if (!pos) continue;
    const count = index ? index.count : pos.count, vid = (t: number) => index ? index.getX(t) : t;
    // Pass 1: which triangles change (most meshes: none).
    const changes = new Map<number, Point2[][]>();
    for (let t = 0; t + 2 < count; t += 3) {
      a.fromBufferAttribute(pos, vid(t)).applyMatrix4(mesh.matrixWorld); b.fromBufferAttribute(pos, vid(t + 1)).applyMatrix4(mesh.matrixWorld); c.fromBufferAttribute(pos, vid(t + 2)).applyMatrix4(mesh.matrixWorld);
      const cands = near(Math.min(a.x, b.x, c.x), Math.max(a.x, b.x, c.x), Math.min(a.z, b.z, c.z), Math.max(a.z, b.z, c.z));
      if (!cands.size) continue;
      const tri = Float64Array.of(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      const result = subtractLayers(tri, [{ surfaces: cands, tolerance: -below, maxRaise: above, anySlope: true }]);
      if (!result) continue;
      changes.set(t, result.pieces);
      stats.removedM2 += result.coveredM2;
      if (result.pieces.length) stats.trianglesClipped++; else stats.trianglesRemoved++;
    }
    if (!changes.size) continue;
    // Pass 2: rebuild (local space), whole triangles unchanged, clipped ones as fans.
    inverse.copy(mesh.matrixWorld).invert();
    const positions: number[] = [], uvs: number[] = [], local = new T.Vector3();
    const push = (x: number, y: number, z: number, u: number, v: number) => { local.set(x, y, z).applyMatrix4(inverse); positions.push(local.x, local.y, local.z); uvs.push(u, v); };
    for (let t = 0; t + 2 < count; t += 3) {
      const pieces = changes.get(t), ids = [vid(t), vid(t + 1), vid(t + 2)];
      const P = ids.map(i => new T.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)), U = ids.map(i => uv ? [uv.getX(i), uv.getY(i)] : [0, 0]);
      if (!pieces) { for (let k = 0; k < 3; k++) push(P[k].x, P[k].y, P[k].z, U[k][0], U[k][1]); continue; }
      const h = plane([P[0].x, P[0].y, P[0].z, P[1].x, P[1].y, P[1].z, P[2].x, P[2].y, P[2].z]);
      if (!h) continue;
      const d = (P[1].z - P[2].z) * (P[0].x - P[2].x) + (P[2].x - P[1].x) * (P[0].z - P[2].z);
      const vertex = ([x, z]: Point2) => {
        const w0 = ((P[1].z - P[2].z) * (x - P[2].x) + (P[2].x - P[1].x) * (z - P[2].z)) / d, w1 = ((P[2].z - P[0].z) * (x - P[2].x) + (P[0].x - P[2].x) * (z - P[2].z)) / d, w2 = 1 - w0 - w1;
        push(x, h[0] * x + h[1] * z + h[2], z, U[0][0] * w0 + U[1][0] * w1 + U[2][0] * w2, U[0][1] * w0 + U[1][1] * w1 + U[2][1] * w2);
      };
      // Keep the source winding: same orientation in plan as the original triangle.
      const sourceSign = Math.sign(d);
      for (const poly of pieces) {
        if (area(poly) <= 0) continue;
        for (let i = 1; i + 1 < poly.length; i++) {
          const p = poly[0], q = poly[i], r = poly[i + 1], s = (q[1] - r[1]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[1] - r[1]);
          if (Math.sign(s) === sourceSign) { vertex(p); vertex(q); vertex(r); } else { vertex(p); vertex(r); vertex(q); }
        }
      }
    }
    const trimmed = new T.BufferGeometry();
    trimmed.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    trimmed.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    trimmed.computeVertexNormals(); trimmed.computeBoundingBox(); trimmed.computeBoundingSphere();
    swaps.push({ mesh, original: geometry, trimmed });
    mesh.geometry = trimmed;
    stats.meshes++;
  }
  return { stats: { ...stats, removedM2: +stats.removedM2.toFixed(2) }, dispose };
}
