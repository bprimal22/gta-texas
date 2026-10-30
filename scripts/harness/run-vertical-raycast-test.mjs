// VerticalRaycast equivalence test (no browser, no build step):
//   node --experimental-strip-types scripts/harness/run-vertical-raycast-test.mjs
// Every query must return exactly three's Raycaster hits (distance, point, object, face, faceIndex, uv, normal,
// barycoord; same order) across indexed/non-indexed geometry, groups with mixed material sides, drawRange, transforms,
// recursion, layers and the fallback cases; in-place edits flagged needsUpdate, resized or replaced attributes must
// invalidate the cached grid; and a large ground batch must test only a small fraction of its triangles per probe.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const THREE = await import('three');
const { VerticalRaycast } = await import(resolve(root, 'lib/campus/vertical-raycast.ts'));

let seed = 12345;
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const same = (a, b) => Object.is(a, b);
const vec = (a, b) => (!a && !b) || (!!a && !!b && same(a.x, b.x) && same(a.y, b.y) && same(a.z, b.z));
function assertSameHits(fast, three, label) {
  assert.equal(fast.length, three.length, `${label}: hit count`);
  fast.forEach((x, i) => {
    const y = three[i];
    assert(same(x.distance, y.distance) && vec(x.point, y.point) && x.object === y.object && x.faceIndex === y.faceIndex
      && x.face.a === y.face.a && x.face.b === y.face.b && x.face.c === y.face.c && x.face.materialIndex === y.face.materialIndex
      && vec(x.face.normal, y.face.normal) && vec(x.uv, y.uv) && vec(x.normal, y.normal) && vec(x.barycoord, y.barycoord), `${label}: hit ${i}`);
  });
}
/** Rolling terrain-like sheet plus a few raised decks (overlapping layers), n x n quads over size metres. */
function ground(n, size, indexed = true) {
  const g = new THREE.PlaneGeometry(size, size, n, n).rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, Math.sin(p.getX(i) * .07) * 2 + Math.cos(p.getZ(i) * .05) * 1.5 + random() * .3);
  const deck = new THREE.BoxGeometry(size * .3, 1, size * .2, 6, 1, 6).translate(size * .1, 4, -size * .15);
  const merged = mergeGeometries([g, deck]);
  return indexed ? merged : merged.toNonIndexed();
}
function mergeGeometries(list) {
  const positions = [], uvs = [], normals = [], indices = [];
  let offset = 0;
  for (const g of list) {
    positions.push(...g.attributes.position.array); uvs.push(...g.attributes.uv.array); normals.push(...g.attributes.normal.array);
    for (const i of g.index.array) indices.push(i + offset);
    offset += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setIndex(indices);
  return out;
}
const sides = [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide].map(side => new THREE.MeshBasicMaterial({ side }));
const scene = new THREE.Group();
const add = (mesh, setup) => { setup?.(mesh); scene.add(mesh); return mesh; };
const plain = add(new THREE.Mesh(ground(48, 120), sides[0]), m => m.position.set(5, -1, 3));
add(new THREE.Mesh(ground(30, 80, false), sides[2]), m => { m.position.set(-20, 2, 10); m.rotation.y = .7; m.scale.set(1.3, .8, 1.1); });
const grouped = add(new THREE.Mesh(ground(32, 90), sides), m => { m.position.set(8, 3, -6); m.rotation.y = -1.2; });
grouped.geometry.addGroup(0, 1200, 0); grouped.geometry.addGroup(1200, 2400, 1); grouped.geometry.addGroup(3000, Infinity, 2);
const ranged = add(new THREE.Mesh(ground(24, 70), sides[2]), m => m.position.set(-6, 6, -4));
ranged.geometry.setDrawRange(300, 1800);
add(new THREE.Mesh(ground(20, 60), sides[2]), m => { m.position.set(2, 9, 2); m.rotation.x = .2; });
const parent = add(new THREE.Group(), g => g.position.set(0, 1, 0));
const child = new THREE.Mesh(ground(16, 50), sides[2]); child.position.set(3, 2, 1); parent.add(child);
add(new THREE.Mesh(ground(16, 50), sides[2]), m => { m.position.y = 12; m.layers.set(3); });
const morph = add(new THREE.Mesh(ground(12, 40), sides[2]), m => m.position.y = 14);
morph.geometry.morphAttributes.position = [morph.geometry.attributes.position.clone()];
morph.geometry.morphAttributes.position[0].array.forEach((v, i, a) => { if (i % 3 === 1) a[i] = v + 1.5; });
morph.updateMorphTargets(); morph.morphTargetInfluences[0] = .5;
const unaligned = add(new THREE.Mesh(ground(12, 40), sides), m => m.position.y = 16);
unaligned.geometry.addGroup(1, 600, 2);
add(new THREE.InstancedMesh(ground(8, 30), sides[2], 2), m => { m.position.y = 18; m.setMatrixAt(1, new THREE.Matrix4().makeTranslation(4, 1, 0)); });
add(new THREE.Mesh(new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2), sides[0]), m => m.position.y = 20); // < 64 triangles
scene.updateMatrixWorld(true);

