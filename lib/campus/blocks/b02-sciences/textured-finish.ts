// b02-sciences: textured PBR finishes for NEW D03 surfaces only (own copy of the engineering-core lane helper; no import of
// another block). Maps are the existing offline context sets /assets/materials/context/<family>-color|normal|rough.jpg with the
// context's own TEXTURES tile/mean/normal specs (literal URLs for the offline asset audit; never a reference photo/screenshot).
// Metre UVs come from the caller (b02 Soup: u along the wall / x, v = y / z) and texture.repeat = 1 / tile.
// color = evidence tint / texture linear mean. b02 owns and disposes these textures; nothing is borrowed or mutated.
// Without a renderer (or if loading throws) a plain same-name colour material is returned.
import * as THREE from 'three';
import { TEXTURES } from '../../context/materials';

type Family = 'buffBrick' | 'limestone' | 'metal' | 'brownBrick' | 'precast' | 'clayTile';
const URLS: Record<Family, [string, string, string]> = {
  buffBrick: ['/assets/materials/context/buffBrick-color.jpg', '/assets/materials/context/buffBrick-normal.jpg', '/assets/materials/context/buffBrick-rough.jpg'],
  limestone: ['/assets/materials/context/limestone-color.jpg', '/assets/materials/context/limestone-normal.jpg', '/assets/materials/context/limestone-rough.jpg'],
  metal: ['/assets/materials/context/metal-color.jpg', '/assets/materials/context/metal-normal.jpg', '/assets/materials/context/metal-rough.jpg'],
  brownBrick: ['/assets/materials/context/brownBrick-color.jpg', '/assets/materials/context/brownBrick-normal.jpg', '/assets/materials/context/brownBrick-rough.jpg'],
  precast: ['/assets/materials/context/precast-color.jpg', '/assets/materials/context/precast-normal.jpg', '/assets/materials/context/precast-rough.jpg'],
  clayTile: ['/assets/materials/context/clayTile-color.jpg', '/assets/materials/context/clayTile-normal.jpg', '/assets/materials/context/clayTile-rough.jpg'],
};

export class TexturedFinish {
  private sets = new Map<Family, THREE.Texture[]>();
  readonly textures: THREE.Texture[] = [];
  readonly materials: THREE.MeshStandardMaterial[] = [];
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
  material(family: Family, tintHex: string, name: string, metalness = 0): THREE.MeshStandardMaterial {
    const tint = new THREE.Color(tintHex), maps = this.set(family), T = TEXTURES[family];
    const m = maps
      ? new THREE.MeshStandardMaterial({ map: maps[0], normalMap: maps[1], roughnessMap: maps[2], roughness: 1, metalness,
          color: new THREE.Color(tint.r / T.linearMean[0], tint.g / T.linearMean[1], tint.b / T.linearMean[2]), normalScale: new THREE.Vector2(T.normal, T.normal) })
      : new THREE.MeshStandardMaterial({ color: tint, roughness: 0.9, metalness });
    m.name = name; m.userData.textured = !!maps; m.userData.family = family;
    this.materials.push(m);
    return m;
  }
  dispose() { for (const m of this.materials) m.dispose(); for (const t of this.textures) t.dispose(); }
}

/** Metre UVs for a triangle soup (positions untouched): walls by their dominant horizontal axis, up-facing triangles in plan; pitched
 * (clay-tile) triangles follow the generated-context roof convention (u across the slope, v down the fall line in slope metres). */
export function metreUVs(g: THREE.BufferGeometry, pitched = false) {
  const p = g.getAttribute('position'), uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i + 2 < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z), h = Math.hypot(n.x, n.z);
    for (let j = 0; j < 3; j++) {
      const v = j === 0 ? a : j === 1 ? b : c, o = (i + j) * 2;
      if (pitched && ay > 0.3 && h > 0.05) { const dx = n.x / h, dz = n.z / h; uv[o] = v.x * -dz + v.z * dx; uv[o + 1] = (v.x * dx + v.z * dz) / ay; }
      else if (ay >= ax && ay >= az) { uv[o] = v.x; uv[o + 1] = v.z; }
      else if (ax >= az) { uv[o] = v.z; uv[o + 1] = v.y; }
      else { uv[o] = v.x; uv[o + 1] = v.y; }
    }
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
