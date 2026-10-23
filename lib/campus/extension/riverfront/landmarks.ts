// Riverfront landmark geometry: pure (no GPU), so the Node checks build exactly what the game renders.
// Reference-guided approximations placed on measured anchors (riverfront-v1 meta.landmarks), not 1:1 models:
//  * Long Center (Nelsen Partners / ZGF, 2008; architect hero photo + operator terrace sheet): the recycled Palmer
//    Auditorium ring beam as a thin, flat, pale-cream band on slender round white columns (LiDAR circle fit:
//    centre/radius/top; median fit residual ~3 m, so placement is approximate) around the raised City Terrace (LiDAR
//    level) with a curved front stair; behind it a rectangular hall (LiDAR box) whose terrace faces are blue-grey glass
//    with orange/tan recycled-aluminium bands, a dark stage house (LiDAR box) and a pale podium under the ring.
//  * Palmer Events Center (BGK Architects / Austin Energy, 2002; architect hero photo): wide pale-grey tented canopy
//    over the City footprint corners with concave edges, raised ridge rim around a dark flat solar plateau (LiDAR
//    profile heights), deep eave sweeps, open perimeter colonnade, enclosed hall under the plateau.
//  * Fannie Davis Town Lake Gazebo (AIA Austin guide): octagonal folded, upswept canopy with a central oculus on
//    limestone columns over a limestone platform. Dimensions estimated from the City footprint and height.
//  * Long Center / Palmer parking garage (City 1329594): a curved parking structure on the City footprint, open decks
//    (dark bays between pale spandrels and piers) up to the 2017 LiDAR bulk-roof level, two LiDAR stair/elevator cores.
//    The City MAX_HEIGHT (its peak) is ~9 m above that roof and is not spread over the whole deck.
//  * Liz Carpenter Pond and Palmer pond docks (City 2023 'Dock' polygons) and the Pfluger bridge south approaches.
import * as THREE from 'three';
import type { GarageMeasure, GazeboMeasure, LongCenterMeasure, PalmerMeasure, PflugerApproach, RiverfrontDock } from './format';

type V3 = [number, number, number];
type P2 = [number, number];
const srgb = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
export const RF_COLORS = {
  cream: srgb(0xe9e1cc), column: srgb(0xf1ece0), terrace: srgb(0xc9bfab), stair: srgb(0xbdb39d), retain: srgb(0xb1a68e),
  glass: srgb(0x41566a), glassLight: srgb(0x6f8aa0), orange: srgb(0xc06a32), tan: srgb(0xb58f62), brick: srgb(0x8e5a44),
  stage: srgb(0x34383d), podium: srgb(0xd8d2c3), mullion: srgb(0x9aa0a4),
  canopy: srgb(0xc9cbc8), soffit: srgb(0x9c9f9e), solar: srgb(0x1f2a3a), solarFrame: srgb(0x5b6168), hallWall: srgb(0xb7ab96), hallGlass: srgb(0x4a5966),
  limestone: srgb(0xd6ccb4), deck: srgb(0xcfcac0), opening: srgb(0x2c2f31), garageRoof: srgb(0x8f8d88), core: srgb(0xb9b4aa), gazebo: srgb(0xe7e5df), dock: srgb(0x8a6a4a), approach: srgb(0xc7a68e), rail: srgb(0x8b9297),
};

