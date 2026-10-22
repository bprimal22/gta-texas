// b11-south-medical: PBR material families for the authored D23 / D24 bodies (material-only pass; geometry frozen).
// The kit collects triangles per coarse class (matte / glass / metal) with per-vertex colours. Here every triangle is
// re-bucketed by its authored colour into a material FAMILY (the colour -> family table below is the authored palette of
// hargis.ts / jordan.ts; an unknown colour throws so nothing is silently mis-textured). Families reuse the offline,
// same-origin CC0 PBR sets of the generated context (public/assets/materials/context, provenance in sources.json there)
// with the same conventions as lib/campus/context/materials.ts: UVs in metres, texture repeat = 1 / tile size, material
// colour = 1 / linear texture mean so the vertex colour stays the average rendered albedo. Glass stays clean (no maps).
// UVs: per triangle, world-space projection onto the triangle's own plane (horizontal tangent along the face, second
// axis in-plane), so every wall, hip, gable and cap has an undistorted metre scale; flat faces use (x, z).
// Positions / triangles are copied unchanged; the collider is still built from the kit's solid buckets in index.ts.
import * as THREE from 'three';
import type { Bucket, Mat } from './kit';
import { C } from './kit';

export type Family = 'limestone' | 'brownBrick' | 'precast' | 'metal' | 'glass' | 'trim';
/** Tile size (m), linear texture mean and normal strength: TEXTURES in lib/campus/context/materials.ts (copied). */
export const PBR: Record<Exclude<Family, 'glass' | 'trim'>, { tile: number; linearMean: [number, number, number]; normal: number; metalness: number; urls: [string, string, string] }> = {
  limestone: { tile: 3.0, linearMean: [0.37763, 0.28873, 0.17665], normal: 0.7, metalness: 0, urls: ['/assets/materials/context/limestone-color.jpg', '/assets/materials/context/limestone-normal.jpg', '/assets/materials/context/limestone-rough.jpg'] },
  brownBrick: { tile: 2.0, linearMean: [0.40217, 0.27688, 0.17404], normal: 1, metalness: 0, urls: ['/assets/materials/context/brownBrick-color.jpg', '/assets/materials/context/brownBrick-normal.jpg', '/assets/materials/context/brownBrick-rough.jpg'] },
  precast: { tile: 2.7, linearMean: [0.26622, 0.23713, 0.16189], normal: 0.6, metalness: 0, urls: ['/assets/materials/context/precast-color.jpg', '/assets/materials/context/precast-normal.jpg', '/assets/materials/context/precast-rough.jpg'] },
  metal: { tile: 2.0, linearMean: [0.16515, 0.17019, 0.17201], normal: 0.8, metalness: 0.25, urls: ['/assets/materials/context/metal-color.jpg', '/assets/materials/context/metal-normal.jpg', '/assets/materials/context/metal-rough.jpg'] },
};
/** Authored palette -> family. Hargis: cream masonry walls / light stone dressings / plinth = limestone (local stone grain);
 * cornice, pilasters, voussoirs and pediment tympanum = brown brick; standing-seam hips and caps = metal. Jordan: fins,
 * spandrel bands, parapet, columns, colonnade soffit/returns, service base and deck = precast (mineral grain); curtain
 * wall = clean glass; mechanical enclosure = metal; flush mullions and loading doors = plain trim. 531887:350 = precast. */
const PALETTE: [string, Family][] = [
  ['#dcd3bf', 'limestone'], ['#ece6d6', 'limestone'], ['#b9ae95', 'limestone'],
  ['#8a5444', 'brownBrick'], ['#9a4b38', 'brownBrick'],
  ['#8d9eaa', 'metal'], ['#a9adae', 'metal'],
  ['#e4e6e2', 'precast'], ['#c9c7c0', 'precast'], ['#b8b6b0', 'precast'], ['#dcdcd6', 'precast'],
  ['#2b7f86', 'glass'], ['#2d353b', 'glass'], ['#24282c', 'glass'],
  ['#d6dad8', 'trim'], ['#5d6063', 'trim'],
];
const key = (r: number, g: number, b: number) => `${r},${g},${b}`;
const FAMILY = new Map(PALETTE.map(([hex, f]) => { const c = C(hex); return [key(c.r, c.g, c.b), f]; }));

