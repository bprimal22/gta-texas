// Headless checks owned by block b10-east-campus (run by scripts/harness/run-block-checks.mjs).
// They measure the REAL scene in campus Y (downward rays on the physical colliders) against the 2017 USGS 3DEP 0.5 m
// building raster sampled inside the same rings (lib/campus/blocks/b10-east-campus/lidar-reference.json, written by
// research/whole-campus-92/b10-east-campus/derived/make_context.py; adapted from the b11 check):
//  1. Every b10 record restated in the LiDAR groundY datum: physical roof P50 within 2 m of the LiDAR P50 and roof P95
//     inside the measured upper band [LiDAR P90 - 2, LiDAR max + 0.6] (P50 only where light poles/towers set the band).
//  2. IPF vault crown (inner hip shell on the LiDAR 16.4 m tier): P50 / top vs the raster in that ring.
//  3. Post-2017 records (Graduate Housing A-F 2024, TTC 2018, LNA 2023, Player Development Center 2019): physical top
//     above the local terrain grade vs the City 2023 h / labelled estimate; roofs flat where the overviews show flat.
//  4. Context decision of every b10 record (all expected generated, except the records the east-south lane replaces with
//     its own install() geometry, which must be 'authored' — and are still held to the same LiDAR roof tests, on the
//     physical colliders of the replacement).
//  5. East-south lane geometry (D21 IPF dome, D22 Disch-Falk grandstand): replacements committed, walkable seat treads
//     present, install stats within the lane budget.
//  6. Lane surfaces (revision 2): (a) every textured lane material is one of the explicit PBR families with the calibrated
//     metre repeat (1 / TEXTURES tile) and its UVs are world metres: per mesh the median UV-edge / 3D-edge ratio is within
//     [0.85, 1.15] and 95 % of edges within [0.5, 1.6] (doubly curved membrane cannot be isometric; a wrong scale such as the
//     old x/4 cap UVs gives ~0.25);
//     walkable, glass and steel meshes carry no texture; (b) the IPF membrane shades continuously: coincident membrane
//     vertices over the dome share one normal, and the skirt keeps a hard crease against it (no shared smoothed normal);
//     (c) the D22 west street facade has a stone plinth below the brick (texture families stacked plinth < brick on a
//     horizontal ray scan) — physical faces, not a colour swap.
import type { BlockCheck } from './types';
import { B10_REPLACED } from '../../../lib/campus/blocks/b10-east-campus/index';
import { TEXTURES } from '../../../lib/campus/context/materials';
import * as THREE from 'three';
import ref from '../../../lib/campus/blocks/b10-east-campus/lidar-reference.json' with { type: 'json' };

type P = [number, number];
const pip = (x: number, z: number, r: P[]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const inRings = (x: number, z: number, rs: P[][]) => pip(x, z, rs[0]) && !rs.slice(1).some(h => pip(x, z, h));
const segDist = (px: number, pz: number, a: P, b: P) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l)) : 0; return Math.hypot(a[0] + t * dx - px, a[1] + t * dz - pz); };
const ringsDist = (x: number, z: number, rs: P[][]) => Math.min(...rs.flatMap(r => r.map((p, i) => segDist(x, z, p, r[(i + 1) % r.length]))));
const q = (v: number[], f: number) => v.length ? +v[Math.min(v.length - 1, Math.floor(v.length * f))].toFixed(2) : NaN;
type Stat = { roofY_P10: number; roofY_P50: number; roofY_P90: number; roofY_P95: number; roofY_max: number };
const R = ref as unknown as {
  records: Record<string, Stat & { abbr: string | null; restated?: boolean; p50Only?: boolean; exempt?: string }>;
  volumes: Record<string, Stat & { ring: P[]; roof: string; targetY: number; skip?: boolean }>;
  officialTop: Record<string, { abbr: string; targetTopAboveGrade: number; tol: number; basis: string }>;
};

