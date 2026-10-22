// Orthographic elevations of a shipped (local-metre) GLB: 4 sides along given yaw + top.
import { loadScan, render } from './scanlib.mjs';
const [file, yawDeg, R, out] = process.argv.slice(2);
const scan = await loadScan(file);
const P = scan.pos, yaw = Number(yawDeg) * Math.PI / 180, res = Number(R);
const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); }
const hw = Math.max(Math.hypot(mn[0], mn[2]), Math.hypot(mx[0], mx[2]), Math.hypot(mn[0], mx[2]), Math.hypot(mx[0], mn[2]));
const W = Math.ceil(2 * hw * res), H = Math.ceil((mx[1] - mn[1]) * res);
const names = ['a', 'b', 'c', 'd'];
for (let s = 0; s < 4; s++) {
  const phi = yaw + s * Math.PI / 2, d = [Math.cos(phi), Math.sin(phi)], r = [-Math.sin(phi), Math.cos(phi)];
  await render(scan, P, W, H, (x, y, z) => [(x * r[0] + z * r[1] + hw) * res, (mx[1] - y) * res, -(x * d[0] + z * d[1])], `${out}-${names[s]}.png`);
}
await render(scan, P, W, W, (x, y, z) => [(x + hw) * res, (z + hw) * res, y], `${out}-top.png`);
console.log({ mn, mx, W, H, tris: scan.nt });
