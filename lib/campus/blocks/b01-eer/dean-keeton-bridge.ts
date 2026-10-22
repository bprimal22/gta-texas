// Block b01-eer round 3: the engineering pedestrian bridge across East Dean Keeton (OSM way 25775199,
// footway, bridge=yes, layer=1). It runs from the ECJ/PMA south terrace (node 1398129190, shared with
// ECJ way 38625301) to the ETC/CPE north plaza (node 281143403). It is NOT the Peyton Yates EER-GLT bridge.
// Evidence: research/whole-campus-92/user-landmarks/ENGINEERING-BRIDGE.md (+ evidence / LiDAR probe json),
// UT ME facilities (https://me.utexas.edu/about/facilities/: ETC walkway and bridge to CPE and the south
// engineering campus), street reference 17-engineering-dean-keeton.jpg (Mar 2024: uncovered concrete deck,
// light longitudinal girders, solid gray parapets). Photos are interpretation only; nothing is traced.
//
// Measured: plan (OSM nodes), south terrace level Y7.03 (DSM z-343, +-7 m), north plaza Y6.39 (DSM z-410),
// road Y0.7-1.5. Estimated (labelled in the ledger): deck grade between the ends (centre DSM missing),
// width 6.0 m, slab 0.3 m, girder/fascia depth 1.0 m below the deck, parapet 1.07 m, the single median pier,
// the north abutment position and the north landing ramp (the baked terrain north of the road is ~2.5 m
// below the LiDAR plaza at the bridge end; no terrain rebake, so the landing ramps down to it at 12%).
//
// Collision contract (ENGINEERING-BRIDGE-COLLISION-REVIEW.md): final campus coordinates are baked into the
// geometry; each collider is a trimesh of exactly the rendered triangles; the deck is returned as walkable;
// nothing is tagged as a ground tie-in source; no terrain cut under the deck; road/sidewalk support below
// is untouched.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { BlockInstallContext } from '../types';
import { engineeringCourtBasis, engineeringCourtLocal } from '../../engineering-courtyard';
import { pmaBridgeCourt } from '../../pma-local-podium';

type ST = [number, number];
export const DEAN_BRIDGE = {
  osmWay: 25775199,
  south: [93.3073, -99.4636] as ST, // engineering s/t of the OSM south node (campus 133.857, -343.150)
  north: [93.0339, -157.5433] as ST, // north node (campus 138.734, -401.026)
  southY: 7.03, // DSM at the south terrace, measured
  northY: 6.4, // DSM north plaza Y6.32-6.39 at z-410, measured nearby; used at the north node (estimate there)
  halfWidth: 3.0, parapetThick: 0.25, parapetH: 1.07, slab: 0.3, structure: 1.0,
  girderWidth: 0.5, pierU: 21.9, pierSize: 0.7, capDepth: 0.35, abutmentU: 52.8, rampGrade: 0.12,
} as const;
const B = DEAN_BRIDGE;
const L = Math.hypot(B.north[0] - B.south[0], B.north[1] - B.south[1]);
const D: ST = [(B.north[0] - B.south[0]) / L, (B.north[1] - B.south[1]) / L];
const N: ST = [-D[1], D[0]]; // lateral, +v toward +s (east)
export const bridgeLength = L;
/** Engineering s/t of the bridge station u (m from the south node toward the north node), lateral v. */
export const bridgeST = (u: number, v: number): ST => [B.south[0] + D[0] * u + N[0] * v, B.south[1] + D[1] * u + N[1] * v];
export const bridgeWorld = (u: number, v: number, y = 0) => { const [s, t] = bridgeST(u, v); return new THREE.Vector3(s, y, t).applyMatrix4(engineeringCourtBasis); };
/** Deck grade between the measured end levels (inferred: centre-deck DSM is missing). */
export const bridgeDeckY = (u: number) => B.southY + (B.northY - B.southY) * THREE.MathUtils.clamp(u, 0, L) / L;
/** Station u of a campus point (projection on the bridge axis) and its lateral v. */
export function bridgeUV(x: number, z: number) {
  const { s, t } = engineeringCourtLocal(x, z), ds = s - B.south[0], dt = t - B.south[1];
  return { u: ds * D[0] + dt * D[1], v: ds * N[0] + dt * N[1] };
}

