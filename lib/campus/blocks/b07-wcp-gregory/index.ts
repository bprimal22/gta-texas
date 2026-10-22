// Block b07-wcp-gregory: WCP, Gregory Gym, Jester, San Jacinto residence halls.
// Round 2 (district work D13/D14): d13.ts (Jester tower window grouping, additive) and d14.ts (Prather rebuilt as
// exact-facet stepped hips; entry surrounds on Roberts / Moore-Hill / San Jacinto) with the private pbr-kit/arch-kit.
// Owner-only file (research/whole-campus-92/BLOCKS.md). install() restores the one real building the generated
// context suppressed without any replacement: the Gregory Aquatic Pool Equipment Bldg (GRP, City footprint
// 716175:1135, UT GIS objectId 414, UT building 0277, 2005, one floor). The WCP perimeter paving
// (east-south-modern.ts, also b07) used to run over it, so the classifier called it a 'route' and nothing drew it.
// The paving is now cut 0.15 m outside the footprint; the coverage raster's 0.8 m tolerance still flags the
// footprint as ground, so the body is authored here (context.json `replaces`), not generated.
// Heights are ABSOLUTE campus Y from the 2017 USGS LiDAR 0.5 m building raster sampled inside the ring
// (research/whole-campus-92/b07-wcp-gregory/derived/lidar-b07.json): ground 0.36, roof P10 4.06 / P50 4.66 /
// max 5.48, pitch 19.6 deg (roofs-lidar.json). Wall/roof materials are an estimate (no facade reference).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Point } from '../../types';
import type { BlockInstall, BlockModule } from '../types';
import { B07Kit } from './pbr-kit';
import { buildJester } from './d13';
import { buildHallEntries, buildPrather, HALL_ENTRY_RECORDS, PHD_KEY } from './d14';

/** City footprint 716175 (campus.json record 1135), source order. */
export const GRP_RING: Point[] = [[118.17, 174.27], [117.01, 188.12], [126.17, 188.89], [127.34, 175.04]];
export const GRP_LIDAR = { groundY: 0.36, roofP50: 4.66, ridgeMax: 5.48, pitchDeg: 19.6 } as const;
/** Walls 0.25 m inside the GIS line; with the paving cut 0.15 m outside it, the 0.3 m route capsule on the paving
 * edge stays clear of the wall (registration scatter of the GIS line is 0.6-0.9 m anyway). */
export const GRP_INSET = 0.25;
export const GRP_RIDGE = 5.45;
const OVERHANG = 0.4, SLAB = 0.14;

const v2 = (p: Point) => new THREE.Vector2(p[0], p[1]);

/** Rectangle frame of the (near-rectangular) quad: centre, unit long axis u, short axis w, half extents. */
function frame(ring: Point[]) {
  const c = ring.reduce((a, p) => a.add(v2(p).multiplyScalar(1 / ring.length)), new THREE.Vector2());
  const e0 = v2(ring[1]).sub(v2(ring[0])), e1 = v2(ring[2]).sub(v2(ring[1]));
  const long = e0.length() >= e1.length() ? e0 : e1, short = long === e0 ? e1 : e0;
  const u = long.clone().normalize(), w = new THREE.Vector2(-u.y, u.x);
  return { c, u, w, hl: long.length() / 2, hw: short.length() / 2 };
}

export function buildGrp(ground: (x: number, z: number) => number) {
  const f = frame(GRP_RING);
  const slope = Math.tan(GRP_LIDAR.pitchDeg * Math.PI / 180);
  const hl = f.hl - GRP_INSET, hw = f.hw - GRP_INSET;               // wall half extents
  const P = (s: number, t: number) => f.c.clone().addScaledVector(f.u, s).addScaledVector(f.w, t);
  const corners = [P(-hl, -hw), P(hl, -hw), P(hl, hw), P(-hl, hw)];
  const base = Math.min(...corners.map(p => ground(p.x, p.y))) - 0.3;
  const eave = GRP_RIDGE - slope * hw;                                // roof plane height at the wall line
  const wall: number[] = [], roof: number[] = [];
  const tri = (out: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const V = (p: THREE.Vector2, y: number) => new THREE.Vector3(p.x, y, p.y);
  /** Vertical face a-b-c wound so its normal points away from the building centre (outward). */
  const nrm = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const outward = (out: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    nrm.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    const mx = (a.x + b.x + c.x) / 3 - f.c.x, mz = (a.z + b.z + c.z) / 3 - f.c.y;
    if (nrm.x * mx + nrm.z * mz >= 0) tri(out, a, b, c); else tri(out, a, c, b);
  };
  // Walls: four quads, outward winding (CCW seen from outside). Gable-free hip: walls stop at the eave line.
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    outward(wall, V(a, base), V(b, base), V(b, eave)); outward(wall, V(a, base), V(b, eave), V(a, eave));
  }
  // Hip roof over the walls + overhang: ridge along the long axis; eave line `OVERHANG` beyond the walls.
  const rl = hl + OVERHANG, rw = hw + OVERHANG, rise = slope * rw, ridgeHalf = Math.max(0, rl - rw);
  const ey = GRP_RIDGE - rise;
  const E = [P(-rl, -rw), P(rl, -rw), P(rl, rw), P(-rl, rw)].map(p => V(p, ey));
  const R0 = V(P(-ridgeHalf, 0), GRP_RIDGE), R1 = V(P(ridgeHalf, 0), GRP_RIDGE);
  const faces: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
    [E[0], R1, E[1]], [E[0], R0, R1], [E[1], R1, E[2]], [E[2], R1, R0], [E[2], R0, E[3]], [E[3], R0, E[0]],
  ];
  const up = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (const [a, b, c] of faces) {
    up.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
    const [p, q, r] = up.y > 0 ? [a, b, c] : [a, c, b];               // top faces point up
    tri(roof, p, q, r);
    const d = new THREE.Vector3(0, -SLAB, 0);                          // underside (soffit) of the roof slab
    tri(roof, p.clone().add(d), r.clone().add(d), q.clone().add(d));
  }
  // Slab edge (fascia) around the eave.
  for (let i = 0; i < 4; i++) {
    const a = E[i], b = E[(i + 1) % 4], a2 = a.clone().setY(ey - SLAB), b2 = b.clone().setY(ey - SLAB);
    outward(roof, a2, b2, b); outward(roof, a2, b, a);
  }
  const geom = (pos: number[]) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g; };
  return { wall: geom(wall), roof: geom(roof), stats: { base: +base.toFixed(2), eaveAtWall: +eave.toFixed(2), ridge: GRP_RIDGE, roofEdge: +ey.toFixed(2), wallHalf: [+hl.toFixed(2), +hw.toFixed(2)] } };
}

