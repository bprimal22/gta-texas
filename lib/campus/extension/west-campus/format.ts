// West Campus additions asset (public/assets/extension/west-campus-v1.json, baked by tools/extension/bake-west-campus.py):
// Deep West LiDAR canopy peaks and the two post-2023 towers. Pure (no three.js): Node checks import it directly.
import type { Point } from '../../types';

export const WEST_CAMPUS_URL = '/assets/extension/west-campus-v1.json';

export interface WestCampusTower {
  key: string; name: string; address: string;
  /** Exterior ring, positive shoelace area in (x, z). */
  ring: Point[];
  /** Ground datum the published / City height is measured from, and the resulting top (campus Y). */
  baseY: number; heightM: number; topY: number;
  /** Union only: the older City 2023 MAX_HEIGHT snapshot, kept as a lower bound / comparison. */
  cityHeightM?: number; cityTopY?: number;
  groundLidar2017: [number, number, number];
  footprint: string; height: string; identity: string;
}
export interface WestCampusData {
  format: 'ut-west-campus'; version: 1; claims: string;
  trees: { fields: string[]; ownedX: [number, number]; data: number[]; counts: Record<string, number> };
  towers: WestCampusTower[];
  sources: string[];
}
/** One Deep West tree: x, z, height (m), crown radius (m), distance to the nearest footprint (m, capped 15). */
export type TreeRecord = [number, number, number, number, number];
export const TREE_FIELDS = ['x', 'z', 'height', 'crownRadius', 'buildingClearance'];
export const UNION_KEY = 'coa-2023:470235', VILLAS_KEY = 'osm:1341073412';

export class WestCampusAssetError extends Error {}
const fail = (m: string): never => { throw new WestCampusAssetError(`West Campus asset rejected: ${m}`); };

/** Validate (fail closed): exact tower set, finite rings and heights, tree records inside the deep-west union. */
export function validateWestCampus(raw: unknown, deepWest: { xmin: number; xmax: number; zmin: number; zmax: number } | null): { data: WestCampusData; trees: TreeRecord[] } {
  const d = raw as WestCampusData;
  if (!d || d.format !== 'ut-west-campus' || d.version !== 1) fail('format');
  if (!Array.isArray(d.towers) || d.towers.map(t => t.key).sort().join() !== [UNION_KEY, VILLAS_KEY].sort().join()) fail('tower set');
  for (const t of d.towers) {
    if (!Array.isArray(t.ring) || t.ring.length < 4 || t.ring.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) fail(`${t.key} ring`);
    let a = 0;
    for (let i = 0; i < t.ring.length; i++) { const p = t.ring[i], q = t.ring[(i + 1) % t.ring.length]; a += p[0] * q[1] - q[0] * p[1]; }
    if (!(a > 0)) fail(`${t.key} ring orientation`);
    if (![t.baseY, t.heightM, t.topY].every(Number.isFinite) || Math.abs(t.baseY + t.heightM - t.topY) > 0.01 || t.heightM < 40 || t.heightM > 120) fail(`${t.key} heights`);
  }
  const f = d.trees?.fields, data = d.trees?.data;
  if (!Array.isArray(f) || f.join() !== TREE_FIELDS.join() || !Array.isArray(data) || data.length % 5) fail('tree fields');
  const trees: TreeRecord[] = [];
  for (let i = 0; i < data.length; i += 5) {
    const t = data.slice(i, i + 5) as TreeRecord;
    if (!t.every(Number.isFinite) || t[2] < 3 || t[2] > 30 || t[3] < 1 || t[3] > 12) fail(`tree ${i / 5}`);
    if (deepWest && (t[0] < deepWest.xmin + 2 || t[0] > deepWest.xmax - 2 || t[1] < deepWest.zmin + 2 || t[1] > deepWest.zmax - 2)) fail(`tree ${i / 5} outside the deep-west union`);
    trees.push(t);
  }
  return { data: d, trees };
}
