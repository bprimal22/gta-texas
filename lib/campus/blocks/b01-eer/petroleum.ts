// b01-eer district D01: Chemical & Petroleum Engineering (CPE, City 732885:1230) and Engineering Teaching Center II
// (ETC, City 506548:211) rebuilt as authored bodies from their OWN measured massing in context.json (same rings, same
// LiDAR roof tiers, campus-Y datum), with reference-interpreted facades. Replaces both records (context.json
// `replaces`); if this install fails the generated massing stays as the fallback.
//
// Evidence (research references only; no pixels ship; the warped photographic tiles guide FORM, never dimensions):
//  * 2017 USGS 3DEP LiDAR DSM/DTM, sampled in the GIS rings (.work/claude-district40/d01_lidar.py → d01_lidar.out):
//    CPE roof P50 25.49, rim 26.5–27 (parapet), plant tiers 29.4 / 30.2 (already the massing tiers); ground 6.2–6.3
//    (south-face areaway dips to 1.5–4); ETC roof 40.9, upper tier 45.2, SE wing 6–8; west plaza ground 6.36, other
//    sides 1.3–4.2.
//  * district-orbits-30m d01-orbit-southwest / -northwest (clean), -southeast (line artefact), -northeast (cooling tower
//    hides the lower floors): CPE = tan brick, a ground storey, three rows of small near-square punched windows with
//    pale splayed sills in clusters per bay, a tall attic band of shallow blind panels, a full-height dark glazed notch
//    face at each end bump, pale ducts down the west bump; full-map-30m priority-03 + ut-etc-471-directory-photo /
//    -engineering-5 / -engineering-6: ETC = buff brick tower, deep recessed ribbon bands per bay with splayed light
//    sills, round dark columns in the bands, continuous brick piers, upper penthouse.
//  * ut-cpe-466-directory-photo: CPE long low street face behind trees (Dean Keeton side).
// Measured: rings, roof / tier / parapet heights, ground datums. Interpreted (photos, straightened onto the GIS edges):
// floor split, window sizes / counts / clusters, attic panels, stair notch glazing, ETC band widths, column pitch, duct
// runs. Estimated: ground-storey openings (hidden by trees), entrances (not modelled), materials / colours.
// Nothing projects outward from the GIS / massing rings except visual-only ducts > 9 m above grade.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { BlockInstallContext } from '../types';
import type { Point } from '../../types';
import context from './context.json';
import { Kit, C, edgesOf, at, hash, orient, insetRing, opening, tube, type Face, type Mat, type Edge } from './petroleum-kit';

export const PETROLEUM_KEYS = { cpe: '732885:1230', etc: '506548:211' } as const;
type Vol = { ring?: Point[]; bottom: number; top: number; roof: string; role?: string };
const massing = (context as unknown as { massing: Record<string, { volumes: Vol[] }> }).massing;

// Measured datums (LiDAR DTM around the rings; campus Y).
const CPE_FLOOR0 = 6.25, ETC_FLOOR0 = 6.4;
const CPE_PARAPET = 1.2, ETC_PARAPET = 0.8; // rim 26.5–27 over the 25.5 deck (CPE); ~0.8 over 40.7 (ETC)
// Interpreted floor splits (photos: CPE ground storey + 3 window rows + attic; ETC nine storeys over the plaza level).
const CPE_GROUND = 4.0, CPE_FLOOR = 3.9, ETC_FLOOR = 3.8;

const BRICK_CPE = C('#b39a78'), BRICK_ETC = C('#b8a07c'), REVEAL = C('#a88f6c'), SILL = C('#d8cdb7');
const GLASS = C('#2d363b'), GLASS_LIT = C('#3d4448'), BLIND = C('#a58c69'), ROOF = C('#8f8c86'), PLANT = C('#a9b0b3');
const PLANT_ROOF = C('#9aa1a4'), LOUVRE = C('#6d7477'), DUCT = C('#9fb0bc'), COLUMN = C('#2a2b2c');

export interface PetroleumResult { solids: THREE.Mesh[]; detail: THREE.Mesh[]; colliders: RAPIER.Collider[]; geometries: THREE.BufferGeometry[]; materials: THREE.Material[]; stats: Record<string, unknown>; replaced: string[] }

/** Lowest / highest ground 1 m outside an edge (sampled every 2 m). */
function groundAlong(e: Edge, g: (x: number, z: number) => number) {
  let lo = Infinity, hi = -Infinity;
  for (let s = 0.5; s < e.L; s += 2) { const p = at(e, s, 0, 1); const y = g(p.x, p.z); lo = Math.min(lo, y); hi = Math.max(hi, y); }
  return { lo, hi };
}

