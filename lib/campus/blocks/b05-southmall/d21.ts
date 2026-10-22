// D08 Dobie Twenty21 (City 484112, campus.json record 83; UT LIS D21, OBJECTID 756, 2021 Guadalupe St), block
// b05-southmall. REPLACES the generated tier massing with an authored body on exactly the same measured volumes.
//
// Measured (kept exactly, never regularised): the City 2023 footprint ring (D21_CITY_RING, campus.json record 83) and
// the four 2017 LiDAR tier rings + heights already in context.json massing['484112:83'] (roofs-lidar.json 484112,
// datum aboveY 6.0): 8.7 m (campus Y 14.7), 13.1 m (Y 19.1), 83.0 m tower (Y 89.0), 91.2 m mechanical (Y 97.2).
// The tower tier ring is the measured stepped outline; its facets are the tower's vertical bays.
// Volumes follow the roofs-lidar.json rule "draw each tier up to its height; the taller covers the lower": the City
// ring is the podium base (walls ground..14.7, roof 14.7, which also closes every sliver between tier rings), tier B
// rises from that roof to 19.1, the tower from it to 89.0, the mechanical tier from the tower roof to 97.2. Upper
// prisms have no bottom caps and start on the roof below (no stacked coplanar walls). Where the measured tier B and
// tower rings share a collinear edge stretch (two stretches, 5.94 m + 3.64 m), both walls would be coplanar and
// opposite between Y 14.7 and 19.1; that internal interface is dropped from both (sharedSegments): tier B's wall is
// omitted there and the tower wall starts at the tier B roof (19.1), so the union stays closed. Lower roofs continue
// hidden inside the higher prisms (no coplanar caps). Every solid triangle is also the one trimesh collider.
//
// Reference-interpreted (UT directory photo ut-d21-756, research only, never a runtime asset): blue-green reflective
// glass tower with dark horizontal bands, stepped vertical bays, a dark level where the tower leaves the podium, and a
// light painted-brick retail podium with storefronts. ESTIMATES (not surveyed): every colour, the ~3 m band rhythm (the
// official housing.utexas.edu page gives 27 storeys for the complex; storey heights are not surveyed), band/glass
// proportions, the dark base and crown band heights, storefront positions/sizes and which podium faces carry them.
// Not modelled: signage, the exterior stair, the metal grid cube, anything above the 97.2 tier (LiDAR max 93.9 /
// r3 raster max 99.9 is a mast or equipment, not surveyed).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import ctxData from './context.json' with { type: 'json' };
import { TEXTURES } from '../../context/materials';
import type { BlockInstallContext } from '../types';
import type { B05Kit } from './pbr-kit';
import { Soup, box, cap, frames, punchedWall, rect, type Opening, type P2 } from './arch-kit';

export const D21_KEY = '484112:83';
export const D21_ARCHETYPE = 'b05-southmall:dobie-glass-tower';
/** City 2023 footprint, public/data/campus.json buildings[83] (id 484112), closing vertex dropped. */
export const D21_CITY_RING: P2[] = [
  [-361.06, 272.14], [-397.93, 268.99], [-398.16, 271.62], [-399.86, 275.54], [-407.11, 274.92], [-406.55, 268.4],
  [-435.33, 265.94], [-435.43, 267.15], [-436.28, 267.08], [-439.62, 270.01], [-444.07, 319.93], [-444.64, 319.89],
  [-446.71, 322.83], [-445.1, 326.61], [-442.63, 326.77], [-442.84, 329.17], [-405.91, 332.74], [-364.71, 335.51],
  [-364.5, 333], [-361.69, 333.24], [-359.04, 299.58], [-361.65, 299.36], [-361.28, 295.09], [-365.42, 294.74],
  [-365.1, 290.93], [-358.31, 291.51], [-357.11, 277.39],
];

type Vol = { ring: P2[]; top: number; role: string };
/** The measured tiers, read from context.json massing['484112:83'] (unchanged; datum aboveY = LiDAR groundY). */
export function d21Tiers() {
  const m = (ctxData as unknown as { massing: Record<string, { datum: { aboveY: number }; volumes: Vol[] }> }).massing[D21_KEY];
  const tops = m.volumes.map(v => v.top);
  if (tops.join() !== '8.7,13.1,83,91.2') throw new Error(`D21 massing tiers changed (${tops.join()}); d21.ts expects the measured 8.7/13.1/83/91.2 m tiers`);
  const datum = m.datum.aboveY, [a, b, t, mech] = m.volumes;
  return {
    datum,
    /** Tier A (8.7 m) is drawn as the whole City ring at its height: the podium base. */
    base: { ring: D21_CITY_RING, y: datum + a.top, tierRing: a.ring as P2[] },
    podiumB: { ring: b.ring as P2[], y: datum + b.top },
    tower: { ring: t.ring as P2[], y: datum + t.top },
    mech: { ring: mech.ring as P2[], y: datum + mech.top },
  };
}

