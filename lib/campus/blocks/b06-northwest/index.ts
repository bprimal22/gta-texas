// Block b06-northwest: Northwest: Communications, Littlefield, Biology, Dean Keeton west.
// Owner-only file (research/whole-campus-92/BLOCKS.md). Round 2 install() rebuilds four City records whose
// recognisable features the generator cannot express (research/whole-campus-92/b06-northwest/EVIDENCE.md):
//  * 504340:183 Jesse H. Jones Communication Center: CMB / CMA / HSM bodies (official UT GIS polygons, LiDAR roof P50),
//    the raised plaza between them (walkable deck at LiDAR 20.08 campus Y, parapets on open edges), the two bridges over
//    the service drive, the south stair (OSM steps 1512199816, DSM treads 19.9 -> 18.5), the CMB-CMA connector and the
//    Moody skybridge over W Dean Keeton to DMC (DSM strip 24.4-24.5 campus Y);
//  * 529270:331 University United Methodist Church: cross plan of gabled nave + transept (LiDAR ridges 30.0 / 29.8,
//    eaves 25.3 / 25.0), crossing dome cap (34.2), SE tower with low pyramidal cap (35.3 -> 37.5), flat annex 22.4;
//  * 463671:18 Littlefield Home: hipped main roof (LiDAR median 31.1, ridge 33.1), square tower (pyramid to 39.5) and
//    round corner turret (cone to 34.3);
//  * 487225:120 small flat structure on the church lot (rebuilt because the church annex would otherwise suppress it).
// District D12 (Honors Quad) adds Andrews + Blanton 549050:385, Carothers 551320:432 and Littlefield Residence Hall
// 654063:872 from honors-quad.ts, in their own kit / meshes / collider so the round-2 meshes above stay byte-identical.
// District D12 (engineering-core lane) adds Kinsolving 547842:357 from kinsolving.ts the same way ('b06 kin ' meshes).
// District D11 (engineering-core lane) corrects CMB's facade (buildCmb): charcoal ribbed metal box over a pale glazed base.
// New D11/D12 surfaces use textured offline context finishes (textured-finish.ts); round-2 / Honors materials are unchanged.
// Heights are absolute campus Y (bodies.json, derived/make_bodies.py). Facade rhythm, doors, materials: estimates.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Point } from '../../types';
import type { BlockInstall, BlockModule } from '../types';
import { Kit, orient, segDist, ringDist as ringDistIn } from './authored-bodies';
import bodies from './bodies.json' with { type: 'json' };
import { buildHonorsQuad, HONORS_MATERIALS, HONORS_REPLACED } from './honors-quad';
import { buildKinsolving, KIN_KEY, KIN_MATERIALS } from './kinsolving';
import { TexturedFinish, TEXTURED, HONORS_TEXTURED, metreUVs, slopeUVs } from './textured-finish';

const B = bodies as unknown as {
  comms: { plazaY: number; stair: { x0: number; x1: number; zTop: number; zFoot: number }; bridgeBottom: number;
    buildings: { name: string; ring: Point[]; deck: number }[]; deck: Point[][]; bridges: Point[][];
    skybridge: { ring: Point[]; bottom: number; top: number }; connector: { ring: Point[]; bottom: number; top: number } };
  church: { base: { ring: Point[]; deck: number }; nave: { ring: Point[]; eave: number; ridge: number }; transept: { ring: Point[]; eave: number; ridge: number };
    dome: { ring: Point[]; eave: number; apex: number }; tower: { ring: Point[]; eave: number; apex: number } };
  littlefield: { ring: Point[]; roofMedian: number; ridgeMax: number; slope: number; tower: { ring: Point[]; eave: number; apex: number }; turret: { ring: Point[]; eave: number; apex: number } };
  shed: { ring: Point[]; deck: number };
};
export const B06_BODIES = B;
export const REPLACED = ['504340:183', '529270:331', '463671:18', '487225:120', ...HONORS_REPLACED, KIN_KEY];
const PARAPET = 1.05;

