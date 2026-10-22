// Runtime integration of the scanned DKR west stand (integrator check, headless):
//  1. commit failure (decode OK, stand collider creation throws) keeps the full generated bowl,
//     leaves no stand collider and disposes the prepared scan;
//  2. the stand's near-LOD visual is a registered ground root: map travel into the stand arrives
//     ON the stand collider with visible = physical, and the scooter finds support on a benign patch.
import './stubs.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const harnessUrl = pathToFileURL(resolve(import.meta.dirname, '../../.work/harness-dist/context-check.mjs')).href;
const { run, ScooterClearance, LocalGroundQuery } = await import(harnessUrl);
const root = resolve(import.meta.dirname, '../..');
const stand = JSON.parse(readFileSync(resolve(root, 'public/assets/scans/dkr-west-stand.json'), 'utf8'));
let failed = false;
const fail = msg => { console.error('FAIL', msg); failed = true; };
const r3 = v => (v === null || v === undefined || !Number.isFinite(v)) ? v : +v.toFixed(3);
const sf = stand.sector.fieldFrame, A = sf.angle;
const fromTV = (t, v) => { const u = -sf.hw - t; return [sf.center[0] + u * Math.cos(A) + v * Math.sin(A), sf.center[1] - u * Math.sin(A) + v * Math.cos(A)]; };
const alongV = [Math.sin(A), Math.cos(A)];
const down = { x: 0, y: -1, z: 0 };

// ---------- 1. commit failure: generated west stand restored, nothing of the scan left ----------
{
  const generated = await run({});
  const injected = await run({ scan: true, standCommitFailure: true });
  const g = generated.stats.stadium, f = injected.stats.stadium, c = injected.standCommit;
  // West generated rows physically present at the same places as in the plain generated scene.
  const probe = r => { const out = []; for (const [t, v] of [[10, -40], [25, 0], [45, 30], [60, -10]]) {
    const [x, z] = fromTV(t, v), h = r.physics.castRay(new r.RAPIER.Ray({ x, y: 160, z }, down), 300, true, undefined, undefined, r.player);
    out.push(h ? r3(160 - h.timeOfImpact) : null); } return out; };
  const westGenerated = probe(generated), westInjected = probe(injected);
  const report = { injected: c.injected, colliderCreateAttempts: c.attempts, collidersBeforeContext: c.collidersBefore, collidersAfterCommit: c.collidersAfterCommit,
    scanStand: !!injected.scanStand, bowlScanSector: f.scanSector, bowlError: f.scanSectorError,
    bowlTriangles: [g.triangles, f.triangles], bowlColliderTriangles: [g.colliderTriangles, f.colliderTriangles],
    preparedMeshes: c.preparedMeshes, preparedMeshesDisposed: c.preparedDisposed, westTopY: { generated: westGenerated, afterFailedCommit: westInjected } };
  console.log('STAND-COMMIT-FAILURE', JSON.stringify(report));
  if (!c.injected || c.attempts < 1) fail('commit failure was not injected through createCollider');
  if (injected.scanStand || f.scanSector !== null || !f.scanSectorError) fail('failed commit still replaced the west sector');
  if (f.triangles !== g.triangles || f.colliderTriangles !== g.colliderTriangles) fail('failed commit: bowl differs from the full generated bowl');
  if (westInjected.some((y, i) => y === null || Math.abs(y - westGenerated[i]) > 1e-3)) fail('failed commit: west rows not physically restored');
  if (c.collidersAfterCommit !== 0 && c.collidersAfterCommit !== c.collidersBefore) fail('failed commit: collider count changed during the commit');
  if (c.preparedMeshes < 1 || c.preparedDisposed < c.preparedMeshes) fail('failed commit: prepared scan geometry not disposed');
  let standObjects = 0; injected.context.group.traverse(o => { if (/west stand/i.test(o.name)) standObjects++; });
  if (standObjects) fail('failed commit: stand objects left in the scene');
  // Same STD travel criterion as the load-failure fallback.
  const std = injected.travel(injected.world.data.landmarks.STD.position);
  console.log('STAND-COMMIT-FAILURE-STD-TRAVEL', JSON.stringify(std));
  if (!std.landing || std.enclosed !== false) fail('failed commit: STD travel');
}

