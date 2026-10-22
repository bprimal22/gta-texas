import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SurfaceIndex, TileMask, type Box2, type IndexedTriangle } from './surface-index';
import { MIN_WIDTH, area, plane, subtractLayers, type ClipLayer, type Point2 } from './clip';
import { BakedGround } from '../baked-ground';
import type { TieInFinish, TieInTag } from './tag';
import { trimFinishesUnder } from './finish-trim';

/**
 * Ground tie-ins for authored ground slabs (paths, plazas, terraces, planting
 * strips) whose outer edges stand above what lies beside them. The authored
 * tops are never moved or covered; every tie-in starts at an outer boundary
 * edge and goes outwards:
 *
 *  - batter:  terrain beside the edge is lower. A ruled soil/lawn slope runs
 *             down at 1:2.5 (steepening to 1:1.2 only where an obstacle leaves
 *             less room) until it is 4 cm below the terrain.
 *  - infill:  a building facade is too close for a batter (<= 3 m). The top is
 *             continued level to the official footprint (no trench at the wall).
 *  - ramp:    a paved edge stands above a mapped road/path finish. The paving
 *             continues down at 1:10 and ends RAMP_LIP (8 cm) above the visible
 *             support (terrain or mapped finish, whichever is higher) on a vertical
 *             paving toe. It is never sunk into the finish: a 1:10 plane meeting a
 *             near-parallel finish at grade crosses it along a wandering, z-fighting
 *             line (the Main Mall forecourt fringe). Ramp output is also clipped
 *             exactly out of the band from 1 m below to 5 cm above any mapped finish.
 *  - wall:    another authored surface or a mapped finish lies directly below a
 *             drop that cannot be graded. The face becomes a limestone retaining
 *             wall with a flush coping (an intentional campus wall, not a
 *             textured CG skirt). Drops of one walkable riser (<= 0.32 m) onto
 *             authored ground (stairs, curbs) are left untouched.
 *
 * Triangles are both the rendered mesh and the Rapier trimesh, so what is seen
 * and what is stood on agree. Unresolved segments are reported, not hidden.
 * Stations only sample rays, so every up-facing output triangle (strips,
 * wedges, corner fans, copings) is finally clipped in plan against the authored
 * up-facing surfaces it would sit above (ground/clip.ts).
 */
export { tagGroundTieIn, type TieInFinish, type TieInTag } from './tag';

export interface GroundTieInOptions {
  /** Roots searched for tagged (or `extraSources`) ground meshes. */
  sources: T.Object3D[];
  /** Authored roots whose up-facing surfaces must not be covered (incl. the sources). */
  obstacles: T.Object3D[];
  /** Visual-only mapped finishes lying on the terrain. */
  overlays?: T.Object3D[];
  /** Baked terrain triangles (the visible ground; it has cutouts under authored floors). */
  terrainPositions: ArrayLike<number>;
  /** Contour terrain, used only where neither terrain nor an authored surface is visible. */
  terrainFallback: (x: number, z: number) => number;
  /** The terrain mesh itself is not an obstacle. */
  isTerrain?: (mesh: T.Mesh) => boolean;
  /** Official footprints, [x, z] rings. */
  buildings?: { rings: number[][][] }[];
  /** Batter finish below paved edges (the campus terrain lawn). */
  lawn: T.Material;
  /** Retaining wall and coping finish (limestone). */
  wall: T.Material;
  /** Opt-in for untagged modules owned elsewhere. */
  extraSources?: (mesh: T.Mesh) => TieInTag | null;
  /** Only edges whose midpoint lies in one of these boxes (default: all). */
  regions?: Box2[];
  physics?: RAPIER.World;
}

export type TieInKind = 'batter' | 'infill' | 'bridge' | 'ramp' | 'wall' | 'none';
export type SegmentStatus = 'graded' | 'infill' | 'bridge' | 'ramp' | 'wall' | 'flush' | 'higher-neighbour' | 'building' | 'step' | 'open';
export interface TieInSegment {
  module: string; finish: TieInFinish; status: SegmentStatus; reason: string;
  x0: number; z0: number; x1: number; z1: number; length: number; drop: number; run: number;
  /** Ramp feet [x0, z0, x1, z1] when both stations are ramps (the paving's outer edge). */
  feet?: [number, number, number, number];
}
const RANK: Record<SegmentStatus, number> = { flush: 0, 'higher-neighbour': 0, building: 0, step: 1, bridge: 2, graded: 2, infill: 2, ramp: 3, wall: 4, open: 5 };

interface Station {
  top: T.Vector3; foot: T.Vector3 | null; kind: TieInKind; status: SegmentStatus; reason: string;
  /** Visible drop next to the edge and the height a wall/cheek must reach down to. */
  drop: number; bottom: number; run: number;
  /** Ramps: outward normal, and a shorter run ending RAMP_LIP above the support there
   * (steeper, at most 1:MIN_RAMP); checks it (and applies it when `apply`), false if not possible. */
  dir?: [number, number]; shorten?: (run: number, apply: boolean) => boolean;
}

const PLANTING = /\b(grass|lawn|turf|yard|planting|soil|garden|planter|bed|mulch)\b/i;
const planting = (mesh: T.Mesh) => {
  const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return !!m && (!!m.userData?.lawn || PLANTING.test(m.name) || PLANTING.test(mesh.name));
};
const SINK = .04, PROBE = .2, STEP = .1, MAX_RUN = 9, STATION = 1, SLOPES = [2.5, 2, 1.5, 1.2], RAMP = 10, MAX_INFILL = 3;
/** Ramp end: the toe stands RAMP_LIP above the support (a walkable 8 cm edge, under the
 * scooter's 12 cm step); ramp output within OVERLAY_BAND above (or up to 1 m below) a
 * mapped finish is removed, so a ramp and a finish can never be near-coplanar. */
const RAMP_LIP = .08, OVERLAY_BAND = .05, OVERLAY_BELOW = 1;
/** Ramp ends along one straight source boundary are trued to one straight foot line by
 * shortening runs (never lengthening: a foot never sinks); the steepest allowed is 1:MIN_RAMP. */