const fast = new VerticalRaycast(), ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
const probe = (x, z, top = 40, far = Infinity, near = 0) => { ray.set(new THREE.Vector3(x, top, z), down); ray.far = far; ray.near = near; };
let queries = 0, hits = 0;
for (let k = 0; k < 600; k++) {
  probe(random() * 140 - 70, random() * 140 - 70, 10 + random() * 40, k % 3 ? Infinity : 15 + random() * 20, k % 7 ? 0 : 5);
  const recursive = k % 2 === 0;
  const a = fast.intersectObjects(ray, scene.children, recursive), b = ray.intersectObjects(scene.children, recursive);
  assertSameHits(a, b, `probe ${k}`); queries++; hits += a.length;
  assertSameHits(fast.intersectObject(ray, scene, true), ray.intersectObject(scene, true), `object probe ${k}`);
}
assert(hits > 1000, `probes hit geometry (${hits})`);
// Non-vertical rays (any direction) still match: three handles them.
for (let k = 0; k < 50; k++) {
  ray.set(new THREE.Vector3(random() * 60 - 30, 30, random() * 60 - 30), new THREE.Vector3(random() - .5, -1, random() - .5).normalize()); ray.far = Infinity; ray.near = 0;
  assertSameHits(fast.intersectObjects(ray, scene.children, true), ray.intersectObjects(scene.children, true), `slanted ${k}`);
}

// Invalidation: in-place edit + needsUpdate, resized/replaced attributes and a new index must never reuse a stale grid.
const p = plain.geometry.attributes.position;
const at = (x, z) => { probe(x, z, 60); return fast.intersectObject(ray, plain, false)[0]?.point.y; };
const before = at(10, 8);
for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + 7);
p.needsUpdate = true;
probe(10, 8, 60);
assertSameHits(fast.intersectObject(ray, plain, false), ray.intersectObject(plain, false), 'after in-place edit');
assert.notEqual(at(10, 8), before, 'edited geometry changes the answer');
plain.geometry.setAttribute('position', new THREE.Float32BufferAttribute(Array.from(p.array, (v, i) => i % 3 === 1 ? v + 3 : v), 3));
probe(-12, 20, 60);
assertSameHits(fast.intersectObject(ray, plain, false), ray.intersectObject(plain, false), 'after replaced position attribute');
plain.geometry.setIndex(Array.from(plain.geometry.index.array).reverse());
probe(14, -9, 60);
assertSameHits(fast.intersectObject(ray, plain, false), ray.intersectObject(plain, false), 'after replaced index');
plain.position.x += 11; plain.updateMatrixWorld(true);
probe(14, -9, 60);
assertSameHits(fast.intersectObject(ray, plain, false), ray.intersectObject(plain, false), 'after moving the mesh');

// Work: a 120 x 120 m ground batch with ~20k triangles is probed with a handful of triangle tests.
const big = new THREE.Mesh(ground(100, 120), sides[0]); big.updateMatrixWorld(true);
const triangles = big.geometry.index.count / 3, counter = new VerticalRaycast();
for (let k = 0; k < 200; k++) { probe(random() * 110 - 55, random() * 110 - 55, 30); counter.intersectObject(ray, big, false); }
const perProbe = counter.stats.triangleTests / 200;
assert(perProbe < triangles * .01, `triangle tests per probe ${perProbe} of ${triangles}`);
assert.equal(counter.stats.gridBuilds, 1, 'one grid build for an unchanged geometry');
console.log(`PASS: ${queries} vertical probes x2 + 50 slanted rays identical to three's Raycaster (${hits} hits); edits, resized/replaced attributes, new index and moved mesh stay exact; ${perProbe.toFixed(1)} of ${triangles} triangles tested per probe, 1 grid build`);
