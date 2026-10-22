// Headless ground-edge probe for the hero route (MLK/East Mall -> Speedway ->
// Tower/Main, West Mall, South Mall, West 24th/Tower north, Flawn/Inner Campus).
// Builds the real authored walkway + baked offline terrain + local finishes
// (no context buildings, no vegetation: they do not change ground edges), then
// walks the outer boundary of every authored ground surface and measures the
// visible drop from the surface edge to whatever lies just outside it.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { Terrain } from '../../lib/campus/terrain';
import { capitolGroundReference } from '../../lib/campus/capitol-area';
import { CampusWorld } from '../../lib/campus/world';
import { materials } from '../../lib/campus/materials';
import { SpeedwayWalkway } from '../../lib/campus/walkway';
import { decodeOfflineTerrain } from '../../lib/campus/offline-terrain-loader';
import { decodeLocalSurfaces } from '../../lib/campus/local-surfaces';
import { BakedGround } from '../../lib/campus/baked-ground';
import { pointInPolygon, distanceToRings } from '../../lib/campus/context-geometry';
import type { CampusData, TerrainData } from '../../lib/campus/types';
import { buildGroundTieIns } from '../../lib/campus/ground/tie-ins';
import { heroRouteExtraGround, HERO_ROUTE_BOXES } from '../../lib/campus/ground/hero-route';
import { applyBlockData, installBlocks } from '../../lib/campus/blocks/registry';
import { ScooterClearance, SCOOTER_ENVELOPE } from '../../lib/campus/scooter-clearance';
import { LocalGroundQuery } from '../../lib/campus/local-ground-query';
import { SCOOTER_TUNING } from '../../lib/campus/scooter-motion';
import { RUN_SPEED } from '../../lib/campus/map-travel';
export { CAMERA_SHOTS } from '../../lib/campus/render/camera-shots';

