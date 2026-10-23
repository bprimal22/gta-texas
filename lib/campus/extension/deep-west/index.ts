import * as THREE from 'three';
import { applyFacadeShader } from '../../context/materials';
import { decodeDeepWest, type DeepWestData, type PolygonRings } from './format';
import { buildingParts, surfaceGeometry, terrainGeometry, TerrainHeight, type DeepWestPart } from './geometry';
import { applyDeepWestProfiles } from '../../blocks/b12-west-campus/highrise-identity/deep-west';

/** Deep-west campus extension (D37-D40, x in [-1570, -760), z in [-510, 570]).
 * Opt-in, isolated, fail-closed: the caller adds it only when decoding and the seam check pass;
 * otherwise the original world (and its west wall) stays exactly as before. Same-origin only. */
export const DEEP_WEST_URL = '/assets/extension/deep-west-v1.bin.gz';

export interface DeepWestMaterials {
  /** Borrowed (never disposed here). */
  terrain: THREE.Material;
  asphalt: THREE.Material;
  concrete: THREE.Material;
  /** Generated-context material set ('wall:<family>', 'roof:<family>'). */
  context: (key: string) => THREE.Material | undefined;
}

export type Point = [number, number];
export interface DeepWestBounds { xmin: number; xmax: number; zmin: number; zmax: number }

/** Extension-only glass: the shared context glass is near-black (0.03) and read as holes on the large deep-west slabs;
 * here panes take a per-building tint (code / 512, set by geometry.ts facadeProgram) and a slightly rougher, less
 * metallic finish so sky light reads in them. Anchors are asserted by the west-campus check. */
export const DEEP_WEST_GLASS_GLSL = /* glsl */`
if (ctxGlass > 0.0) {
  float dwTint = floor(floor(vCtxWin.w + 0.5) / 512.0);
  vec3 dwGlass = dwTint < 0.5 ? vec3(0.15, 0.18, 0.21) : dwTint < 1.5 ? vec3(0.12, 0.17, 0.15) : dwTint < 2.5 ? vec3(0.09, 0.13, 0.19) : vec3(0.16, 0.13, 0.10);
  diffuseColor.rgb = mix(diffuseColor.rgb, dwGlass, ctxGlass * 0.8);
}
`;
export const DEEP_WEST_SHADER_EDITS: [string, string][] = [
  ['roughnessFactor = mix(roughnessFactor, 0.07, ctxGlass);', 'roughnessFactor = mix(roughnessFactor, 0.16, ctxGlass);'],
  ['metalnessFactor = mix(metalnessFactor, 0.3, ctxGlass);', 'metalnessFactor = mix(metalnessFactor, 0.12, ctxGlass);'],
  ['#include <emissivemap_fragment>', `${DEEP_WEST_GLASS_GLSL}\n#include <emissivemap_fragment>`],
];

/** Wall material that keeps the borrowed context textures and facade-opening shader, but with
 * openings always shader-drawn (detail radius pinned to 0): the extension has no recessed
 * opening geometry, so discarding them near the camera would show through the walls. */
function extensionWall(source: THREE.MeshStandardMaterial) {
  const m = new THREE.MeshStandardMaterial({
    map: source.map, normalMap: source.normalMap, roughnessMap: source.roughnessMap,
    roughness: source.roughness, metalness: source.metalness, vertexColors: true,
    color: source.color.clone(), normalScale: source.normalScale.clone(),
  });
  applyFacadeShader(m);
  const patch = m.onBeforeCompile.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    patch(shader, renderer);
    shader.uniforms.uCtxDetailRadius = { value: 0 };
    shader.uniforms.uCtxEye = { value: new THREE.Vector3() };
    for (const [from, to] of DEEP_WEST_SHADER_EDITS) shader.fragmentShader = shader.fragmentShader.replace(from, to);
  };
  m.customProgramCacheKey = () => 'deepwest-facade-v2';
  m.name = `Deep West ${source.name.replace('Local context ', '')}`;
  return m;
}

/** Offset copies of the borrowed paving so the 4 cm drape never z-fights the terrain at range. */
function paving(source: THREE.Material, name: string, tint?: number) {
  const m = source.clone();
  m.name = name;
  m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -1;
  if (tint !== undefined && m instanceof THREE.MeshStandardMaterial) m.color.multiply(new THREE.Color(tint));
  return m;
}

