// D30 / b13: Scottish Rite Dormitory, 210 W 27th St (City record 677852:991; 1922 red-brick women's residence).
// Evidence (research/whole-campus-92/district-agents-40/packets/D30.json; work in .work/derived-b13):
//  * plan: the FROZEN City 2023 ring unchanged. In the building frame (axis atan2(5.5, 52.97) = 5.93 deg, s along the
//    27th-Street bar, t across) the ring is rectilinear: west / east N-S wings (12.6 m), the E-W bar between them (12 m),
//    short end stubs and a south-centre annex (12.7 x 26 m);
//  * roof (MEASURED, 2017 USGS 3DEP 0.5 m class-6 raster sampled per plan section, inset 0.6 m; cross-sections every
//    metre): wings hipped at the frozen massing slope 0.723 with eave 31.35 / ridge 35.9 (raster wing P10 32.2,
//    ridge-line median 35.8 W / 35.45 E); the bar hipped eave 34.76 / ridge 39.1 (raster bar P10 34.1-34.5, ridge-line
//    median 39.11 - the frozen record massing summarises the whole ring as one hip with top 38.42, raster P95 of the
//    WHOLE ring); flat-topped crossing pavilions where the bar meets the wings (eave 33.4, plateau 35.95; cross-section
//    35.8-36.1 flat); hipped end stubs (raster P10/P50 31.99/32.94 and 21.4/32.53; capped at the crossing eave 33.4 so stub and pavilion meet without a sub-metre step); the annex flat at 26.04 (raster P50)
//    with a 1.4 m central monitor (residual cluster s -291..-290, 27.4). Exact planar faces (roof.ts);
//  * dormers: residual clusters 2-3 m above the planar model, spaced ~5 m on both wing slopes and the north hip ends,
//    five on the bar's south slope (tops 38.0) and full-depth dormers on its north slope (tops 39.2, modelled to 38.9 so
//    they die into the plane below the ridge); gabled form from the d30 SW / SE orbit frames (white gabled dormers on
//    slate-grey roofs). Widths are cluster extents (estimates +-0.5 m); hidden north-slope dormer form is assumed;
//  * chimneys: residual maxima (40.4 on the bar ridge, 40.2 / 39.5 at the bar's south wall by the annex, 38.4 / 38.9 on
//    the crossings) as brick stacks; the d30 SE frame shows tall brick stacks rising along walls;
//  * facades reference-interpreted from the d30 SW / SE / NW frames: red brick, limestone base course, belt course and
//    cornice, white-framed sash windows in regular bays, tall windows on the annex. Storey heights and bay spacing are
//    ESTIMATES (no measured elevation); the annex's arched heads are drawn as rectangular recesses.
//  Not modelled: the tall free-standing brick stack seen behind the dorm (not in this record; no class-6 return in the
//  0.5 m raster), entrances, porches, stairs and chimney pots.
import type { Point } from '../../types';
import type { Kit } from './kit';
import { orient, edgesOf } from './kit';
import { P } from './materials';
import { frame, toXZ, toST, fbox, hip, flat, makeBody, emitRoofs, emitSteps, emitWalls, roofBox, dormer, wallChimney, neighbours, type Frame, type Seg, type SegStyle, type WallStats, type Body, type Feature } from './engine';
import type { CampusData } from '../../types';

export const D30_KEY = '677852:991';
const F: Frame = frame(52.97, 5.5);
const SL = 0.723;
/** Measured section parameters (campus Y), see header. */
export const D30 = { wingEave: 31.35, wingTop: 35.9, barEave: 34.76, barTop: 39.1, crossEave: 33.4, crossTop: 35.95, stubEave: 31.9, wStubTop: 33.4, eStubTop: 33.4, annex: 26.04, lidarMax: 40.42 };
// Wing lines in (s, t): W wing west / east, E wing west / east (east lines are slightly skewed in the City ring).
const Wwh = (t: number) => -329.58 - 0.0080833 * (t + 649.94), Wwe = (t: number) => -317.02 + 0.0010776 * (t + 649.9);
const Ew = (t: number) => -264.67 - 0.015176 * (t + 649.4), Ee = (t: number) => -252.32 - 0.0078557 * (t + 649.36);
const TN = -669.8, TS = -681.9;

