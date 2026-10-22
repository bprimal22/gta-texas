// D22 — UFCU Disch-Falk Field grandstand (City 507419:225, UT DFF), replacing the generated flat box.
// Evidence: d22-orbit-southwest / -southeast (usable: buff-brick street facades with a tall recessed-bay rhythm, a pale
// glazed band below a white roof), d22-orbit-northeast (usable: raked dark seating bowl under the roof, wrapping home plate);
// d22-orbit-northwest is roof-only (white roof extent only). Measured: City/UT ring; 2017 USGS 3DEP LiDAR in
// lidar-reference.json (groundY 11.5 field level, roof P50 29.6, front tier band to 32.7 along the field edge, perimeter
// street ground ~15.7). Interpretive / estimate: bay pitch (~7.6 m), opening size, brick top, glazed suite band, 18 seat
// rows of 1.0 x 0.42 m, roof slab 1.1 m. No interior, concourse plan or press box is documented.
// Revision 2 (root IAB review + ut-dff-524-directory-photo.jpg, official UT photograph of the west street facade): a pale
// stone/concrete plinth below the brick (plinth top = street grade + 1.0 m, estimate), tall dark open bays starting on the
// plinth, a pale stone band at the bay heads, buff brick above; the upper storey is pale metal cladding with a clerestory row
// of glazing (not one glass band); on the WEST facade only, a horizontal steel beam and one diagonal steel brace per bay
// inside the open bays (the photo shows these there; no bracing is invented elsewhere). Roof: membrane PBR with shallow
// standing-seam ribs. Local PBR maps (brick / stone / concrete / membrane) at their metre tiles; seats, glass, steel untextured.
import type * as THREE from 'three';
import type { Point } from '../../types';
import type { BlockInstallContext } from '../types';
import { Kit, col, outward, offsetChain, lerp2, unit, V, DOWN, UP, type Mat } from './lane-kit';

export const DFF_KEY = '507419:225';
const FIRST: Point = [1056.37, 749.26], LAST: Point = [987.34, 700.67];
export const DFF = {
  roofBackY: 29.6,   // LiDAR roof P50 (campus Y)
  roofFrontY: 32.4,  // LiDAR front tier band (P90 32.35, tier top 32.7)
  slab: 1.1, seatDepth: 18, rows: 18, rise: 0.42, frontWall: 1.2, parapet: 1.1,
  brickTop: 24.4, bandTop: 27.9, bandRecess: 0.8, bay: 7.6, pier: 0.75, recess: 0.45, endInset: 0.4,
} as const;
const C = {
  brick: col('#c79a6c'), brickDark: col('#b88b5f'), recess: col('#2f2a27'), concrete: col('#c3beb1'), fascia: col('#e8eaea'),
  roof: col('#e4e5e2'), soffit: col('#cfd0cd'), glass: col('#34444f'), seat: col('#2f4237'), riser: col('#a6a7a1'), pad: col('#2c3d33'),
  plinth: col('#e2ded4'), band: col('#ddd8cc'), cladding: col('#c6ccd0'), clerestory: col('#2e3b45'), steel: col('#3b4043'), rib: col('#d2d4d2'),
};
/** Plinth / band heights (estimates read from ut-dff-524-directory-photo.jpg against the ~2.3 m pier banners). */
export const DFF_FACADE = { plinth: 1.0, openingHeight: 7.6, band: 0.45, clerestory: { width: 1.6, height: 1.3, pitch: 2.4 }, ribPitch: 2.4 } as const;
/** West street facade = ring edge 9 (v9 -> v10), the subject of the official photograph. */
const WEST_EDGE = 9;

