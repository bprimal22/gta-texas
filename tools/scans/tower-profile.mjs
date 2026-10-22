import { scanInput } from './inputs.mjs';
// Tower profile in campus frame: per 1 m slice, half-extent along shaft axes (robust), roof heights around shaft.
import { loadScan } from './scanlib.mjs';
import { readFileSync } from 'node:fs';
const X = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const M = X.matrixColumnMajor_rawGltfToCampus;
const scan = await loadScan(scanInput('tower.glb'), { textures: false });
const [cx, cz] = X.checks.shaftCentre, yaw = X.checks.shaftEdgeYawDeg_mod90 * Math.PI / 180;
const eu = [Math.cos(yaw), Math.sin(yaw)], ev = [-Math.sin(yaw), Math.cos(yaw)];
const pts = [];
for (let k = 0; k < scan.pos.length; k += 3) {
  const x = scan.pos[k], y = scan.pos[k + 1], z = scan.pos[k + 2];
  const X0 = M[0] * x + M[4] * y + M[8] * z + M[12], Y0 = M[1] * x + M[5] * y + M[9] * z + M[13], Z0 = M[2] * x + M[6] * y + M[10] * z + M[14];
  const u = (X0 - cx) * eu[0] + (Z0 - cz) * eu[1], v = (X0 - cx) * ev[0] + (Z0 - cz) * ev[1];
  if (Math.abs(u) < 25 && Math.abs(v) < 25) pts.push([u, Y0, v]);
}
const q = (a, f) => a.length ? a[Math.floor(f * (a.length - 1))] : NaN;
for (let y = 112; y >= 14; y -= 1) {
  const s = pts.filter(p => p[1] >= y - 1 && p[1] < y);
  const inner = s.filter(p => Math.abs(p[0]) < 12 && Math.abs(p[2]) < 12);
  const us = inner.map(p => p[0]).sort((a, b) => a - b), vs = inner.map(p => p[2]).sort((a, b) => a - b);
  console.log(y, 'n', s.length, 'inner', inner.length, 'u', q(us, .01)?.toFixed(2), q(us, .99)?.toFixed(2), 'v', q(vs, .01)?.toFixed(2), q(vs, .99)?.toFixed(2));
}
// roof ring around shaft: heights of top surface between 9.5 and 13 m from axis
const ring = pts.filter(p => Math.max(Math.abs(p[0]), Math.abs(p[2])) > 9.6 && Math.max(Math.abs(p[0]), Math.abs(p[2])) < 12.5 && p[1] < 50);
const cellTop = new Map(); for (const p of ring) { const k = Math.floor(p[0]) + ',' + Math.floor(p[2]); cellTop.set(k, Math.max(cellTop.get(k) ?? -1e9, p[1])); }
const tops = [...cellTop.values()].sort((a, b) => a - b);
console.log('roof ring around shaft: cells', tops.length, 'p10', q(tops, .1).toFixed(2), 'p50', q(tops, .5).toFixed(2), 'p90', q(tops, .9).toFixed(2));
