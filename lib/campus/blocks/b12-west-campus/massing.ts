// b12: rebuild a record's EXISTING context.json massing volumes (same rings, same heights) as authored prisms, so a
// replaced record keeps its measured / published tiers exactly; identity detail is then added on top by the callers.
import type * as THREE from 'three';
import type { Point, CampusData } from '../../types';
import type { BlockMassingVolume } from '../types';
import ctxData from './context.json' with { type: 'json' };
import { Kit, orient, edgesOf, inRing, at, UP, type Edge, type Face } from './kit';

type Massing = { volumes: BlockMassingVolume[]; datum?: 'grade' | 'campusY' | { aboveY: number } };
const MASSING = (ctxData as unknown as { massing: Record<string, Massing> }).massing;

/** Per record: ring regularisation applied to tier/mech rings (main / record rings stay exact). */
export const SIMPLIFY_REPORT: Record<string, { tolerance: number; snap: number; volumes: Record<number, { deletedVertices: number; maxDeletedDeviation: number }> }> = {};
export interface Vol { i: number; role: string; ring: Point[]; bottom: number; top: number; fromGround: boolean; archetype?: string }

/** Volumes of a record in absolute campus Y (only aboveY / campusY datums are used in b12 for rebuilt records). */
export function volumesOf(key: string, data: CampusData): Vol[] {
  const m = MASSING[key]; if (!m) throw new Error(`b12: no massing for ${key}`);
  const d = m.datum; if (!d || d === 'grade') throw new Error(`b12: ${key} massing has a grade datum (not rebuildable in absolute Y)`);
  const base = d === 'campusY' ? 0 : d.aboveY;
  const rec = data.buildings.find(b => b.key === key); if (!rec) throw new Error(`b12: record ${key} not in the data`);
  const vols = m.volumes.map((v, i) => ({ i, role: v.role ?? 'main', ring: orient(v.rings?.[0] ?? v.ring ?? rec.rings[0]), bottom: base + v.bottom, top: base + v.top, fromGround: v.bottom === 0, archetype: v.archetype }));
  // LiDAR tier rings were cut from the raster and run a few decimetres off the City ring / each other: snap every tier/mech
  // vertex lying within SNAP of another volume's edge (or the record ring) onto it, so neighbouring walls coincide instead of
  // leaving narrow crevices between volumes (heights unchanged; plan moves <= SNAP = 0.5 m, an implementation tolerance).
  // First drop LiDAR-noise notches/spikes of the explicit volume rings: a vertex closer than SIMPLIFY to the chord of its
  // neighbours is removed (repeatedly, smallest first): a plan tolerance of 0.6 m (implementation choice, not a measured
  // value). Deleted count and the maximum deviation per record are reported (SIMPLIFY_REPORT) and checked by the b12 harness.
  const SIMPLIFY = 0.6;
  for (const v of vols) {
    if ((!m.volumes[v.i].ring && !m.volumes[v.i].rings) || v.role === 'main') continue; // official/City wing rings stay exact
    let r = v.ring.slice(), deleted = 0, maxDev = 0;
    for (;;) {
      if (r.length <= 4) break;
      let bi = -1, bd = SIMPLIFY;
      for (let j = 0; j < r.length; j++) {
        const pv = r[(j + r.length - 1) % r.length], nx = r[(j + 1) % r.length], d = Math.hypot(...sub2(r[j], closest(r[j], pv, nx)));
        if (d < bd) { bd = d; bi = j; }
      }
      if (bi < 0) break; // every deletion is bounded by its real perpendicular deviation from the neighbour chord (< SIMPLIFY)
      deleted++; maxDev = Math.max(maxDev, bd);
      r = r.filter((_p, j) => j !== bi);
    }
    v.ring = orient(r);
    const rep = SIMPLIFY_REPORT[key] ??= { tolerance: SIMPLIFY, snap: 0, volumes: {} };
    rep.volumes[v.i] = { deletedVertices: deleted, maxDeletedDeviation: +maxDev.toFixed(3) };
  }
  const SNAP = 0.5, rings = [orient(rec.rings[0]), ...vols.map(v => v.ring)];
  for (let pass = 0; pass < 2; pass++) for (const v of vols) {
    if (!v.ring.length || v.role === 'main') continue; // main volumes keep the exact City / official UT wing rings
    v.ring = v.ring.map(p => {
      let best: Point = p, bd = SNAP;
      for (const r of rings) { if (r === v.ring) continue; for (let j = 0; j < r.length; j++) { const q = closest(p, r[j], r[(j + 1) % r.length]), d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d > 1e-4 && d < bd) { bd = d; best = q; } } }
      return best;
    });
    rings[v.i + 1] = v.ring;
  }
  if (SIMPLIFY_REPORT[key]) SIMPLIFY_REPORT[key].snap = SNAP;
  return vols;
}
const sub2 = (p: Point, q: Point): [number, number] => [p[0] - q[0], p[1] - q[1]];
const closest = (p: Point, a: Point, b: Point): Point => { const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l)) : 0; return [a[0] + t * dx, a[1] + t * dz]; };
export const recordRing = (key: string, data: CampusData) => { const r = data.buildings.find(b => b.key === key); if (!r) throw new Error(`b12: record ${key} missing`); return orient(r.rings[0]); };
/** Slot closures made by buildVolumes in this install (reported in stats). */
export const SLOT_REPORT = { caps: 0 };
export const ringGroundMin = (ring: Point[], g: (x: number, z: number) => number) => Math.min(...ring.map(p => g(p[0], p[1])));

