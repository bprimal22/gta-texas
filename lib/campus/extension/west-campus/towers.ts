// Two post-2023 West Campus towers, built with the b12 authored-body kit (solid = rendered AND collided from the same
// triangles; detail = flush visual skin within 0.6 m of a solid face). Footprints and tops are evidence (format.ts /
// west-campus-v1.json); everything inside them is a PHOTO-INTERPRETED ESTIMATE (research-only references in
// .work/claude-west-campus/refs, not shipped):
//  * Union on 24th (City 2023 ring 470235; Perkins&Will 2024 photos; Datum Engineers: H-shaped residential floors over
//    4 above-grade parking levels, level-6 amenity deck, level-29 pool): dark vertically-ribbed metal podium on the whole
//    City ring with a glazed ground storey on W 24th (north) and Rio Grande (east); an H-shaped tower whose outer
//    perimeter is charcoal panels with framed windows and white patches in a stepped (herringbone) pattern and whose
//    court faces are champagne-silver ribbed metal with punched windows; roof garden in the north court, pool deck in the
//    south court. H proportions, podium height (18 m) and the mechanical screen (inside the overall height) are estimates.
//  * Villas on 24th (OSM outline; DCI Engineers / owner photos): white panel tower, tall windows each with a black
//    fin (side alternating every second storey), dark glass corner columns, a two-storey glass amenity crown over the
//    north (W 24th) part of the roof and a pool deck south of it facing downtown; garage levels behind a pleated
//    perforated-metal screen; glazed lobby on W 24th (north) and Rio Grande (west). Podium height (16 m), crown extent and
//    the corner columns' width are estimates.
import { Color } from 'three';
import type { Point } from '../../types';
import { Kit, C, edgesOf, at, hash, inRing, ringDist, orient, rect, type Edge } from '../../blocks/b12-west-campus/kit';
import type { WestCampusTower } from './format';

type G = (x: number, z: number) => number;
interface Frame { c: Point; u: [number, number]; v: [number, number]; hu: number; hv: number }
/** Minimum-area oriented rectangle of a ring: u along the longer side (pointing +x-ish), v = u rotated +90 deg (+z-ish). */
export function frameOf(ring: Point[]): Frame {
  let best: Frame | null = null, bestArea = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L < 1) continue;
    let u: [number, number] = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
    if (Math.abs(u[0]) < Math.abs(u[1])) u = [-u[1], u[0]];
    if (u[0] < 0) u = [-u[0], -u[1]];
    const v: [number, number] = [-u[1], u[0]];
    const as = ring.map(r => r[0] * u[0] + r[1] * u[1]), bs = ring.map(r => r[0] * v[0] + r[1] * v[1]);
    const a0 = Math.min(...as), a1 = Math.max(...as), b0 = Math.min(...bs), b1 = Math.max(...bs), area = (a1 - a0) * (b1 - b0);
    if (area < bestArea - 1e-6) {
      bestArea = area;
      const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
      best = { c: [u[0] * ca + v[0] * cb, u[1] * ca + v[1] * cb], u, v, hu: (a1 - a0) / 2, hv: (b1 - b0) / 2 };
    }
  }
  return best!;
}
const L2W = (f: Frame, a: number, b: number): Point => [f.c[0] + f.u[0] * a + f.v[0] * b, f.c[1] + f.u[1] * a + f.v[1] * b];
const W2L = (f: Frame, p: Point): [number, number] => { const dx = p[0] - f.c[0], dz = p[1] - f.c[1]; return [dx * f.u[0] + dz * f.u[1], dx * f.v[0] + dz * f.v[1]]; };
/** Keep the part of a ring with n . p <= c (Sutherland-Hodgman against one half-plane). */
function clipHalf(ring: Point[], n: [number, number], c: number): Point[] {
  const out: Point[] = [], side = (p: Point) => p[0] * n[0] + p[1] * n[1] - c;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length], sp = side(p), sq = side(q);
    if (sp <= 0) out.push(p);
    if (sp * sq < 0) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}
