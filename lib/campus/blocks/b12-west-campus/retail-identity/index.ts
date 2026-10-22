// b12-west-campus / retail-identity: four location-specific fast-food storefronts rebuilt on their FROZEN City records.
// Evidence (retail-identity/evidence.json; reference photos are research inputs only, never runtime assets):
//  * 718451:1176 Raising Cane's, 415 W MLK (official location page; Tripadvisor 415 entrance photo, capture date unverified):
//    terra-cotta orange entry tower with an arched top and dark coping, recessed glazed entry under a black box canopy,
//    tan stucco wings, buff brick base, black standing-seam shed awnings over the windows, drive-thru pickup window.
//  * 596959:677 Chick-fil-A, 503 W MLK (official restaurant 02992 photo, opening-era banner, date unverified): red-brown
//    brick base with recessed storefront bays between brick piers, beige upper band, dark red-brown cornice, red curved
//    (barrel) canopy along the storefront, walk-up order window, red square logo cabinet, drive-thru pickup window.
//  * 675359:960 P. Terry's, 517 W MLK (official page; Restaurantji 517 collage exterior, date unknown; 2019 Hsu rendering
//    = design intent, NOT as-built): white box, wood-slat infill bays, aqua umbrella canopies, red channel-letter sign. The
//    City ring itself traces the canopies (two footprint lobes); they become undercrofts with aqua inverted-pyramid
//    umbrellas on single aqua columns, an aqua rim band and the white fascia above.
//  * 505467:200 southern lobe (ring vertices (-518.87,430.11) .. (-499.60,431.58), OSM way: Domino's 1900 Guadalupe, City
//    import; 2022 published photo of the converted gas station, a demolition proposal is not proof of demolition): cream
//    walls, continuous deep-red fascia, forecourt canopy = the SE block (open south / east / north under the frozen roof)
//    with thin red corner posts, recessed storefront glazing, red/blue tile logo. The rest of the merged record (Monkies
//    1904 Guadalupe and the north shops) is an UNBRANDED storefront strip.
// Massing: every site keeps its exact City ring and one flat cap at the frozen context.json top (campus Y 8.2 / 7.5 /
// 7.4 / 8.2, 2017 USGS 3DEP LiDAR P95 restated above the LiDAR ground datum; checked against volumesOf, no height edits).
// The 2017 massing is the baseline, NOT a claim that the 2026 buildings match it 1:1. Rules (checked by
// scripts/harness/blocks/b12-retail-identity.ts): below OVERHEAD_MIN above local ground nothing leaves the City ring
// (recesses / undercrofts only cut inward); outward solids are overhead bands, awnings and canopies only; no ramps, no
// free-standing posts outside the ring; no bottom caps (walls start 1 m below the lowest ground, buried faces omitted).
// Geometry is built in a PRIVATE Kit and appended to the caller's vertex-colour kit: every Kit.S triangle is rendered AND
// collided by b12 index.ts (render = collision); signs, glazing, door leaves and standing seams are Kit.D detail.
import * as THREE from 'three';
import type { CampusData, Point } from '../../../types';
import { Kit, edgesOf, at, along, inRing, ringDist, segDist, orient, C, UP, DOWN, type Bucket, type Edge, type Face, type Mat } from '../kit';
import { volumesOf, ringGroundMin } from '../massing';

type G = (x: number, z: number) => number;
type Col = THREE.Color;
type P2 = [number, number];
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export const RETAIL_KEYS = { canes: '718451:1176', chickfila: '596959:677', pterrys: '675359:960', dominos: '505467:200' } as const;
export type RetailSite = keyof typeof RETAIL_KEYS;
/** Frozen context.json massing tops in campus Y (datum aboveY + volume top); asserted against volumesOf. */
export const RETAIL_TOPS: Record<RetailSite, number> = { canes: 8.2, chickfila: 7.5, pterrys: 7.4, dominos: 8.2 };
/** Solids outside the City ring must stay at least this far above the local ground (overhead only). */
export const OVERHEAD_MIN = 2.8;
/** Declared maximum outward overhang beyond the City ring per site (bands, awnings, canopies; mitred convex band corners
 * reach depth x sqrt(2)). */
export const MAX_OVERHANG: Record<RetailSite, number> = { canes: 0.9, chickfila: 1.15, pterrys: 0.22, dominos: 0.27 };
/** Domino's lobe of 505467:200 (City ring vertices, in ring order); the remaining ring is unbranded. */
export const DOMINOS_LOBE: Point[] = [[-518.87, 430.11], [-519.7, 439.49], [-511.04, 440.26], [-511.62, 446.85], [-500.92, 447.79], [-500.83, 446.74], [-494.66, 447.28], [-494.1, 440.83], [-500.37, 440.28], [-499.6, 431.58]];
/** Domino's forecourt canopy = SE block of the lobe (open on its three outer sides). */
export const DOMINOS_CANOPY: Point[] = [[-500.83, 446.74], [-494.66, 447.28], [-494.1, 440.83], [-500.37, 440.28]];
/** P. Terry's canopy lobes of the City ring (east lobe; north lobe closed by the box's north face line). */
export const PTERRYS_LOBES: Point[][] = [
  [[-611.41, 475.0], [-610.61, 475.26], [-607.11, 479.5], [-603.07, 477.66], [-601.61, 473.07], [-605.5, 469.66], [-609.52, 470.4]],
  [[-608.6, 460.27], [-604.53, 458.36], [-604.53, 454.07], [-607.9, 453.0], [-609.22, 449.98], [-615.27, 449.21], [-618.6, 452.62], [-616.72, 457.77]],
];
export const CANES_NORTH: [Point, Point] = [[-503.31, 493.41], [-510.57, 490.93]];

export interface RetailProbe { site: RetailSite; label: string; o: [number, number, number]; d: [number, number, number]; reach: number; expect: number | null; tol: number }
export interface RetailClearance { site: RetailSite; label: string; x: number; z: number; minClear: number }
export interface RetailSiteInfo {
  key: string; name: string; top: number; ring: Point[]; base: number; floorY: number; undercrofts: { poly: Point[]; soffit: number }[];
  columns: { x: number; z: number; hw: number }[]; overhang: number; features: string[]; warnings: string[];
  solidTriangles: number; detailTriangles: number; probes: RetailProbe[]; clearance: RetailClearance[];
}
/** Metadata of the last buildRetail() (consumed by the retail harness). */
export const RETAIL_FEATURES: Partial<Record<RetailSite, RetailSiteInfo>> = {};

// ------------------------------------------------------------------ palette (rendered average albedo, interpreted from the photos)
const PAL = {
  canes: { stucco: C('#c9a684'), back: C('#bd9a77'), orange: C('#cf633a'), brick: C('#b39776'), coping: C('#2d2a28'), black: C('#1d1c1b'), awning: C('#2a2927'),
    seam: C('#43413d'), reveal: C('#8a6c55'), signBorder: C('#3a2321'), signRed: C('#c41f2b'), white: C('#f3efe6'), glass: C('#2a343a'), frame: C('#2b2b2b'), roof: C('#8f8b85') },
  cfa: { brick: C('#8a4636'), beige: C('#d6c29d'), cornice: C('#7a3427'), red: C('#c8102e'), redUnder: C('#a50e27'), glass: C('#26323a'), frame: C('#3a3a38'),
    white: C('#f4f1ea'), back: C('#9b5a48'), menu: C('#2b2b2b'), roof: C('#8d8a85') },
  pterrys: { white: C('#eeeeea'), aqua: C('#4fc0a4'), aquaDeep: C('#3fa48b'), wood: C('#a46a3c'), wood2: C('#8f5a32'), woodBack: C('#5e3b22'), glass: C('#1f2a30'),
    red: C('#d62f2a'), black: C('#151515'), roof: C('#9a9893') },
  dominos: { cream: C('#e7dcc0'), red: C('#c8102e'), blue: C('#00669c'), white: C('#f6f4ee'), glass: C('#27323a'), frame: C('#d9d4c6'), soffit: C('#ece6d6'),
    stucco: C('#cdc5b5'), stuccoBack: C('#bdb4a3'), coping: C('#5a5650'), roof: C('#8f8c87'), light: C('#fff6d8') },
};

// ------------------------------------------------------------------ 5x7 block letters (authored here; no font file)
const FONT: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'], C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'], E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'], H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'], K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'], M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'], O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'], R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'], T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], V: ['#...#', '#...#', '#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'], "'": ['#', '#', '.', '.', '.', '.', '.'], '.': ['.', '.', '.', '.', '.', '.', '#'],
  '-': ['...', '...', '...', '###', '...', '...', '...'], ' ': ['...', '...', '...', '...', '...', '...', '...'],
};