/** Facade numbers. All ESTIMATES (photo-read proportions; 27 official storeys only support a ~3 m rhythm). */
export const D21_FACADE = {
  /** Dark level where the tower leaves the podium (top of it). */
  baseBandTop: 22.1,
  /** Dark crown band from here to the measured tower roof. */
  crownBottom: 87.3,
  floorTarget: 3.0,
  /** Dark horizontal band at the top of each floor. */
  spandrel: 1.0,
  /** Visual fins on the stepped-bay corners (vertices of the measured tower ring). */
  fin: { half: 0.1, depth: 0.18 },
  storefront: { minEdge: 7, margin: 1.2, pitch: 4.5, pier: 1.1, sill: 0.35, height: 3.4, recess: 0.35 },
} as const;

/** Dobie-only finishes (photo-read colours, estimates). Glass reflections come from scene.environment (sky). */
export const D21_FINISHES = {
  towerGlass: { color: '#3f8c84', roughness: 0.12, metalness: 0.75 },
  band: { color: '#1e2a2b', roughness: 0.55, metalness: 0.35 },
  podium: { family: 'buffBrick', color: '#e7e3da', metalness: 0 },
} as const;
export type D21FinishKey = keyof typeof D21_FINISHES;

/** Dobie-private materials: two untextured, one tinted from the same-origin CC0 context brick family (3 textures). */
export class DobieKit {
  private textures = new Map<string, THREE.Texture>();
  private materials = new Map<D21FinishKey, THREE.Material>();
  private loader = new THREE.TextureLoader();
  private anisotropy = 4;
  constructor(renderer?: THREE.WebGLRenderer) {
    try { this.anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() ?? 4); } catch { this.anisotropy = 4; }
  }
  private tex(map: 'color' | 'normal' | 'rough') {
    const fam = D21_FINISHES.podium.family, url = `/assets/materials/context/${fam}-${map}.jpg`;
    let t = this.textures.get(url);
    if (!t) {
      t = this.loader.load(url);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1 / TEXTURES[fam].tile, 1 / TEXTURES[fam].tile);
      t.anisotropy = this.anisotropy;
      if (map === 'color') t.colorSpace = THREE.SRGBColorSpace;
      t.name = `b05 D21 ${fam}:${map}`; t.userData.url = url;
      this.textures.set(url, t);
    }
    return t;
  }
  material(k: D21FinishKey): THREE.Material {
    let m = this.materials.get(k);
    if (m) return m;
    if (k === 'podium') {
      const f = D21_FINISHES.podium, spec = TEXTURES[f.family], mean = spec.linearMean, c = new THREE.Color(f.color);
      m = new THREE.MeshStandardMaterial({
        map: this.tex('color'), normalMap: this.tex('normal'), roughnessMap: this.tex('rough'), roughness: 1, metalness: f.metalness,
        normalScale: new THREE.Vector2(spec.normal, spec.normal), color: new THREE.Color(c.r / mean[0], c.g / mean[1], c.b / mean[2]),
      });
    } else {
      const f = D21_FINISHES[k];
      m = new THREE.MeshStandardMaterial({ color: f.color, roughness: f.roughness, metalness: f.metalness });
    }
    m.name = `b05 D21 ${k}`;
    this.materials.set(k, m);
    return m;
  }
  stats() { return { materials: this.materials.size, textures: this.textures.size, urls: [...this.textures.keys()] }; }
  dispose() {
    for (const m of this.materials.values()) m.dispose();
    for (const t of this.textures.values()) t.dispose();
    this.materials.clear(); this.textures.clear();
  }
}

/** Collinear, opposite-facing stretches of two rings (internal interfaces between adjacent prisms), per edge of ring A
 * and of ring B, as [s0, s1] intervals along each edge (metres). Tolerance: 1 cm off the line, anti-parallel. */