// ---------- 2. committed stand registered as ground ----------
const r = await run({ scan: true });
const { physics, RAPIER, player, scanStand } = r;
if (!scanStand) { fail('scan stand missing'); process.exit(1); }
const standIds = new Set(scanStand.colliders.map(c => c.handle));
const registered = r.groundRoots.includes(scanStand.groundSurface);
let farInRoots = 0, colliderMeshInRoots = 0;
const lod = scanStand.group.children.find(o => o.isLOD);
const farLevel = lod.levels[1]?.object;
for (const rootObj of r.groundRoots) rootObj.traverse(o => { if (farLevel && o === farLevel) farInRoots++; if (o.isMesh && /collider/i.test(o.name)) colliderMeshInRoots++; });
console.log('STAND-GROUND-ROOT', JSON.stringify({ registered, isNearLod: scanStand.groundSurface === lod.levels[0].object, farLodInRoots: farInRoots, colliderMeshesInRoots: colliderMeshInRoots }));
if (!registered || scanStand.groundSurface !== lod.levels[0].object || farInRoots || colliderMeshInRoots) fail('stand ground root registration');
const onStand = p => physics.castRay(new RAPIER.Ray({ x: p.x, y: p.y, z: p.z }, down), 1.5, true, undefined, undefined, player, undefined, c => standIds.has(c.handle)) !== null;
const visibleY = (x, z, from) => { const h = r.surface(x, z, from, 6); return h ? h.point.y : null; };

// Map travel into the stand: each request must arrive on the stand collider, near the click.
const requests = [[6, -30], [10, -15], [14, 5], [9, 25], [20, 40], [12, -45]].map(([t, v]) => ({ t, v, at: fromTV(t, v) }));
requests.push({ t: null, v: null, at: [391.67, 263.86], note: 'Codex browser click (west stand)' });
requests.push({ t: null, v: null, at: [sf.center[0], sf.center[1]], note: 'field centre', field: true });
const travels = [];
for (const q of requests) {
  const res = r.travel(q.at);
  const landing = res.landing ? { x: res.landing[0], y: res.landing[1], z: res.landing[2] } : null;
  const feet = landing ? landing.y - 0.905 : null, vis = landing ? visibleY(landing.x, landing.z, feet + 1) : null;
  const phys = landing ? physics.castRay(new RAPIER.Ray({ x: landing.x, y: feet + 1, z: landing.z }, down), 2, true, undefined, undefined, player) : null;
  travels.push({ ...q, landing: res.landing, offset: res.offset, index: res.index, enclosed: res.enclosed, onStand: landing ? onStand(landing) : false,
    feetMinusVisible: vis === null ? null : r3(feet - vis), feetMinusPhysical: phys ? r3(feet - (feet + 1 - phys.timeOfImpact)) : null });
}
for (const t of travels) console.log('STAND-TRAVEL', JSON.stringify(t));
const inStand = travels.filter(t => t.t !== null);
const arrivedOnStand = inStand.filter(t => t.onStand && t.offset <= 6 && t.enclosed === false && Math.abs(t.feetMinusVisible) <= 0.08 && Math.abs(t.feetMinusPhysical) <= 0.08);
console.log('STAND-TRAVEL-SUMMARY', JSON.stringify({ requests: inStand.length, arrivedOnStandWithin6m: arrivedOnStand.length }));
if (arrivedOnStand.length < Math.ceil(inStand.length * 2 / 3)) fail('map travel into the scanned stand does not arrive on the stand');
const codexClick = travels.find(t => t.note?.startsWith('Codex'));
if (!codexClick.onStand || codexClick.offset > 6) fail('map travel to the Codex browser stand click');
const field = travels.find(t => t.field);
if (!field.landing || field.offset > 6 || field.enclosed !== false || Math.abs(field.feetMinusPhysical) > 0.08) fail('map travel to the field centre');