// ------------------------------------------------------------------ small geometry helpers
const near = (p: Point, q: Point, eps = 0.02) => Math.hypot(p[0] - q[0], p[1] - q[1]) < eps;
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const clean = (r: Point[]) => { const out = r.filter((p, i) => i === 0 || !near(p, r[i - 1], 1e-6)); if (out.length > 1 && near(out[0], out[out.length - 1], 1e-6)) out.pop(); return orient(out); };
const edgeOf = (a: Point, c: Point): Edge => { const L = Math.hypot(c[0] - a[0], c[1] - a[1]); return { a, c, L, u: V((c[0] - a[0]) / L, 0, (c[1] - a[1]) / L), n: V((c[1] - a[1]) / L, 0, -(c[0] - a[0]) / L), i: -1 }; };
const neg = (v: THREE.Vector3) => v.clone().negate();
/** Planar polygon (2D coordinates mapped to 3D by `map`), triangulated, facing `hint`. */
function fillPoly(b: Bucket, pts: P2[], map: (p: P2) => THREE.Vector3, color: Col, hint: THREE.Vector3) {
  const v2 = pts.map(p => new THREE.Vector2(p[0], p[1]));
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(v2, [])) b.tri(map(pts[i]), map(pts[j]), map(pts[k]), color, hint);
}
const ellipse = (cx: number, cy: number, rx: number, ry: number, n = 28): P2[] => Array.from({ length: n }, (_, i) => [cx + rx * Math.cos(2 * Math.PI * i / n), cy + ry * Math.sin(2 * Math.PI * i / n)]);
const diamond = (cx: number, cy: number, r: number): P2[] => [[cx + r, cy], [cx, cy + r], [cx - r, cy], [cx, cy - r]];

type Run = { edges: Edge[]; closed: boolean };
interface Paint { jamb: Col; back: Col; head: Col; sill: Col }

