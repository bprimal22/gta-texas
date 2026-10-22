// Block b05-southmall private PBR kit (D08/D09/D10 authored architecture).
//
// Loads only the context texture families these b05 buildings use (public/assets/materials/context, CC0 Poly
// Haven, read-only) and builds tinted MeshStandardMaterials the same way the generated context does: albedo map
// in sRGB, normal + roughness maps linear, repeat = 1 / TEXTURES[family].tile so geometry UVs are in metres, and
// colour = target linear albedo / the texture's linear mean (TEXTURES[family].linearMean), so the rendered average
// equals the target colour. No vertex colours and no facade shader (its aFac/aWin attributes do not exist here).
// The kit owns every texture and material it creates and disposes them once; no photographs are runtime assets.
import * as THREE from 'three';
import { TEXTURES } from '../../context/materials';
import type { WallFamily, RoofFamily } from '../../context/catalog';

type Family = WallFamily | RoofFamily;
const url = (f: Family, m: 'color' | 'normal' | 'rough') => `/assets/materials/context/${f}-${m}.jpg`;

/** b05 surface finishes: texture family + target sRGB colour (photo-read, see evidence notes in the district files). */
export const B05_FINISHES = {
  /** Harry Ransom Center pale shell-stone cladding (ut-hrc-570). */
  hrcStone: { family: 'limestone', color: '#d3cbbb', metalness: 0 },
  /** Batts/Mezes/Benedict cream ashlar trim (ut-mez-553, ut-ben-559). */
  mallStone: { family: 'limestone', color: '#ddd2bd', metalness: 0 },
  /** Blanton cream limestone (campus-10/11, bms campus-12). */
  blantonStone: { family: 'limestone', color: '#e5dbc8', metalness: 0 },
  /** Blanton petal canopy shells (2023, campus-10/11): off-white. */
  petal: { family: 'precast', color: '#ece6da', metalness: 0 },
  /** Cast slabs (balconies, soffits of the HRC colonnade). */
  concrete: { family: 'precast', color: '#cdc5b4', metalness: 0 },
  /** Red clay barrel tile. */
  tile: { family: 'clayTile', color: '#a65a3e', metalness: 0 },
  /** Blanton timber eave soffit (campus-11/12). */
  soffitWood: { family: 'siding', color: '#93593a', metalness: 0 },
  /** Dark steel (AT&T trellis, Blanton eave beams, railings, mullions). */
  steel: { family: 'metal', color: '#3c3e40', metalness: 0.45 },
} as const satisfies Record<string, { family: Family; color: string; metalness: number }>;
export type FinishKey = keyof typeof B05_FINISHES | 'glass' | 'gold';

export class B05Kit {
  private textures = new Map<string, THREE.Texture>();
  private materials = new Map<FinishKey, THREE.Material>();
  private loader = new THREE.TextureLoader();
  private anisotropy: number;
  constructor(renderer?: THREE.WebGLRenderer) {
    let a = 4;
    try { a = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() ?? 4); } catch { a = 4; }
    this.anisotropy = a;
  }
  private tex(family: Family, map: 'color' | 'normal' | 'rough') {
    const key = `${family}:${map}`;
    let t = this.textures.get(key);
    if (!t) {
      t = this.loader.load(url(family, map));
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      const tile = TEXTURES[family].tile;
      t.repeat.set(1 / tile, 1 / tile);
      t.anisotropy = this.anisotropy;
      if (map === 'color') t.colorSpace = THREE.SRGBColorSpace;
      t.name = `b05 ${key}`;
      this.textures.set(key, t);
    }
    return t;
  }
  material(key: FinishKey): THREE.Material {
    let m = this.materials.get(key);
    if (m) return m;
    if (key === 'glass') {
      m = new THREE.MeshStandardMaterial({ color: '#1c2731', roughness: 0.08, metalness: 0.4 });
    } else if (key === 'gold') {
      m = new THREE.MeshStandardMaterial({ color: '#d4a62e', roughness: 0.35, metalness: 0.5 });
    } else {
      const f = B05_FINISHES[key], spec = TEXTURES[f.family], mean = spec.linearMean;
      const target = new THREE.Color(f.color); // linear working colour
      const s = new THREE.MeshStandardMaterial({
        map: this.tex(f.family, 'color'), normalMap: this.tex(f.family, 'normal'), roughnessMap: this.tex(f.family, 'rough'),
        roughness: 1, metalness: f.metalness, normalScale: new THREE.Vector2(spec.normal, spec.normal),
        color: new THREE.Color(target.r / mean[0], target.g / mean[1], target.b / mean[2]),
      });
      if (key === 'petal') s.side = THREE.DoubleSide;
      m = s;
    }
    m.name = `b05 ${key}`;
    this.materials.set(key, m);
    return m;
  }
  stats() { return { textures: this.textures.size, materials: this.materials.size, families: [...new Set([...this.textures.keys()].map(k => k.split(':')[0]))] }; }
  dispose() {
    for (const m of this.materials.values()) m.dispose();
    for (const t of this.textures.values()) t.dispose();
    this.materials.clear(); this.textures.clear();
  }
}
