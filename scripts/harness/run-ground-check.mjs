// Ground-edge check: exposed vertical slab/skirt edges on the hero route before
// and after the graded tie-ins, plus visible/physical agreement on the tie-ins.
import './stubs.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const mod = await import(pathToFileURL(resolve(import.meta.dirname, '../../.work/harness-dist/ground-check.mjs')).href);
const verbose = process.argv.includes('--details');
const scene = await mod.buildGroundScene();
const tally = (edges) => {
  const by = {};
  for (const e of edges) { if (e.exposure <= 0.15) continue; by[e.kind] ??= { edges: 0, metres: 0, max: 0 }; by[e.kind].edges++; by[e.kind].metres = +(by[e.kind].metres + e.length).toFixed(1); by[e.kind].max = Math.max(by[e.kind].max, e.exposure); }
  return by;
};
const print = (label, rows) => {
  rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.area.localeCompare(b.area) || b.max - a.max);
  for (const r of rows) console.log(label, r.kind.padEnd(11), r.area.padEnd(34), (r.source + (r.material ? ` [${r.material}]` : '')).slice(0, 72).padEnd(72), 'len', String(r.length).padStart(6), 'max', String(r.max).padStart(5), 'x', r.box[0], r.box[1], 'z', r.box[2], r.box[3], '<-', r.neighbours.join(' / ').slice(0, 70));
};
const OWNED = /^(West 24th and Tower north|East and West Mall foreground|Inner Campus|Flawn approach|MAI east doorway)/;
const before = mod.probeGroundEdges(scene);
const tieIns = mod.addGroundTieIns(scene);
const after = mod.probeGroundEdges(scene);
const owned = (edges, kind) => edges.filter(e => e.exposure > 0.15 && e.kind === kind && OWNED.test(e.source));
if (verbose) { print('BEFORE', mod.summarize(before.edges)); print('AFTER', mod.summarize(after.edges)); }
else print('AFTER-OWNED', mod.summarize(after.edges.filter(e => OWNED.test(e.source) || /tie-in/.test(e.source))));
const metres = (edges) => +edges.reduce((s, e) => s + e.length, 0).toFixed(1);
console.log('TIE-INS', JSON.stringify(tieIns.stats));
const groups = {};
for (const s of tieIns.segments) { if (!['wall', 'ramp', 'infill', 'step'].includes(s.status) && !(s.status === 'graded' && s.drop > 0.6)) continue; const k = `${s.status.padEnd(6)} ${s.module} @${Math.floor(s.x0 / 8) * 8},${Math.floor(s.z0 / 8) * 8} ${s.reason}`; groups[k] ??= { m: 0, drop: 0 }; groups[k].m += s.length; groups[k].drop = Math.max(groups[k].drop, s.drop); }
if (verbose) for (const [k, v] of Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]))) console.log('  TIE-IN', k, 'len', v.m.toFixed(1), 'drop', v.drop.toFixed(2));
console.log('GROUND-EDGES before', JSON.stringify({ all: tally(before.edges), ownedArtefactMetres: metres(owned(before.edges, 'artefact')) }));
console.log('GROUND-EDGES after ', JSON.stringify({ all: tally(after.edges), ownedArtefactMetres: metres(owned(after.edges, 'artefact')) }));
const phys = mod.tieInPhysics(scene, tieIns);
console.log('TIE-IN-PHYSICS', JSON.stringify(phys));
// What this proves and what it does not (Codex ground review): the rendered tie-in triangles ARE the
// Rapier trimesh (shared buffers), and sampled up-facing tops agree within 0.05 m. Physical hits on
// faces steeper than 60 deg (walls, wedge sides, clip boundaries) are not floors: they are counted,
// not failed, and are NOT smooth-route evidence. Generated retaining walls are scene changes, not
// proof of a real wall. Smooth traversal is claimed only for the WALK crossings below; paving
// coverage is checked separately by run-ground-paving-overlap-test.mjs (original vs new triangles).
console.log('GROUND-DISCLOSURE', JSON.stringify({ sharedVisiblePhysicalSamples: phys.samples, mismatchedOver005: phys.mismatchedOver005,
  skippedSteepFaceContacts: phys.steepFaceContacts, generatedWallMetres: tieIns.stats.metres.wall ?? 0, generatedWallWorstDrop: tieIns.stats.worstDrop.wall ?? 0,
  smoothClaimLimitedTo: 'the 6 WALK crossings (character controller replay); not universal' }));
