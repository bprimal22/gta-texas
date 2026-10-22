// D03 Student Services Building (SSB, City record 656376:923; UT: 7 floors, 1997), rebuilt by b02 install() (context.json `replaces`)
// because the generator can only draw a flat box: the building is a pale precast block with brick infill storeys, an OPEN TOP GALLERY
// on square piers under a broad red clay-tile hip roof (online-photos ut-ssb-476-directory-photo.jpg; full-map-30m b06-r0-b1-30m,
// right background, roughly px 760-1060 x 170-330 - identity by projecting this ring through that camera).
//  * Plan: the City ring (L plan, rectilinear within 0.02 m, building frame rotated 5.07 deg) = the ROOF / eave outline: the 2017 DSM
//    has roof returns up to the ring and ground (15.45) 0.5 m outside it (.work/claude-engineering/ssb/dsm-window.json).
//  * Roof: MEASURED from that DSM (height vs distance d to the ring): eave 37.45 at the ring, rising 0.66 m/m (33.4 deg; record
//    34.2 deg) to a flat crest 42.92, with two rectangular roof wells floored at 37.63 (W1 13.1 x 21.3 m in the east wing, W2
//    12.9 x 11.7 m in the west wing; LiDAR record tiers 26.2 m) whose inner walls drop vertically from the crest. Built as EXACT
//    planar facets: per wing rectangle min(eave planes, crest) (convex clipping), the two wings joined by their upper envelope (valley).
//  * Facade (REFERENCE-INTERPRETED; sizes ESTIMATES): roof overhang 0.9 m beyond the facade line; top storey an open gallery
//    (floor 33.4 to soffit 37.1) with 0.7 m square piers on a 3.7 m bay and a 0.6 m architrave, back wall 2.2 m behind the piers with
//    one window per bay; belt cornice at the gallery floor; two pale storeys with punched windows (26.0-33.4), two storeys with red
//    brick infill panels between pale piers (18.6-26.0), glazed ground storey; storey 3.7 m counted down from the gallery floor
//    (7 floors on the low-side LiDAR ground 11.4). The tall glazed stair bay with brick fins is centred at 32 m along the long
//    south face (projection of the source px 963-987 onto the face: s 26.8-37.4 m; the photo shows it central); 6.0 m wide.
//  * Physical: one trimesh collider of every solid triangle (walls, gallery floor, piers, architrave, back wall, soffit, fascia,
//    roof facets, wells); the gallery between the piers is open (no closed-box collider). Panes / panels / belt are flush detail.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Point } from '../../types';
import { offsetRing } from '../../context-geometry';

export const SSB_KEY = '656376:923';
export const SSB = {
  eave: 37.45, slope: 0.66, crest: 42.92, wellY: 37.63,
  wells: [{ name: 'W1', u0: -23.6, u1: -10.5, v0: 43.0, v1: 64.3 }, { name: 'W2', u0: -57.5, u1: -44.6, v0: 8.9, v1: 20.6 }],
  overhang: 0.9, galleryDepth: 2.2, galleryFloor: 33.4, soffit: 37.1, beam: 0.6, beamDepth: 0.5, pier: 0.7, bay: 3.7, storey: 3.7,
  paleFrom: 26.0, brickFrom: 18.6, window: [1.5, 1.8] as [number, number], galleryWindow: [1.4, 1.9] as [number, number],
  stair: { s: 32.0, width: 6.0 },
};
type UV = [number, number];
type Pl = [number, number, number];
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0), DOWN = V(0, -1, 0);

class Bucket {
  pos: number[] = [];
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, hint?: THREE.Vector3) {
    if (hint && new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).dot(hint) < 0) [b, c] = [c, b];
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, hint: THREE.Vector3) { this.tri(a, b, c, hint); this.tri(a, c, d, hint); }
  /** Flat panel on a wall: edge origin o, along u, outward n; x along, y = centre height, z = offset out. */
  panel(o: THREE.Vector3, u: THREE.Vector3, n: THREE.Vector3, x: number, y: number, z: number, w: number, h: number) {
    const P = (sx: number, sy: number) => o.clone().addScaledVector(u, x + sx * w / 2).setY(y + sy * h / 2).addScaledVector(n, z);
    this.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), n);
  }
}

