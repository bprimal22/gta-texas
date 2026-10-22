import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import plan from "./pob-upper-projection-plan.json" with { type: "json" };

/** Optional simplified upper central projection only. The viewed south photos
 * and measured roof bands justify a coherent high mass; hidden geometry is
 * explicitly inferred. Full lower connector and its floor remain untouched. */
export function buildPobUpperProjection(options: {
  frontage: { frame: { origin: T.Vector3; along: T.Vector3; out: T.Vector3; length: number } };
  stone: T.MeshStandardMaterial;
  glass: T.MeshStandardMaterial;
  metal: T.MeshStandardMaterial;
}) {
  const { origin, along, out } = options.frontage.frame;
  const point = (s: number, y: number, d: number) => origin.clone().addScaledVector(along, s).addScaledVector(out, d).setY(y);
  const parts: T.BufferGeometry[][] = [[], [], []], mats = [options.stone, options.glass, options.metal];
  const witnesses: { origin: number[]; direction: number[]; distance: number; face: string }[] = [];
  const box = (basis: T.Matrix4, x: number, y: number, d: number, w: number, h: number, depth: number, material = 0) => {
    if (Math.min(w, h, depth) <= 1e-7) return;
    const g = new T.BoxGeometry(w, h, depth); g.translate(x, y, d);
    const p = g.attributes.position; for (let i = 0; i < p.count; i++) g.attributes.uv.setXY(i, p.getX(i), p.getY(i));
    g.applyMatrix4(basis); parts[material].push(g);
  };
  let openingCount = 0;
  const facade = (a: T.Vector3, b: T.Vector3, columns: number, name: string, clerestory = false) => {
    const u = b.clone().sub(a).normalize(), n = u.clone().cross(new T.Vector3(0, 1, 0)), length = a.distanceTo(b), basis = new T.Matrix4().makeBasis(u, new T.Vector3(0, 1, 0), n).setPosition(a);
    const openings: { l: number; r: number; low: number; high: number }[] = [];
    const row = (low: number, height: number, width: number) => { for (let i = 0; i < columns; i++) { const x = length * (i + 0.5) / columns; openings.push({ l: x - width / 2, r: x + width / 2, low, high: low + height }); } };
    for (const y of plan.windowRows) row(y, plan.windowHeight, columns === 1 ? 1.35 : 1.55);
    if (clerestory) row(plan.clerestoryBottom, plan.clerestoryHeight, 1.7);
    const levels = [...new Set([plan.base, plan.roof, ...openings.flatMap(o => [o.low, o.high])])].sort((a, b) => a - b);
    for (let i = 0; i < levels.length - 1; i++) {
      const low = levels[i], high = levels[i + 1], y = (low + high) / 2, active = openings.filter(o => y > o.low && y < o.high).sort((a, b) => a.l - b.l);
      let x = 0; for (const o of active) { box(basis, (x + o.l) / 2, y, -0.425, o.l - x, high - low, 0.85); x = o.r; }
      box(basis, (x + length) / 2, y, -0.425, length - x, high - low, 0.85);
    }
    for (const o of openings) {
      const x = (o.l + o.r) / 2, y = (o.low + o.high) / 2, w = o.r - o.l, h = o.high - o.low;
      box(basis, x, y, -0.595, w, h, 0.09, 1);
      for (const xx of [o.l + 0.035, o.r - 0.035]) box(basis, xx, y, -0.51, 0.07, h, 0.08, 2);
      for (const yy of [o.low + 0.035, o.high - 0.035]) box(basis, x, yy, -0.51, w, 0.07, 0.08, 2);
      if (h > 1.5) box(basis, x, o.low + 0.78, -0.505, w, 0.05, 0.08, 2);
      box(basis, x, o.low - 0.065, 0.025, w + 0.18, 0.13, 0.2);
      witnesses.push({ origin: a.clone().addScaledVector(u, x).addScaledVector(n, 2).setY(y).toArray(), direction: n.clone().negate().toArray(), distance: 2.55, face: name }); openingCount++;
    }
    box(basis, length / 2, plan.roof - 0.22, 0.03, length, 0.22, 0.18);
  };
  facade(point(plan.sMin, 0, plan.front), point(plan.sMax, 0, plan.front), 3, "south", true);
  facade(point(plan.sMin, 0, plan.back), point(plan.sMin, 0, plan.front), 1, "west return");
  facade(point(plan.sMax, 0, plan.front), point(plan.sMax, 0, plan.back), 1, "east return");
  const basis = new T.Matrix4().makeBasis(along, new T.Vector3(0, 1, 0), out).setPosition(origin), width = plan.sMax - plan.sMin, depth = plan.front - plan.back, x = (plan.sMin + plan.sMax) / 2, d = (plan.front + plan.back) / 2;
  box(basis, x, (plan.base + plan.roof) / 2, plan.back + 0.11, width, plan.roof - plan.base, 0.22);
  box(basis, x, plan.base + 0.04, d, width, 0.24, depth);
  box(basis, x, plan.roof - 0.08, d, width, 0.4, depth);
  const meshes = parts.map((geometries, i) => {
    const g = mergeGeometries(geometries, false)!; geometries.forEach(q => q.dispose()); g.computeBoundingBox(); g.computeBoundingSphere();
    const mesh = new T.Mesh(g, mats[i]); mesh.name = `POB upper south projection: ${["stone", "opaque glazing", "frames"][i]}`; mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
  });
  const ring = [point(plan.sMin, 0, plan.back), point(plan.sMax, 0, plan.back), point(plan.sMax, 0, plan.front), point(plan.sMin, 0, plan.front)], center = point(x, 0, d);
  const planes = ring.map((a, i) => { const b = ring[(i + 1) % ring.length], p = new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z - a.z, 0, a.x - b.x).normalize(), a); if (p.distanceToPoint(center) > 0) p.negate(); return p; });
  planes.push(new T.Plane(new T.Vector3(0, -1, 0), plan.base + 0.03), new T.Plane(new T.Vector3(0, 1, 0), -(plan.roof + 0.1)));
  const bounds = new T.Box3().setFromPoints(ring); bounds.min.y = plan.base + 0.03; bounds.max.y = plan.roof + 0.1;
  const volumes = [{ planes, bounds }]; let disposed = false;
  return {
    meshes, materials: [] as T.Material[], colliderGeometries: meshes.map(m => m.geometry), volumes, sourceClearanceVolumes: volumes, plan, witnesses,
    stats: { scope: "Optional inferred POB upper central south mass only; connector and ground retained", openings: openingCount, triangles: meshes.reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0), drawCalls: meshes.length, cutVolumes: 1, lowestCut: plan.base + 0.03, exactSurvey: false },
    dispose() { if (disposed) return; disposed = true; meshes.forEach(m => m.geometry.dispose()); },
  };
}
