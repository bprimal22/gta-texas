// Downtown extension asset (Capitol strip seam z=1536 south to Lady Bird Lake): decoding and fail-closed
// validation. Built by tools/extension/bake-downtown.py. No three.js here: Node checks import this file directly.

export const DOWNTOWN_MAGIC = 0x54445455; // 'UTDT'
export const DOWNTOWN_VERSION = 1;

export type Ring = [number, number][];
export type PolygonRings = Ring[];
export type RGB = [number, number, number];

/** Facade treatments drawn by the downtown facade shader (materials.ts FACADE_CODE). */
export type FacadeKind = 'curtain' | 'balcony' | 'punched' | 'ribbon' | 'historic' | 'garage' | 'podium' | 'banded' | 'whitegrid' | 'stone';

export interface DowntownTier {
  r: PolygonRings;
  /** Roof Y (campus metres); with `pl` the roof plane's highest point. */
  y: number;
  /** Bottom Y when the tier starts above ground (setback/cantilever); otherwise the building base. */
  b?: number;
  f: FacadeKind; w: RGB; a: RGB;
  /** Sloped (chamfered) roof plane: top(x,z) = pl[0]*x + pl[1]*z + pl[2]. */
  pl?: [number, number, number];
}
export interface DowntownCrown { type: 'frame' | 'parapet' | 'fin' | 'spires' | 'mast'; h: number; color: RGB; c: [number, number]; u: [number, number]; L: number; W: number; y: number }
export interface DowntownBuilding {
  k: string; src: 'coa2023' | 'osm' | 'landmark'; id: number;
  /** Terrain min/max under the footprint. */
  g: [number, number];
  basis: string; kind: string; name: string;
  tiers: DowntownTier[];
  lm?: string; crown?: DowntownCrown;
  /** Outside the playable area (south bank, I-35 band): rendered, never collidable. */
  visual: boolean;
  /** Chunk index (row-major, meta.chunks = [nx, nz]). */
  c: number;
  /** Seam-stitched: this whole City footprint replaces the clipped Capitol-strip (b14) record with this key. */
  replaces?: string;
  heightPolicy?: 'overall';
}
export interface DowntownLandmark { key: string; name: string; osm: number; heightM: number; roofM?: number; heightBasis: string; sources: string[]; evidence: string; base?: string; crown?: { type: string; height: number } }
export interface DowntownMeta {
  format: 'ut-downtown'; version: number;
  rect: { xmin: number; xmax: number; zmin: number; zmax: number };
  step: number; chunk: number; chunks: [number, number];
  grid: { nx: number; nz: number };
  seam: { z: number; x0: number; x1: number; stripSeamSha256: string; seamVertices: number; maxSeamBlendShift: number };
  water: { y: number; surfaceY: number; navd88: number };
  classMap: { w: number; h: number; res: number };
  playable: PolygonRings;
  walls: [number, number, number, number][];
  barriers: [number, number, number, number][];
  barrierTop: number;
  buildings: DowntownBuilding[];
  landmarks: DowntownLandmark[];
  counts: Record<string, number>;
  claims: string;
  sections: { name: string; type: 'f32' | 'u8'; byteOffset: number; count: number }[];
}
export interface DowntownData {
  meta: DowntownMeta;
  heights: Float32Array;
  /** Per terrain cell: bit0 rendered, bit1 collidable. */
  cellFlags: Uint8Array;
  classMap: Uint8Array;
  /** x, groundY, z, height, crownRadius, playable (6 floats per tree). */
  trees: Float32Array;
  /** Triangle soup (9 floats per triangle) and per-triangle collide flag. */
  bridges: Float32Array;
  bridgeCollide: Uint8Array;
  water: Float32Array;
  checksum: number;
  bytes: number;
  seam: { matched: number; maxAbsDelta: number };
}

export class DowntownAssetError extends Error {}
const fail = (message: string): never => { throw new DowntownAssetError(`Downtown asset rejected: ${message}`); };

export function fnvWords(bytes: Uint8Array) {
  if (bytes.byteLength % 4) fail('checksummed body is not word aligned');
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  let h = 2166136261;
  for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i], 16777619) >>> 0;
  return h >>> 0;
}

/** Strip patch seam row (z = 1536) exactly as blocks/b14-capitol/strip-ground.ts decodes it. */
export interface StripSeamSource { x0: number; z0: number; step: number; nx: number; nz: number; unit: number; heights: string }
export function stripSeamRow(strip: StripSeamSource): Map<number, number> {
  const bin = atob(strip.heights), view = new DataView(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) view.setUint8(i, bin.charCodeAt(i));
  const row = new Map<number, number>(), f = new Float32Array(1), j = strip.nz - 1;
  for (let i = 0; i < strip.nx; i++) {
    f[0] = view.getInt16((j * strip.nx + i) * 2, true) * strip.unit;
    row.set(strip.x0 + i * strip.step, f[0]);
  }
  return row;
}

