// D21 — Frank Denius Fields Indoor Practice Facility (City 504902:195, UT IPF, 2002), replacing the generated hipped box
// with the air-supported fabric dome seen in d21-orbit-southwest and -southeast (usable): a long white membrane with rounded
// ends, a near-vertical low skirt and a darker base band, entrance vestibules on the south end.
// Measured: the 117.7 x 56.6 m rectangle and vestibule notches of the City ring; the profile is fitted to the 2017 USGS 3DEP
// raster in lidar-reference.json (groundY 18.5; whole-ring P10 27.87 / P50 35.14; crown-zone P50 37.76, max 39.38):
// h(u,v) = 4 + 16.9 * (1-|v|^2.5)^0.75 * (1-|u|^4)^0.5  ->  P10 27.9 / P50 35.2 / crown P50 37.8 / max 39.4 (fit offline).
// Estimate: 4 m skirt, vestibule height 4.2 m, seam spacing. No interior is modelled.
// Visual (revision 2, root IAB review): one uniform white membrane (the earlier alternating panel colours read as a
// checkerboard), the local PBR membrane maps at their metre tile with surface arc-length metre UVs, smooth vertex normals over the
// curved membrane only (the skirt is a separate builder, so the skirt/membrane crease stays hard; positions and colliders are
// unchanged), and subtle longitudinal seams as visual relief.
import type { Point } from '../../types';
import type { BlockInstallContext } from '../types';
import { Kit, col, V, UP } from './lane-kit';

export const IPF_KEY = '504902:195';
const A: Point = [1006.94, -86.99], B: Point = [1061.74, -72.7], Cc: Point = [1032.13, 41.1], D: Point = [977.31, 26.9];
export const IPF = { groundY: 18.5, skirt: 4, crown: 20.9, a: 2.5, b: 0.75, c: 4, d: 0.5, nu: 44, nv: 26, vestibuleTop: 4.2 } as const;
/** Entrance vestibules: the three bumps of the City ring on the south end (outer three vertices each; the fourth side
 * lies on the dome skirt line). */
const VESTIBULES: Point[][] = [
  [[1001.68, 33.25], [999.66, 41.0], [1005.13, 42.43], [1007.17, 34.6]],
  [[1010.73, 35.53], [1008.87, 42.69], [1012.54, 43.65], [1014.41, 36.48]],
  [[1021.52, 38.33], [1020.98, 40.4], [1025.11, 41.48], [1025.65, 39.41]],
];
const C = { membrane: col('#eeede8'), seam: col('#d6d5cf'), skirt: col('#8e908f'), vest: col('#cfccc4'), vestRoof: col('#9a9b98') };
/** Longitudinal seam positions across the width (fractions of the A->B width). */
const SEAMS = [0.14, 0.27, 0.39, 0.5, 0.61, 0.73, 0.86];

export function ipfHeight(u: number, v: number) {
  const f = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(v), IPF.a)), IPF.b) * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), IPF.c)), IPF.d);
  return IPF.skirt + (IPF.crown - IPF.skirt) * f;
}

