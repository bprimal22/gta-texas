// George Washington (Pompeo Coppini, 1955), head of the South Mall on the Tower axis. Authored geometry.
// Placement is MEASURED: the 2017 LiDAR DSM shows a raised deck at Y 15.1 (x -229.2..-219.6, z 129.5..136.4,
// 0.3 m coping along its east/west/south edges) and a narrow peak at Y 18.8 at (-225.6, 130.9).
// The pose is reference-interpreted from the full-length CC0 photograph by Daderot (2015-11-17,
// commons.wikimedia.org/wiki/File:George_Washington_by_Pompeo_Coppini,_1955_-_University_of_Texas_at_Austin_-_DSC08601.jpg)
// and the UT News close photographs (2026-07-02). Both arms are lowered, the hat is held in the right hand
// at the thigh, and the left hand rests on a thin vertical staff. He wears a high collar, a buttoned waistcoat,
// a long military coat and a cloak over the shoulders, with a tied queue and tall boots.
// The figure faces south down the mall. Every dimension is an ESTIMATE, scaled so that the pedestal, base
// and figure together fill the LiDAR 3.7 m above the deck. No facial likeness or survey precision is claimed.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { metreBoxUV } from './textured-finish';

export const WASHINGTON = {
  /** LiDAR statue peak and deck (campus Y), plus the Tower-axis heading (local +z faces south down the mall). */
  position: [-225.6, 130.9] as [number, number], lidarPeakY: 18.8, lidarDeckY: 15.1,
  deck: { x0: -229.2, x1: -219.6, z0: 129.5, z1: 136.4 },
  yaw: Math.atan2(-0.08387655737226869, 0.9964761528121866),
  pedestal: { plinthW: 1.75, plinthD: 1.6, plinthH: 0.22, shaftW: 1.3, shaftD: 1.15, shaftH: 1.18, capW: 1.42, capD: 1.27, capH: 0.12 },
  bronzeBaseH: 0.08, figureHeight: 2.12,
};

type Part = { g: THREE.BufferGeometry; m: 'bronze' | 'stone' | 'deck' };

/** Smooth-shaded sculpture part: weld seams, compute smooth normals on the indexed part, then expand.
 * Normals are carried through every later transform/merge and never recomputed (no flat faceting). */
function smooth(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const n of Object.keys(g.attributes)) if (n !== 'position') g.deleteAttribute(n);
  const w = mergeVertices(g, 1e-5); if (w !== g) g.dispose();
  w.computeVertexNormals();
  const out = w.toNonIndexed(); w.dispose();
  out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(out.getAttribute('position').count * 2), 2));
  return out;
}
type Ring = { y: number; cx?: number; cz?: number; rx: number; rz: number };
/** Lofted body section stack around the vertical (phi from local +z toward +x). Optional open front (phi range)
 * and end caps. Winding: d(phi) x d(y) = outward, so normals face out. */