/** Triangle soup with vertex colours and a parallel collider index list (triangles that are also solid). */
export class Soup {
  pos: number[] = []; col: number[] = []; solid: number[] = [];
  get triangles() { return this.pos.length / 9; }
  tri(a: V3, b: V3, c: V3, color: THREE.Color, solid = true) {
    const t = this.triangles;
    for (const q of [a, b, c]) { this.pos.push(q[0], q[1], q[2]); this.col.push(color.r, color.g, color.b); }
    if (solid) this.solid.push(t);
  }
  quad(a: V3, b: V3, c: V3, d: V3, color: THREE.Color, solid = true) { this.tri(a, b, c, color, solid); this.tri(a, c, d, color, solid); }
  /** Vertical wall strip between two plan points, y0..y1 at each end. */
  wall(a: P2, b: P2, ya0: number, ya1: number, yb0: number, yb1: number, color: THREE.Color, solid = true) {
    this.quad([a[0], ya0, a[1]], [b[0], yb0, b[1]], [b[0], yb1, b[1]], [a[0], ya1, a[1]], color, solid);
  }
  /** Round column (n-gon prism). */
  column(x: number, z: number, r: number, y0: number, y1: number, n: number, color: THREE.Color, solid = true) {
    for (let k = 0; k < n; k++) {
      const a = k / n * Math.PI * 2, b = (k + 1) / n * Math.PI * 2;
      this.wall([x + Math.cos(a) * r, z + Math.sin(a) * r], [x + Math.cos(b) * r, z + Math.sin(b) * r], y0, y1, y0, y1, color, solid);
    }
  }
  /** Flat polygon (outer ring + holes) at height y (solids render double-sided). */
  cap(rings: P2[][], y: number, color: THREE.Color, solid = true) {
    const contour = rings[0].map(([x, z]) => new THREE.Vector2(x, z)), holes = rings.slice(1).map(r => r.map(([x, z]) => new THREE.Vector2(x, z)));
    const all = [contour, ...holes].flat();
    for (const t of THREE.ShapeUtils.triangulateShape(contour, holes)) {
      const [a, b, c] = t.map(k => [all[k].x, y, all[k].y] as V3);
      // Earcut returns counter-clockwise XY triangles; placing its second coordinate in Z reverses the Y normal.
      this.tri(a, c, b, color, solid);
    }
  }
  /** Box on a horizontal oriented rectangle (4 plan corners, CCW or CW), y0..y1, all faces. */
  prism(r: P2[], y0: number, y1: number, side: THREE.Color | ((k: number) => THREE.Color), top: THREE.Color, solid = true) {
    for (let k = 0; k < r.length; k++) this.wall(r[k], r[(k + 1) % r.length], y0, y1, y0, y1, typeof side === 'function' ? side(k) : side, solid);
    this.cap([r], y1, top, solid);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
  /** Collider: the solid triangles of the same position buffer (exact render/collider parity). */
  collider(position: Float32Array) {
    const index = new Uint32Array(this.solid.length * 3);
    this.solid.forEach((t, i) => { index[i * 3] = t * 3; index[i * 3 + 1] = t * 3 + 1; index[i * 3 + 2] = t * 3 + 2; });
    return { position, index };
  }
}

type Ground = (x: number, z: number) => number;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ------------------------------------------------------------------------------------------------ Long Center
export const LC = { ringWidth: 3.2, ringDepth: 1.1, columns: 24, columnRadius: .42, stairRise: .16, stairTread: .38 };

export function longCenter(s: Soup, m: LongCenterMeasure, ground: Ground) {
  const [cx, cz] = m.ring.c, R = m.ring.r, top = m.ring.top, T = m.terrace;
  const hall = m.volumes.find(v => v.name === 'hall'), stage = m.volumes.find(v => v.name === 'stage');
  if (!hall || !stage) throw new Error('Long Center volumes missing');
  // Hall-side direction: from the ring centre toward the hall box centre.
  const hc = hall.r.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
  const dl = Math.hypot(hc[0] - cx, hc[1] - cz), dir: P2 = [(hc[0] - cx) / dl, (hc[1] - cz) / dl];
  const side = (x: number, z: number) => (x - cx) * dir[0] + (z - cz) * dir[1];   // > -6: podium/hall side
  const CUT = -6;
  // Ring beam: flat pale band (top, soffit, inner and outer fascia).
  const N = 128, r0 = R - LC.ringWidth / 2, r1 = R + LC.ringWidth / 2, yb = top - LC.ringDepth;
  for (let k = 0; k < N; k++) {
    const a = k / N * Math.PI * 2, b = (k + 1) / N * Math.PI * 2;
    const P = (r: number, t: number, y: number): V3 => [cx + Math.cos(t) * r, y, cz + Math.sin(t) * r];
    s.quad(P(r0, a, top), P(r0, b, top), P(r1, b, top), P(r1, a, top), RF_COLORS.cream);
    s.quad(P(r0, a, yb), P(r1, a, yb), P(r1, b, yb), P(r0, b, yb), RF_COLORS.cream);
    s.quad(P(r1, a, yb), P(r1, a, top), P(r1, b, top), P(r1, b, yb), RF_COLORS.cream);
    s.quad(P(r0, a, yb), P(r0, b, yb), P(r0, b, top), P(r0, a, top), RF_COLORS.cream);
  }
  // Terrace: half-disc on the open (river/park) side at the LiDAR level, retaining wall and a curved front stair.
  const terraceR = R + 1.8, seg = 96;
  const ring: P2[] = [];
  const a0 = Math.atan2(dir[1], dir[0]);
  // Arc over the open side: angles where side < CUT on the circle.
  const span = Math.acos(Math.max(-1, Math.min(1, CUT / terraceR)));   // |angle - a0| > span is the open side
  for (let k = 0; k <= seg; k++) {
    const t = a0 + span + (2 * Math.PI - 2 * span) * k / seg;
    ring.push([cx + Math.cos(t) * terraceR, cz + Math.sin(t) * terraceR]);
  }
  s.cap([ring], T, RF_COLORS.terrace);
  // Retaining edge + stair: per arc slice, steps down to the local ground (rise <= LC.stairRise).
  const stairSlices: { a: number; drop: number; steps: number }[] = [];
  for (let k = 0; k < seg; k++) {
    const p = ring[k], q = ring[k + 1];
    const t = a0 + span + (2 * Math.PI - 2 * span) * (k + .5) / seg;
    const ux = Math.cos(t), uz = Math.sin(t);
    const gEdge = Math.min(ground(p[0], p[1]), ground(q[0], q[1]));
    // Front stair over the open arc's middle 70 %; elsewhere a retaining wall.
    const front = k > seg * .15 && k < seg * .85;
    const gFoot = ground((p[0] + q[0]) / 2 + ux * 6, (p[1] + q[1]) / 2 + uz * 6);
    const drop = T - (front ? gFoot : gEdge);
    if (!front || drop < .2) { s.wall(p, q, gEdge - .6, T, gEdge - .6, T, RF_COLORS.retain); continue; }
    const steps = Math.ceil(drop / LC.stairRise), rise = drop / steps;
    stairSlices.push({ a: t, drop, steps });
    let rp = terraceR;
    const P = (r: number, ang: number, y: number): V3 => [cx + Math.cos(ang) * r, y, cz + Math.sin(ang) * r];
    const ta = a0 + span + (2 * Math.PI - 2 * span) * k / seg, tb = a0 + span + (2 * Math.PI - 2 * span) * (k + 1) / seg;
    for (let i = 0; i < steps; i++) {
      const y = T - rise * i, yn = T - rise * (i + 1), rn = rp + LC.stairTread;
      s.quad(P(rp, ta, y), P(rp, ta, yn), P(rp, tb, yn), P(rp, tb, y), RF_COLORS.stair);           // riser
      s.quad(P(rp, ta, yn), P(rp, tb, yn), P(rn, tb, yn), P(rn, ta, yn), RF_COLORS.stair);         // tread (+Y)
      rp = rn;
    }
    // Close the slice sides down to the ground (visible only where neighbouring slices differ).
    s.wall([P(terraceR, ta, 0)[0], P(terraceR, ta, 0)[2]], [P(rp, ta, 0)[0], P(rp, ta, 0)[2]], T - drop - .6, T, T - drop - .6, T - drop, RF_COLORS.stair, false);
  }
  // Podium under the ring on the hall side (pale, glazed band), its top just below the ring soffit.
  const podTop = Math.min(yb - .25, T + 8.4);
  const pod: P2[] = [];
  for (let k = 0; k <= 64; k++) {
    const t = a0 - span + 2 * span * k / 64;
    pod.push([cx + Math.cos(t) * (R - 2.4), cz + Math.sin(t) * (R - 2.4)]);
  }
  const podBase = Math.min(...pod.map(p => ground(p[0], p[1]))) - .5;
  for (let k = 0; k < pod.length; k++) {
    const p = pod[k], q = pod[(k + 1) % pod.length];
    s.wall(p, q, podBase, T + 3.4, podBase, T + 3.4, RF_COLORS.glass);
    s.wall(p, q, T + 3.4, podTop, T + 3.4, podTop, RF_COLORS.podium);
  }
  s.cap([pod], podTop, RF_COLORS.podium);
  // Hall: rectangular volume; the faces turned toward the terrace are banded glass/aluminium, the rest brick.
  const hallBase = podBase, hallTop = hall.top;
  const faces = hall.r.map((p, k) => { const q = hall.r[(k + 1) % 4], mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2; return side(mx, mz) < side(hc[0], hc[1]); });
  for (let k = 0; k < 4; k++) {
    const p = hall.r[k], q = hall.r[(k + 1) % 4];
    if (!faces[k]) { s.wall(p, q, hallBase, hallTop, hallBase, hallTop, RF_COLORS.brick); continue; }
    // Glazed front: storey bands (3.8 m) alternating blue-grey glass and orange / tan aluminium strips, with mullions.
    const bands = Math.max(1, Math.round((hallTop - hallBase) / 3.8));
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]), cols = Math.max(2, Math.round(len / 4.5));
    for (let b = 0; b < bands; b++) {
      const y0 = lerp(hallBase, hallTop, b / bands), y1 = lerp(hallBase, hallTop, (b + 1) / bands), ys = y1 - .9;
      for (let c = 0; c < cols; c++) {
        const t0 = c / cols, t1 = (c + 1) / cols, A: P2 = [lerp(p[0], q[0], t0), lerp(p[1], q[1], t0)], B: P2 = [lerp(p[0], q[0], t1), lerp(p[1], q[1], t1)];
        const h = (b * 7 + c * 3) % 5;
        s.wall(A, B, y0, ys, y0, ys, h === 0 ? RF_COLORS.glassLight : RF_COLORS.glass);
        s.wall(A, B, ys, y1, ys, y1, h < 2 ? RF_COLORS.orange : h < 4 ? RF_COLORS.tan : RF_COLORS.mullion);
      }
    }
  }
  s.cap([hall.r], hallTop, RF_COLORS.stage);
  // Stage house: dark box rising above the hall.
  s.prism(stage.r, hallBase, stage.top, RF_COLORS.stage, RF_COLORS.stage);
  // Columns on the ring line (skipped where they would stand inside the podium/hall).
  const columns: P2[] = [];
  for (let k = 0; k < LC.columns; k++) {
    const t = k / LC.columns * Math.PI * 2 + Math.PI / LC.columns;
    const x = cx + Math.cos(t) * R, z = cz + Math.sin(t) * R;
    if (side(x, z) > CUT + 1.5) continue;
    const onTerrace = side(x, z) < CUT && Math.hypot(x - cx, z - cz) <= terraceR;
    const y0 = onTerrace ? T : ground(x, z) - .3;
    s.column(x, z, LC.columnRadius, y0, yb, 12, RF_COLORS.column);
    columns.push([x, z]);
  }
  return { terraceRing: ring, terraceY: T, podium: pod, columns, stairSlices: stairSlices.length, maxStairDrop: Math.max(0, ...stairSlices.map(q => q.drop)), dir };
}