/** Own materials (plain PBR colours; estimates of the real finishes, see EVIDENCE.md). */
const MATERIALS: Record<string, [string, number, number?]> = {
  precast: ['#cfc8ba', 0.9], podium: ['#bdb6a9', 0.92], pave: ['#c9c3b6', 0.95], membrane: ['#9d9a94', 0.95], glass: ['#2a333a', 0.3, 0.2],
  doorGlass: ['#1f272c', 0.25, 0.25], limestone: ['#d8cdb5', 0.88], tile: ['#a3533a', 0.8], brick: ['#8c4a3a', 0.9], sandstone: ['#a5614a', 0.9],
  slate: ['#4a5057', 0.7], louvre: ['#3b3a36', 0.8], ...HONORS_MATERIALS, ...KIN_MATERIALS,
  cmbMetal: ['#3e4145', 0.6, 0.35], cmbBase: ['#d6d1c4', 0.9], cmbReveal: ['#202326', 0.7, 0.2],
};

function ringMinGround(ring: Point[], g: (x: number, z: number) => number) { return Math.min(...ring.map(p => g(p[0], p[1]))); }
const onRings = (a: Point, c: Point, rings: Point[][], tol: number) => { const m: Point = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
  return rings.some(r => r.some((p, i) => segDist(m[0], m[1], p, r[(i + 1) % r.length]) < tol && segDist(a[0], a[1], p, r[(i + 1) % r.length]) < tol + 0.3 && segDist(c[0], c[1], p, r[(i + 1) % r.length]) < tol + 0.3)); };
const insideRing = (x: number, z: number, r: Point[]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };

/** D11 CMB (Jesse H. Jones Communication Center Bldg B) facade correction. Plan (official polygon) and roof (LiDAR P50 49.48,
 * 0.5 m parapet) are unchanged. REFERENCE-INTERPRETED from online-photos ut-cmb-654 / ut-hsm-653 / ut-lch-625 and district-orbits-30m
 * d11-orbit-southwest / -southeast: a closed charcoal box of vertically ribbed metal with one horizontal reveal, standing on a
 * pale base that is glazed at street and plaza level. Estimates: base top = plaza + 4.2 m (street + plaza storeys), rib pitch 0.9 m,
 * rib 0.18 x 0.12 m, reveal 0.45 m at 27 % of the box height, base glazing 3.0 x 3.0 m per 3.6 m bay. The roof mast / dish (LiDAR max
 * 60.85) is not localised in the evidence available to this lane and is not modelled. */
export const CMB_FACADE = { baseAbovePlaza: 4.2, ribPitch: 0.9, ribWidth: 0.18, ribDepth: 0.12, revealAt: 0.27, revealHeight: 0.45, parapet: 0.5 };
function buildCmb(k: Kit, ring: Point[], bottom: number, deck: number, g: (x: number, z: number) => number, stats: Record<string, unknown>) {
  const C = B.comms, Y = C.plazaY, F = CMB_FACADE, baseTop = Y + F.baseAbovePlaza, top = deck + F.parapet;
  const revealY = baseTop + F.revealAt * (deck - baseTop);
  let ribs = 0, panes = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 0.5) continue;
    const gl = Math.min(g(a[0], a[1]), g(c[0], c[1])), plaza = onRings(a, c, [...C.deck, ...C.bridges], 0.15);
    k.wall('cmbBase', a, c, bottom, baseTop);
    const u = new THREE.Vector3((c[0] - a[0]) / L, 0, (c[1] - a[1]) / L), n = new THREE.Vector3(u.z, 0, -u.x), o = new THREE.Vector3(a[0], 0, a[1]);
    // base glazing: street storey (not on plaza-facing walls, which stand on the deck) and plaza storey
    const before = k.windows, skip = (x: number, z: number) => plaza && Math.abs((x - a[0]) * u.x + (z - a[1]) * u.z - L / 2) < 3.6;
    if (!plaza) k.windowsOn(a, c, gl + 0.5, gl + 3.5, { storey: 10, bay: 3.6, w: 3.0, h: 3.0, glass: 'glass' });
    if (Y + 0.5 > gl + 3.9 || plaza) k.windowsOn(a, c, Y + 0.5, Y + 3.5, { storey: 10, bay: 3.6, w: 3.0, h: 3.0, glass: 'glass', skip });
    panes += k.windows - before;
    if (plaza && L >= 5) k.D('glass').panel(o, u, n, L / 2, Y + 1.6, 0.04, Math.min(6, L * 0.4), 3.1);   // plaza entrance (round 2)
    // reveal band and vertical ribs over the metal box
    k.D('cmbReveal').panel(o, u, n, L / 2, revealY, 0.015, L, F.revealHeight);
    const count = Math.floor(L / F.ribPitch), y0 = baseTop + 0.2, y1 = top - 0.05;
    for (let j = 0; j < count; j++) {
      const s = (j + 0.5) * L / count, D = k.D('cmbMetal'), w = F.ribWidth / 2;
      D.panel(o, u, n, s, (y0 + y1) / 2, F.ribDepth, F.ribWidth, y1 - y0);
      for (const side of [-1, 1]) {
        const p0 = o.clone().addScaledVector(u, s + side * w), p1 = p0.clone().addScaledVector(n, F.ribDepth), h = u.clone().multiplyScalar(side);
        D.quad(p0.clone().setY(y0), p1.clone().setY(y0), p1.clone().setY(y1), p0.clone().setY(y1), h);
      }
      ribs++;
    }
  }
  k.flatBody(ring, baseTop, deck, { wall: 'cmbMetal', roof: 'membrane', parapet: F.parapet });
  stats.cmb = { baseTop: +baseTop.toFixed(2), deck, parapetTop: +top.toFixed(2), revealY: +revealY.toFixed(2), ribs, basePanes: panes };
}