/** Convex polygon clip keeping A u + B v + C <= 0. */
function clip(poly: UV[], A: number, B: number, C: number): UV[] {
  const out: UV[] = [], f = (p: UV) => A * p[0] + B * p[1] + C;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a), fb = f(b);
    if (fa <= 1e-9) out.push(a);
    if ((fa <= 1e-9) !== (fb <= 1e-9)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
const areaUV = (p: UV[]) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; };
const ev = (pl: Pl, p: UV) => pl[0] * p[0] + pl[1] * p[1] + pl[2];
type Rect = { u0: number; u1: number; v0: number; v1: number };
const rectPoly = (r: Rect): UV[] => [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]];
function hipPlanes(r: Rect): Pl[] {
  const E = SSB.eave, s = SSB.slope;
  return [[s, 0, E - s * r.u0], [-s, 0, E + s * r.u1], [0, s, E - s * r.v0], [0, -s, E + s * r.v1], [0, 0, SSB.crest]];
}
/** Exact facets of one rectangle's hip-with-crest roof: the region of each plane where it is the lowest. */
function rectFacets(r: Rect, region: UV[]): { poly: UV[]; pl: Pl }[] {
  const pls = hipPlanes(r), out: { poly: UV[]; pl: Pl }[] = [];
  pls.forEach((pk, k) => {
    let poly = region;
    pls.forEach((pj, j) => { if (j !== k && poly.length >= 3) poly = clip(poly, pk[0] - pj[0], pk[1] - pj[1], pk[2] - pj[2]); });
    if (poly.length >= 3 && Math.abs(areaUV(poly)) > 1e-6) out.push({ poly, pl: pk });
  });
  return out;
}
const clipToPoly = (poly: UV[], conv: UV[]) => { // intersection of two convex polygons (conv counter-clockwise)
  const ccw = areaUV(conv) > 0 ? conv : conv.slice().reverse(); let p = poly;
  for (let i = 0; i < ccw.length && p.length >= 3; i++) { const a = ccw[i], b = ccw[(i + 1) % ccw.length]; p = clip(p, b[1] - a[1], -(b[0] - a[0]), -((b[1] - a[1]) * a[0] - (b[0] - a[0]) * a[1])); }
  return p;
};

export interface SsbFrame { O: Point; eu: Point; ev: Point; R1: Rect; R2: Rect }
/** Building frame and the two wing rectangles from the City ring (outline vertices snapped to the frame, scatter <= 0.02 m). */
export function ssbFrame(ring: Point[]): SsbFrame {
  // South-east corner = the vertex with the largest x + z (campus z grows southward); south edge = the long edge leaving it westward.
  const O = ring.reduce((m, p) => (p[0] + p[1] > m[0] + m[1] ? p : m));
  const west = ring.filter(p => p !== O).reduce((m, p) => (Math.abs(p[1] - O[1]) < 10 && p[0] < m[0] ? p : m), O);
  const L = Math.hypot(west[0] - O[0], west[1] - O[1]), eu: Point = [(O[0] - west[0]) / L, (O[1] - west[1]) / L], evv: Point = [eu[1], -eu[0]];
  const uv = ring.map(p => [(p[0] - O[0]) * eu[0] + (p[1] - O[1]) * eu[1], (p[0] - O[0]) * evv[0] + (p[1] - O[1]) * evv[1]] as UV);
  const us = uv.map(p => p[0]), vs = uv.map(p => p[1]);
  const uMin = Math.min(...us), vMax = Math.max(...vs);
  const innerU = uv.filter(p => p[1] > 1 && p[0] < -1 && p[0] > uMin + 1).map(p => p[0]), innerV = uv.filter(p => p[1] > 1 && p[1] < vMax - 1).map(p => p[1]);
  const uW1 = innerU.reduce((a, b) => a + b, 0) / innerU.length, vS = innerV.reduce((a, b) => a + b, 0) / innerV.length;
  return { O, eu, ev: evv, R1: { u0: uW1, u1: 0, v0: 0, v1: vMax }, R2: { u0: uMin, u1: 0, v0: 0, v1: vS } };
}

