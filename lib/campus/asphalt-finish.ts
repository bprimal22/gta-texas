import * as THREE from 'three';

/** Procedural road asphalt for the default world material (materials.ts). The borrowed
 * concrete-diff.jpg map has metre-scale blotches that, tiled every 2-4 m on roads, read as coarse
 * checker/cobble paving once the asphalt was brightened. This deterministic 256 px tile carries
 * only fine grain: tileable value noise with 2, 4 and 8 px lattices (~1.5-6 cm at the world
 * ribbons' 2 m tile, ~3-12 cm on the 4 m generated roads) and sparse 1-2 px light/dark aggregate
 * flecks. Neutral grey; no feature coarser than 8 px, so no seams or visible repeat. */
export const ASPHALT_FINISH = { size: 256, seed: 0x5a17, base: 140, grain: [[8, 5], [4, 3.5], [2, 2.5]] as [number, number][], light: 0.03, dark: 0.02 } as const;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** sRGB RGBA bytes of the tile plus their exact per-channel linear mean. */
export function asphaltFinishPixels() {
  const { size: n, seed, base, grain, light, dark } = ASPHALT_FINISH, random = rng(seed);
  const value = new Float32Array(n * n);
  for (const [cell, amp] of grain) {
    // Tileable lattice: m x m random values wrapped, smoothstep-interpolated.
    const m = n / cell, lattice = Float32Array.from({ length: m * m }, () => random() * 2 - 1);
    const at = (i: number, j: number) => lattice[((j % m) * m) + (i % m)];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const fx = x / cell, fy = y / cell, i = Math.floor(fx), j = Math.floor(fy);
      const sx = (fx - i) * (fx - i) * (3 - 2 * (fx - i)), sy = (fy - j) * (fy - j) * (3 - 2 * (fy - j));
      const top = at(i, j) + (at(i + 1, j) - at(i, j)) * sx, bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
      value[y * n + x] += amp * (top + (bottom - top) * sy);
    }
  }
  const data = new Uint8Array(n * n * 4), sum = [0, 0, 0];
  for (let k = 0; k < n * n; k++) {
    const f = random();
    let v = base + value[k];
    if (f < light) v *= 1.2; else if (f < light + dark) v *= 0.85;
    const c = Math.max(0, Math.min(255, Math.round(v)));
    for (let ch = 0; ch < 3; ch++) { data[4 * k + ch] = c; sum[ch] += toLinear(c / 255); }
    data[4 * k + 3] = 255;
  }
  return { data, linearMean: sum.map(s => s / (n * n)) as [number, number, number] };
}

/** The shared asphalt map (app-lifetime like the other world material maps; clones borrow it). */
export function createAsphaltFinish(anisotropy: number) {
  const { data, linearMean } = asphaltFinishPixels(), n = ASPHALT_FINISH.size;
  const map = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  map.name = 'Procedural road asphalt grain';
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = anisotropy;
  map.needsUpdate = true;
  return { map, linearMean };
}