/** One retail record under construction (private kit; merged into the caller's kit only when the whole site succeeded). */
class Site {
  rk = new Kit(); k!: Kit; faces = new Map<Edge, Face[]>(); ring: Point[]; edges: Edge[]; top: number; base: number; floorY: number; info: RetailSiteInfo;
  private paths: { pts: Point[]; w: number }[];
  constructor(readonly id: RetailSite, name: string, data: CampusData, readonly g: G) {
    const key = RETAIL_KEYS[id], vols = volumesOf(key, data);
    if (vols.length !== 1 || vols[0].role !== 'main' || Math.abs(vols[0].top - RETAIL_TOPS[id]) > 1e-6) throw new Error(`retail ${key}: frozen massing changed (${vols.map(v => `${v.role}:${v.top}`).join(',')}, expected one main volume at ${RETAIL_TOPS[id]})`);
    const rec = data.buildings.find(b => b.key === key); if (!rec) throw new Error(`retail ${key}: record missing`);
    this.ring = clean(rec.rings[0] as Point[]); this.edges = edgesOf(this.ring); this.top = vols[0].top;
    this.base = ringGroundMin(this.ring, g) - 1.0;
    this.floorY = median(this.ring.map(p => g(p[0], p[1]))) + 0.1;
    const xs = this.ring.map(p => p[0]), zs = this.ring.map(p => p[1]), box = [Math.min(...xs) - 40, Math.max(...xs) + 40, Math.min(...zs) - 40, Math.max(...zs) + 40];
    this.paths = data.paths.filter(p => p.points.length > 1 && p.points.some(([x, z]) => x > box[0] && x < box[1] && z > box[2] && z < box[3])).map(p => ({ pts: p.points as Point[], w: p.width }));
    this.info = { key, name, top: this.top, ring: this.ring, base: this.base, floorY: this.floorY, undercrofts: [], columns: [], overhang: MAX_OVERHANG[id], features: [], warnings: [], solidTriangles: 0, detailTriangles: 0, probes: [], clearance: [] };
  }
  /** Distance from (x, z) to the nearest mapped path edge (negative inside a path). */
  pathGap(x: number, z: number) { let m = Infinity; for (const p of this.paths) for (let i = 0; i + 1 < p.pts.length; i++) m = Math.min(m, segDist(x, z, p.pts[i], p.pts[i + 1]) - p.w / 2); return m; }
  gAt(v: THREE.Vector3) { return this.g(v.x, v.z); }
  /** Highest ground along an edge span (0.6 m outside and 0.3 m inside). */
  gMax(e: Edge, s0 = 0, s1 = e.L) { let m = -Infinity; for (let s = s0; s <= s1 + 1e-6; s += Math.max(0.25, (s1 - s0) / 40)) for (const d of [0.6, -0.3]) m = Math.max(m, this.gAt(at(e, s, 0, d))); return m; }
  floorOf(e: Edge) { const v: number[] = []; for (let s = 0; s <= e.L; s += 0.5) v.push(this.gAt(at(e, s, 0, 0.6))); return median(v) + 0.1; }
  edge(p: Point, q: Point) { const e = this.edges.find(x => (near(x.a, p) && near(x.c, q)) || (near(x.a, q) && near(x.c, p))); if (!e) throw new Error(`retail ${this.info.key}: no ring edge ${p.join(',')} - ${q.join(',')}`); return e; }
  hasVertex(p: Point) { return this.ring.some(q => near(p, q, 0.01)); }
  addFace(e: Edge, y0: number, y1: number, color: Col, s0 = 0, s1 = e.L, mat: Mat = 'matte') {
    if (y1 - y0 < 0.01 || s1 - s0 < 0.01) return;
    const f = this.rk.face(e, y0, y1, color, { s0, s1, mat }); let l = this.faces.get(e); if (!l) this.faces.set(e, l = []); l.push(f); return f;
  }
  hole(e: Edge, s0: number, s1: number, y0: number, y1: number) { for (const f of this.faces.get(e) ?? []) f.holes.push([s0, s1, y0, y1]); }
  /** Contiguous run of ring edges satisfying pred (closed when every edge does). */
  run(pred: (e: Edge) => boolean): Run {
    const es = this.edges, n = es.length, m = es.map(pred);
    if (m.every(Boolean)) return { edges: es.slice(), closed: true };
    const k = m.findIndex((v, i) => v && !m[(i - 1 + n) % n]); if (k < 0) throw new Error(`retail ${this.info.key}: empty run`);
    const out: Edge[] = []; for (let j = 0; j < n && m[(k + j) % n]; j++) out.push(es[(k + j) % n]);
    if (out.length !== m.filter(Boolean).length) throw new Error(`retail ${this.info.key}: run is not contiguous`);
    return { edges: out, closed: false };
  }
  /** Overhead band protruding `d` outward over a run (mitred joints, butt ends with end caps); nothing behind it. */
  band(r: Run, y0: number, y1: number, d: number, color: Col, mat: Mat = 'matte', label = 'band') {
    const es = r.edges, n = es.length, b = this.rk.S(mat);
    const miter = (p: Edge, q: Edge): Point | null => { const dot = p.n.x * q.n.x + p.n.z * q.n.z; if (1 + dot < 0.35) return null; const k = d / (1 + dot); return [q.a[0] + (p.n.x + q.n.x) * k, q.a[1] + (p.n.z + q.n.z) * k]; };
    const P = (p: Point, y: number) => V(p[0], y, p[1]);
    for (let j = 0; j < n; j++) {
      const e = es[j], prev = r.closed || j > 0 ? es[(j - 1 + n) % n] : null, next = r.closed || j < n - 1 ? es[(j + 1) % n] : null;
      let pa = prev ? miter(prev, e) : null, pc = next ? miter(e, next) : null;
      const buttA = !pa, buttC = !pc;
      pa ??= [e.a[0] + e.n.x * d, e.a[1] + e.n.z * d]; pc ??= [e.c[0] + e.n.x * d, e.c[1] + e.n.z * d];
      b.quad(P(pa, y0), P(pc, y0), P(pc, y1), P(pa, y1), color, e.n);
      b.quad(P(e.a, y1), P(e.c, y1), P(pc, y1), P(pa, y1), color, UP);
      b.quad(P(e.a, y0), P(e.c, y0), P(pc, y0), P(pa, y0), color, DOWN);
      if (buttA) b.quad(P(e.a, y0), P(pa, y0), P(pa, y1), P(e.a, y1), color, neg(e.u));
      if (buttC) b.quad(P(e.c, y0), P(pc, y0), P(pc, y1), P(e.c, y1), color, e.u);
      if (y0 < this.gMax(e) + OVERHEAD_MIN - 0.02) this.info.warnings.push(`${label} bottom ${y0.toFixed(2)} < ground + ${OVERHEAD_MIN} on edge ${e.i}`);
    }
    this.info.features.push(`${label}: ${n} edges, ${d} m outward, y ${y0.toFixed(2)}-${y1.toFixed(2)}`);
  }
  /** Rectangular recess cut INTO the mass behind edge e (inside the City ring); returns its back face. */
  recess(e: Edge, s0: number, s1: number, y0: number, y1: number, depth: number, c: Paint, label?: string) {
    this.hole(e, s0, s1, y0, y1);
    const b = this.rk.S(), back = this.rk.face(e, y0, y1, c.back, { d: -depth, s0, s1 });
    b.quad(at(e, s0, y0, -depth), at(e, s0, y0, 0), at(e, s0, y1, 0), at(e, s0, y1, -depth), c.jamb, e.u);
    b.quad(at(e, s1, y0, 0), at(e, s1, y0, -depth), at(e, s1, y1, -depth), at(e, s1, y1, 0), c.jamb, neg(e.u));
    b.quad(at(e, s0, y1, -depth), at(e, s1, y1, -depth), at(e, s1, y1, 0), at(e, s0, y1, 0), c.head, DOWN);
    if (y0 > this.base + 0.05) b.quad(at(e, s0, y0, -depth), at(e, s1, y0, -depth), at(e, s1, y0, 0), at(e, s0, y0, 0), c.sill, UP);
    if (label) this.info.features.push(`${label}: ${(s1 - s0).toFixed(2)} x ${(y1 - y0).toFixed(2)} m, ${depth} m deep`);
    return back;
  }
  /** Glazed window bay: recess + mullions (solid, inside the recess) + glass and frame detail. */
  window(e: Edge, sc: number, w: number, y0: number, y1: number, depth: number, c: Paint & { glass: Col; frame: Col; mullion: Col }, mullions = 1, label?: string) {
    const s0 = sc - w / 2, s1 = sc + w / 2, back = this.recess(e, s0, s1, y0, y1, depth, c, label);
    this.rk.panel(this.rk.D('glass'), e, s0 + 0.04, s1 - 0.04, y0 + 0.04, y1 - 0.04, -depth + 0.012, c.glass);
    for (let m = 1; m <= mullions; m++) { const sm = s0 + w * m / (mullions + 1); this.rk.attach(back, sm - 0.035, sm + 0.035, y0, y1, Math.min(0.06, depth - 0.02), c.mullion, 'metal', { top: false, bottom: false }); }
    this.probeH(`${label ?? 'window'} back`, e, s0 + w / (2 * (mullions + 1)), (y0 + y1) / 2, 1.5, depth);
    return back;
  }
  /** Door bay from below ground: recess + door leaf / glass detail. */
  door(e: Edge, sc: number, w: number, yHead: number, depth: number, c: Paint & { glass: Col; frame: Col }, label = 'door') {
    const s0 = sc - w / 2, s1 = sc + w / 2, yF = this.floorOf(e), back = this.recess(e, s0, s1, this.base, yHead, depth, c, label);
    this.rk.panel(this.rk.D('metal'), e, sc - 0.55, sc + 0.55, yF, Math.min(yHead - 0.05, yF + 2.3), -depth + 0.012, c.frame);
    this.rk.panel(this.rk.D('glass'), e, sc - 0.45, sc + 0.45, yF + 0.1, Math.min(yHead - 0.15, yF + 2.2), -depth + 0.022, c.glass);
    this.probeH(`${label} recess`, e, sc, yF + 1.4, 1.5, depth);
    return back;
  }
  /** Sloped standing-seam shed awning, overhead: solid wedge (sloped seam deck, front lip, flat soffit at the lip bottom),
   * so no wall strip hides in a slot behind the plate (generic G3 side rule). */
  awning(e: Edge, s0: number, s1: number, yB: number, rise: number, D: number, color: Col, seam: Col, label = 'awning') {
    const yT = yB + rise, t = 0.07, y0 = yB - t, b = this.rk.S('metal'), hint = e.n.clone().multiplyScalar(rise).add(V(0, D, 0));
    b.quad(at(e, s0, yT, 0), at(e, s1, yT, 0), at(e, s1, yB, D), at(e, s0, yB, D), color, hint);
    b.quad(at(e, s0, y0, D), at(e, s1, y0, D), at(e, s1, yB, D), at(e, s0, yB, D), color, e.n);
    b.quad(at(e, s0, y0, 0), at(e, s1, y0, 0), at(e, s1, y0, D), at(e, s0, y0, D), color, DOWN);
    b.quad(at(e, s0, y0, 0), at(e, s0, yT, 0), at(e, s0, yB, D), at(e, s0, y0, D), color, neg(e.u));
    b.quad(at(e, s1, y0, 0), at(e, s1, yT, 0), at(e, s1, yB, D), at(e, s1, y0, D), color, e.u);
    this.hole(e, s0, s1, y0, yT);
    for (let s = s0 + 0.3; s < s1 - 0.15; s += 0.45) this.rk.D('metal').quad(at(e, s - 0.015, yT + 0.02, 0.02), at(e, s + 0.015, yT + 0.02, 0.02), at(e, s + 0.015, yB + 0.02, D - 0.02), at(e, s - 0.015, yB + 0.02, D - 0.02), seam, hint);
    const sm = (s0 + s1) / 2, pm = at(e, sm, 0, D / 2), pe = at(e, sm, 0, D - 0.1);
    this.probe(`${label} top`, V(pm.x, yT + 1, pm.z), DOWN, 2, yT + 1 - (yT - rise / 2), 0.03);
    this.clear(`${label} underside`, pe.x, pe.z, OVERHEAD_MIN - 0.1);
    this.info.features.push(`${label}: ${(s1 - s0).toFixed(2)} m, ${D.toFixed(2)} m deep, bottom ${yB.toFixed(2)}`);
  }
  /** Curved (quarter-barrel) canopy, solid shell of thickness t, attached at the wall, overhead. */
  barrel(e: Edge, s0: number, s1: number, yB: number, H: number, D: number, color: Col, under: Col, label = 'curved canopy') {
    const N = 8, t = 0.08, b = this.rk.S('metal');
    const outer: P2[] = Array.from({ length: N + 1 }, (_, k) => { const th = (k / N) * Math.PI / 2; return [D * Math.sin(th), yB + H * Math.cos(th)]; });
    const inner: P2[] = Array.from({ length: N + 1 }, (_, k) => { const th = (k / N) * Math.PI / 2; return [(D - t) * Math.sin(th), yB + (H - t) * Math.cos(th)]; });
    const Q = (s: number, p: P2) => at(e, s, p[1], p[0]);
    for (let k = 0; k < N; k++) {
      const [d0, y0] = outer[k], [d1, y1] = outer[k + 1], hint = e.n.clone().multiplyScalar(y0 - y1).add(V(0, d1 - d0, 0));
      b.quad(Q(s0, outer[k]), Q(s1, outer[k]), Q(s1, outer[k + 1]), Q(s0, outer[k + 1]), color, hint);
      b.quad(Q(s0, inner[k]), Q(s1, inner[k]), Q(s1, inner[k + 1]), Q(s0, inner[k + 1]), under, neg(hint));
    }
    b.quad(Q(s0, inner[N]), Q(s1, inner[N]), Q(s1, outer[N]), Q(s0, outer[N]), color, DOWN);
    const prof = [...outer, ...inner.slice().reverse()];
    fillPoly(b, prof, p => Q(s0, p), color, neg(e.u)); fillPoly(b, prof, p => Q(s1, p), color, e.u);
    this.hole(e, s0, s1, yB + H - t, yB + H);
    const sm = (s0 + s1) / 2, pm = at(e, sm, 0, D / 2), pe = at(e, sm, 0, D - 0.12), yAt = yB + H * Math.sqrt(1 - 0.25);
    this.probe(`${label} crown`, V(pm.x, yB + H + 1, pm.z), DOWN, 2.5, yB + H + 1 - yAt, 0.04);
    this.clear(`${label} lip`, pe.x, pe.z, OVERHEAD_MIN - 0.1);
    this.info.features.push(`${label}: ${(s1 - s0).toFixed(2)} m, ${D.toFixed(2)} m deep, rise ${H} m, bottom ${yB.toFixed(2)}`);
  }
  /** Thin column / post inside the footprint (base buried 0.3 m, no bottom or top caps). */
  post(cx: number, cz: number, hw: number, y1: number, u: THREE.Vector3, color: Col, label: string) {
    const fe: Edge = { a: [cx, cz], c: [cx + u.x, cz + u.z], L: 1, u, n: V(u.z, 0, -u.x), i: -1 };
    const y0 = Math.min(...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => { const p = at(fe, i * hw, 0, j * hw); return this.gAt(p); })) - 0.3;
    this.rk.box(this.rk.S('metal'), fe, -hw, hw, y0, y1, -hw, hw, color, true, { top: false, bottom: false });
    this.info.columns.push({ x: cx, z: cz, hw });
    const gy = this.g(cx, cz), o = at(fe, 0, gy + 1.2, 1.5);
    this.probe(`${label} (horizontal hit)`, o, neg(fe.n), 2.5, 1.5 - hw, 0.03);
  }
  /** Undercroft inside the ring under the frozen roof: open ring segments, walls on interior chords, flat soffit. */
  undercroft(poly0: Point[], ySoffit: number, soffit: Col, wall: Col, label: string) {
    const P = orient(poly0), walls: Edge[] = [];
    for (let i = 0; i < P.length; i++) {
      const a = P[i], c = P[(i + 1) % P.length], m: Point = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      if (ringDist(m[0], m[1], this.ring) < 1e-3 && ringDist(a[0], a[1], this.ring) < 1e-3 && ringDist(c[0], c[1], this.ring) < 1e-3) {
        const e = this.edges.find(x => segDist(a[0], a[1], x.a, x.c) < 1e-3 && segDist(c[0], c[1], x.a, x.c) < 1e-3); if (!e) throw new Error(`retail ${this.info.key}: open segment off the ring`);
        const sa = along(e, a[0], a[1]), sc = along(e, c[0], c[1]);
        this.hole(e, Math.min(sa, sc), Math.max(sa, sc), this.base - 0.01, ySoffit);
      } else { const w = edgeOf(c, a); this.addFace(w, this.base, ySoffit, wall); walls.push(w); }
    }
    this.rk.cap(this.rk.S(), [P], ySoffit, soffit, 'down');
    this.info.undercrofts.push({ poly: P, soffit: ySoffit });
    this.info.features.push(`${label}: ${P.length}-gon undercroft, soffit Y ${ySoffit.toFixed(2)}, ${walls.length} interior wall(s)`);
    return { P, walls };
  }
  /** Flush block-letter sign (detail): text reads left to right seen from outside (+x along -u). */
  text(e: Edge, str: string, sc: number, y0: number, cap: number, d: number, color: Col, maxW = Infinity) {
    const gl = str.toUpperCase().split('').map(ch => FONT[ch] ?? FONT[' ']), cells = gl.reduce((a, g) => a + g[0].length + 1, 0) - 1;
    const cell = Math.min(cap / 7, maxW / cells), W = cells * cell, b = this.rk.D();
    let x = 0;
    for (const g of gl) {
      g.forEach((row, r) => { for (let c0 = 0; c0 < row.length;) { if (row[c0] !== '#') { c0++; continue; } let c1 = c0; while (c1 + 1 < row.length && row[c1 + 1] === '#') c1++;
        const x0 = x + c0 * cell, x1 = x + (c1 + 1) * cell, yb = y0 + (6 - r) * cell; this.rk.panel(b, e, sc + W / 2 - x1, sc + W / 2 - x0, yb, yb + cell, d, color); c0 = c1 + 1; } });
      x += (g[0].length + 1) * cell;
    }
    return { W, cap: cell * 7 };
  }
  probe(label: string, o: THREE.Vector3, d: THREE.Vector3, reach: number, expect: number | null, tol = 0.03) {
    this.info.probes.push({ site: this.id, label, o: [o.x, o.y, o.z], d: [d.x, d.y, d.z], reach, expect, tol });
  }
  probeH(label: string, e: Edge, s: number, y: number, out: number, depth: number) { this.probe(label, at(e, s, y, out), neg(e.n), out + depth + 1.0, out + depth); }
  clear(label: string, x: number, z: number, minClear: number) { this.info.clearance.push({ site: this.id, label, x, z, minClear }); }
  gridClear(poly: Point[], label: string, minClear: number, avoid: { x: number; z: number; r: number }[] = [], step = 1.0, margin = 0.4) {
    const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step)
      if (inRing(x, z, poly) && ringDist(x, z, poly) >= margin && !avoid.some(a => Math.hypot(a.x - x, a.z - z) < a.r)) this.clear(label, x, z, minClear);
  }
  /** Cap at the exact City ring and frozen top; merge into the caller's kit. */
  finish(k: Kit, roof: Col) {
    this.rk.cap(this.rk.S(), [this.ring], this.top, roof);
    this.rk.flushFaces();
    const move = (from: Map<Mat, Bucket>, to: (m: Mat) => Bucket) => { let n = 0; for (const [m, b] of from) { const t = to(m); for (let i = 0; i < b.pos.length; i++) { t.pos.push(b.pos[i]); t.col.push(b.col[i]); } n += b.triangles; } return n; };
    this.info.solidTriangles = move(this.rk.solid, m => k.S(m)); this.info.detailTriangles = move(this.rk.detail, m => k.D(m));
    RETAIL_FEATURES[this.id] = this.info;
  }
}