function buildComms(k: Kit, g: (x: number, z: number) => number, stats: Record<string, unknown>) {
  const C = B.comms, Y = C.plazaY, bRings = C.buildings.map(b => b.ring);
  // Buildings: closed precast prisms to the LiDAR roof P50, 0.5 m parapet; punched strip windows (estimate rhythm).
  for (const b of C.buildings) {
    const ring = orient(b.ring), bottom = ringMinGround(ring, g) - 1.5;
    if (b.name === 'CMB') { buildCmb(k, ring, bottom, b.deck, g, stats); continue; }
    k.flatBody(ring, bottom, b.deck, { wall: 'precast', roof: 'membrane', parapet: 0.5 });
    const storey = b.name === 'CMB' ? 3.4 : b.name === 'CMA' ? 3.5 : 3.6;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length], gl = Math.min(g(a[0], a[1]), g(c[0], c[1]));
      const plaza = onRings(a, c, [...C.deck, ...C.bridges], 0.15);
      const first = plaza ? Y + 4.2 : gl + 1.0;
      k.windowsOn(a, c, first, b.deck - 0.6, { storey, bay: 1.8, w: 1.0, h: 2.3, glass: 'glass' });
      if (plaza) { // glazed entrance at plaza level in the middle of each plaza-facing wall (estimate)
        const L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 5) continue;
        const u = new THREE.Vector3((c[0] - a[0]) / L, 0, (c[1] - a[1]) / L), n = new THREE.Vector3(u.z, 0, -u.x);
        k.D('glass').panel(new THREE.Vector3(a[0], 0, a[1]), u, n, L / 2, Y + 1.6, 0.04, Math.min(6, L * 0.4), 3.1);
      }
    }
  }
  // Plaza deck pieces (podium to the ground) and bridges over the service drive (slab 19.2 -> 20.08).
  const s = C.stair, all = [...C.deck, ...C.bridges];
  const piece = (raw: Point[], bridge: boolean) => {
    const ring = orient(raw), bottom = bridge ? C.bridgeBottom : ringMinGround(ring, g) - 0.5, m = ring.length;
    // classify edges: 'none' (building wall / stair head / shared), 'under' (podium face below a bridge), 'open' (parapet)
    const kind = ring.map((a, i) => {
      const c = ring[(i + 1) % m];
      if (onRings(a, c, bRings, 0.15)) return 'none';
      if (onRings(a, c, all.filter(r => r !== raw), 0.06)) return !bridge && onRings(a, c, C.bridges, 0.06) ? 'under' : 'none';
      const mz = (a[1] + c[1]) / 2, mx = (a[0] + c[0]) / 2;
      if (Math.abs(mz - s.zTop) < 0.15 && mx > s.x0 - 0.2 && mx < s.x1 + 0.2) return 'none';
      return 'open';
    });
    for (let i = 0; i < m; i++) {
      const a = ring[i], c = ring[(i + 1) % m];
      if (kind[i] === 'under') { k.wall('podium', a, c, bottom, C.bridgeBottom); continue; }
      if (kind[i] !== 'open') continue;
      // open edge: fascia / podium face up to the parapet top, parapet inner face and coping
      k.wall('podium', a, c, bottom, Y + PARAPET);
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 0.05) continue;
      const nx = (c[1] - a[1]) / L, nz = -(c[0] - a[0]) / L, t = 0.25;
      const ia: Point = [a[0] - nx * t, a[1] - nz * t], ic: Point = [c[0] - nx * t, c[1] - nz * t];
      k.wall('podium', ic, ia, Y, Y + PARAPET);
      k.S('podium').quad(new THREE.Vector3(a[0], Y + PARAPET, a[1]), new THREE.Vector3(c[0], Y + PARAPET, c[1]), new THREE.Vector3(ic[0], Y + PARAPET, ic[1]), new THREE.Vector3(ia[0], Y + PARAPET, ia[1]), new THREE.Vector3(0, 1, 0));
      // parapet end caps only where the parapet stops (neighbour edge is not open)
      if (kind[(i + m - 1) % m] !== 'open') k.wall('podium', a, ia, Y, Y + PARAPET);
      if (kind[(i + 1) % m] !== 'open') k.wall('podium', ic, c, Y, Y + PARAPET);
    }
    k.cap(k.W('pave'), [ring], Y);
    if (bridge) k.cap(k.S('podium'), [ring], C.bridgeBottom, 'down');
  };
  for (const r of C.deck) piece(r, false);
  for (const r of C.bridges) {
    // Bridges span the service drive only where the baked terrain leaves >= 3.5 m headroom; the current terrain under the
    // drive is 2.5-3 m above the LiDAR bare earth (14.6), so they fall back to podium (shared-requests b06-r2).
    const clear = Math.max(...r.map(p => g(p[0], p[1])), g(r.reduce((s2, p) => s2 + p[0], 0) / r.length, r.reduce((s2, p) => s2 + p[1], 0) / r.length));
    const asBridge = C.bridgeBottom - clear >= 3.5; stats.bridges ??= [];
    (stats.bridges as unknown[]).push({ terrainMax: +clear.toFixed(2), headroom: +(C.bridgeBottom - clear).toFixed(2), asBridge });
    piece(r, asBridge);
  }
  // South stair (OSM steps 1512199816): straight flight rising north from the sidewalk to the plaza.
  const xc = (s.x0 + s.x1) / 2, foot = Math.max(g(xc, s.zFoot + 0.4), g(s.x0 + 0.3, s.zFoot + 0.4), g(s.x1 - 0.3, s.zFoot + 0.4));
  const n = Math.max(3, Math.round((Y - foot) / 0.165)), rise = (Y - foot) / n, run = (s.zFoot - s.zTop) / n;
  const base = Math.min(foot, g(s.x0, s.zTop), g(s.x1, s.zTop)) - 0.6;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  for (let i = 0; i < n; i++) {
    const z0 = s.zFoot - run * (i + 1), z1 = s.zFoot - run * i, y0 = i === 0 ? base : foot + rise * i, y1 = foot + rise * (i + 1);
    k.W('pave').quad(V(s.x0, y1, z0), V(s.x1, y1, z0), V(s.x1, y1, z1), V(s.x0, y1, z1), V(0, 1, 0));
    k.S('podium').quad(V(s.x0, y0, z1), V(s.x1, y0, z1), V(s.x1, y1, z1), V(s.x0, y1, z1), V(0, 0, 1));   // riser faces south
    k.S('podium').quad(V(s.x0, base, z0), V(s.x0, base, z1), V(s.x0, y1, z1), V(s.x0, y1, z0), V(-1, 0, 0)); // west cheek
    k.S('podium').quad(V(s.x1, base, z0), V(s.x1, base, z1), V(s.x1, y1, z1), V(s.x1, y1, z0), V(1, 0, 0));  // east cheek
  }
  stats.stair = { risers: n, rise: +rise.toFixed(3), run: +run.toFixed(3), footY: +foot.toFixed(2), topY: Y };
  // Elevated connector CMB-CMA and the skybridge over W Dean Keeton (closed glazed tube; soffit height estimate).
  for (const [name, p] of [['connector', C.connector], ['skybridge', C.skybridge]] as const) {
    const ring = orient(p.ring);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length];
      if (onRings(a, c, bRings, 0.25)) continue;                                  // end abutting a building wall
      k.wall('precast', a, c, p.bottom, p.top);
      if (name === 'skybridge') k.windowsOn(a, c, p.bottom + 0.6, p.top - 0.3, { storey: 10, bay: 2.2, w: 1.8, h: 1.9, glass: 'glass' });
    }
    k.cap(k.S('membrane'), [ring], p.top); k.cap(k.S('precast'), [ring], p.bottom, 'down');
  }
}

