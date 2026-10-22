import * as T from "three";

/** Resident scan folds protrude outside the already closed upper shell.
 * These are source-only exterior-air margins, not a new building footprint.
 * Never apply them to authored geometry, especially the lower connector. */
export function buildPobUpperClearance(options: {
  frontage: { frame: { origin: T.Vector3; along: T.Vector3; out: T.Vector3 } };
  upper: { plan: { sMin: number; sMax: number; back: number; front: number; base: number; roof: number } };
}) {
  const { origin, along, out } = options.frontage.frame, p = options.upper.plan;
  const westPadding = 1.3, frontPadding = 0.7;
  const point = (s: number, d: number) => origin.clone().addScaledVector(along, s).addScaledVector(out, d).setY(0);
  const low = p.base + 0.03, high = p.roof + 0.1;
  const volume = (s0: number, s1: number, d0: number, d1: number) => {
    const ring = [point(s0, d0), point(s1, d0), point(s1, d1), point(s0, d1)];
    const center = point((s0 + s1) / 2, (d0 + d1) / 2);
    const planes = ring.map((a, i) => {
      const b = ring[(i + 1) % ring.length];
      const plane = new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z - a.z, 0, a.x - b.x).normalize(), a);
      if (plane.distanceToPoint(center) > 0) plane.negate();
      return plane;
    });
    planes.push(new T.Plane(new T.Vector3(0, -1, 0), low), new T.Plane(new T.Vector3(0, 1, 0), -high));
    const bounds = new T.Box3().setFromPoints(ring); bounds.min.y = low; bounds.max.y = high;
    return { planes, bounds };
  };
  // The observed west fold reaches 1.15384m outside the return; its cut
  // triangle begins exactly at the previous front-air cut d = 1.45. The roof
  // edge reaches 0.55377m south of the new front. Coherent facade strips with
  // small margins replace the clipped remnants, rather than per-triangle cuts.
  const volumes = [
    volume(p.sMin - westPadding, p.sMin + 0.02, p.back, p.front + frontPadding),
    volume(p.sMin, p.sMax, p.front - 0.02, p.front + frontPadding),
  ];
  return {
    meshes: [] as T.Mesh[], materials: [] as T.Material[], colliderGeometries: [] as T.BufferGeometry[],
    volumes, sourceClearanceVolumes: volumes,
    stats: { scope: "POB upper west-return and south-face exterior air only", cutVolumes: volumes.length, drawCalls: 0, triangles: 0, westPadding, frontPadding, lowestCut: low, highestCut: high, inferredArchitectureUnchanged: true },
    dispose() { /* Owns only CPU plane/bounds values; no GPU or physics assets. */ },
  };
}
