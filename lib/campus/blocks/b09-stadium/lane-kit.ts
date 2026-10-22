// Private east-south lane geometry kit (one identical copy per owned block; never imported across blocks).
// Batches every authored triangle into one MeshBuilder per (layer, material, group) and one trimesh collider per layer,
// built from exactly the same solid / walkable triangles that are rendered. Materials are owned vertex-colour standards,
// so one material carries many colours and every mesh has the colour attribute G6 requires.
//  - layer 'solid'  : bodies, walls, roofs (collider = same triangles)
//  - layer 'walk'   : walkable treads / decks (collider = same triangles; joins walkway.surfaces)
//  - layer 'detail' : sub-0.3 m relief and visual-only trim (no collider)
//  - group 'add'    : additive geometry on a still-generated building: flagged userData.localContext so the context's
//                     coverage raster ignores it and the generated building is kept (no double body).
// Material families are explicit: 'brick' / 'redBrick' / 'stone' / 'concrete' / 'membrane' / 'alu' use the offline local PBR maps
// (public/assets/materials/context/<family>-{color,normal,rough}.jpg) with the read-only TEXTURES calibration of
// context/materials.ts (metre tile, normal amplitude, inverse LINEAR mean gain so the lit average stays the vertex colour);
// 'matte' / 'glass' / 'metal' stay untextured. ('alu' = aluminium bleacher seats on the local metal maps.) UVs are world metres (planar projection per face plane, so coplanar pieces
// of one wall share a continuous texture).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { MeshBuilder, ColliderBuilder } from '../../context-geometry';
import { TEXTURES } from '../../context/materials';
import type { Point } from '../../types';
import type { BlockInstallContext } from '../types';

export type Mat = 'matte' | 'glass' | 'metal' | 'membrane' | 'brick' | 'redBrick' | 'stone' | 'concrete' | 'alu';
/** Textured families -> local PBR texture family. */
export const PBR: Partial<Record<Mat, 'buffBrick' | 'brownBrick' | 'limestone' | 'precast' | 'membrane' | 'metal'>> = {
  brick: 'buffBrick', redBrick: 'brownBrick', stone: 'limestone', concrete: 'precast', membrane: 'membrane', alu: 'metal' };
export type Layer = 'solid' | 'walk' | 'detail';
export type Group = 'replace' | 'add';
const MAT: Record<Mat, { roughness: number; metalness: number }> = {
  matte: { roughness: 0.9, metalness: 0 }, glass: { roughness: 0.22, metalness: 0.35 },
  metal: { roughness: 0.45, metalness: 0.5 }, membrane: { roughness: 1, metalness: 0 },
  brick: { roughness: 1, metalness: 0 }, redBrick: { roughness: 1, metalness: 0 }, stone: { roughness: 1, metalness: 0 }, concrete: { roughness: 1, metalness: 0 },
  alu: { roughness: 1, metalness: 0.25 },
};
/** World-metre UV of point p on a face with normal n: top projection for near-horizontal faces, else (horizontal tangent, y). */
export function metreUV(p: THREE.Vector3, n: THREE.Vector3): Point {
  if (Math.abs(n.y) > 0.7) return [p.x, p.z];
  const l = Math.hypot(n.x, n.z) || 1, tx = -n.z / l, tz = n.x / l;
  return [p.x * tx + p.z * tz, p.y];
}
const faceNormal = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, facing?: THREE.Vector3) => {
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
  if (facing && n.dot(facing) < 0) n.negate();
  return n;
};
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const UP = V(0, 1, 0), DOWN = V(0, -1, 0);
export const col = (hex: string) => new THREE.Color(hex);
/** Shoelace area in (x, z); > 0 = counter-clockwise in the x-right / z-up math frame. */
export const ringArea = (r: Point[]) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; };
/** Outward unit normal of edge i of ring r. */
export function outward(r: Point[], i: number): Point {
  const a = r[i], b = r[(i + 1) % r.length], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, s = ringArea(r) > 0 ? -1 : 1;
  return [(-dz / l) * s, (dx / l) * s];
}

