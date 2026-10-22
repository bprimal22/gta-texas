import * as THREE from 'three';
import type { Building, Point } from '../types';
import type { BuildingSpec, WallFamily, WindowSpec, RoofForm } from './catalog';
import type { Volume, Massing } from './massing';
import { hipRise } from './massing';
import { Batch, type FacadeAttr } from './batch';
import { ColliderBuilder, offsetRing, distanceToRings, triangulate, signedArea } from '../context-geometry';
import type { PathIndex } from './paths';
import { MAX_DETAIL_FLOOR } from './materials';

/** Shell geometry for one catalogued context building: walls carrying the
 * facade-opening attributes (openings are drawn by the wall shader far away and
 * replaced by recessed geometry near the camera, see detail.ts), stone plinth,
 * belt course, cornice/parapet with coping, metal sunshades, hipped tile or
 * shingle roofs with soffits, flat roofs with decks. Every solid face that a
 * player can stand on or walk into has a matching collider triangle. */

export type MaterialKey = `wall:${WallFamily}` | 'roof:clayTile' | 'roof:shingle' | 'roof:membrane' | 'glass' | 'frame';
export type BatchFor = (key: MaterialKey) => Batch;

export const OPENING = { none: 0, punched: 1, ribbon: 2, glazed: 3, open: 4, door: 5 } as const;
export type OpeningType = keyof typeof OPENING;
const FRAME = { dark: 0, bronze: 1, light: 2 } as const;

export function openingCode(type: OpeningType, mullions: number, transom: boolean, frame: keyof typeof FRAME, surround: boolean) {
  return OPENING[type] + 8 * Math.min(3, Math.max(0, mullions)) + 32 * (transom ? 1 : 0) + 64 * FRAME[frame] + 256 * (surround ? 1 : 0);
}

/** One horizontal run of identical openings on a facade edge, shared by the
 * shell attributes and the near-camera detail builder. */
export interface OpeningRun {
  ax: number; az: number; dx: number; dz: number; nx: number; nz: number;
  s0: number; s1: number; bayW: number; width: number;
  /** Absolute floor-line heights of each storey with openings, and that storey's opening sill/head (m above the line). */
  floors: number[]; sill: number; head: number;
  type: OpeningType; mullions: number; transom: boolean; frame: keyof typeof FRAME; surround: boolean;
  family: WallFamily; color: THREE.Color; trim: WallFamily; trimColor: THREE.Color; depth: number;
}
export interface EaveRun { ring: Point[]; wall: Point[]; y: number; overhang: number; family: WallFamily; color: THREE.Color }
export interface DetailSource { id: number; x: number; z: number; runs: OpeningRun[]; eaves: EaveRun[] }

export interface FloorGrid { floor0: number; ground: number; floor: number; storeys: number }

export interface ArchStats {
  triangles: number; colliderTriangles: number; hipRoofs: number; flatRoofs: number; failedRoofs: number;
  volumes: number; tierVolumes: number; mechVolumes: number; estimatedMech: number; doors: number; storefrontEdges: number;
  sunshades: number; openings: number;
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
const FRAME_COLOR: Record<string, THREE.Color> = {
  dark: new THREE.Color(0.055, 0.06, 0.065), bronze: new THREE.Color(0.09, 0.065, 0.045), light: new THREE.Color(0.78, 0.77, 0.74),
};
export const frameColor = (k: string) => FRAME_COLOR[k] ?? FRAME_COLOR.dark;
const METAL_TRIM = new THREE.Color('#a8abad');
const CROWN = new THREE.Color('#bdb9b0');

interface Context {
  b: Building; spec: BuildingSpec; batch: BatchFor; collider: ColliderBuilder; stats: ArchStats;
  ground: (x: number, z: number) => number; paths: PathIndex;
}

/** Edges that face a street (storefronts) or carry an entrance. */
interface EdgeRole { door?: { s: number }; storefront?: boolean }

function edgesOf(rings: Point[][]) {
  const edges: { ring: number; i: number; ax: number; az: number; bx: number; bz: number; len: number; dx: number; dz: number; nx: number; nz: number }[] = [];
  rings.forEach((ring, r) => {
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      edges.push({ ring: r, i, ax, az, bx, bz, len, dx, dz, nx: dz, nz: -dx });
    }
  });
  return edges;
}

