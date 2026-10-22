// Orthographic elevation of the leveled scan, looking along horizontal direction phi (deg, in leveled x-z plane).
import { loadScan, render, app3 } from './scanlib.mjs';
import { readFileSync } from 'node:fs';
const [file, alignFile, phiDeg, cx, cz, halfW, y0, y1, R, out, maxDepth] = process.argv.slice(2);
const A = JSON.parse(readFileSync(alignFile, 'utf8'));
const scan = await loadScan(file);
const S0 = 37, Q = new Float64Array(scan.pos.length);
for (let k = 0; k < Q.length; k += 3) { const q = app3(A.L, [scan.pos[k] * S0, scan.pos[k + 1] * S0, scan.pos[k + 2] * S0]); Q[k] = q[0]; Q[k + 1] = q[1]; Q[k + 2] = q[2]; }
const phi = Number(phiDeg) * Math.PI / 180, d = [Math.cos(phi), Math.sin(phi)], r = [-Math.sin(phi), Math.cos(phi)]; // view dir d, right r
const res = Number(R), hw = Number(halfW), W = Math.ceil(2 * hw * res), H = Math.ceil((Number(y1) - Number(y0)) * res);
const md = maxDepth ? Number(maxDepth) : 1e9;
await render(scan, Q, W, H, (x, y, z) => { const dx = x - Number(cx), dz = z - Number(cz); const depth = dx * d[0] + dz * d[1]; return [(dx * r[0] + dz * r[1] + hw) * res, (Number(y1) - y) * res, depth < -md ? -1e9 : -depth]; }, out);
console.log('wrote', out, W, H);
