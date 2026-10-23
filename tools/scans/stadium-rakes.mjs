// DKR measurements from the raw MIT stadium capture used by lib/campus/stadium-bowl.ts STAND_PROFILES / rim details:
//  1. lower-bowl rake per side: median top surface (0.5 m depth bins x 2 m along-bins) vs depth t from the field-plate edge
//     (east / west straights |v| < 40, north / south ends |u| < 22). The capture only reaches the first ~6 m of the east and
//     north stands and ~16 m of the 2021 SEZ, so those slopes are front-row measurements.
//  2. the west gantry / press-box top: max height per 1 m of v over t 55-95 m on the west side (the light-gantry beam top).
// Inputs: stadium.glb (public/assets/scans/sources.json, .work/scan-inputs or UTIMAGERY_DIR) and the aligned transform in
// public/assets/scans/dkr-field.json. Usage (tools/node_modules from tower-tools.package.json): node tools/scans/stadium-rakes.mjs
import { loadScan } from './scanlib.mjs';
import { scanInput } from './inputs.mjs';
import { readFileSync } from 'node:fs';
const OUT = new URL('../../public/assets/scans/', import.meta.url).pathname;
const M = JSON.parse(readFileSync(OUT + 'dkr-field.json', 'utf8')).matrixColumnMajor_rawGltfToCampus_fieldPlaneAtY0;
const scan = await loadScan(scanInput('stadium.glb'), { textures: false });
const A = Math.atan2(-0.068, 1), C = [444.3, 272.5], HW = 35.5, HL = 63;
const bins = { east: {}, west: {}, north: {}, south: {} }, gantry = new Map();
for (let i = 0; i < scan.nv; i++) {
  const x = scan.pos[3 * i], y = scan.pos[3 * i + 1], z = scan.pos[3 * i + 2];
  const X = M[0] * x + M[4] * y + M[8] * z + M[12], Y = M[1] * x + M[5] * y + M[9] * z + M[13], Z = M[2] * x + M[6] * y + M[10] * z + M[14];
  const dx = X - C[0], dz = Z - C[1], u = dx * Math.cos(A) - dz * Math.sin(A), v = dx * Math.sin(A) + dz * Math.cos(A);
  if (u < -HW && Math.abs(v) <= 70 && Y >= 50) { const t = -HW - u; if (t >= 55 && t <= 95) { const k = Math.round(v); gantry.set(k, Math.max(gantry.get(k) ?? -Infinity, Y)); } }
  let side, t, along;
  if (Math.abs(v) < 40 && u > HW) { side = 'east'; t = u - HW; along = v; }
  else if (Math.abs(v) < 40 && u < -HW) { side = 'west'; t = -HW - u; along = v; }
  else if (Math.abs(u) < 22 && v < -HL) { side = 'north'; t = -HL - v; along = u; }
  else if (Math.abs(u) < 22 && v > HL) { side = 'south'; t = v - HL; along = u; }
  else continue;
  const key = Math.floor(t / 0.5) + ':' + Math.floor(along / 2), b = bins[side];
  if (!(b[key] >= Y)) b[key] = Y;
}
for (const [side, b] of Object.entries(bins)) {
  const byT = {};
  for (const [key, y] of Object.entries(b)) (byT[+key.split(':')[0]] ??= []).push(y);
  const rows = Object.entries(byT).map(([k, ys]) => { ys.sort((p, q) => p - q); return [+k * 0.5, +ys[ys.length >> 1].toFixed(2), ys.length]; })
    .sort((p, q) => p[0] - q[0]).filter(r => r[2] >= 6);
  const fit = rows.filter(r => r[0] >= 2 && r[0] <= Math.min(16, rows[rows.length - 1][0]));
  const slope = fit.length > 1 ? (fit[fit.length - 1][1] - fit[0][1]) / (fit[fit.length - 1][0] - fit[0][0]) : NaN;
  console.log(side, 'front', rows[0]?.[1], 'slope t2..', fit[fit.length - 1]?.[0], '=', slope.toFixed(3), '|', rows.filter((_, i) => i % 4 === 0).map(r => `${r[0]}:${r[1]}`).join(' '));
}
console.log('west top (gantry/press box) by v:', [...gantry].sort((a, b) => a[0] - b[0]).map(([v, y]) => `${v}:${y.toFixed(1)}`).join(' '));
