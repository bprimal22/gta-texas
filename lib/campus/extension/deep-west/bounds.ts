// Player-bound geometry with and without the deep-west extension. Pure (no three/rapier) so
// the game and Node checks share it. Without an extension every value equals the original
// game.ts formulas exactly.

export interface ExtensionBounds { xmin: number; xmax: number; zmin: number; zmax: number }
/** [centre x, centre z, half x, half z] of a 150 m half-height cuboid wall. */
export type Wall = [number, number, number, number];

/** Boundary walls. The original west wall is opened only along the extension's seam span;
 * the extension gets its own west, north and south walls. */
export function worldBoundaryWalls(bounds: number[], extension?: ExtensionBounds | null): Wall[] {
  const [west, north, east, south] = bounds;
  const others: Wall[] = [
    [east + 1, (north + south) / 2, 1, (south - north) / 2],
    [(west + east) / 2, north - 1, (east - west) / 2, 1],
    [(west + east) / 2, south + 1, (east - west) / 2, 1],
  ];
  if (!extension) return [[west - 1, (north + south) / 2, 1, (south - north) / 2], ...others];
  const r = extension;
  if (r.xmax !== west || r.zmin <= north || r.zmax >= south) throw new Error('Extension does not abut the west bound');
  return [
    [west - 1, (north + r.zmin) / 2, 1, (r.zmin - north) / 2],
    [west - 1, (r.zmax + south) / 2, 1, (south - r.zmax) / 2],
    ...others,
    [r.xmin - 1, (r.zmin + r.zmax) / 2, 1, (r.zmax - r.zmin) / 2 + 2],
    [(r.xmin + r.xmax) / 2 - 1, r.zmin - 1, (r.xmax - r.xmin) / 2 + 1, 1],
    [(r.xmin + r.xmax) / 2 - 1, r.zmax + 1, (r.xmax - r.xmin) / 2 + 1, 1],
  ];
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Flight's horizontal clamp (2 m inside the walls). The extension rectangle shares the
 * seam with the original one, so crossing is continuous; elsewhere the nearer legal point wins. */
export function clampToWorld(bounds: number[], extension: ExtensionBounds | null | undefined, x: number, z: number): [number, number] {
  const [west, north, east, south] = bounds;
  const a: [number, number] = [clamp(x, west + 2, east - 2), clamp(z, north + 2, south - 2)];
  if (!extension) return a;
  const r = extension;
  const b: [number, number] = [clamp(x, r.xmin + 2, r.xmax + 2), clamp(z, r.zmin + 2, r.zmax - 2)];
  return Math.hypot(a[0] - x, a[1] - z) <= Math.hypot(b[0] - x, b[1] - z) ? a : b;
}

/** Map extent: the original bounds widened west to include the extension. */
export function mapBounds(bounds: number[], extension?: ExtensionBounds | null): number[] {
  if (!extension) return bounds;
  return [Math.min(bounds[0], extension.xmin), Math.min(bounds[1], extension.zmin), Math.max(bounds[2], extension.xmax), Math.max(bounds[3], extension.zmax)];
}
