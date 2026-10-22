// D08 (South Mall, HRC and Dobie) authored architecture, block b05-southmall.
//
// 1. Harry Ransom Center (HRC, City 653897:869, UT GIS OBJECTID 570): REPLACES the generated box. Evidence: UT
//    directory photo ut-hrc-570 (expressed square stone piers carrying the upper mass, a glazed ground storey set
//    back behind them, narrow vertical slot windows, a heavy projecting cornice). Measured: GIS ring (City 2023),
//    roof deck = LiDAR tier 31.4 m above groundY 9.8 = campus Y 41.2 (roofs-lidar.json; r3 P50 41.15). Estimates:
//    ground storey 6.2 m, five upper floors, pier module ~6.4 m, colonnade depth 4.2 m (deep enough that the mapped
//    entrance footways reaching 3.6 m inside the GIS ring stay open), cornice projection 1.3 m. The unseen north and
//    west elevations repeat the photographed module (estimate, not 1:1).
// 2. Batts / Mezes / Benedict (City 714471:1095, generated from b05 massing): ADDITIVE on the generated hipped tile
//    roofs. Dormers on the long exterior tile slopes (seen in the d08 orbit captures; count/spacing estimated),
//    a stone cornice band under the generated eave, and on the three mall (west) end elevations the central
//    entrance surround, stone balcony on corbels with railing and rusticated corner quoins (ut-mez-553,
//    ut-ben-559), plus Benedict's ridge ventilator (ut-ben-559). Roof heights replicate the generator's own hip
//    function (context/architecture.ts hipRoof) for the measured b05 massing, so dormers sit on the rendered roof.
import * as THREE from 'three';
import ctxData from './context.json' with { type: 'json' };
import { CATALOG } from '../../context/catalog';
import { hipRise } from '../../context/massing';
import { offsetRing, distanceToRings } from '../../context-geometry';
import type { BlockInstallContext } from '../types';
import { Group, V, box, bays, cap, edgeDist, fp, frames, offsetConvex, pip, punchedWall, rect, walkSegments, type Frame, type P2 } from './arch-kit';

export const HRC_KEY = '653897:869';
/** City footprint 653897 (campus.json record 869), closing vertex dropped. */
export const HRC_RING: P2[] = [[-415.0, 159.12], [-420.62, 224.26], [-361.2, 229.23], [-355.74, 163.9]];
export const HRC = {
  groundY: 9.8, deckY: 41.2, soffitY: 16.0, corniceBottomY: 39.4, parapetY: 42.1,
  loggiaDepth: 4.2, corniceOut: 1.3, parapetIn: 0.45, pier: 1.2, pierDepth: 1.4, module: 6.4, floors: 5,
} as const;

