// b03-gdc-speedway: textured PBR finishes for b03's OWN new surfaces (power plant chimneys, cooling-tower fan shrouds).
// Own copy of the engineering-core lane helper (no import of another block). Maps are the existing offline context sets
// /assets/materials/context/<family>-color|normal|rough.jpg with the context's TEXTURES tile/mean/normal specs (literal
// URLs for the offline asset audit; never a reference photograph or screenshot). Builders emit metre UVs (cylinders:
// u = arc length, v = y; discs: u = x, v = z) and texture.repeat = 1 / tile. One texture set per family is shared.
// Vertex-tinted variant: the geometry keeps its evidence colours as vertex colours and the material colour is the
// inverse of the texture's linear mean, so the rendered average equals the vertex colour (texture adds pattern, normal
// and roughness only). Without a renderer (headless harness) a plain vertex-colour material is returned
// (userData.textured = false; userData.family/tileM still set for the UV-scale check).
import * as THREE from 'three';
import { TEXTURES } from '../../context/materials';

export type Family = 'buffBrick' | 'metal';
const URLS: Record<Family, [string, string, string]> = {
  buffBrick: ['/assets/materials/context/buffBrick-color.jpg', '/assets/materials/context/buffBrick-normal.jpg', '/assets/materials/context/buffBrick-rough.jpg'],
  metal: ['/assets/materials/context/metal-color.jpg', '/assets/materials/context/metal-normal.jpg', '/assets/materials/context/metal-rough.jpg'],
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
  /** Vertex-colour-tinted textured material. */
  vertexTinted(family: Family, name: string, opts: { roughness: number; metalness: number }): THREE.MeshStandardMaterial {
    const maps = this.set(family), T = TEXTURES[family];
    const m = maps
      ? new THREE.MeshStandardMaterial({ vertexColors: true, map: maps[0], normalMap: maps[1], roughnessMap: maps[2], roughness: opts.roughness, metalness: opts.metalness,
          color: new THREE.Color(1 / T.linearMean[0], 1 / T.linearMean[1], 1 / T.linearMean[2]), normalScale: new THREE.Vector2(T.normal, T.normal) })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: opts.roughness, metalness: opts.metalness });
    m.name = name; m.userData.textured = !!maps; m.userData.family = family; m.userData.tileM = T.tile;
    this.materials.push(m);
    return m;
  }
  dispose() { for (const m of this.materials) m.dispose(); for (const t of this.textures) t.dispose(); }
}
