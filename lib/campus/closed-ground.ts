import * as T from "three";
export type TopTriangle = { points: [T.Vector3, T.Vector3, T.Vector3]; material: number };
/** One shared closed floor skin; internal top edges do not get vertical walls.
 * All inputs are fixed metric world positions. Each material batch uses exactly
 * the same position buffer for rendering and its Rapier triangle collider. */
export function closeGround(
  top: TopTriangle[],
  materials: T.MeshStandardMaterial[],
  depth: number,
  prefix: string,
) {
  const positions = materials.map(() => [] as number[]),
    uvs = materials.map(() => [] as number[]);
  const edges = new Map<string, { a: T.Vector3; b: T.Vector3; count: number }>();
  const key = (p: T.Vector3) =>
    p
      .toArray()
      .map((v) => v.toFixed(8))
      .join(",");
  const emit = (a: T.Vector3, b: T.Vector3, c: T.Vector3, material: number) => {
    for (const p of [a, b, c]) {
      positions[material].push(p.x, p.y, p.z);
      uvs[material].push(p.x * 0.5, p.z * 0.5);
    }
  };
  for (const face of top) {
    const a = face.points[0];
    let [, b, c] = face.points;
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    if (n.lengthSq() < 1e-15) throw new Error("POB boundary floor has a degenerate face");
    if (n.y < 0) [b, c] = [c, b];
    face.points = [a, b, c];
    emit(a, b, c, face.material);
    const down = (p: T.Vector3) => p.clone().add(new T.Vector3(0, -depth, 0));
    emit(down(a), down(c), down(b), 1);
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const k = [key(u), key(v)].sort().join("|"),
        old = edges.get(k);
      if (old) {
        if (key(old.a) !== key(v) || key(old.b) !== key(u))
          throw new Error("POB boundary floor edge winding mismatch");
        old.count++;
        if (old.count > 2) throw new Error("Nonmanifold POB boundary floor");
      } else edges.set(k, { a: u, b: v, count: 1 });
    }
  }
  for (const { a, b, count } of edges.values())
    if (count === 1) {
      const aa = a.clone().add(new T.Vector3(0, -depth, 0)),
        bb = b.clone().add(new T.Vector3(0, -depth, 0));
      emit(a, aa, b, 1);
      emit(b, aa, bb, 1);
    }
  const meshes = positions.flatMap((p, i) => {
    if (!p.length) return [];
    const g = new T.BufferGeometry()
      .setAttribute("position", new T.Float32BufferAttribute(p, 3))
      .setAttribute("uv", new T.Float32BufferAttribute(uvs[i], 2));
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const mesh = new T.Mesh(g, materials[i]);
    mesh.name = `${prefix}: ${i === 0 ? "paved walk" : "closed planting floor"}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return [mesh];
  });
  const height = (x: number, z: number) => {
    for (const {
      points: [a, b, c],
    } of top) {
      const den = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z),
        wa = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / den,
        wb = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / den,
        wc = 1 - wa - wb;
      if (Math.min(wa, wb, wc) >= -1e-7) return wa * a.y + wb * b.y + wc * c.y;
    }
    return NaN;
  };
  return { meshes, height, top, boundaryEdges: [...edges.values()].filter((e) => e.count === 1) };
}