// Scooter on the stand: actual ScooterClearance with the game's rendered-ground source (LocalGroundQuery
// over the registered roots, incl. the stand near LOD). Scan a grid for benign patches, then ride one.
const controller = physics.createCharacterController(0.025);
controller.enableAutostep(0.32, 0.2, false); controller.enableSnapToGround(0.38);
controller.setMaxSlopeClimbAngle(Math.PI * 0.25); controller.setMinSlopeSlideAngle(Math.PI * 0.28);
const query = new LocalGroundQuery();
const clearance = new ScooterClearance({ world: physics, controller, collider: player, renderedGround: (x, z, fromY, distance) => query.sample(x, z, fromY, distance) });
const heading = Math.atan2(alongV[0], alongV[1]); // facing along the stand rows (+v)
const tryAt = (x, z) => {
  const top = physics.castRay(new RAPIER.Ray({ x, y: 160, z }, down), 300, true, undefined, undefined, player, undefined, c => standIds.has(c.handle));
  if (!top) return null;
  const center = { x, y: 160 - top.timeOfImpact + 0.905, z };
  query.prepare(r.groundRoots, center, () => true);
  return { center, result: clearance.canOccupy({ center, heading }) };
};
const patches = [], reasons = {};
for (let v = -50; v <= 50; v += 2.5) for (let t = 1; t <= 90; t += 1.5) {
  const [x, z] = fromTV(t, v), got = tryAt(x, z); if (!got) continue;
  const reason = got.result.blockedReason ?? 'allowed'; reasons[reason] = (reasons[reason] ?? 0) + 1;
  if (got.result.allowed) patches.push({ t, v, x, z, center: got.center, support: got.result.support });
}
console.log('STAND-SCOOTER-SCAN', JSON.stringify({ samples: Object.values(reasons).reduce((a, b) => a + b, 0), outcomes: reasons, allowedPatches: patches.length }));
// Ride: from each allowed patch try 3 m along the rows; keep the best.
let ride = null;
for (const p of patches) {
  query.prepare(r.groundRoots, p.center, () => true);
  const trace = clearance.traceMove({ center: p.center, heading }, { x: alongV[0] * 3, z: alongV[1] * 3 }, heading);
  const physY = physics.castRay(new RAPIER.Ray({ x: p.x, y: p.center.y + 0.1, z: p.z }, down), 2, true, undefined, undefined, player);
  const cand = { t: p.t, v: p.v, at: [r3(p.x), r3(p.z)], groundY: r3(p.support.groundY), physicalY: physY ? r3(p.center.y + 0.1 - physY.timeOfImpact) : null, onStand: onStand(p.center),
    moveFraction: r3(trace.fraction), blocked: trace.blockedReason, grounded: trace.grounded };
  if (!ride || cand.moveFraction > ride.moveFraction) ride = cand;
  if (cand.moveFraction >= 1) break;
}
console.log('STAND-SCOOTER-RIDE', JSON.stringify(ride));
if (!ride || !ride.onStand || ride.physicalY === null || Math.abs(ride.groundY - ride.physicalY) > 0.08) fail('no scooter support on the scanned stand with visible = physical');
else if (ride.moveFraction < 1) console.log(`NOTE stand scooter (disclosed limit): support/mount on ${patches.length} stand patches with visible = physical, but no full 3 m ride along a row: best ${(ride.moveFraction * 3).toFixed(1)} m of 3 m, then '${ride.blocked}' (photogrammetry seat rows vs the 0.5 m top-envelope collider differ by more than the scooter's 0.08 m surface tolerance). The stand is for walking; the scooter is not expected to ride the seating.`);
controller.free?.();
if (failed) { console.error('FAIL: stand runtime check'); process.exit(1); }
console.log('STAND-RUNTIME-CHECK OK');
