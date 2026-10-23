// DKR default stadium (headless, real scene; diagnostic scan mode is covered by run-stand-runtime-check.mjs and
// run-scan-lifecycle.mjs):
//  1. game gate: lib/campus/game.ts requests the west-stand and field captures only behind stadiumScanRequested
//     (`?stadiumscan=1`); the gate is off for the default / unrelated query strings and on for the opt-ins.
//  2. default scene (Tower scan on, as in the game): no dkr-* scan URL is requested, the bowl has no scan sector, no stand
//     or field-decal object exists, and no collider is left from a stand scan.
//  3. visible = physical: on the generated west stand (lower bowl, upper deck), the field and the press-box roof, the first
//     visible stadium surface straight down equals the first physics hit within 0.05 m.
//  4. STD map travel lands outdoors; flight landing finds support on the west stand and the field.
//  5. turf painter: TEXAS in the north end zone and LONGHORNS in the south, both reading from the field (letter tops toward
//     their end line); 18 yard numbers, tops toward the nearer sideline; the midfield mark at the centre (texture -> field
//     frame through the turf UVs and CanvasTexture.flipY).
import './stubs.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const root = resolve(import.meta.dirname, '../..');
const mod = await import(pathToFileURL(resolve(root, '.work/harness-dist/context-check.mjs')).href);
const { run, scanRequests, findFlightLanding, fieldCanvas, stadiumScanRequested } = mod;
const THREE = await import('three');
let failed = false;
const fail = msg => { console.error('FAIL', msg); failed = true; };

