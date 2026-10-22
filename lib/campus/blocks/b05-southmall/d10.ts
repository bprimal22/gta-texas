// D10 (Blanton and MLK frontage) authored architecture, block b05-southmall.
//
// Blanton Museum of Art: the Mari and James Michener Gallery Building (BMA, City 568540:484) and the Edgar A. Smith
// Building (BMS, City 592266:632) REPLACE the generated boxes, and the 2023 petal canopies of the Blanton Grounds
// stand in the plaza between them. Evidence:
//  - campus-10 (from MLK): round-arched arcades at the foot of both plaza facades, cream limestone walls with punched
//    windows, low hipped red tile roofs on deep timber soffits; white flared "petal" canopies on single stems.
//  - campus-11: the petals along the planted plaza walk; the BMA plaza corner opening as a tall arch; timber soffit
//    on dark beams.
//  - bms campus-12 (BMS plaza facade): arcade on round columns, two upper floors of windows with X-panels between,
//    pilasters with capitals under a deep timber eave on dark beams, the tall yellow-framed "Check In" arched portal.
//  - Measured: GIS rings (City 2023); roof heights calibrated to the LiDAR tier raster with the measured pitch
//    (roofs-lidar.json 568540 26.4 deg, 592266 26.3 deg): BMA wall line Y 11.4, crown 19.3; BMS 9.6 / 18.6.
//  - Mapped footways run under both plaza arcades (BMS up to 2.9 m, BMA up to 10.5 m inside the GIS rings), so the
//    plaza loggias are 4.5 m (BMS) and 11.5 m (BMA) deep and open at both ends (the corner arch of campus-11).
//  - Estimates: storey heights, bay module 4.6 m, the facades away from the plaza (unseen: same idiom), the portal
//    bay position, and every petal's position/size (photos only; 2023, after the 2017 LiDAR). Not 1:1.
import * as THREE from 'three';
import type { BlockInstallContext } from '../types';
import { Group, V, archBay, bays, box, cap, cylinder, fp, frames, hipRoof, lathe, offsetConvex, punchedWall, rect, type Frame, type Opening, type P2 } from './arch-kit';

export const BMA_KEY = '568540:484', BMS_KEY = '592266:632';
export interface HallSpec {
  name: string; key: string; ring: P2[]; G: number; Ya: number; wallY: number; crownY: number; slope: number; overhang: number; thick: number;
  loggia: { edge: number; depth: number }; floors: { sill: number; head: number }[]; xPanels: boolean; portalBay?: number;
}
export const BMA_SPEC: HallSpec = {
  name: 'Blanton BMA', key: BMA_KEY, ring: [[-62.5, 522.49], [-68.32, 591.03], [-9.13, 607.56], [12.96, 528.9]],
  G: -4.6, Ya: 1.6, wallY: 11.4, crownY: 19.3, slope: 0.496, overhang: 2.2, thick: 0.35,
  loggia: { edge: 0, depth: 11.5 }, floors: [{ sill: 1.1, head: 3.6 }, { sill: 5.6, head: 8.1 }], xPanels: false,
};
export const BMS_SPEC: HallSpec = {
  name: 'Blanton BMS', key: BMS_KEY, ring: [[-71.64, 523.2], [-113.67, 519.33], [-118.96, 576.56], [-88.67, 584.88]],
  G: -4.0, Ya: 1.8, wallY: 9.6, crownY: 18.6, slope: 0.494, overhang: 2.2, thick: 0.35,
  loggia: { edge: 3, depth: 4.5 }, floors: [{ sill: 0.7, head: 2.7 }, { sill: 4.55, head: 6.4 }], xPanels: true, portalBay: 2,
};
const BAY = 4.6, CP = 0.9, COL = 0.4, BAND = 0.7, WIN = 1.7;