function buildChurch(k: Kit, g: (x: number, z: number) => number) {
  // Base (whole City ring) to the annex deck; the taller volumes start on that deck (their lower walls would be hidden
  // inside the base and only fight with it).
  const C = B.church, bot = () => C.base.deck;
  k.flatBody(C.base.ring, ringMinGround(C.base.ring, g) - 1.0, C.base.deck, { wall: 'limestone', roof: 'membrane' });
  k.gableBody(C.nave.ring, bot(), C.nave.eave, C.nave.ridge, 1, { wall: 'limestone', roof: 'tile', overhang: 0.6 });
  k.gableBody(C.transept.ring, bot(), C.transept.eave, C.transept.ridge, 0, { wall: 'limestone', roof: 'tile', overhang: 0.6 });
  // Crossing cap: drum walls start on the two gable roofs (exact roof planes), pyramidal tile cap above.
  const F = (bodies as unknown as { church: { frame: { origin: Point; east: Point; north: Point } } }).church.frame;
  const loc = (x: number, z: number): Point => { const dx = x - F.origin[0], dz = z - F.origin[1]; return [dx * F.east[0] + dz * F.east[1], dx * F.north[0] + dz * F.north[1]]; };
  const plane = (ring: Point[], eave: number, ridge: number, axisS: boolean) => { const l = ring.map(p => loc(p[0], p[1])), ss = l.map(p => p[0]), ns = l.map(p => p[1]);
    const lo = axisS ? Math.min(...ss) : Math.min(...ns), hi = axisS ? Math.max(...ss) : Math.max(...ns), mid = (lo + hi) / 2, slope = (ridge - eave) / ((hi - lo) / 2);
    return (x: number, z: number) => { const q = loc(x, z), v = axisS ? q[0] : q[1]; return ridge - slope * Math.abs(v - mid); }; };
  const nave = plane(C.nave.ring, C.nave.eave, C.nave.ridge, true), tr = plane(C.transept.ring, C.transept.eave, C.transept.ridge, false);
  const roofAt = (x: number, z: number) => Math.max(nave(x, z), tr(x, z)) - 0.03;
  const d = orient(C.dome.ring), V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  for (let i = 0; i < d.length; i++) {
    const a = d[i], c = d[(i + 1) % d.length], m: Point = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const n = V3((c[1] - a[1]) / L, 0, -(c[0] - a[0]) / L);
    for (const [p0, p1] of [[a, m], [m, c]]) k.S('limestone').quad(V3(p0[0], roofAt(p0[0], p0[1]), p0[1]), V3(p1[0], roofAt(p1[0], p1[1]), p1[1]), V3(p1[0], C.dome.eave, p1[1]), V3(p0[0], C.dome.eave, p0[1]), n);
  }
  k.pyramidBody(C.dome.ring, C.dome.eave, C.dome.eave, C.dome.apex, { wall: 'limestone', roof: 'tile', overhang: 0.3 });
  k.pyramidBody(C.tower.ring, bot(), C.tower.eave, C.tower.apex, { wall: 'limestone', roof: 'tile', overhang: 0.6 });
  // Tall windows on the gable walls and side walls above the low base; belfry openings on the tower (estimates).
  const tall = { storey: 20, bay: 4.2, w: 1.6, h: 4.6, glass: 'glass', trim: 'limestone' };
  for (const [r, eave] of [[C.nave.ring, C.nave.eave], [C.transept.ring, C.transept.eave]] as const) {
    const o = orient(r); for (let i = 0; i < 4; i++) k.windowsOn(o[i], o[(i + 1) % 4], C.base.deck + 0.4, eave - 0.3, { ...tall, skip: (x, z) => insideRing(x, z, C.tower.ring) });
  }
  const t = orient(C.tower.ring);
  for (let i = 0; i < 4; i++) k.windowsOn(t[i], t[(i + 1) % 4], C.tower.eave - 3.6, C.tower.eave - 0.4, { storey: 10, bay: 3.2, w: 1.3, h: 2.8, glass: 'glass', trim: 'limestone' });
}

