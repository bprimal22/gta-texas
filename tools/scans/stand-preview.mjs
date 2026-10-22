// CPU preview (no browser/GPU) of the DKR west stand in the real headless scene: the two shots
// Codex used (inside flight view and the dkr-aerial camera shot). Scan surfaces are textured and
// unlit (captured colour, as in the game); generated surfaces are flat palette colours with a
// simple Lambert sun. This is an approximation for before/after comparison, not a game render.
// Usage (after the harness build, tools/node_modules present):
//   node tools/scans/stand-preview.mjs <label> <palette: before|after>
import '../../scripts/harness/stubs.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync, mkdirSync } from 'node:fs';
import { loadScan, render } from './scanlib.mjs';
const LANE = resolve(import.meta.dirname, '../..');
const OUT = resolve(LANE, '.work/lane-evidence');
mkdirSync(OUT, { recursive: true });
const [label = 'preview', paletteName = 'after'] = process.argv.slice(2);
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const mod = await import(pathToFileURL(resolve(LANE, '.work/harness-dist/context-check.mjs')).href);
const THREE = await import('three');
const r = await mod.run({});
const stand = JSON.parse(readFileSync(resolve(LANE, 'public/assets/scans/dkr-west-stand.json'), 'utf8'));
const fieldMeta = JSON.parse(readFileSync(resolve(LANE, 'public/assets/scans/dkr-field.json'), 'utf8'));
const sector = { side: 'west', vMin: stand.sector.vMin, vMax: stand.sector.vMax, step: stand.sector.step, seamMin: stand.sector.seamMin, seamMax: stand.sector.seamMax, front: stand.sector.front, outer: stand.sector.outer, pressBox: stand.sector.pressBox ?? null, parapet: stand.sector.parapet ?? 0 };
const bowl = mod.buildStadiumBowl(r.world.data.buildings.filter(b => b.id === 655373 || b.id === 504014), (x, z) => r.ground.height(x, z), r.grid, { scanSector: sector });
const fieldY = bowl.stats.fieldY;
// sRGB mean colours of the generated stadium painters (lib/campus/context-textures.ts)
const PALETTES = {
  before: { stadiumSeat: [174, 129, 100], stadiumRiser: [241, 238, 232], trim: [241, 238, 232], stadiumFacade: [176, 174, 170], stadiumSuite: [150, 156, 160], stadiumField: [70, 112, 58] },
  get after() { return JSON.parse(readFileSync(resolve(LANE, 'tools/scans/stadium-palette.json'), 'utf8')).previewMeans; },
};
const palette = PALETTES[paletteName];
const pos = [], uv = [], idx = [], triMat = [], tex = [];
const matIndex = new Map(); const mat = (key, entry) => { if (!matIndex.has(key)) { matIndex.set(key, tex.length); tex.push(entry); } return matIndex.get(key); };
const pushTri = (a, b, c, ua, ub, uc, m) => { const base = pos.length / 3; pos.push(...a, ...b, ...c); uv.push(...ua, ...ub, ...uc); idx.push(base, base + 1, base + 2); triMat.push(m); };
// generated bowl by material key
for (const [key, b] of bowl.builders) {
  const col = palette[key] ?? [200, 0, 200], m = mat('gen:' + key, { solid: col, lit: true });
  for (let k = 0; k < b.position.length; k += 9) pushTri(b.position.slice(k, k + 3), b.position.slice(k + 3, k + 6), b.position.slice(k + 6, k + 9), [0, 0], [0, 0], [0, 0], m);
}
// context buildings, terrain and walkway around the stadium as flat lit grey/green
const box = new THREE.Box3(new THREE.Vector3(150, -40, 50), new THREE.Vector3(750, 200, 560));
const addRoot = (root, key, col, skip = () => false) => { root.updateWorldMatrix(true, true); root.traverse(o => {
  if (!o.isMesh || skip(o)) return; o.geometry.computeBoundingBox(); if (!o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).intersectsBox(box)) return;
  const p = o.geometry.getAttribute('position'), ix = o.geometry.index, v = new THREE.Vector3(), n = ix ? ix.count : p.count, m = mat(key, { solid: col, lit: true });
  const at = i => v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).toArray();
  for (let k = 0; k + 2 < n; k += 3) pushTri(at(ix ? ix.getX(k) : k), at(ix ? ix.getX(k + 1) : k + 1), at(ix ? ix.getX(k + 2) : k + 2), [0, 0], [0, 0], [0, 0], m);
}); };
addRoot(r.world.group, 'terrain', [118, 140, 96], o => o.name !== 'Offline local contour terrain');
addRoot(r.context.solid, 'context', [214, 208, 196], o => o.name.toLowerCase().includes('stadium'));
addRoot(r.walkway.group, 'authored', [200, 196, 188]);
// scanned field decal and west stand (textured, unlit)
const addScan = async (file, offset, skipMat = () => false) => {
  const s = await loadScan(file);
  const texBase = tex.length;
  s.tex.forEach((t, i) => tex.push({ ...t, unlit: true, skip: skipMat(s.prims[i]) }));
  for (let t = 0; t < s.nt; t++) {
    if (tex[texBase + s.triMat[t]].skip) continue;
    const v = [0, 1, 2].map(k => { const i = s.idx[3 * t + k]; return [s.pos[3 * i] + offset[0], s.pos[3 * i + 1] + offset[1], s.pos[3 * i + 2] + offset[2]]; });
    const u = [0, 1, 2].map(k => { const i = s.idx[3 * t + k]; return [s.uv[2 * i], s.uv[2 * i + 1]]; });
    pushTri(...v, ...u, texBase + s.triMat[t]);
  }
};
await addScan(resolve(LANE, 'public/assets/scans/dkr-field.glb'), [fieldMeta.anchor[0], fieldY + 0.03, fieldMeta.anchor[2]]);
await addScan(resolve(LANE, 'public/assets/scans/dkr-west-stand-near.glb'), [stand.anchor[0], fieldY, stand.anchor[2]], p => (p.getMaterial()?.getName() ?? '').includes('collider'));
const scene = { idx: Uint32Array.from(idx), uv: Float32Array.from(uv), triMat: Uint32Array.from(triMat), tex, nt: idx.length / 3 };
const P = Float64Array.from(pos);
const sun = new THREE.Vector3(-0.45, 0.8, 0.4).normalize();
const shadeFn = (nx, ny, nz, m) => tex[m].unlit ? 1 : 0.42 + 0.58 * Math.abs(nx * sun.x + ny * sun.y + nz * sun.z);
const shots = {
  // Codex inside view: x500.76 y92.9 z258.14, heading W275 (compass), pitch 0.54 down
  inside: { eye: [500.76, 92.9, 258.14], dir: (() => { const h = 275 * Math.PI / 180, p = 0.54; return [Math.sin(h) * Math.cos(p), -Math.sin(p), -Math.cos(h) * Math.cos(p)]; })(), fov: 65 },
  // render/camera-shots.ts dkr-aerial: (240, -4.52 + 95, 430) looking at (444, 5, 272), fov 60
  // close look at the upper rim / press box from above the field (diagnostic)
  rim: { eye: [400, 85, 300], dir: (() => { const d = [335 - 400, 48 - 85, 262 - 300], l = Math.hypot(...d); return d.map(x => x / l); })(), fov: 55 },
  aerial: { eye: [240, -4.52 + 95, 430], dir: (() => { const d = [444 - 240, 5 - 90.48, 272 - 430], l = Math.hypot(...d); return d.map(x => x / l); })(), fov: 60 },
};
for (const [name, s] of Object.entries(shots)) {
  const W = 1280, H = 720, f = H / 2 / Math.tan(s.fov * Math.PI / 360);
  const d = new THREE.Vector3(...s.dir).normalize(), right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(right, d);
  const e = new THREE.Vector3(...s.eye), q = new THREE.Vector3();
  await render(scene, P, W, H, (x, y, z) => { q.set(x, y, z).sub(e); const zc = q.dot(d); if (zc < 0.5) return null; return [W / 2 + f * q.dot(right) / zc, H / 2 - f * q.dot(up) / zc, -zc]; },
    resolve(OUT, `${label}-${name}.png`), { shadeFn, background: 205 });
}
console.log('preview written', label, paletteName, 'triangles', scene.nt);
process.exit(0);
