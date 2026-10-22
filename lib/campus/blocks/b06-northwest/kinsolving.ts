// D12 Kinsolving Residence Hall (City record 547842:357), rebuilt by b06 install() in its own kit / meshes / collider
// ('b06 kin ...') so the round-2 meshes and the Honors Quad stay byte-identical (b06 check sections 8b / 8c).
//  * Plan: the OFFICIAL UT GIS outline with both courtyards (context.json footprints 547842:357, objectId 400), unchanged.
//  * Heights: MEASURED. The record's own context.json massing (USGS 3DEP 2017 LiDAR tiers above groundY 16.3): two-storey
//    base 7.8 m over the whole footprint, north block 19.1 m, south bar 17.8 m, west wing 12.8 m, east strip 10.6 m. Tier
//    rings are the measured LiDAR blobs clipped to the official outline, simplified (Douglas-Peucker 0.6 m) so walls are
//    straight; the 3-vertex LiDAR sliver along the west wing is not a wing and is dropped.
//  * Facade: REFERENCE-INTERPRETED from full-map-30m b06-r0-b1-30m (south + west faces across Dean Keeton) and
//    online-photos ut-kin-400-directory-photo.jpg: light buff brick, flat roofs behind a low pale coping.
//  * Windows (appearance follow-up, calibrated on the pixels; ESTIMATES derived from ratios): wide horizontal panes in pale
//    frames split into a PAIR of sashes (centre mullion) with a meeting rail. Photo: window/bay width 40/62 px = 0.65 and
//    window/storey height 30/62 px = 0.48-0.52; b06-r0-b1-30m: ~8 bays on the 27 m main south face (outline edge 10->11).
//    With the storey grid fixed by the measured tiers (2.95 m, 6 storeys in 17.8-19.1 m): bay 3.4 m, window 2.15 x 1.50 m.
//  * Stair strips (KIN_STRIPS): blank brick end piers carrying a centred pale-stone strip with one narrow paired-sash window
//    per storey. Localised by projecting the official outline through the b06-r0-b1-30m camera: the west pavilion's south face
//    (edge 8->9, strip at 0.45-0.60 of the face) and the projecting east bay (edge 13->14, at 0.57-0.65); the directory photo
//    shows the same strip rising from the stone portal, which the OSM steps place on the south bar's east end (edge 16->17,
//    centred over entrance E1). Generic windows are suppressed on those three piers. Strip 2.2 m, window 1.15 x 1.65 m: estimates.
//  * Entrances: located by the mapped footways/steps that end on the outline (OSM 1512521129-1512521132 at the east end of
//    the south bar; 1512521133 at the east face of the middle wing). The photographed two-storey stone frame at the bar's
//    end is drawn there; surround sizes are estimates. Stair-tower glazing and roof penthouses are not localised: omitted.
// Heights are absolute campus Y. Solids form one trimesh collider (visible = physical); panes / frames are flush detail.
import * as THREE from 'three';
import type { Point } from '../../types';
import { offsetRing } from '../../context-geometry';
import { Kit, orient, segDist } from './authored-bodies';
import context from './context.json' with { type: 'json' };

export const KIN_KEY = '547842:357';
/** Plain fallbacks (index.ts MATERIALS); the rendered materials are textured (textured-finish.ts TEXTURED). */
export const KIN_MATERIALS: Record<string, [string, number, number?]> = { kinBrick: ['#d4bb90', 0.9], kinTrim: ['#e3dccb', 0.88], kinPortal: ['#e3dccb', 0.88], kinRoof: ['#9d9a94', 0.95],
  kinGlass: ['#5f6d75', 0.2, 0.3], kinFrame: ['#e6e3da', 0.6] };
