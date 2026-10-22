// Block b03: Speedway mall north of the authored corridor end, 24th Street to the East Dean Keeton curb.
//
// Evidence (research/whole-campus-92/b03-gdc-speedway/EVIDENCE.md, round 2):
//  - the pedestrian Speedway Mall ran from Jester Circle to Dean Keeton and the brick north of 24th was laid by
//    Oct 2017 (Daily Texan 2015-09-25, 2017-10-18);
//  - width: PWP, the designer, "narrowed to a pedestrian-friendly 30 feet wide" (9.144 m), the same figure the
//    accepted corridor south of z -243.8 uses (walkway.ts);
//  - alignment: OSM 571500826 + 1036229280 (campus 22.7,-243.8 -> 29.7,-325.1 -> 33.0,-373.0);
//  - east edge (centreline + 4.572 m east): b01's published engineering-side profile engineeringSpeedwayEdge(z)
//    (shared request b01-r1, measured in the built scene); the brick must meet it within +-0.03 m;
//  - elsewhere the brick follows the baked 2017 LiDAR terrain it replaces (never below it, so no lawn shows
//    through), and at z -243.8 it starts exactly on the end edge and height of the accepted corridor.
// Same triangles for render and collision (trimesh); materials are borrowed from the walkway (not disposed here).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { BlockInstallContext } from '../types';
import { engineeringSpeedwayEdge } from '../../engineering-courtyard';
import { tagGroundTieIn } from '../../ground/tag';

type P2 = [number, number];
export const SPEEDWAY_NORTH_WAYS = [571500826, 1036229280];
/** PWP: 30 ft. */
export const HALF_WIDTH = 9.144 / 2;
/** West edge band (the accepted corridor's 0.45 m concrete edge). The east side abuts b01's ground directly. */
const BAND = 0.45;
/** Lateral nodes across the brick (0.5715 m apart, plus one 0.25 m inside the east edge so the brick can rise
 * off b01's edge profile onto terrain that stands above it) and the drain half width (walkway.ts: 0.19 m). */
const NODES = 16, DRAIN = 0.19, EDGE_RAMP = 0.25;
export const OFFSETS = [...Array.from({ length: NODES }, (_, j) => -HALF_WIDTH + 2 * HALF_WIDTH * j / NODES), HALF_WIDTH - EDGE_RAMP, HALF_WIDTH];
const LAST = OFFSETS.length - 1;
/** Brick clearance above the terrain it covers, and the allowed rise above b01's edge profile. */
const COVER = 0.03, EDGE_LIFT = 0.012;
/** Longest longitudinal grade the brick takes while climbing away from the accepted corridor end (about 14 deg). */
const MAX_GRADE = 0.25;
/** Finish of this stretch. The accepted atlas overview screenshot-dataset/captures/b03-r1-a2 (Codex-accepted,
 * imagery date unknown but after the golden brick south of z -243.8 was laid) shows an asphalt service drive with
 * angled parking and a turnaround from the EER south walk to Dean Keeton, and OSM tags 571500826/1036229280
 * `service`, while every 2015-2017 source describes the planned brick mall to Dean Keeton. The observed finish
 * wins; 'brick' (the accepted golden brick and its central drain) is one switch away if newer evidence shows it. */
export const FINISH: 'asphalt' | 'brick' = 'asphalt';
/** East Dean Keeton: OSM 1096751888/124953109 centreline z -373.0 at Speedway, 13 m wide -> south curb z -366.5. */
export const DEAN_KEETON_CURB_Z = -366.5;

export interface SpeedwayNorthStation { s: number; c: P2; n: P2; scale: number; ys: number[]; band: [number, number] }

