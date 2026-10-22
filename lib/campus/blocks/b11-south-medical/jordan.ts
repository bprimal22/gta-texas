// D23 / b11: Barbara Jordan State Office Building, 1601 N Congress Ave (City record 463088:8; TFC Capitol Complex
// Phase 1, Kirksey, completed 2022 — post-dates the 2017 LiDAR).
// Evidence (research/whole-campus-92/district-agents-40/packets/D23.json, actual orbit frames d23-orbit-*):
//  * plan: the City 2023 ring unchanged; heights: the frozen context.json massing (main deck 60 m above the generator
//    grade, mechanical/roof enclosure 60-63.6 m on its inset ring; published: 12 floors, main roof 200 ft, 211 ft to roof,
//    top floor at 182 ft). Main-roof parapet to 61 m = the published 200 ft main roof;
//  * storeys: ground storey 6.0 m (ESTIMATE) and 10 typical storeys of (55.5 - 6.0) / 10 = 4.95 m so level 12 sits at the
//    published 182 ft (55.5 m);
//  * envelope (reference-interpreted, d23 SW / SE / NW frames): teal-green glazed curtain wall, white horizontal spandrel
//    band at every floor, white vertical fins grouped over two storeys and staggered half a module between successive
//    two-storey bands (the SE frame's offset fin pattern), sharp white-banded corners; module 3.0 m fins with a 1.5 m
//    intermediate mullion is an ESTIMATE from fin counts on the 60 m east face and the ~45 m south face;
//  * base: on the Capitol Mall (west-facing) faces a recessed double-height colonnade with white columns (NW frame,
//    ~9 m column spacing, depth 3 m ESTIMATE); on the long east face a solid light-grey service base with loading doors
//    (SE frame, 4 doors in the middle third; door positions ESTIMATE); elsewhere a glazed ground storey.
//  Evidence mismatch (reported, not changed): the SE frame shows the plan quad between ring vertices (-160.5, 914.9),
//  (-108.4, 931.2), (-101.1, 907.8), (-117.0, 902.8) as a low terrace with a tent canopy rather than full-height tower,
//  while the SW frame's registration places that terrace at grade outside the ring; the frozen footprint/massing
//  (full ring to 60 m) is kept pending a dated site plan / survey.
import * as THREE from 'three';
import type { CampusData, Point } from '../../types';
import { Kit, C, orient, edgesOf, at, type Face } from './kit';
import { dedupe } from './roof';
import context from './context.json' with { type: 'json' };

export const JORDAN_KEY = '463088:8';
export const JORDAN_FLOORS = { ground: 6.0, typical: 4.95, levels: 12 };
export const JORDAN_FIN = { module: 3.0, depth: 0.3, width: 0.14 };
export const JORDAN_COLONNADE = { depth: 3.0, pier: 1.2, column: 0.9, spacing: 9.0 };
const COL = { glass: C('#2b7f86'), white: C('#e4e6e2'), base: C('#c9c7c0'), door: C('#5d6063'), mech: C('#a9adae'), deck: C('#b8b6b0'), soffit: C('#dcdcd6'), mullion: C('#d6dad8') };
type Vol = { ring?: Point[]; bottom: number; top: number };

/** Mitered inward offset of an oriented ring (no tiny edges here). */
function inset(r: Point[], d: number): Point[] {
  const es = edgesOf(r);
  return es.map((e, i) => {
    const p = es[(i - 1 + es.length) % es.length], nx = -(e.n.x + p.n.x), nz = -(e.n.z + p.n.z), l = Math.hypot(nx, nz);
    const cos = (-e.n.x * nx - e.n.z * nz) / l; return [e.a[0] + nx / l * d / cos, e.a[1] + nz / l * d / cos] as Point;
  });
}

