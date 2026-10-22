// Block b04-tower: Tower, Inner Campus, West Mall, Union, Garrison/Waggener.
// Owner-only file (research/whole-campus-92/BLOCKS.md). install() restores the two real buildings
// the generated context suppressed without any authored replacement (see ./historic-infill.ts and
// research/whole-campus-92/b04-tower/EVIDENCE.md): Goldsmith Hall (GOL 734456) and the Dorothy L.
// Gebauer Building (GEB 734466). All heights below are ABSOLUTE campus Y (= LiDAR groundY + tier).
// Round 3 (districts D06/D07): GOL courtyard arcade + tower gallery, GEB arched heads, string courses and a solid
// stone cornice, the measured Biological Greenhouse (BOT 591884, ./greenhouse.ts) as a full replacement, and b04-OWNED
// textured PBR finishes (offline context colour/normal/roughness maps at metre UVs, ./textured-finish.ts) on GOL, GEB,
// BOT and the Washington pedestal/deck. Tints marked "sampled" are mean pixels of the UT directory photographs
// (overcast, research references only); the rest are reference-interpreted. Glass/frames/doors stay borrowed.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Point } from '../../types';
import type { BlockInstall, BlockModule } from '../types';
import { buildInfill, type InfillSpec } from './historic-infill';
import { buildWashington } from './washington';
import { BOT_SPEC, BOT_MATERIALS } from './greenhouse';
import { TexturedFinish } from './textured-finish';

/** LiDAR (USGS 3DEP TX_Central_B1_2017) groundY + tier/percentile heights, roofs-lidar.json. */
export const B04_LIDAR = {
  GOL: { groundY: 11.2, main: 16.0, east: 6.2, tower: 20.4, p95: 20.7, max: 23.8, pitchDeg: 25.8 },
  GEB: { groundY: 11.0, deck: 22.1, p95: 22.9, max: 24.6 },
} as const;

// Goldsmith Hall GIS ring (campus.json 734456): outer ring vertices in source order + courtyard.
const G: Point[] = [[-401.41, 41.64], [-401.72, 45.05], [-406.63, 44.61], [-410.19, 84.65], [-408.57, 84.79], [-410.42, 105.61], [-397.89, 106.73], [-396.98, 96.55],
  [-393.27, 96.88], [-393.2, 96.07], [-368.72, 98.25], [-368.79, 99.02], [-358.73, 99.92], [-357.87, 90.16], [-358.61, 90.1], [-358.5, 88.75], [-357.75, 88.82],
  [-356.91, 79.46], [-357.41, 79.41], [-357.17, 76.69], [-357.8, 76.63], [-356.61, 63.23], [-356.13, 63.27], [-355.77, 59.24], [-355.19, 59.3], [-354.33, 49.62],
  [-388.49, 46.57], [-388.15, 42.82]];
const COURT = { nw: [-390.33, 56.53] as Point, ne: [-364.8, 58.64] as Point, se: [-366.49, 79.16] as Point, sw: [-392.02, 77.06] as Point };
/** Main hipped range: the outer ring with the courtyard + one-storey east range notched out (C plan). */
export const GOL_MAIN: Point[] = [...G.slice(0, 18), COURT.se, COURT.sw, COURT.nw, COURT.ne, ...G.slice(23)];
/** One-storey east range on the courtyard (LiDAR tier 6.2 m, x -366..-356, z 59..80). */
export const GOL_EAST: Point[] = [...G.slice(17, 24), COURT.ne, COURT.se];
/** Tower at the north-west corner (LiDAR tier 20.4 m over x -404..-388, z 42..57); 14 m deep along the wing axis. */
export const GOL_TOWER: Point[] = [[-401.41, 41.64], [-388.15, 42.82], [-389.39, 56.76], [-402.65, 55.58]];
export const GEB_RING: Point[] = [[-134.07, -38.1], [-134.12, -37.37], [-148.63, -38.42], [-148.54, -39.7], [-161.52, -40.64], [-163.13, -18.27], [-149.82, -17.31],
  [-149.61, -20.27], [-142.37, -19.74], [-142.5, -17.96], [-139.61, -17.75], [-139.49, -19.53], [-135.06, -19.21], [-135.3, -15.81], [-122.71, -14.9], [-121.1, -37.16]];

/** Walls sit 0.35 m inside the GIS line (registration scatter 0.6-0.9 m) so abutting paving/terrace
 * edges stay outside the 0.3 m route-clearance capsule. */
export const WALL_INSET = 0.35;
/** GEB: the integrator's tie-in infill fans ~0.2 m past the GIS line at the south recess's reflex corner
 * (shared-requests.json); 0.55 m keeps it outside the capsule and is still inside the scatter. */
