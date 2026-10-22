// Regression: generated ground tie-ins must not cover existing hard ground,
// and generated lawn/soil must not lie on paving even flush (0..3 cm band).
// Station rays cannot prove that the filled strips, wedges and corner fans
// between them stay off nearby paving, so this checks actual output triangles
// against actual surface triangles with its own plan intersection (independent
// of ground/clip.ts), on exact helper cases, a synthetic scene and the real one.
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { subtractCovered, type Point2 } from '../../lib/campus/ground/clip';
import { buildGroundTieIns, tagGroundTieIn, type TieInTag } from '../../lib/campus/ground/tie-ins';
import { heroRouteExtraGround } from '../../lib/campus/ground/hero-route';
import { addGroundTieIns, buildGroundScene } from './ground-check';

/** Hard check stricter than the external one (raise > 5 cm, area > 1e-4 m²). Lawn/soil
 * may not lie on paving at all: from 1 mm below its plane up (BAND). Overlaps narrower
 * than SLIVER (0.1 mm, float32 storage at campus coordinates) are reported, not failed. */
const RAISE = .035, BAND = -.001, MAX_RAISE = 3, SLIVER = 1e-4;

type Tri = number[];
const planeOf = (t: Tri) => {
  const ux = t[3] - t[0], uz = t[5] - t[2], vx = t[6] - t[0], vz = t[8] - t[2], d = ux * vz - vx * uz;
  const a = ((t[4] - t[1]) * vz - (t[7] - t[1]) * uz) / d, b = (ux * (t[7] - t[1]) - vx * (t[4] - t[1])) / d;
  return (x: number, z: number) => t[1] + a * (x - t[0]) + b * (z - t[2]);
};
const upFacing = (t: Tri) => {
  const ux = t[3] - t[0], uy = t[4] - t[1], uz = t[5] - t[2], vx = t[6] - t[0], vy = t[7] - t[1], vz = t[8] - t[2];
  const ny = uz * vx - ux * vz;
  return ny / Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx) >= .5;
};
const polyArea = (p: Point2[]) => Math.abs(p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2;
const cut = (poly: Point2[], keep: (p: Point2) => number) => {
  const out: Point2[] = [];
  poly.forEach((q, i) => {
    const p = poly[(i + poly.length - 1) % poly.length], dp = keep(p), dq = keep(q);
    if ((dp >= 0) !== (dq >= 0)) out.push([p[0] + (q[0] - p[0]) * dp / (dp - dq), p[1] + (q[1] - p[1]) * dp / (dp - dq)]);
    if (dq >= 0) out.push(q);
  });
  return out;
};
const polyWidth = (poly: Point2[]) => Math.min(...poly.map((a, i) => {
  const b = poly[(i + 1) % poly.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return l < 1e-12 ? Infinity : Math.max(...poly.map(p => Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / l));
}));
/** Plan region of `upper` lying lo..hi above `lower` (both x,y,z triangles). */
function overlap(upper: Tri, lower: Tri, lo = RAISE, hi = MAX_RAISE) {
  let poly: Point2[] = [[upper[0], upper[2]], [upper[3], upper[5]], [upper[6], upper[8]]];
  const ring: Point2[] = [[lower[0], lower[2]], [lower[3], lower[5]], [lower[6], lower[8]]];
  const cx = (ring[0][0] + ring[1][0] + ring[2][0]) / 3, cz = (ring[0][1] + ring[1][1] + ring[2][1]) / 3;
  for (let i = 0; i < 3 && poly.length; i++) {
    const p = ring[i], q = ring[(i + 1) % 3], side = (v: Point2) => (q[0] - p[0]) * (v[1] - p[1]) - (q[1] - p[1]) * (v[0] - p[0]);
    const sign = Math.sign(side([cx, cz]));
    poly = cut(poly, v => sign * side(v));
  }
  const hu = planeOf(upper), hl = planeOf(lower), raise = (v: Point2) => hu(v[0], v[1]) - hl(v[0], v[1]);
  poly = cut(cut(poly, v => raise(v) - lo), v => hi - raise(v));
  return poly.length >= 3 ? { area: polyArea(poly), width: polyWidth(poly) } : { area: 0, width: 0 };
}
const raisedOverlap = (upper: Tri, lower: Tri, lo = RAISE) => overlap(upper, lower, lo).area;
/** Overlap totals of `upper` triangles over `lower` triangles: coverage vs float32 slivers. */
function coverage(upper: Tri[], lowerNear: (t: Tri) => Iterable<Tri>, lo: number) {
  const r = { areaM2: 0, pairs: 0, maxRaiseBandWidthM: 0, sliverPairs: 0, sliverM2: 0, maxSliverWidthM: 0 };
  for (const t of upper) for (const l of lowerNear(t)) {
    const o = overlap(t, l, lo);
    if (o.area <= 0) continue;
    if (o.width >= SLIVER) { r.areaM2 += o.area; r.pairs++; r.maxRaiseBandWidthM = Math.max(r.maxRaiseBandWidthM, o.width); }
    else { r.sliverM2 += o.area; r.sliverPairs++; r.maxSliverWidthM = Math.max(r.maxSliverWidthM, o.width); }
  }
  return { ...r, areaM2: +r.areaM2.toFixed(6), sliverM2: +r.sliverM2.toExponential(2), maxSliverWidthM: +r.maxSliverWidthM.toExponential(2) };
}
/** Up-facing x,y,z triangle from plan points at heights (any input winding). */
const up = (a: number[], b: number[], c: number[]): Tri => {
  const t = [...a, ...b, ...c];
  return upFacing(t) ? t : [...a, ...c, ...b];
};
const flat = (y: number, ...pts: Point2[]) => up([pts[0][0], y, pts[0][1]], [pts[1][0], y, pts[1][1]], [pts[2][0], y, pts[2][1]]);
const keptTris = (t: Tri, pieces: Point2[][]) => {
  const h = planeOf(t), out: Tri[] = [];
  for (const p of pieces) for (let i = 1; i + 1 < p.length; i++) out.push(up([p[0][0], h(p[0][0], p[0][1]), p[0][1]], [p[i][0], h(p[i][0], p[i][1]), p[i][1]], [p[i + 1][0], h(p[i + 1][0], p[i + 1][1]), p[i + 1][1]]));
  return out;
};
const triArea = (t: Tri) => polyArea([[t[0], t[2]], [t[3], t[5]], [t[6], t[8]]]);
const inTri = (t: Tri, x: number, z: number) => {
  const s = (ax: number, az: number, bx: number, bz: number) => (bx - ax) * (z - az) - (bz - az) * (x - ax);
  const d1 = s(t[0], t[2], t[3], t[5]), d2 = s(t[3], t[5], t[6], t[8]), d3 = s(t[6], t[8], t[0], t[2]);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

/** Plan triangle containing every helper case below. */
const BIG: Point2[] = [[-10, -10], [30, -10], [-10, 30]];

function helperCases(failures: string[]) {
  const TOL = .03, PLANT = -.002, rows: Record<string, unknown> = {};
  const sub = (t: Tri, surfaces: Tri[], tolerance = TOL) => subtractCovered(t, surfaces, tolerance, 3)?.pieces ?? null;
  const check = (name: string, ok: boolean, detail: unknown) => { rows[name] = detail; if (!ok) failures.push(`helper ${name}: ${JSON.stringify(detail)}`); };
  const residual = (t: Tri, s: Tri, pieces: Point2[][] | null) => (pieces ? keptTris(t, pieces) : [t]).reduce((sum, k) => sum + raisedOverlap(k, s), 0);
  const kept = (t: Tri, pieces: Point2[][] | null) => pieces ? pieces.reduce((a, p) => a + polyArea(p), 0) : triArea(t);

  // Overlap at a corner, away from the centroid (the original centroid test misses it).
  let t = flat(1, [0, 0], [4, 0], [0, 4]), s = flat(0, [3.2, .2], [3.7, .2], [3.45, .5]);
  let pieces = sub(t, [s]);
  const before = raisedOverlap(t, s);
  check('centroid-missed corner overlap', !inTri(s, 4 / 3, 4 / 3) && before > .07 && residual(t, s, pieces) === 0 && Math.abs(kept(t, pieces) - (triArea(t) - triArea(s))) < 1e-9,
    { centroidInside: inTri(s, 4 / 3, 4 / 3), before: +before.toFixed(5), after: residual(t, s, pieces), kept: kept(t, pieces) });
  // Fully contained over hard ground: removed entirely.
  t = flat(.5, [1, 1], [2, 1], [1, 2]); s = flat(0, ...BIG);
  pieces = sub(t, [s]);
  check('triangle fully over a surface', !!pieces && pieces.length === 0, { pieces: pieces ? pieces.length : 'unchanged' });
  // A surface fully inside the triangle: a hole, everything around it kept.
  t = flat(1, [-4, -4], [4, -4], [0, 4]); s = flat(.4, [-.5, -.5], [.5, -.5], [0, .5]);
  pieces = sub(t, [s]);
  check('surface fully inside triangle', residual(t, s, pieces) === 0 && Math.abs(kept(t, pieces) - (triArea(t) - triArea(s))) < 1e-9,
    { after: residual(t, s, pieces), kept: kept(t, pieces), expected: triArea(t) - triArea(s) });
  // Wedge-like slope over flat paving: only the part higher than the tolerance goes.
  t = up([0, 0, 0], [2, 0, 0], [0, .5, 2]); s = flat(0, ...BIG);
  pieces = sub(t, [s]);
  const maxKeptRaise = Math.max(...(pieces ?? []).flat().map(p => planeOf(t)(p[0], p[1])));
  check('sloped wedge raise boundary', !!pieces && pieces.length > 0 && maxKeptRaise <= TOL + 1e-9 && residual(t, s, pieces) === 0, { maxKeptRaise, kept: kept(t, pieces) });
  // Shared edge (and a 1e-7 m numerical overlap) is a contact, not coverage: unchanged.
  t = flat(1, [0, 0], [2, 0], [0, 2]);
  check('shared edge contact', sub(t, [flat(0, [0, 0], [2, 0], [1, -1])]) === null, {});
  check('1e-7 m numerical overlap', sub(t, [flat(0, [0, 1e-7], [2, 1e-7], [1, -1])]) === null, {});
  // Raise bounds: a flush coping (+2 cm), output below a surface, a separate lower level, down-facing faces.
  s = flat(.98, ...BIG);
  check('flush coping +2 cm kept', sub(t, [s]) === null, {});
  check('output below a surface kept', sub(t, [flat(1.4, ...BIG)]) === null, {});
  check('surface 3.5 m below kept', sub(t, [flat(-2.5, ...BIG)]) === null, {});
  const down = flat(0, ...BIG);
  check('down-facing surface ignored', sub(t, [[...down.slice(0, 3), ...down.slice(6, 9), ...down.slice(3, 6)]]) === null, {});
  // Lawn/soil on paving: removed even flush (+1 cm) and just below (-1 mm); 5 mm below is hidden, kept.
  t = flat(1.01, [0, 0], [2, 0], [0, 2]); s = flat(1, ...BIG);
  check('planting +1 cm on paving removed', sub(t, [s], PLANT)?.length === 0, {});
  check('planting -1 mm under paving removed', sub(flat(.999, [0, 0], [2, 0], [0, 2]), [s], PLANT)?.length === 0, {});
  check('planting -5 mm under paving kept', sub(flat(.995, [0, 0], [2, 0], [0, 2]), [s], PLANT) === null, {});
  check('hard +1 cm flush paving kept', sub(t, [s]) === null, {});
  return rows;
}

/** Real buildGroundTieIns on a synthetic 10 x 10 m paved terrace 1 m above flat
 * terrain, with small hard pads placed between station rays: under a strip, in a
 * convex-corner fan, under a one-sided wedge beside a higher neighbour, and a
 * tagged paved pad lying 1 cm under the batter's plane (the flush band). */
function syntheticScene(failures: string[]) {
  const root = new THREE.Group();
  const material = (name: string) => { const m = new THREE.MeshStandardMaterial(); m.name = name; return m; };
  const paving = material('test paving'), lawn = material('test lawn'), stone = material('test limestone');
  const terrace = tagGroundTieIn(new THREE.Mesh(new THREE.PlaneGeometry(10, 10, 10, 10).rotateX(-Math.PI / 2).translate(0, 1, 0), paving), 'terrace', 'paved');
  const pad = (name: string, x: number, z: number, y: number, size: number, m = paving) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2).translate(x, y, z), m); mesh.name = name; return mesh;
  };
  const pads = {
    strip: tagGroundTieIn(pad('strip pad (tagged paved)', .5, 6, .2, .4), 'strip pad', 'paved'),
    // Untagged walk whose name says "yard": still hard ground, by its paving material.
    corner: pad('corner fan pad (east yard: connected walk)', 5 + 1.5 * Math.cos(37.5 * Math.PI / 180), 5 + 1.5 * Math.sin(37.5 * Math.PI / 180), .1, .2),
    wedge: pad('wedge pad', -3.25, 6, .1, .2),
    band: tagGroundTieIn(pad('flush band pad (tagged paved)', 1.5, 6, 0, .4), 'band pad', 'paved'),
  };
  // Parallel to the 1:2.5 batter from the terrace edge (top 3 cm below it), 1 cm lower still.
  const band = pads.band.geometry.getAttribute('position');
  for (let i = 0; i < band.count; i++) band.setY(i, 1 - .03 - (band.getZ(i) - 5) / 2.5 - .01);
  pads.band.geometry.computeBoundingBox();
  const planting = pad('lawn bed', 2.5, 6, .2, .4, lawn);
  const higher = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 1).translate(-4.7, 1, 5.5), stone); higher.name = 'higher neighbour';
  root.add(terrace, ...Object.values(pads), planting, higher);
  const terrainPositions = new Float32Array([-60, 0, -60, -60, 0, 60, 60, 0, 60, -60, 0, -60, 60, 0, 60, 60, 0, -60]);
  const hash = (m: THREE.Mesh) => createHash('sha256').update(new Uint8Array((m.geometry.getAttribute('position').array as Float32Array).buffer)).digest('hex');
  const terraceHash = hash(terrace);
  const ties = buildGroundTieIns({ sources: [root], obstacles: [root], terrainPositions, terrainFallback: () => 0, lawn, wall: stone });
  const out: Tri[] = [], lawnOut: Tri[] = [];
  for (const mesh of ties.meshes) {
    const p = mesh.geometry.getAttribute('position'), index = mesh.geometry.index!;
    for (let i = 0; i < index.count; i += 3) {
      const t = [0, 1, 2].flatMap(k => [p.getX(index.getX(i + k)), p.getY(index.getX(i + k)), p.getZ(index.getX(i + k))]);
      if (upFacing(t)) { out.push(t); if (mesh.material === lawn) lawnOut.push(t); }
    }
  }
  const trianglesOf = (m: THREE.Mesh) => { m.updateWorldMatrix(true, false); const p = m.geometry.getAttribute('position'), index = m.geometry.index!, v = new THREE.Vector3(), r: Tri[] = [];
    for (let i = 0; i < index.count; i += 3) r.push([0, 1, 2].flatMap(k => v.fromBufferAttribute(p, index.getX(i + k)).applyMatrix4(m.matrixWorld).toArray()));
    return r; };
  const heightAt = (list: Tri[], x: number, z: number) => Math.max(-Infinity, ...list.filter(t => inTri(t, x, z)).map(t => planeOf(t)(x, z)));
  const rows: Record<string, unknown> = {};
  for (const [name, mesh] of Object.entries(pads)) {
    const surface = trianglesOf(mesh), [x, , z] = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3()).toArray();
    const hard = coverage(out, () => surface, RAISE), flush = coverage(lawnOut, () => surface, BAND);
    // Coherent outside portions: the batter continues just beyond the pad (rim) and is gone above it.
    const half = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).x / 2;
    const rim = [[x - half - .03, z], [x + half + .03, z]].map(([px, pz]) => heightAt(out, px, pz));
    const padY = planeOf(surface.find(t => inTri(t, x, z))!)(x, z), above = heightAt(out, x, z), lawnAbove = heightAt(lawnOut, x, z);
    rows[name] = { hardCoverM2: hard.areaM2, lawnFlushBandM2: flush.areaM2, slivers: hard.sliverPairs + flush.sliverPairs, batterAtRim: rim.map(v => +v.toFixed(3)),
      padY: +padY.toFixed(3), outputAbovePadCentre: Number.isFinite(above) ? +above.toFixed(3) : null };
    if (hard.pairs) failures.push(`synthetic ${name}: output covers the pad by ${hard.areaM2} m²`);
    if (flush.pairs) failures.push(`synthetic ${name}: lawn lies on the pad (flush band) over ${flush.areaM2} m²`);
    if (!rim.every(v => v > .2 && v < 1)) failures.push(`synthetic ${name}: batter missing beside the pad (${rim.join(', ')})`);
    if (Number.isFinite(above) && above > padY + RAISE) failures.push(`synthetic ${name}: output ${above} above the pad`);
    if (Number.isFinite(lawnAbove) && lawnAbove > padY + BAND) failures.push(`synthetic ${name}: lawn ${lawnAbove} at or above the pad (${padY})`);
  }
  // Station clearance is not enough: every terrace station beside the pads is still a full 1:2.5 batter.
  const near = (sx: number, sz: number) => ties.segments.filter(s => s.module === 'terrace' && Math.hypot((s.x0 + s.x1) / 2 - sx, (s.z0 + s.z1) / 2 - sz) < .8);
  const stationsMissPads = [near(.5, 5), near(1.5, 5), near(-3.5, 5)].every(list => list.length > 0 && list.every(s => s.status === 'graded' && s.reason === '1:2.5 batter'));
  if (!stationsMissPads) failures.push('synthetic: pads were seen by station rays, so the case no longer tests output clipping');
  const lawnCovered = out.reduce((sum, t) => sum + trianglesOf(planting).reduce((a, s) => a + raisedOverlap(t, s), 0), 0);
  if (hash(terrace) !== terraceHash) failures.push('synthetic: source terrace geometry changed');
  if (!(ties.stats.clippedOverAuthored.triangles > 0)) failures.push('synthetic: nothing was clipped');
  return { ...rows, stationsMissPads, plantingBedCoveredM2: +lawnCovered.toFixed(4), clipped: ties.stats.clippedOverAuthored, triangles: ties.stats.triangles };
}

