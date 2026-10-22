// Block b03 (round 3, D04): painted parking-stall lines on the b03-owned Speedway north asphalt service drive.
//
// Evidence: full-map-30m capture b03-r1-a2-30m (Google Photorealistic 3D Tiles research reference; camera campus
// (9, 34.69, -183) -> (22.5, 17.47, -232.5), vertical FOV 60, 1280x720). Its pixels show white transverse stall
// separators on the WEST half of the drive and a longitudinal stall-end line, from just north of the accepted
// corridor end to about z -290 (north of that the drive is under canopy shadow). Pixels were unprojected onto the
// road (startY 5.62 at the corridor end, +-1 m plane uncertainty):
//  - separators near-perpendicular to the drive axis (within ~4 deg), pitch 3.05 m (z -255.8 / -259.0 / -265.0 with
//    one hidden between) -> 14 lines s 5.9 .. 45.55 m from the corridor end (reference-interpreted, +-0.4 m);
//  - observed stall depth ~5.25 m and aisle ~5.6 m inside an observed paved width ~10.8-11.3 m, while the built drive
//    is the PWP 30 ft (9.144 m) strip. The observed pattern is mapped PROPORTIONALLY onto the built strip: separators
//    from 0.12 m inside the west edge to the stall-end line at offset -0.35 m (fraction 0.465 of the width).
// NOT painted (evidence does not support it on this surface): the red curb paint in the capture lies EAST of the built
// strip on the sidewalk/curb return (outside b03's surface); no white edge line is distinguishable from the gutter;
// no curbs are added (none sourced). Line width 0.10 m (4 in) is an estimate.
// Paint sits 0.008 m above the b03 asphalt triangles it covers (heights interpolated exactly as the strip's own
// lateral nodes and stations), merged in ONE mesh, no collider (the asphalt below carries it, like the walkway drain).
import * as THREE from 'three';
import { HALF_WIDTH, OFFSETS, stationY, type SpeedwayNorthStation } from './speedway-north';

export const STALL_PAINT = {
  lift: 0.008, line: 0.10,
  separators: { s0: 5.9, pitch: 3.05, count: 14, o0: -HALF_WIDTH + 0.12, o1: -0.35 },
  endLine: { o: -0.35 },
  evidence: 'full-map-30m b03-r1-a2-30m (pixels unprojected onto the drive); proportional fit to the 9.144 m built strip',
} as const;

/** Point (x, y, z) on the built strip at arc length s and lateral offset o, lifted by `lift`. */
export function stripPoint(stations: SpeedwayNorthStation[], s: number, o: number, lift: number): THREE.Vector3 {
  let i = 0; while (i < stations.length - 2 && stations[i + 1].s < s) i++;
  const A = stations[i], B = stations[i + 1], t = Math.min(1, Math.max(0, (s - A.s) / (B.s - A.s)));
  const pa = [A.c[0] + A.n[0] * o * A.scale, A.c[1] + A.n[1] * o * A.scale], pb = [B.c[0] + B.n[0] * o * B.scale, B.c[1] + B.n[1] * o * B.scale];
  return new THREE.Vector3(pa[0] + (pb[0] - pa[0]) * t, stationY(A, o) + (stationY(B, o) - stationY(A, o)) * t + lift, pa[1] + (pb[1] - pa[1]) * t);
}

export function buildSpeedwayNorthMarkings(stations: SpeedwayNorthStation[]) {
  const P = STALL_PAINT, pos: number[] = [];
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
    for (const [p, q, r] of [[a, b, c], [a, c, d]]) {
      const up = (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x) < 0; // y of (q-p) x (r-p) > 0 => normal up
      for (const v of up ? [p, q, r] : [p, r, q]) pos.push(v.x, v.y, v.z);
    }
  };
  const at = (s: number, o: number) => stripPoint(stations, s, o, P.lift);
  // Transverse separators: subdivided at every lateral node of the asphalt so the paint follows its facets.
  const S = P.separators, lat = [S.o0, ...OFFSETS.filter(o => o > S.o0 && o < S.o1), S.o1];
  const sep: number[] = [];
  for (let k = 0; k < S.count; k++) {
    const s = S.s0 + k * S.pitch; sep.push(+s.toFixed(2));
    for (let j = 0; j + 1 < lat.length; j++) quad(at(s - P.line / 2, lat[j]), at(s - P.line / 2, lat[j + 1]), at(s + P.line / 2, lat[j + 1]), at(s + P.line / 2, lat[j]));
  }
  // Longitudinal stall-end line between the first and last separators, subdivided at every station.
  const s0 = S.s0 - P.line / 2, s1 = S.s0 + (S.count - 1) * S.pitch + P.line / 2, o = P.endLine.o;
  const along = [s0, ...stations.map(st => st.s).filter(s => s > s0 && s < s1), s1];
  for (let j = 0; j + 1 < along.length; j++) quad(at(along[j], o - P.line / 2), at(along[j + 1], o - P.line / 2), at(along[j + 1], o + P.line / 2), at(along[j], o + P.line / 2));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ name: 'b03 Speedway north white stall paint', color: 0xe4e1d6, roughness: 0.7, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(g, material);
  // Named as part of the drive surface: it is flush paint ON the b03 asphalt (B6 treats it as the surface).
  mesh.name = 'b03 Speedway north surface paint (stall lines, b03-r1-a2-30m)';
  mesh.receiveShadow = true; mesh.userData.block = 'b03-gdc-speedway'; mesh.userData.paint = true;
  return { mesh, geometry: g, material, stats: { separators: sep, endLine: { s0: +s0.toFixed(2), s1: +s1.toFixed(2), o }, triangles: pos.length / 9, lift: P.lift, lineWidth: P.line } };
}
