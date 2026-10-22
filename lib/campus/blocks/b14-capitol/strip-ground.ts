// b14-capitol round 2: ground for the south strip z 1288..1536 (x -760..1296), which game.ts adds to the playable bound
// for the Capitol but which campus.json / terrain.json / the baked offline terrain do not cover.
//
// Data: strip-ground.json, a 4 m height grid (Int16 mm, base64) built by
// research/whole-campus-92/b14-capitol/derived/r2/strip_ground.py from the 2017 USGS 3DEP DTM (public domain;
// campus Y = NAVD88 - 165, registration dx -0.23 dz -1.07): vertex = mean DTM over its 4 m cell; row z 1288 = the baked
// terrain's last row (seam), its offset fading out over 40 m; vertices within 6 m of the authored Capitol grounds
// rectangle take the authored grade (capitolGroundHeight), fading to the DTM by 46 m.
//
// One surface, three consumers: the visible mesh, its trimesh collider (same triangles) and stripGroundHeight(), which
// evaluates exactly those triangles (same diagonal as terrain.ts) and backs capitolGroundReference in the strip so the
// contour height used by map travel, flight, the scooter and the generated context equals what is drawn.
// The patch is cut out of the authored Capitol grounds rectangle (no double surface) and of every building footprint
// (+5 cm, strip_holes.py: the generated walls reach below grade, terrain never runs inside a building); clipped
// triangles stay coplanar with their grid triangle.
import * as THREE from 'three';
import data from './strip-ground.json' with { type: 'json' };

const { x0: X0, z0: Z0, step: STEP, nx: NX, nz: NZ } = data;
const ROT = data.grounds.rotation, CX = data.grounds.center[0], CZ = data.grounds.center[1];
const [U0, U1] = data.grounds.u, [V0, V1] = data.grounds.v;
const CR = Math.cos(ROT), SR = Math.sin(ROT);
export const STRIP_BOUNDS = { x0: X0, x1: X0 + (NX - 1) * STEP, z0: Z0, z1: Z0 + (NZ - 1) * STEP };

let heights: Float32Array | null = null;
function grid(): Float32Array {
  if (heights) return heights;
  const bin = atob(data.heights), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const view = new DataView(bytes.buffer), h = new Float32Array(NX * NZ);
  for (let i = 0; i < h.length; i++) h[i] = view.getInt16(i * 2, true) * data.unit;
  return heights = h;
}
const local = (x: number, z: number): [number, number] => [(x - CX) * CR + (z - CZ) * SR, -(x - CX) * SR + (z - CZ) * CR];
/** Inside the authored Capitol grounds rectangle (capitol-area.ts lawn floor), where the patch is cut out. */
export function inCapitolGrounds(x: number, z: number) {
  const [u, v] = local(x, z);
  return u >= U0 && u <= U1 && v >= V0 && v <= V1;
}
/** Height of the strip patch at (x, z): exactly the drawn/physical triangles; null outside the strip or in the grounds. */
export function stripGroundHeight(x: number, z: number): number | null {
  if (!(x >= STRIP_BOUNDS.x0 && x <= STRIP_BOUNDS.x1 && z >= STRIP_BOUNDS.z0 && z <= STRIP_BOUNDS.z1)) return null;
  if (inCapitolGrounds(x, z)) return null;
  const h = grid();
  const fx = Math.min((x - X0) / STEP, NX - 1.000001), fz = Math.min((z - Z0) / STEP, NZ - 1.000001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * NX + i;
  const a = h[k], b = h[k + 1], c = h[k + NX], e = h[k + NX + 1];
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : e + (c - e) * (1 - u) + (b - e) * (1 - v);
}

type V3 = [number, number, number];
/** A convex region as half-planes: value(p) <= 0 inside. */
type Plane = (p: V3) => number;
const groundsPlane = (nu: number, nv: number, c: number): Plane => p => { const [u, v] = local(p[0], p[2]); return nu * u + nv * v - c; };
const GROUNDS: Plane[] = [groundsPlane(1, 0, U1), groundsPlane(-1, 0, -U0), groundsPlane(0, 1, V1), groundsPlane(0, -1, -V0)];
/** Sutherland-Hodgman against one half-plane (keep value * sign <= 0); new points interpolated in 3D (coplanar). */
function clip(poly: V3[], plane: Plane, sign: 1 | -1): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], dp = plane(p) * sign, dq = plane(q) * sign;
    if (dp <= 0) out.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]); }
  }
  return out;
}
/** Parts of a convex polygon outside a convex region: U_k (outside plane k, inside planes 1..k-1), each convex. */
function outsideParts(poly: V3[], planes: Plane[]): V3[][] {
  const parts: V3[][] = [];
  let rest = poly;
  for (const plane of planes) {
    if (rest.length < 3) break;
    const out = clip(rest, plane, -1);
    if (out.length >= 3) parts.push(out);
    rest = clip(rest, plane, 1);
  }
  return parts;
}
const area2 = (poly: V3[]) => { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[2] - q[0] * p[2]; } return a / 2; };
interface HoleTri { planes: Plane[]; box: [number, number, number, number] }
/** Footprint holes (strip_holes.py: every building ring reaching the strip, buffered 5 cm, unioned) as convex triangles. */
function holeTriangles(): HoleTri[] {
  const out: HoleTri[] = [];
  for (const rings of (data as { holes?: number[][][][] }).holes ?? []) {
    const contour = rings[0].map(([x, z]) => new THREE.Vector2(x, z)), holes = rings.slice(1).map(r => r.map(([x, z]) => new THREE.Vector2(x, z)));
    const all = [...contour, ...holes.flat()];
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, holes)) {
      const a = all[i]; let b = all[j], c = all[k];
      const cr = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
      if (Math.abs(cr) < 1e-9) continue;
      if (cr < 0) [b, c] = [c, b];
      // Edge a->b of a positively oriented (x, z) triangle: inside where cross(b - a, p - a) >= 0.
      const edge = (p0: THREE.Vector2, p1: THREE.Vector2): Plane => p => -((p1.x - p0.x) * (p[2] - p0.y) - (p1.y - p0.y) * (p[0] - p0.x));
      out.push({ planes: [edge(a, b), edge(b, c), edge(c, a)], box: [Math.min(a.x, b.x, c.x), Math.max(a.x, b.x, c.x), Math.min(a.y, b.y, c.y), Math.max(a.y, b.y, c.y)] });
    }
  }
  return out;
}