/** Centreline of the northern stretch (OSM ways, deduplicated, ordered south -> north). */
export function speedwayNorthCentre(data: BlockInstallContext['data']): P2[] {
  const pts: P2[] = [];
  for (const id of SPEEDWAY_NORTH_WAYS) {
    const way = data.paths.find(p => p.id === id);
    if (!way) throw new Error(`Speedway north way ${id} is missing`);
    for (const p of [...way.points].sort((a, b) => b[1] - a[1]))
      if (!pts.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.05)) pts.push([p[0], p[1]]);
  }
  // 1036229280 carries an intermediate vertex (32.3,-362.8) on the same line; keep the ordered polyline.
  return pts.sort((a, b) => b[1] - a[1]);
}

/** Normal (east) of the accepted corridor's last segment (OSM 570134436, ending at the start point). */
function previousNormal(data: BlockInstallContext['data'], start: P2): P2 {
  const way = data.paths.find(p => p.id === 570134436);
  if (!way) throw new Error('Accepted Speedway corridor way 570134436 is missing');
  const i = way.points.findIndex(p => Math.hypot(p[0] - start[0], p[1] - start[1]) < 0.05);
  if (i < 1) throw new Error('The northern stretch does not start at the accepted corridor end');
  const a = way.points[i - 1], dx = start[0] - a[0], dz = start[1] - a[1], l = Math.hypot(dx, dz);
  return [-dz / l, dx / l];
}

export function speedwayNorthStations(ctx: BlockInstallContext): SpeedwayNorthStation[] {
  const line = speedwayNorthCentre(ctx.data);
  const segN = line.slice(1).map((b, i) => { const a = line[i], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); return { a, b, l, d: [dx / l, dz / l] as P2, n: [-dz / l, dx / l] as P2 }; });
  // Stations every <= 1 m, including every vertex; stop at the Dean Keeton curb.
  const raw: { s: number; c: P2; n: P2; scale: number }[] = [];
  let s0 = 0;
  for (let k = 0; k < segN.length; k++) {
    const g = segN[k];
    const zEnd = Math.max(g.b[1], DEAN_KEETON_CURB_Z), len = g.l * (g.a[1] - zEnd) / (g.a[1] - g.b[1]);
    const steps = Math.max(1, Math.ceil(len - 1e-6));
    for (let j = k === 0 ? 0 : 1; j <= steps; j++) {
      const t = len * j / steps, c: P2 = [g.a[0] + g.d[0] * t, g.a[1] + g.d[1] * t];
      let n = g.n, scale = 1;
      if (j === steps && k + 1 < segN.length && zEnd === g.b[1]) { // mitred corner
        const m = segN[k + 1].n, sum: P2 = [g.n[0] + m[0], g.n[1] + m[1]], l = Math.hypot(...sum);
        n = [sum[0] / l, sum[1] / l]; scale = 1 / Math.max(0.5, n[0] * m[0] + n[1] * m[1]);
      }
      raw.push({ s: s0 + t, c, n, scale });
    }
    s0 += len;
    if (zEnd > g.b[1]) break;
  }
  raw[0].n = previousNormal(ctx.data, line[0]);
  // Heights.
  const terrainAt = (x: number, z: number) => { const g = ctx.groundHeight(x, z); return g === ctx.terrainHeight(x, z) ? null : g; };
  const startY = ctx.terrainHeight(line[0][0], line[0][1]) + 0.06; // walkway.ts: contour + 0.04 route + 0.02 brick
  const off = (st: { c: P2; n: P2; scale: number }, o: number): P2 => [st.c[0] + st.n[0] * o * st.scale, st.c[1] + st.n[1] * o * st.scale];
  const highest = (st: { c: P2; n: P2; scale: number }, o: number) => highestAt(st, o, 0.29);
  function highestAt(st: { c: P2; n: P2; scale: number }, o: number, lat: number) {
    let best: number | null = null; const t: P2 = [-st.n[1], st.n[0]];
    for (const [da, dl] of [[0, 0], [0.5, 0], [-0.5, 0], [0, lat], [0, -lat], [0.5, lat], [-0.5, -lat], [0.5, -lat], [-0.5, lat]]) {
      const [x, z] = off(st, o + dl); const y = terrainAt(x + t[0] * da, z + t[1] * da);
      if (y !== null && (best === null || y > best)) best = y;
    }
    return best;
  }
  const out: SpeedwayNorthStation[] = [];
  for (let i = 0; i < raw.length; i++) {
    const st = raw[i];
    if (i === 0) { out.push({ ...st, ys: Array(OFFSETS.length).fill(startY), band: [startY + 0.005, startY + 0.005] }); continue; }
    const E = engineeringSpeedwayEdge(st.c[1]);
    const T = OFFSETS.map((o, j) => j === LAST ? highestAt(st, o, 0.1) : highest(st, o));
    const W = T[0] !== null ? T[0] + COVER : E;
    const ys = T.map((t, j) => {
      if (j === LAST) return t === null ? E : Math.min(E + EDGE_LIFT, Math.max(E, t + 0.012));
      const lin = W + (E - W) * (OFFSETS[j] + HALF_WIDTH) / (2 * HALF_WIDTH);
      return t === null ? lin : Math.max(lin, t + COVER);
    });
    // The edge ramp rises no steeper than 1:4 off the profile (rideable crossfall); where the terrain stands higher
    // still (z -306..-314, beside the PMA forecourt), a sliver of lawn under 0.25 m wide stays visible at the edge.
    ys[LAST - 1] = Math.min(ys[LAST - 1], ys[LAST] + 0.25 * EDGE_RAMP);
    // Climb away from the accepted corridor end no steeper than MAX_GRADE (only near the start).
    const prev = out[i - 1], ds = st.s - prev.s;
    for (let j = 0; j <= LAST; j++) ys[j] = Math.min(ys[j], prev.ys[j] + MAX_GRADE * ds);
    const outer = highest(st, -HALF_WIDTH - BAND);
    const bandIn = ys[0] + 0.005, bandOut = Math.min(Math.max(bandIn, outer === null ? bandIn : outer + COVER), prev.band[1] + MAX_GRADE * ds);
    out.push({ ...st, ys, band: [bandOut, bandIn] });
  }
  return out;
}