/** Ramp vs mapped finish (Main Mall forecourt fringe regression). A ramp is "near-coplanar"
 * where it lies from 1 m below to 5 cm above a finish (NEAR_LO..NEAR_HI); the old ramps were
 * sunk 4 cm under the terrain and crossed the finish over a wandering band. */
const NEAR_LO = -1, NEAR_HI = .05;
const trianglesOfRoot = (root: THREE.Object3D, filter: (m: THREE.Mesh) => boolean = () => true) => {
  const out: Tri[] = [], v = new THREE.Vector3();
  root.updateWorldMatrix(true, true);
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !filter(m)) return;
    const p = m.geometry.getAttribute('position'), index = m.geometry.index, count = index ? index.count : p.count;
    for (let i = 0; i + 2 < count; i += 3) out.push([0, 1, 2].flatMap(k => v.fromBufferAttribute(p, index ? index.getX(i + k) : i + k).applyMatrix4(m.matrixWorld).toArray()));
  });
  return out;
};
const gridOf = (list: Tri[], cell = 2) => {
  const grid = new Map<string, Tri[]>();
  for (const t of list) for (let i = Math.floor(Math.min(t[0], t[3], t[6]) / cell); i <= Math.floor(Math.max(t[0], t[3], t[6]) / cell); i++)
    for (let j = Math.floor(Math.min(t[2], t[5], t[8]) / cell); j <= Math.floor(Math.max(t[2], t[5], t[8]) / cell); j++) { const k = `${i},${j}`; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(t); }
  return { near: (t: Tri) => { const found = new Set<Tri>(); for (let i = Math.floor(Math.min(t[0], t[3], t[6]) / cell); i <= Math.floor(Math.max(t[0], t[3], t[6]) / cell); i++)
    for (let j = Math.floor(Math.min(t[2], t[5], t[8]) / cell); j <= Math.floor(Math.max(t[2], t[5], t[8]) / cell); j++) for (const x of grid.get(`${i},${j}`) ?? []) found.add(x); return found; },
  at: (x: number, z: number) => { let best: number | null = null; for (const t of grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) ?? []) if (upFacing(t) && inTri(t, x, z)) { const y = planeOf(t)(x, z); if (best === null || y > best) best = y; } return best; } };
};
/** Exact plan area of `upper` triangles within lo..hi of `lower` ones, and grid samples within +/-5 cm by sign. */
function nearCoplanar(upper: Tri[], lower: Tri[], lo = NEAR_LO, hi = NEAR_HI, box?: [number, number, number, number]) {
  const g = gridOf(lower), u = gridOf(upper);
  let areaM2 = 0, pairs = 0;
  for (const t of upper) for (const l of g.near(t)) { const o = overlap(t, l, lo, hi); if (o.area > 0 && o.width >= SLIVER) { areaM2 += o.area; pairs++; } }
  let positive = 0, negative = 0, samples = 0;
  if (box) for (let z = box[2]; z <= box[3] + 1e-9; z += .25) for (let x = box[0]; x <= box[1] + 1e-9; x += .25) {
    const a = u.at(x, z), b = a === null ? null : g.at(x, z);
    if (a === null || b === null) continue;
    samples++;
    if (Math.abs(a - b) < .05) { if (a >= b) positive++; else negative++; }
  }
  return { areaM2: +areaM2.toFixed(6), pairs, gridSamples: samples, within5cm: positive + negative, positive, negative, signChange: positive > 0 && negative > 0 };
}

