// D14 (San Jacinto residences and Clark Field) authored architecture, block b07-wcp-gregory.
//
// 1. Prather Residence Hall (PHD, City 719550:1193, 1937): REPLACES the generated body (flat 14.2 m box + one hipped
//    tier) with the stepped hipped composition the LiDAR tiers and the d14 orbit captures show: a taller centre
//    pavilion (tier 20.0 m) between the long south wing (tier 14.2 m) and the north-east wing (tier 14.7 m), all red
//    tile hips at the measured 26.0 deg pitch (roofs-lidar.json 719550). Roofs are EXACT planar facets (lower envelope
//    of the eave planes, the south wing's ridge running into the pavilion wall); eave lines calibrated so the roof
//    matches the existing b07 LiDAR assertions (P50 / P95 band / max). From ut-phd-428: limestone ground storey with
//    horizontal banding and round-headed windows, upper walls brick. Storey heights, bay rhythm and the unseen
//    faces are estimates (not 1:1); the exterior steel stair in the photo is not located and not built.
// 2. Roberts (611354:699), Moore-Hill (651688:837), San Jacinto (625251:802): generated bodies stay; context.json gives
//    them the b07 archetype "b07-wcp-gregory:residence-hall" (limestone ground storey, ut-rhd-420 / ut-mhd-421 /
//    ut-sjh-399). This file ADDS limestone entry surrounds (round-headed, keystone, dark doors) where a mapped campus
//    footway meets the facade (entrance positions from campus.json, idiom from the photos). Visual relief only,
//    additive (userData.localContext). Moore-Hill stays FLAT: the 2017 LiDAR measures pitch 1.0 deg / flat tiers
//    while ut-mhd-421 shows tile at a roof edge - conflict left unresolved and reported, not overwritten.
import type { BlockInstallContext } from '../types';
import { Group, V, bays, box, cap, clipHalf, frames, pip, punchedWall, segDist, type Frame, type Opening, type P2 } from './arch-kit';

export const PHD_KEY = '719550:1193';
export const PHD_GIS: P2[] = [[209.1, 378.5], [208.9, 380.7], [207.7, 380.6], [207.8, 378.6], [203.4, 378.2], [203.0, 382.3], [208.6, 382.8], [208.1, 387.9], [206.6, 387.8], [206.7, 386.8], [193.0, 385.6], [187.8, 441.8], [200.7, 442.9], [204.1, 403.1], [205.1, 403.2], [205.9, 393.7], [207.9, 393.9], [207.8, 394.7], [218.8, 395.6], [220.2, 379.4]];
/** One hipped roof: planes from the edges of a convex `planeRing` (minus `noPlane` edges, whose ridge runs into a taller
 * neighbour), each plane = wallY + slope x inward distance from its edge line. Its facets are emitted only over the
 * convex `pieces`, which together tile the measured GIS outline; `interior` piece edges carry no wall and no eave. */
export interface RoofSource { name: string; planeRing: P2[]; wallY: number; noPlane: number[]; lidarTier: number; pieces: { ring: P2[]; interior: number[]; neighbourTop?: number }[] }
// GIS vertices (City 719550, campus.json record 1193), named by their index in PHD_GIS.
const v = (i: number) => PHD_GIS[i];
/** Points on the GIS west edge v10 -> v11 at the pavilion/wing seam (z 403.05) and at the pavilion split (z 393.7). */
const Q: P2 = [191.385, 403.05], P: P2 = [192.25, 393.7];
/** Prather: slope = tan(26.0 deg) measured; wallY = roof plane height on the wall line (calibrated to LiDAR quantiles).
 * Every exterior wall lies on a GIS edge (largest deviation 0.09 m where a 9 cm jog of the GIS outline is straightened);
 * the ~25 m2 entrance stub north-west of the wing (GIS vertices 1-5) is not built (form unseen). */
