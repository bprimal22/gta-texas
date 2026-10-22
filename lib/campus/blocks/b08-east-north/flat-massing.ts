// b08 private: replacement of a FLAT-roofed generated building from its own context.json massing (same rings, same datum,
// same volume tops -> the LiDAR roof assertions keep measuring the same heights), with a photo/orbit-interpreted facade:
// real recessed openings (ribbon / punched / open garage decks) on a fixed absolute floor grid, all recesses inside the GIS
// line (nothing reaches sidewalks), local PBR wall/roof families, visual-only coping/mullions/rails.
import * as THREE from 'three';
import type { Point } from '../../types';
import type { BlockInstallContext, BlockMassingVolume } from '../types';
import { Kit, outward, unit, V, UP, DOWN, type Mat } from './lane-kit';

export type OpeningKind = 'ribbon' | 'punched' | 'deck';
export interface FacadeStyle {
  wall: Mat; wallColor: THREE.Color; roof: Mat; roofColor: THREE.Color; coping: THREE.Color;
  /** Absolute campus Y of floor 0 and floor height. */
  origin: number; floor: number;
  /** Opening kind per floor index (null = solid floor band). */
  kind: (floor: number) => OpeningKind | null;
  sill: number; head: number; recess: number; glass: THREE.Color; glassMat: 'glass' | 'matte';
  punched?: { width: number; pitch: number }; deck?: { bay: number; pier: number };
  mullion?: { pitch: number; color: THREE.Color }; rail?: THREE.Color; minEdge?: number;
  /** Visual coping band height at the wall top (default 0.35 m) and whether punched slots also get mullions. */
  copingHeight?: number; mullionOnPunched?: boolean;
}
export interface Massing { volumes: BlockMassingVolume[]; datum?: 'grade' | 'campusY' | { aboveY: number } }
/** A lane volume as an occluder: plan rings and the height span it fills. */
export interface Occluder { id: string; rings: Point[][]; bottom: number; top: number; box: [number, number, number, number] }
const boxOf = (r: Point[]): [number, number, number, number] => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return [x0, x1, z0, z1]; };
const pin = (x: number, z: number, r: Point[]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const datumOf = (key: string, m: Massing) => { const hb = m.datum === 'campusY' ? 0 : m.datum && typeof m.datum === 'object' ? m.datum.aboveY : NaN; if (!Number.isFinite(hb)) throw new Error(`b08 flat massing: ${key} needs an explicit datum`); return hb; };
/** Occluders for every volume of a massing (main volume from the ground up). */
export function occludersOf(ctx: BlockInstallContext, key: string, m: Massing): Occluder[] {
  const b = ctx.data.buildings.find(x => x.key === key); if (!b) throw new Error(`b08 flat massing: ${key} not in campus data`);
  const hb = datumOf(key, m);
  return m.volumes.map((v, i) => { const rings = (v.rings ?? (v.ring ? [v.ring] : b.rings)) as Point[][]; return { id: `${key}#${i}`, rings, bottom: v.ring || v.rings ? hb + v.bottom : -1e3, top: hb + v.top, box: boxOf(rings[0]) }; });
}

/** Build every volume of a flat massing. `styleFor` picks the facade per volume (index, volume). */
export function buildFlatMassing(kit: Kit, ctx: BlockInstallContext, key: string, m: Massing, styleFor: (i: number, v: BlockMassingVolume) => FacadeStyle, occluders: Occluder[] = []) {
  const b = ctx.data.buildings.find(x => x.key === key);
  if (!b) throw new Error(`b08 flat massing: ${key} not in campus data`);
  if (m.volumes.some(v => v.roof !== 'flat')) throw new Error(`b08 flat massing: ${key} has a non-flat volume`);
  const hb = datumOf(key, m);
  const g = ctx.groundHeight;
  let edges = 0, openings = 0, hidden = 0;
  /** Cover height just outside an edge point: starting at the wall bottom, repeatedly take the top of any other lane volume
   * containing a sample 5 / 30 / 60 cm outside whose bottom is at or below the current cover (stacked main + tier volumes).
   * Walls are only built above the cover, so no hidden back-to-back recesses or slivers behind a neighbouring wall remain. */
  const coverAt = (cands: Occluder[], x: number, z: number, n: Point, y0: number) => {
    const inside = cands.filter(o => [0.05, 0.3, 0.6].some(d => { const px = x + n[0] * d, pz = z + n[1] * d; return px >= o.box[0] && px <= o.box[1] && pz >= o.box[2] && pz <= o.box[3] && pin(px, pz, o.rings[0]); }));
    let h = y0, grew = true;
    while (grew) { grew = false; for (const o of inside) if (o.bottom <= h + 0.05 && o.top > h + 1e-6) { h = o.top; grew = true; } }
    return h > y0 ? h : -Infinity;
  };
  m.volumes.forEach((v, i) => {
    const main = !v.ring && !v.rings;
    const rings = (v.rings ?? (v.ring ? [v.ring] : b.rings)) as Point[][];
    const top = hb + v.top, style = styleFor(i, v);
    const insideVol = (x: number, z: number) => pin(x, z, rings[0]) && !rings.slice(1).some(h => pin(x, z, h));
    rings.forEach((ring, ri) => {
      for (let e = 0; e < ring.length; e++) {
        const a = ring[e], c = ring[(e + 1) % ring.length];
        if (Math.hypot(c[0] - a[0], c[1] - a[1]) < 0.05) continue;
        const n0 = outward(ring, e), n: Point = ri === 0 ? n0 : [-n0[0], -n0[1]];
        const g0 = Math.min(g(a[0], a[1]), g(c[0], c[1]));
        const bottom = main ? g0 - 0.6 : hb + v.bottom;
        const grade = main ? Math.max(g(a[0], a[1]), g(c[0], c[1])) : bottom;
        // Cover profile along the edge (0.25 m steps; each step takes the highest cover at its ends and middle), merged into
        // runs of equal cover height.
        const L = Math.hypot(c[0] - a[0], c[1] - a[1]), steps = Math.max(1, Math.round(L / 0.25)), runs: [number, number, number][] = [];
        const ex = [Math.min(a[0], c[0]) - 0.7, Math.max(a[0], c[0]) + 0.7, Math.min(a[1], c[1]) - 0.7, Math.max(a[1], c[1]) + 0.7];
        const cands = occluders.filter(o => o.id !== `${key}#${i}` && o.rings.length && o.box[0] <= ex[1] && o.box[1] >= ex[0] && o.box[2] <= ex[3] && o.box[3] >= ex[2]);
        for (let k = 0; k < steps; k++) {
          let cov = -Infinity;
          for (const f of [k / steps, (k + 0.5) / steps, (k + 1) / steps]) cov = Math.max(cov, (cands.length ? coverAt(cands, a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f, n, bottom) : -Infinity));
          const h = Math.max(bottom, Math.min(cov, top)), last = runs[runs.length - 1];
          if (last && Math.abs(last[2] - h) < 1e-6) last[1] = (k + 1) / steps; else runs.push([k / steps, (k + 1) / steps, h]);
        }
        for (const [f0, f1, from] of runs) {
          if (from >= top - 0.01) { hidden++; continue; }
          const p0: Point = [a[0] + (c[0] - a[0]) * f0, a[1] + (c[1] - a[1]) * f0], p1: Point = [a[0] + (c[0] - a[0]) * f1, a[1] + (c[1] - a[1]) * f1];
          openings += facadeEdge(kit, p0, p1, n, from, top, Math.max(grade, from), style, true, insideVol);
        }
        edges++;
      }
    });
    kit.cap('solid', style.roof, rings, top, style.roofColor);
  });
  return { volumes: m.volumes.length, edges, hiddenEdges: hidden, openings, datum: hb };
}

/** One wall edge from `bottom` to `top` with the style's floor bands; returns the number of openings. */
export function facadeEdge(kit: Kit, a: Point, b: Point, n: Point, bottom: number, top: number, grade: number, s: FacadeStyle, coping = true,
  inside: (x: number, z: number) => boolean = () => true) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), T = unit(a, b);
  const P = (t: number, d: number, y: number) => V(a[0] + T[0] * t - n[0] * d, y, a[1] + T[1] * t - n[1] * d);
  const out = V(n[0], 0, n[1]);
  const face = (t0: number, t1: number, d: number, y0: number, y1: number, c: THREE.Color, mat: Mat) => {
    if (t1 - t0 > 0.01 && y1 - y0 > 0.01) kit.quad('solid', mat, P(t0, d, y0), P(t1, d, y0), P(t1, d, y1), P(t0, d, y1), c, out);
  };
  // Coping band (visual, 2 cm proud, 0.35 m).
  const ch = s.copingHeight ?? 0.35;
  if (coping) kit.quad('detail', s.wall, P(0, -0.02, top - ch), P(L, -0.02, top - ch), P(L, -0.02, top), P(0, -0.02, top), s.coping, out);
  // Horizontal opening intervals for this edge.
  // Openings keep (recess + 0.25) m clear of both edge ends, so at a concave corner the recess never cuts through the
  // neighbouring wall (no fins, every face backed by its own collider).
  const end = s.recess + 0.25;
  const spans = (kind: OpeningKind): [number, number][] => {
    if (L < (s.minEdge ?? 2.5)) return [];
    let sp: [number, number][];
    if (kind === 'ribbon') sp = [[end, L - end]];
    else if (kind === 'punched') { const p = s.punched!, k = Math.floor((L - 0.8) / p.pitch); if (k < 1) return []; const t0 = (L - k * p.pitch) / 2; sp = Array.from({ length: k }, (_, j) => [t0 + j * p.pitch + (p.pitch - p.width) / 2, t0 + j * p.pitch + (p.pitch + p.width) / 2] as [number, number]); }
    else { const d = s.deck!, k = Math.max(1, Math.round(L / d.bay)), bw = L / k; if (bw - d.pier < 1.2) return []; sp = Array.from({ length: k }, (_, j) => [j * bw + d.pier / 2, (j + 1) * bw - d.pier / 2] as [number, number]); }
    // Keep only openings whose recess back (plus 0.15 m) stays inside the footprint (no cut-through in narrow jogs).
    const back = (t: number) => { const p = P(t, s.recess + 0.15, 0); return inside(p.x, p.z); };
    return sp.map(([a, b]): [number, number] => [Math.max(a, end), Math.min(b, L - end)])
      .filter(([a, b]) => b - a >= 0.9 && back(a + 0.1) && back((a + b) / 2) && back(b - 0.1));
  };
  const bands: { y0: number; y1: number; spans: [number, number][]; kind: OpeningKind }[] = [];
  for (let f = Math.max(0, Math.floor((bottom - s.origin) / s.floor)); ; f++) {
    const y = s.origin + f * s.floor; if (y > top) break;
    const kind = s.kind(f); if (!kind) continue;
    const y0 = y + s.sill, y1 = Math.min(y + s.head, top - 0.6);
    if (y0 < bottom + 1.05 || y0 < grade + 0.5 || y1 - y0 < 0.9) continue;   // sills >= 1.05 m above the wall base (also above a lower roof)
    const sp = spans(kind); if (sp.length) bands.push({ y0, y1, spans: sp, kind });
  }
  let yPrev = bottom, count = 0;
  for (const band of bands) {
    face(0, L, 0, yPrev, band.y0, s.wallColor, s.wall);
    let tPrev = 0;
    for (const [t0, t1] of band.spans) {
      face(tPrev, t0, 0, band.y0, band.y1, s.wallColor, s.wall);
      const r = s.recess, back = band.kind === 'deck' ? 'matte' : s.glassMat;
      face(t0, t1, r, band.y0, band.y1, s.glass, back);
      kit.quad('solid', s.wall, P(t0, 0, band.y0), P(t0, r, band.y0), P(t0, r, band.y1), P(t0, 0, band.y1), s.wallColor, V(T[0], 0, T[1]));
      kit.quad('solid', s.wall, P(t1, r, band.y0), P(t1, 0, band.y0), P(t1, 0, band.y1), P(t1, r, band.y1), s.wallColor, V(-T[0], 0, -T[1]));
      kit.quad('solid', s.wall, P(t0, 0, band.y1), P(t1, 0, band.y1), P(t1, r, band.y1), P(t0, r, band.y1), s.wallColor, DOWN);
      kit.quad('solid', s.wall, P(t0, r, band.y0), P(t1, r, band.y0), P(t1, 0, band.y0), P(t0, 0, band.y0), s.wallColor, UP);
      if (s.mullion && (band.kind === 'ribbon' || (band.kind === 'punched' && s.mullionOnPunched))) for (let t = t0 + s.mullion.pitch; t < t1 - 0.2; t += s.mullion.pitch) {
        const q = (dt: number, y: number) => P(t + dt, r - 0.03, y);
        kit.mb('detail', 'metal').quad(q(-0.05, band.y0), q(0.05, band.y0), q(0.05, band.y1), q(-0.05, band.y1), [0, 0], [1, 0], [1, 1], [0, 1], s.mullion.color, out);
      }
      if (s.rail && band.kind === 'deck') {   // guard rail line across the deck opening (visual)
        const yr = band.y0 + 0.75, q = (t: number, y: number) => P(t, 0.12, y);
        kit.mb('detail', 'metal').quad(q(t0, yr), q(t1, yr), q(t1, yr + 0.07), q(t0, yr + 0.07), [0, 0], [1, 0], [1, 1], [0, 1], s.rail, out);
      }
      tPrev = t1; count++;
    }
    face(tPrev, L, 0, band.y0, band.y1, s.wallColor, s.wall);
    yPrev = band.y1;
  }
  face(0, L, 0, yPrev, top, s.wallColor, s.wall);
  return count;
}