export class Kit {
  private builders = new Map<string, MeshBuilder>();
  readonly solidCol = new ColliderBuilder();
  readonly walkCol = new ColliderBuilder();
  /** Current group for subsequent geometry. */
  group: Group = 'replace';
  constructor(readonly block: string) {}
  mb(layer: Layer, mat: Mat) {
    const k = `${layer}|${mat}|${this.group}`;
    let b = this.builders.get(k); if (!b) this.builders.set(k, b = new MeshBuilder());
    return b;
  }
  private collider(layer: Layer) { return layer === 'solid' ? this.solidCol : layer === 'walk' ? this.walkCol : null; }
  get triangles() { let n = 0; for (const b of this.builders.values()) n += b.triangles; return n; }
  get colliderTriangles() { return this.solidCol.triangles + this.walkCol.triangles; }

  tri(layer: Layer, mat: Mat, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color, facing?: THREE.Vector3) {
    const n = faceNormal(a, b, c, facing);
    this.mb(layer, mat).tri(a, b, c, metreUV(a, n), metreUV(b, n), metreUV(c, n), color, facing);
    this.collider(layer)?.tri(a, b, c);
  }
  /** Quad a-b-c-d (any winding; `facing` fixes it). UVs in world metres (continuous across coplanar quads). `uv` overrides. */
  quad(layer: Layer, mat: Mat, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color, facing?: THREE.Vector3, uv?: (p: THREE.Vector3) => Point) {
    const n = faceNormal(a, b, c, facing), f = uv ?? ((p: THREE.Vector3) => metreUV(p, n));
    this.mb(layer, mat).quad(a, b, c, d, f(a), f(b), f(c), f(d), color, facing);
    this.collider(layer)?.quad(a, b, c, d);
  }
  /** Average the normals of coincident vertices inside ONE builder (layer, mat, current group) only: smooth shading of a
   * curved surface. Positions (and therefore colliders) are untouched; other builders keep their hard creases. */
  smooth(layer: Layer, mat: Mat) {
    const m = this.mb(layer, mat), key = (i: number) => `${m.position[i].toFixed(3)},${m.position[i + 1].toFixed(3)},${m.position[i + 2].toFixed(3)}`;
    const acc = new Map<string, [number, number, number]>();
    for (let i = 0; i < m.position.length; i += 3) { const k = key(i), v = acc.get(k) ?? [0, 0, 0]; v[0] += m.normal[i]; v[1] += m.normal[i + 1]; v[2] += m.normal[i + 2]; acc.set(k, v); }
    for (let i = 0; i < m.position.length; i += 3) { const v = acc.get(key(i))!, l = Math.hypot(v[0], v[1], v[2]) || 1; m.normal[i] = v[0] / l; m.normal[i + 1] = v[1] / l; m.normal[i + 2] = v[2] / l; }
    return acc.size;
  }
  /** Horizontal polygon (holes allowed) at y; collider from the same triangles. UVs in world metres (x, z). */
  cap(layer: Layer, mat: Mat, rings: Point[][], y: number, color: THREE.Color, down = false) {
    const m = this.mb(layer, mat), start = m.position.length;
    m.cap(rings, y, color, 1, down ? DOWN : UP);
    const c = this.collider(layer);
    if (c) for (let i = start; i < m.position.length; i += 9) {
      const p = m.position;
      c.tri(V(p[i], p[i + 1], p[i + 2]), V(p[i + 3], p[i + 4], p[i + 5]), V(p[i + 6], p[i + 7], p[i + 8]));
    }
  }
  /** Vertical wall segment between plan points a and b from y0 to y1, facing the given plan normal. */
  wall(layer: Layer, mat: Mat, a: Point, b: Point, y0: number, y1: number, color: THREE.Color, n: Point) {
    if (y1 - y0 < 0.01) return;
    this.quad(layer, mat, V(a[0], y0, a[1]), V(b[0], y0, b[1]), V(b[0], y1, b[1]), V(a[0], y1, a[1]), color, V(n[0], 0, n[1]));
  }
  /** Oriented box: origin O, unit plan axis T, outward N = rotated T; extents along t, n (outward) and y.
   * `skip`: 'b' bottom, 'k' back (-n), 's' both t-ends, 't' top. */
  box(layer: Layer, mat: Mat, color: THREE.Color, O: Point, T: Point, N: Point, t0: number, t1: number, n0: number, n1: number, y0: number, y1: number, skip = '') {
    const P = (t: number, n: number, y: number) => V(O[0] + T[0] * t + N[0] * n, y, O[1] + T[1] * t + N[1] * n);
    const nT = V(T[0], 0, T[1]), nN = V(N[0], 0, N[1]);
    this.quad(layer, mat, P(t0, n1, y0), P(t1, n1, y0), P(t1, n1, y1), P(t0, n1, y1), color, nN);
    if (!skip.includes('k')) this.quad(layer, mat, P(t1, n0, y0), P(t0, n0, y0), P(t0, n0, y1), P(t1, n0, y1), color, nN.clone().negate());
    if (!skip.includes('s')) {
      this.quad(layer, mat, P(t1, n1, y0), P(t1, n0, y0), P(t1, n0, y1), P(t1, n1, y1), color, nT);
      this.quad(layer, mat, P(t0, n0, y0), P(t0, n1, y0), P(t0, n1, y1), P(t0, n0, y1), color, nT.clone().negate());
    }
    if (!skip.includes('t')) this.quad(layer, mat, P(t0, n1, y1), P(t1, n1, y1), P(t1, n0, y1), P(t0, n0, y1), color, UP);
    if (!skip.includes('b')) this.quad(layer, mat, P(t0, n0, y0), P(t1, n0, y0), P(t1, n1, y0), P(t0, n1, y0), color, DOWN);
  }
  /** Extruded plan polygon: walls on every edge (outward), optional top / bottom caps. */
  prism(layer: Layer, mat: Mat, ring: Point[], y0: number, y1: number, wallColor: THREE.Color, topColor?: THREE.Color | null, bottom = false) {
    for (let i = 0; i < ring.length; i++) this.wall(layer, mat, ring[i], ring[(i + 1) % ring.length], y0, y1, wallColor, outward(ring, i));
    if (topColor) this.cap(layer, mat, [ring], y1, topColor);
    if (bottom) this.cap(layer, mat, [ring], y0, wallColor, true);
  }

