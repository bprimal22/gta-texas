// Block b11-south-medical: South campus: Dell Medical, Brackenridge, Trinity, MLK Blvd east.
// Owner-only file (research/whole-campus-92/BLOCKS.md).
// District wave (D23 / D24, research/whole-campus-92/district-agents-40): install() rebuilds two records whose
// identity the generated archetypes cannot express, each on its FROZEN City ring and context.json massing heights:
//  * 463088:8  Barbara Jordan State Office Building (D23): teal curtain wall, staggered two-storey white fins, floor
//    bands, Capitol Mall colonnade, east service base, parapet + mechanical enclosure (jordan.ts);
//  * 633570:818 John W. Hargis Hall (D24): exact planar hip roofs per frozen section, LiDAR-located cupola and north
//    tower, cream masonry walls with red-brick frieze/pilasters and segmental-arched windows (hargis.ts);
//  * 531887:350 a small post-2017 City structure ~1 m off Jordan's mall face, rebuilt as the generator would (plain 3 m
//    box) because the authored Jordan wall would otherwise suppress it via the context coverage rule (jordan.ts).
// Every solid triangle is also in the block's trimesh collider (render = collision); windows, mullions and door panels
// are flush visual detail. Material pass (materials.ts): triangles are re-bucketed by authored colour into PBR families
// (limestone / brown brick / precast / metal with the offline context maps and metre UVs; clean glass; plain trim);
// the collider is still built from the kit's solid buckets, so geometry and collision are unchanged.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { BlockInstall, BlockModule } from '../types';
import { Kit } from './kit';
import { byFamily, familyGeometry, createFamilyMaterials } from './materials';
import { buildJordan, buildMallStructure } from './jordan';
import { buildHargis } from './hargis';

export const block: BlockModule = {
  id: 'b11-south-medical',
  install(ctx): BlockInstall {
    const started = performance.now();
    const k = new Kit(), stats: Record<string, unknown> = {};
    const replaced = [buildJordan(k, ctx.data, ctx.groundHeight, stats), buildMallStructure(k, ctx.data, ctx.groundHeight, stats), buildHargis(k, ctx.data, ctx.groundHeight, stats)];
    k.flushFaces();
    const fam = createFamilyMaterials(ctx.renderer), geometries: THREE.BufferGeometry[] = [], colliders: RAPIER.Collider[] = [];
    const familyStats: Record<string, number> = {};
    const meshes = (role: 'solid' | 'detail') => [...byFamily(role === 'solid' ? k.solid : k.detail)].map(([f, fb]) => {
      const geo = familyGeometry(fb); geometries.push(geo); familyStats[`${role}:${f}`] = fb.pos.length / 9;
      const o = new THREE.Mesh(geo, fam.get(f)); o.name = `b11 Barbara Jordan / Hargis Hall ${role} ${f}`;
      o.castShadow = role === 'solid'; o.receiveShadow = true; o.userData.block = 'b11-south-medical'; o.userData.family = f; return o;
    });
    try {
      const solids = meshes('solid'), detail = meshes('detail');
      const pos = new Float32Array([...k.solid.values()].flatMap(b => b.pos));
      colliders.push(ctx.physics.createCollider(RAPIER.ColliderDesc.trimesh(pos, Uint32Array.from({ length: pos.length / 3 }, (_v, i) => i), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.8)));
      const tris = (ms: THREE.Mesh[]) => ms.reduce((s, m) => s + m.geometry.getAttribute('position').count / 3, 0);
      return {
        solids, detail, colliders, replaced,
        stats: { ...stats, solidTriangles: tris(solids), detailTriangles: tris(detail), colliderTriangles: pos.length / 9, draws: solids.length + detail.length, colliders: colliders.length, materials: fam.materials.size, textures: fam.textures.length, families: familyStats, installMs: Math.round(performance.now() - started) },
        dispose() {
          for (const c of colliders) if (ctx.physics.getCollider(c.handle)) ctx.physics.removeCollider(c, false);
          for (const geo of geometries) geo.dispose();
          fam.dispose();
        },
      };
    } catch (e) {
      for (const c of colliders) if (ctx.physics.getCollider(c.handle)) ctx.physics.removeCollider(c, false);
      for (const geo of geometries) geo.dispose(); fam.dispose();
      throw e;
    }
  },
};