/** Decode + validate (fail closed): magic/version/checksum, section bounds and counts, geometry ranges, and the
 * seam row float-identical to the loaded Capitol strip patch. */
export function decodeDowntown(buffer: ArrayBuffer, strip: StripSeamSource): DowntownData {
  if (buffer.byteLength < 16) fail('truncated header');
  const head = new DataView(buffer);
  if (head.getUint32(0, true) !== DOWNTOWN_MAGIC) fail('bad magic');
  if (head.getUint32(4, true) !== DOWNTOWN_VERSION) fail('unsupported version');
  const metaLength = head.getUint32(8, true);
  const body = new Uint8Array(buffer, 16);
  if (metaLength > body.byteLength || metaLength % 4) fail('bad metadata length');
  if (fnvWords(body) !== head.getUint32(12, true)) fail('checksum mismatch');
  let meta: DowntownMeta;
  try { meta = JSON.parse(new TextDecoder().decode(body.subarray(0, metaLength))); } catch { return fail('metadata is not JSON'); }
  if (meta.format !== 'ut-downtown' || meta.version !== DOWNTOWN_VERSION) fail('metadata format');
  const data = body.byteOffset + metaLength;
  const dataBytes = body.byteLength - metaLength;
  const section = (name: string) => {
    const s = meta.sections.find(q => q.name === name) ?? fail(`missing section ${name}`);
    const size = s.type === 'f32' ? 4 : 1;
    if (s.byteOffset % 4 || s.byteOffset + s.count * size > dataBytes || s.count < 0) fail(`section ${name} out of bounds`);
    return s.type === 'f32' ? new Float32Array(buffer, data + s.byteOffset, s.count) : new Uint8Array(buffer, data + s.byteOffset, s.count);
  };
  const { nx, nz } = meta.grid;
  const r = meta.rect;
  if (nx !== Math.round((r.xmax - r.xmin) / meta.step) + 1 || nz !== Math.round((r.zmax - r.zmin) / meta.step) + 1) fail('grid does not match rect');
  const heights = section('heights') as Float32Array;
  const cellFlags = section('cellFlags') as Uint8Array;
  const classMap = section('classMap') as Uint8Array;
  if (heights.length !== nx * nz) fail('height count');
  if (cellFlags.length !== (nx - 1) * (nz - 1)) fail('cell flag count');
  if (classMap.length !== meta.classMap.w * meta.classMap.h) fail('class map size');
  for (let i = 0; i < heights.length; i++) if (!(heights[i] > -80 && heights[i] < 80)) fail('terrain height out of range');
  const trees = section('trees') as Float32Array, bridges = section('bridges') as Float32Array;
  const bridgeCollide = section('bridgeCollide') as Uint8Array, water = section('water') as Float32Array;
  if (trees.length % 6 || bridges.length % 9 || water.length % 9 || bridgeCollide.length * 9 !== bridges.length) fail('geometry section sizes');
  for (const arr of [trees, bridges, water]) for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) fail('non-finite geometry');
  if (!(meta.seam.z === r.zmin)) fail('seam is not the north edge');
  // Seam: float-identical to the strip patch's last row on the shared span.
  if (strip.z0 + (strip.nz - 1) * strip.step !== meta.seam.z || strip.step !== meta.step) fail('strip patch does not end on the seam');
  const row = stripSeamRow(strip);
  let matched = 0, maxAbsDelta = 0;
  for (let i = 0; i < nx; i++) {
    const x = r.xmin + i * meta.step;
    if (x < meta.seam.x0 - 1e-6 || x > meta.seam.x1 + 1e-6) continue;
    const y = row.get(x);
    if (y === undefined) fail(`strip has no vertex at x=${x}`);
    maxAbsDelta = Math.max(maxAbsDelta, Math.abs(heights[i] - (y as number)));
    if (heights[i] !== y) fail(`seam height differs at x=${x}`);
    matched++;
  }
  if (matched !== meta.seam.seamVertices) fail('seam vertex count');
  for (const b of meta.buildings) {
    if (!b.tiers.length) fail(`building ${b.k} has no tiers`);
    for (const t of b.tiers) if (!(t.y > b.g[0] && t.y < b.g[0] + 400) || t.r[0].length < 3) fail(`building ${b.k} tier out of range`);
  }
  return { meta, heights, cellFlags, classMap, trees, bridges, bridgeCollide, water, checksum: head.getUint32(12, true),
    bytes: buffer.byteLength, seam: { matched, maxAbsDelta } };
}
