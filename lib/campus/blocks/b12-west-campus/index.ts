// Block b12-west-campus: West of Guadalupe (West Campus, Drag).
// Owner-only file (research/whole-campus-92/BLOCKS.md; evidence: research/whole-campus-92/b12-west-campus/EVIDENCE.md and
// research/whole-campus-92/west-campus-dataset-pass/b12-implementation/NOTES.md).
// Round 2 (user-requested West Campus / Guadalupe pass): install() rebuilds seven City records whose identity the generator
// cannot express, each from its OWN measured / published massing (same rings, same tiers), plus authored identity detail:
//  * 733792:1248 Drag union W 23rd-W 22nd: University Co-op storefront subset (2246 Guadalupe) + separate shop fronts (coop.ts)
//  * 699548:1060 University Baptist Church sanctuary, 2130 Guadalupe: LiDAR cross of tiled gables + frontispiece (church.ts)
//  * 732897:1231 Moontower, 550397:416 Skyloft, 657418:943 The Castilian, 525341:252 2400 Nueces + Nueces Garage,
//    490461:139 Torre (towers.ts).
// Geometry uses three vertex-coloured materials (matte / glass / metal; <= 5 draw calls); every solid triangle is also in
// the block's trimesh collider (render = collision); flush window/sign panels are visual detail.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { BlockInstall, BlockModule } from '../types';
import { Kit, type Mat } from './kit';
import { buildCoop, COOP_KEY } from './coop';
import { buildChurch, CHURCH_KEY } from './church';
import { buildTowers } from './towers';
import { SLOT_REPORT } from './massing';
import { buildDistrict } from './district';
import { buildRetail } from './retail-identity';
import { byFamily, familyGeometry, createFamilyMaterials } from './pbr';
import { buildPaving } from './paving';

// Glass: low roughness and little metalness so the lit pane colours (dim interiors / warm displays) read through the
// reflection instead of collapsing to black (Codex build-11 review). Paving: draped visual-only sidewalk finish drawn
// over the terrain / mapped overlays it sits 1.5 cm above (polygon offset; no depth fighting with them).
const MATS: Record<Mat, { roughness: number; metalness: number }> = { matte: { roughness: 0.86, metalness: 0 }, glass: { roughness: 0.1, metalness: 0.08 }, metal: { roughness: 0.45, metalness: 0.5 }, paving: { roughness: 0.93, metalness: 0 } };
/** Restrained world-space surface detail (no textures): value noise at ~0.3 m and ~3 m modulates albedo by a few
 * percent and roughness by +-10 % (render / stucco / masonry grain and weathering on 'matte' and 'paving'),
 * fine vertical streaks on 'metal', a faint height gradient on 'glass'. Interpreted finish, not a material survey. */
const DETAIL: Record<Mat, string> = {
  matte: 'float n=b12Noise(b12P*3.1),m=b12Noise(b12P*.33); diffuseColor.rgb*=.955+.06*n+.05*(m-.5); b12R=.9+.2*n;',
  paving: 'float n=b12Noise(b12P*7.3),m=b12Noise(b12P*.45); diffuseColor.rgb*=.95+.07*n+.05*(m-.5); b12R=.92+.16*n;',
  metal: 'float n=b12Noise(vec3(b12P.x*9.,b12P.y*.6,b12P.z*9.)); diffuseColor.rgb*=.93+.12*n; b12R=.85+.3*n;',
  glass: 'float m=b12Noise(b12P*.21); diffuseColor.rgb*=.92+.12*m+.04*clamp(fract(b12P.y/3.)-.5,-.5,.5); b12R=.8+.4*m;',
};
const NOISE = `varying vec3 b12P;
float b12Hash(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float b12Noise(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
return mix(mix(mix(b12Hash(i),b12Hash(i+vec3(1,0,0)),f.x),mix(b12Hash(i+vec3(0,1,0)),b12Hash(i+vec3(1,1,0)),f.x),f.y),
mix(mix(b12Hash(i+vec3(0,0,1)),b12Hash(i+vec3(1,0,1)),f.x),mix(b12Hash(i+vec3(0,1,1)),b12Hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
`;
const withDetail = (m: THREE.MeshStandardMaterial, kind: Mat) => {
  m.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 b12P;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nb12P = position;');
    shader.fragmentShader = NOISE + shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\nfloat b12R = 1.;\n{ ' + DETAIL[kind] + ' }')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * b12R, .04, 1.);');
  };
  m.customProgramCacheKey = () => 'b12-detail-v1-' + kind;
  return m;
};

