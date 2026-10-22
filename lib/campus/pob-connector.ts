import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import plan from "./pob-connector-plan.json" with { type: "json" };

/** Photo-informed low entrance only. Shares the accepted POB materials and
 * uses exactly the rendered closed geometry for its physical colliders. */
export function buildPobConnector(options: {
  stone: T.MeshStandardMaterial; brick: T.MeshStandardMaterial;
  glass: T.MeshStandardMaterial; metal: T.MeshStandardMaterial;
  concrete: T.MeshStandardMaterial;
}) {
  const origin = new T.Vector3(plan.northWest[0], 0, plan.northWest[1]);
  const c = new T.Vector3(plan.southWest[0], 0, plan.southWest[1]);
  const end = new T.Vector3(plan.southEast[0], 0, plan.southEast[1]);
  const width = origin.distanceTo(c), depth = c.distanceTo(end);
  const along = c.clone().sub(origin).normalize(), inward = end.clone().sub(c).normalize();
  // Official boundary directions differ from perpendicular by about 0.6deg.
  // The affine basis preserves both measured edges rather than snapping one.
  const basis = new T.Matrix4().makeBasis(along, new T.Vector3(0, 1, 0), inward).setPosition(origin);
  const point = (t: number, y: number, q: number) => origin.clone().addScaledVector(along, t).addScaledVector(inward, q).setY(y);
  const mats = [options.stone, options.brick, options.glass, options.metal, options.concrete];
  const parts: T.BufferGeometry[][] = mats.map(() => []);
  const mapGeometry = (g: T.BufferGeometry) => {
    g.applyMatrix4(basis);
    // The official entrance axis points south, while depth points east.
    // Correct the mirrored affine basis so face winding matches normals.
    if (basis.determinant() < 0 && g.index) for (let i = 0; i < g.index.count; i += 3) {
      const b = g.index.getX(i + 1); g.index.setX(i + 1, g.index.getX(i + 2)); g.index.setX(i + 2, b);
    }
    return g;
  };
  const box = (t: number, y: number, q: number, w: number, h: number, d: number, material: number) => {
    if (Math.min(w, h, d) < 1e-6) return;
    const g = new T.BoxGeometry(w, h, d); g.translate(t, y, q);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) g.attributes.uv.setXY(i, p.getX(i), p.getY(i));
    parts[material].push(mapGeometry(g));
  };
  const quad = (a: T.Vector3, b: T.Vector3, c: T.Vector3, d: T.Vector3, normal: T.Vector3, material: number) => {
    let corners = [a, b, c, d];
    if (b.clone().sub(a).cross(c.clone().sub(a)).dot(normal) < 0) corners = [a, d, c, b];
    const vertices = [0, 1, 2, 0, 2, 3].flatMap(i => corners[i].toArray());
    const uv = [0, 1, 2, 0, 2, 3].flatMap(i => [corners[i].x * 0.5, corners[i].z * 0.5]);
    const g = new T.BufferGeometry().setAttribute("position", new T.Float32BufferAttribute(vertices, 3)).setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals(); parts[material].push(g);
  };
  const roofY = (q: number) => T.MathUtils.lerp(plan.eave, plan.ridge, T.MathUtils.clamp((q + plan.eaveOut) / (plan.ridgeDepth + plan.eaveOut), 0, 1));
  const roofSection = (q0: number, q1: number) => {
    const a = -plan.roofSideOverhang, b = width + plan.roofSideOverhang;
    const upper = [point(a, roofY(q0), q0), point(b, roofY(q0), q0), point(b, roofY(q1), q1), point(a, roofY(q1), q1)];
    const lower = upper.map(p => p.clone().add(new T.Vector3(0, -plan.roofThickness, 0)));
    quad(...upper as [T.Vector3, T.Vector3, T.Vector3, T.Vector3], new T.Vector3(0, 1, 0), 3);
    quad(...lower as [T.Vector3, T.Vector3, T.Vector3, T.Vector3], new T.Vector3(0, -1, 0), 3);
    const center = upper.reduce((s, p) => s.add(p), new T.Vector3()).multiplyScalar(0.25);
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(upper[i], upper[j], lower[j], lower[i], upper[i].clone().lerp(upper[j], 0.5).sub(center).setY(0), 3); }
  };
  roofSection(-plan.eaveOut, plan.ridgeDepth); roofSection(plan.ridgeDepth, depth);
  // Thin true raised seams run uphill on the visible front slope; do not
  // replace the metal with painted high-contrast stripes.
  const slopeLength = Math.hypot(plan.ridgeDepth + plan.eaveOut, plan.ridge - plan.eave);
  const slopeAngle = Math.atan2(plan.ridge - plan.eave, plan.ridgeDepth + plan.eaveOut);
  let seamCount = 0;
  for (let t = 0.14; t < width; t += 0.46) {
    const g = new T.BoxGeometry(0.025, 0.045, slopeLength);
    g.rotateX(-slopeAngle); g.translate(t, (plan.eave + plan.ridge) / 2 + 0.025, (plan.ridgeDepth - plan.eaveOut) / 2); parts[3].push(mapGeometry(g)); seamCount++;
  }
  box(width / 2, plan.eave - 0.10, -plan.eaveOut, width + 0.2, 0.22, 0.10, 3);
  box(width / 2, plan.ridge + 0.025, plan.ridgeDepth, width + 0.18, 0.10, 0.18, 3);
  // Closed slab at the known exterior 2.45m datum. The 16cm outer lip bridges
  // the small registration difference from the accepted apron edge; it does
  // not enlarge the source cut or alter either existing approach floor.
  box(width / 2, plan.floor - plan.slabDepth / 2, (depth - plan.floorOut) / 2, width, plan.slabDepth, depth + plan.floorOut, 4);
  const wallTop = plan.ridge - plan.roofThickness + 0.025;
  const sideWall = (t0: number, t1: number, material: number) => {
    for (const [q0, q1] of [[0, plan.ridgeDepth], [plan.ridgeDepth, depth]]) {
      const low = [point(t0, plan.floor, q0), point(t1, plan.floor, q0), point(t1, plan.floor, q1), point(t0, plan.floor, q1)];
      const high = low.map((p, i) => p.clone().setY(roofY(i < 2 ? q0 : q1) - plan.roofThickness + 0.025));
      const center = low.reduce((s, p) => s.add(p), new T.Vector3()).multiplyScalar(0.25);
      quad(...low as [T.Vector3, T.Vector3, T.Vector3, T.Vector3], new T.Vector3(0, -1, 0), material);
      quad(...high as [T.Vector3, T.Vector3, T.Vector3, T.Vector3], new T.Vector3(0, 1, 0), material);
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(low[i], low[j], high[j], high[i], low[i].clone().lerp(low[j], 0.5).sub(center).setY(0), material); }
    }
  };
  sideWall(0, 0.24, 0); sideWall(width - 0.24, width, 1);
  box(width / 2, (plan.floor + wallTop) / 2, depth - 0.13, width, wallTop - plan.floor, 0.26, 1);
  const frontTop = roofY(0) - plan.roofThickness;
  box(plan.northJamb / 2, (plan.floor + frontTop) / 2, 0.4, plan.northJamb, frontTop - plan.floor, 0.8, 0);
  box(width - plan.southJamb / 2, (plan.floor + frontTop) / 2, 0.4, plan.southJamb, frontTop - plan.floor, 0.8, 1);
  const glassLeft = plan.northJamb, glassRight = width - plan.southJamb, glassWidth = glassRight - glassLeft, mid = (glassLeft + glassRight) / 2;
  box(mid, (plan.glazingTop + frontTop) / 2, 0.37, glassWidth, frontTop - plan.glazingTop, 0.74, 3);
  // Flat dark soffit over the shallow recess gives the roof a visible underside.
  box(width / 2, plan.glazingTop + 0.14, (plan.recess - plan.eaveOut) / 2, width, 0.14, plan.recess + plan.eaveOut, 3);
  const doorLow = plan.floor + 0.025, doorTop = doorLow + plan.doorHeight;
  const leftDoor = mid - plan.doorWidth / 2, rightDoor = mid + plan.doorWidth / 2;
  const columns = [glassLeft, (glassLeft + leftDoor) / 2, leftDoor, mid, rightDoor, (rightDoor + glassRight) / 2, glassRight];
  const glazingWitnesses: number[][] = [];
  for (let i = 0; i < columns.length - 1; i++) {
    const t = (columns[i] + columns[i + 1]) / 2, w = columns[i + 1] - columns[i];
    for (const [low, high] of [[doorLow, doorTop], [doorTop, plan.glazingTop]]) {
      box(t, (low + high) / 2, plan.recess + 0.045, w, high - low, 0.09, 2);
      glazingWitnesses.push(point(t, (low + high) / 2, plan.recess).toArray());
    }
  }
  for (const t of columns) box(t, (doorLow + plan.glazingTop) / 2, plan.recess - 0.018, 0.055, plan.glazingTop - doorLow, 0.11, 3);
  for (const y of [doorLow, doorTop, plan.glazingTop]) box(mid, y, plan.recess - 0.018, glassWidth + 0.05, 0.065, 0.11, 3);
  // Two closed door leaves, narrow meeting stiles and visible pull handles.
  for (const t of [mid - 0.11, mid + 0.11]) {
    box(t, plan.floor + 1.06, plan.recess - 0.17, 0.025, 0.60, 0.035, 3);
    for (const y of [plan.floor + 0.80, plan.floor + 1.32]) box(t, y, plan.recess - 0.11, 0.025, 0.025, 0.13, 3);
  }
  // The small raised glazed pyramid is visible behind the metal slope in
  // L001. Its exact rear placement and dimensions are deliberately inferred.
  const skyT = width * 0.66, skyQ = 5.5, skyW = 2.6, skyD = 2.0, skyBase = plan.ridge + 0.06, skyTop = skyBase + 0.62;
  box(skyT, skyBase - 0.06, skyQ, skyW + 0.10, 0.16, skyD + 0.10, 3);
  const skyCorners = [point(skyT - skyW / 2, skyBase, skyQ - skyD / 2), point(skyT + skyW / 2, skyBase, skyQ - skyD / 2), point(skyT + skyW / 2, skyBase, skyQ + skyD / 2), point(skyT - skyW / 2, skyBase, skyQ + skyD / 2)], peak = point(skyT, skyTop, skyQ);
  for (let i = 0; i < 4; i++) {
    const a = skyCorners[i], b = skyCorners[(i + 1) % 4];
    const vertices = [a, b, peak]; if (b.clone().sub(a).cross(peak.clone().sub(a)).y < 0) vertices.reverse();
    const g = new T.BufferGeometry().setAttribute("position", new T.Float32BufferAttribute(vertices.flatMap(p => p.toArray()), 3)).setAttribute("uv", new T.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2)); g.computeVertexNormals(); parts[2].push(g);
    const delta = peak.clone().sub(a), beam = new T.BoxGeometry(0.045, delta.length(), 0.045); beam.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), delta.clone().normalize())); beam.translate(...a.clone().lerp(peak, 0.5).toArray()); parts[3].push(beam);
  }
  const meshes = parts.flatMap((items, i) => {
    if (!items.length) return [];
    // Mixed primitives become one non-indexed buffer per borrowed material.
    const inputs = items.map(g => g.index ? g.toNonIndexed() : g);
    const geometry = mergeGeometries(inputs, false)!;
    for (let j = 0; j < items.length; j++) { if (inputs[j] !== items[j]) inputs[j].dispose(); items[j].dispose(); }
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new T.Mesh(geometry, mats[i]); mesh.name = `POB low connector: ${["stone jamb", "brick returns", "opaque doors and skylight", "standing-seam roof and frames", "closed entry floor"][i]}`; mesh.castShadow = true; mesh.receiveShadow = true; return [mesh];
  });
  const volume = (t0: number, t1: number, q0: number, q1: number, low: number, high: number) => {
    const ring = [point(t0, 0, q0), point(t1, 0, q0), point(t1, 0, q1), point(t0, 0, q1)], center = point((t0 + t1) / 2, 0, (q0 + q1) / 2);
    const planes = ring.map((a, i) => { const b = ring[(i + 1) % ring.length], p = new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z - a.z, 0, a.x - b.x).normalize(), a); if (p.distanceToPoint(center) > 0) p.negate(); return p; });
    planes.push(new T.Plane(new T.Vector3(0, -1, 0), low), new T.Plane(new T.Vector3(0, 1, 0), -high)); const bounds = new T.Box3().setFromPoints(ring); bounds.min.y = low; bounds.max.y = high; return { planes, bounds };
  };
  const groundVolumes = [volume(0, width, -0.015, depth, plan.floor - 0.02, plan.sourceCutTop)];
  const airVolumes = [volume(0, width, -plan.airOut, 0.02, plan.airBottom, plan.sourceCutTop)];
  const volumes = [...groundVolumes, ...airVolumes]; let disposed = false;
  return {
    meshes, materials: [] as T.Material[], colliderGeometries: meshes.map(m => m.geometry), volumes, sourceClearanceVolumes: volumes, groundVolumes, airVolumes,
    frame: { origin, along, inward, width, depth }, point, roofY, plan, glazingWitnesses,
    stats: { scope: "Low west-facing POB–GDC connector only", drawCalls: meshes.length, triangles: meshes.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0), cutVolumes: volumes.length, seamCount, newMaterials: 0, doorLeaves: 2, recessedEntry: plan.recess, floor: plan.floor, photoInferred: true },
    dispose() { if (disposed) return; disposed = true; meshes.forEach(m => m.geometry.dispose()); },
  };
}
