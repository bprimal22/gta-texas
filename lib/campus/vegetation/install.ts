import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { BakedGround } from '../baked-ground';
import type { CampusData } from '../types';
import type { ForegroundTrees } from '../foreground-trees';
import { GroundIndex } from './ground-index';
import { Footprints } from './tree-fit';
import { treeForms } from './oak-forms';
import { loadTreeMaterials, disposeTreeMaterials } from './tree-materials';
import { bakeImpostors, headlessImpostors } from './tree-batches';
import { buildCanopyForest, loadCanopyData, loadTreeSites, type CanopyData, type TreeSitesData } from './canopy-forest';
import { applyCampusLawn, buildVegetationMask, isLawnMaterial, loadGroundTextures, type LawnStats } from './lawn';

export interface VegetationInstallOptions {
  physics: RAPIER.World;
  renderer?: T.WebGLRenderer;
  data: CampusData;
  /** walkway.trees (authored placements already loaded). */
  foreground?: ForegroundTrees;
  /** Authored walkable roots, e.g. [walkway.surfaces, world.group]. */
  walkable: T.Object3D[];
  /** Visual finishes lying on terrain (local mapped roads/paths): paved. */
  paved?: T.Object3D[];
  /** Baked terrain triangle soup (offline terrain positions) + contour fallback. */
  terrainPositions: ArrayLike<number>;
  terrainFallback: (x: number, z: number) => number;
  /** LiDAR canopy: data, 'fetch' (default, same-origin), or null to disable. */
  canopy?: CanopyData | null | 'fetch';
  /** UT TreeKeeper inventory sites: data, 'fetch' (default), or null. */
  treeSites?: TreeSitesData | null | 'fetch';
  /** Headless checks: impostor geometry without a renderer, for LOD stats. */
  headlessImpostors?: boolean;
  /** Decorate lawn materials under these roots (default: walkable). */
  lawnRoots?: T.Object3D[];
  /** Footprints of buildings newer than campus.json (extension/west-campus towers): no campus tree inside them. */
  extraFootprints?: { rings: [number, number][][] }[];
}

/** One call after walkway + offline terrain + local surfaces + local context. */
export async function installCampusVegetation(o: VegetationInstallOptions) {
  const started = performance.now();
  const group = new T.Group();
  group.name = 'Campus vegetation';
  const baked = new BakedGround(o.terrainPositions, 8, o.terrainFallback);
  const footprints = new Footprints([...o.data.buildings, ...(o.extraFootprints ?? [])]);
  const skip = (mesh: T.Mesh) => mesh.name === 'Offline local contour terrain';
  const ground = new GroundIndex({ roots: o.walkable, pavedOverlays: o.paved, isLawn: isLawnMaterial, skip,
    terrain: (x, z) => baked.sample(x, z) ?? o.terrainFallback(x, z) });
  const materials = await loadTreeMaterials(o.renderer);
  const forms = treeForms();
  const impostors = (o.renderer ? bakeImpostors(o.renderer, forms, materials) : null) ?? (o.headlessImpostors ? headlessImpostors(forms) : null);
  await o.foreground?.finish({ ground, footprints, renderer: o.renderer, materials, impostors });
  const [canopyData, sites] = await Promise.all([
    o.canopy === undefined || o.canopy === 'fetch' ? loadCanopyData() : Promise.resolve(o.canopy),
    o.treeSites === undefined || o.treeSites === 'fetch' ? loadTreeSites() : Promise.resolve(o.treeSites)]);
  const authored = (o.foreground?.placed ?? []).map(t => ({ x: t.x, z: t.z }));
  // Official sites first, residual CHM outside inventory coverage, OSM where
  // neither exists (see canopy-forest.ts).
  const canopy = buildCanopyForest({ sites, canopy: canopyData, osm: o.data.trees, physics: o.physics, ground, footprints, authored, materials, impostors });
  group.add(canopy.group);
  // Ground: lawn shader + campus vegetation mask from every placed tree.
  const allTrees = [...(o.foreground?.placed ?? []).map(t => ({ ...t, hero: true })), ...(canopy.placed ?? []).map(t => ({ ...t, hero: false }))];
  const mask = buildVegetationMask(o.data.bounds, allTrees.map(t => ({ x: t.x, z: t.z, radius: forms[t.form].spec.radius * t.scale, hero: t.hero })));
  let lawn: LawnStats | null = null;
  const groundTextures = await loadGroundTextures(o.renderer);
  lawn = applyCampusLawn(o.lawnRoots ?? o.walkable, { mask, textures: groundTextures });
  const installMs = Math.round(performance.now() - started);
  const stats = () => ({
    installMs,
    groundIndex: { triangles: ground.triangles, buildMs: Math.round(ground.buildMs) },
    authored: o.foreground?.stats() ?? null,
    canopy: canopy.stats(),
    impostors: !!impostors, lawn,
  });
  return {
    group, ground, footprints, canopy, stats,
    /** Shared with extension tree populations (deep-west canopy); owned and disposed here. */
    forms, materials, impostors,
    update(camera: T.Camera) { canopy.update(camera); },
    dispose() {
      group.removeFromParent();
      canopy.dispose();
      impostors?.target.dispose(); impostors?.material.dispose(); impostors?.geometries.forEach(g => g.dispose());
      mask.texture.dispose();
      groundTextures.dispose();
      disposeTreeMaterials(materials);
    },
  };
}
