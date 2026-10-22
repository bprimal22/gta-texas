// Per-primitive inspection of a source scan GLB: triangles, bounds, area, texel density.
import { NodeIO } from '@gltf-transform/core';
const file = process.argv[2];
const io = new NodeIO();
const doc = await io.read(file);
const root = doc.getRoot();
const rows = [];
const gmin = [1e9, 1e9, 1e9], gmax = [-1e9, -1e9, -1e9];
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  const pos = prim.getAttribute('POSITION').getArray(), uv = prim.getAttribute('TEXCOORD_0')?.getArray();
  const idx = prim.getIndices()?.getArray();
  const tri = idx ? idx.length / 3 : pos.length / 9;
  let area = 0, uvArea = 0; const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]); }
  for (let t = 0; t < tri; t++) {
    const a = idx ? idx[3 * t] : 3 * t, b = idx ? idx[3 * t + 1] : 3 * t + 1, c = idx ? idx[3 * t + 2] : 3 * t + 2;
    const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2];
    const vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1], vz = pos[3 * c + 2] - pos[3 * a + 2];
    area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (uv) uvArea += 0.5 * Math.abs((uv[2 * b] - uv[2 * a]) * (uv[2 * c + 1] - uv[2 * a + 1]) - (uv[2 * c] - uv[2 * a]) * (uv[2 * b + 1] - uv[2 * a + 1]));
  }
  for (let k = 0; k < 3; k++) { gmin[k] = Math.min(gmin[k], mn[k]); gmax[k] = Math.max(gmax[k], mx[k]); }
  const tex = prim.getMaterial()?.getBaseColorTexture();
  const size = tex?.getSize() ?? [0, 0];
  rows.push({ mat: prim.getMaterial()?.getName(), tri, area, uvArea, tex: size[0], min: mn, max: mx, mime: tex?.getMimeType() });
}
const scale = Number(process.argv[3] || 37);
let totalArea = 0, totalPix = 0;
for (const r of rows) { totalArea += r.area; totalPix += r.uvArea * r.tex * r.tex; }
console.log(JSON.stringify({ prims: rows.length, gmin, gmax, totalTri: rows.reduce((s, r) => s + r.tri, 0), areaUnits: totalArea, areaM2At: totalArea * scale * scale,
  meanTexelsPerM: Math.sqrt(totalPix / (totalArea * scale * scale)) }, null, 1));
rows.sort((a, b) => b.area - a.area);
for (const r of rows.slice(0, 200)) console.log(r.mat, r.tri, r.tex, r.mime, 'areaM2', (r.area * scale * scale).toFixed(0), 'uvFill', r.uvArea.toFixed(2), 'px/m', (Math.sqrt(r.uvArea * r.tex * r.tex / (r.area * scale * scale))).toFixed(1), 'min', r.min.map(v => (v * scale).toFixed(1)).join(','), 'max', r.max.map(v => (v * scale).toFixed(1)).join(','));
