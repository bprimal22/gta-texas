import type { TreePlacement } from './foreground-trees';

// Exact saved TreeKeeper centers. All sizes/orientations are inferred fits to
// the existing model, not inventory species or crown measurements.
const sites = [
  { x: -155.37650044280196, z: 85.45725292008706, rotation: Math.PI,
    scale: 1, width: 0.75, height: 1.2 }, // site2454: crown points north, away from GAR
  { x: -94.52534255434335, z: 96.59334437994823, rotation: Math.PI / 2,
    scale: 1, width: 0.9, height: 1.15 }, // site2376: crown points east, away from GAR
  { x: -125.26669808665808, z: 122.90604625002369, rotation: 0,
    scale: 0.95, width: 0.82, height: 1.2 }, // site2342: crown points south over garden
] as const;

/** Append to the same existing owner, after the separately staged west pilot. */
export function garrisonGardenExtraTrees(
  retainedSoilHeight: (x: number, z: number) => number | null,
  existing: readonly TreePlacement[],
): TreePlacement[] {
  const placements: TreePlacement[] = [];
  for (const site of sites) {
    if (existing.some(p => Math.hypot(p.x - site.x, p.z - site.z) < 2)) continue;
    const ground = retainedSoilHeight(site.x, site.z);
    if (ground === null || !Number.isFinite(ground)) continue;
    const y = ground + 0.017011718824505806 * 2.5 * site.scale * site.height - 0.01;
    placements.push({ ...site, y });
  }
  return placements;
}
