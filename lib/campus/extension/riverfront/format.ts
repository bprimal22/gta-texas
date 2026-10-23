// Central riverfront extension asset (Lady Bird Lake south bank between the Lamar and South First bridges): decoding
// and fail-closed validation against the loaded downtown asset. Built by tools/extension/bake-riverfront.py.
// No three.js here: Node checks import this file directly.
import type { DowntownData, PolygonRings, Ring } from '../downtown/format';

export const RIVERFRONT_MAGIC = 0x46525455; // 'UTRF'
export const RIVERFRONT_VERSION = 1;

/** [ax, az, bx, bz, kind]: 0 wall, 1 open (shared with downtown), 2 deck edge (the Pfluger railings bound it). */
export type RegionEdge = [number, number, number, number, 0 | 1 | 2];
/** Physical wall piece: [ax, az, bx, bz, bottomY, topY, underDeck(0|1)]. Under-deck pieces stop below the Pfluger girders. */
export type WallPiece = [number, number, number, number, number, number, 0 | 1];
/** Low physical water barrier: [ax, az, bx, bz, bottomY, topY]. */
export type BarrierPiece = [number, number, number, number, number, number];

export interface RiverfrontPond { name: string; surfaceY: number; bankP5: number; bankP50: number; bankReturns: number; areaM2: number; ring: Ring; water: PolygonRings[] }
export interface RiverfrontDock { oid: number; pond: string; y: number; lidarReturns: number; r: PolygonRings }
export interface RiverfrontBuilding { k: string; bg: string; id: number; r: PolygonRings; g: [number, number]; y: number }
export interface PflugerApproach { arm: string; from: [number, number, number]; to: [number, number, number]; half: number; grade: number }
export interface RiverfrontPlace { key: string; name: string; p: [number, number] }
export interface LongCenterMeasure { ring: { c: [number, number]; r: number; top: number; fitPoints: number; medianResidual: number }; ground: number; terrace: number;
  volumes: { name: string; r: [number, number][]; top: number; areaM2: number }[] }
export interface PalmerMeasure { centre: [number, number]; corners: [number, number][]; sags: number[]; eaves: (number | null)[][]; rim: [number, number][]; plateau: number; ground: number }
export interface GazeboMeasure { c: [number, number]; r: number; ground: number }
/** Parking garage (City 1329594): City footprint ring, LiDAR bulk roof and compact cores; the City peak kept for provenance. */
export interface GarageMeasure { r: [number, number][]; ground: number; roof: number; levels: number; cores: { r: [number, number][]; top: number }[];
  lidarReturns: number; roofModeReturns: number; cityMaxHeightTop: number }
export interface RiverfrontMeta {
  format: 'ut-riverfront'; version: number;
  rect: { xmin: number; xmax: number; zmin: number; zmax: number }; step: number; grid: { nx: number; nz: number };
  downtown: { checksum: number; gzSha256: string; walls: number; wallsSum: number; gridOffset: [number, number]; gridNx: number };
  seam: { x: number; maxSeamBlendShift: number };
  water: { y: number; barrierTop: number };
  classMap: { w: number; h: number; res: number };
  land: PolygonRings; region: Ring[]; edges: RegionEdge[];
  walls: WallPiece[]; downtownWalls: WallPiece[]; barriers: BarrierPiece[];
  ponds: RiverfrontPond[]; docks: RiverfrontDock[]; buildings: RiverfrontBuilding[];
  downtownReplace: { k: string; id: number; as: 'long-center' | 'palmer' | 'gazebo' | 'garage' }[];
  /** Backdrop building keys inside the land (re-rendered here or replaced by the park). */
  backgroundSuppress: string[];
  downtownCollide: string[]; downtownBridgeTriangles: number[];
  landmarks: { longCenter: LongCenterMeasure; palmer: PalmerMeasure; gazebo: GazeboMeasure; garage: GarageMeasure; hill: { summitLidar: [number, number, number] } };
  places: RiverfrontPlace[];
  pfluger: { open: { name: string; x: number; z: number; r: number; kind: string; ground?: number }[]; approaches: PflugerApproach[] };
  counts: Record<string, number>; claims: string;
  sections: { name: string; type: 'f32' | 'u8' | 'u32'; byteOffset: number; count: number }[];
}
export interface RiverfrontData {
  meta: RiverfrontMeta;
  heights: Float32Array;
  /** Per cell: bit0 rendered, bit1 collidable (owned cells are both). */
  cellFlags: Uint8Array;
  classMap: Uint8Array;
  /** Downtown cell indices this extension owns (downtown stops rendering them; none is downtown-collidable). */
  ownedDowntownCells: Uint32Array;
  /** Riverfront vertices lowered under modelled water/floors (ponds, Long Center terrace): the only ones allowed to
   * differ from downtown, and only on cells downtown no longer draws. */
  terrainEdits: Uint32Array;
  /** x, groundY, z, height, crownRadius, playable (6 floats per tree), west of x = -1760 only. */
  trees: Float32Array;
  checksum: number; bytes: number;
  /** Shared-lattice vertices verified float-identical to downtown. */
  sharedVertices: number;
}

