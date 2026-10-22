// b13-north-perimeter: PBR material families for the authored D29-D33 bodies. LOCAL COPY (adapted) of
// b11-south-medical/materials.ts (same conventions, no cross-block import): the kit collects triangles with per-vertex
// colours; every triangle is re-bucketed by its authored colour into a material FAMILY via the palette below (an unknown
// colour throws, so nothing is silently mis-textured). Families reuse the offline, same-origin CC0 PBR sets of the
// generated context (public/assets/materials/context, provenance in sources.json there) with the conventions of
// lib/campus/context/materials.ts: UVs in metres, texture repeat = 1 / tile size, material colour = 1 / LINEAR texture
// mean, so the vertex colour stays the average rendered albedo (no washed-out or darkened tint). Glass stays clean (no
// maps); plain trim (window frames, railings' paint) is an untextured satin material.
// Per-feature assignment is by colour: brick walls / stone belts / stucco / siding / shingle / clay tile / membrane /
// metal plant are distinct palette entries, so brick texture never lands on glass or roofs.
// UVs: per triangle, world-space projection onto the triangle's own plane (horizontal tangent along the face, second
// axis in-plane), so every wall, hip, gable and cap has an undistorted metre scale; flat faces use (x, z).
import * as THREE from 'three';
import type { Bucket, Mat } from './kit';
import { C } from './kit';

export type Family = 'limestone' | 'brownBrick' | 'buffBrick' | 'precast' | 'stucco' | 'siding' | 'metal' | 'shingle' | 'membrane' | 'clayTile' | 'glass' | 'trim';
type Textured = Exclude<Family, 'glass' | 'trim'>;
const url = (f: string): [string, string, string] => [`/assets/materials/context/${f}-color.jpg`, `/assets/materials/context/${f}-normal.jpg`, `/assets/materials/context/${f}-rough.jpg`];
/** Tile size (m), linear texture mean and normal strength: TEXTURES in lib/campus/context/materials.ts (copied values). */
export const PBR: Record<Textured, { tile: number; linearMean: [number, number, number]; normal: number; metalness: number; urls: [string, string, string] }> = {
  limestone: { tile: 3.0, linearMean: [0.37763, 0.28873, 0.17665], normal: 0.7, metalness: 0, urls: url('limestone') },
  brownBrick: { tile: 2.0, linearMean: [0.40217, 0.27688, 0.17404], normal: 1, metalness: 0, urls: url('brownBrick') },
  buffBrick: { tile: 1.6, linearMean: [0.31511, 0.21281, 0.14153], normal: 1, metalness: 0, urls: url('buffBrick') },
  precast: { tile: 2.7, linearMean: [0.26622, 0.23713, 0.16189], normal: 0.6, metalness: 0, urls: url('precast') },
  stucco: { tile: 3.0, linearMean: [0.34047, 0.26227, 0.18788], normal: 0.6, metalness: 0, urls: url('stucco') },
  siding: { tile: 2.6, linearMean: [0.46145, 0.3849, 0.34016], normal: 1, metalness: 0, urls: url('siding') },
  metal: { tile: 2.0, linearMean: [0.16515, 0.17019, 0.17201], normal: 0.8, metalness: 0.25, urls: url('metal') },
  shingle: { tile: 3.0, linearMean: [0.08502, 0.08427, 0.08005], normal: 1, metalness: 0, urls: url('shingle') },
  membrane: { tile: 4.0, linearMean: [0.19875, 0.16599, 0.11601], normal: 0.5, metalness: 0, urls: url('membrane') },
  clayTile: { tile: 2.8, linearMean: [0.30974, 0.08655, 0.02723], normal: 1.2, metalness: 0, urls: url('clayTile') },
};

