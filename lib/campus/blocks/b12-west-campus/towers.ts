// b12 round 2: identity skins for five West Campus towers. Each record is rebuilt from its OWN context.json massing
// volumes (same rings, same measured / published heights; massing.ts), then the photo-supported identity is added as
// geometry + per-vertex colour (no photo pixels, no text). Evidence per tower: west-campus-dataset-pass/photos/*.jpg
// (architect / developer / owner galleries, research references only) — see b12-implementation/NOTES.md.
// Relief deeper than 0.15 m is solid (attached to a wall Face, which opens behind it); flatter relief and glazing are
// visual detail within 0.15 m of the wall collider. Feature orientation on a given face is a photo interpretation (estimate).
import { Vector3 } from 'three';
import type { CampusData, Point } from '../../types';
import { Kit, C, edgesOf, at, hash, inRing, orient, hipBody, type Edge, type Face } from './kit';
import { volumesOf, buildVolumes, ringGroundMin, recordRing, type Vol } from './massing';

export const TOWER_KEYS = { moontower: '732897:1231', skyloft: '550397:416', castilian: '657418:943', nueces2400: '525341:252', torre: '490461:139' } as const;
type G = (x: number, z: number) => number;
/** Edge a->c with outward normal (dz, -dx)/L (same convention as edgesOf on an oriented ring). */
const edgeOf = (a: Point, c: Point): Edge => { const L = Math.hypot(c[0] - a[0], c[1] - a[1]); return { a, c, L, u: new Vector3((c[0] - a[0]) / L, 0, (c[1] - a[1]) / L), n: new Vector3((c[1] - a[1]) / L, 0, -(c[0] - a[0]) / L), i: 0 }; };
const groundAt = (e: Edge, g: G) => { const m = at(e, e.L / 2, 0, 1.2); return g(m.x, m.z); };
/** Punched windows per storey with an irregular (hashed) rhythm (flat glass detail). */
function punched(k: Kit, e: Edge, y0: number, y1: number, o: { storey: number; bay: number; w: [number, number]; h: number; color: string; seed: number; skip?: (s: number, y: number) => boolean; d?: number }) {
  const n = Math.floor(e.L / o.bay); if (n < 1) return 0;
  let c = 0;
  for (let f = 0, y = y0; y + o.h <= y1; f++, y += o.storey) for (let j = 0; j < n; j++) {
    const w = o.w[0] + (o.w[1] - o.w[0]) * hash(o.seed, j, f % 3), s = (j + 0.5) * e.L / n + (hash(o.seed + 7, j) - 0.5) * 0.6;
    if (o.skip?.(s, y)) continue;
    k.panel(k.D('glass'), e, s - w / 2, s + w / 2, y, y + o.h, o.d ?? 0.03, C(o.color)); c++;
  }
  return c;
}