/** Interpolated brick top at lateral offset o of station st. */
export function stationY(st: SpeedwayNorthStation, o: number) {
  let j = 0; while (j < LAST - 1 && o > OFFSETS[j + 1]) j++;
  const f = Math.min(1, Math.max(0, (o - OFFSETS[j]) / (OFFSETS[j + 1] - OFFSETS[j])));
  return st.ys[j] + (st.ys[j + 1] - st.ys[j]) * f;
}

function strip(stations: SpeedwayNorthStation[], offsets: number[], y: (st: SpeedwayNorthStation, k: number) => number) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], w = offsets.length;
  for (const st of stations) for (let k = 0; k < w; k++) {
    const o = offsets[k];
    pos.push(st.c[0] + st.n[0] * o * st.scale, y(st, k), st.c[1] + st.n[1] * o * st.scale);
    uv.push(o / 2, st.c[1] / 2 + st.c[0] / 2); // walkway.ts brick/drain mapping
  }
  for (let i = 0; i + 1 < stations.length; i++) for (let k = 0; k + 1 < w; k++) {
    const a = i * w + k, b = a + 1, c = a + w, d = c + 1;
    idx.push(a, c, b, b, c, d); // counter-clockwise from above (north = -z, east = +x)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // Wind every triangle upward (normal +Y) whatever the station orientation.
  const p = g.getAttribute('position'), ix = g.index!;
  for (let t = 0; t < ix.count; t += 3) {
    const [i0, i1, i2] = [ix.getX(t), ix.getX(t + 1), ix.getX(t + 2)];
    const ux = p.getX(i1) - p.getX(i0), uz = p.getZ(i1) - p.getZ(i0), vx = p.getX(i2) - p.getX(i0), vz = p.getZ(i2) - p.getZ(i0);
    if (uz * vx - ux * vz < 0) { ix.setX(t + 1, i2); ix.setX(t + 2, i1); }
  }
  g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

function trimesh(physics: RAPIER.World, g: THREE.BufferGeometry) {
  const pos = new Float32Array(g.getAttribute('position').array as ArrayLike<number>);
  return physics.createCollider(RAPIER.ColliderDesc.trimesh(pos, new Uint32Array(g.index!.array as ArrayLike<number>), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.8));
}

function findMeshMaterial(ctx: BlockInstallContext, name: RegExp): THREE.Material | undefined {
  let found: THREE.Material | undefined;
  ctx.authored.surfaces.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (!found && (o as THREE.Mesh).isMesh && m && !Array.isArray(m) && name.test(o.name)) found = m;
  });
  return found;
}

