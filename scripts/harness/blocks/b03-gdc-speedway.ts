// Headless checks owned by block b03-gdc-speedway (run by scripts/harness/run-block-checks.mjs).
// They prove this block's changes in the real scene and in the LiDAR datum (campus Y =
// LiDAR groundY + height, public/data/derived/roofs-lidar.json). Passing proves geometric
// consistency with the cited measurements, not real-world resemblance.
//  B1 594130 (PPE) generated roof top, measured by raycast in campus Y, vs LiDAR groundY+P95.
//  B2 GDC west passage between the paired wings: open to the sky, wing edges vs LiDAR tier edges.
//  B3 new GDC approach hedges: off every mapped path, standing on the visible frontage.
//  B4 Speedway paving width (PWP: 30 ft = 9.144 m) and visible = physical at stations.
//  B5 GDC roof area above the LiDAR P95.
//  B6 (round 2) Speedway north brick (install(), speedway-north.ts): 30 ft width across the normal,
//     visible = own physical, seam with b01's published engineeringSpeedwayEdge() profile (+-0.03 m),
//     no step at the accepted corridor end, no lawn showing through, scooter rideability with the
//     real ScooterClearance + LocalGroundQuery (as run-stand-runtime-check.mjs).
//  B7 (round 2) LiDAR chimneys: built rim top and radius vs the 2017 point cloud; own colliders.
//  B8 (round 2) power plant massing zones (generated) vs LiDAR zone medians; the four records stay generated.
//  B9 (round 3) official additions CT1/CT2/PA1/PA3/PA4/PB2: generated, top (raycast, campus Y) vs LiDAR deck.
//  B10 (round 3) remaining generated records (WIN, LTH, PPA, four sheds): top per LiDAR tier (probe outside higher
//     tiers) vs groundY + tier height; footprint choice (City vs official) reported from derived/r3/towers-fit.json.
//  B11 (round 3) cooling-tower fan shrouds: rim top vs LiDAR, base seated on the generated deck, own colliders.
//  B12 (district round, D04/D05) stall paint (speedway-north-markings.ts): every vertex 0.004-0.012 m above the own
//     asphalt collider and inside the built 9.144 m strip, 14 observed separators, no own collider; chimney/fan solids
//     carry a textured family and metre UVs (area-weighted median |uv area| / world area within 5 %).
// Reported (not failed): authored roof anchors vs LiDAR for GDC/JGB/EPS/BRB, eave residuals.
import * as THREE from 'three';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BlockCheck } from './types';
import { engineeringSpeedwayEdge, speedwayNorthEastEdge } from '../../../lib/campus/engineering-courtyard';
import { ScooterClearance } from '../../../lib/campus/scooter-clearance';
import { LocalGroundQuery } from '../../../lib/campus/local-ground-query';
import { HALF_WIDTH, DEAN_KEETON_CURB_Z, speedwayNorthCentre } from '../../../lib/campus/blocks/b03-gdc-speedway/speedway-north';
import { STACKS } from '../../../lib/campus/blocks/b03-gdc-speedway/power-plant-stacks';
import { FANS } from '../../../lib/campus/blocks/b03-gdc-speedway/cooling-fans';

type Pt = [number, number];
const pip = (x: number, z: number, r: Pt[]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > z) !== (r[j][1] > z) && x < (r[j][0] - r[i][0]) * (z - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };
const segDist = (px: number, pz: number, ax: number, az: number, bx: number, bz: number) => {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l)) : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
};
/** Interior point farthest from the ring edges (coarse grid search, 0.5 m). */
const pole = (r: Pt[]): Pt => {
  const xs = r.map(p => p[0]), zs = r.map(p => p[1]); let best: Pt = r[0], bd = -1;
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.5) for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.5) {
    if (!pip(x, z, r)) continue; let d = Infinity;
    for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; d = Math.min(d, segDist(x, z, a[0], a[1], b[0], b[1])); }
    if (d > bd) { bd = d; best = [x, z]; }
  }
  return best;
};
/** Pole of ring r restricted to points outside every ring in minus (distance to all those edges too). */
const poleOutside = (r: Pt[], minus: Pt[][]): Pt => {
  const xs = r.map(p => p[0]), zs = r.map(p => p[1]); let best: Pt = r[0], bd = -1;
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.5) for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.5) {
    if (!pip(x, z, r) || minus.some(m => pip(x, z, m))) continue; let d = Infinity;
    for (const q of [r, ...minus]) for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; d = Math.min(d, segDist(x, z, a[0], a[1], b[0], b[1])); }
    if (d > bd) { bd = d; best = [x, z]; }
  }
  return best;
};
const SKIP = /hedge|oak|tree|canopy|Foreground|impostor|lamp|globe|banner/i;

