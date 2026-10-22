import * as THREE from 'three';
import { limestone } from './stone';
import { createAsphaltFinish } from './asphalt-finish';
export function materials(renderer: THREE.WebGLRenderer) {
  const loader = new THREE.TextureLoader();
  const tex = (name: string, color = false) => {
    const t = loader.load(`/assets/${name}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const brick = tex('brick-diff', true),
    bn = tex('brick-normal'),
    concrete = tex('concrete-diff', true),
    cn = tex('concrete-normal');
  const asphaltFinish = createAsphaltFinish(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  return {
    recess: new THREE.MeshStandardMaterial({
      color: 0x292a27,
      roughness: 0.95,
    }),
    clockFace: new THREE.MeshStandardMaterial({
      color: 0x858678,
      roughness: 0.78,
    }),
    clockGold: new THREE.MeshStandardMaterial({
      color: 0xb49b61,
      metalness: 0.65,
      roughness: 0.38,
    }),
    copper: new THREE.MeshStandardMaterial({
      color: 0x697c71,
      metalness: 0.55,
      roughness: 0.65,
    }),
    pclConcrete: new THREE.MeshStandardMaterial({
      normalMap: cn,
      normalScale: new THREE.Vector2(0.1, 0.1),
      color: 0xc5c1b5,
      roughness: 0.97,
    }),
    brick: new THREE.MeshStandardMaterial({
      map: brick,
      normalMap: bn,
      normalScale: new THREE.Vector2(0.4, 0.4),
      roughness: 0.9,
      color: 0xdcb69a,
    }),
    stone: limestone(cn),
    bronzePanel: new THREE.MeshStandardMaterial({
      color: 0x716c5a,
      metalness: 0.45,
      roughness: 0.64,
    }),
    trim: new THREE.MeshStandardMaterial({ color: 0xc5b694, roughness: 0.84 }),
    gdcBrick: new THREE.MeshStandardMaterial({
      map: brick,
      normalMap: bn,
      normalScale: new THREE.Vector2(0.3, 0.3),
      color: 0xffe4bc,
      roughness: 0.9,
    }),
    concrete: new THREE.MeshStandardMaterial({
      map: concrete,
      normalMap: cn,
      normalScale: new THREE.Vector2(0.35, 0.35),
      color: 0xb4b0a2,
      roughness: 0.96,
    }),
    paving: new THREE.MeshStandardMaterial({
      map: brick,
      normalMap: bn,
      color: 0xb9967c,
      roughness: 0.9,
    }),
    // Weathered asphalt albedo is ~0.08-0.12. The rendered albedo is this tint
    // multiplied by the map's linear mean. The map is the procedural fine-grain
    // tile (asphalt-finish.ts): the previously borrowed concrete-diff.jpg and its
    // normal map read as coarse cobble paving on roads once brightened. The tint
    // divides the measured per-channel mean out, so tint x map mean = 0.08 in each
    // channel (neutral grey). No normal map: roads stay smooth.
    asphalt: new THREE.MeshStandardMaterial({
      map: asphaltFinish.map,
      color: new THREE.Color(...asphaltFinish.linearMean.map(m => 0.08 / m) as [number, number, number]),
      roughness: 0.94,
    }),
    grass: Object.assign(new THREE.MeshStandardMaterial({
      name: 'Campus terrain lawn',
      map: tex('grass-diff', true),
      color: 0x82935f,
      roughness: 1,
    }), { userData: { lawn: true } }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x374c50,
      metalness: 0.85,
      roughness: 0.13,
      envMapIntensity: 1,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: 0x303e3f,
      metalness: 0.7,
      roughness: 0.42,
    }),
    roof: new THREE.MeshStandardMaterial({
      map: concrete,
      color: 0x827c72,
      roughness: 0.95,
    }),
    bark: new THREE.MeshStandardMaterial({
      map: tex('bark-diff', true),
      normalMap: tex('bark-normal'),
      normalScale: new THREE.Vector2(0.7, 0.7),
      color: 0xb4ada0,
      roughness: 1,
    }),
    leaves: new THREE.MeshStandardMaterial({ color: 0x45603c, roughness: 1 }),
  };
}
export type Materials = ReturnType<typeof materials>;
