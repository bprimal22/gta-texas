// D17 — Texas Science & Natural History Museum (Texas Memorial Museum, City 612504:719, UT TMM), replacing the generated
// boxes. Evidence: ut-tmm-493-directory-photo.jpg (official UT directory photograph): monumental pale Art Deco limestone front
// with three tall narrow dark window fields split by flat stone pilasters, a central entrance below the middle field, plain
// flanking wall, a broad central stair; d17-orbit-northwest (context-limited) shows the same west front over the plaza.
// Measured: City ring; LiDAR tiers restated in b09 context.json (groundY 4.7, main block top Y 26.2 = raster P50 26.15,
// east annex top Y 20.3). Estimate: window / pilaster widths, sill and head heights, attic reveal, door size. The front stair
// is NOT built: the forecourt is the shared pedestrian area path:130882569:681 with mapped steps (687/688), and no step may
// overlap it. Side and rear elevations are undocumented and kept plain.
import type { Point } from '../../types';
import type { BlockInstallContext } from '../types';
import { Kit, col, outward, unit, V, UP, DOWN, type Mat } from './lane-kit';

export const TMM_KEY = '612504:719';
/** The City ring split along its own vertices (465.75,-80.36)-(467.92,-107.89) into the main museum block (LiDAR tier, Y 26.2;
 * matches context.json massing 612504:719 volume 1 within 0.4 m) and the stepped east annex (Y 20.3). */
const MAIN: Point[] = [[447.5, -82.03], [450.7, -116.93], [451.2, -117.47], [468.65, -115.87], [467.92, -107.89], [465.75, -80.36]];
const ANNEX: Point[] = [[465.75, -80.36], [466.41, -87.51], [471.43, -87.05], [471.58, -88.78], [477.15, -88.27], [478.45, -102.45], [472.72, -102.97],
  [473.12, -107.42], [467.92, -107.89]];
export const TMM = { mainTop: 26.2, annexTop: 20.3, window: 4.4, pier: 2.6, sill: 7.5, head: 18.0, recess: 0.7, attic: 1.0 } as const;
const C = { stone: col('#e3ded2'), stoneShade: col('#d3cdbf'), glass: col('#2b3136'), mullion: col('#6f6a5f'), door: col('#3a3b38'), roof: col('#bdb8ab') };

export function buildTmm(kit: Kit, ctx: BlockInstallContext) {
  const b = ctx.data.buildings.find(x => x.key === TMM_KEY);
  if (!b) throw new Error(`D17: ${TMM_KEY} not in campus data`);
  const g = ctx.groundHeight;
  let low = Infinity; for (const p of b.rings[0]) low = Math.min(low, g(p[0], p[1]));
  const base = low - 0.6;
  // Annex: walls on its outer edges only (the last edge is shared with the main block), roof at its LiDAR top.
  for (let i = 0; i < ANNEX.length; i++) {
    if (i === ANNEX.length - 1) continue;      // shared edge (main block east wall)
    kit.wall('solid', 'stone', ANNEX[i], ANNEX[(i + 1) % ANNEX.length], base, TMM.annexTop, C.stoneShade, outward(ANNEX, i));
  }
  kit.cap('solid', 'membrane', [ANNEX], TMM.annexTop, C.roof);
  // Main block: west front composed, east edges (shared with the annex) only above the annex roof, others plain.
  for (let i = 0; i < MAIN.length; i++) {
    const a = MAIN[i], c = MAIN[(i + 1) % MAIN.length], n = outward(MAIN, i);
    if (i === 0) { front(kit, a, c, n, g); continue; }
    const shared = i === 4;
    kit.wall('solid', 'stone', a, c, shared ? TMM.annexTop : base, TMM.mainTop, C.stone, n);
  }
  kit.cap('solid', 'membrane', [MAIN], TMM.mainTop, C.roof);
  return { mainTop: TMM.mainTop, annexTop: TMM.annexTop, windows: 3 };
}

/** West front: plain flanks, four flat pilasters, three tall recessed dark window fields with a mullion grid, a recessed
 * entrance under the middle field, and an attic reveal line. Recesses go inward from the GIS/tier line. */