function buildLittlefield(k: Kit, g: (x: number, z: number) => number) {
  const L = B.littlefield, bottom = ringMinGround(L.ring, g) - 1.0;
  // Main-roof triangles inside the tower / turret shafts are hidden by them (and would sit under their own caps).
  const inside = (x: number, z: number) => insideRing(x, z, L.tower.ring) || ringDistIn(x, z, L.tower.ring) < 0.35 || Math.hypot(x + 339.3, z + 212.5) < 3.4;
  const { wallTop } = k.hipBody(L.ring, bottom, L.roofMedian, L.ridgeMax, L.slope, { wall: 'brick', roof: 'slate', overhang: 0.5, exclude: inside });
  k.pyramidBody(L.tower.ring, bottom, L.tower.eave, L.tower.apex, { wall: 'brick', roof: 'slate', overhang: 0.3 });
  k.pyramidBody(L.turret.ring, bottom, L.turret.eave, L.turret.apex, { wall: 'brick', roof: 'slate', overhang: 0.25 });
  const r = orient(L.ring), skip = (x: number, z: number) => insideRing(x, z, L.tower.ring) || Math.hypot(x + 339.3, z + 212.5) < 3.2;
  for (let i = 0; i < r.length; i++) { const a = r[i], c = r[(i + 1) % r.length], gl = Math.min(g(a[0], a[1]), g(c[0], c[1]));
    k.windowsOn(a, c, gl + 1.2, wallTop - 0.4, { storey: 4.3, bay: 3.0, w: 1.05, h: 2.5, glass: 'glass', trim: 'sandstone', skip }); }
  for (const ring of [L.tower.ring, L.turret.ring]) { const o = orient(ring); for (let i = 0; i < o.length; i++) k.windowsOn(o[i], o[(i + 1) % o.length], wallTop + 0.6, (ring === L.tower.ring ? L.tower.eave : L.turret.eave) - 0.3, { storey: 10, bay: 1.7, w: 0.8, h: 1.8, glass: 'glass', trim: 'sandstone' }); }
}