export function buildHall(ctx: BlockInstallContext, h: HallSpec) {
  const g = new Group(h.name), ring = h.ring, F = frames(ring), n = ring.length, k = h.loggia.edge;
  const stone = g.s('blantonStone'), glass = g.s('glass'), trim = g.d('blantonStone'), beams = g.d('steel'), gold = g.d('gold');
  const gnd = (p: THREE.Vector3) => ctx.groundHeight(p.x, p.z);
  const baseOf = (f: Frame, s0: number, s1: number) => Math.min(...[s0, (s0 + s1) / 2, s1].map(s => gnd(fp(f, s, 0, 0)))) - 0.4;
  const inner = offsetConvex(ring, i => (i === k ? -h.loggia.depth : 0)), Pa = inner[k], Pb = inner[(k + 1) % n];
  const prev = (k + n - 1) % n, next = (k + 1) % n;
  const proj = (f: Frame, p: P2) => (p[0] - f.a[0]) * f.u[0] + (p[1] - f.a[1]) * f.u[1];
  const sPa = proj(F[prev], Pa), sPb = proj(F[next], Pb);
  const top = h.wallY - h.thick, stats = { columns: 0, arches: 0, windows: 0, portal: false };
  // One arcade run on frame f over [a, b] (both ends on piers): columns on interior bay lines, round arches between.
  const arcade = (f: Frame, a: number, b: number, portal?: number, piers: [boolean, boolean] = [true, true]) => {
    const bb = bays(b - a - 2 * CP, BAY).map(x => x + a + CP), clear = (bb[1] - bb[0]) - COL;
    const ys = h.Ya - 0.55 - clear / 2;
    for (let j = 1; j + 1 < bb.length; j++) {
      const c = fp(f, bb[j], -BAND / 2, 0), y0 = gnd(c) - 0.3;
      cylinder(stone, c.x, c.z, COL, y0, ys - 0.35, 14);
      box(stone, f, bb[j] - 0.48, bb[j] + 0.48, -BAND / 2 - 0.48, -BAND / 2 + 0.48, ys - 0.35, ys, { top: true });
      stats.columns++;
    }
    for (let j = 0; j + 1 < bb.length; j++) {
      const lo = bb[j] + (j === 0 ? 0 : COL), hi = bb[j + 1] - (j + 2 === bb.length ? 0 : COL), r = (hi - lo) / 2;
      archBay(stone, f, j === 0 ? a : bb[j], j + 2 === bb.length ? b : bb[j + 1], (lo + hi) / 2, r, ys, h.Ya, 0, BAND);
      stats.arches++;
      if (portal === j) {
        // "Check In" portal: the arch glazed and framed in gold, its bay glazed up to just under the eave.
        const yb = gnd(fp(f, (lo + hi) / 2, 0, 0));
        rect(glass, f, lo, hi, -BAND / 2, yb, ys + r);
        for (const s of [lo, hi - 0.22]) box(gold, f, s, s + 0.22, -0.02, 0.12, yb, ys);
        stats.portal = true;
      }
    }
    // Piers at both ends (corner / loggia-end), carrying the band.
    // (Their inner faces look into the building and are omitted.)
    ([[a, a + CP], [b - CP, b]] as const).forEach(([p0, p1], e) => { if (piers[e]) box(stone, f, p0, p1, -CP, 0, baseOf(f, p0, p1), ys, { top: true, bottom: true, back: !(piers[0] && piers[1]) }); });
    return { bb, ys };
  };
  // Ground storey.
  let kBays: number[] = [];
  F.forEach((f, i) => {
    if (i === k) { kBays = arcade(f, 0, f.len, h.portalBay).bb; return; }
    let lo = 0, hi = f.len;
    // Loggia ends: the inner pier stands just outside the opening (behind the inner wall line), so the opening is the
    // full loggia depth; the corner pier is the arcade edge's own (not duplicated).
    if (i === prev) { arcade(f, sPa - CP, f.len, undefined, [true, false]); hi = sPa - CP; }
    if (i === next) { arcade(f, 0, sPb + CP, undefined, [false, true]); lo = sPb + CP; }
    if (hi - lo > 0.05) punchedWall(stone, stone, glass, f, lo, hi, baseOf(f, lo, hi), h.Ya, [], 0.3);
  });
  // Inner loggia wall (storefronts, one per bay) and the loggia ceiling.
  {
    const fi = frames(inner)[k], b = bays(fi.len, BAY), open: Opening[] = [];
    for (let j = 0; j + 1 < b.length; j++) {
      const c = (b[j] + b[j + 1]) / 2, y0 = gnd(fp(fi, c, 0.5, 0)) + 0.03;
      if (y0 + 2.6 < h.Ya - 0.6) open.push({ s0: c - 1.3, s1: c + 1.3, y0, y1: Math.min(h.Ya - 0.6, y0 + 3.6) });
    }
    punchedWall(stone, stone, glass, fi, 0, fi.len, baseOf(fi, 0, fi.len), h.Ya, open, 0.25);
    cap(g.s('blantonStone'), [ring[k], ring[next], Pb, Pa], h.Ya, false);
  }
  // Upper storeys on every edge: windows per bay per floor (the arcade edge follows the arcade bays).
  F.forEach((f, i) => {
    const b = i === k ? kBays : bays(f.len, BAY), open: Opening[] = [];
    for (let j = 0; j + 1 < b.length; j++) {
      const c = (b[j] + b[j + 1]) / 2;
      if (i === k && h.portalBay === j) { open.push({ s0: c - 1.1, s1: c + 1.1, y0: h.Ya + 0.25, y1: top - 1.05 }); continue; }
      if (b[j + 1] - b[j] < WIN + 0.8) continue;
      for (const fl of h.floors) { open.push({ s0: c - WIN / 2, s1: c + WIN / 2, y0: h.Ya + fl.sill, y1: Math.min(top - 1.0, h.Ya + fl.head) }); stats.windows++; }
    }
    punchedWall(stone, stone, glass, f, 0, f.len, h.Ya, top, open, 0.35);
    if (i === k && h.portalBay !== undefined) {
      const c = (b[h.portalBay] + b[h.portalBay + 1]) / 2;
      for (const s of [c - 1.35, c + 1.1]) box(gold, f, s, s + 0.25, 0, 0.14, h.Ya, top - 0.8);
      box(gold, f, c - 1.35, c + 1.35, 0, 0.14, top - 1.05, top - 0.8);
    }
    // Pilasters on bay lines with capital blocks under the eave, string course at the arcade top (visual relief).
    for (let j = 1; j + 1 < b.length; j++) {
      box(trim, f, b[j] - 0.36, b[j] + 0.36, 0, 0.14, h.Ya, top - 0.55, { back: true });
      box(trim, f, b[j] - 0.5, b[j] + 0.5, 0, 0.26, top - 0.55, top, { back: true });
    }
    box(trim, f, 0, f.len, 0, 0.12, h.Ya - 0.05, h.Ya + 0.3, { back: true });
    // X-panels between the floors (BMS, campus-12): recessed-look panel with two diagonal ribs.
    if (h.xPanels) for (let j = 0; j + 1 < b.length; j++) {
      if (i === k && h.portalBay === j) continue;
      const c = (b[j] + b[j + 1]) / 2, y0 = h.Ya + h.floors[0].head + 0.45, y1 = h.Ya + h.floors[1].sill - 0.35;
      if (y1 - y0 < 0.4 || b[j + 1] - b[j] < WIN + 0.8) continue;
      box(trim, f, c - WIN / 2, c + WIN / 2, 0, 0.05, y0, y1, { back: true });
      for (const sg of [1, -1]) {
        const p = (s: number, y: number) => fp(f, c + sg * s, 0.09, y), w = 0.07;
        trim.quad(p(-WIN / 2 + 0.1, y0 + 0.08), p(-WIN / 2 + 0.1 + w, y0 + 0.08), p(WIN / 2 - 0.1, y1 - 0.08), p(WIN / 2 - 0.1 - w, y1 - 0.08), V(f.n[0], 0, f.n[1]));
      }
    }
    // Dark beams under the timber soffit on the bay lines (visual, 0.26 m deep).
    for (let j = 0; j < b.length; j++) {
      const s = Math.min(f.len - 0.12, Math.max(0.12, b[j])), y = (t: number) => h.wallY - h.thick - h.slope * t;
      const P = (ds: number, t: number, dy: number) => fp(f, s + ds, t, y(t) + dy), L = h.overhang - 0.15;
      beams.quad(P(-0.11, 0, -0.26), P(0.11, 0, -0.26), P(0.11, L, -0.26), P(-0.11, L, -0.26), V(0, -1, 0));
      for (const sg of [-1, 1]) beams.quad(P(0.11 * sg, 0, 0), P(0.11 * sg, L, 0), P(0.11 * sg, L, -0.26), P(0.11 * sg, 0, -0.26), V(f.u[0] * sg, 0, f.u[1] * sg));
    }
  });
  const roof = hipRoof(g.s('tile'), g.s('soffitWood'), g.s('soffitWood'), ring, { wallY: h.wallY, slope: h.slope, overhang: h.overhang, crownY: h.crownY, thick: h.thick });
  return { group: g, roof, stats: { ...stats, roofFacets: roof.facets, eaveY: +roof.eaveY.toFixed(2), wallY: h.wallY, crownY: h.crownY, loggiaDepth: h.loggia.depth, arcadeTopY: h.Ya } };
}