/** Exact roof facets (east wing R1 only / west wing R2 only / overlap: upper envelope), minus the wells. */
export function ssbRoofFacets(F: SsbFrame) {
  const { R1, R2 } = F;
  const A = rectFacets(R1, clip(rectPoly(R1), 0, -1, R2.v1));                 // R1, v >= R2.v1
  const B = rectFacets(R2, clip(rectPoly(R2), 1, 0, -R1.u0));                 // R2, u <= R1.u0
  const Cr = clip(rectPoly(R2), -1, 0, R1.u0), C: { poly: UV[]; pl: Pl }[] = [];
  for (const f1 of rectFacets(R1, Cr)) for (const f2 of rectFacets(R2, Cr)) {
    const both = clipToPoly(f1.poly, f2.poly); if (both.length < 3 || Math.abs(areaUV(both)) < 1e-6) continue;
    const p1 = clip(both, f2.pl[0] - f1.pl[0], f2.pl[1] - f1.pl[1], f2.pl[2] - f1.pl[2]);   // H1 >= H2
    const p2 = clip(both, f1.pl[0] - f2.pl[0], f1.pl[1] - f2.pl[1], f1.pl[2] - f2.pl[2]);   // H2 >= H1
    if (p1.length >= 3 && Math.abs(areaUV(p1)) > 1e-6) C.push({ poly: p1, pl: f1.pl });
    if (p2.length >= 3 && Math.abs(areaUV(p2)) > 1e-6) C.push({ poly: p2, pl: f2.pl });
  }
  let facets = [...A, ...B, ...C];
  for (const w of SSB.wells) facets = facets.flatMap(f => [clip(f.poly, 1, 0, -w.u0), clip(clip(clip(f.poly, -1, 0, w.u0), 1, 0, -w.u1), 0, 1, -w.v0),
    clip(clip(clip(f.poly, -1, 0, w.u0), 1, 0, -w.u1), 0, -1, w.v1), clip(f.poly, -1, 0, w.u1)].filter(p => p.length >= 3 && Math.abs(areaUV(p)) > 1e-6).map(poly => ({ poly, pl: f.pl })));
  return facets;
}
/** Roof height (campus Y) at building-frame (u, v): upper envelope of the wing hip roofs; wells at their floor. */
export function ssbRoofAt(F: SsbFrame, u: number, v: number) {
  // 1 mm / 1 cm boundary margins: float32 campus vertices on a well edge or on the outline belong to the roof.
  if (SSB.wells.some(w => u > w.u0 + 1e-3 && u < w.u1 - 1e-3 && v > w.v0 + 1e-3 && v < w.v1 - 1e-3)) return SSB.wellY;
  let h = -Infinity;
  for (const r of [F.R1, F.R2]) if (u >= r.u0 - 0.01 && u <= r.u1 + 0.01 && v >= r.v0 - 0.01 && v <= r.v1 + 0.01) h = Math.max(h, Math.min(...hipPlanes(r).map(pl => ev(pl, [u, v]))));
  return h;
}

