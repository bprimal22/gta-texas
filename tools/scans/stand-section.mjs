// Side elevation of the west stand looking along the field axis (north, -v) for a thin slab of v.
import { loadScan, render } from './scanlib.mjs';
import { scanInput } from './inputs.mjs';
import { readFileSync } from 'node:fs';
const LANE = new URL('../../', import.meta.url).pathname;
const meta = JSON.parse(readFileSync(LANE + 'public/assets/scans/dkr-field.json', 'utf8'));
const M = meta.matrixColumnMajor_rawGltfToCampus_fieldPlaneAtY0;
const scan = await loadScan(scanInput('stadium.glb'));
const F = { center: [444.3, 272.5], angle: Math.atan2(-0.068, 1) };
const P = new Float64Array(scan.pos.length);
for (let i = 0; i < scan.nv; i++) { const x = scan.pos[3 * i], y = scan.pos[3 * i + 1], z = scan.pos[3 * i + 2]; P[3 * i] = M[0] * x + M[4] * y + M[8] * z + M[12]; P[3 * i + 1] = M[1] * x + M[5] * y + M[9] * z + M[13]; P[3 * i + 2] = M[2] * x + M[6] * y + M[10] * z + M[14]; }
const toField = (x, z) => { const dx = x - F.center[0], dz = z - F.center[1]; return [dx * Math.cos(F.angle) - dz * Math.sin(F.angle), dx * Math.sin(F.angle) + dz * Math.cos(F.angle)]; };
const [v0, half, out] = [Number(process.argv[2]), Number(process.argv[3] ?? 1), process.argv[4]];
const keep = new Uint8Array(scan.nt);
for (let t = 0; t < scan.nt; t++) { const i = scan.idx[3 * t]; const [, v] = toField(P[3 * i], P[3 * i + 2]); keep[t] = Math.abs(v - v0) < half ? 1 : 0; }
const R = 8, W = 110 * R, H = 80 * R; // t from -10 (field) to 100, y -8..72
await render(scan, P, W, H, (x, y, z) => { const [u, v] = toField(x, z); const t = -35.5 - u; return [(100 - t) * R, (72 - y) * R, -v]; }, out, { keep });
