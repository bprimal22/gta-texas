// b06-northwest: textured PBR finishes for the NEW district geometry only (D12 Kinsolving 'b06 kin ' meshes, D11 CMB facade
// buckets). Round-2 meshes and the Honors Quad keep their own plain materials, untouched.
//  * Maps: the existing offline context sets (public/assets/materials/context/<family>-color|normal|rough.jpg, the same files
//    and the same TEXTURES tile/mean/normal specs the generated context uses). URLs are literal for the offline asset audit.
//    Never a reference photograph or tile screenshot.
//  * Scale: metre UVs (dominant-plane projection, metreUVs()) and texture.repeat = 1 / tile, as the context does.
//  * Albedo: color = target linear colour / texture linear mean, so the textured average equals the evidence-based tint.
//  * Ownership: b06 loads its own Texture objects (one set per family actually used, <= 5 families) and disposes them in
//    dispose(); nothing is borrowed, so no shared material or texture is ever modified or freed.
//  * Fallback: without a renderer, or if a texture cannot be created, the material is a plain colour of the same name.
import * as THREE from 'three';
import { TEXTURES } from '../../context/materials';

type Family = 'buffBrick' | 'limestone' | 'precast' | 'metal' | 'membrane' | 'clayTile';
const URLS: Record<Family, [string, string, string]> = {
  buffBrick: ['/assets/materials/context/buffBrick-color.jpg', '/assets/materials/context/buffBrick-normal.jpg', '/assets/materials/context/buffBrick-rough.jpg'],
  limestone: ['/assets/materials/context/limestone-color.jpg', '/assets/materials/context/limestone-normal.jpg', '/assets/materials/context/limestone-rough.jpg'],
  precast: ['/assets/materials/context/precast-color.jpg', '/assets/materials/context/precast-normal.jpg', '/assets/materials/context/precast-rough.jpg'],
  metal: ['/assets/materials/context/metal-color.jpg', '/assets/materials/context/metal-normal.jpg', '/assets/materials/context/metal-rough.jpg'],
  membrane: ['/assets/materials/context/membrane-color.jpg', '/assets/materials/context/membrane-normal.jpg', '/assets/materials/context/membrane-rough.jpg'],
  clayTile: ['/assets/materials/context/clayTile-color.jpg', '/assets/materials/context/clayTile-normal.jpg', '/assets/materials/context/clayTile-rough.jpg'],
};
/** Material key -> texture family, evidence tint (sRGB hex), metalness. Tints: see kinsolving.ts / index.ts CMB notes. */
/** D12 Honors Quad appearance follow-up (root-authorized): textured finishes for the 'b06 honors ' meshes ONLY (material names
 * 'b06 honors <key>'); tints = the existing honors plain colours (honors-quad.ts HONORS_MATERIALS / index.ts MATERIALS), so the
 * evidence-based palette is unchanged and only surface texture is added. The church / LFH / round-2 'tile' and 'limestone'
 * materials stay plain. Clay tile: red tile seen in b06-r0-b1-30m (foreground Honors roofs) and the d12 orbits. */
export const HONORS_TEXTURED: Record<string, { family: Family; tint: string; metalness?: number }> = {
  tanBrick: { family: 'buffBrick', tint: '#c6a47a' }, brickShade: { family: 'buffBrick', tint: '#ad8d64' },
  paleBase: { family: 'limestone', tint: '#e3ddcf' }, limestone: { family: 'limestone', tint: '#d8cdb5' },
  tile: { family: 'clayTile', tint: '#a3533a' }, membrane: { family: 'membrane', tint: '#9d9a94' },
};
export const TEXTURED: Record<string, { family: Family; tint: string; metalness?: number }> = {
  kinBrick: { family: 'buffBrick', tint: '#d4bb90' },      // light buff brick (b06-r0-b1-30m, ut-kin-400 photo)
  kinTrim: { family: 'limestone', tint: '#e3dccb' },       // pale coping, sills/heads
  kinPortal: { family: 'limestone', tint: '#e3dccb' },     // entrance stone surrounds (ut-kin-400 photo)
  kinRoof: { family: 'membrane', tint: '#9d9a94' },        // flat roof membrane (LiDAR flat 1.2 deg)
  cmbMetal: { family: 'metal', tint: '#3e4145', metalness: 0.35 }, // charcoal ribbed metal (ut-cmb-654 / ut-hsm-653 / ut-lch-625)
  cmbBase: { family: 'precast', tint: '#d6d1c4' },        // pale base under the metal box (ut-cmb-654)
};