/** Walls of one volume ring with parapet, roof deck and inner parapet faces. Returns the Faces per edge. */
function body(k: Kit, ring: Point[], bottomOf: (e: Edge) => number, roofY: number, parapet: number, wall: THREE.Color) {
  const r = orient(ring), faces = new Map<Edge, Face>(), top = roofY + parapet, inner = insetRing(r, 0.3);
  for (const e of edgesOf(r)) faces.set(e, k.face(e, bottomOf(e), top, wall));
  k.cap(k.S(), [inner], roofY, ROOF);
  k.cap(k.S(), [r, inner.slice().reverse()], top, wall);
  for (let i = 0; i < inner.length; i++) { const a = inner[i], c = inner[(i + 1) % inner.length]; k.wall(k.S(), c, a, roofY, top, wall); }
  return faces;
}

/** Rooftop plant enclosure on a measured tier ring: pale metal walls with louvre bands, flat top. */
function plant(k: Kit, ring: Point[], fromY: number, topY: number, color = PLANT) {
  const r = orient(ring);
  for (const e of edgesOf(r)) {
    k.wall(k.S('metal'), e.a, e.c, fromY, topY, color);
    if (e.L > 1.5) for (let y = fromY + 0.5; y < topY - 0.3; y += 0.45) k.panel(k.D('metal'), e, 0.2, e.L - 0.2, y, y + 0.1, 0.02, LOUVRE);
  }
  k.cap(k.S('metal'), [r], topY, PLANT_ROOF);
}

function buildCPE(k: Kit, recordRing: Point[], g: (x: number, z: number) => number, st: Record<string, unknown>) {
  const m = massing['732885'].volumes;
  const roofY = m[0].top;
  // v0 (main) has no ring in the massing: it is the record's own (City 2023) outer ring, passed in from ctx.data.
  const faces = body(k, m[0].ring ?? recordRing, e => Math.min(groundAlong(e, g).lo, CPE_FLOOR0) - 0.6, roofY, CPE_PARAPET, BRICK_CPE);
  let punched = 0, blind = 0, notchGlass = 0;
  const rowsY = [1, 2, 3].map(f => CPE_FLOOR0 + CPE_GROUND + (f - 1) * CPE_FLOOR + 1.1); // window sills
  const atticY0 = CPE_FLOOR0 + CPE_GROUND + 3 * CPE_FLOOR + 0.9, atticY1 = roofY - 0.3;
  for (const [e, f] of faces) {
    const L = e.L;
    if (L < 5) { // end-bump notch faces: full-height dark glazing (orbits SW / NW "slot")
      if (opening(k, f, 0.3, L - 0.3, CPE_FLOOR0 + 0.4, roofY - 0.6, 0.5, GLASS, REVEAL, SILL)) notchGlass++;
      continue;
    }
    const long = L > 40, nb = Math.max(1, Math.round(L / (long ? 7.8 : 4.6))), pitch = L / nb;
    const per = long ? 5 : 3, w = long ? 0.75 : 0.62, h = long ? 1.15 : 1.0, step = long ? 1.2 : 0.95;
    for (let b = 0; b < nb; b++) {
      const c = (b + 0.5) * pitch;
      // three upper rows of small punched windows in a centred cluster; the cluster shifts by one module on alternate
      // bays as in the south-west orbit (interpreted rhythm, not counted window by window)
      const shift = long && b % 2 ? step * 0.5 : 0;
      for (const y0 of rowsY) for (let j = 0; j < per; j++) {
        const x = c + shift + (j - (per - 1) / 2) * step;
        if (opening(k, f, x - w / 2, x + w / 2, y0, y0 + h, 0.35, hash(e.i, b, j) > 0.7 ? GLASS_LIT : GLASS, REVEAL, SILL)) punched++;
      }
      // ground storey (hidden by trees in every reference): two larger openings per bay, ESTIMATE
      if (long) for (const dx of [-1.3, 1.3]) if (opening(k, f, c + dx - 0.75, c + dx + 0.75, CPE_FLOOR0 + 1.0, CPE_FLOOR0 + 3.0, 0.4, GLASS, REVEAL, SILL)) punched++;
      // attic band: one shallow blind panel per bay (SW / NW orbits)
      if (long && pitch > 3.5 && opening(k, f, c - pitch / 2 + 1.2, c + pitch / 2 - 1.2, atticY0, atticY1 - 0.4, 0.15, BLIND, REVEAL, REVEAL, 'matte')) blind++;
    }
  }
  // plant enclosures on the measured tiers (v1 west 29.4, v2 east 30.2)
  for (const v of m.slice(1)) if (v.ring) plant(k, v.ring, roofY, v.top);
  // ducts (visual): two pale runs down the west bump near its north end (orbit NW) and one long roof run between the
  // plant tiers; all > 9 m above grade and within 0.7 m of the wall, never over a walk.
  // west end bump: the ~14.7 m edge whose midpoint lies west of x 59.5 between the two notches (z -473.4 .. -458.7)
  const bump = [...faces.keys()].find(e => { const mx = (e.a[0] + e.c[0]) / 2, mz = (e.a[1] + e.c[1]) / 2; return mx < 59.5 && mz < -458 && mz > -474 && e.L > 10; });
  const D = k.D('metal');
  if (bump) for (const s of [1.4, 2.6]) tube(D, at(bump, s, CPE_FLOOR0 + 9.5, 0.55), at(bump, s, roofY + 0.9, 0.55), 0.42, DUCT);
  tube(D, new THREE.Vector3(84.8, roofY + 0.9, -451.5), new THREE.Vector3(101.2, roofY + 0.9, -451.5), 0.5, DUCT);
  st.cpe = { roofY, parapetY: roofY + CPE_PARAPET, punched, attic: blind, notchGlazing: notchGlass, plantTiers: m.length - 1 };
}