// ------------------------------------------------------------------------------------------------ Palmer
export const PALMER = { grid: 36, rimD: .46, plateauD: .33, hallD: .4, thickness: .7, colonnadeSpacing: 13, solarRows: 12 };

export function palmerSurface(m: PalmerMeasure) {
  const [N, E, S, W] = m.corners;
  const C: P2 = m.centre;
  // Edge curves corner->corner with a quadratic inward sag (measured on the City footprint).
  const edge = (a: P2, b: P2, sag: number) => (t: number): P2 => {
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, ix = C[0] - mx, iz = C[1] - mz, il = Math.hypot(ix, iz);
    const k = sag * 4 * t * (1 - t);
    return [lerp(a[0], b[0], t) + ix / il * k, lerp(a[1], b[1], t) + iz / il * k];
  };
  const e0 = edge(N, E, m.sags[0]), e1 = edge(E, S, m.sags[1]), e2 = edge(S, W, m.sags[2]), e3 = edge(W, N, m.sags[3]);
  // Coons patch: u along N->E, v along N->W.
  const P = (u: number, v: number): P2 => {
    const c0 = e0(u), c1 = e2(1 - u), d0 = e3(1 - v), d1 = e1(v);
    const x = (1 - v) * c0[0] + v * c1[0] + (1 - u) * d0[0] + u * d1[0] - ((1 - u) * (1 - v) * N[0] + u * (1 - v) * E[0] + (1 - u) * v * W[0] + u * v * S[0]);
    const z = (1 - v) * c0[1] + v * c1[1] + (1 - u) * d0[1] + u * d1[1] - ((1 - u) * (1 - v) * N[1] + u * (1 - v) * E[1] + (1 - u) * v * W[1] + u * v * S[1]);
    return [x, z];
  };
  // Eave height along each edge from the LiDAR samples (t = .15 .3 .5 .7 .85), held flat to the corners.
  const eaveOf = (k: number, t: number) => {
    const ts = [.15, .3, .5, .7, .85], ys = m.eaves[k].map(v => v ?? m.eaves[k].find(q => q !== null) ?? m.ground + 10) as number[];
    if (t <= ts[0]) return ys[0] - (ts[0] - t) * 4;          // corners sweep down a little further
    if (t >= ts[4]) return ys[4] - (t - ts[4]) * 4;
    for (let i = 0; i < 4; i++) if (t <= ts[i + 1]) return lerp(ys[i], ys[i + 1], (t - ts[i]) / (ts[i + 1] - ts[i]));
    return ys[4];
  };
  const rimY = m.rim.reduce((a, r) => a + r[1], 0) / m.rim.length;
  const H = (u: number, v: number) => {
    const du = Math.abs(2 * u - 1), dv = Math.abs(2 * v - 1), d = Math.max(du, dv);
    if (d <= PALMER.plateauD) return m.plateau;
    if (d <= PALMER.rimD) return lerp(m.plateau, rimY, Math.sin((d - PALMER.plateauD) / (PALMER.rimD - PALMER.plateauD) * Math.PI / 2));
    // Nearest edge: which coordinate dominates, and position along it.
    const eave = du >= dv ? (u > .5 ? eaveOf(1, v) : eaveOf(3, 1 - v)) : (v > .5 ? eaveOf(2, 1 - u) : eaveOf(0, u));
    const t = (d - PALMER.rimD) / (1 - PALMER.rimD);
    return eave + (rimY - eave) * Math.pow(1 - t, 1.7);    // concave sweep down to the eave
  };
  return { P, H, rimY };
}