const walks = mod.walkAcross(scene, tieIns, {
  'Tower north: Inner Campus drive -> West 24th road end (ramp)': [[-211.3, -30.5], [-211.0, -42]],
  'Tower north: Inner Campus drive -> West 24th sidewalk (concrete ramp)': [[-205.6, -30.5], [-205.6, -42]],
  'Tower north east edge: lawn -> sidewalk (batter)': [[-185.5, -58], [-193.5, -58]],
  'West Mall south edge: lawn -> plaza (batter)': [[-330, 50.5], [-330, 44]],
  // Main Mall forecourt sides (b04 plaza): up the 1:10 apron from the old mapped T arm, over its 8 cm toe.
  'Main Mall forecourt west: mapped finish -> plaza (ramp toe, uphill)': [[-247.5, 104], [-236, 104]],
  'Main Mall forecourt east: mapped finish -> plaza (ramp toe, uphill)': [[-198, 106], [-210, 106]],
});
for (const [name, r] of Object.entries(walks)) console.log('WALK', name.padEnd(72), JSON.stringify(r));
// The 8 cm ramp toes on the scooter (game clearance code), up and down, on the Main Mall aprons and Tower north.
const rides = mod.scooterAcross(scene, {
  'Main Mall west apron: mapped finish -> toe -> plaza (up)': [[-247.5, 104], [-236, 104]],
  'Main Mall west apron: plaza -> toe -> mapped finish (down)': [[-236, 103], [-247.5, 103]],
  'Main Mall east apron: mapped finish -> toe -> plaza (up)': [[-198, 106], [-210, 106]],
  'Main Mall east apron: plaza -> toe -> mapped finish (down)': [[-210, 108], [-198, 108]],
  'Tower north: West 24th road end -> ramp toe -> Inner Campus drive (up)': [[-211.0, -42], [-211.3, -30.5]],
  'Tower north: Inner Campus drive -> ramp toe -> West 24th road end (down)': [[-211.3, -30.5], [-211.0, -42]],
});
for (const [name, r] of Object.entries(rides)) console.log('SCOOTER', name.padEnd(72), JSON.stringify(r));
let failed = false;
for (const [name, r] of Object.entries(walks)) if (!r.after.reached || r.after.maxStepUp > 0.32) { console.error('FAIL: walk', name); failed = true; }
for (const [name, r] of Object.entries(rides)) if (!r.reached || r.maxFrameRiseM > 0.12 || r.maxFrameDropM > 0.12) { console.error('FAIL: scooter', name); failed = true; }
if (phys.mismatchedOver005) { console.error('FAIL: tie-in visible/physical mismatch'); failed = true; }
if (failed) process.exit(1);
// Per fixed shot (render/camera-shots.ts): exposed edges inside the camera's
// horizontal field of view within 150 m, before vs after (all modules).
const { CAMERA_SHOTS } = await import(pathToFileURL(resolve(import.meta.dirname, '../../.work/harness-dist/ground-check.mjs')).href);
for (const id of ['tower-west-mall', 'tower-east-yard', 'south-mall', 'spawn-east-mall-west']) {
  const shot = CAMERA_SHOTS.find(s => s.id === id);
  const [cx, , cz] = shot.position, [tx, , tz] = shot.target, heading = Math.atan2(tz - cz, tx - cx), half = shot.fov * 16 / 9 / 2 * Math.PI / 180;
  const inView = (e) => { const x = (e.x0 + e.x1) / 2, z = (e.z0 + e.z1) / 2, d = Math.hypot(x - cx, z - cz); if (d > 150 || d < 1) return false; let a = Math.atan2(z - cz, x - cx) - heading; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return Math.abs(a) <= half; };
  const sum = (edges) => { const by = {}; for (const e of edges) { if (e.exposure <= 0.15 || !inView(e)) continue; by[e.kind] = +((by[e.kind] ?? 0) + e.length).toFixed(1); } return by; };
  console.log('SHOT', id.padEnd(22), 'before', JSON.stringify(sum(before.edges)), 'after', JSON.stringify(sum(after.edges)));
  if (verbose) print(`SHOT-AFTER ${id}`, mod.summarize(after.edges.filter(e => e.kind === 'artefact' && inView(e))));
}
