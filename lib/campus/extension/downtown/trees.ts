// Downtown street and park trees: the baked LiDAR canopy peaks (downtown-v1 `trees`: x, groundY, z, height,
// crownRadius, playable) drawn with the campus tree forms, bark/foliage materials and impostors (borrowed from the
// campus vegetation install, never disposed here) in one TreeBatches population: 3 draw calls in total, distance LOD
// (real geometry near, baked impostors to 1.5 km) and per-instance frustum culling. Replaces the rejected
// icosahedron-ball template. Form and scale follow the Deep West rules (west-campus/trees.ts): crown aspect picks a
// live oak or an upright form, scale = measured height / form height, reduced so the crown reaches at most 2.5 m past
// the nearest building face. Trees are scene decor (never a walkable/landing floor); playable trees get one trunk
// capsule each, nothing else collides.
import type { TreeForm } from '../../vegetation/oak-forms';
import type { TreeMaterials } from '../../vegetation/tree-materials';
import type { ImpostorSet } from '../../vegetation/tree-batches';
import { deepWestTreeBatches, planDeepWestTrees, type DeepWestTreePlan } from '../west-campus/trees';
import type { TreeRecord } from '../west-campus/format';
import type { DowntownData } from './format';

type Point = [number, number];
/** Clearance is only searched this far; beyond it the measured height wins. */
const CLEAR_SEARCH = 14;

export interface DowntownTreePlan extends DeepWestTreePlan { playable: boolean[] }

/** Distance from each tree to the nearest building edge (all footprints, visual-only ones included). */
function clearances(data: DowntownData, points: Point[]) {
  const cell = 32, grid = new Map<number, [Point, Point][]>();
  const key = (i: number, j: number) => j * 100003 + i;
  for (const b of data.meta.buildings) for (const t of b.tiers) for (const ring of t.r) {
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k] as Point, c = ring[(k + 1) % ring.length] as Point;
      const i0 = Math.floor((Math.min(a[0], c[0]) - CLEAR_SEARCH) / cell), i1 = Math.floor((Math.max(a[0], c[0]) + CLEAR_SEARCH) / cell);
      const j0 = Math.floor((Math.min(a[1], c[1]) - CLEAR_SEARCH) / cell), j1 = Math.floor((Math.max(a[1], c[1]) + CLEAR_SEARCH) / cell);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const l = grid.get(key(i, j)); if (l) l.push([a, c]); else grid.set(key(i, j), [[a, c]]);
      }
    }
  }
  return points.map(([x, z]) => {
    let d = CLEAR_SEARCH;
    for (const [a, c] of grid.get(key(Math.floor(x / cell), Math.floor(z / cell))) ?? []) {
      const dx = c[0] - a[0], dz = c[1] - a[1], L = dx * dx + dz * dz;
      const t = L ? Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / L)) : 0;
      d = Math.min(d, Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z));
    }
    return d;
  });
}

/** Pure plan (no GPU): forms, scales and trunk capsules on the rendered terrain (`height`, null = no ground). */
export function planDowntownTrees(data: DowntownData, forms: TreeForm[], height: (x: number, z: number) => number | null): DowntownTreePlan {
  const tr = data.trees, n = tr.length / 6, points: Point[] = [];
  for (let i = 0; i < n; i++) points.push([tr[i * 6], tr[i * 6 + 2]]);
  const clear = clearances(data, points);
  // Measured crown radius (canopy above 60 % of the peak) is a lower bound on the drip line; the building
  // clearance is the binding limit in the street grid.
  const records: TreeRecord[] = points.map(([x, z], i) => [x, z, tr[i * 6 + 3], tr[i * 6 + 4], clear[i]] as TreeRecord);
  const playableAt = new Map<string, boolean>();
  points.forEach(([x, z], i) => playableAt.set(`${x},${z}`, tr[i * 6 + 5] === 1));
  const plan = planDeepWestTrees(records, forms, height);
  // Visual-only trees (south bank, I-35 band) render but never collide.
  const playable = plan.placed.map(t => playableAt.get(`${t.x},${t.z}`) ?? false);
  plan.capsules = plan.capsules.filter((_c, i) => playable[i]);
  return { ...plan, playable };
}

export function downtownTreeBatches(plan: DowntownTreePlan, forms: TreeForm[], materials: TreeMaterials, impostors: ImpostorSet | null) {
  const batches = deepWestTreeBatches(plan, forms, materials, impostors);
  batches.group.name = 'Downtown trees (LiDAR canopy, campus forms)';
  batches.wood.name = 'Downtown trees wood'; batches.foliage.name = 'Downtown trees foliage';
  if (batches.impostor) batches.impostor.name = 'Downtown trees impostors';
  return batches;
}
