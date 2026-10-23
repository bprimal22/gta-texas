import * as THREE from 'three';
import type { DowntownBuilding, DowntownData, FacadeKind, PolygonRings, RGB } from './format';
import { buildingChunk, terrainChunk } from './geometry';
import { createFacadeMaterial, createGroundMaterial, createWaterMaterial } from './materials';

/** Visual-only measured backdrop around the playable world (west notch between deep west and downtown, west of
 * Lamar, east of the campus/downtown edges, south of the downtown rectangle). Built by
 * tools/extension/bake-downtown-background.py. It is added to the scene only: no colliders, not under world.group,
 * so map travel, scooter and flight ground queries never see it. Fail-safe: any error leaves it out. */
export const BACKGROUND_URL = '/assets/extension/downtown-background-v1.bin.gz';
const MAGIC = 0x47425455, VERSION = 1;
/** Backdrop render chunk (m): few draw calls; it is distant context. */
export const BACKGROUND_CHUNK = 2048;
export const BACKGROUND_LOWRISE_DISTANCE = 2600;
/** Horizon ground below every real surface (lake bed cells are covered by water at -34.35). */
export const HORIZON_Y = -44;

interface BgBuilding { k: string; r: PolygonRings; g: number; y: number; f: FacadeKind; w: RGB; a: RGB }
export interface BackgroundMeta {
  format: 'ut-downtown-background'; version: number;
  rect: { xmin: number; xmax: number; zmin: number; zmax: number }; step: number; grid: { nx: number; nz: number };
  covered: [number, number, number, number][]; lowered: number;
  classMap: { w: number; h: number; res: number }; water: { surfaceY: number };
  buildings: BgBuilding[]; counts: Record<string, number>; claims: string;
  sections: { name: string; type: 'f32' | 'u8'; byteOffset: number; count: number }[];
}
export interface BackgroundData { meta: BackgroundMeta; heights: Float32Array; cellFlags: Uint8Array; classMap: Uint8Array; water: Float32Array; bytes: number }

export class BackgroundAssetError extends Error {}
const fail = (m: string): never => { throw new BackgroundAssetError(`Background asset rejected: ${m}`); };
function fnv(bytes: Uint8Array) {
  if (bytes.byteLength % 4) fail('body not word aligned');
  const w = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  let h = 2166136261; for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w[i], 16777619) >>> 0;
  return h >>> 0;
}

export function decodeBackground(buffer: ArrayBuffer): BackgroundData {
  if (buffer.byteLength < 16) fail('truncated');
  const v = new DataView(buffer);
  if (v.getUint32(0, true) !== MAGIC) fail('bad magic');
  if (v.getUint32(4, true) !== VERSION) fail('unsupported version');
  const ml = v.getUint32(8, true), body = new Uint8Array(buffer, 16);
  if (ml > body.byteLength || ml % 4) fail('bad metadata length');
  if (fnv(body) !== v.getUint32(12, true)) fail('checksum mismatch');
  const meta = JSON.parse(new TextDecoder().decode(body.subarray(0, ml))) as BackgroundMeta;
  if (meta.format !== 'ut-downtown-background') fail('format');
  const base = 16 + ml, size = buffer.byteLength - base;
  const sec = (name: string) => {
    const s = meta.sections.find(q => q.name === name) ?? fail(`missing ${name}`);
    const n = s.type === 'f32' ? 4 : 1;
    if (s.byteOffset % 4 || s.byteOffset + s.count * n > size) fail(`${name} out of bounds`);
    return s.type === 'f32' ? new Float32Array(buffer, base + s.byteOffset, s.count) : new Uint8Array(buffer, base + s.byteOffset, s.count);
  };
  const heights = sec('heights') as Float32Array, cellFlags = sec('cellFlags') as Uint8Array, classMap = sec('classMap') as Uint8Array, water = sec('water') as Float32Array;
  const { nx, nz } = meta.grid;
  if (heights.length !== nx * nz || cellFlags.length !== (nx - 1) * (nz - 1) || classMap.length !== meta.classMap.w * meta.classMap.h || water.length % 9) fail('section sizes');
  for (let i = 0; i < heights.length; i++) if (!(heights[i] > -80 && heights[i] < 120)) fail('height out of range');
  return { meta, heights, cellFlags, classMap, water, bytes: buffer.byteLength };
}

export class DowntownBackground {
  readonly group = new THREE.Group();
  readonly stats: Record<string, unknown>;
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly lod: { object: THREE.Object3D; center: THREE.Vector3 }[] = [];
  private disposed = false;

