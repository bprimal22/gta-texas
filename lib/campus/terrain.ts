import * as THREE from 'three';
import type { TerrainData } from './types';
export class Terrain {
  constructor(public data: TerrainData,
    private readonly authoredHeight?: (x:number,z:number)=>number|null) {}
  height(x: number, z: number) {
    const authored=this.authoredHeight?.(x,z);
    if(authored!==undefined&&authored!==null&&Number.isFinite(authored))return authored;
    const d = this.data,
      fx = THREE.MathUtils.clamp((x - d.x0) / d.step, 0, d.nx - 1.001),
      fz = THREE.MathUtils.clamp((z - d.z0) / d.step, 0, d.nz - 1.001);
    const ix = Math.floor(fx),
      iz = Math.floor(fz),
      u = fx - ix,
      v = fz - iz,
      i = iz * d.nx + ix;
    const a = d.heights[i],
      b = d.heights[i + 1],
      c = d.heights[i + d.nx],
      e = d.heights[i + d.nx + 1];
    // Match the actual diagonal used by the physics/render triangle mesh.
    return u + v <= 1
      ? a + (b - a) * u + (c - a) * v
      : e + (c - e) * (1 - u) + (b - e) * (1 - v);
  }
  geometry() {
    const d = this.data,
      pos = new Float32Array(d.nx * d.nz * 3),
      uv = new Float32Array(d.nx * d.nz * 2),
      indices: number[] = [];
    for (let z = 0; z < d.nz; z++)
      for (let x = 0; x < d.nx; x++) {
        const i = z * d.nx + x;
        pos.set([d.x0 + x * d.step, d.heights[i], d.z0 + z * d.step], i * 3);
        uv.set([(x * d.step) / 2, (z * d.step) / 2], i * 2);
        if (x < d.nx - 1 && z < d.nz - 1)
          indices.push(i, i + d.nx, i + 1, i + 1, i + d.nx, i + d.nx + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }
}
