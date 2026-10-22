import * as THREE from 'three';
import { Batch } from './batch';
import { frameColor, type DetailSource, type MaterialKey, type OpeningRun, type EaveRun } from './architecture';

/** Near-camera facade detail: real recessed openings (jambs, head soffit, sill
 * reveal, glass set back 0.16-0.34 m, frames, mullions, transoms, projecting
 * stone sills, glazed or panelled doors) and eave brackets. The wall shader
 * discards exactly these openings inside the detail radius, so the geometry
 * here must use the same layout as the shell attributes (OpeningRun). */

const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
const DOOR_LEAF = new THREE.Color(0.16, 0.1, 0.06);
const GLASS = new THREE.Color(1, 1, 1);

export interface DetailStats { windows: number; doors: number; brackets: number; triangles: number }

export function buildDetail(sources: DetailSource[], batchFor: (key: MaterialKey) => Batch, stats: DetailStats) {
  for (const source of sources) {
    for (const run of source.runs) openings(run, batchFor, stats);
    for (const eave of source.eaves) brackets(eave, batchFor, stats);
  }
}

function openings(r: OpeningRun, batchFor: (key: MaterialKey) => Batch, stats: DetailStats) {
  const dir = new THREE.Vector3(r.dx, 0, r.dz), n = new THREE.Vector3(r.nx, 0, r.nz);
  const P = (s: number, y: number, d = 0) => new THREE.Vector3(r.ax + r.dx * s - r.nx * d, y, r.az + r.dz * s - r.nz * d);
  const wall = batchFor(`wall:${r.family}`), trim = batchFor(`wall:${r.trim}`), glass = batchFor('glass'), frame = batchFor('frame');
  const fc = frameColor(r.frame), d = r.depth;
  const i0 = Math.round(r.s0 / r.bayW), i1 = Math.round(r.s1 / r.bayW);
  const door = r.type === 'door';
  const ribbon = r.type === 'ribbon';
  for (let i = i0; i < i1; i++) {
    const sc = (i + 0.5) * r.bayW, sl = sc - r.width / 2, sr = sc + r.width / 2;
    for (const f of r.floors) {
      const yb = f + r.sill, yt = f + r.head, h = yt - yb;
      if (h <= 0.2 || r.width <= 0.2) continue;
      // Reveals (wall material, no openings attribute): jambs, head soffit, sill.
      wall.quad(P(sl, yb, 0), P(sl, yb, d), P(sl, yt, d), P(sl, yt, 0), [sl, yb], [sl + d, yb], [sl + d, yt], [sl, yt], r.color, dir);
      wall.quad(P(sr, yb, d), P(sr, yb, 0), P(sr, yt, 0), P(sr, yt, d), [sr, yb], [sr + d, yb], [sr + d, yt], [sr, yt], r.color, dir.clone().negate());
      wall.quad(P(sl, yt, 0), P(sr, yt, 0), P(sr, yt, d), P(sl, yt, d), [sl, 0], [sr, 0], [sr, d], [sl, d], r.color.clone().multiplyScalar(0.85), DOWN);
      if (!door) (r.surround ? trim : wall).quad(P(sl, yb, d), P(sr, yb, d), P(sr, yb, 0), P(sl, yb, 0), [sl, 0], [sr, 0], [sr, d], [sl, d], r.surround ? r.trimColor : r.color, UP);
      // Glass (or a panelled leaf for residential doors).
      const leafSolid = door && r.frame === 'light';
      (leafSolid ? frame : glass).quad(P(sl, yb, d), P(sr, yb, d), P(sr, yt, d), P(sl, yt, d), [0, 0], [r.width, 0], [r.width, h], [0, h], leafSolid ? DOOR_LEAF : GLASS, n);
      // Frame bars just in front of the glass.
      const fw = ribbon ? 0.04 : door ? 0.07 : 0.055, fd = d - 0.012;
      const bar = (s0: number, s1: number, y0: number, y1: number) =>
        frame.quad(P(s0, y0, fd), P(s1, y0, fd), P(s1, y1, fd), P(s0, y1, fd), [0, 0], [1, 0], [1, 1], [0, 1], fc, n);
      bar(sl, sr, yb, yb + fw); bar(sl, sr, yt - fw, yt); bar(sl, sl + fw, yb, yt); bar(sr - fw, sr, yb, yt);
      const m = r.mullions;
      for (let k = 1; k <= m; k++) { const s = sl + (r.width * k) / (m + 1); bar(s - fw / 2, s + fw / 2, yb, yt); }
      if (r.transom && h > 1.2) {
        // Residential double-hung meeting rail at mid height; transom bar at ~72 % elsewhere.
        const y = yb + h * (r.frame === 'light' && !door ? 0.5 : door ? Math.max(0.78, (h - 0.5) / h) : 0.72);
        bar(sl, sr, y - fw / 2, y + fw / 2);
      }
      if (door) { stats.doors++; continue; }
      stats.windows++;
      // Projecting sill (stone for surrounds, otherwise matching the wall).
      if (!ribbon && r.type !== 'glazed') {
        const sb = r.surround ? trim : wall, sc2 = r.surround ? r.trimColor : r.color;
        const ext = 0.06, proj = 0.05, sh = 0.07;
        const A = P(sl - ext, yb, -proj), B = P(sr + ext, yb, -proj), C = P(sr + ext, yb, 0), D = P(sl - ext, yb, 0);
        sb.quad(D, C, B, A, [sl, 0], [sr, 0], [sr, proj], [sl, proj], sc2, UP);
        sb.quad(A.clone().setY(yb - sh), B.clone().setY(yb - sh), B, A, [sl, yb - sh], [sr, yb - sh], [sr, yb], [sl, yb], sc2, n);
        sb.quad(A.clone().setY(yb - sh), A, D, D.clone().setY(yb - sh), [0, 0], [0, sh], [proj, sh], [proj, 0], sc2, dir.clone().negate());
        sb.quad(B, B.clone().setY(yb - sh), C.clone().setY(yb - sh), C, [0, 0], [0, sh], [proj, sh], [proj, 0], sc2, dir);
      }
    }
  }
}

/** Carved eave brackets (modillions) every ~1.3 m under core-idiom tile eaves. */
function brackets(e: EaveRun, batchFor: (key: MaterialKey) => Batch, stats: DetailStats) {
  const b = batchFor(`wall:${e.family}`);
  const ring = e.wall;
  const w = 0.16, h = 0.3, depth = e.overhang * 0.85;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1.6) continue;
    const dx = (bx - ax) / len, dz = (bz - az) / len, nx = dz, nz = -dx;
    const count = Math.floor((len - 0.6) / 1.3);
    for (let k = 0; k <= count; k++) {
      const s = 0.3 + (len - 0.6) * (count ? k / count : 0.5);
      const cx = ax + dx * s, cz = az + dz * s;
      const p = (u: number, d: number) => new THREE.Vector3(cx + dx * u + nx * d, e.y - h, cz + dz * u + nz * d);
      b.box([p(-w / 2, 0), p(w / 2, 0), p(w / 2, depth), p(-w / 2, depth)], h - 0.005, 1, e.color, true);
      stats.brackets++;
    }
  }
}
