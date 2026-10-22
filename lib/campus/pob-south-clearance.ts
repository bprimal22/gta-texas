import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { closeGround, type TopTriangle } from "./closed-ground";

type Volume = { planes: T.Plane[]; bounds: T.Box3 };
type Frontage = {
  frame: { origin: T.Vector3; along: T.Vector3; out: T.Vector3; length: number };
  floorY: (s: number) => number;
};
/** Source-only upper air clearance plus a genuinely closed, graded near-wall
 * apron. Borrowed materials and existing assets are never changed. The source
 * dimensions are resident measurements, not exact architectural dimensions. */
export function buildPobSouthClearance(options: {
  frontage: Frontage;
  concrete: T.MeshStandardMaterial;
  /** Measured outer-edge stations in frontage metres; no silent flat fallback. */
  outerGrade: readonly (readonly [number, number])[];
  /** Existing POB west cap at its exact X26.0695267 edge. */
  westCapHeight: (x: number, z: number) => number;
}) {
  const { origin, along, out, length } = options.frontage.frame;
  if (options.outerGrade.length < 2 || options.outerGrade.some(q => !q.every(Number.isFinite))) throw new Error("POB south apron needs a finite measured grade profile");
  const inner = 0.64, outer = 3.65;
  const point = (s: number, y: number, d: number) => origin.clone().addScaledVector(along, s).addScaledVector(out, d).setY(y);
  const leftS = (d: number) => -out.x * d / along.x;
  const interpolate = (s: number) => {
    const rows = options.outerGrade;
    let i = 0; while (i < rows.length - 2 && s > rows[i + 1][0]) i++;
    return T.MathUtils.lerp(rows[i][1], rows[i + 1][1], T.MathUtils.clamp((s - rows[i][0]) / (rows[i + 1][0] - rows[i][0]), 0, 1));
  };
  // The east tip lacked source support. Its short triangular extension meets
  // the installed GDC frontage north edge exactly, at that asset's2.45m floor.
  const gdcA = new T.Vector2(30.1, -56.4), gdcB = new T.Vector2(45.9, -54.9), edge = gdcB.clone().sub(gdcA);
  const end = point(length, 0, 0), cross = (a: T.Vector2, b: T.Vector2) => a.x * b.y - a.y * b.x;
  const endOuter = -cross(new T.Vector2(end.x, end.z).sub(gdcA), edge) / cross(new T.Vector2(out.x, out.z), edge);
  const outerAt = (s: number) => T.MathUtils.lerp(outer, endOuter, T.MathUtils.clamp((s - 14) / (length - 14), 0, 1));
  const baseGrade = (s: number, d: number) => T.MathUtils.lerp(options.frontage.floorY(s), interpolate(s), (d - inner) / (outerAt(s) - inner));
  const grade = (s: number, d: number) => {
    const ls = leftS(d), p = point(ls, 0, d);
    const weight = Math.max(0, 1 - (s - ls) / 1.5);
    if (weight === 0) return baseGrade(s, d);
    const fixed = options.westCapHeight(p.x - 0.000001, p.z);
    if (!Number.isFinite(fixed)) throw new Error(`POB south apron west cap missing at ${p.x},${p.z}`);
    // Exact old boundary, fading over 1.5m. The inner endpoint falls within
    // the closed stone wall; walking paths cross the matched west seam.
    return baseGrade(s, d) + weight * (fixed - baseGrade(ls, d));
  };
  const makeVolume = (ring: T.Vector3[], low: number, high: number): Volume => {
    const center = ring.reduce((p, q) => p.add(q), new T.Vector3()).multiplyScalar(1 / ring.length);
    const planes = ring.map((a, i) => {
      const b = ring[(i + 1) % ring.length], plane = new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z - a.z, 0, a.x - b.x).normalize(), a);
      if (plane.distanceToPoint(center) > 0) plane.negate(); return plane;
    });
    planes.push(new T.Plane(new T.Vector3(0, -1, 0), low), new T.Plane(new T.Vector3(0, 1, 0), -high));
    const bounds = new T.Box3().setFromPoints(ring); bounds.min.y = low; bounds.max.y = high;
    return { planes, bounds };
  };
  const top: TopTriangle[] = [];
  // Shared triangulation avoids internal vertical seams. Stations include
  // the old west-cap Z breaks, so its boundary interpolation is exact.
  const ds = [inner, ...[-61.5, -60.5, -59.5].map(z => (z - origin.z) * along.x), 1.45, outer].filter(d => d >= inner && d <= outer).sort((a, b) => a - b);
  const ss = [...new Set([0, ...Array.from({ length: 19 }, (_, i) => i + 1), 7.5, 14, length])].sort((a, b) => a - b);
  for (let i = 0; i < ss.length - 1; i++) for (let j = 0; j < ds.length - 1; j++) {
    const v = (station: number, sourceD: number) => {
      const d = inner + (sourceD - inner) / (outer - inner) * (outerAt(station) - inner);
      const s = station === 0 ? leftS(d) : station; return point(s, grade(s, d), d);
    };
    const ring = [v(ss[i], ds[j]), v(ss[i + 1], ds[j]), v(ss[i + 1], ds[j + 1]), v(ss[i], ds[j + 1])];
    for (const indices of [[0, 1, 2], [0, 2, 3]]) {
      const triangle = indices.map(k => ring[k]) as [T.Vector3, T.Vector3, T.Vector3];
      top.push({ points: triangle, material: 0 });
    }
  }
  // Two coherent footprint pieces, not a collection of tiny debris patches.
  // The closed base is deep enough that its highest underside still lies
  // below this flat cut bottom, despite the graded top surface.
  const heights = top.flatMap(t => t.points.map(p => p.y)), low = Math.min(...heights) - 0.025;
  const slabDepth = Math.max(0.6, Math.max(...heights) - low + 0.2);
  const perimeter = [[leftS(inner), inner], [length, inner], [length, outer], [leftS(outer), outer]].map(([s, d]) => point(s, grade(s, d), d));
  const groundVolumes = [makeVolume(perimeter, low, 4.5), makeVolume([[14, outer], [length, outer], [length, endOuter]].map(([s, d]) => point(s, grade(s, d), d)), low, 4.5)];
  const ground = closeGround(top, [options.concrete, options.concrete], slabDepth, "POB south closed apron");
  const geometry = mergeGeometries(ground.meshes.map(m => m.geometry), false)!;
  for (const m of ground.meshes) m.geometry.dispose();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const mesh = new T.Mesh(geometry, options.concrete); mesh.name = "POB south supported frontage apron"; mesh.castShadow = true; mesh.receiveShadow = true;
  // The photos show air in front of the straight south stone wall. These
  // measured folds extend1.279m outward and0.661m past its west corner. This
  // box removes source air artifacts only; it does not enlarge the building.
  const upperVolumes = [makeVolume([point(-0.75, 0, -1.64), point(length, 0, -1.64), point(length, 0, 1.45), point(-0.75, 0, 1.45)], 4, 25.65)];
  let disposed = false;
  return {
    meshes: [mesh], materials: [] as T.Material[], colliderGeometries: [geometry],
    volumes: [...groundVolumes, ...upperVolumes], sourceClearanceVolumes: [...groundVolumes, ...upperVolumes],
    groundVolumes, upperVolumes, height: ground.height, top: ground.top, boundaryEdges: ground.boundaryEdges,
    stats: { scope: "POB20m south facade front air and supported apron only", triangles: geometry.attributes.position.count / 3, drawCalls: 1, groundVolumes: groundVolumes.length, upperVolumes: upperVolumes.length, outerDistance: outer, eastOuterDistance: endOuter, eastJoin: point(length, 2.45, endOuter).toArray(), upperDistance: 1.45, slabDepth, cutBottom: low, inferredGradeBetweenSamples: true },
    dispose() { if (disposed) return; disposed = true; geometry.dispose(); },
  };
}
