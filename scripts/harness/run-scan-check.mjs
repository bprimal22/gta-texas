// Headless check of the scan integration: the real authored scene with the aligned Tower scan
// replacing buildTower and the scanned DKR field decal on the generated field. Textures stubbed.
import './stubs.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
// GLTFLoader decodes embedded images through createImageBitmap; a 1x1 stand-in keeps it inert.
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const { run } = await import(pathToFileURL(resolve(import.meta.dirname, '../../.work/harness-dist/context-check.mjs')).href);
const THREE = await import('three');
const root = resolve(import.meta.dirname, '../..');
const tower = JSON.parse(readFileSync(resolve(root, 'public/assets/scans/ut-tower.json'), 'utf8'));
const field = JSON.parse(readFileSync(resolve(root, 'public/assets/scans/dkr-field.json'), 'utf8'));
const result = await run({ scan: true, stadiumScan: true });
const { RAPIER, physics, player, scanTower, scanField, world, walkway, ground } = result;
let failed = false;
const fail = msg => { console.error('FAIL', msg); failed = true; };
const q = (a, f) => a.length ? a[Math.min(a.length - 1, Math.floor(f * a.length))] : NaN;
const r3 = v => +v.toFixed(3);

// 1. finite geometry + counts
const scanMeshes = []; scanTower.group.traverse(o => { if (o.isMesh) scanMeshes.push(o); });
const fieldMeshes = []; scanField.group.traverse(o => { if (o.isMesh) fieldMeshes.push(o); });
let nonFinite = 0;
for (const m of [...scanMeshes, ...fieldMeshes]) for (const v of m.geometry.getAttribute('position').array) if (!Number.isFinite(v)) nonFinite++;
const tris = ms => ms.reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.getAttribute('position').count) / 3, 0);
const mats = ms => new Set(ms.flatMap(m => Array.isArray(m.material) ? m.material : [m.material])).size;
console.log('SCAN-GEOMETRY', JSON.stringify({ towerMeshes: scanMeshes.length, towerTriangles: tris(scanMeshes), towerMaterials: mats(scanMeshes), fieldTriangles: tris(fieldMeshes), fieldMaterials: mats(fieldMeshes), nonFinite, colliders: scanTower.colliders.length }));
if (nonFinite) fail('non-finite scan vertices');
// Tower: near = captured scan + textured crown/clocks/window panels + metal/reveals; far = captured scan + textured crown/clocks.
if (mats(scanMeshes) > 5 || mats(fieldMeshes) > 1) fail('too many scan materials');
{
  const towerLod = scanTower.group.children.find(o => o.isLOD);
  const lodMats = towerLod.levels.map(l => { const ms = []; l.object.traverse(o => { if (o.isMesh) ms.push(o); }); return [...new Set(ms.flatMap(m => [m.material].flat()))]; });
  const capturedMaps = lodMats.map(list => list.filter(m => m.userData.capturedColor).map(m => m.map));
  // one unlit captured textured material per LOD (relit by COLOR_0), authored infill never labelled captured,
  // and the far LOD draws from the near textures (scan atlas and authored detail atlas each once on the GPU)
  const ok = lodMats.every(list => list.length <= 3 && list.every(m => m.isMeshBasicMaterial && !m.toneMapped && m.vertexColors) && list.filter(m => m.map && m.userData.capturedColor).length === 1 && list.every(m => m.userData.capturedColor === !m.userData.authoredInfill))
    && capturedMaps[0][0] && capturedMaps[1][0] === capturedMaps[0][0] && scanTower.stats.sharedAtlases === 2
    && new Set(lodMats.flatMap(l => l.map(m => m.map).filter(Boolean))).size === 2; // scan atlas + authored detail atlas, each once
  console.log('TOWER-MATERIALS', JSON.stringify({ lodMaterials: lodMats.map(l => l.map(m => m.name)), sharedAtlas: capturedMaps[1][0] === capturedMaps[0][0], lodTriangles: scanTower.stats.lodTriangles }));
  if (!ok) fail('tower LOD materials (captured/authored labelling, vertex colours, shared atlas)');
}

// 2. transform residuals (recorded by tools/scans)
const res = tower.transform.residuals;
console.log('TOWER-TRANSFORM', JSON.stringify({ corners: `${res.cornersUsed}/${res.cornersTotal}`, cornerRms2D: r3(res.cornerRms2D_m), verticalRms: res.verticalRms_m, umeyama3D: res.umeyama3D.rms_m, scaleMPerUnit: r3(tower.transform.components.scale_metresPerGltfUnit) }));
if (!(res.cornerRms2D_m < 1.0 && res.verticalRms_m < 0.5)) fail('tower transform residuals too large');
console.log('FIELD-TRANSFORM', JSON.stringify({ yardLineRmsS37: r3(field.scale.yardLineRmsS37), metresPerUnit: r3(field.scale.metresPerGltfUnit), sidelineWidth: r3(field.scale.sidelineWidthTrue), centre: field.registration.fieldCentreCampus, yawDeg: r3(field.registration.yawDeg) }));