const root = resolve(process.cwd());
const json = <T>(p: string) => JSON.parse(readFileSync(resolve(root, p), 'utf8')) as T;
const bin = (p: string) => { const b = gunzipSync(readFileSync(resolve(root, p))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

/** Hero-route boxes [x0, x1, z0, z1] (campus metres, Z south), shared with the tie-ins. */
export const HERO_BOXES = HERO_ROUTE_BOXES;
export const heroArea = (x: number, z: number) => {
  for (const [name, [x0, x1, z0, z1]] of Object.entries(HERO_BOXES)) if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return name;
  return null;
};

/** Meshes whose up-facing edges are intentional built steps (stairs, walls,
 * planter curbs, copings, lamp bases, benches, statue plinths, buildings). */
const INTENTIONAL = /stair|step|riser|tread|wall|coping|curb|kerb|planter|bench|lamp|base|plinth|pier|parapet|ledge|bollard|column|sphere|limestone|stone|masonry|facade|roof|window|sill|door|porch|portico|terrace|balustrade|rail|seat|fountain|sculpture|statue|memorial|pedestal|bin|tree|hedge|drain|grate|globe|metal|steel|mulch|bronze|brick|furnishing|banner/i;

export async function buildGroundScene() {
  await RAPIER.init();
  const physics = new RAPIER.World({ x: 0, y: -24, z: 0 });
  const data = json<CampusData>('public/data/campus.json');
  applyBlockData(data);
  const renderer = { capabilities: { getMaxAnisotropy: () => 8 } } as unknown as THREE.WebGLRenderer;
  const world = new CampusWorld(data, new Terrain(json<TerrainData>('public/data/terrain.json'), capitolGroundReference), physics, () => materials(renderer), renderer);
  const t0 = performance.now();
  const walkway = new SpeedwayWalkway(data, world.terrain, physics, renderer, true, true);
  const walkwayMs = performance.now() - t0;
  const terrain = decodeOfflineTerrain(bin('public/assets/campus/offline-terrain-61.bin.gz'), world.mat.grass);
  world.group.add(terrain.mesh);
  for (const g of terrain.colliderGeometries) world.collider(g);
  world.flush();
  const paving = walkway.materials.find(m => m.name === 'Speedway golden brick paving')!;
  const surfaces = decodeLocalSurfaces(bin('public/assets/campus/local-surfaces-61.bin.gz'),
    { asphalt: world.mat.asphalt, concrete: world.mat.concrete, speedway: paving });
  const baked = new BakedGround(terrain.mesh.geometry.getAttribute('position').array, 8, (x, z) => world.terrain.height(x, z));
  // Whole-campus block geometry as in CampusGame (before tie-ins, which addGroundTieIns builds).
  const blocks = installBlocks({
    data, physics, renderer, terrainHeight: (x, z) => world.terrain.height(x, z), groundHeight: (x, z) => baked.height(x, z),
    authored: { surfaces: walkway.surfaces, world: world.group },
    material: name => walkway.materials.find(m => m.name === name) ?? Object.values(world.mat).find(m => (m as THREE.Material).name === name) as THREE.Material | undefined,
  }, walkway.surfaces, world.group);
  const body = physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(114, 30, 64.4));
  const player = physics.createCollider(RAPIER.ColliderDesc.capsule(0.54, 0.34).setFriction(0), body);
  physics.step();
  return { RAPIER, physics, world, walkway, terrain, surfaces, baked, data, player, walkwayMs, blocks };
}
export type GroundScene = Awaited<ReturnType<typeof buildGroundScene>>;

type Tri = { ax: number; ay: number; az: number; bx: number; by: number; bz: number; cx: number; cy: number; cz: number; name: string; material: string };

/** Grid index of every up-facing visible triangle (walkway, world incl. baked terrain, local finishes). */
class SurfaceIndex {
  cells = new Map<number, Tri[]>();
  constructor(roots: THREE.Object3D[], private cell = 4, box?: [number, number, number, number]) {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    for (const r of roots) {
      r.updateWorldMatrix(true, true);
      r.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || !m.visible) return;
        const pos = m.geometry.getAttribute('position'), index = m.geometry.index, count = index ? index.count : pos.count;
        if (!pos) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (let t = 0; t + 2 < count; t += 3) {
          a.fromBufferAttribute(pos, index ? index.getX(t) : t).applyMatrix4(m.matrixWorld);
          b.fromBufferAttribute(pos, index ? index.getX(t + 1) : t + 1).applyMatrix4(m.matrixWorld);
          c.fromBufferAttribute(pos, index ? index.getX(t + 2) : t + 2).applyMatrix4(m.matrixWorld);
          if (box && (Math.max(a.x, b.x, c.x) < box[0] || Math.min(a.x, b.x, c.x) > box[1] || Math.max(a.z, b.z, c.z) < box[2] || Math.min(a.z, b.z, c.z) > box[3])) continue;
          n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
          const l = n.length();
          if (l < 1e-9 || Math.abs(n.y) / l < .5) continue;
          const tri: Tri = { ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, cx: c.x, cy: c.y, cz: c.z, name: m.name, material: mats[0]?.name ?? '' };
          const i0 = Math.floor(Math.min(a.x, b.x, c.x) / this.cell), i1 = Math.floor(Math.max(a.x, b.x, c.x) / this.cell);
          const j0 = Math.floor(Math.min(a.z, b.z, c.z) / this.cell), j1 = Math.floor(Math.max(a.z, b.z, c.z) / this.cell);
          if ((i1 - i0 + 1) * (j1 - j0 + 1) > 4096) continue;
          for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
            const k = (i + 32768) * 65536 + (j + 32768);
            let list = this.cells.get(k); if (!list) this.cells.set(k, list = []); list.push(tri);
          }
        }
      });
    }
  }
  /** Lowest visible up-facing surface at (x,z) strictly between `from` and `to`. */
  above(x: number, z: number, from: number, to: number) {
    const list = this.cells.get((Math.floor(x / this.cell) + 32768) * 65536 + (Math.floor(z / this.cell) + 32768));
    let best: number | null = null;
    if (list) for (const t of list) {
      const d = (t.bz - t.cz) * (t.ax - t.cx) + (t.cx - t.bx) * (t.az - t.cz);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((t.bz - t.cz) * (x - t.cx) + (t.cx - t.bx) * (z - t.cz)) / d, v = ((t.cz - t.az) * (x - t.cx) + (t.ax - t.cx) * (z - t.cz)) / d, w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      const y = u * t.ay + v * t.by + w * t.cy;
      if (y > from && y <= to && (best === null || y < best)) best = y;
    }
    return best;
  }
  /** Name of a mesh with an up-facing surface at (x,z) strictly between from and to. */
  coveredBy(x: number, z: number, from: number, to: number) {
    const list = this.cells.get((Math.floor(x / this.cell) + 32768) * 65536 + (Math.floor(z / this.cell) + 32768));
    if (list) for (const t of list) {
      const d = (t.bz - t.cz) * (t.ax - t.cx) + (t.cx - t.bx) * (t.az - t.cz);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((t.bz - t.cz) * (x - t.cx) + (t.cx - t.bx) * (z - t.cz)) / d, v = ((t.cz - t.az) * (x - t.cx) + (t.ax - t.cx) * (z - t.cz)) / d, w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      const y = u * t.ay + v * t.by + w * t.cy;
      if (y > from && y <= to) return t.name;
    }
    return null;
  }
  /** Highest visible up-facing surface at (x,z) not above `below`. */
  under(x: number, z: number, below: number) {
    const list = this.cells.get((Math.floor(x / this.cell) + 32768) * 65536 + (Math.floor(z / this.cell) + 32768));
    let best: { y: number; tri: Tri } | null = null;
    if (list) for (const t of list) {
      const d = (t.bz - t.cz) * (t.ax - t.cx) + (t.cx - t.bx) * (t.az - t.cz);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((t.bz - t.cz) * (x - t.cx) + (t.cx - t.bx) * (z - t.cz)) / d, v = ((t.cz - t.az) * (x - t.cx) + (t.ax - t.cx) * (z - t.cz)) / d, w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      const y = u * t.ay + v * t.by + w * t.cy;
      if (y > below) continue;
      if (!best || y > best.y) best = { y, tri: t };
    }
    return best;
  }
}