export class TexturedFinish {
  private sets = new Map<Family, THREE.Texture[]>();
  readonly textures: THREE.Texture[] = [];
  constructor(private readonly renderer: THREE.WebGLRenderer | undefined) {}
  private set(family: Family): THREE.Texture[] | null {
    if (!this.renderer) return null;
    let s = this.sets.get(family);
    if (s) return s;
    try {
      const loader = new THREE.TextureLoader(), tile = TEXTURES[family].tile;
      const anisotropy = Math.min(8, this.renderer.capabilities?.getMaxAnisotropy?.() ?? 1);
      s = URLS[family].map((url, i) => {
        const t = loader.load(url);
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / tile, 1 / tile); t.anisotropy = anisotropy;
        if (i === 0) t.colorSpace = THREE.SRGBColorSpace;
        this.textures.push(t); return t;
      });
    } catch { return null; }
    this.sets.set(family, s);
    return s;
  }
  /** Textured material for a TEXTURED key (plain same-name fallback without a renderer / textures). */
  material(key: string, name: string, table: Record<string, { family: Family; tint: string; metalness?: number }> = TEXTURED): THREE.MeshStandardMaterial {
    const spec = table[key], tint = new THREE.Color(spec.tint), maps = this.set(spec.family), T = TEXTURES[spec.family];
    const m = maps
      ? new THREE.MeshStandardMaterial({ map: maps[0], normalMap: maps[1], roughnessMap: maps[2], roughness: 1, metalness: spec.metalness ?? 0,
          color: new THREE.Color(tint.r / T.linearMean[0], tint.g / T.linearMean[1], tint.b / T.linearMean[2]), normalScale: new THREE.Vector2(T.normal, T.normal) })
      : new THREE.MeshStandardMaterial({ color: tint, roughness: 0.9, metalness: spec.metalness ?? 0 });
    m.name = name; m.userData.textured = !!maps; m.userData.family = spec.family;
    return m;
  }
  dispose() { for (const t of this.textures) t.dispose(); }
}

/** Dominant-plane metre UVs (walls: horizontal run along the face x or z, height y; roofs/caps: x, z). Positions untouched. */
/** Clay-tile roof UVs (same convention as the generated context roofs, context/architecture.ts): u across the slope, v down the
 * fall line in slope metres; near-flat triangles fall back to plan x, z. Positions untouched. */
export function slopeUVs(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position'), uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i + 2 < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(b, a).cross(c.clone().sub(a)); if (n.y < 0) n.negate(); n.normalize();
    const h = Math.hypot(n.x, n.z), flat = h < 0.05, dx = flat ? 1 : n.x / h, dz = flat ? 0 : n.z / h, k = flat ? 1 : 1 / Math.max(0.2, n.y);
    for (let j = 0; j < 3; j++) { const v = j === 0 ? a : j === 1 ? b : c, o = (i + j) * 2;
      if (flat) { uv[o] = v.x; uv[o + 1] = v.z; } else { uv[o] = v.x * -dz + v.z * dx; uv[o + 1] = (v.x * dx + v.z * dz) * k; } }
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
export function metreUVs(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position'), uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i + 2 < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(b, a).cross(c.clone().sub(a));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? b : c, o = (i + k) * 2;
      if (ay >= ax && ay >= az) { uv[o] = v.x; uv[o + 1] = v.z; }
      else if (ax >= az) { uv[o] = v.z; uv[o + 1] = v.y; }
      else { uv[o] = v.x; uv[o + 1] = v.y; }
    }
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
