// Playable-area geometry of the downtown extension. Pure (no three/rapier): the game and Node checks share it.
import type { PolygonRings } from './format';

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

/** The playable polygon (land north/east of the river inside the authored region) and its walled edges.
 * The seam span (z = seamZ, x in [seamX0, seamX1]) is shared with the Capitol strip and open. */
export class DowntownBounds {
  readonly rings: P[][];
  readonly walls: [number, number, number, number][];
  readonly box: { xmin: number; xmax: number; zmin: number; zmax: number };
  private readonly cells = new Map<number, number[]>();
  private static readonly BUCKET = 64;
  constructor(playable: PolygonRings, walls: [number, number, number, number][], readonly seam: { z: number; x0: number; x1: number }) {
    this.rings = playable as P[][];
    this.walls = walls;
    let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
    for (const [x, z] of this.rings[0]) { xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
    this.box = { xmin, xmax, zmin, zmax };
    walls.forEach(([ax, az, bx, bz], i) => {
      const B = DowntownBounds.BUCKET;
      for (let cz = Math.floor(Math.min(az, bz) / B) - 1; cz <= Math.floor(Math.max(az, bz) / B) + 1; cz++)
        for (let cx = Math.floor(Math.min(ax, bx) / B) - 1; cx <= Math.floor(Math.max(ax, bx) / B) + 1; cx++) {
          const k = cz * 100003 + cx, l = this.cells.get(k);
          if (l) l.push(i); else this.cells.set(k, [i]);
        }
    });
  }
  /** Inside the playable polygon (holes excluded). */
  contains(x: number, z: number) {
    const b = this.box;
    if (!(x >= b.xmin && x <= b.xmax && z >= b.zmin && z <= b.zmax)) return false;
    if (!inRing(x, z, this.rings[0])) return false;
    return !this.rings.slice(1).some(r => inRing(x, z, r));
  }
  /** Distance to the nearest walled edge (Infinity when none within ~128 m). */
  wallDistance(x: number, z: number) {
    const B = DowntownBounds.BUCKET, l = this.cells.get(Math.floor(z / B) * 100003 + Math.floor(x / B));
    let best = Infinity;
    if (l) for (const i of l) {
      const [ax, az, bx, bz] = this.walls[i];
      const q = nearestOnSegment(x, z, ax, az, bx, bz);
      best = Math.min(best, Math.hypot(q[0] - x, q[1] - z));
    }
    return best;
  }
  /** Legal for flight/travel: inside, at least `margin` from every wall. Near the open seam the strip side counts. */
  legal(x: number, z: number, margin = 2) {
    return this.contains(x, z) && this.wallDistance(x, z) >= margin;
  }
  /** Nearest legal point (margin from walls) to (x, z); used by the flight clamp. */
  nearestLegal(x: number, z: number, margin = 2): P {
    if (this.legal(x, z, margin)) return [x, z];
    let best: P = [x, z], bestD = Infinity;
    for (const [ax, az, bx, bz] of this.walls) {
      const q = nearestOnSegment(x, z, ax, az, bx, bz);
      const d = Math.hypot(q[0] - x, q[1] - z);
      if (d >= bestD) continue;
      // Step inward along the inward normal of the segment until legal.
      const len = Math.hypot(bx - ax, bz - az) || 1;
      for (const s of [1, -1]) {
        const nx = -(bz - az) / len * s, nz = (bx - ax) / len * s;
        const p: P = [q[0] + nx * (margin + .05), q[1] + nz * (margin + .05)];
        if (this.legal(p[0], p[1], margin)) { best = p; bestD = d; break; }
      }
    }
    return best;
  }
  /** On the open seam band: crossing between the Capitol strip and downtown is continuous. */
  onSeam(x: number, z: number, margin = 2) {
    return x >= this.seam.x0 + margin && x <= this.seam.x1 - margin && Math.abs(z - this.seam.z) <= margin + .01;
  }
}
