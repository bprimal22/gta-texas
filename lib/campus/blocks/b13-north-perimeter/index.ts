// Block b13-north-perimeter: North perimeter (north of Dean Keeton band).
// Owner-only file (research/whole-campus-92/BLOCKS.md). District wave (D29-D33, research/whole-campus-92/district-agents-40):
// install() rebuilds the records whose identity the generated archetypes cannot express, each on its FROZEN City ring
// (holes / courtyards kept) with roof heights from the frozen context.json massing and the 2017 USGS 3DEP raster
// sections (see each builder's header for evidence and estimates):
//  * D29 734784:1264 / 654096:874  apartments: recessed window grid, brick base, belts, cornice, parapet + coping,
//    stacked balconies (654096), LiDAR-located penthouses / plant; 654096's courtyard stays open (d29.ts);
//  * D30 677852:991  Scottish Rite Dormitory: exact planar slate hips per measured section, gabled dormers, brick
//    chimneys at the raster maxima, limestone base / belt / cornice, flat annex with monitor (d30.ts);
//  * D31 717036:1152 courtyard apartments (measured hole kept open, fascia eave, court walls) and 529398:335 red-tile
//    hip house with shed / flat wings (d31.ts);
//  * D32 614187:743 / 569864:510 stuccoed houses: tile hips, NW porch with posts, window trim (d32.ts);
//  * D33 587556:560 buff-brick school: parapeted tiers, pilaster bay rhythm, LiDAR-located rooftop units (d33.ts).
// Every solid triangle is also in the block's trimesh collider (render = collision); only flush dormer glass is detail.
// Material pass (materials.ts): triangles are re-bucketed by authored colour into the offline CC0 PBR families with metre
// UVs and linear-mean neutralised tint; the collider is built from the kit's solid buckets, so geometry = collision.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { BlockInstall, BlockModule } from '../types';
import { Kit } from './kit';
import { byFamily, familyGeometry, createFamilyMaterials } from './materials';
import { buildD29 } from './d29';
import { buildD30 } from './d30';
import { buildD31 } from './d31';
import { buildD32 } from './d32';
import { buildD33 } from './d33';

export const B13_BUILDERS = [buildD29, buildD30, buildD31, buildD32, buildD33];

export const block: BlockModule = {
  id: 'b13-north-perimeter',
  install(ctx): BlockInstall {
    const started = performance.now();
    const k = new Kit(), stats: Record<string, unknown> = {};
    const built = B13_BUILDERS.flatMap(f => [f(k, ctx.data, ctx.groundHeight, stats)].flat());
    k.flushFaces();
    const fam = createFamilyMaterials(ctx.renderer), geometries: THREE.BufferGeometry[] = [], colliders: RAPIER.Collider[] = [];
    const familyStats: Record<string, number> = {};
    const meshes = (role: 'solid' | 'detail') => [...byFamily(role === 'solid' ? k.solid : k.detail)].map(([f, fb]) => {
      const geo = familyGeometry(fb); geometries.push(geo); familyStats[`${role}:${f}`] = fb.pos.length / 9;
      const o = new THREE.Mesh(geo, fam.get(f)); o.name = `b13 D29-D33 authored ${role} ${f}`;
      o.castShadow = role === 'solid'; o.receiveShadow = true; o.userData.block = 'b13-north-perimeter'; o.userData.family = f; return o;
    });
    try {
      const solids = meshes('solid'), detail = meshes('detail');
      const pos = new Float32Array([...k.solid.values()].flatMap(b => b.pos));
      colliders.push(ctx.physics.createCollider(RAPIER.ColliderDesc.trimesh(pos, Uint32Array.from({ length: pos.length / 3 }, (_v, i) => i), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.8)));
      const tris = (ms: THREE.Mesh[]) => ms.reduce((s, m) => s + m.geometry.getAttribute('position').count / 3, 0);
      return {
        solids, detail, colliders, replaced: built.map(b => b.key),
        stats: {
          ...stats, records: built.map(b => b.key), probes: built.flatMap(b => b.probes.map(p => ({ ...p, key: b.key }))),
          features: built.flatMap(b => b.features), courts: built.flatMap(b => b.courts),
          solidTriangles: tris(solids), detailTriangles: tris(detail), colliderTriangles: pos.length / 9,
          draws: solids.length + detail.length, colliders: colliders.length, materials: fam.materials.size, textures: fam.textures.length,
          textureUrls: [...new Set(fam.textures.map(t => t.userData.src as string))], families: familyStats, installMs: Math.round(performance.now() - started),
        },
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