/** Build every volume as a flat prism (walls + deck); volumes standing on the ground start 1 m below the lowest
 * visible ground along their ring. `wallColor(vol, edge)` picks the wall colour; `skipEdge` lets callers own a face. */
export function buildVolumes(k: Kit, vols: Vol[], g: (x: number, z: number) => number, wallColor: (v: Vol, e: Edge) => THREE.Color, roof: THREE.Color,
  o: { skipEdge?: (v: Vol, e: Edge) => boolean; capRing?: (v: Vol) => Point[] | undefined; topOf?: (v: Vol) => number; noCap?: (v: Vol) => boolean } = {}) {
  const faces = new Map<string, Face[]>();
  let slotCaps = 0;
  for (const v of vols) {
    const bottom = v.fromGround ? ringGroundMin(v.ring, g) - 1.0 : v.bottom, top = o.topOf?.(v) ?? v.top;
    for (const e of edgesOf(v.ring)) {
      if (o.skipEdge?.(v, e)) continue;
      // parts of the wall hidden inside an overlapping / adjacent volume of the same record are not built (0.5 m runs)
      const n = Math.max(1, Math.ceil(e.L / 0.5)), cov: number[] = [];
      for (let j = 0; j < n; j++) { const sm = (j + 0.5) * e.L / n, px = e.a[0] + e.u.x * sm + e.n.x * 0.3, pz = e.a[1] + e.u.z * sm + e.n.z * 0.3;
        // duplicate coverage: an earlier volume of the same record already spans this wall's whole height here (the UT/City
        // wing rings of 525341 both contain the Nueces Garage lobe) -> that volume builds the wall, this one does not
        const ix = e.a[0] + e.u.x * sm - e.n.x * 0.3, iz = e.a[1] + e.u.z * sm - e.n.z * 0.3;
        const dup = vols.some(w => w !== v && w.i < v.i && w.bottom <= v.bottom + 0.1 && w.top >= top - 0.05 && inRing(ix, iz, w.ring));
        let c = dup ? Infinity : Math.max(-Infinity, ...vols.filter(w => w !== v && w.bottom <= v.bottom + 0.1 && w.top > v.bottom && inRing(px, pz, w.ring)).map(w => w.top));
        // Narrow slot (Group 2 localized fix of the two baseline G3 side misses, Castilian 657418:943 / Co-op 733792:1248):
        // another volume of the same record begins within 1.0 m outside this wall (LiDAR-noise tier rings leave < 1 m
        // crevices between volumes, narrower than wall + neighbour relief (piers / fins <= 0.5 m) + the 0.5 m G3 probe). The
        // wall is then covered up to that neighbour's top like an overlap, and when this wall is the lower side the slot is
        // closed by a deck strip at this volume's top reaching just into the neighbour (no ring or height changes).
        if (c < top - 0.05) {
          const qx = e.a[0] + e.u.x * sm + e.n.x * 1.0, qz = e.a[1] + e.u.z * sm + e.n.z * 1.0;
          const slot = vols.filter(w => w !== v && w.bottom <= v.bottom + 0.1 && w.top > v.bottom && !inRing(px, pz, w.ring) && inRing(qx, qz, w.ring));
          if (slot.length) {
            const st = Math.max(...slot.map(w => w.top)); c = Math.max(c, st);
            if (st >= top - 0.05) {
              let lo = 0.3, hi = 1.0; for (let it = 0; it < 12; it++) { const md = (lo + hi) / 2, mx = e.a[0] + e.u.x * sm + e.n.x * md, mz = e.a[1] + e.u.z * sm + e.n.z * md; if (slot.some(w => inRing(mx, mz, w.ring))) hi = md; else lo = md; }
              const s0 = j * e.L / n, s1 = (j + 1) * e.L / n, d = hi + 0.03;
              k.S().quad(at(e, s0, top, 0), at(e, s1, top, 0), at(e, s1, top, d), at(e, s0, top, d), roof, UP); slotCaps++;
            }
          }
        }
        cov.push(c); }
      const list: Face[] = [];
      for (let j = 0; j < n;) { let m = j; while (m + 1 < n && cov[m + 1] === cov[j]) m++;
        if (cov[j] < top - 0.05) list.push(k.face(e, Math.max(bottom, cov[j]), top, wallColor(v, e), { s0: j === 0 ? 0 : j * e.L / n, s1: m === n - 1 ? e.L : (m + 1) * e.L / n }));
        j = m + 1; }
      if (list.length) faces.set(`${v.i}:${e.i}`, list);
    }
    if (!o.noCap?.(v)) k.cap(k.S(), [o.capRing?.(v) ?? v.ring], top, roof);
  }
  SLOT_REPORT.caps += slotCaps;
  /** The wall face of volume v on edge e (undefined when skipped); attach solid relief to it. */
  return (v: Vol, e: Edge): Face[] | undefined => faces.get(`${v.i}:${e.i}`);
}