export function buildD30(k: Kit, data: CampusData, ground: (x: number, z: number) => number, stats: Record<string, unknown>) {
  const b = data.buildings.find(x => x.key === D30_KEY);
  if (!b) throw new Error(`b13: ${D30_KEY} (Scottish Rite Dormitory) missing from the data`);
  // Every cell / hip quad is built from the FROZEN ring's own vertices (located by coordinate, asserted present), so
  // cell boundaries coincide with the City walls; cells extend only into empty plan space beyond the ring.
  const ring = b.rings[0] as Point[];
  const v = (x: number, z: number): Point => { const p = ring.find(q => Math.hypot(q[0] - x, q[1] - z) < 0.011); if (!p) throw new Error(`b13 D30: ring vertex ${x},${z} missing`); return p; };
  const unit = (a: Point, c: Point): Point => { const L = Math.hypot(c[0] - a[0], c[1] - a[1]); return [(c[0] - a[0]) / L, (c[1] - a[1]) / L]; };
  const add = (p: Point, d: Point, m: number): Point => [p[0] + d[0] * m, p[1] + d[1] * m];
  const ext = (p: Point, from: Point, m: number) => add(p, unit(from, p), m);
  const atT = (a: Point, c: Point, t: number): Point => { const [, ta] = toST(F, a), [, tc] = toST(F, c), f = (t - ta) / (tc - ta); return [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f]; };
  const v0 = v(-225.73, -709.11), v9 = v(-245.02, -711.0), v10 = v(-242.51, -734.55), v11 = v(-254.5, -735.83), v12 = v(-257.0, -712.4), v13 = v(-262.43, -712.98), v14 = v(-263.66, -701.41), v15 = v(-258.52, -700.86), v16 = v(-260.69, -680.5), v17 = v(-248.2, -679.17), v18 = v(-246.08, -699.07);
  const v29 = v(-194.04, -693.4), v30 = v(-196.19, -673.26), v31 = v(-183.91, -671.95), v32 = v(-181.7, -692.62), v33 = v(-175.92, -692.01), v34 = v(-174.68, -703.65), v35 = v(-180.17, -704.24), v36 = v(-177.68, -727.61), v37 = v(-189.56, -728.88), v38 = v(-192.05, -705.5), v39 = v(-213.1, -707.74), v40 = v(-210.53, -731.87), v45 = v(-223.15, -733.3);
  const Wq = [v16, v17, v10, v11], Eq = [v30, v31, v36, v37], T9 = toST(F, v9)[1];
  const barQ = orient([v18, v29, v38, v9]), wxQ = orient([v15, v18, v9, v12]), exQ = orient([v29, v32, v35, v38]);
  const wsQ = orient([v14, v15, v12, v13]), esQ = orient([v32, v33, v34, v35]);
  const specs = [
    hip(Wq, D30.wingEave, SL, D30.wingTop), hip(Eq, D30.wingEave, SL, D30.wingTop),
    hip(barQ, D30.barEave, SL, D30.barTop),
    hip(wxQ, D30.crossEave, SL, D30.crossTop, [[v15, v18], [v12, v9]]), hip(exQ, D30.crossEave, SL, D30.crossTop, [[v29, v32], [v38, v35]]),
    hip(wsQ, D30.stubEave, SL, D30.wStubTop, [[v15, v12]]), hip(esQ, D30.stubEave, SL, D30.eStubTop, [[v32, v35]]),
    flat(D30.annex),
  ];
  const slate = P('slate');
  const up = unit(v18, v17), dn = unit(v9, v10), eUp = unit(v29, v30), eUpE = unit(v32, v31), eDn = unit(v38, v37), eDnE = unit(v35, v36);
  const cells = [
    { name: 'Wstub', poly: orient([v15, v12, ext(v13, v12, 10), ext(v14, v15, 10)]), spec: 5 },
    { name: 'Wnorth', poly: orient([v15, v18, add(v18, up, 40), add(v15, unit(v15, v16), 40)]), spec: 0 },
    { name: 'Wcross', poly: wxQ, spec: 3 },
    { name: 'Wsouth', poly: orient([v12, v9, add(v9, dn, 40), add(v12, unit(v12, v11), 40)]), spec: 0 },
    { name: 'BarW', poly: orient([v9, atT(v45, v0, T9), atT(v45, v0, -655), ext(v18, v9, 12)]), spec: 2 },
    { name: 'BarWjog', poly: orient([atT(v9, v10, T9 - 6), atT(v45, v0, T9 - 6), atT(v45, v0, T9), v9]), spec: 2 },
    { name: 'BarMid', poly: orient([v0, v39, atT(v40, v39, -655), atT(v45, v0, -655)]), spec: 2 },
    { name: 'Annex', poly: orient([v0, v39, add(v39, unit(v39, v40), 40), add(v0, unit(v0, v45), 40)]), spec: 7 },
    { name: 'BarE', poly: orient([v39, v38, atT(v38, v29, -655), atT(v40, v39, -655)]), spec: 2 },
    { name: 'Enorth', poly: orient([v29, v32, add(v32, eUpE, 40), add(v29, eUp, 40)]), spec: 1 },
    { name: 'Ecross', poly: exQ, spec: 4 },
    { name: 'Esouth', poly: orient([v38, v35, add(v35, eDnE, 40), add(v38, eDn, 40)]), spec: 1 },
    { name: 'Estub', poly: orient([v32, ext(v33, v32, 10), ext(v34, v35, 10), v35]), spec: 6 },
  ];
  const body: Body = makeBody({ key: D30_KEY, ring: b.rings[0], specs, roofColor: specs.map((_, i) => (i === 7 ? P('membraneGrey') : slate)), cells, others: neighbours(data, D30_KEY, b.rings[0]) }, ground);
  const G = body.grade;

  // Roof features first (their footprints are cut out of the roofs).
  const brick = P('redBrick'), stone = P('limestone'), white = P('sidingWhite');
  let chimneys = 0, dormers = 0, skipped = 0;
  const features: Feature[] = [];
  const chim = (s0: number, s1: number, t0: number, t1: number, top: number) => {
    const r = roofBox(k, body, fbox(F, s0, s1, t0, t1), top, brick, P('castStone'));
    if (r) { chimneys++; features.push({ key: D30_KEY, kind: 'chimney', x: r.x, z: r.z, top, lidarMax: D30.lidarMax }); } else skipped++;
  };
  chim(-311.2, -310.0, -677.2, -675.8, 40.4); chim(-311.2, -310.0, -675.0, -671.5, 40.4); // bar ridge west (raster 40.42)
  chim(-273.0, -271.2, -678.2, -675.3, 40.4);                                               // bar ridge east (40.41)
  chim(-324.0, -322.6, -677.0, -675.5, 38.4);                                               // W crossing (38.40)
  chim(-260.0, -258.6, -676.6, -675.0, 38.9);                                               // E crossing (38.92)
  chim(-294.0, -292.6, -683.3, -682.05, 39.5);                                              // on the annex at the bar wall (39.53)
  const mon = roofBox(k, body, fbox(F, -291.2, -289.8, -706.5, -685.0), 27.4, P('metalLight'), P('metalLight')); // annex monitor (27.4)
  if (mon) features.push({ key: D30_KEY, kind: 'monitor', x: mon.x, z: mon.z, top: 27.4, lidarMax: D30.lidarMax });
  // Exterior chimney breast on the bar's south wall west of the annex (raster 40.19 at s -298, t -681).
  const southEdge = edgesOf(body.outer).find(e => { const [sa, ta] = toST(F, e.a), [sc, tc] = toST(F, e.c); return Math.abs(ta - TS) < 0.5 && Math.abs(tc - TS) < 0.5 && Math.min(sa, sc) < -299.5 && Math.max(sa, sc) > -297.9; });
  if (southEdge) {
    const sOf = (s: number) => { const p = toXZ(F, s, TS); return (p[0] - southEdge.a[0]) * southEdge.u.x + (p[1] - southEdge.a[1]) * southEdge.u.z; };
    const [x0, x1] = [sOf(-299.7), sOf(-298.4)].sort((p, q) => p - q); // raster max s -298; kept 0.64 m off the annex wall
    const e = wallChimney(k, body, southEdge.i, x0, x1, 1.0, 40.2, brick); chimneys++;
    const c = { x: e.a[0] + e.u.x * (x0 + x1) / 2 + e.n.x * 0.52, z: e.a[1] + e.u.z * (x0 + x1) / 2 + e.n.z * 0.52 };
    features.push({ key: D30_KEY, kind: 'wall chimney', ...c, top: 40.2, lidarMax: D30.lidarMax });
  }
  // Dormers: [cell rect, eave line near-point (s, t), centres (s or t), width, rf, yE above main-at-rf, yR].
  const dorm = (rect: Point[], eave: number, near: [number, number], at: [number, number][], w: number, rf: number, rise: number, yR: number) => {
    const r = orient(rect), np = toXZ(F, ...near);
    const e = edgesOf(r).reduce((p, q) => (segD(np, q.a, q.c) < segD(np, p.a, p.c) ? q : p));
    for (const c of at) {
      const pc = toXZ(F, ...c), s = (pc[0] - e.a[0]) * e.u.x + (pc[1] - e.a[1]) * e.u.z;
      const ok = dormer(k, body, { a0: e.a, u: [e.u.x, e.u.z], eave, slope: SL, s, w, rf, yE: eave + SL * rf + rise, yR, front: white, cheek: slate, roof: slate, glass: P('glass') });
      if (ok) { dormers++; features.push({ key: D30_KEY, kind: 'dormer', x: ok.x, z: ok.z, top: ok.top, lidarMax: D30.lidarMax }); } else skipped++;
    }
  };
  const wingW = (t: number): [number, number] => [Wwh(t), t], wingE = (t: number): [number, number] => [Wwe(t), t];
  dorm(Wq, D30.wingEave, [Wwh(-690), -690], [-698, -693.5, -688.75, -684, -667.25, -662, -656.5].map(wingW), 1.8, 0.7, 1.7, 34.85);
  dorm(Wq, D30.wingEave, [Wwe(-690), -690], [-696.5, -691, -685, -666.75, -662, -656.75].map(wingE), 1.8, 0.7, 1.7, 34.85);
  dorm(Wq, D30.wingEave, [-323, -649.9], [[-323.5, -649.9]], 2.4, 0.6, 1.7, 34.85);
  dorm(Eq, D30.wingEave, [Ew(-690), -690], [-699, -692, -685].map(t => [Ew(t), t] as [number, number]), 1.8, 0.7, 1.7, 34.85);
  dorm(Eq, D30.wingEave, [Ee(-690), -690], [-698, -693, -688.75, -684, -667, -662, -656.5].map(t => [Ee(t), t] as [number, number]), 1.8, 0.7, 1.7, 34.85);
  dorm(Eq, D30.wingEave, [-258, -649.4], [[-259.5, -649.4]], 2.4, 0.6, 1.7, 34.85);
  dorm(barQ, D30.barEave, [-290, TS], [-303.5, -295.75, -287.25, -279.0, -271.5].map(s => [s, TS] as [number, number]), 2.0, 0.9, 1.5, 38.0);
  for (const [s, w, yR] of [[-308.0, 2.6, 37.78], [-303.25, 2.0, 38.9], [-295.0, 2.6, 38.9], [-287.75, 2.0, 38.9], [-284.0, 2.4, 38.9], [-279.25, 2.6, 38.9], [-275.5, 2.4, 38.9]] as [number, number, number][])
    dorm(barQ, D30.barEave, [-290, TN], [[s, TN]], w, 0.4, 1.6, yR);

  const roof = emitRoofs(k, body);
  const steps = emitSteps(k, body, brick);
  const ws: WallStats = { segments: 0, windows: 0, bands: 0, pilasters: 0, balconies: 0, infill: 0, party: 0, near: 0, probes: [] };
  const win = (sill: number, w = 1.15) => ({ sill: G + sill, head: G + sill + 2.0, w, bay: 3.1, recess: 0.2, reveal: P('trimWhite'), pane: P('glass'), sillBox: { h: 0.12, d: 0.07, color: stone }, lintel: { h: 0.3, d: 0.04, color: stone } });
  emitWalls(k, body, ground, (s: Seg): SegStyle => {
    const name = body.cells[s.cell].name, annex = name === 'Annex';
    return {
      wall: brick, plinth: { top: G + 1.3, color: stone },
      bands: [{ y0: G + 3.8, y1: G + 4.05, d: 0.08, color: stone, ext: true }, { y0: s.top - 0.55, y1: s.top, d: 0.4, color: stone, ext: true }],
      windows: annex ? [{ ...win(1.5, 1.7), head: G + 6.2, bay: 3.4 }] : [win(1.7), win(5.25), win(8.6), win(11.95)],
    };
  }, ws);
  stats.scottishRite = {
    key: D30_KEY, grade: +G.toFixed(2), base: +body.base.toFixed(2), sections: D30, slope: SL, cells: cells.map(c => c.name),
    roofPlanes: roof.planes, roofTriangles: roof.triangles, stepFaces: steps, dormers, chimneys, skippedFeatures: skipped, ...ws, probes: ws.probes.length,
  };
  return { key: D30_KEY, probes: ws.probes, features, courts: [] as { key: string; ring: Point[] }[] };
}

const segD = (p: Point, a: Point, c: Point) => { const dx = c[0] - a[0], dz = c[1] - a[1], l = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l)); return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dz - p[1]); };
