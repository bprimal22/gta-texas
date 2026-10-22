// CPU preview (no browser, no GPU) of the generated DKR outer-wall facade.
// 1. Bundles lib/campus/context-textures.ts with Vite (SSR, into .work/facade-bundle) and runs the
//    real stadium painters against a tiny software 2D-canvas shim (fillRect with area coverage,
//    linear gradients, arc fill, get/putImageData), writing each stadiumFacade* colour tile 2x2.
// 2. Builds the real bowl through the harness bundle (scripts/harness: vite build first) and renders
//    it with a perspective-correct, mip-mapped software rasterizer: facade keys textured with the
//    painted tiles, other bowl keys / context / terrain as flat colours, Lambert sun = SHOT_SUN.
// Approximation for before/after comparison only; not a game render (no tone mapping, shadows,
// normal maps or scanned stand). Usage: node tools/scans/facade-preview.mjs <label>
import '../../scripts/harness/stubs.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
const LANE = resolve(import.meta.dirname, '../..');
const OUT = resolve(LANE, '.work/lane-evidence');
mkdirSync(OUT, { recursive: true });
const label = process.argv[2] ?? 'preview';

// ---------- 2D canvas shim ----------
const parse = c => {
  if (typeof c !== 'string') return c;
  if (c[0] === '#') { const h = c.length === 4 ? c.slice(1).split('').map(x => x + x).join('') : c.slice(1); return [0, 2, 4].map(k => parseInt(h.slice(k, k + 2), 16)); }
  const m = c.match(/rgba?\(([^)]+)\)/); if (m) return m[1].split(',').slice(0, 3).map(Number);
  return [255, 0, 255];
};
class Ctx {
  constructor(canvas) { this.canvas = canvas; this.fillStyle = '#000'; this.path = []; }
  get data() { return this.canvas.data; }
  colorAt(px, py) { const f = this.fillStyle; return typeof f === 'object' && f.at ? f.at(px, py) : parse(f); }
  blend(x, y, a) {
    if (a <= 0) return; const { width: w, data } = this.canvas, o = (y * w + x) * 4, c = this.colorAt(x + 0.5, y + 0.5);
    for (let k = 0; k < 3; k++) data[o + k] = data[o + k] * (1 - a) + c[k] * a; data[o + 3] = 255;
  }
  fillRect(x, y, w, h) {
    const W = this.canvas.width, H = this.canvas.height, x1 = x + w, y1 = y + h;
    for (let py = Math.max(0, Math.floor(y)); py < Math.min(H, Math.ceil(y1)); py++) {
      const cy = Math.min(py + 1, y1) - Math.max(py, y);
      for (let px = Math.max(0, Math.floor(x)); px < Math.min(W, Math.ceil(x1)); px++) this.blend(px, py, cy * (Math.min(px + 1, x1) - Math.max(px, x)));
    }
  }
  createLinearGradient(x0, y0, x1, y1) {
    const stops = [], dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1;
    return { addColorStop: (o, c) => { stops.push([o, parse(c)]); stops.sort((a, b) => a[0] - b[0]); },
      at: (px, py) => { const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2));
        for (let k = 1; k < stops.length; k++) if (t <= stops[k][0]) { const [o0, c0] = stops[k - 1], [o1, c1] = stops[k], f = (t - o0) / (o1 - o0 || 1); return c0.map((v, i) => v + (c1[i] - v) * f); }
        return stops[stops.length - 1][1]; } };
  }
  beginPath() { this.path = []; }
  arc(cx, cy, r, a0, a1) { this.path.push({ cx, cy, r, a0, a1 }); }
  fill() {
    for (const { cx, cy, r, a0, a1 } of this.path) {
      const sweep = (((a1 - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
      for (let py = Math.max(0, Math.floor(cy - r)); py < Math.min(this.canvas.height, Math.ceil(cy + r)); py++)
        for (let px = Math.max(0, Math.floor(cx - r)); px < Math.min(this.canvas.width, Math.ceil(cx + r)); px++) {
          const dx = px + 0.5 - cx, dy = py + 0.5 - cy; if (dx * dx + dy * dy > r * r) continue;
          const a = (((Math.atan2(dy, dx) - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          if (a <= sweep + 1e-9) this.blend(px, py, 1);
        }
    }
  }
  getImageData(x, y, w, h) { const out = new Uint8ClampedArray(w * h * 4), W = this.canvas.width;
    for (let r = 0; r < h; r++) out.set(this.data.subarray(((y + r) * W + x) * 4, ((y + r) * W + x + w) * 4), r * w * 4); return { data: out, width: w, height: h }; }
  createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }
  putImageData(img, x, y) { const W = this.canvas.width; for (let r = 0; r < img.height; r++) this.data.set(img.data.subarray(r * img.width * 4, (r + 1) * img.width * 4), ((y + r) * W + x) * 4); }
}
class Canvas {
  constructor() { this._w = 1; this._h = 1; this.data = new Uint8ClampedArray(4); this.style = {}; this.ctx = new Proxy(new Ctx(this), { get: (t, k) => k in t ? (typeof t[k] === 'function' ? t[k].bind(t) : t[k]) : () => {}, set: (t, k, v) => { t[k] = v; return true; } }); }
  realloc() { this.data = new Uint8ClampedArray(this._w * this._h * 4); }
  get width() { return this._w; } set width(v) { this._w = v; this.realloc(); }
  get height() { return this._h; } set height(v) { this._h = v; this.realloc(); }
  getContext() { return this.ctx; }
  addEventListener() {} removeEventListener() {}
}
// stubs.mjs installs an inert Node stand-in for document; canvases now come from the shim above.
const prevCreate = Reflect.get(globalThis.document, 'createElement');
Reflect.set(globalThis.document, 'createElement', t => t === 'canvas' ? new Canvas() : prevCreate(t));

// ---------- PNG ----------
function png(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// ---------- painters ----------
const { build } = await import('vite');
const bundleDir = resolve(LANE, '.work/facade-bundle');
await build({ root: LANE, configFile: false, publicDir: false, logLevel: 'warn', resolve: { alias: { '@': LANE } },
  build: { ssr: true, outDir: bundleDir, emptyOutDir: true, rolldownOptions: { input: { textures: resolve(LANE, 'lib/campus/context-textures.ts') }, output: { entryFileNames: '[name].mjs' } } } });
const texMod = await import(pathToFileURL(resolve(bundleDir, 'textures.mjs')).href + `?t=${Date.now()}`);
const renderer = { capabilities: { getMaxAnisotropy: () => 8 } };
const { materials } = texMod.createStadiumMaterials(renderer);
const tiles = {};
for (const [key, m] of materials) {
  if (!key.startsWith('stadiumFacade')) continue;
  const c = m.map.image, s = c.width, rgb = new Uint8Array(s * s * 3);
  for (let i = 0; i < s * s; i++) for (let k = 0; k < 3; k++) rgb[3 * i + k] = c.data[4 * i + k];
  // mip chain (box filter), image row 0 = top = v 1
  const mips = [{ w: s, data: rgb }];
  while (mips[mips.length - 1].w > 1) { const p = mips[mips.length - 1], w = p.w / 2, d = new Uint8Array(w * w * 3);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) d[(y * w + x) * 3 + k] = (p.data[((2 * y) * p.w + 2 * x) * 3 + k] + p.data[((2 * y) * p.w + 2 * x + 1) * 3 + k] + p.data[((2 * y + 1) * p.w + 2 * x) * 3 + k] + p.data[((2 * y + 1) * p.w + 2 * x + 1) * 3 + k]) / 4;
    mips.push({ w, data: d }); }
  tiles[key] = mips;
  const T = 2 * s, big = new Uint8Array(T * T * 3);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) for (let k = 0; k < 3; k++) big[(y * T + x) * 3 + k] = rgb[((y % s) * s + (x % s)) * 3 + k];
  png(resolve(OUT, `${label}-tex-${key}.png`), T, T, big);
}
console.log('facade tiles', Object.keys(tiles));

// ---------- scene ----------
const mod = await import(pathToFileURL(resolve(LANE, '.work/harness-dist/context-check.mjs')).href);
const THREE = await import('three');
const r = await mod.run({});
const bowl = mod.buildStadiumBowl(r.world.data.buildings.filter(b => b.id === 655373 || b.id === 504014), (x, z) => r.ground.height(x, z), r.grid);
const FLAT = { stadiumSeat: [126, 129, 130], stadiumRiser: [121, 124, 125], trim: [121, 124, 125], stadiumSuite: [150, 156, 160], stadiumField: [70, 112, 58] };
const tris = []; // {p: [9], uv: [6], mat}
const mats = [];
const matId = m => { mats.push(m); return mats.length - 1; };
for (const [key, b] of bowl.builders) {
  const m = matId(tiles[key] ? { mips: tiles[key] } : { solid: FLAT[key] ?? [200, 0, 200] });
  for (let k = 0; k < b.position.length / 9; k++) tris.push({ p: b.position.slice(9 * k, 9 * k + 9), uv: b.uv.slice(6 * k, 6 * k + 6), mat: m });
}
const box = new THREE.Box3(new THREE.Vector3(150, -40, 0), new THREE.Vector3(800, 200, 600));
const addRoot = (root, col, skip = () => false) => { root.updateWorldMatrix(true, true); const m = matId({ solid: col }); root.traverse(o => {
  if (!o.isMesh || skip(o)) return; o.geometry.computeBoundingBox(); if (!o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).intersectsBox(box)) return;
  const p = o.geometry.getAttribute('position'), ix = o.geometry.index, v = new THREE.Vector3(), n = ix ? ix.count : p.count;
  const at = i => v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).toArray();
  for (let k = 0; k + 2 < n; k += 3) tris.push({ p: [...at(ix ? ix.getX(k) : k), ...at(ix ? ix.getX(k + 1) : k + 1), ...at(ix ? ix.getX(k + 2) : k + 2)], uv: [0, 0, 0, 0, 0, 0], mat: m });
}); };
addRoot(r.world.group, [118, 140, 96], o => o.name !== 'Offline local contour terrain');
addRoot(r.context.solid, [214, 208, 196], o => o.name.toLowerCase().includes('stadium'));
addRoot(r.walkway.group, [200, 196, 188]);
// SHOT_SUN (render/camera-shots.ts): elevation 41.9 deg, azimuth 121.2 deg (from north, clockwise); Z is south.
const el = 41.9 * Math.PI / 180, az = 121.2 * Math.PI / 180;
const sun = [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];

function sample(mips, u, v, lod) {
  const L = Math.max(0, Math.min(mips.length - 1, Math.round(lod))), { w, data } = mips[L];
  const x = (u - Math.floor(u)) * w - 0.5, y = (1 - (v - Math.floor(v))) * w - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const px = (xx, yy, k) => data[((((yy % w) + w) % w) * w + (((xx % w) + w) % w)) * 3 + k];
  return [0, 1, 2].map(k => (px(x0, y0, k) * (1 - fx) + px(x0 + 1, y0, k) * fx) * (1 - fy) + (px(x0, y0 + 1, k) * (1 - fx) + px(x0 + 1, y0 + 1, k) * fx) * fy);
}
function renderShot(name, eye, target, fov, W = 1280, H = 720, SS = 2) {
  const w = W * SS, h = H * SS, f = h / 2 / Math.tan(fov * Math.PI / 360);
  const d = new THREE.Vector3(...target).sub(new THREE.Vector3(...eye)).normalize(), right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(right, d);
  const img = new Float32Array(w * h * 3), zb = new Float32Array(w * h).fill(Infinity);
  for (let i = 0; i < w * h; i++) { const t = Math.floor(i / w) / h; img[3 * i] = 205 - 40 * t; img[3 * i + 1] = 214 - 30 * t; img[3 * i + 2] = 224 - 20 * t; }
  const q = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const tri of tris) {
    let ok = true;
    for (let k = 0; k < 3; k++) { const x = tri.p[3 * k] - eye[0], y = tri.p[3 * k + 1] - eye[1], z = tri.p[3 * k + 2] - eye[2];
      const zc = x * d.x + y * d.y + z * d.z; if (zc < 1) { ok = false; break; }
      q[k][0] = w / 2 + f * (x * right.x + y * right.y + z * right.z) / zc; q[k][1] = h / 2 - f * (x * up.x + y * up.y + z * up.z) / zc; q[k][2] = zc; }
    if (!ok) continue;
    const [a, b, c] = q, den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(den) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    if (x0 > x1 || y0 > y1) continue;
    const P = tri.p, ux = P[3] - P[0], uy = P[4] - P[1], uz = P[5] - P[2], vx = P[6] - P[0], vy = P[7] - P[1], vz = P[8] - P[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const shade = 0.5 + 0.62 * Math.abs(nx * sun[0] + ny * sun[1] + nz * sun[2]) * ((nx * sun[0] + ny * sun[1] + nz * sun[2]) > 0 || Math.abs(ny) < 0.5 ? 1 : 0.4);
    const m = mats[tri.mat], T = tri.uv;
    let lod = 0;
    if (m.mips) { // per-triangle mip level: texel area / pixel area
      const tw = m.mips[0].w, tA = Math.abs((T[2] - T[0]) * (T[5] - T[1]) - (T[4] - T[0]) * (T[3] - T[1])) * tw * tw, sA = Math.abs(den) / 2;
      lod = 0.5 * Math.log2(Math.max(1, tA / Math.max(1e-6, sA)));
    }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / den, w1 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / den, w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const iz = w0 / a[2] + w1 / b[2] + w2 / c[2], z = 1 / iz, o = y * w + x;
      if (z >= zb[o]) continue; zb[o] = z;
      let col;
      if (m.mips) { const u = (w0 * T[0] / a[2] + w1 * T[2] / b[2] + w2 * T[4] / c[2]) * z, v = (w0 * T[1] / a[2] + w1 * T[3] / b[2] + w2 * T[5] / c[2]) * z; col = sample(m.mips, u, v, lod); }
      else col = m.solid;
      img[3 * o] = col[0] * shade; img[3 * o + 1] = col[1] * shade; img[3 * o + 2] = col[2] * shade;
    }
  }
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let k = 0; k < 3; k++) {
    let s = 0; for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) s += img[((y * SS + j) * w + x * SS + i) * 3 + k];
    out[(y * W + x) * 3 + k] = Math.max(0, Math.min(255, s / SS / SS));
  }
  png(resolve(OUT, `${label}-${name}.png`), W, H, out);
}
// dkr-aerial (render/camera-shots.ts): position (240, -4.52 + 95, 430), target (444, 5, 272), fov 60.
renderShot('aerial', [240, 90.48, 430], [444, 5, 272], 60);
// North-east diagnostic view (not a camera-shots.ts shot): shows the buff north end + east side.
renderShot('northeast', [620, 80, 90], [444, 10, 272], 60);
// dkr-west street shot (camera-shots.ts): (304, -9.07 + 1.75, 300) -> (348, 11.2, 250), fov 62.
renderShot('street-west', [304, -7.32, 300], [348, 11.2, 250], 62);
console.log('preview written', label, 'triangles', tris.length, 'bowl', JSON.stringify(bowl.stats));
process.exit(0);