export interface ExposedEdge {
  area: string; source: string; material: string; x0: number; z0: number; x1: number; z1: number; length: number;
  exposure: number; meanExposure: number; top: number; neighbour: string; kind: 'artefact' | 'intentional' | 'building' | 'stair';
  reason: string;
}

/** Group meshes into modules; boundaries are computed per module (all its meshes together). */
const moduleOf = (name: string) => name.replace(/ (asphalt|concrete|soil|planting|lawn batter|tie-in.*)$/, '');

export function probeGroundEdges(s: GroundScene, o: { threshold?: number; offset?: number; step?: number; onlyModules?: RegExp } = {}) {
  const threshold = o.threshold ?? .15, offset = o.offset ?? .08, step = o.step ?? .5;
  const area: [number, number, number, number] = [-430, 140, -170, 220];
  const index = new SurfaceIndex([s.walkway.surfaces, s.world.group, s.surfaces.group], 4, area);
  // Official building footprints: an edge against a facade is not a lawn edge.
  const buildings = s.data.buildings.map(b => ({ abbr: b.abbr || String(b.id), rings: b.rings as unknown as [number, number][][] }))
    .filter(b => b.rings[0]?.some(([x, z]) => x > area[0] && x < area[1] && z > area[2] && z < area[3]));
  const inBuilding = (x: number, z: number) => buildings.find(b => pointInPolygon(x, z, b.rings) || distanceToRings(x, z, b.rings) < .3)?.abbr ?? null;
  // Collect up-facing triangles per module from walkway.surfaces.
  const modules = new Map<string, { tris: number[]; materials: string[]; meshes: string[] }>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  s.walkway.surfaces.updateWorldMatrix(true, true);
  s.walkway.surfaces.traverse(obj => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    if (o.onlyModules && !o.onlyModules.test(m.name)) return;
    const pos = m.geometry.getAttribute('position'), idx = m.geometry.index, count = idx ? idx.count : pos.count;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material)?.name ?? '';
    const key = moduleOf(m.name);
    let mod = modules.get(key); if (!mod) modules.set(key, mod = { tris: [], materials: [], meshes: [] });
    for (let t = 0; t + 2 < count; t += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(t) : t).applyMatrix4(m.matrixWorld);
      b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(m.matrixWorld);
      const cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3;
      if (!heroArea(cx, cz)) continue;
      n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
      const l = n.length();
      if (l < 1e-9 || n.y / l < .6) continue;
      // Ground-level only (within 3 m of the baked terrain): skips roofs.
      if (Math.max(a.y, b.y, c.y) > s.baked.height(cx, cz) + 3) continue;
      mod.tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); mod.materials.push(mat); mod.meshes.push(m.name);
    }
  });
  const q = (v: number) => Math.round(v * 500);
  const edges: ExposedEdge[] = [];
  let boundaryMetres = 0, sampled = 0;
  for (const mod of modules.values()) {
    const count = new Map<string, number>();
    const key = (x0: number, z0: number, x1: number, z1: number) => {
      const p = `${q(x0)},${q(z0)}`, r = `${q(x1)},${q(z1)}`; return p < r ? `${p}|${r}` : `${r}|${p}`;
    };
    const T = mod.tris;
    for (let t = 0; t < T.length; t += 9) for (let e = 0; e < 3; e++) {
      const i = t + e * 3, j = t + ((e + 1) % 3) * 3;
      const k = key(T[i], T[i + 2], T[j], T[j + 2]); count.set(k, (count.get(k) ?? 0) + 1);
    }
    for (let t = 0; t < T.length; t += 9) for (let e = 0; e < 3; e++) {
      const i = t + e * 3, j = t + ((e + 1) % 3) * 3, k3 = t + ((e + 2) % 3) * 3;
      if (count.get(key(T[i], T[i + 2], T[j], T[j + 2])) !== 1) continue;
      const x0 = T[i], y0 = T[i + 1], z0 = T[i + 2], x1 = T[j], y1 = T[j + 1], z1 = T[j + 2];
      const len = Math.hypot(x1 - x0, z1 - z0); if (len < .05) continue;
      // Outward normal: away from the triangle's third vertex.
      let nx = (z1 - z0) / len, nz = -(x1 - x0) / len;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      if ((T[k3] - mx) * nx + (T[k3 + 2] - mz) * nz > 0) { nx = -nx; nz = -nz; }
      boundaryMetres += len;
      const samples = Math.max(1, Math.round(len / step));
      let worst = 0, sum = 0, exposedN = 0, walled = 0, neighbour = '', building: string | null = null, top = 0;
      for (let si = 0; si < samples; si++) {
        const f = (si + .5) / samples, x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f, y = y0 + (y1 - y0) * f;
        const px = x + nx * offset, pz = z + nz * offset;
        sampled++;
        const bld = inBuilding(px, pz);
        // A tie-in retaining wall coping over the edge itself: the drop is a built wall.
        const coping = index.coveredBy(x, z, y + .005, y + .1);
        if (coping && /retaining wall/.test(coping)) { exposedN++; walled++; sum += 0; continue; }
        const hit = index.under(px, pz, y + .02);
        // A higher neighbour within 1 m owns the visible face (probed from its side).
        if (index.above(px, pz, y + .02, y + 1) !== null) continue;
        const drop = hit ? y - hit.y : 99;
        if (drop > threshold) {
          exposedN++; sum += drop;
          if (drop > worst) { worst = drop; neighbour = hit ? `${hit.tri.name}${hit.tri.material ? ` [${hit.tri.material}]` : ''}` : '(nothing)'; building = bld; top = y; }
        }
      }
      if (!exposedN) continue;
      if (walled === exposedN) { edges.push({ area: heroArea(mx, mz) ?? 'hero-area border', source: mod.meshes[t / 9], material: mod.materials[t / 9], x0: +x0.toFixed(2), z0: +z0.toFixed(2), x1: +x1.toFixed(2), z1: +z1.toFixed(2),
        length: +(len * walled / samples).toFixed(2), exposure: .16, meanExposure: .16, top: +y0.toFixed(2), neighbour: 'tie-in retaining wall', kind: 'intentional', reason: 'faced by a tie-in retaining wall' }); continue; }
      if (worst <= threshold) continue;
      const material = mod.materials[t / 9], mesh = mod.meshes[t / 9];
      let kind: ExposedEdge['kind'] = 'artefact', reason = '';
      if (building) { kind = 'building'; reason = `outside point inside ${building} footprint`; }
      else if (/retaining wall/i.test(mesh)) { kind = 'intentional'; reason = 'tie-in retaining wall'; }
      else if (worst <= .32 && neighbour.replace(/ \[.*\]$/, '').startsWith(moduleOf(mesh).replace(/ foreground$/, ''))) { kind = 'stair'; reason = 'walkable step within one module (graded riser / curb)'; }
      else if (/stair|step/i.test(material) || /stair|step/i.test(mesh)) { kind = 'stair'; reason = 'stair flight'; }
      else if (INTENTIONAL.test(material) || INTENTIONAL.test(mesh)) { kind = 'intentional'; reason = `built element (${material || mesh})`; }
      edges.push({ area: heroArea(mx, mz) ?? 'hero-area border', source: mesh, material, x0: +x0.toFixed(2), z0: +z0.toFixed(2), x1: +x1.toFixed(2), z1: +z1.toFixed(2),
        length: +(len * exposedN / samples).toFixed(2), exposure: +worst.toFixed(2), meanExposure: +(sum / exposedN).toFixed(2), top: +top.toFixed(2), neighbour, kind, reason });
    }
  }
  return { edges, boundaryMetres, sampled, modules: [...modules.keys()] };
}

