// Per-face photographed sRGB levels of the shipped Tower near LOD (shaft, Y 45..85), for gain calibration.
import { loadScan, sampleTex } from './scanlib.mjs';
import { readFileSync } from 'node:fs';
const LANE = new URL('../../', import.meta.url).pathname;
const meta = JSON.parse(readFileSync(LANE + 'public/assets/scans/ut-tower.json', 'utf8'));
const scan = await loadScan(LANE + 'public/assets/scans/ut-tower-near.glb');
const { pos, uv, idx, nt, tex, triMat } = scan, [eu, ev] = [meta.axes.u, meta.axes.v];
const faces = {};
for (let t = 0; t < nt; t++) {
  const [a, b, c] = [0, 1, 2].map(k => idx[3 * t + k]); if (!tex[triMat[t]]?.data) continue;
  const y = (pos[3 * a + 1] + pos[3 * b + 1] + pos[3 * c + 1]) / 3; if (y < 45 || y > 85) continue;
  const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2], vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1], vz = pos[3 * c + 2] - pos[3 * a + 2];
  const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], l = Math.hypot(...n); if (!l) continue;
  const nu = (n[0] * eu[0] + n[2] * eu[1]) / l, nv = (n[0] * ev[0] + n[2] * ev[1]) / l;
  const nx = n[0] / l, nz = n[2] / l; if (Math.hypot(nx, nz) < 0.8) continue;
  const dir = Math.abs(nx) > Math.abs(nz) ? (nx > 0 ? 'east' : 'west') : (nz > 0 ? 'south' : 'north');
  void nu; void nv;
  for (let s = 0; s < 6; s++) { const w = [Math.random(), Math.random()]; if (w[0] + w[1] > 1) { w[0] = 1 - w[0]; w[1] = 1 - w[1]; } const w2 = 1 - w[0] - w[1];
    const col = sampleTex(tex[triMat[t]], w[0] * uv[2 * a] + w[1] * uv[2 * b] + w2 * uv[2 * c], w[0] * uv[2 * a + 1] + w[1] * uv[2 * b + 1] + w2 * uv[2 * c + 1]);
    (faces[dir] ??= []).push(0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2]); }
}
for (const [k, v] of Object.entries(faces)) { v.sort((p, q) => p - q); console.log(k, 'n', v.length, 'sRGB luma p25/p50/p75', v[v.length >> 2].toFixed(0), v[v.length >> 1].toFixed(0), v[(3 * v.length) >> 2].toFixed(0)); }
