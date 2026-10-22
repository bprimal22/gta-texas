// b12 round 2: University Baptist Church SANCTUARY, 2130 Guadalupe (City record 699548:1060). The education building /
// chapel annex on San Antonio (714509:1097) stays a generated record (identity fixed in context.json only).
// Massing from the 2017 USGS 3DEP 0.5 m LiDAR (b12-implementation/church-grid.txt, measured): a cross of two tiled gables —
// nave E-W (ridge Y 26.7, eaves ~23.5, 14 m wide) and transept N-S (ridge 26.85, eaves ~23.4, 14 m wide) — on a flat
// lower body (annex pieces ~Y 20), plus the south wing gable (ridge 18.5, eaves 15.4). The plan is rotated 5.1 deg like
// the City ring. Architectural vocabulary from ubc-historic-1958.jpg (1958-09-29, Neal Douglass, Austin History Center
// via UNT Portal): brick walls, red clay tile gabled roofs, ornate pale-stone frontispiece with three tall arched windows
// at the primary entrance, pale-stone window surround on the second gable; ubc-visit-02.png (owner access plan) puts the
// PRIMARY ENTRANCE on Guadalupe (east). Ornament is simplified to blocks; colours are estimates (1958 photo is B&W).
import type { CampusData, Point } from '../../types';
import { Kit, C, edgesOf, at, rect, orient, type Edge } from './kit';
import { recordRing, ringGroundMin } from './massing';

export const CHURCH_KEY = '699548:1060';
const AX: [number, number] = [0.99607, 0.08857]; // ring edge direction (5.08 deg)
const AXN: [number, number] = [-0.08857, 0.99607];
/** LiDAR-derived bodies (campus Y). */
export const CHURCH = {
  baseDeck: 20.0,
  nave: { ring: rect(-485.4, 142.3, AX, 17.55, 7.0), eave: 23.5, ridge: 26.7 },
  transept: { ring: rect(-487.0, 141.45, AXN, 13.0, 7.0), eave: 23.4, ridge: 26.85 },
  south: { ring: [[-504.19, 152.97], [-506.27, 174.44], [-492.33, 175.68], [-491.83, 154.07]] as Point[], eave: 15.4, ridge: 18.5 },
  /** Ring part north of the south wing (cut along the wing's north wall line). */
  baseRing: [[-467.03, 134.26], [-471.37, 133.88], [-471.63, 136.77], [-476.59, 136.33], [-475.97, 129.35], [-490.93, 128.03], [-490.98, 128.53], [-494.41, 128.22],
    [-494.54, 129.77], [-498.99, 129.37], [-499.41, 134.1], [-502.33, 133.84], [-504.19, 152.97], [-491.83, 154.07], [-475.53, 155.52], [-475.27, 152.55], [-468.71, 153.13]] as Point[],
};
const BRICK = '#8e5a43', TILE = '#a5563a', STONE = '#e3dac6', GLASS = '#1d2428';
const segOn = (a: Point, c: Point, p: Point, q: Point) => near({ a, c } as Edge, p, q);
const near = (e: Pick<Edge, 'a' | 'c'>, p: Point, q: Point) => { const m: Point = [(e.a[0] + e.c[0]) / 2, (e.a[1] + e.c[1]) / 2], dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz);
  return Math.abs((m[0] - p[0]) * dz - (m[1] - p[1]) * dx) / L < 0.3; };

/** Tall arched window: rectangle + 6-segment semicircular head (flat panel on the wall plane at offset d). */
function arched(k: Kit, e: Edge, s: number, y0: number, w: number, h: number, d: number, color: string) {
  const b = k.D('glass'), c = C(color), r = w / 2, yc = y0 + h - r;
  k.panel(b, e, s - r, s + r, y0, yc, d, c);
  for (let i = 0; i < 6; i++) { const a0 = Math.PI * i / 6, a1 = Math.PI * (i + 1) / 6;
    b.tri(at(e, s, yc, d), at(e, s + r * Math.cos(a0), yc + r * Math.sin(a0), d), at(e, s + r * Math.cos(a1), yc + r * Math.sin(a1), d), c, e.n); }
}