export const block: BlockModule = {
  id: 'b12-west-campus',
  install(ctx): BlockInstall {
    const started = performance.now();
    const k = new Kit(), stats: Record<string, unknown> = {};
    SLOT_REPORT.caps = 0;
    const g = ctx.groundHeight;
    buildCoop(k, ctx.data, g, stats);
    buildChurch(k, ctx.data, g, stats);
    const towers = buildTowers(k, ctx.data, g, stats);
    // Retail identities (retail-identity/): Raising Cane's, Chick-fil-A, P. Terry's, Domino's on their frozen City records (own private kit, appended to k).
    const retail = buildRetail(k, ctx.data, g, stats);
    // Measured ground paving (paving.ts): CoA 2023 sidewalks / plazas / patios / driveways / parking on ground that was
    // drawn as lawn; same 'paving' detail bucket (material, draw call) as the Co-op frontage.
    stats.paving = buildPaving(k.D('paving'), g);
    k.flushFaces();
    // Group 2 district bodies (district.ts): separate kit, PBR families (pbr.ts); collider shared below.
    const kp = new Kit(), district = buildDistrict(kp, ctx.data, g, stats);
    kp.flushFaces();
    const replaced = [COOP_KEY, CHURCH_KEY, ...towers, ...district, ...retail];
    const materials = new Map<Mat, THREE.MeshStandardMaterial>(), geometries: THREE.BufferGeometry[] = [], colliders: RAPIER.Collider[] = [];
    const fam = createFamilyMaterials(ctx.renderer), familyStats: Record<string, number> = {};
    const pbrMeshes = (role: 'solid' | 'detail') => [...byFamily(role === 'solid' ? kp.solid : kp.detail)].map(([f, fb]) => {
      const geo = familyGeometry(fb); geometries.push(geo); familyStats[`${role}:${f}`] = fb.pos.length / 9;
      const o = new THREE.Mesh(geo, fam.get(f)); o.name = `b12 district ${role} ${f}`;
      o.castShadow = role === 'solid'; o.receiveShadow = true; o.userData.block = 'b12-west-campus'; o.userData.family = f; return o;
    });
    const mat = (m: Mat) => { let x = materials.get(m); if (!x) { x = withDetail(new THREE.MeshStandardMaterial({ ...MATS[m], vertexColors: true }), m); x.name = `b12 ${m} (vertex colours)`; if (m === 'paving') { x.polygonOffset = true; x.polygonOffsetFactor = -2; x.polygonOffsetUnits = -2; } materials.set(m, x); } return x; };
    const mesh = (m: Mat, b: { geometry(): THREE.BufferGeometry }, role: 'solid' | 'detail') => {
      const geo = b.geometry(); geometries.push(geo);
      const o = new THREE.Mesh(geo, mat(m)); o.name = `b12 West Campus / Drag ${role} ${m}`;
      o.castShadow = role === 'solid'; o.receiveShadow = true; o.userData.block = 'b12-west-campus';
      // Ground paving is visual-only finish on the terrain, not authored walkable ground: skipped by the context coverage
      // raster (userData.localContext, as b05's D10 plaza) so it never turns a neighbouring generated footprint into 'route'.
      if (m === 'paving') { o.name = 'b12 West Campus / Drag sidewalk paving + measured CoA ground paving (visual, draped on terrain)'; o.userData.localContext = true; }
      return o;
    };
    try {
      const solids = [...[...k.solid].filter(([, b]) => b.triangles).map(([m, b]) => mesh(m, b, 'solid')), ...pbrMeshes('solid')];
      const detail = [...[...k.detail].filter(([, b]) => b.triangles).map(([m, b]) => mesh(m, b, 'detail')), ...pbrMeshes('detail')];
      const pos = new Float32Array([...k.solid.values(), ...kp.solid.values()].flatMap(b => b.pos));
      colliders.push(ctx.physics.createCollider(RAPIER.ColliderDesc.trimesh(pos, Uint32Array.from({ length: pos.length / 3 }, (_v, i) => i), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.8)));
      const tris = (ms: THREE.Mesh[]) => ms.reduce((s, m) => s + m.geometry.getAttribute('position').count / 3, 0);
      return {
        solids, detail, colliders, replaced,
        stats: { ...stats, slotCaps: SLOT_REPORT.caps, solidTriangles: tris(solids), detailTriangles: tris(detail), colliderTriangles: pos.length / 9, draws: solids.length + detail.length, colliders: colliders.length, materials: materials.size + fam.materials.size, textures: fam.textures.length, districtFamilies: familyStats, installMs: Math.round(performance.now() - started) },
        dispose() {
          for (const c of colliders) if (ctx.physics.getCollider(c.handle)) ctx.physics.removeCollider(c, false);
          for (const geo of geometries) geo.dispose();
          for (const m of materials.values()) m.dispose();
          fam.dispose();
        },
      };
    } catch (e) {
      for (const c of colliders) if (ctx.physics.getCollider(c.handle)) ctx.physics.removeCollider(c, false);
      for (const geo of geometries) geo.dispose(); for (const m of materials.values()) m.dispose(); fam.dispose();
      throw e;
    }
  },
};
