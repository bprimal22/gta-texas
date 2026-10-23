// b09 round 2: DKR exterior features outside the generated bowl's collider envelope (research/whole-campus-92/b09-stadium/EVIDENCE.md).
//  1. Bellmont Hall west facade: the official UT GIS (object 480) twin-pier notches continue above the authored dkr-frontage
//     (z 254-302, from Y 18.25) and full height for the three bays south of it (z 302-330.5). D19 pilot: bay types and the
//     block's top datum (Y 32.2, below the bowl rim; the upper-deck rear sets back above it) were read from reviewed captures with
//     the GIS piers projected through each sidecar camera (exterior-plan.json `bellmont`): five fin bays above the frontage
//     (10 pale fins of the frontage fin section with >= 0.55 m slots; upper-panel rib count unresolvable), three band bays of stacked recessed
//     ribbons. All levels are reference-interpreted estimates; the storefront level reuses dkr-frontage-plan.
//  2. North end corner towers: three round towers measured in the 2017 USGS 3DEP DSM (NEZ built 2008): centre, radius, top.
//  3. 2021 South End Zone: the official 160 x 44 ft
//     videoboard with its name header on the generated SEZ building face (stadium-bowl.ts SEZ_FACE), above the SEZ roof.
// The bowl is built later from footprints and retracts from authored coverage, so every mesh here is excluded from the coverage
// raster (userData.localContext) and the block check asserts the bowl is bit-identical to the no-install baseline.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { MeshBuilder, ColliderBuilder } from '../../context-geometry';
import type { Point } from '../../types';
import plan from './exterior-plan.json' with { type: 'json' };
import { STADIUM_FIELD, SEZ_FACE } from '../../stadium-bowl';
import { BOARD_HEADER_FRACTION } from './board-face';

type V = THREE.Vector3;
type Key = 'concrete' | 'glass' | 'fin' | 'finBack' | 'masonry' | 'cap' | 'roof' | 'boardFace' | 'boardBack' | 'slit';
const WHITE = new THREE.Color(1, 1, 1), UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
/** North round towers: height of the dark glazed lantern band under the cap (ref-ut-dji0226, estimate). */
const LANTERN_HEIGHT = 7.2;

export interface ExteriorParts { builders: Map<Key, MeshBuilder>; detail: Map<Key, MeshBuilder>; collider: ColliderBuilder; stats: Record<string, number> }

/** Piecewise-linear lookup in a [key, value...] table sorted by key. */
function lerpTable(rows: number[][], k: number, col: number) {
  if (k <= rows[0][0]) return rows[0][col];
  for (let i = 1; i < rows.length; i++) if (k <= rows[i][0]) { const a = rows[i - 1], b = rows[i], f = (k - a[0]) / (b[0] - a[0]); return a[col] + (b[col] - a[col]) * f; }
  return rows[rows.length - 1][col];
}

