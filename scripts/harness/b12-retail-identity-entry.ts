// Bundle entry for the b12 retail-identity harness (scripts/harness/b12-retail-identity.vite.config.mjs).
//  standalone(): independent real Rapier world: offline terrain collider + the retail trimesh only (no b12 index.ts involved).
//  scene():      the full headless game scene (context-check.ts run) with .work/INTEGRATION.json applied in memory by the
//                Vite config; generic G1 / G3 / G6 rules for b12 near the retail sites, the existing b12 check, the retail check.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import type { CampusData, Point, TerrainData } from '../../lib/campus/types';
import { Terrain } from '../../lib/campus/terrain';
import { capitolGroundReference } from '../../lib/campus/capitol-area';
import { decodeOfflineTerrain } from '../../lib/campus/offline-terrain-loader';
import { BakedGround } from '../../lib/campus/baked-ground';
import { applyBlockData } from '../../lib/campus/blocks/registry';
import { Kit } from '../../lib/campus/blocks/b12-west-campus/kit';
import { buildRetail, RETAIL_FEATURES, RETAIL_KEYS } from '../../lib/campus/blocks/b12-west-campus/retail-identity';
import { runRetailChecks, type RetailEnv } from './blocks/b12-retail-identity';

const root = resolve(process.cwd());
const json = <T>(p: string) => JSON.parse(readFileSync(resolve(root, p), 'utf8')) as T;
const bin = (p: string) => { const b = gunzipSync(readFileSync(resolve(root, p))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
/** Source rings (campus.json record key "<id>:<index>") and source massing (unpatched context.json file). */
function sources() {
  const raw = json<CampusData>('public/data/campus.json'), ctx = json<{ massing: RetailEnv['sourceMassing'] }>('lib/campus/blocks/b12-west-campus/context.json');
  const sourceRings: Record<string, Point[]> = {}, sourceMassing: RetailEnv['sourceMassing'] = {};
  for (const key of Object.values(RETAIL_KEYS)) { const [id, i] = key.split(':').map(Number); const b = raw.buildings[i]; if (b?.id === id) sourceRings[key] = b.rings[0] as Point[]; sourceMassing[key] = ctx.massing[key]; }
  return { sourceRings, sourceMassing };
}
const trimeshTriangles = (c: RAPIER.Collider) => {
  const sh = c.shape as unknown as { vertices?: Float32Array; indices?: Uint32Array };
  if (!sh.vertices || !sh.indices) return new Float32Array(0);
  const out = new Float32Array(sh.indices.length * 3);
  sh.indices.forEach((ix, k) => { out[k * 3] = sh.vertices![ix * 3]; out[k * 3 + 1] = sh.vertices![ix * 3 + 1]; out[k * 3 + 2] = sh.vertices![ix * 3 + 2]; });
  return out;
};

export async function standalone() {
  await RAPIER.init();
  const physics = new RAPIER.World({ x: 0, y: -24, z: 0 }), data = json<CampusData>('public/data/campus.json');
  const blockData = applyBlockData(data);
  const terrainData = new Terrain(json<TerrainData>('public/data/terrain.json'), capitolGroundReference);
  const terrain = decodeOfflineTerrain(bin('public/assets/campus/offline-terrain-61.bin.gz'), new THREE.MeshBasicMaterial());
  for (const geo of terrain.colliderGeometries) { const p = geo.getAttribute('position').array as Float32Array, ix = geo.index ? geo.index.array : Uint32Array.from({ length: p.length / 3 }, (_, i) => i); physics.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(p), new Uint32Array(ix))); }
  const ground = new BakedGround(terrain.mesh.geometry.getAttribute('position').array, 8, (x, z) => terrainData.height(x, z)), g = (x: number, z: number) => ground.height(x, z);
  const k = new Kit(), stats: Record<string, unknown> = {}, started = performance.now();
  const built = buildRetail(k, data, g, stats);
  k.flushFaces();
  const buildMs = Math.round(performance.now() - started);
  const solids = [...k.solid.values()].filter(b => b.triangles).map(b => new THREE.Mesh(b.geometry(), new THREE.MeshBasicMaterial()));
  const detail = [...k.detail.values()].filter(b => b.triangles).map(b => new THREE.Mesh(b.geometry(), new THREE.MeshBasicMaterial()));
  const pos = new Float32Array([...k.solid.values()].flatMap(b => b.pos));
  const collider = physics.createCollider(RAPIER.ColliderDesc.trimesh(pos, Uint32Array.from({ length: pos.length / 3 }, (_, i) => i), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.8));
  const body = physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 200, 0));
  const player = physics.createCollider(RAPIER.ColliderDesc.capsule(0.54, 0.34).setFriction(0), body);
  physics.step();
  const group = new THREE.Group(); group.add(...solids);
  const env: RetailEnv = { physics, RAPIER, player, own: new Set([collider.handle]), solids, detail, colliderPositions: [trimeshTriangles(collider)], g, groundRoots: [terrain.mesh, group],
    paths: data.paths as RetailEnv['paths'], ...sources(), trees: (data.trees ?? []).map(t => ({ x: t.position[0], z: t.position[1] })) };
  const res = runRetailChecks(env);
  return { mode: 'standalone', built, buildMs, stats: stats.retailIdentity, blockDataErrors: blockData.errors, ...res };
}