function buildETC(k: Kit, g: (x: number, z: number) => number, st: Record<string, unknown>) {
  const m = massing['506548'].volumes, [main, wing, tier] = m;
  const faces = body(k, main.ring!, e => Math.min(groundAlong(e, g).lo, ETC_FLOOR0) - 0.6, main.top, ETC_PARAPET, BRICK_ETC);
  let bands = 0, cols = 0;
  const Dm = k.D('metal');
  for (const [e, f] of faces) {
    if (e.L < 6) continue;
    const { lo } = groundAlong(e, g);
    const nb = Math.max(1, Math.round((e.L - 3.6) / 12.1)), pitch = e.L / nb, bw = Math.min(9, pitch - 3.4);
    for (let fl = -1; fl < 9; fl++) {
      const fy = ETC_FLOOR0 + fl * ETC_FLOOR;
      if (fy < lo - 0.2) continue; // lower level only where that face's grade exposes it
      const groundish = fy < lo + 2.5, y0 = fy + (groundish ? 0.5 : 1.0), y1 = fy + (groundish ? 3.1 : 2.5), depth = groundish ? 0.6 : 0.55;
      if (y1 > main.top - 0.4) continue;
      for (let b = 0; b < nb; b++) {
        const c = (b + 0.5) * pitch, cp0 = at(e, c, 0, 1), localG = g(cp0.x, cp0.z);
        if (y0 < localG + 0.3) continue; // that bay's grade (e.g. the Y6.36 west plaza) buries this storey here
        if (!opening(k, f, c - bw / 2, c + bw / 2, y0, y1, depth, hash(e.i, fl, b) > 0.75 ? GLASS_LIT : GLASS, REVEAL, SILL)) continue;
        bands++;
        // round dark columns inside the recess (engineering-5 / -6): VISUAL only; the solid glass + reveals behind
        // them already close the recess (sills >= 0.5 m above grade), and solid columns would occlude the reveals.
        const cp = groundish ? 2.4 : 1.2;
        for (let x = c - bw / 2 + cp / 2; x < c + bw / 2 - 0.2; x += cp) {
          tube(Dm, at(e, x, y0, -depth / 2), at(e, x, y1, -depth / 2), groundish ? 0.18 : 0.11, COLUMN); cols++;
        }
      }
    }
  }
  // SE low wing (measured 6.5) and the upper penthouse tier (measured 45.1)
  if (wing?.ring) { const wf = body(k, wing.ring, e => groundAlong(e, g).lo - 0.6, wing.top, 0.4, BRICK_ETC); for (const [e] of wf) if (e.L > 2) k.panel(k.D('metal'), e, 0.4, e.L - 0.4, wing.top - 1.6, wing.top - 0.4, 0.02, LOUVRE); }
  if (tier?.ring) {
    const tf = body(k, tier.ring, () => main.top - 0.05, tier.top, 0.4, BRICK_ETC);
    for (const [e] of tf) if (e.L > 3) for (let y = main.top + 0.8; y < tier.top - 0.8; y += 0.5) k.panel(Dm, e, 0.6, e.L - 0.6, y, y + 0.12, 0.02, LOUVRE);
  }
  st.etc = { roofY: main.top, tierY: tier?.top, wingY: wing?.top, bands, columns: cols };
}