export function palmer(s: Soup, m: PalmerMeasure, ground: Ground) {
  const { P, H } = palmerSurface(m), n = PALMER.grid;
  const V = (u: number, v: number, dy = 0): V3 => { const [x, z] = P(u, v); return [x, H(u, v) + dy, z]; };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const u0 = i / n, u1 = (i + 1) / n, v0 = j / n, v1 = (j + 1) / n;
    const d = Math.max(Math.abs(u0 + u1 - 1), Math.abs(v0 + v1 - 1));
    const col = d <= PALMER.plateauD ? RF_COLORS.solarFrame : RF_COLORS.canopy;
    // Top (solid: landable roof) and soffit (decor) of the canopy.
    s.quad(V(u0, v0), V(u0, v1), V(u1, v1), V(u1, v0), col);
    if (d > PALMER.hallD - .02) s.quad(V(u0, v0, -PALMER.thickness), V(u1, v0, -PALMER.thickness), V(u1, v1, -PALMER.thickness), V(u0, v1, -PALMER.thickness), RF_COLORS.soffit, false);
  }
  // Eave fascia around the perimeter.
  for (let k = 0; k < n; k++) for (const [a, b] of [[[k / n, 0], [(k + 1) / n, 0]], [[1, k / n], [1, (k + 1) / n]], [[(k + 1) / n, 1], [k / n, 1]], [[0, (k + 1) / n], [0, k / n]]] as [P2, P2][]) {
    const A = V(a[0], a[1]), B = V(b[0], b[1]);
    s.quad([A[0], A[1] - PALMER.thickness, A[2]], [B[0], B[1] - PALMER.thickness, B[2]], B, A, RF_COLORS.canopy, false);
  }
  // Solar plateau: tilted panel rows slightly above the flat centre.
  // H() measures distance as |2u - 1|, so the plateau's UV half-width is plateauD / 2.
  const rows = PALMER.solarRows, lo = .5 - PALMER.plateauD / 2 + .01, hi = .5 + PALMER.plateauD / 2 - .01;
  for (let r = 0; r < rows; r++) {
    const v0 = lerp(lo, hi, (r + .12) / rows), v1 = lerp(lo, hi, (r + .88) / rows);
    for (let c = 0; c < 6; c++) {
      const u0 = lerp(lo, hi, (c + .04) / 6), u1 = lerp(lo, hi, (c + .96) / 6);
      s.quad(V(u0, v0, .25), V(u0, v1, .65), V(u1, v1, .65), V(u1, v0, .25), RF_COLORS.solar);
    }
  }
  // Enclosed hall walls under the plateau/rim (glass base band, pale wall above), solid.
  const hd = PALMER.hallD, ring: P2[] = [];
  for (const [a, b] of [[[.5 - hd, .5 - hd], [.5 + hd, .5 - hd]], [[.5 + hd, .5 - hd], [.5 + hd, .5 + hd]], [[.5 + hd, .5 + hd], [.5 - hd, .5 + hd]], [[.5 - hd, .5 + hd], [.5 - hd, .5 - hd]]] as [P2, P2][])
    for (let k = 0; k < 10; k++) {
      const ta = k / 10, tb = (k + 1) / 10;
      const ua = lerp(a[0], b[0], ta), va = lerp(a[1], b[1], ta), ub = lerp(a[0], b[0], tb), vb = lerp(a[1], b[1], tb);
      const A = P(ua, va), B = P(ub, vb), ya = H(ua, va) - PALMER.thickness, yb = H(ub, vb) - PALMER.thickness;
      const ga = ground(A[0], A[1]) - .5, gb = ground(B[0], B[1]) - .5;
      s.wall(A, B, ga, ga + 4.5, gb, gb + 4.5, RF_COLORS.hallGlass);
      s.wall(A, B, ga + 4.5, ya, gb + 4.5, yb, RF_COLORS.hallWall);
      ring.push(A);
    }
  // Open colonnade along the eave line (inside the concave edges).
  const columns: P2[] = [];
  for (const [a, b] of [[[0, 0], [1, 0]], [[1, 0], [1, 1]], [[1, 1], [0, 1]], [[0, 1], [0, 0]]] as [P2, P2][]) {
    const [ax, az] = P(a[0], a[1]), [bx, bz] = P(b[0], b[1]);
    const count = Math.max(3, Math.round(Math.hypot(bx - ax, bz - az) / PALMER.colonnadeSpacing));
    for (let k = 1; k < count; k++) {
      const t = k / count, u = lerp(a[0], b[0], t), v = lerp(a[1], b[1], t);
      // Pull 6 % toward the centre so the column meets the soffit, not the fascia.
      const ui = lerp(u, .5, .06), vi = lerp(v, .5, .06), [x, z] = P(ui, vi);
      s.column(x, z, .45, ground(x, z) - .4, H(ui, vi) - PALMER.thickness, 10, RF_COLORS.column);
      columns.push([x, z]);
    }
  }
  return { hall: ring, columns };
}