export const GEB_INSET = 0.55;
const L = B04_LIDAR, slope = Math.tan(L.GOL.pitchDeg * Math.PI / 180);
const shared = { glass: 'Historic campus deep green glass', frame: 'Historic campus painted green steel', door: 'Historic campus dark wood doors' };
/** GOL courtyard faces (the inner ring of the C plan, and the east range's west face): round-arched ground floor
 * (ut-gol-576 directory photograph: arched openings and arched centre door on the courtyard). */
export const GOL_COURT_EDGES: [Point, Point][] = [[COURT.se, COURT.sw], [COURT.sw, COURT.nw], [COURT.nw, COURT.ne], [COURT.ne, COURT.se]];
export const GOL_GALLERY = { height: 2.8, bay: 3.3 };
export const GEB_CORNICE = { height: 0.95, projection: 0.42, dentils: true };

export const GOL_SPEC: InfillSpec = {
  id: 734456, abbr: 'GOL', name: 'Goldsmith Hall', plinthHeight: 1.2,
  materials: { wall: 'Union warm coursed limestone', plinth: 'Union pale carved limestone', trim: 'Union pale carved limestone', roof: 'Union red clay barrel tiles', shadow: 'b04 GOL gallery recess shadow', ...shared },
  volumes: [
    // Doors (estimate): West Mall (north) face of the north range, and the east face of the east range.
    { rings: [GOL_MAIN], roof: 'hip', slope, roofMedian: L.GOL.groundY + L.GOL.main, ridgeMax: L.GOL.groundY + L.GOL.tower, inset: WALL_INSET, storey: 4.1, bay: 3.7, doors: [[-371.4, 48.1]],
      arches: [{ row: 0, edges: GOL_COURT_EDGES }] },
    { rings: [GOL_EAST], abuts: [GOL_MAIN], roof: 'hip', slope, roofMedian: L.GOL.groundY + L.GOL.east, inset: WALL_INSET, storey: 4.1, bay: 3.4, doors: [[-357.2, 70.0]],
      arches: [{ row: 0, edges: GOL_COURT_EDGES }] },
    // Tower top storey: open gallery with balustrade under the eave (ut-gol-576; reference-interpreted, height estimate).
    { rings: [GOL_TOWER], roof: 'hip', slope, roofMedian: L.GOL.groundY + L.GOL.tower, ridgeMax: L.GOL.groundY + L.GOL.max, storey: 4.1, bay: 3.3, outset: 0.08, inset: WALL_INSET, windowBottom: L.GOL.groundY + L.GOL.main,
      gallery: GOL_GALLERY },
  ],
};
export const GEB_SPEC: InfillSpec = {
  id: 734466, abbr: 'GEB', name: 'Dorothy L. Gebauer Building', plinthHeight: 1.4,
  materials: { wall: 'Historic campus buff varied brick', plinth: 'Historic campus warm limestone', trim: 'Historic campus warm limestone', roof: 'Historic campus shadowed eaves', deck: 'Historic campus shadowed eaves', ...shared },
  // Flat deck at the LiDAR tier median, parapet to the LiDAR P95. ut-geb-433 directory photograph: round-arched windows
  // in the second row from the top with stone surrounds/keystones, stone string courses at the floor lines and a
  // projecting classical cornice with a dentil course just under the roof line, parapet above (reference-interpreted;
  // projection/height estimates). The cornice top sits at the deck (0.05 m under it) so the measured parapet stays.
  volumes: [{ rings: [GEB_RING], roof: 'flat', deck: L.GEB.groundY + L.GEB.deck, parapet: +(L.GEB.p95 - L.GEB.deck).toFixed(2), inset: GEB_INSET, storey: 4.0, bay: 3.4, firstSill: 1.0,
    doors: [[-141.4, -37.9], [-162.3, -29.5]], arches: [{ row: 1, fromTop: true }], stringCourses: true,
    cornice: { below: +(L.GEB.p95 - L.GEB.deck + 0.05).toFixed(2), ...GEB_CORNICE } }],
};