const SURFACE_MATERIAL: Record<string, string> = {
  'Paved Road': 'asphalt', 'Paved Alley': 'asphalt', Sidewalk: 'concrete', Pavement: 'concrete', Courtyard: 'courtyard', Trail: 'trail',
};

export interface DeepWestGeometry {
  data: DeepWestData;
  parts: DeepWestPart[];
  heightQuery: TerrainHeight;
  stats: ReturnType<typeof buildingParts>['stats'];
}

/** Pure geometry (no materials, no GPU): used by the game and by Node checks alike. */
export function buildDeepWestGeometry(data: DeepWestData): DeepWestGeometry {
  const parts: DeepWestPart[] = [{ name: 'Deep West terrain (USGS 3DEP)', district: null, material: 'terrain', geometry: terrainGeometry(data) }];
  for (const [kind, positions] of data.surfaces)
    parts.push({ name: `Deep West ${kind} (CoA 2023)`, district: null, material: `surface:${kind}`, geometry: surfaceGeometry(positions) });
  const buildings = buildingParts(applyDeepWestProfiles(data.meta.buildings), data.meta.districts);
  parts.push(...buildings.parts);
  return { data, parts, heightQuery: new TerrainHeight(data.terrainPosition, data.terrainIndex, data.meta.union), stats: buildings.stats };
}

export class DeepWest {
  readonly group = new THREE.Group();
  readonly bounds: DeepWestBounds;
  /** Exactly the rendered geometries (shared buffers) for trimesh colliders. */
  readonly colliderGeometries: THREE.BufferGeometry[];
  readonly travelRegion: { contains: (p: Point) => boolean; footprints: Point[][][] };
  private readonly ownMaterials: THREE.Material[] = [];
  private readonly mapFootprints: Path2D | null;
  private readonly mapSurfaces: { fill: string; path: Path2D }[] = [];
  private disposed = false;
  readonly stats: Record<string, unknown>;

  constructor(private readonly built: DeepWestGeometry, materials: DeepWestMaterials, decodeMs: number) {
    const meta = built.data.meta;
    this.bounds = { ...meta.union };
    this.group.name = 'Deep West extension (D37-D40)';
    const cache = new Map<string, THREE.Material>();
    const material = (key: string): THREE.Material => {
      const known = cache.get(key);
      if (known) return known;
      let m: THREE.Material | undefined;
      if (key === 'terrain') m = materials.terrain;
      else if (key.startsWith('surface:')) {
        const kind = SURFACE_MATERIAL[key.slice(8)] ?? 'concrete';
        m = kind === 'asphalt' ? paving(materials.asphalt, 'Deep West road asphalt')
          : kind === 'courtyard' ? paving(materials.concrete, 'Deep West courtyard paving', 0xe8dccb)
          : kind === 'trail' ? paving(materials.concrete, 'Deep West trail surface', 0xc9b48f)
          : paving(materials.concrete, 'Deep West sidewalk concrete');
        this.ownMaterials.push(m);
      } else if (key.startsWith('wall:')) {
        const source = materials.context(key);
        if (!(source instanceof THREE.MeshStandardMaterial)) throw new Error(`Deep West needs context material ${key}`);
        m = extensionWall(source);
        this.ownMaterials.push(m);
      } else {
        m = materials.context(key);
        if (!m) throw new Error(`Deep West needs context material ${key}`);
      }
      cache.set(key, m);
      return m;
    };
    for (const part of built.parts) {
      const mesh = new THREE.Mesh(part.geometry, material(part.material));
      mesh.name = part.name;
      mesh.receiveShadow = true;
      mesh.castShadow = part.material.startsWith('wall:') || part.material.startsWith('roof:');
      mesh.userData.deepWest = { district: part.district, material: part.material };
      this.group.add(mesh);
    }
    this.colliderGeometries = built.parts.map(p => p.geometry);
    const footprints = meta.buildings.map(b => b.rings as Point[][]);
    const u = this.bounds;
    this.travelRegion = {
      contains: ([x, z]) => x < u.xmax && x >= u.xmin + 2 && z >= u.zmin + 2 && z <= u.zmax - 2,
      footprints,
    };
    const canPath = typeof Path2D !== 'undefined';
    const toPath = (polys: PolygonRings[]) => {
      const path = new Path2D();
      for (const rings of polys) for (const r of rings) { r.forEach(([x, z], i) => i ? path.lineTo(x, z) : path.moveTo(x, z)); path.closePath(); }
      return path;
    };
    this.mapFootprints = canPath ? toPath(meta.buildings.map(b => b.rings)) : null;
    if (canPath) for (const [kind, polys] of Object.entries(meta.map.surfaces))
      this.mapSurfaces.push({ fill: SURFACE_MATERIAL[kind] === 'asphalt' ? '#5a5f5c' : '#8f8d7f', path: toPath(polys) });
    const triangles = built.parts.reduce((s, p) => s + (p.geometry.index ? p.geometry.index.count : p.geometry.getAttribute('position').count) / 3, 0);
    const perDistrict: Record<string, { buildings: number; triangles: number; drawCalls: number }> = {};
    for (const b of meta.buildings) (perDistrict[b.district] ??= { buildings: 0, triangles: 0, drawCalls: 0 }).buildings++;
    for (const p of built.parts) if (p.district) {
      const d = perDistrict[p.district] ??= { buildings: 0, triangles: 0, drawCalls: 0 };
      d.triangles += (p.geometry.index?.count ?? 0) / 3; d.drawCalls++;
    }
    this.stats = {
      loaded: true, bounds: this.bounds, buildings: meta.counts.buildings, excludedBuildings: meta.counts.excludedBuildings,
      surfaceTriangles: meta.counts.surfaceTriangles, terrainTriangles: meta.counts.terrainTriangles,
      triangles, drawCalls: built.parts.length, perDistrict, architecture: built.stats,
      seam: { x: meta.seam.x, matchedOldVertices: built.data.seam.matched, cornerMaxAbsDelta: built.data.seam.maxAbsDelta, blendWidth: meta.seam.blendWidth },
      asset: { url: DEEP_WEST_URL, bytes: built.data.bytes, checksum: built.data.checksum }, decodeMs,
      claims: 'CoA 2023 footprints/heights + USGS 3DEP terrain; facades, colours and gables are generic estimates; not current-age, not 1:1',
    };
  }