type Fn = (u: number, v: number) => number;
/** Prism over stations us x laterals vs: top/bottom grids, two sides, two end caps, all outward. Faces
 * fully covered by an adjoining solid (e.g. a girder top under the deck slab) are skipped: they are never
 * visible, and a hidden up-facing face would otherwise be a phantom floor for the ground query. */
type Skip = Partial<Record<'top' | 'bottom' | 'northEnd', boolean>>;
function prism(us: number[], vs: number[], top: Fn, bottom: Fn, uOf: (u: number, v: number) => number = u => u, skip: Skip = {}) {
  const pos: number[] = [], idx: number[] = [];
  const P = (u: number, v: number, y: number) => { const [s, t] = bridgeST(uOf(u, v), v); pos.push(s, y, t); return pos.length / 3 - 1; };
  const quad = (a: number, b: number, c: number, d: number, want: THREE.Vector3) => {
    const pa = new THREE.Vector3().fromArray(pos, a * 3), pb = new THREE.Vector3().fromArray(pos, b * 3), pc = new THREE.Vector3().fromArray(pos, c * 3);
    const n = pb.clone().sub(pa).cross(pc.clone().sub(pa));
    if (n.dot(want) >= 0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
  };
  const up = new THREE.Vector3(0, 1, 0), dn = new THREE.Vector3(0, -1, 0);
  const n3 = new THREE.Vector3(N[0], 0, N[1]), d3 = new THREE.Vector3(D[0], 0, D[1]);
  for (const [f, want] of ([[top, up, skip.top], [bottom, dn, skip.bottom]] as [Fn, THREE.Vector3, boolean | undefined][]).filter(e => !e[2])) {
    const grid = us.map(u => vs.map(v => P(u, v, f(u, v))));
    for (let i = 0; i + 1 < us.length; i++) for (let j = 0; j + 1 < vs.length; j++) quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1], want);
  }
  for (const [v, want] of [[vs[0], n3.clone().negate()], [vs[vs.length - 1], n3]] as [number, THREE.Vector3][])
    for (let i = 0; i + 1 < us.length; i++) {
      const a = P(us[i], v, bottom(us[i], v)), b = P(us[i + 1], v, bottom(us[i + 1], v)), c = P(us[i + 1], v, top(us[i + 1], v)), d = P(us[i], v, top(us[i], v));
      quad(a, b, c, d, want);
    }
  for (const [u, want] of ([[us[0], d3.clone().negate()], [us[us.length - 1], d3]] as [number, THREE.Vector3][]).filter((_, i) => !(i === 1 && skip.northEnd)))
    for (let j = 0; j + 1 < vs.length; j++) {
      const a = P(u, vs[j], bottom(u, vs[j])), b = P(u, vs[j + 1], bottom(u, vs[j + 1])), c = P(u, vs[j + 1], top(u, vs[j + 1])), d = P(u, vs[j], top(u, vs[j]));
      quad(a, b, c, d, want);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  return g;
}
/** Axis-aligned box in the engineering s/t frame (terrace pieces). */
function stBox(s0: number, s1: number, t0: number, t1: number, y0: number, y1: number) {
  return new THREE.BoxGeometry(s1 - s0, y1 - y0, t1 - t0).translate((s0 + s1) / 2, (y0 + y1) / 2, (t0 + t1) / 2);
}
const range = (a: number, b: number, step: number) => { const r: number[] = []; for (let u = a; u < b - 1e-6; u += step) r.push(u); r.push(b); return r; };

