// b12-west-campus: PBR material families for the Group 2 district bodies (district.ts), adapted from
// b11-south-medical/materials.ts (a local copy: blocks stay independent). The pre-existing round-2 towers keep their own
// vertex-colour materials (index.ts); only the new district kit is partitioned here.
// Every triangle is assigned a family by its authored colour (PAL below, the only colours district.ts may use; an unknown
// colour throws). Families reuse the offline same-origin CC0 PBR sets of the generated context
// (public/assets/materials/context, provenance in sources.json there) with its conventions (lib/campus/context/materials.ts):
// UVs in metres, texture repeat = 1 / tile, material colour = 1 / linear texture mean so the vertex colour is the average
// rendered albedo (no washed-out tint). Glass and trim carry no maps.
// UVs: per triangle, projection onto the triangle's own plane (horizontal tangent along the face); flat faces use (x, z);
// near-degenerate slivers map along their longest edge. Positions are copied unchanged (collider built in index.ts).
import * as THREE from 'three';
import type { Bucket, Mat } from './kit';
import { C } from './kit';

export type Family = 'stucco' | 'brownBrick' | 'precast' | 'limestone' | 'shingle' | 'membrane' | 'metal' | 'glass' | 'trim';
type Textured = Exclude<Family, 'glass' | 'trim'>;
/** Tile size (m), linear mean, normal strength: TEXTURES in lib/campus/context/materials.ts (copied values). */
export const PBR: Record<Textured, { tile: number; linearMean: [number, number, number]; normal: number; metalness: number; urls: [string, string, string] }> = {
  stucco: { tile: 3.0, linearMean: [0.34047, 0.26227, 0.18788], normal: 0.6, metalness: 0, urls: ['/assets/materials/context/stucco-color.jpg', '/assets/materials/context/stucco-normal.jpg', '/assets/materials/context/stucco-rough.jpg'] },
  brownBrick: { tile: 2.0, linearMean: [0.40217, 0.27688, 0.17404], normal: 1, metalness: 0, urls: ['/assets/materials/context/brownBrick-color.jpg', '/assets/materials/context/brownBrick-normal.jpg', '/assets/materials/context/brownBrick-rough.jpg'] },
  precast: { tile: 2.7, linearMean: [0.26622, 0.23713, 0.16189], normal: 0.6, metalness: 0, urls: ['/assets/materials/context/precast-color.jpg', '/assets/materials/context/precast-normal.jpg', '/assets/materials/context/precast-rough.jpg'] },
  limestone: { tile: 3.0, linearMean: [0.37763, 0.28873, 0.17665], normal: 0.7, metalness: 0, urls: ['/assets/materials/context/limestone-color.jpg', '/assets/materials/context/limestone-normal.jpg', '/assets/materials/context/limestone-rough.jpg'] },
  shingle: { tile: 3.0, linearMean: [0.08502, 0.08427, 0.08005], normal: 1, metalness: 0, urls: ['/assets/materials/context/shingle-color.jpg', '/assets/materials/context/shingle-normal.jpg', '/assets/materials/context/shingle-rough.jpg'] },
  membrane: { tile: 4.0, linearMean: [0.19875, 0.16599, 0.11601], normal: 0.5, metalness: 0, urls: ['/assets/materials/context/membrane-color.jpg', '/assets/materials/context/membrane-normal.jpg', '/assets/materials/context/membrane-rough.jpg'] },
  metal: { tile: 2.0, linearMean: [0.16515, 0.17019, 0.17201], normal: 0.8, metalness: 0.25, urls: ['/assets/materials/context/metal-color.jpg', '/assets/materials/context/metal-normal.jpg', '/assets/materials/context/metal-rough.jpg'] },
};
/** Authored palette (rendered average albedo, sRGB hex) -> family. Values interpreted from the actual orbit frames. */
export const PAL = {
  // D25 2529 Rio Grande townhouses (571123:534) + Delta Gamma (549218:389)
  townWall: ['#dedcd4', 'stucco'], townTrim: ['#f1efe8', 'stucco'], townRoof: ['#6d5b5a', 'shingle'], townStack: ['#ebe9e2', 'stucco'],
  dgWall: ['#e6e4de', 'stucco'], dgMansard: ['#3f4146', 'shingle'], flatRoof: ['#aaa7a0', 'membrane'],
  // D26 Twenty Two 15 (528395:313)
  tfWall: ['#ebe9e4', 'stucco'], tfBrickBase: ['#a8705f', 'brownBrick'], tfBrickBay: ['#9b4f40', 'brownBrick'], coping: ['#d3cfc6', 'precast'],
  // D27 red-brick block (652834:858)
  rbWall: ['#a4473a', 'brownBrick'], rbFrame: ['#d8d1c4', 'limestone'], rbRoof: ['#8d8b86', 'membrane'], rbParapet: ['#a14538', 'brownBrick'],
  // D28 Moody Bank Tower (592244:630)
  mbPier: ['#bca889', 'precast'], mbArch: ['#cdbd9f', 'limestone'], mbBand: ['#e3ded3', 'precast'], mbSpandrel: ['#4a4643', 'metal'], mbMech: ['#a5a8a8', 'metal'], mbSoffit: ['#d8d2c4', 'limestone'], mbCrown: ['#1f2022', 'metal'],
  // shared
  glass: ['#273036', 'glass'], tealGlass: ['#4f9893', 'glass'], storefront: ['#1e2629', 'glass'], frameDark: ['#2c2f31', 'trim'], frameLight: ['#e8e6df', 'trim'],
} as const satisfies Record<string, readonly [string, Family]>;
export const col = (k: keyof typeof PAL) => C(PAL[k][0]);
const key = (r: number, g: number, b: number) => `${r},${g},${b}`;
const FAMILY = new Map(Object.values(PAL).map(([hex, f]) => { const c = C(hex); return [key(c.r, c.g, c.b), f as Family]; }));

export interface FamilyBucket { pos: number[]; col: number[] }
/** Split kit buckets (one role) into family buckets by vertex colour; triangle order within a family is preserved. */
export function byFamily(buckets: Map<Mat, Bucket>) {
  const out = new Map<Family, FamilyBucket>();
  for (const b of buckets.values()) for (let t = 0; t < b.pos.length / 9; t++) {
    const f = FAMILY.get(key(b.col[t * 9], b.col[t * 9 + 1], b.col[t * 9 + 2]));
    if (!f) throw new Error(`b12 pbr: authored colour ${b.col.slice(t * 9, t * 9 + 3).join(',')} has no family`);
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
    if (l <= 1e-6 * lmax) { // near-degenerate sliver: its normal is noise, so map along its longest edge (isometric)
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
    else if (f === 'trim') m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 });
    else {
      const s = PBR[f];
      m = new THREE.MeshStandardMaterial({
        map: load(s.urls[0], s.tile, true), normalMap: load(s.urls[1], s.tile, false), roughnessMap: load(s.urls[2], s.tile, false),
        roughness: 1, metalness: s.metalness, vertexColors: true, color: new THREE.Color(1 / s.linearMean[0], 1 / s.linearMean[1], 1 / s.linearMean[2]),
        normalScale: new THREE.Vector2(s.normal, s.normal),
      });
    }
    m.name = `b12 district ${f}`; materials.set(f, m); return m;
  };
  return { get, materials, textures, dispose() { for (const m of materials.values()) m.dispose(); for (const t of textures) t.dispose(); } };
}