/** Merge collinear-ish consecutive edges into runs for a readable report. */
export function summarize(edges: ExposedEdge[], minExposure = .15) {
  const groups = new Map<string, { area: string; source: string; material: string; kind: string; count: number; length: number; max: number; box: number[]; neighbours: Set<string> }>();
  for (const e of edges) {
    if (e.exposure <= minExposure) continue;
    // 8 m tiles keep separate locations apart.
    const k = `${e.kind}|${e.source}|${e.material}|${Math.floor((e.x0 + e.x1) / 16)},${Math.floor((e.z0 + e.z1) / 16)}`;
    let g = groups.get(k);
    if (!g) groups.set(k, g = { area: e.area, source: e.source, material: e.material, kind: e.kind, count: 0, length: 0, max: 0, box: [Infinity, -Infinity, Infinity, -Infinity], neighbours: new Set() });
    g.count++; g.length += e.length; g.max = Math.max(g.max, e.exposure);
    g.box = [Math.min(g.box[0], e.x0, e.x1), Math.max(g.box[1], e.x0, e.x1), Math.min(g.box[2], e.z0, e.z1), Math.max(g.box[3], e.z0, e.z1)];
    g.neighbours.add(e.neighbour.replace(/ \[.*\]$/, ''));
  }
  return [...groups.values()].map(g => ({ ...g, length: +g.length.toFixed(1), max: +g.max.toFixed(2), box: g.box.map(v => +v.toFixed(1)), neighbours: [...g.neighbours].slice(0, 3) }));
}