/** Clean L outline (roof / eave line, ccw in x,z so offsetRing(+d) is outward), facade line and gallery back-wall line. */
export function ssbLines(ring: Point[]) {
  const F = ssbFrame(ring), S = SSB, { R1, R2 } = F;
  const xz = (p: UV): Point => [F.O[0] + F.eu[0] * p[0] + F.ev[0] * p[1], F.O[1] + F.eu[1] * p[0] + F.ev[1] * p[1]];
  let outline: Point[] = ([[0, 0], [0, R1.v1], [R1.u0, R1.v1], [R1.u0, R2.v1], [R2.u0, R2.v1], [R2.u0, 0]] as UV[]).map(xz);
  const area = outline.reduce((s, p, i) => { const q = outline[(i + 1) % outline.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
  if (area < 0) outline = outline.reverse();
  return { F, xz, outline, facade: offsetRing(outline, -S.overhang), back: offsetRing(outline, -(S.overhang + S.galleryDepth)) };
}

export function buildSsb(ring: Point[], g: (x: number, z: number) => number, physics: RAPIER.World,
  mats: { precast: THREE.Material; tile: THREE.Material; brick: THREE.Material; glass: THREE.Material }, uvs: (geo: THREE.BufferGeometry, pitched: boolean) => void) {
  const { F, xz, outline, facade, back } = ssbLines(ring), S = SSB;
  const toUV = (x: number, z: number): UV => [(x - F.O[0]) * F.eu[0] + (z - F.O[1]) * F.eu[1], (x - F.O[0]) * F.ev[0] + (z - F.O[1]) * F.ev[1]];
  const beamOut = offsetRing(outline, -(S.overhang - S.beamDepth / 2)), beamIn = offsetRing(outline, -(S.overhang + S.beamDepth / 2));
  const solidP = new Bucket(), solidT = new Bucket(), dPre = new Bucket(), dBrick = new Bucket(), dGlass = new Bucket();
  const wall = (b: Bucket, a: Point, c: Point, y0: number, y1: number, inward = false) => {
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 0.01) return;
    const n = V((c[1] - a[1]) / L, 0, -(c[0] - a[0]) / L); if (inward) n.negate();
    b.quad(V(a[0], y0, a[1]), V(c[0], y0, c[1]), V(c[0], y1, c[1]), V(a[0], y1, a[1]), n);
  };
  const cap = (b: Bucket, rings: Point[][], y: number, face: THREE.Vector3) => {
    const c2 = rings[0].map(p => new THREE.Vector2(p[0], p[1])), holes = rings.slice(1).map(r => r.map(p => new THREE.Vector2(p[0], p[1]))), all = [c2, ...holes].flat();
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(c2, holes)) b.tri(V(all[i].x, y, all[i].y), V(all[j].x, y, all[j].y), V(all[k].x, y, all[k].y), face);
  };
  const bottom = Math.min(...facade.map(p => g(p[0], p[1]))) - 1.0;
  const stats = { piers: 0, windows: 0, brickPanels: 0, galleryWindows: 0, roofFacets: 0, wellWalls: 0, stairBay: 0 };
  // 1. body to the gallery floor, gallery floor, back wall, architrave, soffit, fascia
  for (let i = 0; i < facade.length; i++) wall(solidP, facade[i], facade[(i + 1) % facade.length], bottom, S.galleryFloor);
  cap(solidP, [facade, back.slice().reverse()], S.galleryFloor, UP);
  for (let i = 0; i < back.length; i++) wall(solidP, back[i], back[(i + 1) % back.length], S.galleryFloor, S.soffit);
  for (let i = 0; i < beamOut.length; i++) { wall(solidP, beamOut[i], beamOut[(i + 1) % beamOut.length], S.soffit - S.beam, S.soffit); wall(solidP, beamIn[i], beamIn[(i + 1) % beamIn.length], S.soffit - S.beam, S.soffit, true); }
  cap(solidP, [beamOut, beamIn.slice().reverse()], S.soffit - S.beam, DOWN);
  cap(solidP, [outline, back.slice().reverse()], S.soffit, DOWN);
  for (let i = 0; i < outline.length; i++) wall(solidP, outline[i], outline[(i + 1) % outline.length], S.soffit, S.eave);
  // 2. gallery piers (square, on the facade line, one per bay; corners included once)
  for (let i = 0; i < facade.length; i++) {
    const a = facade[i], c = facade[(i + 1) % facade.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]), n = Math.max(1, Math.round(L / S.bay));
    const u = V((c[0] - a[0]) / L, 0, (c[1] - a[1]) / L), nn = V(u.z, 0, -u.x), h = S.pier / 2;
    for (let k = 0; k < n; k++) {
      const p = V(a[0], 0, a[1]).addScaledVector(u, k * L / n), corners = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([su, sn]) => p.clone().addScaledVector(u, su).addScaledVector(nn, sn));
      for (let q = 0; q < 4; q++) { const A = corners[q], B = corners[(q + 1) % 4], m = A.clone().add(B).multiplyScalar(0.5).sub(p).setY(0).normalize();
        solidP.quad(A.clone().setY(S.galleryFloor), B.clone().setY(S.galleryFloor), B.clone().setY(S.soffit - S.beam), A.clone().setY(S.soffit - S.beam), m); }
      stats.piers++;
    }
  }
  // 3. roof: exact facets (tile), wells (flat floor + vertical inner walls up to the roof)
  const facets = ssbRoofFacets(F), wellEdgePts = SSB.wells.map(() => [[], [], [], []] as UV[][]);
  for (const f of facets) {
    const P = f.poly.map(p => { const [x, z] = xz(p); return V(x, ev(f.pl, p), z); });
    for (let q = 1; q + 1 < P.length; q++) solidT.tri(P[0], P[q], P[q + 1], UP);
    stats.roofFacets++;
    SSB.wells.forEach((w, wi) => { for (const p of f.poly) {
      const on = [Math.abs(p[1] - w.v0) < 1e-6, Math.abs(p[0] - w.u1) < 1e-6, Math.abs(p[1] - w.v1) < 1e-6, Math.abs(p[0] - w.u0) < 1e-6];
      const inU = p[0] >= w.u0 - 1e-6 && p[0] <= w.u1 + 1e-6, inV = p[1] >= w.v0 - 1e-6 && p[1] <= w.v1 + 1e-6;
      on.forEach((o, e) => { if (o && (e % 2 === 0 ? inU : inV)) wellEdgePts[wi][e].push(p); }); } });
  }
  SSB.wells.forEach((w, wi) => {
    cap(solidP, [([[w.u0, w.v0], [w.u1, w.v0], [w.u1, w.v1], [w.u0, w.v1]] as UV[]).map(xz)], S.wellY, UP);
    const corners: UV[] = [[w.u0, w.v0], [w.u1, w.v0], [w.u1, w.v1], [w.u0, w.v1]], centre = xz([(w.u0 + w.u1) / 2, (w.v0 + w.v1) / 2]);
    for (let e = 0; e < 4; e++) {
      const a = corners[e], b = corners[(e + 1) % 4], axis = e % 2 === 0 ? 0 : 1;
      const pts = [a, b, ...wellEdgePts[wi][e]].sort((p, q) => (p[axis] - q[axis]) * (b[axis] > a[axis] ? 1 : -1));
      const uniq = pts.filter((p, i) => i === 0 || Math.abs(p[axis] - pts[i - 1][axis]) > 1e-5);
      for (let i = 0; i + 1 < uniq.length; i++) {
        const p0 = uniq[i], p1 = uniq[i + 1], [x0, z0] = xz(p0), [x1, z1] = xz(p1), m = V(centre[0] - (x0 + x1) / 2, 0, centre[1] - (z0 + z1) / 2).normalize();
        solidP.quad(V(x0, S.wellY, z0), V(x1, S.wellY, z1), V(x1, ssbRoofAt(F, ...nudge(p1, w)), z1), V(x0, ssbRoofAt(F, ...nudge(p0, w)), z0), m); stats.wellWalls++;
      }
    }
  });
  // 4. facade detail on the facade line: belt cornice, storeys (pale / brick infill / glazed base), stair bay; gallery back-wall windows
  const storeys: number[] = []; for (let y = S.galleryFloor - S.storey; y > bottom - S.storey; y -= S.storey) storeys.push(y);
  const southU = [-(F.R2.u1 - F.R2.u0) + S.stair.s - S.stair.width / 2, -(F.R2.u1 - F.R2.u0) + S.stair.s + S.stair.width / 2];
  for (let i = 0; i < facade.length; i++) {
    const a = facade[i], c = facade[(i + 1) % facade.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]), n = Math.max(1, Math.round(L / S.bay)), bay = L / n;
    const u = V((c[0] - a[0]) / L, 0, (c[1] - a[1]) / L), nn = V(u.z, 0, -u.x), o = V(a[0], 0, a[1]);
    dPre.panel(o, u, nn, L / 2, S.galleryFloor - 0.2, 0.2, L + 0.4, 0.4);                         // belt cornice
    const south = Math.abs(toUV(a[0], a[1])[1] - S.overhang) < 0.05 && Math.abs(toUV(c[0], c[1])[1] - S.overhang) < 0.05;
    for (let k = 0; k < n; k++) {
      const s = (k + 0.5) * bay, p = o.clone().addScaledVector(u, s), gl = g(p.x + nn.x * 1.2, p.z + nn.z * 1.2), pu = toUV(p.x, p.z)[0];
      if (south && pu > southU[0] - bay / 2 && pu < southU[1] + bay / 2) continue;               // stair bay drawn below
      for (const y of storeys) {
        if (y >= S.paleFrom) { if (y + 0.95 > gl + 0.3) { dGlass.panel(o, u, nn, s, y + 0.95 + S.window[1] / 2, 0.04, S.window[0], S.window[1]); stats.windows++; } }
        else if (y >= S.brickFrom) { if (y + 0.25 > gl) { dBrick.panel(o, u, nn, s, y + S.storey / 2, 0.02, bay - 0.8, S.storey - 0.5); stats.brickPanels++; }
          if (y + 0.95 > gl + 0.3) { dGlass.panel(o, u, nn, s, y + 0.95 + S.window[1] / 2, 0.05, S.window[0], S.window[1]); stats.windows++; } }
        else if (y + 0.5 > gl + 0.2) { dGlass.panel(o, u, nn, s, y + 0.5 + 1.4, 0.04, bay - 1.0, 2.8); stats.windows++; }
      }
    }
    if (south) {  // tall glazed stair bay with brick fins and storey mullions (centre: projection of the source pixels / photo)
      const s0 = (southU[0] + southU[1]) / 2 - toUV(a[0], a[1])[0], sDir = Math.sign(toUV(c[0], c[1])[0] - toUV(a[0], a[1])[0]), s = sDir > 0 ? s0 : -s0;
      const p = o.clone().addScaledVector(u, s), gl = g(p.x + nn.x * 1.2, p.z + nn.z * 1.2), y0 = gl + 0.3, y1 = S.galleryFloor - 0.45, W = S.stair.width;
      dGlass.panel(o, u, nn, s, (y0 + y1) / 2, 0.04, W - 1.2, y1 - y0);
      for (const side of [-1, 1]) dBrick.panel(o, u, nn, s + side * (W / 2 - 0.3), (y0 + y1) / 2, 0.06, 0.6, y1 - y0);
      for (const y of storeys) if (y > y0 + 0.5 && y < y1) dPre.panel(o, u, nn, s, y, 0.07, W - 1.2, 0.18);
      stats.stairBay++;
    }
  }
  for (let i = 0; i < back.length; i++) {
    const a = back[i], c = back[(i + 1) % back.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]), n = Math.max(1, Math.round(L / S.bay));
    const u = V((c[0] - a[0]) / L, 0, (c[1] - a[1]) / L), nn = V(u.z, 0, -u.x), o = V(a[0], 0, a[1]);
    for (let k = 0; k < n; k++) { if (L / n < S.galleryWindow[0] + 0.6) continue; dGlass.panel(o, u, nn, (k + 0.5) * L / n, S.galleryFloor + 0.8 + S.galleryWindow[1] / 2, 0.03, S.galleryWindow[0], S.galleryWindow[1]); stats.galleryWindows++; }
  }
  // meshes (merged by material) + one collider of every solid triangle
  const geometries: THREE.BufferGeometry[] = [], meshes: THREE.Mesh[] = [];
  const mk = (b: Bucket, m: THREE.Material, name: string, pitched: boolean, solid: boolean) => {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3)); geo.computeVertexNormals(); uvs(geo, pitched);
    geometries.push(geo); const mesh = new THREE.Mesh(geo, m); mesh.name = name; mesh.castShadow = solid; mesh.receiveShadow = true; mesh.userData.block = 'b02-sciences'; meshes.push(mesh); return mesh;
  };
  const solids = [mk(solidP, mats.precast, 'b02 SSB solid pale precast (body, gallery piers, architrave, soffit, wells)', false, true), mk(solidT, mats.tile, 'b02 SSB solid clay tile hip roof (LiDAR)', true, true)];
  const detail = [mk(dBrick, mats.brick, 'b02 SSB detail brick infill panels and stair fins', false, false), mk(dGlass, mats.glass, 'b02 SSB detail glazing', false, false), mk(dPre, mats.precast, 'b02 SSB detail belt cornice and stair mullions', false, false)];
  const pos = new Float32Array([...solidP.pos, ...solidT.pos]);
  const collider = physics.createCollider(RAPIER.ColliderDesc.trimesh(pos, Uint32Array.from({ length: pos.length / 3 }, (_v, i) => i), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.8));
  return { solids, detail, collider, geometries, frame: F, outline, facade, back, stats: { ...stats, solidTriangles: pos.length / 9, detailTriangles: (dBrick.pos.length + dGlass.pos.length + dPre.pos.length) / 9 } };
}
/** A point on a well edge, nudged 1 mm outward so the roof (not the well floor) is evaluated. */
function nudge(p: UV, w: { u0: number; u1: number; v0: number; v1: number }): [number, number] {
  const e = 1e-3; return [p[0] <= w.u0 + 1e-6 ? p[0] - e : p[0] >= w.u1 - 1e-6 ? p[0] + e : p[0], p[1] <= w.v0 + 1e-6 ? p[1] - e : p[1] >= w.v1 - 1e-6 ? p[1] + e : p[1]];
}