/** Pick entrance edges facing the nearest walk and storefront edges facing streets. */
function edgeRoles(ctx: Context, rings: Point[][], perimeter: number) {
  const roles = new Map<string, EdgeRole>();
  const { spec, paths } = ctx;
  const edges = edgesOf([rings[0]]).filter(e => e.len >= Math.max(3, spec.arch.door.width + 1));
  const isShed = spec.archetype === 'shed' || spec.archetype === 'garage';
  // Storefronts: commercial archetypes on any street; West Campus housing on major streets.
  const wantsStore = spec.storefront || spec.archetype === 'wc-tower' || spec.archetype === 'wc-midrise';
  if (wantsStore) for (const e of edges) {
    const mx = e.ax + e.dx * e.len / 2 + e.nx * 2, mz = e.az + e.dz * e.len / 2 + e.nz * 2;
    const hit = paths.nearest(mx, mz, 22, k => spec.storefront ? k !== 'footway' && k !== 'steps' && k !== 'service' : k === 'primary' || k === 'secondary' || k === 'primary_link' || k === 'secondary_link');
    if (!hit) continue;
    // Street must lie in front of the edge.
    if ((hit.x - (e.ax + e.dx * e.len / 2)) * e.nx + (hit.z - (e.az + e.dz * e.len / 2)) * e.nz < 1) continue;
    roles.set(`0:${e.i}`, { storefront: true });
  }
  if (isShed && spec.archetype === 'garage') return roles;
  const scored = edges.map(e => {
    const mx = e.ax + e.dx * e.len / 2, mz = e.az + e.dz * e.len / 2;
    let best: { d: number; x: number; z: number } | null = null;
    for (const t of [0.25, 0.5, 0.75]) {
      const px = e.ax + e.dx * e.len * t + e.nx * 1.5, pz = e.az + e.dz * e.len * t + e.nz * 1.5;
      const hit = paths.nearest(px, pz, 45);
      if (!hit) continue;
      const front = (hit.x - mx) * e.nx + (hit.z - mz) * e.nz;
      if (front < 0.5) continue;
      const d = hit.distance - (hit.pedestrian ? 6 : 0);
      if (!best || d < best.d) best = { d, x: hit.x, z: hit.z };
    }
    return { e, best };
  }).filter(s => s.best).sort((a, b) => a.best!.d - b.best!.d);
  const count = perimeter > 160 ? 2 : 1;
  const used: { nx: number; nz: number }[] = [];
  for (const { e, best } of scored) {
    if (used.length >= count) break;
    if (used.some(u => u.nx * e.nx + u.nz * e.nz > 0.3)) continue;
    const s = THREE.MathUtils.clamp((best!.x - e.ax) * e.dx + (best!.z - e.az) * e.dz, 0, e.len);
    const key = `0:${e.i}`;
    roles.set(key, { ...roles.get(key), door: { s } });
    used.push(e);
  }
  return roles;
}

/** Floor grid fitted to the tallest occupied volume. */
function fitGrid(spec: BuildingSpec, floor0: number, deck: number): FloorGrid {
  const arch = spec.arch, f = arch.floor;
  const avail = deck - floor0;
  if (avail < arch.groundFloor + Math.max(1.2, f * 0.6)) {
    const g = THREE.MathUtils.clamp(avail - 0.5, 2.4, Math.max(2.4, arch.groundFloor));
    return { floor0, ground: g, floor: f, storeys: 1 };
  }
  const g = arch.groundFloor;
  let n = Math.max(1, Math.round((avail - g - 0.9) / f));
  let fit = (avail - g - 0.9) / n;
  if (fit < f * 0.95 && n > 1) { n--; fit = (avail - g - 0.9) / n; }
  if (fit > f * 1.12) { n++; fit = (avail - g - 0.9) / n; }
  // Leftover height goes into the attic/parapet band above the top storey.
  return { floor0, ground: g, floor: THREE.MathUtils.clamp(fit, f * 0.95, f * 1.12), storeys: n + 1 };
}

const floorY = (g: FloorGrid, k: number) => k <= 0 ? g.floor0 : g.floor0 + g.ground + (k - 1) * g.floor;
const vOf = (g: FloorGrid, y: number) => y < g.floor0 + g.ground ? (y - g.floor0) / g.ground : 1 + (y - g.floor0 - g.ground) / g.floor;

