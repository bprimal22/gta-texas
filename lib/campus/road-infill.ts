import * as THREE from 'three';
import type { Path } from './types';
import type { CoverageGrid } from './context-coverage';
import { MeshBuilder } from './context-geometry';

/** Asphalt ribbons for mapped vehicle roads that still show bare terrain
 * (mainly I-35 and its ramps). Like the baked road finishes these are visual
 * only: the baked terrain stays the physical ground. Planar world UVs keep
 * overlapping carriageways seamless. */

const VEHICLE = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary',
  'secondary_link', 'tertiary', 'tertiary_link', 'residential', 'unclassified', 'living_street', 'service']);

export function buildRoadInfill(paths: Path[], grid: CoverageGrid, ground: (x: number, z: number) => number) {
  const asphalt = new MeshBuilder(), white = new THREE.Color(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  let metres = 0, roads = 0;
  const bare = (x: number, z: number) => !grid.near(grid.finish, x, z, 0.5) && !grid.at(grid.ground, x, z) &&
    !grid.near(grid.elevated, x, z, 1);
  // Wider roads first, so narrow ramps do not claim a junction.
  const ordered = paths.filter(p => VEHICLE.has(p.kind) && !p.area && p.points.length > 1)
    .sort((a, b) => b.width - a.width);
  for (const path of ordered) {
    const half = Math.max(2.5, path.width) / 2;
    const samples: { x: number; z: number; dx: number; dz: number }[] = [];
    for (let i = 1; i < path.points.length; i++) {
      const [ax, az] = path.points[i - 1], [bx, bz] = path.points[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-3) continue;
      const n = Math.max(1, Math.ceil(len / 2.5));
      for (let k = i === 1 ? 0 : 1; k <= n; k++)
        samples.push({ x: ax + ((bx - ax) * k) / n, z: az + ((bz - az) * k) / n, dx: (bx - ax) / len, dz: (bz - az) / len });
    }
    let emitted = false;
    const marks: [number, number][] = [];
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      if (!bare(mx, mz)) continue;
      // Average adjacent directions at joints to avoid wedge gaps.
      const dir = (s: typeof a, j: number) => {
        const o = samples[Math.min(samples.length - 1, j + 1)];
        const x = s.dx + o.dx, z = s.dz + o.dz, l = Math.hypot(x, z) || 1;
        return [x / l, z / l];
      };
      const [adx, adz] = dir(a, i - 1), [bdx, bdz] = dir(b, i);
      const corner = (s: typeof a, dx: number, dz: number, side: number) => {
        const x = s.x - dz * half * side, z = s.z + dx * half * side;
        return new THREE.Vector3(x, ground(x, z) + 0.07, z);
      };
      const al = corner(a, adx, adz, 1), ar = corner(a, adx, adz, -1), bl = corner(b, bdx, bdz, 1), br = corner(b, bdx, bdz, -1);
      const uv = (p: THREE.Vector3): [number, number] => [p.x / 4, p.z / 4];
      asphalt.quad(al, ar, br, bl, uv(al), uv(ar), uv(br), uv(bl), white, up);
      metres += Math.hypot(b.x - a.x, b.z - a.z);
      emitted = true;
      for (let t = 0; t <= 1; t += 0.5) for (let w = -1; w <= 1; w += 0.5)
        marks.push([mx + (b.x - a.x) * (t - 0.5) - a.dz * half * w, mz + (b.z - a.z) * (t - 0.5) + a.dx * half * w]);
    }
    // Claim the surface after the whole road so it does not block itself.
    for (const [x, z] of marks) grid.mark(grid.finish, x, z);
    if (emitted) roads++;
  }
  return { asphalt, stats: { roads, metres: Math.round(metres), triangles: asphalt.triangles } };
}