// ---------------------------------------------------------------- Moontower (moontower-architect-01/-02, developer-01/-11/-12)
function moontower(k: Kit, data: CampusData, g: G, st: Record<string, unknown>) {
  const vols = volumesOf(TOWER_KEYS.moontower, data), v = vols[0], top = v.top;
  const east = edgesOf(v.ring).reduce((b, e) => (e.n.x > b.n.x ? e : b));
  // Rooftop frame: open white frame around a recessed roof terrace on the San Antonio (east) face, centre bay.
  const FRAME = { w: 12, depth: 8, terrace: top - 3.0, beamTop: Math.min(top + 1.1, v.bottom + 56.82) }; // City h top = base + 56.82
  const f0 = east.L / 2 - FRAME.w / 2, f1 = f0 + FRAME.w;
  const P = (s: number, d: number): Point => { const p = at(east, s, 0, d); return [p.x, p.z]; };
  const same = (e: Edge) => Math.hypot(e.a[0] - east.a[0], e.a[1] - east.a[1]) < 1e-6 && Math.hypot(e.c[0] - east.c[0], e.c[1] - east.c[1]) < 1e-6;
  // roof deck = the ring with the recess notched out of its east edge
  const notched = v.ring.flatMap(p => (Math.hypot(p[0] - east.c[0], p[1] - east.c[1]) < 1e-6 ? [P(f0, 0), P(f0, -FRAME.depth), P(f1, -FRAME.depth), P(f1, 0), p] : [p]));
  const dark = C('#4d5058'), white = C('#ecebe6'), roof = C('#8e8f8c');
  const faceOf = buildVolumes(k, vols, g, () => dark, roof, { skipEdge: (_v, e) => same(e), capRing: () => notched });
  const bottom = ringGroundMin(v.ring, g) - 1.0;
  const eastFaces = [k.face(east, bottom, FRAME.terrace, dark), k.face(east, FRAME.terrace, top, dark, { s1: f0 }), k.face(east, FRAME.terrace, top, dark, { s0: f1 })];
  // terrace floor, back and side walls of the recess (facing into the recess)
  k.cap(k.S(), [orient([P(f0, -FRAME.depth), P(f1, -FRAME.depth), P(f1, 0), P(f0, 0)])], FRAME.terrace, roof);
  const back = edgeOf(P(f0, -FRAME.depth), P(f1, -FRAME.depth)), sideA = edgeOf(P(f0, 0), P(f0, -FRAME.depth)), sideB = edgeOf(P(f1, -FRAME.depth), P(f1, 0));
  for (const e of [back, sideA, sideB]) k.wall(k.S(), e.a, e.c, FRAME.terrace, top, white);
  // the frame: posts + front beam + side beams (white, free-standing => back faces); sign = orange blocks (no text)
  for (const s of [f0, f0 + FRAME.w / 3, f0 + 2 * FRAME.w / 3 - 0.8, f1 - 0.8]) k.box(k.S(), east, s, s + 0.8, FRAME.terrace, FRAME.beamTop, -0.8, 0.15, white, true);
  // side beams butt the corner posts' outer faces (no 0.4 m slot between a beam face and a post face)
  k.box(k.S(), east, f0, f1, FRAME.beamTop - 0.9, FRAME.beamTop, -0.8, 0.15, white, true);
  for (const [e, s0, s1] of [[sideA, 0.8, sideA.L], [sideB, 0, sideB.L - 0.8]] as [Edge, number, number][]) { k.box(k.S(), e, s0, s1, FRAME.beamTop - 0.9, FRAME.beamTop, 0, 0.8, white, true); k.box(k.S(), e, e.L / 2 - 0.4, e.L / 2 + 0.4, top, FRAME.beamTop, 0, 0.8, white, true); }
  for (let j = 0; j < 9; j++) { const s = f0 + 1.3 + j * (FRAME.w - 2.6) / 8; k.box(k.D('metal'), east, s - 0.42, s + 0.42, FRAME.beamTop - 0.85, FRAME.beamTop - 0.08, 0.15, 0.27, C('#e2702c')); }
  // Facades: dark podium glazing + band, offset white vertical panels in staggered segments, windows in the dark gaps,
  // full-height corner glass column on the east and south faces.
  let panels = 0, windows = 0;
  for (const e of edgesOf(v.ring)) {
    const faces = same(e) ? eastFaces : faceOf(v, e) ?? [];
    const gy = groundAt(e, g), podTop = gy + 7.5, glassCol = (same(e) || e.n.z > 0.9) ? [e.L * 0.3, e.L * 0.3 + 3.4] : null;
    k.panel(k.D('glass'), e, 0.3, e.L - 0.3, gy + 0.3, podTop - 0.6, 0.03, C('#1d272c'));
    k.attach(faces, 0, e.L, podTop - 0.6, podTop, 0.3, C('#34373c'), 'metal');
    if (glassCol) k.panel(k.D('glass'), e, glassCol[0], glassCol[1], podTop, top - 1.5, 0.03, C('#2c4650'));
    const roofTop = (x: number) => (same(e) && x > f0 - 0.5 && x < f1 + 0.5 ? FRAME.terrace : top);
    let s = 0.6, j = 0;
    while (s < e.L - 1.2) {
      const w = [1.4, 2.4, 1.8, 2.8][Math.floor(hash(e.i, j, 1) * 4)], gap = 1.2 + hash(e.i, j, 2) * 0.7;
      if (glassCol && s + w > glassCol[0] - 0.6 && s < glassCol[1] + 0.6) { s = glassCol[1] + 0.7; j++; continue; }
      let y = podTop, seg = 0;
      const rt = Math.min(roofTop(s - 0.3), roofTop(s + w + 0.3));
      while (y < rt - 1) {
        const floors = 3 + Math.floor(hash(e.i, j, seg + 5) * 4), y1 = Math.min(rt - 0.3, y + floors * 3.0), off = (seg % 2 ? 0.3 : -0.3) * (hash(e.i, j) > 0.5 ? 1 : -1);
        const a = Math.max(0.2, s + off), b = Math.min(e.L - 0.2, s + w + off);
        if (b - a > 0.5 && y1 - y > 1) { k.attach(faces, a, b, y, y1, 0.16, white); panels++; }
        y = y1; seg++;
      }
      for (let fy = podTop + 0.9; fy + 1.5 < roofTop(s + w + gap / 2) - 0.6; fy += 3.0) { k.panel(k.D('glass'), e, s + w + 0.45, s + w + gap - 0.45, fy, fy + 1.5, 0.03, C('#3e6a70')); windows++; }
      s += w + gap; j++;
    }
  }
  st.moontower = { panels, windows, frame: { terraceY: +FRAME.terrace.toFixed(2), beamTopY: +FRAME.beamTop.toFixed(2), widthM: FRAME.w, depthM: FRAME.depth } };
}