/** Petal canopies (Blanton Grounds, 2023). Positions/sizes are estimates fitted to campus-10/11 and solved to keep
 * every stem >= 1.6 m from mapped footways, every rim >= 0.6 m from the BMA/BMS walls and >= 8 m + R from the MLK
 * centreline. Rim height H above the local ground, rim radius R. */
export const PETALS: { x: number; z: number; R: number; H: number }[] = [
  { x: -78.5, z: 592.5, R: 4.6, H: 10.8 }, { x: -68.5, z: 596.0, R: 4.0, H: 10.2 }, { x: -88.0, z: 594.0, R: 3.8, H: 9.6 },
  { x: -74.5, z: 580.5, R: 3.6, H: 9.2 }, { x: -72.5, z: 566.5, R: 3.2, H: 8.6 }, { x: -75.0, z: 554.0, R: 3.0, H: 8.2 },
  { x: -69.5, z: 542.5, R: 2.8, H: 7.8 }, { x: -67.0, z: 531.5, R: 2.4, H: 7.2 },
];
export const PETAL_STEM = { r0: 0.34, r1: 0.27, flareFrom: 0.45, power: 2.4 } as const;
/** Analytic petal radius at height y above local ground (profile used for the lathe; harness checks the built shell). */
export const petalRadius = (p: { R: number; H: number }, h: number) => {
  const y0 = PETAL_STEM.flareFrom * p.H; if (h <= y0) return PETAL_STEM.r1;
  const k = Math.min(1, (h - y0) / (p.H - y0)); return PETAL_STEM.r1 + (p.R - PETAL_STEM.r1) * Math.pow(k, PETAL_STEM.power);
};
export function buildPetals(ctx: BlockInstallContext) {
  const g = new Group('Blanton petals'), shell = g.s('petal'), placed: { x: number; z: number; R: number; H: number; groundY: number; rimY: number }[] = [];
  PETALS.forEach((p, i) => {
    const gy = ctx.groundHeight(p.x, p.z), y0 = gy + PETAL_STEM.flareFrom * p.H, prof: [number, number][] = [[PETAL_STEM.r0, gy - 0.3], [0.3, gy + 0.8], [PETAL_STEM.r1, y0]];
    for (let q = 1; q <= 18; q++) { const k = q / 18, h = PETAL_STEM.flareFrom * p.H + (p.H - PETAL_STEM.flareFrom * p.H) * k; prof.push([petalRadius(p, h), gy + h]); }
    lathe(shell, p.x, p.z, prof, 44, { k: 4, amp: 0.06, phase: i * 0.7, from: 0.75 });
    placed.push({ ...p, groundY: +gy.toFixed(2), rimY: +(gy + p.H).toFixed(2) });
  });
  return { group: g, stats: { petals: placed } };
}