export function buildPetroleum(ctx: BlockInstallContext): PetroleumResult {
  const began = performance.now(), k = new Kit(), stats: Record<string, unknown> = {};
  const g = ctx.groundHeight;
  const rec = ctx.data.buildings.find(b => (b as { key?: string }).key === PETROLEUM_KEYS.cpe);
  if (!rec) throw new Error('CPE record ' + PETROLEUM_KEYS.cpe + ' missing');
  const ring = rec.rings[0].slice() as Point[];
  if (ring.length > 3 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
  buildCPE(k, ring, g, stats);
  buildETC(k, g, stats);
  k.flushFaces();
  const materials = new Map<Mat, THREE.MeshStandardMaterial>(), geometries: THREE.BufferGeometry[] = [], colliders: RAPIER.Collider[] = [];
  const P: Record<Mat, [number, number]> = { matte: [0.9, 0], glass: [0.12, 0.1], metal: [0.5, 0.45], paving: [0.9, 0] };
  const mat = (m: Mat) => {
    let x = materials.get(m);
    if (!x) {
      x = new THREE.MeshStandardMaterial({ roughness: P[m][0], metalness: P[m][1], vertexColors: true });
      x.name = `b01 petroleum ${m} (vertex colours)`;
      if (m === 'matte') { // fine running-bond brick on vertical faces, fading where sub-pixel (no textures)
        x.onBeforeCompile = shader => {
          shader.vertexShader = 'varying vec3 d01P;\nvarying vec3 d01N;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nd01P = position;\nd01N = normal;');
          shader.fragmentShader = 'varying vec3 d01P;\nvarying vec3 d01N;\n' + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
            vec3 bn = normalize(d01N);
            if (abs(bn.y) < .5) {
              float v = d01P.y / .0677, row = floor(v);
              float u = (abs(bn.x) > abs(bn.z) ? d01P.z : d01P.x) / .2032 + .5 * mod(row, 2.);
              vec2 f = fract(vec2(u, v)), w = fwidth(vec2(u, v));
              float joint = max(1. - smoothstep(.023, .023 + w.x, min(f.x, 1. - f.x)), 1. - smoothstep(.07, .07 + w.y, min(f.y, 1. - f.y)));
              float fade = 1. - smoothstep(.12, .4, max(w.x, w.y));
              float id = fract(sin(dot(vec2(floor(u), row), vec2(12.9898, 78.233))) * 43758.5453);
              vec3 brick = diffuseColor.rgb * (.95 + .1 * id), mortar = diffuseColor.rgb * 1.07;
              diffuseColor.rgb = mix(diffuseColor.rgb, mix(brick, mortar, joint), fade);
            }`);
        };
        x.customProgramCacheKey = () => 'b01-petroleum-brick-v1';
      }
      materials.set(m, x);
    }
    return x;
  };
  const mesh = (m: Mat, b: { geometry(): THREE.BufferGeometry }, role: string) => {
    const geo = b.geometry(); geometries.push(geo);
    const o = new THREE.Mesh(geo, mat(m)); o.name = `b01 petroleum engineering CPE/ETC ${role} ${m}`;
    o.castShadow = role === 'solid'; o.receiveShadow = true; o.userData.block = 'b01-eer'; return o;
  };
  const solids = [...k.solid].filter(([, b]) => b.triangles).map(([m, b]) => mesh(m, b, 'solid'));
  const detail = [...k.detail].filter(([, b]) => b.triangles).map(([m, b]) => mesh(m, b, 'detail'));
  try {
    const pos = new Float32Array([...k.solid.values()].flatMap(b => b.pos));
    colliders.push(ctx.physics.createCollider(RAPIER.ColliderDesc.trimesh(pos, Uint32Array.from({ length: pos.length / 3 }, (_v, i) => i), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.8)));
  } catch (e) {
    for (const geo of geometries) geo.dispose(); for (const x of materials.values()) x.dispose();
    throw e;
  }
  const tris = (ms: THREE.Mesh[]) => ms.reduce((s, x) => s + x.geometry.getAttribute('position').count / 3, 0);
  Object.assign(stats, { solidTriangles: tris(solids), detailTriangles: tris(detail), draws: solids.length + detail.length, colliders: colliders.length, ms: +(performance.now() - began).toFixed(1) });
  return { solids, detail, colliders, geometries, materials: [...materials.values()], stats, replaced: [PETROLEUM_KEYS.cpe, PETROLEUM_KEYS.etc] };
}
export type { Edge };
