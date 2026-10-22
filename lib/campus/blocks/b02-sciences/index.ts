// Block b02-sciences: Sciences: NHB, Welch, Painter, Burdine, Hackerman, POB.
// Owner-only file (research/whole-campus-92/BLOCKS.md).
//
// install() builds the building BODIES that were missing from the scene (bodies.json):
//  - POB 504518: the authored POB package is a street facade shell (24th St / Speedway sides);
//    the body behind it (LiDAR roof Y25.2) was absent because the record is suppressed as "authored".
//  - Welch 507353: west wing (LiDAR Y34.0), middle bar (Y12.0), south block (Y17.5) and parts of
//    the Y27.3 roof had no geometry under the authored north/east/south pieces.
//  - MBB / NMS / FNT: the City footprint 655081 is a union of five official UT buildings; only NHB
//    is authored, so these three were missing (BME is generated from its own added record).
// Each piece = official UT polygon AND 2017 LiDAR roof AND nothing built (0.5 m probe of the
// scene without this block), eroded 0.75 m from authored ground; top = LiDAR tier campus Y
// (campus Y = NAVD88 - 165). See research/whole-campus-92/b02-sciences/derived/bodies.py.
// Walls + roof are one trimesh collider per piece built from the rendered triangles.
// Round 2: pieces whose LiDAR tier belongs to a pitched section in roofs.json (MBB wings, NMS central hip,
// Welch middle-bar shed) get a clay-tile roof on the fitted LiDAR surface instead of stepped flat decks; their
// wall tops follow the same surface (eaves/gables), so the collider is still exactly the rendered triangles.
// D03 (engineering-core lane, nms-detail.ts): NMS walls take a textured buff brick, its z-facing faces get the photographed
// green glazed bays + pale eave band, and the LiDAR-measured roof plant housings / exhaust stacks stand on its hip cap.
// D03 SSB (ssb.ts, root-authorized geometry correction): Student Services 656376:923 is rebuilt (open top gallery on piers, measured
// clay-tile hip roof with wells, pale precast + brick infill facade) instead of the generated flat box (context.json `replaces`).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { BlockModule, BlockInstallContext } from '../types';
import bodies from './bodies.json' with { type: 'json' };
import roofs from './roofs.json' with { type: 'json' };
import { TexturedFinish, metreUVs } from './textured-finish';
import { buildSsb, SSB_KEY } from './ssb';
import { NMS_DETAIL, inNmsBayRun, nmsBaySpans, buildNmsRoofPlant } from './nms-detail';

type Pt = [number, number];
interface Piece { record: string; lidarRecord: number; top: number; groundY: number; area: number; rings: Pt[][] }

/** Facade parameters per building (official floor counts; floor height = LiDAR roof height / floors). */
const SKIN: Record<string, { floors: number; bay: number; win: number; wall: string[]; base: string[]; glass: string[]; baseH: number; color: number; baseColor: number }> = {
  // POB: buff brick, limestone base, blue-gray glazing (pob-frontage materials); 7 floors (UTDirect POB).
  POB: { floors: 6, bay: 3.6, win: 2.2, wall: ['POB buff brick'], base: ['POB warm limestone'], glass: ['POB recessed blue-gray glazing'], baseH: 4.2, color: 0xc9ad88, baseColor: 0xd8c9ad },
  // Welch: buff brick with cut-stone base (west24 materials); 7 floors (UTDirect WEL) incl. basement/attic.
  WEL: { floors: 6, bay: 3.3, win: 1.5, wall: ['24th buff brick'], base: ['24th cut stone trim', '24th limestone'], glass: ['24th painted sash'], baseH: 1.4, color: 0xd2b996, baseColor: 0xe0d3b8 },
  // MBB (1997, 5 fl), NMS (2005, 7 fl), FNT (2006, 9 fl incl. basement): master-plan buff brick + limestone.
  MBB: { floors: 5, bay: 3.4, win: 1.6, wall: ['24th buff brick'], base: ['NHB buff limestone', '24th limestone'], glass: ['NHB recessed ground glazing', 'POB recessed blue-gray glazing'], baseH: 4.5, color: 0xd0b48f, baseColor: 0xe0d3b8 },
  NMS: { floors: 7, bay: 3.4, win: 1.6, wall: ['24th buff brick'], base: ['NHB buff limestone', '24th limestone'], glass: ['NHB recessed ground glazing', 'POB recessed blue-gray glazing'], baseH: 4.5, color: 0xd0b48f, baseColor: 0xe0d3b8 },
  FNT: { floors: 7, bay: 3.2, win: 1.7, wall: ['NHB warm running-bond brick', '24th buff brick'], base: ['NHB buff limestone', '24th limestone'], glass: ['NHB recessed ground glazing', 'POB recessed blue-gray glazing'], baseH: 4.5, color: 0xb88a6e, baseColor: 0xe0d3b8 },
};
const ROOF = ['GDC pale roof membrane and soffit', 'Welch inner roof pale standing seam cover'];