export function buildHrc(ctx: BlockInstallContext) {
  const g = new Group('HRC'), ring = HRC_RING, F = frames(ring);
  const stone = g.s('hrcStone'), glass = g.s('glass'), slab = g.s('concrete'), trim = g.d('hrcStone'), mull = g.d('steel');
  const base = (pts: P2[]) => Math.min(...pts.map(([x, z]) => ctx.groundHeight(x, z))) - 0.4;
  const inner = offsetConvex(ring, -HRC.loggiaDepth);
  const floorH = (HRC.corniceBottomY - HRC.soffitY) / HRC.floors;
  let piers = 0, slots = 0, piersLeftOpen = 0;
  // A pier is left out where a mapped walkway passes within 0.9 m of it (entrances into the colonnade stay open).
  const walk = walkSegments((ctx.data as unknown as { paths: { kind: string; points: P2[] }[] }).paths, -430, -345, 150, 240);
  F.forEach((f, i) => {
    const b = bays(f.len, HRC.module);
    // Ground storey piers on the GIS line: a corner pier at the start of every edge (it closes the corner for the
    // previous edge too), then one centred on every interior module line.
    for (let k = 0; k + 1 < b.length; k++) {
      const s0 = k === 0 ? 0 : b[k] - HRC.pier / 2, s1 = k === 0 ? HRC.pier + 0.1 : b[k] + HRC.pier / 2;
      const c = fp(f, (s0 + s1) / 2, -HRC.pierDepth / 2, 0);
      if (walk(c.x, c.z) < 0.9 + Math.hypot(s1 - s0, HRC.pierDepth) / 2) { piersLeftOpen++; continue; }
      const y0 = base([fp2s(f, s0), fp2s(f, s1)]);
      box(stone, f, s0, s1, -HRC.pierDepth, 0, y0, HRC.soffitY, { top: true, bottom: true });
      piers++;
    }
    // Recessed glazed ground storey (glass on the inset line) with steel mullions every ~1.6 m.
    const gi = { a: inner[i], b: inner[(i + 1) % ring.length] }, gf = frames(inner)[i];
    const gy0 = base([gi.a, gi.b]);
    rect(glass, gf, 0, gf.len, 0, gy0, HRC.soffitY);
    for (const s of bays(gf.len, 1.6).slice(1, -1)) box(mull, gf, s - 0.05, s + 0.05, 0, 0.14, gy0 + 0.4, HRC.soffitY, { bottom: true, top: true, back: true });
    box(mull, gf, 0, gf.len, 0, 0.12, gy0 + 0.4 + 2.8, gy0 + 0.4 + 2.95, { back: true }); // transom
    // Colonnade soffit (underside of the upper mass) between the GIS line and the glass line.
    slab.quad(V(ring[i][0], HRC.soffitY, ring[i][1]), V(ring[(i + 1) % 4][0], HRC.soffitY, ring[(i + 1) % 4][1]),
      V(gi.b[0], HRC.soffitY, gi.b[1]), V(gi.a[0], HRC.soffitY, gi.a[1]), V(0, -1, 0));
    // Upper mass: stone wall on the GIS line with paired narrow slot windows per module on every floor.
    const open: { s0: number; s1: number; y0: number; y1: number }[] = [];
    for (let k = 0; k + 1 < b.length; k++) {
      const c = (b[k] + b[k + 1]) / 2;
      for (let fl = 0; fl < HRC.floors; fl++) {
        const y0 = HRC.soffitY + fl * floorH + 0.95, y1 = y0 + Math.min(2.9, floorH - 1.4);
        for (const d of [-1.05, 1.05]) { open.push({ s0: c + d - 0.4, s1: c + d + 0.4, y0, y1 }); slots++; }
      }
    }
    punchedWall(stone, stone, glass, f, 0, f.len, HRC.soffitY, HRC.corniceBottomY, open, 0.45);
    // Pilaster strips continuing the piers up the upper mass (0.15 m relief, visual).
    for (let k = 1; k + 1 < b.length; k++) box(trim, f, b[k] - 0.45, b[k] + 0.45, 0, 0.15, HRC.soffitY, HRC.corniceBottomY, { back: true });
  });
  // Cornice: projecting block wrapping the whole ring, its top continuing inward as the parapet; roof deck behind.
  const out = offsetConvex(ring, HRC.corniceOut), par = offsetConvex(ring, -HRC.parapetIn), Fo = frames(out), Fp = frames(par);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    rect(stone, Fo[i], 0, Fo[i].len, 0, HRC.corniceBottomY, HRC.parapetY);
    stone.quad(V(ring[i][0], HRC.corniceBottomY, ring[i][1]), V(ring[j][0], HRC.corniceBottomY, ring[j][1]), V(out[j][0], HRC.corniceBottomY, out[j][1]), V(out[i][0], HRC.corniceBottomY, out[i][1]), V(0, -1, 0));
    stone.quad(V(out[i][0], HRC.parapetY, out[i][1]), V(out[j][0], HRC.parapetY, out[j][1]), V(par[j][0], HRC.parapetY, par[j][1]), V(par[i][0], HRC.parapetY, par[i][1]), V(0, 1, 0));
    rect(stone, Fp[i], 0, Fp[i].len, 0, HRC.deckY, HRC.parapetY, -1);
    // Cornice fascia reveal line (visual groove band, 0.12 m relief).
    box(trim, Fo[i], 0, Fo[i].len, 0, 0.12, HRC.corniceBottomY + 0.9, HRC.corniceBottomY + 1.15, { back: true, left: true, right: true });
  }
  cap(g.s('concrete'), par, HRC.deckY, true);
  return { group: g, stats: { piers, piersLeftOpenForMappedWalkways: piersLeftOpen, slotWindows: slots, deckY: HRC.deckY, parapetY: HRC.parapetY, loggiaDepth: HRC.loggiaDepth, floors: HRC.floors } };
}
const fp2s = (f: Frame, s: number): P2 => [f.a[0] + f.u[0] * s, f.a[1] + f.u[1] * s];