export const PHD = {
  slope: Math.tan(26.0 * Math.PI / 180), overhang: 0.75, thick: 0.3, groundStorey: 4.2, floor: 3.2,
  sources: [
    { name: 'south wing', planeRing: [Q, v(13), v(12), v(11)], wallY: 6.8, noPlane: [0], lidarTier: 14.2,
      pieces: [{ ring: [Q, v(13), v(12), v(11)], interior: [0] }] },
    { name: 'centre pavilion', planeRing: [v(10), v(9), v(14), Q], wallY: 12.6, noPlane: [], lidarTier: 20.0,
      pieces: [{ ring: [v(10), v(9), v(15), P], interior: [2] }, { ring: [P, v(15), v(14), Q], interior: [0] }] },
    { name: 'north-east wing', planeRing: [v(0), v(19), v(18), v(17), v(7), v(6)], wallY: 7.2, noPlane: [], lidarTier: 14.7,
      pieces: [{ ring: [v(0), v(19), v(18), v(17), v(7), v(6)], interior: [3] }] },
  ] as RoofSource[],
  /** Flat-roofed link between the pavilion and the wing (GIS vertices 8, 7, 16, 15), deck on the wing's wall line. */
  link: { ring: [v(8), v(7), v(16), v(15)] as P2[], interior: [1, 3], deckY: 7.2 },
};
/** Neighbour roof tops (estimates) used only to skip windows that would open into a lower neighbour. */
const LOWER_TOP: { ring: P2[]; top: number }[] = [{ ring: PHD.sources[0].pieces[0].ring, top: 10.3 }, { ring: PHD.link.ring, top: 7.4 }];

type Paths = { kind: string; points: P2[] }[];
const WALK = new Set(['footway', 'pedestrian', 'steps', 'path']);
/** Facade points where a mapped walkway line ends at (or crosses) a ring edge: [frame index, s along the edge]. */
export function entryPoints(paths: Paths, ring: P2[], maxInside = 3.5) {
  const F = frames(ring), out: { edge: number; s: number; x: number; z: number }[] = [];
  for (const p of paths) {
    if (!WALK.has(p.kind)) continue;
    for (let k = 1; k < p.points.length; k++) {
      const a = p.points[k - 1], b = p.points[k];
      F.forEach((f, ei) => {
        // Segment-edge intersection.
        const dx = b[0] - a[0], dz = b[1] - a[1], ex = f.b[0] - f.a[0], ez = f.b[1] - f.a[1], den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-9) return;
        const t = ((f.a[0] - a[0]) * ez - (f.a[1] - a[1]) * ex) / den, u = ((f.a[0] - a[0]) * dz - (f.a[1] - a[1]) * dx) / den;
        if (t < 0 || t > 1 || u < 0.08 || u > 0.92) return;
        // Only where the walkway reaches into the building (an entrance), not where it grazes a corner.
        const inside = [a, b].some(q => pip(q[0], q[1], ring) && Math.min(...F.map(g => segDist(q[0], q[1], g.a, g.b))) <= maxInside);
        if (!inside) return;
        const s = u * f.len;
        if (out.some(o => o.edge === ei && Math.abs(o.s - s) < 4)) return;
        out.push({ edge: ei, s, x: f.a[0] + f.u[0] * s, z: f.a[1] + f.u[1] * s });
      });
    }
  }
  return out;
}

/** Round-headed limestone entry surround with keystone and dark door leaves (visual relief, <= 0.22 m).
 * Door leaves and jambs start below the lowest ground under their own footprint, so their bottoms are buried; those
 * never-visible bottom caps are not emitted (they would read as low horizontal surfaces inside the footprint). */