// ---------------------------------------------------------------- Skyloft (skyloft-01..-13)
function skyloft(k: Kit, data: CampusData, g: G, st: Record<string, unknown>) {
  const vols = volumesOf(TOWER_KEYS.skyloft, data), [main, mech] = vols;
  const pale = C('#dcd7cb'), warm = C('#c4c7c5'); // N/S faces: cool light-grey panels in skyloft-01 (was warm sand #c9b796)
  const faceOf = buildVolumes(k, vols, g, (v, e) => (v === mech ? pale : Math.abs(e.n.z) > 0.7 ? warm : pale), C('#9a9a96'));
  let windows = 0;
  const es = edgesOf(main.ring), north = es.reduce((b, e) => (e.n.z < b.n.z ? e : b)), west = es.reduce((b, e) => (e.n.x < b.n.x ? e : b));
  // NW corner = W 23rd St / Nueces corner in skyloft-01 (street sign "NUECES"): dark glazed podium corner + canopy.
  const corner = new Map<number, [number, number]>([[north.i, [0, 12]], [west.i, [west.L - 12, west.L]]]);
  for (const v of vols) for (const e of edgesOf(v.ring)) {
    const face = faceOf(v, e), gy = groundAt(e, g), y0 = v === main ? gy + 6.2 : v.bottom + 0.8;
    const slot = e.L > 30 ? [e.L * 0.46, e.L * 0.46 + 2.6] : null;
    if (slot) { k.panel(k.D('glass'), e, slot[0], slot[1], y0 - 2, v.top - 0.4, 0.03, C('#3d4f63'));
      for (const sx of [slot[0] - 0.35, slot[1]]) k.attach(face, sx, sx + 0.35, y0 - 2, v.top, 0.35, C('#6b737c'), 'metal'); }
    windows += punched(k, e, y0, v.top - 1.0, { storey: 3.0, bay: 2.6, w: [0.9, 1.5], h: 1.5, color: '#25467a', seed: e.i + (v === mech ? 50 : 0), skip: s => !!slot && s > slot[0] - 1 && s < slot[1] + 1 });
    if (v === mech) { k.attach(face, 0, e.L, v.top - 1.2, v.top, 0.6, C('#3f6f98'), 'metal'); continue; } // blue-grey cap band
    k.panel(k.D('glass'), e, 0.3, e.L - 0.3, gy + 0.3, gy + 5.6, 0.03, C('#28323a'));
    const cr = corner.get(e.i);
    if (cr) { // two-storey dark glazed corner + projecting canopy (underside 4.6 m above the sidewalk)
      k.attach(face, cr[0], cr[1], gy - 0.5, gy + 9.0, 0.12, C('#1f2a33'), 'glass');
      k.attach(face, cr[0], cr[1], gy + 4.6, gy + 5.0, 2.2, C('#3a3f45'), 'metal'); // canopy underside 4.6 m above the face-midpoint ground
    }
  }
  st.skyloft = { windows };
}