// 3. tower top above ground
scanTower.group.updateMatrixWorld(true);
const lod = scanTower.group.children.find(o => o.isLOD);
const near = []; lod.levels[0].object.traverse(o => { if (o.isMesh) near.push(o); });
const box = new THREE.Box3(); for (const m of near) box.expandByObject(m);
const [cx, , cz] = tower.anchor, groundY = ground.height(cx, cz);
// Architectural top (published 307 ft excludes antennas): median first visible hit straight down over
// the crown roof (1 m grid within 3 m of the centre; the thin roof rail and mast cover a few cells only).
// The bounding box (incl. the mast) is reported and bounded separately.
const roofHits = [];
for (let s = -3; s <= 3; s += 1) for (let t = -3; t <= 3; t += 1) { const [x, z] = [cx + s * tower.axes.u[0] + t * tower.axes.v[0], cz + s * tower.axes.u[1] + t * tower.axes.v[1]]; const h = new THREE.Raycaster(new THREE.Vector3(x, 200, z), new THREE.Vector3(0, -1, 0), 0, 300).intersectObjects(near, false)[0]; if (h) roofHits.push(h.point.y); }
roofHits.sort((p, q2) => p - q2);
const roofY = q(roofHits, 0.5), topAbove = roofY - groundY;
console.log('TOWER-TOP', JSON.stringify({ roofY: r3(roofY), roofSamples: roofHits.length, boxTopY: r3(box.max.y), groundY: r3(groundY), aboveGround: r3(topAbove), boxAboveGround: r3(box.max.y - groundY), published: 93.6 }));
if (Math.abs(topAbove - 93.6) > 2) fail('tower top height');
if (box.max.y - groundY > 93.6 + 8) fail('tower appendages (mast/antennas) implausibly tall');

// helpers: tower-local axes
const [u, v] = [tower.axes.u, tower.axes.v];
const local = (x, z) => [(x - cx) * u[0] + (z - cz) * u[1], (x - cx) * v[0] + (z - cz) * v[1]];
const worldXZ = (a, b) => [cx + a * u[0] + b * v[0], cz + a * u[1] + b * v[1]];
const scanRay = (x, z, fromY, dist) => new THREE.Raycaster(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0), 0, dist).intersectObjects(near, false);
const physRay = (x, z, fromY) => { const h = physics.castRay(new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }), 400, true, undefined, undefined, player); return h ? fromY - h.timeOfImpact : null; };

// 4. no scan surface within 0.3 m above authored walkable surfaces in the crop region
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
let walkSamples = 0, scanAbove = 0, upwardAbove = 0;
for (const rootObj of [walkway.surfaces, world.group]) {
  rootObj.updateWorldMatrix(true, true);
  rootObj.traverse(o => {
    if (!o.isMesh || o.name === 'Offline local contour terrain') return;
    let p = o; while (p) { if (p === scanTower.group) return; p = p.parent; }
    const pos = o.geometry.getAttribute('position'), index = o.geometry.index, count = index ? index.count : pos.count;
    for (let t = 0; t + 2 < count; t += 3) {
      a.fromBufferAttribute(pos, index ? index.getX(t) : t).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, index ? index.getX(t + 1) : t + 1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, index ? index.getX(t + 2) : t + 2).applyMatrix4(o.matrixWorld);
      const la = local(a.x, a.z); if (Math.max(Math.abs(la[0]), Math.abs(la[1])) > 30) continue;
      n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)); const l = n.length(); if (l < 1e-9 || n.y / l < 0.6) continue;
      const span = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)), k = Math.min(30, Math.max(1, Math.ceil(span / 0.75)));
      for (let i = 0; i <= k; i++) for (let j = 0; j <= k - i; j++) {
        const w0 = i / k, w1 = j / k, w2 = 1 - w0 - w1, x = a.x * w0 + b.x * w1 + c.x * w2, y = a.y * w0 + b.y * w1 + c.y * w2, z = a.z * w0 + b.z * w1 + c.z * w2;
        const L = local(x, z); if (Math.max(Math.abs(L[0]), Math.abs(L[1])) > 10.5) continue; // scan crop square (+margin)
        walkSamples++;
        const hits = scanRay(x, z, y + 0.3, 0.3);
        if (hits.length) { scanAbove++; if (hits.some(h => h.face && h.face.normal.y > 0.5)) upwardAbove++; }
      }
    }
  });
}
console.log('SCAN-ABOVE-WALKABLE', JSON.stringify({ authoredWalkableSamplesInCrop: walkSamples, samplesWithScanWithin03m: scanAbove, ofWhichUpwardScanSurface: upwardAbove }));
if (upwardAbove) fail('scan floor-like surface within 0.3 m above authored walkable surface');