export async function scene() {
  const { run, BLOCK_CHECKS } = await import('./context-check');
  const sc = await run({ scan: false });
  const failures: string[] = [], report: Record<string, unknown> = {};
  const entry = sc.blocks.installs.find(x => x.id === 'b12-west-campus');
  if (!entry) return { mode: 'scene', ok: false, failures: ['b12 install missing: ' + JSON.stringify(sc.blocks.stats['b12-west-campus'])], report };
  const own = new Set(entry.colliders.map(c => c.handle));
  // G1 (retail keys): committed, nothing left on the generated fallback, data accepted
  const committed = Object.entries(sc.blocks.replacements.committed).filter(([, o]) => o === 'b12-west-campus').map(([k]) => k);
  const fallback = Object.entries(sc.blocks.replacements.fallback).filter(([, o]) => o === 'b12-west-campus').map(([k]) => k);
  for (const k of Object.values(RETAIL_KEYS)) if (!committed.includes(k)) failures.push(`G1 ${k} not committed`);
  if (fallback.length) failures.push(`G1 fallback kept: ${fallback.join(', ')}`);
  for (const e of sc.blockData.rejected['b12-west-campus'] ?? []) failures.push(`G1 data rejected: ${e}`);
  const plans = new Map(sc.plans.map(p => [p.building.key ?? String(p.building.id), p.decision]));
  report.G1 = { committed: Object.values(RETAIL_KEYS).map(k => [k, committed.includes(k), plans.get(k)]), fallback, b12Stats: { ...(sc.blocks.stats['b12-west-campus'] as Record<string, unknown>), retailIdentity: undefined }, retail: (sc.blocks.stats['b12-west-campus'] as Record<string, unknown>)?.retailIdentity };
  for (const k of Object.values(RETAIL_KEYS)) if (plans.get(k) !== 'authored') failures.push(`G1 ${k} context decision ${plans.get(k)} (expected authored)`);
  // G3 near the retail sites: solid tops within 0.1 m and side faces within 0.15 m of own colliders
  const boxes = Object.values(RETAIL_FEATURES).map(i => { const xs = i!.ring.map(p => p[0]), zs = i!.ring.map(p => p[1]); return [Math.min(...xs) - 2.5, Math.max(...xs) + 2.5, Math.min(...zs) - 2.5, Math.max(...zs) + 2.5]; });
  const inBox = (x: number, z: number) => boxes.some(b => x >= b[0] && x <= b[1] && z >= b[2] && z <= b[3]);
  const accept = (c: { handle: number }) => own.has(c.handle);
  const tri = new THREE.Triangle(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  let tops = 0, topBad = 0, sides = 0, sideBad = 0; const ex: unknown[] = [], exTop: unknown[] = [];
  for (const s of entry.install.solids ?? []) s.traverse(o => {
    const m = o as THREE.Mesh; if (!m.isMesh) return; m.updateWorldMatrix(true, false); const p = m.geometry.getAttribute('position');
    for (let t = 0; t + 2 < p.count; t += 3) {
      a.fromBufferAttribute(p, t).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(p, t + 1).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(p, t + 2).applyMatrix4(m.matrixWorld);
      const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3, cz = (a.z + b.z + c.z) / 3; if (!inBox(cx, cz)) continue;
      tri.set(a, b, c); tri.getNormal(n); const area = tri.getArea();
      if (n.y >= 0.5 && area >= 1e-4) { tops++; const h = sc.physics.castRay(new RAPIER.Ray({ x: cx, y: cy + 1, z: cz }, { x: 0, y: -1, z: 0 }), 2, true, undefined, undefined, sc.player, undefined, accept);
        if (!h || Math.abs(cy + 1 - h.timeOfImpact - cy) > 0.1 + (Math.max(a.y, b.y, c.y) - Math.min(a.y, b.y, c.y)) / 2) { topBad++; if (exTop.length < 12) exTop.push(['top', +cx.toFixed(2), +cy.toFixed(2), +cz.toFixed(2), h ? +(cy + 1 - h.timeOfImpact).toFixed(2) : null, +n.y.toFixed(2)]); } }
      else if (Math.abs(n.y) <= 0.3 && area >= 0.05) { sides++; const h = sc.physics.castRay(new RAPIER.Ray({ x: cx + n.x * 0.5, y: cy + n.y * 0.5, z: cz + n.z * 0.5 }, { x: -n.x, y: -n.y, z: -n.z }), 1, true, undefined, undefined, sc.player, undefined, accept);
        if (!h || Math.abs(h.timeOfImpact - 0.5) > 0.15) { sideBad++; if (ex.length < 40) ex.push(['side', +cx.toFixed(2), +cy.toFixed(2), +cz.toFixed(2), h ? +h.timeOfImpact.toFixed(2) : null, +n.x.toFixed(2), +n.z.toFixed(2)]); } }
    }
  });
  report.G3 = { tops, topBad, sides, sideBad, topExamples: exTop, examples: ex };
  if (topBad) failures.push(`G3 ${topBad}/${tops} retail-area solid tops lack an own collider within 0.1 m ${JSON.stringify(exTop.slice(0, 4))}`);
  if (sideBad) failures.push(`G3 ${sideBad}/${sides} retail-area side faces lack an own collider within 0.15 m ${JSON.stringify(ex.slice(0, 4))}`);
  // G6 colour attribute on vertex-colour meshes
  const noColour: string[] = [];
  for (const r of [...(entry.install.solids ?? []), ...(entry.install.detail ?? [])]) r.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; const mats = Array.isArray(m.material) ? m.material : [m.material]; if (mats.some(x => (x as THREE.MeshStandardMaterial).vertexColors) && !m.geometry.getAttribute('color')) noColour.push(m.name); });
  report.G6 = { missingColour: noColour }; if (noColour.length) failures.push(`G6 ${noColour.join(', ')}`);
  // existing b12 check with the integration applied (EXPECTED_REBUILT patched in memory)
  const b12 = await BLOCK_CHECKS['b12-west-campus'](sc);
  report.b12ExistingCheck = { ok: b12.ok, failures: b12.failures ?? [] };
  for (const f of b12.failures ?? []) failures.push(`b12 existing check: ${f}`);
  // retail check against the real scene
  const solids: THREE.Mesh[] = [], detail: THREE.Mesh[] = [];
  for (const r of entry.install.solids ?? []) r.traverse(o => { if ((o as THREE.Mesh).isMesh) solids.push(o as THREE.Mesh); });
  for (const r of entry.install.detail ?? []) r.traverse(o => { if ((o as THREE.Mesh).isMesh) detail.push(o as THREE.Mesh); });
  const trees = [...(sc.walkway.trees?.placed ?? []).map(t => ({ x: t.x, z: t.z })), ...(sc.vegetation.canopy?.placed ?? []).map(t => ({ x: t.x, z: t.z }))];
  const g = (x: number, z: number) => sc.ground.height(x, z);
  const env: RetailEnv = { physics: sc.physics, RAPIER, player: sc.player, own, solids, detail, colliderPositions: entry.colliders.map(trimeshTriangles), g, groundRoots: sc.groundRoots,
    paths: sc.world.data.paths as RetailEnv['paths'], ...sources(), trees };
  const res = runRetailChecks(env);
  failures.push(...res.failures);
  return { mode: 'scene', ok: failures.length === 0, failures, report: { ...report, retail: res.report } };
}

/** Baked ground height (the game's block groundHeight) at plan points, for review-shot camera groundY. */
export function groundAt(points: [number, number][]) {
  const terrainData = new Terrain(json<TerrainData>('public/data/terrain.json'), capitolGroundReference);
  const terrain = decodeOfflineTerrain(bin('public/assets/campus/offline-terrain-61.bin.gz'), new THREE.MeshBasicMaterial());
  const ground = new BakedGround(terrain.mesh.geometry.getAttribute('position').array, 8, (x, z) => terrainData.height(x, z));
  return points.map(([x, z]) => +ground.height(x, z).toFixed(2));
}