export interface FamilyBucket { pos: number[]; col: number[] }
/** Split kit buckets (one role) into family buckets by vertex colour; triangle order within a family is preserved. */
export function byFamily(buckets: Map<Mat, Bucket>) {
  const out = new Map<Family, FamilyBucket>();
  for (const b of buckets.values()) for (let t = 0; t < b.pos.length / 9; t++) {
    const f = FAMILY.get(key(b.col[t * 9], b.col[t * 9 + 1], b.col[t * 9 + 2]));
    if (!f) throw new Error(`b11 materials: authored colour ${b.col.slice(t * 9, t * 9 + 3).join(',')} has no family`);
    let fb = out.get(f); if (!fb) out.set(f, fb = { pos: [], col: [] });
    for (let i = 0; i < 9; i++) { fb.pos.push(b.pos[t * 9 + i]); fb.col.push(b.col[t * 9 + i]); }
  }
  return out;
}

/** Geometry with position, colour, flat normals and per-triangle metre UVs (projection onto the triangle's plane). */
export function familyGeometry(fb: FamilyBucket) {
  const n = fb.pos.length / 9, uv = new Float32Array(n * 6);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3(), t = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const p = fb.pos, o = i * 9;
    a.set(p[o], p[o + 1], p[o + 2]); b.set(p[o + 3], p[o + 4], p[o + 5]); c.set(p[o + 6], p[o + 7], p[o + 8]);
    nn.subVectors(b, a).cross(s.subVectors(c, a)); const l = nn.length(); if (l > 0) nn.divideScalar(l);
    const h = Math.hypot(nn.x, nn.z), lmax = Math.max(a.distanceToSquared(b), b.distanceToSquared(c), c.distanceToSquared(a));
    if (l <= 1e-6 * lmax) { // near-degenerate clip sliver: its normal is noise, so map along its longest edge (isometric)
      const [p0, p1] = [[a, b], [b, c], [c, a]].reduce((m, e) => (e[0].distanceToSquared(e[1]) > m[0].distanceToSquared(m[1]) ? e : m));
      t.subVectors(p1, p0).normalize(); s.set(-t.z, 0, t.x); if (s.lengthSq() < 1e-12) s.set(1, 0, 0); else s.normalize();
    } else if (h < 1e-4) { t.set(1, 0, 0); s.set(0, 0, 1); } // flat: plan coordinates
    else { t.set(-nn.z / h, 0, nn.x / h); s.crossVectors(t, nn).normalize(); if (s.y < 0) s.negate(); }
    [a, b, c].forEach((v, k) => { uv[i * 6 + k * 2] = v.dot(t); uv[i * 6 + k * 2 + 1] = v.dot(s); });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(fb.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(fb.col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

/** Owned material set: loads the local PBR maps once per family (same-origin literal URLs), disposes them with dispose(). */
export function createFamilyMaterials(renderer?: THREE.WebGLRenderer) {
  const loader = new THREE.TextureLoader(), textures: THREE.Texture[] = [], materials = new Map<Family, THREE.MeshStandardMaterial>();
  const anisotropy = Math.min(8, renderer?.capabilities.getMaxAnisotropy() ?? 4);
  const load = (url: string, tile: number, srgb: boolean) => {
    const tx = loader.load(url);
    tx.name = url; tx.userData.src = url;
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(1 / tile, 1 / tile); tx.anisotropy = anisotropy;
    if (srgb) tx.colorSpace = THREE.SRGBColorSpace;
    textures.push(tx); return tx;
  };
  const get = (f: Family) => {
    let m = materials.get(f); if (m) return m;
    if (f === 'glass') m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.1 });
    else if (f === 'trim') m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.4 });
    else {
      const s = PBR[f];
      m = new THREE.MeshStandardMaterial({
        map: load(s.urls[0], s.tile, true), normalMap: load(s.urls[1], s.tile, false), roughnessMap: load(s.urls[2], s.tile, false),
        roughness: 1, metalness: s.metalness, vertexColors: true, color: new THREE.Color(1 / s.linearMean[0], 1 / s.linearMean[1], 1 / s.linearMean[2]),
        normalScale: new THREE.Vector2(s.normal, s.normal),
      });
    }
    m.name = `b11 ${f}`; materials.set(f, m); return m;
  };
  return { get, materials, textures, dispose() { for (const m of materials.values()) m.dispose(); for (const t of textures) t.dispose(); } };
}