/** The game integration (game.ts after local finishes load), mirrored here. */
export function addGroundTieIns(s: GroundScene) {
  const tieIns = buildGroundTieIns({ sources: [s.walkway.surfaces], obstacles: [s.walkway.surfaces, s.world.group], overlays: [s.surfaces.group],
    terrainPositions: s.terrain.mesh.geometry.getAttribute('position').array, terrainFallback: (x, z) => s.world.terrain.height(x, z), isTerrain: m => m.name === 'Offline local contour terrain',
    buildings: s.data.buildings, lawn: s.world.mat.grass, physics: s.physics, extraSources: heroRouteExtraGround,
    wall: s.walkway.materials.find(m => m.name === 'East Mall limestone walls and steps')! });
  s.walkway.surfaces.add(...tieIns.meshes);
  s.physics.step();
  return tieIns;
}

/** Visible vs physical support on the tie-ins: the highest visible up-facing
 * surface (all roots) against a Rapier ray from above, at triangle centroids and
 * edge midpoints of every batter triangle. Also: baked vs contour terrain at feet. */
export function tieInPhysics(s: GroundScene, tieIns: ReturnType<typeof addGroundTieIns>) {
  const boxes: [number, number, number, number][] = tieIns.meshes.map(m => { const b = m.geometry.boundingBox!; return [b.min.x - 1, b.max.x + 1, b.min.z - 1, b.max.z + 1]; });
  const index = new SurfaceIndex([s.walkway.surfaces, s.world.group], 2, [Math.min(...boxes.map(b => b[0])), Math.max(...boxes.map(b => b[1])), Math.min(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))]);
  let samples = 0, mismatched = 0, wallContacts = 0, worst = 0, steepest = 0, walkableSamples = 0, bakedDiff = 0;
  const examples: string[] = [];
  const v = new THREE.Vector3(), w = new THREE.Vector3(), u = new THREE.Vector3();
  for (const mesh of tieIns.meshes) {
    const pos = mesh.geometry.getAttribute('position'), idx = mesh.geometry.index!;
    for (let t = 0; t < idx.count; t += 3) {
      v.fromBufferAttribute(pos, idx.getX(t)); w.fromBufferAttribute(pos, idx.getX(t + 1)); u.fromBufferAttribute(pos, idx.getX(t + 2));
      const n = new THREE.Vector3().crossVectors(w.clone().sub(v), u.clone().sub(v)).normalize();
      steepest = Math.max(steepest, Math.acos(Math.min(1, n.y)) * 180 / Math.PI);
      if (n.y >= Math.cos(Math.PI / 4)) walkableSamples++;
      if (n.y < .5) continue;
      for (const [a, b, c] of [[1 / 3, 1 / 3, 1 / 3], [.6, .2, .2], [.2, .6, .2], [.2, .2, .6]]) {
        const x = v.x * a + w.x * b + u.x * c, y = v.y * a + w.y * b + u.y * c, z = v.z * a + w.z * b + u.z * c;
        // Standing on the tie-in: the visible support is the tie-in, or any other
        // visible up-facing surface poking up to 0.3 m above it (terrain, curbs).
        const over = index.under(x, z, y + .3);
        const visible = over && over.y > y ? over.y : y;
        const ray = s.physics.castRayAndGetNormal(new s.RAPIER.Ray({ x, y: y + .3, z }, { x: 0, y: -1, z: 0 }), 1.3, true, undefined, undefined, s.player);
        samples++;
        if (!ray) { mismatched++; if (examples.length < 8) examples.push(`${x.toFixed(2)},${z.toFixed(2)} y ${y.toFixed(3)} no physical support`); continue; }
        if (ray.normal.y < .5) { wallContacts++; continue; }
        const physical = y + .3 - ray.timeOfImpact, d = Math.abs(visible - physical);
        if (d > .05) { mismatched++; if (examples.length < 8) examples.push(`${x.toFixed(2)},${z.toFixed(2)} visible ${visible.toFixed(3)} physical ${physical.toFixed(3)}`); }
        worst = Math.max(worst, d);
      }
    }
  }
  for (const seg of tieIns.segments) if (seg.status === 'graded') {
    const b = s.baked.sample(seg.x0, seg.z0);
    if (b !== null) bakedDiff = Math.max(bakedDiff, Math.abs(b - s.world.terrain.height(seg.x0, seg.z0)));
  }
  return { samples, mismatchedOver005: mismatched, steepFaceContacts: wallContacts, worstDifference: +worst.toFixed(3), steepestDeg: +steepest.toFixed(1),
    triangles: tieIns.stats.triangles, walkableTriangles: walkableSamples, bakedVsContourAtTopsMax: +bakedDiff.toFixed(3), examples };
}