// ------------------------------------------------------------------ 718451:1176 Raising Cane's
export const CANES = { brick: 0.9, coping: 0.35, arch: { rise: 0.95, band: 0.35, out: 0.15 }, door: { width: 2.5, depth: 1.5 }, canopy: { out: 0.45, thick: 0.45, wing: 0.3 }, wrap: 2.4, awning: { rise: 0.45, depth: 0.85 } };
function canes(s: Site) {
  const P = PAL.canes, top = s.top, rk = s.rk, north = s.edge(...CANES_NORTH), yBrick = s.floorY + CANES.brick, yCop = top - CANES.coping;
  const paint: Paint = { jamb: P.stucco, back: P.back, head: P.stucco, sill: P.brick };
  const wp = { ...paint, glass: P.glass, frame: P.frame, mullion: P.frame };
  for (const e of s.edges) {
    s.addFace(e, s.base, yBrick, P.brick);
    if (e === north) continue;
    const atA = CANES_NORTH.some(v => near(v, e.a)), atC = CANES_NORTH.some(v => near(v, e.c));
    if (!atA && !atC) { s.addFace(e, yBrick, yCop, P.stucco); continue; }
    const wl = Math.min(CANES.wrap, e.L), o: [number, number] = atA ? [0, wl] : [e.L - wl, e.L];
    s.addFace(e, yBrick, yCop, P.orange, o[0], o[1]);
    if (wl < e.L - 0.01) {
      s.addFace(e, yBrick, yCop, P.stucco, atA ? wl : 0, atA ? e.L : e.L - wl);
      const sb = atA ? wl : e.L - wl; s.recess(e, sb - 0.04, sb + 0.04, yBrick, yCop - 0.1, 0.06, { jamb: P.stucco, back: P.reveal, head: P.stucco, sill: P.brick }, 'tower / wing reveal');
    }
  }
  s.band(s.run(e => e !== north), yCop, top, 0.1, P.coping, 'metal', 'dark parapet coping');
  // North (MLK) entry tower: arched orange front with dark arched coping, recessed entry under a black box canopy.
  const L = north.L, sc = L / 2, sd0 = sc - CANES.door.width / 2, sd1 = sc + CANES.door.width / 2, D = CANES.door.depth;
  const yC0 = Math.max(s.floorY + 3.0, s.gMax(north) + OVERHEAD_MIN + 0.05), yC1 = yC0 + CANES.canopy.thick, cw = CANES.canopy.wing;
  s.recess(north, sd0, sd1, s.base, yC0, D, { jamb: P.orange, back: P.back, head: P.black, sill: P.brick }, 'entry recess');
  rk.panel(rk.D('metal'), north, sc - 0.55, sc + 0.55, s.floorY, s.floorY + 2.3, -D + 0.012, P.frame);
  rk.panel(rk.D('glass'), north, sc - 0.45, sc + 0.45, s.floorY + 0.1, s.floorY + 2.2, -D + 0.022, P.glass);
  for (const [a, b] of [[sd0 + 0.12, sc - 0.65], [sc + 0.65, sd1 - 0.12]]) rk.panel(rk.D('glass'), north, a, b, s.floorY + 0.15, yC0 - 0.25, -D + 0.012, P.glass);
  const rise = CANES.arch.rise, R = ((L / 2) ** 2 + rise ** 2) / (2 * rise), yc = top - R, ySp = top - rise;
  const arcTop = (v: number) => yc + Math.sqrt(Math.max(0, R * R - (v - L / 2) ** 2)), arcBot = (v: number) => arcTop(v) - CANES.arch.band;
  if (yC1 > arcBot(sd0 - cw) - 0.6) throw new Error('retail canes: canopy collides with the arched coping');
  const N = 16, ss = Array.from({ length: N + 1 }, (_, i) => L * i / N), F = (d: number) => (p: P2) => at(north, p[0], p[1], d);
  const orange: P2[] = [[0, yBrick], [sd0, yBrick], [sd0, yC0], [sd0 - cw, yC0], [sd0 - cw, yC1], [sd1 + cw, yC1], [sd1 + cw, yC0], [sd1, yC0], [sd1, yBrick], [L, yBrick], ...ss.slice().reverse().map(v => [v, arcBot(v)] as P2)];
  fillPoly(rk.S(), orange, F(0), P.orange, north.n);
  fillPoly(rk.S(), [...ss.slice(0, N / 2 + 1).map(v => [v, arcTop(v)] as P2), [0, top]], F(0), P.stucco, north.n);
  fillPoly(rk.S(), [...ss.slice(N / 2).map(v => [v, arcTop(v)] as P2), [L, top]], F(0), P.stucco, north.n);
  const o = CANES.arch.out, bm = rk.S('metal');
  for (let i = 0; i < N; i++) {
    const a = ss[i], b = ss[i + 1];
    bm.quad(at(north, a, arcBot(a), o), at(north, b, arcBot(b), o), at(north, b, arcTop(b), o), at(north, a, arcTop(a), o), P.coping, north.n);
    bm.quad(at(north, a, arcTop(a), 0), at(north, b, arcTop(b), 0), at(north, b, arcTop(b), o), at(north, a, arcTop(a), o), P.coping, UP);
    bm.quad(at(north, a, arcBot(a), 0), at(north, b, arcBot(b), 0), at(north, b, arcBot(b), o), at(north, a, arcBot(a), o), P.coping, DOWN);
  }
  bm.quad(at(north, 0, arcBot(0), 0), at(north, 0, arcBot(0), o), at(north, 0, arcTop(0), o), at(north, 0, arcTop(0), 0), P.coping, neg(north.u));
  bm.quad(at(north, L, arcBot(L), 0), at(north, L, arcBot(L), o), at(north, L, arcTop(L), o), at(north, L, arcTop(L), 0), P.coping, north.u);
  rk.box(rk.S('metal'), north, sd0 - cw, sd1 + cw, yC0, yC1, 0, CANES.canopy.out, P.black);
  s.info.features.push(`arched entry tower: crown ${top.toFixed(2)} (frozen top), springing ${ySp.toFixed(2)}, radius ${R.toFixed(2)} m`, `black box canopy ${(sd1 - sd0 + 2 * cw).toFixed(2)} m, ${CANES.canopy.out} m out, underside ${yC0.toFixed(2)}`);
  // oval sign over the canopy (detail): dark border, red field, white letters
  const sy0 = yC1 + 0.25, sy1 = Math.min(yC1 + 1.6, arcBot(sc - 1.6) - 0.15), ry = (sy1 - sy0) / 2, scy = (sy0 + sy1) / 2;
  if (ry > 0.3) {
    fillPoly(rk.D(), ellipse(sc, scy, 1.6, ry), F(0.02), P.signBorder, north.n);
    fillPoly(rk.D(), ellipse(sc, scy, 1.48, ry - 0.1), F(0.032), P.signRed, north.n);
    const t = s.text(north, "CANE'S", sc, scy - Math.min(0.5, ry * 0.9) / 2, Math.min(0.5, ry * 0.9), 0.044, P.white, 2.4);
    s.info.features.push(`oval CANE'S sign ${t.W.toFixed(2)} x ${t.cap.toFixed(2)} m letters`);
  }
  s.probeH('tower pier on the ring line', north, 0.6, s.floorY + 1.6, 1.5, 0);
  s.probeH('entry recess back', north, sc + 0.9, s.floorY + 1.6, 1.5, D);
  const pc = at(north, L / 2, 0, o / 2), p2 = at(north, L * 0.15, 0, o / 2), pk = at(north, sc, 0, 0.3), pr = at(north, sc, 0, -0.8);
  s.probe('arched coping crown at the frozen top', V(pc.x, top + 1, pc.z), DOWN, 2, 1, 0.03);
  s.probe('arched coping shoulder', V(p2.x, top + 1, p2.z), DOWN, 3, top + 1 - arcTop(L * 0.15), 0.03);
  s.probe('box canopy top', V(pk.x, yC1 + 1, pk.z), DOWN, 2, 1, 0.03);
  s.clear('under box canopy (outside ring)', pk.x, pk.z, OVERHEAD_MIN - 0.1); s.clear('entry recess headroom', pr.x, pr.z, 2.4);
  // long faces: big windows on the brick base under black shed awnings; east face: drive-thru pickup window
  for (const e of s.edges.filter(x => x !== north && x.L >= 9)) {
    const east = e.n.x > 0, nb = Math.max(1, Math.floor((e.L - 1.2) / 3.4)), yW1 = yBrick + 2.0, gm = s.gMax(e);
    for (let j = 0; j < nb; j++) {
      const c = (j + 0.5) * e.L / nb;
      if (east && j === 0) {
        const yH = Math.max(s.floorY + 2.45, gm + OVERHEAD_MIN + 0.02);
        s.window(e, c, 1.3, s.floorY + 0.95, s.floorY + 2.05, 0.35, wp, 0, 'drive-thru pickup window');
        if (yH + 0.25 < yCop - 0.5) { rk.box(rk.S('metal'), e, c - 0.9, c + 0.9, yH, yH + 0.25, 0, 0.6, P.black, false); s.hole(e, c - 0.9, c + 0.9, yH, yH + 0.25); const ph = at(e, c, 0, 0.5); s.clear('pickup hood underside', ph.x, ph.z, OVERHEAD_MIN - 0.1); s.info.features.push('pickup hood 1.8 x 0.6 m'); }
        const cap = 0.3, ty = Math.max(yH + 0.45, yW1 + 0.4); if (ty + cap < yCop - 0.2) s.text(e, 'DRIVE THRU', c, ty, cap, 0.015, P.signRed, 2.8);
        continue;
      }
      s.window(e, c, 2.4, yBrick, yW1, 0.2, wp, 1, 'wing window');
      const yB = Math.max(yW1 + 0.25, gm + OVERHEAD_MIN + 0.05), pe = at(e, c, 0, CANES.awning.depth);
      const Dm = Math.min(CANES.awning.depth, s.pathGap(pe.x, pe.z) + CANES.awning.depth - 0.3);
      if (Dm >= 0.45 && yB + CANES.awning.rise < yCop - 0.15) s.awning(e, c - 1.35, c + 1.35, yB, CANES.awning.rise, Dm, P.awning, P.seam, 'black standing-seam awning');
      else s.info.warnings.push(`awning skipped on edge ${e.i} (depth ${Dm.toFixed(2)} / height)`);
    }
  }
  // service door on the south end
  const south = s.edges.filter(e => e !== north && e.L >= 3).reduce((b, e) => (e.n.z > b.n.z ? e : b));
  s.door(south, south.L / 2, 1.1, s.floorOf(south) + 2.3, 0.15, { ...paint, glass: P.frame, frame: P.frame }, 'service door');
  s.finish(s.k, P.roof);
}