function loft(rings: Ring[], seg: number, phi0 = 0, phi1 = Math.PI * 2, caps = true): THREE.BufferGeometry {
  const closed = phi1 - phi0 >= Math.PI * 2 - 1e-6, cols = closed ? seg : seg + 1, pos: number[] = [], idx: number[] = [];
  for (const r of rings) for (let j = 0; j < cols; j++) { const f = phi0 + (phi1 - phi0) * j / seg; pos.push((r.cx ?? 0) + Math.sin(f) * r.rx, r.y, (r.cz ?? 0) + Math.cos(f) * r.rz); }
  const v = (i: number, j: number) => i * cols + (closed ? j % seg : j);
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < seg; j++) idx.push(v(i, j), v(i, j + 1), v(i + 1, j), v(i, j + 1), v(i + 1, j + 1), v(i + 1, j));
  if (caps && closed) {
    const b = pos.length / 3, t = b + 1, r0 = rings[0], r1 = rings[rings.length - 1];
    pos.push(r0.cx ?? 0, r0.y, r0.cz ?? 0, r1.cx ?? 0, r1.y, r1.cz ?? 0);
    for (let j = 0; j < seg; j++) { idx.push(b, v(0, j + 1), v(0, j)); idx.push(t, v(rings.length - 1, j), v(rings.length - 1, j + 1)); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
}
/** Tube along a polyline with per-point radius (limbs, queue, hair rolls); capped, outward winding. */
function tube(path: THREE.Vector3[], radii: number[], seg = 12): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  for (let k = 0; k < path.length; k++) {
    const T = (k === 0 ? path[1].clone().sub(path[0]) : k === path.length - 1 ? path[k].clone().sub(path[k - 1]) : path[k + 1].clone().sub(path[k - 1])).normalize();
    const ref = Math.abs(T.z) > .9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const N = new THREE.Vector3().crossVectors(ref, T).normalize(), B = new THREE.Vector3().crossVectors(T, N);
    for (let j = 0; j < seg; j++) { const a = j / seg * Math.PI * 2; pos.push(...path[k].clone().addScaledVector(N, Math.cos(a) * radii[k]).addScaledVector(B, Math.sin(a) * radii[k]).toArray()); }
  }
  const v = (k: number, j: number) => k * seg + (j % seg), n = path.length;
  for (let k = 0; k < n - 1; k++) for (let j = 0; j < seg; j++) idx.push(v(k, j), v(k, j + 1), v(k + 1, j), v(k, j + 1), v(k + 1, j + 1), v(k + 1, j));
  const b = pos.length / 3; pos.push(...path[0].toArray(), ...path[n - 1].toArray());
  for (let j = 0; j < seg; j++) { idx.push(b, v(0, j + 1), v(0, j)); idx.push(b + 1, v(n - 1, j), v(n - 1, j + 1)); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** Sculpted head (local: centre at origin, facing +z): skull, jaw/chin, brow, eye sockets, nose, ears. */
function head(): THREE.BufferGeometry[] {
  const g = new THREE.SphereGeometry(.1, 32, 24), p = g.getAttribute('position');
  const gauss = (a: number, b: number) => Math.exp(-(a * a + b * b));
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i); let x = p.getX(i), z = p.getZ(i);
    const front = Math.max(0, z / .1);
    const jaw = THREE.MathUtils.clamp((-y - .015) / .085, 0, 1);
    x *= .84 * (1 - .28 * jaw); z *= 1 - .12 * jaw * (1 - front);
    z += .012 * jaw * front;                                                     // chin forward
    z += front * (.026 * gauss(x / .016, (y + .012) / .03)                        // nose
      + .009 * gauss(x / .06, (y - .036) / .012)                                  // brow ridge
      - .009 * gauss((Math.abs(x) - .031) / .014, (y - .016) / .011)              // eye sockets
      + .008 * gauss(x / .022, (y + .072) / .018)                                 // chin
      - .004 * gauss(x / .03, (y + .045) / .006));                                // mouth line
    p.setXYZ(i, x, y * 1.12, z);
  }
  const parts = [smooth(g)];
  for (const s of [-1, 1]) parts.push(smooth(new THREE.SphereGeometry(.026, 12, 10).scale(.38, 1, .72).translate(s * .081, 0, -.004)));  // ears
  return parts;
}
/** Hair: a cap over crown and back with the hairline swept back from the forehead, side rolls over the ears
 * and the tied queue with its ribbon (UT News front/back photographs). */