export const block: BlockModule = {
  id: 'b06-northwest',
  install(ctx) {
    const started = performance.now();
    const k = new Kit(), stats: Record<string, unknown> = {};
    buildComms(k, ctx.groundHeight, stats);
    buildChurch(k, ctx.groundHeight);
    buildLittlefield(k, ctx.groundHeight);
    const hk = new Kit(), honors = buildHonorsQuad(hk, ctx.groundHeight);
    const kinRecord = ctx.data.buildings.find(b => b.key === KIN_KEY);
    if (!kinRecord || kinRecord.rings.length < 3) throw new Error('b06: Kinsolving official footprint (outer + 2 courtyards) missing');
    const kk = new Kit(), kin = buildKinsolving(kk, kinRecord.rings, ctx.groundHeight);
    k.flatBody(B.shed.ring, ringMinGround(B.shed.ring, ctx.groundHeight) - 0.8, B.shed.deck, { wall: 'precast', roof: 'membrane', skipEdge: (a, c) => { const r = B.church.base.ring; return r.some((p, i) => segDist((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, p, r[(i + 1) % r.length]) < 0.7); } });
    const created = new Map<string, THREE.MeshStandardMaterial>(), finish = new TexturedFinish(ctx.renderer);
    const honorsMat = (key: string) => { let m = created.get(`honors:${key}`); if (!m) { m = finish.material(key, `b06 honors ${key}`, HONORS_TEXTURED); created.set(`honors:${key}`, m); } return m; };
    const mat = (key: string) => { let m = created.get(key); if (!m) { if (TEXTURED[key]) m = finish.material(key, `b06 ${key}`); else { const [col, rough, metal] = MATERIALS[key]; m = new THREE.MeshStandardMaterial({ color: col, roughness: rough, metalness: metal ?? 0 }); m.name = `b06 ${key}`; } created.set(key, m); } return m; };
    const geometries: THREE.BufferGeometry[] = [], colliders: RAPIER.Collider[] = [];
    const mesh = (key: string, b: { geometry(): THREE.BufferGeometry }, role: string, shadow: boolean, tag = '') => {
      // Honors appearance follow-up: own textured material + metric UVs for the 'honors ' tag only (positions untouched).
      const honorsFinish = tag === 'honors ' && !!HONORS_TEXTURED[key];
      const geo = b.geometry(); if (honorsFinish) (key === 'tile' ? slopeUVs : metreUVs)(geo); else if (TEXTURED[key] || tag === 'kin ') metreUVs(geo);
      geometries.push(geo); const m = new THREE.Mesh(geo, honorsFinish ? honorsMat(key) : mat(key)); m.name = `b06 ${tag}${role} ${key}`;
      m.castShadow = shadow; m.receiveShadow = true; m.userData.block = 'b06-northwest'; return m;
    };
    const collide = (buckets: Map<string, { pos: number[] }>) => {
      const pos = new Float32Array([...buckets.values()].flatMap(b => b.pos)); if (!pos.length) return;
      colliders.push(ctx.physics.createCollider(RAPIER.ColliderDesc.trimesh(pos, Uint32Array.from({ length: pos.length / 3 }, (_v, i) => i), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.8)));
    };
    const solids = [...k.solid].map(([key, b]) => mesh(key, b, 'solid', true));
    const walkable = [...k.walk].map(([key, b]) => mesh(key, b, 'walkable', false));
    const detail = [...k.detail].map(([key, b]) => mesh(key, b, 'detail', false));
    collide(k.solid); collide(k.walk);
    const hSolids = [...hk.solid].map(([key, b]) => mesh(key, b, 'solid', true, 'honors ')), hDetail = [...hk.detail].map(([key, b]) => mesh(key, b, 'detail', false, 'honors '));
    collide(hk.solid); solids.push(...hSolids); detail.push(...hDetail);
    const kSolids = [...kk.solid].map(([key, b]) => mesh(key, b, 'solid', true, 'kin ')), kDetail = [...kk.detail].map(([key, b]) => mesh(key, b, 'detail', false, 'kin '));
    collide(kk.solid); solids.push(...kSolids); detail.push(...kDetail);
    const tris = (ms: THREE.Mesh[]) => ms.reduce((s, m) => s + m.geometry.getAttribute('position').count / 3, 0);
    const install: BlockInstall & { replaced: string[] } = {
      solids, walkable, detail, colliders, replaced: REPLACED,
      stats: { ...stats, honors: { ...honors, solidTriangles: tris(hSolids), detailTriangles: tris(hDetail), draws: hSolids.length + hDetail.length },
        kinsolving: { ...kin, solidTriangles: tris(kSolids), detailTriangles: tris(kDetail), draws: kSolids.length + kDetail.length }, ownTextures: finish.textures.length, windows: k.windows, solidTriangles: tris(solids), walkableTriangles: tris(walkable), detailTriangles: tris(detail),
        draws: solids.length + walkable.length + detail.length, colliders: colliders.length, installMs: Math.round(performance.now() - started) },
      dispose() {
        for (const c of colliders) if (ctx.physics.getCollider(c.handle)) ctx.physics.removeCollider(c, false);
        for (const geo of geometries) geo.dispose();
        for (const m of created.values()) m.dispose();
        finish.dispose();
      },
    };
    return install;
  },
};
