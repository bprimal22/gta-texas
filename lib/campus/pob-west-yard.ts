import * as T from "three";
import rawPlan from "./pob-frontage-plan.json" with { type: "json" };
import type { PobVolume } from "./pob-frontage";
type Face = [T.Vector3, T.Vector3, T.Vector3];
/** Finite closed ground replacement. fixedGroundHeight MUST sample stable
 * authored ground, never transient registration wedges or streamed foliage. */
export function buildPobWestYard(options: {
  concrete: T.MeshStandardMaterial;
  grass: T.MeshStandardMaterial;
  fixedGroundHeight?: (x: number, z: number) => number;
  makeVolume: (p: T.Vector3[], lo: number, hi: number) => PobVolume;
}) {
  const p = rawPlan.yard,
    a = rawPlan.west[0],
    b = rawPlan.west[1],
    length = b[1] - a[1],
    dx = (b[0] - a[0]) / length;
  const local = (x: number, z: number) => ({ s: z - a[1], d: x - p.outerX });
  const edgeHeight = (z: number) => {
    if (options.fixedGroundHeight) {
      const supplied = options.fixedGroundHeight(p.outerX, z);
      if (!Number.isFinite(supplied))
        throw new Error(`POB fixed authored edge has no support at (${p.outerX}, ${z})`);
      return supplied;
    }
    const rows = p.fixedEdgeFallback;
    let i = 0;
    while (i < rows.length - 2 && z > rows[i + 1][0]) i++;
    const u = T.MathUtils.clamp((z - rows[i][0]) / (rows[i + 1][0] - rows[i][0]), 0, 1);
    return T.MathUtils.lerp(rows[i][1], rows[i + 1][1], u);
  };
  const wallX = (s: number) => a[0] + dx * s;
  const innerY = (s: number) => {
    const endWeight =
      1 - Math.min(T.MathUtils.smoothstep(s, 0, 6), T.MathUtils.smoothstep(length - s, 0, 6));
    return T.MathUtils.lerp(rawPlan.base + 0.2, edgeHeight(a[1] + s), endWeight);
  };
  const stations = [
    0,
    length,
    6,
    length - 6,
    p.crossPathCenter - p.crossPathWidth / 2,
    p.crossPathCenter + p.crossPathWidth / 2,
  ];
  for (let s = p.rowSpacing; s < length; s += p.rowSpacing) stations.push(s);
  stations.sort((a, b) => a - b);
  const ss = stations.filter((s, i) => i === 0 || s - stations[i - 1] > 0.06);
  const rows = ss.map((s) => {
    const z = a[1] + s,
      w = wallX(s) - p.outerX,
      outer = edgeHeight(z),
      inner = innerY(s);
    return {
      s,
      z,
      width: w,
      outer,
      inner,
      vertices: [0, p.outerWalkWidth, w - p.innerWalkWidth, w].map((d) => {
        const u = T.MathUtils.clamp(
          (d - p.outerWalkWidth) / (w - p.innerWalkWidth - p.outerWalkWidth),
          0,
          1,
        );
        return new T.Vector3(p.outerX + d, T.MathUtils.lerp(outer, inner, u), z);
      }),
    };
  });
  const values: number[][] = [[], []],
    uvs: number[][] = [[], []],
    faces: Face[] = [],
    pavedFaces: Face[] = [];
  const tri = (f: Face, mat: number) => {
    for (const v of f) {
      values[mat].push(...v.toArray());
      uvs[mat].push(v.x * 0.5, v.z * 0.5);
    }
  };
  const isPaved = (s: number, d: number) =>
    d <= p.outerWalkWidth + 1e-6 ||
    d >= wallX(s) - p.outerX - p.innerWalkWidth - 1e-6 ||
    Math.abs(s - p.crossPathCenter) <= p.crossPathWidth / 2 + 1e-6;
  const top = (a: T.Vector3, b: T.Vector3, c: T.Vector3) => {
    let f: Face = [a, b, c];
    if (b.clone().sub(a).cross(c.clone().sub(a)).y < 0) f = [a, c, b];
    const center = a.clone().add(b).add(c).divideScalar(3),
      q = local(center.x, center.z),
      paved = isPaved(q.s, q.d);
    tri(f, paved ? 0 : 1);
    faces.push(f);
    if (paved) pavedFaces.push(f);
    const under = f.map((v) => v.clone().add(new T.Vector3(0, -p.shellDepth, 0))) as Face;
    tri([under[0], under[2], under[1]], 1);
  };
  for (let i = 0; i < rows.length - 1; i++)
    for (let j = 0; j < 3; j++) {
      const a = rows[i].vertices,
        b = rows[i + 1].vertices;
      top(a[j], b[j], a[j + 1]);
      top(a[j + 1], b[j], b[j + 1]);
    }
  const boundary = [
    ...rows.map((r) => r.vertices[0]),
    ...rows.at(-1)!.vertices.slice(1),
    ...rows
      .slice(0, -1)
      .reverse()
      .map((r) => r.vertices.at(-1)!),
    ...rows[0].vertices.slice(1, -1).reverse(),
  ];
  const center = boundary.reduce((a, b) => a.add(b), new T.Vector3()).divideScalar(boundary.length);
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i],
      b = boundary[(i + 1) % boundary.length],
      aa = a.clone().add(new T.Vector3(0, -p.shellDepth, 0)),
      bb = b.clone().add(new T.Vector3(0, -p.shellDepth, 0));
    if (
      b
        .clone()
        .sub(a)
        .cross(bb.clone().sub(a))
        .dot(a.clone().add(b).multiplyScalar(0.5).sub(center).setY(0)) >= 0
    ) {
      tri([a, b, bb], 1);
      tri([a, bb, aa], 1);
    } else {
      tri([a, bb, b], 1);
      tri([a, aa, bb], 1);
    }
  }
  const meshes = values.map((v, i) => {
    const g = new T.BufferGeometry()
      .setAttribute("position", new T.Float32BufferAttribute(v, 3))
      .setAttribute("uv", new T.Float32BufferAttribute(uvs[i], 2));
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const m = new T.Mesh(g, i === 0 ? options.concrete : options.grass);
    m.name =
      i === 0 ? "POB west yard: lower-entry walks" : "POB west yard: closed sloping planting";
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  });
  const height = (x: number, z: number) => {
    for (const [a, b, c] of faces) {
      const den = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z),
        wa = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / den,
        wb = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / den,
        wc = 1 - wa - wb;
      if (Math.min(wa, wb, wc) >= -1e-7) return wa * a.y + wb * b.y + wc * c.y;
    }
    return NaN;
  };
  const contains = (x: number, z: number) => Number.isFinite(height(x, z)),
    paved = (x: number, z: number) => {
      const q = local(x, z);
      return contains(x, z) && isPaved(q.s, q.d);
    };
  const volumes: PobVolume[] = [],
    oldGroundTrimVolumes: PobVolume[] = [];
  let area = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i],
      b = rows[i + 1],
      poly = [a.vertices[0], b.vertices[0], b.vertices[3], a.vertices[3]],
      lo = Math.min(...a.vertices.map((v) => v.y), ...b.vertices.map((v) => v.y));
    volumes.push(options.makeVolume(poly, lo - 0.04, p.sourceCeiling));
    oldGroundTrimVolumes.push(options.makeVolume(poly, lo - 4, p.sourceCeiling));
    area += ((a.width + b.width) / 2) * (b.s - a.s);
  }
  let disposed = false;
  return {
    meshes,
    materials: [],
    colliderGeometries: meshes.map((m) => m.geometry),
    volumes,
    oldGroundTrimVolumes,
    contains,
    height,
    paved,
    local,
    rows,
    stats: {
      triangles: values.reduce((n, a) => n + a.length / 9, 0),
      rows: rows.length,
      areaM2: area,
      outerBoundaryX: p.outerX,
      sourceCeiling: p.sourceCeiling,
      callbackProvided: Boolean(options.fixedGroundHeight),
      placementEstimated: true,
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const m of meshes) m.geometry.dispose();
    },
  };
}
