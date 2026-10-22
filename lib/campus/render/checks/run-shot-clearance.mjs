// Shot camera clearance against the REAL authored + generated colliders.
// Requires the harness bundle (.work/harness-dist) built by:
//   npx vite build --config scripts/harness/vite.harness.config.mjs
// Usage: node lib/campus/render/checks/run-shot-clearance.mjs
import '../../../../scripts/harness/stubs.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { CAMERA_SHOTS } from '../camera-shots.ts';

const root = resolve(import.meta.dirname, '../../../..');
const { run } = await import(pathToFileURL(resolve(root, '.work/harness-dist/context-check.mjs')).href);
const result = await run();
const { physics, RAPIER, player } = result;
const failures = [];
const ball = new RAPIER.Ball(0.25);
for (const s of CAMERA_SHOTS) {
  const [x, y, z] = s.position;
  // 1) The camera point (0.25 m ball, larger than the 0.12 m near plane) overlaps no collider.
  let overlaps = 0;
  physics.intersectionsWithShape({ x, y, z }, { x: 0, y: 0, z: 0, w: 1 }, ball, () => { overlaps++; return true; }, undefined, undefined, player);
  // 2) Physical ground (first hit straight down) and overhead cover.
  const down = physics.castRay(new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 }), 200, true, undefined, undefined, player);
  const up = physics.castRay(new RAPIER.Ray({ x, y, z }, { x: 0, y: 1, z: 0 }), 60, true, undefined, undefined, player);
  const above = down ? down.timeOfImpact : null;
  // 3) Line of sight: distance to the first collider along the view ray.
  const d = s.target.map((v, i) => v - s.position[i]), len = Math.hypot(...d);
  const sight = physics.castRay(new RAPIER.Ray({ x, y, z }, { x: d[0] / len, y: d[1] / len, z: d[2] / len }), len, true, undefined, undefined, player);
  const row = { id: s.id, overlaps, heightAbovePhysicalGround: above === null ? null : +above.toFixed(2),
    overheadCoverM: up ? +up.timeOfImpact.toFixed(2) : null, firstHitAlongViewM: sight ? +sight.timeOfImpact.toFixed(1) : null, targetDistanceM: +len.toFixed(1) };
  console.log(JSON.stringify(row));
  if (overlaps) failures.push(`${s.id}: camera overlaps ${overlaps} collider(s)`);
  if (above !== null && above < 1.0) failures.push(`${s.id}: camera only ${above.toFixed(2)} m above physical ground`);
  if (sight && sight.timeOfImpact < 4) failures.push(`${s.id}: view blocked ${sight.timeOfImpact.toFixed(1)} m ahead`);
}
if (failures.length) { console.error('FAIL\n' + failures.join('\n')); process.exit(1); }
console.log('SHOT CLEARANCE PASS', CAMERA_SHOTS.length);