// ------------------------------------------------------------------ 596959:677 Chick-fil-A
export const CFA = { cornice: 0.6, corniceOut: 0.22, canopy: { H: 0.55, D: 1.1 }, pier: 0.9, bay: 2.3, window: 0.25 };
function chickfila(s: Site) {
  const P = PAL.cfa, top = s.top, rk = s.rk;
  const front = s.edges.filter(e => e.n.x > 0.8).reduce((b, e) => (e.L > b.L ? e : b));
  const yB = s.gMax(front) + OVERHEAD_MIN + 0.05, yBand = yB + CFA.canopy.H + 0.12, yCor = top - CFA.cornice;
  if (yBand > yCor - 0.9) throw new Error('retail chickfila: no room for the beige band under the cornice');
  for (const e of s.edges) { s.addFace(e, s.base, yBand, P.brick); s.addFace(e, yBand, yCor, P.beige); }
  s.band(s.run(() => true), yCor, top, CFA.corniceOut, P.cornice, 'matte', 'red-brown cornice');
  const paint: Paint = { jamb: P.brick, back: P.back, head: P.brick, sill: P.brick }, wp = { ...paint, glass: P.glass, frame: P.frame, mullion: P.frame };
  // storefront: recessed glazing bays between brick piers, one entry door, one walk-up order window
  const nb = Math.floor((front.L - CFA.pier) / (CFA.bay + CFA.pier)), w0 = (front.L - nb * CFA.bay) / (nb + 1);
  const yF = s.floorOf(front);
  for (let j = 0; j < nb; j++) {
    const c = w0 + CFA.bay / 2 + j * (CFA.bay + w0);
    if (j === 1) s.door(front, c, 2.0, yF + 2.6, 0.3, { ...paint, glass: P.glass, frame: P.frame }, 'entry door');
    else if (j === nb - 2) {
      const back = s.recess(front, c - 0.8, c + 0.8, yF + 0.95, yF + 2.2, 0.5, paint, 'walk-up order window');
      rk.panel(rk.D('glass'), front, c - 0.7, c + 0.7, yF + 1.0, yF + 2.15, -0.488, P.glass);
      rk.attach(back, c - 0.7, c + 0.7, yF + 0.95, yF + 1.02, 0.25, P.white, 'matte', { bottom: false, s0: false, s1: false });
      s.probeH('walk-up window back', front, c + 0.3, yF + 1.6, 1.5, 0.5);
    } else s.window(front, c, CFA.bay, yF + 0.45, yB - 0.35, CFA.window, wp, 1, 'storefront bay');
  }
  s.probeH('brick pier on the ring line', front, w0 / 2, yF + 1.6, 1.5, 0);
  const pe = at(front, front.L / 2, 0, CFA.canopy.D), D = Math.min(CFA.canopy.D, s.pathGap(pe.x, pe.z) + CFA.canopy.D - 0.3);
  if (D < 0.6) throw new Error('retail chickfila: storefront canopy has no clearance');
  s.barrel(front, 0.6, front.L - 0.6, yB, CFA.canopy.H, D, P.red, P.redUnder, 'red curved storefront canopy');
  const tw = s.text(front, 'CHICK-FIL-A', front.L / 2, yBand + 0.25, Math.min(0.85, yCor - yBand - 0.45), 0.015, P.red, front.L * 0.55);
  s.info.features.push(`CHICK-FIL-A letters ${tw.W.toFixed(2)} m on the beige band`);
  // red square logo cabinet on the MLK (north) face, white C
  // the cabinet hangs from the cornice soffit (its top abuts the cornice: buried, omitted), bottom stays overhead
  const nf = s.edges.filter(e => e.n.z < -0.8).reduce((b, e) => (e.L > b.L ? e : b)), lc = nf.L / 2, ly0 = Math.max(yBand + 0.15, s.gMax(nf) + OVERHEAD_MIN + 0.05), lh = yCor - ly0, ls = Math.min(1.4, nf.L - 0.6);
  if (ls > 0.7 && lh > 0.8) {
    rk.box(rk.S('metal'), nf, lc - ls / 2, lc + ls / 2, ly0, yCor, 0, 0.14, P.red, false, { top: false }); s.hole(nf, lc - ls / 2, lc + ls / 2, ly0, yCor);
    const cs = Math.min(ls, lh) * 0.64; s.text(nf, 'C', lc, ly0 + (lh - cs) / 2, cs, 0.152, P.white);
    s.probeH('logo cabinet front', nf, lc + ls * 0.3, ly0 + lh / 2, 1.5, -0.14);
    s.info.features.push(`red logo cabinet ${ls.toFixed(2)} x ${lh.toFixed(2)} m under the cornice, north face`);
  } else s.info.warnings.push('logo cabinet skipped (no room)');
  // drive-thru pickup window (west face) with its own small red curved canopy
  const west = s.edges.filter(e => e.n.x < -0.8).reduce((b, e) => (e.L > b.L ? e : b)), yW = s.floorOf(west), wc = west.L / 2;
  s.window(west, wc, 1.4, yW + 0.95, yW + 2.05, 0.4, wp, 0, 'drive-thru pickup window');
  const yB2 = Math.max(yW + 2.4, s.gMax(west, wc - 1.2, wc + 1.2) + OVERHEAD_MIN + 0.05), pw = at(west, wc, 0, 0.8);
  if (yB2 + 0.4 <= yBand - 0.05 && s.pathGap(pw.x, pw.z) > 0.3) s.barrel(west, wc - 1.2, wc + 1.2, yB2, 0.4, 0.8, P.red, P.redUnder, 'pickup window canopy');
  else s.info.warnings.push('pickup canopy skipped (height / clearance)');
  const pcn = at(front, front.L * 0.3, 0, CFA.corniceOut / 2);
  s.probe('cornice top', V(pcn.x, top + 1, pcn.z), DOWN, 2, 1, 0.03);
  s.finish(s.k, P.roof);
}