export class RiverfrontAssetError extends Error {}
const fail = (message: string): never => { throw new RiverfrontAssetError(`Riverfront asset rejected: ${message}`); };

export function fnvWords(bytes: Uint8Array) {
  if (bytes.byteLength % 4) fail('checksummed body is not word aligned');
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  let h = 2166136261;
  for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i], 16777619) >>> 0;
  return h >>> 0;
}

/** Sum of all downtown wall coordinates (binding cross-check next to the checksum). */
export function wallsSum(walls: number[][]) { let t = 0; for (const w of walls) for (const v of w) t += v; return Math.round(t * 100) / 100; }

const finite = (a: ArrayLike<number>) => { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; };
const segOk = (s: number[], n: number) => s.length === n && finite(s);

/** Decode + validate (fail closed) against the validated downtown data the asset was baked against. */
export function decodeRiverfront(buffer: ArrayBuffer, downtown: DowntownData): RiverfrontData {
  if (buffer.byteLength < 16) fail('truncated header');
  const head = new DataView(buffer);
  if (head.getUint32(0, true) !== RIVERFRONT_MAGIC) fail('bad magic');
  if (head.getUint32(4, true) !== RIVERFRONT_VERSION) fail('unsupported version');
  const metaLength = head.getUint32(8, true);
  const body = new Uint8Array(buffer, 16);
  if (metaLength > body.byteLength || metaLength % 4) fail('bad metadata length');
  if (fnvWords(body) !== head.getUint32(12, true)) fail('checksum mismatch');
  let meta: RiverfrontMeta;
  try { meta = JSON.parse(new TextDecoder().decode(body.subarray(0, metaLength))); } catch { return fail('metadata is not JSON'); }
  if (meta.format !== 'ut-riverfront' || meta.version !== RIVERFRONT_VERSION) fail('metadata format');
  // Binding to the downtown asset it was baked against.
  if (meta.downtown.checksum !== downtown.checksum) fail('baked against a different downtown asset');
  if (meta.downtown.walls !== downtown.meta.walls.length || Math.abs(meta.downtown.wallsSum - wallsSum(downtown.meta.walls)) > .05) fail('downtown wall list differs');
  const dm = downtown.meta;
  if (meta.water.y !== dm.water.y || meta.water.barrierTop !== dm.barrierTop) fail('water datum differs from downtown');
  if (meta.step !== dm.step || meta.downtown.gridNx !== dm.grid.nx) fail('grid differs from downtown');
  const data = body.byteOffset + metaLength, dataBytes = body.byteLength - metaLength;
  const section = (name: string) => {
    const s = meta.sections.find(q => q.name === name) ?? fail(`missing section ${name}`);
    const size = s.type === 'u8' ? 1 : 4;
    if (s.byteOffset % 4 || s.count < 0 || s.byteOffset + s.count * size > dataBytes) fail(`section ${name} out of bounds`);
    return s.type === 'f32' ? new Float32Array(buffer, data + s.byteOffset, s.count)
      : s.type === 'u32' ? new Uint32Array(buffer, data + s.byteOffset, s.count) : new Uint8Array(buffer, data + s.byteOffset, s.count);
  };
  const { nx, nz } = meta.grid, r = meta.rect;
  if (nx !== Math.round((r.xmax - r.xmin) / meta.step) + 1 || nz !== Math.round((r.zmax - r.zmin) / meta.step) + 1) fail('grid does not match rect');
  const [oi, oj] = meta.downtown.gridOffset;
  if (r.xmin !== dm.rect.xmin + oi * meta.step || r.zmin !== dm.rect.zmin + oj * meta.step) fail('grid is not on the downtown lattice');
  if (r.zmin < dm.rect.zmin || r.zmax > dm.rect.zmax || r.xmax > dm.rect.xmax || r.xmin > meta.seam.x || meta.seam.x !== dm.rect.xmin) fail('grid outside the downtown rectangle');
  const heights = section('heights') as Float32Array, cellFlags = section('cellFlags') as Uint8Array, classMap = section('classMap') as Uint8Array;
  const owned = section('ownedDowntownCells') as Uint32Array, terrainEdits = section('terrainEdits') as Uint32Array, trees = section('trees') as Float32Array;
  if (heights.length !== nx * nz || cellFlags.length !== (nx - 1) * (nz - 1)) fail('grid section sizes');
  if (classMap.length !== meta.classMap.w * meta.classMap.h || meta.classMap.w !== (r.xmax - r.xmin) / meta.classMap.res || meta.classMap.h !== (r.zmax - r.zmin) / meta.classMap.res) fail('class map size');
  for (let i = 0; i < heights.length; i++) if (!(heights[i] > -80 && heights[i] < 80)) fail('terrain height out of range');
  for (let i = 0; i < classMap.length; i++) if (classMap[i] > 8) fail('class out of range');
  if (trees.length % 6 || !finite(trees)) fail('tree section');
  // Owned downtown cells: in range, strictly increasing, rendered and NOT collidable in downtown, inside this grid and
  // flagged rendered+collidable here.
  const dnx = dm.grid.nx, dcells = downtown.cellFlags;
  for (let k = 0; k < owned.length; k++) {
    const c = owned[k];
    if (k && c <= owned[k - 1]) fail('owned cells not sorted');
    if (c >= dcells.length || (dcells[c] & 3) !== 1) fail('owned downtown cell is not a visual-only cell');
    const i = c % (dnx - 1) - oi, j = Math.floor(c / (dnx - 1)) - oj;
    if (i < 0 || j < 0 || i >= nx - 1 || j >= nz - 1 || cellFlags[j * (nx - 1) + i] !== 3) fail('owned cell outside the riverfront grid');
  }
  // Completeness (reverse): every cell this asset renders east of the seam is an owned downtown cell or one downtown never
  // draws (under a former footprint); otherwise both would render it. Flags are 0 (not ours) or 3 (rendered + collidable).
  const ownedSet = new Set<number>(owned);
  const ci0 = Math.round((meta.seam.x - r.xmin) / meta.step);
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const f = cellFlags[j * (nx - 1) + i];
    if (f !== 0 && f !== 3) fail('cell flag value');
    if (f === 3 && i >= ci0) {
      const dc = (j + oj) * (dnx - 1) + i + oi;
      if (!ownedSet.has(dc) && (dcells[dc] & 1)) fail('rendered cell east of the seam is not owned');
    }
  }
  // Shared lattice: every riverfront vertex at x >= seam is a float-identical copy of downtown, except listed pond
  // vertices (sorted, unique), which must belong only to owned cells (downtown never renders them).
  const edits = new Set<number>();
  for (let k = 0; k < terrainEdits.length; k++) {
    if (terrainEdits[k] >= heights.length || (k && terrainEdits[k] <= terrainEdits[k - 1])) fail('terrain edit index');
    edits.add(terrainEdits[k]);
  }
  let shared = 0;
  const i0 = Math.round((meta.seam.x - r.xmin) / meta.step);
  for (let j = 0; j < nz; j++) for (let i = i0; i < nx; i++) {
    const k = j * nx + i, d = (j + oj) * dnx + (i + oi);
    if (edits.has(k)) {
      for (const [di, dj] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
        const ci = i + oi + di, cj = j + oj + dj;
        if (ci < 0 || cj < 0 || ci >= dnx - 1) continue;
        const dc = cj * (dnx - 1) + ci;
        if ((dcells[dc] & 1) && !ownedSet.has(dc)) fail('terrain edit touches a downtown-rendered cell');
      }
      continue;
    }
    if (heights[k] !== downtown.heights[d]) fail(`terrain differs from downtown at x=${r.xmin + i * meta.step}, z=${r.zmin + j * meta.step}`);
    shared++;
  }
  // Region / wall geometry.
  if (!meta.edges.length || !meta.edges.every(e => segOk(e, 5) && [0, 1, 2].includes(e[4]))) fail('region edges');
  for (let k = 0; k < meta.edges.length; k++) {
    const a = meta.edges[k], b = meta.edges[(k + 1) % meta.edges.length];
    if (Math.hypot(a[2] - b[0], a[3] - b[1]) > .02) fail('region edges do not form a closed ring');
  }
  if (!meta.walls.every(w => segOk(w, 7) && w[4] < w[5]) || !meta.downtownWalls.every(w => segOk(w, 7) && w[4] < w[5])) fail('wall pieces');
  if (!meta.barriers.every(b => segOk(b, 6) && b[4] < b[5])) fail('barrier pieces');
  if (!meta.land.length || meta.land[0].length < 3) fail('land polygon');
  for (const p of meta.ponds) if (!(p.surfaceY > meta.water.y && p.surfaceY < meta.water.y + 15) || p.ring.length < 3) fail(`pond ${p.name}`);
  if (meta.downtownReplace.map(q => q.as).sort().join() !== 'garage,gazebo,long-center,palmer') fail('expected the Long Center, Palmer, gazebo and garage replacements');
  if (!Array.isArray(meta.backgroundSuppress) || !meta.backgroundSuppress.every(k => typeof k === 'string')) fail('backdrop suppression list');
  const keys = new Set(dm.buildings.map(b => b.k));
  for (const k of [...meta.downtownReplace.map(q => q.k), ...meta.downtownCollide]) if (!keys.has(k)) fail(`unknown downtown building ${k}`);
  const ntri = downtown.bridges.length / 9;
  if (!meta.downtownBridgeTriangles.every(t => Number.isInteger(t) && t >= 0 && t < ntri)) fail('bridge triangle index');
  for (const b of meta.buildings) if (!(b.y > b.g[0] + 1 && b.y < b.g[0] + 80) || b.r[0].length < 3) fail(`building ${b.k}`);
  for (const a of meta.pfluger.approaches) if (!(segOk(a.from, 3) && segOk(a.to, 3) && a.half > 1 && a.half < 4 && a.grade < .2)) fail('Pfluger approach');
  const lc = meta.landmarks.longCenter, pm = meta.landmarks.palmer, gz = meta.landmarks.gazebo;
  if (!(lc.ring.r > 30 && lc.ring.r < 55 && lc.ring.top > lc.terrace + 5 && lc.ring.top < lc.terrace + 20 && Math.abs(lc.terrace - lc.ground) < 6)) fail('Long Center ring measurement');
  for (const n of ['hall', 'stage']) {
    const v = lc.volumes.find(q => q.name === n);
    if (!v || v.r.length !== 4 || !v.r.every(p => segOk(p, 2)) || !(v.top > lc.terrace + 10 && v.top < lc.terrace + 40)) fail(`Long Center ${n} volume`);
  }
  if (pm.corners.length !== 4 || pm.sags.length !== 4 || pm.eaves.length !== 4 || pm.rim.length !== 4 || !(pm.plateau > pm.ground + 6 && pm.plateau < pm.ground + 30)
    || !pm.eaves.every(e => e.length === 5 && e.some(v => v !== null) && e.every(v => v === null || (v > pm.ground + 3 && v < pm.ground + 25)))) fail('Palmer measurement');
  if (!(gz.r > 3 && gz.r < 12 && Number.isFinite(gz.ground))) fail('gazebo measurement');
  const ga = meta.landmarks.garage;
  if (ga.r.length < 4 || !ga.r.every(p => segOk(p, 2)) || !(ga.roof > ga.ground + 4 && ga.roof < ga.ground + 25) || !(ga.levels >= 2 && ga.levels <= 8)
    || !ga.cores.every(c => c.r.length === 4 && c.r.every(p => segOk(p, 2)) && c.top > ga.roof && c.top < ga.roof + 12)) fail('garage measurement');
  for (const d of meta.docks) if (!(d.r[0].length >= 3 && d.r[0].every(p => segOk(p, 2)) && meta.ponds.some(p => p.name === d.pond && d.y > p.surfaceY && d.y < p.surfaceY + 3))) fail(`dock ${d.oid}`);
  return { meta, heights, cellFlags, classMap, ownedDowntownCells: owned, terrainEdits, trees, checksum: head.getUint32(12, true),
    bytes: buffer.byteLength, sharedVertices: shared };
}
