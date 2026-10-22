import './stubs.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const mod = await import(pathToFileURL(resolve(import.meta.dirname, '../../.work/harness-dist/context-check.mjs')).href);
const { run } = mod;
const result = await run();
const { stats, vertices, nonFinite } = result;
console.log(JSON.stringify({ ...stats, vertices, nonFinite }, null, 1));
console.log('GROUND-TIE-INS', JSON.stringify(result.tieIns?.stats ?? 'off'));
if (process.argv.includes('--details')) {
  const rows = result.plans.filter(p => p.decision !== 'generated' || p.building.abbr).map(p => [p.building.id, p.building.abbr, p.decision, p.style ?? '', p.elevatedFraction.toFixed(2), p.perimeterFraction.toFixed(2), p.groundFraction.toFixed(2)].join(' '));
  console.log(rows.join('\n'));
}
if (nonFinite) { console.error('non-finite generated vertices'); process.exit(1); }
let contextFailed = false;
{
  // Catalogue-driven architecture: coverage, scale plausibility, budgets, detail layer, visible/physical agreement.
  const { context } = result;
  const s = context.stats;
  console.log('CATALOG basis (generated buildings)', JSON.stringify(s.basis), 'catalogue-wide', JSON.stringify(s.catalogBasis));
  console.log('MASSING', JSON.stringify(s.massing), 'roofs-lidar', s.roofsLidar, 'tiers', s.tierVolumes, 'mech', s.mechVolumes, 'estimated-mech', s.estimatedMech);
  console.log('TRIANGLES-BY-ARCHETYPE', JSON.stringify(s.trianglesByArchetype));
  const shellDraws = Object.values(s.drawCallsByMaterial).reduce((a, b) => a + b, 0);
  console.log('DRAW-CALLS shell meshes', shellDraws, JSON.stringify(s.drawCallsByMaterial));
  // <scale-contracts> pure and import-free (extracted verbatim by .work/scale-contracts/scale-test.mjs).
  // Storey heights: non-residential 3.4-4.9 m (3.0-6.5 for halls/garages/service), residential 2.9-3.9 m.
  // Window/ground opening height / storey height: 0.35-0.60 (none/open/glazed and special archetypes skipped); doors 2.1-3.2 m.
  // SCALE_CONTRACTS replace one bound for ONE namespaced archetype and ONE dimension only. Each interval documents the authored
  // interpretation of a cited UT / architect / developer photograph or research tile frame: visual estimates, NOT facade surveys.
  // The exact-name residential / hotel contracts below reuse the existing residential interval; their namespace does not
  // change the generic classifier. Nominal, window-type and
  // reference guards fail the check if the authored values or evidence drift, so a contract cannot silently cover other values.
  const PHOTOS = 'research/whole-campus-92/screenshot-dataset/online-photos/';
  const SCALE_CONTRACTS = [
    { id: 'storey.residence-hall', archetype: 'b07-wcp-gregory:residence-hall', dim: 'storey', range: [2.9, 3.9],
      nominal: { floor: 3.5, groundFloor: 3.9 }, ref: ['ut-rhd-420', 'ut-mhd-421', 'ut-sjh-399'],
      evidence: ['ut-rhd-420', 'ut-mhd-421', 'ut-sjh-399'].map(k => `${PHOTOS}${k}-directory-photo.jpg`),
      why: 'residence halls: existing residential bounds; authored 3.5 m, fitted upper storeys 3.357-3.672 m' },
    { id: 'storey.winship-hall', archetype: 'b03-gdc-speedway:winship-brick', dim: 'storey', range: [3.4, 5.0],
      nominal: { floor: 4.5, groundFloor: 5.5 }, ref: ['ut-win-564'], evidence: [`${PHOTOS}ut-win-564-directory-photo.jpg`],
      why: 'authored 4.5 m storeys over a 5.5 m lobby; fitting to the building height stretches upper storeys to 4.936 m (x1.097)' },
    { id: 'window.ua9', archetype: 'b02-sciences:ua9-brick', dim: 'window', range: [0.25, 0.30],
      nominal: { type: 'punched', sill: 1.2, head: 2.2, floor: 3.6 }, ref: ['ut-ua9-461'], evidence: [`${PHOTOS}ut-ua9-461-directory-photo.jpg`],
      why: 'mostly blank tan brick walls with a few small windows (1.0/3.6)' },
    { id: 'window.lth', archetype: 'b03-gdc-speedway:lab-theater', dim: 'window', range: [0.25, 0.30],
      nominal: { type: 'punched', sill: 1.4, head: 2.6, floor: 4.6 }, ref: ['ut-lth-446'], evidence: [`${PHOTOS}ut-lth-446-directory-photo.jpg`],
      why: 'pale walls with very few small openings (1.2/4.6)' },
    { id: 'ground.lth', archetype: 'b03-gdc-speedway:lab-theater', dim: 'ground', range: [0.30, 0.33],
      nominal: { type: 'punched', sill: 1.0, head: 2.4, floor: 4.6 }, ref: ['ut-lth-446'], evidence: [`${PHOTOS}ut-lth-446-directory-photo.jpg`],
      why: 'sparse small ground openings beside the glazed entry (1.4/4.6)' },
    { id: 'window.win', archetype: 'b03-gdc-speedway:winship-brick', dim: 'window', range: [0.30, 0.34],
      nominal: { type: 'punched', sill: 1.2, head: 2.6, floor: 4.5 }, ref: ['ut-win-564'], evidence: [`${PHOTOS}ut-win-564-directory-photo.jpg`],
      why: 'small punched windows in brick above the tall glazed lobby and deep canopy (1.4/4.5)' },
    { id: 'ground.ccj', archetype: 'b08-east-north:ccj-limestone', dim: 'ground', range: [0.65, 0.70],
      nominal: { type: 'punched', sill: 0.5, head: 3.8, floor: 4.8 }, ref: ['ut-ccj-484'], evidence: [`${PHOTOS}ut-ccj-484-directory-photo.jpg`],
      why: 'tall recessed lower windows between limestone pilasters (3.3/4.8)' },

    // West Campus identity profiles retain measured envelopes; these namespaced residential / hotel facades must use the
    // same storey interval as wc-tower / modernist-dorm, not the generic office minimum (3.4 m). Literal nominal and reference
    // guards keep this classification bounded to the reviewed profile; it does not classify arbitrary b12:* archetypes.
    { id: 'storey.west-signature-1909', archetype: 'b12-west-campus:signature-1909', dim: 'storey', range: [2.9, 3.9],
      nominal: { floor: 3.15, groundFloor: 4.6 }, ref: ['d27-orbit-southeast', 'west-extension-c4-r5'],
      evidence: ['research/whole-campus-92/screenshot-dataset/collections/district-orbits-30m/captures/d27-orbit-southeast.jpg'],
      why: 'residential tower profile: ribbon-window rhythm interpreted from the cited frames; fitted 3.230 m within the existing residential interval' },
    { id: 'storey.west-21-rio', archetype: 'b12-west-campus:21-rio', dim: 'storey', range: [2.9, 3.9],
      nominal: { floor: 3.15, groundFloor: 4.6 }, ref: ['b12-r0-a4-30m-r2', 'd27-orbit-southeast'],
      evidence: ['research/whole-campus-92/screenshot-dataset/collections/district-orbits-30m/captures/d27-orbit-southeast.jpg'],
      why: 'residential tower profile: large glazed bays interpreted from the cited frames; fitted 3.231 m, not an office storey' },
    { id: 'storey.west-union-san-antonio', archetype: 'b12-west-campus:union-san-antonio', dim: 'storey', range: [2.9, 3.9],
      nominal: { floor: 3.2, groundFloor: 4.6 }, ref: ['Greystar photo 20476BDG1', 'silver standing-seam'],
      evidence: ['https://www.greystar.com/union-on-san-antonio-austin-tx/p_20476'],
      why: 'residential tower: reviewed partial finished-facade photo supports storey-high glazed balcony doors and silver panels; fitted 3.202 m' },
    { id: 'storey.west-doubletree', archetype: 'b12-west-campus:doubletree', dim: 'storey', range: [2.9, 3.9],
      nominal: { floor: 3.1, groundFloor: 5 }, ref: ['d34-orbit-southeast', 'precast hotel'],
      evidence: ['research/whole-campus-92/screenshot-dataset/collections/district-orbits-30m/captures/d34-orbit-southeast.jpg'],
      why: 'hotel guest-room tower, not an office: regular punched-window rhythm in the cited frames; nominal 3.1 m is an estimate, fitted 3.105 m' },
    { id: 'storey.west-rise', archetype: 'b12-west-campus:rise', dim: 'storey', range: [2.9, 3.9],
      nominal: { floor: 3.15, groundFloor: 7.5 }, ref: ['GMI_RISE_Kristian-Alveo_Hires-1', 'dense small dark/blue punched windows'],
      evidence: ['https://gmitexas.com/project/rise-at-west-campus/'],
      why: 'residential tower above a screen podium: GMI photograph supports dense punched windows; fitted 3.146 m within existing residential bounds' },
    { id: 'storey.west-waterloo', archetype: 'b12-west-campus:waterloo', dim: 'storey', range: [2.9, 3.9],
      nominal: { floor: 3.15, groundFloor: 15 }, ref: ['LV Collective developer photo DSC06440', 'large blue glass bays'],
      evidence: ['https://lvcollective.com/rendering-reality-waterloo/'],
      why: 'residential tower above a tall masonry podium: developer photograph supports large glazed bays; fitted 3.102 m' },
    { id: 'storey.west-villas-on-rio', archetype: 'b12-west-campus:villas-on-rio', dim: 'storey', range: [2.9, 3.9],
      nominal: { floor: 3.15, groundFloor: 4.6 }, ref: ['b12-r0-a4-30m-r2', 'white sawtooth-stepped facade'],
      evidence: ['research/whole-campus-92/screenshot-dataset/collections/low-altitude-30m/'],
      why: 'residential tower facade interpreted from the cited research frame; fitted 3.130 m within existing residential bounds' },
    { id: 'storey.west-linden', archetype: 'b12-west-campus:linden', dim: 'storey', range: [2.9, 3.9],
      nominal: { floor: 3.4, groundFloor: 15 }, ref: ['Rhode Partners architect aerial', 'near-full-height glass bays'],
      evidence: ['https://www.rhodepartners.com/the-linden/'],
      why: 'residential condominium tower: architect photograph supports the glass / pier grid; fitted 3.3991 m is a residential storey, not an office minimum violation' },
    { id: 'storey.west-inspire', archetype: 'b12-west-campus:inspire', dim: 'storey', range: [2.9, 3.9],
      nominal: { floor: 3.15, groundFloor: 4.6 }, ref: ['b12-r0-a4-30m', 'd26-orbit-northeast'],
      evidence: ['research/whole-campus-92/screenshot-dataset/collections/district-orbits-30m/captures/d26-orbit-northeast.jpg'],
      why: 'residential tower facade interpreted from research frames: tall punched windows and charcoal bands; fitted 3.104 m' },
    { id: 'storey.west-lark', archetype: 'b12-west-campus:lark', dim: 'storey', range: [2.9, 3.9],
      nominal: { floor: 3.15, groundFloor: 4.6 }, ref: ['d26-orbit-northwest', 'd27-orbit-southwest'],
      evidence: ['research/whole-campus-92/screenshot-dataset/collections/district-orbits-30m/captures/d26-orbit-northwest.jpg'],
      why: 'probable residential identity, explicitly estimated from conflicting frames; large glazed bays use a residential grid, fitted 3.196 m' },
    // These four reviewed tall-opening profiles exceed the generic punched-window height fraction. Each small interval
    // contains only its declared nominal ratio, and literal type / sill / head / floor plus reference guards remain mandatory.
    // Dobie is an authored replacement; its generated fallback archetype still participates in this catalogue-wide check.
    { id: 'window.dobie-glass-fallback', archetype: 'b05-southmall:dobie-glass-tower', dim: 'window', range: [0.64, 0.65],
      nominal: { type: 'ribbon', sill: 0.05, head: 1.95, floor: 2.96 }, ref: ['ut-d21-756-directory-photo.jpg', 'Fallback only'],
      evidence: [`${PHOTOS}ut-d21-756-directory-photo.jpg`],
      why: 'dark bands across the reflective glass tower: fallback opening height 1.90 / 2.96 = 0.642; authored D21 replaces this generated fallback' },
    { id: 'window.west-rise', archetype: 'b12-west-campus:rise', dim: 'window', range: [0.68, 0.69],
      nominal: { type: 'punched', sill: 0.45, head: 2.6, floor: 3.15 }, ref: ['GMI_RISE_Kristian-Alveo_Hires-1', 'dense small dark/blue punched windows'],
      evidence: ['https://gmitexas.com/project/rise-at-west-campus/'],
      why: 'GMI photograph supports taller dense punched windows: nominal opening height 2.15 / 3.15 = 0.683 (facade interpretation)' },
    { id: 'window.west-inspire', archetype: 'b12-west-campus:inspire', dim: 'window', range: [0.66, 0.68],
      nominal: { type: 'punched', sill: 0.5, head: 2.6, floor: 3.15 }, ref: ['b12-r0-a4-30m', 'd26-orbit-northeast'],
      evidence: ['research/whole-campus-92/screenshot-dataset/collections/district-orbits-30m/captures/d26-orbit-northeast.jpg'],
      why: 'tall punched windows read in the cited frames: nominal opening height 2.10 / 3.15 = 0.667 (estimated)' },
    { id: 'window.west-sxsw-center', archetype: 'b12-west-campus:sxsw-center', dim: 'window', range: [0.69, 0.70],
      nominal: { type: 'ribbon', sill: 0.85, head: 3.75, floor: 4.2 }, ref: ['b12-r0-b8-30m', 'b14-r0-a1-30m', 'continuous teal-tinted glass ribbons'],
      evidence: ['research/whole-campus-92/screenshot-dataset/collections/low-altitude-30m/'],
      why: 'continuous glass ribbons above metal spandrels: nominal opening height 2.90 / 4.20 = 0.690 (reference interpretation)' },
  ];
  /** archetypes: catalogue archetypes, or null when no catalogue is available (openings, doors and contract guards skipped). */
  function scaleViolations(storeyRange, archetypes, contracts = SCALE_CONTRACTS) {
    const residential = new Set(['house', 'apartment-lowrise', 'wc-midrise', 'wc-tower', 'modernist-dorm', 'cret-residence']);
    const special = new Set(['garage', 'athletic', 'arena', 'utility', 'monolith-stone', 'shed']);
    const contract = (arch, dim) => contracts.find(c => c.archetype === arch && c.dim === dim);
    const out = [];
    for (const [arch, [lo, hi]] of Object.entries(storeyRange)) {
      const c = contract(arch, 'storey');
      const [min, max] = c ? c.range : residential.has(arch) ? [2.9, 3.9] : special.has(arch) ? [3.0, 6.5] : [3.4, 4.9];
      if (lo < min - 1e-6 || hi > max + 1e-6) out.push(`${arch} ${lo.toFixed(2)}-${hi.toFixed(2)} outside ${min}-${max}${c ? ` (contract ${c.id})` : ''}`);
    }
    if (!archetypes) return out;
    for (const c of contracts) {
      const a = archetypes[c.archetype];
      if (!a) { out.push(`contract ${c.id} stale: archetype ${c.archetype} missing`); continue; }
      if (c.dim === 'storey' && !storeyRange[c.archetype]) out.push(`contract ${c.id} stale: no fitted storeys`);
      const w = c.dim === 'window' ? a.window : a.groundWindow;
      const actual = c.dim === 'storey' ? { floor: a.floor, groundFloor: a.groundFloor }
        : { type: w.type, sill: w.sill, head: w.head, floor: c.dim === 'window' ? a.floor : a.groundFloor };
      for (const [k, v] of Object.entries(c.nominal)) if (actual[k] !== v) out.push(`contract ${c.id} nominal drift: ${k} ${actual[k]} != ${v}`);
      for (const t of c.ref) if (!String(a.reference ?? '').includes(t)) out.push(`contract ${c.id} reference drift: ${t} missing`);
    }
    for (const [name, a] of Object.entries(archetypes)) {
      for (const [label, w, floor] of [['window', a.window, a.floor], ['ground', a.groundWindow, a.groundFloor]]) {
        if (w.type === 'none' || w.type === 'open' || w.type === 'glazed' || special.has(name)) continue;
        const c = contract(name, label), [min, max] = c ? c.range : [0.35, 0.6], r = (w.head - w.sill) / floor;
        if (r < min - 1e-6 || r > max + 1e-6) out.push(`${name} ${label} height/floor ${r.toFixed(2)}${c ? ` outside ${min}-${max} (contract ${c.id})` : ''}`);
      }
      if (!a.door.vehicle && (a.door.height < 2.1 || a.door.height > 3.2)) out.push(`${name} door ${a.door.height}`);
    }
    return out;
  }
  // </scale-contracts>
  const scale = scaleViolations(s.storeyRange, mod.CATALOG ? mod.CATALOG.archetypes : null);
  console.log('SCALE-CONTRACTS', JSON.stringify(SCALE_CONTRACTS.map(c => [c.id, c.archetype, c.dim, c.range])));
  console.log('SCALE', scale.length ? `VIOLATIONS ${JSON.stringify(scale)}` : 'storeys, window and door proportions within range', JSON.stringify(s.storeyRange));
  if (scale.length) contextFailed = true;
  // Streamed detail at representative viewpoints: resident cells once fully built.
  const views = { spawn: [114, 64.4], drag24th: [-470, -60], westCampus: [-600, -250], northUniversity: [-150, -650], capitolNorth: [-278, 1000], dellMed: [300, 980] };
  let worstResident = 0;
  for (const [name, [x, z]] of Object.entries(views)) {
    for (let i = 0; i < 80; i++) { context.update({ x, y: 0, z }); if (context.detailStats().radius >= 109) break; }
    const ds = context.detailStats();
    worstResident = Math.max(worstResident, ds.residentTriangles);
    console.log('DETAIL-VIEW', name, JSON.stringify(ds));
  }
  const d = context.measureDetail();
  console.log('DETAIL', JSON.stringify(d));
  if (d.nonFinite) contextFailed = true;
  // Worst-case resident detail: cells inside the build radius around the busiest spot (approximate by the 9 densest cells).
  const total = s.buildingTriangles + s.stadium.triangles + s.roads.triangles;
  console.log('BUDGET shell triangles', total, '+ worst resident detail', worstResident, '=', total + worstResident, '(detail max cell', d.maxCellTriangles, ', all cells if everything were resident', d.triangles + ')');
  if (total + worstResident > 1_250_000) { console.error('context triangle budget exceeded'); contextFailed = true; }
  if (total > 1_000_000) { console.error('shell triangle budget exceeded'); contextFailed = true; }
  if (shellDraws > 300) { console.error('shell draw-call budget exceeded'); contextFailed = true; }
  // Visible roofs vs colliders: a downward ray at each generated footprint's interior point must
  // hit the same height in the rendered solids and in Rapier (<= 0.1 m apart).
  const THREE = mod.THREE_NS;
  const { RAPIER, physics, player } = result;
  const { poleOfInaccessibility, cleanRing, orientRings } = mod;
  let checked = 0, mismatched = 0; const worst = [];
  const rc = new THREE.Raycaster();
  for (const p of result.plans) {
    if (p.decision !== 'generated') continue;
    const rings = orientRings(p.building.rings.map(r => cleanRing(r)).filter(r => r.length >= 3));
    if (!rings.length) continue;
    const pole = poleOfInaccessibility(rings);
    if (pole.d < 1) continue;
    rc.set(new THREE.Vector3(pole.x, 400, pole.z), new THREE.Vector3(0, -1, 0)); rc.far = 600;
    const hit = rc.intersectObject(context.solid, true)[0];
    const ray = physics.castRay(new RAPIER.Ray({ x: pole.x, y: 400, z: pole.z }, { x: 0, y: -1, z: 0 }), 600, true, undefined, undefined, player);
    if (!hit || !ray) continue;
    checked++;
    const diff = Math.abs(hit.point.y - (400 - ray.timeOfImpact));
    if (diff > 0.1) { mismatched++; worst.push([p.building.abbr || p.building.id, +diff.toFixed(2)]); }
  }
  // Shell opening attributes vs detail geometry: at sampled detail openings, the wall the
  // shader draws must report "opening" at the centre and "solid" just beside the jamb.
  {
    const fract = x => x - Math.floor(x);
    const opening = (f, w, r) => {
      if (w[3] < 0.5 || f[2] < 0.01 || f[3] < 0.01) return false;
      const k = Math.floor(f[1]);
      if (k < r[0] - 0.5 || k > r[1] + 0.5) return false;
      const wm = w[0] * f[2], xm = (fract(f[0]) - 0.5 + w[0] * 0.5) * f[2], hm = (w[2] - w[1]) * f[3], ym = (fract(f[1]) - w[1]) * f[3];
      return xm >= 0 && xm <= wm && ym >= 0 && ym <= hm;
    };
    const attrAt = (hit, name, n) => {
      const a = hit.object.geometry.getAttribute(name), { a: ia, b: ib, c: ic } = hit.face, bc = hit.barycoord;
      return Array.from({ length: n }, (_, i) => a.array[ia * n + i] * bc.x + a.array[ib * n + i] * bc.y + a.array[ic * n + i] * bc.z);
    };
    // Probe the wall face that belongs to THIS run: coplanar shell faces of overlapping volumes can carry other
    // bay grids (engineering-audit/pier-check-review.md), so pick the hit whose bay width matches the run;
    // if faces exist but none matches, report the probe as ambiguous (with a witness) instead of guessing.
    let ambiguous = 0; const ambiguousWitness = [];
    const probe = (x, y, z, nx, nz, bayW) => {
      rc.set(new THREE.Vector3(x + nx * 0.6, y, z + nz * 0.6), new THREE.Vector3(-nx, 0, -nz)); rc.far = 0.9;
      const hits = rc.intersectObject(context.solid, true).filter(h => h.object.geometry.getAttribute('aFac') && Math.abs(h.distance - 0.6) < 0.02);
      if (!hits.length) return null;
      const own = hits.find(h => Math.abs(attrAt(h, 'aFac', 4)[2] - bayW) < 1e-3);
      if (!own) { ambiguous++; if (ambiguousWitness.length < 5) ambiguousWitness.push([+x.toFixed(2), +y.toFixed(2), +z.toFixed(2), hits.map(h => +attrAt(h, 'aFac', 4)[2].toFixed(4)), +bayW.toFixed(4)]); return 'ambiguous'; }
      return opening(attrAt(own, 'aFac', 4), attrAt(own, 'aWin', 4), attrAt(own, 'aRange', 2));
    };
    let sampled = 0, centreMiss = 0, pierHit = 0, noWall = 0, n = 0;
    for (const list of context.detailSources.values()) for (const src of list) for (const r of src.runs) {
      for (let i = Math.round(r.s0 / r.bayW); i < Math.round(r.s1 / r.bayW); i++) for (const f of r.floors) {
        if (n++ % 23) continue;
        const sc = (i + 0.5) * r.bayW, y = f + (r.sill + r.head) / 2;
        const px = r.ax + r.dx * sc, pz = r.az + r.dz * sc;
        const c = probe(px, y, pz, r.nx, r.nz, r.bayW);
        if (c === null) { noWall++; continue; }
        if (c === 'ambiguous') continue;
        sampled++;
        if (!c) { centreMiss++; if (process.argv.includes('--opening-debug')) { rc.set(new THREE.Vector3(px + r.nx * 0.6, y, pz + r.nz * 0.6), new THREE.Vector3(-r.nx, 0, -r.nz)); rc.far = 0.9; for (const h of rc.intersectObject(context.solid, true)) console.log('  miss', src.id, r.type, px.toFixed(2), y.toFixed(2), pz.toFixed(2), h.object.name, h.distance.toFixed(3), h.object.geometry.getAttribute('aFac') ? JSON.stringify([attrAt(h, 'aFac', 4), attrAt(h, 'aWin', 4), attrAt(h, 'aRange', 2)]) : ''); } }
        const off = r.width / 2 + 0.08;
        if (sc + off < (r.s1 - 0.05)) { const p = probe(px + r.dx * off, y, pz + r.dz * off, r.nx, r.nz, r.bayW); if (p === true) { pierHit++; if (process.argv.includes('--opening-debug')) console.log('  pier', src.id, r.type, JSON.stringify({ i, bayW: r.bayW, width: r.width, s0: r.s0, s1: r.s1, sc, off, floors: r.floors.length, f, x: +(px + r.dx * off).toFixed(2), z: +(pz + r.dz * off).toFixed(2) })); } }
      }
    }
    console.log('OPENING-MATCH', sampled, 'sampled openings; centre not an opening', centreMiss, '; pier drawn as opening', pierHit, '; wall plane not found (occluded by an adjoining footprint)', noWall, '; ambiguous owner (coplanar faces, no grid match)', ambiguous, JSON.stringify(ambiguousWitness));
    if (centreMiss || pierHit) contextFailed = true;
  }
  console.log('ROOF-COLLIDER', checked, 'footprints checked;', mismatched ? `MISMATCH ${mismatched}: ${JSON.stringify(worst.slice(0, 12))}` : 'visible roofs and colliders agree within 0.1 m');
  if (mismatched) contextFailed = true;
}
if (process.argv.includes('--overlaps')) {
  for (const p of result.plans)
    if (p.decision === 'generated' && (p.elevatedFraction > 0 || p.perimeterFraction > 0.08 || p.groundFraction > 0) || p.building.id === 533822)
      console.log('OVERLAP', p.building.id, p.building.abbr || '-', p.decision, p.style, p.elevatedFraction.toFixed(3), p.perimeterFraction.toFixed(3), p.groundFraction.toFixed(3), p.building.center.map(v => v.toFixed(0)).join(','), p.building.h);
}
{
  // Route protection: authored walkable ground must not end up inside a generated footprint.
  const { grid, plans } = result;
  const inRing = (x, z, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  let blocked = 0; const by = {};
  for (const p of plans) {
    if (p.decision !== 'generated') continue;
    const r = p.building.rings[0], xs = r.map(q => q[0]), zs = r.map(q => q[1]);
    for (let x = Math.min(...xs) + 1; x < Math.max(...xs); x += 2) for (let z = Math.min(...zs) + 1; z < Math.max(...zs); z += 2) {
      if (!inRing(x, z, r) || !grid.at(grid.ground, x, z)) continue;
      blocked++; const k = p.building.abbr || p.building.id; by[k] = (by[k] || 0) + 1;
    }
  }
  console.log('ROUTE-CELLS-INSIDE-GENERATED', blocked, JSON.stringify(by));
  // Spawn and landmark clearance: a standing capsule must not overlap generated colliders.
  const { RAPIER } = result;
  const ids = new Set(result.context.colliders.map(c => c.handle));
  // Tree trunks/limbs and hedges must not block spawn or landmark capsules either.
  const treeIds = new Set([...(result.walkway.trees?.colliderHandles ?? []), ...(result.vegetation.canopy?.allColliders().map(c => c.handle) ?? [])]);
  for (const h of treeIds) ids.add(h);
  const shape = new RAPIER.Capsule(0.54, 0.34);
  const checks = { spawn: [114, 64.4], ...Object.fromEntries(Object.entries(result.world.data.landmarks).map(([k, v]) => [k, v.position])) };
  for (const [name, [x, z]] of Object.entries(checks)) {
    const y = result.world.terrain.height(x, z) + 0.95;
    let hits = 0;
    result.physics.intersectionsWithShape({ x, y, z }, { x: 0, y: 0, z: 0, w: 1 }, shape, c => { if (ids.has(c.handle)) hits++; return true; }, undefined, undefined, result.player);
    console.log('CLEARANCE', name, x, z, hits ? `BLOCKED by ${hits} generated collider(s)` : 'clear');
  }
}

{
  const violations = Object.entries(result.routeViolations);
  console.log('ROUTE-GEOMETRY', result.walkableSamples, 'authored walkable samples;', violations.length ? `INSIDE GENERATED: ${JSON.stringify(result.routeViolations)}` : 'none inside generated footprints');
  let failed = violations.length > 0;
  // Map travel near the GDC atrium (label, landmark and the reported arrival) must land under open sky.
  for (const requested of [[69.635, -18.478], [47.8647, -17.0776], [47.0488, -17.0776], [58, -18], [62, -10]]) {
    const r = result.travel(requested);
    console.log('TRAVEL', JSON.stringify(r));
    // Every request must arrive on verified ground under open sky, near the click,
    // within a few seconds of resident-geometry search (the game spends ~12 ms per frame).
    if (!r.landing || r.enclosed !== false || r.offset > 60 || r.searchMs > 8000) failed = true;
  }
  if (failed || contextFailed) { console.error('FAIL: route, travel or context architecture check'); process.exit(1); }
}
{
  // Vegetation: counts, LOD triangles and the tree-collider clearance check.
  const { vegetation, vegetationMs } = result;
  const stats = vegetation.stats();
  console.log('VEGETATION', JSON.stringify({ ...stats, installMsHeadless: Math.round(vegetationMs) }));
  const { treeClearance, heroViews } = await import(pathToFileURL(resolve(import.meta.dirname, '../../.work/harness-dist/context-check.mjs')).href);
  const c = treeClearance(result);
  console.log('TREE-CLEARANCE', JSON.stringify(c));
  for (const [name, v] of Object.entries(heroViews(result))) console.log('TREE-VIEW', name, JSON.stringify(v));
  if (c.limbViolations || c.trunkZoneSamplesOverPaving.canopy || c.trunkPairsUnder1_5m) { console.error('FAIL: tree collider clearance'); process.exit(1); }
}