const M = (context as unknown as { massing: Record<string, { datum: { aboveY: number }; volumes: { rings?: Point[][]; top: number; role: string }[] }> }).massing[KIN_KEY];
/** LiDAR groundY datum of the measured tiers (context.json massing). */
export const KIN_GROUND = M.datum.aboveY;
export const KIN_BASE_TOP = KIN_GROUND + M.volumes[0].top;
const PARAPET = 0.6, COPING = 0.3;
const STOREY = 2.95, FIRST = KIN_GROUND + 1.0;
export const KIN_WINDOW = { storey: STOREY, first: FIRST, bay: 3.4, width: 2.15, height: 1.5, frame: 0.08, mullion: 0.07, rail: 0.05 };
/** Blank end piers with a stair strip: anchor on the official outline (edge midpoint / fraction), strip centre fraction. */
export const KIN_STRIPS = [
  { name: 'west pavilion south face (b06-r0-b1-30m, outline edge 8->9)', a: [-272.91, -421.57] as Point, c: [-261.24, -420.55] as Point, at: 0.52, from: 'storey2' as const },
  { name: 'projecting east bay south face (b06-r0-b1-30m, outline edge 13->14)', a: [-232.29, -419.05] as Point, c: [-222.64, -418.23] as Point, at: 0.6, from: 'storey2' as const },
  { name: 'south bar east end over entrance E1 (ut-kin-400 photo + OSM steps, outline edge 16->17)', a: [-203.42, -420.58] as Point, c: [-202.83, -427.58] as Point, at: -1, from: 'portal' as const },
];
export const KIN_STRIP = { width: 2.2, window: [1.15, 1.65] as [number, number] };
/** OSM path ends on the outline (campus x,z), wall edge found at build time. */
export const KIN_ENTRANCES = [
  { name: 'south-bar east end (OSM steps 1512521129/1512521131, footway 1512521132)', at: [-203.05, -424.3] as Point, width: 3.8, height: 6.2, door: [2.4, 2.9] as [number, number], storeys: 2 },
  { name: 'middle wing east face (OSM footway 1512521133)', at: [-220.3, -445.2] as Point, width: 3.0, height: 3.5, door: [2.0, 2.7] as [number, number], storeys: 1 },
];

/** Douglas-Peucker on a closed ring (keeps the two farthest-apart vertices as anchors). */
function simplify(ring: Point[], tol: number): Point[] {
  const dp = (pts: Point[]): Point[] => {
    if (pts.length < 3) return pts;
    let worst = -1, at = 0;
    for (let i = 1; i < pts.length - 1; i++) { const d = segDist(pts[i][0], pts[i][1], pts[0], pts[pts.length - 1]); if (d > worst) { worst = d; at = i; } }
    return worst <= tol ? [pts[0], pts[pts.length - 1]] : [...dp(pts.slice(0, at + 1)).slice(0, -1), ...dp(pts.slice(at))];
  };
  let a = 0, b = 0, best = -1;
  for (let i = 0; i < ring.length; i++) for (let j = i + 1; j < ring.length; j++) { const d = Math.hypot(ring[i][0] - ring[j][0], ring[i][1] - ring[j][1]); if (d > best) { best = d; a = i; b = j; } }
  const first = dp(ring.slice(a, b + 1)), second = dp([...ring.slice(b), ...ring.slice(0, a + 1)]);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}