  /** Meshes + colliders. Each mesh is tagged with the block; group 'add' meshes are coverage-exempt (localContext).
   * `exemptAll`: every mesh is coverage-exempt (b09: the generated bowl is built later and must stay bit-identical). */
  finish(ctx: BlockInstallContext, label: string, exemptAll = false) {
    const materials = new Map<Mat, THREE.MeshStandardMaterial>(), geometries: THREE.BufferGeometry[] = [], textures: THREE.Texture[] = [];
    const loader = new THREE.TextureLoader(), aniso = ctx.renderer ? Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy()) : 1;
    const tex = (family: string, kind: 'color' | 'normal' | 'rough', tile: number) => {
      const t = loader.load(`/assets/materials/context/${family}-${kind}.jpg`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / tile, 1 / tile); t.anisotropy = aniso;
      if (kind === 'color') t.colorSpace = THREE.SRGBColorSpace;
      textures.push(t); return t;
    };
    const material = (k: Mat) => {
      let m = materials.get(k);
      if (!m) {
        const fam = PBR[k];
        if (fam) {
          const spec = TEXTURES[fam], mean = spec.linearMean;
          m = new THREE.MeshStandardMaterial({ name: `${this.block} lane ${k} (${fam} PBR)`, vertexColors: true, ...MAT[k],
            map: tex(fam, 'color', spec.tile), normalMap: tex(fam, 'normal', spec.tile), roughnessMap: tex(fam, 'rough', spec.tile),
            color: new THREE.Color(1 / mean[0], 1 / mean[1], 1 / mean[2]), normalScale: new THREE.Vector2(spec.normal, spec.normal) });
          m.userData.pbrFamily = fam; m.userData.tileMetres = spec.tile;
        } else m = new THREE.MeshStandardMaterial({ name: `${this.block} lane ${k}`, color: 0xffffff, vertexColors: true, ...MAT[k] });
        materials.set(k, m);
      }
      return m;
    };
    const solids: THREE.Mesh[] = [], walkable: THREE.Mesh[] = [], detail: THREE.Mesh[] = [];
    for (const [key, b] of this.builders) {
      if (!b.triangles) continue;
      const [layer, mat, group] = key.split('|') as [Layer, Mat, Group];
      const g = b.geometry(); geometries.push(g);
      const mesh = new THREE.Mesh(g, material(mat));
      mesh.name = `${label} ${layer} ${mat}${group === 'add' ? ' (additive)' : ''}`;
      mesh.castShadow = layer !== 'detail' || mat !== 'glass'; mesh.receiveShadow = true;
      mesh.userData.block = this.block;
      if (group === 'add' || exemptAll) mesh.userData.localContext = true;
      (layer === 'solid' ? solids : layer === 'walk' ? walkable : detail).push(mesh);
    }
    const colliders: RAPIER.Collider[] = [];
    for (const c of [this.solidCol, this.walkCol]) {
      if (!c.triangles) continue;
      const v = new Float32Array(c.position), idx = new Uint32Array(v.length / 3).map((_, i) => i);
      colliders.push(ctx.physics.createCollider(RAPIER.ColliderDesc.trimesh(v, idx).setFriction(0.8)));
    }
    return {
      solids, walkable, detail, colliders, materials: materials.size, textures: textures.length, meshes: solids.length + walkable.length + detail.length,
      dispose: () => {
        for (const c of colliders) if (ctx.physics.getCollider(c.handle)) ctx.physics.removeCollider(c, false);
        for (const g of geometries) g.dispose();
        for (const m of materials.values()) m.dispose();
        for (const t of textures) t.dispose();
      },
    };
  }
}