export function buildPracticeDome(kit: Kit, ctx: BlockInstallContext) {
  const b = ctx.data.buildings.find(x => x.key === IPF_KEY);
  if (!b) throw new Error(`D21: ${IPF_KEY} not in campus data`);
  const near = (p: Point) => b.rings[0].some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.05);
  if (![A, B, Cc, D].every(near)) throw new Error('D21: IPF ring corners differ from the City source');
  const g = ctx.groundHeight, G = IPF.groundY;
  const at = (s: number, t: number): Point => { // s: 0..1 along A->D (length), t: 0..1 along A->B (width)
    const ab: Point = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t], dc: Point = [D[0] + (Cc[0] - D[0]) * t, D[1] + (Cc[1] - D[1]) * t];
    return [ab[0] + (dc[0] - ab[0]) * s, ab[1] + (dc[1] - ab[1]) * s];
  };
  // Cosine spacing concentrates rows at the steep edges.
  const cs = (k: number, n: number) => 0.5 - 0.5 * Math.cos(Math.PI * k / n);
  const us = Array.from({ length: IPF.nu + 1 }, (_, k) => cs(k, IPF.nu)), vs = Array.from({ length: IPF.nv + 1 }, (_, k) => cs(k, IPF.nv));
  const P = (i: number, j: number) => { const s = us[i], t = vs[j], p = at(s, t); return V(p[0], G + ipfHeight(2 * s - 1, 2 * t - 1), p[1]); };
  // Metre UVs per vertex (a doubly curved surface cannot be mapped isometrically): u = crown-line arc length along the length
  // (one value per length station, so no shear), v = surface arc length across the width at that station.
  const arcV: number[][] = [], crown = Math.round(IPF.nv / 2), arcU = [0];
  for (let i = 0; i <= IPF.nu; i++) { const row = [0]; for (let j = 1; j <= IPF.nv; j++) row.push(row[j - 1] + P(i, j).distanceTo(P(i, j - 1))); arcV.push(row); }
  for (let i = 1; i <= IPF.nu; i++) arcU.push(arcU[i - 1] + P(i, crown).distanceTo(P(i - 1, crown)));
  const uvAt = new Map<string, Point>();
  for (let i = 0; i <= IPF.nu; i++) for (let j = 0; j <= IPF.nv; j++) { const p = P(i, j); uvAt.set(`${p.x.toFixed(4)},${p.z.toFixed(4)}`, [arcU[i], arcV[i][j]]); }
  const domeUV = (p: { x: number; z: number }): Point => uvAt.get(`${p.x.toFixed(4)},${p.z.toFixed(4)}`) ?? [p.x, p.z];
  for (let i = 0; i < IPF.nu; i++) for (let j = 0; j < IPF.nv; j++)
    kit.quad('solid', 'membrane', P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), C.membrane, UP, domeUV);
  const smoothed = kit.smooth('solid', 'membrane');
  // Seams: 0.18 m strips following the surface along the length, 3 cm above it (visual only).
  const Q = (s: number, t: number, lift: number) => { const p = at(s, t); return V(p[0], G + ipfHeight(2 * s - 1, 2 * t - 1) + lift, p[1]); };
  for (const t of SEAMS) {
    const dt = 0.09 / Math.hypot(B[0] - A[0], B[1] - A[1]);
    for (let i = 0; i < IPF.nu; i++) kit.mb('detail', 'matte').quad(Q(us[i], t - dt, 0.03), Q(us[i + 1], t - dt, 0.03), Q(us[i + 1], t + dt, 0.03), Q(us[i], t + dt, 0.03),
      [0, 0], [1, 0], [1, 1], [0, 1], C.seam, UP);
  }
  // Skirt: the perimeter at skirt height down to the ground (below grade by 0.6 m), outward.
  const per: [number, number][] = [];
  for (let i = 0; i < IPF.nu; i++) per.push([i, 0]);
  for (let j = 0; j < IPF.nv; j++) per.push([IPF.nu, j]);
  for (let i = IPF.nu; i > 0; i--) per.push([i, IPF.nv]);
  for (let j = IPF.nv; j > 0; j--) per.push([0, j]);
  const centre = at(0.5, 0.5);
  for (let k = 0; k < per.length; k++) {
    const [i0, j0] = per[k], [i1, j1] = per[(k + 1) % per.length], p = P(i0, j0), q = P(i1, j1);
    const out = V((p.x + q.x) / 2 - centre[0], 0, (p.z + q.z) / 2 - centre[1]);
    kit.quad('solid', 'matte', V(p.x, g(p.x, p.z) - 0.6, p.z), V(q.x, g(q.x, q.z) - 0.6, q.z), q, p, C.skirt, out);
  }
  // Vestibules (flat-roofed boxes on the three ring bumps; their dome-side face is the skirt).
  for (const r of VESTIBULES) {
    let base = Infinity; for (const p of r) base = Math.min(base, g(p[0], p[1]));
    const top = G + IPF.vestibuleTop;
    const m: Point = [(r[0][0] + r[3][0]) / 2, (r[0][1] + r[3][1]) / 2];
    for (let k = 0; k < 3; k++) {
      const a = r[k], c = r[k + 1], mid: Point = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      kit.wall('solid', 'matte', a, c, base - 0.6, top, C.vest, [mid[0] - m[0], mid[1] - m[1]]);
    }
    kit.cap('solid', 'matte', [r], top, C.vestRoof);
  }
  return { crownY: G + IPF.crown, edgeY: G + IPF.skirt, grid: [IPF.nu, IPF.nv], vestibules: VESTIBULES.length, smoothedVertices: smoothed, seams: SEAMS.length };
}
