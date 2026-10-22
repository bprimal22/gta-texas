// D18 — LBJ Presidential Library (City 590259:602, UT LBJ) replaced; Bass Concert Hall fly tower (PAC union 526275:274)
// kept generated, with its blank-tan composition set by data (context.json massing volume role tier + archetype
// b09-stadium:bass-blank) and additive dark slit reveals near its top.
// LBJ evidence: ut-lbj-392-directory-photo.jpg and ut-lbj-392-campus-14.jpg (official UT photographs; campus-13 depicts the
// adjoining Sid Richardson Hall and is NOT used): blank tall travertine body, an upper cantilevered cornice box over a deep dark
// horizontal ribbon with small projecting perpendicular ribs under the overhang, the short front recessed between the long
// walls with narrow dark ground-floor glazing, a central rooftop penthouse. Measured: City ring = cornice outline; roof Y 42.4
// (raster P50 42.46) with a central penthouse to Y 44.0 (raster blob ~12 x 18 m), plaza ground ~15.8 (2017 USGS 3DEP DSM/DTM).
// Estimate: overhang depth 2.8 m, ribbon / cornice heights, rib pitch, front recess depth, penthouse plan.
// Revision 2: travertine surfaces on the local limestone PBR maps (calibrated metre tile), roof on the membrane maps; the dark
// ribbon / ground glazing stay untextured glass. Bass slit reveals stay untextured dark matte (no stone/brick on the slits).
// Bass evidence: d18-orbit-southwest / -southeast (usable / context-limited): blank tan fly tower with dark horizontal slit
// recesses near the top of its south face; ut-pac-488-directory-photo.jpg (front glass pavilion between tan brick piers — its
// facade direction is not verified, so it is not built).
import type { Point } from '../../types';
import type { BlockInstallContext } from '../types';
import { Kit, col, outward, unit, lerp2, V, UP, DOWN } from './lane-kit';

export const LBJ_KEY = '590259:602';
export const LBJ = { roof: 42.4, corniceBottom: 38.2, ribbonBottom: 36.0, overhang: 2.8, ribbonRecess: 1.2, frontRecess: 3.2, ribPitch: 3.4, ribDepth: 0.9, penthouseTop: 44.0 } as const;
/** Bass fly tower: generated volume ring (context.json massing 526275 volume, 12.3..33.8 above Y 0.5) and its top. */
const FLY: Point[] = [[580.7, -24.0], [558.9, -26.0], [555.5, -25.2], [556.2, -43.1], [560.1, -44.2], [586.0, -41.3], [585.0, -22.1]];
export const BASS_FLY_TOP = 0.5 + 33.8;
const C = { trav: col('#e6e1d6'), travShade: col('#d4cfc3'), ribbon: col('#1f2428'), rib: col('#efeae0'), glass: col('#2a3238'), roof: col('#c9c5bb'), slit: col('#2b2723') };

