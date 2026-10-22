// b14 D34 FINAL correction (root IAB review of the first pass): 656265:920 rebuilt from the 2017 USGS 3DEP DSM (0.5 m,
// realism-lanes/lidar work/rasters.npz; alignment work/alignment.json: campus = LiDAR + (-0.23, -1.07), Y = NAVD88 - 165)
// and the four actual d34 orbit frames. The first pass extruded the whole ring to the deck under one small tier hip; the
// sources show (research: .work/b14-group4/fit34.py, model34.py, d34-dsm-reference.json):
//  * a one-storey podium (roof 1.15) along the west ring edge and in the south-west annex, in front of the main west wall;
//  * the main body (deck 20.3 = frozen LiDAR deck) with a 0.9 m perimeter ledge at 21.52 all round;
//  * two raised west corner pavilions standing on the ring line with copper pyramid caps (DSM peaks 25.31 / 25.25),
//    joined to the central roof by flat links (23.3 / 23.1);
//  * a broad central copper hip on a light attic (eave 24.1, slope tan 33.4 deg = the LiDAR pitch, ridge 27.89);
//  * pale pink granite (sunlit orbit pixels ~ (206, 157, 138)), tall round-arched bays: west 2 (between the pavilions),
//    east 3, north 1, south 1; paired small round-headed windows under the ledge.
// The east corners carry no raised volume in the DSM (deck / ledge only), so no east pavilions are modelled. DSM features
// are registered to the official ring by the median wall offset (+0.30 m in u, +0.53 m in v; uncertainty +-0.15 m).
// The record ring stays the outer footprint; every solid lies inside it. Identity is not claimed.
import * as THREE from 'three';
import type { CampusData, Point } from '../../types';
import { Kit, at, type Edge } from './kit';
import { hipPlanes, roofFaces, type RoofSpec } from './roof';
import { col } from './pbr';

export const D34_KEY = '656265:920';
const S = Math.tan(33.4 * Math.PI / 180);
/** DSM-derived (registered) layout in the building frame: u south along the west ring edge from the NW corner, v east. */
export const D34 = {
  slope: S, podium: 1.15, ledge: 21.52, ledgeW: 0.9, wall: 3.25,
  pavN: [3.7, 7.6] as [number, number], pavS: [20.9, 25.1] as [number, number], pavPeak: [25.31, 25.25] as [number, number],
  link: 7.28, linkTop: [23.3, 23.1] as [number, number], attic: [4.8, 23.9, 7.28, 18.78] as [number, number, number, number], eave: 24.1,
  recess: 0.45, archW: { west: 2.6, east: 3.0, north: 2.6, south: 2.6 }, arches: { west: 2, east: 3, north: 1, south: 1 },
  registration: { du: 0.30, dv: 0.53 },
};
/** City record vertices (campus x, z) named in the building frame: a = NW corner (u 0, v 0), b = SW end of the west edge. */
const NAMED: Record<string, Point> = {
  j: [-481.14, 1180.39], a: [-500.45, 1174.08], b: [-509.89, 1203.68], c: [-501.64, 1206.14], d: [-501.05, 1204.1],
  e: [-490.02, 1207.72], f: [-488.9, 1204.31], g: [-487.31, 1204.83], h: [-480.66, 1184.5], i: [-482.31, 1183.96],
};
type V2 = [number, number];
const sub = (p: Point, q: Point): V2 => [p[0] - q[0], p[1] - q[1]];
const norm = (p: V2): V2 => { const l = Math.hypot(p[0], p[1]); return [p[0] / l, p[1] / l]; };
const lerp = (p: Point, q: Point, t: number): Point => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

