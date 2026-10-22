import * as THREE from 'three';
import type { CampusWorld } from './world';
import type { Building } from './types';

// Meter dimensions anchored to UT's published Tower measurements. Decorative
// proportions are inferred from reference photos, not a surveyed CAD model.
export function buildTower(w: CampusWorld) {
  const [x, z] = w.data.landmarks.MAI.position;
  const y = w.terrain.height(x, z),
    rotation = 0.085;
  const box = (
    u: number,
    v: number,
    t: number,
    a: number,
    b: number,
    c: number,
    m: THREE.Material,
    collision = false,
  ) =>
    w.box(
      x + u * Math.cos(rotation) + t * Math.sin(rotation),
      y + v,
      z - u * Math.sin(rotation) + t * Math.cos(rotation),
      a,
      b,
      c,
      m,
      collision,
      rotation,
    );
  box(0, 43.3, 0, 17.98, 56.6, 17.98, w.mat.stone, true);
  for (const [level, width, h] of [
    [70.9, 18.5, 0.45],
    [71.45, 19.25, 0.55],
    [72.05, 19.65, 0.4],
    [73.3, 18.9, 0.3],
  ])
    box(0, level, 0, width, h, width, w.mat.trim);
  box(0, 76.0, 0, 15.7, 7.4, 15.7, w.mat.stone, true);
  box(0, 79.7, 0, 16.5, 0.45, 16.5, w.mat.trim);
  box(0, 85.7, 0, 6.5, 11.6, 6.5, w.mat.recess, true);
  for (const u of [-5.95, 5.95])
    for (const t of [-5.95, 5.95])
      box(u, 85.9, t, 1.25, 11.4, 1.25, w.mat.stone, true);
  for (const [level, width, h, m] of [
    [80.4, 13.6, 0.6, w.mat.trim],
    [91.3, 13.6, 0.7, w.mat.stone],
    [91.9, 14.5, 0.5, w.mat.trim],
    [92.45, 13.2, 0.6, w.mat.stone],
    [92.94, 12.2, 0.38, w.mat.copper],
    [93.38, 10.9, 0.3872, w.mat.copper],
  ] as const)
    box(0, level, 0, width, h, width, m);

  for (let side = 0; side < 4; side++) {
    const angle = rotation + (side * Math.PI) / 2;
    const faceBox = (
      u: number,
      v: number,
      radius: number,
      a: number,
      b: number,
      d: number,
      m: THREE.Material,
    ) =>
      w.box(
        x + Math.cos(angle) * u + Math.sin(angle) * radius,
        y + v,
        z - Math.sin(angle) * u + Math.cos(angle) * radius,
        a,
        b,
        d,
        m,
        false,
        angle,
      );
    const faceGeometry = (
      g: THREE.BufferGeometry,
      u: number,
      v: number,
      radius: number,
      m: THREE.Material,
    ) => {
      g.translate(u, v, radius);
      g.rotateY(angle);
      g.translate(x, y, z);
      w.batch(g, m);
    };
    for (let col = -1; col <= 1; col++) {
      faceBox(col * 3.45, 43.95, 9.015, 1.6, 52.6, 0.08, w.mat.bronzePanel);
      for (let f = 0; f < 18; f++) {
        const level = 18.6 + f * 2.83;
        faceBox(col * 3.45, level, 9.075, 1.18, 1.87, 0.07, w.mat.glass);
        faceBox(col * 3.45, level, 9.14, 0.045, 1.9, 0.07, w.mat.clockGold);
        faceBox(
          col * 3.45,
          level - 0.2,
          9.14,
          1.2,
          0.05,
          0.07,
          w.mat.clockGold,
        );
        faceBox(col * 3.45, level - 1.18, 9.12, 1.52, 0.4, 0.12, w.mat.trim);
      }
    }
    // Balustrade, carved-looking panels and corner finials below the clock.
    for (let k = -8; k <= 8; k++)
      faceBox(k * 1.06, 72.65, 9.35, 0.12, 0.85, 0.18, w.mat.trim);
    for (const u of [-7, 7]) {
      faceBox(u, 80.05, 7.9, 1.4, 0.65, 1.4, w.mat.trim);
      const finial = new THREE.ConeGeometry(0.57, 1.15, 4);
      faceGeometry(finial, u, 80.95, 7.9, w.mat.copper);
    }
    // Four genuinely open belfry faces, with thin piers in front of a recessed core.
    for (const u of [-1.98, 1.98])
      faceBox(u, 86, 5.96, 0.74, 10.7, 0.85, w.mat.stone);
    faceBox(0, 81.1, 6, 11.4, 0.4, 0.95, w.mat.trim);
    faceBox(0, 90.85, 6, 11.5, 0.4, 0.95, w.mat.trim);
    // Clock face is geometry; photographs are references and are not baked textures.
    faceGeometry(
      new THREE.CircleGeometry(2.03, 64),
      0,
      77.0,
      7.9,
      w.mat.clockFace,
    );
    faceGeometry(
      new THREE.TorusGeometry(2.07, 0.13, 8, 64),
      0,
      77,
      8.02,
      w.mat.clockGold,
    );
    faceGeometry(
      new THREE.TorusGeometry(2.29, 0.15, 8, 64),
      0,
      77,
      7.98,
      w.mat.trim,
    );
    for (let hour = 0; hour < 12; hour++) {
      const a = (hour * Math.PI) / 6;
      const tick = new THREE.BoxGeometry(0.13, 0.37, 0.05);
      tick.rotateZ(-a);
      faceGeometry(
        tick,
        Math.sin(a) * 1.68,
        77 + Math.cos(a) * 1.68,
        8.05,
        w.mat.clockGold,
      );
    }
    for (const [a, length] of [
      [-Math.PI / 3, 1.13],
      [Math.PI / 3, 1.55],
    ]) {
      const hand = new THREE.BoxGeometry(0.12, length, 0.075);
      hand.translate(0, length / 2 - 0.12, 0);
      hand.rotateZ(-a);
      faceGeometry(hand, 0, 77, 8.13, w.mat.clockGold);
    }
    faceGeometry(
      new THREE.CircleGeometry(0.16, 16),
      0,
      77,
      8.19,
      w.mat.clockGold,
    );
  }
}