export function buildDischFalk(kit: Kit, ctx: BlockInstallContext) {
  const b = ctx.data.buildings.find(x => x.key === DFF_KEY);
  if (!b) throw new Error(`D22: ${DFF_KEY} not in campus data`);
  const ring = b.rings[0] as Point[], n = ring.length;
  const near = (p: Point, q: Point) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.05;
  if (!near(ring[0], FIRST) || !near(ring[8], LAST)) throw new Error('D22: DFF ring order differs from the City source order');
  const g = ctx.groundHeight;
  // Field-side chain v0..v8 (curved around home plate, then the third-base line); ends pulled 0.4 m clear of the end walls.
  const chain = ring.slice(0, 9).map(p => [p[0], p[1]] as Point);
  chain[0] = lerp2(chain[0], chain[1], DFF.endInset / Math.hypot(chain[1][0] - chain[0][0], chain[1][1] - chain[0][1]));
  chain[8] = lerp2(chain[8], chain[7], DFF.endInset / Math.hypot(chain[7][0] - chain[8][0], chain[7][1] - chain[8][1]));
  const startDir = unit(ring[0], ring[n - 1]), endDir = unit(ring[8], ring[9]);
  const back = offsetChain(chain, DFF.seatDepth, sideInto(ring, chain), startDir, endDir);
  const row = (j: number) => chain.map((p, k) => lerp2(p, back[k], j / DFF.rows));
  const fg = chain.map(p => g(p[0], p[1])).sort((a, c) => a - c)[Math.floor(chain.length / 2)];
  const yFront = fg + DFF.frontWall, yTop = yFront + (DFF.rows - 1) * DFF.rise;
  const roofAt = (t: number) => DFF.roofFrontY + (DFF.roofBackY - DFF.roofFrontY) * t; // t = 0 field edge .. 1 back line
  const seg = (L: Point[], k: number, y0: number, y1: number, color: typeof C.seat, layer: 'solid' | 'walk', facing: Point, mat: Mat = 'matte') =>
    kit.quad(layer, mat, V(L[k][0], y0, L[k][1]), V(L[k + 1][0], y0, L[k + 1][1]), V(L[k + 1][0], y1, L[k + 1][1]), V(L[k][0], y1, L[k][1]), color, V(facing[0], 0, facing[1]));
  const fieldward = (L: Point[], k: number): Point => { const d = unit(L[k], L[k + 1]), s = sideInto(ring, chain); return [(d[1]) * s, (-d[0]) * s]; };
  let base = Infinity; for (const p of ring) base = Math.min(base, g(p[0], p[1]));
  // 1. Field wall and raked seating (walkable treads; risers share the walkable collider).
  for (let k = 0; k + 1 < chain.length; k++) seg(chain, k, base - 0.6, yFront, C.pad, 'solid', fieldward(chain, k));
  for (let j = 0; j < DFF.rows; j++) {
    const L0 = row(j), L1 = row(j + 1), y = yFront + j * DFF.rise;
    for (let k = 0; k + 1 < chain.length; k++) {
      kit.quad('walk', 'matte', V(L0[k][0], y, L0[k][1]), V(L0[k + 1][0], y, L0[k + 1][1]), V(L1[k + 1][0], y, L1[k + 1][1]), V(L1[k][0], y, L1[k][1]), C.seat, UP);
      if (j + 1 < DFF.rows) seg(L1, k, y, y + DFF.rise, C.riser, 'walk', fieldward(L1, k));
    }
  }
  // 2. Back wall of the stand (concrete parapet, then a glazed suite band under the roof) facing the field.
  for (let k = 0; k + 1 < back.length; k++) {
    const f = fieldward(back, k), under = roofAt(1) - DFF.slab;
    seg(back, k, yTop, yTop + DFF.parapet, C.concrete, 'solid', f, 'concrete');
    seg(back, k, yTop + DFF.parapet, under, C.glass, 'solid', f, 'glass');
  }
  // 3. Roof: sloped canopy over the stand (top + soffit + field edge), flat roof over the enclosed rear part.
  for (let k = 0; k + 1 < chain.length; k++) {
    const a = chain[k], b2 = chain[k + 1], c = back[k + 1], d = back[k];
    kit.quad('solid', 'membrane', V(a[0], roofAt(0), a[1]), V(b2[0], roofAt(0), b2[1]), V(c[0], roofAt(1), c[1]), V(d[0], roofAt(1), d[1]), C.roof, UP, topUV);
    kit.quad('solid', 'concrete', V(a[0], roofAt(0) - DFF.slab, a[1]), V(b2[0], roofAt(0) - DFF.slab, b2[1]), V(c[0], roofAt(1) - DFF.slab, c[1]), V(d[0], roofAt(1) - DFF.slab, d[1]), C.soffit, DOWN);
    seg(chain, k, roofAt(0) - DFF.slab, roofAt(0), C.fascia, 'solid', fieldward(chain, k), 'metal');
    // Standing-seam ribs running down the slope (visual, 8 cm).
    const segLen = Math.hypot(b2[0] - a[0], b2[1] - a[1]), T = unit(a, b2), nr = Math.max(1, Math.round(segLen / DFF_FACADE.ribPitch));
    for (let r = 0; r < nr; r++) {
      const f = (r + 0.5) / nr, p0 = lerp2(a, b2, f), p1 = lerp2(d, c, f);
      rib(kit, V(p0[0], roofAt(0), p0[1]), V(p1[0], roofAt(1), p1[1]), T);
    }
  }
  const ends: [number, Point, Point][] = [[8, chain[8], back[8]], [n - 1, chain[0], back[0]]];
  const qOuters: Point[] = [];
  for (const [i, pin, qin] of ends) {
    const a = ring[i], b2 = ring[(i + 1) % n], nOut = outward(ring, i);
    const field = i === 8 ? a : b2; // ring corner at the field edge
    const far = i === 8 ? b2 : a;
    const qOuter: Point = [qin[0] + nOut[0] * DFF.endInset, qin[1] + nOut[1] * DFF.endInset];
    const gF = Math.min(g(field[0], field[1]), g(qOuter[0], qOuter[1])) - 0.6;
    // Outer face, field corner -> back line (sloped top), then back line -> far corner (flat roof height).
    const pt = Math.max(g(field[0], field[1]), g(qOuter[0], qOuter[1])) + DFF_FACADE.plinth;
    kit.quad('solid', 'stone', V(field[0], gF, field[1]), V(qOuter[0], gF, qOuter[1]), V(qOuter[0], pt, qOuter[1]), V(field[0], pt, field[1]), C.plinth, V(nOut[0], 0, nOut[1]));
    kit.quad('solid', 'brick', V(field[0], pt, field[1]), V(qOuter[0], pt, qOuter[1]), V(qOuter[0], roofAt(1), qOuter[1]), V(field[0], roofAt(0), field[1]), C.brick, V(nOut[0], 0, nOut[1]));
    facade(kit, qOuter, far, nOut, g, true, false);
    // Inner face along the stand end (seen from the seats), field side cap and top strip.
    kit.quad('solid', 'concrete', V(pin[0], gF, pin[1]), V(qin[0], gF, qin[1]), V(qin[0], roofAt(1) - DFF.slab, qin[1]), V(pin[0], roofAt(0) - DFF.slab, pin[1]), C.concrete, V(-nOut[0], 0, -nOut[1]));
    const fd = unit(qin, pin);
    kit.quad('solid', 'brick', V(pin[0], gF, pin[1]), V(field[0], gF, field[1]), V(field[0], roofAt(0), field[1]), V(pin[0], roofAt(0), pin[1]), C.brickDark, V(fd[0], 0, fd[1]));
    // Roof over the 0.4 m wall (continues the sloped canopy to the GIS line).
    kit.quad('solid', 'membrane', V(field[0], roofAt(0), field[1]), V(qOuter[0], roofAt(1), qOuter[1]), V(qin[0], roofAt(1), qin[1]), V(pin[0], roofAt(0), pin[1]), C.roof, UP, topUV);
    qOuters.push(qOuter);
  }
  // Flat roof over the enclosed rear part: back line, end-wall corners, outer ring v9..v(n-1).
  const rear: Point[] = [...back, qOuters[0], ...ring.slice(9), qOuters[1]];
  kit.cap('solid', 'membrane', [rear], DFF.roofBackY, C.roof);
  const ribs = rearRibs(kit, rear, unit(chain[4], back[4]));
  // 5. Street facades on every other outer edge.
  for (let i = 9; i < n - 1; i++) facade(kit, ring[i], ring[i + 1], outward(ring, i), g, false, i === WEST_EDGE);
  return { yFront: +yFront.toFixed(2), yTopTread: +yTop.toFixed(2), rows: DFF.rows, roofFrontY: DFF.roofFrontY, roofBackY: DFF.roofBackY, rearRibs: ribs };
}