// 5. visible vs physical on landable tower tops (proxy cuboids vs scan surface)
const tiers = { deck: [7.85, 8.9], clockBlockTop: [5.0, 7.5], belfryAndLantern: [0, 4.9], lid: [0, 2.3] };
const agreement = {};
for (const [name, [r0, r1]] of Object.entries(tiers)) {
  const d = [];
  for (let s = -8.937; s <= 9; s += 0.2) for (let t = -8.911; t <= 9; t += 0.2) { // off-grid: rays exactly through heightfield vertices can slip through the crack
    const r = Math.max(Math.abs(s), Math.abs(t)); if (name === 'lid' ? Math.hypot(s + 0.21, t + 0.27) > r1 : (r < r0 || r > r1)) continue;
    const [x, z] = worldXZ(s, t); const hit = scanRay(x, z, 130, 60)[0], py = physRay(x, z, 130);
    if (!hit || py === null) continue;
    d.push(Math.abs(hit.point.y - py));
  }
  d.sort((p, q2) => p - q2);
  agreement[name] = { samples: d.length, p50: r3(q(d, 0.5)), p90: r3(q(d, 0.9)), max: r3(d[d.length - 1] ?? NaN), within01: r3(d.filter(x => x <= 0.1).length / d.length) };
}
console.log('TOWER-TOP-AGREEMENT', JSON.stringify(agreement));
console.log('TOWER-TOP-AGREEMENT-SUMMARY', Object.entries(agreement).map(([k2, a2]) => `${k2}: median ${a2.p50} m, ${Math.round(a2.within01 * 100)}% within 0.1 m`).join('; '), '(not universal: step/ornament cells exceed 0.1 m)');
// Landable tops: the median point must agree within 0.1 m; steep ornament/step cells are reported (p90/max).
for (const [name, a2] of Object.entries(agreement)) if (!(a2.p50 <= 0.1)) fail(`${name} visible vs physical disagreement`);

// 6. Registration proof: visual Tower (scan shaft section) and physical Tower (shaft cuboid +
// heightfield) co-registered at the measured shaft centre; nothing physical left at the old spot.
const MEASURED = [-212.6, -17.7];
const towerIds = result.towerColliderHandles;
const physHit = (o, d) => { const h = physics.castRay(new RAPIER.Ray(o, d), 200, true, undefined, undefined, undefined, undefined, c2 => towerIds.has(c2.handle)); return h ? { x: o.x + d.x * h.timeOfImpact, z: o.z + d.z * h.timeOfImpact } : null; };
const visHit = (o, d) => { const h = new THREE.Raycaster(new THREE.Vector3(o.x, o.y, o.z), new THREE.Vector3(d.x, 0, d.z), 0, 200).intersectObjects(near, false)[0]; return h ? { x: h.point.x, z: h.point.z } : null; };
const registration = {};
for (const [label, hit] of [['visual', visHit], ['physical', physHit]]) {
  // Probe the shaft from four sides along its own axes at three heights (Y 50/65/80), 60 m out.
  const centres = [];
  for (const y of [50, 65, 80]) for (const axis of [u, v]) {
    const a2 = hit({ x: cx + axis[0] * 60, y, z: cz + axis[1] * 60 }, { x: -axis[0], y: 0, z: -axis[1] });
    const b2 = hit({ x: cx - axis[0] * 60, y, z: cz - axis[1] * 60 }, { x: axis[0], y: 0, z: axis[1] });
    if (a2 && b2) centres.push({ x: (a2.x + b2.x) / 2, z: (a2.z + b2.z) / 2, width: Math.hypot(a2.x - b2.x, a2.z - b2.z) });
  }
  const m = centres.reduce((acc, p2) => ({ x: acc.x + p2.x / centres.length, z: acc.z + p2.z / centres.length, w: acc.w + p2.width / centres.length }), { x: 0, z: 0, w: 0 });
  registration[label] = { probes: centres.length, centre: [r3(m.x), r3(m.z)], width: r3(m.w), offsetFromMeasured: r3(Math.hypot(m.x - MEASURED[0], m.z - MEASURED[1])) };
  if (centres.length !== 6 || registration[label].offsetFromMeasured > 0.5) fail(`${String(label)} Tower not at the measured shaft centre ±0.5 m`);
}
registration.visualToPhysical = r3(Math.hypot(registration.visual.centre[0] - registration.physical.centre[0], registration.visual.centre[1] - registration.physical.centre[1]));
console.log('TOWER-REGISTRATION', JSON.stringify({ measured: MEASURED, ...registration }));
if (registration.visualToPhysical > 0.5) fail('visual and physical Tower not co-registered within 0.5 m');
// Old authored Tower footprint (17.98 m square at the MAI landmark): first physical hit everywhere
// must be the Main roof / offline base, never the old 94 m authored Tower. The measured 2017 LiDAR Main roof over this square
// reaches 41–44.5 (b04 round 2, main-building-envelope-plan zones), so the limit is the LiDAR max + 1.5 m = 46.
let oldMax = -Infinity, oldSamples = 0;
for (let s2 = -8.5; s2 <= 8.5; s2 += 1.7) for (let t2 = -8.5; t2 <= 8.5; t2 += 1.7) {
  const x = -215.27 + s2 * Math.cos(0.085) + t2 * Math.sin(0.085), z = 10.40 - s2 * Math.sin(0.085) + t2 * Math.cos(0.085);
  const y = physRay(x, z, 130); oldSamples++; if (y !== null) oldMax = Math.max(oldMax, y);
}
console.log('OLD-TOWER-COLUMN', JSON.stringify({ samples: oldSamples, highestFirstPhysicalHitY: r3(oldMax), limit: 46 }));
if (oldMax > 46) fail('collider remains above the old authored Tower position (above the measured Main roof)');