export function buildLbj(kit: Kit, ctx: BlockInstallContext) {
  const b = ctx.data.buildings.find(x => x.key === LBJ_KEY);
  if (!b) throw new Error(`D18: ${LBJ_KEY} not in campus data`);
  const R0 = b.rings[0] as Point[], last = R0[R0.length - 1];
  const R = Math.hypot(last[0] - R0[0][0], last[1] - R0[0][1]) < 0.01 ? R0.slice(0, -1) : R0;   // drop a closing duplicate
  if (R.length !== 4) throw new Error('D18: LBJ ring is not the 4-corner City rectangle');
  const g = ctx.groundHeight;
  let low = Infinity; for (const p of R) low = Math.min(low, g(p[0], p[1]));
  const base = low - 0.6, L = LBJ;
  const len = (i: number) => Math.hypot(R[(i + 1) % 4][0] - R[i][0], R[(i + 1) % 4][1] - R[i][1]);
  const long = len(0) > len(1) ? [0, 2] : [1, 3];
  // Body ring: cornice outline inset by the overhang on every side.
  const ins = (i: number, d: number) => { const n = outward(R, i); return [R[i], R[(i + 1) % 4]].map(p => [p[0] - n[0] * d, p[1] - n[1] * d] as Point); };
  const lines = [0, 1, 2, 3].map(i => ins(i, L.overhang));
  const meet = (a: Point[], c: Point[]): Point => { // intersection of two infinite lines
    const d1 = unit(a[0], a[1]), d2 = unit(c[0], c[1]), den = d1[0] * d2[1] - d1[1] * d2[0];
    const t = ((c[0][0] - a[0][0]) * d2[1] - (c[0][1] - a[0][1]) * d2[0]) / den; return [a[0][0] + d1[0] * t, a[0][1] + d1[1] * t];
  };
  const body = [0, 1, 2, 3].map(i => meet(lines[(i + 3) % 4], lines[i]));   // body[i] = corner between edge i-1 and i
  for (let i = 0; i < 4; i++) {
    const a = body[i], c = body[(i + 1) % 4], n = outward(body, i), isLong = long.includes(i);
    if (isLong) { kit.wall('solid', 'stone', a, c, base, L.ribbonBottom, C.trav, n); continue; }
    // Short fronts: recessed between the long walls (end fins 1.6 m), narrow dark ground-floor glazing band.
    const T = unit(a, c), Lc = Math.hypot(c[0] - a[0], c[1] - a[1]), f = 1.6, d = L.frontRecess;
    const P = (t: number, dd: number): Point => [a[0] + T[0] * t - n[0] * dd, a[1] + T[1] * t - n[1] * dd];
    kit.wall('solid', 'stone', P(0, 0), P(f, 0), base, L.ribbonBottom, C.trav, n);
    kit.wall('solid', 'stone', P(Lc - f, 0), P(Lc, 0), base, L.ribbonBottom, C.trav, n);
    kit.wall('solid', 'stone', P(f, 0), P(f, d), base, L.ribbonBottom, C.travShade, T);
    kit.wall('solid', 'stone', P(Lc - f, d), P(Lc - f, 0), base, L.ribbonBottom, C.travShade, [-T[0], -T[1]]);
    const gy = low + 4.2;
    kit.wall('solid', 'glass', P(f, d), P(Lc - f, d), base, gy, C.glass, n);
    kit.wall('solid', 'stone', P(f, d), P(Lc - f, d), gy, L.ribbonBottom, C.trav, n);
    kit.quad('solid', 'stone', V(P(f, 0)[0], L.ribbonBottom, P(f, 0)[1]), V(P(Lc - f, 0)[0], L.ribbonBottom, P(Lc - f, 0)[1]), V(P(Lc - f, d)[0], L.ribbonBottom, P(Lc - f, d)[1]), V(P(f, d)[0], L.ribbonBottom, P(f, d)[1]), C.travShade, DOWN);
    // Thin concrete band over the ground glazing (visual relief).
    const Q = (t: number, y: number) => V(P(t, d - 0.02)[0], y, P(t, d - 0.02)[1]);
    kit.quad('detail', 'stone', Q(f, gy), Q(Lc - f, gy), Q(Lc - f, gy + 0.6), Q(f, gy + 0.6), C.travShade, V(n[0], 0, n[1]));
  }
  // Under the cornice box: a ledge on the body top, the dark ribbon set 1.2 m further in, ribs from the ribbon out to the
  // cornice line, and the cornice underside (cornice outline minus ribbon ring).
  const rl = [0, 1, 2, 3].map(i => ins(i, L.overhang + L.ribbonRecess));
  const rib = [0, 1, 2, 3].map(i => meet(rl[(i + 3) % 4], rl[i]));
  kit.cap('solid', 'stone', [body, rib.slice().reverse()], L.ribbonBottom, C.travShade);
  for (let i = 0; i < 4; i++) {
    const a = rib[i], c = rib[(i + 1) % 4], n = outward(rib, i);
    kit.wall('solid', 'glass', a, c, L.ribbonBottom, L.corniceBottom, C.ribbon, n);
    const Lc = Math.hypot(c[0] - a[0], c[1] - a[1]), T = unit(a, c), k = Math.max(2, Math.round(Lc / L.ribPitch));
    for (let j = 1; j < k; j++) {           // ribs: 0.5 m wide, ribbon to cornice line, 0.9 m deep under the cornice box
      const O = lerp2(a, c, j / k);
      kit.box('solid', 'stone', C.rib, O, T, n, -0.25, 0.25, 0, L.overhang + L.ribbonRecess, L.corniceBottom - L.ribDepth, L.corniceBottom, 'kt');
    }
  }
  kit.cap('solid', 'stone', [R, rib.slice().reverse()], L.corniceBottom, C.travShade, true);
  for (let i = 0; i < 4; i++) kit.wall('solid', 'stone', R[i], R[(i + 1) % 4], L.corniceBottom, L.roof, C.trav, outward(R, i));
  kit.cap('solid', 'membrane', [R], L.roof, C.roof);
  // Penthouse: centred, 12 m across the short axis x 18 m along the long axis (raster blob), to Y 44.0.
  const c0 = lerp2(lerp2(R[0], R[1], 0.5), lerp2(R[2], R[3], 0.5), 0.5), la = unit(R[long[0]], R[(long[0] + 1) % 4]), sa: Point = [-la[1], la[0]];
  kit.box('solid', 'stone', C.trav, c0, la, sa, -9, 9, -6, 6, L.roof, L.penthouseTop, 'b');
  return { roof: L.roof, penthouseTop: L.penthouseTop, bodyInset: L.overhang };
}

/** Bass fly tower: two dark slit reveals near the top of the south face (visual, 2 cm proud of the generated wall). */
export function buildBassSlits(kit: Kit) {
  const prev = kit.group; kit.group = 'add';
  const a = FLY[0], b = FLY[1], n = outward(FLY, 0), T = unit(a, b), Lc = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const P = (t: number, y: number) => V(a[0] + T[0] * t + n[0] * 0.02, y, a[1] + T[1] * t + n[1] * 0.02);
  const y1 = BASS_FLY_TOP - 1.6, y0 = y1 - 0.9;
  for (const [t0, t1] of [[Lc * 0.12, Lc * 0.42], [Lc * 0.58, Lc * 0.88]]) kit.mb('detail', 'matte').quad(P(t0, y0), P(t1, y0), P(t1, y1), P(t0, y1), [0, 0], [1, 0], [1, 1], [0, 1], C.slit, V(n[0], 0, n[1]));
  kit.group = prev;
  return { slits: 2, y: [y0, y1] };
}
void UP;
