// Deterministic lifecycle tests for lib/campus/scan-landmarks.ts with injected loaders.
// No WebGL, network or real assets: tiny in-memory GLTF stand-ins with dispose counters.
// Runs the TypeScript module directly (Node >= 22.18 / 25 type stripping).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const { prepareScanTower, prepareScanStand, loadScanTower, loadScanField } = await import(pathToFileURL(resolve(import.meta.dirname, '../../lib/campus/scan-landmarks.ts')).href);
await RAPIER.init();

let failures = 0;
const results = [];
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures++; };
const tick = () => new Promise(r => setTimeout(r, 5));

/** A GLTF stand-in: 3 meshes, shared geometry/material, a texture on a closable ImageBitmap stand-in. */
function fakeGltf({ nan = false, collider = false } = {}) {
  const counts = new Map();
  const track = r => { counts.set(r, 0); r.addEventListener('dispose', () => counts.set(r, counts.get(r) + 1)); return r; };
  const tri = v => new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0].map(x => (nan ? NaN : x + v))), 3);
  const shared = track(new THREE.BufferGeometry()); shared.setAttribute('position', tri(0));
  const other = track(new THREE.BufferGeometry()); other.setAttribute('position', tri(2));
  const bitmap = { width: 1, height: 1, closed: 0, close() { this.closed++; } };
  const texture = track(new THREE.Texture(bitmap));
  const textured = track(new THREE.MeshBasicMaterial({ map: texture })), plain = track(new THREE.MeshBasicMaterial());
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(shared, textured), new THREE.Mesh(shared, textured), new THREE.Mesh(other, plain));
  if (collider) { // the stand's reduced collider surface ships as a named, indexed mesh
    const cg = track(new THREE.BufferGeometry()); cg.setAttribute('position', tri(0)); cg.setIndex([0, 1, 2]);
    const cm = new THREE.Mesh(cg, track(new THREE.MeshBasicMaterial())); cm.name = 'DKR west stand collider'; scene.add(cm);
  }
  return {
    gltf: { scene, scenes: [scene] },
    /** every resource disposed exactly once and the bitmap closed exactly once */
    clean: () => [...counts.values()].every(n => n === 1) && bitmap.closed === 1,
    untouched: () => [...counts.values()].every(n => n === 0) && bitmap.closed === 0,
    summary: () => `dispose counts ${[...counts.values()].join(',')}, bitmap closes ${bitmap.closed}`,
  };
}
/** Loader whose results are released by the test, in request order. */
function deferredLoader() {
  const calls = [];
  const load = url => new Promise((resolve, reject) => calls.push({ url, resolve, reject }));
  return { load, calls };
}
const rejects = async (p, pattern) => { try { await p; return false; } catch (e) { return pattern.test(String(e?.message ?? e)); } };
/** Physics wrapper that counts collider creation (and can inject a failure on the n-th call). */
function countingPhysics(world, failOn = 0) {
  let created = 0;
  return {
    get created() { return created; },
    createCollider(desc) { created++; if (failOn && created === failOn) throw new Error('injected collider failure'); return world.createCollider(desc); },
    removeCollider: (c, wake) => world.removeCollider(c, wake),
    getCollider: h => world.getCollider(h),
  };
}

