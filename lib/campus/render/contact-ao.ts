import * as THREE from 'three';

/** Cheap baked contact darkening with no post-processing: a soft dark band on
 * the ground along building footprints and a soft disc under tree trunks.
 * One merged mesh, one draw call, unlit (black with per-vertex alpha), no
 * depth writes, no raycast/physics participation. Opt-in (`?contactao=on`)
 * until Codex confirms it hugs the real ground without floating or z-fighting.
 *
 * Ground heights come from the caller (use a physics/visible-ground ray so the
 * band follows paving, not only the terrain grid). Quads whose two edges
 * disagree by more than `maxStep` (stairs, walls, terraces) are dropped.
 */
export interface ContactAoOptions {
  footprints: { rings: number[][][]; h?: number }[];
  trees?: { x: number; z: number; radius: number }[];
  groundAt: (x: number, z: number) => number | null;
  /** Band width (m) and opacity at the wall. */
  width?: number;
  strength?: number;
  treeStrength?: number;
  spacing?: number;
  lift?: number;
  maxStep?: number;
  /** Only footprints whose centroid lies within this box [west, north, east, south]. */
  bounds?: [number, number, number, number];
}

export function buildContactAo(o: ContactAoOptions) {
  const width = o.width ?? 2.4, strength = o.strength ?? .32, spacing = o.spacing ?? 2.5;
  const lift = o.lift ?? .035, maxStep = o.maxStep ?? .45, treeStrength = o.treeStrength ?? .22;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  let dropped = 0, quads = 0, discs = 0;
  const vertex = (x: number, y: number, z: number, a: number) => { pos.push(x, y + lift, z); col.push(0, 0, 0, a); return pos.length / 3 - 1; };
  for (const fp of o.footprints) {
    const ring = fp.rings[0];
    if (!ring || ring.length < 4) continue;
    if (o.bounds) {
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      const [w, n, e, s] = o.bounds;
      if (cx < w || cx > e || cz < n || cz > s) continue;
    }
    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    // Outward normal: rotate the edge direction away from the interior.
    const sign = area > 0 ? -1 : 1;
    for (let i = 0; i < ring.length - 1; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < .3) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len, nx = -uz * sign, nz = ux * sign;
      const steps = Math.max(1, Math.ceil(len / spacing));
      let prev: [number, number] | null = null;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const xi = x + nx * .06, zi = z + nz * .06, xo = x + nx * width, zo = z + nz * width;
        const yi = o.groundAt(xi, zi), yo = o.groundAt(xo, zo);
        if (yi === null || yo === null || !Number.isFinite(yi) || !Number.isFinite(yo) || Math.abs(yi - yo) > maxStep) { prev = null; dropped++; continue; }
        const pair: [number, number] = [vertex(xi, yi, zi, strength), vertex(xo, yo, zo, 0)];
        if (prev) { idx.push(prev[0], prev[1], pair[1], prev[0], pair[1], pair[0]); quads++; }
        prev = pair;
      }
    }
  }
  for (const tree of o.trees ?? []) {
    const y = o.groundAt(tree.x, tree.z);
    if (y === null || !Number.isFinite(y)) continue;
    const r = Math.max(.6, tree.radius), centre = vertex(tree.x, y, tree.z, treeStrength), ring: number[] = [];
    let ok = true;
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2, x = tree.x + Math.cos(a) * r, z = tree.z + Math.sin(a) * r, yy = o.groundAt(x, z);
      if (yy === null || Math.abs(yy - y) > maxStep) { ok = false; break; }
      ring.push(vertex(x, yy, z, 0));
    }
    if (!ok) continue;
    for (let k = 0; k < 12; k++) idx.push(centre, ring[(k + 1) % 12], ring[k]);
    discs++;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geometry.setIndex(idx);
  geometry.computeBoundingSphere();
  const material = new THREE.MeshBasicMaterial({
    name: 'Campus contact darkening', color: 0xffffff, vertexColors: true, transparent: true,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    toneMapped: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Campus contact darkening (render only)';
  mesh.renderOrder = 1;
  mesh.castShadow = false; mesh.receiveShadow = false;
  // Never a camera, travel or ground-query hit.
  mesh.raycast = () => {};
  mesh.userData.renderOnly = true;
  return {
    mesh,
    stats: { quads, discs, dropped, triangles: idx.length / 3, vertices: pos.length / 3 },
    dispose() { geometry.dispose(); material.dispose(); mesh.removeFromParent(); },
  };
}
