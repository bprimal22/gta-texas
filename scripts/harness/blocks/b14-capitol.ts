// Headless checks owned by block b14-capitol (run by scripts/harness/run-block-checks.mjs).
// Everything is measured on the REAL scene in campus Y (downward rays on the physical colliders) and compared with the
// 2017 USGS 3DEP LiDAR raster sampled in the same rings/points (lib/campus/blocks/b14-capitol/lidar-reference.json):
//  1. Datum-restated generated records (context.json massing, LiDAR coverage >= 0.6, area >= 60 m2): flat roofs have
//     physical P50 within 2 m of the raster P50 (or, for tiered roofs, P10 and P90 within 2 m of the raster's), hipped
//     roofs have their physical ridge inside [raster P90 - 2, raster max + 1]; nothing above raster max + 1.
//  2. Supreme Court / Clark / Price Daniel union 486339 is generated (it was suppressed as 'route' because the Capitol
//     lawn grid ran into it) with its main deck at the LiDAR P50 and nothing above the raster max.
//  3. 697689 (City h conflict) stands at its measured 2017 roof instead of 18.8 m above it.
//  4. Capitol (capitol-dome.ts / capitol-area.ts): Goddess star tip = TSPB 302.64 ft above the south front ground;
//     peristyle deck, upper drum cornice and lantern cap at the LiDAR heights; central block north face out to
//     v = -48.5 (City footprint / LiDAR) and the measured north entrance pavilion deck; Great Walk / lawn ground vs
//     the LiDAR DTM; map travel to CAP, CAPS and the Capitol centre lands outdoors.
// Round 2 (south strip z 1288..1536, strip-ground.ts + context.json add[]):
//  5. Strip ground: the physical patch (own collider) vs the 2017 DTM at 400 open-ground samples (median |d| <= 0.15 m,
//     P95 <= 0.6 m); contour height (world.terrain.height, via capitolGroundReference) = the patch; seam at z 1288 vs the
//     baked terrain's last row (step <= 0.03 m); Capitol grounds edge vs capitolGroundHeight (step <= 0.10 m).
//  6. Every added City 2023 record is generated (none suppressed as route/authored); LiDAR-massed ones have their physical
//     roof at the raster (flat: P50 within 2 m or P10 and P90 within 2 m; hip: ridge in [P90 - 2, max + 1]; nothing above
//     max + 1.5 except official City-height records).
//  7. Map travel into the strip lands outdoors on the patch (not enclosed, within 0.3 m of the patch height).
// Group 4 (district wave D34-D36, district.ts):
//  1'. 656265:920 and 624194:789 are committed b14 replacements ('authored') held to the SAME LiDAR record test (1).
//  8. Articulation is physical (own colliders only): district solids inside their City rings (+2 cm; house eave fascia
//     <= 0.45 m out at the eave line only; flush window skins <= 5 cm); 656265 arches open to the recessed glazing
//     (recess depth) with solid granite above the crown and at the piers. 656265:920 FINAL correction (granite.ts,
//     source evidence d34-dsm-reference.json = registered 2017 DSM samples with masks): physical roof within 0.4 m (median)
//     of the DSM on every feature core (podium, decks, pavilions, links, central hip), overall median <= 0.25 m and
//     unbiased; both west pavilions stand on the ring line with exact copper pyramids peaking at the DSM peaks >= 3 m
//     above the 21.52 ledge while the west silhouette between them reaches back to the attic; the central hip equals its
//     exact planes with the ridge at 27.89 (<= LiDAR max); podium 1.15, links 23.3 / 23.1 and the ledge 21.52 found by
//     rays; 7 arches (west 2, east 3, north 1, south 1) open with solid crowns / piers; granite pale pink (sRGB R >= 185,
//     saturation <= 0.35). 624194 deck at the frozen deck and, on every faced edge and level, open bays at the recess
//     depth alternating with flush spandrels and columns; 467902 ridge =
//     generator grade (baked ground, generator sampling) + City h 10.82 within 5 cm, never above it, porch open to its
//     back wall between solid posts under a solid upper storey, porch floor / ceiling at their heights, eave fascia found;
//     every well-conditioned sloped district roof triangle lies on the copper hip or the house gable slope.
//  9. Materials and budget: district meshes have finite metre-scale UVs, only local context PBR maps (files present) at
//     the context tile size with the 1 / linear-mean gain, clean glass / trim without maps, per-feature families (granite
//     walls limestone, copper roofs metal, garage walls precast, house walls siding, house roof shingle); draws <= 12,
//     textures <= 18; and the multiset of rendered district solid triangles equals the district collider's exactly.
import type { BlockCheck } from './types';
import ref from '../../../lib/campus/blocks/b14-capitol/lidar-reference.json' with { type: 'json' };
import stripRef from '../../../lib/campus/blocks/b14-capitol/strip-reference.json' with { type: 'json' };
import b14Context from '../../../lib/campus/blocks/b14-capitol/context.json' with { type: 'json' };
import { stripGroundHeight, inCapitolGrounds } from '../../../lib/campus/blocks/b14-capitol/strip-ground';
import { capitolGroundHeight, capitolLocal } from '../../../lib/campus/capitol-area';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { BakedGround } from '../../../lib/campus/baked-ground';
import { DISTRICT_KEYS, GARAGE, HOUSE, groundOf, massingOf, houseRoof } from '../../../lib/campus/blocks/b14-capitol/district';
import { D34, d34Plan, d34Roofs } from '../../../lib/campus/blocks/b14-capitol/granite';
import { col } from '../../../lib/campus/blocks/b14-capitol/pbr';
import d34Ref from '../../../lib/campus/blocks/b14-capitol/d34-dsm-reference.json' with { type: 'json' };
import * as THREE from 'three';
import { edgesOf, type Edge } from '../../../lib/campus/blocks/b14-capitol/kit';
import { roofY } from '../../../lib/campus/blocks/b14-capitol/roof';
import { PBR } from '../../../lib/campus/blocks/b14-capitol/pbr';
import { TEXTURES } from '../../../lib/campus/context/materials';

type P = [number, number];
const pip = (x: number, z: number, r: P[]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const segDist = (px: number, pz: number, a: P, b: P) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l)) : 0; return Math.hypot(a[0] + t * dx - px, a[1] + t * dz - pz); };
const ringDist = (x: number, z: number, r: P[]) => Math.min(...r.map((p, i) => segDist(x, z, p, r[(i + 1) % r.length])));
const q = (v: number[], f: number) => v.length ? +v[Math.min(v.length - 1, Math.floor(v.length * f))].toFixed(2) : NaN;
const C = Math.cos(0.315), S = Math.sin(0.315);
const cp = (u: number, v: number): P => [-308 + C * u - S * v, 1266.5 + S * u + C * v];
type Rec = { roof: string; roofY_P10: number; roofY_P50: number; roofY_P90: number; roofY_P95: number; roofY_max: number; coverage: number; area: number };

