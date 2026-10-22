import type { TreePlacement } from './foreground-trees';

// Only site 2175 has a surveyed center. Its size and the companion are inferred;
// see the placement packet. These are deliberately inside the surveyed west
// garden strip, away from the Garrison access path and the building itself.
const sites = [
  { x: -169.91856506083198, z: 112.47385864011815, rotation: 0,
    scale: 1, width: 0.86, height: 1.25 },
  { x: -162.8, z: 118, rotation: Math.PI,
    scale: 0.9, width: 0.82, height: 1.25 },
] as const;

/** Add to the existing ForegroundTrees owner after regional placement filters.
 * The caller must sample the retained Mall planting-soil mesh, not source tiles,
 * a canopy hit, or an extrapolated terrain height. Missing support skips a tree.
 */
export function garrisonGardenTrees(
  retainedSoilHeight: (x: number, z: number) => number | null,
  existing: readonly TreePlacement[],
): TreePlacement[] {
  const placements: TreePlacement[] = [];
  for (const site of sites) {
    if (existing.some(p => Math.hypot(p.x - site.x, p.z - site.z) < 2)) continue;
    const ground = retainedSoilHeight(site.x, site.z);
    if (ground === null || !Number.isFinite(ground)) continue;
    // Actual near.glb wood minimum is -0.0170117188m. Match that root to the
    // accepted floor with 1cm buried, accounting for ForegroundTrees' Y scale.
    const y = ground + 0.017011718824505806 * 2.5 * site.scale * site.height - 0.01;
    placements.push({ ...site, y });
  }
  return placements;
}
