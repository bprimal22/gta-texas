// Headless checks owned by block b09-stadium (run by scripts/harness/run-block-checks.mjs).
// They measure the REAL scene in campus Y (downward rays on the physical colliders, 2 m grid, 1 m inset) against the
// 2017 USGS 3DEP LiDAR raster sampled inside the same rings (lib/campus/blocks/b09-stadium/lidar-reference.json):
//  1. Each corrected generated record: physical roof P50 within tol of the LiDAR P50 and the rendered P95 inside the
//     measured upper band [LiDAR P90 - tol, LiDAR max + 0.5].
//  2. MAG/MFH (City union 463679): each official ring's roof P50 vs its LiDAR P50 (was a 57 m slab from City h).
//  3. Stadium south end: the record 504014 ring is the official SEZ ring (area within 1%); no generated stand above
//     the measured MNC roof inside the Moncrief-Neuhaus ring (it used to carry 38-47 m stands); MNC (-901) drawn at its
//     LiDAR roof; the bowl's SEZ rim stays at or under the City 2023 SEZ top (groundY -5.6 + h 40.6 = 35.0) + 1 m.
//  4. The captured DKR west stand sector is still committed (no scan sector error, 35 replaced sections).
// East-south lane (D17 TMM, D18 LBJ, D19 Manor Garage + MFH, D20 Myers east stand): records it replaces (B09_LANE_REPLACED)
// must be decision 'authored' instead of 'generated' and are held to the same LiDAR roof test on their physical replacement;
// section 11 checks the lane install (committed replacements, walkable stand treads on both Myers stands, triangle budget).
// Section 12 (revision 2) checks lane surfaces: textured lane materials are explicit PBR families with the calibrated metre
// repeat and world-metre UVs (per mesh median UV-edge / 3D-edge ratio in [0.85, 1.15], 95 % within [0.5, 1.6]); glass, steel,
// dark openings and the Bass slit reveals are untextured; Myers treads use the aluminium (metal) maps, never brick/stone; and
// horizontal rays find limestone on the TMM front and LBJ, precast on the garage and brownBrick on MFH.
import type { BlockCheck } from './types';
import * as THREE from 'three';
import { TEXTURES } from '../../../lib/campus/context/materials';
import { B09_LANE_REPLACED } from '../../../lib/campus/blocks/b09-stadium/index';
import ref from '../../../lib/campus/blocks/b09-stadium/lidar-reference.json' with { type: 'json' };
import ext from '../../../lib/campus/blocks/b09-stadium/exterior-plan.json' with { type: 'json' };

type P = [number, number];
const pip = (x: number, z: number, r: P[]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const segDist = (px: number, pz: number, a: P, b: P) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l)) : 0; return Math.hypot(a[0] + t * dx - px, a[1] + t * dz - pz); };
const ringDist = (x: number, z: number, r: P[]) => Math.min(...r.map((p, i) => segDist(x, z, p, r[(i + 1) % r.length])));
const area = (r: P[]) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
const q = (v: number[], f: number) => v.length ? +v[Math.min(v.length - 1, Math.floor(v.length * f))].toFixed(2) : NaN;
const TOL = 2.0;
type Stats = { roofY_P50: number; roofY_P90: number; roofY_P95: number; roofY_max: number };