export function sharedSegments(A: P2[], B: P2[], tol = 0.01) {
  const onA: [number, number][][] = A.map(() => []), onB: [number, number][][] = B.map(() => []);
  let total = 0;
  for (let i = 0; i < A.length; i++) {
    const a = A[i], b = A[(i + 1) % A.length], la = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / la, uz = (b[1] - a[1]) / la;
    for (let j = 0; j < B.length; j++) {
      const c = B[j], d = B[(j + 1) % B.length], lb = Math.hypot(d[0] - c[0], d[1] - c[1]), vx = (d[0] - c[0]) / lb, vz = (d[1] - c[1]) / lb;
      if (ux * vx + uz * vz > -0.9999) continue;
      const off = (p: P2) => Math.abs((p[0] - a[0]) * uz - (p[1] - a[1]) * ux);
      if (off(c) > tol || off(d) > tol) continue;
      const sc = (c[0] - a[0]) * ux + (c[1] - a[1]) * uz, sd = (d[0] - a[0]) * ux + (d[1] - a[1]) * uz;
      const s0 = Math.max(0, Math.min(sc, sd)), s1 = Math.min(la, Math.max(sc, sd));
      if (s1 - s0 < 0.02) continue;
      onA[i].push([s0, s1]);
      // Same stretch along B's edge j (B runs opposite: param from c).
      const t = (s: number) => (c[0] - (a[0] + ux * s)) * -vx + (c[1] - (a[1] + uz * s)) * -vz;
      onB[j].push([Math.min(t(s0), t(s1)), Math.max(t(s0), t(s1))]);
      total += s1 - s0;
    }
  }
  return { onA, onB, total };
}
/** Complement of sorted intervals inside [0, len]. */
const gaps = (len: number, cut: [number, number][]) => {
  const out: [number, number][] = []; let s = 0;
  for (const [a, b] of cut.slice().sort((p, q) => p[0] - q[0])) { if (a > s + 1e-6) out.push([s, a]); s = Math.max(s, b); }
  if (len > s + 1e-6) out.push([s, len]);
  return out;
};

