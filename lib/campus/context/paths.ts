import type { Path, Point } from '../types';
import { segmentDistanceSq } from '../context-coverage';

/** Spatial index of OSM path segments, used to orient entrances and
 * storefronts toward the nearest walk or street. */

const PEDESTRIAN = new Set(['footway', 'pedestrian', 'path', 'steps', 'cycleway', 'living_street']);
const STREET = new Set(['primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'residential', 'unclassified']);
const MAJOR = new Set(['primary', 'primary_link', 'secondary', 'secondary_link']);
const SKIP = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link']);

export interface PathHit { distance: number; x: number; z: number; kind: string; name: string; pedestrian: boolean; street: boolean; major: boolean }

export class PathIndex {
  private cells = new Map<string, { ax: number; az: number; bx: number; bz: number; path: Path }[]>();
  constructor(paths: Path[], private cell = 40) {
    for (const path of paths) {
      if (SKIP.has(path.kind) || path.points.length < 2) continue;
      const pts: Point[] = path.points;
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
        const seg = { ax, az, bx, bz, path };
        for (let x = Math.floor(Math.min(ax, bx) / cell); x <= Math.floor(Math.max(ax, bx) / cell); x++)
          for (let z = Math.floor(Math.min(az, bz) / cell); z <= Math.floor(Math.max(az, bz) / cell); z++) {
            const k = `${x},${z}`;
            let list = this.cells.get(k);
            if (!list) this.cells.set(k, list = []);
            list.push(seg);
          }
      }
    }
  }
  /** Nearest segment within `radius` passing the filter. */
  nearest(x: number, z: number, radius: number, filter: (kind: string) => boolean = () => true): PathHit | null {
    const r = Math.ceil(radius / this.cell), ci = Math.floor(x / this.cell), cj = Math.floor(z / this.cell);
    let best: PathHit | null = null, bestD = radius * radius;
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      for (const s of this.cells.get(`${i},${j}`) ?? []) {
        if (!filter(s.path.kind)) continue;
        const d = segmentDistanceSq(x, z, s.ax, s.az, s.bx, s.bz);
        if (d >= bestD) continue;
        bestD = d;
        const dx = s.bx - s.ax, dz = s.bz - s.az, l = dx * dx + dz * dz;
        const t = l > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l)) : 0;
        best = { distance: Math.sqrt(d), x: s.ax + dx * t, z: s.az + dz * t, kind: s.path.kind, name: s.path.name,
          pedestrian: PEDESTRIAN.has(s.path.kind), street: STREET.has(s.path.kind), major: MAJOR.has(s.path.kind) };
      }
    }
    return best;
  }
  static isPedestrian(kind: string) { return PEDESTRIAN.has(kind) || kind === 'service'; }
  static isStreet(kind: string) { return STREET.has(kind); }
}