export const block: BlockModule = {
  id: 'b04-tower',
  install(ctx) {
    const started = performance.now();
    // b04-owned textured finishes (one texture set per family, shared); names stay the spec keys' meshes.
    const tex = new TexturedFinish(ctx.renderer);
    const plain = (name: string, color: number, roughness: number, metalness = 0) => { const m = new THREE.MeshStandardMaterial({ name, color, roughness, metalness }); tex.materials.push(m); return m; };
    const own: Record<string, THREE.Material> = {
      'Union warm coursed limestone': tex.material('limestone', '#cbc2b7', 'b04 GOL coursed cream limestone (textured; ut-gol-576 sampled)'),
      'Union pale carved limestone': tex.material('limestone', '#d8d1c4', 'b04 GOL pale carved limestone trim (textured)'),
      'Union red clay barrel tiles': tex.material('clayTile', '#a4553d', 'b04 GOL red clay barrel tile roof (textured)'),
      'Historic campus buff varied brick': tex.material('buffBrick', '#b9a27c', 'b04 GEB buff brick (textured)'),
      'Historic campus warm limestone': tex.material('limestone', '#d3c8af', 'b04 GEB limestone base, courses and cornice (textured)'),
      'b04 GOL gallery recess shadow': plain('b04 GOL gallery recess shadow', 0x2b2724, 1),
      [BOT_MATERIALS.knee]: tex.material('stucco', '#d9d8d0', 'b04 BOT white painted knee wall (textured)', { roughnessScale: 0.9 }),
      [BOT_MATERIALS.glazing]: plain(BOT_MATERIALS.glazing, 0x8fa29c, 0.08, 0.15),
      [BOT_MATERIALS.steel]: plain(BOT_MATERIALS.steel, 0xeeede6, 0.45),
    };
    const lookup = (name: string) => own[name] ?? ctx.material(name);
    const results = [GOL_SPEC, GEB_SPEC, BOT_SPEC].map(s => buildInfill(s, ctx.groundHeight, lookup, ctx.physics));
    // Merge visual trim by material across both buildings (draw calls); solids stay per building.
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const r of results) for (const m of r.detail) { const list = byMat.get(m.material as THREE.Material) ?? []; list.push(m.geometry); byMat.set(m.material as THREE.Material, list); }
    const detail: THREE.Mesh[] = [], owned: THREE.BufferGeometry[] = [];
    for (const [material, parts] of byMat) {
      const g = mergeGeometries(parts); if (!g) throw new Error('b04 trim merge failed');
      for (const p of parts) p.dispose();
      const mesh = new THREE.Mesh(g, material); mesh.name = `b04 historic infill trim ${material.name}`; mesh.receiveShadow = true; mesh.userData.block = 'b04-tower'; detail.push(mesh); owned.push(g);
    }
    const solids = results.flatMap(r => r.solids);
    for (const r of results) owned.push(...r.geometries.filter(g => solids.some(s => s.geometry === g)));
    const colliders = results.flatMap(r => r.colliders);
    // Round 2b: George Washington (Coppini 1955) at the head of the South Mall (./washington.ts).
    const ownedMaterials = [
      new THREE.MeshStandardMaterial({ name: 'b04 Washington bronze patina', color: 0x4b4a3a, roughness: .52, metalness: .55, side: THREE.DoubleSide }), // open garment shells are visible from both sides
      tex.material('limestone', '#cfc8b6', 'b04 Washington pale limestone pedestal (textured)'),
      tex.material('limestone', '#c9c0aa', 'b04 Washington deck limestone (textured)', { roughnessScale: 1.05 }),
    ];
    const surfaceAt = (x: number, z: number) => {
      const rc = new THREE.Raycaster(new THREE.Vector3(x, 60, z), new THREE.Vector3(0, -1, 0), 0, 80);
      const hit = rc.intersectObject(ctx.authored.surfaces, true)[0];
      return Math.min(hit ? hit.point.y : Infinity, ctx.groundHeight(x, z));
    };
    const apronFinish = ctx.material('Main Mall pale limestone paving');  // borrowed (central-malls owns it); never disposed here
    const wash = buildWashington(ctx.physics, { bronze: ownedMaterials[0], stone: ownedMaterials[1], deck: ownedMaterials[2] }, surfaceAt,
      apronFinish ? { height: (x, z) => ctx.terrainHeight(x, z) + .08, material: apronFinish } : undefined);
    if (!apronFinish) throw new Error('b04: Main Mall paving material missing (central-malls)');
    solids.push(...wash.solids); detail.push(...wash.detail); colliders.push(...wash.colliders); owned.push(...wash.geometries);
    const install: BlockInstall & { replaced: string[] } = {
      solids, detail, colliders, walkable: wash.walkable,
      replaced: ['734456', '734466', '591884'],
      stats: { buildings: results.map(r => r.stats), washington: wash.stats, draws: solids.length + detail.length + wash.walkable.length,
        textured: tex.materials.filter(m => m.userData.family).map(m => ({ name: m.name, family: m.userData.family, tileM: m.userData.tileM, tint: m.userData.tint, textured: m.userData.textured })),
        installMs: Math.round(performance.now() - started) },
      dispose() {
        for (const c of colliders) if (ctx.physics.getCollider(c.handle)) ctx.physics.removeCollider(c, false);
        for (const g of owned) g.dispose();
        ownedMaterials[0].dispose(); tex.dispose();
      },
    };
    return install;
  },
};