export interface StripGroundGeometry { geometry: THREE.BufferGeometry; positions: Float32Array; indices: Uint32Array; triangles: number; clipped: number; dropped: number; holeTriangles: number }
/** The strip patch: indexed triangles (grid vertices shared; clip vertices deduplicated at 0.1 mm), cut out of the
 * Capitol grounds rectangle and of every building footprint (+5 cm). */
export function buildStripGroundGeometry(): StripGroundGeometry {
  const h = grid(), pos: number[] = [], idx: number[] = [], key = new Map<string, number>();
  const vert = (p: V3) => {
    const k = `${Math.round(p[0] * 1e4)},${Math.round(p[2] * 1e4)}`;
    let i = key.get(k);
    if (i === undefined) { i = pos.length / 3; pos.push(p[0], p[1], p[2]); key.set(k, i); }
    return i;
  };
  const holes = holeTriangles(), cells = new Map<number, HoleTri[]>();
  for (const t of holes) {
    const i0 = Math.max(0, Math.floor((t.box[0] - X0) / STEP)), i1 = Math.min(NX - 2, Math.floor((t.box[1] - X0) / STEP));
    const j0 = Math.max(0, Math.floor((t.box[2] - Z0) / STEP)), j1 = Math.min(NZ - 2, Math.floor((t.box[3] - Z0) / STEP));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const l = cells.get(j * NX + i) ?? []; l.push(t); cells.set(j * NX + i, l); }
  }
  const P = (i: number, j: number): V3 => [X0 + i * STEP, h[j * NX + i], Z0 + j * STEP];
  let clipped = 0, dropped = 0;
  for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i, j + 1), d = P(i + 1, j + 1);
    const [cu, cv] = local((a[0] + d[0]) / 2, (a[2] + d[2]) / 2);
    const near = cu > U0 - 4 && cu < U1 + 4 && cv > V0 - 4 && cv < V1 + 4, cand = cells.get(j * NX + i);
    for (const tri of [[a, c, b], [b, c, d]] as V3[][]) {
      if (tri.every(p => inCapitolGrounds(p[0], p[2]))) { dropped++; continue; }
      if (!near && !cand) { idx.push(vert(tri[0]), vert(tri[1]), vert(tri[2])); continue; }
      let pieces: V3[][] = near ? outsideParts(tri, GROUNDS) : [tri];
      for (const t of cand ?? []) pieces = pieces.flatMap(p => {
        const xs = p.map(q => q[0]), zs = p.map(q => q[2]);
        if (Math.max(...xs) < t.box[0] || Math.min(...xs) > t.box[1] || Math.max(...zs) < t.box[2] || Math.min(...zs) > t.box[3]) return [p];
        return outsideParts(p, t.planes);
      });
      if (pieces.length !== 1 || pieces[0].length !== 3) clipped++;
      if (!pieces.length) dropped++;
      for (const poly of pieces) {
        if (Math.abs(area2(poly)) < 1e-5) continue;
        const ids = poly.map(vert);
        for (let k = 1; k + 1 < ids.length; k++) {
          const p0 = poly[0], p1 = poly[k], p2 = poly[k + 1];
          const area = Math.abs((p1[0] - p0[0]) * (p2[2] - p0[2]) - (p2[0] - p0[0]) * (p1[2] - p0[2])) / 2;
          if (area > 1e-5 && ids[0] !== ids[k] && ids[k] !== ids[k + 1] && ids[0] !== ids[k + 1]) idx.push(ids[0], ids[k], ids[k + 1]);
        }
      }
    }
  }
  const positions = new Float32Array(pos), indices = new Uint32Array(idx);
  const uv = new Float32Array(positions.length / 3 * 2);
  // Same UV frame as the baked offline terrain (x + 760) / 2, (z + 864) / 2: the lawn texture continues across the seam.
  for (let i = 0; i < positions.length / 3; i++) { uv[i * 2] = (positions[i * 3] + 760) / 2; uv[i * 2 + 1] = (positions[i * 3 + 2] + 864) / 2; }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return { geometry, positions, indices, triangles: indices.length / 3, clipped, dropped, holeTriangles: holes.length };
}
