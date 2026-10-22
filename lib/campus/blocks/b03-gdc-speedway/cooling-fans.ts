// Block b03 (round 3): fan shrouds on the three cooling towers of the Hal C. Weaver plant.
//
// Decks are generated (context.json massing, LiDAR class-6 P50); this module adds the cylindrical fan stacks that
// stand on them, from the USGS 3DEP 2017 points (research/whole-campus-92/b03-gdc-speedway/derived/r3/towers-fit.json,
// towers_and_fit.py: connected 1 m cells whose P90 is > 1 m above the deck):
//  CS6 (698195, 24.9 m tier, deck campus Y 25.9): three cells, centres measured, 8.6-9.2 m across, tops Y 27.0-27.5.
//  CT1 (added -301, deck Y 4.41): cells along a line from (229.2,-34.0) to (232.4,-78.9), single cells 5.3 m across,
//      tops Y 7.4. The accepted atlas overview b03-r0-b1 shows SEVEN fans in one row, so seven equal steps (7.5 m)
//      between the measured end cells; the middle cells merge in the LiDAR (reference-interpreted spacing).
//  CT2 (added -302, deck Y 8.84; built 2017, the LiDAR year): cells at z -23.1 / -31.6 and a merged cell centred
//      -45.3 (two fans); the overview shows FIVE fans, so five 8.3 m steps from the first (the fifth is not in the
//      2017 points). Tops Y 10.1.
// Each stack: shroud wall from 5 cm below the deck to the measured top, a rim, a dark lining down to the deck and the fan
// disc 3 cm above the deck (fans sit at the bottom of their velocity-recovery stacks; it also keeps the deck pole probes of
// run-context-check ROOF-COLLIDER within 0.1 m of the visible generated roof).
// Colliders are a trimesh of the rendered triangles. Round 3 (D05): metre UVs and a b03-owned textured metal finish
// (offline metal colour/normal/roughness maps) tinted by the same vertex colours; geometry and collider unchanged.
// This is a finish on b03's own fan shrouds only; it says nothing about the root-owned GDC model.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { BlockInstallContext } from '../types';
import { Builder } from './power-plant-stacks';
import type { TexturedFinish } from './textured-finish';

export interface Fan { tower: string; centre: [number, number]; deckY: number; topY: number; r: number; basis: 'measured' | 'reference-interpreted' }
const line = (tower: string, n: number, z0: number, step: number, x0: number, slope: number, deckY: number, topY: number, r: number, measured: number[]): Fan[] =>
  Array.from({ length: n }, (_, i) => { const z = z0 - i * step; return { tower, centre: [+(x0 + (z0 - z) * slope).toFixed(2), +z.toFixed(2)] as [number, number], deckY, topY, r, basis: measured.includes(i) ? 'measured' : 'reference-interpreted' }; });
export const FANS: Fan[] = [
  { tower: 'CS6', centre: [137.19, -21.59], deckY: 25.9, topY: 27.5, r: 4.2, basis: 'measured' },
  { tower: 'CS6', centre: [137.66, -35.01], deckY: 25.9, topY: 27.05, r: 4.2, basis: 'measured' },
  { tower: 'CS6', centre: [138.79, -47.79], deckY: 25.9, topY: 27.1, r: 4.2, basis: 'measured' },
  ...line('CT1', 7, -34.0, 7.5, 229.23, 0.0702, 4.41, 7.4, 2.7, [0, 6]),
  // CT2 x: centred between the official ring's long edges (the LiDAR cells sit 0.3-0.8 m east, beyond the 6.1 m wide north end).
  ...line('CT2', 5, -23.09, 8.3, 261.54, 0.0316, 8.84, 10.1, 2.6, [0, 1]),
];
const LIP = 0.12, DISC = 0.03;

export function buildCoolingFans(ctx: BlockInstallContext, tex: TexturedFinish) {
  const b = new Builder();
  for (const f of FANS) {
    const [x, z] = f.centre, shell = 0xb9bcb9, dark = 0x2c2f31;
    b.band(x, z, f.deckY - 0.05, f.r, f.topY, f.r, shell);
    b.ring(x, z, f.topY, f.r, f.r - LIP, shell, true);
    b.band(x, z, f.deckY + DISC, f.r - LIP, f.topY, f.r - LIP, 0x5d6062, false);
    b.ring(x, z, f.deckY + DISC, f.r - LIP, 0, dark, true);
  }
  const g = b.geometry();
  const material = tex.vertexTinted('metal', 'b03 cooling tower fan shrouds (textured metal)', { roughness: 0.75, metalness: 0.15 });
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'b03 cooling tower fan shrouds (LiDAR)';
  mesh.castShadow = mesh.receiveShadow = true;
  // Rooftop equipment ON generated decks: keep it out of the authored-coverage raster (as b09/b14 do), otherwise the
  // shrouds (up to 60% of a deck) would make planContextBuildings classify CS6/CT1/CT2 'authored' and drop them.
  mesh.userData.localContext = true;
  const pos = new Float32Array(b.pos), idx = Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
  const collider = ctx.physics.createCollider(RAPIER.ColliderDesc.trimesh(pos, idx));
  return { mesh, geometry: g, material, collider, triangles: pos.length / 9, count: FANS.length };
}
