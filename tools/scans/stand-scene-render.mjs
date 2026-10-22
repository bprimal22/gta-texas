// Evidence render of the integrated stadium (headless harness scene): scanned west stand (tan)
// vs generated bowl incl. seam/outer walls (grey), oblique orthographic views. Run after the
// harness build: node tools/scans/stand-scene-render.mjs (needs tools/node_modules for sharp).
import '../../scripts/harness/stubs.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { render } from './scanlib.mjs';
const LANE = resolve(import.meta.dirname, '../..');
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const mod = await import(pathToFileURL(resolve(LANE, '.work/harness-dist/context-check.mjs')).href);
const THREE = await import('three');
const mode = process.argv[2] ?? 'scan';
const r = await mod.run(mode === 'scan' ? { scan: true } : {});
const box = new THREE.Box3(new THREE.Vector3(300, -30, 150), new THREE.Vector3(600, 120, 440));
const pos = [], idx = [], triMat = [];
const add = (root, mat) => { root.updateWorldMatrix(true, true); root.traverse(o => {
  if (!o.isMesh) return; if (o.parent?.isLOD && o.parent.levels[0].object !== o && !o.parent.levels[0].object.getObjectById(o.id)) return;
  o.geometry.computeBoundingBox(); if (!o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).intersectsBox(box)) return;
  const p = o.geometry.getAttribute('position'), ix = o.geometry.index, v = new THREE.Vector3(), base = pos.length / 3;
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); pos.push(v.x, v.y, v.z); }
  const n = ix ? ix.count : p.count; for (let k = 0; k < n; k += 3) { idx.push(base + (ix ? ix.getX(k) : k), base + (ix ? ix.getX(k + 1) : k + 1), base + (ix ? ix.getX(k + 2) : k + 2)); triMat.push(mat); }
}); };
if (r.scanStand) { const lod = r.scanStand.group.children.find(o => o.isLOD); add(lod.levels[0].object, 0); }
const ctx = new THREE.Group(); for (const c of r.context.group.children) if (c !== r.scanStand?.group && c !== r.scanField?.group) ctx.add(c.clone(true));
r.context.group.updateWorldMatrix(true, true); add(r.context.solid ?? r.context.group, 1);
const scan = { idx: Uint32Array.from(idx), uv: new Float32Array(pos.length / 3 * 2), triMat: Uint16Array.from(triMat), tex: [{ solid: [205, 170, 120] }, { solid: [150, 150, 158] }], nt: idx.length / 3 };
const P = Float64Array.from(pos);
for (const [name, az, el] of [['ne', -0.9, 0.55], ['e', 0, 0.3], ['top', 0, 1.45]]) {
  const R = 4, W = 1400, H = 900, c = [440, 0, 280];
  const d = new THREE.Vector3(Math.cos(el) * Math.cos(Math.PI + az), -Math.sin(el), Math.cos(el) * Math.sin(Math.PI + az)); // looking from +x side toward -x
  const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(right, d).normalize();
  await render(scan, P, W, H, (x, y, z) => { const q = new THREE.Vector3(x - c[0], y - c[1], z - c[2]); return [W / 2 + q.dot(right) * R, H / 2 - q.dot(up) * R, -q.dot(d)]; }, resolve(LANE, `.work/scans/stand-scene-${mode}-${name}.png`));
}
console.log('rendered', idx.length / 3, 'triangles');
process.exit(0);
