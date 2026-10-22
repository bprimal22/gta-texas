import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import plan from "./pob-south-plan.json" with { type: "json" };

export type PobSouthVolume = { planes: T.Plane[]; bounds: T.Box3 };
export type PobSouthMaterials = {
  /** Borrowed from the existing POB frontage; caller retains ownership. */
  stone: T.MeshStandardMaterial;
  glass: T.MeshStandardMaterial;
  metal: T.MeshStandardMaterial;
};

/** Closed, photo-informed south wall of UT437's southwest wing. The central
 * projection and low POB–GDC connector remain retained source. No old asset,
 * material, collider or cut is mutated. Dimensions are qualified in the plan. */
export function buildPobSouth(materials: PobSouthMaterials) {
  const origin = new T.Vector3(plan.a[0], 0, plan.a[1]);
  const along = new T.Vector3(plan.b[0] - plan.a[0], 0, plan.b[1] - plan.a[1]);
  const length = along.length();
  along.divideScalar(length);
  const out = new T.Vector3(-along.z, 0, along.x);
  const basis = new T.Matrix4().makeBasis(along, new T.Vector3(0, 1, 0), out).setPosition(origin);
  const point = (s: number, y: number, d: number) =>
    origin.clone().addScaledVector(along, s).addScaledVector(out, d).setY(y);
  const local = (x: number, z: number) => {
    const q = new T.Vector3(x, 0, z).sub(origin);
    return { s: q.dot(along), d: q.dot(out) };
  };
  const floorY = (s: number) => {
    const clamped = T.MathUtils.clamp(s, 0, length);
    for (let i = 0; i < plan.floor.length - 1; i++) {
      const [a, b] = [plan.floor[i], plan.floor[i + 1]];
      if (clamped <= b[0] + 1e-7)
        return T.MathUtils.lerp(a[1], b[1], (clamped - a[0]) / (b[0] - a[0]));
    }
    return plan.floor.at(-1)![1];
  };
  const mats = [materials.stone, materials.glass, materials.metal];
  const batches: T.BufferGeometry[][] = mats.map(() => []);
  const box = (s: number, y: number, d: number, w: number, h: number, depth: number, material = 0) => {
    if (Math.min(w, h, depth) <= 1e-7) return;
    const g = new T.BoxGeometry(w, h, depth);
    g.translate(s, y, d);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) g.attributes.uv.setXY(i, p.getX(i), p.getY(i));
    g.applyMatrix4(basis);
    batches[material].push(g);
  };
  // A graded, fully capped prism under every cut column. Geometry and physics
  // share this exact prism; the source cut never substitutes for a floor.
  const slab = (a: number, b: number) => {
    const ya = floorY(a), yb = floorY(b), h = plan.floorThickness;
    const vertices = [
      [a, ya, plan.back], [b, yb, plan.back], [b, yb, plan.front], [a, ya, plan.front],
      [a, ya - h, plan.back], [b, yb - h, plan.back], [b, yb - h, plan.front], [a, ya - h, plan.front],
    ];
    const indices = [0, 3, 2, 0, 2, 1, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(indices.flatMap(i => vertices[i]), 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(indices.flatMap(i => [vertices[i][0], vertices[i][2]]), 2));
    g.computeVertexNormals();
    g.applyMatrix4(basis);
    batches[0].push(g);
  };
  for (let i = 0; i < plan.floor.length - 1; i++) slab(plan.floor[i][0], Math.min(length, plan.floor[i + 1][0]));

  type Opening = { left: number; right: number; low: number; high: number; kind: string };
  const openings: Opening[] = [];
  const row = (count: number, width: number, low: number, high: number, kind: string) => {
    for (let i = 0; i < count; i++) {
      const s = length * (i + 0.5) / count;
      openings.push({ left: s - width / 2, right: s + width / 2, low, high, kind });
    }
  };
  for (const y of plan.upperRows) row(plan.upperCount, plan.upperWindowWidth, y, y + plan.upperWindowHeight, "upper");
  row(plan.upperCount, plan.clerestoryWidth, plan.clerestoryBottom, plan.clerestoryBottom + plan.clerestoryHeight, "clerestory");
  for (let i = 0; i < plan.lowerCount; i++) {
    const s = length * (i + 0.5) / plan.lowerCount;
    openings.push({ left: s - plan.lowerWidth / 2, right: s + plan.lowerWidth / 2, low: floorY(s) + plan.lowerSillAboveGrade, high: plan.lowerTop, kind: "lower" });
  }
  const base = Math.min(...plan.floor.map(q => q[1])) - 0.02;
  const levels = [...new Set([base, plan.roof, ...openings.flatMap(o => [o.low, o.high])])].sort((a, b) => a - b);
  for (let j = 0; j < levels.length - 1; j++) {
    const lo = levels[j], hi = levels[j + 1], y = (lo + hi) / 2;
    const active = openings.filter(o => y > o.low && y < o.high).sort((a, b) => a.left - b.left);
    let s = 0;
    for (const o of active) {
      box((s + o.left) / 2, y, plan.front - plan.wallDepth / 2, o.left - s, hi - lo, plan.wallDepth);
      s = o.right;
    }
    box((s + length) / 2, y, plan.front - plan.wallDepth / 2, length - s, hi - lo, plan.wallDepth);
  }
  const witnesses: { origin: number[]; direction: number[]; expectedDistance: number; kind: string }[] = [];
  for (const o of openings) {
    const s = (o.left + o.right) / 2, y = (o.low + o.high) / 2, w = o.right - o.left, h = o.high - o.low;
    const glassFront = plan.front - plan.inset;
    box(s, y, glassFront - 0.045, w, h, 0.09, 1);
    for (const x of [o.left + 0.036, o.right - 0.036]) box(x, y, glassFront + 0.03, 0.072, h, 0.06, 2);
    for (const yy of [o.low + 0.036, o.high - 0.036]) box(s, yy, glassFront + 0.03, w, 0.072, 0.06, 2);
    if (o.kind === "lower") {
      for (const f of [1 / 3, 2 / 3]) box(o.left + w * f, y, glassFront + 0.035, 0.05, h, 0.07, 2);
      box(s, o.high - 0.9, glassFront + 0.035, w, 0.05, 0.07, 2);
    } else if (o.kind === "upper") box(s, o.low + 0.7, glassFront + 0.035, w, 0.045, 0.07, 2);
    // Shallow sill rather than a heavy painted grid: true local metric UVs
    // continue the existing caller-owned POB stone treatment.
    box(s, o.low - 0.055, plan.front + 0.04, w + 0.14, 0.11, 0.2);
    witnesses.push({ origin: point(s, y, plan.front + 2).toArray(), direction: out.clone().negate().toArray(), expectedDistance: 2 + plan.inset, kind: o.kind });
  }
  // Back, ends, roof and the floor form a closed shell around the recesses.
  const depth = plan.front - plan.back;
  box(length / 2, (base + plan.roof) / 2, plan.back + 0.1, length, plan.roof - base, 0.2);
  for (const s of [0.07, length - 0.07]) box(s, (base + plan.roof) / 2, (plan.front + plan.back) / 2, 0.14, plan.roof - base, depth);
  box(length / 2, plan.roof - 0.12, (plan.front + plan.back) / 2, length, 0.24, depth);
  box(length / 2, plan.stoneTop + 0.055, plan.front + 0.025, length, 0.18, 0.17);
  box(length / 2, plan.roof + 0.04, (plan.front + 0.12 + plan.back) / 2, length, 0.16, depth + 0.12);

  const volumes: PobSouthVolume[] = [];
  // Two convex grade sections. Each cap lies within the visible/physical
  // shell. The lower plane is 0.2m into the 0.4m structural slab, retaining
  // deeper source and keeping all removed near-foot surfaces supported.
  for (let i = 0; i < plan.floor.length - 1; i++) {
    const a = plan.floor[i][0], b = Math.min(length, plan.floor[i + 1][0]);
    const ring = [point(a, 0, plan.front - 0.01), point(b, 0, plan.front - 0.01), point(b, 0, plan.back + 0.01), point(a, 0, plan.back + 0.01)];
    const center = ring.reduce((p, q) => p.add(q), new T.Vector3()).multiplyScalar(0.25);
    const planes = ring.map((p, j) => {
      const q = ring[(j + 1) % ring.length];
      const plane = new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(q.z - p.z, 0, p.x - q.x).normalize(), p);
      if (plane.distanceToPoint(center) > 0) plane.negate();
      return plane;
    });
    const slope = (floorY(b) - floorY(a)) / (b - a);
    planes.push(new T.Plane().setFromNormalAndCoplanarPoint(along.clone().multiplyScalar(slope).add(new T.Vector3(0, -1, 0)).normalize(), point(a, floorY(a) - 0.2, 0)));
    planes.push(new T.Plane(new T.Vector3(0, 1, 0), -(plan.roof + 0.08)));
    const bounds = new T.Box3().setFromPoints(ring);
    bounds.min.y = Math.min(floorY(a), floorY(b)) - 0.2;
    bounds.max.y = plan.roof + 0.08;
    volumes.push({ planes, bounds });
  }
  const meshes = batches.map((parts, i) => {
    const normalized = parts.map(g => g.index ? g.toNonIndexed() : g);
    const geometry = mergeGeometries(normalized, false)!;
    for (let j = 0; j < normalized.length; j++) if (normalized[j] !== parts[j]) normalized[j].dispose();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new T.Mesh(geometry, mats[i]);
    mesh.name = `POB south frontage: ${["stone", "opaque glazing", "frames"][i]}`;
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  });
  // Ownership: colliderGeometries aliases the visible buffers. No returned
  // material is owned; dispose releases each merged geometry once.
  for (const parts of batches) for (const g of parts) g.dispose();
  let disposed = false;
  return {
    meshes, materials: [] as T.Material[], colliderGeometries: meshes.map(m => m.geometry),
    volumes, sourceClearanceVolumes: volumes, witnesses,
    frame: { origin, along, out, length }, plan, local, floorY,
    stats: { scope: plan.scope, openings: openings.length, drawCalls: meshes.length, triangles: meshes.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0), volumes: volumes.length, outwardRegistration: plan.front, placementEstimated: true },
    dispose() { if (disposed) return; disposed = true; for (const mesh of meshes) mesh.geometry.dispose(); },
  };
}