// 7. field decal sits on the generated field collider, visual only
const fieldY = result.stats.stadium.fieldY, fd = [];
let outside = 0;
for (const m of fieldMeshes) {
  m.updateWorldMatrix(true, false);
  const pos = m.geometry.getAttribute('position'), p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 37) {
    p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
    const hy = physRay(p.x, p.z, p.y + 5); if (hy === null) { outside++; continue; }
    fd.push(Math.abs(p.y - hy));
  }
}
fd.sort((p, q2) => p - q2);
console.log('FIELD-DECAL', JSON.stringify({ fieldY: r3(fieldY), samples: fd.length, noColliderBelow: outside, gapP50: r3(q(fd, 0.5)), gapMax: r3(fd[fd.length - 1]) }));
if (outside || fd[fd.length - 1] > 0.1) fail('field decal not on the generated field collider within 0.1 m');

// 7b. DKR west stand (scan sector replacing the generated west straight)
const stand = JSON.parse(readFileSync(resolve(root, 'public/assets/scans/dkr-west-stand.json'), 'utf8'));
{
  const { scanStand } = result;
  if (!scanStand) fail('scanned west stand missing in scan mode');
  const sf = stand.sector.fieldFrame, A2 = sf.angle, fieldY = result.stats.stadium.fieldY;
  const fromTV = (t, v2) => { const u2 = -sf.hw - t; return [sf.center[0] + u2 * Math.cos(A2) + v2 * Math.sin(A2), sf.center[1] - u2 * Math.sin(A2) + v2 * Math.cos(A2)]; };
  const lerpRows = (rows, v2, k) => { const sr = [...rows].sort((p2, q2) => p2[0] - q2[0]); if (v2 <= sr[0][0]) return sr[0][k]; for (let r2 = 1; r2 < sr.length; r2++) if (v2 <= sr[r2][0]) { const f = (v2 - sr[r2 - 1][0]) / (sr[r2][0] - sr[r2 - 1][0]); return sr[r2 - 1][k] + (sr[r2][k] - sr[r2 - 1][k]) * f; } return sr[sr.length - 1][k]; };
  const reachAt = v2 => lerpRows(stand.sector.reach, v2, 1);
  const edgeAt = v2 => lerpRows(stand.sector.outer, v2, 1);
  const meshes = []; scanStand.group.traverse(o => { if (o.isMesh) meshes.push(o); });
  const standLod = scanStand.group.children.find(o => o.isLOD), standNear = [];
  standLod.levels[0].object.traverse(o => { if (o.isMesh) standNear.push(o); });
  let nf = 0; for (const m of meshes) for (const x of m.geometry.getAttribute('position').array) if (!Number.isFinite(x)) nf++;
  // Per LOD: one textured captured material and at most one untextured authored infill, both unlit;
  // only the photographed one is labelled captured. Also finite UVs and in-range indices.
  const lodMaterials = standLod.levels.map(l => { const ms = []; l.object.traverse(o => { if (o.isMesh) ms.push(o); }); return [...new Set(ms.flatMap(m => [m.material].flat()))]; });
  const lodMaterialsOk = lodMaterials.every(list => list.length <= 2 && list.every(m => m.isMeshBasicMaterial) && list.filter(m => m.map && m.userData.capturedColor && !m.toneMapped).length === 1 && list.every(m => m.map ? !m.userData.authoredInfill : m.userData.authoredInfill && !m.userData.capturedColor));
  for (const m of meshes) for (const k of ['uv', 'position']) { const a = m.geometry.getAttribute(k); if (a) for (const x of a.array) if (!Number.isFinite(x)) nf++; }
  for (const m of meshes) { const n = m.geometry.getAttribute('position').count; for (const i of m.geometry.index?.array ?? []) if (i >= n) nf++; }
  console.log('STAND-GEOMETRY', JSON.stringify({ meshes: meshes.length, triangles: tris(meshes), nearTriangles: tris(standNear), materials: mats(meshes), lodMaterials: lodMaterials.map(l => l.map(m => m.name)), nonFinite: nf, colliders: scanStand.colliders.length, colliderTriangles: stand.collider.triangles, bowl: result.stats.stadium.scanSector, sourceTexelsPerMetre: +stand.crop.texelsPerMetre.toFixed(1), planCoverage: +stand.crop.planCoverage.toFixed(3) }));
  if (nf || !lodMaterialsOk || !result.stats.stadium.scanSector || result.stats.stadium.scanSector.seamWalls !== 2 || !result.stats.stadium.scanSector.pressBox) fail('stand geometry / bowl sector');
  console.log('STAND-CLEANUP', JSON.stringify({ ...stand.cleanup, visualInfillCells: stand.collider.visualInfillCells, pressBox: stand.sector.pressBox }));
  const standIds = new Set(scanStand.colliders.map(c2 => c2.handle));
  const visY = (x, z, from = 140) => { const h = new THREE.Raycaster(new THREE.Vector3(x, from, z), new THREE.Vector3(0, -1, 0), 0, 300).intersectObjects(standNear, false)[0]; return h ? h.point.y : null; };
  // visible vs physical over the scanned surface (off-grid samples)
  const d = [];
  for (let v2 = -52.63; v2 <= 52.7; v2 += 0.71) for (let t = 0.37; t <= reachAt(v2) - 1.2; t += 0.71) {
    const [x, z] = fromTV(t, v2), vy = visY(x, z), py = physRay(x, z, 140);
    if (vy === null || py === null) continue;
    d.push(Math.abs(vy - py));
  }
  d.sort((p2, q2) => p2 - q2);
  const agree = { samples: d.length, median: r3(q(d, 0.5)), p90: r3(q(d, 0.9)), within01: r3(d.filter(x => x <= 0.1).length / d.length), within03: r3(d.filter(x => x <= 0.3).length / d.length), max: r3(d[d.length - 1]) };
  console.log('STAND-AGREEMENT', JSON.stringify(agree), `(median ${agree.median} m, ${Math.round(agree.within01 * 100)}% within 0.1 m, ${Math.round(agree.within03 * 100)}% within 0.3 m; overhang/edge cells exceed)`);
  if (!(agree.median <= 0.1 && agree.within03 >= 0.85)) fail('stand visible vs physical disagreement');
  // seams: nothing to fall through into the bowl hollow along the sector boundaries, the field edge and the outer edge
  const seam = { side: [0, 0], front: [0, 0], outer: [0, 0] };
  // side seams: within the generated neighbour's own extent (its rim is capped at 50 m, t <= ~77 m)
  for (const vb of [stand.sector.vMin, stand.sector.vMax]) for (const dv of [-0.3, -0.1, 0.1, 0.3]) for (let t = 0.25; t <= Math.min(76.5, reachAt(vb) - 0.25); t += 0.5) {
    const [x, z] = fromTV(t, vb + dv), py = physRay(x, z, 140); seam.side[0]++; if (py === null || py < fieldY - 0.3) { seam.side[1]++; if (process.env.SEAM_DEBUG) console.log('SIDE-HOLE', vb, dv, r3(t), py === null ? null : r3(py)); }
  }
  for (let v2 = stand.sector.vMin + 0.25; v2 <= stand.sector.vMax - 0.25; v2 += 0.5) {
    for (const t of [-0.3, -0.1, 0.1, 0.3]) { const [x, z] = fromTV(t, v2), py = physRay(x, z, 140); seam.front[0]++; if (py === null || py < fieldY - 0.1) { seam.front[1]++; if (process.env.SEAM_DEBUG) console.log('FRONT-HOLE', r3(v2), t, py === null ? null : r3(py)); } }
    for (const t of [edgeAt(v2) - 0.3, edgeAt(v2) + 0.2, reachAt(v2) + 0.2]) { const [x, z] = fromTV(t, v2), py = physRay(x, z, 140); seam.outer[0]++; if (py === null || py < fieldY - 0.3) { seam.outer[1]++; if (process.env.SEAM_DEBUG) console.log('OUTER-HOLE', r3(v2), r3(t), r3(edgeAt(v2)), r3(reachAt(v2)), py === null ? null : r3(py)); } }
  }
  console.log('STAND-SEAMS', JSON.stringify({ fieldY: r3(fieldY), sideSamples: seam.side[0], sideHoles: seam.side[1], frontSamples: seam.front[0], frontHoles: seam.front[1], outerSamples: seam.outer[0], outerHoles: seam.outer[1] }));
  if (seam.side[1] || seam.front[1] || seam.outer[1]) fail('stand sector seam has a hole');
  // Seam honesty: visible and physical top heights on both sides of each seam (scan side 0.4 m inside
  // the sector, generated side 0.4 m outside), max step across, and a player-capsule sweep across.
  const genMeshes = []; result.context.solid.traverse(o => { if (o.isMesh) genMeshes.push(o); });
  const genY = (x, z) => { const h = new THREE.Raycaster(new THREE.Vector3(x, 140, z), new THREE.Vector3(0, -1, 0), 0, 300).intersectObjects(genMeshes, false)[0]; return h ? h.point.y : null; };
  const L2 = [Math.sin(A2), Math.cos(A2)]; // +v direction in (x, z)
  const capsule = new RAPIER.Capsule(0.54, 0.34), seamRows = [];
  let maxStep = 0, sweeps = 0, sweepBlocked = 0;
  for (const [label2, vb, inward] of [['vMin', stand.sector.vMin, 1], ['vMax', stand.sector.vMax, -1]]) for (const t of [2, 5, 10, 20, 30, 40, 50, 60, 70]) {
    if (t > reachAt(vb) - 1) continue;
    const [xs, zs] = fromTV(t, vb + inward * 0.4), [xg, zg] = fromTV(t, vb - inward * 0.4);
    const visScan = visY(xs, zs), visGen = genY(xg, zg), phyScan = physRay(xs, zs, 140), phyGen = physRay(xg, zg, 140);
    const step = visScan !== null && visGen !== null ? Math.abs(visScan - visGen) : null;
    if (step !== null) maxStep = Math.max(maxStep, step);
    // capsule sweep from 1.5 m inside the sector toward the generated side, standing on the scan surface
    let sweep = null;
    if (phyScan !== null) {
      const [x0, z0] = fromTV(t, vb + inward * 1.5);
      const y0 = (physRay(x0, z0, 140) ?? phyScan) + 0.95, dir = { x: -inward * L2[0], y: 0, z: -inward * L2[1] };
      const hit = physics.castShape({ x: x0, y: y0, z: z0 }, { x: 0, y: 0, z: 0, w: 1 }, dir, capsule, 0, 3.0, true, undefined, undefined, player);
      sweeps++; if (hit) sweepBlocked++;
      sweep = hit ? `blocked after ${r3(hit.time_of_impact ?? hit.timeOfImpact ?? 0)} m` : 'passes 3 m';
    }
    seamRows.push({ seam: label2, t, visibleScan: visScan === null ? null : r3(visScan - fieldY), visibleGenerated: visGen === null ? null : r3(visGen - fieldY), physicalScan: phyScan === null ? null : r3(phyScan - fieldY), physicalGenerated: phyGen === null ? null : r3(phyGen - fieldY), step: step === null ? null : r3(step), sweep });
  }
  for (const row of seamRows) console.log('STAND-SEAM-PROFILE', JSON.stringify(row));
  console.log('STAND-SEAM-SUMMARY', JSON.stringify({ maxVisibleStepM: r3(maxStep), capsuleSweeps: sweeps, blocked: sweepBlocked,
    verdict: 'visible barrier: the seam walls rise to the higher of the scanned and generated profiles, so the seam is a closed boundary with no holes, not a smooth walkable transition' }));

  // no scan surface within 0.3 m above authored walkable ground near the sector (outer streets/forecourt)
  let ws = 0, wa = 0;
  for (const rootObj of [walkway.surfaces, world.group]) rootObj.traverse(o => {
    if (!o.isMesh || o.name === 'Offline local contour terrain') return;
    const pos = o.geometry.getAttribute('position'), index = o.geometry.index, count = index ? index.count : pos.count;
    for (let t = 0; t + 2 < count; t += 3) {
      a.fromBufferAttribute(pos, index ? index.getX(t) : t).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, index ? index.getX(t + 1) : t + 1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, index ? index.getX(t + 2) : t + 2).applyMatrix4(o.matrixWorld);
      const cxm = (a.x + b.x + c.x) / 3, czm = (a.z + b.z + c.z) / 3, dx = cxm - sf.center[0], dz = czm - sf.center[1];
      const uu = dx * Math.cos(A2) - dz * Math.sin(A2), vv = dx * Math.sin(A2) + dz * Math.cos(A2), tt = -sf.hw - uu;
      if (tt < -2 || tt > 100 || vv < stand.sector.vMin - 3 || vv > stand.sector.vMax + 3) continue;
      n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)); const l = n.length(); if (l < 1e-9 || n.y / l < 0.6) continue;
      ws++;
      const y = (a.y + b.y + c.y) / 3, h = new THREE.Raycaster(new THREE.Vector3(cxm, y + 0.3, czm), new THREE.Vector3(0, -1, 0), 0, 0.3).intersectObjects(standNear, false);
      if (h.length) wa++;
    }
  });
  console.log('STAND-ABOVE-WALKABLE', JSON.stringify({ authoredWalkableTrianglesNearSector: ws, withScanWithin03m: wa }));
  if (wa) fail('scanned stand surface within 0.3 m above authored walkable ground');
  // STD landmark travel must land outdoors; flight landings on the scanned lower bowl and upper deck
  const std = result.travel(world.data.landmarks.STD.position);
  console.log('STAND-TRAVEL-STD', JSON.stringify(std));
  if (!std.landing || std.enclosed !== false) fail('STD travel');
  const { findFlightLanding } = await import(pathToFileURL(resolve(import.meta.dirname, '../../.work/harness-dist/context-check.mjs')).href);
  const landings = [];
  for (const [t, v2] of [[12, -20], [18, 30], [8, 0], [60, -30], [70, 20]]) {
    const [x, z] = fromTV(t, v2), vy = visY(x, z);
    const target = findFlightLanding(physics, player, { x, y: (vy ?? fieldY) + 25, z }, undefined, null);
    const shown = target ? visY(target.x, target.z) : null;
    landings.push({ t, v: v2, visibleY: vy === null ? null : r3(vy), landing: target ? target.toArray().map(r3) : null, footAboveVisible: target && shown !== null ? r3(target.y - shown) : null, onStandCollider: target ? standIds.size > 0 && physics.castRay(new RAPIER.Ray({ x: target.x, y: target.y, z: target.z }, { x: 0, y: -1, z: 0 }), 3, true, undefined, undefined, player, undefined, c2 => standIds.has(c2.handle)) !== null : false });
  }
  console.log('STAND-FLIGHT-LANDING', JSON.stringify(landings));
  const lower = landings.slice(0, 3);
  if (lower.some(l2 => !l2.landing || !l2.onStandCollider || l2.footAboveVisible === null || Math.abs(l2.footAboveVisible - 0.905) > 0.3)) fail('flight landing on the scanned lower bowl');
}