// ---------------------------------------------------------------- The Castilian (castilian-10)
function castilian(k: Kit, data: CampusData, g: G, st: Record<string, unknown>) {
  const vols = volumesOf(TOWER_KEYS.castilian, data), main = vols[0];
  const faceOf = buildVolumes(k, vols, g, v => (v === main ? C('#c9ced0') : C('#e9e9e5')), C('#9a9b98'));
  let fins = 0, piers = 0;
  for (const e of edgesOf(main.ring)) {
    if (e.L < 5) continue;
    const face = faceOf(main, e), gy = groundAt(e, g), finTop = main.top - 3.4;
    k.panel(k.D('glass'), e, 0.2, e.L - 0.2, gy + 0.3, gy + 4.3, 0.03, C('#1f272b'));
    k.panel(k.D('glass'), e, 0.2, e.L - 0.2, gy + 4.6, finTop, 0.03, C('#7e9cb0'));
    for (let s = 0.6; s < e.L - 0.6; s += 1.15) { k.attach(face, s, s + 0.22, gy + 4.6, finTop, 0.5, C('#dfe7ea')); fins++; }
    k.panel(k.D('glass'), e, 0, e.L, finTop, main.top - 0.45, 0.04, C('#1a2024')); // dark band above the podium
    k.attach(face, 0, e.L, main.top - 0.45, main.top, 0.3, C('#f0f0ec'));
  }
  for (const v of vols.slice(1)) for (const e of edgesOf(v.ring)) {
    if (e.L < 4 || v.role === 'mech') continue;
    const face = faceOf(v, e), n = Math.max(1, Math.round(e.L / 3.0));
    // slender pale piers (only on edges >= 6 m, kept 1.0 m from the corners of the jagged LiDAR tier rings)
    if (e.L >= 6) for (let j = 0; j <= n; j++) { const s = Math.min(e.L - 1.45, Math.max(1.0, j * e.L / n - 0.22)); k.attach(face, s, s + 0.45, v.bottom, v.top, 0.32, C('#f2f2ee')); piers++; }
    for (let y = v.bottom + 0.9; y + 1.9 < v.top - 0.5; y += 3.05) for (let j = 0; j < n; j++) k.panel(k.D('glass'), e, j * e.L / n + 0.4, (j + 1) * e.L / n - 0.4, y, y + 1.9, 0.03, C('#20292e'));
  }
  st.castilian = { fins, piers };
}

// ---------------------------------------------------------------- 2400 Nueces + Nueces Garage (nueces2400-00/-39/-43/-44)
function nueces(k: Kit, data: CampusData, g: G, st: Record<string, unknown>) {
  const vols = volumesOf(TOWER_KEYS.nueces2400, data);
  const [garage, podium, south, north, core] = vols;
  // Tones from nueces2400-00 / -43 (build-11 review: the north mass read saturated yellow): deep maroon panel on the
  // podium and south mass, muted tan-ochre on the north mass (the pale tan tower in nueces2400-00), zinc grey core.
  const colour = (v: Vol) => (v === garage ? '#a29f98' : v === podium ? '#6e2c26' : v === south ? '#6a2823' : v === north ? '#a48b62' : '#868a8d');
  const faceOf = buildVolumes(k, vols, g, v => C(colour(v)), C('#9a9b98'));
  const inside = (x: number, z: number, y: number, self: Vol) => vols.some(o => o !== self && y < o.top && y > o.bottom - 0.01 && inRing(x, z, o.ring));
  const slats = ['#b09450', '#8e3a2c', '#ddd8cc', '#7b7d80', '#66704a', '#c4b385'];
  let nSlats = 0, balconies = 0;
  for (const v of vols) for (const e of edgesOf(v.ring)) {
    if (e.L < 3) continue;
    const mid = at(e, e.L / 2, 0, 0.5);
    if (inside(mid.x, mid.z, v.bottom + 2, v)) continue; // interior (shared) wall
    const face = faceOf(v, e), gy = groundAt(e, g);
    if (v === garage) { // multicolour vertical slats over the garage decks (nueces2400-00 left)
      // slats kept >= 0.8 m from the corners (no slat in front of the next wall)
        for (let s = 0.8, j = 0; s < e.L - 1.2; s += 1.0, j++) { k.attach(face, s, s + 0.38, gy + 3.6, v.top - 0.3, 0.42, C(slats[Math.floor(hash(e.i, j) * slats.length)])); nSlats++; }
      continue;
    }
    if (v === podium) { // pale limestone street base with storefront glazing, red above
      k.attach(face, 0, e.L, gy - 0.5, gy + 5.2, 0.12, C('#c0a477')); // honey ashlar limestone base (nueces2400-43)
      k.panel(k.D('glass'), e, 0.6, e.L - 0.6, gy + 0.4, gy + 4.4, 0.13, C('#22302f'));
      punched(k, e, gy + 6.4, v.top - 0.6, { storey: 3.0, bay: 3.2, w: [1.4, 2.2], h: 1.8, color: '#2a3638', seed: e.i + 300 });
      continue;
    }
    punched(k, e, v.bottom + 0.9, v.top - 0.6, { storey: 3.0, bay: 3.2, w: [1.4, 2.4], h: 1.9, color: '#26323a', seed: e.i + (v === north ? 100 : 200) });
    if (v === core || e.L < 10) continue;
    // stacked cantilevered balconies: two columns per long exterior face, every storey (concrete slab + glass rail)
    for (const sc of [e.L * 0.3, e.L * 0.7]) for (let y = v.bottom + 3.0; y < v.top - 2.5; y += 3.0) {
      const p = at(e, sc, y, 1.0); if (inside(p.x, p.z, y + 0.5, v)) continue;
      k.attach(face, sc - 1.6, sc + 1.6, y - 0.25, y, 1.7, C('#c8c6c0'));
      k.panel(k.D('glass'), e, sc - 1.6, sc + 1.6, y, y + 1.05, 1.68, C('#9fb3b8')); balconies++;
    }
  }
  st.nueces2400 = { slats: nSlats, balconies };
}

