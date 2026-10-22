import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CutVolume } from './clip-volume';
import { createGdcGlazing, annotateGdcGlazing } from './gdc-glazing';
import { detailMainEastLimestone } from './main-east-materials';

type Options = { groundHeight: (x: number, z: number) => number; stoneTexture: T.Texture; gravelColor: T.Texture; gravelNormal: T.Texture };
/** Gregory's north basement and paired exterior stairs. The upper photographed
 * brick facade stays in the scene. Layout follows L103/L104; heights are fitted
 * to the local scan rather than represented as an architectural survey. */
export function buildGregoryNorth(options: Options) {
  const u = new T.Vector3(62.15, 0, 5.53).normalize(), outward = new T.Vector3(u.z, 0, -u.x);
  // Visible masonry is about 1.0m inside the official footprint in this scan.
  const length = Math.hypot(62.15, 5.53), origin = new T.Vector3(32.82, 0, 181.16).addScaledVector(outward, -1.02);
  const transform = new T.Matrix4().makeBasis(u, new T.Vector3(0, 1, 0), outward).setPosition(origin);
  const point = (x: number, y: number, d: number) => new T.Vector3(x, y, d).applyMatrix4(transform);
  const ground = (x: number, d: number) => { const p = point(x, 0, d); const y = options.groundHeight(p.x, p.z); if (!Number.isFinite(y)) throw Error('Gregory north ground is unavailable'); return y; };
  const materials: T.MeshStandardMaterial[] = [], batches = new Map<T.Material, T.BufferGeometry[]>();
  const material = (name: string, color: number, roughness = .88, metalness = 0) => { const m = new T.MeshStandardMaterial({ color, roughness, metalness }); m.name = `Gregory north ${name}`; materials.push(m); return m; };
  const plaster = material('pale lower masonry', 0xb2b0a4), cap = material('weathered stone caps', 0x929488), joints = material('shadowed joints', 0x827f72), bronze = material('oxidized bronze sash and rails', 0x55453d, .64, .48), dark = material('shaded entry doors', 0x484038), gravel = material('entry ground', 0x8f9082);
  gravel.map = options.gravelColor; gravel.normalMap = options.gravelNormal; gravel.normalScale.set(.30, .30); gravel.color.setHex(0xb5aea0); gravel.roughness = 1;
  detailMainEastLimestone(plaster, options.stoneTexture); detailMainEastLimestone(cap, options.stoneTexture);
  const glass = createGdcGlazing('Gregory north recessed window glass'); glass.roughness = .22; materials.push(glass);
  const put = (g: T.BufferGeometry, m: T.Material) => {
    g.applyMatrix4(transform);
    // This facade basis is left handed; reverse triangle winding after reflection.
    if (g.index) { for (let i = 0; i < g.index.count; i += 3) { const a = g.index.getX(i); g.index.setX(i, g.index.getX(i + 2)); g.index.setX(i + 2, a); } }
    else for (const a of Object.values(g.attributes)) for (let i = 0; i < a.count; i += 3) for (let k = 0; k < a.itemSize; k++) { const l = i * a.itemSize + k, r = (i + 2) * a.itemSize + k, t = a.array[l]; a.array[l] = a.array[r]; a.array[r] = t; }
    if (!batches.has(m)) batches.set(m, []); batches.get(m)!.push(g);
  };
  const box = (x: number, y: number, d: number, w: number, h: number, depth: number, m: T.Material) => {
    if (Math.min(w, h, depth) <= .00001) return;
    const g = new T.BoxGeometry(w, h, depth).translate(x, y, d);
    if (m === glass) annotateGdcGlazing(g, 'x', u, outward, x * 1.37 + y * .7);
    put(g, m);
  };
  const tube = (a: T.Vector3, b: T.Vector3, radius: number, m: T.Material) => {
    const v = b.clone().sub(a), g = new T.CylinderGeometry(radius, radius, v.length(), 8);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), v.normalize())).translate(...a.clone().add(b).multiplyScalar(.5).toArray()); put(g, m);
  };
  const volume = (x0: number, x1: number, d0: number, d1: number, y0: number, y1: number): CutVolume => {
    const p = [[x0, d0], [x1, d0], [x1, d1], [x0, d1]].map(([x, d]) => point(x, 0, d));
    const center = p.reduce((a, b) => a.add(b), new T.Vector3()).multiplyScalar(.25);
    const planes = p.map((a, i) => { const b = p[(i + 1) % 4], plane = new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z - a.z, 0, a.x - b.x).normalize(), a); if (plane.distanceToPoint(center) > 0) plane.negate(); return plane; });
    const bounds = new T.Box3().setFromPoints(p); bounds.min.y = y0; bounds.max.y = y1; return { planes, bounds };
  };
  const front = 9.5, back = -.85, bottom = -3.1, cornice = 3.60, landing = 3.43;
  // One continuous triangulated floor owns the trimmed strip, including the
  // approach around both stair sets. Its edge samples the retained yard floor.
  const floorPositions: number[] = [];
  const nx = Math.ceil((length + 2.2) / .8), nz = Math.ceil((front - back) / .8);
  const grid = Array.from({ length: nx + 1 }, (_, i) => Array.from({ length: nz + 1 }, (_, j) => { const x = -.6 + (length + 2.2) * i / nx, d = back + (front - back) * j / nz; return new T.Vector3(x, ground(x, d), d); }));
  const vertex = (i: number, j: number) => grid[i][j].clone();
  const emit = (...v: T.Vector3[]) => floorPositions.push(...v.flatMap(p => p.toArray()));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { const a = vertex(i, j), b = vertex(i + 1, j), c = vertex(i + 1, j + 1), d = vertex(i, j + 1); emit(a, c, b, a, d, c); }
  for (let i = 0; i < nx; i++) for (const j of [0, nz]) { const a = vertex(i, j), b = vertex(i + 1, j), ab = a.clone().setY(bottom), bb = b.clone().setY(bottom); if (j === 0) emit(a, b, bb, a, bb, ab); else emit(a, bb, b, a, ab, bb); }
  for (let j = 0; j < nz; j++) for (const i of [0, nx]) { const a = vertex(i, j), b = vertex(i, j + 1), ab = a.clone().setY(bottom), bb = b.clone().setY(bottom); if (i === 0) emit(a, bb, b, a, ab, bb); else emit(a, b, bb, a, bb, ab); }
  const p0 = vertex(0, 0).setY(bottom), p1 = vertex(nx, 0).setY(bottom), p2 = vertex(nx, nz).setY(bottom), p3 = vertex(0, nz).setY(bottom); emit(p0, p1, p2, p0, p2, p3);
  const floor = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(floorPositions, 3)); floor.computeVertexNormals();
  // Keep the floor as an explicit batch so collider/ground comparisons can
  // distinguish it from the solid stair and wall geometry.
  const floorUvs = new Float32Array(floor.attributes.position.count * 2); for (let i = 0; i < floor.attributes.position.count; i++) { floorUvs[i * 2] = floor.attributes.position.getX(i); floorUvs[i * 2 + 1] = floor.attributes.position.getZ(i); } floor.setAttribute('uv', new T.BufferAttribute(floorUvs, 2));
  put(floor, gravel);

  // Three source stair clusters (local x about 10, 34 and 54m), corroborated
  // by the adjacent L103/L104 views. Exact doorway registration is approximate.
  const centers = [9.2, 33.2, 54.6];
  const holes = [2.6, 17.6, 22.5, 27.4, 39.0, 43.9, 48.8, length - 2.6].map(x => ({ x, w: x < 4 || x > length - 4 ? 2.6 : 3.65, low: .48, high: 2.98 }));
  const sorted = holes.slice().sort((a, b) => a.x - b.x);
  let cursor = 0;
  for (const h of sorted) { box((cursor + h.x - h.w / 2) / 2, (bottom + cornice) / 2, -.40, h.x - h.w / 2 - cursor, cornice - bottom, .8, plaster); cursor = h.x + h.w / 2; }
  box((cursor + length) / 2, (bottom + cornice) / 2, -.40, length - cursor, cornice - bottom, .8, plaster);
  for (const h of sorted) {
    box(h.x, (bottom + h.low) / 2, -.40, h.w, h.low - bottom, .8, plaster); box(h.x, (h.high + cornice) / 2, -.40, h.w, cornice - h.high, .8, plaster);
    box(h.x, (h.low + h.high) / 2, -.30, h.w, h.high - h.low, .09, glass);
    for (const sign of [-1, 1]) box(h.x + sign * (h.w / 2 - .035), (h.low + h.high) / 2, -.12, .07, h.high - h.low, .33, cap);
    box(h.x, h.low - .04, -.035, h.w + .18, .08, .42, cap);
    for (let i = 0; i <= 7; i++) box(h.x - h.w / 2 + h.w * i / 7, (h.low + h.high) / 2, -.22, .025, h.high - h.low, .06, bronze);
    for (let j = 0; j <= 6; j++) box(h.x, h.low + (h.high - h.low) * j / 6, -.22, h.w, .032, .06, bronze);
  }
  for (const [y, h, depth] of [[3.20, .10, 1.00], [3.34, .17, 1.16], [3.49, .13, 1.00], [3.575, .04, .88]]) box(length / 2, y, -.21, length, h, depth, plaster);
  // Fine horizontal coursing on the white basement, without a heavy brick grid.
  for (let y = .12; y < 3.15; y += .32) { let x0 = 0; for (const h of sorted) { if (y > h.low && y < h.high) { box((x0 + h.x - h.w / 2) / 2, y, .006, h.x - h.w / 2 - x0, .008, .009, joints); x0 = h.x + h.w / 2; } } box((x0 + length) / 2, y, .006, length - x0, .008, .009, joints); }
  const stairRoutes: { label: string; positions: number[][] }[] = [];
  const sourceVolumes = [volume(-.60, length + 1.60, back, front, bottom, 3.61),
    // Only empty exterior space: preserve the brick plane and both corner returns.
    volume(2, length - 2, 1.4, front, 3.61, 16.8)];
  const groundVolumes = [volume(-.60, length + 1.60, back, front, bottom, 3.61)];
  for (const center of centers) {
    const half = 2.10, depth = 3.75, width = 2.45, flight = 6.0;
    // Raised landing and two climbing flights; concrete thickness closes the
    // underside, and small arches in the front screen leave a visible recess.
    box(center, landing - .17, depth / 2 - .12, half * 2, .34, depth + .24, cap);
    box(center, (bottom + landing - .34) / 2, -.6, half * 2, landing - .34 - bottom, .42, plaster);
    box(center, 1.27, .15, 2.20, 2.54, .14, dark);
    for (const x of [-.53, .53]) box(center + x, 1.30, .24, .045, .5, .05, bronze);
    // Five round arches beneath the landing, built as solid wall segments.
    const archRadius = .34, spring = 1.66, screen = depth - .20;
    for (let k = 0; k < 6; k++) box(center - 1.9 + k * .76, (bottom + spring) / 2, screen, .16, spring - bottom, .34, plaster);
    for (let k = 0; k < 5; k++) {
      const cx = center - 1.52 + k * .76;
      const shape = new T.Shape(); shape.moveTo(cx - .42, landing + .78); shape.lineTo(cx + .42, landing + .78); shape.lineTo(cx + .42, spring); shape.lineTo(cx + archRadius, spring);
      shape.absarc(cx, spring, archRadius, 0, Math.PI, false); shape.lineTo(cx - .42, spring); shape.closePath();
      put(new T.ExtrudeGeometry(shape, { depth: .34, bevelEnabled: false, curveSegments: 14 }).translate(0, 0, screen - .17), plaster);
    }
    box(center, landing + .835, screen, half * 2 + .12, .11, .43, cap);
    // The scan folds outward across each actual upper landing. Replace only
    // the doorway aperture and reveals so a person can approach its closed leaf.
    box(center, landing + 1.37, -.37, 2.72, 2.74, .12, dark);
    for (const side of [-1, 1]) {
      box(center + side * .69, landing + 1.55, -.28, 1.17, 1.97, .035, glass);
      box(center + side * 1.47, landing + 1.40, -.24, .24, 2.80, 1.02, cap);
      box(center + side * .14, landing + 1.16, -.14, .025, .37, .06, bronze);
    }
    for (const dx of [-1.32, 0, 1.32]) box(center + dx, landing + 1.38, -.17, .065, 2.76, .09, bronze);
    box(center, landing + .53, -.17, 2.72, .085, .09, bronze);
    box(center, landing + 2.86, -.24, 3.18, .30, 1.04, cap);
    sourceVolumes.push(volume(center - 1.56, center + 1.56, -.84, 1.65, landing - .02, landing + 2.96));

    // Solid side parapets start at existing ground and follow the stair slope.
    for (const sign of [-1, 1]) {
      const lowX = center + sign * (half + flight), highX = center + sign * half, d = depth - width / 2 - .18;
      const lowY = ground(lowX, d), risers = Math.ceil((landing - lowY) / .18), rise = (landing - lowY) / risers;
      for (let i = 0; i < risers; i++) { const x = lowX + (highX - lowX) * (i + .5) / risers, top = lowY + rise * (i + 1); box(x, (bottom + top) / 2, d, flight / risers + .001, top - bottom, width, cap); }
      for (const edge of [d - width / 2 - .13, d + width / 2 + .13]) {
        const shape = new T.Shape(); shape.moveTo(lowX, bottom); shape.lineTo(highX, bottom); shape.lineTo(highX, landing + .80); shape.lineTo(lowX, lowY + .72); shape.closePath();
        put(new T.ExtrudeGeometry(shape, { depth: .23, bevelEnabled: false }).translate(0, 0, edge - .115), plaster);
        const a = new T.Vector3(lowX, lowY + .76, edge), b = new T.Vector3(highX, landing + .84, edge), v = b.clone().sub(a), capStrip = new T.BoxGeometry(v.length(), .11, .34);
        capStrip.rotateZ(Math.atan2(v.y, v.x)).translate(...a.clone().add(b).multiplyScalar(.5).toArray()); put(capStrip, cap);
        tube(new T.Vector3(lowX, lowY + .96, edge - .07), new T.Vector3(highX, landing + 1.02, edge - .07), .022, bronze);
      }
      stairRoutes.push({ label: `${center < 20 ? 'west' : center < 45 ? 'middle' : 'east'}-${sign < 0 ? 'west' : 'east'}-flight`, positions: [point(lowX + sign * .8, lowY, d).toArray(), point(highX - sign * .5, landing, d).toArray(), point(center, landing, .65).toArray()] });
      sourceVolumes.push(volume(Math.min(lowX, highX) - .4, Math.max(lowX, highX) + .4, .7, depth + .3, bottom, landing + 1.1));
    }
  }
  // Short returns close the lower wall against the retained side scan.
  for (const x of [.06, length - .06]) box(x, (bottom + cornice) / 2, -1.1, .12, cornice - bottom, 2.2, plaster);
  const meshes: T.Mesh[] = [];
  for (const [m, pieces] of batches) {
    const flat = pieces.map(g => g.index ? g.toNonIndexed() : g), g = mergeGeometries(flat);
    if (!g) throw Error('Gregory north geometry merge failed'); g.computeBoundingBox(); g.computeBoundingSphere();
    const mesh = new T.Mesh(g, m); mesh.name = `GRE north: ${m.name}`; mesh.castShadow = m !== gravel; mesh.receiveShadow = true; meshes.push(mesh);
    for (const p of new Set([...pieces, ...flat])) p.dispose();
  }
  return { meshes, materials, colliderGeometries: meshes.map(m => m.geometry), volumes: sourceVolumes, groundVolumes, stairRoutes,
    stats: { building: 'GRE', scope: 'North lower masonry, paired entry stairs and connecting ground; upper brick scan retained', length, cornice, landing, stairFlights: stairRoutes.length, stairRoutes, windows: holes.length, materials: materials.length, triangles: meshes.reduce((s, m) => s + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0), sourceCuts: sourceVolumes.length, approximateDimensions: true, sourcePhotos: ['L103-h180', 'L104-h180', 'L104-detail-180'] } };
}