export function buildChurch(k: Kit, data: CampusData, g: (x: number, z: number) => number, st: Record<string, unknown>) {
  const ring = recordRing(CHURCH_KEY, data), bottom = ringGroundMin(ring, g) - 1.0;
  const brick = C(BRICK), tile = C(TILE), stone = C(STONE);
  const S = CHURCH.south.ring, cutA = S[0], cutB = S[3];
  // flat lower body (whole north part) to the annex deck; its wall on the cut line stays (it rises above the south wing)
  k.prism(CHURCH.baseRing, bottom, CHURCH.baseDeck, brick, C('#8b8781'));
  // cross of gables on the deck
  const nave = k.gable(CHURCH.nave.ring, CHURCH.baseDeck, CHURCH.nave.eave, CHURCH.nave.ridge, 0, brick, tile, 0.5);
  const tr = k.gable(CHURCH.transept.ring, CHURCH.baseDeck, CHURCH.transept.eave, CHURCH.transept.ridge, 0, brick, tile, 0.5);
  // south wing gable (ridge N-S), its north end wall is the base's cut wall -> skipped via a thin trim instead
  k.gable(S, bottom, CHURCH.south.eave, CHURCH.south.ridge, 0, brick, tile, 0.45, { skipWall: (a, c) => segOn(a, c, cutA, cutB) });
  // pale stone eave bands on the gabled bodies
  for (const r of [nave.r, tr.r]) for (const e of edgesOf(r)) k.box(k.D(), e, 0, e.L, CHURCH.nave.eave - 0.45, CHURCH.nave.eave - 0.1, 0, 0.1, stone);
  let windows = 0;
  // Primary entrance (Guadalupe / east gable end of the nave): pale stone frontispiece, three arched windows, portal.
  const east = edgesOf(nave.r).reduce((b, e) => (e.n.x > b.n.x ? e : b)), gyE = g(at(east, east.L / 2, 0, 1.5).x, at(east, east.L / 2, 0, 1.5).z);
  const sc = east.L / 2, fw = 9.4;
  k.box(k.D(), east, sc - fw / 2, sc + fw / 2, bottom, CHURCH.nave.eave + 1.6, 0, 0.1, stone);
  for (const sx of [sc - fw / 2 - 0.2, sc - fw / 6 - 0.25, sc + fw / 6 - 0.25, sc + fw / 2 - 0.3]) k.box(k.D(), east, sx, sx + 0.5, bottom, CHURCH.nave.eave + 2.6, 0.1, 0.15, stone); // pilasters / finials (flat relief)
  for (const dx of [-fw / 3, 0, fw / 3]) { arched(k, east, sc + dx, gyE + 6.2, 2.0, 6.4, 0.115, GLASS); arched(k, east, sc + dx, gyE, 1.9, 3.6, 0.115, '#3a2a20'); windows += 2; }
  k.box(k.D(), east, sc - fw / 2, sc + fw / 2, gyE + 4.3, gyE + 5.1, 0.1, 0.15, stone); // carved band over the doors
  // second gable (transept north end, W 22nd St): ornate pale window surround around a tall arched window
  const north = edgesOf(tr.r).reduce((b, e) => (e.n.z < b.n.z ? e : b)), sn = north.L / 2;
  k.box(k.D(), north, sn - 2.2, sn + 2.2, CHURCH.baseDeck - 4.5, CHURCH.transept.eave + 1.9, 0, 0.1, stone);
  arched(k, north, sn, CHURCH.baseDeck - 3.6, 2.2, 7.6, 0.115, GLASS); windows++;
  // side windows: tall windows on the gabled bodies above the deck, two rows of small windows on the brick base
  const skipIn = (x: number, z: number) => [nave.r, tr.r].some(r => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > z) !== (r[j][1] > z) && x < (r[j][0] - r[i][0]) * (z - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; });
  for (const r of [nave.r, tr.r]) for (const e of edgesOf(r)) {
    if (e === east || e.L < 8) continue;
    const n = Math.floor(e.L / 4.2);
    for (let j = 0; j < n; j++) { const s = (j + 0.5) * e.L / n, p = at(e, s, 0, 0.6); if (skipIn(p.x, p.z)) continue; k.panel(k.D('glass'), e, s - 0.55, s + 0.55, CHURCH.baseDeck + 0.3, CHURCH.nave.eave - 0.7, 0.03, C(GLASS)); windows++; }
  }
  for (const e of edgesOf(orient(CHURCH.baseRing))) {
    if (e.L < 3.5 || near(e, cutA, cutB)) continue;
    const gy = g(at(e, e.L / 2, 0, 1).x, at(e, e.L / 2, 0, 1).z), n = Math.floor(e.L / 3.4);
    for (let j = 0; j < n; j++) { const s = (j + 0.5) * e.L / n; if (e.n.x > 0.9 && Math.abs(at(e, s, 0).z - at(east, sc, 0).z) < fw / 2 + 0.6) continue; // frontispiece zone
      for (const y of [gy + 1.4, gy + 5.6]) { if (y + 2.2 > CHURCH.baseDeck - 0.5) continue; k.panel(k.D('glass'), e, s - 0.5, s + 0.5, y, y + 2.2, 0.03, C(GLASS)); windows++; } }
  }
  // south wing: small windows on its long walls
  for (const e of edgesOf(orient(S))) { if (e.L < 15) continue; const gy = g(at(e, e.L / 2, 0, 1).x, at(e, e.L / 2, 0, 1).z), n = Math.floor(e.L / 3.2);
    for (let j = 0; j < n; j++) { const s = (j + 0.5) * e.L / n; for (const y of [gy + 1.3, gy + 4.6]) { if (y + 1.8 > CHURCH.south.eave - 0.4) continue; k.panel(k.D('glass'), e, s - 0.5, s + 0.5, y, y + 1.8, 0.03, C(GLASS)); windows++; } } }
  st.church = { windows, frontispiece: { centre: [+at(east, sc, 0).x.toFixed(2), +at(east, sc, 0).z.toFixed(2)], groundY: +gyE.toFixed(2) }, ridges: [CHURCH.nave.ridge, CHURCH.transept.ridge, CHURCH.south.ridge] };
}