function entrySurround(g: Group, f: Frame, s: number, gy: number, ground: (x: number, z: number) => number) {
  const stone = g.d('limestone'), door = g.d('bronze'), w = 1.8, h = 2.7, r = w / 2 + 0.35;
  const buried = (s0: number, s1: number, t1: number, depth: number) =>
    Math.min(...[[s0, 0], [s1, 0], [s0, t1], [s1, t1]].map(([ss, tt]) => ground(f.a[0] + f.u[0] * ss + f.n[0] * tt, f.a[1] + f.u[1] * ss + f.n[1] * tt))) - depth;
  box(door, f, s - w / 2, s + w / 2, 0, 0.05, Math.min(gy, buried(s - w / 2, s + w / 2, 0.05, 0.05)), gy + h, { back: true, bottom: true });
  for (const sg of [-1, 1]) {
    const j0 = s + sg * (w / 2 + 0.175) - 0.175, j1 = j0 + 0.35;
    box(stone, f, j0, j1, 0, 0.18, Math.min(gy - 0.1, buried(j0, j1, 0.18, 0.1)), gy + h, { back: true, bottom: true });
  }
  const seg = 9, yc = gy + h;
  for (let k = 0; k < seg; k++) { // voussoir ring as short boxes along the arc
    const th0 = Math.PI * k / seg, th1 = Math.PI * (k + 1) / seg, m = (th0 + th1) / 2;
    const cx = s + Math.cos(m) * (r - 0.17), cy = yc + Math.sin(m) * (r - 0.17), half = (r - 0.17) * Math.sin((th1 - th0) / 2);
    box(stone, f, cx - half, cx + half, 0, 0.16, cy - 0.17, cy + 0.17, { back: true });
  }
  box(stone, f, s - 0.18, s + 0.18, 0, 0.22, yc + r - 0.35, yc + r + 0.1, { back: true }); // keystone
  box(door, f, s - w / 2 + 0.1, s + w / 2 - 0.1, 0, 0.04, yc, yc + w / 2 - 0.05, { back: true }); // fanlight panel
}

/** Eave outline of a convex piece: the exact intersection of its edge half-planes, exterior edges pushed out by the
 * overhang, interior edges unshifted (so an overhang never crosses a seam line). */
export function eaveOutline(ring: P2[], interior: Set<number>, ov: number): P2[] {
  const xs = ring.map(q => q[0]), zs = ring.map(q => q[1]), m = 50;
  let poly: P2[] = [[Math.min(...xs) - m, Math.min(...zs) - m], [Math.max(...xs) + m, Math.min(...zs) - m], [Math.max(...xs) + m, Math.max(...zs) + m], [Math.min(...xs) - m, Math.max(...zs) + m]];
  frames(ring).forEach((f, i) => { poly = clipHalf(poly, -f.n[0], -f.n[1], f.a[0] * f.n[0] + f.a[1] * f.n[1] + (interior.has(i) ? 0 : ov)); });
  return poly;
}
/** The two ends of the outline segment lying on edge f's line shifted out by d. */
function outlineSegment(poly: P2[], f: Frame, d: number): [P2, P2] | null {
  const on = poly.filter(q => Math.abs(-((q[0] - f.a[0]) * f.n[0] + (q[1] - f.a[1]) * f.n[1]) + d) < 1e-6);
  if (on.length < 2) return null;
  const u = (q: P2) => (q[0] - f.a[0]) * f.u[0] + (q[1] - f.a[1]) * f.u[1];
  on.sort((a, b) => u(a) - u(b));
  return [on[0], on[on.length - 1]];
}

/** Plane coefficients [A, B, C] (Y = A x + B z + C) of a source. */
export function sourcePlanes(src: RoofSource, slope: number): [number, number, number][] {
  return frames(src.planeRing).filter((_, i) => !src.noPlane.includes(i)).map(f => [-slope * f.n[0], -slope * f.n[1], src.wallY + slope * (f.a[0] * f.n[0] + f.a[1] * f.n[1])]);
}