/** Debug top-down map: highest visible surface (below terrain + 4 m) per pixel and its class. */
export function topDown(s: GroundScene, box: [number, number, number, number], res = .25, extra: THREE.Object3D[] = []) {
  const index = new SurfaceIndex([s.walkway.surfaces, s.world.group, s.surfaces.group, ...extra], 2, box);
  const w = Math.ceil((box[1] - box[0]) / res), h = Math.ceil((box[3] - box[2]) / res);
  const y = new Float32Array(w * h), cls = new Uint8Array(w * h);
  const names: string[] = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = box[0] + (i + .5) * res, z = box[2] + (j + .5) * res;
    const g = s.baked.height(x, z);
    const hit = index.under(x, z, g + 4);
    y[j * w + i] = hit ? hit.y : NaN;
    const name = hit ? hit.tri.name + (hit.tri.material ? ` [${hit.tri.material}]` : '') : '';
    let k = names.indexOf(name); if (k < 0) { k = names.length; names.push(name); }
    cls[j * w + i] = k;
  }
  const footprints = s.data.buildings.filter(b => b.rings[0].some(([x, z]) => x > box[0] && x < box[1] && z > box[2] && z < box[3])).map(b => b.rings as unknown as number[][][]);
  return { w, h, y, cls, names, footprints, box, res };
}

