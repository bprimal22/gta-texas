/** Height queries against the baked local terrain triangles. The baked mesh,
 * not the contour grid, is what the player sees and stands on, so generated
 * context geometry is seated on these heights. Pure data: no DOM or WebGL. */
export class BakedGround {
  private readonly x0: number;
  private readonly z0: number;
  private readonly w: number;
  private readonly h: number;
  private readonly starts: Uint32Array;
  private readonly items: Uint32Array;
  constructor(private readonly positions: ArrayLike<number>, private readonly cell = 8,
    private readonly fallback: (x: number, z: number) => number = () => 0) {
    const triangles = Math.floor(positions.length / 9);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], z = positions[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    if (!triangles) { minX = maxX = minZ = maxZ = 0; }
    this.x0 = minX; this.z0 = minZ;
    this.w = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
    this.h = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);
    const counts = new Uint32Array(this.w * this.h + 1);
    const visit = (t: number, fn: (index: number) => void) => {
      const o = t * 9;
      const ax = positions[o], az = positions[o + 2], bx = positions[o + 3], bz = positions[o + 5],
        cx = positions[o + 6], cz = positions[o + 8];
      const i0 = Math.floor((Math.min(ax, bx, cx) - this.x0) / cell), i1 = Math.floor((Math.max(ax, bx, cx) - this.x0) / cell);
      const j0 = Math.floor((Math.min(az, bz, cz) - this.z0) / cell), j1 = Math.floor((Math.max(az, bz, cz) - this.z0) / cell);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * this.w + i);
    };
    for (let t = 0; t < triangles; t++) visit(t, index => counts[index + 1]++);
    for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
    this.starts = counts.slice();
    const cursor = counts.slice(0, -1);
    this.items = new Uint32Array(counts[counts.length - 1]);
    for (let t = 0; t < triangles; t++) visit(t, index => { this.items[cursor[index]++] = t; });
  }
  /** Highest baked triangle under (x, z), or null inside a terrain cutout. */
  sample(x: number, z: number): number | null {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return null;
    const p = this.positions, cell = j * this.w + i;
    let best: number | null = null;
    for (let k = this.starts[cell]; k < this.starts[cell + 1]; k++) {
      const o = this.items[k] * 9;
      const ax = p[o], ay = p[o + 1], az = p[o + 2], bx = p[o + 3], by = p[o + 4], bz = p[o + 5],
        cx = p[o + 6], cy = p[o + 7], cz = p[o + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      const y = u * ay + v * by + w * cy;
      if (best === null || y > best) best = y;
    }
    return best;
  }
  /** Baked height, falling back to the contour surface inside cutouts. */
  height(x: number, z: number) { return this.sample(x, z) ?? this.fallback(x, z); }
}