const MIN_RAMP = 8, CHAIN_GAP = 1.25;
/** A mapped finish this far (or less) under ramp paving is superseded by it and trimmed. */
const FINISH_TRIM_BELOW = 1.5;
const COPING_IN = .28, COPING_OUT = .03, COPING_UP = .02, MIN_DROP = .05, STEP_DROP = .32;
/** Hard output (paving, limestone coping) may sit at most COVER_TOLERANCE above
 * authored hard ground (a flush coping is +2 cm). Lawn/soil output is cut from
 * PLANTING_COVER below the hard surface upwards: no grass on paving, no z-fighting.
 * A surface more than COVER_MAX below is a separate lower level, not covered ground.
 * Authored planting (lawn/soil) may be graded over, as the tie-ins' own lawn is. */
const COVER_TOLERANCE = .03, PLANTING_COVER = -.002, COVER_MAX = 3;
const SOFT_FINISH = /\b(grass|lawn|turf|soil|mulch)\b/i;

function pointInRing(x: number, z: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function ringDistance(x: number, z: number, ring: number[][]) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
    const t = l2 ? Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
  }
  return best;
}

type UvMode = { top: true } | { top: false; dx: number; dz: number };
class Batch {
  positions: number[] = []; uvs: number[] = []; indices: number[] = []; private map = new Map<string, number>();
  /** Up-facing ramp output as emitted (x,y,z triples): the paving that supersedes mapped finishes. */
  rampTris: Float64Array[] = []; private recording = false;
  /** Plan pieces of a triangle to keep, or null to keep it whole; omitted slivers are reported. */
  constructor(private readonly keep?: (tri: Float64Array, ramp: boolean) => Point2[][] | null, private readonly omitted?: (areaM2: number, widthM: number) => void) {}
  private vertex(p: T.Vector3, uv: UvMode) {
    const u = uv.top ? p.x / 2 : (p.x * uv.dx + p.z * uv.dz) / 2, v = uv.top ? p.z / 2 : p.y / 2;
    const k = `${Math.fround(p.x)},${Math.fround(p.y)},${Math.fround(p.z)},${Math.fround(u)},${Math.fround(v)}`;
    let i = this.map.get(k);
    if (i === undefined) { i = this.positions.length / 3; this.map.set(k, i); this.positions.push(p.x, p.y, p.z); this.uvs.push(u, v); }
    return i;
  }
  /** Up-facing triangle (wound counter-clockwise seen from +Y), minus any covered parts
   * (and, for ramp output, minus its near-coplanar band over mapped finishes). */
  up(p: T.Vector3, q: T.Vector3, r: T.Vector3, ramp = false) {
    const tri = Float64Array.of(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z), pieces = this.keep?.(tri, ramp);
    this.recording = ramp;
    try {
      if (!pieces) { this.upWhole(p, q, r); return; }
      const [A, B, C] = plane(tri)!, at = ([x, z]: Point2) => new T.Vector3(x, A * x + B * z + C, z);
      for (const poly of pieces) for (let i = 1; i + 1 < poly.length; i++) this.upPiece(at(poly[0]), at(poly[i]), at(poly[i + 1]));
    } finally { this.recording = false; }
  }
  /** Clipped pieces: omit sub-MIN_WIDTH needles, whose stored (float32) shape is unreliable. */
  private upPiece(p: T.Vector3, q: T.Vector3, r: T.Vector3) {
    const f = Math.fround, cross = Math.abs((f(q.x) - f(p.x)) * (f(r.z) - f(p.z)) - (f(q.z) - f(p.z)) * (f(r.x) - f(p.x)));
    const longest = Math.max(Math.hypot(q.x - p.x, q.z - p.z), Math.hypot(r.x - q.x, r.z - q.z), Math.hypot(p.x - r.x, p.z - r.z));
    if (cross >= MIN_WIDTH * longest) this.upWhole(p, q, r);
    else this.omitted?.(cross / 2, longest ? cross / longest : 0);
  }
  private upWhole(p: T.Vector3, q: T.Vector3, r: T.Vector3) {
    const cross = (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
    if (Math.abs(cross) < 1e-7) return;
    const uv: UvMode = { top: true };
    const [a, b, c] = cross < 0 ? [p, q, r] : [p, r, q];
    this.indices.push(this.vertex(a, uv), this.vertex(b, uv), this.vertex(c, uv));
    if (this.recording) this.rampTris.push(Float64Array.of(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z));
  }
  /** Side triangle facing horizontal direction (nx, nz). */
  side(p: T.Vector3, q: T.Vector3, r: T.Vector3, nx: number, nz: number) {
    const e1x = q.x - p.x, e1y = q.y - p.y, e1z = q.z - p.z, e2x = r.x - p.x, e2y = r.y - p.y, e2z = r.z - p.z;
    const cx = e1y * e2z - e1z * e2y, cz = e1x * e2y - e1y * e2x, cy = e1z * e2x - e1x * e2z;
    if (Math.hypot(cx, cy, cz) < 1e-7) return;
    const uv: UvMode = { top: false, dx: -nz, dz: nx };
    const [a, b, c] = cx * nx + cz * nz >= 0 ? [p, q, r] : [p, r, q];
    this.indices.push(this.vertex(a, uv), this.vertex(b, uv), this.vertex(c, uv));
  }
}

export function buildGroundTieIns(o: GroundTieInOptions) {
  const started = performance.now();
  const baked = new BakedGround(o.terrainPositions, 8, o.terrainFallback);
  /** Visible terrain at (x, z), or null inside a cutout. */
  const terrain = (x: number, z: number) => baked.sample(x, z);
  const terrainHeight = (x: number, z: number) => baked.height(x, z);
  // 1. Source meshes grouped per module.
  type Source = { mesh: T.Mesh; tag: TieInTag };
  const sources: Source[] = [];
  for (const root of o.sources) {
    root.updateWorldMatrix(true, true);
    root.traverse(object => {
      const mesh = object as T.Mesh;
      if (!mesh.isMesh || mesh.userData.groundTieInOutput) return;
      const tag = (mesh.userData.groundTieIn as TieInTag | undefined) ?? o.extraSources?.(mesh) ?? null;
      if (tag) sources.push({ mesh, tag });
    });
  }
  const modules = new Map<string, Source[]>();
  for (const s of sources) { const list = modules.get(s.tag.module) ?? []; list.push(s); modules.set(s.tag.module, list); }
  // 2. Up-facing top triangles per module, and the regions they need.
  type Top = { p: Float64Array; source: Source };
  const tops = new Map<string, Top[]>();
  const regions = new TileMask(8), pad = MAX_RUN + 1;
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), e1 = new T.Vector3(), e2 = new T.Vector3(), n = new T.Vector3();
  for (const [module, list] of modules) {
    const out: Top[] = [];
    for (const source of list) {
      const { mesh } = source, pos = mesh.geometry.getAttribute('position'), index = mesh.geometry.index, count = index ? index.count : pos.count;
      for (let t = 0; t + 2 < count; t += 3) {
        a.fromBufferAttribute(pos, index ? index.getX(t) : t).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(pos, index ? index.getX(t + 1) : t + 1).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(pos, index ? index.getX(t + 2) : t + 2).applyMatrix4(mesh.matrixWorld);
        n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
        const l = n.length();
        if (l < 1e-9 || n.y / l < .6) continue;
        out.push({ p: Float64Array.of(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z), source });
      }
    }
    if (!out.length) continue;
    tops.set(module, out);
  }
  // Outer boundary edges per module (edges used by one top triangle, in x/z),
  // with outward normals; the regions to index are around these edges only.
  type Edge = { a: T.Vector3; b: T.Vector3; nx: number; nz: number; source: Source };
  const moduleEdges = new Map<string, Edge[]>();
  const inRegions = (x: number, z: number, own?: Box2[]) => [o.regions, own].every(list => !list || list.some(r => x >= r[0] && x <= r[1] && z >= r[2] && z <= r[3]));
  const pointKey = (x: number, z: number) => (Math.round(x * 500) + 1e6) * 4e6 + (Math.round(z * 500) + 1e6);
  for (const [module, list] of tops) {
    const counts = new Map<number, Map<number, number>>();
    const bump = (u: number, v: number, by: number) => {
      const [lo, hi] = u < v ? [u, v] : [v, u];
      let row = counts.get(lo); if (!row) counts.set(lo, row = new Map());
      const c = (row.get(hi) ?? 0) + by; row.set(hi, c); return c;
    };
    const keys = list.map(t => [pointKey(t.p[0], t.p[2]), pointKey(t.p[3], t.p[5]), pointKey(t.p[6], t.p[8])]);
    for (const k of keys) for (let e = 0; e < 3; e++) bump(k[e], k[(e + 1) % 3], 1);
    const edges: Edge[] = [];
    list.forEach((t, ti) => {
      for (let e = 0; e < 3; e++) {
        const i = e * 3, j = ((e + 1) % 3) * 3, k = ((e + 2) % 3) * 3, p = t.p;
        if (bump(keys[ti][e], keys[ti][(e + 1) % 3], 0) !== 1) continue;
        const len = Math.hypot(p[j] - p[i], p[j + 2] - p[i + 2]);
        if (len < .02) continue;
        if (!inRegions((p[i] + p[j]) / 2, (p[i + 2] + p[j + 2]) / 2, t.source.tag.regions)) continue;
        let nx = (p[j + 2] - p[i + 2]) / len, nz = -(p[j] - p[i]) / len;
        if ((p[k] - (p[i] + p[j]) / 2) * nx + (p[k + 2] - (p[i + 2] + p[j + 2]) / 2) * nz > 0) { nx = -nx; nz = -nz; }
        edges.push({ a: new T.Vector3(p[i], p[i + 1], p[i + 2]), b: new T.Vector3(p[j], p[j + 1], p[j + 2]), nx, nz, source: t.source });
        regions.addBox(Math.min(p[i], p[j]) - pad, Math.max(p[i], p[j]) + pad, Math.min(p[i + 2], p[j + 2]) - pad, Math.max(p[i + 2], p[j + 2]) + pad);
      }
    });
    moduleEdges.set(module, edges);
  }
  // 3. Obstacles: every authored up-facing surface and mapped finish nearby.
  const indexStarted = performance.now();
  const index = new SurfaceIndex(1);
  // Only surfaces near the ground matter (tie-ins never rise above their edge;
  // edges are at most a few metres above the terrain): skip upper floors and roofs.
  const nearGround = (minY: number, x: number, z: number) => minY < o.terrainFallback(x, z) + 6;
  for (const root of o.obstacles) index.add(root, 'authored', regions, mesh => !!o.isTerrain?.(mesh) || !!mesh.userData.groundTieInOutput, nearGround);
  for (const root of o.overlays ?? []) index.add(root, 'overlay', regions);
  const buildings = (o.buildings ?? []).map(bld => {
    const ring = bld.rings[0] ?? [];
    const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
    return { rings: bld.rings, box: [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)] as Box2 };
  }).filter(bld => bld.rings[0]?.length >= 3 && regions.overlaps(...bld.box));
  // 8 m grid of footprints (with a 1 m margin) for the many point tests below.
  const buildingGrid = new Map<number, typeof buildings>();
  const gridKey = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);
  for (const bld of buildings) for (let i = Math.floor((bld.box[0] - 1) / 8); i <= Math.floor((bld.box[1] + 1) / 8); i++)
    for (let j = Math.floor((bld.box[2] - 1) / 8); j <= Math.floor((bld.box[3] + 1) / 8); j++) {
      const k = gridKey(i, j); let list = buildingGrid.get(k); if (!list) buildingGrid.set(k, list = []); list.push(bld);
    }
  const inBuilding = (x: number, z: number, margin = 0) => {
    const list = buildingGrid.get(gridKey(Math.floor(x / 8), Math.floor(z / 8)));
    if (list) for (const bld of list) {
      if (x < bld.box[0] - margin || x > bld.box[1] + margin || z < bld.box[2] - margin || z > bld.box[3] + margin) continue;
      if (pointInRing(x, z, bld.rings[0])) { let hole = false; for (let r = 1; r < bld.rings.length; r++) if (pointInRing(x, z, bld.rings[r])) hole = true; if (!hole) return true; }
      if (margin > 0) for (const r of bld.rings) if (ringDistance(x, z, r) < margin) return true;
    }
    return false;
  };
  /** One pass over the surfaces at (x, z): any surface in (y + 3 cm, y + 1 m], and the
   * highest visible surface at or below y + 3 cm (null when only the terrain is there). */
  const look = (x: number, z: number, y: number) => {
    let higher = false, hit: IndexedTriangle | null = null, hy = -Infinity;
    index.at(x, z, (sy, tri) => {
      if (sy > y + .03) { if (sy <= y + 1) higher = true; }
      else if (sy > hy) { hy = sy; hit = tri; }
    });
    // Inside a terrain cutout the authored surface below is what is seen.
    const cut = terrain(x, z), tg = cut ?? (hit !== null ? hy : o.terrainFallback(x, z));
    const visible = hit !== null && hy >= tg - .05;
    return { higher, tg, y: visible ? Math.max(hy, tg) : tg, tri: visible ? hit as IndexedTriangle | null : null };
  };

  const indexMs = performance.now() - indexStarted;
  // 4. Per-station profile.
  const profile = (x: number, y: number, z: number, nx: number, nz: number, finish: TieInFinish): Station => {
    const at = (status: SegmentStatus, kind: TieInKind, drop: number, reason: string, extra: Partial<Station> = {}): Station =>
      ({ top: new T.Vector3(x, y, z), foot: null, kind, status, reason, drop, bottom: y - drop - .15, run: 0, ...extra });
    const qx = x + nx * PROBE, qz = z + nz * PROBE;
    if (inBuilding(qx, qz)) return at('building', 'none', 0, 'edge against a building footprint');
    // A slit narrower than the probe between this edge and a flush authored
    // surface or mapped finish shows the ground far below: bridge it level.
    for (const d0 of [.03, .08, .13]) {
      const edge = look(x + nx * d0, z + nz * d0, y);
      if (edge.higher || (edge.tri && y - edge.y <= MIN_DROP)) break;
      if (y - edge.y <= MIN_DROP) continue;
      for (let d = d0 + .025; d <= PROBE + .1; d += .025) {
        const l = look(x + nx * d, z + nz * d, y);
        if (l.higher || (l.tri && y - l.y <= .15)) {
          const run = d + .04;
          return at('bridge', 'bridge', y - edge.y, 'slit to a flush neighbour bridged', { top: new T.Vector3(x, y - .003, z), foot: new T.Vector3(x + nx * run, y - .003, z + nz * run), run });
        }
      }
      break;
    }
    const near = look(qx, qz, y);
    if (near.higher) return at('higher-neighbour', 'none', 0, 'higher authored surface beside the edge');
    const tg = near.tg;
    // Lazily sampled march along the normal: terrain, lowest visible authored
    // surface / mapped finish (could be covered), building footprints.
    const marchT: number[] = [], marchTg: number[] = [], marchAny: number[] = [], marchAuthored: number[] = [], marchOverlay: number[] = [], marchBuilding: boolean[] = [];
    const sample = (i: number) => {
      while (marchT.length <= i) {
        const t = STEP * (marchT.length + 1), rx = x + nx * t, rz = z + nz * t, cut = terrain(rx, rz);
        // Surfaces below the terrain are hidden; in a cutout every surface is visible.
        const low = cut === null ? -Infinity : cut - .05, tgr = cut ?? terrainHeight(rx, rz);
        let any = Infinity, authored = Infinity, overlay = -Infinity;
        index.at(rx, rz, (sy, tri) => {
          if (sy < low) return;
          if (sy < any) any = sy;
          if (tri.kind === 'authored') { if (sy < authored) authored = sy; }
          // The visible mapped finish lying on the terrain here (the ramp's support).
          else if (sy <= tgr + .3 && sy > overlay) overlay = sy;
        });
        marchT.push(t); marchTg.push(tgr); marchAny.push(any); marchAuthored.push(authored); marchOverlay.push(overlay); marchBuilding.push(inBuilding(rx, rz, .3));
      }
    };
    const steps = Math.round(MAX_RUN / STEP);
    const wall = (drop: number, reason: string) => at('wall', 'wall', drop, reason);
    // Level continuation to a facade (infill) or a graded batter down to the terrain.
    const grade = (drop: number): Station => {
      const lower = finish === 'paved' ? .03 : .005, topY = y - lower;
      let buildingAt = Infinity;
      for (const slope of SLOPES) {
        let prev = topY - tg + SINK;
        for (let i = 0; i < steps; i++) {
          sample(i);
          const t = marchT[i], by = topY - t / slope, diff = by - (marchTg[i] - SINK);
          if (diff <= 0) {
            const run = t - STEP + STEP * prev / Math.max(1e-6, prev - diff);
            return at('graded', 'batter', drop, `1:${slope} batter`, { top: new T.Vector3(x, topY, z), foot: new T.Vector3(x + nx * run, topY - run / slope, z + nz * run), run });
          }
          if (marchBuilding[i]) { buildingAt = Math.min(buildingAt, t); break; }
          if (marchAny[i] <= by + .05) break;
          prev = diff;
        }
      }
      if (buildingAt <= MAX_INFILL + .3) {
        // Distance to the footprint itself along the normal; nothing may be covered on the way.
        for (let t = STEP / 2; t <= MAX_INFILL + .5; t += STEP / 2) {
          const rx = x + nx * t, rz = z + nz * t;
          if (inBuilding(rx, rz)) {
            const run = Math.max(0, t - STEP / 2 - .05);
            if (run < .05) break;
            return at('infill', 'infill', drop, 'level infill to the facade', { foot: new T.Vector3(x + nx * run, y, z + nz * run), run,
              bottom: Math.min(y, terrainHeight(x + nx * run, z + nz * run)) - .15 });
          }
          const i = Math.max(0, Math.round(t / STEP) - 1);
          sample(i);
          if (marchAny[i] <= y + .05) break;
        }
      }
      return wall(drop, 'no room for a batter before an obstacle');
    };
    if (near.tri) {
      const drop = y - near.y, name = near.tri.mesh.name;
      if (drop <= .15) return at('flush', 'none', drop, 'flush with the neighbouring surface');
      if (near.tri.kind === 'authored') {
        // One riser onto paving/stairs stays a step; above a planting bed or lawn it is a stone curb.
        if (drop <= STEP_DROP && !planting(near.tri.mesh)) return at('step', 'none', drop, 'walkable step onto authored ground');
        return wall(drop, `retaining wall above ${name}`);
      }
      if (finish !== 'paved') return wall(drop, `planter wall above ${name}`);
      // Paved edge above a mapped finish: continue the paving down at 1:10 until it is
      // RAMP_LIP above the visible support (terrain or finish), and stop there on a toe.
      let prev = drop - RAMP_LIP, prevSupport = near.y;
      const supportAt = (k: number) => k < 0 ? near.y : Math.max(marchTg[k], marchOverlay[k]);
      for (let i = 0; i < steps; i++) {
        sample(i);
        const t = marchT[i], by = y - t / RAMP, support = supportAt(i), diff = by - (support + RAMP_LIP);
        if (diff <= 0) {
          const f = prev / Math.max(1e-6, prev - diff), run = t - STEP + STEP * f, footY = y - run / RAMP;
          const s = at('ramp', 'ramp', drop, `1:${RAMP} paved ramp onto ${name}`, { foot: new T.Vector3(x + nx * run, footY, z + nz * run), run,
            bottom: Math.min(footY - RAMP_LIP, prevSupport + (support - prevSupport) * f) - .1, dir: [nx, nz] });
          s.shorten = (target, apply) => {
            if (target >= s.run - 1e-3) return true;
            if (!(target > .3)) return false;
            // Support at the new foot (between march samples), the new slope, and clearance on the way.
            const kf = target / STEP - 1, k0 = Math.floor(kf), k1 = Math.min(k0 + 1, i);
            const sup = k0 >= i ? supportAt(i) : supportAt(k0) + (supportAt(k1) - supportAt(k0)) * (kf - k0);
            const fy = sup + RAMP_LIP, slope = (y - fy) / target;
            if (!(slope > 0) || slope > 1 / MIN_RAMP) return false;
            for (let k = 0; k <= i && marchT[k] < target; k++) if (y - marchT[k] * slope < supportAt(k) + RAMP_LIP - .005) return false;
            if (apply) { s.foot = new T.Vector3(x + nx * target, fy, z + nz * target); s.run = target; s.bottom = Math.min(fy - RAMP_LIP, sup) - .1; }
            return true;
          };
          return s;
        }
        if (marchBuilding[i] || marchAuthored[i] <= by + .05) break;
        prev = diff; prevSupport = support;
      }
      return wall(drop, `no room for a ramp onto ${name}`);
    }
    const drop = y - tg;
    if (drop <= MIN_DROP) return at('flush', 'none', drop, 'flush with the terrain');
    return grade(drop);
  };

  // 5. Boundary edges -> strips, cheeks, walls and convex-corner fans.
  const clipped = { triangles: 0, removedM2: 0, plantingTriangles: 0, plantingRemovedM2: 0, omittedSliverM2: 0, maxOmittedWidthM: 0, nearFinishTriangles: 0, nearFinishRemovedM2: 0 };
  // Hard ground to keep uncovered: tagged by finish, otherwise by the surface material
  // itself (area names such as "yard" or "planter curbs" describe walks and stones too).
  const hardGround = new Map<T.Mesh, boolean>();
  const softMaterial = (m: T.Material | undefined) => !!m && (!!m.userData?.lawn || SOFT_FINISH.test(m.name));
  const hard = (mesh: T.Mesh) => {
    let h = hardGround.get(mesh);
    if (h === undefined) {
      const finish = ((mesh.userData.groundTieIn as TieInTag | undefined) ?? o.extraSources?.(mesh))?.finish;
      hardGround.set(mesh, h = finish ? finish === 'paved' : !softMaterial([mesh.material].flat()[0]));
    }
    return h;
  };
  const keep = (tri: Float64Array, plantingOutput: boolean, ramp: boolean) => {
    const surfaces: Float64Array[] = [], finishes: Float64Array[] = [];
    for (const s of index.inBox(Math.min(tri[0], tri[3], tri[6]), Math.max(tri[0], tri[3], tri[6]), Math.min(tri[2], tri[5], tri[8]), Math.max(tri[2], tri[5], tri[8])))
      if (s.kind === 'authored' ? hard(s.mesh) : ramp) (s.kind === 'authored' ? surfaces : finishes).push(s.p);
    const layers: ClipLayer[] = [];
    if (surfaces.length) layers.push({ surfaces, tolerance: plantingOutput ? PLANTING_COVER : COVER_TOLERANCE, maxRaise: COVER_MAX });
    // Ramp output: never within the near-coplanar band of a mapped finish (by construction
    // it ends RAMP_LIP above it; this exact clip is the guarantee between stations).
    if (finishes.length) layers.push({ surfaces: finishes, tolerance: -OVERLAY_BELOW, maxRaise: OVERLAY_BAND });
    const result = layers.length ? subtractLayers(tri, layers) : null;
    if (!result) return null;
    // Area per layer: rerun the overlay layer alone only when both layers touched (rare).
    const overlayM2 = finishes.length ? (surfaces.length ? subtractLayers(tri, layers.slice(1))?.coveredM2 ?? 0 : result.coveredM2) : 0;
    if (overlayM2 > 0) { clipped.nearFinishTriangles++; clipped.nearFinishRemovedM2 += overlayM2; }
    if (result.coveredM2 - overlayM2 > 0 || !finishes.length) { clipped.triangles++; clipped.removedM2 += result.coveredM2 - overlayM2; }
    if (plantingOutput) { clipped.plantingTriangles++; clipped.plantingRemovedM2 += result.coveredM2; }
    // Whatever is neither covered nor kept was dropped as sub-MIN_WIDTH slivers.
    clipped.omittedSliverM2 += Math.max(0, area([[tri[0], tri[2]], [tri[3], tri[5]], [tri[6], tri[8]]]) - result.coveredM2 - result.pieces.reduce((sum, poly) => sum + area(poly), 0));
    return result.pieces;
  };
  const omitted = (areaM2: number, widthM: number) => { clipped.omittedSliverM2 += areaM2; clipped.maxOmittedWidthM = Math.max(clipped.maxOmittedWidthM, widthM); };
  // Lawn/soil output: the batter lawn and the materials of lawn/soil-finish sources.
  const plantingMaterials = new Set<T.Material>([o.lawn]);
  for (const s of sources) if (s.tag.finish !== 'paved') for (const m of [s.mesh.material].flat()) plantingMaterials.add(m);
  const plantingOutput = (m: T.Material) => plantingMaterials.has(m) || softMaterial(m);
  const batches = new Map<T.Material, Batch>();
  const batch = (m: T.Material) => {
    let b = batches.get(m);
    if (!b) { const lawn = plantingOutput(m); batches.set(m, b = new Batch((tri, ramp) => keep(tri, lawn, ramp), omitted)); }
    return b;
  };
  const segments: TieInSegment[] = [];
  const key = (x: number, z: number) => `${Math.round(x * 500)},${Math.round(z * 500)}`;
  const down = (p: T.Vector3, y: number) => new T.Vector3(p.x, y, p.z);
  /** Bottom of the closure under a foot: below the ramp's support, or 10 cm under a buried batter foot. */
  const footBottom = (s: Station) => s.kind === 'ramp' ? s.bottom : s.foot!.y - .1;
  /** Vertical paving toe under a ramp's outer edge f0-f1, facing away from (ox, oz)'s side. */
  const toe = (m: Batch, f0: T.Vector3, f1: T.Vector3, b0: number, b1: number, ox: number, oz: number) => {
    let tx = f1.z - f0.z, tz = f0.x - f1.x;
    if (tx * ox + tz * oz < 0) { tx = -tx; tz = -tz; }
    m.side(f0, f1, down(f1, b1), tx, tz); m.side(f0, down(f1, b1), down(f0, b0), tx, tz);
  };
  /** Ramp stations along one straight source boundary (same outward normal and offset,
   * consecutive within CHAIN_GAP) get feet on one straight line: the line maximising the
   * total run with every run only shortened (at most to 1:MIN_RAMP). A chain whose line
   * any station cannot take keeps its own 1:10 feet. */
  const trued = { chains: 0, stations: 0, keptChains: 0, maxShortenM: 0 };
  const trueRampEnds = (all: Station[]) => {
    const ramps = [...new Set(all)].filter(s => s.kind === 'ramp' && s.dir && s.shorten);
    ramps.sort((p, q) => Math.atan2(p.dir![1], p.dir![0]) - Math.atan2(q.dir![1], q.dir![0]));
    const groups: Station[][] = [];
    for (const s of ramps) {
      const g = groups.find(list => { const d = list[0].dir!; return d[0] * s.dir![0] + d[1] * s.dir![1] > .99999 &&
        Math.abs((s.top.x - list[0].top.x) * d[0] + (s.top.z - list[0].top.z) * d[1]) < .05; });
      if (g) g.push(s); else groups.push([s]);
    }
    for (const group of groups) {
      const [nx, nz] = group[0].dir!, along = (s: Station) => -s.top.x * nz + s.top.z * nx;
      group.sort((p, q) => along(p) - along(q));
      const chains: Station[][] = [[]];
      for (const s of group) { const c = chains[chains.length - 1]; if (c.length && along(s) - along(c[c.length - 1]) > CHAIN_GAP) chains.push([s]); else c.push(s); }
      for (const chain of chains) {
        if (chain.length < 3) continue;
        const s0 = chain.reduce((a, s) => a + along(s), 0) / chain.length, u = chain.map(s => along(s) - s0), run = chain.map(s => s.run);
        if (Math.max(...run) - Math.min(...run) < .02) continue;
        // Two-variable LP (maximise mean run a, line r = a + b u): optimum at two tight constraints.
        const bounds = run.flatMap((r, i) => [[u[i], r], [u[i], r * MIN_RAMP / RAMP]]);
        let best: [number, number] | null = null;
        const feasible = (a: number, b: number) => chain.every((_, i) => { const r = a + b * u[i]; return r <= run[i] + 1e-9 && r >= run[i] * MIN_RAMP / RAMP - 1e-9; });
        for (let i = 0; i < bounds.length; i++) for (let j = i + 1; j < bounds.length; j++) {
          const [ui, ri] = bounds[i], [uj, rj] = bounds[j];
          if (Math.abs(uj - ui) < 1e-6) continue;
          const b = (rj - ri) / (uj - ui), a = ri - b * ui;
          if ((!best || a > best[0]) && feasible(a, b)) best = [a, b];
        }
        trued.chains++;
        if (!best || !chain.every((s, i) => s.shorten!(best![0] + best![1] * u[i], false))) { trued.keptChains++; continue; }
        chain.forEach((s, i) => { const r = best![0] + best![1] * u[i]; trued.maxShortenM = Math.max(trued.maxShortenM, s.run - r); s.shorten!(r, true); });
        trued.stations += chain.length;
      }
    }
  };
  for (const [module, list] of tops) {
    const moduleMeshes = new Set(list.map(t => t.source.mesh));
    const edges = moduleEdges.get(module)!;
    const cache = new Map<string, Station>();
    const station = (x: number, y: number, z: number, nx: number, nz: number, finish: TieInFinish) => {
      const k = `${key(x, z)}|${Math.round(y * 1000)}|${Math.round(nx * 1e4)},${Math.round(nz * 1e4)}`;
      let s = cache.get(k);
      if (!s) cache.set(k, s = profile(x, y, z, nx, nz, finish));
      return s;
    };
    const sourceMaterial = (source: Source) => Array.isArray(source.mesh.material) ? source.mesh.material[0] : source.mesh.material;
    const surfaceMaterial = (source: Source, s: Station) => s.kind === 'batter' && source.tag.finish === 'paved' ? o.lawn : sourceMaterial(source);
    const corners = new Map<string, { v: T.Vector3; edges: Edge[] }>();
    const edgeStations = edges.map(edge => {
      const { nx, nz } = edge, finish = edge.source.tag.finish;
      const len = Math.hypot(edge.b.x - edge.a.x, edge.b.z - edge.a.z), count = Math.max(1, Math.ceil(len / STATION));
      const stations: Station[] = [];
      for (let s = 0; s <= count; s++) {
        const f = s / count;
        stations.push(station(edge.a.x + (edge.b.x - edge.a.x) * f, edge.a.y + (edge.b.y - edge.a.y) * f, edge.a.z + (edge.b.z - edge.a.z) * f, nx, nz, finish));
      }
      return stations;
    });
    trueRampEnds(edgeStations.flat());
    edges.forEach((edge, e) => {
      const { nx, nz } = edge, finish = edge.source.tag.finish, stations = edgeStations[e];
      const len = Math.hypot(edge.b.x - edge.a.x, edge.b.z - edge.a.z), count = stations.length - 1;
      for (let s = 0; s < count; s++) {
        const p0 = stations[s], p1 = stations[s + 1];
        // Graded surfaces between the stations (and a vertical cheek where one side stops).
        const f0 = p0.foot, f1 = p1.foot;
        if (f0 && f1) {
          const m = batch(surfaceMaterial(edge.source, RANK[p0.status] >= RANK[p1.status] ? p0 : p1)), ramp = p0.kind === 'ramp' || p1.kind === 'ramp';
          if (ramp && (p0.kind === 'batter' || p1.kind === 'batter')) {
            // A ramp's end beside a batter: the paving ends on the diagonal from the batter's
            // top to the ramp foot (a flared side), and the batter's lawn fills the rest, rather
            // than one twisted paving strip from a 7 m ramp foot to a 1.5 m batter foot.
            const [rs, bs] = p0.kind === 'ramp' ? [p0, p1] : [p1, p0];
            m.up(p0.top, p1.top, rs.foot!, true);
            batch(surfaceMaterial(edge.source, bs)).up(bs.top, rs.foot!, bs.foot!, true);
          } else { m.up(p0.top, p1.top, f1, ramp); m.up(p0.top, f1, f0, ramp); }
          if (ramp) toe(m, f0, f1, footBottom(p0), footBottom(p1), nx, nz);
          if (p0.kind === 'infill') m.side(f0, f1, down(f1, p1.bottom), nx, nz);
          if (p0.kind === 'infill') m.side(f0, down(f1, p1.bottom), down(f0, p0.bottom), nx, nz);
        } else if (f0 || f1) {
          const [graded, other] = f0 ? [p0, p1] : [p1, p0];
          const m = batch(surfaceMaterial(edge.source, graded));
          m.up(p0.top, p1.top, graded.foot!, graded.kind === 'ramp');
          // Close the wedge under the free edge from the other station's top to the
          // foot. A visible cheek (> 0.15 m) is a limestone wing wall with a sloped
          // coping (the batter's end beside a path, wall or step); a low one is soil.
          // A ramp foot stands RAMP_LIP proud, so its free side is always closed.
          if (other.drop > MIN_DROP || graded.kind === 'ramp') {
            const ex = graded.top.x - other.top.x, ez = graded.top.z - other.top.z, el = Math.hypot(ex, ez) || 1, ux = ex / el, uz = ez / el;
            const bottom = Math.min(other.bottom, footBottom(graded)), foot = graded.foot!;
            if (other.drop > .15 || other.kind === 'wall') {
              const w = batch(o.wall), shift = (p: T.Vector3, d: number, dy: number) => new T.Vector3(p.x + ux * d, p.y + dy, p.z + uz * d);
              const a0 = shift(other.top, -COPING_OUT, COPING_UP), a1 = shift(foot, -COPING_OUT, COPING_UP);
              const b0 = shift(other.top, COPING_IN, COPING_UP), b1 = shift(foot, COPING_IN, COPING_UP);
              w.up(a0, a1, b1); w.up(a0, b1, b0);
              w.side(a0, a1, down(a1, bottom), -ux, -uz); w.side(a0, down(a1, bottom), down(a0, bottom), -ux, -uz);
            } else {
              const c = batch(surfaceMaterial(edge.source, graded));
              c.side(other.top, foot, down(other.top, bottom), -ux, -uz);
              // A proud ramp foot: close the cheek down under the foot as well.
              if (graded.kind === 'ramp') c.side(foot, down(foot, bottom), down(other.top, bottom), -ux, -uz);
            }
          }
        }
        // Limestone retaining wall with a flush coping.
        const w0 = p0.kind === 'wall', w1 = p1.kind === 'wall';
        if ((w0 && w1) || (w0 && !f1) || (w1 && !f0)) {
          const m = batch(o.wall), bottom = Math.min(w0 ? p0.bottom : Infinity, w1 ? p1.bottom : Infinity);
          const lift = (p: T.Vector3, d: number, dy: number) => new T.Vector3(p.x + nx * d, p.y + dy, p.z + nz * d);
          const o0 = lift(p0.top, COPING_OUT, COPING_UP), o1 = lift(p1.top, COPING_OUT, COPING_UP);
          const i0 = lift(p0.top, -COPING_IN, COPING_UP), i1 = lift(p1.top, -COPING_IN, COPING_UP);
          m.up(i0, i1, o1); m.up(i0, o1, o0);
          m.side(o0, o1, down(o1, bottom), nx, nz); m.side(o0, down(o1, bottom), down(o0, bottom), nx, nz);
          const j0 = lift(p0.top, -COPING_IN, -.01), j1 = lift(p1.top, -COPING_IN, -.01);
          m.side(i0, i1, j1, -nx, -nz); m.side(i0, j1, j0, -nx, -nz);
        }
        const worst = RANK[p0.status] >= RANK[p1.status] ? p0 : p1;
        segments.push({ module, finish, status: worst.status, reason: worst.reason, x0: +p0.top.x.toFixed(2), z0: +p0.top.z.toFixed(2), x1: +p1.top.x.toFixed(2), z1: +p1.top.z.toFixed(2),
          length: len / count, drop: +Math.max(p0.drop, p1.drop).toFixed(3), run: +Math.max(p0.run, p1.run).toFixed(2),
          ...(p0.kind === 'ramp' && p1.kind === 'ramp' && p0.foot && p1.foot ? { feet: [+p0.foot.x.toFixed(3), +p0.foot.z.toFixed(3), +p1.foot.x.toFixed(3), +p1.foot.z.toFixed(3)] as [number, number, number, number] } : {}) });
      }
      for (const v of [edge.a, edge.b]) {
        const k = key(v.x, v.z), corner = corners.get(k) ?? { v, edges: [] };
        corner.edges.push(edge); corners.set(k, corner);
      }
    });
    // Convex corners leave a wedge between two graded strips: fill it with a fan.
    const insideModule = (x: number, z: number) => { let hit = false; index.at(x, z, (_y, tri) => { if (moduleMeshes.has(tri.mesh)) hit = true; }); return hit; };
    for (const { v, edges: pair } of corners.values()) {
      if (pair.length !== 2) continue;
      const [e0, e1] = pair;
      if (e0.nx * e1.nx + e0.nz * e1.nz > .9995) continue;
      const mx = e0.nx + e1.nx, mz = e0.nz + e1.nz, ml = Math.hypot(mx, mz);
      if (ml < 1e-3 || insideModule(v.x + mx / ml * .05, v.z + mz / ml * .05)) continue;
      const t0 = Math.atan2(e0.nz, e0.nx);
      let delta = Math.atan2(e1.nz, e1.nx) - t0;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta <= -Math.PI) delta += 2 * Math.PI;
      const steps = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 12)));
      const fan: Station[] = [];
      for (let s = 0; s <= steps; s++) {
        const angle = t0 + delta * s / steps;
        const nx = s === 0 ? e0.nx : s === steps ? e1.nx : Math.cos(angle), nz = s === 0 ? e0.nz : s === steps ? e1.nz : Math.sin(angle);
        fan.push(station(v.x, v.y, v.z, nx, nz, e0.source.tag.finish));
      }
      for (let s = 0; s < steps; s++) {
        const f0 = fan[s], f1 = fan[s + 1];
        if (!f0.foot || !f1.foot || f0.kind !== f1.kind) continue;
        const m = batch(surfaceMaterial(e0.source, f0));
        m.up(f0.top, f0.foot, f1.foot, f0.kind === 'ramp');
        if (f0.kind === 'ramp') toe(m, f0.foot, f1.foot, f0.bottom, f1.bottom, (f0.foot.x + f1.foot.x) / 2 - v.x, (f0.foot.z + f1.foot.z) / 2 - v.z);
        if (f0.kind === 'infill') { const dx = (f0.foot.x + f1.foot.x) / 2 - v.x, dz = (f0.foot.z + f1.foot.z) / 2 - v.z, dl = Math.hypot(dx, dz) || 1;
          m.side(f0.foot, f1.foot, down(f1.foot, f1.bottom), dx / dl, dz / dl); m.side(f0.foot, down(f1.foot, f1.bottom), down(f0.foot, f0.bottom), dx / dl, dz / dl); }
      }
    }
  }

  // 6. Mapped finishes superseded by ramp paving are trimmed out from under it (visual-only
  // overlays; the ramp is the visible and physical ground there, and a finish left a few cm
  // under it would still win the depth test at aerial range through its polygon offset).
  const rampTriangles = [...batches.values()].flatMap(b => b.rampTris);
  const finishTrim = trimFinishesUnder(o.overlays ?? [], rampTriangles, FINISH_TRIM_BELOW, OVERLAY_BAND);
  // 7. One indexed mesh + trimesh per finish material.
  const meshes: T.Mesh[] = [], colliderGeometries: T.BufferGeometry[] = [], colliders: RAPIER.Collider[] = [];
  let triangles = 0;
  for (const [material, b] of batches) {
    if (!b.indices.length) continue;
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(b.positions, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(b.uvs, 2));
    geometry.setIndex(b.indices);
    geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new T.Mesh(geometry, material);
    const label = material === o.wall ? 'retaining wall' : 'graded ground';
    mesh.name = `Ground tie-in ${label} (${material.name || 'lawn'})`;
    mesh.receiveShadow = true; mesh.castShadow = material === o.wall;
    mesh.userData.groundTieInOutput = true;
    meshes.push(mesh); colliderGeometries.push(geometry);
    triangles += b.indices.length / 3;
    if (o.physics) colliders.push(o.physics.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(b.positions), new Uint32Array(b.indices),
      RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(.8)));
  }
  const metres: Partial<Record<SegmentStatus, number>> = {};
  const worst: Partial<Record<SegmentStatus, number>> = {};
  for (const s of segments) {
    metres[s.status] = (metres[s.status] ?? 0) + s.length;
    worst[s.status] = Math.max(worst[s.status] ?? 0, s.drop);
  }
  return {
    meshes, colliders, colliderGeometries, segments,
    /** Up-facing ramp output triangles (x,y,z triples, world), for checks. */
    rampTriangles,
    stats: { modules: tops.size, sourceMeshes: sources.length, obstacleTriangles: index.triangles, triangles, drawCalls: meshes.length,
      metres: Object.fromEntries(Object.entries(metres).map(([k, v]) => [k, +v!.toFixed(1)])),
      worstDrop: Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, +v!.toFixed(2)])),
      clippedOverAuthored: { triangles: clipped.triangles, removedM2: +clipped.removedM2.toFixed(3), plantingTriangles: clipped.plantingTriangles,
        plantingRemovedM2: +clipped.plantingRemovedM2.toFixed(3), nearFinishTriangles: clipped.nearFinishTriangles, nearFinishRemovedM2: +clipped.nearFinishRemovedM2.toFixed(3), omittedSliverM2: +clipped.omittedSliverM2.toExponential(2), sliverWidthToleranceM: MIN_WIDTH,
        maxOmittedFanWidthM: +clipped.maxOmittedWidthM.toExponential(2) }, finishTrim: finishTrim.stats,
      rampEnds: { ...trued, maxShortenM: +trued.maxShortenM.toFixed(2) }, indexMs: Math.round(indexMs), buildMs: Math.round(performance.now() - started) },
    dispose() { for (const m of meshes) m.geometry.dispose(); finishTrim.dispose(); if (o.physics) for (const c of colliders) o.physics.removeCollider(c, false); },
  };
}