// ------------------------------------------------------------------ 675359:960 P. Terry's
export const PTERRYS = { soffitClear: 3.4, rim: 0.35, rimOut: 0.15, coping: 0.35, copingOut: 0.08, umbrella: { depth: 0.75, column: 0.16, minClear: 2.5 }, slat: { w: 0.05, pitch: 0.14, depth: 0.06 } };
function pterrys(s: Site) {
  const P = PAL.pterrys, top = s.top, rk = s.rk;
  for (const l of PTERRYS_LOBES) for (const p of l) if (!s.hasVertex(p)) throw new Error(`retail pterrys: lobe vertex ${p.join(',')} not on the City ring`);
  const inLobe = (l: Point[]) => (e: Edge) => l.some(p => near(p, e.a)) && l.some(p => near(p, e.c));
  const lobeEdge = (e: Edge) => PTERRYS_LOBES.some(l => inLobe(l)(e));
  const yS = Math.max(...s.edges.filter(lobeEdge).map(e => s.gMax(e))) + PTERRYS.soffitClear, yRim = yS + PTERRYS.rim, yCop = top - PTERRYS.coping;
  if (yRim > yCop - 0.5) throw new Error('retail pterrys: no fascia room above the umbrella canopies');
  for (const e of s.edges) {
    if (lobeEdge(e)) { s.addFace(e, s.base, yS, P.white); s.addFace(e, yRim, yCop, P.white); } else s.addFace(e, s.base, yCop, P.white);
  }
  for (const l of PTERRYS_LOBES) s.band(s.run(inLobe(l)), yS, yRim, PTERRYS.rimOut, P.aqua, 'matte', 'aqua umbrella rim');
  s.band(s.run(() => true), yCop, top, PTERRYS.copingOut, P.white, 'matte', 'white box coping');
  // frame of the box (2017 City ring axes): A ~ north, B ~ east
  const A = V(0.3, 0, -0.954).normalize(), B = V(0.954, 0, 0.3).normalize();
  const ox = s.ring.reduce((t, p) => t + p[0], 0) / s.ring.length, oz = s.ring.reduce((t, p) => t + p[1], 0) / s.ring.length;
  const F = (a: number, b: number): Point => [ox + A.x * a + B.x * b, oz + A.z * a + B.z * b];
  const prefs: P2[][] = [[[-7.5, 7.0]], [[10.0, -6.0], [9.6, 0.6]]];
  const paint: Paint = { jamb: P.white, back: P.white, head: P.white, sill: P.white }, wp = { ...paint, glass: P.glass, frame: P.black, mullion: P.black };
  const woodBay = (e: Edge, c: number, w: number, y1: number, label: string, window?: [number, number]) => {
    s.recess(e, c - w / 2, c + w / 2, s.base, y1, 0.22, { jamb: P.wood, back: P.woodBack, head: P.wood, sill: P.wood }, label);
    let n = 0;
    // vertical slats: explicit Kit.D trim (9 cm gaps are below the collision rule's resolution; the solid is the bay back)
    for (let x = c - w / 2 + 0.08; x < c + w / 2 - 0.05; x += PTERRYS.slat.pitch) {
      if (window && x > c - window[0] / 2 - 0.1 && x < c + window[0] / 2 + 0.1) continue;
      rk.box(rk.D(), e, x - PTERRYS.slat.w / 2, x + PTERRYS.slat.w / 2, Math.max(s.base, s.floorOf(e) - 0.4), y1, -0.22, -0.22 + PTERRYS.slat.depth, n % 2 ? P.wood : P.wood2, false, { top: false, bottom: false }); n++;
    }
    if (window) { const yF = s.floorOf(e); rk.panel(rk.D(), e, c - window[0] / 2 - 0.08, c + window[0] / 2 + 0.08, yF + 0.87, yF + 0.95 + window[1] + 0.08, -0.205, P.red); rk.panel(rk.D('glass'), e, c - window[0] / 2, c + window[0] / 2, yF + 0.95, yF + 0.95 + window[1], -0.195, P.glass); }
    s.info.features.push(`${label}: ${n} wood slats`);
  };
  PTERRYS_LOBES.forEach((l, li) => {
    const { P: poly, walls } = s.undercroft(l, yS, P.aqua, P.white, li ? 'north umbrella patio / drive-thru undercroft' : 'east umbrella undercroft');
    // storefront on the box face under the canopies: glazing bays, one wood infill bay
    for (const w of walls) {
      const nb = Math.max(1, Math.floor(w.L / 2.7)), yF = s.floorOf(w);
      for (let j = 0; j < nb; j++) { const c = (j + 0.5) * w.L / nb; if (j === 0 && nb > 1) woodBay(w, c, Math.min(2.4, w.L / nb - 0.3), Math.min(yF + 3.4, yS - 0.4), 'wood infill bay'); else s.window(w, c, Math.min(2.2, w.L / nb - 0.4), yF + 0.4, Math.min(yF + 2.9, yS - 0.5), 0.2, wp, 1, 'patio storefront'); }
    }
    const cols: { x: number; z: number; r: number }[] = [];
    for (const [pa, pb] of prefs[li]) {
      let done = false;
      for (let r = 0; r <= 4.0 && !done; r += 0.5) for (const [da, db] of r ? [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]] : [[0, 0]]) {
        if (done) break;
        for (let h = 2.0; h >= 1.0 - 1e-9 && !done; h -= 0.2) {
          const [cx, cz] = F(pa + da, pb + db), corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([i, j]) => F(pa + da + i * h, pb + db + j * h));
          if (!corners.every(q => inRing(q[0], q[1], poly) && ringDist(q[0], q[1], poly) >= 0.1) || !inRing(cx, cz, poly)) continue;
          if (s.pathGap(cx, cz) < PTERRYS.umbrella.column + 0.4) continue; // keep the column out of mapped lanes / footways
          const gy = s.g(cx, cz), yA = Math.max(yS - PTERRYS.umbrella.depth, gy + PTERRYS.umbrella.minClear); if (yA > yS - 0.3) continue;
          const apex = V(cx, yA, cz), b = rk.S();
          for (let k = 0; k < 4; k++) { const p = corners[k], q = corners[(k + 1) % 4], mx = (p[0] + q[0]) / 2 - cx, mz = (p[1] + q[1]) / 2 - cz;
            b.tri(apex, V(p[0], yS, p[1]), V(q[0], yS, q[1]), P.aqua, V(mx, 0, mz).normalize().multiplyScalar(yS - yA).add(V(0, -h, 0))); }
          s.post(cx, cz, PTERRYS.umbrella.column, yA + 0.04, A, P.aquaDeep, 'umbrella column');
          const pu = F(pa + da + 0.6 * h, pb + db), gu = s.g(pu[0], pu[1]);
          s.probe('umbrella underside', V(pu[0], gu + 1.0, pu[1]), UP, 4, yA + (yS - yA) * 0.6 - (gu + 1.0), 0.04);
          cols.push({ x: cx, z: cz, r: PTERRYS.umbrella.column + 0.6 });
          s.info.features.push(`aqua umbrella ${(2 * h).toFixed(1)} m square, apex ${yA.toFixed(2)} on a column at (${cx.toFixed(2)}, ${cz.toFixed(2)})`);
          done = true;
        }
      }
      if (!done) s.info.warnings.push(`umbrella near frame (${pa}, ${pb}) skipped: no column site clear of mapped paths inside the lobe`);
    }
    s.gridClear(poly, li ? 'north undercroft headroom' : 'east undercroft headroom', 2.4, cols);
  });
  // west face: storefront windows with wood eyebrow panels; one full-height wood infill bay
  const wests = s.edges.filter(e => !lobeEdge(e) && e.n.dot(B) < -0.8 && e.L >= 8);
  for (const e of wests) {
    const yF = s.floorOf(e), nb = Math.floor(e.L / 3.1);
    for (let j = 0; j < nb; j++) {
      const c = (j + 0.5) * e.L / nb;
      if (j === nb - 1) { woodBay(e, c, 2.4, Math.min(yF + 3.6, yCop - 0.6), 'wood infill bay'); continue; }
      // storefront window with a wood eyebrow in the same recess (glass below, wood panel + battens above; trim = Kit.D)
      s.window(e, c, 2.2, yF + 0.5, yF + 3.6, 0.2, { ...wp, jamb: P.wood, head: P.wood }, 1, 'storefront window + wood eyebrow');
      rk.panel(rk.D(), e, c - 1.06, c + 1.06, yF + 2.85, yF + 3.56, -0.17, P.wood);
      for (let x = c - 1.0; x < c + 1.05; x += 0.2) rk.box(rk.D(), e, x - 0.04, x + 0.04, yF + 2.85, yF + 3.56, -0.17, -0.135, P.wood2, false, { top: false, bottom: false });
    }
  }
  // drive-thru pickup on the east box face (the mapped drive-thru lane runs along it): wood-clad bay with a red-framed window
  const east = s.edges.filter(e => !lobeEdge(e) && e.n.dot(B) > 0.8).reduce((b, e) => (e.L > b.L ? e : b));
  woodBay(east, east.L / 2, 3.0, Math.min(s.floorOf(east) + 3.2, yCop - 0.6), 'drive-thru wood bay + pickup window', [1.2, 1.05]);
  s.probeH('pickup window back', east, east.L / 2, s.floorOf(east) + 1.5, 1.5, 0.22);
  // red channel letters with a black drop shadow on the MLK fascia and high on the west face
  const nf = s.edges.filter(e => e.n.dot(A) > 0.8).reduce((b, e) => (e.L > b.L ? e : b)), lobeN = lobeEdge(nf);
  const y0 = (lobeN ? yRim : s.floorOf(nf) + 3.3) + 0.15, cap = Math.min(0.6, yCop - 0.15 - y0);
  if (cap > 0.3) { s.text(nf, "P.TERRY'S", nf.L / 2 - 0.04, y0 - 0.04, cap, 0.02, P.black, nf.L * 0.85); s.text(nf, "P.TERRY'S", nf.L / 2, y0, cap, 0.04, P.red, nf.L * 0.85); }
  if (wests.length) { const w = wests[0], yw = Math.min(yCop - 0.85, s.floorOf(w) + 4.0); s.text(w, "P.TERRY'S", w.L / 2 - 0.04, yw - 0.04, 0.6, 0.02, P.black, w.L * 0.7); s.text(w, "P.TERRY'S", w.L / 2, yw, 0.6, 0.04, P.red, w.L * 0.7); }
  const pr = at(nf, nf.L / 2, 0, PTERRYS.rimOut / 2);
  if (lobeN) s.probe('aqua rim band top', V(pr.x, yRim + 1, pr.z), DOWN, 2, 1, 0.03);
  s.finish(s.k, P.roof);
}

