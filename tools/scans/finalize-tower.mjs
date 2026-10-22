import { scanInput } from './inputs.mjs';
// Turn the leveled 2D corner fit into a full glTF->campus similarity, fit the vertical offset
// against the baked terrain on open ground, cross-check with a 3D Umeyama, write tower-transform.json.
import { loadScan, app3, mul3, umeyama3, loadBakedTerrain } from './scanlib.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const LANE = new URL('../../', import.meta.url).pathname;
const SRC = scanInput('tower.glb');
const A = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = process.argv[3];
const terrain = loadBakedTerrain(LANE + 'public/assets/campus/offline-terrain-61.bin.gz');
const campus = JSON.parse(readFileSync(LANE + 'public/data/campus.json', 'utf8'));
const plan = JSON.parse(readFileSync(LANE + 'lib/campus/main-building-envelope-plan.json', 'utf8'));
const scan = await loadScan(SRC, { textures: false });
const { s, theta, t } = A.fin.T, c = Math.cos(theta), si = Math.sin(theta);
const Rxz = [[c, 0, -si], [0, 1, 0], [si, 0, c]];
const lin = mul3(Rxz, A.L).map(r => r.map(v => v * s * 37)); // linear part (raw glTF units -> campus metres)
const fwd = (p, ty) => { const q = app3(lin, p); return [q[0] + t[0], q[1] + ty, q[2] + t[1]]; };
// vertical: lowest upward-facing surface per 1 m cell vs baked terrain
const inRing = (x, z, r) => { let k = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) k = !k; } return k; };
const footprints = campus.buildings.map(b => b.rings[0]).concat([plan.officialWorldRings[0]]);
const cells = new Map();
const { idx, nt, pos } = scan;
for (let tr = 0; tr < nt; tr++) {
  const a = fwd([pos[3 * idx[3 * tr]], pos[3 * idx[3 * tr] + 1], pos[3 * idx[3 * tr] + 2]], 0), b = fwd([pos[3 * idx[3 * tr + 1]], pos[3 * idx[3 * tr + 1] + 1], pos[3 * idx[3 * tr + 1] + 2]], 0), d = fwd([pos[3 * idx[3 * tr + 2]], pos[3 * idx[3 * tr + 2] + 1], pos[3 * idx[3 * tr + 2] + 2]], 0);
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
  if (l < 1e-9 || Math.abs(ny / l) < 0.95) continue;
  const cx = (a[0] + b[0] + d[0]) / 3, cy = (a[1] + b[1] + d[1]) / 3, cz = (a[2] + b[2] + d[2]) / 3, key = Math.floor(cx) + ',' + Math.floor(cz);
  const v = cells.get(key); if (v === undefined || cy < v[1]) cells.set(key, [cx, cy, cz]);
}
const diffs = [];
for (const [x, y, z] of cells.values()) {
  if (footprints.some(r => inRing(x, z, r))) continue;
  const g = terrain.height(x, z); if (!Number.isFinite(g)) continue;
  diffs.push({ x, z, d: g - y });
}
const median = a => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
let ty = median(diffs.map(q => q.d));
let inl = diffs.filter(q => Math.abs(q.d - ty) < 1.0); ty = median(inl.map(q => q.d));
inl = diffs.filter(q => Math.abs(q.d - ty) < 0.6); ty = inl.reduce((x, q) => x + q.d, 0) / inl.length;
const res = inl.map(q => q.d - ty), rmsV = Math.sqrt(res.reduce((x, r) => x + r * r, 0) / res.length);
const absAll = diffs.map(q => Math.abs(q.d - ty)).sort((p, q) => p - q);
console.log('vertical offset', ty.toFixed(3), 'ground cells', diffs.length, 'inliers(<0.6m)', inl.length, 'rms', rmsV.toFixed(3), 'p50|res| all', absAll[Math.floor(absAll.length * .5)].toFixed(2), 'p75', absAll[Math.floor(absAll.length * .75)].toFixed(2));
// tower centre/top
const sc = A.shaft.center, towerXZ = [s * (c * sc[0] - si * sc[1]) + t[0], s * (si * sc[0] + c * sc[1]) + t[1]];
const topY = s * A.topY + ty;
const groundAtTower = terrain.height(...towerXZ);
// north-side ground in front of the shaft (open, measured by scan) for a scan-only height
console.log('tower centre', towerXZ.map(v => v.toFixed(2)), 'top Y', topY.toFixed(2), 'baked ground at centre', groundAtTower.toFixed(2), 'top above it', (topY - groundAtTower).toFixed(2));
// 3D Umeyama cross-check: footprint corners at ground (scan ground under corner from nearest outside cell) + tower top
const src3 = [], dst3 = [];
const Linv = [[A.L[0][0], A.L[1][0], A.L[2][0]], [A.L[0][1], A.L[1][1], A.L[2][1]], [A.L[0][2], A.L[1][2], A.L[2][2]]];
for (const cor of A.fin.corners.filter(k => k.used)) {
  // scan corner (leveled xz) at scan ground height near it; target = GIS corner at baked terrain height
  const g = terrain.height(...cor.gis); if (!Number.isFinite(g)) continue;
  const near = inl.filter(q => Math.hypot(q.x - cor.gis[0], q.z - cor.gis[1]) < 10);
  if (near.length < 3) continue;
  const scanGroundCampus = median(near.map(q => terrain.height(q.x, q.z) - q.d)), g0 = median(near.map(q => terrain.height(q.x, q.z))); // scan surface y (ty=0)
  const yLevel = scanGroundCampus / s;
  const pLevel = [cor.scan[0], yLevel, cor.scan[1]];
  src3.push(app3(Linv, pLevel).map(v => v / 37)); dst3.push([cor.gis[0], g0, cor.gis[1]]);
}
// tower top: horizontal target from the 2D fit, vertical target = baked ground at tower + 93.6 m (published)
src3.push(app3(Linv, [A.topXZ?.[0] ?? sc[0], A.topY, A.topXZ?.[1] ?? sc[1]]).map(v => v / 37));
dst3.push([towerXZ[0], groundAtTower + 93.6, towerXZ[1]]);
const u3 = umeyama3(src3, dst3);
const twoStage = p => fwd(p, ty);
const cmp = src3.map((p, i) => ({ twoStage: Math.hypot(...twoStage(p).map((v, k) => v - dst3[i][k])), umeyama3: u3.residuals[i] }));
console.log('3D Umeyama: n', src3.length, 'scale', (u3.s).toFixed(4), 'rms', u3.rms.toFixed(3), 'two-stage rms on same points', Math.sqrt(cmp.reduce((x, q) => x + q.twoStage ** 2, 0) / cmp.length).toFixed(3));
const matrix = [lin[0][0], lin[1][0], lin[2][0], 0, lin[0][1], lin[1][1], lin[2][1], 0, lin[0][2], lin[1][2], lin[2][2], 0, t[0], ty, t[1], 1]; // column-major (THREE.Matrix4.fromArray)
const record = {
  asset: 'tower', source: { repository: 'https://github.com/seanhlewis/utimagery', commit: '13f08efebe2a0488283e09c47365878d0904a49e', file: 'tower.glb', sha256: 'be80720f22224735d9b558e0007d4288915cd3e84ecba1529a8e290153d0dc4f' },
  method: 'Leveling from area-weighted facade normals (smallest eigenvector), then 2D Umeyama similarity from footprint corners (intersections of robust scan wall-line fits) against the official UT MAI526 GIS rings + campus.json FAC/WCH/GEB rings, seeded by a brute-force roof-mask registration; vertical offset = trimmed mean of baked-terrain minus scan open-ground heights. Author Cesium placement NOT used.',
  matrixColumnMajor_rawGltfToCampus: matrix,
  components: { levelingUp_gltf: A.up, tiltDeg: A.tiltDeg, yawThetaRad_xz: theta, scale_metresPerGltfUnit: s * 37, scaleRelativeToAuthor37: s, translation: [t[0], ty, t[1]] },
  residuals: {
    cornersUsed: A.fin.corners.filter(k => k.used).length, cornersTotal: A.fin.corners.length, cornerRms2D_m: A.fin.rms,
    corners: A.fin.corners.map(k => ({ name: k.name, gis: k.gis.map(v => +v.toFixed(2)), residual_m: +k.residual.toFixed(3), used: k.used })),
    verticalGroundCells: inl.length, verticalRms_m: +rmsV.toFixed(3), verticalAllCellsMedianAbs_m: +absAll[Math.floor(absAll.length * .5)].toFixed(3),
    umeyama3D: { n: src3.length, scale_metresPerGltfUnit: u3.s, rms_m: +u3.rms.toFixed(3), residuals_m: u3.residuals.map(v => +v.toFixed(3)), twoStageRmsSamePoints_m: +Math.sqrt(cmp.reduce((x, q) => x + q.twoStage ** 2, 0) / cmp.length).toFixed(3) },
  },
  checks: { shaftCentre: towerXZ, shaftWidth_m: [A.shaft.w * s, A.shaft.h * s], shaftEdgeYawDeg_mod90: (((A.shaft.angleDeg * Math.PI / 180 + theta) * 180 / Math.PI) % 90 + 90) % 90, topY, bakedGroundAtCentre: groundAtTower, topAboveBakedGround_m: topY - groundAtTower, authoredTowerCentre: [-215.27, 10.40], offsetFromAuthored_m: Math.hypot(towerXZ[0] + 215.27, towerXZ[1] - 10.40) },
  createdBy: 'tools/scans/finalize-tower.mjs',
};
writeFileSync(out, JSON.stringify(record, null, 1));
console.log(JSON.stringify(record.checks, null, 1));
