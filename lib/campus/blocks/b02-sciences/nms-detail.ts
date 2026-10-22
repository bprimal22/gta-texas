// D03 Neural and Molecular Science Building (NMS, official object 401; part of City union 655081:892 rebuilt by b02).
// Evidence (engineering-core lane, .work/claude-engineering/lidar/windows.json = read-only window of the 2017 USGS 3DEP 0.5 m DSM,
// campus Y = NAVD88 - 165, alignment.json global shift dx -0.22 / dz -1.09 applied):
//  * Roof plant: MEASURED. Over the central hip (roofs.json NMS-central-hip, cap 40.6) the DSM shows two metal plant housings
//    (cells > 43.6 m: west x -57.5..-47.0 z -349.8..-340.8, east x -41.0..-31.0 z -347.8..-339.8, top P50 44.2 / P90 44.5) split
//    by an open slot, and four exhaust stacks in symmetric pairs (DSM peaks 48.12 / 47.93 / 47.92 / 48.09 at the centres below).
//    district-orbits-30m d03-orbit-southeast shows them as silver duct housings with tall stacks on the tile roof.
//  * Glazed bays: REFERENCE-INTERPRETED. d03-orbit-southeast (south face) and online-photos ut-nms-401 (north face on Dean
//    Keeton) show tall green-tinted glazed bays with white floor mullions between brick piers, under a pale stone band at the
//    eaves. Placement: 4 bays centred on the stack pairs' symmetry axis x = -44.2 (pairs at x -55.2 / -33.2), bay 5.5 m.
//    Glass width 4.0 m, pier 1.5 m, band 1.4 m and mullion sizes are ESTIMATES.
//  * Not modelled: the roof slot (DSM 30.4 m) under the existing hip cap, the projecting flat roof canopies on Dean Keeton
//    (photo) and ground-storey entrances.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

/** Building frame of the science block (roofs.json axisA / axisC). */
const AX: [number, number] = [0.087503890742, -0.996164177786], CX: [number, number] = [0.996164177786, 0.087503890742];
export const NMS_DETAIL = {
  bays: { axisX: -44.2, count: 4, pitch: 5.5, glass: 4.0 },
  band: { height: 1.4, below: 0.15 },
  /** plant housings: centre, half-lengths along the building C (~x) and A (~-z) axes, measured top (DSM P50), base embedded in the 40.6 cap */
  housings: [
    { name: 'west', c: [-52.2, -345.3] as [number, number], hc: 5.25, ha: 4.5, top: 44.2, bottom: 40.0 },
    { name: 'east', c: [-36.0, -343.8] as [number, number], hc: 5.0, ha: 4.0, top: 44.2, bottom: 40.0 },
  ],
  stacks: [
    { c: [-32.97, -347.09] as [number, number], top: 48.12 }, { c: [-55.47, -341.84] as [number, number], top: 47.93 },
    { c: [-33.47, -340.34] as [number, number], top: 47.92 }, { c: [-55.0, -348.6] as [number, number], top: 48.09 },
  ],
  stackRadius: 0.6, stackBase: 44.0,
};
/** Punched windows of NMS are replaced by the glazed bays on z-facing walls inside the bay run. */
export function inNmsBayRun(x: number, nzAbs: number) {
  const B = NMS_DETAIL.bays, half = B.count * B.pitch / 2;
  return nzAbs > 0.9 && x > B.axisX - half - 0.4 && x < B.axisX + half + 0.4;
}
/** Glass spans (x0, x1) of the bays in campus x. */
export function nmsBaySpans(): [number, number][] {
  const B = NMS_DETAIL.bays, x0 = B.axisX - B.count * B.pitch / 2;
  return Array.from({ length: B.count }, (_v, k) => { const c = x0 + (k + 0.5) * B.pitch; return [c - B.glass / 2, c + B.glass / 2]; });
}

/** Roof plant housings + stacks: one solid mesh (textured metal, metre UVs) and one trimesh collider of the same triangles. */
export function buildNmsRoofPlant(physics: RAPIER.World, metal: THREE.Material) {
  const pos: number[] = [], uv: number[] = [];
  const V = (c: [number, number], u: number, v: number): [number, number] => [c[0] + CX[0] * u + AX[0] * v, c[1] + CX[1] * u + AX[1] * v];
  const tri = (a: number[], b: number[], c: number[], n: THREE.Vector3) => {
    const cr = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).cross(new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]));
    const [p, q, r] = cr.dot(n) >= 0 ? [a, b, c] : [a, c, b];
    for (const w of [p, q, r]) { pos.push(w[0], w[1], w[2]); uv.push(Math.abs(n.y) > 0.5 ? w[0] : (Math.abs(n.x) > Math.abs(n.z) ? w[2] : w[0]), Math.abs(n.y) > 0.5 ? w[2] : w[1]); }
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], n: THREE.Vector3) => { tri(a, b, c, n); tri(a, c, d, n); };
  for (const h of NMS_DETAIL.housings) {
    const k = [V(h.c, -h.hc, -h.ha), V(h.c, h.hc, -h.ha), V(h.c, h.hc, h.ha), V(h.c, -h.hc, h.ha)];
    for (let i = 0; i < 4; i++) {
      const a = k[i], b = k[(i + 1) % 4], mx = (a[0] + b[0]) / 2 - h.c[0], mz = (a[1] + b[1]) / 2 - h.c[1], l = Math.hypot(mx, mz);
      quad([a[0], h.bottom, a[1]], [b[0], h.bottom, b[1]], [b[0], h.top, b[1]], [a[0], h.top, a[1]], new THREE.Vector3(mx / l, 0, mz / l));
    }
    quad([k[0][0], h.top, k[0][1]], [k[1][0], h.top, k[1][1]], [k[2][0], h.top, k[2][1]], [k[3][0], h.top, k[3][1]], new THREE.Vector3(0, 1, 0));
  }
  const seg = 16, R = NMS_DETAIL.stackRadius;
  for (const s of NMS_DETAIL.stacks) {
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2, am = (a0 + a1) / 2;
      const p0 = [s.c[0] + Math.cos(a0) * R, s.c[1] + Math.sin(a0) * R], p1 = [s.c[0] + Math.cos(a1) * R, s.c[1] + Math.sin(a1) * R];
      quad([p0[0], NMS_DETAIL.stackBase, p0[1]], [p1[0], NMS_DETAIL.stackBase, p1[1]], [p1[0], s.top, p1[1]], [p0[0], s.top, p0[1]], new THREE.Vector3(Math.cos(am), 0, Math.sin(am)));
      tri([s.c[0], s.top, s.c[1]], [p0[0], s.top, p0[1]], [p1[0], s.top, p1[1]], new THREE.Vector3(0, 1, 0));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, metal); mesh.name = 'b02 NMS roof plant housings and exhaust stacks (LiDAR)'; mesh.castShadow = mesh.receiveShadow = true; mesh.userData.block = 'b02-sciences';
  const p = g.getAttribute('position').array as Float32Array;
  const collider = physics.createCollider(RAPIER.ColliderDesc.trimesh(p, Uint32Array.from({ length: p.length / 3 }, (_v, i) => i), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.8));
  return { mesh, collider, geometry: g, triangles: p.length / 9 };
}