/** Building frame and every plan polygon of the corrected massing (campus x, z). */
export function d34Plan(data: CampusData) {
  const rec = data.buildings.find(x => x.key === D34_KEY); if (!rec) throw new Error(`b14: record ${D34_KEY} missing`);
  const R: Record<string, Point> = {};
  for (const [k, p] of Object.entries(NAMED)) { const q = rec.rings[0].find(r => Math.hypot(r[0] - p[0], r[1] - p[1]) < 0.05); if (!q) throw new Error(`b14: ${D34_KEY} vertex ${k} moved`); R[k] = [q[0], q[1]]; }
  const O = R.a, U = norm(sub(R.b, R.a)), Vv: V2 = [U[1], -U[0]];
  const P = (u: number, v: number): Point => [O[0] + U[0] * u + Vv[0] * v, O[1] + U[1] * u + Vv[1] * v];
  const uv = (p: Point): V2 => { const d = sub(p, O); return [d[0] * U[0] + d[1] * U[1], d[0] * Vv[0] + d[1] * Vv[1]]; };
  const W = D34.wall, L = D34.ledgeW, [n0, n1] = D34.pavN, [s0, s1] = D34.pavS, [a0, a1, b0, b1] = D34.attic, PD = W + L;
  const onLine = (p: Point, q: Point, v: number) => lerp(p, q, (v - uv(p)[1]) / (uv(q)[1] - uv(p)[1])); // point with frame v on line p-q
  const Nw = onLine(R.a, R.j, W), Sw = onLine(R.d, R.e, W);
  // outer chain of the main body (ledge) from the south pavilion round the south, east and north sides to the north pavilion
  const chain1: Point[] = [P(s1, W), Sw, R.d, R.e, R.f, R.g, R.h, R.i, R.j, Nw, P(n0, W)], chain2: Point[] = [P(n1, W), P(s0, W)];
  const centre = P((a0 + a1) / 2, (b0 + b1) / 2);
  const inner = (ch: Point[]) => {
    const nIn = ch.slice(0, -1).map((p, k) => { const t = norm(sub(ch[k + 1], p)); let n: V2 = [-t[1], t[0]]; const m = lerp(p, ch[k + 1], 0.5); if ((centre[0] - m[0]) * n[0] + (centre[1] - m[1]) * n[1] < 0) n = [-n[0], -n[1]]; return n; });
    return ch.map((p, k) => {
      if (k === 0 || k === ch.length - 1) { const n = nIn[Math.min(k, nIn.length - 1)]; return [p[0] + n[0] * L, p[1] + n[1] * L] as Point; }
      const n1_ = nIn[k - 1], n2 = nIn[k], t1 = norm(sub(p, ch[k - 1])), q1: Point = [p[0] + n1_[0] * L, p[1] + n1_[1] * L], q2: Point = [p[0] + n2[0] * L, p[1] + n2[1] * L];
      const t2 = norm(sub(ch[k + 1], p)), den = t1[0] * t2[1] - t1[1] * t2[0];
      if (Math.abs(den) < 1e-9) return q1;
      const s = ((q2[0] - q1[0]) * t2[1] - (q2[1] - q1[1]) * t2[0]) / den; return [q1[0] + t1[0] * s, q1[1] + t1[1] * s] as Point;
    });
  };
  const in1 = inner(chain1), in2 = inner(chain2);
  const rect = (u0: number, u1: number, v0: number, v1: number): Point[] => [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
  return {
    R, O, U, V: Vv, P, uv, Nw, Sw, chain1, chain2, in1, in2,
    podium: [[R.a, P(n0, 0), P(n0, W), Nw], [P(n1, 0), P(s0, 0), P(s0, W), P(n1, W)], [P(s1, 0), R.b, R.c, R.d, Sw, P(s1, W)]] as Point[][],
    pav: [rect(n0, n1, 0, PD), rect(s0, s1, 0, PD)], link: [rect(n0, n1, PD, D34.link), rect(s0, s1, PD, D34.link)], attic: rect(a0, a1, b0, b1),
    deck1: [...in1, P(n0, b0), P(a0, b0), P(a0, b1), P(a1, b1), P(a1, b0), P(s1, b0)] as Point[],
    deck2: [in2[0], in2[1], P(s0, b0), P(n1, b0)] as Point[],
  };
}
export function d34Roofs(plan: ReturnType<typeof d34Plan>) {
  const pav = plan.pav.map((r, k) => {
    const half = Math.min(Math.hypot(...sub(r[1], r[0])), Math.hypot(...sub(r[3], r[0]))) / 2, peak = D34.pavPeak[k], eave = peak - S * half;
    return { ring: r, eave, peak, spec: { hips: hipPlanes(r, eave, S, peak, () => false), gables: [] } as RoofSpec };
  });
  const [a0, a1, b0, b1] = D34.attic, ridge = D34.eave + S * Math.min(a1 - a0, b1 - b0) / 2;
  return { pav, attic: { ring: plan.attic, eave: D34.eave, ridge, spec: { hips: hipPlanes(plan.attic, D34.eave, S, ridge, () => false), gables: [] } as RoofSpec } };
}

const UPV = new THREE.Vector3(0, 1, 0);
const edge = (A: Point, B: Point, out: V2): Edge => { const L = Math.hypot(B[0] - A[0], B[1] - A[1]); return { a: A, c: B, L, u: new THREE.Vector3((B[0] - A[0]) / L, 0, (B[1] - A[1]) / L), n: new THREE.Vector3(out[0], 0, out[1]), i: -1 }; };
const archPoly = (sc: number, r: number, y0: number, spring: number): [number, number][] =>
  [[sc - r, y0], [sc + r, y0], ...Array.from({ length: 13 }, (_, j) => [sc + r * Math.cos(Math.PI * j / 12), spring + r * Math.sin(Math.PI * j / 12)] as [number, number])];
function planar(k: Kit, e: Edge, outer: [number, number][], holes: [number, number][][], d: number, c: THREE.Color) {
  const all = [outer, ...holes].flat(), v2 = (r: [number, number][]) => r.map(([s, y]) => new THREE.Vector2(s, y));
  for (const [i, j, l] of THREE.ShapeUtils.triangulateShape(v2(outer), holes.map(v2))) k.S().tri(at(e, ...all[i], d), at(e, ...all[j], d), at(e, ...all[l], d), c, e.n);
}
const win = (k: Kit, e: Edge, sc: number, w: number, y0: number, y1: number) => {
  k.panel(k.D(), e, sc - w / 2 - 0.1, sc + w / 2 + 0.1, y0 - 0.1, y1 + 0.1, 0.03, col('frameLight'));
  k.panel(k.D(), e, sc - w / 2, sc + w / 2, y0, y1, 0.045, col('glass'));
};
const roundWin = (k: Kit, e: Edge, sc: number, w: number, y0: number, spring: number) => {
  const o = archPoly(sc, w / 2, y0, spring), cy = (y0 + spring) / 2;
  for (let i = 0; i < o.length; i++) { const a = o[i], c = o[(i + 1) % o.length]; k.D().tri(at(e, sc, cy, 0.03), at(e, ...a, 0.03), at(e, ...c, 0.03), col('glass'), e.n); }
};

export function buildGranite(k: Kit, data: CampusData, ground: { grade: number; base: number }, deck: number, st: Record<string, unknown>) {
  const plan = d34Plan(data), roofs = d34Roofs(plan), { R, P, U, V: Vv, Nw, Sw } = plan, { grade, base } = ground;
  const W = D34.wall, [n0, n1] = D34.pavN, [s0, s1] = D34.pavS, [a0, a1, b0, b1] = D34.attic, PD = W + D34.ledgeW, LK = D34.link;
  const [cN, cS] = D34.linkTop, [eN, eS] = roofs.pav.map(p => p.eave), E = D34.eave, LG = D34.ledge, PO = D34.podium;
  const zb = grade + 4.2, zt = deck - 4.5, mU: V2 = [-U[0], -U[1]], pU: V2 = [U[0], U[1]], mV: V2 = [-Vv[0], -Vv[1]], pV: V2 = [Vv[0], Vv[1]];
  // outward normal of a ring-order edge (the record ring j, a, b, ... runs with the interior on the +V side of a -> b)
  const ringOut = (A: Point, B: Point): V2 => { const t = norm(sub(B, A)); return [-t[1], t[0]]; };
  const toCentre = (A: Point, B: Point): V2 => { const t = norm(sub(B, A)); let n: V2 = [t[1], -t[0]]; const m = lerp(A, B, 0.5), c = plan.P(14, 12); if ((c[0] - m[0]) * n[0] + (c[1] - m[1]) * n[1] < 0) n = [-n[0], -n[1]]; return n; };
  const arches: { face: string; a: Point; u: V2; n: V2; s: number; r: number; y0: number; spring: number }[] = [];
  let windows = 0;
  type Opt = { kind: 'main' | 'pavilion' | 'podium' | 'plain'; arches?: number; archW?: number; archAt?: number; name?: string; color?: THREE.Color; lowTop?: number };
  /** One vertical face A->B (outward n) from y0 to y1, with optional recessed round arches and window detail. */
  const face = (A: Point, B: Point, n: V2, y0: number, y1: number, o: Opt) => {
    const e = edge(A, B, n), c = o.color ?? col(o.kind === 'podium' ? 'podium' : 'granite'); if (e.L < 0.02 || y1 - y0 < 0.01) return;
    const holes: [number, number][][] = [], zones: [number, number][] = [];
    if (o.arches) {
      const w = o.archW ?? 2.6, r = w / 2, pitch = w + 1.6, mid = o.archAt ?? e.L / 2, ay0 = zb + 0.6, spring = zt - 1.2 - r;
      for (let i = 0; i < o.arches; i++) {
        const sc = mid + (i - (o.arches - 1) / 2) * pitch; holes.push(archPoly(sc, r, ay0, spring)); zones.push([sc - r - 0.7, sc + r + 0.7]);
        arches.push({ face: o.name ?? '', a: A, u: [e.u.x, e.u.z], n, s: +sc.toFixed(4), r, y0: +ay0.toFixed(4), spring: +spring.toFixed(4) });
        const R0 = -D34.recess;
        planar(k, e, archPoly(sc, r, ay0, spring), [], R0, col('glass'));
        k.S().quad(at(e, sc - r, ay0, 0), at(e, sc - r, ay0, R0), at(e, sc - r, spring, R0), at(e, sc - r, spring, 0), c, e.u);
        k.S().quad(at(e, sc + r, ay0, R0), at(e, sc + r, ay0, 0), at(e, sc + r, spring, 0), at(e, sc + r, spring, R0), c, e.u.clone().negate());
        k.S().quad(at(e, sc - r, ay0, R0), at(e, sc + r, ay0, R0), at(e, sc + r, ay0, 0), at(e, sc - r, ay0, 0), col('graniteDark'), UPV);
        for (let j = 0; j < 12; j++) {
          const t0 = Math.PI * j / 12, t1 = Math.PI * (j + 1) / 12, tm = (t0 + t1) / 2, hint = e.u.clone().multiplyScalar(-Math.cos(tm)).add(new THREE.Vector3(0, -Math.sin(tm), 0));
          k.S().quad(at(e, sc + r * Math.cos(t0), spring + r * Math.sin(t0), 0), at(e, sc + r * Math.cos(t0), spring + r * Math.sin(t0), R0), at(e, sc + r * Math.cos(t1), spring + r * Math.sin(t1), R0), at(e, sc + r * Math.cos(t1), spring + r * Math.sin(t1), 0), c, hint);
        }
        for (let y = ay0 + 3.3; y < spring; y += 3.3) k.panel(k.D(), e, sc - r + 0.05, sc + r - 0.05, y - 0.15, y + 0.15, R0 + 0.03, col('frameDark'));
      }
    }
    planar(k, e, [[0, y0], [e.L, y0], [e.L, y1], [0, y1]], holes, 0, c);
    // window detail (flush): storeys of punched windows outside the arch zones, base storey at grade, paired round-headed
    // windows in the top storey under the ledge; pavilions one column; podium one row
    const free = (s: number, w: number) => s - w / 2 > 0.5 && s + w / 2 < e.L - 0.5 && !zones.some(([p, q]) => s + w / 2 > p && s - w / 2 < q);
    const lo = Math.max(y0, o.lowTop ?? y0);
    if (o.kind === 'podium') { if (y0 < grade + 0.5) for (let s = 1.5; s < e.L - 1; s += 3) if (free(s, 1.1)) { win(k, e, s, 1.1, grade + 1.0, grade + 2.6); windows++; } return; }
    if (o.kind === 'plain' || e.L < 2.4) return;
    const cols = o.kind === 'pavilion' ? [e.L / 2] : ((n: number) => Array.from({ length: n }, (_v, i) => e.L / 2 + (i - (n - 1) / 2) * 2.9))(Math.max(1, Math.floor((e.L - 1.2) / 2.9)));
    for (const sc of cols) {
      if (!free(sc, 1.2)) continue;
      if (y0 < grade + 0.5) { win(k, e, sc, 1.2, grade + 1.0, grade + 3.0); windows++; }
      for (let y = Math.max(zb, lo + 0.8) + 0.9; y + 1.8 < Math.min(zt, y1 - 2.6); y += 3.3) { win(k, e, sc, 1.2, y, y + 1.8); windows++; }
    }
    const top = o.kind === 'pavilion' ? y1 - 2.9 : deck - 3.2;
    if (y1 >= deck) for (let s = 1.6; s + 1.6 <= e.L; s += 3.0) for (const ds of [-0.45, 0.45]) if (free(s + ds, 0.6)) { roundWin(k, e, s + ds, 0.6, top, top + 0.9); windows++; }
  };
  // ---- outer ring faces (official footprint)
  const ringFace = (A: Point, B: Point, y1: number, o: Opt) => face(A, B, ringOut(A, B), base, y1, o);
  ringFace(R.j, Nw, LG, { kind: 'main', arches: D34.arches.north, archW: D34.archW.north, name: 'north' });
  ringFace(Nw, R.a, PO, { kind: 'podium' });
  ringFace(R.a, P(n0, 0), PO, { kind: 'podium' }); ringFace(P(n0, 0), P(n1, 0), eN, { kind: 'pavilion', name: 'pavN-front' });
  ringFace(P(n1, 0), P(s0, 0), PO, { kind: 'podium' }); ringFace(P(s0, 0), P(s1, 0), eS, { kind: 'pavilion', name: 'pavS-front' });
  ringFace(P(s1, 0), R.b, PO, { kind: 'podium' }); ringFace(R.b, R.c, PO, { kind: 'podium' }); ringFace(R.c, R.d, PO, { kind: 'podium' });
  const sMid = (Math.hypot(...sub(Sw, R.e)) / 2) - Math.hypot(...sub(Sw, R.d)); // south arch centred on the whole main south face
  ringFace(R.d, R.e, LG, { kind: 'main', arches: D34.arches.south, archW: D34.archW.south, archAt: sMid, name: 'south' });
  ringFace(R.e, R.f, LG, { kind: 'main' }); ringFace(R.f, R.g, LG, { kind: 'main' });
  ringFace(R.g, R.h, LG, { kind: 'main', arches: D34.arches.east, archW: D34.archW.east, name: 'east' });
  ringFace(R.h, R.i, LG, { kind: 'main' }); ringFace(R.i, R.j, LG, { kind: 'main' });
  // ---- internal faces: main west wall and the south face above the annex (over the podium)
  face(Nw, P(n0, W), mV, PO, LG, { kind: 'main', lowTop: PO });
  face(P(n1, W), P(s0, W), mV, PO, LG, { kind: 'main', arches: D34.arches.west, archW: D34.archW.west, name: 'west', lowTop: PO });
  face(P(s1, W), Sw, mV, PO, LG, { kind: 'main', lowTop: PO });
  face(Sw, R.d, ringOut(R.d, R.e), PO, LG, { kind: 'main', lowTop: PO });
  // ---- pavilions (sides above the podium / ledge, back above the link)
  for (const [p0, p1, ep, ct] of [[n0, n1, eN, cN], [s0, s1, eS, cS]] as [number, number, number, number][]) {
    face(P(p0, 0), P(p0, W), mU, PO, ep, { kind: 'pavilion', lowTop: PO }); face(P(p0, W), P(p0, PD), mU, LG, ep, { kind: 'plain' });
    face(P(p1, 0), P(p1, W), pU, PO, ep, { kind: 'pavilion', lowTop: PO }); face(P(p1, W), P(p1, PD), pU, LG, ep, { kind: 'plain' });
    face(P(p0, PD), P(p1, PD), pV, ct, ep, { kind: 'plain' });
    face(P(p0, PD), P(p0, LK), mU, deck, ct, { kind: 'plain' }); face(P(p1, PD), P(p1, LK), pU, deck, ct, { kind: 'plain' });
  }
  face(P(n0, LK), P(a0, LK), pV, deck, cN, { kind: 'plain' }); face(P(a1, LK), P(s1, LK), pV, deck, cS, { kind: 'plain' });
  // ---- attic under the central copper hip (light stone)
  const at_ = col('attic');
  face(P(a0, b0), P(n1, b0), mV, cN, E, { kind: 'plain', color: at_ }); face(P(n1, b0), P(s0, b0), mV, deck, E, { kind: 'plain', color: at_ }); face(P(s0, b0), P(a1, b0), mV, cS, E, { kind: 'plain', color: at_ });
  face(P(a0, b0), P(a0, b1), mU, deck, E, { kind: 'plain', color: at_ }); face(P(a1, b0), P(a1, b1), pU, deck, E, { kind: 'plain', color: at_ }); face(P(a0, b1), P(a1, b1), pV, deck, E, { kind: 'plain', color: at_ });
  // ---- ledge (0.9 m perimeter band at 21.52): top strips + inner faces down to the deck
  for (const [ch, inn] of [[plan.chain1, plan.in1], [plan.chain2, plan.in2]] as [Point[], Point[]][]) for (let i = 0; i + 1 < ch.length; i++) {
    const V3 = (p: Point, y: number) => new THREE.Vector3(p[0], y, p[1]);
    k.S().quad(V3(ch[i], LG), V3(ch[i + 1], LG), V3(inn[i + 1], LG), V3(inn[i], LG), col('attic'), UPV);
    face(inn[i], inn[i + 1], toCentre(inn[i], inn[i + 1]), deck, LG, { kind: 'plain', color: at_ });
  }
  // ---- flat roofs: podium, decks, links; copper pyramids and central hip (exact planes)
  for (const r of plan.podium) k.cap(k.S(), [r], PO, col('podiumRoof'));
  k.cap(k.S(), [plan.deck1], deck, col('granRoof')); k.cap(k.S(), [plan.deck2], deck, col('granRoof'));
  k.cap(k.S(), [plan.link[0]], cN, col('granRoof')); k.cap(k.S(), [plan.link[1]], cS, col('granRoof'));
  const pr = roofs.pav.map(p => roofFaces(k, p.ring, p.spec, col('copper'), 'matte').planes), hr = roofFaces(k, roofs.attic.ring, roofs.attic.spec, col('copper'), 'matte').planes;
  st.granite = { key: D34_KEY, grade: +grade.toFixed(3), deck, ledge: LG, podium: PO, links: D34.linkTop, pavilions: roofs.pav.map((p, i) => ({ eave: +p.eave.toFixed(3), peak: p.peak, planes: pr[i] })),
    centralHip: { eave: E, ridge: +roofs.attic.ridge.toFixed(3), slope: +S.toFixed(5), planes: hr }, arches, windows, registration: D34.registration };
  return D34_KEY;
}