/** Largest distance of the ramp feet of `segments` from their least-squares straight line (plan), m. */
function footLineDeviation(segments: { feet?: [number, number, number, number] }[]) {
  const pts = segments.flatMap(sg => sg.feet ? [[sg.feet[0], sg.feet[1]], [sg.feet[2], sg.feet[3]]] : []);
  if (pts.length < 3) return null;
  const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, mz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  let xx = 0, xz = 0, zz = 0;
  for (const [x, z] of pts) { xx += (x - mx) ** 2; xz += (x - mx) * (z - mz); zz += (z - mz) ** 2; }
  const angle = Math.atan2(2 * xz, xx - zz) / 2, dx = Math.cos(angle), dz = Math.sin(angle);
  return Math.max(...pts.map(([x, z]) => Math.abs(-(x - mx) * dz + (z - mz) * dx)));
}

/** Synthetic plaza 0.6 m above gently undulating terrain (+/-2 cm) with a mapped concrete
 * finish lying 4 mm on the terrain east of it (the Main Mall T arm), and a second finish
 * nearly coplanar with the plaza top (3 cm below) north of it. Expected: a 1:10 ramp east
 * that never comes within 5 cm of the finish, ends on a vertical toe, and has the finish
 * trimmed from under it; nothing at all over the coplanar finish. */
