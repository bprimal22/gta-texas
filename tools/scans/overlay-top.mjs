// Render the leveled scan in campus coordinates (2D similarity) with GIS footprints overlaid.
import { loadScan, render, drawLine, app3 } from './scanlib.mjs';
import { readFileSync } from 'node:fs';
const LANE = new URL('../../', import.meta.url).pathname;
const [src, alignFile, thetaDeg, out] = process.argv.slice(2);
const A = JSON.parse(readFileSync(alignFile, 'utf8'));
const scan = await loadScan(src);
const S0 = 37, L = A.L;
let T = A.fin.T;
if (thetaDeg !== 'fit') { // rigid guess about the shaft centre
  const th = Number(thetaDeg) * Math.PI / 180, c = Math.cos(th), s = Math.sin(th), sc = A.shaft.center, tw = [-215.27, 10.40];
  T = { s: 0.95, theta: th, t: [tw[0] - 0.95 * (c * sc[0] - s * sc[1]), tw[1] - 0.95 * (s * sc[0] + c * sc[1])] };
}
const c = Math.cos(T.theta), s = Math.sin(T.theta);
const P = new Float64Array(scan.pos.length);
for (let k = 0; k < P.length; k += 3) {
  const q = app3(L, [scan.pos[k] * S0, scan.pos[k + 1] * S0, scan.pos[k + 2] * S0]);
  P[k] = T.s * (c * q[0] - s * q[2]) + T.t[0]; P[k + 1] = T.s * q[1]; P[k + 2] = T.s * (s * q[0] + c * q[2]) + T.t[1];
}
const win = [-300, -80, -130, 100], R = 6; // x0, z0, x1, z1
const W = (win[2] - win[0]) * R, H = (win[3] - win[1]) * R;
const px = (x, z) => [(x - win[0]) * R, (z - win[1]) * R];
const campus = JSON.parse(readFileSync(LANE + 'public/data/campus.json', 'utf8'));
const plan = JSON.parse(readFileSync(LANE + 'lib/campus/main-building-envelope-plan.json', 'utf8'));
await render(scan, P, W, H, (x, y, z) => [...px(x, z), y], out, {
  overlay(img) {
    for (const b of campus.buildings) for (const r of b.rings) for (let i = 0; i < r.length; i++) { const a = px(...r[i]), q = px(...r[(i + 1) % r.length]); drawLine(img, W, H, a[0], a[1], q[0], q[1], [255, 255, 0], 1); }
    for (const r of plan.officialWorldRings) for (let i = 0; i < r.length; i++) { const a = px(...r[i]), q = px(...r[(i + 1) % r.length]); drawLine(img, W, H, a[0], a[1], q[0], q[1], [255, 0, 0], 2); }
    const { origin, east, south } = plan.frame, wp = (u, v) => [origin[0] + u * east[0] + v * south[0], origin[1] + u * east[1] + v * south[1]];
    const th = plan.towerHole.outer.map(p => px(...wp(...p)));
    for (let i = 0; i < 4; i++) drawLine(img, W, H, th[i][0], th[i][1], th[(i + 1) % 4][0], th[(i + 1) % 4][1], [0, 255, 255], 1);
    for (let x = win[0]; x <= win[2]; x += 50) drawLine(img, W, H, ...px(x, win[1]), ...px(x, win[1] + 3), [0, 0, 255], 2);
  },
});
console.log('wrote', out, JSON.stringify(T));
