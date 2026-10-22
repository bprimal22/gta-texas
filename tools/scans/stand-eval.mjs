// Evaluate the scanned DKR west stand vs the generated bowl: campus-frame top view with GIS,
// generated opening and authored DKR frontage; elevation from the field; per-section profiles.
import { loadScan, render, drawLine } from './scanlib.mjs';
import { scanInput } from './inputs.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const LANE = new URL('../../', import.meta.url).pathname;
const OUT = LANE + '.work/scans/';
const meta = JSON.parse(readFileSync(LANE + 'public/assets/scans/dkr-field.json', 'utf8'));
const M = meta.matrixColumnMajor_rawGltfToCampus_fieldPlaneAtY0;
const campus = JSON.parse(readFileSync(LANE + 'public/data/campus.json', 'utf8'));
const frontage = JSON.parse(readFileSync(LANE + 'lib/campus/dkr-frontage-plan.json', 'utf8'));
const scan = await loadScan(scanInput('stadium.glb'));
const F = { center: [444.3, 272.5], angle: Math.atan2(-0.068, 1), hw: 35.5, hl: 63 };
const toField = (x, z) => { const dx = x - F.center[0], dz = z - F.center[1]; return [dx * Math.cos(F.angle) - dz * Math.sin(F.angle), dx * Math.sin(F.angle) + dz * Math.cos(F.angle)]; };
const fromField = (u, v) => [F.center[0] + u * Math.cos(F.angle) + v * Math.sin(F.angle), F.center[1] - u * Math.sin(F.angle) + v * Math.cos(F.angle)];
const P = new Float64Array(scan.pos.length);
for (let i = 0; i < scan.nv; i++) {
  const x = scan.pos[3 * i], y = scan.pos[3 * i + 1], z = scan.pos[3 * i + 2];
  P[3 * i] = M[0] * x + M[4] * y + M[8] * z + M[12]; P[3 * i + 1] = M[1] * x + M[5] * y + M[9] * z + M[13]; P[3 * i + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
}
// (a) top view in campus coordinates (height above field), overlays
const win = [300, 160, 560, 400], R = 5, W = (win[2] - win[0]) * R, H = (win[3] - win[1]) * R;
const px = (x, z) => [(x - win[0]) * R, (z - win[1]) * R];
await render(scan, P, W, H, (x, y, z) => [...px(x, z), y], OUT + 'stand-top.png', {
  overlay(img) {
    for (const b of campus.buildings.filter(b => b.id === 655373 || b.id === 504014)) { const r = b.rings[0]; for (let i = 0; i < r.length; i++) drawLine(img, W, H, ...px(...r[i]), ...px(...r[(i + 1) % r.length]), [255, 255, 0], 2); }
    const fr = frontage.officialFootprint; for (let i = 0; i < fr.length; i++) drawLine(img, W, H, ...px(...fr[i]), ...px(...fr[(i + 1) % fr.length]), [0, 255, 255], 1);
    const c = [[-F.hw, -F.hl], [F.hw, -F.hl], [F.hw, F.hl], [-F.hw, F.hl]].map(([u, v]) => px(...fromField(u, v)));
    for (let i = 0; i < 4; i++) drawLine(img, W, H, ...c[i], ...c[(i + 1) % 4], [255, 0, 0], 2);
  },
});
// (b) elevation of the west stand seen from the field (looking -u), field-frame axes
const eW = 180, eH = 80, ER = 6;
await render(scan, P, eW * ER, eH * ER, (x, y, z) => { const [u, v] = toField(x, z); return [(v + eW / 2) * ER, (eH - 5 - y) * ER, u > -F.hw + 2 ? -1e9 : u]; }, OUT + 'stand-elev-from-field.png');
// (c) section profiles: max scan height per 0.5 m of outward distance t = -hw - u
const sections = {};
for (const v0 of [-50, -35, -20, 0, 20, 35, 50]) sections[v0] = new Map();
const cov = new Map(); // coverage grid of the west sector (1 m cells in field frame)
for (let t = 0; t < scan.nt; t++) for (let k = 0; k < 3; k++) {
  const i = scan.idx[3 * t + k], [u, v] = toField(P[3 * i], P[3 * i + 2]), y = P[3 * i + 1];
  if (u > -F.hw) continue;
  const key = `${Math.floor(-F.hw - u)},${Math.floor(v)}`; cov.set(key, Math.max(cov.get(key) ?? -1e9, y));
  for (const v0 of Object.keys(sections)) if (Math.abs(v - v0) < 1.5) { const b = Math.round((-F.hw - u) / 0.5); sections[v0].set(b, Math.max(sections[v0].get(b) ?? -1e9, y)); }
}
// generated profile (stadium-bowl.ts profile(), cap 50)
const gen = []; { let t = 0, y = 1.8; gen.push([0, 0], [0, 1.8]); while (t + 0.85 <= 27.2) { t += 0.85; gen.push([t, y]); y += 0.4; gen.push([t, y]); } t += 3; gen.push([t, y]); y += 6.5; gen.push([t, y]); while (t + 0.85 <= 140 && y <= 50) { t += 0.85; gen.push([t, y]); y += 0.52; gen.push([t, y]); } }
const genAt = t => { let y = 0; for (const [tt, yy] of gen) if (tt <= t) y = yy; return Math.min(y, 50); };
const report = {};
for (const [v0, m] of Object.entries(sections)) {
  const rows = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([b, y]) => [b * 0.5, y]);
  const maxY = Math.max(...rows.map(r => r[1])), depth = Math.max(...rows.filter(r => r[1] > 3).map(r => r[0]));
  const pick = [5, 10, 20, 30, 40, 50, 60, 70].map(t => { const r = rows.find(q => Math.abs(q[0] - t) < 0.3); return [t, r ? +r[1].toFixed(1) : null, genAt(t)]; });
  report[v0] = { maxHeight: +maxY.toFixed(1), depthAbove3m: depth, scanVsGenerated_tScanGen: pick };
}
// coverage: for v in [-63, 63] and t in [0, depth] count filled 1 m cells
let filled = 0, total = 0; const vCover = {};
for (let v = -63; v < 63; v++) { let f = 0, n = 0; for (let t = 0; t < 60; t++) { n++; if (cov.has(`${t},${v}`)) f++; } total += n; filled += f; vCover[v] = f / n; }
const vs = Object.entries(vCover).filter(([, f]) => f > 0.9).map(([v]) => +v);
console.log(JSON.stringify({ sections: report, westSectorCells: { filled, total, fraction: +(filled / total).toFixed(3) }, vRangeOver90pctCovered: [Math.min(...vs), Math.max(...vs)] }, null, 1));
writeFileSync(OUT + 'stand-eval.json', JSON.stringify({ report, vCover }, null, 1));