export function buildArchitecture(b: Building, rings: Point[][], spec: BuildingSpec, massing: Massing, ctx0: Omit<Context, 'b' | 'spec'>): DetailSource {
  const ctx: Context = { ...ctx0, b, spec };
  const { ground, batch, collider, stats } = ctx;
  const arch = spec.arch;
  // Ground samples around the footprint.
  const samples: number[] = [];
  for (const ring of rings) for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 6));
    for (let k = 0; k < n; k++) samples.push(ground(ax + (bx - ax) * k / n, az + (bz - az) * k / n));
  }
  samples.push(ground(b.center[0], b.center[1]));
  samples.sort((a, c) => a - c);
  const low = samples[0], high = samples[samples.length - 1], grade = samples[Math.floor(samples.length / 2)];
  const base = low - 1.2;
  // Volume heights are above this campus Y: the median grade, or a block's explicit datum (Massing.heightBase).
  const hb = massing.heightBase ?? grade;
  let perimeter = 0;
  for (const e of edgesOf([rings[0]])) perimeter += e.len;
  const roles = edgeRoles(ctx, rings, perimeter);
  const doorEdge = [...roles.entries()].find(([, r]) => r.door);
  let floor0 = grade;
  if (doorEdge) {
    const e = edgesOf([rings[0]]).find(x => `0:${x.i}` === doorEdge[0])!;
    const s = doorEdge[1].door!.s;
    floor0 = ground(e.ax + e.dx * s + e.nx * 1.2, e.az + e.dz * s + e.nz * 1.2) + 0.12;
  }
  floor0 = THREE.MathUtils.clamp(floor0, low, high);
  const occupied = massing.volumes.filter(v => v.role === 'main' || v.role === 'tier');
  const overhang = Math.max(0.35, arch.overhang || 0.5);
  const deckOf = (v: Volume) => v.roof === 'flat' ? hb + v.top : hb + v.top - hipRise(v.rings, v.roof, v.slope, overhang);
  const grid = fitGrid(spec, floor0, Math.max(...occupied.map(deckOf), floor0 + 2.6));
  const source: DetailSource = { id: b.id, x: b.center[0], z: b.center[1], runs: [], eaves: [] };

  for (const volume of massing.volumes) {
    // Per-volume facade composition (a wing can carry its own archetype; blocks/<id>/context.json massing).
    const vspec = volume.spec ?? spec, varch = vspec.arch, vctx = volume.spec ? { ...ctx, spec: volume.spec } : ctx;
    stats.volumes++;
    if (volume.role === 'tier') stats.tierVolumes++;
    if (volume.role === 'mech') stats.mechVolumes++;
    if (volume.role === 'estimated-mech') stats.estimatedMech++;
    const main = volume.role === 'main';
    const mech = volume.role === 'mech' || volume.role === 'estimated-mech';
    const hip = volume.roof !== 'flat';
    const rise = hip ? hipRise(volume.rings, volume.roof, volume.slope, overhang) : 0;
    const deck = hip ? Math.max(grid.floor0 + 2.6, hb + volume.top - rise) : Math.max(hb + volume.top, (main ? grid.floor0 : hb + volume.bottom) + 2.4);
    const parapet = hip ? 0 : mech ? 0.25 : varch.parapet;
    const wallTop = deck + parapet;
    const wallBottom = main ? base : hb + volume.bottom;
    const fam: WallFamily = mech ? 'metal' : vspec.wall;
    const famColor = mech ? new THREE.Color('#b7b9b8') : vspec.wallColor;
    const gLine = grid.floor0 + grid.ground;
    const edges = edgesOf(volume.rings);
    let run = 0;
    for (const e of edges) {
      const role = main && e.ring === 0 ? roles.get(`0:${e.i}`) : undefined;
      const facing = v3(e.nx, 0, e.nz);
      const P = (s: number, y: number) => v3(e.ax + e.dx * s, y, e.az + e.dz * s);
      collider.quad(P(0, wallBottom), P(e.len, wallBottom), P(e.len, wallTop), P(0, wallTop));
      const emit = (s0: number, s1: number, y0: number, y1: number, family: WallFamily, color: THREE.Color, attr?: FacadeAttr, bayW = 1, floorH = 1) => {
        const fac = (s: number, y: number): [number, number, number, number] => [s / bayW, vOf(grid, y), bayW, floorH];
        const a: FacadeAttr | undefined = attr ? { ...attr, fac: [fac(s0, y0), fac(s1, y0), fac(s1, y1), fac(s0, y1)] } : undefined;
        batch(`wall:${family}`).quad(P(s0, y0), P(s1, y0), P(s1, y1), P(s0, y1),
          [run + s0, y0], [run + s1, y0], [run + s1, y1], [run + s0, y1], color, facing, a);
      };
      // Ground storey (main volume only).
      if (main && wallBottom < gLine) {
        const yTop = Math.min(gLine, wallTop);
        const gw: WindowSpec = role?.storefront
          ? { ...vspec.groundWindow, type: 'glazed', bay: Math.max(3, vspec.groundWindow.bay), width: Math.max(3, vspec.groundWindow.bay) * 0.9, sill: 0.45, head: Math.min(grid.ground - 0.8, 3.6), mullions: 2, transom: true }
          : vspec.groundWindow;
        if (role?.storefront) stats.storefrontEdges++;
        const bays = Math.max(1, Math.round(e.len / gw.bay)), bayW = e.len / bays;
        const ok = gw.type !== 'none' && !mech && e.len >= Math.max(1.6, gw.bay * 0.6) && grid.floor0 + gw.head <= Math.min(yTop, deck) - 0.25;
        const width = Math.min(gw.width, bayW - (gw.type === 'glazed' || gw.type === 'ribbon' ? 0.2 : 0.35));
        const groundFamily = vspec.ground, groundColor = vspec.groundColor;
        const attrFor = (w: WindowSpec, wid: number, type: OpeningType): FacadeAttr => ({
          fac: [] as never, win: [wid / bayW, w.sill / grid.ground, w.head / grid.ground,
            openingCode(type, w.mullions, w.transom, w.frame, !!w.surround)], range: [0, 0],
        });
        const runFor = (s0: number, s1: number, w: WindowSpec, wid: number, type: OpeningType): OpeningRun => ({
          ax: e.ax, az: e.az, dx: e.dx, dz: e.dz, nx: e.nx, nz: e.nz, s0, s1, bayW, width: wid,
          floors: [grid.floor0], sill: w.sill, head: w.head, type, mullions: w.mullions, transom: w.transom, frame: w.frame,
          surround: !!w.surround, family: groundFamily, color: groundColor, trim: vspec.trim, trimColor: vspec.trimColor,
          depth: type === 'glazed' || type === 'door' ? 0.22 : varch.deepReveal ? 0.32 : 0.2,
        });
        if (!ok) emit(0, e.len, wallBottom, yTop, groundFamily, groundColor);
        else {
          const door = role?.door && grid.floor0 + varch.door.height <= yTop - 0.2 ? Math.min(bays - 1, Math.floor(role.door.s / bayW)) : -1;
          const segs: [number, number, boolean][] = door < 0 ? [[0, bays, false]] : [[0, door, false], [door, door + 1, true], [door + 1, bays, false]];
          for (const [i0, i1, isDoor] of segs) {
            if (i1 <= i0) continue;
            const s0 = i0 * bayW, s1 = i1 * bayW;
            if (isDoor) {
              const dw = Math.min(varch.door.width, bayW - 0.3), dh = Math.min(varch.door.height, grid.ground - 0.4);
              const dspec: WindowSpec = { ...gw, sill: 0, head: dh, mullions: dw > 1.4 ? 1 : 0, transom: dh > 2.6, type: 'punched' };
              emit(s0, s1, wallBottom, yTop, groundFamily, groundColor, attrFor(dspec, dw, 'door'), bayW, grid.ground);
              source.runs.push(runFor(s0, s1, dspec, dw, 'door'));
              stats.doors++;
            } else {
              const type = gw.type as OpeningType;
              emit(s0, s1, wallBottom, yTop, groundFamily, groundColor, attrFor(gw, width, type), bayW, grid.ground);
              if (type !== 'open') source.runs.push(runFor(s0, s1, gw, width, type));
              stats.openings += i1 - i0;
            }
          }
        }
      }
      // Upper storeys.
      const uBottom = main ? Math.max(wallBottom, gLine) : wallBottom;
      if (uBottom < wallTop - 0.01) {
        const w = vspec.window;
        const bays = Math.max(1, Math.round(e.len / w.bay)), bayW = e.len / bays;
        const width = w.type === 'ribbon' ? bayW * (w.width / w.bay) : Math.min(w.width, bayW - 0.35);
        let kMin = 1, kMax = 0;
        if (!mech && w.type !== 'none' && e.len >= Math.max(1.4, w.bay * 0.6) && width > 0.5) {
          while (floorY(grid, kMin) + w.sill < uBottom + 0.2 && kMin < 400) kMin++;
          kMax = kMin - 1;
          while (floorY(grid, kMax + 1) + w.head <= deck - 0.35 && kMax < 400) kMax++;
        }
        if (kMax >= kMin) {
          const attr: FacadeAttr = { fac: [] as never, win: [width / bayW, w.sill / grid.floor, w.head / grid.floor,
            openingCode(w.type as OpeningType, w.mullions, w.transom, w.frame, !!w.surround)], range: [kMin, kMax] };
          emit(0, e.len, uBottom, wallTop, fam, famColor, attr, bayW, grid.floor);
          const floors: number[] = [];
          // Recessed detail geometry only for the lower storeys (see MAX_DETAIL_FLOOR in materials.ts).
          for (let k = kMin; k <= Math.min(kMax, MAX_DETAIL_FLOOR); k++) floors.push(floorY(grid, k));
          if (w.type !== 'open' && floors.length) source.runs.push({ ax: e.ax, az: e.az, dx: e.dx, dz: e.dz, nx: e.nx, nz: e.nz, s0: 0, s1: e.len, bayW, width,
            floors, sill: w.sill, head: w.head, type: w.type as OpeningType, mullions: w.mullions, transom: w.transom, frame: w.frame,
            surround: !!w.surround, family: fam, color: famColor, trim: vspec.trim, trimColor: vspec.trimColor,
            depth: w.type === 'ribbon' ? 0.16 : varch.deepReveal ? 0.34 : 0.2 });
          stats.openings += bays * (kMax - kMin + 1);
          // Metal sunshades over sun-facing openings (south, east, west).
          if (varch.sunshades && (e.nz > 0.35 || Math.abs(e.nx) > 0.6) && e.len > 3) {
            for (let k = kMin; k <= kMax; k++) {
              const y = floorY(grid, k) + w.head + 0.06;
              fin(vctx, P, e.len, y, facing, v3(e.dx, 0, e.dz));
              stats.sunshades++;
            }
          }
        } else emit(0, e.len, uBottom, wallTop, fam, famColor);
      }
      run += e.len;
    }
    // Plinth (main), belt course, cornice / parapet.
    const trimFam = vspec.trim, trimColor = vspec.trimColor;
    if (main) {
      const plinthTop = grid.floor0 + Math.max(0.15, Math.min(varch.baseHeight, vspec.groundWindow.type === 'none' ? varch.baseHeight : vspec.groundWindow.sill - 0.06));
      const gaps = new Map<number, [number, number]>();
      for (const r of source.runs) if (r.type === 'door') {
        const idx = edgesOf([volume.rings[0]]).find(x => Math.abs(x.ax - r.ax) < 1e-6 && Math.abs(x.az - r.az) < 1e-6);
        if (idx) gaps.set(idx.i, [r.s0 + (r.bayW - r.width) / 2 - 0.05, r.s0 + (r.bayW + r.width) / 2 + 0.05]);
      }
      band(vctx, volume.rings, vspec.base, vspec.baseColor, 0.07, base, Math.min(plinthTop, wallTop - 0.3), gaps);
      if (varch.belt && grid.storeys >= 2 && wallTop > gLine + 1) {
        const room = grid.ground - vspec.groundWindow.head;
        if (room > 0.45 && vspec.window.sill > 0.3) band(vctx, volume.rings, trimFam, trimColor, 0.05, gLine - 0.18, gLine + 0.14);
      }
    }
    if (hip) {
      if (varch.cornice > 0) band(vctx, volume.rings, trimFam, trimColor, 0.05, deck - Math.min(0.7, varch.cornice + 0.25), deck);
      hipRoof(vctx, volume, deck, rise, source);
    } else {
      if (!mech && varch.cornice > 0 && wallTop - deck > 0.2) band(vctx, volume.rings, trimFam, trimColor, Math.min(0.1, varch.cornice * 0.2), wallTop - 0.42, wallTop - 0.02);
      flatRoof(vctx, volume.rings, deck, wallTop, mech ? 'metal' : trimFam, mech ? METAL_TRIM : trimColor);
    }
  }
  return source;
}