export function buildPrather(ctx: BlockInstallContext, paths: Paths) {
  const g = new Group('Prather'), stone = g.s('limestone'), brick = g.s('hallBrick'), glass = g.s('glass'), trim = g.d('limestone');
  const tile = g.s('tile'), soffit = g.s('soffit');
  const roofs: { name: string; facets: number; eaveY: number; ridgeMaxY: number; groundY: number }[] = [];
  const { slope, overhang, thick } = PHD;
  let windows = 0;
  const pieces = PHD.sources.flatMap(src => src.pieces.map(pc => ({ src, ring: pc.ring, interior: new Set(pc.interior) })));
  // Entrances where mapped walkways meet an exterior facade (computed first so ground windows keep clear of them).
  const entries: { x: number; z: number; part: string; piece: number; edge: number; s: number }[] = [];
  pieces.forEach((pc, k) => { for (const e of entryPoints(paths, pc.ring)) if (!pc.interior.has(e.edge)) entries.push({ x: +e.x.toFixed(1), z: +e.z.toFixed(1), part: pc.src.name, piece: k, edge: e.edge, s: e.s }); });
  /** Exterior walls of one convex piece from its base to `top`, limestone ground storey + brick, windows per bay. */
  const walls = (k: number, ring: P2[], interior: Set<number>, top: number, G: number, openings: boolean) => {
    const gTop = G + PHD.groundStorey;
    frames(ring).forEach((f, i) => {
      if (interior.has(i)) return;
      const base = Math.min(...[0, 0.5, 1].map(q => ctx.groundHeight(...fp2(f, f.len * q)))) - 0.4;
      const b = bays(f.len, 3.1), low: Opening[] = [], up: Opening[] = [];
      for (let j = 0; openings && j + 1 < b.length; j++) {
        const c = (b[j] + b[j + 1]) / 2;
        if (b[j + 1] - b[j] < 2.2 || c < 1.2 || c > f.len - 1.2) continue;
        const nearDoor = entries.some(d => d.piece === k && d.edge === i && Math.abs(d.s - c) < 2.6);
        // Openings below a lower neighbour's roof would open into it: skipped.
        const out = [f.a[0] + f.u[0] * c + f.n[0] * 0.6, f.a[1] + f.u[1] * c + f.n[1] * 0.6];
        const under = LOWER_TOP.find(n => n.ring !== ring && pip(out[0], out[1], n.ring))?.top ?? -Infinity;
        if (!nearDoor && G + 3.1 > under) low.push({ s0: c - 0.6, s1: c + 0.6, y0: G + 1.0, y1: G + 3.1 });
        for (let y = gTop + 0.85; y + 1.75 <= top - 1.0; y += PHD.floor) if (y > under) { up.push({ s0: c - 0.55, s1: c + 0.55, y0: y, y1: y + 1.75 }); windows++; }
        // Round head of the ground-storey window: limestone voussoir relief (visual).
        for (let q = 0; !nearDoor && G + 3.1 > under && q < 7; q++) { const th0 = Math.PI * q / 7, th1 = Math.PI * (q + 1) / 7, m = (th0 + th1) / 2, rr = 0.78, half = rr * Math.sin((th1 - th0) / 2);
          const cx = c + Math.cos(m) * rr, cy = G + 3.1 + Math.sin(m) * rr * 0.9; box(trim, f, cx - half, cx + half, 0, 0.12, cy - 0.12, cy + 0.12, { back: true }); }
      }
      punchedWall(stone, stone, glass, f, 0, f.len, base, Math.min(gTop, top), low, 0.3);
      if (top > gTop) punchedWall(brick, brick, glass, f, 0, f.len, gTop, top, up, 0.25);
      // Banded rustication of the ground storey (ut-phd-428) and a limestone string course on top of it (visual).
      for (let y = G + 0.45; y < Math.min(gTop, top) - 0.2; y += 0.6) box(trim, f, 0, f.len, 0, 0.05, y, y + 0.08, { back: true });
      if (top > gTop + 0.3) box(trim, f, 0, f.len, 0, 0.14, gTop - 0.05, gTop + 0.3, { back: true });
    });
  };
  for (const src of PHD.sources) {
    const planes = sourcePlanes(src, slope), Y = (pl: [number, number, number], x: number, z: number) => pl[0] * x + pl[1] * z + pl[2];
    const field = (x: number, z: number) => Math.min(...planes.map(pl => Y(pl, x, z)));
    let facets = 0, ridge = -Infinity, G0 = 0;
    src.pieces.forEach(pc => {
      const k = pieces.findIndex(q => q.ring === pc.ring), ring = pc.ring, interior = new Set(pc.interior);
      const G = ring.map(([x, z]) => ctx.groundHeight(x, z)).sort((a, b) => a - b)[1]; G0 = G;
      walls(k, ring, interior, src.wallY - thick, G, true);
      // Roof facets: each plane's cell (plane_i <= plane_j for all j) clipped to this piece's eave outline.
      const eave = eaveOutline(ring, interior, overhang);
      planes.forEach((pi, i) => {
        let poly = eave.slice();
        planes.forEach((pj, j) => { if (j !== i && poly.length) poly = clipHalf(poly, pj[0] - pi[0], pj[1] - pi[1], pj[2] - pi[2] + (j < i ? -1e-7 : 1e-7)); });
        if (poly.length < 3) return;
        facets++;
        for (let t = 1; t + 1 < poly.length; t++) {
          const [a, b, c] = [poly[0], poly[t], poly[t + 1]].map(q => V(q[0], Y(pi, q[0], q[1]), q[1]));
          tile.triF(a, b, c, V(0, 1, 0));
          for (const q of [a, b, c]) ridge = Math.max(ridge, q.y);
        }
      });
      // Sloped soffit under the overhang and fascia, on exterior edges only.
      frames(ring).forEach((f, i) => {
        if (interior.has(i)) return;
        const seg = outlineSegment(eave, f, overhang); if (!seg) return;
        const j = (i + 1) % ring.length, A = ring[i], B = ring[j], [ea, eb] = seg;
        const P3 = (q: P2, dy: number) => V(q[0], field(q[0], q[1]) + dy, q[1]);
        soffit.quad(P3(A, -thick), P3(B, -thick), P3(eb, -thick), P3(ea, -thick), V(0, -1, 0));
        soffit.quad(P3(ea, -thick), P3(eb, -thick), P3(eb, 0), P3(ea, 0), V(f.n[0], 0, f.n[1]));
      });
    });
    roofs.push({ name: src.name, facets, eaveY: +(src.wallY - slope * overhang).toFixed(2), ridgeMaxY: +ridge.toFixed(2), groundY: +G0.toFixed(2) });
  }
  // Link: exterior walls to the deck, flat deck on the wing's wall line.
  {
    const L = PHD.link, G = L.ring.map(([x, z]) => ctx.groundHeight(x, z)).sort((a, b) => a - b)[1];
    walls(-1, L.ring, new Set(L.interior), L.deckY, G, false);
    cap(stone, L.ring, L.deckY, true);
    roofs.push({ name: 'link (flat)', facets: 1, eaveY: L.deckY, ridgeMaxY: L.deckY, groundY: +G.toFixed(2) });
  }
  for (const e of entries) {
    const f = frames(pieces[e.piece].ring)[e.edge], gy = ctx.groundHeight(e.x + f.n[0] * 0.8, e.z + f.n[1] * 0.8);
    entrySurround(g, f, Math.min(f.len - 1.6, Math.max(1.6, e.s)), gy, ctx.groundHeight);
  }
  return { group: g, stats: { roofs, windows, entries: entries.map(({ x, z, part }) => ({ x, z, part })) } };
}
const fp2 = (f: Frame, s: number): [number, number] => [f.a[0] + f.u[0] * s, f.a[1] + f.u[1] * s];

