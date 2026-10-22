import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildHedgeBatches } from './hedge-batches';
import { treeForms } from './vegetation/oak-forms';
import { loadTreeMaterials, type TreeMaterials, disposeTreeMaterials } from './vegetation/tree-materials';
import { TreeBatches, bakeImpostors, AUTHORED_LODS, type PlacedTree, type ImpostorSet } from './vegetation/tree-batches';
import { fitTree, createCapsuleColliders, type Footprints, type FitResult } from './vegetation/tree-fit';
import type { GroundQuery } from './vegetation/ground-index';
import speedwayInventory from '../../public/data/speedway-tree-inventory.json' with { type: 'json' };

export type TreePlacement = {
  x: number;
  y: number;
  z: number;
  rotation: number;
  scale: number;
  width?: number;
  height?: number;
};
export type HedgePlacement = {
  a: [number,number]; b: [number,number]; y:number; endY:number; width:number; height:number;
};

/** Legacy sizing contract of authored placements: the former island_tree_02
 * model was 8.5155 m tall and ~12.2 m wide at scale 1 (3.1/2.5 axis scales). */
const LEGACY_HEIGHT = 3.4062 * 2.5, LEGACY_RADIUS = 1.97 * 3.1;
/** Authored placements were deliberately capped small; mature campus live
 * oaks are larger. Estimate, not measured per tree. */
const MATURE_HEIGHT = 1.15, MATURE_RADIUS = 1.2;

export interface TreeEnvironment {
  ground: GroundQuery;
  footprints?: Footprints;
  renderer?: THREE.WebGLRenderer;
  materials?: TreeMaterials;
  impostors?: ImpostorSet | null;
}

/**
 * Authored campus trees. `load` keeps every authored placement and builds the
 * unchanged hedge cells/colliders; `finish` (called once authored ground,
 * terrain and context exist) fits procedural live-oak forms to each placement,
 * creates trunk/limb capsule colliders that keep 2.4 m head clearance over
 * walkable ground, and draws all trees in three instanced BatchedMesh calls.
 */