// Round 2: pitched roofs fitted to the 2017 LiDAR (roofs.json, research/.../derived/r2/roofs_fit.py).
// Each section is an oriented rectangle in the science-block frame (s = p.A, t = p.C) whose height is
// H = min(cap, min over eave edges (eaveY + slope * inside distance)): hips where several edges are eaves,
// gable ends where an edge is not. A piece uses the section only if its LiDAR tier lies in the section's range.
interface Section { id: string; record: string; s0: number; s1: number; t0: number; t1: number; eaves: Record<string, number>; slope: number; cap: number }
const RA = roofs.axisA as [number, number], RC = roofs.axisC as [number, number];
const SECTIONS = roofs.sections as unknown as Section[];
const toST = (x: number, z: number): Pt => [x * RA[0] + z * RA[1], x * RC[0] + z * RC[1]];
const fromST = (s: number, t: number): Pt => [s * RA[0] + t * RC[0], s * RA[1] + t * RC[1]];
const GRID = 1.0;
const usesSections = (p: Piece) => SECTIONS.some(q => q.record === p.record && p.top >= Math.min(...Object.values(q.eaves)) - 1.5 && p.top <= q.cap + 1.5);
/** Roof height of a section at (s,t) and the governing eave edge (for tile UVs: u along it, v up the slope). */
function sectionRoof(q: Section, s: number, t: number) {
  let h = q.cap, u = s, v = 0;
  for (const [e, y] of Object.entries(q.eaves)) {
    const d = e === 's0' ? s - q.s0 : e === 's1' ? q.s1 - s : e === 't0' ? t - q.t0 : q.t1 - t;
    const val = y + q.slope * d;
    if (val < h) { h = val; u = e[0] === 's' ? t : s; v = d / Math.cos(Math.atan(q.slope)); }
  }
  return { h, u, v };
}
/** Roof surface of a piece at campus (x,z): the containing section (or the nearest within 1.5 m), else the flat tier. */
function roofAt(p: Piece, x: number, z: number) {
  if (usesSections(p)) {
    const [s, t] = toST(x, z);
    let best: { h: number; u: number; v: number } | null = null, bestOut = 1.5;
    for (const q of SECTIONS) {
      if (q.record !== p.record) continue;
      const out = Math.max(q.s0 - s, s - q.s1, q.t0 - t, t - q.t1, 0);
      const r = sectionRoof(q, s, t);
      // Inside several sections (a gable end meeting a lower wing): the higher roof wins.
      if (out < bestOut - 1e-9 || (out <= bestOut + 1e-9 && best && r.h > best.h)) { best = r; bestOut = out; }
    }
    if (best) return { ...best, pitched: true };
  }
  return { h: p.top, u: x, v: z, pitched: false };
}
/** Sutherland-Hodgman clip of a ring (s,t) against an axis-aligned cell. */
function clipCell(ring: Pt[], s0: number, s1: number, t0: number, t1: number): Pt[] {
  let poly = ring;
  for (const [axis, val, keepGreater] of [[0, s0, true], [0, s1, false], [1, t0, true], [1, t1, false]] as [0 | 1, number, boolean][]) {
    const out: Pt[] = []; const inside = (p: Pt) => keepGreater ? p[axis] >= val : p[axis] <= val;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) { const k = (val - a[axis]) / (b[axis] - a[axis]); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); }
    }
    poly = out.filter((p, i) => { const q = out[(i + out.length - 1) % out.length]; return out.length < 2 || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-7; });
    if (poly.length < 3) return [];
  }
  return poly;
}
const area2 = (r: Pt[]) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };

const inRing = (x: number, z: number, r: Pt[]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const inSolid = (x: number, z: number, rings: Pt[][]) => inRing(x, z, rings[0]) && !rings.slice(1).some(h => inRing(x, z, h));

/** Plain triangle soup with metric UVs (u along the wall / x, v = y / z) — the materials are metric. */
class Soup {
  p: number[] = []; uv: number[] = [];
  tri(a: number[], b: number[], c: number[], ua: number[], ub: number[], uc: number[]) { this.p.push(...a, ...b, ...c); this.uv.push(...ua, ...ub, ...uc); }
  quad(a: number[], b: number[], c: number[], d: number[], u0: number, u1: number, v0: number, v1: number) {
    this.tri(a, b, c, [u0, v0], [u1, v0], [u1, v1]); this.tri(a, c, d, [u0, v0], [u1, v1], [u0, v1]);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals(); return g;
  }
}

export const block: BlockModule = {
  id: 'b02-sciences',
  install(ctx: BlockInstallContext) {
    const t0 = performance.now();
    const created: THREE.Material[] = [];
    const found: Record<string, string> = {};
    const pick = (names: string[], color: number, label: string) => {
      for (const n of names) { const m = ctx.material(n); if (m) { found[label] = n; return m; } }
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.88 }); m.name = `b02 ${label}`; created.push(m); found[label] = `created ${m.name}`; return m;
    };
    const roofMat = pick(ROOF, 0xcfcac0, 'roof');
    // Clay tile hips/gables: LiDAR pitch 21-25 deg; red tile in the accepted overviews b02-r0-a1/a2.
    const tileMat = pick(['Welch south calibrated terracotta roof'], 0x9a654b, 'tile roof');
    // D03 NMS finishes (own; textured offline context families, plain glazing / mullions).
    const finish = new TexturedFinish(ctx.renderer);
    const nmsBrick = finish.material('buffBrick', '#d0b48f', 'b02 NMS textured buff brick');
    const nmsBand = finish.material('limestone', '#ddd3bf', 'b02 NMS pale stone eave band');
    const nmsPlant = finish.material('metal', '#aeb2b5', 'b02 NMS roof plant metal', 0.3);
    const nmsGlass = new THREE.MeshStandardMaterial({ color: 0x4e6a5d, roughness: 0.22, metalness: 0.25 }); nmsGlass.name = 'b02 NMS green-tinted bay glazing';
    const nmsMullion = new THREE.MeshStandardMaterial({ color: 0xe9e7e0, roughness: 0.55, metalness: 0.2 }); nmsMullion.name = 'b02 NMS white bay mullions';
    created.push(nmsGlass, nmsMullion);
    const nmsStats = { bays: 0, bayFaces: 0, bandSegments: 0, punchedReplaced: 0 };
    let roofTris = 0;
    const solidSoups = new Map<THREE.Material, Soup>();
    const detailSoups = new Map<THREE.Material, Soup>();
    const soupOf = (map: Map<THREE.Material, Soup>, m: THREE.Material) => { let s = map.get(m); if (!s) map.set(m, s = new Soup()); return s; };
    const colliders: RAPIER.Collider[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    let windows = 0;
    const perRecord: Record<string, { pieces: number; area: number }> = {};
    const pieces = (bodies as unknown as { pieces: Piece[] }).pieces;
    for (const piece of pieces) {
      const skin = SKIN[piece.record];
      const wall = piece.record === 'NMS' ? nmsBrick : pick(skin.wall, skin.color, `${piece.record} wall`);
      const base = pick(skin.base, skin.baseColor, `${piece.record} base`);
      const glass = pick(skin.glass, 0x46525c, `${piece.record} glass`);
      const rings = piece.rings, top = piece.top, pitched = usesSections(piece);
      const H = (x: number, z: number) => roofAt(piece, x, z).h;
      let bottom = Infinity;
      for (const r of rings) for (const [x, z] of r) bottom = Math.min(bottom, ctx.groundHeight(x, z));
      bottom -= 1.0;
      // Per-piece collider soup: exactly the solid triangles rendered for this piece.
      const own = new Soup();
      const both = (m: THREE.Material, f: (s: Soup) => void) => { f(soupOf(solidSoups, m)); f(own); };
      const floorH = (top - piece.groundY) / skin.floors;
      for (const ring of rings) for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
        if (len < 1e-3) continue;
        let nx = dz / len, nz = -dx / len;
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        if (inSolid(mx + nx * 0.05, mz + nz * 0.05, rings)) { nx = -nx; nz = -nz; }
        // Order a->b so the quad faces outward (counter-clockwise seen from outside).
        const [p, q] = (dx * nz - dz * nx) > 0 ? [a, b] : [b, a];
        const ux = (q[0] - p[0]) / len, uz = (q[1] - p[1]) / len;
        // Split points: every 2.5 m for flat pieces; for pitched pieces exactly where the edge crosses the
        // roof grid lines, so wall tops meet the roof triangles vertex for vertex (no slivers at gables).
        const cuts = [0, len];
        if (pitched) {
          const [sa, ta] = toST(p[0], p[1]), [sb, tb] = toST(q[0], q[1]);
          for (const [c0, c1] of [[sa, sb], [ta, tb]]) {
            if (Math.abs(c1 - c0) < 1e-9) continue;
            for (let k = Math.ceil(Math.min(c0, c1) / GRID); k * GRID < Math.max(c0, c1); k++) { const f = (k * GRID - c0) / (c1 - c0); if (f > 1e-6 && f < 1 - 1e-6) cuts.push(f * len); }
          }
        } else for (let k = 1, n = Math.max(1, Math.ceil(len / 2.5)); k < n; k++) cuts.push(k * len / n);
        cuts.sort((m, n) => m - n);
        const segs: { d0: number; d1: number; keep: boolean; low: number }[] = [];
        const at = (d: number): Pt => [p[0] + ux * d, p[1] + uz * d];
        for (let k = 0; k + 1 < cuts.length; k++) {
          const d0 = cuts[k], d1 = cuts[k + 1];
          if (d1 - d0 < 1e-6) continue;
          // Neighbour pieces within 0.7 m outside: a roof at least as high hides the sub-segment; a lower one
          // hides it up to its own roof (that part is not built, so no coincident party walls remain). Between pitched
          // pieces the comparison allows 0.35 m (slope x probe distance) so both sides of a slot never build facing walls.
          const [cx, cz] = at((d0 + d1) / 2), mine = Math.max(H(...at(d0)), H(...at(d1)));
          let full = false, low = -Infinity;
          for (const d of [0.08, 0.15, 0.3, 0.45, 0.6, 0.7]) {
            const sx = cx + nx * d, sz = cz + nz * d;
            for (const o of pieces) if (inSolid(sx, sz, o.rings)) { const r = roofAt(o, sx, sz), hn = r.h; if (o === piece || hn >= mine - (pitched || r.pitched ? 0.35 : 0.01)) full = true; else low = Math.max(low, hn); }
          }
          segs.push({ d0, d1, keep: !full, low });
        }
        const P = (s: Pt, y: number) => [s[0], y, s[1]];
        for (const g of segs) {
          if (!g.keep) continue;
          const A = at(g.d0), B = at(g.d1), tA = H(...A), tB = H(...B);
          const gr = Math.min(ctx.groundHeight(A[0] + nx * 0.6, A[1] + nz * 0.6), ctx.groundHeight(B[0] + nx * 0.6, B[1] + nz * 0.6));
          const from = Math.max(bottom, g.low);
          const bA = Math.min(tA, Math.max(bottom + 0.2, gr + skin.baseH)), bB = Math.min(tB, Math.max(bottom + 0.2, gr + skin.baseH));
          if (from < Math.max(bA, bB)) both(base, s => s.tri(P(A, from), P(B, from), P(B, Math.max(from, bB)), [g.d0, from], [g.d1, from], [g.d1, Math.max(from, bB)]));
          if (from < Math.max(bA, bB)) both(base, s => s.tri(P(A, from), P(B, Math.max(from, bB)), P(A, Math.max(from, bA)), [g.d0, from], [g.d1, Math.max(from, bB)], [g.d0, Math.max(from, bA)]));
          const wA = Math.max(bA, from), wB = Math.max(bB, from);
          if (tA > wA + 1e-4 || tB > wB + 1e-4) {
            both(wall, s => s.tri(P(A, wA), P(B, wB), P(B, Math.max(wB, tB)), [g.d0, wA], [g.d1, wB], [g.d1, Math.max(wB, tB)]));
            both(wall, s => s.tri(P(A, wA), P(B, Math.max(wB, tB)), P(A, Math.max(wA, tA)), [g.d0, wA], [g.d1, Math.max(wB, tB)], [g.d0, Math.max(wA, tA)]));
          }
        }
        // D03 NMS: pale stone band under flat eave segments; glazed bays (glass, floor + vertical mullions) on z-facing walls.
        if (piece.record === 'NMS') {
          const Q = (soup: Soup, s0: number, s1: number, y0: number, y1: number, off: number) => {
            const A = [p[0] + ux * s0 + nx * off, y0, p[1] + uz * s0 + nz * off], B = [p[0] + ux * s1 + nx * off, y0, p[1] + uz * s1 + nz * off];
            soup.quad(A, B, [B[0], y1, B[2]], [A[0], y1, A[2]], s0, s1, y0, y1);
          };
          for (const g of segs) {
            if (!g.keep) continue;
            const tA = H(...at(g.d0)), tB = H(...at(g.d1)), gr = ctx.groundHeight(...at((g.d0 + g.d1) / 2));
            if (Math.abs(tA - tB) < 0.05 && tA > gr + 8) { Q(soupOf(detailSoups, nmsBand), g.d0, g.d1, tA - NMS_DETAIL.band.below - NMS_DETAIL.band.height, tA - NMS_DETAIL.band.below, 0.035); nmsStats.bandSegments++; }
          }
          if (Math.abs(nz) > 0.9 && Math.abs(ux) > 0.9) {
            let faceBays = 0;
            for (const [xa, xb] of nmsBaySpans()) {
              const sa = (xa - p[0]) / ux, sb = (xb - p[0]) / ux, s0 = Math.max(0.3, Math.min(sa, sb)), s1 = Math.min(len - 0.3, Math.max(sa, sb));
              if (s1 - s0 < 1.0) continue;
              const g = segs.find(x => x.d0 <= (s0 + s1) / 2 && (s0 + s1) / 2 <= x.d1); if (!g || !g.keep) continue;
              const gr = ctx.groundHeight(...at((s0 + s1) / 2)), y0 = Math.max(gr + skin.baseH + 0.3, g.low + 0.3);
              const y1 = Math.min(H(...at(s0)), H(...at(s1))) - NMS_DETAIL.band.below - NMS_DETAIL.band.height - 0.15;
              if (y1 - y0 < 3) continue;
              Q(soupOf(detailSoups, nmsGlass), s0, s1, y0, y1, 0.04);
              const ms = soupOf(detailSoups, nmsMullion);
              Q(ms, s0, s1, y0 - 0.1, y0 + 0.1, 0.07); Q(ms, s0, s1, y1 - 0.1, y1 + 0.1, 0.07);
              for (let f = 1; f < skin.floors; f++) { const y = piece.groundY + f * floorH; if (y > y0 + 0.4 && y < y1 - 0.4) Q(ms, s0, s1, y - 0.07, y + 0.07, 0.07); }
              for (const fr of [1 / 3, 2 / 3]) { const sm = s0 + (s1 - s0) * fr; Q(ms, sm - 0.05, sm + 0.05, y0, y1, 0.07); }
              nmsStats.bays++; faceBays++;
            }
            if (faceBays) nmsStats.bayFaces++;
          }
        }
        // Punched windows: visual detail 3 cm proud of the wall, one per bay and floor above the base course.
        const bays = Math.floor((len - 1.2) / skin.bay);
        if (bays < 1) continue;
        const off = (len - bays * skin.bay) / 2, gs = soupOf(detailSoups, glass);
        const g0 = ctx.groundHeight(mx + nx * 0.6, mz + nz * 0.6);
        for (let f = 0; f < skin.floors; f++) {
          const y0 = piece.groundY + f * floorH + floorH * 0.32, y1 = y0 + Math.min(floorH * 0.5, 2.2);
          if (y0 < g0 + skin.baseH + 0.4) continue;
          for (let k = 0; k < bays; k++) {
            const s0 = off + k * skin.bay + (skin.bay - skin.win) / 2, s1 = s0 + skin.win, mid = (s0 + s1) / 2;
            const g = segs.find(x => x.d0 <= mid && mid <= x.d1);
            if (!g || !g.keep || y0 < g.low + 0.3) continue;
            if (y1 > Math.min(H(...at(s0)), H(...at(s1))) - 0.6) continue;
            if (piece.record === 'NMS') {
              if (inNmsBayRun(p[0] + ux * mid, Math.abs(nz))) { nmsStats.punchedReplaced++; continue; }
              if (y1 > Math.min(H(...at(s0)), H(...at(s1))) - NMS_DETAIL.band.below - NMS_DETAIL.band.height - 0.1) continue;
            }
            const A = [p[0] + ux * s0 + nx * 0.03, y0, p[1] + uz * s0 + nz * 0.03], B = [p[0] + ux * s1 + nx * 0.03, y0, p[1] + uz * s1 + nz * 0.03];
            gs.quad(A, B, [B[0], y1, B[2]], [A[0], y1, A[2]], s0, s1, y0, y1); windows++;
          }
        }
      }
      if (!pitched) {
        // Flat roof deck at the measured LiDAR tier Y (holes = open courts / taller tiers).
        const outer = rings[0].map(([x, z]) => new THREE.Vector2(x, z));
        const holes = rings.slice(1).map(h => h.map(([x, z]) => new THREE.Vector2(x, z)));
        const all = [...outer, ...holes.flat()];
        for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(outer, holes)) {
          const A = all[i], B = all[j], C = all[k];
          const up = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) < 0; // y-up normal for (x, z) winding
          const [b2, c2] = up ? [B, C] : [C, B];
          both(roofMat, s => s.tri([A.x, top, A.y], [b2.x, top, b2.y], [c2.x, top, c2.y], [A.x, A.y], [b2.x, b2.y], [c2.x, c2.y]));
        }
      } else {
        // Pitched roof: the piece clipped to a 1 m grid in the (s,t) frame; every vertex lies on the fitted
        // section surface, so ridges/eaves follow grid lines and hips are resolved at 1 m.
        const st = rings.map(r => r.map(([x, z]) => toST(x, z)));
        const ss = st[0].map(v => v[0]), ts = st[0].map(v => v[1]);
        for (let s0 = Math.floor(Math.min(...ss) / GRID) * GRID; s0 < Math.max(...ss); s0 += GRID) for (let t0 = Math.floor(Math.min(...ts) / GRID) * GRID; t0 < Math.max(...ts); t0 += GRID) {
          const O = clipCell(st[0], s0, s0 + GRID, t0, t0 + GRID);
          if (O.length < 3 || Math.abs(area2(O)) < 1e-4) continue;
          const hs = st.slice(1).map(h => clipCell(h, s0, s0 + GRID, t0, t0 + GRID)).filter(h => h.length >= 3 && Math.abs(area2(h)) > 1e-4);
          if (hs.some(h => Math.abs(area2(h)) >= Math.abs(area2(O)) - 1e-6)) continue;
          const all = [O, ...hs].flat();
          const tris = THREE.ShapeUtils.triangulateShape(O.map(v => new THREE.Vector2(v[0], v[1])), hs.map(h => h.map(v => new THREE.Vector2(v[0], v[1]))));
          for (const tri of tris) {
            const pts = tri.map(i => { const [x, z] = fromST(all[i][0], all[i][1]); const r = roofAt(piece, x, z); return { x, z, ...r }; });
            const [A, B, C] = pts;
            const up = (B.x - A.x) * (C.z - A.z) - (B.z - A.z) * (C.x - A.x) < 0;
            const [b2, c2] = up ? [B, C] : [C, B];
            both(tileMat, s => s.tri([A.x, A.h, A.z], [b2.x, b2.h, b2.z], [c2.x, c2.h, c2.z], [A.u, A.v], [b2.u, b2.v], [c2.u, c2.v]));
            roofTris++;
          }
        }
      }
      const cg = own.geometry(); geometries.push(cg);
      const pos = cg.getAttribute('position').array as Float32Array;
      colliders.push(ctx.physics.createCollider(RAPIER.ColliderDesc.trimesh(pos, Uint32Array.from({ length: pos.length / 3 }, (_v, i) => i), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.8)));
      const r = perRecord[piece.record] ??= { pieces: 0, area: 0 }; r.pieces++; r.area += piece.area;
    }
    const solids: THREE.Object3D[] = [], detail: THREE.Object3D[] = [];
    const plant = buildNmsRoofPlant(ctx.physics, nmsPlant);
    solids.push(plant.mesh); colliders.push(plant.collider); geometries.push(plant.geometry);
    // D03 SSB (own meshes 'b02 SSB ...', own collider appended last).
    const ssbRecord = ctx.data.buildings.find(b => b.key === SSB_KEY);
    if (!ssbRecord) throw new Error('b02: SSB record 656376:923 missing');
    const ssbGlass = new THREE.MeshStandardMaterial({ color: 0x3b464e, roughness: 0.25, metalness: 0.25 }); ssbGlass.name = 'b02 SSB glazing'; created.push(ssbGlass);
    const ssb = buildSsb(ssbRecord.rings[0], ctx.groundHeight, ctx.physics, {
      precast: finish.material('precast', '#ddd6c6', 'b02 SSB pale precast'), tile: finish.material('clayTile', '#b65a3c', 'b02 SSB clay tile roof'),
      brick: finish.material('brownBrick', '#a5624a', 'b02 SSB red brick infill'), glass: ssbGlass }, (geo, pitched) => metreUVs(geo, pitched));
    solids.push(...ssb.solids); detail.push(...ssb.detail); colliders.push(ssb.collider); geometries.push(...ssb.geometries);
    for (const [m, s] of solidSoups) { const g = s.geometry(); geometries.push(g); const mesh = new THREE.Mesh(g, m); mesh.name = `b02 science bodies: ${m.name}`; mesh.castShadow = mesh.receiveShadow = true; solids.push(mesh); }
    for (const [m, s] of detailSoups) { const g = s.geometry(); geometries.push(g); const mesh = new THREE.Mesh(g, m); mesh.name = `b02 science bodies windows: ${m.name}`; mesh.receiveShadow = true; detail.push(mesh); }
    return {
      solids, detail, colliders,
      replaced: ['655081:892', '-201:add', SSB_KEY],
      stats: { ssb: ssb.stats, nms: { ...nmsStats, plantTriangles: plant.triangles, housings: NMS_DETAIL.housings.length, stacks: NMS_DETAIL.stacks.length, ownTextures: finish.textures.length }, pitchedRoofTriangles: roofTris, sections: SECTIONS.map(q => q.id), pieces: (bodies as unknown as { pieces: Piece[] }).pieces.length, perRecord, windows, materials: found, installMs: Math.round(performance.now() - t0) },
      dispose() {
        for (const c of colliders) try { if (ctx.physics.getCollider(c.handle)) ctx.physics.removeCollider(c, false); } catch { /* already removed */ }
        for (const g of geometries) g.dispose();
        for (const m of created) m.dispose();
        finish.dispose();
      },
    };
  },
};