// ---------- Batts / Mezes / Benedict additions on the generated roofs ----------
export const SIXPACK_KEY = '714471:1095';
const SIX_NAMES = ['BAT', 'MEZ north bar', 'MEZ south bar', 'MEZ west wing', 'BEN'];
/** Pieces with a mall (west) end elevation: BAT, MEZ west wing, BEN. */
const WEST_ENDS = new Set([0, 3, 4]);

/** Remove consecutive vertices closer than 0.25 m (the City union has 1-10 cm slivers). */
export function clean(r: P2[]): P2[] {
  const out: P2[] = [];
  for (const p of r) if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > 0.25) out.push(p);
  if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 0.25) out.pop();
  return out;
}

type MassVol = { ring: P2[]; top: number; roof: 'hip-tile' | 'flat'; slope: number };
/** The generator's hipped roof over one massing volume (architecture.ts hipRoof + deckOf), in campus Y. */
export function generatedHip(vol: MassVol, heightBase: number, overhang: number) {
  const rings = [vol.ring as [number, number][]];
  const rise = hipRise(rings, vol.roof, vol.slope, overhang);
  const eaveTop = heightBase + vol.top - rise, roofBase = eaveTop + 0.22, eave = rings.map(r => offsetRing(r, overhang));
  return { rise, eaveTop, roofBase, ridgeY: roofBase + rise, y: (x: number, z: number) => roofBase + Math.min(rise, vol.slope * distanceToRings(x, z, eave)) };
}

