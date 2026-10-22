// Headless checks owned by block b07-wcp-gregory (run by scripts/harness/run-block-checks.mjs).
// They measure the REAL scene in campus Y against the 2017 USGS LiDAR raster sampled inside the same rings
// (lib/campus/blocks/b07-wcp-gregory/lidar-reference.json):
//  1. Every b07 generated record: physical roof surface (downward rays on all colliders, 2 m grid, 1 m inset)
//     P50/P95 vs the LiDAR building-return P50/P95 in the same ring (context.json massing uses the LiDAR groundY datum).
//  2. WCP/RLP authored masses (east-south-modern.ts): physical roof P50 per mass vs LiDAR P50; ridge/top <= LiDAR max.
//  3. Context decisions of all 17 records (route/authored suppressions reported with what covers them).
//  4. Route clearance: standing capsules on the Gregory plaza / WCP south paving are free of solids, and the open
//     WCP-RLP passage (GIS ring part x120-134) stays walkable.
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BlockCheck } from './types';
import { PHD, PHD_GIS } from '../../../lib/campus/blocks/b07-wcp-gregory/d14';
import ref from '../../../lib/campus/blocks/b07-wcp-gregory/lidar-reference.json' with { type: 'json' };
import plan from '../../../public/data/east-south-modern-plan.json' with { type: 'json' };

type P = [number, number];
const pip = (x: number, z: number, r: P[]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const segDist = (px: number, pz: number, a: P, b: P) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l)) : 0; return Math.hypot(a[0] + t * dx - px, a[1] + t * dz - pz); };
const ringDist = (x: number, z: number, r: P[]) => Math.min(...r.map((p, i) => segDist(x, z, p, r[(i + 1) % r.length])));
const q = (v: number[], f: number) => v.length ? +v[Math.min(v.length - 1, Math.floor(v.length * f))].toFixed(2) : NaN;
/** Tolerances (m): generated volumes are LiDAR tier outlines simplified by the generator; hipped forms are approximations. */
const TOL: Record<string, number> = { default: 2.0, hipped: 2.0 };
/** Round 2: records whose generated body the b07 install replaces (D14 Prather). Same height assertions, measured on the
 * physical scene; only the expected decision changes to 'authored'. */
const AUTHORED_R2 = new Set(['719550:1193']);