export function buildDeanKeetonBridge(ctx: BlockInstallContext) {
  const ground = (u: number, v: number) => { const p = bridgeWorld(u, v); return ctx.groundHeight(p.x, p.z); };
  // South end: the deck's first row lies exactly on the court's Dean Keeton edge t = pmaBridgeCourt.tN.
  const uFace = (u: number, v: number) => u === 0 ? (pmaBridgeCourt.tN - B.south[1] - N[1] * v) / D[1] : u;
  // North landing: from the north node the top ramps down at rampGrade until it meets the baked ground.
  let uEnd = L;
  while (uEnd < L + 30 && B.northY - B.rampGrade * (uEnd - L) > ground(uEnd, 0) + 0.03) uEnd += 0.5;
  const topY: Fn = (u, v) => {
    const base = u <= L ? bridgeDeckY(u) : B.northY - B.rampGrade * (u - L);
    return u > B.abutmentU ? Math.max(base, ground(u, v) + 0.03) : base;
  };
  const W = B.halfWidth, inner = W - B.parapetThick, girderIn = W - B.girderWidth - B.parapetThick;
  // Stations: u = 0 is remapped onto the terrace edge row; key stations kept exactly.
  const us = [...new Set([0, ...range(3, uEnd, 1), B.pierU - .5, B.pierU + .5, B.abutmentU - .6, B.abutmentU, L].map(u => +u.toFixed(3)))].filter(u => u <= uEnd).sort((a, b) => a - b);
  const span = us.filter(u => u <= B.abutmentU - .6), approach = us.filter(u => u >= B.abutmentU);
  const geos: Record<'deck' | 'struct' | 'parapet', THREE.BufferGeometry[]> = { deck: [], struct: [], parapet: [] };
  const below = (d: number): Fn => (u, v) => topY(u, v) - d, low: Fn = (u, v) => ground(u, v) - 0.4;
  // 1. Walkable deck + north landing: closed 0.3 m slab across the full 6 m (parapets stand on it).
  geos.deck.push(prism(us, [-W, -inner, -1.4, 1.4, inner, W], topY, below(B.slab), uFace));
  for (const sgn of [-1, 1]) {
    const side = (a: number, b: number) => sgn < 0 ? [-b, -a] : [a, b];
    // 2. Solid gray parapets along both edges, the whole length (no bottom face: it sits on the deck).
    geos.parapet.push(prism(us, side(inner, W), (u, v) => topY(u, v) + B.parapetH, topY, uFace, { bottom: true }));
    // 3. Light concrete edge girders (outer face flush with the deck edge = the deep fascia), span only.
    geos.struct.push(prism(span, side(girderIn, W), below(B.slab), below(B.structure), uFace, { top: true, northEnd: true }));
    // Approach side walls closing the landing down into the baked ground (its retaining edges).
    geos.struct.push(prism(approach, side(inner, W), below(B.slab), low, undefined, { top: true }));
  }
  geos.struct.push(prism(span, [-B.girderWidth / 2, B.girderWidth / 2], below(B.slab), below(B.structure), uFace, { top: true, northEnd: true }));
  // 4. Median pier (estimate: count/position not sourced): two columns under the edge girders.
  const pu = B.pierU, half = B.pierSize / 2, gv = W - B.girderWidth / 2;
  for (const v of [-gv, gv]) geos.struct.push(prism([pu - half, pu + half], [v - half, v + half], below(B.structure), low, undefined, { top: true }));
  // 5. North abutment wall closing the span end over the falling bank.
  geos.struct.push(prism([B.abutmentU - .6, B.abutmentU], [-W, W], below(B.slab), low, undefined, { top: true }));
  const uParEnd = uEnd;
  // 6. South court through the podium (cut in pma-local-podium.ts) carrying OSM footway 573368327 from the
  //    existing ground south of the podium to the deck: walkable floor at an even grade from the measured
  //    Y7.03 at the Dean Keeton edge to the baked ground at the podium's south face (+0.6 m apron), plus
  //    the Dean Keeton parapet, open where the deck meets it.
  const C0 = pmaBridgeCourt, groundST = (sv: number, tv: number) => { const p = new THREE.Vector3(sv, 0, tv).applyMatrix4(engineeringCourtBasis); return ctx.groundHeight(p.x, p.z); };
  const tApron = C0.tS + .6, courtS = range(C0.s0, C0.s1, 2.5), courtT = range(C0.tN, C0.tS, 3).concat([tApron]);
  const courtY = (sv: number, tv: number) => {
    const south = groundST(sv, tApron) + .02, k = THREE.MathUtils.clamp((tv - C0.tN) / (tApron - C0.tN), 0, 1);
    return Math.max(THREE.MathUtils.lerp(B.southY, south, k), groundST(sv, tv) + .03);
  };
  const court = (() => {
    const pos: number[] = [], idx: number[] = [], top: number[][] = [], bot: number[][] = [];
    const V = (sv: number, y: number, tv: number) => { pos.push(sv, y, tv); return pos.length / 3 - 1; };
    for (const tv of courtT) { top.push(courtS.map(sv => V(sv, courtY(sv, tv), tv))); bot.push(courtS.map(sv => V(sv, courtY(sv, tv) - B.slab, tv))); }
    const P = (i: number) => new THREE.Vector3().fromArray(pos, i * 3);
    // Quad a-b-c-d emitted with its normal turned toward `want` (top up, bottom down, sides outward).
    const quad = (a: number, b: number, c: number, d: number, want: THREE.Vector3) => {
      const n = P(b).sub(P(a)).cross(P(c).sub(P(a)));
      if (n.dot(want) >= 0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
    };
    const ni = courtT.length, nj = courtS.length, up = new THREE.Vector3(0, 1, 0), dn = new THREE.Vector3(0, -1, 0);
    for (let i = 0; i + 1 < ni; i++) for (let j = 0; j + 1 < nj; j++) {
      quad(top[i][j], top[i + 1][j], top[i + 1][j + 1], top[i][j + 1], up);
      quad(bot[i][j], bot[i + 1][j], bot[i + 1][j + 1], bot[i][j + 1], dn);
    }
    for (let i = 0; i + 1 < ni; i++) {
      quad(bot[i][0], bot[i + 1][0], top[i + 1][0], top[i][0], new THREE.Vector3(-1, 0, 0));
      quad(bot[i][nj - 1], bot[i + 1][nj - 1], top[i + 1][nj - 1], top[i][nj - 1], new THREE.Vector3(1, 0, 0));
    }
    for (let j = 0; j + 1 < nj; j++) {
      quad(bot[0][j], bot[0][j + 1], top[0][j + 1], top[0][j], new THREE.Vector3(0, 0, -1));
      quad(bot[ni - 1][j], bot[ni - 1][j + 1], top[ni - 1][j + 1], top[ni - 1][j], new THREE.Vector3(0, 0, 1));
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    return g;
  })();
  const deckS = [bridgeST(uFace(0, -W), -W)[0], bridgeST(uFace(0, W), W)[0]].sort((a, b) => a - b);
  const parY0 = courtY(C0.s0, C0.tN);
  geos.parapet.push(stBox(C0.s0, deckS[0], C0.tN, C0.tN + B.parapetThick, parY0, B.southY + B.parapetH),
    stBox(deckS[1], C0.s1, C0.tN, C0.tN + B.parapetThick, parY0, B.southY + B.parapetH));
  const terraceFloor = court;
  const paving = ctx.material('Engineering concrete walks') as THREE.Material | undefined;
  const owned: THREE.Material[] = [];
  const mat = (name: string, color: number, roughness: number) => { const m = new THREE.MeshStandardMaterial({ color, roughness }); m.name = name; owned.push(m); return m; };
  const deckMat = paving ?? mat('Dean Keeton bridge deck paving', 0xb9b6ac, .95);
  const structMat = mat('Dean Keeton bridge light concrete girders', 0xcfc8b8, .9);
  const parapetMat = mat('Dean Keeton bridge gray parapet', 0x9a9b95, .92);
  const geometries: THREE.BufferGeometry[] = [], colliders: RAPIER.Collider[] = [];
  const finish = (parts: THREE.BufferGeometry[], material: THREE.Material, name: string) => {
    const flat = parts.map(g => { g.applyMatrix4(engineeringCourtBasis); const f = g.index ? g.toNonIndexed() : g; return f; });
    const g = new THREE.BufferGeometry();
    const all = flat.flatMap(f => Array.from(f.getAttribute('position').array as ArrayLike<number>));
    g.setAttribute('position', new THREE.Float32BufferAttribute(all, 3));
    g.setIndex(Array.from({ length: all.length / 3 }, (_, i) => i));
    g.computeVertexNormals();
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { const ny = Math.abs(n.getY(i)) > .7; uv[i * 2] = ny ? p.getX(i) / 2 : (p.getX(i) + p.getZ(i)) / 2; uv[i * 2 + 1] = ny ? p.getZ(i) / 2 : p.getY(i) / 2; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.computeBoundingBox(); g.computeBoundingSphere();
    for (const part of new Set([...parts, ...flat])) part.dispose();
    geometries.push(g);
    const mesh = new THREE.Mesh(g, material); mesh.name = name; mesh.castShadow = mesh.receiveShadow = true;
    colliders.push(ctx.physics.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(p.array as ArrayLike<number>), new Uint32Array(g.index!.array as ArrayLike<number>), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.8)));
    return mesh;
  };
  const deck = finish([...geos.deck, terraceFloor], deckMat, 'Dean Keeton engineering bridge: deck and landings');
  const struct = finish(geos.struct, structMat, 'Dean Keeton engineering bridge: girders, pier and abutment');
  const parapet = finish(geos.parapet, parapetMat, 'Dean Keeton engineering bridge: parapets');
  const southEnd = bridgeWorld(uFace(0, 0), 0, B.southY), northEnd = bridgeWorld(uEnd, 0, topY(uEnd, 0));
  return {
    walkable: [deck], solids: [struct, parapet], colliders, geometries, materials: owned,
    stats: {
      osmWay: B.osmWay, mappedLengthM: +L.toFixed(2), widthM: 2 * W, walkableWidthM: 2 * inner,
      deckY: { south: B.southY, northNode: B.northY, basis: 'south/north measured nearby (DSM); grade between inferred' },
      uFace: +uFace(0, 0).toFixed(2), abutmentU: B.abutmentU, northNodeU: +L.toFixed(2), landingEndU: +uEnd.toFixed(2), parapetEndU: uParEnd,
      landingEndY: +topY(uEnd, 0).toFixed(2), southEnd: southEnd.toArray().map(v => +v.toFixed(2)), northEnd: northEnd.toArray().map(v => +v.toFixed(2)),
      underside: 'deck - 1.0 m (girders/fascia)', pierU: B.pierU,
      triangles: geometries.reduce((n, g) => n + g.getAttribute('position').count / 3, 0), meshes: 3,
      materials: { deck: deckMat.name, borrowedDeck: !!paving, owned: owned.map(m => m.name) },
      court: { s: [C0.s0, C0.s1], t: [C0.tN, tApron], yNorth: +courtY(93.5, C0.tN).toFixed(2), ySouth: +courtY(93.5, tApron).toFixed(2), osmFootway: 573368327 },
      estimates: ['deck grade between ends', 'width 6.0 m', 'slab/girder/parapet sizes', 'median pier', 'north abutment at u52.8', 'north landing ramp 12% to the baked ground', 'court width 15 m and its even grade'],
    },
  };
}
