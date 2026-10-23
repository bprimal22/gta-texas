// West Campus additions (West Campus pass, 2026-10-23): two post-2023 towers and the Deep West LiDAR canopy.
// Opt-in and fail-closed like the other extensions: the caller installs it after the campus vegetation and the deep-west
// extension; any failure leaves the world exactly as before. Union on 24th crosses the deep-west seam, so it (and the
// Deep West trees) are built only when the deep-west extension is loaded; Villas on 24th stands inside b12 on the
// original terrain. Solid tower triangles are the trimesh collider (render = collision); facade panels, ribs, pleats,
// deck finishes and railings are visual detail; trees collide by trunk capsules only.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Point } from '../../types';
import { Kit, inRing, ringDist, type Mat } from '../../blocks/b12-west-campus/kit';
import type { TreeForm } from '../../vegetation/oak-forms';
import type { TreeMaterials } from '../../vegetation/tree-materials';
import type { ImpostorSet, TreeBatches } from '../../vegetation/tree-batches';
import { createCapsuleColliders } from '../../vegetation/tree-fit';
import { validateWestCampus, WEST_CAMPUS_URL, UNION_KEY, VILLAS_KEY, type TreeRecord, type WestCampusData } from './format';
import { buildUnion, buildVillas, type TowerReport } from './towers';
import { planDeepWestTrees, deepWestTreeBatches, type DeepWestTreePlan } from './trees';

export { WEST_CAMPUS_URL } from './format';

export interface PreparedWestCampus { data: WestCampusData; trees: TreeRecord[]; bytes: number; fetchMs: number }

/** Fetch + validate (no deep-west bounds yet: trees are re-validated against them in build). Throws on any problem. */
export async function prepareWestCampus(signal?: AbortSignal, url = WEST_CAMPUS_URL): Promise<PreparedWestCampus> {
  if (!url.startsWith('/') || url.startsWith('//')) throw Error('West Campus asset must be same-origin');
  const t0 = performance.now();
  const response = await fetch(url, { signal });
  if (!response.ok) throw Error(`West Campus asset load failed: ${response.status}`);
  const text = await response.text();
  const { data, trees } = validateWestCampus(JSON.parse(text), null);
  return { data, trees, bytes: text.length, fetchMs: Math.round(performance.now() - t0) };
}

/** Tower footprints (for the campus vegetation exclusion, map and travel): known as soon as the asset is prepared. */
export const towerFootprints = (p: PreparedWestCampus, deepWestLoaded: boolean) =>
  p.data.towers.filter(t => deepWestLoaded || t.key !== UNION_KEY).map(t => ({ key: t.key, rings: [t.ring] as Point[][] }));

export interface WestCampusGeometry { kit: Kit; towers: TowerReport[] }
/** Pure tower geometry (no GPU, no physics): used by the game and by Node checks. */
export function buildWestCampusTowers(data: WestCampusData, ground: (x: number, z: number) => number, deepWestLoaded: boolean): WestCampusGeometry {
  const kit = new Kit(), towers: TowerReport[] = [];
  for (const t of data.towers) {
    if (t.key === UNION_KEY && deepWestLoaded) towers.push(buildUnion(kit, t, ground));
    if (t.key === VILLAS_KEY) towers.push(buildVillas(kit, t, ground));
  }
  kit.flushFaces();
  return { kit, towers };
}

const MATS: Record<Mat, { roughness: number; metalness: number }> = {
  matte: { roughness: .82, metalness: 0 }, glass: { roughness: .12, metalness: .1 }, metal: { roughness: .42, metalness: .45 }, paving: { roughness: .93, metalness: 0 },
};

export interface WestCampusInstallOptions {
  prepared: PreparedWestCampus;
  /** Borrowed full-color environment; glass keeps its own reflection strength. */
  reflection?: THREE.Texture;
  physics: RAPIER.World;
  /** Game ground height (deep-west extension where it owns x, else the original terrain). */
  ground: (x: number, z: number) => number;
  deepWest: { bounds: { xmin: number; xmax: number; zmin: number; zmax: number }; height: (x: number, z: number) => number | null } | null;
  vegetation: { forms: TreeForm[]; materials: TreeMaterials; impostors: ImpostorSet | null } | null;
}