const inside = (x: number, z: number, r: Point[]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const onRings = (a: Point, c: Point, rings: Point[][], tol = 0.35) => { const m: Point = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
  return rings.some(r => r.some((p, i) => segDist(m[0], m[1], p, r[(i + 1) % r.length]) < tol)); };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface KinTier { role: string; ring: Point[]; top: number }
/** Snap a tier vertex onto the official outline when the LiDAR blob edge lies within `tol` of it (GIS wins over wobble). */
function snap(p: Point, base: Point[][], tol: number): Point {
  let bestV: Point | null = null, dv = tol;
  for (const r of base) for (const q of r) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < dv) { dv = d; bestV = q; } }
  if (bestV) return [bestV[0], bestV[1]];
  let best: Point = p, de = tol;
  for (const r of base) for (let i = 0; i < r.length; i++) {
    const a = r[i], c = r[(i + 1) % r.length], dx = c[0] - a[0], dz = c[1] - a[1], l = dx * dx + dz * dz; if (!l) continue;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l)), q: Point = [a[0] + t * dx, a[1] + t * dz], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < de) { de = d; best = q; }
  }
  return best;
}
/** Measured tiers above the base (absolute campus Y): LiDAR blobs simplified (DP 1.0 m) and snapped to the official outline. */
export function kinTiers(base: Point[][]): KinTier[] {
  return M.volumes.slice(1).filter(v => v.rings && v.rings[0].length > 3).map(v => {
    const pts = simplify(v.rings![0], 1.0).map(p => snap(p, base, 1.1)).filter((p, i, a) => Math.hypot(p[0] - a[(i + a.length - 1) % a.length][0], p[1] - a[(i + a.length - 1) % a.length][1]) > 0.05);
    return { role: v.role, ring: orient(pts), top: KIN_GROUND + v.top };
  });
}

/** Flat roof with a parapet: walls are drawn by the caller; this adds coping, inner parapet faces and the deck. */
function parapetDeck(k: Kit, rings: Point[][], deck: number, key: string) {
  const top = deck + PARAPET, inner = rings.map(r => offsetRing(r, -COPING));
  rings.forEach((r, ri) => {
    const ir = inner[ri];
    for (let i = 0; i < r.length; i++) {
      const j = (i + 1) % r.length;
      k.S('kinTrim').quad(V(r[i][0], top, r[i][1]), V(r[j][0], top, r[j][1]), V(ir[j][0], top, ir[j][1]), V(ir[i][0], top, ir[i][1]), V(0, 1, 0));
      const a = ir[i], c = ir[j], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 0.02) continue;
      k.S(key).quad(V(a[0], deck, a[1]), V(c[0], deck, c[1]), V(c[0], top, c[1]), V(a[0], top, a[1]), V(-(c[1] - a[1]) / L, 0, (c[0] - a[0]) / L));
    }
  });
  k.cap(k.S('kinRoof'), inner, deck);
}