// ---------------------------------------------------------------- Torre (torre-02/-03/-04/-07/-11/-14)
/** Clip a ring to the band t0 <= (p - o).u <= t1 (Sutherland-Hodgman twice). */
function band(ring: Point[], o: Point, u: Point, t0: number, t1: number): Point[] {
  const T = (p: Point) => (p[0] - o[0]) * u[0] + (p[1] - o[1]) * u[1];
  const clip = (r: Point[], keep: (t: number) => boolean, edge: number) => {
    const out: Point[] = [];
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], ta = T(a), tb = T(b);
      if (keep(ta)) out.push(a);
      if (keep(ta) !== keep(tb)) { const f = (edge - ta) / (tb - ta); out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); }
    }
    return out;
  };
  return clip(clip(ring, t => t >= t0, t0), t => t <= t1, t1);
}
/** Terraces (estimate, torre-02/-03): 2-storey steps descending toward the south end of the Nueces face. */
export const TORRE_STEPS = [{ t0: -1, t1: 40, drop: 0 }, { t0: 40, t1: 46.5, drop: 6.2 }, { t0: 46.5, t1: 53, drop: 12.4 }, { t0: 53, t1: 70, drop: 18.6 }];
export const TORRE_AXIS = { o: [-671.25, 245.09] as Point, to: [-675.86, 303.1] as Point };
function torre(k: Kit, data: CampusData, g: G, st: Record<string, unknown>) {
  const [v] = volumesOf(TOWER_KEYS.torre, data), ring = recordRing(TOWER_KEYS.torre, data);
  const o = TORRE_AXIS.o, d = [TORRE_AXIS.to[0] - o[0], TORRE_AXIS.to[1] - o[1]], L = Math.hypot(d[0], d[1]), u: Point = [d[0] / L, d[1] / L];
  const white = C('#efefeb'), gyMin = ringGroundMin(ring, g) - 1.0, podTop = v.bottom + 13.0;
  // podium (whole ring) to the podium roof, then the stepped tower above it
  const podFaces = new Map<number, Face>();
  for (const e of edgesOf(ring)) podFaces.set(e.i, k.face(e, gyMin, podTop, C('#9fa4a6')));
  k.cap(k.S(), [ring], podTop, C('#8f908c'));
  const steps = TORRE_STEPS.map(s => ({ ...s, ring: orient(band(ring, o, u, s.t0, s.t1)), top: v.top - s.drop }));
  let windows = 0;
  for (const s of steps) {
    if (s.ring.length < 3) continue;
    k.cap(k.S(), [s.ring], s.top, C('#b9bab6'));
    for (const e of edgesOf(s.ring)) {
      if (e.L < 0.05) continue;
      const mid = at(e, e.L / 2, 0, 0.6);
      const coveredTo = Math.max(podTop, ...steps.filter(q => q !== s && q.ring.length >= 3 && inRing(mid.x, mid.z, q.ring)).map(q => q.top));
      if (coveredTo >= s.top - 0.05) continue; // internal step wall, fully hidden
      const face = k.face(e, coveredTo, s.top, white);
      if (e.L < 2) continue;
      windows += punched(k, e, coveredTo + 0.8, s.top - 0.8, { storey: 3.1, bay: 1.9, w: [0.7, 1.7], h: 2.3, color: '#2a383e', seed: e.i * 13 + s.t0, skip: (x, y) => hash(e.i + s.t0, Math.round(x * 3), Math.round(y)) < 0.18 });
      // continuous dark glazed amenity band two storeys below the top of the highest level (proud 0.3 m)
      if (s.drop === 0) k.attach(face, 0, e.L, Math.max(coveredTo, v.top - 12.4), v.top - 6.2, 0.3, C('#25333a'), 'glass');
      k.box(k.S(), e, 0, e.L, s.top, s.top + 1.05, -0.07, 0.0, C('#d9dcdc'), true); // terrace guard / parapet
    }
  }
  // podium: glazed ground floor, grey metal screen above, deep timber entrance soffit at the 21st / Nueces corner
  const es = edgesOf(ring), eastFace = es.reduce((b, e) => (e.n.x > b.n.x ? e : b)), gyE = groundAt(eastFace, g);
  for (const e of es) {
    if (e.L < 2) continue;
    const gy = groundAt(e, g);
    k.panel(k.D('glass'), e, 0.3, e.L - 0.3, gy + 0.3, gy + 4.3, 0.03, C('#1d2629'));
    k.attach(podFaces.get(e.i)!, 0, e.L, gy + 5.1, podTop - 0.3, 0.18, C('#a6abad'), 'metal');
  }
  const nEnd = eastFace.u.z < 0 ? eastFace.L : 0; // the north end of the Nueces face
  const [sa, sb] = nEnd > 0 ? [eastFace.L - 10, eastFace.L] : [0, 10];
  k.attach(podFaces.get(eastFace.i)!, sa, sb, gyE + 4.5, gyE + 5.1, 2.4, C('#9b6438'));
  st.torre = { windows, steps: steps.map(s => ({ t0: s.t0, t1: s.t1, topY: +s.top.toFixed(2), pts: s.ring.length })), podiumTopY: +podTop.toFixed(2) };
}

