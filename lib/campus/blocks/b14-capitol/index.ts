// Block b14-capitol: Capitol + downtown context south of 15th.
// Owner-only file (research/whole-campus-92/BLOCKS.md; evidence in research/whole-campus-92/b14-capitol/).
//
// The Capitol itself stays in walkway.ts via its owned modules (capitol-area.ts / capitol-dome.ts).
// install() adds the ground of the south strip z 1288..1536 that game.ts opens for the Capitol but which the
// root terrain data do not cover (strip-ground.ts: 2017 USGS 3DEP DTM, seam-matched to the baked terrain at
// z 1288 and to the authored Capitol grounds edge, cut out of the grounds). Visible mesh and trimesh collider are
// the same triangles. The City 2023 footprints standing on it are context.json add[] records (generated context).
// Group 4 (district wave D34-D36): three records rebuilt on their frozen rings / heights with source-visible
// articulation (district.ts) in local PBR families (pbr.ts); every district solid triangle is also in one district
// trimesh collider (render = collision); flush window detail is visual only.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { BlockModule } from '../types';
import { buildStripGroundGeometry } from './strip-ground';
import { Kit } from './kit';
import { buildDistrict } from './district';
import { byFamily, familyGeometry, createFamilyMaterials } from './pbr';

export const block: BlockModule = {
  id: 'b14-capitol',
  install: ctx => {
    const started = performance.now();
    const ground = buildStripGroundGeometry();
    const material = ctx.material('Campus terrain lawn');
    if (!material) throw new Error('b14: terrain lawn material missing');
    const mesh = new THREE.Mesh(ground.geometry, material);
    mesh.name = 'b14 south strip ground (USGS 3DEP DTM)';
    mesh.receiveShadow = true; mesh.castShadow = false;
    // Terrain, not an authored route: the context coverage raster must not read it as walkable authored ground
    // (that would suppress every building standing on it as 'route'), exactly as it skips the baked terrain.
    mesh.userData.localContext = true;
    const colliders = [ctx.physics.createCollider(RAPIER.ColliderDesc.trimesh(ground.positions, ground.indices).setFriction(0.8))];
    const geometries: THREE.BufferGeometry[] = [ground.geometry], fam = createFamilyMaterials(ctx.renderer);
    const release = () => { for (const c of colliders) if (ctx.physics.getCollider(c.handle)) ctx.physics.removeCollider(c, false); for (const geo of geometries) geo.dispose(); fam.dispose(); };
    try {
      const stats: Record<string, unknown> = {}, k = new Kit(), replaced = buildDistrict(k, ctx.data, ctx.groundHeight, stats);
      k.flushFaces();
      const familyStats: Record<string, number> = {};
      const meshes = (role: 'solid' | 'detail') => [...byFamily(role === 'solid' ? k.solid : k.detail)].map(([f, fb]) => {
        const geo = familyGeometry(fb); geometries.push(geo); familyStats[`${role}:${f}`] = fb.pos.length / 9;
        const o = new THREE.Mesh(geo, fam.get(f)); o.name = `b14 district ${role} ${f}`;
        o.castShadow = role === 'solid'; o.receiveShadow = true; o.userData.block = 'b14-capitol'; o.userData.family = f; return o;
      });
      const solids = meshes('solid'), detail = meshes('detail');
      const pos = new Float32Array([...k.solid.values()].flatMap(b => b.pos));
      colliders.push(ctx.physics.createCollider(RAPIER.ColliderDesc.trimesh(pos, Uint32Array.from({ length: pos.length / 3 }, (_v, i) => i), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.8)));
      const tris = (ms: THREE.Mesh[]) => ms.reduce((s, m) => s + m.geometry.getAttribute('position').count / 3, 0);
      return {
        walkable: [mesh], solids, detail, colliders, replaced,
        stats: {
          stripGround: { triangles: ground.triangles, clippedTriangles: ground.clipped, droppedInGroundsOrFootprints: ground.dropped, footprintHoleTriangles: ground.holeTriangles, vertices: ground.positions.length / 3 },
          ...stats, districtFamilies: familyStats, solidTriangles: tris(solids), detailTriangles: tris(detail), districtColliderTriangles: pos.length / 9,
          draws: 1 + solids.length + detail.length, materials: 1 + fam.materials.size, ownedMaterials: fam.materials.size, textures: fam.textures.length, colliders: colliders.length, installMs: Math.round(performance.now() - started),
        },
        dispose: release,
      };
    } catch (e) { release(); throw e; }
  },
};