export const block: BlockModule = {
  id: 'b07-wcp-gregory',
  install(ctx) {
    const started = performance.now();
    const built = buildGrp(ctx.groundHeight);
    // Estimate: pale masonry block walls and a grey standing-seam metal roof (pool-service building, 2005).
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xc9bca4, roughness: 0.9, side: THREE.DoubleSide }); wallMat.name = 'b07 GRP pale masonry';
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x7b8083, roughness: 0.45, metalness: 0.55 }); roofMat.name = 'b07 GRP metal roof';
    const solids: THREE.Mesh[] = [new THREE.Mesh(built.wall, wallMat), new THREE.Mesh(built.roof, roofMat)];
    for (const m of solids) { m.name = (m.material as THREE.Material).name; m.castShadow = m.receiveShadow = true; m.userData.block = 'b07-wcp-gregory'; m.userData.b07 = 'GRP'; }
    // One trimesh collider from exactly the rendered wall + roof triangles.
    const pos: number[] = [];
    for (const g of [built.wall, built.roof]) pos.push(...(g.getAttribute('position').array as Float32Array));
    const vertices = new Float32Array(pos), indices = new Uint32Array(vertices.length / 3).map((_, i) => i);
    const collider = ctx.physics.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.8));
    const colliders = [collider];
    // D13/D14 authored architecture (b07 round 2): private PBR kit, one collider per building group.
    const kit = new B07Kit(ctx.renderer), geometries: THREE.BufferGeometry[] = [], detail: THREE.Object3D[] = [];
    const disposeOwn = () => {
      for (const c of colliders) if (ctx.physics.getCollider(c.handle)) ctx.physics.removeCollider(c, false);
      built.wall.dispose(); built.roof.dispose(); wallMat.dispose(); roofMat.dispose();
      for (const g of geometries) g.dispose(); kit.dispose();
    };
    const districts: Record<string, unknown> = {};
    try {
      const paths = (ctx.data as unknown as { paths: { kind: string; points: [number, number][] }[] }).paths;
      const rings: Record<string, [number, number][]> = {};
      for (const b of ctx.data.buildings) if (b.key && HALL_ENTRY_RECORDS.some(r => r.key === b.key)) rings[b.key] = b.rings[0] as [number, number][];
      const jester = buildJester(ctx), prather = buildPrather(ctx, paths), entries = buildHallEntries(ctx, paths, rings);
      for (const [part, built2, localContext, record] of [
        ['D13 Jester towers', jester, true, '526723:286 526236:273'], ['D14 Prather', prather, false, PHD_KEY], ['D14 residence hall entries', entries, true, undefined],
      ] as const) {
        const b = built2.group.build(kit, ctx.physics, { localContext, record });
        geometries.push(...b.geometries); if (b.collider) colliders.push(b.collider);
        solids.push(...b.solids); detail.push(...b.detail);
        districts[part] = { ...built2.stats, solidTriangles: b.solidTris, trimTriangles: b.detailTris, colliderTriangles: b.colliderTris, meshes: b.solids.length + b.detail.length };
      }
      districts.jesterWindowSamples = jester.windowLog;
    } catch (e) { disposeOwn(); throw e; }
    const install: BlockInstall & { replaced: string[] } = {
      solids, detail, colliders, replaced: ['716175:1135', PHD_KEY],
      stats: { GRP: built.stats, triangles: vertices.length / 9, drawCalls: 2, districts, pbr: kit.stats(), installMs: Math.round(performance.now() - started) },
      dispose: disposeOwn,
    };
    return install;
  },
};