function front(kit: Kit, a: Point, b: Point, n: Point, g: (x: number, z: number) => number) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), T = unit(a, b);
  const P = (t: number, d: number, y: number) => V(a[0] + T[0] * t - n[0] * d, y, a[1] + T[1] * t - n[1] * d);
  const out = V(n[0], 0, n[1]);
  const face = (t0: number, t1: number, d: number, y0: number, y1: number, c = C.stone, mat: Mat = 'stone') => {
    if (t1 - t0 > 0.01 && y1 - y0 > 0.01) kit.quad('solid', mat, P(t0, d, y0), P(t1, d, y0), P(t1, d, y1), P(t0, d, y1), c, out);
  };
  const recess = (t0: number, t1: number, y0: number, y1: number, d: number, back: typeof C.glass, mat: Mat) => {
    face(t0, t1, d, y0, y1, back, mat);
    kit.quad('solid', 'stone', P(t0, 0, y0), P(t0, d, y0), P(t0, d, y1), P(t0, 0, y1), C.stoneShade, V(T[0], 0, T[1]));
    kit.quad('solid', 'stone', P(t1, d, y0), P(t1, 0, y0), P(t1, 0, y1), P(t1, d, y1), C.stoneShade, V(-T[0], 0, -T[1]));
    kit.quad('solid', 'stone', P(t0, 0, y1), P(t1, 0, y1), P(t1, d, y1), P(t0, d, y1), C.stoneShade, DOWN);
    kit.quad('solid', 'stone', P(t0, d, y0), P(t1, d, y0), P(t1, 0, y0), P(t0, 0, y0), C.stoneShade, UP);
  };
  let gmin = Infinity; for (let t = 0; t <= L; t += 2) { const p = P(t, 0, 0); gmin = Math.min(gmin, g(p.x, p.z)); }
  const base = gmin - 0.6, top = TMM.mainTop, sill = gmin + TMM.sill, head = Math.min(gmin + TMM.head, top - 3.0);
  const W = TMM.window, Pw = TMM.pier, span = 3 * W + 4 * Pw, t0 = (L - span) / 2;
  const door = { w: 3.0, h: 4.0 };
  face(0, t0, 0, base, top); face(L - t0, L, 0, base, top);
  for (let k = 0; k < 4; k++) face(t0 + k * (W + Pw), t0 + k * (W + Pw) + Pw, 0, base, top);   // pilasters (flush, flat)
  for (let k = 0; k < 3; k++) {
    const w0 = t0 + Pw + k * (W + Pw), w1 = w0 + W;
    face(w0, w1, 0, head, top);
    if (k === 1) {
      const d0 = (w0 + w1) / 2 - door.w / 2, d1 = d0 + door.w, dt = gmin + door.h;
      face(w0, d0, 0, base, sill); face(d1, w1, 0, base, sill); face(d0, d1, 0, dt, sill);
      recess(d0, d1, base + 0.6, dt, 0.5, C.door, 'matte');
    } else face(w0, w1, 0, base, sill);
    recess(w0, w1, sill, head, TMM.recess, C.glass, 'glass');
    // Mullion grid (visual, 2 cm proud of the glass).
    const m = kit.mb('detail', 'metal'), d = TMM.recess - 0.02;
    for (let x = w0 + W / 4; x < w1 - 0.1; x += W / 4) m.quad(P(x - 0.06, d, sill), P(x + 0.06, d, sill), P(x + 0.06, d, head), P(x - 0.06, d, head), [0, 0], [1, 0], [1, 1], [0, 1], C.mullion, out);
    for (let y = sill + 1.5; y < head - 0.2; y += 1.5) m.quad(P(w0, d, y - 0.06), P(w1, d, y - 0.06), P(w1, d, y + 0.06), P(w0, d, y + 0.06), [0, 0], [1, 0], [1, 1], [0, 1], C.mullion, out);
  }
  // Attic reveal line and base course (visual relief, 2 cm proud).
  for (const [y0, y1, c] of [[head + TMM.attic, head + TMM.attic + 0.25, C.stoneShade], [gmin + 2.2, gmin + 2.45, C.stoneShade]] as const)
    kit.quad('detail', 'stone', P(0, -0.02, y0), P(L, -0.02, y0), P(L, -0.02, y1), P(0, -0.02, y1), c, out);
  // Revision 2 (visual relief only, <= 0.24 m proud, no collider): a two-step limestone cornice along the photographed west
  // front and a flat stone surround (jambs + lintel) framing the central entrance, as in ut-tmm-493-directory-photo.jpg.
  const Tn: Point = [T[0], T[1]], Nn: Point = [n[0], n[1]];
  kit.box('detail', 'stone', C.stoneShade, a, Tn, Nn, 0, L, 0, 0.12, top - 1.45, top - 0.9, 'k');
  kit.box('detail', 'stone', C.stone, a, Tn, Nn, 0, L, 0, 0.24, top - 0.9, top - 0.3, 'k');
  const mid = t0 + Pw + W + Pw + W / 2, dw = door.w / 2, dtop = gmin + door.h;
  kit.box('detail', 'stone', C.stoneShade, a, Tn, Nn, mid - dw - 0.6, mid - dw, 0, 0.18, base + 0.6, dtop + 0.7, 'kb');
  kit.box('detail', 'stone', C.stoneShade, a, Tn, Nn, mid + dw, mid + dw + 0.6, 0, 0.18, base + 0.6, dtop + 0.7, 'kb');
  kit.box('detail', 'stone', C.stoneShade, a, Tn, Nn, mid - dw, mid + dw, 0, 0.18, dtop, dtop + 0.7, 'k');
}