export function buildSixPack(ctx: BlockInstallContext) {
  const g = new Group('Batts-Mezes-Benedict');
  const m = (ctxData as unknown as { massing: Record<string, { datum: { aboveY: number }; volumes: MassVol[] }> }).massing['714471'];
  const hb = m.datum.aboveY, overhang = Math.max(0.35, CATALOG.archetypes['cret-core'].overhang || 0.5);
  const pieces = m.volumes.map(v => ({ v, ring: clean(v.ring), hip: generatedHip(v, hb, overhang) }));
  const tile = g.s('tile'), stone = g.s('mallStone'), glass = g.s('glass'), trim = g.d('mallStone'), rail = g.d('steel');
  const insideOther = (x: number, z: number, self: number) => pieces.some((p, k) => k !== self && pip(x, z, p.ring));
  const stats = { dormers: 0, skippedDormers: 0, balconies: 0, vent: 0, corniceRuns: 0, maxDormerSeat: 0 };
  const dormerLog: { piece: string; x: number; z: number; seatY: number; ridgeY: number }[] = [];
  pieces.forEach((p, k) => {
    const F = frames(p.ring), slope = p.v.slope;
    F.forEach(f => {
      if (f.len < 1.0) return;
      const mid = fp(f, f.len / 2, 1.5, 0);
      if (insideOther(mid.x, mid.z, k)) return; // shared wall between pieces
      // Stone cornice band under the generated eave soffit (visual trim, 0.22 m relief).
      box(trim, f, 0, f.len, 0, 0.22, p.hip.eaveTop - 0.5, p.hip.eaveTop - 0.04, { back: true });
      stats.corniceRuns++;
      // Dormers on long exterior slopes, clear of the hips (>= 6.5 m from the edge ends).
      if (f.len >= 16) {
        const dF = 0.7, w = 1.75, hF = 1.55, gable = 0.55, positions: number[] = [];
        const span = f.len - 13, n = Math.max(1, Math.floor(span / 5.5) + 1);
        for (let q = 0; q < n; q++) positions.push(6.5 + (n === 1 ? span / 2 : (q * span) / (n - 1)));
        for (const c of positions) {
          const dR = dF + (hF + gable) / slope + 0.3;
          // Valid only where this edge's roof plane is the generated surface (not a hip, not the crown).
          const exp = (s: number, d: number) => p.hip.roofBase + slope * (overhang + d);
          const probe: [number, number][] = [[c - w / 2 - 0.2, dF], [c + w / 2 + 0.2, dF], [c, dR], [c - w / 2 - 0.2, dR], [c + w / 2 + 0.2, dR]];
          const ok = probe.every(([s, d]) => { const pt = fp(f, s, -d, 0); return pip(pt.x, pt.z, p.ring) && Math.abs(p.hip.y(pt.x, pt.z) - exp(s, d)) < 0.04 && exp(s, d) < p.hip.ridgeY - 0.1; });
          if (!ok) { stats.skippedDormers++; continue; }
          const Y0 = exp(c, dF), ye = Y0 + hF, yr = ye + gable, dB = dF + hF / slope;
          punchedWall(stone, stone, glass, f, c - w / 2, c + w / 2, Y0 - 0.05, ye, [{ s0: c - 0.45, s1: c + 0.45, y0: Y0 + 0.22, y1: Y0 + 1.4 }], 0.14, -dF);
          stone.triF(fp(f, c - w / 2, -dF, ye), fp(f, c + w / 2, -dF, ye), fp(f, c, -dF, yr), V(f.n[0], 0, f.n[1]));
          for (const sg of [-1, 1]) {
            const s = c + sg * w / 2;
            stone.triF(fp(f, s, -dF, Y0 - 0.05), fp(f, s, -dF, ye), fp(f, s, -dB, ye), V(f.u[0] * sg, 0, f.u[1] * sg));
            const se = c + sg * (w / 2 + 0.15), dE = dF + (hF - 0.05) / slope;
            tile.quad(fp(f, se, -dF + 0.25, ye - 0.05), fp(f, c, -dF + 0.25, yr), fp(f, c, -(dF + (yr - Y0) / slope), yr), fp(f, se, -dE, ye - 0.05),
              V(f.u[0] * sg, 1, f.u[1] * sg));
          }
          const at = fp(f, c, -dF, Y0);
          dormerLog.push({ piece: SIX_NAMES[k], x: +at.x.toFixed(2), z: +at.z.toFixed(2), seatY: +Y0.toFixed(2), ridgeY: +yr.toFixed(2) });
          stats.dormers++;
        }
      }
    });
    // Mall end elevation: entrance surround, balcony on corbels with railing, corner quoins.
    if (WEST_ENDS.has(k)) {
      const ends = F.map((f, i) => ({ f, i })).filter(({ f }) => f.len > 10 && !insideOther(...centerOut(f), k));
      const { f } = ends.reduce((a, b) => (b.f.n[0] < a.f.n[0] ? b : a));
      const c = f.len / 2, mp = fp(f, c, 1.0, 0), gy = ctx.groundHeight(mp.x, mp.z);
      box(trim, f, c - 1.5, c - 1.1, 0, 0.18, gy - 0.2, gy + 3.6, { back: true });
      box(trim, f, c + 1.1, c + 1.5, 0, 0.18, gy - 0.2, gy + 3.6, { back: true });
      box(trim, f, c - 1.5, c + 1.5, 0, 0.22, gy + 3.6, gy + 4.1, { back: true });
      const by = gy + 4.6; // balcony slab top at the second floor
      box(stone, f, c - 2.6, c + 2.6, 0, 1.1, by - 0.3, by, { back: true });
      for (const s of [c - 2.1, c, c + 2.1]) box(stone, f, s - 0.18, s + 0.18, 0, 0.9, by - 0.85, by - 0.3, { back: true, top: true });
      for (const s of [c - 2.5, c - 1.25, c, c + 1.25, c + 2.5]) box(rail, f, s - 0.03, s + 0.03, 0.98, 1.04, by, by + 1.0, { bottom: true });
      box(rail, f, c - 2.55, c + 2.55, 0.96, 1.06, by + 1.0, by + 1.06, {});
      for (const sg of [-1, 1]) box(rail, f, sg < 0 ? c - 2.55 : c + 2.49, sg < 0 ? c - 2.49 : c + 2.55, 0, 1.06, by + 1.0, by + 1.06, {});
      stats.balconies++;
      for (const [s0, s1] of [[0, 1], [f.len - 1, f.len]] as const) {
        for (let y = gy, q = 0; y + 0.36 < p.hip.eaveTop - 0.6; y += 0.42, q++) {
          const wd = q % 2 ? 0.55 : 0.95, a = s0 === 0 ? 0 : f.len - wd, b = s0 === 0 ? wd : f.len;
          box(trim, f, a, b, 0, 0.08, y, y + 0.36, { back: true });
        }
        void s1;
      }
    }
  });
  // Benedict ridge ventilator (ut-ben-559): box on the ridge in the west third, small pyramid tile cap.
  {
    const p = pieces[4], F = frames(p.ring), long = F.reduce((a, b) => (b.len > a.len ? b : a));
    let best = { x: 0, z: 0, y: -Infinity };
    for (let s = long.len * 0.15; s < long.len * 0.45; s += 0.5) for (let d = 2; d < 12; d += 0.25) {
      const pt = fp(long, s, -d, 0); if (!pip(pt.x, pt.z, p.ring)) continue;
      const y = p.hip.y(pt.x, pt.z); if (y > best.y + 1e-3 || (Math.abs(y - best.y) < 1e-3 && Math.abs(s - long.len * 0.3) < 0.5)) best = { x: pt.x, z: pt.z, y };
    }
    const vf: Frame = { a: [best.x, best.z], b: [best.x + long.u[0], best.z + long.u[1]], u: long.u, n: long.n, len: 1 };
    const corners = [[-0.85, -0.85], [0.85, -0.85], [0.85, 0.85], [-0.85, 0.85]].map(([s, t]) => fp(vf, s, t, 0));
    const y0 = Math.min(...corners.map(c => p.hip.y(c.x, c.z))) - 0.05, y1 = p.hip.ridgeY + 1.1;
    box(stone, vf, -0.85, 0.85, -0.85, 0.85, y0, y1, { top: true, bottom: true });
    const apex = V(best.x, y1 + 0.55, best.z), eaveC = [[-1.05, -1.05], [1.05, -1.05], [1.05, 1.05], [-1.05, 1.05]].map(([s, t]) => fp(vf, s, t, y1));
    for (let q = 0; q < 4; q++) tile.triF(eaveC[q], eaveC[(q + 1) % 4], apex, V(0, 1, 0));
    stone.quad(eaveC[0], eaveC[1], eaveC[2], eaveC[3], V(0, -1, 0));
    stats.vent = 1;
  }
  stats.maxDormerSeat = dormerLog.length ? Math.max(...dormerLog.map(d => d.seatY)) : 0;
  return { group: g, stats, dormers: dormerLog, pieces: pieces.map((p, k) => ({ name: SIX_NAMES[k], eaveTop: +p.hip.eaveTop.toFixed(2), ridgeY: +p.hip.ridgeY.toFixed(2) })) };
}
const centerOut = (f: Frame): [number, number] => { const p = fp(f, f.len / 2, 1.5, 0); return [p.x, p.z]; };

export const _d08 = { edgeDist, THREE };
