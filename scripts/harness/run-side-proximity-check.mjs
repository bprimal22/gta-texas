import RAPIER from '@dimforge/rapier3d-compat';
import assert from 'node:assert/strict';
import { probeSideFace } from './side-face-probe.mjs';
await RAPIER.init();
const rows = [];
for (const [name, planes, expected, useNear] of [
  ['isolated matching face', [0], true, false],
  ['matching face behind nearby own wall', [0, 0.336], true, true],
  ['missing face with nearby wall', [0.336], false, false],
  ['face displaced twenty centimetres', [-0.2, 0.336], false, false],
  ['missing face without occluder', [], false, false],
]) {
  const physics = new RAPIER.World({ x: 0, y: 0, z: 0 }), vertices = [];
  for (const x of planes) vertices.push(x,-2,-2, x,2,-2, x,2,2, x,-2,-2, x,2,2, x,-2,2);
  if (vertices.length) physics.createCollider(RAPIER.ColliderDesc.trimesh(Float32Array.from(vertices), Uint32Array.from({ length: vertices.length / 3 }, (_, i) => i)));
  physics.step();
  const got = probeSideFace(physics, RAPIER, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  assert.equal(got.matched, expected, name); assert.equal(got.localProof, useNear, name);
  rows.push({ name, ...got }); physics.free();
}
// A collider belonging to another block must not provide the local proof.
{
  const physics = new RAPIER.World({ x: 0, y: 0, z: 0 });
  physics.createCollider(RAPIER.ColliderDesc.cuboid(0.001, 2, 2)); physics.step();
  const got = probeSideFace(physics, RAPIER, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, undefined, () => false);
  assert.equal(got.matched, false, 'foreign block excluded'); rows.push({ name: 'foreign block excluded', ...got }); physics.free();
}
console.log('SIDE PROXIMITY PASS', JSON.stringify(rows));