const topUV = (p: { x: number; z: number }): Point => [p.x, p.z];
/** Shallow standing seam: an 8 cm tent of two narrow faces along p0 -> p1 (lateral axis T). Visual only. */
function rib(kit: Kit, p0: THREE.Vector3, p1: THREE.Vector3, T: Point) {
  const w = 0.06, h = 0.08, L = (p: THREE.Vector3, s: number) => V(p.x + T[0] * s, p.y, p.z + T[1] * s), Hh = (p: THREE.Vector3) => V(p.x, p.y + h, p.z);
  const m = kit.mb('detail', 'metal');
  for (const s of [-1, 1]) m.quad(L(p0, s * w), L(p1, s * w), Hh(p1), Hh(p0), [0, 0], [1, 0], [1, 1], [0, 1], C.rib, V(T[0] * s, 1, T[1] * s));
}
/** Ribs on the flat rear roof: lines along `dir` every rib pitch, clipped to the polygon (even-odd). */
function rearRibs(kit: Kit, poly: Point[], dir: Point) {
  const nrm: Point = [-dir[1], dir[0]];
  const proj = poly.map(p => p[0] * nrm[0] + p[1] * nrm[1]), lo = Math.min(...proj), hi = Math.max(...proj);
  let count = 0;
  for (let c = lo + DFF_FACADE.ribPitch / 2; c < hi; c += DFF_FACADE.ribPitch) {
    const ts: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], ca = proj[i] - c, cb = proj[(i + 1) % poly.length] - c;
      if ((ca > 0) === (cb > 0) || ca === cb) continue;
      const f = ca / (ca - cb), x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f; ts.push(x * dir[0] + z * dir[1]);
    }
    ts.sort((a, b) => a - b);
    for (let k = 0; k + 1 < ts.length; k += 2) {
      if (ts[k + 1] - ts[k] < 1) continue;
      const P = (t: number) => V(nrm[0] * c + dir[0] * t, DFF.roofBackY, nrm[1] * c + dir[1] * t);
      rib(kit, P(ts[k] + 0.3), P(ts[k + 1] - 0.3), nrm); count++;
    }
  }
  return count;
}