function findDrainMaterial(ctx: BlockInstallContext): THREE.Material | undefined {
  let found: THREE.Material | undefined;
  ctx.authored.surfaces.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (!found && (o as THREE.Mesh).isMesh && m && !Array.isArray(m) && m.customProgramCacheKey?.() === 'speedway-central-drain-v1') found = m;
  });
  return found;
}

export function buildSpeedwayNorth(ctx: BlockInstallContext) {
  const surface = FINISH === 'brick' ? ctx.material('Speedway golden brick paving') : findMeshMaterial(ctx, /asphalt surfaces$/i);
  if (!surface) throw new Error(`Speedway north ${FINISH} material is missing`);
  const concrete = ctx.material('Engineering concrete walks');
  const drain = FINISH === 'brick' ? findDrainMaterial(ctx) : undefined;
  const stations = speedwayNorthStations(ctx);
  const geometries: THREE.BufferGeometry[] = [], walkable: THREE.Mesh[] = [], colliders: RAPIER.Collider[] = [];
  const brickGeometry = strip(stations, OFFSETS, (st, k) => st.ys[k]);
  const brickMesh = tagGroundTieIn(new THREE.Mesh(brickGeometry, surface), 'b03 Speedway north brick', 'paved');
  brickMesh.name = `b03 Speedway north surface (${FINISH}, EER south walk to Dean Keeton)`;
  geometries.push(brickGeometry); walkable.push(brickMesh); colliders.push(trimesh(ctx.physics, brickGeometry));
  if (concrete) {
    const g = strip(stations, [-HALF_WIDTH - BAND, -HALF_WIDTH], (st, k) => st.band[k]);
    const m = tagGroundTieIn(new THREE.Mesh(g, concrete), 'b03 Speedway north brick', 'paved');
    m.name = 'b03 Speedway north west edge band';
    geometries.push(g); walkable.push(m); colliders.push(trimesh(ctx.physics, g));
  }
  if (drain) {
    // Flush grate over the brick (walkway.ts: no own collider, the brick below carries it).
    const g = strip(stations, [-DRAIN, 0, DRAIN], (st, k) => stationY(st, [-DRAIN, 0, DRAIN][k]) + 0.003);
    const m = new THREE.Mesh(g, drain); m.name = 'b03 Speedway north central drain';
    geometries.push(g); walkable.push(m);
  }
  for (const m of walkable) m.receiveShadow = true;
  const triangles = geometries.reduce((a, g) => a + g.index!.count / 3, 0);
  const last = stations.at(-1)!;
  return {
    walkable, colliders, geometries, stations,
    stats: { finish: FINISH, surfaceMaterial: (surface as THREE.Material).name || '(walkway asphalt)', stations: stations.length, lengthM: +last.s.toFixed(1), endZ: +last.c[1].toFixed(2), widthM: 2 * HALF_WIDTH, triangles,
      drain: !!drain, band: !!concrete, startY: +stations[0].ys[0].toFixed(3) },
  };
}
