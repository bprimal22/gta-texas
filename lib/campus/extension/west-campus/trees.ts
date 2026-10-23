// Deep West canopy (x < -762): 2017 LiDAR canopy peaks (west-campus-v1.json) drawn with the campus tree forms, materials
// and impostors (borrowed from the campus vegetation install, never disposed here) in one extra TreeBatches population.
// Form choice follows tree-fit (crown aspect < 0.42 -> upright, else live oak; nearest of the three closest aspects,
// seeded); scale = measured height / form height, reduced so the crown reaches at most 2.5 m past the nearest building
// face (crowns may overhang roofs a little, as street trees do). Trunks stand on the extension terrain triangles
// (DeepWest.height). Colliders: one resident trunk capsule per tree (limbs are visual only).
import * as THREE from 'three';
import type { TreeForm, CollisionCapsule } from '../../vegetation/oak-forms';
import type { TreeMaterials } from '../../vegetation/tree-materials';
import { TreeBatches, CANOPY_LODS, type ImpostorSet, type PlacedTree } from '../../vegetation/tree-batches';
import type { TreeRecord } from './format';

export const OAK_ASPECT = .42, MIN_SCALE = .35, CROWN_OVERHANG = 2.5, TRUNK_COLLIDER_MAX = 3.2;

export interface DeepWestTreePlan { placed: PlacedTree[]; capsules: CollisionCapsule[]; skipped: { noGround: number }; reduced: number }

export function planDeepWestTrees(records: TreeRecord[], forms: TreeForm[], height: (x: number, z: number) => number | null): DeepWestTreePlan {
  const placed: PlacedTree[] = [], capsules: CollisionCapsule[] = [];
  let noGround = 0, reduced = 0;
  for (const [x, z, h, r, clear] of records) {
    const y = height(x, z);
    if (y === null) { noGround++; continue; }
    const seed = Math.abs(Math.round(x * 3.1 + z * 1.7));
    const aspect = r / Math.max(1, h), kind = aspect < OAK_ASPECT ? 'upright' : 'live-oak';
    const near = forms.filter(f => f.spec.kind === kind)
      .map(f => ({ f, err: Math.abs(Math.log((f.spec.radius / f.spec.height) / aspect)) }))
      .sort((a, b) => a.err - b.err).slice(0, 3);
    const form = near[seed % near.length].f;
    const full = h / form.spec.height, crownCap = (clear + CROWN_OVERHANG) / form.spec.radius;
    const scale = Math.max(MIN_SCALE, Math.min(full, crownCap));
    if (scale < full * .999) reduced++;
    const tint = .86 + .22 * (((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1 + 1) % 1);
    placed.push({ x, y: y - .02, z, rotation: (seed * 2.39996) % (Math.PI * 2), scale, form: form.spec.id, tint });
    const top = Math.min(TRUNK_COLLIDER_MAX, form.spec.forkHeight * scale);
    capsules.push({ a: new THREE.Vector3(x, y - .1, z), b: new THREE.Vector3(x, y - .02 + top, z), radius: Math.max(.12, form.trunkRadius * scale), trunk: true });
  }
  return { placed, capsules, skipped: { noGround }, reduced };
}

export function deepWestTreeBatches(plan: DeepWestTreePlan, forms: TreeForm[], materials: TreeMaterials, impostors: ImpostorSet | null) {
  const batches = new TreeBatches(plan.placed, forms, materials, CANOPY_LODS, impostors, 'Deep West trees (2017 LiDAR canopy)');
  batches.wood.sortObjects = batches.foliage.sortObjects = false;
  if (batches.impostor) batches.impostor.sortObjects = false;
  return batches;
}