export class WestCampus {
  /** Solid tower meshes (= the trimesh collider): the caller adds them under world.group (ground / travel probes see them). */
  readonly group = new THREE.Group();
  /** Visual-only facade detail and the Deep West canopy: scenery, never a travel / scooter / landing floor. Scene child. */
  readonly decor = new THREE.Group();
  readonly towers: TowerReport[];
  readonly footprints: { key: string; rings: Point[][] }[];
  readonly travelRegion: { contains: (p: Point) => boolean; footprints: Point[][][]; outdoor: (p: Point) => boolean; paths: Point[][] };
  readonly trees: TreeBatches | null = null;
  readonly treePlan: DeepWestTreePlan | null = null;
  /** Exactly the solid tower triangles (also rendered): the trimesh collider. */
  readonly colliderPositions: Float32Array;
  private readonly colliders: RAPIER.Collider[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly mapPath: Path2D | null = null;
  private disposed = false;
  readonly stats: Record<string, unknown>;

  constructor(private readonly o: WestCampusInstallOptions) {
    const started = performance.now();
    this.group.name = 'West Campus towers (Union on 24th, Villas on 24th): solids';
    this.decor.name = 'West Campus scenery (tower facade detail, Deep West canopy)';
    const deepWestLoaded = !!o.deepWest;
    const { data } = o.prepared;
    try {
      const { kit, towers } = buildWestCampusTowers(data, o.ground, deepWestLoaded);
      this.towers = towers;
      this.footprints = towerFootprints(o.prepared, deepWestLoaded);
      const mats = new Map<Mat, THREE.MeshStandardMaterial>();
      const mat = (m: Mat) => {
        let x = mats.get(m);
        if (!x) { x = new THREE.MeshStandardMaterial({ ...MATS[m], vertexColors: true, envMap: m === 'glass' ? o.reflection ?? null : null, envMapIntensity: m === 'glass' ? .5 : 1 }); x.name = `West Campus towers ${m} (vertex colours)`; mats.set(m, x); this.materials.push(x); }
        return x;
      };
      for (const [role, buckets] of [['solid', kit.solid], ['detail', kit.detail]] as const) for (const [m, b] of buckets) {
        if (!b.triangles) continue;
        const geo = b.geometry(); this.geometries.push(geo);
        const mesh = new THREE.Mesh(geo, mat(m));
        mesh.name = `West Campus towers ${role} ${m}`; mesh.castShadow = role === 'solid'; mesh.receiveShadow = true;
        mesh.userData.westCampus = { role, material: m };
        (role === 'solid' ? this.group : this.decor).add(mesh);
      }
      this.colliderPositions = new Float32Array([...kit.solid.values()].flatMap(b => b.pos));
      if (this.colliderPositions.length) this.colliders.push(o.physics.createCollider(RAPIER.ColliderDesc.trimesh(this.colliderPositions,
        Uint32Array.from({ length: this.colliderPositions.length / 3 }, (_v, i) => i), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(.8)));
      // Deep West canopy: needs the deep-west terrain and the campus tree forms / materials.
      if (o.deepWest && o.vegetation) {
        const { trees } = validateWestCampus(data, o.deepWest.bounds);
        const plan = planDeepWestTrees(trees, o.vegetation.forms, (x, z) => o.deepWest!.height(x, z));
        this.treePlan = plan;
        this.trees = deepWestTreeBatches(plan, o.vegetation.forms, o.vegetation.materials, o.vegetation.impostors);
        this.decor.add(this.trees.group);
        this.colliders.push(...createCapsuleColliders(o.physics, plan.capsules));
      }
      const near = (p: Point) => this.footprints.some(f => inRing(p[0], p[1], f.rings[0]) || ringDist(p[0], p[1], f.rings[0]) < 1.5);
      // Walkable loops 7 m outside each footprint (street / sidewalk side): campus.json has no paths west of the seam.
      const loops = this.footprints.map(f => offsetLoop(f.rings[0], 7, 5));
      this.travelRegion = { contains: near, footprints: this.footprints.map(f => f.rings), outdoor: () => false, paths: loops };
      if (typeof Path2D !== 'undefined') {
        const path = new Path2D();
        for (const f of this.footprints) { f.rings[0].forEach(([x, z], i) => i ? path.lineTo(x, z) : path.moveTo(x, z)); path.closePath(); }
        this.mapPath = path;
      }
      const meshes = [...this.group.children, ...this.decor.children].filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && !!c.userData.westCampus);
      const tris = (role: string) => meshes.filter(c => c.userData.westCampus.role === role).reduce((s, c) => s + c.geometry.getAttribute('position').count / 3, 0);
      this.stats = {
        loaded: true, towers: towers.map(t => ({ key: t.key, name: t.name, bottom: +t.bottom.toFixed(2), podiumTop: +t.podiumTop.toFixed(2), roofY: +t.roofY.toFixed(2), topY: t.topY, floors: t.floors, detail: t.detail })),
        solidTriangles: tris('solid'), detailTriangles: tris('detail'), colliderTriangles: this.colliderPositions.length / 9,
        towerDraws: meshes.length, materials: this.materials.length,
        trees: this.treePlan ? { placed: this.treePlan.placed.length, capsules: this.treePlan.capsules.length, reducedScale: this.treePlan.reduced, skipped: this.treePlan.skipped, draws: this.trees!.impostor ? 3 : 2 } : null,
        asset: { url: WEST_CAMPUS_URL, bytes: o.prepared.bytes, fetchMs: o.prepared.fetchMs }, installMs: Math.round(performance.now() - started),
        claims: data.claims,
      };
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  update(camera: THREE.Camera) { if (!this.disposed) this.trees?.update(camera); }

  drawMap(ctx: CanvasRenderingContext2D) {
    if (!this.mapPath) return;
    ctx.save(); ctx.fillStyle = '#c1bca6'; ctx.fill(this.mapPath); ctx.restore();
  }

  /** Live trimesh / capsule colliders (checks). */
  get colliderCount() { return this.colliders.length; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.decor.removeFromParent();
    for (const c of this.colliders) if (this.o.physics.getCollider(c.handle)) this.o.physics.removeCollider(c, false);
    this.colliders.length = 0;
    this.trees?.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

/** Points every `step` m along a ring (positive area), pushed `d` m outward along each edge normal; closed polyline. */
export function offsetLoop(ring: Point[], d: number, step: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < .5) continue;
    const nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L;
    for (let s = 0; s < L; s += step) out.push([a[0] + (b[0] - a[0]) * s / L + nx * d, a[1] + (b[1] - a[1]) * s / L + nz * d]);
  }
  if (out.length) out.push(out[0]);
  return out;
}