// ------------------------------------------------------------------------------------------------ Gazebo
export function gazebo(s: Soup, g: GazeboMeasure, ground: Ground) {
  const [cx, cz] = g.c, R = g.r, n = 8;
  // Platform top above the highest ground under it (edge ring and interior samples).
  let y0 = -Infinity;
  for (const r of [0, R * .5, R]) for (let k = 0; k < 16; k++) y0 = Math.max(y0, ground(cx + Math.cos(k * Math.PI / 8) * r, cz + Math.sin(k * Math.PI / 8) * r));
  const floor = y0 + .35, oc = 1.3;
  const at = (k: number, r: number): P2 => [cx + Math.cos(k / n * Math.PI * 2) * r, cz + Math.sin(k / n * Math.PI * 2) * r];
  // Limestone platform.
  const plat: P2[] = [];
  for (let k = 0; k < n; k++) plat.push(at(k + .5, R * .95));
  for (let k = 0; k < n; k++) { const p = plat[k], q = plat[(k + 1) % n]; s.wall(p, q, g.ground - .6, floor, g.ground - .6, floor, RF_COLORS.limestone); }
  s.cap([plat], floor, RF_COLORS.limestone);
  // Columns at the 8 corners.
  const colTop = floor + 3.2;
  for (let k = 0; k < n; k++) { const [x, z] = at(k, R * .72); s.column(x, z, .32, floor, colTop + .3, 8, RF_COLORS.limestone); }
  // Folded upswept canopy: outer vertices high at the column angles, low between; inner oculus ring.
  const hiY = floor + 6.1, loY = floor + 3.9, inY = floor + 3.7, th = .2;
  for (let k = 0; k < n * 2; k++) {
    const a = k / 2, b = (k + 1) / 2;
    const oa = at(a, R), ob = at(b, R), ia = at(a, oc), ib = at(b, oc);
    const ya = k % 2 === 0 ? hiY : loY, ybb = k % 2 === 0 ? loY : hiY;
    s.quad([ia[0], inY, ia[1]], [ib[0], inY, ib[1]], [ob[0], ybb, ob[1]], [oa[0], ya, oa[1]], RF_COLORS.gazebo);
    s.quad([ia[0], inY - th, ia[1]], [oa[0], ya - th, oa[1]], [ob[0], ybb - th, ob[1]], [ib[0], inY - th, ib[1]], RF_COLORS.soffit, false);
    s.quad([oa[0], ya - th, oa[1]], [ob[0], ybb - th, ob[1]], [ob[0], ybb, ob[1]], [oa[0], ya, oa[1]], RF_COLORS.gazebo, false);
    s.quad([ia[0], inY - th, ia[1]], [ia[0], inY, ia[1]], [ib[0], inY, ib[1]], [ib[0], inY - th, ib[1]], RF_COLORS.gazebo, false);
  }
  return { floor, top: hiY };
}