// 1. late success after timeout
{
  const L = deferredLoader(), near = fakeGltf(), far = fakeGltf();
  const ok = await rejects(prepareScanTower({ load: L.load, timeoutMs: 10 }), /timed out/);
  L.calls[0].resolve(near.gltf); L.calls[1].resolve(far.gltf); await tick();
  check('tower: late success after timeout is disposed', ok && near.clean() && far.clean(), `${near.summary()} | ${far.summary()}`);
}
{
  const L = deferredLoader(), field = fakeGltf();
  const ok = await rejects(loadScanField({ fieldY: 0, load: L.load, timeoutMs: 10 }), /timed out/);
  L.calls[0].resolve(field.gltf); await tick();
  check('field: late success after timeout is disposed', ok && field.clean(), field.summary());
}
// 2. one sibling rejection (success first, and success arriving after the rejection)
{
  const L = deferredLoader(), near = fakeGltf();
  const p = prepareScanTower({ load: L.load, timeoutMs: 5000 });
  L.calls[0].resolve(near.gltf); await tick(); L.calls[1].reject(new Error('far 404'));
  const ok = await rejects(p, /far 404/);
  check('tower: sibling rejection disposes the already-loaded sibling', ok && near.clean(), near.summary());
}
{
  const L = deferredLoader(), near = fakeGltf();
  const p = prepareScanTower({ load: L.load, timeoutMs: 5000 });
  L.calls[1].reject(new Error('far 404'));
  const ok = await rejects(p, /far 404/);
  L.calls[0].resolve(near.gltf); await tick();
  check('tower: sibling arriving after the rejection is disposed', ok && near.clean(), near.summary());
}
// 3. invalid geometry
{
  const L = deferredLoader(), near = fakeGltf({ nan: true }), far = fakeGltf();
  const p = prepareScanTower({ load: L.load, timeoutMs: 5000 });
  L.calls[0].resolve(near.gltf); L.calls[1].resolve(far.gltf);
  const ok = await rejects(p, /non-finite/);
  check('tower: invalid geometry rejects and disposes both LODs once', ok && near.clean() && far.clean(), `${near.summary()} | ${far.summary()}`);
}
{
  const L = deferredLoader(), field = fakeGltf({ nan: true });
  const p = loadScanField({ fieldY: 0, load: L.load, timeoutMs: 5000 });
  L.calls[0].resolve(field.gltf);
  check('field: invalid geometry rejects and disposes once', (await rejects(p, /non-finite/)) && field.clean(), field.summary());
}
// 4. disposal while pending — the game path: prepare (no physics), game disposed, world freed, then loads resolve
{
  const L = deferredLoader(), near = fakeGltf(), far = fakeGltf();
  const world = new RAPIER.World({ x: 0, y: -9, z: 0 }), physics = countingPhysics(world), lifetime = new AbortController();
  let disposed = false, committed = null;
  const pending = prepareScanTower({ load: L.load, signal: lifetime.signal, timeoutMs: 5000 }).then(prepared => {
    if (disposed) { prepared.dispose(); return null; }
    committed = prepared.commit(physics); return committed;
  }, () => null);
  // CampusGame.dispose(): disposed flag, abort, physics.free()
  disposed = true; lifetime.abort(); world.free();
  L.calls[0].resolve(near.gltf); L.calls[1].resolve(far.gltf);
  const value = await pending; await tick();
  check('tower: disposal while pending — no collider on freed world, all decoded resources disposed',
    value === null && committed === null && physics.created === 0 && near.clean() && far.clean(), `createCollider calls ${physics.created}; ${near.summary()} | ${far.summary()}`);
}
{
  // Resolved first, game disposed before commit (prepared owned by the game, released by dispose()).
  const L = deferredLoader(), near = fakeGltf(), far = fakeGltf();
  const world = new RAPIER.World({ x: 0, y: -9, z: 0 }), physics = countingPhysics(world), lifetime = new AbortController();
  const p = prepareScanTower({ load: L.load, signal: lifetime.signal, timeoutMs: 5000 });
  L.calls[0].resolve(near.gltf); L.calls[1].resolve(far.gltf);
  const prepared = await p;
  prepared.dispose(); lifetime.abort(); world.free(); // game dispose() while awaiting terrain
  check('tower: prepared-but-uncommitted scan disposed by owner, never touches physics', physics.created === 0 && near.clean() && far.clean(), `${near.summary()} | ${far.summary()}`);
  let threw = false; try { prepared.commit(physics); } catch { threw = true; }
  check('tower: commit after dispose is refused', threw && physics.created === 0);
}
{
  const L = deferredLoader(), field = fakeGltf(), lifetime = new AbortController();
  const p = loadScanField({ fieldY: 0, load: L.load, signal: lifetime.signal, timeoutMs: 5000 });
  lifetime.abort();
  const ok = await rejects(p, /cancelled/);
  L.calls[0].resolve(field.gltf); await tick();
  check('field: abort while pending disposes the late arrival', ok && field.clean(), field.summary());
}
{
  // Already-aborted signal: rejects at once, any later arrival is disposed.
  const L = deferredLoader(), near = fakeGltf(), far = fakeGltf(), lifetime = new AbortController();
  lifetime.abort();
  const ok = await rejects(prepareScanTower({ load: L.load, signal: lifetime.signal }), /cancelled/);
  for (const c of L.calls) c.resolve(c === L.calls[0] ? near.gltf : far.gltf);
  await tick();
  check('tower: pre-aborted signal rejects and never leaks', ok && (L.calls.length === 0 || (near.clean() && far.clean())), `loader calls ${L.calls.length}`);
}
{
  // Reviewer's reproducer shape (convenience API, no signal, world freed before resolve):
  // the commit fails on the freed world, but the decoded assets are still disposed.
  const L = deferredLoader(), near = fakeGltf(), far = fakeGltf();
  const world = new RAPIER.World({ x: 0, y: -9, z: 0 });
  const p = loadScanTower({ physics: world, load: L.load, timeoutMs: 5000 });
  world.free();
  L.calls[0].resolve(near.gltf); L.calls[1].resolve(far.gltf);
  let error = null; try { await p; } catch (e) { error = e; }
  check('tower: legacy loadScanTower on a freed world rejects without leaking', error !== null && near.clean() && far.clean(), `${String(error?.message ?? error)}; ${near.summary()} | ${far.summary()}`);
}
// 5. collider rollback and the normal success path
{
  const L = deferredLoader(), near = fakeGltf(), far = fakeGltf();
  const world = new RAPIER.World({ x: 0, y: -9, z: 0 }), physics = countingPhysics(world, 2);
  const p = prepareScanTower({ load: L.load, timeoutMs: 5000 });
  L.calls[0].resolve(near.gltf); L.calls[1].resolve(far.gltf);
  const prepared = await p;
  let threw = false; try { prepared.commit(physics); } catch { threw = true; }
  const left = world.colliders.len();
  prepared.dispose();
  check('tower: collider failure rolls back partial colliders; prepared still disposable', threw && left === 0 && near.clean() && far.clean(), `colliders left ${left}; ${near.summary()}`);
  world.free();
}
{
  const L = deferredLoader(), near = fakeGltf(), far = fakeGltf();
  const world = new RAPIER.World({ x: 0, y: -9, z: 0 });
  const p = prepareScanTower({ load: L.load, timeoutMs: 5000 });
  L.calls[0].resolve(near.gltf); L.calls[1].resolve(far.gltf);
  const prepared = await p;
  check('tower: prepare decodes without touching physics', near.untouched() && far.untouched() && world.colliders.len() === 0);
  const tower = prepared.commit(world);
  const made = world.colliders.len();
  tower.dispose(); tower.dispose();
  check('tower: commit creates the proxy colliders; dispose removes them and frees each resource once',
    made === tower.colliders.length && made >= 2 && world.colliders.len() === 0 && near.clean() && far.clean(), `colliders ${made}; ${near.summary()} | ${far.summary()}`);
  world.free();
}
{
  const L = deferredLoader(), field = fakeGltf();
  const p = loadScanField({ fieldY: 1, load: L.load, timeoutMs: 5000 });
  L.calls[0].resolve(field.gltf);
  const f = await p; f.dispose(); f.dispose();
  check('field: success then double dispose frees each resource once', field.clean(), field.summary());
}

