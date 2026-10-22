// Block b03: the two Hal C. Weaver power plant chimneys, from the USGS 3DEP 2017 point cloud.
//
// Measured (research/whole-campus-92/b03-gdc-speedway/derived/r2/stacks.json; points from the LiDAR lane's
// aligned extraction, campus Y = NAVD88 - 165, same horizontal shift as roofs-lidar.json):
//  A  inside City ring 613959 (the 1927 plant, PPL): 173 returns between campus Y 30 and 59.7, centre
//     (193.9, -70.4), 4.1 m across at mid height, 3.6 m at the rim; top campus Y 59.7 = 64.0 m above the
//     LiDAR ground (-4.3), i.e. the published 212 ft (64.6 m) stack and the City height 64.1 m of the record.
//  B  inside City ring 594130: 218 returns, centre (99.2, -68.5), 4.6 m across, 3.8 m at the rim, top campus
//     Y 47.3 (46.5 m above ground -0.8: the record's LiDAR max 46.6), a 6.5 m wide platform/collar return
//     band at campus Y 34-37.
// Colours/collar are interpreted from the Codex photo-only capture live-reference/gdc-power-plant-north-photo-only
// (A orange-red brick, B pale buff brick with a light band), not measured. Bases sit inside the generated
// roofs (below the measured roof levels), so only the part above the roof shows.
// Round 3 (D05): metre UVs (u = arc length round the shaft, v = height; rims/floors u = x, v = z) and a b03-owned
// textured brick finish (offline buffBrick colour/normal/roughness maps, ./textured-finish.ts) tinted by the same vertex
// colours. Positions, triangles and the collider are unchanged.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { BlockInstallContext } from '../types';
import type { TexturedFinish } from './textured-finish';

export interface Stack { id: string; record: string; centre: [number, number]; baseY: number; topY: number; rBase: number; rTop: number; color: number; collar?: { y0: number; y1: number; r: number; color: number } }
export const STACKS: Stack[] = [
  { id: 'A', record: '613959', centre: [193.9, -70.4], baseY: 7.0, topY: 59.7, rBase: 2.2, rTop: 1.85, color: 0xa86a45 },
  { id: 'B', record: '594130', centre: [99.2, -68.5], baseY: 11.0, topY: 47.3, rBase: 2.35, rTop: 1.9, color: 0xcbb38f,
    collar: { y0: 34.9, y1: 36.1, r: 3.0, color: 0xddd2bd } },
];
export const SEG = 20; const LIP = 0.32, FLUE = 2.5;

export class Builder {
  pos: number[] = []; col: number[] = []; uv: number[] = [];
  private c = new THREE.Color();
  /** `uvs` (metres) per vertex; default u = x, v = z (horizontal faces). */
  tri(a: number[], b: number[], c: number[], color: number, uvs?: [number, number][]) {
    this.c.setHex(color).convertSRGBToLinear();
    [a, b, c].forEach((p, k) => { this.pos.push(p[0], p[1], p[2]); this.col.push(this.c.r, this.c.g, this.c.b); const t = uvs ? uvs[k] : [p[0], p[2]]; this.uv.push(t[0], t[1]); });
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
  /** Frustum band between radii r0 (y0) and r1 (y1); outward true = normals away from the axis. */
  band(cx: number, cz: number, y0: number, r0: number, y1: number, r1: number, color: number, outward = true) {
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
      const p = (r: number, a: number, y: number) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
      const A = p(r0, a0, y0), B = p(r0, a1, y0), C = p(r1, a1, y1), D = p(r1, a0, y1);
      // Metre uvs: arc length at the mean radius, height (one texture tile = its real size on the shaft).
      const rm = (r0 + r1) / 2, uA: [number, number] = [a0 * rm, y0], uB: [number, number] = [a1 * rm, y0], uC: [number, number] = [a1 * rm, y1], uD: [number, number] = [a0 * rm, y1];
      if (outward) { this.tri(A, C, B, color, [uA, uC, uB]); this.tri(A, D, C, color, [uA, uD, uC]); } else { this.tri(A, B, C, color, [uA, uB, uC]); this.tri(A, C, D, color, [uA, uC, uD]); }
    }
  }
  /** Horizontal annulus (r0 outer, r1 inner; r1 = 0 -> disk) facing up or down. */
  ring(cx: number, cz: number, y: number, r0: number, r1: number, color: number, up = true) {
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
      const p = (r: number, a: number) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
      const A = p(r0, a0), B = p(r0, a1), C = p(r1, a1), D = p(r1, a0);
      if (up) { this.tri(A, C, B, color); if (r1 > 0) this.tri(A, D, C, color); } else { this.tri(A, B, C, color); if (r1 > 0) this.tri(A, C, D, color); }
    }
  }
}

export function buildPowerPlantStacks(ctx: BlockInstallContext, tex: TexturedFinish) {
  const b = new Builder();
  for (const s of STACKS) {
    const [x, z] = s.centre, rAt = (y: number) => s.rBase + (s.rTop - s.rBase) * (y - s.baseY) / (s.topY - s.baseY);
    if (s.collar) {
      const { y0, y1, r, color } = s.collar;
      b.band(x, z, s.baseY, s.rBase, y0, rAt(y0), s.color);
      b.ring(x, z, y0, r, rAt(y0), color, false);
      b.band(x, z, y0, r, y1, r, color);
      b.ring(x, z, y1, r, rAt(y1), color, true);
      b.band(x, z, y1, rAt(y1), s.topY, s.rTop, s.color);
    } else b.band(x, z, s.baseY, s.rBase, s.topY, s.rTop, s.color);
    // Rim, flue lining and a dark flue floor (open top, not a capped cylinder).
    b.ring(x, z, s.topY, s.rTop, s.rTop - LIP, s.color, true);
    b.band(x, z, s.topY - FLUE, s.rTop - LIP, s.topY, s.rTop - LIP, 0x3b3532, false);
    b.ring(x, z, s.topY - FLUE, s.rTop - LIP, 0, 0x1f1c1b, true);
  }
  const g = b.geometry();
  const material = tex.vertexTinted('buffBrick', 'b03 power plant chimney brick (textured)', { roughness: 0.93, metalness: 0 });
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'b03 Hal C. Weaver power plant chimneys (LiDAR)';
  mesh.castShadow = mesh.receiveShadow = true;
  const pos = new Float32Array(b.pos), idx = Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
  const collider = ctx.physics.createCollider(RAPIER.ColliderDesc.trimesh(pos, idx));
  return { mesh, geometry: g, material, collider, triangles: pos.length / 9 };
}