export function buildJordan(k: Kit, data: CampusData, ground: (x: number, z: number) => number, stats: Record<string, unknown>) {
  const b = data.buildings.find(x => x.key === JORDAN_KEY);
  if (!b) throw new Error(`b11: ${JORDAN_KEY} (Barbara Jordan) missing from the data`);
  const ring = orient(dedupe(b.rings[0]));
  const vols = (context as unknown as { massing: Record<string, { volumes: Vol[] }> }).massing[JORDAN_KEY].volumes;
  const main = vols.find(v => !v.ring)!, mech = vols.find(v => v.ring)!;
  // Generator datum ('grade'): median baked ground along the ring every <= 6 m + centre; base = low - 1.2.
  const samples: number[] = [];
  for (const e of edgesOf(ring)) { const n = Math.max(1, Math.ceil(e.L / 6)); for (let i = 0; i < n; i++) { const p = at(e, e.L * i / n, 0); samples.push(ground(p.x, p.z)); } }
  samples.push(ground(b.center[0], b.center[1])); samples.sort((p, q) => p - q);
  const hb = samples[Math.floor(samples.length / 2)], base = samples[0] - 1.2;
  const deck = hb + main.top, top = deck + 1.0, mechTop = hb + mech.top;
  const F = JORDAN_FLOORS, level = (L: number) => hb + F.ground + (L - 2) * F.typical; // floor line of level L >= 2
  const band = 0.35, parapetBand = deck - 0.7;
  let fins = 0, bandPieces = 0, columns = 0, mullions = 0;

  for (const e of edgesOf(ring)) {
    if (e.L < 1) { k.face(e, base, top, COL.glass, { mat: 'glass' }); continue; }
    const mall = e.n.x < -0.85, service = e.n.x > 0.85 && e.L > 40;
    const P = JORDAN_COLONNADE.pier, yc = level(2) - band;
    const faces: Face[] = mall && e.L > 2 * P + 6
      ? [k.face(e, base, top, COL.glass, { mat: 'glass', s1: P }), k.face(e, yc, top, COL.glass, { mat: 'glass', s0: P, s1: e.L - P }), k.face(e, base, top, COL.glass, { mat: 'glass', s0: e.L - P })]
      : [k.face(e, base, top, COL.glass, { mat: 'glass' })];
    // Fins: two-storey runs (levels 2-4, 4-6, ... , 12-parapet), staggered by half a module per run.
    const runs: [number, number][] = [];
    for (let L = 2; L < F.levels; L += 2) runs.push([level(L) + band, level(Math.min(L + 2, F.levels)) - band]);
    runs.push([level(F.levels) + band, parapetBand]);
    const list: { s: number; y0: number; y1: number }[] = [];
    runs.forEach(([y0, y1], j) => {
      const off = JORDAN_FIN.module / 2 + (j % 2) * JORDAN_FIN.module / 2;
      for (let s = off; s <= e.L - 0.9; s += JORDAN_FIN.module) {
        if (s < 0.9) continue;
        k.attach(faces, s - JORDAN_FIN.width / 2, s + JORDAN_FIN.width / 2, y0, y1, JORDAN_FIN.depth, COL.white, 'matte', { top: false, bottom: false });
        list.push({ s, y0, y1 }); fins++;
      }
    });
    // Spandrel bands at every floor line, split where a fin passes through; the parapet band caps the wall.
    for (let L = 2; L <= F.levels; L++) {
      const y = level(L), cuts = list.filter(f => f.y0 < y && f.y1 > y).map(f => f.s).sort((p, q) => p - q);
      let s0 = 0, open0 = false;
      for (const s of [...cuts, Infinity]) {
        const a = s0, c = Math.min(s === Infinity ? e.L : s - JORDAN_FIN.width / 2, e.L);
        if (c - a > 0.02) { k.attach(faces, a, c, y - band, y + band, 0.1, COL.white, 'matte', { s0: !open0, s1: s === Infinity }); bandPieces++; }
        s0 = s + JORDAN_FIN.width / 2; open0 = true;
      }
    }
    k.attach(faces, 0, e.L, parapetBand, top, 0.1, COL.white);
    // Intermediate mullions (flush detail) half a module from each fin, per storey.
    for (let L = 2; L < F.levels + 1; L++) {
      const y0 = level(L) + band, y1 = L < F.levels ? level(L + 1) - band : parapetBand;
      const run = list.filter(f => f.y0 <= y0 + 1e-6 && f.y1 >= y1 - 1e-6);
      for (const f of run) { const s = f.s + JORDAN_FIN.module / 2; if (s < e.L - 0.6) { k.panel(k.D('metal'), e, s - 0.03, s + 0.03, y0, y1, 0.02, COL.mullion); mullions++; } }
    }
    // Ground storey.
    if (mall && faces.length === 3) {
      const D = JORDAN_COLONNADE.depth, s0 = P, s1 = e.L - P, glass = k.S('glass'), wall = k.S();
      glass.quad(at(e, s0, base, -D), at(e, s1, base, -D), at(e, s1, yc, -D), at(e, s0, yc, -D), COL.glass, e.n);       // recessed glazing
      wall.quad(at(e, s0, yc, -D), at(e, s1, yc, -D), at(e, s1, yc, 0), at(e, s0, yc, 0), COL.soffit, new THREE.Vector3(0, -1, 0)); // soffit
      wall.quad(at(e, s0, base, 0), at(e, s0, base, -D), at(e, s0, yc, -D), at(e, s0, yc, 0), COL.white, e.u);           // return walls
      wall.quad(at(e, s1, base, -D), at(e, s1, base, 0), at(e, s1, yc, 0), at(e, s1, yc, -D), COL.white, e.u.clone().negate());
      const n = Math.max(1, Math.round((s1 - s0) / JORDAN_COLONNADE.spacing)), c = JORDAN_COLONNADE.column;
      for (let i = 1; i < n; i++) {
        const s = s0 + (s1 - s0) * i / n;
        k.box(wall, e, s - c / 2, s + c / 2, base, yc, -c, 0, COL.white, true, { top: false, bottom: false }); columns++;
      }
      for (let s = s0 + 1.5; s < s1 - 0.5; s += 1.5) { k.D('metal').quad(at(e, s - 0.03, base, -D + 0.02), at(e, s + 0.03, base, -D + 0.02), at(e, s + 0.03, yc, -D + 0.02), at(e, s - 0.03, yc, -D + 0.02), COL.mullion, e.n); mullions++; }
    } else if (service) {
      k.attach(faces, 0, e.L, base, level(2) - band, 0.06, COL.base, 'matte', { top: false });
      for (let d = 0; d < 4; d++) { const s = e.L * (0.22 + d * 0.1); k.panel(k.D(), e, s, s + 4.0, Math.max(base, hb - 0.2), hb + 4.2, 0.08, COL.door); }
    } else {
      for (let s = 1.5; s < e.L - 0.5; s += 1.5) { k.panel(k.D('metal'), e, s - 0.03, s + 0.03, base, level(2) - band, 0.02, COL.mullion); mullions++; }
    }
  }
  k.flushFaces();
  // Parapet (inner wall + coping) to the published main roof, deck around the mechanical enclosure, enclosure prism.
  const inner = inset(ring, 0.35), mr = orient(mech.ring!);
  for (const e of edgesOf(inner)) k.wall(k.S(), e.c, e.a, deck, top, COL.white);
  k.cap(k.S(), [ring, inner.slice().reverse()], top, COL.white);
  k.cap(k.S(), [inner, mr.slice().reverse()], deck, COL.deck);
  k.prism(mr, deck, mechTop, COL.mech, COL.mech);

  stats.jordan = { key: JORDAN_KEY, grade: +hb.toFixed(2), deck: +deck.toFixed(2), parapetTop: +top.toFixed(2), mechTop: +mechTop.toFixed(2), floors: F, fins, bandPieces, columns, mullions };
  return JORDAN_KEY;
}