export const check: BlockCheck = scene => {
  const failures: string[] = [], report: Record<string, unknown> = {};
  const { physics, RAPIER, player } = scene;
  const ray = (x: number, z: number, from = 150) => { const h = physics.castRay(new RAPIER.Ray({ x, y: from, z }, { x: 0, y: -1, z: 0 }), 300, true, undefined, undefined, player); return h ? from - h.timeOfImpact : NaN; };
  const plans = new Map<string, { decision: string; building: { id: number; key?: string; rings: P[][] } }>(
    scene.plans.map((p: { building: { id: number; key?: string } }) => [p.building.key ?? String(p.building.id), p]));
  const surface = (ring: P[], inset = 1.0, step = 2) => {
    const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]), tops: number[] = [];
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) {
      if (!pip(x, z, ring) || ringDist(x, z, ring) < inset) continue;
      const y = ray(x, z); if (Number.isFinite(y)) tops.push(y);
    }
    return tops.sort((a, b) => a - b);
  };
  // 1. Records.
  const records: Record<string, unknown> = {}; let passed = 0;
  const committed = scene.blocks.replacements.committed as Record<string, string>, district = new Set<string>(Object.values(DISTRICT_KEYS));
  for (const [key, r] of Object.entries(ref.records as Record<string, Rec>)) {
    const p = plans.get(key), want = district.has(key) ? 'authored' : 'generated';
    if (!p || p.decision !== want) { failures.push(`${key} decision ${p?.decision ?? 'missing'} (expected ${want})`); continue; }
    if (want === 'authored' && committed[key] !== 'b14-capitol') { failures.push(`${key} replacement not committed by b14 (${committed[key]})`); continue; }
    let tops = surface(p.building.rings[0] as P[]);
    if (tops.length < 4) tops = surface(p.building.rings[0] as P[], 0.4, 0.5);
    const m = { p10: q(tops, 0.1), p50: q(tops, 0.5), p90: q(tops, 0.9), max: q(tops, 0.999) };
    let ok: boolean;
    if (r.roof === 'flat') ok = (Math.abs(m.p50 - r.roofY_P50) <= 2 || (Math.abs(m.p10 - r.roofY_P10) <= 2 && Math.abs(m.p90 - r.roofY_P90) <= 2)) && m.max <= r.roofY_max + 1;
    else ok = m.max >= r.roofY_P90 - 2 && m.max <= r.roofY_max + 1;
    records[key] = { roof: r.roof, samples: tops.length, model: m, lidar: { p10: r.roofY_P10, p50: r.roofY_P50, p90: r.roofY_P90, max: r.roofY_max }, ok };
    if (ok) passed++; else failures.push(`${key} ${r.roof} model ${JSON.stringify(m)} vs LiDAR P10/P50/P90/max ${r.roofY_P10}/${r.roofY_P50}/${r.roofY_P90}/${r.roofY_max}`);
  }
  report.records = { checked: Object.keys(ref.records).length, passed };
  report.recordDetail = records;
  // 2. Supreme Court / Clark / Price Daniel union.
  const sc = plans.get('486339:109');
  const scTops = sc ? surface(sc.building.rings[0] as P[]) : [];
  report.supremeCourtClark = { decision: sc?.decision, samples: scTops.length, p50: q(scTops, 0.5), p95: q(scTops, 0.95), max: q(scTops, 0.999), lidarP50: 14.51, lidarP95: 41.23, lidarMax: 43.0 };
  if (sc?.decision !== 'generated') failures.push(`486339:109 decision ${sc?.decision} (expected generated)`);
  else if (!(Math.abs(q(scTops, 0.5) - 14.51) <= 1.0 && q(scTops, 0.999) <= 43.5 && q(scTops, 0.95) >= 41.23 - 6)) failures.push(`486339:109 roofs ${JSON.stringify(report.supremeCourtClark)}`);
  // 3. 697689 conflict.
  const wc = plans.get('697689:1025'), wcTops = wc ? surface(wc.building.rings[0] as P[]) : [];
  report.r697689 = { p50: q(wcTops, 0.5), lidarP50: -7.99 };
  if (!(Math.abs(q(wcTops, 0.5) + 7.99) <= 1.0)) failures.push(`697689:1025 roof ${q(wcTops, 0.5)} vs LiDAR -7.99`);
  // 4. Capitol.
  const cap = ref.capitol;
  let starTip = -Infinity;
  scene.walkway.surfaces.traverse((o: { isMesh?: boolean; name?: string; geometry?: { boundingBox: { max: { y: number } } | null; computeBoundingBox(): void } }) => {
    if (o.isMesh && o.name === 'Capitol carved pale granite' && o.geometry) { o.geometry.computeBoundingBox(); starTip = Math.max(starTip, o.geometry.boundingBox!.max.y); }
  });
  const ringMedian = (r: number) => { const v: number[] = []; for (let i = 0; i < 48; i++) { const a = i * Math.PI / 24; const y = ray(-308 + Math.sin(a) * r, 1266.5 + Math.cos(a) * r); if (Number.isFinite(y)) v.push(y); } return q(v.sort((a, b) => a - b), 0.5); };
  const northRoof: number[] = []; for (let u = -14; u <= 20; u += 2) northRoof.push(ray(...cp(u, -47.5)));
  const porch: number[] = []; for (let u = -4; u <= 8; u += 2) for (const v of [-50.5, -53]) porch.push(ray(...cp(u, v)));
  const dtm = (cap.groundDtm as { u: number; v: number; dtm: number }[]).map(g => { const y = ray(...cp(g.u, g.v), 40); return { u: g.u, v: g.v, model: +y.toFixed(2), dtm: g.dtm, d: +(y - g.dtm).toFixed(2) }; });
  const dtmWorst = dtm.reduce((a, b) => Math.abs(b.d) > Math.abs(a.d) ? b : a, dtm[0]);
  const capitol = {
    starTip: +starTip.toFixed(2), starTipRef: cap.starTipY,
    peristyleDeck: ringMedian(14.4), peristyleRef: cap.peristyleDeckY,
    upperDrumCornice: ringMedian(11.6), upperDrumRef: cap.upperDrumCorniceY,
    lanternCap: ray(-308, 1266.5 + 1.2), lanternCapRef: cap.lanternCapY,
    northRoofMin: +Math.min(...northRoof).toFixed(2), northRoofRef: cap.northRoofY,
    porchDeckMedian: q(porch.slice().sort((a, b) => a - b), 0.5), porchRef: cap.porchDeckY,
    groundSamples: dtm.length, groundMedianAbs: q(dtm.map(d => Math.abs(d.d)).sort((a, b) => a - b), 0.5), groundWorst: dtmWorst,
  };
  report.capitol = capitol;
  if (Math.abs(capitol.starTip - cap.starTipY) > 0.3) failures.push(`Capitol star tip ${capitol.starTip} vs ${cap.starTipY}`);
  if (Math.abs(capitol.peristyleDeck - cap.peristyleDeckY) > 0.6) failures.push(`peristyle deck ${capitol.peristyleDeck} vs LiDAR ${cap.peristyleDeckY}`);
  if (Math.abs(capitol.upperDrumCornice - cap.upperDrumCorniceY) > 0.6) failures.push(`upper drum cornice ${capitol.upperDrumCornice} vs LiDAR ${cap.upperDrumCorniceY}`);
  if (Math.abs(capitol.lanternCap - cap.lanternCapY) > 1.0) failures.push(`lantern cap ${capitol.lanternCap} vs LiDAR ${cap.lanternCapY}`);
  if (!(capitol.northRoofMin >= cap.northRoofY - 1)) failures.push(`central block north edge (v -47.5) roof min ${capitol.northRoofMin} < ${cap.northRoofY - 1} (north face not at the measured line)`);
  if (Math.abs(capitol.porchDeckMedian - cap.porchDeckY) > 0.7) failures.push(`north entrance pavilion deck ${capitol.porchDeckMedian} vs LiDAR ${cap.porchDeckY}`);
  if (Math.abs(dtmWorst.d) > 0.9) failures.push(`grounds vs LiDAR DTM worst ${JSON.stringify(dtmWorst)}`);
  // Map travel lands outdoors (never under/on the Capitol roof).
  const trips: Record<string, unknown> = {};
  for (const [label, p] of [['CAP', [-278.335, 1179.898]], ['CAPS', [-363.0, 1433.0]], ['Capitol centre', [-308, 1266.5]], ['north entrance', cp(2, -60)]] as [string, P][]) {
    const t = scene.travel(p); trips[label] = t;
    if (!t.landing) failures.push(`travel ${label} found no landing`);
    else if (t.enclosed) failures.push(`travel ${label} landed enclosed ${JSON.stringify(t.landing)}`);
    else if (t.landing[1] > 6) failures.push(`travel ${label} landed at Y ${t.landing[1]} (roof?)`);
  }
  report.travel = trips;
  // 5. Strip ground.
  const entry = scene.blocks.installs.find((x: { id: string }) => x.id === 'b14-capitol');
  const own = new Set<number>((entry?.colliders ?? []).map((k: { handle: number }) => k.handle));
  const ownRay = (x: number, z: number) => { const h = physics.castRay(new RAPIER.Ray({ x, y: 80, z }, { x: 0, y: -1, z: 0 }), 200, true, undefined, undefined, player, undefined, (k: { handle: number }) => own.has(k.handle)); return h ? 80 - h.timeOfImpact : NaN; };
  const dtmD = (stripRef.dtmSamples as [number, number, number][]).map(([x, z, d]) => ownRay(x, z) - d).filter(Number.isFinite);
  const absD = dtmD.map(Math.abs).sort((a, b) => a - b);
  let contourWorst = 0;
  for (const [x, z] of stripRef.dtmSamples as [number, number, number][]) contourWorst = Math.max(contourWorst, Math.abs(scene.world.terrain.height(x, z) - ownRay(x, z)));
  // Seam: baked terrain (last row triangles) just north of z 1288 vs the patch just south.
  const terrain = scene.world.group.getObjectByName('Offline local contour terrain');
  const tp = terrain.geometry.getAttribute('position').array as Float32Array, rowTris: number[] = [];
  for (let t = 0; t < tp.length; t += 9) if (Math.max(tp[t + 2], tp[t + 5], tp[t + 8]) > 1287.9) rowTris.push(t);
  const baked = (x: number, z: number) => {
    for (const t of rowTris) {
      const ax = tp[t], ay = tp[t + 1], az = tp[t + 2], bx = tp[t + 3], by = tp[t + 4], bz = tp[t + 5], cx = tp[t + 6], cy = tp[t + 7], cz = tp[t + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(d) < 1e-9) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, w = 1 - u - v;
      if (u >= -1e-6 && v >= -1e-6 && w >= -1e-6) return u * ay + v * by + w * cy;
    }
    return NaN;
  };
  let seamN = 0, seamWorst = 0, seamAt: number[] = [];
  for (let x = -759; x < 1296; x += 2) {
    if (inCapitolGrounds(x, 1288.02)) continue;
    const a = baked(x, 1287.98), b = ownRay(x, 1288.02); if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    seamN++; const d = Math.abs(a - b) - 0.04 * 0.6; // minus the slope over the 4 cm sampling gap (<= 60 % grade)
    if (d > seamWorst) { seamWorst = d; seamAt = [x, +a.toFixed(3), +b.toFixed(3)]; }
  }
  // Grounds edge: authored grade just inside vs the patch just outside, along the rectangle sides south of z 1288.
  // Inside the 40 m seam fade the patch keeps the baked terrain's own offset to the grounds (root terrain already sits
  // up to ~3 m below the west lawn edge north of z 1288): reported as seamBandEdgeWorst, gated only south of z 1328.
  let edgeN = 0, edgeWorst = 0, edgeAt: number[] = [], bandWorst = 0, bandAt: number[] = [];
  const C2 = Math.cos(0.315), S2 = Math.sin(0.315), pt = (u: number, v: number): P => [-308 + C2 * u - S2 * v, 1266.5 + S2 * u + C2 * v];
  const sides: [number, number, number, number][] = [];
  for (let v = -105; v <= 215; v += 1) sides.push([-112, v, -1, 0], [112, v, 1, 0]);
  for (let u = -112; u <= 112; u += 1) sides.push([u, 215, 0, 1]);
  for (const [u, v, nu, nv] of sides) {
    const [xo, zo] = pt(u + nu * 0.03, v + nv * 0.03); if (zo < 1288.5) continue;
    const yo = stripGroundHeight(xo, zo); if (yo === null) continue;
    const [ui, vi] = capitolLocal(...pt(u - nu * 0.03, v - nv * 0.03)), yi = capitolGroundHeight(ui, vi);
    const d = Math.abs(yo - yi) - 0.06 * 0.06;
    if (zo < 1328) { if (d > bandWorst) { bandWorst = d; bandAt = [u, v, +zo.toFixed(1), +yi.toFixed(3), +yo.toFixed(3)]; } continue; }
    edgeN++;
    if (d > edgeWorst) { edgeWorst = d; edgeAt = [u, v, +yi.toFixed(3), +yo.toFixed(3)]; }
  }
  const strip = { dtmSamples: dtmD.length, dtmMedianAbs: q(absD, 0.5), dtmP95Abs: q(absD, 0.95), dtmMaxAbs: q(absD, 0.999), contourVsPhysicalWorst: +contourWorst.toFixed(4),
    seamSamples: seamN, seamWorstStep: +seamWorst.toFixed(3), seamWorstAt: seamAt, groundsEdgeSamples: edgeN, groundsEdgeWorstStep: +edgeWorst.toFixed(3), groundsEdgeWorstAt: edgeAt, seamBandEdgeWorst: +bandWorst.toFixed(3), seamBandEdgeAt: bandAt,
    install: scene.blocks.stats['b14-capitol'] };
  report.stripGround = strip;
  if (!(dtmD.length >= 380)) failures.push(`strip ground: only ${dtmD.length}/400 DTM samples hit the patch`);
  if (!(strip.dtmMedianAbs <= 0.15 && strip.dtmP95Abs <= 0.6)) failures.push(`strip ground vs DTM median ${strip.dtmMedianAbs} / P95 ${strip.dtmP95Abs}`);
  if (contourWorst > 0.02) failures.push(`contour height (terrain.height) differs from the physical patch by ${contourWorst.toFixed(3)} m`);
  if (seamN < 600 || seamWorst > 0.03) failures.push(`seam z 1288: ${seamN} samples, worst step ${seamWorst.toFixed(3)} at ${JSON.stringify(seamAt)}`);
  if (edgeN < 100 || edgeWorst > 0.10) failures.push(`grounds edge: ${edgeN} samples, worst step ${edgeWorst.toFixed(3)} at ${JSON.stringify(edgeAt)}`);
  // 6. Added City 2023 records.
  const adds = (b14Context as unknown as { add: { id: number; name: string; rings: P[][] }[] }).add;
  const sref = stripRef.records as Record<string, Rec & { roof: string; name: string; tiers: number }>;
  let generated = 0, roofOk = 0, roofChecked = 0; const roofBad: unknown[] = [], notGenerated: string[] = [], res: number[] = [];
  for (const a of adds) {
    const key = `${a.id}:add`, p = plans.get(key);
    if (!p || p.decision !== 'generated') { notGenerated.push(`${key} ${p?.decision ?? 'missing'}`); continue; }
    generated++;
    const r = sref[key]; if (!r || r.coverage < 0.6 || r.area < 40) continue;
    let tops = surface(a.rings[0]); if (tops.length < 4) tops = surface(a.rings[0], 0.4, 0.5);
    if (tops.length < 3) continue;
    roofChecked++;
    const m = { p10: q(tops, 0.1), p50: q(tops, 0.5), p90: q(tops, 0.9), max: q(tops, 0.999) };
    const ok = r.roof === 'flat'
      ? (Math.abs(m.p50 - r.roofY_P50) <= 2 || (Math.abs(m.p10 - r.roofY_P10) <= 2 && Math.abs(m.p90 - r.roofY_P90) <= 2)) && m.max <= r.roofY_max + 1.5
      : m.max >= r.roofY_P90 - 2 && m.max <= r.roofY_max + 1;
    res.push(Math.abs(m.p50 - r.roofY_P50));
    if (ok) roofOk++; else roofBad.push({ key, name: r.name, roof: r.roof, model: m, lidar: [r.roofY_P10, r.roofY_P50, r.roofY_P90, r.roofY_max] });
  }
  res.sort((a, b) => a - b);
  report.stripBuildings = { added: adds.length, generated, notGenerated, roofChecked, roofOk, medianAbsP50: q(res, 0.5), p90AbsP50: q(res, 0.9), roofBad: roofBad.slice(0, 12) };
  if (notGenerated.length) failures.push(`added records not generated: ${notGenerated.slice(0, 10).join(', ')}`);
  if (roofBad.length) failures.push(`${roofBad.length}/${roofChecked} added roofs off the LiDAR, e.g. ${JSON.stringify(roofBad.slice(0, 3))}`);
  // 7. Travel into the strip.
  const stripTrips: Record<string, unknown> = {};
  for (const [label, p] of [['Congress Ave at 11th', [-330, 1520]], ['west strip (Lavaca/Colorado)', [-600, 1440]], ['east strip (Brazos/San Jacinto)', [-60, 1470]], ['Waller Creek strip', [560, 1420]], ['east of I-35', [1150, 1360]]] as [string, P][]) {
    const t = scene.travel(p); stripTrips[label] = t;
    if (!t.landing) { failures.push(`travel ${label} found no landing`); continue; }
    const g = stripGroundHeight(t.landing[0], t.landing[2]);
    (t as Record<string, unknown>).patchY = g === null ? null : +g.toFixed(3);
    // travelLanding stands the player capsule centre 0.905 m above the ground it found.
    if (t.enclosed) failures.push(`travel ${label} landed enclosed ${JSON.stringify(t.landing)}`);
    else if (t.landing[2] > 1288 && (g === null || Math.abs(t.landing[1] - 0.905 - g) > 0.3)) failures.push(`travel ${label} landing ${JSON.stringify(t.landing)} not on the strip patch (patch ${g})`);
  }
  report.stripTravel = stripTrips;
  // 8 + 9. Group 4 district records.
  {
    const inst = scene.blocks.installs.find((x: { id: string }) => x.id === 'b14-capitol');
    const st = (inst?.install?.stats ?? {}) as Record<string, Record<string, unknown>>;
    for (const key of district) { if (plans.get(key)?.decision !== 'authored' || committed[key] !== 'b14-capitol') failures.push(`${key}: not a committed b14 replacement (${plans.get(key)?.decision} / ${committed[key]})`); }
    const data = scene.world.data;
    const baked = new BakedGround(terrain.geometry.getAttribute('position').array, 8, (x: number, z: number) => scene.world.terrain.height(x, z));
    const g = (x: number, z: number) => baked.height(x, z);
    const ownD = new Set<number>((inst?.colliders ?? []).map((k: { handle: number }) => k.handle));
    const dRay = (o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, reach: number) => { const h = physics.castRay(new RAPIER.Ray(o, d), reach, true, undefined, undefined, player, undefined, (k: { handle: number }) => ownD.has(k.handle)); return h ? h.timeOfImpact : NaN; };
    const down = (x: number, z: number, from: number) => { const t = dRay({ x, y: from, z }, { x: 0, y: -1, z: 0 }, 80); return Number.isNaN(t) ? NaN : from - t; };
    const probe = (e: Edge, s: number, y: number, out = 1, reach = 8) => dRay({ x: e.a[0] + e.u.x * s + e.n.x * out, y, z: e.a[1] + e.u.z * s + e.n.z * out }, { x: -e.n.x, y: 0, z: -e.n.z }, reach);
    const near = (a: number, b: number, tol = 0.03) => Math.abs(a - b) <= tol;
    const horiz = (o: P, dir: P, y: number, reach = 30) => dRay({ x: o[0], y, z: o[1] }, { x: dir[0], y: 0, z: dir[1] }, reach);
    type Geo = { getAttribute(n: string): { count: number; itemSize: number; array: ArrayLike<number> } | undefined };
    type M = { isMesh?: boolean; name: string; userData: { family?: string }; material: Record<string, unknown> & { color: { r: number; g: number; b: number } }; geometry: Geo };
    const all: [M, 'solid' | 'detail'][] = [];
    for (const [list, role] of [[inst?.install?.solids ?? [], 'solid'], [inst?.install?.detail ?? [], 'detail']] as const) for (const r of list) r.traverse((o: M) => { if (o.isMesh && /district/.test(o.name)) all.push([o, role]); });
    const d8: Record<string, unknown> = {};
    const gr = groundOf(data, DISTRICT_KEYS.granite, g), ga = groundOf(data, DISTRICT_KEYS.garage, g), hr = houseRoof(data, g);
    // inside rings
    { const res: Record<string, unknown> = {};
      for (const [name, ring, fasciaY] of [['granite', gr.ring, null], ['garage', ga.ring, null], ['blueHouse', hr.ring, [hr.E - 0.25, hr.E]]] as [string, P[], [number, number] | null][]) {
        const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]); let solidOut = 0, detailOut = 0, fascia = 0, worst = 0;
        for (const [m, role] of all) { const pa = m.geometry.getAttribute('position')!.array;
          for (let i = 0; i < pa.length; i += 3) { const x = pa[i], y = pa[i + 1], z = pa[i + 2]; if (x < Math.min(...xs) - 3 || x > Math.max(...xs) + 3 || z < Math.min(...zs) - 3 || z > Math.max(...zs) + 3) continue;
            if (pip(x, z, ring)) continue; const dd = ringDist(x, z, ring); worst = Math.max(worst, dd);
            if (role === 'detail') { if (dd > 0.05) detailOut++; continue; }
            if (dd <= 0.02) continue;
            if (fasciaY && dd <= 0.45 && y >= fasciaY[0] - 1e-3 && y <= fasciaY[1] + 1e-3) { fascia++; continue; }
            solidOut++; } }
        res[name] = { solidVerticesOutside: solidOut, detailVerticesOutside: detailOut, fasciaVerticesOutside: fascia, worst: +worst.toFixed(3) };
        if (solidOut || detailOut) failures.push(`${name}: ${solidOut} solid / ${detailOut} detail vertices outside the City ring (worst ${worst.toFixed(3)} m)`);
        if (fasciaY && !fascia) failures.push(`${name}: no eave fascia found outside the ring`);
      }
      d8.insideRings = res; }
    // 656265:920 FINAL correction (granite.ts): source-derived roof volumes vs the registered 2017 DSM, pavilion / hip
    // silhouettes, podium / ledge / deck bands, arches, colour.
    { const s = st.granite as { arches: { face: string; a: P; u: P; n: P; s: number; r: number; y0: number; spring: number }[] }, plan = d34Plan(data), roofs = d34Roofs(plan);
      const dsm = d34Ref as unknown as { samples: [number, number, number, string][] }, per: Record<string, number[]> = {}, signed: number[] = [];
      for (const [x, z, y, f] of dsm.samples) { const d = down(x, z, 40) - y; (per[f] ??= []).push(Math.abs(d)); signed.push(d); }
      const med = (v: number[]) => { const w = v.slice().sort((p, q) => p - q); return w.length ? w[Math.floor(w.length / 2)] : NaN; }, p90 = (v: number[]) => { const w = v.slice().sort((p, q) => p - q); return w[Math.floor(w.length * 0.9)]; };
      const dsmReport = Object.fromEntries(Object.entries(per).map(([f, v]) => [f, { n: v.length, medianAbs: +med(v).toFixed(3), p90Abs: +p90(v).toFixed(3) }]));
      const allAbs = Object.values(per).flat(), badF = Object.entries(dsmReport).filter(([, r]) => !(r.medianAbs <= 0.4)).map(([f]) => f);
      // pavilions: exact pyramid peak, raised >= 3 m above the ledge, standing on the ring line above the ledge
      const pav = roofs.pav.map((r, k) => { const c: P = [(r.ring[0][0] + r.ring[2][0]) / 2, (r.ring[0][1] + r.ring[2][1]) / 2], top = down(c[0], c[1], 40);
        const xs = r.ring.map(q => q[0]), zs = r.ring.map(q => q[1]); let mx = -Infinity, off = 0, n = 0;
        for (let x = Math.min(...xs); x < Math.max(...xs); x += 0.25) for (let z = Math.min(...zs); z < Math.max(...zs); z += 0.25) { if (!pip(x, z, r.ring) || ringDist(x, z, r.ring) < 0.1) continue; n++; const y = down(x, z, 40); mx = Math.max(mx, y); if (!(Math.abs(y - roofY(r.spec, x, z)) <= 0.02)) off++; }
        const uc = (plan.uv(c)[0]), front = horiz(plan.P(uc, -1), plan.V, (D34.ledge + r.eave) / 2);
        return { peak: +top.toFixed(3), want: r.peak, eave: +r.eave.toFixed(3), max: +mx.toFixed(3), samples: n, offExactPyramid: off, frontHitAt1m: +front.toFixed(3), k }; });
      const between = horiz(plan.P((D34.pavN[1] + D34.pavS[0]) / 2, -1), plan.V, (D34.ledge + roofs.pav[0].eave) / 2);
      // central copper hip on the attic
      let hipN = 0, hipOff = 0, hipMax = -Infinity; { const r = roofs.attic, xs = r.ring.map(q => q[0]), zs = r.ring.map(q => q[1]);
        for (let x = Math.min(...xs); x < Math.max(...xs); x += 0.5) for (let z = Math.min(...zs); z < Math.max(...zs); z += 0.5) { if (!pip(x, z, r.ring) || ringDist(x, z, r.ring) < 0.3) continue; hipN++; const y = down(x, z, 40); hipMax = Math.max(hipMax, y); if (!(Math.abs(y - roofY(r.spec, x, z)) <= 0.02)) hipOff++; } }
      // podium / ledge / deck bands
      const at = (pl: P[]) => { const c = pl.reduce((m, q) => [m[0] + q[0] / pl.length, m[1] + q[1] / pl.length], [0, 0]); return down(c[0], c[1], 40); };
      const podium = ([[1.8, 1.6], [14, 1.6], [26.9, 1.6], [29.9, 4.3]] as P[]).map(([u, v]) => +down(...plan.P(u, v), 40).toFixed(3)), links = plan.link.map(r => +at(r).toFixed(3)); // podium interiors (frame u, v)
      let ledgeN = 0, ledgeOk = 0; for (const [ch, inn] of [[plan.chain1, plan.in1], [plan.chain2, plan.in2]] as [P[], P[]][]) for (let i = 0; i + 1 < ch.length; i++) {
        const L = Math.hypot(ch[i + 1][0] - ch[i][0], ch[i + 1][1] - ch[i][1]); if (L < 1.5) continue; for (let t = 0.2; t <= 0.8; t += 0.2) { ledgeN++;
          const x = (ch[i][0] + (ch[i + 1][0] - ch[i][0]) * t + inn[i][0] + (inn[i + 1][0] - inn[i][0]) * t) / 2, z = (ch[i][1] + (ch[i + 1][1] - ch[i][1]) * t + inn[i][1] + (inn[i + 1][1] - inn[i][1]) * t) / 2;
          if (near(down(x, z, 40), D34.ledge, 0.02)) ledgeOk++; } }
      // arches (per face: west 2 between the pavilions, east 3, north 1, south 1)
      let open = 0, crown = 0, piers = 0; const faces: Record<string, number> = {};
      for (const a of s?.arches ?? []) { faces[a.face] = (faces[a.face] ?? 0) + 1; const e = { a: a.a, c: a.a, L: 0, u: { x: a.u[0], y: 0, z: a.u[1] }, n: { x: a.n[0], y: 0, z: a.n[1] }, i: -1 } as unknown as Edge, ym = (a.y0 + a.spring) / 2;
        if (near(probe(e, a.s, ym), 1 + D34.recess)) open++; if (near(probe(e, a.s, a.spring + a.r + 0.6), 1)) crown++;
        if (near(probe(e, a.s - a.r - 0.5, ym), 1) && near(probe(e, a.s + a.r + 0.5, ym), 1)) piers++; }
      // colour: rendered granite albedo (vertex colour, sRGB) of the D34 granite walls is pale pink, not dark saturated red
      const gcol = new THREE.Color(...(['r', 'g', 'b'] as const).map(k => col('granite')[k]) as [number, number, number]).convertLinearToSRGB();
      const rgb = [gcol.r, gcol.g, gcol.b].map(v => Math.round(v * 255)), sat = (Math.max(...rgb) - Math.min(...rgb)) / Math.max(...rgb);
      d8.granite = { dsm: dsmReport, dsmOverallMedianAbs: +med(allAbs).toFixed(3), dsmSignedMedian: +med(signed).toFixed(3), pavilions: pav, betweenPavilionsHitAt: +between.toFixed(3), centralHip: { samples: hipN, offExactHip: hipOff, max: +hipMax.toFixed(3), ridge: +roofs.attic.ridge.toFixed(3), eave: D34.eave },
        podium, links, ledge: { samples: ledgeN, at2152: ledgeOk }, arches: { n: s?.arches?.length ?? 0, faces, open, crown, piers }, graniteSRGB: rgb, graniteSaturation: +sat.toFixed(3) };
      if (badF.length || !(med(allAbs) <= 0.25) || !(Math.abs(med(signed)) <= 0.25)) failures.push(`656265:920 physical roof vs registered DSM: features ${JSON.stringify(badF)} median |d| > 0.4, overall ${med(allAbs).toFixed(3)}, signed ${med(signed).toFixed(3)}`);
      for (const p of pav) if (!(Math.abs(p.peak - p.want) <= 0.03) || !(p.max <= p.want + 0.001) || p.offExactPyramid || !(p.want - D34.ledge >= 3.0) || !near(p.frontHitAt1m, 1)) failures.push(`656265:920 pavilion ${p.k}: ${JSON.stringify(p)}`);
      if (!near(between, 1 + D34.attic[2], 0.05)) failures.push(`656265:920 west silhouette between the pavilions hits at ${between} (expected the attic at ${1 + D34.attic[2]})`);
      if (!hipN || hipOff || !(Math.abs(hipMax - roofs.attic.ridge) <= 0.03) || !(roofs.attic.ridge <= 27.95 + 0.05)) failures.push(`656265:920 central hip: ${hipOff}/${hipN} off exact, max ${hipMax.toFixed(3)} vs ridge ${roofs.attic.ridge.toFixed(3)} (LiDAR max 27.95)`);
      if (podium.some(v => !near(v, D34.podium, 0.02)) || !near(links[0], D34.linkTop[0], 0.02) || !near(links[1], D34.linkTop[1], 0.02) || ledgeOk !== ledgeN || ledgeN < 30) failures.push(`656265:920 bands: podium ${JSON.stringify(podium)}, links ${JSON.stringify(links)}, ledge ${ledgeOk}/${ledgeN}`);
      if ((s?.arches?.length ?? 0) !== 7 || faces.west !== 2 || faces.east !== 3 || faces.north !== 1 || faces.south !== 1 || open !== 7 || crown !== 7 || piers !== 7) failures.push(`656265:920 arches ${JSON.stringify({ n: s?.arches?.length, faces, open, crown, piers })}`);
      if (!(rgb[0] >= 185 && sat <= 0.35)) failures.push(`656265:920 granite colour ${JSON.stringify(rgb)} (saturation ${sat.toFixed(3)}) not the pale pink of the frames`); }
    // 624194:789 garage
    { const s = st.garage as { levels: number; levelHeight: number; grade: number; faces: { edge: number; open: [number, number][] }[] }, es = edgesOf(ga.ring), m = massingOf(DISTRICT_KEYS.garage);
      let bays = 0, bayOpen = 0, bands = 0, bandSolid = 0, cols = 0, colSolid = 0;
      for (const f of s?.faces ?? []) { const e = es.find(x => x.i === f.edge)!;
        for (let i = 0; i < s.levels; i++) { const top = s.grade + (i + 1) * s.levelHeight, o1 = top - GARAGE.spandrel, o0 = i ? s.grade + i * s.levelHeight : o1 - 1.5, ym = (o0 + o1) / 2;
          f.open.forEach(([a, b], j) => { bays++; if (near(probe(e, (a + b) / 2, ym), 1 + GARAGE.recess)) bayOpen++; bands++; if (near(probe(e, (a + b) / 2, top - GARAGE.spandrel / 2), 1)) bandSolid++;
            if (j) { cols++; if (near(probe(e, (f.open[j - 1][1] + a) / 2, ym), 1)) colSolid++; } }); } }
      let deckN = 0, deckOk = 0; const gx = ga.ring.map(p => p[0]), gz = ga.ring.map(p => p[1]);
      for (let x = Math.min(...gx) + 1; x < Math.max(...gx); x += 2) for (let z = Math.min(...gz) + 1; z < Math.max(...gz); z += 2) {
        if (!pip(x, z, ga.ring) || ringDist(x, z, ga.ring) < 1 || pip(x, z, m.tier) || ringDist(x, z, m.tier) < 0.5) continue; deckN++; if (near(down(x, z, m.tierTop + 5), m.deck, 0.02)) deckOk++; }
      let towerN = 0, towerOk = 0; for (let x = Math.min(...m.tier.map(p => p[0])); x < Math.max(...m.tier.map(p => p[0])); x += 0.5) for (let z = Math.min(...m.tier.map(p => p[1])); z < Math.max(...m.tier.map(p => p[1])); z += 0.5) {
        if (!pip(x, z, m.tier) || ringDist(x, z, m.tier) < 0.3) continue; towerN++; if (near(down(x, z, m.tierTop + 5), m.tierTop, 0.02)) towerOk++; }
      d8.garage = { levels: s?.levels, levelHeight: s?.levelHeight, faces: s?.faces?.length, bays, bayOpenAtRecess: bayOpen, spandrelBands: bands, spandrelSolid: bandSolid, columns: cols, columnsSolid: colSolid, deck: { samples: deckN, atFrozenDeck: deckOk, y: m.deck }, stairTower: { samples: towerN, atFrozenTop: towerOk, y: m.tierTop } };
      if (!s?.faces?.length || bays < 150 || bayOpen !== bays || bandSolid !== bands || colSolid !== cols || cols < 20) failures.push(`624194:789 garage rhythm: bays ${bayOpen}/${bays} open, spandrels ${bandSolid}/${bands}, columns ${colSolid}/${cols}`);
      if (deckOk < deckN * 0.98 || towerOk < towerN * 0.98) failures.push(`624194:789 deck ${deckOk}/${deckN}, stair tower ${towerOk}/${towerN}`); }
    // 467902:75 blue house
    { const s = st.blueHouse as { ridgeTop: number; grade: number; porch: { edge: number; s: [number, number]; depth: number; floorY: number; ceilingY: number; columns: number[] } }, es = edgesOf(hr.ring);
      const want = hr.grade + HOUSE.cityH; let max = -Infinity, n = 0, above = 0, off = 0;
      const xs = hr.ring.map(p => p[0]), zs = hr.ring.map(p => p[1]);
      for (let x = Math.min(...xs) + 0.125; x < Math.max(...xs); x += 0.25) for (let z = Math.min(...zs) + 0.125; z < Math.max(...zs); z += 0.25) {
        if (!pip(x, z, hr.ring) || ringDist(x, z, hr.ring) < 0.05) continue; n++; const y = down(x, z, want + 6); max = Math.max(max, y); if (y > want + 0.01) above++; if (!(Math.abs(y - roofY(hr.spec, x, z)) <= 0.02)) off++; }
      const p = s?.porch, e = p ? es.find(x => x.i === p.edge)! : undefined, c = p?.columns ?? [];
      const porchOpen = e ? probe(e, (c[1] + c[2]) / 2, p!.floorY + 1.5) : NaN, posts = e ? c.map(x => probe(e, x, p!.floorY + 1.5)) : [];
      const upper = e ? probe(e, (c[1] + c[2]) / 2, (p!.ceilingY + hr.E) / 2) : NaN;
      const at = (sAlong: number, d: number): [number, number] => [e!.a[0] + e!.u.x * sAlong + e!.n.x * d, e!.a[1] + e!.u.z * sAlong + e!.n.z * d];
      const floorY = e ? down(...at((c[1] + c[2]) / 2, -1), p!.floorY + 1) : NaN;
      const ceil = e ? (() => { const [x, z] = at((c[1] + c[2]) / 2, -1); const t = dRay({ x, y: p!.floorY + 1, z }, { x: 0, y: 1, z: 0 }, 5); return p!.floorY + 1 + t; })() : NaN;
      const eaves = es.filter(x => Math.abs(x.u.x) > 0.7 && x.L > 5), fasciaHits = eaves.map(x => probe(x, x.L / 2, hr.E - 0.12));
      d8.blueHouse = { grade: +hr.grade.toFixed(3), cityH: HOUSE.cityH, wantTop: +want.toFixed(3), statsTop: s?.ridgeTop, physicalMax: +max.toFixed(3), samples: n, aboveTop: above, offExactGable: off, gableSlope: +hr.slope.toFixed(5),
        porch: { open: +porchOpen.toFixed(3), posts: posts.map(v => +v.toFixed(3)), upperStorey: +upper.toFixed(3), floor: +floorY.toFixed(3), ceiling: +ceil.toFixed(3) }, fascia: fasciaHits.map(v => +v.toFixed(3)) };
      if (!(Math.abs(max - want) <= 0.05) || above || off) failures.push(`467902:75 ridge ${max.toFixed(3)} vs grade + City h ${want.toFixed(3)}; ${above} above, ${off}/${n} off the exact gable`);
      if (!p || !near(porchOpen, 1 + p.depth) || posts.length !== 4 || posts.some(v => !near(v, 1)) || !near(upper, 1) || !near(floorY, p.floorY, 0.02) || !near(ceil, p.ceilingY, 0.02)) failures.push(`467902:75 porch ${JSON.stringify(d8.blueHouse)}`);
      if (eaves.length !== 2 || fasciaHits.some(v => !near(v, 0.7))) failures.push(`467902:75 eave fascia hits ${JSON.stringify(fasciaHits)}`); }
    // exact slopes of sloped district roofs
    { let sloped = 0, offS = 0, worst = 0; const slopes = [D34.slope, hr.slope];
      for (const [m, role] of all) { if (role !== 'solid') continue; const P2 = m.geometry.getAttribute('position')!.array;
        for (let i = 0; i < P2.length; i += 9) { const ux = P2[i + 3] - P2[i], uy = P2[i + 4] - P2[i + 1], uz = P2[i + 5] - P2[i + 2], wx = P2[i + 6] - P2[i], wy = P2[i + 7] - P2[i + 1], wz = P2[i + 8] - P2[i + 2];
          let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const l = Math.hypot(nx, ny, nz); if (l / 2 < 0.05) continue;
          const Lmax = Math.max(Math.hypot(ux, uy, uz), Math.hypot(wx, wy, wz), Math.hypot(wx - ux, wy - uy, wz - uz)); if (l / Lmax < 0.25) continue;
          nx /= l; ny /= l; nz /= l; if (ny < 0.5 || ny > 0.999) continue; sloped++; const dev = Math.min(...slopes.map(v => Math.abs(Math.hypot(nx, nz) / ny - v))); worst = Math.max(worst, dev); if (dev > 0.003) offS++; } }
      d8.slopes = { sloped, offModelledSlopes: offS, worst: +worst.toFixed(4), modelled: slopes.map(v => +v.toFixed(5)) };
      if (!sloped || offS) failures.push(`district roofs: ${offS}/${sloped} sloped triangles off the modelled exact slopes`); }
    report.district = d8;
    // 9. Materials, budget, exact render = collision.
    let uvBad = 0, scaleBad = 0, scaleN = 0; const texIssues: string[] = [], fam: Record<string, number> = {}, textures = new Set<unknown>();
    for (const [m, role] of all) {
      const pos = m.geometry.getAttribute('position')!, uv = m.geometry.getAttribute('uv'), f = m.userData.family ?? 'none', n = pos.count / 3; fam[`${role}:${f}`] = n;
      if (!uv || uv.count !== pos.count) { texIssues.push(`${m.name}: uv missing`); continue; }
      for (let i = 0; i < uv.array.length; i++) if (!Number.isFinite(uv.array[i])) uvBad++;
      for (let t = 0; t < n; t++) for (let e = 0; e < 3; e++) { const i = t * 3 + e, j = t * 3 + (e + 1) % 3, P2 = pos.array, U = uv.array, L = Math.hypot(P2[j * 3] - P2[i * 3], P2[j * 3 + 1] - P2[i * 3 + 1], P2[j * 3 + 2] - P2[i * 3 + 2]); if (L < 0.2) continue; scaleN++; if (Math.abs(Math.hypot(U[j * 2] - U[i * 2], U[j * 2 + 1] - U[i * 2 + 1]) - L) > 2e-3 + 1e-3 * L) scaleBad++; }
      const mat = m.material;
      if (f === 'glass' || f === 'trim') { if (mat.map || mat.normalMap || mat.roughnessMap) texIssues.push(`${m.name}: ${f} must carry no maps`); continue; }
      const spec = PBR[f as keyof typeof PBR], ct = TEXTURES[f as keyof typeof TEXTURES];
      if (!spec || !ct) { texIssues.push(`${m.name}: unknown family ${f}`); continue; }
      if (spec.tile !== ct.tile || spec.linearMean.some((v, i) => v !== ct.linearMean[i])) texIssues.push(`${f}: tile / linear mean differ from context TEXTURES`);
      if ([mat.color.r, mat.color.g, mat.color.b].some((v, i) => Math.abs(v - 1 / ct.linearMean[i]) > 1e-4)) texIssues.push(`${m.name}: colour is not the 1 / linear-mean gain`);
      (['map', 'normalMap', 'roughnessMap'] as const).forEach((slot, k) => {
        const tx = mat[slot] as { userData?: { src?: string }; repeat?: { x: number; y: number } } | undefined, src = tx?.userData?.src, wantSrc = `/assets/materials/context/${f}-${['color', 'normal', 'rough'][k]}.jpg`;
        textures.add(tx);
        if (src !== wantSrc) texIssues.push(`${m.name}.${slot}: ${src} (expected ${wantSrc})`);
        else if (!existsSync(resolve(process.cwd(), 'public' + src))) texIssues.push(`${m.name}.${slot}: ${src} missing under public/`);
        if (!tx?.repeat || Math.abs(tx.repeat.x - 1 / ct.tile) > 1e-9 || Math.abs(tx.repeat.y - 1 / ct.tile) > 1e-9) texIssues.push(`${m.name}.${slot}: repeat is not 1 / tile`);
      });
    }
    // per-feature families (solid triangles by ring and orientation)
    const famIn = (ring: P[], test: (ny: number, y: number) => boolean) => { const counts: Record<string, number> = {};
      for (const [m, role] of all) { if (role !== 'solid') continue; const P2 = m.geometry.getAttribute('position')!.array;
        for (let i = 0; i < P2.length; i += 9) { const cx = (P2[i] + P2[i + 3] + P2[i + 6]) / 3, cy = (P2[i + 1] + P2[i + 4] + P2[i + 7]) / 3, cz = (P2[i + 2] + P2[i + 5] + P2[i + 8]) / 3;
          if (ringDist(cx, cz, ring) > 0.6 && !pip(cx, cz, ring)) continue;
          const ux = P2[i + 3] - P2[i], uy = P2[i + 4] - P2[i + 1], uz = P2[i + 5] - P2[i + 2], wx = P2[i + 6] - P2[i], wy = P2[i + 7] - P2[i + 1], wz = P2[i + 8] - P2[i + 2], ny = (uz * wx - ux * wz) / (Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) || 1);
          if (test(Math.abs(ny), cy)) counts[m.userData.family ?? 'none'] = (counts[m.userData.family ?? 'none'] ?? 0) + 1; } }
      return counts; };
    const dom = (c: Record<string, number>) => Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0];
    const features = { graniteWalls: famIn(gr.ring, (ny, y) => ny < 0.1 && y < 20), copperRoofs: famIn(gr.ring, (ny, y) => ny > 0.5 && ny < 0.999 && y > 23), garageWalls: famIn(ga.ring, ny => ny < 0.1), houseWalls: famIn(hr.ring, (ny, y) => ny < 0.1 && y < hr.E - 0.3), houseRoof: famIn(hr.ring, ny => ny > 0.5 && ny < 0.999) };
    const wantFam: Record<keyof typeof features, string> = { graniteWalls: 'limestone', copperRoofs: 'metal', garageWalls: 'precast', houseWalls: 'siding', houseRoof: 'shingle' };
    // exact render = collision: district solids vs the district collider (the strip ground keeps its own collider)
    const triKey = (v: number[]) => [0, 1, 2].map(i => `${v[i * 3].toFixed(3)},${v[i * 3 + 1].toFixed(3)},${v[i * 3 + 2].toFixed(3)}`).sort().join('|');
    const counts = new Map<string, number>();
    for (const [m, role] of all) if (role === 'solid') { const P2 = m.geometry.getAttribute('position')!.array; for (let o = 0; o < P2.length; o += 9) { const k2 = triKey(Array.from({ length: 9 }, (_, i) => P2[o + i])); counts.set(k2, (counts.get(k2) ?? 0) + 1); } }
    const want = (st as Record<string, unknown>).districtColliderTriangles as number;
    const dc = (inst?.colliders ?? []).filter((c: { shape: { indices?: Uint32Array } }) => c.shape.indices && c.shape.indices.length / 3 === want) as { shape: { vertices: Float32Array; indices: Uint32Array } }[];
    let collOnly = 0, collN = 0;
    if (dc.length !== 1) failures.push(`district collider: ${dc.length} colliders with ${want} triangles (expected 1)`);
    for (const c of dc) { const Vv = c.shape.vertices, I = c.shape.indices;
      for (let k = 0; k < I.length; k += 3) { collN++; const k2 = triKey([0, 1, 2].flatMap(e => [Vv[I[k + e] * 3], Vv[I[k + e] * 3 + 1], Vv[I[k + e] * 3 + 2]])); const n2 = counts.get(k2) ?? 0; if (n2 > 0) counts.set(k2, n2 - 1); else collOnly++; } }
    const renderOnly = [...counts.values()].reduce((a, b) => a + b, 0), draws = (st as Record<string, unknown>).draws as number;
    report.materials = { districtFamilies: fam, uvNonFinite: uvBad, uvScaleSamples: scaleN, uvScaleBad: scaleBad, textureIssues: texIssues.slice(0, 5), textures: textures.size, draws, featureFamilies: features, colliderTriangles: collN, colliderOnly: collOnly, renderOnly };
    if (!all.length) failures.push('no district meshes');
    if (uvBad) failures.push(`${uvBad} non-finite district uv values`);
    if (scaleBad) failures.push(`${scaleBad}/${scaleN} district uv edges not at metre scale`);
    for (const x of texIssues.slice(0, 8)) failures.push(x);
    for (const [k, f] of Object.entries(wantFam) as [keyof typeof features, string][]) if (dom(features[k]) !== f) failures.push(`${k} family ${dom(features[k])} (expected ${f})`);
    if (!(draws <= 12)) failures.push(`b14 draw calls ${draws} > budget 12`);
    if (textures.size > 18) failures.push(`b14 textures ${textures.size} > budget 18`);
    if (collOnly || renderOnly || !collN) failures.push(`render != collision: ${collOnly} collider-only, ${renderOnly} render-only district solid triangles (of ${collN})`);
  }
  return { ok: failures.length === 0, report, failures };
};
