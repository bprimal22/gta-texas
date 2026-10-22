// A half-metre probe can start across another wall in a narrow measured slit.
// Keep the original 15 cm gate. When an own wall occludes it, additionally
// require contact at the expected face within 1.5 cm from a 10 cm local probe.
export function probeSideFace(physics, RAPIER, point, normal, excludedCollider, accept) {
  const cast = (offset, reach) => physics.castRay(new RAPIER.Ray({
    x: point.x + normal.x * offset, y: point.y + normal.y * offset, z: point.z + normal.z * offset,
  }, { x: -normal.x, y: -normal.y, z: -normal.z }), reach, true,
  undefined, undefined, excludedCollider, undefined, accept);
  const wide = cast(0.5, 1);
  if (wide && Math.abs(wide.timeOfImpact - 0.5) <= 0.15) return { matched: true, localProof: false };
  if (wide && wide.timeOfImpact < 0.35) {
    const near = cast(0.1, 0.2);
    if (near && Math.abs(near.timeOfImpact - 0.1) <= 0.015) return { matched: true, localProof: true };
  }
  return { matched: false, localProof: false };
}
