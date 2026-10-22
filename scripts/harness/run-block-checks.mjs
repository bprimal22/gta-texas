// Whole-campus block checks (headless, real scene). Generic rules for every block, then each
// block's own check (scripts/harness/blocks/<id>.ts).
//   node scripts/harness/run-block-checks.mjs [blockId ...]
// Generic rules (fail):
//  G1 block data accepted by the runtime validator (ownership by record key, schema, evidence, conflicts);
//     every declared replacement committed (its install() built it) — else the fallback stays and this fails.
//  G2 walkable block meshes: visible up-facing tops = the block's OWN colliders within 0.05 m (both directions).
//  G3 solid block meshes: tops within 0.10 m and side faces within 0.15 m of the block's own colliders
//     (BlockInstall.reusedColliders names intentionally reused pre-existing colliders; only those are accepted).
//  G4 no block collider in a standing capsule above OTHER walkable ground (walkway.surfaces) in/near the block.
//  G5 block shots: camera inside the block's rectangles (±40 m for aerials), fields present.
//  G6 every installed mesh whose material multiplies by vertex colours has a colour attribute (else it renders black).
// Reported (not failed): triangles, meshes, colliders, draw-call estimate, install ms.
import './stubs.mjs';
import { probeSideFace } from './side-face-probe.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const root = resolve(import.meta.dirname, '../..');
const { run, BLOCK_CHECKS } = await import(pathToFileURL(resolve(root, '.work/harness-dist/context-check.mjs')).href);
const { BLOCKS } = await import(pathToFileURL(resolve(root, 'tools/blocks/partition.mjs')).href);
const THREE = await import('three');
const only = process.argv.slice(2);
const scene = await run({ scan: true });
const { physics, RAPIER, player, blocks, blockData, walkway } = scene;
const down = { x: 0, y: -1, z: 0 };
let failed = false;
const fail = (id, msg) => { console.error('FAIL', id, msg); failed = true; };
const tri = new THREE.Triangle(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
const upTriangles = (root, each) => root.traverse(o => {
  if (!o.isMesh) return; o.updateWorldMatrix(true, false);
  const pos = o.geometry.getAttribute('position'), idx = o.geometry.index, count = idx ? idx.count : pos.count;
  for (let t = 0; t + 2 < count; t += 3) {
    a.fromBufferAttribute(pos, idx ? idx.getX(t) : t).applyMatrix4(o.matrixWorld);
    b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(o.matrixWorld);
    c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(o.matrixWorld);
    tri.set(a, b, c); tri.getNormal(n); if (n.y < 0.5 || tri.getArea() < 1e-4) continue;
    each(a.clone(), b.clone(), c.clone(), o);
  }
});
if (blockData.errors.length) console.error('block data errors:', blockData.errors.length);
const summary = {};
for (const def of BLOCKS) {
  if (only.length && !only.includes(def.id)) continue;
  const id = def.id, report = { data: blockData.applied[id] ?? null };
  // G1 data: validated atomically at runtime (registry.applyBlockData); rejected blocks / errors fail here.
  if (blockData.rejected[id]) for (const e of blockData.rejected[id]) fail(id, `data rejected: ${e}`);
  const fallback = Object.entries(blocks.replacements.fallback).filter(([, o]) => o === id).map(([k]) => k);
  if (fallback.length) fail(id, `declared replacements not built by install() (generated fallback kept): ${fallback.join(', ')}`);
  report.replacements = { committed: Object.entries(blocks.replacements.committed).filter(([, o]) => o === id).map(([k]) => k), fallback };
  report.excluded = blockData.excluded.filter(e => e.block === id).map(e => e.key);
  report.added = blockData.added.filter(e => e.block === id).map(e => e.key);
  const inst = blocks.installs.find(x => x.id === id)?.install;
  report.install = blocks.stats[id] ?? null;
  if (blocks.stats[id]?.failed) fail(id, `install failed: ${blocks.stats[id].failed}`);
  if (inst) {
    const entry = blocks.installs.find(x => x.id === id);
    const blockColliders = new Set(entry.colliders.map(k => k.handle));
    // Explicitly named reused colliders only (BlockInstall.reusedColliders) — never "any collider".
    const reused = new Set(entry.reused.map(k => k.handle));
    const accept = k => blockColliders.has(k.handle) || reused.has(k.handle);
    // Rays only against THIS block's colliders: another collider above/below cannot pass the test.
    const ownY = (x, z, fromY, reach = 4) => { const h = physics.castRay(new RAPIER.Ray({ x, y: fromY, z }, down), reach, true, undefined, undefined, player, undefined, accept); return h ? fromY - h.timeOfImpact : null; };
    // G2 walkable visible = own physical, absolute error both directions
    let wS = 0, wBad = 0, wWorst = 0;
    for (const w of entry.walkable) upTriangles(w, (p, q, r) => {
      const cx = (p.x + q.x + r.x) / 3, cy = (p.y + q.y + r.y) / 3, cz = (p.z + q.z + r.z) / 3, y = ownY(cx, cz, cy + 1.0, 2.0);
      wS++; const d = y === null ? Infinity : Math.abs(y - cy); wWorst = Math.max(wWorst, Math.min(d, 99)); if (d > 0.05) wBad++;
    });
    report.walkable = { samples: wS, mismatchedOver005: wBad, worst: +wWorst.toFixed(3) };
    if (wBad) fail(id, `${wBad}/${wS} walkable tops differ from the block's own colliders by > 0.05 m`);
    // G3 solid tops: own collider within 0.10 m of the visible top (both directions); side faces: own collider
    // within 0.15 m of the face along its outward normal.
    let sS = 0, sBad = 0, fS = 0, fBad = 0, closeFaceProofs = 0; const sideExamples = [];
    const fn = new THREE.Vector3();
    for (const s of inst.solids ?? []) {
      upTriangles(s, (p, q, r) => {
        const cx = (p.x + q.x + r.x) / 3, cy = (p.y + q.y + r.y) / 3, cz = (p.z + q.z + r.z) / 3, y = ownY(cx, cz, cy + 1.0, 2.0);
        sS++; if (y === null || Math.abs(y - cy) > 0.1 + Math.abs(Math.max(p.y, q.y, r.y) - Math.min(p.y, q.y, r.y)) / 2) sBad++;
      });
      s.traverse(o => {
        if (!o.isMesh) return; o.updateWorldMatrix(true, false);
        const pos = o.geometry.getAttribute('position'), idx = o.geometry.index, count = idx ? idx.count : pos.count;
        for (let t = 0; t + 2 < count; t += 3 * Math.max(1, Math.floor(count / 3 / 400))) {
          a.fromBufferAttribute(pos, idx ? idx.getX(t) : t).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(o.matrixWorld);
          tri.set(a, b, c); tri.getNormal(fn); if (Math.abs(fn.y) > 0.3 || tri.getArea() < 0.05) continue;
          const m = new THREE.Vector3().addVectors(a, b).add(c).multiplyScalar(1 / 3);
          const contact = probeSideFace(physics, RAPIER, m, fn, player, accept);
          if (contact.localProof) closeFaceProofs++;
          fS++; if (!contact.matched) { fBad++; if (sideExamples.length < 3) sideExamples.push([+m.x.toFixed(1), +m.y.toFixed(1), +m.z.toFixed(1), o.name]); }
        }
      });
    }
    report.solidTops = { samples: sS, mismatched: sBad };
    report.sideFaces = { samples: fS, withoutOwnCollider: fBad, closeFaceProofs, examples: sideExamples };
    if (sBad) fail(id, `${sBad}/${sS} solid tops lack an own collider within 0.1 m`);
    if (fBad) fail(id, `${fBad}/${fS} solid side faces lack an own collider within 0.15 m, e.g. ${JSON.stringify(sideExamples)}`);
    // G4 no block collider over other authored walkable ground inside the block bounds (+10 m)
    const box = def.rects.reduce((m, [x0, x1, z0, z1]) => [Math.min(m[0], x0 - 10), Math.max(m[1], x1 + 10), Math.min(m[2], z0 - 10), Math.max(m[3], z1 + 10)], [Infinity, -Infinity, Infinity, -Infinity]);
    const own = new Set(); for (const w of entry.walkable) w.traverse(o => own.add(o));
    let gS = 0, gBad = 0; const examples = [];
    const shape = new RAPIER.Capsule(0.5, 0.3);
    for (const rootObj of [walkway.surfaces]) upTriangles(rootObj, (p, q, r, mesh) => {
      if (own.has(mesh) || mesh.name === 'Offline local contour terrain' || mesh.userData.block === id) return;
      const cx = (p.x + q.x + r.x) / 3, cz = (p.z + q.z + r.z) / 3;
      if (cx < box[0] || cx > box[1] || cz < box[2] || cz > box[3]) return;
      const cy = (p.y + q.y + r.y) / 3; gS++;
      let hit = false;
      physics.intersectionsWithShape({ x: cx, y: cy + 0.3 + 0.8, z: cz }, { x: 0, y: 0, z: 0, w: 1 }, shape, k => { if (blockColliders.has(k.handle)) { hit = true; return false; } return true; }, undefined, undefined, player);
      if (hit) { gBad++; if (examples.length < 5) examples.push([+cx.toFixed(1), +cy.toFixed(2), +cz.toFixed(1), mesh.name]); }
    });
    report.otherWalkableBlocked = { samples: gS, blocked: gBad, examples };
    if (gBad) fail(id, `${gBad} other authored walkable samples blocked by block colliders, e.g. ${JSON.stringify(examples)}`);
  }
  // G6 vertex-colour compatibility
  if (inst) {
    const bad = [];
    for (const root of [...(inst.solids ?? []), ...(inst.walkable ?? []), ...(inst.detail ?? [])]) root.traverse(o => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m?.vertexColors && !o.geometry.getAttribute('color')) bad.push(`${o.name} / ${m.name}`);
    });
    report.vertexColorMismatch = bad.length;
    if (bad.length) fail(id, `${bad.length} meshes use vertexColors materials without a colour attribute (render black): ${bad.slice(0, 5).join('; ')}`);
  }
  // G5 shots
  const shots = JSON.parse(readFileSync(resolve(root, `lib/campus/blocks/${id}/shots.json`), 'utf8'));
  for (const s of shots) {
    const [x, , z] = s.position ?? [], margin = s.kind === 'aerial' ? 40 : 0;
    if (!s.id?.startsWith(id.split('-')[0] + '-') || !s.label || !s.target || !s.fov || s.groundY === undefined || !s.kind || s.block !== id) fail(id, `shot ${s.id}: fields (id prefix "${id.split('-')[0]}-", label, position, target, fov, groundY, kind, block)`);
    if (!def.rects.some(([x0, x1, z0, z1]) => x >= x0 - margin && x < x1 + margin && z >= z0 - margin && z < z1 + margin)) fail(id, `shot ${s.id} camera outside the block`);
  }
  report.shots = shots.length;
  // block-owned checks
  const own = await BLOCK_CHECKS[id](scene);
  report.own = own.report;
  if (!own.ok) for (const f of own.failures ?? ['block check failed']) fail(id, f);
  summary[id] = report;
  console.log('BLOCK', id, JSON.stringify(report));
}
if (failed) { console.error('FAIL: block checks'); process.exit(1); }
console.log('BLOCK-CHECKS OK', Object.keys(summary).length);