/** Walk the game's capsule/controller (autostep 0.32, snap 0.38, 45 deg climb,
 * gravity 24) from a to b across a tie-in, with the tie-in colliders disabled
 * (before) and enabled (after). Success = within 0.6 m of b after 12 s. */
export function walkAcross(s: GroundScene, tieIns: ReturnType<typeof addGroundTieIns>, tests: Record<string, [[number, number], [number, number]]>) {
  const out: Record<string, unknown> = {};
  const controller = s.physics.createCharacterController(0.025);
  controller.enableAutostep(0.32, 0.2, false); controller.enableSnapToGround(0.38);
  controller.setMaxSlopeClimbAngle(Math.PI * 0.25); controller.setMinSlopeSlideAngle(Math.PI * 0.28);
  const body = s.physics.createRigidBody(s.RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 100, 0));
  const collider = s.physics.createCollider(s.RAPIER.ColliderDesc.capsule(0.54, 0.34).setFriction(0), body);
  for (const [name, [a, b]] of Object.entries(tests)) {
    const result: Record<string, unknown> = {};
    for (const enabled of [false, true]) {
      for (const c of tieIns.colliders) c.setEnabled(enabled);
      const ground = s.physics.castRay(new s.RAPIER.Ray({ x: a[0], y: 60, z: a[1] }, { x: 0, y: -1, z: 0 }), 120, true, undefined, undefined, collider);
      const p = { x: a[0], y: (ground ? 60 - ground.timeOfImpact : s.baked.height(a[0], a[1])) + .92, z: a[1] };
      body.setTranslation(p, true); body.setNextKinematicTranslation(p); s.physics.step();
      let vy = 0, maxRise = 0, t = 0;
      const dt = 1 / 60, speed = 2.2;
      for (; t < 12; t += dt) {
        const dx = b[0] - p.x, dz = b[1] - p.z, d = Math.hypot(dx, dz);
        if (d < .3) break;
        vy = Math.max(vy - 24 * dt, -30);
        controller.computeColliderMovement(collider, { x: dx / d * speed * dt, y: vy * dt, z: dz / d * speed * dt });
        const m = controller.computedMovement();
        if (controller.computedGrounded()) vy = 0;
        maxRise = Math.max(maxRise, m.y);
        p.x += m.x; p.y += m.y; p.z += m.z;
        body.setNextKinematicTranslation(p); s.physics.step();
      }
      const reached = Math.hypot(b[0] - p.x, b[1] - p.z) < .6;
      result[enabled ? 'after' : 'before'] = { reached, end: [+p.x.toFixed(2), +(p.y - .92).toFixed(2), +p.z.toFixed(2)], seconds: +t.toFixed(2), maxStepUp: +maxRise.toFixed(3) };
    }
    out[name] = result;
  }
  for (const c of tieIns.colliders) c.setEnabled(true);
  s.physics.removeCollider(collider, false); s.physics.removeRigidBody(body); s.physics.removeCharacterController(controller);
  s.physics.step();
  return out;
}