/** +1 / -1: which side of the chain the ring interior (the stand) lies on. */
function sideInto(ring: Point[], chain: Point[]): 1 | -1 {
  const a = chain[3], b = chain[4], d = unit(a, b), m = lerp2(a, b, 0.5), p: Point = [m[0] - d[1] * 3, m[1] + d[0] * 3];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, zi] = ring[i], [xj, zj] = ring[j]; if ((zi > p[1]) !== (zj > p[1]) && p[0] < (xj - xi) * (p[1] - zi) / (zj - zi) + xi) inside = !inside; }
  return inside ? 1 : -1;
}

/** Street facade (ut-dff-524-directory-photo.jpg): pale stone plinth, tall dark open bays between brick piers starting on the
 * plinth, a pale stone band at the bay heads, brick to the brick top, then pale metal cladding (recessed 0.8 m) with a
 * clerestory row of glazing and a pale fascia to the roof. Everything stays on or inside the GIS line (recesses go inward). */
function facade(kit: Kit, a: Point, b: Point, nOut: Point, g: (x: number, z: number) => number, plainBrick: boolean, braces: boolean) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.05) return;
  const T = unit(a, b), N = nOut, O = a;
  const P = (t: number, d: number, y: number) => V(O[0] + T[0] * t - N[0] * d, y, O[1] + T[1] * t - N[1] * d);
  const out = V(N[0], 0, N[1]), down = DOWN, up = UP;
  const face = (t0: number, t1: number, d: number, y0: number, y1: number, c: THREE.Color, mat: Mat) => {
    if (y1 - y0 > 0.01 && t1 - t0 > 0.01) kit.quad('solid', mat, P(t0, d, y0), P(t1, d, y0), P(t1, d, y1), P(t0, d, y1), c, out);
  };
  const gs = [g(a[0], a[1]), g(b[0], b[1]), g((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)];
  const gMin = Math.min(...gs) - 0.6, pt = Math.max(...gs) + DFF_FACADE.plinth;
  const roofY = DFF.roofBackY, bt = DFF.brickTop, ft = DFF.bandTop, r = DFF.bandRecess;
  const head = Math.min(pt + DFF_FACADE.openingHeight, bt - 1.6), bandTop = head + DFF_FACADE.band;
  // Fascia, metal cladding (recessed) with its soffit, sill and end returns, clerestory glazing row (visual).
  face(0, len, 0, ft, roofY, C.fascia, 'metal');
  face(0, len, r, bt, ft, C.cladding, 'metal');
  kit.quad('solid', 'metal', P(0, 0, ft), P(len, 0, ft), P(len, r, ft), P(0, r, ft), C.fascia, down);
  kit.quad('solid', 'concrete', P(0, r, bt), P(len, r, bt), P(len, 0, bt), P(0, 0, bt), C.concrete, up);
  kit.quad('solid', 'concrete', P(0, 0, bt), P(0, r, bt), P(0, r, ft), P(0, 0, ft), C.concrete, V(-T[0], 0, -T[1]));
  kit.quad('solid', 'concrete', P(len, r, bt), P(len, 0, bt), P(len, 0, ft), P(len, r, ft), C.concrete, V(T[0], 0, T[1]));
  const W = DFF_FACADE.clerestory, nw = Math.floor((len - 0.6) / W.pitch), w0 = (len - nw * W.pitch) / 2, yc = (bt + ft) / 2;
  for (let k = 0; k < nw; k++) {
    const t0 = w0 + k * W.pitch + (W.pitch - W.width) / 2, q = (t: number, y: number) => P(t, r - 0.02, y);
    kit.mb('detail', 'glass').quad(q(t0, yc - W.height / 2), q(t0 + W.width, yc - W.height / 2), q(t0 + W.width, yc + W.height / 2), q(t0, yc + W.height / 2), [0, 0], [1, 0], [1, 1], [0, 1], C.clerestory, out);
  }
  // Plinth, stone band and brick above the band run the full length.
  face(0, len, 0, gMin, pt, C.plinth, 'stone');
  face(0, len, 0, head, bandTop, C.band, 'stone');
  face(0, len, 0, bandTop, bt, C.brick, 'brick');
  const bays = plainBrick || len < DFF.bay * 0.75 ? 0 : Math.max(1, Math.round(len / DFF.bay));
  if (!bays) { face(0, len, 0, pt, head, C.brick, 'brick'); return; }
  const bw = len / bays, d = DFF.recess;
  for (let k = 0; k < bays; k++) {
    const s = k * bw, o0 = s + DFF.pier + 0.6, o1 = s + bw - DFF.pier - 0.6;
    face(s, o0, 0, pt, head, C.brick, 'brick'); face(o1, s + bw, 0, pt, head, C.brick, 'brick');
    face(o0, o1, d, pt, head, C.recess, 'matte');
    kit.quad('solid', 'brick', P(o0, 0, pt), P(o0, d, pt), P(o0, d, head), P(o0, 0, head), C.brickDark, V(T[0], 0, T[1]));
    kit.quad('solid', 'brick', P(o1, d, pt), P(o1, 0, pt), P(o1, 0, head), P(o1, d, head), C.brickDark, V(-T[0], 0, -T[1]));
    kit.quad('solid', 'stone', P(o0, 0, head), P(o1, 0, head), P(o1, d, head), P(o0, d, head), C.band, down);
    kit.quad('solid', 'stone', P(o0, d, pt), P(o1, d, pt), P(o1, 0, pt), P(o0, 0, pt), C.plinth, up);
    if (braces) {   // horizontal beam + one diagonal brace per bay, 8 cm in front of the dark back (visual)
      const m = kit.mb('detail', 'metal'), dd = d - 0.08, yb = pt + (head - pt) * 0.45;
      const Q = (t: number, y: number) => P(t, dd, y);
      m.quad(Q(o0, yb - 0.18), Q(o1, yb - 0.18), Q(o1, yb + 0.18), Q(o0, yb + 0.18), [0, 0], [1, 0], [1, 1], [0, 1], C.steel, out);
      const [ta, tb] = k % 2 ? [o1 - 0.2, o0 + 0.2] : [o0 + 0.2, o1 - 0.2], ya = pt + 0.2, yb2 = head - 0.2;
      const len2 = Math.hypot(tb - ta, yb2 - ya), nt = -(yb2 - ya) / len2 * 0.14, ny = (tb - ta) / len2 * 0.14;
      m.quad(Q(ta - nt, ya - ny), Q(tb - nt, yb2 - ny), Q(tb + nt, yb2 + ny), Q(ta + nt, ya + ny), [0, 0], [1, 0], [1, 1], [0, 1], C.steel, out);
    }
  }
}