export class ForegroundTrees {
  group = new THREE.Group();
  private hedgeMeshes: THREE.InstancedMesh[] = [];
  private hedgeDispose: (() => void) | null = null;
  private hedgeUpdate: ((camera: THREE.Vector3) => void) | null = null;
  private cameraPosition = new THREE.Vector3();
  private hedgeTextures: THREE.Texture[] = [];
  private colliders: RAPIER.Collider[] = [];
  private disposed = false;
  private placements: TreePlacement[] = [];
  batches: TreeBatches | null = null;
  private ownedMaterials: TreeMaterials | null = null;
  fits: FitResult[] = [];
  targets: { height: number; radius: number; measured: boolean }[] = [];
  placed: PlacedTree[] = [];
  count = 0;
  colliderCount = 0;
  hedgeStats: ReturnType<typeof buildHedgeBatches>['stats'] | null = null;
  constructor(private physics: RAPIER.World, private renderer?: THREE.WebGLRenderer) {
    this.group.name = 'Foreground live oaks and hedges';
  }
  async load(placements: TreePlacement[], hedges: HedgePlacement[] = []) {
    this.placements = placements;
    // Hedges keep the exact original cells and colliders; their leaf maps are
    // the same island_tree_02 (CC0) leaf textures the old tree GLB carried.
    const textures = (url: string, srgb: boolean) => {
      const t = typeof document !== 'undefined' && typeof (globalThis as { Image?: unknown }).Image === 'function'
        ? new THREE.TextureLoader().load(url) : new THREE.Texture();
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      // glTF convention of the former source material.
      t.flipY = false;
      this.hedgeTextures.push(t);
      return t;
    };
    const sourceLeaf = new THREE.MeshStandardMaterial({ name: 'island_tree_02_leaves',
      map: textures('/assets/foreground-tree/textures/island_tree_02_leaves_diff_1k.jpg', true),
      normalMap: textures('/assets/foreground-tree/textures/island_tree_02_leaves_nor_gl_1k.jpg', false) });
    const hedge = buildHedgeBatches(hedges, sourceLeaf);
    sourceLeaf.dispose();
    this.hedgeDispose = () => hedge.dispose();
    this.hedgeUpdate = position => hedge.update(position);
    for (const mesh of hedge.batches) { this.group.add(mesh); this.hedgeMeshes.push(mesh); }
    this.hedgeStats = hedge.stats;
    for (const p of hedge.cells) this.colliders.push(this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(p.width * .43, p.height * .45, p.width * .43).setTranslation(p.x, p.y + p.height * .45, p.z)));
    this.count = placements.length;
  }

  /** Target height/radius for an authored placement (inventory when known). */
  static target(p: TreePlacement) {
    const inv = speedwayInventory.trees.find(t => Math.abs(t.x - p.x) < .05 && Math.abs(t.z - p.z) < .05);
    if (inv) return { height: inv.heightMetres, radius: inv.heightMetres * .78, measured: true };
    const height = LEGACY_HEIGHT * p.scale * (p.height ?? 1) * MATURE_HEIGHT;
    const radius = LEGACY_RADIUS * p.scale * (p.width ?? 1) * MATURE_RADIUS;
    return { height, radius, measured: false };
  }

  async finish(env: TreeEnvironment) {
    if (this.disposed || this.batches) return;
    const forms = treeForms();
    this.fits = [];
    this.placed = [];
    for (const [i, p] of this.placements.entries()) {
      const target = ForegroundTrees.target(p);
      this.targets.push(target);
      const fit = fitTree(forms, { x: p.x, y: p.y, z: p.z, rotation: p.rotation, height: target.height, radius: target.radius,
        // Authored mall/Speedway trees are live oaks unless explicitly narrow.
        kind: target.radius / target.height >= .38 ? 'live-oak' : 'any',
        seed: Math.round(p.x * 7.13 + p.z * 3.71 + i) }, env.ground, env.footprints);
      this.fits.push(fit);
      this.placed.push({ x: p.x, y: p.y, z: p.z, rotation: fit.rotation, scale: fit.scale, form: fit.form,
        tint: .9 + .2 * ((Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453) % 1 + 1) % 1 });
      const colliders = createCapsuleColliders(this.physics, fit.capsules);
      this.colliders.push(...colliders);
      this.colliderCount += colliders.length;
    }
    const renderer = env.renderer ?? this.renderer;
    const materials = env.materials ?? (this.ownedMaterials = await loadTreeMaterials(renderer));
    if (this.disposed) { if (this.ownedMaterials) disposeTreeMaterials(this.ownedMaterials); return; }
    const impostors = env.impostors !== undefined ? env.impostors : renderer ? bakeImpostors(renderer, forms, materials) : null;
    this.batches = new TreeBatches(this.placed, forms, materials, AUTHORED_LODS, impostors, 'Authored live oaks');
    this.group.add(this.batches.group);
  }

  /** Physics handles of every tree/hedge collider (for checks and snapshots). */
  get colliderHandles() { return this.colliders.map(c => c.handle); }

  stats() {
    return {
      authoredPlacements: this.placements.length,
      fitted: this.fits.length,
      unresolved: this.fits.filter(f => f.unresolved).length,
      inventoryMatched: this.targets.filter(t => t.measured).length,
      reducedScale: this.fits.filter((f, i) => f.scale * treeForms()[f.form].spec.height < this.targets[i].height * .999).length,
      woodViolations: this.fits.reduce((a, f) => a + f.woodViolations, 0),
      unresolvedTrees: this.fits.flatMap((f, i) => f.unresolved ? [{ x: +this.placed[i].x.toFixed(1), z: +this.placed[i].z.toFixed(1), wood: f.woodViolations, form: f.form, scale: +f.scale.toFixed(2) }] : []),
      foliageOverPavingBelow2_2m: this.fits.reduce((a, f) => a + f.foliagePaved, 0),
      forms: this.placed.reduce<Record<number, number>>((a, t) => { a[t.form] = (a[t.form] ?? 0) + 1; return a; }, {}),
      treeColliders: this.colliderCount,
      lodCounts: this.batches?.counts.slice() ?? null,
      lodTriangles: this.batches?.triangleEstimate() ?? null,
      hedges: this.hedgeStats,
    };
  }

  update(camera: THREE.Camera) {
    this.batches?.update(camera);
    this.hedgeUpdate?.(camera.getWorldPosition(this.cameraPosition));
  }

  dispose() {
    this.disposed = true;
    this.group.removeFromParent();
    for (const collider of this.colliders) this.physics.removeCollider(collider, true);
    this.colliders = [];
    this.batches?.dispose();
    this.hedgeMeshes = [];
    this.hedgeDispose?.();
    for (const t of this.hedgeTextures) t.dispose();
    if (this.ownedMaterials) disposeTreeMaterials(this.ownedMaterials);
  }
}