// ------------------------------------------------------------------------------------------------ Garage
export const GARAGE = { spandrel: 1.05, pierSpacing: 9, pierWidth: .7, parapet: 1.05 };

export function garage(s: Soup, g: GarageMeasure, ground: Ground) {
  const ring = g.r as P2[], n = ring.length, levelH = (g.roof - g.ground) / g.levels;
  // Facade: per footprint edge, each level an open dark bay with a pale deck spandrel above (top level ends in the parapet).
  for (let k = 0; k < n; k++) {
    const a = ring[k], b = ring[(k + 1) % n];
    const ga = ground(a[0], a[1]) - .5, gb = ground(b[0], b[1]) - .5;
    for (let L = 0; L < g.levels; L++) {
      const top = g.ground + levelH * (L + 1), sp = top - GARAGE.spandrel, bot = L === 0 ? null : g.ground + levelH * L;
      s.wall(a, b, bot ?? ga, sp, bot ?? gb, sp, RF_COLORS.opening);
      s.wall(a, b, sp, top, sp, top, RF_COLORS.deck);
    }
    s.wall(a, b, g.roof, g.roof + GARAGE.parapet, g.roof, g.roof + GARAGE.parapet, RF_COLORS.deck);
    // Piers: pale vertical strips standing 6 cm proud of the bays, full height.
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    const count = Math.floor(len / GARAGE.pierSpacing);
    for (let i = 1; i <= count; i++) {
      const t = i * len / (count + 1), cx = a[0] + ux * t, cz = a[1] + uz * t, h = GARAGE.pierWidth / 2;
      const nx = -uz * .06, nz = ux * .06;   // both faces offset (double-sided material): read from either side
      for (const sgn of [1, -1]) {
        const A: P2 = [cx - ux * h + nx * sgn, cz - uz * h + nz * sgn], B: P2 = [cx + ux * h + nx * sgn, cz + uz * h + nz * sgn];
        const gg = ground(cx, cz) - .5;
        s.wall(A, B, gg, g.roof, gg, g.roof, RF_COLORS.deck, false);
      }
    }
  }
  // Roof deck at the LiDAR bulk-roof level (landable) and the two stair/elevator cores.
  s.cap([ring], g.roof, RF_COLORS.garageRoof);
  for (const c of g.cores) s.prism(c.r as P2[], g.roof, c.top, RF_COLORS.core, RF_COLORS.core);
  return { roof: g.roof, levels: g.levels, cores: g.cores.length };
}

