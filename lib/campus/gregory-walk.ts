import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import plan from './gregory-walk-plan.json' with { type: 'json' };
import type { CutVolume } from './clip-volume';
import type { TreePlacement } from './foreground-trees';

type Options = {
  groundHeight: (x: number, z: number) => number;
  westHeight: (z: number) => number;
  concrete: T.Material;
  brickColor: T.Texture;
  brickNormal: T.Texture;
  gravelColor: T.Texture;
  gravelNormal: T.Texture;
};
const local = (x: number, d: number) => [x, 166 + .09 * x + d] as const;
const inside = (x: number, z: number, ring: number[][]) => {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
};

/** Replace the damaged outdoor scan only. Baked XZ bounds reserve Gregory's
 * frontage/stairs and WCP's walls. All visible solid parts own matching colliders.
 * Maps and concrete are borrowed; the caller owns returned materials/geometries. */
export function buildGregoryWalk(options: Options) {
  const meshes: T.Mesh[] = [], colliderGeometries: T.BufferGeometry[] = [];
  const brick = new T.MeshStandardMaterial({ map: options.brickColor, normalMap: options.brickNormal, normalScale: new T.Vector2(.32, .32), color: 0xd6c2b0, roughness: .94 });
  brick.name = 'Gregory north walk red brick';
  const soil = new T.MeshStandardMaterial({ map: options.gravelColor, normalMap: options.gravelNormal, normalScale: new T.Vector2(.3, .3), color: 0x8b8878, roughness: 1 });
  soil.name = 'Gregory north walk gravel beds';
  const wood = new T.MeshStandardMaterial({ color: 0x777367, roughness: .91 });
  wood.name = 'Gregory court weathered timber';
  const metal = new T.MeshStandardMaterial({ color: 0x9ba19e, roughness: .42, metalness: .65 });
  metal.name = 'Gregory court silver furniture';
  const materials = [brick, soil, wood, metal];
  const floorHeight = (x: number, z: number) => {
    const h = options.groundHeight(x, z);
    // Meet Speedway at its existing elevation; transition over ten metres.
    const westWeight = (1 - T.MathUtils.smoothstep(x, 0, 10)) * T.MathUtils.smoothstep(z - 166 - .09 * x, -17, -10);
    return T.MathUtils.lerp(h, options.westHeight(z), westWeight);
  };
  const vertices = plan.vertices.map(([x, z], i) => new T.Vector3(x, floorHeight(x, z) + plan.underlayOffsets[i], z));
  const faces = Object.values(plan.triangles).flat();
  const normals = vertices.map(() => new T.Vector3());
  const edges = new Map<string, { a: number; b: number; count: number }>();
  for (const face of faces) {
    const [a, b, c] = face.map(i => vertices[i]);
    const n = new T.Vector3().subVectors(b, a).cross(new T.Vector3().subVectors(c, a));
    for (const i of face) normals[i].add(n);
    for (let i = 0; i < 3; i++) {
      const a = face[i], b = face[(i + 1) % 3], key = [a, b].sort((x, y) => x - y).join(':');
      const edge = edges.get(key);
      if (edge) edge.count++; else edges.set(key, { a, b, count: 1 });
    }
  }
  normals.forEach(n => n.normalize());
  const addMesh = (geometry: T.BufferGeometry, material: T.Material, name: string, castShadow = true) => {
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new T.Mesh(geometry, material); mesh.name = name;
    mesh.receiveShadow = true; mesh.castShadow = castShadow;
    meshes.push(mesh); colliderGeometries.push(geometry);
  };
  for (const kind of ['brick', 'concrete', 'soil'] as const) {
    const points: number[] = [], uv: number[] = [];
    const push = (p: T.Vector3) => { points.push(p.x, p.y, p.z); uv.push(p.x / (kind === 'brick' ? 1 : 2), (p.z - .09 * p.x) / (kind === 'brick' ? 1 : 2)); };
    for (const face of plan.triangles[kind]) for (const i of face) push(vertices[i]);
    if (kind === 'soil') {
      for (const face of faces) for (const i of [...face].reverse()) push(vertices[i].clone().setY(plan.bottom));
      for (const { a, b, count } of edges.values()) if (count === 1) {
        const p = vertices[a], q = vertices[b], pb = p.clone().setY(plan.bottom), qb = q.clone().setY(plan.bottom);
        for (const v of [p, pb, qb, p, qb, q]) push(v);
      }
    }
    const geometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(points, 3)).setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    geometry.computeVertexNormals(); let i = 0;
    for (const face of plan.triangles[kind]) for (const id of face) { const n = normals[id]; geometry.attributes.normal.setXYZ(i++, n.x, n.y, n.z); }
    addMesh(geometry, kind === 'brick' ? brick : kind === 'soil' ? soil : options.concrete, `Gregory north walk ${kind}`, false);
  }
  const contains = (x: number, z: number) => inside(x, z, plan.rings[0]) && !plan.rings.slice(1).some(r => inside(x, z, r));
  // Sample the actual triangulated floor, including at tree roots and props.
  const height = (x: number, z: number): number | null => {
    for (const face of faces) {
      const [a, b, c] = face.map(i => vertices[i]);
      const den = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(den) < 1e-10) continue;
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / den;
      const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / den;
      if (Math.min(u, v, 1 - u - v) >= -1e-7) return u * a.y + v * b.y + (1 - u - v) * c.y;
    }
    return null;
  };
  const batches = new Map<T.Material, T.BufferGeometry[]>();
  const part = (g: T.BufferGeometry, m: T.Material) => { if (!batches.has(m)) batches.set(m, []); batches.get(m)!.push(g); };
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, m: T.Material) => part(new T.BoxGeometry(w, h, d).translate(x, y, z), m);
  const cylinder = (x: number, y: number, z: number, radius: number, h: number, m: T.Material, count = 16) => part(new T.CylinderGeometry(radius, radius, h, count).translate(x, y, z), m);
  // Low timber terrace, inferred from the L102 reference. Keep the brick route clear.
  const [deckX, deckZ] = local(11, -10), deckY = Math.max(...[[-5, -3], [5, -3], [-5, 3], [5, 3]].map(([x, z]) => height(deckX + x, deckZ + z) ?? 0)) + .18;
  const deckBottom = Math.min(...[[-5, -3], [5, -3], [-5, 3], [5, 3]].map(([x, z]) => height(deckX + x, deckZ + z) ?? 0)) - .12;
  box(deckX, (deckY - .1 + deckBottom) / 2, deckZ, 10, deckY - .1 - deckBottom, 6, wood);
  for (let i = 0; i < 40; i++) box(deckX - 4.875 + i * .25, deckY - .06, deckZ, .242, .12, 6, wood);
  for (const z of [-2.85, 2.85]) box(deckX, deckY - .2, deckZ + z, 10, .22, .12, metal);
  const bench = (x: number, d: number, y?: number) => {
    const [px, pz] = local(x, d), base = y ?? height(px, pz);
    if (base === null) return;
    for (const sx of [-.82, .82]) {
      box(px + sx, base + .26, pz, .055, .52, .5, metal);
      box(px + sx, base + .65, pz + .23, .055, .76, .055, metal);
    }
    for (let i = 0; i < 5; i++) box(px, base + .48, pz - .22 + i * .11, 1.9, .045, .085, wood);
    for (let i = 0; i < 4; i++) box(px, base + .68 + i * .095, pz + .23, 1.9, .065, .04, wood);
  };
  bench(8, -11.5, deckY); bench(14, -11.5, deckY);
  for (const x of [8, 14]) { const [px, pz] = local(x, -9); cylinder(px, deckY + .37, pz, .06, .74, metal); cylinder(px, deckY + .75, pz, .62, .055, metal, 28); }
  for (const x of [45, 57, 71]) bench(x, 4.3);
  const [planterX, planterZ] = local(34, -8.1), planterY = height(planterX, planterZ)!;
  cylinder(planterX, planterY + .21, planterZ, 3.45, .5, options.concrete, 48);
  cylinder(planterX, planterY + .465, planterZ, 3.26, .025, soil, 48);
  for (const [x, d] of [[8, -3.9], [39, 4], [66, 4]]) {
    const [px, pz] = local(x, d), y = height(px, pz)!;
    cylinder(px, y + .10, pz, .18, .2, metal); cylinder(px, y + 2.1, pz, .055, 4.2, metal);
    cylinder(px, y + 4.24, pz, .4, .075, metal, 24);
  }
  for (const [material, pieces] of batches) {
    const geometry = mergeGeometries(pieces); pieces.forEach(p => p.dispose());
    if (!geometry) throw Error('Gregory furniture geometry is unavailable');
    addMesh(geometry, material, `Gregory north court ${material.name}`);
  }
  const makeVolumes = (triangles: number[][][], minimumY: number): CutVolume[] => triangles.map(tri => {
    const points = tri.map(([x, z]) => new T.Vector3(x, 0, z));
    const center = points.reduce((s, v) => s.add(v), new T.Vector3()).multiplyScalar(1 / 3);
    const planes = points.map((a, i) => { const b = points[(i + 1) % 3], plane = new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z - a.z, 0, a.x - b.x).normalize(), a); if (plane.distanceToPoint(center) > 0) plane.negate(); return plane; });
    const bounds = new T.Box3().setFromPoints(points); bounds.min.y = minimumY; bounds.max.y = plan.sourceMaxY;
    return { planes, bounds };
  });
  const groundVolumes = makeVolumes(plan.cutTriangles, plan.bottom - .03);
  const volumes = [...groundVolumes, ...makeVolumes(plan.upperCanopyTriangles, 5)];
  const trees: TreePlacement[] = plan.trees.map(p => ({ ...p, y: height(p.x, p.z)! + .017011718824505806 * 2.5 * p.scale * p.height - .03 }));
  return { meshes, colliderGeometries, materials, volumes, groundVolumes, contains, height, trees, treeRelocation: plan.treeRelocation, stats: { ...plan.stats, sourceCuts: volumes.length, upperCanopyMinY: 5, materialBatches: meshes.length, finalTriangles: colliderGeometries.reduce((n, g) => n + (g.index?.count ?? g.attributes.position.count) / 3, 0) } };
}
