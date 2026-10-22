// Renders of the shipped west stand GLB (local metres, field frame): top view and elevation from the field.
import { loadScan, render } from './scanlib.mjs';
const [file, out] = process.argv.slice(2);
const scan = await loadScan(file);
const A = Math.atan2(-0.068, 1), toTV = (x, z) => { const u = x * Math.cos(A) - z * Math.sin(A), v = x * Math.sin(A) + z * Math.cos(A); return [-35.5 - u, v]; };
const keep = new Uint8Array(scan.nt); for (let t = 0; t < scan.nt; t++) keep[t] = scan.triMat[t] === 0 ? 1 : 0; // skip the collider primitive
const R = 6;
await render(scan, scan.pos, 100 * R, 120 * R, (x, y, z) => { const [t, v] = toTV(x, z); return [(100 - t) * R, (v + 60) * R, y]; }, `${out}-top.png`, { keep });
await render(scan, scan.pos, 120 * R, 75 * R, (x, y, z) => { const [t, v] = toTV(x, z); return [(v + 60) * R, (70 - y) * R, -t]; }, `${out}-elev.png`, { keep });