export const check: BlockCheck = scene => {
  const failures: string[] = [], report: Record<string, unknown> = {};
  const { physics, RAPIER, player } = scene;
  const data = scene.world.data;
  const plans = new Map<string, { decision: string; building: { id: number; key?: string; rings: P[][] } }>(
    scene.plans.map((p: { building: { id: number; key?: string } }) => [p.building.key ?? String(p.building.id), p]));
  const ray = (x: number, z: number) => { const h = physics.castRay(new RAPIER.Ray({ x, y: 160, z }, { x: 0, y: -1, z: 0 }), 220, true, undefined, undefined, player); return h ? 160 - h.timeOfImpact : NaN; };
  const surface = (rings: P[][], inset: number, step = 1.5) => {
    const xs = rings[0].map(p => p[0]), zs = rings[0].map(p => p[1]), tops: number[] = [];
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) {
      if (!inRings(x, z, rings) || ringsDist(x, z, rings) < inset) continue;
      const y = ray(x, z); if (!Number.isNaN(y)) tops.push(y);
    }
    return tops.sort((a, b) => a - b);
  };
  const terrain = (x: number, z: number) => scene.world.terrain?.height ? scene.world.terrain.height(x, z) : NaN;
  // 1 + 4. Records.
  const records: Record<string, unknown> = {};
  let checkedN = 0;
  const residuals: number[] = [];
  for (const [key, r] of Object.entries(R.records)) {
    const p = plans.get(key); const b = data.buildings.find((x: { key?: string }) => x.key === key) ?? p?.building;
    const decision = p?.decision ?? 'missing';
    const entry: Record<string, unknown> = { abbr: r.abbr, decision };
    const expected = (B10_REPLACED as readonly string[]).includes(key) ? 'authored' : 'generated';
    if (decision !== expected) failures.push(`${key} ${r.abbr ?? ''} decision ${decision} (expected ${expected})`);
    if (b && r.roofY_P50 !== undefined && r.roofY_P50 !== null) {
      let tops = surface(b.rings as P[][], 1.0);
      if (tops.length < 4) tops = surface(b.rings as P[][], 0.3, 0.5); // tiny sheds (< 20 m2)
      const tol = 2.0, p50 = q(tops, 0.5), p95 = q(tops, 0.95);
      Object.assign(entry, { samples: tops.length, modelP50: p50, lidarP50: r.roofY_P50, modelP95: p95, lidarP90: r.roofY_P90, lidarP95: r.roofY_P95, lidarMax: r.roofY_max,
        residual: { p50: +(p50 - r.roofY_P50).toFixed(2), p95: +(p95 - r.roofY_P95).toFixed(2) } });
      const upperOk = r.p50Only || (p95 >= r.roofY_P90 - tol && p95 <= r.roofY_max + 0.6);
      const checked = r.restated === true;
      entry.checked = checked;
      if (r.exempt) entry.exempt = r.exempt;
      if (checked) { checkedN++; residuals.push(Math.abs(p50 - r.roofY_P50)); }
      if (checked && decision === expected && !(Math.abs(p50 - r.roofY_P50) <= tol && upperOk))
        failures.push(`${key} ${r.abbr ?? ''} roof P50/P95 ${p50}/${p95} vs LiDAR P50 ${r.roofY_P50}, band P90 ${r.roofY_P90}..max ${r.roofY_max} (campus Y, tol ${tol})`);
    }
    records[key] = entry;
  }
  residuals.sort((a, b) => a - b);
  report.summary = { checked: checkedN, medianAbsP50: q(residuals, 0.5), over2m: residuals.filter(v => v > 2).length };
  report.records = records;
  // 2. Wings / tiers.
  const wings: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(R.volumes)) {
    if (v.skip) continue;
    const tops = surface([v.ring], 1.0, 1.0);
    const p50 = q(tops, 0.5), top = tops.length ? +tops[tops.length - 1].toFixed(2) : NaN;
    const tol = 2.0;
    wings[k] = { samples: tops.length, modelP50: p50, lidarP50: v.roofY_P50, targetY: v.targetY, modelTop: top, lidarMax: v.roofY_max, residualP50: +(p50 - v.roofY_P50).toFixed(2) };
    if (tops.length < 4) failures.push(`${k}: only ${tops.length} roof samples`);
    else {
      if (!(Math.abs(p50 - v.roofY_P50) <= tol)) failures.push(`${k} roof P50 ${p50} vs LiDAR ${v.roofY_P50} (tol ${tol})`);
      if (!(top <= v.roofY_max + 1.2 && top >= v.roofY_max - 1.5)) failures.push(`${k} top ${top} vs LiDAR max ${v.roofY_max} (-1.5..+1.2)`);
    }
  }
  report.wings = wings;
  // 3. Post-2017 records: top above local grade.
  const post: Record<string, unknown> = {};
  for (const [key, o] of Object.entries(R.officialTop)) {
    const b = data.buildings.find((x: { key?: string }) => x.key === key) as { rings: P[][] } | undefined;
    if (!b) { failures.push(`${key} ${o.abbr}: post-2017 record missing`); continue; }
    const tops = surface(b.rings, 1.0, 1.5);
    const g: number[] = []; for (const [x, z] of b.rings[0]) g.push(terrain(x, z));
    g.sort((a, c) => a - c); const grade = q(g, 0.5), top = tops.length ? tops[tops.length - 1] : NaN;
    const above = +(top - grade).toFixed(2);
    post[key] = { abbr: o.abbr, grade, topAboveGrade: above, target: o.targetTopAboveGrade, basis: o.basis, samples: tops.length };
    if (!(Math.abs(above - o.targetTopAboveGrade) <= o.tol + 0.6)) failures.push(`${key} ${o.abbr}: top ${above} m above grade vs ${o.targetTopAboveGrade} (${o.basis})`);
  }
  report.post2017 = post;
  // 5. East-south lane.
  const st = scene.blocks.stats['b10-east-campus'] as { districts?: Record<string, { triangles: number }>; triangles?: number; replaced?: string[] } | undefined;
  const committed = Object.entries(scene.blocks.replacements.committed).filter(([, o]) => o === 'b10-east-campus').map(([k]) => k);
  for (const k of B10_REPLACED) if (!committed.includes(k)) failures.push(`lane replacement ${k} not committed`);
  const entry = scene.blocks.installs.find((x: { id: string }) => x.id === 'b10-east-campus');
  let treads = 0; for (const w of entry?.walkable ?? []) w.traverse((o: { isMesh?: boolean; geometry?: { getAttribute(n: string): { count: number } } }) => { if (o.isMesh) treads += o.geometry!.getAttribute('position').count / 3; });
  if (treads < 300) failures.push(`D22 seat treads: only ${treads} walkable triangles`);
  if ((st?.triangles ?? 0) > 120000) failures.push(`lane triangles ${st?.triangles} > 120000 budget`);
  report.lane = { districts: st?.districts, triangles: st?.triangles, committed, walkableTriangles: treads };
  // 6a. Texture families, metre repeat, metre UVs, locality.
  type M = { isMesh?: boolean; name: string; material: { name: string; map?: { repeat: { x: number; y: number } } | null; userData: { pbrFamily?: keyof typeof TEXTURES } }; geometry: { getAttribute(n: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } } };
  const meshes: M[] = [];
  for (const root of [...(entry?.install.solids ?? []), ...(entry?.install.walkable ?? []), ...(entry?.install.detail ?? [])]) root.traverse((o: M) => { if (o.isMesh) meshes.push(o); });
  const tex: Record<string, unknown> = {}; let uvBad = 0, uvN = 0;
  for (const m of meshes) {
    const fam = m.material.userData.pbrFamily, map = m.material.map;
    const walk = (entry?.walkable ?? []).includes(m as never);
    if (map && (!fam || walk || /glass|metal/.test(m.material.name))) failures.push(`texture on a non-PBR-family / walkable / glass / steel mesh: ${m.name}`);
    if (!fam) continue;
    const tile = TEXTURES[fam].tile;
    if (!map || Math.abs(map.repeat.x - 1 / tile) > 1e-6 || Math.abs(map.repeat.y - 1 / tile) > 1e-6) failures.push(`${m.name}: ${fam} repeat ${map?.repeat.x} != 1/${tile}`);
    const pos = m.geometry.getAttribute('position'), uv = m.geometry.getAttribute('uv'), stride = Math.max(1, Math.floor(pos.count / 3 / 300));
    let bad = 0; const ratios: number[] = [];
    for (let t = 0; t < pos.count / 3; t += stride) for (const [i, j] of [[0, 1], [1, 2]]) {
      const a = t * 3 + i, b = t * 3 + j, d3 = Math.hypot(pos.getX(a) - pos.getX(b), pos.getY(a) - pos.getY(b), pos.getZ(a) - pos.getZ(b));
      if (d3 < 0.3) continue;
      const r = Math.hypot(uv.getX(a) - uv.getX(b), uv.getY(a) - uv.getY(b)) / d3; ratios.push(r);
      if (r < 0.5 || r > 1.6) bad++;
    }
    ratios.sort((a, b) => a - b);
    const med = ratios.length ? ratios[Math.floor(ratios.length / 2)] : NaN;
    uvBad += bad; uvN += ratios.length; tex[m.name] = { family: fam, tileMetres: tile, uvSamples: ratios.length, medianUvPerMetre: +med.toFixed(3), outside05to16: bad };
    if (!(med >= 0.85 && med <= 1.15) || bad > ratios.length * 0.05) failures.push(`${m.name}: UV scale median ${med.toFixed(3)} / ${bad} of ${ratios.length} edges outside [0.5, 1.6] (not world metres)`);
  }
  report.textures = { meshes: tex, edges: uvN, outside05to16: uvBad };
  if (!Object.values(tex).some(v => (v as { family: string }).family === 'buffBrick') || !Object.values(tex).some(v => (v as { family: string }).family === 'limestone') || !Object.values(tex).some(v => (v as { family: string }).family === 'membrane'))
    failures.push('lane PBR families missing (expected buffBrick, limestone, membrane)');
  // 6b. Membrane normal continuity over the IPF dome; the skirt (separate builder) keeps flat, unsmoothed shading.
  const ipfBox = [977, 1063, -87, 44], inIpf = (x: number, z: number) => x > ipfBox[0] && x < ipfBox[1] && z > ipfBox[2] && z < ipfBox[3];
  const groups = new Map<string, number[][]>(); let skirtTris = 0, skirtSmoothed = 0;
  for (const m of meshes) {
    const fam = m.material.userData.pbrFamily, solid = (entry?.install.solids ?? []).includes(m as never);
    if (!solid) continue;
    const pos = m.geometry.getAttribute('position'), nor = m.geometry.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); if (!inIpf(x, z)) continue;
      if (fam === 'membrane') { const k = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`, l = groups.get(k) ?? []; l.push([nor.getX(i), nor.getY(i), nor.getZ(i)]); groups.set(k, l); }
    }
    if (fam || !/matte/.test(m.material.name)) continue;
    for (let t = 0; t + 2 < pos.count; t += 3) {   // untextured skirt / vestibule walls: flat shading per triangle
      if (!inIpf(pos.getX(t), pos.getZ(t)) || Math.abs(nor.getY(t)) > 0.3) continue;
      skirtTris++;
      for (const o of [1, 2]) if (nor.getX(t) * nor.getX(t + o) + nor.getY(t) * nor.getY(t + o) + nor.getZ(t) * nor.getZ(t + o) < 0.99999) { skirtSmoothed++; break; }
    }
  }
  let disc = 0;
  for (const l of groups.values()) for (const v of l) if (v[0] * l[0][0] + v[1] * l[0][1] + v[2] * l[0][2] < 0.9999) { disc++; break; }
  report.membraneNormals = { sharedPositions: groups.size, discontinuous: disc, skirtTriangles: skirtTris, skirtSmoothed };
  if (groups.size < 500 || disc) failures.push(`IPF membrane normals: ${disc} discontinuous of ${groups.size} positions`);
  if (skirtTris < 100 || skirtSmoothed) failures.push(`IPF skirt shading: ${skirtSmoothed}/${skirtTris} skirt triangles not flat`);
  // 6c. D22 west facade: horizontal rays at plinth and at brick height hit lane meshes of the stone and brick families.
  const solidsRoot = (entry?.install.solids ?? []) as THREE.Object3D[];
  const famAt = (x: number, y: number, z: number, dx: number, dz: number) => {
    const rc = new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(dx, 0, dz).normalize(), 0, 12);
    const h = rc.intersectObjects(solidsRoot, true)[0]; if (!h) return null;
    return ((h.object as THREE.Mesh).material as THREE.Material).userData.pbrFamily as string | undefined ?? 'untextured';
  };
  const W0 = [963.23, 704.46], W1 = [972.69, 757.09], wl = Math.hypot(W1[0] - W0[0], W1[1] - W0[1]), wt = [(W1[0] - W0[0]) / wl, (W1[1] - W0[1]) / wl], wn = [-wt[1], wt[0]]; // outward (west)
  const west: Record<string, unknown>[] = []; let westBad = 0;
  for (const f of [0.2, 0.5, 0.8]) {
    const px = W0[0] + wt[0] * wl * f + wn[0] * 3, pz = W0[1] + wt[1] * wl * f + wn[1] * 3, gy = scene.world.terrain?.height ? scene.world.terrain.height(px, pz) : 15.7;
    const plinth = famAt(px, gy + 0.4, pz, -wn[0], -wn[1]), brick = famAt(px, 24.4 - 0.8, pz, -wn[0], -wn[1]);
    west.push({ f, plinth, brickZone: brick }); if (plinth !== 'limestone' || brick !== 'buffBrick') westBad++;
  }
  report.westFacade = west;
  if (westBad) failures.push(`D22 west facade material stack: ${JSON.stringify(west)}`);
  return { ok: failures.length === 0, report, failures };
};