export function buildKinsolving(k: Kit, rings: Point[][], g: (x: number, z: number) => number) {
  const outer = orient(rings[0]), holes = rings.slice(1).map(h => orient(h, false)), base = [outer, ...holes];
  const tiers = kinTiers(base);
  const bottom = Math.min(...outer.map(p => g(p[0], p[1]))) - 1.0;
  const stats = { tiers: tiers.map(t => ({ role: t.role, top: +t.top.toFixed(2), vertices: t.ring.length })), windows: 0, entrances: 0, strips: 0, stripWindows: 0, baseTop: +KIN_BASE_TOP.toFixed(2) };
  const W = KIN_WINDOW, pierOf = (a: Point, c: Point) => KIN_STRIPS.find(st => Math.hypot(a[0] - st.a[0], a[1] - st.a[1]) + Math.hypot(c[0] - st.c[0], c[1] - st.c[1]) < 0.6
    || Math.hypot(a[0] - st.c[0], a[1] - st.c[1]) + Math.hypot(c[0] - st.a[0], c[1] - st.a[1]) < 0.6);
  // One framed window: pane, pale frame, centre mullion (paired sashes), meeting rail, stone sill. All flush detail (<= 0.1 m).
  const framed = (org: THREE.Vector3, u: THREE.Vector3, n: THREE.Vector3, s: number, y: number, w: number, h: number, base = 0) => {
    k.D('kinGlass').panel(org, u, n, s, y + h / 2, base + 0.03, w, h);
    const F = k.D('kinFrame'), f = W.frame;
    F.panel(org, u, n, s, y + h - f / 2, base + 0.06, w + 2 * f, f); F.panel(org, u, n, s, y + f / 2, base + 0.06, w + 2 * f, f);
    F.panel(org, u, n, s - w / 2 - f / 2, y + h / 2, base + 0.06, f, h); F.panel(org, u, n, s + w / 2 + f / 2, y + h / 2, base + 0.06, f, h);
    F.panel(org, u, n, s, y + h / 2, base + 0.06, W.mullion, h); F.panel(org, u, n, s, y + h / 2, base + 0.055, w, W.rail);
    k.D('kinTrim').panel(org, u, n, s, y - 0.09, base + 0.07, w + 0.3, 0.12);
  };
  // Height of the building column just inside a wall point (tallest tier containing it, else the base).
  const columnTop = (x: number, z: number) => Math.max(KIN_BASE_TOP, ...tiers.filter(t => inside(x, z, t.ring)).map(t => t.top));
  const entranceNear = (x: number, z: number) => KIN_ENTRANCES.find(e => Math.hypot(x - e.at[0], z - e.at[1]) < e.width / 2 + 1.0);
  // Window grid on one wall edge: columns at bay centres; rows on the global storey grid between `from` and the column top.
  const windows = (a: Point, c: Point, from: number, topOf: (x: number, z: number) => number) => {
    if (pierOf(a, c)) return;   // blank end pier: only its stair strip (below)
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]), count = Math.floor(L / W.bay); if (count < 1) return;
    const u = V((c[0] - a[0]) / L, 0, (c[1] - a[1]) / L), n = V(u.z, 0, -u.x), org = V(a[0], 0, a[1]);
    for (let j = 0; j < count; j++) {
      const s = (j + 0.5) * L / count, p = org.clone().addScaledVector(u, s), w = Math.min(W.width, L / count - 0.6); if (w < 0.6) continue;
      const top = topOf(p.x - n.x * 0.4, p.z - n.z * 0.4) - 0.25, e = entranceNear(p.x, p.z);
      for (let y = FIRST; y + W.height + W.frame <= top; y += STOREY) {
        if (y < from + 0.5) continue;
        if (e && y < KIN_GROUND + e.storeys * STOREY) continue;
        framed(org, u, n, s, y, w, W.height);
        stats.windows++;
      }
    }
  };
  // Base: walls on the outer ring and the courtyard rings to the base parapet; coplanar tier walls continue above.
  for (const r of base) for (let i = 0; i < r.length; i++) {
    const a = r[i], c = r[(i + 1) % r.length];
    k.wall('kinBrick', a, c, bottom, KIN_BASE_TOP + PARAPET);
    windows(a, c, KIN_GROUND, columnTop);
  }
  parapetDeck(k, base, KIN_BASE_TOP, 'kinBrick');
  // Tiers: walls from the base roof (or from the base parapet top where the wall continues the base facade).
  for (const t of tiers) {
    const r = t.ring, lower = tiers.filter(o => o !== t && o.top < t.top);
    for (let i = 0; i < r.length; i++) {
      const a = r[i], c = r[(i + 1) % r.length], mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
      const facade = onRings(a, c, base);
      // a wall standing on a lower tier starts on that tier's roof (never inside it)
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]), nx = (c[1] - a[1]) / L, nz = -(c[0] - a[0]) / L;
      const below = lower.filter(o => inside(mx + nx * 0.4, mz + nz * 0.4, o.ring)).reduce((m, o) => Math.max(m, o.top), KIN_BASE_TOP);
      const y0 = facade ? KIN_BASE_TOP + PARAPET : below + PARAPET;
      k.wall('kinBrick', a, c, Math.min(y0, t.top), t.top + PARAPET);
      if (!facade) windows(a, c, below + 0.3, () => t.top);
    }
    parapetDeck(k, [r], t.top, 'kinBrick');
  }
  // Entrances: stone surround (flush detail, <= 0.14 m proud), glazed door, transom / upper light.
  for (const e of KIN_ENTRANCES) {
    let best = { d: Infinity, a: outer[0], c: outer[1] };
    for (let i = 0; i < outer.length; i++) { const a = outer[i], c = outer[(i + 1) % outer.length], d = segDist(e.at[0], e.at[1], a, c); if (d < best.d) best = { d, a, c }; }
    if (best.d > 3.5) continue;
    const { a, c } = best, L = Math.hypot(c[0] - a[0], c[1] - a[1]), u = V((c[0] - a[0]) / L, 0, (c[1] - a[1]) / L), n = V(u.z, 0, -u.x), org = V(a[0], 0, a[1]);
    const s = Math.max(e.width / 2 + 0.2, Math.min(L - e.width / 2 - 0.2, (e.at[0] - a[0]) * u.x + (e.at[1] - a[1]) * u.z));
    const p = org.clone().addScaledVector(u, s), floor = g(p.x + n.x * 1.5, p.z + n.z * 1.5);
    const D = k.D('kinPortal'), dw = e.door[0], dh = e.door[1];
    D.panel(org, u, n, s - (e.width - 0.5) / 2, floor + e.height / 2, 0.12, 0.5, e.height);   // jambs
    D.panel(org, u, n, s + (e.width - 0.5) / 2, floor + e.height / 2, 0.12, 0.5, e.height);
    D.panel(org, u, n, s, floor + e.height - 0.3, 0.14, e.width + 0.3, 0.6);                    // lintel / cornice block
    D.panel(org, u, n, s, floor + dh + 0.2, 0.1, e.width - 0.5, 0.4);                           // door head
    k.D('kinGlass').panel(org, u, n, s, floor + dh / 2, 0.05, dw, dh);
    if (e.storeys > 1) k.D('kinGlass').panel(org, u, n, s, floor + dh + 0.4 + (e.height - dh - 1.0) / 2, 0.05, e.width - 1.2, e.height - dh - 1.0);
    stats.entrances++;
  }
  // Stair strips on the blank end piers: pale stone band + one narrow paired-sash window per storey above the porch / portal.
  for (const st of KIN_STRIPS) {
    let edge: { a: Point; c: Point } | null = null;
    for (let i = 0; i < outer.length && !edge; i++) { const a = outer[i], c = outer[(i + 1) % outer.length]; if (pierOf(a, c) === st) edge = { a, c }; }
    if (!edge) continue;
    const { a, c } = edge, L = Math.hypot(c[0] - a[0], c[1] - a[1]), u = V((c[0] - a[0]) / L, 0, (c[1] - a[1]) / L), n = V(u.z, 0, -u.x), org = V(a[0], 0, a[1]);
    const sameDir = Math.hypot(a[0] - st.a[0], a[1] - st.a[1]) < 0.3;
    const e = st.from === 'portal' ? KIN_ENTRANCES[0] : null;
    let s = (sameDir ? st.at : 1 - st.at) * L;
    if (e) s = Math.max(e.width / 2 + 0.2, Math.min(L - e.width / 2 - 0.2, (e.at[0] - a[0]) * u.x + (e.at[1] - a[1]) * u.z));
    const p = org.clone().addScaledVector(u, s), top = columnTop(p.x - n.x * 0.4, p.z - n.z * 0.4);
    const bottom0 = e ? g(p.x + n.x * 1.5, p.z + n.z * 1.5) + e.height : FIRST + STOREY - 0.35;
    let lastHead = bottom0, rows = 0;
    for (let y = FIRST; y + KIN_STRIP.window[1] + W.frame <= top - 0.35; y += STOREY) {
      if (y < bottom0 + 0.25) continue;
      framed(org, u, n, s, y, KIN_STRIP.window[0], KIN_STRIP.window[1], 0.03); lastHead = y + KIN_STRIP.window[1]; rows++;
    }
    if (!rows) continue;
    k.D('kinPortal').panel(org, u, n, s, (bottom0 + lastHead + 0.45) / 2, 0.03, KIN_STRIP.width, lastHead + 0.45 - bottom0);
    stats.strips++; stats.stripWindows += rows;
  }
  return stats;
}
