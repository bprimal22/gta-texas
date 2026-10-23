// World edges with the optional extensions (deep west, downtown, riverfront). Pure (no three/rapier).
// Without downtown every result equals extension/deep-west/bounds.ts exactly; without the riverfront every result
// equals the downtown-only world exactly.
import { clampToWorld as clampBase, mapBounds as mapBase, worldBoundaryWalls, type ExtensionBounds } from './deep-west/bounds';
import type { DowntownBounds } from './downtown/bounds';
import type { RiverfrontBounds } from './riverfront/bounds';
import type { BarrierPiece, WallPiece } from './riverfront/format';

/** Cuboid wall: centre, half extents (x, y, z) and rotation about +Y (radians). */
export interface WorldWall { cx: number; cy: number; cz: number; hx: number; hy: number; hz: number; angle: number; kind: 'edge' | 'downtown' | 'barrier' | 'riverfront' }

export interface DowntownEdges { bounds: DowntownBounds; barriers: [number, number, number, number][]; barrierBottom: number; barrierTop: number }
/** Riverfront edges (validated against the downtown asset): its walls/barriers and the downtown wall list that replaces
 * downtown's own (the original walls minus the opened shoreline/Pfluger crossing; deck crossings clipped under the deck). */
export interface RiverfrontEdges { bounds: RiverfrontBounds; walls: WallPiece[]; downtownWalls: WallPiece[]; barriers: BarrierPiece[] }

export function worldWalls(bounds: number[], deepWest?: ExtensionBounds | null, downtown?: DowntownEdges | null, riverfront?: RiverfrontEdges | null): WorldWall[] {
  const [west, , east, south] = bounds;
  const walls: WorldWall[] = [];
  for (const [cx, cz, hx, hz] of worldBoundaryWalls(bounds, deepWest)) {
    const isSouth = downtown && Math.abs(cz - (south + 1)) < 1e-9 && Math.abs(hz - 1) < 1e-9 && Math.abs(hx - (east - west) / 2) < 1e-9;
    if (!isSouth) { walls.push({ cx, cy: 0, cz, hx, hy: 150, hz, angle: 0, kind: 'edge' }); continue; }
    // Open the base south wall along the downtown seam span only.
    const s = downtown.bounds.seam;
    if (s.x0 > west) walls.push({ cx: (west + s.x0) / 2, cy: 0, cz, hx: (s.x0 - west) / 2, hy: 150, hz, angle: 0, kind: 'edge' });
    if (s.x1 < east) walls.push({ cx: (s.x1 + east) / 2, cy: 0, cz, hx: (east - s.x1) / 2, hy: 150, hz, angle: 0, kind: 'edge' });
  }
  if (!downtown) return walls;
  const b = downtown.bounds;
  const segment = (ax: number, az: number, bx: number, bz: number, cy: number, hy: number, kind: WorldWall['kind'], thick: number,
    inside: (x: number, z: number) => boolean = (x, z) => b.contains(x, z)) => {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-3) return;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    let nx = -(bz - az) / len, nz = (bx - ax) / len;
    // Outward = away from the playable side; the wall's inner face lies on the segment.
    if (inside(mx + nx * .25, mz + nz * .25)) { nx = -nx; nz = -nz; }
    walls.push({ cx: mx + nx * thick, cy, cz: mz + nz * thick, hx: len / 2 + thick * .5, hy, hz: thick, angle: -Math.atan2(bz - az, bx - ax), kind });
  };
  if (!riverfront) for (const [ax, az, bx, bz] of b.walls) segment(ax, az, bx, bz, 0, 150, 'downtown', 1);
  else for (const [ax, az, bx, bz, y0, y1] of riverfront.downtownWalls) segment(ax, az, bx, bz, (y0 + y1) / 2, (y1 - y0) / 2, 'downtown', 1);
  const hy = (downtown.barrierTop - downtown.barrierBottom) / 2;
  for (const [ax, az, bx, bz] of downtown.barriers) segment(ax, az, bx, bz, downtown.barrierBottom + hy, hy, 'barrier', .3);
  if (riverfront) {
    const rb = riverfront.bounds, inside = (x: number, z: number) => rb.contains(x, z) || b.contains(x, z);
    for (const [ax, az, bx, bz, y0, y1] of riverfront.walls) segment(ax, az, bx, bz, (y0 + y1) / 2, (y1 - y0) / 2, 'riverfront', 1, inside);
    // Water barriers stand on the shoreline itself (both sides are inside the region): centred, thin.
    for (const [ax, az, bx, bz, y0, y1] of riverfront.barriers) {
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-3) continue;
      walls.push({ cx: (ax + bx) / 2, cy: (y0 + y1) / 2, cz: (az + bz) / 2, hx: len / 2 + .15, hy: (y1 - y0) / 2, hz: .15, angle: -Math.atan2(bz - az, bx - ax), kind: 'riverfront' });
    }
  }
  return walls;
}

/** Flight's horizontal clamp: the nearest legal point of the base rectangle (south edge open on the seam span),
 * the deep-west rectangle and the downtown polygon (2 m inside its walls). */
export function clampToWorld(bounds: number[], deepWest: ExtensionBounds | null | undefined, downtown: DowntownBounds | null | undefined, x: number, z: number,
  riverfront?: RiverfrontBounds | null): [number, number] {
  // The parks lie outside the old downtown polygon. Avoid searching every old shoreline wall each flight step
  // when this point is already legal in the newly opened riverfront.
  if (riverfront?.legal(x, z)) return [x, z];
  const base = clampDowntown(bounds, deepWest, downtown, x, z);
  if (!riverfront || (base[0] === x && base[1] === z)) return base;
  const r = riverfront.nearestLegal(x, z);
  return r && Math.hypot(r[0] - x, r[1] - z) < Math.hypot(base[0] - x, base[1] - z) ? r : base;
}

function clampDowntown(bounds: number[], deepWest: ExtensionBounds | null | undefined, downtown: DowntownBounds | null | undefined, x: number, z: number): [number, number] {
  const base = clampBase(bounds, deepWest, x, z);
  // A point already legal in the base/deep-west union is its own (zero-distance) answer.
  if (!downtown || (base[0] === x && base[1] === z)) return base;
  if (downtown.legal(x, z) || downtown.onSeam(x, z)) return [x, z];
  const [west, north, east, south] = bounds;
  // On the seam span the base rectangle continues to the seam itself (no wall there).
  const s = downtown.seam;
  if (x >= s.x0 + 2 && x <= s.x1 - 2 && z >= north + 2 && z <= south + 2 && x >= west + 2 && x <= east - 2) return [x, z];
  const d = downtown.nearestLegal(x, z);
  return Math.hypot(base[0] - x, base[1] - z) <= Math.hypot(d[0] - x, d[1] - z) ? base : d;
}

export function mapBounds(bounds: number[], deepWest?: ExtensionBounds | null, downtown?: DowntownBounds | null, riverfront?: RiverfrontBounds | null): number[] {
  const m = mapBase(bounds, deepWest);
  if (!downtown) return m;
  const b = downtown.box;
  const d = [Math.min(m[0], b.xmin), Math.min(m[1], b.zmin), Math.max(m[2], b.xmax), Math.max(m[3], b.zmax)];
  if (!riverfront) return d;
  const r = riverfront.box;
  return [Math.min(d[0], r.xmin), Math.min(d[1], r.zmin), Math.max(d[2], r.xmax), Math.max(d[3], r.zmax)];
}
