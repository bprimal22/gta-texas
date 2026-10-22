import { scanInput } from './inputs.mjs';
// West-stand cross-section at midfield: are individual seat rows (generated: 0.85 m tread / 0.40 m riser) resolved?
import { loadScan } from './scanlib.mjs';
import { readFileSync } from 'node:fs';
const LANE = new URL('../../', import.meta.url).pathname;
const meta = JSON.parse(readFileSync(LANE + 'public/assets/scans/dkr-field.json', 'utf8'));
const M = meta.matrixColumnMajor_rawGltfToCampus_fieldPlaneAtY0;
const scan = await loadScan(scanInput('stadium.glb'), { textures: false });
const [cx, cz] = meta.registration.fieldCentreCampus, ang = Math.atan2(-0.1164, 1); // long axis toward south
const L = [Math.sin(ang), Math.cos(ang)], W = [Math.cos(ang), -Math.sin(ang)];
const bins = new Map();
const { pos, idx, nt } = scan;
const P = i => [M[0] * pos[3 * i] + M[4] * pos[3 * i + 1] + M[8] * pos[3 * i + 2] + M[12], M[1] * pos[3 * i] + M[5] * pos[3 * i + 1] + M[9] * pos[3 * i + 2] + M[13], M[2] * pos[3 * i] + M[6] * pos[3 * i + 1] + M[10] * pos[3 * i + 2] + M[14]];
for (let t = 0; t < nt; t++) {
  const [a, b, c] = [0, 1, 2].map(k => P(idx[3 * t + k]));
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6 - i; j++) {
    const w0 = i / 6, w1 = j / 6, w2 = 1 - w0 - w1, x = a[0] * w0 + b[0] * w1 + c[0] * w2, y = a[1] * w0 + b[1] * w1 + c[1] * w2, z = a[2] * w0 + b[2] * w1 + c[2] * w2;
    const dx = x - cx, dz = z - cz, along = dx * L[0] + dz * L[1], across = dx * W[0] + dz * W[1];
    if (Math.abs(along) > 10 || across > -30) continue; // west stand band around the 50
    const k = Math.round(-across / 0.1); bins.set(k, Math.max(bins.get(k) ?? -1e9, y));
  }
}
const ks = [...bins.keys()].sort((p, q) => p - q), prof = ks.map(k => [k * 0.1, bins.get(k)]);
// lower bowl window: first 25 m of rising seats
const start = prof.find(p => p[1] > 1.5)?.[0] ?? 35, win = prof.filter(p => p[0] >= start + 1 && p[0] <= start + 20);
const n = win.length, mx = win.reduce((s, p) => s + p[0], 0) / n, my = win.reduce((s, p) => s + p[1], 0) / n;
const sl = win.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / win.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
const res = win.map(p => p[1] - (my + sl * (p[0] - mx))), rms = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / n);
// autocorrelation of residual for 0.6..1.2 m periods
let best = null; for (let lag = 6; lag <= 12; lag++) { let s = 0, s0 = 0; for (let i = 0; i + lag < n; i++) { s += res[i] * res[i + lag]; s0 += res[i] * res[i]; } const r = s / s0; if (!best || r > best.r) best = { period: lag / 10, r }; }
console.log(JSON.stringify({ sectionStartFromCentre: start, rakeSlope: +sl.toFixed(3), rakeDeg: +(Math.atan(sl) * 180 / Math.PI).toFixed(1), residualRms: +rms.toFixed(3), bestRowPeriod: best.period, autocorr: +best.r.toFixed(2), maxHeight: +Math.max(...prof.map(p => p[1])).toFixed(1), samples: n }));
