// Flight/travel region of the riverfront extension. Pure (no three/rapier): the game and the Node checks share it.
// The region is south-bank land + the river reach between the Lamar and South First bridges + an 8 m overlap into the
// downtown bank (where the downtown shoreline walls are opened) + the Pfluger bridge footprint. Edges of kind 1 (open,
// shared with downtown) and 2 (deck edge, bounded by the modelled railings) are not walls: only kind 0 keeps a margin.
import type { RegionEdge } from './format';

type P = [number, number];

function inRing(x: number, z: number, ring: P[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function nearestOnSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): P {
  const dx = bx - ax, dz = bz - az, d = dx * dx + dz * dz;
  const t = d ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / d)) : 0;
  return [ax + dx * t, az + dz * t];
}

export class RiverfrontBounds {
  readonly ring: P[];
  readonly edges: RegionEdge[];
  readonly box: { xmin: number; xmax: number; zmin: number; zmax: number };
  private readonly wallCells = new Map<number, number[]>();
  private static readonly BUCKET = 64;
  constructor(edges: RegionEdge[]) {
    this.edges = edges;
    this.ring = edges.map(e => [e[0], e[1]] as P);
    let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
    for (const [x, z] of this.ring) { xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
    this.box = { xmin, xmax, zmin, zmax };
    const B = RiverfrontBounds.BUCKET;
    edges.forEach(([ax, az, bx, bz, kind], i) => {
      if (kind !== 0) return;
      for (let cz = Math.floor(Math.min(az, bz) / B) - 1; cz <= Math.floor(Math.max(az, bz) / B) + 1; cz++)
        for (let cx = Math.floor(Math.min(ax, bx) / B) - 1; cx <= Math.floor(Math.max(ax, bx) / B) + 1; cx++) {
          const k = cz * 100003 + cx, l = this.wallCells.get(k);
          if (l) l.push(i); else this.wallCells.set(k, [i]);
        }
    });
  }
  contains(x: number, z: number) {
    const b = this.box;
    return x >= b.xmin && x <= b.xmax && z >= b.zmin && z <= b.zmax && inRing(x, z, this.ring);
  }
  /** Distance to the nearest walled (kind 0) edge; Infinity when none within ~128 m. */
  wallDistance(x: number, z: number) {
    const B = RiverfrontBounds.BUCKET, l = this.wallCells.get(Math.floor(z / B) * 100003 + Math.floor(x / B));
    let best = Infinity;
    if (l) for (const i of l) {
      const [ax, az, bx, bz] = this.edges[i];
      const q = nearestOnSegment(x, z, ax, az, bx, bz);
      best = Math.min(best, Math.hypot(q[0] - x, q[1] - z));
    }
    return best;
  }
  legal(x: number, z: number, margin = 2) {
    return Number.isFinite(x) && Number.isFinite(z) && this.contains(x, z) && this.wallDistance(x, z) >= margin;
  }
  /** Nearest legal point: projection onto every edge (walls keep `margin`, open/deck edges a small inset). */
  nearestLegal(x: number, z: number, margin = 2): P | null {
    if (this.legal(x, z, margin)) return [x, z];
    let best: P | null = null, bestD = Infinity;
    for (const [ax, az, bx, bz, kind] of this.edges) {
      const q = nearestOnSegment(x, z, ax, az, bx, bz);
      const d = Math.hypot(q[0] - x, q[1] - z);
      if (d >= bestD) continue;
      const len = Math.hypot(bx - ax, bz - az) || 1, inset = (kind === 0 ? margin : .3) + .05;
      for (const s of [1, -1]) {
        const p: P = [q[0] - (bz - az) / len * s * inset, q[1] + (bx - ax) / len * s * inset];
        if (this.legal(p[0], p[1], margin)) { best = p; bestD = d; break; }
      }
    }
    return best;
  }
}