export function buildExterior(ground: (x: number, z: number) => number): ExteriorParts {
  const builders = new Map<Key, MeshBuilder>(), detail = new Map<Key, MeshBuilder>(), collider = new ColliderBuilder();
  const solid = (k: Key) => { let b = builders.get(k); if (!b) builders.set(k, b = new MeshBuilder()); return b; };
  const visual = (k: Key) => { let b = detail.get(k); if (!b) detail.set(k, b = new MeshBuilder()); return b; };
  const stats = { piers: 0, bays: 0, finBays: 0, bandBays: 0, ribbons: 0, fins: 0, towers: 0, board: 0 };
  const quad = (k: Key, a: V, b: V, c: V, d: V, facing: V, uvScale = 1) => {
    const w = a.distanceTo(b) / uvScale, h = a.distanceTo(d) / uvScale;
    solid(k).quad(a, b, c, d, [0, 0], [w, 0], [w, h], [0, h], WHITE, facing); collider.quad(a, b, c, d);
  };
  /** Oriented box: origin O, unit axes T (along), N (outward), Y up; extents t, d, y. `skip` omits faces ('b' bottom, 'k' back,
   *  's' both ±t sides — only where a neighbouring solid's coplanar face closes them, so no hidden overlapping faces remain). */
  const box = (k: Key, O: Point, T: Point, N: Point, t0: number, t1: number, d0: number, d1: number, y0: number, y1: number, skip = '') => {
    const P = (t: number, d: number, y: number) => new THREE.Vector3(O[0] + T[0] * t + N[0] * d, y, O[1] + T[1] * t + N[1] * d);
    const nT = new THREE.Vector3(T[0], 0, T[1]), nN = new THREE.Vector3(N[0], 0, N[1]);
    quad(k, P(t0, d1, y0), P(t1, d1, y0), P(t1, d1, y1), P(t0, d1, y1), nN);                       // front
    if (!skip.includes('k')) quad(k, P(t1, d0, y0), P(t0, d0, y0), P(t0, d0, y1), P(t1, d0, y1), nN.clone().negate());
    if (!skip.includes('s')) {
      quad(k, P(t1, d1, y0), P(t1, d0, y0), P(t1, d0, y1), P(t1, d1, y1), nT);                     // +t side
      quad(k, P(t0, d0, y0), P(t0, d1, y0), P(t0, d1, y1), P(t0, d0, y1), nT.clone().negate());    // -t side
    }
    quad(k, P(t0, d1, y1), P(t1, d1, y1), P(t1, d0, y1), P(t0, d0, y1), UP);                       // top
    if (!skip.includes('b')) quad(k, P(t0, d0, y0), P(t1, d0, y0), P(t1, d1, y0), P(t0, d1, y0), DOWN);
  };

  // ---- 1. Bellmont west facade -------------------------------------------------------------------------------------------
  const piers = plan.piers, wall = plan.westWall as number[][], F = plan.frontage;
  const wallX = (z: number) => lerpTable(wall, z, 1), wallTop = (z: number) => lerpTable(wall, z, 2);
  const frontageCovers = (z: number) => z >= F.zMin - 0.01 && z <= F.zMax + 0.01;
  const baseAt = (z: number) => lerpTable(piers.map(p => [p.z, p.base]), z, 1);
  /** Recess depth behind the GIS face line, limited by the measured bowl wall (>= 0.12 m clear). */
  const backFor = (z0: number, z1: number) => { let m = Infinity; for (let z = z0; z <= z1; z += 0.25) m = Math.min(m, wallX(z) - baseAt(z)); return Math.max(0.05, Math.min(0.3, m - 0.12)); };
  // D19 pilot (exterior-plan.json `bellmont`): the west block tops out at a reference-interpreted datum well below the bowl rim
  // (the upper-deck rear sets back to the bowl wall above it), and each official bay is either a fin bay (dense pale ribs above the
  // authored frontage) or a band bay (evenly stacked recessed ribbon windows), as projected into the reviewed captures.
  const BEL = plan.bellmont, bayTops: number[] = [];
  for (let i = 0; i + 1 < piers.length; i++) { let t = Infinity; for (let z = piers[i].z; z <= piers[i + 1].z; z += 0.25) t = Math.min(t, wallTop(z)); bayTops.push(Math.round(Math.min(t, BEL.facadeTop) * 20) / 20); }
  const frame = (a: { z: number; base: number }, b: { z: number; base: number }) => {
    const dx = b.base - a.base, dz = b.z - a.z, L = Math.hypot(dx, dz), T: Point = [dx / L, dz / L], N: Point = [-T[1], T[0]];
    return { O: [a.base, a.z] as Point, T, N, L };
  };
  for (let i = 0; i + 1 < piers.length; i++) {
    const a = piers[i], b = piers[i + 1], { O, T, N, L } = frame(a, b), top = bayTops[i], back = backFor(a.z, b.z);
    const full = !frontageCovers((a.z + b.z) / 2), t0 = a.width / 2, t1 = L - b.width / 2;
    const g = Math.min(ground(O[0] + T[0] * t0, O[1] + T[1] * t0), ground(O[0] + T[0] * t1, O[1] + T[1] * t1), ground(O[0] + T[0] * L / 2, O[1] + T[1] * L / 2));
    const bay = BEL.bays[i];
    if (!bay || Math.abs(bay.z0 - a.z) > 0.01 || Math.abs(bay.z1 - b.z) > 0.01) throw new Error(`b09 Bellmont bay ${i} does not match the official piers`);
    const bands: [number, number, 'spandrel' | 'glass' | 'fins'][] = [];
    if (bay.type === 'band') {
      // Ground storey (storefront level reused from dkr-frontage), then evenly pitched recessed ribbons up to the coping.
      const B = BEL.band, y0 = (full ? g - 0.6 : F.upperBottom), base = full ? g + B.groundStorey : F.upperBottom, pitch = (top - B.coping - base) / B.ribbons;
      if (full) bands.push([y0, base, 'glass']);
      for (let k = 0; k < B.ribbons; k++) bands.push([base + k * pitch, base + (k + 1) * pitch - B.ribbonHeight, 'spandrel'], [base + (k + 1) * pitch - B.ribbonHeight, base + (k + 1) * pitch, 'glass']);
      bands.push([top - B.coping, top, 'spandrel']);
      stats.bandBays++; stats.ribbons += B.ribbons;
    } else {
      const Fn = BEL.fin;
      if (full) bands.push([g - 0.6, g + 4.7, 'glass'], [g + 4.7, g + 6.0, 'spandrel'], [g + 6.0, g + 7.6, 'glass'], [g + 7.6, g + 9.25, 'spandrel'], [g + 9.25, g + 24.2, 'fins'], [g + 24.2, F.upperBottom, 'spandrel']);
      bands.push([F.upperBottom, F.upperBottom + Fn.base, 'spandrel'], [F.upperBottom + Fn.base, top - Fn.coping, 'fins'], [top - Fn.coping, top, 'spandrel']);
      stats.finBays++;
    }
    for (const [y0, y1, kind] of bands) {
      if (y1 - y0 < 0.05) continue;
      if (kind === 'spandrel') { box('concrete', O, T, N, t0, t1, -back, 0, y0, y1, 'k'); continue; }
      if (kind === 'glass') {
        box('glass', O, T, N, t0, t1, -back, -back + 0.05, y0, y1, 'k');
        for (let t = t0 + 1.5; t < t1 - 0.5; t += 1.5) box('fin', O, T, N, t - 0.04, t + 0.04, -back + 0.05, -back + 0.17, y0, y1, 'kb');
        continue;
      }
      // Fin panel: pale full-depth fins (frontage fin section) with equal slots between them and at both piers; the mid-grey
      // backing exists only inside the slots (no slab hidden behind the fins). Slots narrower than BEL.fin.minSlot would be
      // unreachable sub-capsule cavities (same rule as the pier slot above) and are rejected rather than built.
      const n = BEL.fin.perBay, w = BEL.fin.width, gap = (t1 - t0 - n * w) / (n + 1);
      if (gap < BEL.fin.minSlot) throw new Error(`b09 Bellmont bay ${i}: fin slot ${gap.toFixed(3)} m < ${BEL.fin.minSlot} m`);
      for (let j = 0; j <= n; j++) {
        const s0 = t0 + j * (gap + w), s1 = s0 + gap;
        box('finBack', O, T, N, s0, s1, -back, -back + 0.05, y0, y1, 'ks');
        if (j < n) { box('fin', O, T, N, s1, s1 + w, -back, BEL.fin.proud, y0, y1, 'kb'); stats.fins++; }
      }
    }
    // Roof over the void between the facade and the measured bowl wall, soffit under it on the upper-only bays.
    const yBottom = full ? null : F.upperBottom;
    for (let t = 0; t < L - 1e-6; t += 0.5) {
      const tb = Math.min(L, t + 0.5), pa = [O[0] + T[0] * t, O[1] + T[1] * t], pb = [O[0] + T[0] * tb, O[1] + T[1] * tb];
      const ba = new THREE.Vector3(pa[0] - N[0] * back, 0, pa[1] - N[1] * back), bb = new THREE.Vector3(pb[0] - N[0] * back, 0, pb[1] - N[1] * back);
      const wa = new THREE.Vector3(Math.min(wallX(pa[1]), wallX(pb[1])) - 0.05, 0, pa[1]), wb = new THREE.Vector3(Math.min(wallX(pa[1]), wallX(pb[1])) - 0.05, 0, pb[1]);
      if (wa.x - ba.x < 0.02 && wb.x - bb.x < 0.02) continue;
      quad('roof', ba.clone().setY(top), bb.clone().setY(top), wb.clone().setY(top), wa.clone().setY(top), UP);
      if (yBottom !== null) quad('concrete', ba.clone().setY(yBottom), wa.clone().setY(yBottom), wb.clone().setY(yBottom), bb.clone().setY(yBottom), DOWN);
    }
    stats.bays++;
  }
  // Twin piers (official notch positions/widths); their frame follows the adjacent bays.
  for (let i = 0; i < piers.length; i++) {
    const p = piers[i], prev = piers[Math.max(0, i - 1)], next = piers[Math.min(piers.length - 1, i + 1)];
    const { T, N } = frame(prev === p ? p : prev, next === p ? p : next), O: Point = [p.base, p.z];
    const top = Math.max(i > 0 ? bayTops[i - 1] : -Infinity, i < bayTops.length ? bayTops[i] : -Infinity) + 0.45;
    const back = backFor(p.z - p.width / 2, p.z + p.width / 2), front = p.base - p.front, half = p.width / 2, col = 0.42;
    const y0 = frontageCovers(p.z) ? F.upperBottom : Math.min(ground(p.front, p.z - half), ground(p.front, p.z + half)) - 0.6;
    // One solid pier to the GIS front; the 0.42 m slot between the twin columns is drawn as a dark 1 cm-proud reveal (a real
    // 0.42 m slot is narrower than the player capsule and would only add an unreachable cavity).
    box('concrete', O, T, N, -half, half, -back, front, y0, top, 'k');
    const R = (t: number, y: number) => new THREE.Vector3(O[0] + T[0] * t + N[0] * (front + 0.01), y, O[1] + T[1] * t + N[1] * (front + 0.01));
    visual('slit').quad(R(-half + col, y0 + 0.3), R(half - col, y0 + 0.3), R(half - col, top - 0.3), R(-half + col, top - 0.3), [0, 0], [1, 0], [1, 1], [0, 1], WHITE, new THREE.Vector3(N[0], 0, N[1]));
    stats.piers++;
  }
  // End walls closing the void at the north and south ends of the facade.
  for (const [p, sign] of [[piers[0], -1], [piers[piers.length - 1], 1]] as const) {
    const z = p.z + sign * p.width / 2, x0 = p.base, x1 = wallX(z) - 0.05;
    const y0 = frontageCovers(p.z) ? F.upperBottom : ground(p.base, z) - 0.6, y1 = (sign < 0 ? bayTops[0] : bayTops[bayTops.length - 1]);
    if (x1 - x0 > 0.05) quad('concrete', new THREE.Vector3(x0, y0, z), new THREE.Vector3(x1, y0, z), new THREE.Vector3(x1, y1, z), new THREE.Vector3(x0, y1, z), new THREE.Vector3(0, 0, sign));
  }

  // ---- 2. North end corner towers (2017 LiDAR DSM blobs) -------------------------------------------------------------------
  for (const tw of plan.towers) {
    const [cx, cz] = tw.centre, r = tw.radius, seg = 28;
    let g = Infinity; for (let k = 0; k < seg; k++) { const a = (k / seg) * Math.PI * 2; g = Math.min(g, ground(cx + Math.cos(a) * r, cz + Math.sin(a) * r)); }
    const y0 = g - 0.6, capY = tw.top - 0.7, ring = (rad: number, y: number, k: number) => new THREE.Vector3(cx + Math.cos((k / seg) * Math.PI * 2) * rad, y, cz + Math.sin((k / seg) * Math.PI * 2) * rad);
    // ref-ut-dji0226 (north elevation crop): brick body with cream cast-stone base and stringcourse, a tall dark glazed
    // lantern band right under the round cap (pale cornice, dark roof). Band heights are estimates from that image.
    const glassTop = capY, glassBottom = tw.top - LANTERN_HEIGHT, course = glassBottom - 0.7, baseTop = g + 2.2;
    for (let k = 0; k < seg; k++) {
      const out = new THREE.Vector3(Math.cos(((k + 0.5) / seg) * Math.PI * 2), 0, Math.sin(((k + 0.5) / seg) * Math.PI * 2));
      quad('cap', ring(r, y0, k), ring(r, y0, k + 1), ring(r, baseTop, k + 1), ring(r, baseTop, k), out);
      quad('masonry', ring(r, baseTop, k), ring(r, baseTop, k + 1), ring(r, course, k + 1), ring(r, course, k), out, 3);
      quad('cap', ring(r, course, k), ring(r, course, k + 1), ring(r, glassBottom, k + 1), ring(r, glassBottom, k), out);
      // Lantern glazing 0.1 m inside the brick face (within the LiDAR radius tolerance), its sill and head closed.
      quad('glass', ring(r - 0.1, glassBottom, k), ring(r - 0.1, glassBottom, k + 1), ring(r - 0.1, glassTop, k + 1), ring(r - 0.1, glassTop, k), out);
      quad('cap', ring(r - 0.1, glassBottom, k), ring(r - 0.1, glassBottom, k + 1), ring(r, glassBottom, k + 1), ring(r, glassBottom, k), UP);
      // Pale cap band (slightly proud) and its underside.
      quad('cap', ring(r + 0.18, capY, k), ring(r + 0.18, capY, k + 1), ring(r + 0.18, tw.top, k + 1), ring(r + 0.18, tw.top, k), out);
      quad('cap', ring(r - 0.1, capY, k), ring(r - 0.1, capY, k + 1), ring(r + 0.18, capY, k + 1), ring(r + 0.18, capY, k), DOWN);
      solid('roof').tri(new THREE.Vector3(cx, tw.top, cz), ring(r + 0.18, tw.top, k + 1), ring(r + 0.18, tw.top, k), [0, 0], [1, 0], [0, 1], WHITE, UP);
      collider.tri(new THREE.Vector3(cx, tw.top, cz), ring(r + 0.18, tw.top, k + 1), ring(r + 0.18, tw.top, k));
    }
    // Slim pale mullions on the lantern (every second facet), 2 cm proud, visual only.
    for (let k = 0; k < seg; k += 2) {
      const a0 = ((k - 0.06) / seg) * Math.PI * 2, a1 = ((k + 0.06) / seg) * Math.PI * 2, rr = r - 0.08;
      const p = (a: number, y: number) => new THREE.Vector3(cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr);
      visual('cap').quad(p(a0, glassBottom), p(a1, glassBottom), p(a1, glassTop), p(a0, glassTop), [0, 0], [1, 0], [1, 1], [0, 1], WHITE, new THREE.Vector3(Math.cos(k / seg * Math.PI * 2), 0, Math.sin(k / seg * Math.PI * 2)));
    }
    stats.towers++;
  }

  // ---- 3. (retired) South End Zone premium bands: the bowl's own SEZ exterior (stadium-bowl.ts stadiumSezSouth facade, from the
  //      Dec 2025 photograph) replaces the estimated glazing ribbons that used to be hung on the measured south wall.
  // ---- 4. 2021 SEZ videoboard on the SEZ building face ---------------------------------------------------------------------
  // Official 160 x 44 ft screen (texaslonghorns.com facility page), centred on the field axis (ref-ut-pano0009) and mounted on
  // the generated SEZ building face (stadium-bowl.ts SEZ_FACE) with the name header above, rising above the SEZ roof (plan.board.note).
  const B = plan.board, W: Point = [Math.cos(STADIUM_FIELD.angle), -Math.sin(STADIUM_FIELD.angle)], Lf: Point = [Math.sin(STADIUM_FIELD.angle), Math.cos(STADIUM_FIELD.angle)];
  const along = STADIUM_FIELD.halfLength + SEZ_FACE.t - B.depth / 2 - B.faceGap;
  const Ob: Point = [STADIUM_FIELD.center[0] + Lf[0] * along, STADIUM_FIELD.center[1] + Lf[1] * along];
  if (Math.hypot(Ob[0] - B.centre[0], Ob[1] - B.centre[1]) > 0.05) throw new Error(`b09 board centre ${Ob.join(',')} drifted from the plan ${B.centre.join(',')} (SEZ face moved?)`);
  const P = (t: number, d: number, y: number) => new THREE.Vector3(Ob[0] + W[0] * t + Lf[0] * d, y, Ob[1] + W[1] * t + Lf[1] * d);
  const hw = B.width / 2, hd = B.depth / 2, nL = new THREE.Vector3(Lf[0], 0, Lf[1]), nW = new THREE.Vector3(W[0], 0, W[1]);
  const bottom = B.top - B.header - B.height, split = B.top - B.header;
  // Screen + header faces toward the field (-L) with one shared canvas (board-face.ts: header = top BOARD_HEADER_FRACTION).
  const face = (y0: number, y1: number, v0: number, v1: number) => {
    const a = P(hw, -hd, y0), b = P(-hw, -hd, y0), c = P(-hw, -hd, y1), d = P(hw, -hd, y1);
    solid('boardFace').quad(a, b, c, d, [0, v0], [1, v0], [1, v1], [0, v1], WHITE, nL.clone().negate()); collider.quad(a, b, c, d);
  };
  face(bottom, split, 0, 1 - BOARD_HEADER_FRACTION); face(split, B.top, 1 - BOARD_HEADER_FRACTION, 1);
  quad('boardBack', P(-hw, hd, bottom), P(hw, hd, bottom), P(hw, hd, B.top), P(-hw, hd, B.top), nL);
  quad('boardBack', P(hw, hd, bottom), P(hw, -hd, bottom), P(hw, -hd, B.top), P(hw, hd, B.top), nW);
  quad('boardBack', P(-hw, -hd, bottom), P(-hw, hd, bottom), P(-hw, hd, B.top), P(-hw, -hd, B.top), nW.clone().negate());
  quad('boardBack', P(-hw, -hd, B.top), P(hw, -hd, B.top), P(hw, hd, B.top), P(-hw, hd, B.top), UP);
  quad('boardBack', P(-hw, hd, bottom), P(hw, hd, bottom), P(hw, -hd, bottom), P(-hw, -hd, bottom), DOWN);
  stats.board = 1;
  return { builders, detail, collider, stats };
}

export const EXTERIOR_MATERIALS: Record<Key, { color: number; roughness: number; metalness?: number; emissive?: number }> = {
  concrete: { color: 0xcfcabb, roughness: 0.88 }, fin: { color: 0xc4bfae, roughness: 0.86 }, finBack: { color: 0x8f8c83, roughness: 0.9 }, glass: { color: 0x26313a, roughness: 0.22, metalness: 0.35 },
  masonry: { color: 0xb9814f, roughness: 0.92 }, cap: { color: 0xe3ddcd, roughness: 0.85 }, roof: { color: 0x8e8b84, roughness: 0.95 },
  boardFace: { color: 0xffffff, roughness: 0.4, metalness: 0, emissive: 0xffffff }, boardBack: { color: 0xb4521c, roughness: 0.6, metalness: 0.15 } /* orange-clad board rear (ref-commons-ajay-2025) */, slit: { color: 0x1f272d, roughness: 0.3, metalness: 0.3 },
};

/** Trimesh collider from the solid triangles (same buffers as the rendered solids). */
export function exteriorCollider(physics: RAPIER.World, c: ColliderBuilder) {
  const vertices = new Float32Array(c.position), indices = new Uint32Array(vertices.length / 3).map((_, i) => i);
  return physics.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.8));
}