/** Lowest ground 1.2 m outside the ring, sampled every 2 m. */
function groundMin(ring: Point[], g: G) {
  let m = Infinity;
  for (const e of edgesOf(ring)) for (let s = 0; s <= e.L; s += 2) { const p = at(e, Math.min(s, e.L), 0, 1.2); m = Math.min(m, g(p.x, p.z)); }
  return m;
}
const edgeGround = (e: Edge, g: G) => { let m = Infinity; for (const t of [.1, .5, .9]) { const p = at(e, e.L * t, 0, 1.2); m = Math.min(m, g(p.x, p.z)); } return m; };
const mix = (a: Color, b: Color, t: number) => a.clone().lerp(b, t);

export interface TowerReport { key: string; name: string; bottom: number; podiumTop: number; roofY: number; topY: number; floors: number; plan: Point[][]; detail: Record<string, number> }

// ------------------------------------------------------------------------------------------------ Union on 24th
/** H plan (Datum Engineers: H-shaped residential floors; Perkins&Will north elevation union-3: two dark legs ~20 m wide at
 * the podium ends, a recessed silver bar between them, courts on the podium deck north (W 24th) and south). Local frame:
 * u = east (Rio Grande), v = south; W 24th St is on the NORTH side (-v). Leg width, end inset, bar depth: estimates. */
