// Probe the real authored scene around the DKR west stand (harness bundle): generated-bowl
// section reach, field height, and the highest authored surface per 1 m cell of the sector.
import '../../scripts/harness/stubs.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const LANE = resolve(import.meta.dirname, '../..');
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const mod = await import(pathToFileURL(resolve(LANE, '.work/harness-dist/context-check.mjs')).href);
const THREE = await import('three');
const r = await mod.run({});
const { buildStadiumBowl, STADIUM_FIELD } = mod;
const data = r.world.data;
const bowl = buildStadiumBowl(data.buildings.filter(b => b.id === 655373 || b.id === 504014), (x, z) => r.ground.height(x, z), r.grid);
const F = STADIUM_FIELD, fromField = (u, v) => [F.center[0] + u * Math.cos(F.angle) + v * Math.sin(F.angle), F.center[1] - u * Math.sin(F.angle) + v * Math.cos(F.angle)];
// candidate authored meshes overlapping the west sector box
const box = new THREE.Box3(); const corners = [[-F.halfWidth + 1, -80], [-F.halfWidth - 110, -80], [-F.halfWidth - 110, 80], [-F.halfWidth + 1, 80]].map(([u, v]) => fromField(u, v));
box.setFromPoints(corners.map(([x, z]) => new THREE.Vector3(x, -50, z))); box.max.y = 200;
const cand = [];
for (const root of [r.walkway.group, r.walkway.surfaces, r.world.group]) { root.updateWorldMatrix(true, true); root.traverse(o => { if (!o.isMesh || o.name === 'Offline local contour terrain') return; o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); if (b.intersectsBox(box)) cand.push(o); }); }
console.log('candidate authored meshes', cand.length, cand.slice(0, 40).map(m => m.name).join(' | '));
const ray = new THREE.Raycaster(); const raster = [];
for (let t = -2; t <= 100; t += 1) for (let v = -75; v <= 75; v += 1) {
  const [x, z] = fromField(-F.halfWidth - t, v);
  ray.set(new THREE.Vector3(x, 200, z), new THREE.Vector3(0, -1, 0));
  const h = ray.intersectObjects(cand, false)[0];
  if (h) raster.push([t, v, +(h.point.y - bowl.stats.fieldY).toFixed(2), h.object.name.slice(0, 40)]);
}
const west = bowl.sectionInfo.map((s, i) => ({ i, ...s })).filter(s => s.nu < -0.99);
console.log('fieldY', bowl.stats.fieldY, 'west straight samples', west.length, 'v', west[0]?.v, west[west.length - 1]?.v, 'reach', west.map(s => s.reach.toFixed(1)).join(','));
const names = {}; for (const q of raster) names[q[3]] = (names[q[3]] ?? 0) + 1; console.log('authored cells by mesh', JSON.stringify(names));
writeFileSync(resolve(LANE, '.work/scans/stand-probe.json'), JSON.stringify({ fieldY: bowl.stats.fieldY, sectionInfo: bowl.sectionInfo, raster }));
process.exit(0);