/** Horizontal metal sunshade: top, underside and front, with a collider. */
function fin(ctx: Context, P: (s: number, y: number) => THREE.Vector3, len: number, y: number, n: THREE.Vector3, dir: THREE.Vector3) {
  const depth = 0.55, t = 0.07, s0 = 0.15, s1 = len - 0.15;
  const out = (p: THREE.Vector3, d: number) => p.clone().addScaledVector(n, d);
  const a0 = P(s0, y), a1 = P(s1, y), b0 = out(a0, depth), b1 = out(a1, depth);
  const m = ctx.batch('wall:metal'), c = METAL_TRIM;
  const up = (p: THREE.Vector3) => p.clone().setY(p.y + t);
  m.quad(up(a0), up(a1), up(b1), up(b0), [0, 0], [len, 0], [len, depth], [0, depth], c, UP);
  m.quad(a0, b0, b1, a1, [0, 0], [0, depth], [len, depth], [len, 0], c, DOWN);
  m.quad(b0, b1, up(b1), up(b0), [0, 0], [len, 0], [len, t], [0, t], c, n);
  m.quad(a0, b0, up(b0), up(a0), [0, 0], [depth, 0], [depth, t], [0, t], c, dir.clone().negate());
  m.quad(b1, a1, up(a1), up(b1), [0, 0], [depth, 0], [depth, t], [0, t], c, dir);
  ctx.collider.quad(up(a0), up(a1), up(b1), up(b0));
  ctx.collider.quad(b0, b1, up(b1), up(b0));
}