/** City 2023 record 531887:350 (post-2017, no 2017 LiDAR returns; City h 2.5, catalogue 'shed'): a ~3.6 x 8 m low structure
 * standing ~1 m off Barbara Jordan's Capitol Mall face. Once that face is authored, the generated context's coverage rule
 * (perimeter within 1.5 m of authored solids) would suppress it, so b11 rebuilds it on its exact ring as the generator
 * would: a plain flat-roofed box 3.0 m above grade (the generator's 3 m height floor). Form and height are ESTIMATES. */
export const MALL_STRUCTURE_KEY = '531887:350';
export const MALL_STRUCTURE_HEIGHT = 3.0;
export function buildMallStructure(k: Kit, data: CampusData, ground: (x: number, z: number) => number, stats: Record<string, unknown>) {
  const b = data.buildings.find(x => x.key === MALL_STRUCTURE_KEY);
  if (!b) throw new Error(`b11: ${MALL_STRUCTURE_KEY} missing from the data`);
  const ring = orient(dedupe(b.rings[0]));
  const g = ring.map(p => ground(p[0], p[1])).concat(ground(b.center[0], b.center[1])).sort((p, q) => p - q);
  const grade = g[Math.floor(g.length / 2)], top = grade + MALL_STRUCTURE_HEIGHT;
  k.prism(ring, g[0] - 1.2, top, COL.base, COL.deck);
  stats.mallStructure = { key: MALL_STRUCTURE_KEY, grade: +grade.toFixed(2), top: +top.toFixed(2) };
  return MALL_STRUCTURE_KEY;
}