function syntheticCoplanarFinish(failures: string[]) {
  const material = (name: string) => { const m = new THREE.MeshStandardMaterial(); m.name = name; return m; };
  const paving = material('test pale paving'), lawn = material('test lawn'), stone = material('test limestone'), concrete = material('Local mapped concrete surface');
  const root = new THREE.Group();
  const plaza = tagGroundTieIn(new THREE.Mesh(new THREE.PlaneGeometry(10, 10, 10, 10).rotateX(-Math.PI / 2).translate(0, .6, 0), paving), 'plaza', 'paved');
  root.add(plaza);
  const ground = (x: number, z: number) => .02 * Math.sin(1.7 * x) * Math.cos(1.3 * z);
  const terrain: number[] = [], lowFinish: number[] = [];
  for (let i = -40; i < 40; i++) for (let j = -40; j < 40; j++) {
    const x0 = i * .5, z0 = j * .5, x1 = x0 + .5, z1 = z0 + .5;
    const quad = [[x0, z0], [x0, z1], [x1, z1], [x0, z0], [x1, z1], [x1, z0]];
    for (const [x, z] of quad) terrain.push(x, ground(x, z), z);
    // The finish: the terrain's own triangles, 4 mm up (as local-surfaces are clipped to the baked terrain).
    if (x0 >= 5 && x1 <= 14 && z0 >= -4 && z1 <= 4) for (const [x, z] of quad) lowFinish.push(x, ground(x, z) + .004, z);
  }
  const finishMesh = (positions: number[], name: string) => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(positions.length / 3 * 2), 2));
    const m = new THREE.Mesh(g, concrete); m.name = name; return m;
  };
  const overlays = new THREE.Group();
  const low = finishMesh(lowFinish, 'finish beside the plaza (on the terrain)');
  const coplanar = finishMesh([-4, .57, -9, -4, .57, -5, 4, .57, -5, -4, .57, -9, 4, .57, -5, 4, .57, -9], 'finish 3 cm below the plaza top');
  overlays.add(low, coplanar);
  const originalLow = trianglesOfRoot(low), originalCoplanar = trianglesOfRoot(coplanar);
  const ties = buildGroundTieIns({ sources: [root], obstacles: [root], overlays: [overlays], terrainPositions: new Float32Array(terrain), terrainFallback: ground, lawn, wall: stone });
  const pavingOut = ties.meshes.filter(m => m.material === paving).flatMap(m => trianglesOfRoot(m));
  const rampUp = pavingOut.filter(upFacing), toeFaces = pavingOut.filter(t => !upFacing(t));
  const east = ties.segments.filter(sg => sg.x0 > 4.9 && sg.x1 > 4.9 && Math.abs(sg.z0) < 4.5 && Math.abs(sg.z1) < 4.5);
  const north = ties.segments.filter(sg => sg.z0 < -4.9 && sg.z1 < -4.9 && Math.abs(sg.x0) < 3.9 && Math.abs(sg.x1) < 3.9);
  const ramp = nearCoplanar(rampUp, originalLow, NEAR_LO, NEAR_HI, [5, 14, -4, 4]);
  const lowGrid = gridOf(originalLow), lowest = Math.min(...rampUp.flatMap(t => [0, 3, 6].map(k => { const o = lowGrid.at(t[k], t[k + 2]); return o === null ? Infinity : t[k + 1] - o; })));
  const trimmed = trianglesOfRoot(low), finishLeftUnder = nearCoplanar(trimmed, rampUp, -1.5, NEAR_HI).areaM2;
  const finishArea = (list: Tri[]) => list.reduce((a, t) => a + triArea(t), 0);
  const overCoplanar = ties.meshes.flatMap(m => trianglesOfRoot(m)).filter(upFacing).reduce((a, t) => a + originalCoplanar.reduce((b, l) => b + overlap(t, l, -1, 1).area, 0), 0);
  const footDeviation = footLineDeviation(east);
  const row = { eastStations: east.length, eastRamp: east.filter(sg => sg.status === 'ramp').length, maxRun: Math.max(0, ...east.map(sg => sg.run)), footLineDeviationM: footDeviation, rampVsFinish: ramp,
    lowestRampAboveFinishM: +lowest.toFixed(4), toeFaces: toeFaces.length, finishTrimmed: ties.stats.finishTrim, finishLeftUnderRampM2: +finishLeftUnder.toFixed(6),
    finishKeptM2: +finishArea(trimmed).toFixed(2), finishOriginalM2: +finishArea(originalLow).toFixed(2),
    northStations: north.length, northStatuses: [...new Set(north.map(sg => sg.status))], outputOverCoplanarFinishM2: +overCoplanar.toFixed(6) };
  if (!east.length || east.some(sg => sg.status !== 'ramp')) failures.push(`coplanar finish: east edge is not a ramp (${JSON.stringify(east.map(sg => sg.status))})`);
  if (ramp.pairs || ramp.within5cm) failures.push(`coplanar finish: ramp within -1 m..+5 cm of the finish (${JSON.stringify(ramp)})`);
  if (footDeviation === null || footDeviation > .01) failures.push(`coplanar finish: ramp feet not on one straight line (${footDeviation} m)`);
  if (!(lowest >= .06)) failures.push(`coplanar finish: ramp vertex only ${lowest} above the finish`);
  if (!toeFaces.length) failures.push('coplanar finish: no vertical toe under the ramp end');
  if (finishLeftUnder > 0) failures.push(`coplanar finish: ${finishLeftUnder} m² of finish left under the ramp`);
  if (!(finishArea(trimmed) > finishArea(originalLow) * .3 && finishArea(trimmed) < finishArea(originalLow) - 1)) failures.push('coplanar finish: finish not trimmed to the ramp (or removed beyond it)');
  if (!north.length || north.some(sg => sg.status !== 'flush')) failures.push(`coplanar finish: edge over a finish 3 cm below is not flush (${JSON.stringify(row.northStatuses)})`);
  if (overCoplanar > 0) failures.push(`coplanar finish: tie-in output over the coplanar finish (${overCoplanar} m²)`);
  ties.dispose();
  if (trianglesOfRoot(low).length !== originalLow.length) failures.push('coplanar finish: dispose() did not restore the trimmed finish');
  return row;
}

