/** Restore the existing Mall planting strip between Speedway and MLK to its
 * shared corridor grade. The contour fallback depressed this narrow remnant
 * below both adjoining authored floors. No floor footprint or paving changes.
 * X/Z feathers are inside the already paved overlap or the level Mall join. */
export function speedwayMallEdgeHeight(
  x: number, z: number, gardenHeight: number, corridorHeight: (x: number, z: number) => number,
): number {
  if (x <= -6 || x > 0 || z <= 70 || z >= 80) return gardenHeight;
  const smooth = (v: number, a: number, b: number) => {
    const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const weight = smooth(x, -6, -3) * smooth(z, 70, 72) * (1 - smooth(z, 78, 80));
  return gardenHeight + (corridorHeight(x, z) - gardenHeight) * weight;
}
