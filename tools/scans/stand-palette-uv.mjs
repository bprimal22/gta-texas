// Generated-stadium palette measured from the shipped west-stand near GLB through each captured
// triangle's own UVs (area-weighted, fixed seed), not from projected atlas panes. Seats = captured
// faces with normal.y >= 0.45 between 3 m and (rim - 3 m) outward; fascia = captured steep faces
// facing the field (normal toward +u, |n.y| < 0.35) above 2 m. Authored infill materials
// (name contains "authored" or "infill") are excluded. Sunlit/shade split by 2-means on luma.
// Usage: NODE_PATH=<dir with @gltf-transform/core + sharp> node tools/scans/stand-palette-uv.mjs [glb]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const sharp = require('sharp');
const ROOT = resolve(import.meta.dirname, '../..');
const meta = JSON.parse(readFileSync(resolve(ROOT, 'public/assets/scans/dkr-west-stand.json'), 'utf8'));
const glbPath = process.argv[2] ?? resolve(ROOT, 'public/assets/scans/dkr-west-stand-near.glb');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(glbPath);
const sf = meta.sector.fieldFrame, A = sf.angle, [ax, , az] = meta.anchor;
// campus frame -> field frame: u across the field (west stand at u < -hw), t outward, v along.
const toTV = (x, z) => { const dx = x + ax - sf.center[0], dz = z + az - sf.center[1]; const u = dx * Math.cos(A) - dz * Math.sin(A), v = dx * Math.sin(A) + dz * Math.cos(A); return [-sf.hw - u, v]; };
const rim = meta.sector.outer, rimAt = v => { let b = rim[0]; for (const r of rim) if (Math.abs(r[0] - v) < Math.abs(b[0] - v)) b = r; return b[1]; };
let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const images = new Map();
const decode = async tex => { if (!images.has(tex)) { const { data, info } = await sharp(Buffer.from(tex.getImage())).raw().toBuffer({ resolveWithObject: true }); images.set(tex, { data, info }); } return images.get(tex); };
const groups = { seats: [], fascia: [] }; const skipped = { authoredMaterials: [], untextured: 0 };
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  const mat = prim.getMaterial(), name = mat?.getName() ?? '';
  if (/authored|infill|collider/i.test(name) || /collider/i.test(mesh.getName())) { skipped.authoredMaterials.push(name || mesh.getName()); continue; }
  const tex = mat?.getBaseColorTexture(); const P = prim.getAttribute('POSITION'), UV = prim.getAttribute('TEXCOORD_0'), I = prim.getIndices();
  if (!tex || !P || !UV) { skipped.untextured++; continue; }
  const img = await decode(tex), { width: W, height: H, channels: C } = img.info;
  const n = I ? I.getCount() : P.getCount(), p = [[], [], []], q = [[], [], []];
  const faces = [];
  for (let f = 0; f + 2 < n; f += 3) {
    for (let k = 0; k < 3; k++) { const i = I ? I.getScalar(f + k) : f + k; P.getElement(i, p[k]); UV.getElement(i, q[k]); }
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], len = Math.hypot(...c);
    if (len < 1e-9) continue;
    const ny = c[1] / len, cx = (p[0][0] + p[1][0] + p[2][0]) / 3, cy = (p[0][1] + p[1][1] + p[2][1]) / 3, cz = (p[0][2] + p[1][2] + p[2][2]) / 3;
    const [t, v] = toTV(cx, cz);
    // field-facing: normal pointing toward the field = +u = -t direction
    const nu = (c[0] / len) * Math.cos(A) - (c[2] / len) * Math.sin(A);
    let group = null;
    if (ny >= 0.45 && t > 3 && t < rimAt(v) - 3) group = 'seats';
    else if (Math.abs(ny) < 0.35 && nu > 0.5 && cy > 2) group = 'fascia';
    if (group) faces.push({ group, area: len / 2, uv: q.map(a => [...a]) });
  }
  const total = { seats: 0, fascia: 0 }; for (const f of faces) total[f.group] += f.area;
  for (const f of faces) {
    const k = Math.round(2000 * f.area / Math.max(total[f.group], 1e-9)) + (rnd() < (2000 * f.area / Math.max(total[f.group], 1e-9)) % 1 ? 1 : 0);
    for (let s = 0; s < k; s++) {
      let a = rnd(), b = rnd(); if (a + b > 1) { a = 1 - a; b = 1 - b; }
      const u = f.uv[0][0] + a * (f.uv[1][0] - f.uv[0][0]) + b * (f.uv[2][0] - f.uv[0][0]), w = f.uv[0][1] + a * (f.uv[1][1] - f.uv[0][1]) + b * (f.uv[2][1] - f.uv[0][1]);
      const x = Math.min(W - 1, Math.max(0, Math.floor(u * W))), y = Math.min(H - 1, Math.max(0, Math.floor(w * H))), o = (y * W + x) * C;
      groups[f.group].push([img.data[o], img.data[o + 1], img.data[o + 2]]);
    }
  }
}
const luma = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const median3 = arr => [0, 1, 2].map(k => { const s = arr.map(c => c[k]).sort((a, b) => a - b); return s[s.length >> 1]; });
const split = arr => { let lo = 60, hi = 160; for (let it = 0; it < 20; it++) { const th = (lo + hi) / 2, a = arr.filter(c => luma(c) < th), b = arr.filter(c => luma(c) >= th); lo = a.length ? a.reduce((s, c) => s + luma(c), 0) / a.length : lo; hi = b.length ? b.reduce((s, c) => s + luma(c), 0) / b.length : hi; } const th = (lo + hi) / 2; return { th, shade: arr.filter(c => luma(c) < th), sun: arr.filter(c => luma(c) >= th) }; };
const report = { glb: glbPath.replace(ROOT + '/', ''), method: 'area-weighted UV samples of captured faces (fixed seed)', skipped };
for (const [name, arr] of Object.entries(groups)) {
  if (!arr.length) { report[name] = { samples: 0 }; continue; }
  const s = split(arr);
  report[name] = { samples: arr.length, median: median3(arr), sunlitMedian: median3(s.sun), shadeMedian: median3(s.shade), sunlitFraction: +(s.sun.length / arr.length).toFixed(3), lumaThreshold: +s.th.toFixed(1) };
}
report.seats.warmFraction = groups.seats.length ? +(groups.seats.filter(c => c[0] - c[2] > 25).length / groups.seats.length).toFixed(3) : null;
console.log(JSON.stringify(report, null, 1));