/** The authored palette (sRGB hex). Builders use ONLY these colours; each maps to exactly one family. */
export const PAL = {
  // masonry / walls
  redBrick: '#94513f', darkRedBrick: '#7d4335', buffBrick: '#c9ad85', limestone: '#d9cdb1', castStone: '#cfc5ad',
  stuccoWhite: '#e5e2da', stuccoGrey: '#c6c8c5', stuccoBlue: '#9db2c3', stuccoCream: '#e2d6bb', stuccoWarm: '#d9cfbf',
  sidingWhite: '#e8e6df', precastLight: '#d2cec5', precastGrey: '#aeaba4',
  // roofs
  slate: '#5c6167', tileRed: '#a4533a', membraneLight: '#cfccc4', membraneTan: '#a48d70', membraneGrey: '#9c9a94',
  // metal: plant, railings, flashing, porch roof
  metalLight: '#c3c7ca', metalDark: '#3e4348', metalBlue: '#4f6f8f', metalPorch: '#5a6066', fasciaBrown: '#5d4a3b',
  // glass / plain trim
  glass: '#2a333c', glassDark: '#1f262d', door: '#3b2f2a', trimWhite: '#efeee8', trimDark: '#4a4d50',
} as const;
export const FAMILY_OF: Record<keyof typeof PAL, Family> = {
  redBrick: 'brownBrick', darkRedBrick: 'brownBrick', buffBrick: 'buffBrick', limestone: 'limestone', castStone: 'limestone',
  stuccoWhite: 'stucco', stuccoGrey: 'stucco', stuccoBlue: 'stucco', stuccoCream: 'stucco', stuccoWarm: 'stucco',
  sidingWhite: 'siding', precastLight: 'precast', precastGrey: 'precast',
  slate: 'shingle', tileRed: 'clayTile', membraneLight: 'membrane', membraneTan: 'membrane', membraneGrey: 'membrane',
  metalLight: 'metal', metalDark: 'metal', metalBlue: 'metal', metalPorch: 'metal', fasciaBrown: 'metal',
  glass: 'glass', glassDark: 'glass', door: 'trim', trimWhite: 'trim', trimDark: 'trim',
};
/** Palette colour by name (cached THREE.Color via the kit). */
export const P = (name: keyof typeof PAL) => C(PAL[name]);
const key = (r: number, g: number, b: number) => `${r},${g},${b}`;
const FAMILY = new Map((Object.keys(PAL) as (keyof typeof PAL)[]).map(n => { const c = C(PAL[n]); return [key(c.r, c.g, c.b), FAMILY_OF[n]] as const; }));
if (FAMILY.size !== Object.keys(PAL).length) throw new Error('b13 materials: two palette names share one colour');

export interface FamilyBucket { pos: number[]; col: number[] }
/** Split kit buckets (one role) into family buckets by vertex colour; triangle order within a family is preserved. */
export function byFamily(buckets: Map<Mat, Bucket>) {
  const out = new Map<Family, FamilyBucket>();
  for (const b of buckets.values()) for (let t = 0; t < b.pos.length / 9; t++) {
    const f = FAMILY.get(key(b.col[t * 9], b.col[t * 9 + 1], b.col[t * 9 + 2]));
    if (!f) throw new Error(`b13 materials: authored colour ${b.col.slice(t * 9, t * 9 + 3).join(',')} has no family`);
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
  const load = (src: string, tile: number, srgb: boolean) => {
    const tx = loader.load(src);
    tx.name = src; tx.userData.src = src;
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(1 / tile, 1 / tile); tx.anisotropy = anisotropy;
    if (srgb) tx.colorSpace = THREE.SRGBColorSpace;
    textures.push(tx); return tx;
  };
  const get = (f: Family) => {
    let m = materials.get(f); if (m) return m;
    if (f === 'glass') m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.1 });
    else if (f === 'trim') m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.15 });
    else {
      const s = PBR[f];
      m = new THREE.MeshStandardMaterial({
        map: load(s.urls[0], s.tile, true), normalMap: load(s.urls[1], s.tile, false), roughnessMap: load(s.urls[2], s.tile, false),
        roughness: 1, metalness: s.metalness, vertexColors: true, color: new THREE.Color(1 / s.linearMean[0], 1 / s.linearMean[1], 1 / s.linearMean[2]),
        normalScale: new THREE.Vector2(s.normal, s.normal),
      });
    }
    m.name = `b13 ${f}`; m.userData.family = f; materials.set(f, m); return m;
  };
  return { get, materials, textures, dispose() { for (const m of materials.values()) m.dispose(); for (const t of textures) t.dispose(); } };
}
