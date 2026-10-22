// Deep-west extension asset (districts D37-D40, x < -760): decoding and fail-closed validation.
// Built by tools/extension/bake-deep-west.py from 2023 City of Austin planimetrics and the
// USGS 3DEP bare-earth DEM. No three.js here: Node checks import this file directly.

export const DEEP_WEST_MAGIC = 0x57445455; // 'UTDW'
export const DEEP_WEST_VERSION = 1;
export const SEAM_X = -760;

export type Ring = [number, number][];
export type PolygonRings = Ring[]; // exterior first (counter-clockwise in x/z), then holes

export interface RoofGable { form: 'gable-estimated'; ridge: [[number, number], [number, number]]; ridgeY: number; slope: number; eaveY: number; halves: PolygonRings[]; family: string; rgb: [number, number, number] }
export interface RoofFlat { form: 'flat-parapet' | 'flat'; deckY: number; topY: number; deck?: PolygonRings[]; coping?: PolygonRings[]; family: string; rgb: [number, number, number] }
export interface DeepWestBuilding {
  key: string; sourceId: number; district: string;
  /** Source footprint: exterior + courtyard holes, orientation normalised (exterior CCW in x/z). */
  rings: PolygonRings;
  sourceRingCount: number;
  heightMeters: number; groundMin: number; groundMax: number; baseMinusGround: number;
  wall: { family: string; rgb: [number, number, number] };
  roof: RoofGable | RoofFlat;
}
export interface DistrictStyle { rectangles: number[][]; style: string; floor: number; bay: number; window: [number, number, number]; frame: number; surround: number }
export interface DeepWestMeta {
  format: 'ut-deep-west'; version: number;
  union: { xmin: number; xmax: number; zmin: number; zmax: number };
  districts: Record<string, DistrictStyle>;
  seam: { x: number; blendWidth: number; offlineSeamSha256: string; vertices: [number, number][] };
  drape: number;
  /** Drape fades linearly to 0 over this width west of the seam (flush with the old terrain at x=-760). */
  drapeFade: number;
  sections: { name: string; type: 'f32' | 'u32'; byteOffset: number; count: number }[];
  buildings: DeepWestBuilding[];
  map: { surfaces: Record<string, PolygonRings[]> };
  counts: { buildings: number; excludedBuildings: number; terrainVertices: number; terrainTriangles: number; surfaceTriangles: Record<string, number> };
}
export interface DeepWestData {
  meta: DeepWestMeta;
  terrainPosition: Float32Array;
  terrainIndex: Uint32Array;
  surfaces: Map<string, Float32Array>;
  seam: { matched: number; maxAbsDelta: number };
  checksum: number;
  bytes: number;
}

export class DeepWestAssetError extends Error {}
const fail = (message: string): never => { throw new DeepWestAssetError(`Deep West asset rejected: ${message}`); };

/** FNV-1a over little-endian 32-bit words (matches the bake). */
export function fnvWords(bytes: Uint8Array) {
  if (bytes.byteLength % 4) fail('checksummed body is not word aligned');
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  let h = 2166136261;
  for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i], 16777619) >>> 0;
  return h >>> 0;
}

/** Old-world seam column (x = -760) from the offline-terrain-61 position buffer: z -> y. */
export function offlineSeam(positions: ArrayLike<number>) {
  const seam = new Map<number, number>();
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i] !== SEAM_X) continue;
    const z = positions[i + 2], y = positions[i + 1], known = seam.get(z);
    if (known !== undefined && known !== y) fail(`old seam is inconsistent at z=${z}`);
    seam.set(z, y);
  }
  return seam;
}

/** Decode and validate. Throws DeepWestAssetError on any inconsistency; never returns partial data.
 * `offlinePositions` must be the loaded offline-terrain-61 buffer: the seam column must be float-identical. */