// ---- 1. gate ----
{
  const src = readFileSync(resolve(root, 'lib/campus/game.ts'), 'utf8');
  const gated = /const standScan = stadiumScanRequested\(location\.search\);/.test(src)
    && /!standScan \? Promise\.resolve\(null\) : prepareScanStand\(/.test(src) && /if \(standScan\) loadScanField\(/.test(src)
    && (src.match(/prepareScanStand\(/g) ?? []).length === 1 && (src.match(/loadScanField\(/g) ?? []).length === 1;
  const cases = { '': false, '?shot=b09-aerial-stadium': false, '?stand=generated': false, '?stadiumscan=0': false, '?stadiumscan=1': true, '?stand=scan': true };
  const bad = Object.entries(cases).filter(([q, want]) => stadiumScanRequested(q) !== want);
  console.log('STADIUM-GATE', JSON.stringify({ gatedInGame: gated, wrongCases: bad }));
  if (!gated) fail('game.ts loads a stadium scan outside the stadiumScanRequested gate');
  if (bad.length) fail(`stadiumScanRequested: ${JSON.stringify(bad)}`);
}

// ---- 2. default scene ----
const r = await run({ scan: true });
const { physics, RAPIER, player, context } = r;
const st = r.stats.stadium;
const dkrRequests = scanRequests.filter(u => /dkr-/.test(u));
let scanObjects = 0; context.group.traverse(o => { if (/west stand|field photogrammetry/i.test(o.name)) scanObjects++; });
console.log('STADIUM-DEFAULT', JSON.stringify({ requests: scanRequests, dkrRequests, scanSector: st.scanSector, scanSectorError: st.scanSectorError,
  scanStand: !!r.scanStand, scanField: !!r.scanField, scanObjects, standPrepared: !!r.standPrepared, bowlTriangles: st.triangles, bowlColliderTriangles: st.colliderTriangles }));
if (dkrRequests.length) fail(`default scene requested stadium scans: ${dkrRequests.join(', ')}`);
if (!scanRequests.some(u => /ut-tower/.test(u))) fail('default scene did not load the Tower scan (it should be unchanged)');
if (st.scanSector !== null || st.scanSectorError || r.scanStand || r.scanField || r.standPrepared || scanObjects) fail('default scene carries stadium scan state/objects');

// ---- 3. visible = physical on the generated west stand, field and press-box roof ----
const A = Math.atan2(-0.068, 1), HW = 35.5;
const fromTV = (t, v) => { const u = -HW - t; return [444.3 + u * Math.cos(A) + v * Math.sin(A), 272.5 - u * Math.sin(A) + v * Math.cos(A)]; };
const stadiumMeshes = []; context.solid.traverse(o => { if (o.isMesh && o.name.startsWith('Local context stadium ')) stadiumMeshes.push(o); });
const down = new THREE.Vector3(0, -1, 0);
const compare = (label, pts) => {
  let n = 0, bad = 0, worst = 0;
  const gap = (x, z) => {
    const vis = new THREE.Raycaster(new THREE.Vector3(x, 140, z), down, 0, 300).intersectObjects(stadiumMeshes, false)[0];
    const phy = physics.castRay(new RAPIER.Ray({ x, y: 140, z }, { x: 0, y: -1, z: 0 }), 300, true, undefined, undefined, player);
    return vis ? (phy ? Math.abs(140 - phy.timeOfImpact - vis.point.y) : Infinity) : null;
  };
  for (const [x, z] of pts) {
    let d = gap(x, z);
    if (d === null) continue; n++;
    // A ray exactly on a riser edge may meet adjacent treads in the two queries (same triangles): re-test 0.1 m either side
    // in x and z; a real mismatch disagrees at every offset.
    if (d > 0.05) d = Math.min(d, ...[[0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]].map(([dx, dz]) => gap(x + dx, z + dz) ?? Infinity));
    worst = Math.max(worst, d); if (d > 0.05) bad++;
  }
  console.log('STADIUM-VISIBLE-PHYSICAL', label, JSON.stringify({ samples: n, mismatches: bad, worstM: +worst.toFixed(3) }));
  if (n < 10 || bad) fail(`${label}: ${bad}/${n} samples where the visible stadium surface is not the physical one (worst ${worst.toFixed(3)} m)`);
};
const westPts = []; for (let t = 1.3; t < 74; t += 2.3) for (let v = -44; v <= 44; v += 8) westPts.push(fromTV(t, v));
compare('west stand', westPts);
const fieldPts = []; for (let u = -30; u <= 30; u += 6) for (let v = -55; v <= 55; v += 10) fieldPts.push([444.3 + u * Math.cos(A) + v * Math.sin(A), 272.5 - u * Math.sin(A) + v * Math.cos(A)]);
compare('field', fieldPts);
const pressPts = []; for (let v = -46; v <= -13; v += 3) pressPts.push(fromTV(78, v));
compare('press box', pressPts);
for (const [x, z] of pressPts) {
  const roof = new THREE.Raycaster(new THREE.Vector3(x, 140, z), down, 0, 300).intersectObjects(stadiumMeshes, false)[0];
  if (!roof || Math.abs(roof.point.y - (st.fieldY + 66)) > 0.05) fail('preserved west press-box roof is missing or at the wrong height');
}

// ---- 4. travel and flight landing ----
const std = r.travel(r.world.data.landmarks.STD.position);
console.log('STADIUM-STD-TRAVEL', JSON.stringify(std));
if (!std.landing || std.enclosed !== false) fail('STD travel did not land outdoors');
const fy = st.fieldY, landings = {};
for (const [label, [x, z], y] of [['west lower bowl', fromTV(20, 0), fy + 60], ['west upper deck', fromTV(60, -20), fy + 80], ['field', [444.3, 272.5], fy + 30]]) {
  const hit = findFlightLanding(physics, player, { x, y, z }, undefined, null);
  landings[label] = hit ? hit.toArray().map(q => +q.toFixed(2)) : null;
  if (!hit) fail(`flight landing found no support on the ${label}`);
}
console.log('STADIUM-FLIGHT-LANDING', JSON.stringify(landings));

// ---- 5. turf painter orientation (recording 2D context) ----
{
  const texts = [], paths = [];
  let M = [1, 0, 0, 1, 0, 0]; const stack = [];
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const ap = (x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
  const ctx = new Proxy({}, { get: (_, k) => ({
    setTransform: (a, b, c, d, e, f) => { M = [a, b, c, d, e, f]; }, translate: (x, y) => { M = mul(M, [1, 0, 0, 1, x, y]); },
    rotate: a => { M = mul(M, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); }, scale: (x, y) => { M = mul(M, [x, 0, 0, y, 0, 0]); },
    save: () => stack.push(M), restore: () => { M = stack.pop(); },
    fillText: (t, x, y) => { const p = ap(x, y), q = ap(x, y - 1), rr = ap(x + 1, y); texts.push({ t, p, up: [q[0] - p[0], q[1] - p[1]], right: [rr[0] - p[0], rr[1] - p[1]] }); },
    beginPath: () => { paths.length = 0; },
    moveTo: (x, y) => paths.push(ap(x, y)), lineTo: (x, y) => paths.push(ap(x, y)),
    bezierCurveTo: (a, b, c, d, e, f) => { paths.push(ap(a, b), ap(c, d), ap(e, f)); }, canvas: canvasObj,
  })[k] ?? (() => {}), set: () => true });
  const canvasObj = { width: 0, height: 0, getContext: () => ctx };
  const prev = globalThis.document;
  // oxlint-disable-next-line typescript/no-deprecated -- inert stand-in object, not the DOM API
  globalThis.document = { createElement: () => canvasObj };
  const c = fieldCanvas();
  globalThis.document = prev;
  // canvas px -> uv (flipY) -> field frame (STADIUM_MARKINGS local(): u east, v south over the 71 x 126 m plate).
  const toField = ([x, y]) => [x / c.width * 71 - 35.5, (1 - y / c.height) * 126 - 63];
  const dirField = ([dx, dy]) => { const l = Math.hypot(dx / c.width * 71, dy / c.height * 126); return [dx / c.width * 71 / l, -dy / c.height * 126 / l]; };
  const words = texts.map(e => ({ t: e.t, at: toField(e.p).map(q => +q.toFixed(1)), up: dirField(e.up).map(q => +q.toFixed(2)), reads: dirField(e.right).map(q => +q.toFixed(2)) }));
  const texas = words.find(w => w.t === 'TEXAS'), horns = words.find(w => w.t === 'LONGHORNS'), nums = words.filter(w => /^\d+$/.test(w.t));
  const numOk = nums.filter(w => Math.sign(w.at[0]) === Math.sign(w.up[0]) && Math.abs(w.up[0]) > 0.99).length;
  const contour = paths.map(toField);
  const mid = contour.length ? [0, 1].map(axis => +(0.5 * (Math.min(...contour.map(p => p[axis])) + Math.max(...contour.map(p => p[axis])))).toFixed(1)) : null;
  console.log('STADIUM-TURF', JSON.stringify({ size: [c.width, c.height], texas, longhorns: horns, numbers: nums.length, numbersTopTowardSideline: numOk, midfieldPathEnd: mid }));
  // Reading direction (not mirrored): facing north, TEXAS reads west -> east; facing south, LONGHORNS reads east -> west.
  if (!texas || !(texas.at[1] < -45 && texas.up[1] < -0.99 && texas.reads[0] > 0.99)) fail('TEXAS is not in the north end zone reading from the field');
  if (!horns || !(horns.at[1] > 45 && horns.up[1] > 0.99 && horns.reads[0] < -0.99)) fail('LONGHORNS is not in the south end zone reading from the field');
  // Not mirrored: in the field frame seen from above (u east = screen right, v south = screen down) a glyph's reading
  // direction is its 'up' turned 90 deg clockwise, i.e. reads x up = -1 (z component of the 2-D cross product).
  const mirrored = nums.filter(w => Math.abs(w.reads[0] * w.up[1] - w.reads[1] * w.up[0] + 1) > 0.01).length;
  if (mirrored) fail(`${mirrored} yard numbers are mirrored`);
  if (nums.length !== 18 || numOk !== 18) fail(`yard numbers: ${nums.length} drawn, ${numOk} with tops toward the nearer sideline`);
  if (!mid || Math.hypot(mid[0], mid[1]) > 1) fail('midfield mark not at the centre');
}
console.log(failed ? 'STADIUM-DEFAULT-CHECK FAIL' : 'STADIUM-DEFAULT-CHECK OK');
process.exit(failed ? 1 : 0);
