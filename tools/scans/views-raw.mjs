import { loadScan, render } from './scanlib.mjs';
const [file, out, scaleArg] = process.argv.slice(2);
const S = Number(scaleArg || 37);
const scan = await loadScan(file);
const P = scan.pos.map(v => v * S);
const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); }
const R = 8; // px per metre
const W = Math.ceil((mx[0] - mn[0]) * R), D = Math.ceil((mx[2] - mn[2]) * R), H = Math.ceil((mx[1] - mn[1]) * R);
await render(scan, P, W, D, (x, y, z) => [(x - mn[0]) * R, (z - mn[2]) * R, y], `${out}-top.png`);
// side views: looking along -z (from +z), along +z, along -x, along +x
await render(scan, P, W, H, (x, y, z) => [(x - mn[0]) * R, (mx[1] - y) * R, z], `${out}-from+z.png`);
await render(scan, P, W, H, (x, y, z) => [(mx[0] - x) * R, (mx[1] - y) * R, -z], `${out}-from-z.png`);
await render(scan, P, D, H, (x, y, z) => [(mx[2] - z) * R, (mx[1] - y) * R, x], `${out}-from+x.png`);
await render(scan, P, D, H, (x, y, z) => [(z - mn[2]) * R, (mx[1] - y) * R, -x], `${out}-from-x.png`);
console.log({ mn, mx, W, D, H });