export function buildDobie(ctx: BlockInstallContext, kit: B05Kit, dkit: DobieKit, physics: RAPIER.World) {
  const T = d21Tiers(), FAC = D21_FACADE, SF = FAC.storefront;
  const podium = new Soup(), roof = new Soup(), storeGlass = new Soup(), towerGlass = new Soup(), band = new Soup(), fins = new Soup();
  const g = (x: number, z: number) => ctx.groundHeight(x, z);
  const at = (f: ReturnType<typeof frames>[number], s: number, t: number): P2 => [f.a[0] + f.u[0] * s + f.n[0] * t, f.a[1] + f.u[1] * s + f.n[1] * t];
  const groundAlong = (f: ReturnType<typeof frames>[number], s0: number, s1: number) => {
    const ys: number[] = [];
    for (let s = s0; ; s = Math.min(s1, s + 1)) { for (const t of [0, 0.8]) { const p = at(f, s, t); ys.push(g(p[0], p[1])); } if (s >= s1) break; }
    return { min: Math.min(...ys), max: Math.max(...ys) };
  };

  // 1. Podium base on the City ring: walls from below the lowest ground along each edge (never above grade) to the
  //    tier-A roof, storefronts on the street faces (21st St north, Guadalupe west, Whitis east), roof cap.
  let storeEdges = 0, openings = 0, wallBottomMin = Infinity;
  for (const f of frames(T.base.ring)) {
    const gr = groundAlong(f, 0, f.len), y0 = gr.min - 0.5;
    wallBottomMin = Math.min(wallBottomMin, y0);
    const street = f.len >= SF.minEdge && (f.n[1] < -0.8 || Math.abs(f.n[0]) > 0.8);
    if (!street) { rect(podium, f, 0, f.len, 0, y0, T.base.y); continue; }
    const n = Math.max(1, Math.floor((f.len - 2 * SF.margin + SF.pier) / SF.pitch)), pitch = (f.len - 2 * SF.margin) / n, ops: Opening[] = [];
    for (let k = 0; k < n; k++) {
      const s0 = SF.margin + k * pitch + SF.pier / 2, s1 = SF.margin + (k + 1) * pitch - SF.pier / 2;
      const sill = groundAlong(f, s0, s1).max + SF.sill;
      ops.push({ s0, s1, y0: sill, y1: sill + SF.height });
    }
    punchedWall(podium, podium, storeGlass, f, 0, f.len, y0, T.base.y, ops, SF.recess);
    storeEdges++; openings += ops.length;
  }
  cap(roof, T.base.ring, T.base.y, true);

  // 2. Tier B (13.1 m) from the podium roof; no wall on the stretches it shares with the tower ring (internal interface).
  const shared = sharedSegments(T.podiumB.ring, T.tower.ring);
  frames(T.podiumB.ring).forEach((f, i) => { for (const [s0, s1] of gaps(f.len, shared.onA[i])) rect(podium, f, s0, s1, 0, T.base.y, T.podiumB.y); });
  cap(roof, T.podiumB.ring, T.podiumB.y, true);

  // 3. Tower on the measured stepped ring: curtain wall split into glass and dark bands (same plane, all solid).
  const floors = Math.round((FAC.crownBottom - FAC.baseBandTop) / FAC.floorTarget), rhythm = (FAC.crownBottom - FAC.baseBandTop) / floors;
  const strips: [number, number, Soup][] = [[T.base.y, FAC.baseBandTop, band]];
  for (let k = 0; k < floors; k++) {
    const y = FAC.baseBandTop + k * rhythm;
    strips.push([y, y + rhythm - FAC.spandrel, towerGlass], [y + rhythm - FAC.spandrel, y + rhythm, band]);
  }
  strips.push([FAC.crownBottom, T.tower.y, band]);
  const merged: [number, number, Soup][] = [];
  for (const s of strips) { const l = merged[merged.length - 1]; if (l && l[2] === s[2] && Math.abs(l[1] - s[0]) < 1e-9) l[1] = s[1]; else merged.push([...s]); }
  const towerFrames = frames(T.tower.ring);
  towerFrames.forEach((f, i) => {
    // On the stretches shared with tier B the tower wall starts at the tier B roof (the B/tower interface below is internal).
    const spans: [number, number, number][] = [...gaps(f.len, shared.onB[i]).map(([a, b]) => [a, b, T.base.y] as [number, number, number]),
      ...shared.onB[i].map(([a, b]) => [a, b, T.podiumB.y] as [number, number, number])];
    for (const [s0, s1, from] of spans) for (const [y0, y1, soup] of merged) if (y1 > from) rect(soup, f, s0, s1, 0, Math.max(y0, from), y1);
    box(fins, f, -FAC.fin.half, FAC.fin.half, 0, FAC.fin.depth, FAC.baseBandTop, FAC.crownBottom, { back: true });
  });
  cap(roof, T.tower.ring, T.tower.y, true);

  // 4. Mechanical tier (91.2 m) on the tower roof, dark screen.
  for (const f of frames(T.mech.ring)) rect(band, f, 0, f.len, 0, T.tower.y, T.mech.y);
  cap(roof, T.mech.ring, T.mech.y, true);

  // Meshes: one per finish; one trimesh collider from exactly the solid triangles (fins are visual trim < 0.3 m).
  const solids: THREE.Mesh[] = [], detail: THREE.Mesh[] = [], geometries: THREE.BufferGeometry[] = [], pos: number[] = [];
  const parts: [string, Soup, THREE.Material, boolean][] = [
    ['podium walls', podium, dkit.material('podium'), true], ['roofs', roof, kit.material('concrete'), true],
    ['storefront glass', storeGlass, kit.material('glass'), true], ['tower curtain-wall glass', towerGlass, dkit.material('towerGlass'), true],
    ['tower bands and mechanical screen', band, dkit.material('band'), true], ['tower bay fins (visual trim)', fins, dkit.material('band'), false],
  ];
  let solidTris = 0, detailTris = 0;
  for (const [name, soup, mat, solid] of parts) {
    if (!soup.triangles) continue;
    const geo = soup.geometry(); geometries.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.name = `b05 D21 ${name}`; m.castShadow = true; m.receiveShadow = true;
    m.userData.block = 'b05-southmall'; m.userData.b05Group = 'D21'; m.userData.record = D21_KEY;
    (solid ? solids : detail).push(m);
    if (solid) { for (const v of soup.p) pos.push(v); solidTris += soup.triangles; } else detailTris += soup.triangles;
  }
  const v = new Float32Array(pos), idx = new Uint32Array(v.length / 3).map((_, i) => i);
  const collider = physics.createCollider(RAPIER.ColliderDesc.trimesh(v, idx).setFriction(0.8));
  for (const m of [...solids, ...detail]) m.userData.colliderHandle = collider.handle;
  const r2 = (x: number) => +x.toFixed(2);
  return {
    solids, detail, geometries, collider,
    stats: {
      measured: { datum: T.datum, baseRoofY: r2(T.base.y), podiumBRoofY: r2(T.podiumB.y), towerRoofY: r2(T.tower.y), mechRoofY: r2(T.mech.y),
        ringVertices: { city: T.base.ring.length, tierA: T.base.tierRing.length, podiumB: T.podiumB.ring.length, tower: T.tower.ring.length, mech: T.mech.ring.length } },
      estimates: { towerFloors: floors, bandRhythm: +rhythm.toFixed(3), spandrel: FAC.spandrel, baseBandTop: FAC.baseBandTop, crownBottom: FAC.crownBottom,
        storefrontEdges: storeEdges, storefrontOpenings: openings, colours: D21_FINISHES, note: '27 official storeys (housing.utexas.edu) only support a ~3 m rhythm; not a storey survey' },
      wallBottomMinY: r2(wallBottomMin), towerBays: towerFrames.length, sharedTierBTowerStretchM: +shared.total.toFixed(2),
      solidTriangles: solidTris, trimTriangles: detailTris, colliderTriangles: pos.length / 9, meshes: solids.length + detail.length,
    },
  };
}