function lidar(): Record<string, { groundY: number; heightP50: number; heightP95: number; heightMax: number; tiers?: { height: number; area: number; ring: Pt[] }[] }> {
  for (const p of [resolve(import.meta.dirname ?? '.', '../../public/data/derived/roofs-lidar.json'), resolve(process.cwd(), 'public/data/derived/roofs-lidar.json')])
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')).buildings;
  throw new Error('roofs-lidar.json not found');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const check: BlockCheck = (scene: any) => {
  const failures: string[] = [];
  const report: Record<string, unknown> = {};
  const roofs = lidar();
  const { plans, walkway, world, context, physics, RAPIER, player } = scene;
  const rc = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const firstHit = (roots: THREE.Object3D[], x: number, z: number, from = 120) => {
    rc.set(new THREE.Vector3(x, from, z), down); rc.far = from + 60;
    return rc.intersectObjects(roots, true).find(h => !SKIP.test(h.object.name + '|' + (h.object.parent?.name ?? ''))) ?? null;
  };
  const physY = (x: number, z: number, from: number) => { const h = physics.castRay(new RAPIER.Ray({ x, y: from, z }, { x: 0, y: -1, z: 0 }), 200, true, undefined, undefined, player); return h ? from - h.timeOfImpact : null; };
  const authoredRoots = [walkway.surfaces, world.group];

  // B1: PPE (594130) roof in campus Y vs LiDAR.
  {
    const id = 594130, l = roofs[String(id)], plan = plans.find((p: { building: { id: number } }) => p.building.id === id);
    const [x, z] = pole(plan.building.rings[0]);
    const hit = context?.solid ? firstHit([context.solid], x, z, 200) : null;
    const lidarRoofY = l.groundY + l.heightP95, top = hit ? +hit.point.y.toFixed(2) : null;
    const residual = top === null ? null : +(top - lidarRoofY).toFixed(2);
    report.ppe594130 = { decision: plan.decision, probe: [x, z], generatedTopCampusY: top, lidarRoofCampusY: +lidarRoofY.toFixed(2), residual, before: 'City h 47.83 m fallback (+ estimated penthouse)' };
    if (plan.decision !== 'generated') failures.push(`594130 decision ${plan.decision}, expected generated`);
    else if (top === null || Math.abs(residual!) > 1.5) failures.push(`594130 roof campus Y ${top} vs LiDAR ${lidarRoofY.toFixed(2)} (> 1.5 m)`);
  }

  // B2: GDC central west passage between the paired wings (LiDAR tier rings of 589955).
  {
    const open: [number, number, number | null][] = [];
    for (const x of [20, 24, 28, 31]) {
      const h = firstHit(authoredRoots, x, -19, 80); const y = h ? +h.point.y.toFixed(2) : null; open.push([x, -19, y]);
      if (y === null || y > 4) failures.push(`GDC passage not open to the sky at (${x}, -19): first hit y ${y}`);
    }
    // Wing edges at x = 30: first roof (> 20 m) north and south of the passage centre line.
    const edge = (dir: number) => { for (let k = 0; k <= 160; k++) { const z = -19 + dir * k * 0.1, h = firstHit(authoredRoots, 30, z, 80); if (h && h.point.y > 20) return +z.toFixed(2); } return null; };
    const north = edge(-1), south = edge(1);
    const lz = (a: Pt, b: Pt, x: number) => a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
    const lidarNorth = +lz([22.9, -24.7], [114.3, -16.8], 30).toFixed(2), lidarSouth = +lz([21.4, -13.5], [52.5, -10.6], 30).toFixed(2);
    report.gdcPassage = { openToSky: open, wingEdgesAtX30: { modelNorth: north, lidarNorth, modelSouth: south, lidarSouth, modelWidth: north !== null && south !== null ? +(south - north).toFixed(2) : null, lidarWidth: +(lidarSouth - lidarNorth).toFixed(2) } };
    if (north === null || Math.abs(north - lidarNorth) > 1.5) failures.push(`GDC north wing edge ${north} vs LiDAR ${lidarNorth}`);
    if (south === null || Math.abs(south - lidarSouth) > 1.5) failures.push(`GDC south wing edge ${south} vs LiDAR ${lidarSouth}`);
  }

  // B3: the two new approach hedges (gdc-frontage.ts) stay off mapped paths and on visible ground.
  {
    const placements: { a: Pt; b: Pt; y: number; endY: number; width: number; height: number }[] = walkway.hedgePlacements ?? [];
    const mine = placements.filter(h => h.a[0] < 12 && h.b[0] > 13.5 && h.b[0] < 15 && ((h.a[1] < -26 && h.a[1] > -29) || (h.a[1] > -14 && h.a[1] < -11)));
    const paths = scene.walkway?.data?.paths ?? JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/campus.json'), 'utf8')).paths;
    let cells = 0, onPath = 0, groundMiss = 0, worstGround = 0, minClear = Infinity;
    for (const h of mine) {
      const n = Math.ceil(Math.hypot(h.b[0] - h.a[0], h.b[1] - h.a[1]) / 0.8);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, x = h.a[0] + (h.b[0] - h.a[0]) * t, z = h.a[1] + (h.b[1] - h.a[1]) * t, y = h.y + (h.endY - h.y) * t; cells++;
        for (const p of paths) for (let k = 1; k < p.points.length; k++) {
          const d = segDist(x, z, p.points[k - 1][0], p.points[k - 1][1], p.points[k][0], p.points[k][1]) - (p.width ?? 2.2) / 2 - h.width / 2;
          if (d < minClear) minClear = d; if (d < 0.2) onPath++;
        }
        const g = firstHit([walkway.surfaces], x, z, y + 5); const dy = g ? Math.abs(g.point.y - y) : Infinity;
        worstGround = Math.max(worstGround, Math.min(dy, 99)); if (dy > 0.15) groundMiss++;
      }
    }
    report.gdcApproachHedges = { strips: mine.length, cells, minClearanceToMappedPathEdge: +minClear.toFixed(2), cellsOnPath: onPath, worstBaseVsVisibleGround: +worstGround.toFixed(3) };
    if (mine.length !== 2) failures.push(`expected 2 new GDC approach hedges, found ${mine.length}`);
    if (onPath) failures.push(`${onPath} hedge cells within 0.2 m of a mapped path edge`);
    if (groundMiss) failures.push(`${groundMiss} hedge cells not standing on the visible frontage (> 0.15 m)`);
  }

  // B4: Speedway paving width and visible = physical (south of 24th and the accepted north run).
  {
    const sp: Pt[] = [];
    const src = (scene.walkway?.data?.paths ?? JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/campus.json'), 'utf8')).paths) as { id: number; points: Pt[] }[];
    for (const id of [126307538, 570134436]) for (const p of src.find(p => p.id === id)!.points) if (!sp.some(q => q[0] === p[0] && q[1] === p[1])) sp.push(p);
    sp.sort((a, b) => b[1] - a[1]);
    const cx = (z: number) => { for (let i = 1; i < sp.length; i++) if ((z - sp[i - 1][1]) * (z - sp[i][1]) <= 0) return sp[i - 1][0] + (sp[i][0] - sp[i - 1][0]) * (z - sp[i - 1][1]) / (sp[i][1] - sp[i - 1][1]); return null; };
    const stations: unknown[] = [];
    for (const z of [17, 0, -19, -40, -58, -80, -100, -125, -160, -200, -230]) {
      const c = cx(z); if (c === null) continue;
      let lo: number | null = null, hi: number | null = null, gap = 0, worst = 0;
      for (let x = c - 8; x <= c + 8; x += 0.125) {
        const h = firstHit([walkway.surfaces], x, z, 60);
        if (h && (h.object as THREE.Mesh).material && ((h.object as THREE.Mesh).material as THREE.Material).name === 'Speedway golden brick paving') {
          if (lo === null) lo = x; else if (x - (hi ?? x) > 0.9) gap++; hi = x;
          const py = physY(x, z, h.point.y + 1); if (py !== null) worst = Math.max(worst, Math.abs(py - h.point.y));
        }
      }
      const width = lo !== null && hi !== null ? +(hi - lo + 0.125).toFixed(2) : 0;
      stations.push({ z, centre: +c.toFixed(2), brickWidth: width, visPhysWorst: +worst.toFixed(3) });
      if (width < 8.6 || width > 9.7) failures.push(`Speedway brick width ${width} m at z ${z} (expected 9.144 m +- 0.5)`);
      if (worst > 0.05) failures.push(`Speedway brick visible/physical ${worst.toFixed(3)} m at z ${z}`);
      if (gap) failures.push(`Speedway brick broken at z ${z}`);
    }
    report.speedway = { stations };
  }

  // B5: GDC roof-top area above the LiDAR P95 (penthouses) and highest top vs LiDAR max.
  {
    const l = roofs['589955'], plan = plans.find((p: { building: { id: number } }) => p.building.id === 589955);
    const ring: Pt[] = plan.building.rings[0], xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
    let n = 0, above = 0, maxTop = -Infinity;
    const p95Y = l.groundY + l.heightP95, maxY = l.groundY + l.heightMax;
    for (let x = Math.min(...xs) + 0.5; x < Math.max(...xs); x += 1) for (let z = Math.min(...zs) + 0.5; z < Math.max(...zs); z += 1) {
      if (!pip(x, z, ring)) continue; const h = firstHit(authoredRoots, x, z, 80); if (!h || h.point.y < 15) continue;
      n++; if (h.point.y > p95Y + 0.3) above++; maxTop = Math.max(maxTop, h.point.y);
    }
    const fraction = n ? above / n : 0;
    report.gdcRoofAboveP95 = { roofSamples: n, aboveP95: above, fraction: +fraction.toFixed(3), lidarP95CampusY: +p95Y.toFixed(2), modelMaxTop: +maxTop.toFixed(2), lidarMaxCampusY: +maxY.toFixed(2), before: '~38% (two 1,505 m2 penthouses)' };
    if (fraction > 0.06) failures.push(`GDC roof area above LiDAR P95 ${(fraction * 100).toFixed(1)}% (> 6%)`);
    if (maxTop > maxY + 0.5) failures.push(`GDC highest top ${maxTop.toFixed(2)} above LiDAR max ${maxY.toFixed(2)} + 0.5`);
  }

  // Reported: authored roof anchors vs LiDAR tiers (same datum), and suppressed records.
  {
    const anchors: unknown[] = [];
    for (const [id, abbr] of [[589955, 'GDC'], [575728, 'JGB'], [591140, 'EPS'], [657075, 'BRB']] as const) {
      const l = roofs[String(id)];
      for (const t of (l.tiers ?? []).filter(t => t.area >= 100)) {
        // Round 3: probe outside every higher tier ring (round 2 used the plain pole, which for JGB 22.7 m fell inside the 27.7 m tier).
        const [x, z] = poleOutside(t.ring, (l.tiers ?? []).filter(u => u.height > t.height).map(u => u.ring)), h = firstHit(authoredRoots, x, z, 120);
        const lidarY = l.groundY + t.height;
        anchors.push({ abbr, tier: t.height, area: t.area, probe: [x, z], lidarCampusY: +lidarY.toFixed(2), modelTopCampusY: h ? +h.point.y.toFixed(2) : null, residual: h ? +(h.point.y - lidarY).toFixed(2) : null, lidarMaxCampusY: +(l.groundY + l.heightMax).toFixed(2), mesh: h?.object.name ?? null });
      }
    }
    report.authoredRoofAnchors = anchors;
  }
  // ---------- Round 2 ----------
  const entry = scene.blocks.installs.find((x: { id: string }) => x.id === 'b03-gdc-speedway');
  if (!entry) { failures.push('b03 install() produced nothing'); return { ok: false, report, failures }; }
  const ownHandles = new Set<number>(entry.colliders.map((k: { handle: number }) => k.handle));
  const ownY = (x: number, z: number, from: number, reach = 3) => { const h = physics.castRay(new RAPIER.Ray({ x, y: from, z }, { x: 0, y: -1, z: 0 }), reach, true, undefined, undefined, player, undefined, (k: { handle: number }) => ownHandles.has(k.handle)); return h ? from - h.timeOfImpact : null; };
  const otherY = (x: number, z: number, from: number, reach = 3) => { const h = physics.castRay(new RAPIER.Ray({ x, y: from, z }, { x: 0, y: -1, z: 0 }), reach, true, undefined, undefined, player, undefined, (k: { handle: number }) => !ownHandles.has(k.handle)); return h ? from - h.timeOfImpact : null; };
  const isOwnBrick = (h: THREE.Intersection | null) => !!h && h.object.userData.block === 'b03-gdc-speedway';
  const sceneRoots = [walkway.surfaces, world.group, ...(context?.group ? [context.group] : [])];
  const r3 = (v: number | null) => v === null ? null : +v.toFixed(3);

  // B6 Speedway north brick.
  {
    const line = speedwayNorthCentre(scene.world.data ?? JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/campus.json'), 'utf8')));
    const frame = (z: number) => { // centre and east normal at centreline z (b01's segment convention)
      const i = z > line[1][1] ? 0 : line.length - 2, a = line[i], b = line[i + 1];
      const k = (z - a[1]) / (b[1] - a[1]), dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
      return { c: [a[0] + dx * k, z] as Pt, n: [-dz / l, dx / l] as Pt, d: [dx / l, dz / l] as Pt };
    };
    const stations: unknown[] = [];
    for (const z of [-248, -256, -270, -290, -310, -324, -330, -345, -360, -365]) {
      const f = frame(z); let lo: number | null = null, hi: number | null = null, worst = 0, gaps = 0, last: number | null = null;
      const foreign: Record<string, number> = {};
      for (let o = -6; o <= 6; o += 0.05) {
        const x = f.c[0] + f.n[0] * o, zz = f.c[1] + f.n[1] * o, h = firstHit(sceneRoots, x, zz, 40);
        // Paving = the brick and its flush central drain (the 0.45 m west band is concrete, outside the 30 ft).
        if (!h || !isOwnBrick(h) || !/Speedway north (surface|central drain)/i.test(h.object.name)) {
          if (Math.abs(o) < HALF_WIDTH - 0.05) { const k = h ? `${h.object.name}@${o.toFixed(2)}` : 'none'; if (Object.keys(foreign).length < 6) foreign[k] = +(h?.point.y ?? 0).toFixed(2); }
          continue;
        }
        if (lo === null) lo = o; else if (last !== null && o - last > 0.3) gaps++; hi = o; last = o;
        const py = ownY(x, zz, h.point.y + 1); worst = Math.max(worst, py === null ? 99 : Math.abs(py - h.point.y));
      }
      const width = lo !== null && hi !== null ? +(hi - lo + 0.05).toFixed(2) : 0;
      // Built (physical) width: own brick collider across the normal, west band excluded (it stands 5 mm higher).
      let plo: number | null = null, phi: number | null = null;
      for (let o = -6; o <= 6; o += 0.05) { const x = f.c[0] + f.n[0] * o, zz = f.c[1] + f.n[1] * o; if (ownY(x, zz, 30, 40) !== null && o > -HALF_WIDTH - 0.02) { if (plo === null) plo = o; phi = o; } }
      const built = plo !== null && phi !== null ? +(phi - plo + 0.05).toFixed(2) : 0;
      stations.push({ z, centre: f.c.map(v => +v.toFixed(2)), builtWidth: built, visibleBrickWidth: width, visPhysWorst: +worst.toFixed(3), gaps, foreign });
      if (built < 9.0 || built > 9.3) failures.push(`Speedway north brick built width ${built} m at z ${z} (30 ft = 9.144 m)`);
      if (width < 8.8) failures.push(`Speedway north brick visible width ${width} m at z ${z} (terrain over > 0.35 m of it)`);
      if (worst > 0.05) failures.push(`Speedway north brick visible/physical ${worst.toFixed(3)} m at z ${z}`);
      if (gaps) failures.push(`Speedway north brick broken at z ${z}`);
    }
    // Seam: brick top 2 cm inside the shared east edge vs b01's published profile; b01 side 0.5 m east.
    const seam: unknown[] = []; let seamWorst = 0, stepWorst = 0;
    for (let z = -244; z >= -364; z -= 4) {
      const [ex, ez] = speedwayNorthEastEdge(z), f = frame(z);
      const brickY = ownY(ex - f.n[0] * 0.02, ez - f.n[1] * 0.02, 12, 12), pub = engineeringSpeedwayEdge(z);
      const engY = otherY(ex + f.n[0] * 0.5, ez + f.n[1] * 0.5, 12, 12);
      const dev = brickY === null ? null : brickY - pub, step = brickY === null || engY === null ? null : brickY - engY;
      seamWorst = Math.max(seamWorst, dev === null ? 99 : Math.abs(dev)); if (step !== null) stepWorst = Math.max(stepWorst, Math.abs(step));
      seam.push([z, +ex.toFixed(2), r3(brickY), +pub.toFixed(3), r3(dev), r3(engY), r3(step)]);
    }
    if (seamWorst > 0.03) failures.push(`Speedway north east edge deviates ${seamWorst.toFixed(3)} m from b01's engineeringSpeedwayEdge() (> 0.03)`);
    // Join with the accepted corridor (OSM 570134436 ends at line[0]): existing brick 2 cm south of the end edge vs ours 2 cm north.
    const way = (scene.world.data ?? { paths: [] }).paths.find((p: { id: number }) => p.id === 570134436) ?? JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/campus.json'), 'utf8')).paths.find((p: { id: number }) => p.id === 570134436);
    const prev = way.points[way.points.findIndex((p: Pt) => Math.hypot(p[0] - line[0][0], p[1] - line[0][1]) < 0.05) - 1] as Pt;
    const dl = Math.hypot(line[0][0] - prev[0], line[0][1] - prev[1]), du: Pt = [(line[0][0] - prev[0]) / dl, (line[0][1] - prev[1]) / dl], nu: Pt = [-du[1], du[0]];
    const join: unknown[] = []; let joinWorst = 0;
    for (const o of [-4.4, -2.2, 0, 2.2, 4.4]) {
      const bx = line[0][0] + nu[0] * o, bz = line[0][1] + nu[1] * o;
      const south = otherY(bx - du[0] * 0.02, bz - du[1] * 0.02, 10, 8), north = ownY(bx + du[0] * 0.02, bz + du[1] * 0.02, 10, 8);
      const d = south === null || north === null ? null : north - south; joinWorst = Math.max(joinWorst, d === null ? 99 : Math.abs(d));
      join.push([o, r3(south), r3(north), r3(d)]);
    }
    if (joinWorst > 0.03) failures.push(`step ${joinWorst.toFixed(3)} m between the accepted Speedway brick end and the new brick`);
    // Coverage: first visible hit over the brick area must be the brick/drain (no terrain lawn above it).
    let samples = 0, lawn = 0, lawnNorth = 0, other = 0; const lawnAt: number[][] = []; const otherNames: Record<string, number> = {};
    for (let z = -244.6; z >= DEAN_KEETON_CURB_Z + 0.3; z -= 0.5) {
      const f = frame(z);
      for (let o = -HALF_WIDTH + 0.1; o <= HALF_WIDTH - 0.1; o += 0.5) {
        const x = f.c[0] + f.n[0] * o, zz = f.c[1] + f.n[1] * o; rc.set(new THREE.Vector3(x, 40, zz), down); rc.far = 60;
        const h = rc.intersectObjects(sceneRoots, true).find(q => !/hedge|oak|canopy|Foreground|impostor|banner/i.test(q.object.name + '|' + (q.object.parent?.name ?? ''))) ?? null;
        samples++;
        if (isOwnBrick(h)) continue;
        if (h && h.object.name === 'Offline local contour terrain') { lawn++; if (z < -250) lawnNorth++; if (lawnAt.length < 12) lawnAt.push([+x.toFixed(1), +zz.toFixed(1), +(h.point.y - (stationsY(x, zz) ?? h.point.y)).toFixed(3)]); }
        else { other++; const k = h ? h.object.name || '(unnamed)' : '(none)'; otherNames[k] = (otherNames[k] ?? 0) + 1; }
      }
    }
    function stationsY(x: number, z: number) { return ownY(x, z, 40, 60); }
    if (lawnNorth / samples > 0.005) failures.push(`terrain lawn shows through the Speedway north brick at ${lawnNorth} of ${samples} samples north of z -250`);
    // Scooter: real ScooterClearance against the scene colliders and the rendered ground (LocalGroundQuery over groundRoots).
    const controller = physics.createCharacterController(0.025);
    controller.enableAutostep(0.32, 0.2, false); controller.enableSnapToGround(0.38);
    controller.setMaxSlopeClimbAngle(Math.PI * 0.25); controller.setMinSlopeSlideAngle(Math.PI * 0.28);
    const query = new LocalGroundQuery();
    const clearance = new ScooterClearance({ world: physics, controller, collider: player, renderedGround: (x, z, fromY, distance) => query.sample(x, z, fromY, distance) });
    const rides: Record<string, unknown> = {}; let centreBlocked = 0;
    for (const o of [-2.8, 0, 2.8]) {
      let metres = 0, blocked = 0; const reasons: Record<string, number> = {}; const firstBlocks: unknown[] = [];
      for (let z = -246; z > DEAN_KEETON_CURB_Z + 1.5; z -= 1) {
        const f = frame(z), x = f.c[0] + f.n[0] * o, zz = f.c[1] + f.n[1] * o, y = ownY(x, zz, 30, 40);
        if (y === null) { blocked++; reasons['no-brick'] = (reasons['no-brick'] ?? 0) + 1; continue; }
        const center = { x, y: y + 0.905, z: zz }, heading = Math.atan2(f.d[0], f.d[1]);
        query.prepare(scene.groundRoots, center, () => true);
        const t = clearance.traceMove({ center, heading }, { x: f.d[0], z: f.d[1] }, heading);
        if (t.fraction >= 0.999 && !t.blockedReason) metres += 1; else { blocked++; const k = t.blockedReason ?? 'partial'; reasons[k] = (reasons[k] ?? 0) + 1; if (firstBlocks.length < 4) firstBlocks.push([+x.toFixed(1), +zz.toFixed(1), k, +t.fraction.toFixed(2)]); }
      }
      rides[`offset${o}`] = { metresRidden: metres, blockedMetres: blocked, reasons, firstBlocks };
      if (o === 0) centreBlocked = blocked;
    }
    controller.free?.();
    if (centreBlocked) failures.push(`scooter blocked on ${centreBlocked} one-metre moves along the Speedway north centreline`);
    report.speedwayNorth = { install: scene.blocks.stats['b03-gdc-speedway']?.speedwayNorth ?? null, stations,
      seam: { columns: ['z', 'edgeX', 'brickY', 'publishedY', 'deviation', 'b01SideY(+0.5m)', 'step'], rows: seam, worstDeviation: +seamWorst.toFixed(3), worstStepToB01Side: +stepWorst.toFixed(3) },
      joinWithAcceptedCorridor: { columns: ['offset', 'existingY', 'newY', 'step'], rows: join, worst: +joinWorst.toFixed(3) },
      coverage: { samples, lawnShowing: lawn, lawnShowingNorthOfZ250: lawnNorth, otherFirstHits: other, otherNames, lawnExamples: lawnAt }, scooter: rides };
  }

  // B7 chimneys: rim top (down ray on the rim) and radius (horizontal ray 5 m below the top) vs the point cloud.
  {
    const lidarStacks: Record<string, { top: number; rimDiameter: number; midDiameter: number }> = { A: { top: 59.68, rimDiameter: 3.65, midDiameter: 4.17 }, B: { top: 47.31, rimDiameter: 3.8, midDiameter: 4.6 } };
    const rows: unknown[] = [];
    for (const s of STACKS) {
      const l = lidarStacks[s.id], [cx, cz] = s.centre, rimY = ownY(cx + s.rTop - 0.15, cz, s.topY + 5, 10);
      const y = s.topY - 5, h = physics.castRay(new RAPIER.Ray({ x: cx + 10, y, z: cz }, { x: -1, y: 0, z: 0 }), 10, true, undefined, undefined, player, undefined, (k: { handle: number }) => ownHandles.has(k.handle));
      const radius = h ? 10 - h.timeOfImpact : null;
      const vis = firstHit([world.group], cx + s.rTop - 0.15, cz, s.topY + 20);
      rows.push({ id: s.id, record: s.record, centre: s.centre, rimTopOwnCollider: r3(rimY), rimTopVisible: vis ? r3(vis.point.y) : null, lidarTop: l.top, residual: rimY === null ? null : +(rimY - l.top).toFixed(2),
        radiusAt: +y.toFixed(1), modelRadius: r3(radius), lidarRadiusMid: l.midDiameter / 2, lidarRadiusRim: l.rimDiameter / 2 });
      if (rimY === null || Math.abs(rimY - l.top) > 0.3) failures.push(`chimney ${s.id} rim ${rimY} vs LiDAR top ${l.top}`);
      if (radius === null || radius < l.rimDiameter / 2 - 0.3 || radius > l.midDiameter / 2 + 0.3) failures.push(`chimney ${s.id} radius ${radius} outside LiDAR ${l.rimDiameter / 2}-${l.midDiameter / 2}`);
    }
    report.chimneys = rows;
  }

  // B8 power plant massing zones (generated context) vs LiDAR zone medians (derived/r2/zones.json, campus Y).
  {
    const ctxData = JSON.parse(readFileSync(resolve(process.cwd(), 'lib/campus/blocks/b03-gdc-speedway/context.json'), 'utf8'));
    const vol = (id: string, i: number) => ctxData.massing[id].volumes[i].ring as Pt[];
    const zones: [string, Pt, number, number][] = [ // name, probe, LiDAR campus Y, tolerance
      ['594130 hall crown', pole(vol('594130', 0)), 17.87, 1.0],
      ['594130 north wing', pole(vol('594130', 1)), 17.99, 1.0],
      ['594130 mechanical box', pole(vol('594130', 2)), 21.89, 1.0],
      ['613959 south block', pole(vol('613959', 1)), 12.09, 1.0],
      ['613959 hall west strip', [183.5, -75], 7.74, 1.0],
      ['613959 hall mid strip', [193.0, -90], 13.29, 1.0],
      ['613959 hall east strip', pole(vol('613959', 3)), 16.1, 1.0],
      ['698195 cooling-tower tier', pole(vol('698195', 1)), 25.81, 1.0],
      ['594130 tile band 1 m inside the west wall (reported)', [96.9, -85], 13.2, 99],
    ];
    const rows: unknown[] = [];
    for (const [name, [x, z], lidarY, tol] of zones) {
      const h = context?.solid ? firstHit([context.solid], x, z, 80) : null, y = h ? +h.point.y.toFixed(2) : null;
      const res = y === null ? null : +(y - lidarY).toFixed(2);
      rows.push({ zone: name, probe: [x, z].map(v => +v.toFixed(1)), modelY: y, lidarY, residual: res });
      if (tol < 99 && (res === null || Math.abs(res) > tol)) failures.push(`${name}: generated top ${y} vs LiDAR ${lidarY} (> ${tol} m)`);
    }
    report.powerPlantZones = rows;
    report.records = [549259, 613959, 698195, 594130].map(id => { const p = plans.find((q: { building: { id: number } }) => q.building.id === id); return { id, abbr: p.building.abbr, decision: p.decision, style: p.style ?? null, elevated: +p.elevatedFraction.toFixed(3), ground: +p.groundFraction.toFixed(3), perimeter: +p.perimeterFraction.toFixed(3) }; });
    for (const r of report.records as { id: number; decision: string }[]) if (r.decision !== 'generated') failures.push(`${r.id} decision ${r.decision}, expected generated`);
  }
  // ---------- Round 3 ----------
  const genTop = (x: number, z: number) => { const h = context?.solid ? firstHit([context.solid], x, z, 120) : null; return h ? +h.point.y.toFixed(2) : null; };
  // B9 official additions (context.json add[]): generated, top vs LiDAR deck (derived/r3/plant-official.json).
  {
    const ctxData = JSON.parse(readFileSync(resolve(process.cwd(), 'lib/campus/blocks/b03-gdc-speedway/context.json'), 'utf8'));
    const lidarDeck: Record<string, number> = { CT1: 4.41, CT2: 8.84, PA3: 0.34, PA4: 1.65, PA1: -0.72, PB2: -2.48 };
    const rows: unknown[] = [];
    for (const a of ctxData.add as { id: number; abbr: string; rings: Pt[][] }[]) {
      const plan = plans.find((p: { building: { id: number } }) => p.building.id === a.id);
      const [x, z] = pole(a.rings[0]), top = genTop(x, z), ly = lidarDeck[a.abbr], res = top === null ? null : +(top - ly).toFixed(2);
      rows.push({ id: a.id, abbr: a.abbr, decision: plan?.decision ?? 'missing', style: plan?.style ?? null, probe: [x, z], generatedTopCampusY: top, lidarCampusY: ly, residual: res, before: 'absent (no City record)' });
      if (!plan || plan.decision !== 'generated') failures.push(`added ${a.abbr} (${a.id}) decision ${plan?.decision ?? 'missing'}, expected generated`);
      else if (res === null || Math.abs(res) > 1.0) failures.push(`added ${a.abbr} top ${top} vs LiDAR ${ly} (> 1.0 m)`);
    }
    report.officialAdditions = rows;
  }
  // B10 remaining generated records: one probe per LiDAR tier (outside higher tiers), or the ring pole at P50.
  {
    const rows: unknown[] = [];
    for (const id of [732538, 549259, 633980, 463644, 502996, 656434, 699862]) {
      const l = roofs[String(id)], plan = plans.find((p: { building: { id: number } }) => p.building.id === id);
      if (!plan) { failures.push(`${id} has no plan`); continue; }
      const ring: Pt[] = plan.building.rings[0];
      const tiers = (l.tiers ?? []).filter(t => t.area >= 60);
      const probes: [string, Pt, number][] = tiers.length
        ? tiers.map(t => [`tier ${t.height}`, poleOutside(t.ring.filter(() => true), tiers.filter(u => u.height > t.height).map(u => u.ring)), l.groundY + t.height] as [string, Pt, number])
        : [['P50', pole(ring), l.groundY + l.heightP50]];
      for (const [name, [x, z], ly] of probes) {
        const inRing = pip(x, z, ring), top = inRing ? genTop(x, z) : null, res = top === null ? null : +(top - ly).toFixed(2);
        rows.push({ id, abbr: plan.building.abbr || null, decision: plan.decision, style: plan.style ?? null, probe: name, at: [x, z], inCityRing: inRing, generatedTopCampusY: top, lidarCampusY: +ly.toFixed(2), residual: res });
        if (plan.decision !== 'generated') failures.push(`${id} decision ${plan.decision}, expected generated`);
        else if (inRing && (res === null || Math.abs(res) > 1.0)) failures.push(`${id} ${name}: generated top ${top} vs LiDAR ${ly.toFixed(2)} (> 1.0 m)`);
      }
    }
    report.generatedRecordTiers = rows;
    const fit = resolve(process.cwd(), '../../../../ut/research/whole-campus-92/b03-gdc-speedway/derived/r3/towers-fit.json');
    if (existsSync(fit)) report.footprintFit = JSON.parse(readFileSync(fit, 'utf8')).fit;
  }
  // B11 fan shrouds: rim (own collider) vs LiDAR top; generated deck just outside the shroud vs the shroud base.
  {
    const rows: unknown[] = [];
    for (const f of FANS) {
      const [cx, cz] = f.centre, rim = ownY(cx + f.r - 0.06, cz, f.topY + 5, 10);
      let worstGap = -Infinity, deckHits = 0;
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, y = genTop(cx + Math.cos(a) * (f.r + 0.35), cz + Math.sin(a) * (f.r + 0.35)); if (y === null) continue; deckHits++; worstGap = Math.max(worstGap, (f.deckY - 0.05) - y); }
      rows.push({ tower: f.tower, centre: f.centre, basis: f.basis, rimOwnCollider: r3(rim), lidarTop: f.topY, deckY: f.deckY, deckHits, worstBaseAboveDeck: deckHits ? +worstGap.toFixed(3) : null });
      if (rim === null || Math.abs(rim - f.topY) > 0.1) failures.push(`fan ${f.tower} ${f.centre.join(",")} rim ${rim} vs ${f.topY}`);
      if (deckHits < 8) failures.push(`fan ${f.tower} ${f.centre.join(",")} overhangs the generated deck (${deckHits}/8 deck hits)`);
      else if (worstGap > 0.02) failures.push(`fan ${f.tower} ${f.centre.join(",")} floats ${worstGap.toFixed(3)} m above the generated deck`);
    }
    report.coolingFans = rows;
  }
  // B12 (district round, D04/D05) stall paint on the b03 asphalt and textured finishes on the chimneys / fan shrouds.
  {
    const paint = ((entry.install.walkable ?? []) as THREE.Mesh[]).find(m => m.userData.paint);
    const p12: Record<string, unknown> = { stats: scene.blocks.stats['b03-gdc-speedway']?.stallPaint ?? null };
    if (!paint) failures.push('Speedway north stall paint missing');
    else {
      const pos = paint.geometry.getAttribute('position') as THREE.BufferAttribute; let lo = Infinity, hi = -Infinity, miss = 0, outside = 0;
      const line = speedwayNorthCentre(scene.world.data ?? JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/campus.json'), 'utf8')));
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), g = ownY(x, z, y + 0.3, 0.6);
        if (g === null) { miss++; continue; } const d = y - g; lo = Math.min(lo, d); hi = Math.max(hi, d);
        let best = Infinity; for (let k = 0; k + 1 < line.length; k++) best = Math.min(best, segDist(x, z, line[k][0], line[k][1], line[k + 1][0], line[k + 1][1]));
        if (best > HALF_WIDTH + 0.02) outside++;
      }
      const sep = (p12.stats as { separators?: number[] } | null)?.separators ?? [];
      Object.assign(p12, { vertices: pos.count, liftMin: +lo.toFixed(4), liftMax: +hi.toFixed(4), notOverOwnAsphalt: miss, outsideBuiltStrip: outside, separators: sep.length,
        b03Colliders: entry.install.colliders.length });
      if (miss || outside) failures.push(`stall paint: ${miss} vertices not over the b03 asphalt, ${outside} outside the 9.144 m strip`);
      if (!(lo >= 0.004 && hi <= 0.012)) failures.push(`stall paint lift ${lo.toFixed(4)}..${hi.toFixed(4)} m above the own asphalt collider (0.008 expected)`);
      if (sep.length !== 14) failures.push(`stall separators ${sep.length} (14 observed)`);
    }
    report.stallPaint = p12;
    const rows: unknown[] = []; const ua = new THREE.Vector2(), ub = new THREE.Vector2(), uc = new THREE.Vector2();
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    for (const m of (entry.install.solids ?? []) as THREE.Mesh[]) {
      const mat = m.material as THREE.Material, pos = m.geometry.getAttribute('position') as THREE.BufferAttribute, uv = m.geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
      if (!mat.userData?.family || !uv) { failures.push(`${m.name}: no textured family / metre uv`); continue; }
      const ratios: { r: number; w: number }[] = [];
      for (let i = 0; i + 2 < pos.count; i += 3) {
        va.fromBufferAttribute(pos, i); vb.fromBufferAttribute(pos, i + 1); vc.fromBufferAttribute(pos, i + 2);
        const wa = new THREE.Triangle(va, vb, vc).getArea(); if (wa < 1e-4) continue;
        ua.fromBufferAttribute(uv, i); ub.fromBufferAttribute(uv, i + 1); uc.fromBufferAttribute(uv, i + 2);
        ratios.push({ r: Math.abs((ub.x - ua.x) * (uc.y - ua.y) - (uc.x - ua.x) * (ub.y - ua.y)) / 2 / wa, w: wa });
      }
      ratios.sort((p, q) => p.r - q.r); const tot = ratios.reduce((s, x) => s + x.w, 0); let acc = 0, med = NaN;
      for (const x of ratios) { acc += x.w; if (acc >= tot / 2) { med = x.r; break; } }
      rows.push({ mesh: m.name, material: mat.name, family: mat.userData.family, tileM: mat.userData.tileM, textured: mat.userData.textured, triangles: pos.count / 3, uvAreaRatioMedian: +med.toFixed(3) });
      if (!(med >= 0.95 && med <= 1.05)) failures.push(`${m.name}: uv area ratio ${med} (metre UVs expected)`);
    }
    report.texturedFinishes = rows;
  }
  return { ok: failures.length === 0, report, failures };
};