export const check: BlockCheck = scene => {
  const failures: string[] = [], report: Record<string, unknown> = {};
  const { physics, RAPIER, player } = scene;
  const data = scene.world.data;
  const plans = new Map<string, { decision: string; building: { id: number; key?: string; rings: P[][] }; spec?: { roof: string } }>(
    scene.plans.map((p: { building: { id: number; key?: string } }) => [p.building.key ?? String(p.building.id), p]));
  const surface = (ring: P[], inset: number, step = 2) => {
    const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]), tops: number[] = [];
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) {
      if (!pip(x, z, ring) || ringDist(x, z, ring) < inset) continue;
      const h = physics.castRay(new RAPIER.Ray({ x, y: 150, z }, { x: 0, y: -1, z: 0 }), 200, true, undefined, undefined, player);
      // Ignore terrain/ground hits (courtyards): the harness now has the game's terrain colliders (integrator).
      if (h && 150 - h.timeOfImpact > scene.ground.height(x, z) + 0.5) tops.push(150 - h.timeOfImpact);
    }
    return tops.sort((a, b) => a - b);
  };
  // 1+3. Records.
  const records: Record<string, unknown> = {};
  for (const [key, r] of Object.entries(ref.records)) {
    const p = plans.get(key); const b = data.buildings.find((x: { key?: string }) => x.key === key) ?? p?.building;
    const decision = p?.decision ?? 'missing';
    const entry: Record<string, unknown> = { abbr: r.abbr, decision };
    if ((decision === 'generated' || (AUTHORED_R2.has(key) && decision === 'authored')) && b) {
      const tops = surface(b.rings[0] as P[], 1.0);
      const hipped = AUTHORED_R2.has(key) || (!!p?.spec && p.spec.roof !== 'flat');
      const tol = hipped ? TOL.hipped : TOL.default;
      Object.assign(entry, { samples: tops.length, modelP50: q(tops, 0.5), lidarP50: r.roofY_P50, modelP95: q(tops, 0.95), lidarP90: r.roofY_P90, lidarP95: r.roofY_P95, lidarMax: r.roofY_max, tol });
      const d50 = q(tops, 0.5) - r.roofY_P50, d95 = q(tops, 0.95) - r.roofY_P95;
      entry.residual = { p50: +d50.toFixed(2), p95: +d95.toFixed(2) };
      // Median within tol; the top of the rendered roof (P95) inside the measured upper band [LiDAR P90 - tol, LiDAR max + 0.5]
      // (raster P95 also contains small penthouses/parapets the generator keeps as tier medians).
      const p95 = q(tops, 0.95), upperOk = p95 >= r.roofY_P90 - tol && p95 <= r.roofY_max + 0.5;
      if (!(Math.abs(d50) <= tol && upperOk)) failures.push(`${key} ${r.abbr} roof P50/P95 ${q(tops, 0.5)}/${p95} vs LiDAR P50 ${r.roofY_P50}, band P90 ${r.roofY_P90}..max ${r.roofY_max} (campus Y, tol ${tol})`);
    }
    records[key] = entry;
  }
  report.records = records;
  // Expected decisions: WCP+RLP union authored (east-south-modern), GRP restored (paving cut, LiDAR massing), rest generated.
  for (const [key, r] of Object.entries(ref.records)) {
    const d = (records[key] as { decision: string }).decision;
    const want = key === '507336:222' || key === '716175:1135' || AUTHORED_R2.has(key) ? 'authored' : 'generated';
    if (d !== want) failures.push(`${key} ${r.abbr} decision ${d} (expected ${want})`);
  }
  // 2. Authored WCP/RLP masses.
  const masses: Record<string, unknown> = {};
  for (const b of (plan as unknown as { buildings: { abbr: string; masses: { name: string; rings: P[][]; top?: number; roofRise?: number }[] }[] }).buildings) for (const m of b.masses) {
    const k = `${b.abbr}:${m.name}`, r = (ref.masses as Record<string, { roofY_P50: number; roofY_max: number }>)[k];
    const tops = surface(m.rings[0], 1.5, 1.5);
    const top = tops.length ? tops[tops.length - 1] : NaN;
    masses[k] = { samples: tops.length, modelP50: q(tops, 0.5), lidarP50: r.roofY_P50, modelTop: +top.toFixed(2), lidarMax: r.roofY_max, planTop: m.top, ridge: m.roofRise ? +(m.top! + 0.12 + m.roofRise).toFixed(2) : undefined };
    if (!(Math.abs(q(tops, 0.5) - r.roofY_P50) <= 1.5)) failures.push(`${k} roof P50 ${q(tops, 0.5)} vs LiDAR ${r.roofY_P50}`);
    if (!(top <= r.roofY_max + 1.0)) failures.push(`${k} top ${top.toFixed(2)} above LiDAR max ${r.roofY_max} + 1.0`);
  }
  report.wcpRlpMasses = masses;
  // 4. Standing capsules on routes next to the raised WCP masses (Gregory plaza north edge, WCP-RLP passage).
  const shape = new RAPIER.Capsule(0.5, 0.3); const blocked: number[][] = []; let tested = 0;
  const probes: P[] = [];
  for (let x = 40; x <= 116; x += 4) probes.push([x, 177.5]);         // Gregory plaza / WCP south frontage
  for (let z = 100; z <= 130; z += 3) probes.push([129.0, z]);        // open WCP-RLP passage
  for (const [x, z] of probes) {
    const h = physics.castRay(new RAPIER.Ray({ x, y: 60, z }, { x: 0, y: -1, z: 0 }), 80, true, undefined, undefined, player);
    if (!h) continue; const y = 60 - h.timeOfImpact; if (y > 6) continue; tested++;
    let bad = false;
    physics.intersectionsWithShape({ x, y: y + 1.1, z }, { x: 0, y: 0, z: 0, w: 1 }, shape, () => { bad = true; return false; }, undefined, undefined, player);
    if (bad) blocked.push([x, +y.toFixed(2), z]);
  }
  report.routeCapsules = { tested, blocked };
  if (blocked.length) failures.push(`route capsules blocked at ${JSON.stringify(blocked)}`);
  if (tested < 15) failures.push(`only ${tested} route capsules found ground`);
  // GRP: what authored walkable covers its footprint (why it stays suppressed).
  const grp = (data.buildings.find((x: { key?: string }) => x.key === '716175:1135')?.rings[0] ?? []) as P[];
  const covering = new Set<string>();
  scene.walkway.surfaces.traverse((o: { isMesh?: boolean; name: string; geometry: { getAttribute: (n: string) => { count: number; getX: (i: number) => number; getZ: (i: number) => number } }; matrixWorld: unknown }) => {
    if (!o.isMesh) return; const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 3) if (grp.length && pip(pos.getX(i), pos.getZ(i), grp) && ringDist(pos.getX(i), pos.getZ(i), grp) > 0.5) { covering.add(o.name || '(unnamed)'); break; }
  });
  report.grpCoveredBy = [...covering];
  if (covering.size) failures.push(`GRP footprint still covered by walkable ${[...covering].join(', ')}`);
  // 5. GRP body (b07 install): committed replacement, rendered roof vs LiDAR, walls inside the GIS ring.
  const inst = scene.blocks.installs.find((x: { id: string }) => x.id === 'b07-wcp-gregory')?.install;
  const committed = Object.entries((scene.blocks.replacements?.committed ?? {}) as Record<string, string>).filter(([, o]) => o === 'b07-wcp-gregory').map(([k]) => k);
  if (!committed.includes('716175:1135')) failures.push('GRP replacement 716175:1135 not committed');
  if (!inst) failures.push('b07 install missing');
  else {
    const own = new Set(inst.colliders.map((k: { handle: number }) => k.handle));
    const tops: number[] = [];
    for (let x = 117; x <= 128; x += 0.5) for (let z = 174; z <= 189.5; z += 0.5) {
      if (!pip(x, z, grp) || ringDist(x, z, grp) < 0.6) continue;
      const h = physics.castRay(new RAPIER.Ray({ x, y: 40, z }, { x: 0, y: -1, z: 0 }), 60, true, undefined, undefined, player, undefined, (k: { handle: number }) => own.has(k.handle));
      if (h) tops.push(40 - h.timeOfImpact);
    }
    tops.sort((a, b) => a - b);
    const L = (ref.records as Record<string, { roofY_P50: number; roofY_max: number }>)['716175:1135'];
    const outside: number[][] = [];
    for (const s of inst.solids as { geometry: { getAttribute: (n: string) => { count: number; getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number } }; name: string }[]) {
      if (!/masonry/.test(s.name)) continue; const p = s.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) if (!pip(p.getX(i), p.getZ(i), grp)) outside.push([p.getX(i), p.getZ(i)]);
    }
    report.grp = { samples: tops.length, modelP50: q(tops, 0.5), lidarP50: L.roofY_P50, modelTop: tops.length ? +tops[tops.length - 1].toFixed(2) : null, lidarMax: L.roofY_max, wallVerticesOutsideGis: outside.length };
    if (!(Math.abs(q(tops, 0.5) - L.roofY_P50) <= 0.5)) failures.push(`GRP roof P50 ${q(tops, 0.5)} vs LiDAR ${L.roofY_P50}`);
    if (!(tops[tops.length - 1] <= L.roofY_max + 0.05)) failures.push(`GRP top above LiDAR max ${L.roofY_max}`);
    if (outside.length) failures.push(`${outside.length} GRP wall vertices outside the GIS ring`);
  }
  // 6. Round 2 (D13/D14 district work). Expected values recomputed here from the published spec numbers / data.
  {
    const r2: Record<string, unknown> = {};
    const own = new Set((inst?.colliders ?? []).map((k: { handle: number }) => k.handle));
    const ownTop = (x: number, z: number, from: number) => { const h = physics.castRay(new RAPIER.Ray({ x, y: from, z }, { x: 0, y: -1, z: 0 }), 80, true, undefined, undefined, player, undefined, (k: { handle: number }) => own.has(k.handle)); return h ? from - h.timeOfImpact : null; };
    const meshes: THREE.Mesh[] = []; for (const o of (inst?.solids ?? []) as THREE.Object3D[]) o.traverse(q => { const m = q as THREE.Mesh; if (m.isMesh) meshes.push(m); });
    const detailMeshes: THREE.Mesh[] = []; for (const o of (inst?.detail ?? []) as THREE.Object3D[]) o.traverse(q => { const m = q as THREE.Mesh; if (m.isMesh) detailMeshes.push(m); });
    // (a) Prather roofs: per source, the lower envelope of the planes of its convex plane ring (minus noPlane edges),
    // valid over its convex pieces' eave outlines (exterior edges pushed out by the overhang); flat link deck.
    const lineSet = (ring: P[]) => ring.map((a, i) => { const b2 = ring[(i + 1) % ring.length], dx = b2[0] - a[0], dz = b2[1] - a[1], l = Math.hypot(dx, dz); let nx = dz / l, nz = -dx / l;
      if (pip((a[0] + b2[0]) / 2 + nx * 0.05, (a[1] + b2[1]) / 2 + nz * 0.05, ring)) { nx = -nx; nz = -nz; } return { a, nx, nz }; });
    const inward = (L: { a: P; nx: number; nz: number }, x: number, z: number) => -((x - L.a[0]) * L.nx + (z - L.a[1]) * L.nz);
    const sources = PHD.sources.map(src => {
      const planes = lineSet(src.planeRing as P[]).filter((_, i) => !src.noPlane.includes(i));
      const field = (x: number, z: number) => Math.min(...planes.map(L => src.wallY + PHD.slope * inward(L, x, z)));
      const eaves = src.pieces.map(pc => { const ls = lineSet(pc.ring as P[]); return (x: number, z: number) => ls.every((L, i) => inward(L, x, z) + (pc.interior.includes(i) ? 0 : PHD.overhang) >= -1e-3); });
      const pieceRings = src.pieces.map(pc => pc.ring as P[]);
      return { name: src.name, field, inEave: (x: number, z: number) => eaves.some(e => e(x, z)), inPiece: (x: number, z: number) => pieceRings.some(r => pip(x, z, r)) };
    });
    const link = PHD.link.ring as P[];
    {
      const tiles = meshes.filter(m => m.name === 'b07 Prather tile');
      let nv = 0, worst = 0; const worstEx: unknown[] = [];
      for (const m of tiles) { const pos = m.geometry.getAttribute('position'); for (let t = 0; t < pos.count; t += 3) {
        const pts = [0, 1, 2].map(k => [pos.getX(t + k), pos.getY(t + k), pos.getZ(t + k)]); pts.push([0, 1, 2].map(c => (pts[0][c] + pts[1][c] + pts[2][c]) / 3));
        for (const [x, y, z] of pts) { nv++; const e = Math.min(...sources.filter(q => q.inEave(x, z)).map(q => Math.abs(y - q.field(x, z)))); const ee = Number.isFinite(e) ? e : 99; if (ee > 0.001 && worstEx.length < 4) worstEx.push([+x.toFixed(3), +y.toFixed(3), +z.toFixed(3), +ee.toFixed(4)]); worst = Math.max(worst, ee); }
      } }
      const xs = PHD_GIS.map(q => q[0]), zs = PHD_GIS.map(q => q[1]); let pn = 0, pbad = 0, pworst = 0;
      for (let x = Math.min(...xs) + 0.4; x < Math.max(...xs); x += 0.9) for (let z = Math.min(...zs) + 0.4; z < Math.max(...zs); z += 0.9) {
        const inL = pip(x, z, link), hits = sources.filter(q => q.inEave(x, z));
        if (!inL && !sources.some(q => q.inPiece(x, z))) continue;
        const want = Math.max(...hits.map(q => q.field(x, z)), inL ? PHD.link.deckY : -Infinity), y = ownTop(x, z, want + 4); pn++;
        const e = y === null ? 99 : Math.abs(y - want); pworst = Math.max(pworst, e); if (e > 0.01) pbad++;
      }
      r2.pratherRoofFacets = { examples: worstEx, tileMeshes: tiles.length, verticesAndCentroids: nv, worstMm: +(worst * 1000).toFixed(3), physicalSamples: pn, physicalOver1cm: pbad, physicalWorstMm: +(pworst * 1000).toFixed(2) };
      if (!tiles.length || nv < 30 || worst > 0.001) failures.push(`Prather roof facets: ${nv} samples, worst ${(worst * 1000).toFixed(3)} mm off the analytic plane envelope (> 1 mm)`);
      if (pbad || pn < 300) failures.push(`Prather physical roof: ${pbad}/${pn} samples off the analytic envelope by > 1 cm`);
    }
    // (b) Prather: visible top = own collider top over the built pieces; no physical wall outside the measured GIS ring
    // beyond 0.1 m (every non-roof solid mesh: vertices and 5 samples along every triangle edge; roof overhang excluded).
    {
      const rc = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), prather = meshes.filter(m => m.userData.b07Group === 'Prather');
      const xs = PHD_GIS.map(q => q[0]), zs = PHD_GIS.map(q => q[1]); let n = 0, bad = 0, unbuilt = 0;
      for (let x = Math.min(...xs) + 0.5; x < Math.max(...xs); x += 1) for (let z = Math.min(...zs) + 0.5; z < Math.max(...zs); z += 1) {
        if (!pip(x, z, PHD_GIS) || ringDist(x, z, PHD_GIS) < 0.6) continue;
        if (!pip(x, z, link) && !sources.some(q => q.inPiece(x, z))) { unbuilt++; continue; } // GIS area outside the built pieces (reported)
        rc.set(new THREE.Vector3(x, 60, z), down); const h = rc.intersectObjects(prather, false)[0]; if (!h) { bad++; continue; } n++;
        const y = ownTop(x, z, h.point.y + 1); if (y === null || Math.abs(y - h.point.y) > 0.05) bad++;
      }
      let samples = 0, outside = 0, worstOut = 0; const outEx: unknown[] = [];
      const q0 = new THREE.Vector3(), q1 = new THREE.Vector3(), q = new THREE.Vector3();
      for (const m of prather) { if (/tile|soffit/.test(m.name)) continue; const pos = m.geometry.getAttribute('position');
        for (let t = 0; t < pos.count; t += 3) for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
          q0.fromBufferAttribute(pos, t + i); q1.fromBufferAttribute(pos, t + j);
          for (const f of [0, 0.25, 0.5, 0.75]) { q.lerpVectors(q0, q1, f); samples++;
            if (!pip(q.x, q.z, PHD_GIS)) { const d = ringDist(q.x, q.z, PHD_GIS); worstOut = Math.max(worstOut, d); if (d > 0.1) { outside++; if (outEx.length < 4) outEx.push([+q.x.toFixed(2), +q.z.toFixed(2), +d.toFixed(3), m.name]); } } }
        } }
      r2.pratherBody = { samples: n, visualPhysicalMismatch: bad, gisSamplesOutsideBuiltPieces: unbuilt, wallSamples: samples, wallSamplesOver01OutsideGis: outside, worstOutsideGisM: +worstOut.toFixed(3), examples: outEx };
      if (bad || n < 300) failures.push(`Prather: ${bad}/${n} roof samples without an own collider at the visible top`);
      if (unbuilt > 12) failures.push(`Prather: ${unbuilt} 1 m samples of the GIS ring left unbuilt (only the ~25 m2 NW stub is expected)`);
      if (outside || samples < 1000) failures.push(`Prather: ${outside}/${samples} wall samples more than 0.1 m outside the GIS ring, e.g. ${JSON.stringify(outEx)}`);
    }
    // (c) Jester window stacks and (d) entry surrounds sit on the generated walls they decorate.
    {
      const gen = scene.context?.solid ? [scene.context.solid] : [];
      const rc = new THREE.Raycaster(); let n = 0, bad = 0; const ex: unknown[] = [];
      const samples = (scene.blocks.stats['b07-wcp-gregory']?.districts?.jesterWindowSamples ?? []) as { abbr: string; x: number; y: number; z: number; nx: number; nz: number }[];
      for (const w of samples) {
        rc.set(new THREE.Vector3(w.x + w.nx * 3, w.y, w.z + w.nz * 3), new THREE.Vector3(-w.nx, 0, -w.nz)); rc.far = 6;
        const h = rc.intersectObjects(gen, true)[0]; n++; if (!h || Math.abs(h.distance - 3) > 0.15) { bad++; if (ex.length < 4) ex.push([w.abbr, w.x, w.z, h ? +h.distance.toFixed(2) : null]); }
      }
      const entries = (scene.blocks.stats['b07-wcp-gregory']?.districts?.['D14 residence hall entries']?.entries ?? []) as { abbr: string; x: number; z: number; groundY: number }[];
      let eBad = 0; for (const e of entries) { const g0 = scene.ground.height(e.x, e.z); if (Math.abs(g0 - e.groundY) > 0.6) eBad++; }
      const towers = scene.blocks.stats['b07-wcp-gregory']?.districts?.['D13 Jester towers']?.towers ?? [];
      r2.jester = { towers, windowSamples: n, notOnGeneratedWall: bad, examples: ex, decisions: { '526723:286': plans.get('526723:286')?.decision, '526236:273': plans.get('526236:273')?.decision } };
      r2.hallEntries = { count: entries.length, groundMismatchOver06: eBad, entries };
      if (n < 20 || bad > Math.max(2, n * 0.05)) failures.push(`Jester window stacks: ${bad}/${n} not on the generated tower wall (3 +- 0.15 m)`);
      if (eBad) failures.push(`${eBad} entry surrounds not at the local ground`);
    }
    // (e) Mapped walkways around Prather: standing capsule free of b07 colliders.
    {
      const paths = JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/campus.json'), 'utf8')).paths as { id: number; kind: string; points: P[] }[];
      const WALK = new Set(['footway', 'pedestrian', 'steps', 'path', 'cycleway', 'living_street']);
      const shape = new RAPIER.Capsule(0.5, 0.3); let n = 0, blocked = 0, shifted = 0, entering = 0; const ex: unknown[] = [], enterEx: unknown[] = [];
      for (const p of paths) { if (!WALK.has(p.kind)) continue; for (let k = 1; k < p.points.length; k++) {
        const a = p.points[k - 1], b2 = p.points[k], L = Math.hypot(b2[0] - a[0], b2[1] - a[1]);
        for (let d = 0; d < L; d += 0.75) {
          const x = a[0] + (b2[0] - a[0]) * d / L, z = a[1] + (b2[1] - a[1]) * d / L;
          if (!(x > 175 && x < 232 && z > 366 && z < 455)) continue;
          if (pip(x, z, PHD_GIS) && ringDist(x, z, PHD_GIS) > 0.9) continue; // inside the building (mapped interior/entrance stub)
          n++;
          const free = (qx: number, qz: number) => { let hit = false; physics.intersectionsWithShape({ x: qx, y: scene.ground.height(qx, qz) + 1.15, z: qz }, { x: 0, y: 0, z: 0, w: 1 }, shape, (k2: { handle: number }) => { if (own.has(k2.handle)) { hit = true; return false; } return true; }, undefined, undefined, player); return !hit; };
          if (free(x, z)) continue;
          // A mapped line lying on the facade line (within 0.9 m of the GIS ring): the parallel lane 1.2 m outside must be free.
          if (ringDist(x, z, PHD_GIS) < 0.9) {
            let bi = 0, bd = Infinity; PHD_GIS.forEach((a, i) => { const d2 = segDist(x, z, a, PHD_GIS[(i + 1) % PHD_GIS.length]); if (d2 < bd) { bd = d2; bi = i; } });
            const a = PHD_GIS[bi], c = PHD_GIS[(bi + 1) % PHD_GIS.length], l = Math.hypot(c[0] - a[0], c[1] - a[1]); let nx = (c[1] - a[1]) / l, nz = -(c[0] - a[0]) / l;
            if (pip((a[0] + c[0]) / 2 + nx * 0.05, (a[1] + c[1]) / 2 + nz * 0.05, PHD_GIS)) { nx = -nx; nz = -nz; }
            if (free(x + nx * 1.2, z + nz * 1.2)) { shifted++; continue; }
          }
          // Inside the measured ring: a mapped line entering the building (entrance), reported as in b05; outside: failure.
          if (pip(x, z, PHD_GIS)) { entering++; if (enterEx.length < 4) enterEx.push([p.id, +x.toFixed(1), +z.toFixed(1), +ringDist(x, z, PHD_GIS).toFixed(2)]); continue; }
          blocked++; if (ex.length < 6) ex.push([p.id, +x.toFixed(1), +z.toFixed(1), +ringDist(x, z, PHD_GIS).toFixed(2)]);
        }
      } }
      r2.pratherRoutes = { samples: n, blocked, onFacadeLineParallelLaneFree: shifted, entranceCrossingsInsideGisRing: entering, entranceExamples: enterEx, examples: ex };
      if (blocked) failures.push(`${blocked} mapped walkway samples around Prather blocked by b07 colliders, e.g. ${JSON.stringify(ex)}`);
    }
    // (f) PBR, metre UVs, coverage flags and budget on every round-2 mesh.
    {
      const all = [...meshes, ...detailMeshes].filter(m => m.userData.b07Group);
      const bad: string[] = []; let tris = 0, uvN = 0, uvBad = 0; const mats = new Set<THREE.Material>(), texs = new Set<THREE.Texture>();
      const va = new THREE.Vector3(), vb = new THREE.Vector3();
      for (const m of all) {
        const mat = m.material as THREE.MeshStandardMaterial; mats.add(mat); tris += m.geometry.getAttribute('position').count / 3;
        if (mat.vertexColors) bad.push(`${m.name}: vertexColors`);
        if (!/glass|gold/.test(mat.name) && !(mat.map && mat.normalMap && mat.roughnessMap)) bad.push(`${m.name}: missing PBR maps`);
        for (const t of [mat.map, mat.normalMap, mat.roughnessMap]) if (t) texs.add(t);
        const additive = m.userData.b07Group !== 'Prather';
        if (additive !== (m.userData.localContext === true)) bad.push(`${m.name}: localContext ${m.userData.localContext}`);
        const pos = m.geometry.getAttribute('position'), uv = m.geometry.getAttribute('uv'); if (!uv) { bad.push(`${m.name}: no uv`); continue; }
        for (let t = 0; t < pos.count; t += 3 * Math.max(1, Math.floor(pos.count / 3 / 300))) for (const [i, j] of [[0, 1], [1, 2]]) {
          va.fromBufferAttribute(pos, t + i); vb.fromBufferAttribute(pos, t + j); const w = va.distanceTo(vb); if (w < 0.05) continue;
          uvN++; if (Math.abs(Math.hypot(uv.getX(t + i) - uv.getX(t + j), uv.getY(t + i) - uv.getY(t + j)) / w - 1) > 0.01) uvBad++;
        }
      }
      r2.pbr = { meshes: all.length, triangles: tris, materials: mats.size, textures: texs.size, kit: scene.blocks.stats['b07-wcp-gregory']?.pbr, uvEdgesChecked: uvN, uvNotMetre: uvBad, problems: bad.slice(0, 6) };
      if (bad.length) failures.push(`round-2 meshes: ${bad.length} PBR/flag problems, e.g. ${bad.slice(0, 3).join('; ')}`);
      if (uvN < 300 || uvBad) failures.push(`metre UVs: ${uvBad}/${uvN} edges with UV length != world length (1 %)`);
      if (all.length > 40 || tris > 250000 || texs.size > 18 || mats.size > 10) failures.push(`round-2 budget exceeded: ${all.length} meshes, ${tris} triangles, ${mats.size} materials, ${texs.size} textures`);
    }
    // (g) Moore-Hill roof-form conflict (reported, not resolved): LiDAR flat vs photo tile edge.
    {
      const mhd = (ref.records as Record<string, unknown>)['651688:837'];
      r2.mooreHillRoofConflict = { lidar: mhd, roofsLidarPitchDeg: 1.0, roofsLidarType: 'flat', massing: 'flat tiers kept (measured)', photo: 'ut-mhd-421 shows red tile at a roof edge', status: 'unresolved - needs a roof-level photograph' };
      r2.shotsGround = (JSON.parse(readFileSync(resolve(process.cwd(), 'lib/campus/blocks/b07-wcp-gregory/shots.json'), 'utf8')) as { id: string; position: number[]; groundY: number }[])
        .filter(q => q.id.startsWith('b07-r2-')).map(q => ({ id: q.id, groundY: q.groundY, terrain: +scene.ground.height(q.position[0], q.position[2]).toFixed(2) }));
    }
    report.round2 = r2;
  }
  return { ok: failures.length === 0, report, failures };
};
