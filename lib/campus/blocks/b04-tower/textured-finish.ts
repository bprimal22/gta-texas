// b04-tower: textured PBR finishes for b04's OWN surfaces (GOL, GEB, BOT, Washington pedestal). Own copy of the
// engineering-core lane helper (no import of another block). Maps are the existing offline context sets
// /assets/materials/context/<family>-color|normal|rough.jpg with the context's TEXTURES tile/mean/normal specs (literal
// URLs for the offline asset audit; never a reference photograph or screenshot). Every b04 builder emits metre UVs
// (u along the surface, v up or across), and texture.repeat = 1 / tile, so one texture tile = the real tile size.
// One texture set per family is loaded and shared by every material of that family (no per-material reloads).
// color = evidence tint / texture linear mean, so the rendered average equals the tint. b04 owns and disposes these
// textures/materials; nothing is borrowed or mutated. Without a renderer (headless harness) a plain same-name colour
// material is returned with userData.textured = false (userData.family is still set for the UV-scale check).
import * as THREE from 'three';
import { TEXTURES } from '../../context/materials';

export type Family = 'buffBrick' | 'limestone' | 'clayTile' | 'stucco';
const URLS: Record<Family, [string, string, string]> = {
  buffBrick: ['/assets/materials/context/buffBrick-color.jpg', '/assets/materials/context/buffBrick-normal.jpg', '/assets/materials/context/buffBrick-rough.jpg'],
  limestone: ['/assets/materials/context/limestone-color.jpg', '/assets/materials/context/limestone-normal.jpg', '/assets/materials/context/limestone-rough.jpg'],
  clayTile: ['/assets/materials/context/clayTile-color.jpg', '/assets/materials/context/clayTile-normal.jpg', '/assets/materials/context/clayTile-rough.jpg'],
  stucco: ['/assets/materials/context/stucco-color.jpg', '/assets/materials/context/stucco-normal.jpg', '/assets/materials/context/stucco-rough.jpg'],
};

export class TexturedFinish {
  private sets = new Map<Family, THREE.Texture[] | null>();
  readonly textures: THREE.Texture[] = [];
  readonly materials: THREE.MeshStandardMaterial[] = [];
  constructor(private readonly renderer: THREE.WebGLRenderer | undefined) {}
  private set(family: Family): THREE.Texture[] | null {
    if (this.sets.has(family)) return this.sets.get(family)!;
    let s: THREE.Texture[] | null = null;
    if (this.renderer) {
      try {
        const loader = new THREE.TextureLoader(), tile = TEXTURES[family].tile;
        const anisotropy = Math.min(8, this.renderer.capabilities?.getMaxAnisotropy?.() ?? 1);
        s = URLS[family].map((url, i) => {
          const t = loader.load(url);
          t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / tile, 1 / tile); t.anisotropy = anisotropy;
          if (i === 0) t.colorSpace = THREE.SRGBColorSpace;
          this.textures.push(t); return t;
        });
      } catch { s = null; }
    }
    this.sets.set(family, s);
    return s;
  }
  /** Textured material whose rendered average colour is `tintHex` (sRGB). `roughnessScale` scales the rough map. */
  material(family: Family, tintHex: string, name: string, opts: { metalness?: number; roughnessScale?: number; normalScale?: number } = {}): THREE.MeshStandardMaterial {
    const tint = new THREE.Color(tintHex), maps = this.set(family), T = TEXTURES[family];
    const metalness = opts.metalness ?? 0, ns = (opts.normalScale ?? 1) * T.normal;
    const m = maps
      ? new THREE.MeshStandardMaterial({ map: maps[0], normalMap: maps[1], roughnessMap: maps[2], roughness: opts.roughnessScale ?? 1, metalness,
          color: new THREE.Color(tint.r / T.linearMean[0], tint.g / T.linearMean[1], tint.b / T.linearMean[2]), normalScale: new THREE.Vector2(ns, ns) })
      : new THREE.MeshStandardMaterial({ color: tint, roughness: 0.9 * (opts.roughnessScale ?? 1), metalness });
    m.name = name; m.userData.textured = !!maps; m.userData.family = family; m.userData.tileM = T.tile; m.userData.tint = tintHex;
    this.materials.push(m);
    return m;
  }
  dispose() { for (const m of this.materials) m.dispose(); for (const t of this.textures) t.dispose(); }
}

/** Replace a geometry's uv with metre box-projected coordinates (dominant normal axis per triangle): up/down faces
 * u = x, v = z; east/west faces u = z, v = y; north/south faces u = x, v = y. Positions are untouched.
 * The geometry must be non-indexed. Used for primitives whose own uvs are 0..1 per face (BoxGeometry, Lathe). */
export function metreBoxUV(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position'), uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i + 2 < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const x = p.getX(i + k), y = p.getY(i + k), z = p.getZ(i + k);
      const [u, v] = ay >= ax && ay >= az ? [x, z] : ax >= az ? [z, y] : [x, y];
      uv[(i + k) * 2] = u; uv[(i + k) * 2 + 1] = v;
    }
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