/** Ride the scooter from a to b with the game's real clearance code (ScooterClearance.resolveMove,
 * KCC-committed and re-validated, rendered ground from LocalGroundQuery over the walkable roots as in
 * CampusGame), accelerating from rest to scooter speed at 60 Hz. Success = within 0.6 m of b with no
 * frame rising or dropping more than the scooter's step (SCOOTER_ENVELOPE.maxStep). */
export function scooterAcross(s: GroundScene, tests: Record<string, [[number, number], [number, number]]>) {
  const out: Record<string, { reached: boolean; [k: string]: unknown }> = {};
  const controller = s.physics.createCharacterController(0.025);
  controller.enableAutostep(0.32, 0.2, false); controller.enableSnapToGround(0.38);
  controller.setMaxSlopeClimbAngle(Math.PI * 0.25); controller.setMinSlopeSlideAngle(Math.PI * 0.28);
  const body = s.physics.createRigidBody(s.RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 100, 0));
  const collider = s.physics.createCollider(s.RAPIER.ColliderDesc.capsule(0.54, 0.34).setFriction(0), body);
  const roots: THREE.Object3D[] = [s.world.group, s.walkway.surfaces];
  for (const r of roots) r.updateMatrixWorld(true);
  const query = new LocalGroundQuery();
  const clearance = new ScooterClearance({ world: s.physics, controller, collider, renderedGround: (x, z, fromY, distance) => query.sample(x, z, fromY, distance) });
  const commit = (q: { x: number; y: number; z: number }) => { body.setTranslation(q, true); s.physics.propagateModifiedBodyPositionsToColliders(); };
  const dt = 1 / 60, vmax = RUN_SPEED * SCOOTER_TUNING.speedMultiplier;
  for (const [name, [a, b]] of Object.entries(tests)) {
    const hit = s.physics.castRay(new s.RAPIER.Ray({ x: a[0], y: 60, z: a[1] }, { x: 0, y: -1, z: 0 }), 120, true, undefined, undefined, collider);
    if (!hit) { out[name] = { reached: false, error: 'no start support' }; continue; }
    commit({ x: a[0], y: 60 - hit.timeOfImpact + SCOOTER_ENVELOPE.riderCenterToFeet, z: a[1] });
    let speed = 0, heading = Math.atan2(b[0] - a[0], b[1] - a[1]), frames = 0, stuck = 0, maxRise = 0, maxDrop = 0, travelled = 0;
    const reasons: Record<string, number> = {};
    for (; frames < 2400; frames++) {
      const p = body.translation(), dx = b[0] - p.x, dz = b[1] - p.z, dist = Math.hypot(dx, dz);
      if (dist < .25) break;
      speed = Math.min(vmax, speed + SCOOTER_TUNING.acceleration * dt);
      const stepLen = Math.min(speed * dt, dist);
      query.prepare(roots, p, () => true);
      const r = clearance.resolveMove({ fromHeading: heading, heading: Math.atan2(dx, dz), displacement: { x: dx / dist * stepLen, z: dz / dist * stepLen } });
      if (r.blockedReason) reasons[r.blockedReason] = (reasons[r.blockedReason] ?? 0) + 1;
      const moved = Math.hypot(r.center.x - p.x, r.center.z - p.z); travelled += moved;
      if (moved < .3 * stepLen) { stuck++; speed = 0; } else stuck = 0;
      maxRise = Math.max(maxRise, r.center.y - p.y); maxDrop = Math.max(maxDrop, p.y - r.center.y);
      heading = r.allowedHeading; commit(r.center);
      if (stuck > 45) break;
    }
    const end = body.translation();
    out[name] = { reached: Math.hypot(b[0] - end.x, b[1] - end.z) < .6, metres: +travelled.toFixed(2), frames, maxFrameRiseM: +maxRise.toFixed(3), maxFrameDropM: +maxDrop.toFixed(3),
      blockedReasons: reasons, end: [+end.x.toFixed(2), +(end.y - SCOOTER_ENVELOPE.riderCenterToFeet).toFixed(2), +end.z.toFixed(2)] };
  }
  s.physics.removeCollider(collider, false); s.physics.removeRigidBody(body); s.physics.removeCharacterController(controller);
  s.physics.step();
  return out;
}