function hair(): THREE.BufferGeometry[] {
  const g = new THREE.SphereGeometry(.106, 28, 20), p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // forehead/face: tuck below the skin (hidden) so the hairline sweeps back from the brow over the temples
    const face = z > .028 - .2 * Math.max(0, y - .03) && y < .085;
    const k = face ? .86 : 1 + .05 * Math.max(0, -z / .106) * Math.max(0, 1 - Math.abs(y) / .1);
    p.setXYZ(i, x * .9 * k, (y * 1.1 + .006) * (face ? .97 : 1), z * k - .004);
  }
  const parts = [smooth(g)];
  for (const s of [-1, 1]) for (const [dy, r] of [[.012, .017], [-.016, .015]] as const)
    parts.push(smooth(tube([V(s * .086, dy, .02), V(s * .092, dy - .002, -.02), V(s * .084, dy - .004, -.058)], [r * .8, r, r * .85], 12)));
  parts.push(smooth(tube([V(0, -.02, -.098), V(0, -.06, -.112), V(0, -.105, -.118), V(0, -.135, -.114)], [.02, .019, .016, .011], 12)));
  for (const s of [-1, 1]) parts.push(smooth(new THREE.SphereGeometry(.018, 12, 8).scale(1.3, .7, .45).translate(s * .02, -.045, -.115)));  // ribbon bow
  return parts;
}
/** Figure in a unit frame: feet at y 0, facing +z, his right hand toward -x; height ~1.77 before scaling. */
function figure(): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, x = 0, y = 0, z = 0, ry = 0) => { g.rotateY(ry); g.translate(x, y, z); parts.push(g); };
  // Legs: tall riding boots with turned cuffs below the knee, close breeches above (weight on his right leg).
  for (const s of [-1, 1]) {
    const x = s * .092, k = s < 0 ? 0 : .012;
    add(smooth(tube([V(x, .05, .0), V(x * 1.02, .2, -.005), V(x * 1.02, .36, .0), V(x * 1.03, .5, .006), V(x * 1.03, .53, .006)], [.052, .062, .066, .072, .074], 14)));
    add(smooth(tube([V(x * 1.03, .52, .004), V(x * 1.02, .62, .01 + k), V(s * .088, .76, .006), V(s * .09, .92, -.005)], [.064, .068, .082, .094], 14)));
    add(smooth(tube([V(x, .035, -.05), V(x, .04, .05), V(x * 1.03, .03, .135)], [.042, .045, .03], 12).scale(1, .75, 1)));   // foot
  }
  // Torso: hips, waist, chest, sloped shoulders and neck base, with a slightly forward chest.
  add(smooth(loft([
    { y: .86, rx: .19, rz: .13 }, { y: .95, rx: .175, rz: .122, cz: .004 }, { y: 1.05, rx: .178, rz: .128, cz: .008 },
    { y: 1.17, rx: .195, rz: .138, cz: .014 }, { y: 1.27, rx: .21, rz: .138, cz: .012 }, { y: 1.34, rx: .215, rz: .128, cz: .004 },
    { y: 1.39, rx: .19, rz: .112 }, { y: 1.43, rx: .12, rz: .09 }, { y: 1.455, rx: .068, rz: .066, cz: .004 }], 28)));
  // Coat skirts: open at the front, flaring to just below mid-thigh; turned-back front edges.
  add(smooth(loft([{ y: .5, rx: .262, rz: .21, cz: -.012 }, { y: .62, rx: .245, rz: .195, cz: -.008 }, { y: .76, rx: .222, rz: .17, cz: -.004 }, { y: .9, rx: .2, rz: .142 }], 28, Math.PI * .14, Math.PI * 1.86, false)));
  for (const s of [-1, 1]) add(smooth(tube([V(s * .05, 1.38, .13), V(s * .085, 1.12, .145), V(s * .09, .9, .138), V(s * .12, .55, .2)], [.014, .016, .016, .014], 8)));  // coat front edges
  // Waistcoat buttons (double row, UT front photograph).
  for (let i = 0; i < 7; i++) for (const s of [-1, 1]) add(smooth(new THREE.SphereGeometry(.0105, 8, 6)), s * .028, .96 + i * .058, .14 + .006 * Math.sin(i / 6 * Math.PI));
  // High standing collar (open at the front) with the stock/cravat, and the cloak clasp.
  add(smooth(loft([{ y: 1.43, rx: .078, rz: .072 }, { y: 1.47, rx: .072, rz: .068 }, { y: 1.51, rx: .066, rz: .064 }], 20, Math.PI * .18, Math.PI * 1.82, false)));
  add(smooth(tube([V(0, 1.475, .02), V(0, 1.53, .0)], [.05, .046], 14)));                    // neck
  add(smooth(new THREE.SphereGeometry(.03, 12, 8).scale(1.3, .9, .7)), 0, 1.44, .06);           // stock
  add(smooth(new THREE.SphereGeometry(.016, 10, 8)), 0, 1.39, .118);                           // clasp
  // Cloak: mantle over both shoulders (meeting at the clasp) and a long back drape to near the ankles,
  // fuller on his right where it gathers (Daderot photograph); cut away at the front.
  add(smooth(loft([{ y: 1.28, rx: .265, rz: .185, cz: -.01 }, { y: 1.36, rx: .245, rz: .16, cz: -.005 }, { y: 1.42, rx: .18, rz: .13 }, { y: 1.46, rx: .1, rz: .095 }], 28, Math.PI * .1, Math.PI * 1.9, false)));
  add(smooth(loft([{ y: .14, rx: .37, rz: .25, cx: -.03, cz: -.04 }, { y: .5, rx: .34, rz: .235, cx: -.02, cz: -.035 }, { y: .9, rx: .3, rz: .21, cx: -.01, cz: -.03 },
    { y: 1.15, rx: .275, rz: .19, cz: -.02 }, { y: 1.3, rx: .262, rz: .175, cz: -.012 }], 28, Math.PI * .42, Math.PI * 1.62, false)));
  add(smooth(loft([{ y: .2, rx: .1, rz: .11 }, { y: .6, rx: .085, rz: .1 }, { y: .95, rx: .07, rz: .085 }, { y: 1.25, rx: .045, rz: .06 }], 14, Math.PI, Math.PI * 2, false)), -.26, 0, .0);  // gathered fold at his right
  // Arms lowered close to the body: sleeve with coat cuff, hands. Right hand (−x) holds the hat at the thigh;
  // the left rests on the top of a thin staff.
  for (const s of [-1, 1]) {
    const sh = V(s * .215, 1.36, .0), el = V(s * .252, 1.1, .022), wr = V(s * .262, .885, .07);
    add(smooth(tube([sh, V(s * .235, 1.24, .008), el, V(s * .26, .99, .045), wr], [.068, .064, .058, .054, .05], 14)));
    add(smooth(tube([V(s * .26, .93, .06), wr, V(s * .263, .86, .075)], [.054, .062, .063], 14)));         // turned-back cuff
    add(smooth(new THREE.SphereGeometry(.042, 14, 10).scale(.78, 1.3, .95)), s * .265, .815, .08);          // hand
  }
  // Tricorn hat held by the brim at his right thigh: a cocked three-cornered brim and low crown, tilted.
  {
    const brim = smooth(loft([{ y: -.022, rx: .2, rz: .17 }, { y: .0, rx: .205, rz: .175 }, { y: .022, rx: .19, rz: .16 }], 3, Math.PI / 6, Math.PI / 6 + Math.PI * 2));
    const crown = smooth(loft([{ y: .0, rx: .11, rz: .1 }, { y: .07, rx: .105, rz: .095 }, { y: .1, rx: .07, rz: .065 }], 18));
    for (const g of [brim, crown]) { g.rotateX(Math.PI / 2); g.rotateZ(.35); g.translate(-.312, .76, .1); parts.push(g); }
  }
  add(smooth(tube([V(.285, 0, .115), V(.282, .42, .1), V(.278, .8, .085)], [.012, .013, .014], 10)));       // staff (cane or sword: unresolved)
  // Head on the neck, turned slightly (UT front photograph).
  for (const g of [...head(), ...hair()]) add(g, 0, 1.635, .012, .18);
  return parts;
}