// ------------------------------------------------------------------------------------------------ docks, approaches
export function dock(s: Soup, d: RiverfrontDock) {
  const r = d.r[0] as P2[];
  for (let k = 0; k < r.length; k++) { const p = r[k], q = r[(k + 1) % r.length]; s.wall(p, q, d.y - .5, d.y, d.y - .5, d.y, RF_COLORS.dock, false); }
  s.cap([r], d.y, RF_COLORS.dock);
}

export const RAIL_HEIGHT = 1.1;
export function approach(s: Soup, a: PflugerApproach, ground: Ground) {
  const [fx, fy, fz] = a.from, [tx, ty, tz] = a.to, L = Math.hypot(tx - fx, tz - fz), ux = (tx - fx) / L, uz = (tz - fz) / L, nx = -uz, nz = ux;
  const n = Math.max(2, Math.ceil(L / 2));
  const at = (t: number, side: number): V3 => [lerp(fx, tx, t) + nx * a.half * side, lerp(fy, ty, t), lerp(fz, tz, t) + nz * a.half * side];
  for (let k = 0; k < n; k++) {
    const t0 = k / n, t1 = (k + 1) / n;
    const L0 = at(t0, -1), L1 = at(t1, -1), R0 = at(t0, 1), R1 = at(t1, 1);
    s.quad(L0, R0, R1, L1, RF_COLORS.approach);
    for (const [p, q] of [[L0, L1], [R1, R0]] as [V3, V3][]) {
      const gp = ground(p[0], p[2]) - .5, gq = ground(q[0], q[2]) - .5;
      s.wall([p[0], p[2]], [q[0], q[2]], Math.min(gp, p[1] - .4), p[1], Math.min(gq, q[1] - .4), q[1], RF_COLORS.retain, false);
      s.wall([p[0], p[2]], [q[0], q[2]], p[1], p[1] + RAIL_HEIGHT, q[1], q[1] + RAIL_HEIGHT, RF_COLORS.rail);   // railing (solid)
    }
  }
  return { length: L };
}