/** Projecting horizontal band around every ring (outer face, top, bottom),
 * optionally interrupted on given outer-ring edges (door openings). */
function band(ctx: Context, rings: Point[][], family: WallFamily, color: THREE.Color, out: number, y0: number, y1: number,
  gaps?: Map<number, [number, number]>) {
  if (y1 <= y0 + 0.01) return;
  const m = ctx.batch(`wall:${family}`);
  rings.forEach((ring, r) => {
    const outer = offsetRing(ring, out);
    let run = 0;
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length, a = ring[i], c = ring[j], oa = outer[i], ob = outer[j];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 1e-3) continue;
      const normal = v3(c[1] - a[1], 0, -(c[0] - a[0])).normalize();
      const dir = v3(c[0] - a[0], 0, c[1] - a[1]).normalize();
      const gap = r === 0 ? gaps?.get(i) : undefined;
      const pieces: [number, number][] = gap ? [[0, Math.max(0, gap[0])], [Math.min(len, gap[1]), len]] : [[0, len]];
      for (const [s0, s1] of pieces) {
        if (s1 - s0 < 0.02) continue;
        const t0 = s0 / len, t1 = s1 / len;
        const ia = [a[0] + (c[0] - a[0]) * t0, a[1] + (c[1] - a[1]) * t0], ib = [a[0] + (c[0] - a[0]) * t1, a[1] + (c[1] - a[1]) * t1];
        // Gap ends cut square through the band; full edges follow the mitred outline.
        const qa = gap && s0 > 0 ? [ia[0] + normal.x * out, ia[1] + normal.z * out] : [oa[0] + (ob[0] - oa[0]) * t0, oa[1] + (ob[1] - oa[1]) * t0];
        const qb = gap && s1 < len ? [ib[0] + normal.x * out, ib[1] + normal.z * out] : [oa[0] + (ob[0] - oa[0]) * t1, oa[1] + (ob[1] - oa[1]) * t1];
        const u0 = run + s0, u1 = run + s1;
        const A0 = v3(qa[0], y0, qa[1]), B0 = v3(qb[0], y0, qb[1]), B1 = v3(qb[0], y1, qb[1]), A1 = v3(qa[0], y1, qa[1]);
        m.quad(A0, B0, B1, A1, [u0, y0], [u1, y0], [u1, y1], [u0, y1], color, normal);
        m.quad(v3(ia[0], y1, ia[1]), v3(ib[0], y1, ib[1]), B1, A1, [u0, 0], [u1, 0], [u1, out], [u0, out], color, UP);
        m.quad(v3(ia[0], y0, ia[1]), v3(ib[0], y0, ib[1]), B0, A0, [u0, 0], [u1, 0], [u1, out], [u0, out], color, DOWN);
        ctx.collider.quad(A0, B0, B1, A1);
        ctx.collider.quad(v3(ia[0], y1, ia[1]), v3(ib[0], y1, ib[1]), B1, A1);
        if (gap && s1 < len) m.quad(v3(ib[0], y0, ib[1]), B0, B1, v3(ib[0], y1, ib[1]), [0, y0], [out, y0], [out, y1], [0, y1], color, dir);
        if (gap && s0 > 0) m.quad(A0, v3(ia[0], y0, ia[1]), v3(ia[0], y1, ia[1]), A1, [0, y0], [out, y0], [out, y1], [0, y1], color, dir.clone().negate());
      }
      run += len;
    }
  });
}