export interface WashingtonBuild {
  solids: THREE.Mesh[]; walkable: THREE.Mesh[]; detail: THREE.Mesh[]; colliders: RAPIER.Collider[]; geometries: THREE.BufferGeometry[];
  stats: Record<string, unknown>;
}

/** Deck, pedestal and figure. `deckY` is the support level (LiDAR deck 15.1); `groundAt` gives the
 * visible ground under the deck footprint so the deck sides reach below it. */
export function buildWashington(physics: RAPIER.World, materials: { bronze: THREE.Material; stone: THREE.Material; deck: THREE.Material },
  groundAt: (x: number, z: number) => number,
  /** Level of the surrounding South Mall apron (central-malls 'south-mall-walk': contour + 0.08) and its finish. */
  apron?: { height: (x: number, z: number) => number; material: THREE.Material }): WashingtonBuild {
  const W = WASHINGTON, P = W.pedestal, [cx, cz] = W.position;
  const parts: Part[] = [];
  const rot = new THREE.Matrix4().makeRotationY(W.yaw);
  const placeLocal = (g: THREE.BufferGeometry, x: number, y: number, z: number) => { g.translate(x, y, z); g.applyMatrix4(rot); g.translate(cx, 0, cz); return g; };
  // Raised deck (world-aligned rectangle from the LiDAR), with a 0.3 m coping on the east, west and south edges
  // and two 0.25 m steps along its north edge (towards the drive and sidewalk).
  const d = W.deck, deckY = W.lidarDeckY;
  const lows = [[d.x0, d.z0], [d.x1, d.z0], [d.x1, d.z1], [d.x0, d.z1]].map(([x, z]) => groundAt(x, z));
  const bottom = Math.min(...lows) - .25;
  const boxW = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, m: Part['m']) =>
    parts.push({ g: new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).toNonIndexed(), m });
  boxW(d.x0, d.x1, d.z0 + .7, d.z1, bottom, deckY, 'deck');
  // Two equal risers from the apron level at the north edge up to the deck.
  const g0 = apron ? Math.max(apron.height(d.x0, d.z0), apron.height(d.x1, d.z0), apron.height((d.x0 + d.x1) / 2, d.z0)) : deckY - .5;
  boxW(d.x0, d.x1, d.z0, d.z0 + .35, bottom, g0 + (deckY - g0) / 3, 'deck');        // lower step
  boxW(d.x0, d.x1, d.z0 + .35, d.z0 + .7, bottom, g0 + 2 * (deckY - g0) / 3, 'deck'); // upper step
  // Coping: one closed U-shaped solid (east, south, west edges) so no internal faces.
  const k = .35, u = new THREE.Shape([[d.x0, d.z0 + .7], [d.x0 + k, d.z0 + .7], [d.x0 + k, d.z1 - k], [d.x1 - k, d.z1 - k], [d.x1 - k, d.z0 + .7], [d.x1, d.z0 + .7], [d.x1, d.z1], [d.x0, d.z1]]
    .map(([x, z]) => new THREE.Vector2(x, -z)));
  parts.push({ g: new THREE.ExtrudeGeometry(u, { depth: .3, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, deckY, 0).toNonIndexed(), m: 'stone' });
  // Pedestal (pale limestone) as ONE stepped closed solid: plinth step, shaft, cap, bronze-base seat.
  const steps: [number, number, number][] = [[P.plinthW, P.plinthD, P.plinthH], [P.shaftW, P.shaftD, P.shaftH], [P.capW, P.capD, P.capH]];
  const ref = P.plinthW / 2, prof: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
  let y = deckY, h0 = 0;
  for (const [w, , h] of steps) { prof.push(new THREE.Vector2(w / 2 * Math.SQRT2, h0), new THREE.Vector2(w / 2 * Math.SQRT2, h0 + h)); h0 += h; }
  // Open seat under the bronze base (the base box closes it), so no pedestal top lies under the figure.
  prof.push(new THREE.Vector2(.46 * Math.SQRT2, h0));
  // A 4-segment lathe is a square in plan; per-step depth is set by a z-scale (all steps share one ratio).
  const ped = new THREE.LatheGeometry(prof, 4, Math.PI / 4).scale(1, 1, P.shaftD / P.shaftW);
  parts.push({ g: placeLocal(ped.toNonIndexed(), 0, y, 0), m: 'stone' }); y += h0; void ref;
  parts.push({ g: placeLocal(new THREE.BoxGeometry(.93, W.bronzeBaseH + .02, .84).toNonIndexed(), 0, y + (W.bronzeBaseH - .02) / 2, 0), m: 'bronze' }); y += W.bronzeBaseH;
  const pedestalTop = y;
  const fig = figure(), s = W.figureHeight / 1.77;
  for (const g of fig) { g.scale(s, s, s); parts.push({ g: placeLocal(g, 0, pedestalTop, 0), m: 'bronze' }); }
  // One mesh (and one trimesh collider from the same triangles) per material.
  const solids: THREE.Mesh[] = [], walkable: THREE.Mesh[] = [], detail: THREE.Mesh[] = [], colliders: RAPIER.Collider[] = [], geometries: THREE.BufferGeometry[] = [];
  for (const key of ['deck', 'stone', 'bronze'] as const) {
    const list = parts.filter(p => p.m === key).map(p => { for (const n of Object.keys(p.g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) p.g.deleteAttribute(n); if (!p.g.attributes.uv) p.g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(p.g.attributes.position.count * 2), 2)); return p.g; });
    const g = mergeGeometries(list); if (!g) throw new Error(`Washington ${key} merge failed`);
    for (const p of list) p.dispose();
    if (key !== 'bronze') { g.computeVertexNormals(); metreBoxUV(g); } // flat stone/deck faces (metre UVs for the textured limestone); bronze keeps each part's smooth normals
    g.computeBoundingBox(); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, materials[key]); mesh.name = `b04 George Washington (Coppini 1955) ${key === 'bronze' ? 'bronze figure' : key === 'stone' ? 'limestone pedestal and coping' : 'raised deck and steps'}`;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.block = 'b04-tower'; mesh.userData.b04 = 'WASHINGTON';
    (key === 'deck' ? walkable : key === 'bronze' ? detail : solids).push(mesh); geometries.push(g);
    const pos = g.getAttribute('position').array as Float32Array, idx = new Uint32Array(pos.length / 3).map((_, i) => i);
    colliders.push(physics.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(pos), idx).setFriction(.9)));
  }
  if (apron) {
    const R = .5, pts: number[] = [];
    const quad = (ax: number, az: number, bx: number, bz: number, cx2: number, cz2: number, dx: number, dz: number) => {
      // subdivided along its length (<= 1 m) so the strip follows the contour like the apron edge
      const n = Math.max(1, Math.ceil(Math.max(Math.hypot(bx - ax, bz - az), Math.hypot(cx2 - dx, cz2 - dz))));
      for (let i = 0; i < n; i++) {
        const l = (t: number, p: number, q: number) => p + (q - p) * t, t0 = i / n, t1 = (i + 1) / n;
        const P = [[l(t0, ax, bx), l(t0, az, bz)], [l(t1, ax, bx), l(t1, az, bz)], [l(t1, dx, cx2), l(t1, dz, cz2)], [l(t0, dx, cx2), l(t0, dz, cz2)]];
        for (const k of [0, 2, 1, 0, 3, 2]) pts.push(P[k][0], apron.height(P[k][0], P[k][1]), P[k][1]);
      }
    };
    // inner corners (deck) i*, outer corners (deck + R) o*; north, east, south, west strips
    quad(d.x0 - R, d.z0 - R, d.x1 + R, d.z0 - R, d.x1, d.z0, d.x0, d.z0);
    quad(d.x1 + R, d.z0 - R, d.x1 + R, d.z1 + R, d.x1, d.z1, d.x1, d.z0);
    quad(d.x1 + R, d.z1 + R, d.x0 - R, d.z1 + R, d.x0, d.z1, d.x1, d.z1);
    quad(d.x0 - R, d.z1 + R, d.x0 - R, d.z0 - R, d.x0, d.z0, d.x0, d.z1);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pts.length / 3 * 2), 2));
    g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    // keep every triangle facing up
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i += 3) { const a = new THREE.Vector3().fromBufferAttribute(pos, i), b = new THREE.Vector3().fromBufferAttribute(pos, i + 1), c = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
      if (b.clone().sub(a).cross(c.clone().sub(a)).y < 0) { pos.setXYZ(i + 1, c.x, c.y, c.z); pos.setXYZ(i + 2, b.x, b.y, b.z); } }
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, apron.material); mesh.name = 'b04 George Washington deck surround paving'; mesh.receiveShadow = true; mesh.userData.block = 'b04-tower';
    walkable.push(mesh); geometries.push(g);
    colliders.push(physics.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(pos.array as Float32Array), new Uint32Array(pos.count).map((_, i) => i)).setFriction(.9)));
  }
  const tri = geometries.reduce((n, g) => n + g.getAttribute('position').count / 3, 0);
  return { solids, walkable, detail, colliders, geometries,
    stats: { name: 'George Washington (Coppini 1955)', position: W.position, yawRad: +W.yaw.toFixed(4), deckY, pedestalTop: +pedestalTop.toFixed(2), top: +(pedestalTop + W.figureHeight).toFixed(2), lidarPeakY: W.lidarPeakY, triangles: tri, colliders: colliders.length, dimensions: 'estimated', figure: 'detail mesh with its own trimesh collider from the same triangles (overlapping sculpted parts have internal faces)' } };
}