/** 733549:1241 (low post-2017 building 1-5 m south of Torre): its north edge lies within the coverage raster's 1.5 m of the
 * authored Torre podium, which would make the generator drop it ('authored'); it is rebuilt here UNCHANGED from its own
 * massing (City 2023 h) so it stays in the scene. */
export const TORRE_NEIGHBOUR = '733549:1241';
/** 551525:438, a hipped house 2 m south of Torre's SW corner: same reason, rebuilt unchanged from its massing (hip). */
export const TORRE_HOUSE = '551525:438';
const HOUSE_SLOPE = 0.441;
export function buildTowers(k: Kit, data: CampusData, g: G, st: Record<string, unknown>) {
  moontower(k, data, g, st); skyloft(k, data, g, st); castilian(k, data, g, st); nueces(k, data, g, st); torre(k, data, g, st);
  buildVolumes(k, volumesOf(TORRE_NEIGHBOUR, data), g, () => C('#cdc6b8'), C('#9a9b98'));
  const [house] = volumesOf(TORRE_HOUSE, data); // hip-shingle house, same massing (ridge top, slope 0.441)
  hipBody(k, house.ring, ringGroundMin(house.ring, g) - 1.0, house.top, HOUSE_SLOPE, C('#d8d0bf'), C('#6e6a63'));
  return [...Object.values(TOWER_KEYS), TORRE_NEIGHBOUR, TORRE_HOUSE] as string[];
}