export const UNION_PLAN = { podium: 18, mech: 3.0, endInset: 4, sideInset: 2, leg: 20, bar: 14 };
export function buildUnion(k: Kit, t: WestCampusTower, g: G): TowerReport {
  const ring = orient(t.ring), f = frameOf(ring), P = UNION_PLAN;
  const bottom = groundMin(ring, g) - 1.0, podiumTop = t.baseY + P.podium, topY = t.topY, roofY = topY - P.mech;
  const A = f.hu - P.endInset, A2 = A - P.leg, B = f.hv - P.sideInset, H = P.bar / 2;
  const hLocal: [number, number][] = [[-A, -B], [-A2, -B], [-A2, -H], [A2, -H], [A2, -B], [A, -B], [A, B], [A2, B], [A2, H], [-A2, H], [-A2, B], [-A, B]];
  const tower = orient(hLocal.map(([a, b]) => L2W(f, a, b)));
  for (const p of tower) if (!inRing(p[0], p[1], ring) || ringDist(p[0], p[1], ring) < 1) throw Error('Union on 24th: tower plan leaves the City ring');
  const charcoal = C('#2c2d30'), silver = C('#c4c0b6'), podiumCol = C('#232427'), deck = C('#9d9a93'), roof = C('#7d7f80');
  // Podium: City ring walls, deck = ring minus the H.
  for (const e of edgesOf(ring)) k.wall(k.S('metal'), e.a, e.c, bottom, podiumTop, podiumCol);
  k.cap(k.S(), [ring, tower.slice().reverse()], podiumTop, deck);
  // Tower: dark herringbone on the H's outer perimeter, silver on every court-facing face.
  const skins = new Map<Edge, 'dark' | 'silver'>();
  for (const e of edgesOf(tower)) {
    const probe = at(e, e.L / 2, 0, 2), [pa, pb] = W2L(f, [probe.x, probe.z]);
    const dark = !(Math.abs(pa) < A && Math.abs(pb) < B);
    skins.set(e, dark ? 'dark' : 'silver');
    k.wall(k.S(dark ? 'matte' : 'metal'), e.a, e.c, podiumTop, roofY, dark ? charcoal : silver);
  }
  k.cap(k.S(), [tower], roofY, roof);
  // Rooftop mechanical screen on the bar (inside the overall height, never above it).
  const ph = orient(rect(...L2W(f, 0, 0), f.u, Math.min(12, A2 - 1), H - 3));
  k.prism(ph, roofY, topY, C('#8b8d8e'), C('#6f7173'));
  const storey = 3.15, floors = Math.round((roofY - podiumTop) / storey), sh = (roofY - podiumTop) / floors;
  const detail = { windows: 0, patches: 0, ribs: 0, tiles: 0, planters: 0 };
  const glass = C('#46586a'), glassLow = C('#33424f'), white = C('#dcdcd8'), frameDark = C('#18191b');
  for (const [e, skin] of skins) {
    const bays = Math.floor((e.L - 1.2) / 3.3); if (bays < 1) continue;
    const bay = (e.L - 1.2) / bays, s0 = .6;
    if (skin === 'silver') {
      // vertical ribs, warm champagne at the base fading to bright silver at the top (photo gradient); punched windows
      const ribs = Math.floor(e.L / .55);
      for (let r = 0; r < ribs; r++) {
        const s = (r + .5) * e.L / ribs, col = r % 2 ? C('#d2cfc7') : C('#b3afa5');
        for (let q = 0; q < 3; q++) {
          const ya = podiumTop + (roofY - podiumTop) * q / 3, yb = podiumTop + (roofY - podiumTop) * (q + 1) / 3;
          k.panel(k.D('metal'), e, s - .07, s + .07, ya, yb, .025, mix(col, C('#9a9283'), .45 - .2 * q));
        }
        detail.ribs++;
      }
      for (let fl = 0; fl < floors; fl++) for (let j = 0; j < bays; j++) {
        const y = podiumTop + fl * sh + .75, s = s0 + (j + .5) * bay;
        k.panel(k.D('glass'), e, s - .78, s + .78, y, y + 1.56, .05, fl < floors / 2 ? glassLow : glass); detail.windows++;
      }
    } else {
      // charcoal ribbed panels: floor joints, framed windows, white patches stepping diagonally (herringbone)
      for (let fl = 1; fl < floors; fl++) { const y = podiumTop + fl * sh; k.panel(k.D(), e, 0, e.L, y - .04, y + .04, .02, frameDark); }
      for (let fl = 0; fl < floors; fl++) for (let j = 0; j < bays; j++) {
        const y = podiumTop + fl * sh + .6, s = s0 + (j + .5) * bay;
        k.panel(k.D(), e, s - .92, s + .92, y - .12, y + 1.92, .03, frameDark);
        k.panel(k.D('glass'), e, s - .8, s + .8, y, y + 1.8, .05, hash(j, fl, 3) < .5 ? glass : glassLow); detail.windows++;
        const m = ((j + fl) % 5 + 5) % 5, n = ((j - fl) % 4 + 4) % 4;
        if (m === 0) { k.panel(k.D(), e, s + .92, Math.min(s + bay - .55, s + 2.1), y - .12, y + 1.92, .03, white); detail.patches++; }
        else if (n === 1) { k.panel(k.D(), e, s - .92, s + .92, y + 1.92, Math.min(y + sh - .62, y + 2.3), .03, white); detail.patches++; }
      }
    }
  }
  // Podium skin: ribs above a glazed ground storey on W 24th (north, -v) and Rio Grande (east, +u), screened elsewhere.
  for (const e of edgesOf(ring)) {
    const gy = edgeGround(e, g), gTop = gy + 4.6, nb = e.n.x * f.v[0] + e.n.z * f.v[1], na = e.n.x * f.u[0] + e.n.z * f.u[1];
    const ribs = Math.floor(e.L / .45);
    for (let r = 0; r < ribs; r++) { const s = (r + .5) * e.L / ribs; k.panel(k.D('metal'), e, s - .06, s + .06, gTop, podiumTop - .3, .04, C('#36383c')); detail.ribs++; }
    for (const y of [gTop, gTop + (podiumTop - gTop) / 3, gTop + 2 * (podiumTop - gTop) / 3, podiumTop - .3]) k.panel(k.D(), e, 0, e.L, y - .12, y + .12, .05, C('#141517'));
    const shop = nb < -.7 || na > .7;
    if (e.L > 2) {
      k.panel(k.D(shop ? 'glass' : 'matte'), e, .3, e.L - .3, gy + .2, gTop - .5, .04, shop ? C('#556776') : C('#1e1f21'));
      if (shop) for (let s = 1.6; s < e.L - .5; s += 1.6) k.panel(k.D('metal'), e, s - .04, s + .04, gy + .2, gTop - .5, .06, C('#1a1b1d'));
    }
  }
  // Courts on the podium deck: north (W 24th) roof garden with lawn and planters, south pool deck with checker tiles.
  const inside = (q: Point[]) => q.every(p => inRing(p[0], p[1], ring) && ringDist(p[0], p[1], ring) > .3);
  const quad = (a0: number, b0: number, a1: number, b1: number) => [L2W(f, a0, b0), L2W(f, a1, b0), L2W(f, a1, b1), L2W(f, a0, b1)];
  const lawn = quad(-A2 + 2, -B + 1, A2 - 2, -H - 2);
  if (inside(lawn)) k.cap(k.D(), [orient(lawn)], podiumTop + .02, C('#5d7a3c'));
  for (let i = 0; i < 4; i++) {
    const p = L2W(f, -A2 + 4 + i * (2 * A2 - 8) / 3, -H - 1.4);
    k.prism(orient(rect(p[0], p[1], f.u, 2.4, .7)), podiumTop, podiumTop + .7, C('#d9d6cf'), C('#4f6b34')); detail.planters++;
  }
  for (let a = -A2 + .5; a < A2 - 2; a += 1.5) for (let b = H + .5; b < f.hv - 1.5; b += 1.5) {
    const q = quad(a, b, a + 1.5, b + 1.5);
    if (!inside(q)) continue;
    const odd = (Math.round((a + A2) / 1.5) + Math.round(b / 1.5)) % 2 !== 0;
    k.cap(k.D(), [orient(q)], podiumTop + .02, odd ? C('#d9a98f') : C('#ece3d4')); detail.tiles++;
  }
  const pool = quad(-8, H + 4, 8, H + 11);
  if (inside(pool)) k.cap(k.D('glass'), [orient(pool)], podiumTop + .04, C('#3fa6c4'));
  return { key: t.key, name: t.name, bottom, podiumTop, roofY, topY, floors: floors + 5, plan: [ring, tower, ph], detail };
}