export function landmarkFacade(w: CampusWorld, b: Building, high: number) {
  if (!['PCL', 'MAI'].includes(b.abbr || '')) return false;
  const ring = b.rings[0];
  let area = 0;
  for (let i = 1; i < ring.length; i++)
    area += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
  const sign = area > 0 ? 1 : -1;
  for (let i = 1; i < ring.length; i++) {
    const [ax, az] = ring[i - 1],
      [bx, bz] = ring[i];
    const dx = bx - ax,
      dz = bz - az,
      len = Math.hypot(dx, dz);
    if (len < 5) continue;
    const nx = (dz / len) * sign,
      nz = (-dx / len) * sign,
      angle = Math.atan2(-dz, dx);
    const place = (
      u: number,
      v: number,
      out: number,
      width: number,
      height: number,
      depth: number,
      mat: THREE.Material,
    ) =>
      w.box(
        ax + (dx / len) * u + nx * out,
        high + v,
        az + (dz / len) * u + nz * out,
        width,
        height,
        depth,
        mat,
        false,
        angle,
      );
    if (b.abbr === 'PCL') {
      // Grouped, narrow slots and wide blank end walls are PCL's visible rhythm.
      // Six public levels; level 1 is below the level-2 entrance plaza. Heights
      // and bay counts remain photograph-based estimates pending elevation data.
      if (len < 14) continue;
      const margin = Math.min(10, Math.max(3.5, len * 0.16));
      const count = Math.max(2, Math.floor((len - 2 * margin) / 2.55));
      for (let c = 0; c < count; c++)
        for (let f = 0; f < 5; f++) {
          const u = margin + ((c + 0.5) * (len - margin * 2)) / count,
            v = 2.8 + f * 4.35;
          place(u, v, 0.06, 1.44, 3.25, 0.1, w.mat.recess);
          place(u, v, 0.13, 0.8, 2.9, 0.08, w.mat.glass);
          place(u - 0.8, v, 0.3, 0.24, 3.48, 0.6, w.mat.pclConcrete);
          place(u + 0.8, v, 0.3, 0.24, 3.48, 0.6, w.mat.pclConcrete);
          place(u, v - 1.7, 0.32, 1.82, 0.22, 0.64, w.mat.pclConcrete);
        }
      place(len / 2, 25.7, 0.14, len, 0.25, 0.35, w.mat.pclConcrete);
      continue;
    }
    const bays = Math.floor(len / 4.8);
    for (let c = 0; c < bays; c++) {
      const u = ((c + 0.5) * len) / bays;
      // Ground-level arches are recessed façade details; interiors remain closed.
      const arch = new THREE.Shape();
      arch.moveTo(-1.12, 0);
      arch.lineTo(1.12, 0);
      arch.lineTo(1.12, 3.7);
      arch.absarc(0, 3.7, 1.12, 0, Math.PI, false);
      arch.lineTo(-1.12, 0);
      const g = new THREE.ShapeGeometry(arch, 12);
      // Shape's front must face the polygon exterior for either ring orientation.
      g.rotateY(sign > 0 ? Math.PI : 0);
      g.rotateY(angle);
      g.translate(
        ax + (dx / len) * u + nx * 0.065,
        high + 0.5,
        az + (dz / len) * u + nz * 0.065,
      );
      w.batch(g, w.mat.recess);
      for (let k = 0; k < 9; k++) {
        const t = ((k + 0.5) * Math.PI) / 9;
        place(
          u + Math.cos(t) * 1.31,
          4.2 + Math.sin(t) * 1.31,
          0.16,
          0.4,
          0.38,
          0.32,
          w.mat.trim,
        );
      }
      place(u - 1.3, 2.4, 0.13, 0.28, 3.8, 0.3, w.mat.trim);
      place(u + 1.3, 2.4, 0.13, 0.28, 3.8, 0.3, w.mat.trim);
      for (const v of [8.0, 11.7]) {
        place(u, v, 0.07, 1.55, 2.45, 0.12, w.mat.recess);
        place(u, v, 0.13, 1.2, 2.18, 0.12, w.mat.glass);
        place(u, v, 0.21, 0.08, 2.2, 0.1, w.mat.trim);
        place(u, v - 1.3, 0.22, 1.85, 0.22, 0.48, w.mat.trim);
      }
    }
    for (const [v, out, h, depth] of [
      [6.1, 0.08, 0.35, 0.25],
      [14.2, 0.17, 0.3, 0.55],
      [14.65, 0.3, 0.3, 0.8],
    ])
      place(len / 2, v, out, len + 0.1, h, depth, w.mat.trim);
  }
  return true;
}