function flatRoof(ctx: Context, rings: Point[][], deck: number, top: number, trimFamily: WallFamily, trimColor: THREE.Color) {
  const roof = ctx.batch('roof:membrane'), trim = ctx.batch(`wall:${trimFamily}`);
  const roofColor = ctx.spec.roof === 'flat' ? ctx.spec.roofColor : new THREE.Color('#c4c1ba');
  const parapet = top - deck > 0.05;
  const inset = parapet ? rings.map(r => offsetRing(r, -0.3)) : rings;
  const valid = inset.every((r, i) => Math.sign(signedArea(r)) === Math.sign(signedArea(rings[i])) &&
    Math.abs(signedArea(r)) > Math.abs(signedArea(rings[i])) * 0.3);
  const inner = valid ? inset : rings;
  if (parapet && valid) rings.forEach((ring, k) => {
    const ins = inner[k];
    let run = 0;
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length, a = ring[i], c = ring[j], ia = ins[i], ib = ins[j];
      const normal = v3(c[1] - a[1], 0, -(c[0] - a[0])).normalize();
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]), u0 = run, u1 = run + len; run += len;
      trim.quad(v3(a[0], top, a[1]), v3(c[0], top, c[1]), v3(ib[0], top, ib[1]), v3(ia[0], top, ia[1]),
        [u0, 0], [u1, 0], [u1, 0.3], [u0, 0.3], trimColor, UP);
      ctx.collider.quad(v3(a[0], top, a[1]), v3(c[0], top, c[1]), v3(ib[0], top, ib[1]), v3(ia[0], top, ia[1]));
      trim.quad(v3(ia[0], deck, ia[1]), v3(ib[0], deck, ib[1]), v3(ib[0], top, ib[1]), v3(ia[0], top, ia[1]),
        [u0, deck], [u1, deck], [u1, top], [u0, top], trimColor, normal.clone().negate());
    }
  });
  const y = parapet && valid ? deck : top;
  try {
    const { points, faces } = triangulate(inner);
    const t = (p: THREE.Vector2): [number, number] => [p.x, p.y];
    for (const [i, j, k] of faces) {
      const a = v3(points[i].x, y, points[i].y), b = v3(points[j].x, y, points[j].y), c = v3(points[k].x, y, points[k].y);
      roof.tri(a, b, c, t(points[i]), t(points[j]), t(points[k]), roofColor, UP);
    }
    const all = triangulate(rings);
    for (const [i, j, k] of all.faces)
      ctx.collider.tri(v3(all.points[i].x, y, all.points[i].y), v3(all.points[j].x, y, all.points[j].y), v3(all.points[k].x, y, all.points[k].y));
    ctx.stats.flatRoofs++;
  } catch { ctx.stats.failedRoofs++; }
}

