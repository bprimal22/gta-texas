// D20 — Mike A. Myers Track & Soccer Stadium: east grandstand and its two light masts. No GIS building record covers
// them (the MMS City records are small support buildings, kept generated). The west grandstand is the east edge of the
// Manor Garage record 463679:19 and belongs to D19.
// Measured (USGS 3DEP 2017 0.5 m DSM/DTM, realism-lanes lidar rasters, sampled read-only for this lane; campus Y):
//   field level 10.6; east-stand front line x = 834.55 - 0.251 z (fit z 320-450), stand axis parallel to the Manor Garage
//   stepped east edge (slope -0.26); rake to Y ~25.6 at ~31 m depth from z ~352 south to the MMS 507225 building, and only
//   ~21 m deep north of z ~352 (MMS 716988 stands behind it); light-mast peaks Y 53.9-54.0 at (752.8, 460.2) and
//   (778.1, 362.7). (The west masts stand on the Manor Garage record and are built with it in D19.)
// Reference: d20-orbit-southwest/-southeast/-northeast/-northwest (all usable: grey aluminium bleachers along both straights,
//   tall masts behind the east stand). Estimate: 0.8 x 0.36 m row pitch, solid back wall (the raster sees through the open
//   aluminium rake to Y 16.2 behind it, so the under-structure is really an open frame), press-box glazing/bottom, lamp-bank size.
//   Revision 2: treads/risers on the local metal (aluminium) PBR maps, walls / press box / columns on precast; steel untextured. The red track / field surfacing is shared ground and is NOT overlaid here.
import * as THREE from 'three';
import type { Point } from '../../types';
import type { BlockInstallContext } from '../types';
import { Kit, col, rakedStand, lightMast } from './lane-kit';

const AX = Math.hypot(-0.255, 1);
export const MYERS = {
  A: [-0.255 / AX, 1 / AX] as Point, N: [1 / AX, 0.255 / AX] as Point, F0: [739.17, 380] as Point, field: 10.6,
  north: [-55.7, -28.9, 20.8] as [number, number, number], south: [-28.9, 84.6, 31.2] as [number, number, number], row: 0.8, rise: 0.34,
  /** Press box on the stand crest: LiDAR flat top Y 28.9 over ~x 772-780, z 373-381 (axis s -16..-8, depth 31.2..38.4). */
  pressBox: { s0: -16, s1: -8, d0: 31.3, d1: 38.4, top: 28.9 },
  masts: [
    { at: [752.8, 460.2] as Point, top: 54.0, width: 8, face: 'west' },
    { at: [778.1, 362.7] as Point, top: 53.9, width: 8, face: 'west' },
  ],
} as const;
const C = { tread: col('#b7babd'), riser: col('#8d9093'), wall: col('#b3aea3'), steel: col('#8e9396'), lamp: col('#e9edf0'),
  box: col('#d8d5cc'), roof: col('#a9aaa6'), glass: col('#2f3a42') };

export function buildMyers(kit: Kit, ctx: BlockInstallContext) {
  const g = ctx.groundHeight, M = MYERS;
  const yFront = Math.max(M.field, g(M.F0[0], M.F0[1])) + 1.0;
  const stand = rakedStand(kit, { F0: M.F0, A: M.A, N: M.N, sections: [M.north, M.south], yFront, row: M.row, rise: M.rise, ground: g, tread: C.tread, riser: C.riser, wall: C.wall,
    treadMat: 'alu', riserMat: 'alu', wallMat: 'concrete' });
  // Press box: glazed field face on the stand's back line, roof at the LiDAR top, two rear columns to the ground.
  // Slab 0.25 m, glazed band 1.9 m (set 0.6 m in), roof box to the LiDAR top; 0.1 m behind the stand's back wall / rail.
  const B = M.pressBox, y0 = stand.topY + 0.45, yg = y0 + 1.9, P = (s: number, d: number): Point => [M.F0[0] + M.A[0] * s + M.N[0] * d, M.F0[1] + M.A[1] * s + M.N[1] * d];
  kit.box('solid', 'concrete', C.box, M.F0, M.A, M.N, B.s0, B.s1, B.d0, B.d1, yg, B.top);
  kit.box('solid', 'glass', C.glass, M.F0, M.A, M.N, B.s0 + 0.4, B.s1 - 0.4, B.d0 + 0.6, B.d1 - 0.4, y0, yg, 't');
  kit.box('solid', 'concrete', C.box, M.F0, M.A, M.N, B.s0, B.s1, B.d0, B.d1, y0 - 0.25, y0, 't');
  kit.mb('detail', 'glass').quad(...([[B.s0 + 0.3, B.d0 - 0.02, yg + 0.2], [B.s1 - 0.3, B.d0 - 0.02, yg + 0.2], [B.s1 - 0.3, B.d0 - 0.02, B.top - 0.35], [B.s0 + 0.3, B.d0 - 0.02, B.top - 0.35]].map(([s, d, y]) => { const p = P(s, d); return new THREE.Vector3(p[0], y, p[1]); }) as [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]),
    [0, 0], [1, 0], [1, 1], [0, 1], C.glass, new THREE.Vector3(-M.N[0], 0, -M.N[1]));
  for (const s of [B.s0 + 0.5, B.s1 - 0.5]) {
    const c = P(s, B.d1 - 0.5), gy = g(c[0], c[1]) - 0.6;
    kit.box('solid', 'concrete', C.wall, c, M.A, M.N, -0.35, 0.35, -0.35, 0.35, gy, y0 - 0.25, 't');
  }
  for (const m of M.masts) {
    const face: Point = m.face === 'west' ? [-M.N[0], -M.N[1]] : [M.N[0], M.N[1]];
    lightMast(kit, m.at, g(m.at[0], m.at[1]), m.top, m.width, M.A, face, C.steel, C.lamp);
  }
  return { eastStand: { ...stand, yFront: +yFront.toFixed(2) }, pressBox: { bottom: +(y0 - 0.25).toFixed(2), top: B.top }, masts: M.masts.length };
}