// ------------------------------------------------------------------------------------------------ Villas on 24th
export const VILLAS_PLAN = { podium: 16, crown: 9, storey: 3.1, bay: 2.9, corner: 2.6, crownShare: .58 };
export function buildVillas(k: Kit, t: WestCampusTower, g: G): TowerReport {
  const ring = orient(t.ring), f = frameOf(ring), V = VILLAS_PLAN;
  const bottom = groundMin(ring, g) - 1.0, podiumTop = t.baseY + V.podium, topY = t.topY, roofY = topY - V.crown;
  const white = C('#eceae4'), roofDeck = C('#d6d1c6'), crownGlass = C('#6f8791'), black = C('#141516');
  // Body: one prism (podium + tower share the outline), pool deck at roofY; glass crown over the north part.
  for (const e of edgesOf(ring)) k.wall(k.S(), e.a, e.c, bottom, roofY, white);
  const nSouth: [number, number] = [f.v[0], f.v[1]], cut = (f.c[0] * f.v[0] + f.c[1] * f.v[1]) - f.hv + 2 * f.hv * V.crownShare;
  const crown = orient(clipHalf(ring, nSouth, cut)), deck = orient(clipHalf(ring, [-nSouth[0], -nSouth[1]], -cut));
  k.cap(k.S(), [deck], roofY, roofDeck);
  for (const e of edgesOf(crown)) k.wall(k.S('glass'), e.a, e.c, roofY, topY, crownGlass);
  k.cap(k.S(), [crown], topY, C('#3b3d40'));
  const floors = Math.round((roofY - podiumTop) / V.storey), storey = (roofY - podiumTop) / floors;
  const detail = { windows: 0, fins: 0, mullions: 0, pleats: 0 };
  for (const e of edgesOf(ring)) {
    if (e.L < 3) continue;
    const gy = edgeGround(e, g), nb = e.n.x * f.v[0] + e.n.z * f.v[1], na = e.n.x * f.u[0] + e.n.z * f.u[1];
    // dark glass corner columns at both ends of every long face
    const cw = e.L > 12 ? V.corner : 0;
    if (cw) for (const [s0, s1] of [[0, cw], [e.L - cw, e.L]]) {
      k.panel(k.D('glass'), e, s0, s1, podiumTop, roofY, .04, C('#252c31'));
      for (let fl = 1; fl < floors; fl++) k.panel(k.D(), e, s0, s1, podiumTop + fl * storey - .06, podiumTop + fl * storey + .06, .06, black);
    }
    const span = e.L - 2 * cw, bays = Math.floor(span / V.bay);
    if (bays >= 1) for (let fl = 0; fl < floors; fl++) for (let j = 0; j < bays; j++) {
      const s = cw + (j + .5) * span / bays, y = podiumTop + fl * storey + .55, side = ((fl >> 1) + j) % 2 ? 1 : -1;
      k.panel(k.D('glass'), e, s - .62, s + .62, y, y + 2.05, .04, hash(j, fl, 11) < .3 ? C('#4b5a62') : C('#2c353b'));
      const f0 = side > 0 ? s + .62 : s - 1.07, f1 = f0 + .45;
      k.panel(k.D(), e, f0, f1, y - .1, y + 2.15, .07, black);
      k.panel(k.D(), e, Math.min(s - .62, f0), Math.max(s + .62, f1), y + 2.15, y + 2.4, .05, C('#c9c9c5'));
      detail.windows++; detail.fins++;
    }
    // podium: glazed lobby on the street faces (Rio Grande = west, -u; W 24th = north, -v), pleated perforated screen above
    const street = na < -.7 || nb < -.7, gTop = gy + 4.8;
    if (street) {
      k.panel(k.D('glass'), e, .4, e.L - .4, gy + .2, gTop - .4, .04, C('#56666f'));
      for (let s = 1.5; s < e.L - .4; s += 1.5) k.panel(k.D('metal'), e, s - .04, s + .04, gy + .2, gTop - .4, .06, black);
    }
    const y0 = street ? gTop : gy + .4, bands = Math.max(1, Math.round((podiumTop - .4 - y0) / 5.5)), bh = (podiumTop - .4 - y0) / bands;
    const n = Math.max(2, Math.round(e.L / 1.5)), step = e.L / n;
    for (let band = 0; band < bands; band++) {
      const ya = y0 + band * bh, yb = ya + bh;
      for (let i = 0; i < n; i++) {
        const sa = i * step, sb = sa + step, up = (i + band) % 2 === 0;
        // triangle pleats: a ridge running diagonally across each module, alternately proud (0.55 m) and flush (0.08 m)
        const A = at(e, sa, ya, .08), B = at(e, sb, ya, up ? .55 : .08), Cc = at(e, sb, yb, .08), D = at(e, sa, yb, up ? .08 : .55);
        k.D('metal').tri(A, B, Cc, C(up ? '#b8bab6' : '#8e908d'), e.n);
        k.D('metal').tri(A, Cc, D, C(up ? '#9fa19d' : '#c3c5c1'), e.n);
        detail.pleats++;
      }
    }
  }
  // crown mullions (black frame lines on the glass box) and a glass railing + pool on the deck
  for (const e of edgesOf(crown)) {
    for (let s = 1.5; s < e.L - .2; s += 1.5) { k.panel(k.D('metal'), e, s - .05, s + .05, roofY, topY, .05, black); detail.mullions++; }
    for (const y of [roofY + 3.2, roofY + 6.4, topY - .6]) k.panel(k.D('metal'), e, 0, e.L, y - .08, y + .08, .05, black);
  }
  for (const e of edgesOf(deck)) {
    const out = at(e, e.L / 2, 0, .3);
    if (!inRing(out.x, out.z, crown) && e.L > 1) {
      const lo = at(e, 0, roofY, -.15), lo2 = at(e, e.L, roofY, -.15), hi2 = at(e, e.L, roofY + 1.1, -.15), hi = at(e, 0, roofY + 1.1, -.15);
      k.D('glass').quad(lo, lo2, hi2, hi, C('#7d949c'), e.n); k.D('glass').quad(lo2, lo, hi, hi2, C('#7d949c'), e.n.clone().negate());
    }
  }
  const pc = L2W(f, 0, f.hv * .6);
  k.cap(k.D('glass'), [orient(rect(pc[0], pc[1], f.u, 9, 2.6))], roofY + .03, C('#3fa6c4'));
  return { key: t.key, name: t.name, bottom, podiumTop, roofY, topY, floors: floors + 5 + 2, plan: [ring, crown, deck], detail };
}