export const check: BlockCheck = scene => {
  const failures: string[] = [], report: Record<string, unknown> = {};
  const { physics, RAPIER, player } = scene;
  const data = scene.world.data;
  const plans = new Map<string, { decision: string; building: { id: number; key?: string; rings: P[][] } }>(
    scene.plans.map((p: { building: { id: number; key?: string } }) => [p.building.key ?? String(p.building.id), p]));
  const surface = (ring: P[], inset = 1.0, step = 2) => {
    const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]), tops: number[] = [];
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) {
      if (!pip(x, z, ring) || ringDist(x, z, ring) < inset) continue;
      const h = physics.castRay(new RAPIER.Ray({ x, y: 150, z }, { x: 0, y: -1, z: 0 }), 200, true, undefined, undefined, player);
      if (h) tops.push(150 - h.timeOfImpact);
    }
    return tops.sort((a, b) => a - b);
  };
  // p50Only: deliberate one-deck simplifications (garage top deck, MNC main roof) whose raster upper band is small
  // features (stair/lift towers, light poles, a ~100 m2 clerestory) — the P95 gap is reported, not failed.
  const compare = (label: string, tops: number[], r: Stats, tol = TOL, p50Only = false) => {
    const p50 = q(tops, 0.5), p95 = q(tops, 0.95);
    const entry = { samples: tops.length, modelP50: p50, lidarP50: r.roofY_P50, modelP95: p95, lidarP90: r.roofY_P90, lidarP95: r.roofY_P95, lidarMax: r.roofY_max, residualP50: +(p50 - r.roofY_P50).toFixed(2), p95Gap: +(p95 - r.roofY_P95).toFixed(2) };
    const ok = tops.length > 0 && Math.abs(p50 - r.roofY_P50) <= tol && p95 <= r.roofY_max + 0.5 && (p50Only || p95 >= r.roofY_P90 - tol);
    if (!ok) failures.push(`${label} roof P50/P95 ${p50}/${p95} vs LiDAR P50 ${r.roofY_P50}, band P90 ${r.roofY_P90}..max ${r.roofY_max} (campus Y, tol ${tol})`);
    return entry;
  };
  // 1. Corrected generated records.
  const records: Record<string, unknown> = {};
  for (const [key, r] of Object.entries(ref.records as Record<string, Stats & { abbr: string }>)) {
    const p = plans.get(key);
    if (!p) { failures.push(`${key} missing from the context plans`); continue; }
    const expected = (B09_LANE_REPLACED as readonly string[]).includes(key) ? 'authored' : 'generated';
    if (p.decision !== expected) { failures.push(`${key} ${r.abbr} decision ${p.decision} (expected ${expected})`); continue; }
    const tops = surface(p.building.rings[0] as P[]);
    const bands = (r as { bands?: { split: number; highFraction: number; lowMedianY: number; highMedianY: number } }).bands;
    if (bands) {
      // Two-level hall (RSC): compare each band's median and the high-band area fraction with the raster bands.
      const lo = tops.filter(y => y < bands.split), hi = tops.filter(y => y >= bands.split), frac = hi.length / Math.max(1, tops.length);
      const e = { abbr: r.abbr, samples: tops.length, lowMedian: q(lo, 0.5), lidarLowMedian: bands.lowMedianY, highMedian: q(hi, 0.5), lidarHighMedian: bands.highMedianY, highFraction: +frac.toFixed(3), lidarHighFraction: bands.highFraction, modelMax: q(tops, 0.999), lidarMax: r.roofY_max };
      if (!(Math.abs(q(lo, 0.5) - bands.lowMedianY) <= 1.0 && Math.abs(q(hi, 0.5) - bands.highMedianY) <= 1.0 && Math.abs(frac - bands.highFraction) <= 0.08 && q(tops, 0.999) <= r.roofY_max + 0.5))
        failures.push(`${key} ${r.abbr} bands ${JSON.stringify(e)}`);
      records[key] = e; continue;
    }
    // Tiny sheds (< 4 samples at 2 m) are sampled at 0.5 m with a 0.4 m inset.
    records[key] = { abbr: r.abbr, ...compare(`${key} ${r.abbr}`, tops.length >= 4 ? tops : surface(p.building.rings[0] as P[], 0.4, 0.5), r) };
  }
  report.records = records;
  // 2. MAG / MFH split of City union 463679.
  const off = ref.official as unknown as Record<string, Stats & { ring: P[] }>;
  report.mag = compare('MAG:479', surface(off['MAG:479'].ring), off['MAG:479'], 1.0, true);
  report.mfh = compare('MFH:527', surface(off['MFH:527'].ring, 1.5), off['MFH:527'], 1.0, true);
  // 3. Stadium south end.
  const sez = data.buildings.find((b: { key?: string }) => b.key === '504014:177');
  const sezArea = sez ? area(sez.rings[0] as P[]) : 0, offArea = area(off['SEZ:642'].ring);
  report.sezFootprint = { area: +sezArea.toFixed(1), officialArea: +offArea.toFixed(1) };
  if (!sez || Math.abs(sezArea - offArea) / offArea > 0.01) failures.push(`504014:177 ring area ${sezArea.toFixed(0)} is not the official SEZ ring (${offArea.toFixed(0)})`);
  const mncPlan = plans.get('-901:add');
  if (!mncPlan || mncPlan.decision !== 'generated') failures.push(`MNC -901:add decision ${mncPlan?.decision ?? 'missing'} (expected generated)`);
  const mncTops = surface(off['MNC:560'].ring, 2.0);
  report.mnc = compare('MNC -901 (UT 560)', mncTops, off['MNC:560'], 1.0, true);
  const overMnc = mncTops.filter(y => y > off['MNC:560'].roofY_P50 + 1.0).length;
  report.mnc = { ...(report.mnc as object), samplesAboveRoofPlus1: overMnc };
  if (overMnc / Math.max(1, mncTops.length) > 0.03) failures.push(`${overMnc}/${mncTops.length} samples inside the MNC ring are above its roof + 1 m (bowl stands still over MNC?)`);
  // Bowl-only rays (the b09 videoboard on the rim is checked separately in round 2).
  const inst = scene.blocks.installs.find((x: { id: string }) => x.id === 'b09-stadium');
  const own = new Set<number>((inst?.colliders ?? []).map((k: { handle: number }) => k.handle));
  const notOwn = (k: { handle: number }) => !own.has(k.handle), onlyOwn = (k: { handle: number }) => own.has(k.handle);
  const sezRing = off['SEZ:642'].ring, sezTops: number[] = [];
  { const xs = sezRing.map(p => p[0]), zs = sezRing.map(p => p[1]);
    for (let x = Math.min(...xs) + 1; x < Math.max(...xs); x += 2) for (let z = Math.min(...zs) + 1; z < Math.max(...zs); z += 2) {
      if (!pip(x, z, sezRing) || ringDist(x, z, sezRing) < 2) continue;
      const h = physics.castRay(new RAPIER.Ray({ x, y: 150, z }, { x: 0, y: -1, z: 0 }), 200, true, undefined, undefined, player, undefined, notOwn);
      if (h) sezTops.push(150 - h.timeOfImpact);
    } sezTops.sort((a, b) => a - b); }
  const sezTop = sezTops.length ? sezTops[sezTops.length - 1] : NaN;
  report.sezRim = { samples: sezTops.length, top: +sezTop.toFixed(2), cityTop: 35.0, p50: q(sezTops, 0.5) };
  if (!(sezTop <= 36.0)) failures.push(`SEZ rim ${sezTop.toFixed(2)} above the City 2023 SEZ top 35.0 + 1 m`);
  // 4. Captured west stand.
  const st = scene.context.stats.stadium;
  report.stadium = { fieldY: st.fieldY, sections: st.sections, rimMaxHeight: st.rimMaxHeight, meanDepth: +st.meanDepth.toFixed(2), triangles: st.triangles, scanSector: st.scanSector, scanSectorError: st.scanSectorError };
  if (st.scanSectorError || !st.scanSector || st.scanSector.replacedSections !== 35) failures.push(`west scan sector not committed as before: ${JSON.stringify(st.scanSector)} ${st.scanSectorError}`);
  // ---- Round 2: exterior features (lib/campus/blocks/b09-stadium/exterior.ts, exterior-plan.json) ----
  // 5. The bowl is identical to the no-install baseline (the exterior must not reshape it via the coverage raster).
  const base = ext.bowlBaseline as { triangles: number; colliderTriangles: number; retractedMetres: number; meanDepth: number };
  report.bowlVsBaseline = { triangles: [st.triangles, base.triangles], colliderTriangles: [st.colliderTriangles, base.colliderTriangles], retracted: [st.retractedMetres, base.retractedMetres], meanDepth: [st.meanDepth, base.meanDepth] };
  if (st.triangles !== base.triangles || st.colliderTriangles !== base.colliderTriangles || st.retractedMetres !== base.retractedMetres || Math.abs(st.meanDepth - base.meanDepth) > 1e-9)
    failures.push(`bowl differs from the no-install baseline: ${JSON.stringify(report.bowlVsBaseline)}`);
  if (!inst) { failures.push('b09 install missing'); return { ok: false, report, failures }; }
  const ray = (o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, len: number, filter: (k: { handle: number }) => boolean) => {
    const h = physics.castRay(new RAPIER.Ray(o, d), len, true, undefined, undefined, player, undefined, filter); return h ? h.timeOfImpact : null; };
  const probe = new RAPIER.Ball(0.03);
  const hitsOwn = (x: number, y: number, z: number) => { let hit = false; physics.intersectionsWithShape({ x, y, z }, { x: 0, y: 0, z: 0, w: 1 }, probe, () => { hit = true; return false; }, undefined, undefined, player, undefined, onlyOwn); return hit; };
  // 6. Bellmont: pier fronts on the official GIS front line (horizontal rays at the pier centre); nothing of b09 east of the bowl's
  //    measured west wall (balls just behind the wall plane); ground capsules in front of the full-height bays are free.
  const piers: Record<string, unknown>[] = []; let pierBad = 0;
  for (const p of ext.piers as { z: number; front: number; base: number }[]) {
    const errs: number[] = [];
    // Heights inside the D19 facade datum (Y 32.2); every probe must hit (the upper facade no longer reaches the rim).
    for (const y of [20, 24, 28, 31.5]) { const t = ray({ x: 300, y, z: p.z }, { x: 1, y: 0, z: 0 }, 40, onlyOwn); if (t !== null) errs.push(+(300 + t - p.front).toFixed(3)); }
    piers.push({ z: p.z, gisFront: p.front, errors: errs }); if (errs.length < 4 || errs.some(e => Math.abs(e) > 0.05)) pierBad++;
  }
  report.bellmontPiers = piers; if (pierBad) failures.push(`${pierBad} Bellmont piers not on the official GIS front line (+-0.05 m)`);
  let behind = 0, behindN = 0;
  for (let z = 252; z <= 333; z += 0.5) for (let y = 19; y <= 47; y += 2) {
    const t = ray({ x: 300, y, z }, { x: 1, y: 0, z: 0 }, 40, notOwn); if (t === null) continue; behindN++;
    if (hitsOwn(300 + t + 0.06, y, z)) behind++;
  }
  report.bellmontInsideBowl = { samples: behindN, b09InsideBowlWall: behind };
  if (behind) failures.push(`${behind}/${behindN} samples: b09 geometry behind the bowl's west wall`);
  const cap = new RAPIER.Capsule(0.5, 0.3); let capN = 0; const capBad: number[][] = [];
  for (const p of ext.piers as { z: number; front: number }[]) if (p.z > 302.5) for (const dz of [-3, 0, 3]) {
    const x = p.front - 0.75, z = p.z + dz, g = ray({ x, y: 40, z }, { x: 0, y: -1, z: 0 }, 80, notOwn); if (g === null) continue; capN++;
    let hit = false; physics.intersectionsWithShape({ x, y: 40 - g + 1.1, z }, { x: 0, y: 0, z: 0, w: 1 }, cap, () => { hit = true; return false; }, undefined, undefined, player, undefined, onlyOwn);
    if (hit) capBad.push([x, z]);
  }
  report.bellmontStreetCapsules = { tested: capN, blocked: capBad };
  if (capBad.length || capN < 6) failures.push(`street capsules in front of the Bellmont bays: ${capN} tested, blocked ${JSON.stringify(capBad)}`);
  // 7. Towers: physical top and radius vs the LiDAR blob.
  const towers: Record<string, unknown>[] = [];
  for (const tw of ext.towers as { name: string; centre: [number, number]; radius: number; top: number }[]) {
    const [cx, cz] = tw.centre, t = ray({ x: cx, y: 120, z: cz }, { x: 0, y: -1, z: 0 }, 200, onlyOwn), top = t === null ? NaN : 120 - t;
    const rs: number[] = []; for (let a = 0; a < 360; a += 45) { const dx = Math.cos(a * Math.PI / 180), dz = Math.sin(a * Math.PI / 180), h = ray({ x: cx + dx * 20, y: tw.top - 8, z: cz + dz * 20 }, { x: -dx, y: 0, z: -dz }, 20, onlyOwn); if (h !== null) rs.push(+(20 - h).toFixed(2)); }
    towers.push({ name: tw.name, lidarTop: tw.top, modelTop: +top.toFixed(2), lidarRadius: tw.radius, modelRadii: rs });
    if (!(Math.abs(top - tw.top) <= 0.05) || rs.length < 8 || rs.some(r => Math.abs(r - tw.radius) > 0.15)) failures.push(`tower ${tw.name} top ${top} / radii ${JSON.stringify(rs)} vs LiDAR ${tw.top} / ${tw.radius}`);
    // No other collider inside the tower above its base (bowl envelope / buildings).
    let clash = 0; for (let y = tw.top - 2; y > tw.top - 25; y -= 3) for (let a = 0; a < 360; a += 30) for (const f of [0.3, 0.8]) {
      let hit = false; physics.intersectionsWithShape({ x: cx + Math.cos(a) * tw.radius * f, y, z: cz + Math.sin(a) * tw.radius * f }, { x: 0, y: 0, z: 0, w: 1 }, probe, () => { hit = true; return false; }, undefined, undefined, player, undefined, notOwn);
      if (hit) clash++; }
    if (clash) failures.push(`tower ${tw.name}: ${clash} samples inside other colliders`);
  }
  report.towers = towers;
  // 8. Videoboard: official size (width/height) measured on the physical box; no bowl collider inside it.
  const B = ext.board as unknown as { centre: [number, number]; width: number; height: number; depth: number; angle: number; bottom: number; top: number };
  const Wd = [Math.cos(B.angle), -Math.sin(B.angle)], Ld = [Math.sin(B.angle), Math.cos(B.angle)];
  const at = (t: number, d: number) => [B.centre[0] + Wd[0] * t + Ld[0] * d, B.centre[1] + Wd[1] * t + Ld[1] * d];
  const mid = (B.bottom + B.top) / 2;
  const [ax, az] = at(-B.width / 2 - 5, 0), wHit = ray({ x: ax, y: mid, z: az }, { x: Wd[0], y: 0, z: Wd[1] }, 10, onlyOwn);
  const [bx, bz] = at(B.width / 2 + 5, 0), wHit2 = ray({ x: bx, y: mid, z: bz }, { x: -Wd[0], y: 0, z: -Wd[1] }, 10, onlyOwn);
  const width = wHit !== null && wHit2 !== null ? B.width + 10 - wHit - wHit2 : NaN;
  const [cx0, cz0] = at(0, 0), topHit = ray({ x: cx0, y: 120, z: cz0 }, { x: 0, y: -1, z: 0 }, 200, onlyOwn), botHit = ray({ x: cx0, y: B.bottom - 0.5, z: cz0 }, { x: 0, y: 1, z: 0 }, 30, onlyOwn);
  const height = topHit !== null && botHit !== null ? (120 - topHit) - (B.bottom - 0.5 + botHit) : NaN;
  let inBoard = 0; for (let t = -B.width / 2 + 0.3; t < B.width / 2; t += 2) for (const d of [-B.depth / 2 + 0.2, 0, B.depth / 2 - 0.2]) for (let y = B.bottom + 0.1; y < B.top; y += 2) {
    const [x, z] = at(t, d); let hit = false; physics.intersectionsWithShape({ x, y, z }, { x: 0, y: 0, z: 0, w: 1 }, probe, () => { hit = true; return false; }, undefined, undefined, player, undefined, notOwn); if (hit) inBoard++; }
  report.videoboard = { widthM: +width.toFixed(3), officialWidthM: 40.96, heightM: +height.toFixed(3), officialHeightM: 17.02, bottom: B.bottom, top: B.top, otherCollidersInside: inBoard };
  if (!(Math.abs(width - 40.96) < 0.05 && Math.abs(height - 17.02) < 0.05) || inBoard) failures.push(`videoboard ${JSON.stringify(report.videoboard)}`);
  // 9. SEZ premium bands present on the south wall (south-to-north rays at band level hit b09 just outside the bowl wall).
  let bandN = 0, bandOk = 0;
  for (const [x, wz] of (ext.southWall as number[][]).filter(p => p[0] >= 385 && p[0] <= 490).map(p => [p[0], p[1]])) {
    bandN++; const t = ray({ x, y: 12.5, z: 470 }, { x: 0, y: 0, z: -1 }, 120, onlyOwn); if (t !== null && 470 - t - wz > 0.05 && 470 - t - wz < 0.8) bandOk++;
  }
  report.sezBands = { columns: bandN, withGlazingBand: bandOk };
  if (bandOk < bandN * 0.95) failures.push(`SEZ bands: ${bandOk}/${bandN}`);
  // ---- D19 Bellmont pilot (exterior-plan.json `bellmont`, reference-interpreted from projected reviewed captures) ----
  // 10. Per official bay: the physical top is the referenced datum (roof behind the facade line) and nothing of b09 rises above
  //     it in front of the line; fin bays carry the planned number of proud fins; band bays the planned number of recessed ribbons
  //     (and no proud fins). Rays are on b09's own colliders only.
  const BEL = ext.bellmont as { facadeTop: number; fin: { perBay: number; base: number; coping: number }; band: { ribbons: number; groundStorey: number; coping: number }; bays: { z0: number; z1: number; type: string }[] };
  const WW = ext.westWall as number[][], wallXAt = (z: number) => { let i = 1; while (i < WW.length - 1 && z > WW[i][0]) i++; const a = WW[i - 1], b = WW[i]; return a[1] + (b[1] - a[1]) * (z - a[0]) / (b[0] - a[0]); };
  const PP = ext.piers as { z: number; base: number; width: number }[], bays: Record<string, unknown>[] = [];
  const datum = Math.round(BEL.facadeTop * 20) / 20;
  for (let i = 0; i + 1 < PP.length; i++) {
    const a = PP[i], b = PP[i + 1], bay = BEL.bays[i], errs: string[] = [];
    const baseX = (z: number) => a.base + (b.base - a.base) * (z - a.z) / (b.z - a.z), za = a.z + a.width / 2, zb = b.z - b.width / 2;
    let roofN = 0, roofBad = 0, aboveBad = 0;
    for (let z = za + 0.4; z < zb - 0.3; z += 1) {
      const xr = Math.min(baseX(z) + 0.6, wallXAt(z) - 0.3), tr = ray({ x: xr, y: 80, z }, { x: 0, y: -1, z: 0 }, 120, onlyOwn); roofN++;
      if (tr === null || Math.abs(80 - tr - datum) > 0.05) roofBad++;
      const tf = ray({ x: baseX(z) - 0.2, y: 80, z }, { x: 0, y: -1, z: 0 }, 120, onlyOwn); if (tf !== null && 80 - tf > datum + 0.01) aboveBad++;
    }
    if (roofBad || aboveBad || roofN < 5) errs.push(`top: ${roofBad}/${roofN} roof samples off datum ${datum}, ${aboveBad} above it in front`);
    // Oriented clear bay (same frame as the builder: GIS pier bases a->b, clear span between the official pier half-widths);
    // rays along -N onto the facade, so the projecting piers themselves are outside the swept domain.
    const L = Math.hypot(b.base - a.base, b.z - a.z), T = [(b.base - a.base) / L, (b.z - a.z) / L], N = [-T[1], T[0]];
    const proudRuns = (y: number) => { let runs = 0, prev = false;
      for (let t = a.width / 2 + 0.03; t < L - b.width / 2 - 0.03; t += 0.02) {
        const px = a.base + T[0] * t, pz = a.z + T[1] * t, h = ray({ x: px + N[0] * 3, y, z: pz + N[1] * 3 }, { x: -N[0], y: 0, z: -N[1] }, 6, onlyOwn);
        const p = h !== null && 3 - h > 0.2; if (p && !prev) runs++; prev = p; }
      return runs; };
    let fins = NaN, ribbons = NaN;
    if (bay.type === 'fin') {
      fins = proudRuns((18.25 + BEL.fin.base + datum - BEL.fin.coping) / 2);
      if (fins !== BEL.fin.perBay) errs.push(`fin bay has ${fins} proud fins (plan ${BEL.fin.perBay})`);
    } else {
      const zc = za + 0.75, g = ray({ x: baseX(zc) - 1.5, y: 40, z: zc }, { x: 0, y: -1, z: 0 }, 80, notOwn), gy = g === null ? NaN : 40 - g;
      ribbons = 0; let prev = false;
      for (let y = gy + BEL.band.groundStorey + 0.6; y < datum - 0.05; y += 0.05) { const t = ray({ x: 300, y, z: zc }, { x: 1, y: 0, z: 0 }, 40, onlyOwn); const r = t !== null && 300 + t > baseX(zc) + 0.02; if (r && !prev) ribbons++; prev = r; }
      if (ribbons !== BEL.band.ribbons) errs.push(`band bay has ${ribbons} recessed ribbons (plan ${BEL.band.ribbons}, ground ${gy.toFixed(2)})`);
      const pr = proudRuns((datum + 18.25) / 2); if (pr) errs.push(`band bay has ${pr} proud fins at mid height`);
    }
    bays.push({ z0: a.z, z1: b.z, type: bay.type, roofSamples: roofN, fins, ribbons, errors: errs });
    if (errs.length) failures.push(`Bellmont bay ${a.z}-${b.z} (${bay.type}): ${errs.join('; ')}`);
  }
  report.bellmontBays = { datum, bays };
  // 11. East-south lane install.
  const laneStats = (scene.blocks.stats['b09-stadium'] as { lane?: { triangles: number; districts: Record<string, unknown> } } | undefined)?.lane;
  const committed = Object.entries(scene.blocks.replacements.committed).filter(([, o]) => o === 'b09-stadium').map(([k]) => k);
  for (const k of B09_LANE_REPLACED) if (!committed.includes(k)) failures.push(`lane replacement ${k} not committed`);
  const treadAt = (x: number, z: number) => { const t = ray({ x, y: 60, z }, { x: 0, y: -1, z: 0 }, 80, onlyOwn); return t === null ? NaN : 60 - t; };
  const eastStand = [treadAt(752, 380), treadAt(762, 400)], westStand = [treadAt(626, 350), treadAt(612, 410)];
  report.lane = { committed, districts: laneStats?.districts, triangles: laneStats?.triangles, eastStandTreadY: eastStand, westStandTreadY: westStand };
  if (eastStand.some(y => !(y > 11 && y < 27)) || westStand.some(y => !(y > 11 && y < 19))) failures.push(`Myers stand treads missing: east ${JSON.stringify(eastStand)}, west ${JSON.stringify(westStand)}`);
  if (!laneStats || laneStats.triangles > 150000) failures.push(`b09 lane triangles ${laneStats?.triangles} (budget 150000)`);
  // 12. Lane surfaces.
  type M = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const laneMeshes: M[] = [];
  for (const root of [...(inst.install.solids ?? []), ...(inst.install.walkable ?? []), ...(inst.install.detail ?? [])] as THREE.Object3D[])
    root.traverse(o => { const m = o as M; if (m.isMesh && m.name.startsWith('b09 east-south lane')) laneMeshes.push(m); });
  const surf: Record<string, unknown> = {};
  for (const m of laneMeshes) {
    const fam = m.material.userData.pbrFamily as keyof typeof TEXTURES | undefined, map = m.material.map;
    if (map && !fam) failures.push(`${m.name}: texture without an explicit PBR family`);
    if (!fam) { if (/glass|metal|matte/.test(m.name) && map) failures.push(`${m.name}: untextured family carries a map`); continue; }
    const tile = TEXTURES[fam].tile;
    if (!map || Math.abs(map.repeat.x - 1 / tile) > 1e-6 || Math.abs(map.repeat.y - 1 / tile) > 1e-6) failures.push(`${m.name}: ${fam} repeat != 1/${tile}`);
    const pos = m.geometry.getAttribute('position'), uv = m.geometry.getAttribute('uv'), stride = Math.max(1, Math.floor(pos.count / 3 / 300)), ratios: number[] = [];
    for (let t = 0; t < pos.count / 3; t += stride) for (const [i, j] of [[0, 1], [1, 2]]) {
      const a = t * 3 + i, b = t * 3 + j, d3 = Math.hypot(pos.getX(a) - pos.getX(b), pos.getY(a) - pos.getY(b), pos.getZ(a) - pos.getZ(b));
      if (d3 >= 0.3) ratios.push(Math.hypot(uv.getX(a) - uv.getX(b), uv.getY(a) - uv.getY(b)) / d3);
    }
    ratios.sort((a, b) => a - b);
    const med = ratios.length ? ratios[Math.floor(ratios.length / 2)] : NaN, out = ratios.filter(r => r < 0.5 || r > 1.6).length;
    surf[m.name] = { family: fam, tileMetres: tile, uvSamples: ratios.length, medianUvPerMetre: +med.toFixed(3), outside05to16: out };
    if (!(med >= 0.85 && med <= 1.15) || out > ratios.length * 0.05) failures.push(`${m.name}: UV scale median ${med.toFixed(3)}, ${out}/${ratios.length} outside [0.5, 1.6]`);
  }
  const famRay = (x: number, y: number, z: number, dx: number, dz: number, down = false) => {
    const rc = new THREE.Raycaster(new THREE.Vector3(x, y, z), down ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(dx, 0, dz).normalize(), 0, down ? 40 : 15);
    const h = rc.intersectObjects(laneMeshes, false)[0];
    return h ? ((h.object as M).material.userData.pbrFamily as string | undefined) ?? 'untextured' : null;
  };
  // Expected family per probe ('a|b' = either: the garage spandrels carry inset brick panels on the precast frame).
  const probes: Record<string, [string | null, string]> = {
    tmmFront: [famRay(440, 14, -84.5, 1, 0), 'limestone'], lbjWest: [famRay(735, 26, 20, 1, 0), 'limestone'],
    garageWest: [famRay(558, 8, 380, 1, 0.26), 'precast|brownBrick'], mfhSouth: [famRay(588, 7, 480, 0, -1), 'brownBrick'],
    eastTreads: [famRay(752, 40, 380, 0, 0, true), 'metal'], westTreads: [famRay(626, 40, 350, 0, 0, true), 'metal'],
  };
  for (const [k, [got, want]] of Object.entries(probes)) if (!want.split('|').includes(got ?? '')) failures.push(`surface probe ${k}: ${got} (expected ${want})`);
  const slits = laneMeshes.filter(m => (m.userData.localContext && /detail matte/.test(m.name))).map(m => !!m.material.map);
  report.laneSurfaces = { meshes: surf, probes: Object.fromEntries(Object.entries(probes).map(([k, [g]]) => [k, g])), untexturedDetailMatte: slits.every(x => !x) };
  if (slits.some(x => x)) failures.push('Bass slit reveals / dark detail carry a texture');
  return { ok: failures.length === 0, report, failures };
};