// 8. Route / travel / clearance — run for the scan scene AND the scan-load-failure fallback scene.
const SCOPE = 'generated-context colliders only (unchanged criterion); scan colliders (Tower proxies / authored Tower boxes + scanned DKR west stand) and tree capsules are separate scopes below';
function treeCapsules(r) {
  const caps = [];
  for (const fit of r.walkway.trees?.fits ?? []) for (const c2 of fit.capsules) caps.push(c2);
  const canopy = r.vegetation?.canopy; if (canopy) for (const c2 of canopy.capsules) caps.push(c2);
  return caps;
}
// segment–segment distance (Ericson) for capsule tests
function segDist(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), rr = p1.clone().sub(p2);
  const a2 = d1.dot(d1), e = d2.dot(d2), f = d2.dot(rr); let s3, t3;
  if (a2 <= 1e-9 && e <= 1e-9) return p1.distanceTo(p2);
  if (a2 <= 1e-9) { s3 = 0; t3 = Math.min(1, Math.max(0, f / e)); }
  else { const c3 = d1.dot(rr); if (e <= 1e-9) { t3 = 0; s3 = Math.min(1, Math.max(0, -c3 / a2)); } else {
    const b3 = d1.dot(d2), den = a2 * e - b3 * b3; s3 = den !== 0 ? Math.min(1, Math.max(0, (b3 * f - c3 * e) / den)) : 0;
    t3 = (b3 * s3 + f) / e; if (t3 < 0) { t3 = 0; s3 = Math.min(1, Math.max(0, -c3 / a2)); } else if (t3 > 1) { t3 = 1; s3 = Math.min(1, Math.max(0, (b3 - c3) / a2)); } } }
  return p1.clone().addScaledVector(d1, s3).distanceTo(p2.clone().addScaledVector(d2, t3));
}
function routeTravelClearance(r, label) {
  const { RAPIER: R, physics: ph, player: pl, world: w } = r;
  const violations = Object.entries(r.routeViolations);
  console.log(`[${label}] ROUTE-GEOMETRY`, r.walkableSamples, 'authored walkable samples;', violations.length ? `INSIDE GENERATED: ${JSON.stringify(r.routeViolations)}` : 'none inside generated footprints');
  if (violations.length) fail(`[${label}] authored route inside generated footprint`);
  for (const requested of [[69.635, -18.478], [47.8647, -17.0776], [47.0488, -17.0776], [58, -18], [62, -10]]) {
    const t4 = r.travel(requested);
    console.log(`[${label}] TRAVEL`, JSON.stringify(t4));
    if (!t4.landing || t4.enclosed !== false || t4.offset > 60 || t4.searchMs > 8000) fail(`[${label}] GDC travel ${JSON.stringify(requested)}`);
  }
  // Old MAI landmark request must still land outdoors under open sky; others: open sky if landed.
  {
    // STD landmark (inside the west-stand sector in the scan scene) must land under open sky.
    const t4 = r.travel(w.data.landmarks.STD.position);
    console.log(`[${label}] TRAVEL-STD`, JSON.stringify(t4));
    if (!t4.landing || t4.enclosed !== false) fail(`[${label}] STD travel`);
  }
  for (const requested of [[-215.269, 10.398], [-212.6, -40], [-212.6, 5]]) {
    const t4 = r.travel(requested);
    console.log(`[${label}] TRAVEL-TOWER-AREA`, JSON.stringify(t4));
    const required = requested[0] === -215.269;
    if ((required && (!t4.landing || t4.enclosed !== false)) || (t4.landing && t4.enclosed !== false)) fail(`[${label}] Tower-area travel ${JSON.stringify(requested)}`);
  }
  const generated = new Set(r.context.colliders.map(c2 => c2.handle)), tower = new Set([...r.towerColliderHandles, ...(r.scanStand?.colliders ?? []).map(c2 => c2.handle)]), trees = treeCapsules(r);
  const shape = new R.Capsule(0.54, 0.34);
  const checks = { spawn: [114, 64.4], ...Object.fromEntries(Object.entries(w.data.landmarks).map(([k2, v2]) => [k2, v2.position])) };
  console.log(`[${label}] CLEARANCE scope: ${SCOPE}`);
  for (const [name, [x, z]] of Object.entries(checks)) {
    const y = w.terrain.height(x, z) + 0.95; let gen = 0, tw = 0;
    ph.intersectionsWithShape({ x, y, z }, { x: 0, y: 0, z: 0, w: 1 }, shape, c2 => { if (generated.has(c2.handle)) gen++; if (tower.has(c2.handle)) tw++; return true; }, undefined, undefined, pl);
    const a3 = new THREE.Vector3(x, y - 0.54, z), b3 = new THREE.Vector3(x, y + 0.54, z);
    const treeHits = trees.filter(c2 => segDist(a3, b3, c2.a, c2.b) < 0.34 + c2.radius).length;
    console.log(`[${label}] CLEARANCE`, name, x, z, gen ? `BLOCKED by ${gen} generated collider(s)` : 'clear',
      `| SCAN-COLLIDERS ${tw ? `BLOCKED by ${tw}` : 'clear'} | TREE-CAPSULES ${treeHits ? `BLOCKED by ${treeHits}` : 'clear'} (${trees.length} capsules)`);
    if (gen) fail(`[${label}] ${name} capsule blocked by generated colliders`);
    if (tw) fail(`[${label}] ${name} capsule blocked by scan colliders`);
    if (treeHits) fail(`[${label}] ${name} capsule blocked by tree capsules`);
  }
}
routeTravelClearance(result, 'scan');

// 9. Scan-load-failure fallback: same harness path with an injected load failure must build the
// authored Tower and pass the same route/travel/clearance criteria.
{
  const fallback = await run({ scanFailure: true });
  console.log('[fallback] SCAN-FALLBACK', JSON.stringify({ authoredTowerBuilt: fallback.scanFallback, scanTower: !!fallback.scanTower, towerColliders: fallback.towerColliderHandles.size }));
  if (!fallback.scanFallback || fallback.scanTower || fallback.towerColliderHandles.size === 0) fail('scan failure did not fall back to the authored Tower');
  routeTravelClearance(fallback, 'fallback');
}
if (failed) { console.error('FAIL: scan check'); process.exit(1); }
console.log('SCAN-CHECK OK');
