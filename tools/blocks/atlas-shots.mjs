// Research comparison camera poses for the 153 accepted unit-overview captures (Codex screenshot atlas,
// research/whole-campus-92/screenshot-dataset). Writes lib/campus/render/atlas-shots.json: camera = the capture's
// actual campus camera, target = its planned target, fov = 60° vertical (same as the capture). No image data.
//   node tools/blocks/atlas-shots.mjs [datasetDir]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const ROOT = resolve(import.meta.dirname, '../..');
const D = resolve(process.argv[2] ?? resolve(ROOT, '../ut/research/whole-campus-92/screenshot-dataset'));
const review = JSON.parse(readFileSync(resolve(D, 'review.json'), 'utf8')).reviews;
const shots = [];
for (const [id, r] of Object.entries(review)) {
  if (r.status !== 'accepted') continue;
  const c = JSON.parse(readFileSync(resolve(D, 'captures', `${id}.json`), 'utf8'));
  const cam = c.actualCameraCampus ?? c.plannedCameraCampus, tgt = c.plannedTargetCampus;
  shots.push({ id, label: `ATLAS (staged research pose) ${c.block} unit ${c.unit} overview`, position: cam.map(v => +v.toFixed(2)), target: tgt.map(v => +v.toFixed(2)),
    fov: Math.round(c.actualVerticalFovDegrees ?? c.plannedVerticalFovDegrees ?? 60), groundY: +tgt[1].toFixed(2), focus: tgt.map(v => +v.toFixed(2)), block: c.block, kind: 'atlas',
    imageSha256: r.imageSha256, note: 'Matches an accepted geographic-overview capture (Google Photorealistic 3D Tiles via Cesium, research only; 1204x954). Staged comparison pose, not gameplay proof and not facade evidence.' });
}
shots.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(resolve(ROOT, 'lib/campus/render/atlas-shots.json'), JSON.stringify(shots, null, 1) + '\n');
console.log('atlas shots', shots.length);