// 6. DKR west stand: same ownership rules, collider only at commit
{
  const L = deferredLoader(), near = fakeGltf({ collider: true }), far = fakeGltf();
  const ok = await rejects(prepareScanStand({ load: L.load, timeoutMs: 10 }), /timed out/);
  L.calls[0].resolve(near.gltf); L.calls[1].resolve(far.gltf); await tick();
  check('stand: late success after timeout is disposed', ok && near.clean() && far.clean(), `${near.summary()} | ${far.summary()}`);
}
{
  const L = deferredLoader(), near = fakeGltf({ collider: true }), far = fakeGltf();
  const world = new RAPIER.World({ x: 0, y: -9, z: 0 }), physics = countingPhysics(world), lifetime = new AbortController();
  let disposed = false;
  const pending = prepareScanStand({ load: L.load, signal: lifetime.signal, timeoutMs: 5000 }).then(prepared => { if (disposed) { prepared.dispose(); return null; } return prepared.commit(physics, 0); }, () => null);
  disposed = true; lifetime.abort(); world.free();
  L.calls[0].resolve(near.gltf); L.calls[1].resolve(far.gltf);
  const value = await pending; await tick();
  check('stand: disposal while pending — no collider on freed world, all decoded resources disposed', value === null && physics.created === 0 && near.clean() && far.clean(), `createCollider calls ${physics.created}; ${near.summary()}`);
}
{
  const L = deferredLoader(), near = fakeGltf(), far = fakeGltf(); // no collider mesh
  const p = prepareScanStand({ load: L.load, timeoutMs: 5000 });
  L.calls[0].resolve(near.gltf); L.calls[1].resolve(far.gltf);
  check('stand: missing collider surface rejects and disposes everything', (await rejects(p, /collider surface missing/)) && near.clean() && far.clean(), near.summary());
}
{
  const L = deferredLoader(), near = fakeGltf({ collider: true }), far = fakeGltf();
  const world = new RAPIER.World({ x: 0, y: -9, z: 0 });
  const p = prepareScanStand({ load: L.load, timeoutMs: 5000 });
  L.calls[0].resolve(near.gltf); L.calls[1].resolve(far.gltf);
  const prepared = await p;
  const zeroBefore = world.colliders.len() === 0;
  const stand = prepared.commit(world, -2.5);
  const made = world.colliders.len(), y = stand.group.position.y;
  stand.dispose(); stand.dispose();
  check('stand: commit creates one trimesh on the field plane; dispose removes it and frees each resource once',
    zeroBefore && made === 1 && y === -2.5 && world.colliders.len() === 0 && near.clean() && far.clean(), `colliders ${made}; ${near.summary()} | ${far.summary()}`);
  world.free();
}

for (const r of results) console.log(r);
if (failures) { console.error(`FAIL: ${failures} scan lifecycle test(s)`); process.exit(1); }
console.log(`SCAN-LIFECYCLE OK (${results.length} tests)`);