  constructor(data: BackgroundData, borrowed: { grass: THREE.MeshStandardMaterial; asphalt: THREE.MeshStandardMaterial; concrete: THREE.MeshStandardMaterial; envMap: THREE.Texture | null }, decodeMs: number) {
    const m = data.meta;
    this.group.name = 'Downtown backdrop (visual only, CoA 2023 + USGS 3DEP)';
    const ground = createGroundMaterial({ grass: borrowed.grass, asphalt: borrowed.asphalt, concrete: borrowed.concrete, classMap: data.classMap,
      width: m.classMap.w, height: m.classMap.h, origin: [m.rect.xmin, m.rect.zmin], res: m.classMap.res });
    ground.material.name = 'Downtown backdrop ground';
    const facade = createFacadeMaterial(borrowed.envMap); facade.name = 'Downtown backdrop facades';
    const water = createWaterMaterial(borrowed.envMap); water.name = 'Lady Bird Lake backdrop water';
    const horizon = new THREE.MeshStandardMaterial({ color: borrowed.grass.color.clone().multiplyScalar(.55), roughness: 1 });
    horizon.name = 'Downtown horizon ground (nondescript, below all terrain)';
    this.materials.push(ground.material, facade, water, horizon); this.textures.push(ground.texture);
    // Grid terrain through the shared chunk builder (render bit only; collider never used).
    const grid = { meta: { grid: m.grid, step: m.step, rect: m.rect }, heights: data.heights, cellFlags: data.cellFlags } as unknown as DowntownData;
    const cells = BACKGROUND_CHUNK / m.step, ncx = Math.ceil((m.grid.nx - 1) / cells), ncz = Math.ceil((m.grid.nz - 1) / cells);
    const groups = new Map<string, DowntownBuilding[]>();
    for (const b of m.buildings) {
      const [x, z] = b.r[0][0];
      const key = `${Math.min(ncx - 1, Math.floor((x - m.rect.xmin) / BACKGROUND_CHUNK))},${Math.min(ncz - 1, Math.floor((z - m.rect.zmin) / BACKGROUND_CHUNK))}`;
      const rec: DowntownBuilding = { k: b.k, src: 'coa2023', id: 0, g: [b.g, b.g], basis: 'coa', kind: '', name: '', visual: true, c: 0,
        tiers: [{ r: b.r, y: b.y, f: b.f, w: b.w, a: b.a }] };
      const l = groups.get(key); if (l) l.push(rec); else groups.set(key, [rec]);
    }
    let triangles = 0, drawCalls = 0;
    for (let cz = 0; cz < ncz; cz++) for (let cx = 0; cx < ncx; cx++) {
      const key = `${cx},${cz}`, center = new THREE.Vector3(m.rect.xmin + (cx + .5) * BACKGROUND_CHUNK, 0, m.rect.zmin + (cz + .5) * BACKGROUND_CHUNK);
      const t = terrainChunk(grid, cx * cells, Math.min(m.grid.nx - 1, (cx + 1) * cells), cz * cells, Math.min(m.grid.nz - 1, (cz + 1) * cells));
      if (t.render) {
        const mesh = new THREE.Mesh(t.render, ground.material); mesh.name = `Downtown backdrop terrain ${key}`; mesh.receiveShadow = true;
        this.group.add(mesh); drawCalls++; triangles += t.triangles;
      }
      const bc = buildingChunk(groups.get(key) ?? []);
      for (const [kind, batch] of [['skyline', bc.major], ['lowrise', bc.minor]] as const) {
        if (!batch.triangles) continue;
        const mesh = new THREE.Mesh(batch.geometry(), facade); mesh.name = `Downtown backdrop ${kind} ${key}`; mesh.castShadow = true; mesh.receiveShadow = true;
        this.group.add(mesh); drawCalls++; triangles += batch.triangles;
        if (kind === 'lowrise') this.lod.push({ object: mesh, center });
      }
    }
    if (data.water.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.water), 3));
      g.computeVertexNormals(); g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, water); mesh.name = 'Lady Bird Lake backdrop water'; this.group.add(mesh); drawCalls++;
    }
    // Horizon: one quad far below all terrain, beyond which only fog remains (hides outer data cut-offs).
    const plane = new THREE.PlaneGeometry(16000, 16000).rotateX(-Math.PI / 2).translate((m.rect.xmin + m.rect.xmax) / 2, HORIZON_Y, (m.rect.zmin + m.rect.zmax) / 2);
    const hz = new THREE.Mesh(plane, horizon); hz.name = 'Downtown horizon ground'; this.group.add(hz); drawCalls++;
    this.group.traverse(o => { o.userData.visualOnly = true; });
    this.stats = { loaded: true, rect: m.rect, covered: m.covered, buildings: m.buildings.length, triangles, drawCalls, bytes: data.bytes, decodeMs, colliders: 0, claims: m.claims };
  }

  update(camera: THREE.Vector3) {
    for (const l of this.lod) l.object.visible = Math.hypot(camera.x - l.center.x, camera.z - l.center.z) < BACKGROUND_LOWRISE_DISTANCE + BACKGROUND_CHUNK * .71;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.group.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
    for (const mat of this.materials) mat.dispose();
    for (const t of this.textures) t.dispose();
  }
  get isDisposed() { return this.disposed; }
}

export async function loadBackground(options: { borrowed: ConstructorParameters<typeof DowntownBackground>[1]; signal?: AbortSignal; url?: string }) {
  const url = options.url ?? BACKGROUND_URL;
  if (!url.startsWith('/') || url.startsWith('//')) throw new Error('Background asset must be same-origin');
  const t0 = performance.now();
  const response = await fetch(url, { signal: options.signal });
  if (!response.ok) throw new Error(`Background asset load failed: ${response.status}`);
  const zipped = await response.arrayBuffer(), b = new Uint8Array(zipped);
  const buffer = b[0] === 0x1f && b[1] === 0x8b ? await new Response(new Blob([zipped]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : zipped;
  const data = decodeBackground(buffer);
  return new DowntownBackground(data, options.borrowed, performance.now() - t0);
}