/** Entry surrounds on the generated Roberts / Moore-Hill / San Jacinto bodies at mapped walkway entrances. */
export const HALL_ENTRY_RECORDS = [{ key: '611354:699', abbr: 'RHD' }, { key: '651688:837', abbr: 'MHD' }, { key: '625251:802', abbr: 'SJH' }] as const;
export function buildHallEntries(ctx: BlockInstallContext, paths: Paths, rings: Record<string, P2[]>) {
  const g = new Group('Residence hall entries'), log: { abbr: string; x: number; z: number; groundY: number }[] = [];
  for (const r of HALL_ENTRY_RECORDS) {
    const ring = rings[r.key]; if (!ring) continue;
    const F = frames(ring);
    for (const e of entryPoints(paths, ring)) {
      const f = F[e.edge]; if (f.len < 4) continue;
      const gy = ctx.groundHeight(e.x + f.n[0] * 0.8, e.z + f.n[1] * 0.8);
      entrySurround(g, f, Math.min(f.len - 1.6, Math.max(1.6, e.s)), gy, ctx.groundHeight);
      log.push({ abbr: r.abbr, x: +e.x.toFixed(1), z: +e.z.toFixed(1), groundY: +gy.toFixed(2) });
    }
  }
  return { group: g, stats: { entries: log } };
}