  /** Extension terrain height, or null where the original world is authoritative (x >= -760 or outside). */
  height(x: number, z: number) { return this.disposed ? null : this.built.heightQuery.height(x, z); }

  contains(x: number, z: number) { return this.height(x, z) !== null; }

  /** Draw in campus coordinates (caller has applied the map transform). */
  drawMap(ctx: CanvasRenderingContext2D) {
    if (!this.mapFootprints) return;
    ctx.save();
    ctx.globalAlpha = .55;
    for (const s of this.mapSurfaces) { ctx.fillStyle = s.fill; ctx.fill(s.path, 'evenodd'); }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#c1bca6';
    ctx.fill(this.mapFootprints, 'evenodd');
    ctx.restore();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    for (const p of this.built.parts) p.geometry.dispose();
    for (const m of this.ownMaterials) m.dispose();
  }
}

async function fetchBytes(url: string, signal?: AbortSignal) {
  if (!url.startsWith('/') || url.startsWith('//')) throw new Error('Deep West asset must be same-origin');
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Deep West asset load failed: ${response.status}`);
  const zipped = await response.arrayBuffer();
  const bytes = new Uint8Array(zipped);
  return bytes[0] === 0x1f && bytes[1] === 0x8b
    ? await new Response(new Blob([zipped]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : zipped; // Content-Encoding may already have been removed by the server/browser.
}

/** Fetch, validate against the loaded offline terrain seam, and build. Throws (fail closed). */
export async function loadDeepWest(options: { materials: DeepWestMaterials; offlineTerrainPositions: ArrayLike<number>; signal?: AbortSignal; url?: string }) {
  const start = performance.now();
  const buffer = await fetchBytes(options.url ?? DEEP_WEST_URL, options.signal);
  const data = decodeDeepWest(buffer, options.offlineTerrainPositions);
  const built = buildDeepWestGeometry(data);
  try { return new DeepWest(built, options.materials, performance.now() - start); }
  catch (error) { for (const p of built.parts) p.geometry.dispose(); throw error; }
}
