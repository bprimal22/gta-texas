// Linear-light mean albedo of each shipped context colour texture (sRGB-decoded per pixel, then averaged).
// The generated-context material colour is 1 / linearMean so that a vertex colour equals the texture's average
// rendered albedo (appearance-audit/REPORT.md §5: averaging encoded sRGB then decoding biased walls 3–18 % bright).
//   NODE_PATH=<dir with sharp> node tools/context/linear-means.mjs
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const ROOT = resolve(import.meta.dirname, '../..');
const toLin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const out = {};
for (const k of ['buffBrick', 'brownBrick', 'limestone', 'precast', 'stucco', 'siding', 'metal', 'clayTile', 'shingle', 'membrane']) {
  const { data, info } = await sharp(resolve(ROOT, `public/assets/materials/context/${k}-color.jpg`)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0], enc = [0, 0, 0], n = info.width * info.height;
  for (let i = 0; i < data.length; i += 3) for (let c = 0; c < 3; c++) { sum[c] += toLin(data[i + c] / 255); enc[c] += data[i + c]; }
  out[k] = { linearMean: sum.map(v => +(v / n).toFixed(5)), encodedMean: enc.map(v => Math.round(v / n)) };
}
console.log(JSON.stringify(out));
