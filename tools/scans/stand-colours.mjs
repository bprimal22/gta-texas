// Measured median colours of the scanned DKR west stand (baked atlas panes) for the generated
// stadium palette: seats = top pane over the seating decks, concrete = front pane (field-facing
// fascia/risers). Sunlit vs shade split at the luminance valley (2-means on luma).
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const LANE = resolve(import.meta.dirname, '../..');
const meta = JSON.parse(readFileSync(resolve(LANE, 'public/assets/scans/dkr-west-stand.json'), 'utf8'));
const img = await sharp(resolve(LANE, '.work/scans/stand-atlas.png')).raw().toBuffer({ resolveWithObject: true });
const { width: W } = img.info, ch = img.info.channels, px = img.data;
const P = meta.atlas.panes, BR = meta.atlas.pxPerMetre, rim = meta.sector.outer;
const rimAt = v => { let best = rim[0]; for (const r of rim) if (Math.abs(r[0] - v) < Math.abs(best[0] - v)) best = r; return best[1]; };
const luma = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const med = (arr, k) => { const s = arr.map(c => c[k]).sort((a, b) => a - b); return s[s.length >> 1]; };
const median3 = arr => [0, 1, 2].map(k => med(arr, k));
const split = arr => { let lo = 60, hi = 160; for (let it = 0; it < 20; it++) { const th = (lo + hi) / 2, a = arr.filter(c => luma(c) < th), b = arr.filter(c => luma(c) >= th); lo = a.length ? a.reduce((s, c) => s + luma(c), 0) / a.length : lo; hi = b.length ? b.reduce((s, c) => s + luma(c), 0) / b.length : hi; } const th = (lo + hi) / 2; return { threshold: th, shade: arr.filter(c => luma(c) < th), sun: arr.filter(c => luma(c) >= th) }; };
const sample = (pane, accept) => { const out = []; for (let y = 0; y < pane.h; y += 2) for (let x = 0; x < pane.w; x += 2) { if (!accept(x, y)) continue; const o = ((pane.oy + y) * W + pane.ox + x) * ch; const c = [px[o], px[o + 1], px[o + 2]]; if (c[0] + c[1] + c[2] < 6 || Math.min(c[0], c[1], c[2]) > 250) continue; out.push(c); } return out; };
const vMin = meta.sector.vMin;
// top pane: x = t*BR, y = (v - vMin)*BR; seats between t 3 m and rim - 3 m
const seats = sample(P.top, (x, y) => { const t = x / BR, v = vMin + y / BR; return t > 3 && t < rimAt(v) - 3; });
// front pane: x = (v - vMin)*BR, y = (YMAX - y)*BR; field-facing fascia and risers above 2 m
const fascia = sample(P.front, (x, y) => (70 - y / BR) > 2);
const report = {};
for (const [name, arr] of Object.entries({ seats, fascia })) { const s = split(arr); report[name] = { pixels: arr.length, median: median3(arr), sunlitMedian: median3(s.sun), shadeMedian: median3(s.shade), sunlitFraction: +(s.sun.length / arr.length).toFixed(3), lumaThreshold: +s.threshold.toFixed(1) }; }
const warm = seats.filter(c => c[0] - c[2] > 25);
report.seats.warmFraction = +(warm.length / seats.length).toFixed(3); report.seats.warmMedian = warm.length ? median3(warm) : null;
console.log(JSON.stringify(report, null, 1));
writeFileSync(resolve(LANE, '.work/scans/stand-colours.json'), JSON.stringify(report, null, 1));