// ------------------------------------------------------------------ 505467:200 Domino's (southern lobe) + unbranded storefronts
export const DOMINOS = { fascia: 1.5, fasciaOut: 0.18, minSoffitClear: 3.2, post: 0.09, coping: 0.5, copingOut: 0.1 };
function dominos(s: Site) {
  const P = PAL.dominos, top = s.top, rk = s.rk;
  for (const p of DOMINOS_LOBE) if (!s.hasVertex(p)) throw new Error(`retail dominos: lobe vertex ${p.join(',')} not on the City ring`);
  const idx = (p: Point) => DOMINOS_LOBE.findIndex(q => near(p, q));
  const lobe = (e: Edge) => { const i = idx(e.a), j = idx(e.c); return i >= 0 && j >= 0 && Math.abs(i - j) === 1; };
  const gL = Math.max(...s.edges.filter(lobe).map(e => s.gMax(e)));
  let yS = top - DOMINOS.fascia;
  if (yS < gL + DOMINOS.minSoffitClear) { yS = Math.min(top - 0.9, gL + DOMINOS.minSoffitClear); s.info.warnings.push(`fascia shortened to ${(top - yS).toFixed(2)} m for canopy headroom`); }
  const yCop = top - DOMINOS.coping;
  for (const e of s.edges) { if (lobe(e)) s.addFace(e, s.base, yS, P.cream); else s.addFace(e, s.base, yCop, P.stucco); }
  s.band(s.run(lobe), yS, top, DOMINOS.fasciaOut, P.red, 'matte', 'continuous deep-red fascia');
  s.band(s.run(e => !lobe(e)), yCop, top, DOMINOS.copingOut, P.coping, 'matte', 'unbranded storefront coping');
  // forecourt canopy: the SE block, open on its three outer sides under the frozen roof
  const { P: cpoly, walls } = s.undercroft(DOMINOS_CANOPY, yS, P.soffit, P.cream, 'forecourt canopy');
  const paint: Paint = { jamb: P.cream, back: P.cream, head: P.cream, sill: P.cream }, wp = { ...paint, glass: P.glass, frame: P.frame, mullion: P.frame };
  for (const w of walls) {
    const yF = s.floorOf(w), nb = Math.max(2, Math.floor(w.L / 2.2));
    for (let j = 0; j < nb; j++) { const c = (j + 0.5) * w.L / nb; if (j === 1) s.door(w, c, 1.8, yF + 2.6, 0.2, { ...paint, glass: P.glass, frame: P.frame }, 'storefront door'); else s.window(w, c, w.L / nb - 0.35, yF + 0.35, yF + 2.6, 0.2, wp, 1, 'storefront glazing'); }
  }
  const avoid: { x: number; z: number; r: number }[] = [];
  for (const v of [DOMINOS_CANOPY[1], DOMINOS_CANOPY[2]]) {
    const es = s.edges.filter(e => near(e.a, v) || near(e.c, v)); if (es.length !== 2) continue;
    const cx = v[0] - (es[0].n.x + es[1].n.x) * (DOMINOS.post + 0.08), cz = v[1] - (es[0].n.z + es[1].n.z) * (DOMINOS.post + 0.08);
    const ok = inRing(cx, cz, s.ring) && ringDist(cx, cz, s.ring) >= DOMINOS.post + 0.02 && s.pathGap(cx, cz) >= DOMINOS.post + 0.3;
    if (!ok) { s.info.warnings.push(`red post at ${v.join(',')} skipped (bounded clearance)`); continue; }
    s.post(cx, cz, DOMINOS.post, yS + 0.02, es[0].u, P.red, 'thin red canopy post'); avoid.push({ x: cx, z: cz, r: 0.6 });
    s.info.features.push(`thin red post inside the footprint at (${cx.toFixed(2)}, ${cz.toFixed(2)})`);
  }
  s.gridClear(cpoly, 'forecourt canopy headroom', DOMINOS.minSoffitClear - 0.25, avoid);
  // downlights (detail) on the soffit
  for (const [fx, fz] of [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) {
    const xs = cpoly.map(p => p[0]), zs = cpoly.map(p => p[1]), x = Math.min(...xs) + fx * (Math.max(...xs) - Math.min(...xs)), z = Math.min(...zs) + fz * (Math.max(...zs) - Math.min(...zs));
    if (inRing(x, z, cpoly)) rk.D().quad(V(x - 0.2, yS - 0.01, z - 0.2), V(x + 0.2, yS - 0.01, z - 0.2), V(x + 0.2, yS - 0.01, z + 0.2), V(x - 0.2, yS - 0.01, z + 0.2), P.light, DOWN);
  }
  // probes: open forecourt (south -> north passes under), east -> west hits the storefront, soffit, fascia
  const eS = s.edge(DOMINOS_CANOPY[0], DOMINOS_CANOPY[1]), eE = s.edge(DOMINOS_CANOPY[1], DOMINOS_CANOPY[2]), eN = s.edge(DOMINOS_CANOPY[2], DOMINOS_CANOPY[3]);
  const gs = s.gAt(at(eS, eS.L / 2, 0, 0)) + 1.5, depthNS = segDist(...((p => [p.x, p.z] as [number, number])(at(eS, eS.L / 2, 0, 0))), eN.a, eN.c);
  s.probe('forecourt open south -> north (no b12 hit)', at(eS, eS.L / 2, gs, 1.5), neg(eS.n), 1.5 + depthNS - 0.2, null);
  if (walls[0]) { const m = at(eE, eE.L / 2, 0, 0), dW = segDist(m.x, m.z, walls[0].a, walls[0].c);
    s.probe('forecourt open from the east, clear up to the storefront', at(eE, eE.L / 2, s.gAt(m) + 1.5, 1.5), neg(eE.n), 1.5 + dW - 0.35, null); }
  const cxp = cpoly.reduce((t, p) => t + p[0], 0) / cpoly.length, czp = cpoly.reduce((t, p) => t + p[1], 0) / cpoly.length, gc = s.g(cxp, czp);
  s.probe('forecourt soffit', V(cxp, gc + 1.0, czp), UP, 8, yS - (gc + 1.0), 0.03);
  const pf = at(eE, eE.L / 2, 0, DOMINOS.fasciaOut / 2); s.probe('red fascia top', V(pf.x, top + 1, pf.z), DOWN, 2, 1, 0.03);
  // block A east storefront (faces the forecourt notch), south window band, logos and letters on the fascia
  const eA = s.edge(DOMINOS_LOBE[8], DOMINOS_LOBE[9]), yFA = s.floorOf(eA);
  for (let j = 0; j < 3; j++) { const c = (j + 0.5) * eA.L / 3; if (j === 1) s.door(eA, c, 1.8, yFA + 2.6, 0.2, { ...paint, glass: P.glass, frame: P.frame }, 'side door'); else s.window(eA, c, eA.L / 3 - 0.5, yFA + 0.35, yFA + 2.6, 0.2, wp, 1, 'storefront glazing'); }
  const eSo = s.edge(DOMINOS_LOBE[3], DOMINOS_LOBE[4]), yFS = s.floorOf(eSo);
  s.window(eSo, eSo.L / 2, eSo.L - 1.6, yFS + 1.0, yFS + 2.3, 0.15, wp, Math.max(1, Math.floor((eSo.L - 1.6) / 1.2) - 1), 'window band');
  const logo = (e: Edge, sc: number, yc: number, r: number) => {
    const d = DOMINOS.fasciaOut + 0.01, M = (p: P2) => at(e, p[0], p[1], d), b = rk.D();
    fillPoly(b, diamond(sc + r * 0.55, yc + r * 0.55, r * 0.75), M, P.red, e.n); fillPoly(b, diamond(sc - r * 0.55, yc - r * 0.55, r * 0.75), M, P.blue, e.n);
    const M2 = (p: P2) => at(e, p[0], p[1], d + 0.01);
    for (const [dx, dy] of [[0.55, 0.55], [-0.85, -0.25], [-0.25, -0.85]]) fillPoly(b, diamond(sc + r * dx, yc + r * dy, r * 0.16), M2, P.white, e.n);
  };
  for (const e of [eS, eE, eSo]) {
    const cap = Math.min(0.55, (top - yS) * 0.45), yc = (yS + top) / 2, r = cap * 0.62;
    logo(e, e.L / 2 + (e === eE ? 0 : -e.L * 0.25), yc, r);
    if (e !== eE) s.text(e, "DOMINO'S", e.L / 2 + e.L * 0.12, yc - cap / 2, cap, DOMINOS.fasciaOut + 0.01, P.white, e.L * 0.55);
  }
  s.info.features.push('red/blue tile logos + DOMINO\'S letters on the fascia (south canopy, east canopy logo, south wall)');
  // unbranded remainder (Monkies 1904 Guadalupe and the north shops): Guadalupe / forecourt storefront bays
  const up: Paint = { jamb: P.stucco, back: P.stuccoBack, head: P.stucco, sill: P.stucco }, uwp = { ...up, glass: P.glass, frame: P.coping, mullion: P.coping };
  for (const e of s.edges.filter(e => !lobe(e) && e.L >= 6 && (e.n.x > 0.8 || e.n.z > 0.8))) {
    const yF = s.floorOf(e), nb = Math.max(1, Math.floor(e.L / 3.4));
    for (let j = 0; j < nb; j++) { const c = (j + 0.5) * e.L / nb; if (j === Math.floor(nb / 2)) s.door(e, c, 1.6, yF + 2.6, 0.2, { ...up, glass: P.glass, frame: P.coping }, 'unbranded shop door'); else s.window(e, c, Math.min(2.6, e.L / nb - 0.6), yF + 0.4, yF + 2.8, 0.2, uwp, 1, 'unbranded shop window'); }
  }
  s.finish(s.k, P.roof);
}

/** Build the four retail identities into the caller's NON-PBR vertex-colour kit `k` (before k.flushFaces() or after: this
 * module flushes its own private kit). Returns the record keys actually rebuilt (a site that throws is skipped, its
 * generated fallback stays, and the error is reported in stats.retailIdentity.errors). */
export function buildRetail(k: Kit, data: CampusData, g: G, stats: Record<string, unknown>): string[] {
  const started = performance.now(), built: string[] = [], errors: Record<string, string> = {};
  const builders: [RetailSite, string, (s: Site) => void][] = [['canes', "Raising Cane's, 415 W MLK", canes], ['chickfila', 'Chick-fil-A, 503 W MLK (drive-thru only)', chickfila],
    ['pterrys', "P. Terry's, 517 W MLK", pterrys], ['dominos', "Domino's, 1900 Guadalupe (south lobe of 505467:200) + unbranded storefronts", dominos]];
  for (const [id, name, fn] of builders) {
    delete RETAIL_FEATURES[id];
    try { const s = new Site(id, name, data, g); s.k = k; fn(s); built.push(RETAIL_KEYS[id]); }
    catch (e) { errors[id] = String(e instanceof Error ? e.message : e); }
  }
  stats.retailIdentity = {
    built, errors, ms: Math.round(performance.now() - started),
    sites: Object.fromEntries(Object.entries(RETAIL_FEATURES).map(([id, v]) => [id, { key: v.key, top: v.top, solidTriangles: v.solidTriangles, detailTriangles: v.detailTriangles, features: v.features.length, warnings: v.warnings, probes: v.probes.length, undercrofts: v.undercrofts.length, columns: v.columns.length }])),
  };
  return built;
}