/** Offset of an open polyline: each vertex moved by `d` along the miter of the edge normals `side` (+1 left of travel in
 * x-right/z-up, -1 right). Optional explicit end directions override the end miters. */
export function offsetChain(chain: Point[], d: number, side: 1 | -1, startDir?: Point, endDir?: Point): Point[] {
  const n = chain.length, normals: Point[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const a = chain[i], b = chain[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    normals.push([(-dz / l) * side, (dx / l) * side]);
  }
  return chain.map((p, i) => {
    if (i === 0 && startDir) return [p[0] + startDir[0] * d, p[1] + startDir[1] * d] as Point;
    if (i === n - 1 && endDir) return [p[0] + endDir[0] * d, p[1] + endDir[1] * d] as Point;
    const a = normals[Math.max(0, i - 1)], b = normals[Math.min(normals.length - 1, i)];
    let mx = a[0] + b[0], mz = a[1] + b[1]; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const s = d / Math.max(0.35, mx * b[0] + mz * b[1]);
    return [p[0] + mx * s, p[1] + mz * s] as Point;
  });
}
export const lerp2 = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const unit = (a: Point, b: Point): Point => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
export { V };

/** Straight raked stand in an axis frame: front line origin F0 (plan), unit axis A, outward (away from the field) N.
 * Sections [s0, s1, depth] share the same row pitch, so adjacent sections' treads are continuous; only the exposed parts of
 * section end faces are built. Treads + risers are walkable (one collider), front/back/end walls are solid. */
export function rakedStand(kit: Kit, o: {
  F0: Point; A: Point; N: Point; sections: [number, number, number][]; yFront: number; row: number; rise: number;
  ground: (x: number, z: number) => number; tread: THREE.Color; riser: THREE.Color; wall: THREE.Color; treadMat?: Mat; riserMat?: Mat; wallMat?: Mat;
}) {
  const wm = o.wallMat ?? 'matte';
  const P = (s: number, d: number): Point => [o.F0[0] + o.A[0] * s + o.N[0] * d, o.F0[1] + o.A[1] * s + o.N[1] * d];
  const Y = (j: number) => o.yFront + j * o.rise;
  const nA = o.A, nN = o.N, toField: Point = [-o.N[0], -o.N[1]];
  const low = (p: Point) => o.ground(p[0], p[1]) - 0.6;
  let rows = 0;
  o.sections.forEach(([s0, s1, depth], k) => {
    const n = Math.max(1, Math.round(depth / o.row)), dd = depth / n;
    rows = Math.max(rows, n);
    for (let j = 0; j < n; j++) {
      const a = P(s0, j * dd), b = P(s1, j * dd), c = P(s1, (j + 1) * dd), d = P(s0, (j + 1) * dd), y = Y(j);
      kit.quad('walk', o.treadMat ?? 'metal', V(a[0], y, a[1]), V(b[0], y, b[1]), V(c[0], y, c[1]), V(d[0], y, d[1]), o.tread, UP);
      if (j + 1 < n) kit.wall('walk', o.riserMat ?? 'matte', d, c, y, Y(j + 1), o.riser, toField);
    }
    // Front wall to the field and back wall to the ground.
    const f0 = P(s0, 0), f1 = P(s1, 0), b0 = P(s0, depth), b1 = P(s1, depth);
    kit.quad('solid', wm, V(f0[0], Math.min(low(f0), low(f1)), f0[1]), V(f1[0], Math.min(low(f0), low(f1)), f1[1]), V(f1[0], o.yFront, f1[1]), V(f0[0], o.yFront, f0[1]), o.wall, V(toField[0], 0, toField[1]));
    const yb = Y(n - 1), gb = Math.min(low(b0), low(b1));
    kit.quad('solid', wm, V(b0[0], gb, b0[1]), V(b1[0], gb, b1[1]), V(b1[0], yb + 1.1, b1[1]), V(b0[0], yb + 1.1, b0[1]), o.wall, V(nN[0], 0, nN[1]));
    kit.quad('solid', wm, V(b0[0], yb, b0[1]), V(b1[0], yb, b1[1]), V(b1[0], yb + 1.1, b1[1]), V(b0[0], yb + 1.1, b0[1]), o.wall, V(toField[0], 0, toField[1]));
    kit.quad('solid', wm, V(b0[0], yb + 1.1, b0[1]), V(b1[0], yb + 1.1, b1[1]), V(b1[0] - nN[0] * 0.01, yb + 1.1, b1[1] - nN[1] * 0.01), V(b0[0] - nN[0] * 0.01, yb + 1.1, b0[1] - nN[1] * 0.01), o.wall, UP);
    // End faces: stepped profile; skip the rows covered by the neighbouring section's own body.
    for (const [s, side, other] of [[s0, -1, o.sections[k - 1]], [s1, 1, o.sections[k + 1]]] as const) {
      const covered = other && Math.abs((side < 0 ? other[1] : other[0]) - s) < 1e-6 ? Math.round(other[2] / o.row) : 0;
      for (let j = covered; j < n; j++) {
        const p = P(s, j * dd), q = P(s, (j + 1) * dd), g0 = Math.min(low(p), low(q));
        kit.quad('solid', wm, V(p[0], g0, p[1]), V(q[0], g0, q[1]), V(q[0], Y(j), q[1]), V(p[0], Y(j), p[1]), o.wall, V(nA[0] * side, 0, nA[1] * side));
      }
      if (covered < n) { // back-wall rail end
        const p = P(s, depth), q = P(s, depth - 0.01);
        kit.quad('solid', wm, V(p[0], Y(n - 1), p[1]), V(q[0], Y(n - 1), q[1]), V(q[0], Y(n - 1) + 1.1, q[1]), V(p[0], Y(n - 1) + 1.1, p[1]), o.wall, V(nA[0] * side, 0, nA[1] * side));
      }
    }
  });
  return { rows, topY: +Y(rows - 1).toFixed(2) };
}

/** Stadium light mast: octagonal steel pole and a lamp-bank head (width along `along`, facing `face`). */
export function lightMast(kit: Kit, base: Point, groundY: number, topY: number, headWidth: number, along: Point, face: Point, steel: THREE.Color, lamp: THREE.Color) {
  const seg = 8, headH = 4.2, pTop = topY - headH;
  const ring = (r: number, y: number, k: number) => V(base[0] + Math.cos(k / seg * Math.PI * 2) * r, y, base[1] + Math.sin(k / seg * Math.PI * 2) * r);
  for (let k = 0; k < seg; k++) {
    const m = (k + 0.5) / seg * Math.PI * 2;
    kit.quad('solid', 'metal', ring(0.55, groundY - 0.6, k), ring(0.55, groundY - 0.6, k + 1), ring(0.35, pTop, k + 1), ring(0.35, pTop, k), steel, V(Math.cos(m), 0, Math.sin(m)));
  }
  const O: Point = [base[0] - face[0] * 0.6, base[1] - face[1] * 0.6];
  kit.box('solid', 'metal', steel, O, along, face, -headWidth / 2, headWidth / 2, -0.6, 0.6, pTop, topY);
  // Lamp faces (visual, 2 cm proud of the bank's field face).
  for (let r = 0; r < 3; r++) for (let c = 0; c < Math.max(2, Math.round(headWidth / 1.6)); c++) {
    const n = Math.max(2, Math.round(headWidth / 1.6)), w = headWidth / n, t0 = -headWidth / 2 + c * w + 0.12, t1 = t0 + w - 0.24, y0 = pTop + 0.25 + r * 1.3, y1 = y0 + 1.05;
    const Q = (t: number, y: number) => V(O[0] + along[0] * t + face[0] * 0.62, y, O[1] + along[1] * t + face[1] * 0.62);
    kit.mb('detail', 'glass').quad(Q(t0, y0), Q(t1, y0), Q(t1, y1), Q(t0, y1), [0, 0], [1, 0], [1, 1], [0, 1], lamp, V(face[0], 0, face[1]));
  }
}