export function decodeDeepWest(buffer: ArrayBuffer, offlinePositions: ArrayLike<number>): DeepWestData {
  if (buffer.byteLength < 20) fail('truncated header');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== DEEP_WEST_MAGIC) fail('bad magic');
  if (view.getUint32(4, true) !== DEEP_WEST_VERSION) fail('unsupported version');
  const metaBytes = view.getUint32(8, true), payloadBytes = view.getUint32(12, true), checksum = view.getUint32(16, true);
  if (metaBytes % 4 || payloadBytes % 4 || 20 + metaBytes + payloadBytes !== buffer.byteLength) fail('length mismatch');
  const body = new Uint8Array(buffer, 20);
  if (fnvWords(body) !== checksum) fail('checksum mismatch');
  let meta: DeepWestMeta;
  try { meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, metaBytes))) as DeepWestMeta; }
  catch { return fail('metadata is not JSON'); }
  if (meta.format !== 'ut-deep-west' || meta.version !== DEEP_WEST_VERSION) fail('metadata format');
  const u = meta.union;
  if (!u || u.xmax !== SEAM_X || !(u.xmin < u.xmax) || !(u.zmin < u.zmax)) fail('owned union');
  if (!(meta.drape >= 0 && meta.drape < 0.1) || !(meta.drapeFade > 0 && meta.drapeFade <= 8)) fail('surface drape parameters');
  const payloadStart = 20 + metaBytes;
  const section = (name: string) => {
    const s = meta.sections.find(x => x.name === name);
    if (!s) return fail(`missing section ${name}`);
    if (s.byteOffset % 4 || s.byteOffset + s.count * 4 > payloadBytes) fail(`section ${name} out of range`);
    return s.type === 'u32' ? new Uint32Array(buffer, payloadStart + s.byteOffset, s.count)
      : new Float32Array(buffer, payloadStart + s.byteOffset, s.count);
  };
  const eps = 1e-3;
  const inUnion = (p: ArrayLike<number>, name: string) => {
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) fail(`${name} has a non-finite vertex`);
      if (x > SEAM_X) fail(`${name} reaches east of the seam (x=${x})`);
      if (x < u.xmin - eps || z < u.zmin - eps || z > u.zmax + eps) fail(`${name} leaves the owned union`);
      if (y < -60 || y > 200) fail(`${name} height out of range`);
    }
  };
  const terrainPosition = section('terrain.position') as Float32Array;
  const terrainIndex = section('terrain.index') as Uint32Array;
  if (terrainPosition.length % 3 || terrainIndex.length % 3 || terrainPosition.length / 3 !== meta.counts.terrainVertices
    || terrainIndex.length / 3 !== meta.counts.terrainTriangles) fail('terrain counts');
  inUnion(terrainPosition, 'terrain');
  const vertexCount = terrainPosition.length / 3;
  for (let i = 0; i < terrainIndex.length; i++) if (terrainIndex[i] >= vertexCount) fail('terrain index out of range');
  const surfaces = new Map<string, Float32Array>();
  for (const s of meta.sections) {
    if (!s.name.startsWith('surface.')) continue;
    const p = section(s.name) as Float32Array;
    if (p.length % 9 || p.length / 9 !== meta.counts.surfaceTriangles[s.name.slice(8)]) fail(`${s.name} counts`);
    inUnion(p, s.name);
    surfaces.set(s.name.slice(8), p);
  }
  // Seam: every extension vertex on x=-760 at an old 8 m vertex must carry the identical float.
  const old = offlineSeam(offlinePositions);
  let matched = 0, maxAbsDelta = 0;
  for (let i = 0; i < terrainPosition.length; i += 3) {
    if (terrainPosition[i] !== SEAM_X) continue;
    const z = terrainPosition[i + 2], y = terrainPosition[i + 1];
    const exact = old.get(z);
    if (exact !== undefined) {
      if (exact !== y) fail(`seam height differs at z=${z} (${y} vs ${exact})`);
      matched++;
      continue;
    }
    // Corner rows lie on an old 8 m edge: linear interpolation of its two old vertices.
    const z0 = Math.floor(z / 8) * 8, a = old.get(z0), b = old.get(z0 + 8);
    if (a === undefined || b === undefined) fail(`seam vertex z=${z} has no old edge`);
    const expected = a! + (b! - a!) * (z - z0) / 8;
    maxAbsDelta = Math.max(maxAbsDelta, Math.abs(expected - y));
    if (Math.abs(expected - y) > 1e-4) fail(`seam corner z=${z} is off the old edge`);
  }
  const expectedSeam = meta.seam.vertices.filter(([z]) => z >= u.zmin && z <= u.zmax).length;
  if (matched !== expectedSeam || matched < 10) fail(`seam matched ${matched} of ${expectedSeam} old vertices`);
  for (const [z, y] of meta.seam.vertices) if (old.get(z) !== Math.fround(y)) fail(`declared seam vertex z=${z} differs from offline terrain`);
  // Buildings: finite, inside the owned union with the 3 m indivisibility clearance.
  if (meta.buildings.length !== meta.counts.buildings) fail('building count');
  const keys = new Set<string>();
  for (const b of meta.buildings) {
    if (keys.has(b.key)) fail(`duplicate building ${b.key}`);
    keys.add(b.key);
    if (!meta.districts[b.district]) fail(`${b.key} has an unknown district`);
    if (!b.rings.length || b.rings.some(r => r.length < 3)) fail(`${b.key} rings`);
    for (const r of b.rings) for (const [x, z] of r) {
      if (!Number.isFinite(x) || !Number.isFinite(z) || x > u.xmax - 3 + eps || x < u.xmin + 3 - eps || z < u.zmin + 3 - eps || z > u.zmax - 3 + eps)
        fail(`${b.key} is not wholly owned with 3 m clearance`);
    }
    const top = b.roof.form === 'gable-estimated' ? b.roof.ridgeY : b.roof.topY;
    if (![b.heightMeters, b.groundMin, b.groundMax, top].every(Number.isFinite) || b.heightMeters <= 0 || top <= b.groundMin) fail(`${b.key} heights`);
  }
  return { meta, terrainPosition, terrainIndex, surfaces, seam: { matched, maxAbsDelta }, checksum, bytes: buffer.byteLength };
}
