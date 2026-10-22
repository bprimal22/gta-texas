// GDC/NHB envelope checks against the real authored scene (headless).
// 1. finite vertices for every GDC/NHB mesh;
// 2. visual vs Rapier collider agreement on reachable roof tops (<= 0.1 m);
// 3. no GDC/NHB solid inside the clear height above authored walkable ground
//    (east court, GDC frontage, NHB forecourt);
// 4. flight blocked by the atrium/central roof, east court open to the sky.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { run } from './context-check';
import { gdcRoofPlates } from '../../lib/campus/gdc-facade';
import { hackermanFrame } from '../../lib/campus/hackerman-building';

export async function runGdcCheck() {
  const r = await run();
  const failures: string[] = [];
  const building = /^(GDC|NHB)/;
  const ground = new Set(['GDC east court pale concrete pavers', 'GDC graded groundcover and mapped stone paths', 'Hackerman continuous entrance forecourt']);
  const solids: THREE.Mesh[] = [], walkable: THREE.Mesh[] = [];
  let vertices = 0, nonFinite = 0;
  r.walkway.group.updateWorldMatrix(true, true);
  r.walkway.group.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const name = (m.material as THREE.Material).name || m.name;
    if (ground.has(name)) walkable.push(m);
    else if (building.test(name) && !/sculpture|lamp|globe|bench|planting|bed fine|courtyard pale stone/i.test(name)) solids.push(m);
    if (!building.test(name) && !ground.has(name)) return;
    for (const v of m.geometry.getAttribute('position').array as Float32Array) { vertices++; if (!Number.isFinite(v)) nonFinite++; }
  });
  if (nonFinite) failures.push(`${nonFinite} non-finite GDC/NHB vertex components`);
  // Private BVH of the visual building meshes (decorative screens included).
  const visual = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const p = new THREE.Vector3();
  for (const m of solids) {
    const pos = m.geometry.getAttribute('position'), verts = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); verts.set([p.x, p.y, p.z], i * 3); }
    const index = m.geometry.index ? new Uint32Array(m.geometry.index.array) : Uint32Array.from({ length: pos.count }, (_, i) => i);
    visual.createCollider(RAPIER.ColliderDesc.trimesh(verts, index));
  }
  visual.step();
  const down = (world: RAPIER.World, x: number, z: number, exclude?: RAPIER.Collider) => {
    const h = world.castRay(new RAPIER.Ray({ x, y: 80, z }, { x: 0, y: -1, z: 0 }), 100, true, undefined, undefined, exclude);
    return h ? 80 - h.timeOfImpact : null;
  };
  const gdc = (u: number, v: number) => [21.8 + u * .996164 - v * .087504, -19.1 + u * .087504 + v * .996164] as const;
  // 2. Roof agreement: wing plates (outside penthouses), central roof, monitor,
  // penthouse tops; NHB main roof. Physics must match visual within 0.1 m.
  const roofPoints: [string, number, number][] = [];
  for (const plate of gdcRoofPlates) for (let u = plate.u0 + 1; u < plate.u1 - .5; u += 4.3) for (let v = plate.v0 + .6; v < plate.v1 - .3; v += 3.1)
    roofPoints.push([`GDC ${plate.name} roof`, ...gdc(u, v)]);
  for (let u = 30.5; u < 45.4; u += 1.7) for (let v = -7.2; v <= 7.2; v += 2.4) roofPoints.push(['GDC central roof', ...gdc(u, v)]);
  for (let u = -3; u < 148; u += 3.7) for (let v = -3.9; v < 26.5; v += 2.9) {
    const x = hackermanFrame.southeast[0] + u * hackermanFrame.west[0] + v * hackermanFrame.north[0];
    const z = hackermanFrame.southeast[1] + u * hackermanFrame.west[1] + v * hackermanFrame.north[1];
    roofPoints.push(['NHB roof', x, z]);
  }
  let roofChecked = 0, roofMismatch = 0, thinMembers = 0;
  const mismatches: string[] = [];
  for (const [name, x, z] of roofPoints) {
    // Open grids (NHB canopy, GDC screens) have gaps: compare physics with
    // the highest visual hit within ±0.16 m, i.e. the support a foot finds.
    const ring = [[0, 0], [.16, 0], [-.16, 0], [0, .16], [0, -.16]].map(([dx, dz]) => down(visual, x + dx, z + dz) ?? -Infinity);
    const hits = ring.filter(h => h > -Infinity);
    const a = hits.length ? Math.max(...hits) : null, b = down(r.physics, x, z, r.player);
    if (a === null || a < 15) continue; // only elevated roof tops
    // A maximum narrower than 0.32 m along x or z (canopy stay, mullion cap)
    // is not a surface anyone can stand on; physics may then support below it.
    const narrow = (ring[1] < a - .1 && ring[2] < a - .1) || (ring[3] < a - .1 && ring[4] < a - .1);
    if (b !== null && narrow && b <= a + .1) { thinMembers++; continue; }
    roofChecked++;
    if (b === null || Math.abs(a - b) > .1) { roofMismatch++; if (name.startsWith('GDC') || mismatches.length < 40) mismatches.push(`${name} ${x.toFixed(1)},${z.toFixed(1)} visual ${a.toFixed(2)} physics ${b?.toFixed(2)}`); }
  }
  // Report NHB separately: its decorative canopy blades are visual-only by design.
  const gdcMismatch = mismatches.filter(m => m.startsWith('GDC'));
  if (gdcMismatch.length) failures.push(`GDC roof visual/collider mismatch: ${gdcMismatch.join('; ')}`);
  if (roofMismatch > gdcMismatch.length) failures.push(`NHB roof visual/collider mismatch: ${mismatches.filter(m => m.startsWith('NHB')).slice(0, 8).join('; ')}`);
  // 3. Clear height above authored walkable ground.
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let walkSamples = 0, blocked = 0, steps = 0; const blockedAt: string[] = [];
  for (const m of walkable) {
    const pos = m.geometry.getAttribute('position'), index = m.geometry.index, count = index ? index.count : pos.count;
    for (let t = 0; t + 2 < count; t += 3) {
      a.fromBufferAttribute(pos, index ? index.getX(t) : t).applyMatrix4(m.matrixWorld);
      b.fromBufferAttribute(pos, index ? index.getX(t + 1) : t + 1).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(pos, index ? index.getX(t + 2) : t + 2).applyMatrix4(m.matrixWorld);
      const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      if (n.length() < 1e-9 || Math.abs(n.y / n.length()) < .6) continue;
      const k = Math.max(1, Math.min(12, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c)) / .7)));
      for (let i = 0; i <= k; i++) for (let j = 0; j <= k - i; j++) {
        const w = 1 - i / k - j / k, x = a.x * i / k + b.x * j / k + c.x * w, y = a.y * i / k + b.y * j / k + c.y * w, z = a.z * i / k + b.z * j / k + c.z * w;
        walkSamples++;
        const hit = visual.castRay(new RAPIER.Ray({ x, y: y + .05, z }, { x: 0, y: 1, z: 0 }), 1.75, true);
        if (hit && hit.timeOfImpact + .05 <= .3) steps++;
        else if (hit) { blocked++; if (!nearWall(x, z) && blockedAt.length < 10) blockedAt.push(`${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} ceiling +${(hit.timeOfImpact + .05).toFixed(2)}`); }
      }
    }
  }
  // Edge contact: paving deliberately runs under the masonry base line. Only
  // samples farther than 0.45 m from every wall-side court edge are scored.
  if (blockedAt.length) failures.push(`solids over authored walkable ground: ${blockedAt.join('; ')}`);
  // 4. Flight: atrium/central volume roofs collide; the east court is open.
  const flight: Record<string, number | null> = {};
  for (const [name, u, v] of [['atrium top terrace', 32, 0], ['central roof', 40, 0], ['roof monitor', 39.5, 0], ['east court', 52, 0]] as const) {
    const [x, z] = gdc(u, v); flight[name] = down(r.physics, x, z, r.player);
  }
  if (!(flight['central roof']! > 24.9) || !(flight['atrium top terrace']! > 24.9) || !(flight['roof monitor']! > 25.5)) failures.push(`flight roofs not physical: ${JSON.stringify(flight)}`);
  if (!(flight['east court']! < 3)) failures.push(`east court not open to sky: ${JSON.stringify(flight)}`);
  const travel = [[69.635, -18.478], gdc(50, 4), gdc(58, -2)].map(q => r.travel(q as [number, number]));
  for (const t of travel) if (!t.landing || t.enclosed !== false) failures.push(`travel ${JSON.stringify(t.requested)} failed`);
  return { vertices, nonFinite, solids: solids.length, roofChecked, roofMismatch, thinMembers, gdcRoofMismatch: gdcMismatch.length, nhbRoofExamples: mismatches.filter(m => m.startsWith('NHB')).slice(0, 4),
    walkSamples, stepUps: steps, blockedNearWalls: blocked, flight, travel, failures };
}

// UT official GDC footprint (OBJECTID 402). Paving meets these wall lines and
// runs under the masonry base: samples within 0.45 m are edge contact only.
const ut402 = [[67.075,-22.971],[65.672,-7.484],[80.488,-6.188],[80.02,-0.824],[81.638,-0.682],[80.807,8.832],[79.189,8.69],[78.721,14.054],[24.918,9.35],[25.386,3.987],[23.768,3.844],[24.599,-5.67],[26.217,-5.528],[26.685,-10.893],[37.784,-9.922],[39.137,-25.414],[28.038,-26.385],[28.506,-31.749],[26.888,-31.89],[27.718,-41.404],[29.336,-41.263],[29.805,-46.627],[44.927,-45.305],[45.425,-51.01],[57.502,-49.954],[57.004,-44.249],[114.352,-39.234],[113.884,-33.871],[115.502,-33.729],[114.671,-24.214],[113.053,-24.356],[112.585,-18.992]];
function nearWall(x: number, z: number) {
  for (let i = 0; i < ut402.length; i++) {
    const [ax, az] = ut402[i], [bx, bz] = ut402[(i + 1) % ut402.length], dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    if (Math.hypot(x - ax - t * dx, z - az - t * dz) < .45) return true;
  }
  return false;
}