/** Real hero scene: no output over the ORIGINAL tagged paved triangles (recorded
 * in world space before the tie-ins exist), no lawn/soil in their flush band, and
 * original authored meshes and colliders untouched. */
async function realScene(failures: string[]) {
  const s = await buildGroundScene();
  s.walkway.surfaces.updateWorldMatrix(true, true);
  const grid = new Map<string, Tri[]>(), cellKeys = (t: Tri) => {
    const keys: string[] = [];
    for (let i = Math.floor(Math.min(t[0], t[3], t[6]) / 2); i <= Math.floor(Math.max(t[0], t[3], t[6]) / 2); i++)
      for (let j = Math.floor(Math.min(t[2], t[5], t[8]) / 2); j <= Math.floor(Math.max(t[2], t[5], t[8]) / 2); j++) keys.push(`${i},${j}`);
    return keys;
  };
  const plantingMaterials = new Set<THREE.Material>([s.world.mat.grass]);
  let pavedTriangles = 0;
  const v = new THREE.Vector3();
  s.walkway.surfaces.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const tag = (m.userData.groundTieIn as TieInTag | undefined) ?? heroRouteExtraGround(m);
    if (tag && tag.finish !== 'paved') for (const mat of [m.material].flat()) plantingMaterials.add(mat);
    if ((m.userData.groundTieIn as TieInTag | undefined)?.finish !== 'paved') return;
    const p = m.geometry.getAttribute('position'), index = m.geometry.index, count = index ? index.count : p.count;
    for (let i = 0; i < count; i += 3) {
      const t = [0, 1, 2].flatMap(k => v.fromBufferAttribute(p, index ? index.getX(i + k) : i + k).applyMatrix4(m.matrixWorld).toArray());
      const ux = t[3] - t[0], uy = t[4] - t[1], uz = t[5] - t[2], wx = t[6] - t[0], wy = t[7] - t[1], wz = t[8] - t[2], ny = uz * wx - ux * wz;
      if (!(ny / Math.hypot(uy * wz - uz * wy, ny, ux * wy - uy * wx) >= .6)) continue;
      pavedTriangles++;
      for (const k of cellKeys(t)) { let list = grid.get(k); if (!list) grid.set(k, list = []); list.push(t); }
    }
  });
  const nearPaving = (t: Tri) => new Set(cellKeys(t).flatMap(k => grid.get(k) ?? []));
  const digest = () => {
    const h = createHash('sha256'); let meshes = 0;
    s.walkway.surfaces.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.groundTieInOutput) return;
      meshes++; h.update(m.name).update(new Uint8Array((m.geometry.getAttribute('position').array as Float32Array).buffer.slice(0)))
        .update(new Float64Array(m.matrixWorld.elements));
      if (m.geometry.index) h.update(new Uint8Array((m.geometry.index.array as Uint32Array).buffer.slice(0)));
    });
    return { meshes, sha256: h.digest('hex') };
  };
  const colliders = () => { const out: string[] = []; s.physics.forEachCollider(c => { out.push(`${c.handle}:${c.shape.type}:${JSON.stringify(c.translation())}`); }); return out; };
  const before = digest(), collidersBefore = colliders();
  // Mapped finishes as decoded, before the tie-ins trim them.
  const finishes = trianglesOfRoot(s.surfaces.group);
  const ties = addGroundTieIns(s);
  const after = digest(), collidersAfter = colliders();
  const all: Tri[] = [], lawnOut: Tri[] = [];
  for (const mesh of ties.meshes) {
    const p = mesh.geometry.getAttribute('position'), index = mesh.geometry.index!, lawn = plantingMaterials.has(mesh.material as THREE.Material);
    for (let i = 0; i < index.count; i += 3) {
      const t = [0, 1, 2].flatMap(k => [p.getX(index.getX(i + k)), p.getY(index.getX(i + k)), p.getZ(index.getX(i + k))]);
      if (upFacing(t)) { all.push(t); if (lawn) lawnOut.push(t); }
    }
  }
  const hard = coverage(all, nearPaving, RAISE), flush = coverage(lawnOut, nearPaving, BAND);
  if (hard.pairs) failures.push(`real scene: output raised over original paving, ${hard.areaM2} m² in ${hard.pairs} pairs`);
  if (flush.pairs) failures.push(`real scene: lawn/soil in the flush band on original paving, ${flush.areaM2} m² in ${flush.pairs} pairs`);
  if (before.sha256 !== after.sha256 || before.meshes !== after.meshes) failures.push('real scene: original authored surface geometry changed');
  // Main Mall forecourt (b04 plaza, Tower south; MAIN-MALL-PAVING-FRINGE.md): pale tie-in paving vs the old
  // mapped finish, exact area and Codex's 0.25 m grid (x -247..-199, z 97..116); campus-wide for ramps.
  const pavingOut = ties.meshes.filter(m => !plantingMaterials.has(m.material as THREE.Material) && !/retaining wall/.test(m.name)).flatMap(m => trianglesOfRoot(m)).filter(upFacing);
  const box: [number, number, number, number] = [-247, -199, 97, 116];
  const inBox = (t: Tri) => Math.max(t[0], t[3], t[6]) >= box[0] - 10 && Math.min(t[0], t[3], t[6]) <= box[1] + 10 && Math.max(t[2], t[5], t[8]) >= box[2] - 10 && Math.min(t[2], t[5], t[8]) <= box[3] + 10;
  // Exact area: the ramp output itself. Grid: any pale tie-in paving (Codex's probe), so slit bridges count too.
  const ramps = ties.rampTriangles.map(t => [...t]);
  const mainMall = { ...nearCoplanar(pavingOut.filter(inBox), finishes.filter(inBox), NEAR_LO, NEAR_HI, box), rampAreaM2: nearCoplanar(ramps.filter(inBox), finishes.filter(inBox)).areaM2 };
  const campusRamps = nearCoplanar(ramps, finishes);
  const renderedFinishUnder = nearCoplanar(trianglesOfRoot(s.surfaces.group).filter(inBox), ramps.filter(inBox), -1.5, NEAR_HI).areaM2;
  const mainMallRamps = ties.segments.filter(sg => sg.status === 'ramp' && (sg.x0 + sg.x1) / 2 >= -250 && (sg.x0 + sg.x1) / 2 <= -195 && (sg.z0 + sg.z1) / 2 >= 90 && (sg.z0 + sg.z1) / 2 <= 123);
  if (campusRamps.pairs) failures.push(`real scene: tie-in ramps within -1 m..+5 cm of a mapped finish (${JSON.stringify(campusRamps)})`);
  if (mainMall.within5cm || mainMall.rampAreaM2) failures.push(`real scene: Main Mall tie-in paving within -1 m..+5 cm of the mapped finish (${JSON.stringify(mainMall)})`);
  if (renderedFinishUnder > 0) failures.push(`real scene: ${renderedFinishUnder} m² of mapped finish left under Main Mall tie-in paving`);
  if (!mainMallRamps.length) failures.push('real scene: the Main Mall forecourt side ramps are gone (approach grade lost)');
  const footLines = { west: footLineDeviation(mainMallRamps.filter(sg => sg.x0 + sg.x1 < -444)), east: footLineDeviation(mainMallRamps.filter(sg => sg.x0 + sg.x1 >= -444)) };
  for (const [side, d] of Object.entries(footLines)) if (d === null || d > .01) failures.push(`real scene: Main Mall ${side} ramp feet not on one straight line (${d} m)`);
  const kept = collidersBefore.every((c, i) => collidersAfter[i] === c);
  if (!kept || collidersAfter.length !== collidersBefore.length + ties.colliders.length) failures.push('real scene: original colliders changed');
  return { originalPavedTriangles: pavedTriangles, outputUpTriangles: all.length, lawnSoilUpTriangles: lawnOut.length,
    raisedOverPaving: hard, lawnSoilFlushBandOnPaving: flush, authoredMeshes: before.meshes, authoredGeometrySha256: before.sha256, unchanged: before.sha256 === after.sha256,
    collidersBefore: collidersBefore.length, tieInColliders: ties.colliders.length, originalCollidersUnchanged: kept, tieIns: ties.stats.clippedOverAuthored, triangles: ties.stats.triangles,
    campusRampsVsOriginalFinish: campusRamps, mainMallForecourt: { pavingVsOriginalFinish: mainMall, renderedFinishUnderPavingM2: renderedFinishUnder, rampSegments: mainMallRamps.length,
      maxRampRunM: Math.max(0, ...mainMallRamps.map(sg => sg.run)), footLineDeviationM: footLines }, finishTrim: ties.stats.finishTrim, rampEnds: ties.stats.rampEnds };
}

export async function runGroundPavingOverlapTest() {
  const failures: string[] = [];
  const section = async <R>(name: string, run: () => R | Promise<R>) => {
    try { return await run(); } catch (error) { failures.push(`${name} threw: ${error instanceof Error ? error.message : String(error)}`); return null; }
  };
  const helper = await section('helper', () => helperCases(failures));
  const synthetic = await section('synthetic', () => syntheticScene(failures));
  const coplanarFinish = await section('coplanar finish', () => syntheticCoplanarFinish(failures));
  const real = await section('real scene', () => realScene(failures));
  return { failures, helper, synthetic, coplanarFinish, real };
}