/** Hipped roof over any footprint: the roof height rises with distance from the
 * eave line (straight-skeleton height function), capped as a flat crown on
 * deep plans; soffit and fascia under the overhang. */
function hipRoof(ctx: Context, volume: Volume, eaveTop: number, rise: number, source: DetailSource) {
  const { spec, collider, stats } = ctx;
  const arch = spec.arch, rings = volume.rings, slope = volume.slope;
  const overhang = Math.max(0.35, arch.overhang || 0.5);
  const eave = rings.map(r => offsetRing(r, overhang));
  const trim = ctx.batch(`wall:${spec.trim}`);
  const fascia = 0.22, roofBase = eaveTop + fascia;
  const soffit = spec.trimColor.clone().multiplyScalar(0.8);
  rings.forEach((ring, k) => {
    const out = eave[k];
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length, a = ring[i], c = ring[j], oa = out[i], ob = out[j];
      const normal = v3(c[1] - a[1], 0, -(c[0] - a[0])).normalize();
      const len = Math.hypot(ob[0] - oa[0], ob[1] - oa[1]);
      trim.quad(v3(a[0], eaveTop, a[1]), v3(c[0], eaveTop, c[1]), v3(ob[0], eaveTop, ob[1]), v3(oa[0], eaveTop, oa[1]),
        [0, 0], [len, 0], [len, overhang], [0, overhang], soffit, DOWN);
      trim.quad(v3(oa[0], eaveTop, oa[1]), v3(ob[0], eaveTop, ob[1]), v3(ob[0], roofBase, ob[1]), v3(oa[0], roofBase, oa[1]),
        [0, 0], [len, 0], [len, fascia], [0, fascia], spec.trimColor, normal);
      collider.quad(v3(oa[0], eaveTop, oa[1]), v3(ob[0], eaveTop, ob[1]), v3(ob[0], roofBase, ob[1]), v3(oa[0], roofBase, oa[1]));
    }
  });
  if (arch.brackets) source.eaves.push({ ring: eave[0], wall: rings[0], y: eaveTop, overhang, family: spec.trim, color: soffit });
  let tris: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [];
  try {
    const { points, faces } = triangulate(eave);
    for (const [i, j, k] of faces)
      tris.push([v3(points[i].x, roofBase, points[i].y), v3(points[j].x, roofBase, points[j].y), v3(points[k].x, roofBase, points[k].y)]);
  } catch { tris = []; }
  const roofKey: MaterialKey = volume.roof === 'hip-tile' ? 'roof:clayTile' : volume.roof === 'hip-shingle' ? 'roof:shingle' : 'wall:metal';
  const roof = ctx.batch(roofKey), flat = ctx.batch('roof:membrane');
  if (!tris.length) {
    stats.failedRoofs++;
    try {
      const { points, faces } = triangulate(rings);
      for (const [i, j, k] of faces) {
        const a = v3(points[i].x, roofBase, points[i].y), b = v3(points[j].x, roofBase, points[j].y), c = v3(points[k].x, roofBase, points[k].y);
        flat.tri(a, b, c, [a.x, a.z], [b.x, b.z], [c.x, c.z], spec.roofColor, UP);
        collider.tri(a, b, c);
      }
    } catch { /* Degenerate footprint: walls remain closed from the side. */ }
    return;
  }
  const fine: typeof tris = [];
  const split = (t: [THREE.Vector3, THREE.Vector3, THREE.Vector3], depth: number) => {
    const l = [t[0].distanceTo(t[1]), t[1].distanceTo(t[2]), t[2].distanceTo(t[0])];
    const m = l.indexOf(Math.max(...l));
    if (l[m] <= 3.2 || depth > 12) { fine.push(t); return; }
    const a = t[m], c = t[(m + 1) % 3], o = t[(m + 2) % 3], mid = a.clone().lerp(c, 0.5);
    split([a, mid, o], depth + 1);
    split([mid, c, o], depth + 1);
  };
  for (const t of tris) split(t, 0);
  const lift = (p: THREE.Vector3) => p.clone().setY(roofBase + Math.min(rise, slope * distanceToRings(p.x, p.z, eave)));
  const crown = roofBase + rise - 0.01;
  const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  // Tile courses: about 0.3 m per barrel, so UV metres map directly to the 2.5 m texture tile.
  for (const t of fine) {
    const [a, c, d] = t.map(lift);
    if (a.y >= crown && c.y >= crown && d.y >= crown && rise > 0.5) {
      flat.tri(a, c, d, [a.x, a.z], [c.x, c.z], [d.x, d.z], CROWN, UP);
    } else {
      n.crossVectors(e1.subVectors(c, a), e2.subVectors(d, a));
      if (n.y < 0) n.negate();
      const h = Math.hypot(n.x, n.z);
      const dx = h > 1e-6 ? n.x / h : 1, dz = h > 1e-6 ? n.z / h : 0;
      const k = Math.sqrt(1 + slope * slope);
      // u across the slope, v down the slope (tile courses follow the fall line).
      const uv = (p: THREE.Vector3): [number, number] => [p.x * -dz + p.z * dx, (p.x * dx + p.z * dz) * k];
      roof.tri(a, c, d, uv(a), uv(c), uv(d), spec.roofColor, UP);
    }
    collider.tri(a, c, d);
  }
  stats.hipRoofs++;
}

export const _internal = { fitGrid, floorY, vOf };
export type { RoofForm };
