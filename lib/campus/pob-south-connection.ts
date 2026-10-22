import * as T from "three";
import { closeGround, type TopTriangle } from "./closed-ground";
import { pobVolume, type PobVolume } from "./pob-frontage";

/** Replace the high south-cap soil strip with a graded connection to the
 * existing GDC ground. The lower edge is sampled from its actual triangles;
 * this is not a second analytic approximation of GDC's tessellated grade. */
export function buildPobSouthConnection(options: {
  concrete: T.MeshStandardMaterial;
  grass: T.MeshStandardMaterial;
  existingCapHeight: (x: number, z: number) => number;
  existingGroundHeight: (x: number, z: number) => number;
  gdcGround: T.Mesh;
}) {
  const west = 11.25,
    east = 26.069526722358884,
    north = -62.19388495307754;
  // Existing GDC frontage outline, not a new extent. The western edge stays in soil, just clear of Speedway paving;
  // extending the shoulder to it avoids
  // moving the old 0.69 m cliff onto the west edge of a narrow ramp.
  const southZ = (x: number) => -58.5 + ((x - 10.78) * 2.1) / 19.32;
  const finite = (y: number, label: string) => {
    if (!Number.isFinite(y)) throw new Error(`POB south connection needs ${label}`);
    return y;
  };
  options.gdcGround.updateWorldMatrix(true, false);
  const g = options.gdcGround.geometry,
    positions = g.attributes.position,
    indices = g.index,
    faces: T.Vector3[][] = [],
    xs = [west, 19, 19.85, east - 1.2, east];
  for (let i = 0; i < (indices?.count ?? positions.count); i += 3) {
    const f = [0, 1, 2].map((j) =>
      new T.Vector3()
        .fromBufferAttribute(positions, indices ? indices.getX(i + j) : i + j)
        .applyMatrix4(options.gdcGround.matrixWorld),
    );
    const normal = f[1].clone().sub(f[0]).cross(f[2].clone().sub(f[0])).normalize();
    if (normal.y < 0.5 || !f.some((p) => p.x >= west - 2 && p.x <= east + 2 && p.z < -55)) continue;
    faces.push(f);
    for (const p of f)
      if (p.x > west && p.x < east && Math.abs(p.z - southZ(p.x)) < 0.0001) xs.push(p.x);
  }
  const lower = (x: number) => {
    const z = southZ(x);
    for (const [a, b, c] of faces) {
      const den = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / den,
        v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / den;
      // Float32 source boundary differs from the declared outline by microns.
      // Only this numerical boundary tolerance permits plane extrapolation.
      if (Math.min(u, v, 1 - u - v) >= -0.00002) return u * a.y + v * b.y + (1 - u - v) * c.y;
    }
    throw new Error(`GDC backing floor missing at ${x},${z}`);
  };
  const upper = (x: number) =>
    x < 19
      ? finite(options.existingGroundHeight(x, north), "north soil edge")
      : finite(options.existingCapHeight(x, north), "north cap edge");
  const left = (v: number) =>
    v >= 1
      ? lower(west)
      : finite(
          options.existingGroundHeight(west, T.MathUtils.lerp(north, southZ(west), v)),
          "west soil edge",
        );
  const right = (v: number) => {
    const z = T.MathUtils.lerp(north, southZ(east), v);
    if (z <= -58)
      return finite(options.existingCapHeight(east, z), "existing south-apron shared edge");
    return T.MathUtils.lerp(
      finite(options.existingCapHeight(east, -58), "old cap end"),
      lower(east),
      (z + 58) / (southZ(east) + 58),
    );
  };
  const nw = upper(west),
    ne = upper(east),
    sw = lower(west),
    se = lower(east);
  // Coons interpolation preserves all four independently measured boundaries.
  // East stations retain the exact profile used by the south-facade apron.
  const point = (x: number, v: number) => {
    const u = (x - west) / (east - west),
      z = T.MathUtils.lerp(north, southZ(x), v);
    const y =
      (1 - v) * upper(x) +
      v * lower(x) +
      (1 - u) * left(v) +
      u * right(v) -
      ((1 - u) * (1 - v) * nw + u * (1 - v) * ne + (1 - u) * v * sw + u * v * se);
    return new T.Vector3(x, y, z);
  };
  for (let x = west + 0.7; x < east; x += 0.7) xs.push(x);
  xs.sort((a, b) => a - b);
  const columns = xs.filter((x, i) => !i || x - xs[i - 1] > 0.0001);
  const rows = [
    0,
    1,
    ...[-61.551220598189325, -61.5, -60.5, -59.5, -58.52868980410568, -58].map(
      (z) => (z - north) / (southZ(east) - north),
    ),
  ];
  rows.sort((a, b) => a - b);
  const top: TopTriangle[] = [];
  for (let j = 0; j < rows.length - 1; j++)
    for (let i = 0; i < columns.length - 1; i++) {
      const a = columns[i],
        b = columns[i + 1],
        v0 = rows[j],
        v1 = rows[j + 1],
        q = [point(a, v0), point(b, v0), point(b, v1), point(a, v1)],
        mid = (a + b) / 2,
        material = (mid >= 19 && mid <= 19.85) || mid >= east - 1.2 ? 0 : 1;
      top.push({ points: [q[0], q[1], q[2]], material }, { points: [q[0], q[2], q[3]], material });
    }
  const ground = closeGround(
    top,
    [options.concrete, options.grass],
    0.6,
    "POB59 south graded connection",
  );
  // Old ground is removed only where this closed replacement exists. The
  // upper ceiling is floor-scale; no facade or upper tree-row cleanup here.
  // One convex footprint avoids a clipping volume for every tessellation cell.
  const footprint = [point(west, 0), point(east, 0), point(east, 1), point(west, 1)],
    low = Math.min(...top.flatMap((f) => f.points.map((p) => p.y))),
    oldGroundTrimVolumes: PobVolume[] = [pobVolume(footprint, low - 1, 4.2)],
    volumes: PobVolume[] = [pobVolume(footprint, low - 0.04, 4.2)];
  // The previous soil has a vertical skirt exactly on GDC's north boundary.
  // Convex subtraction retains a coplanar boundary, so the floor-sized masks
  // alone leave that old wall standing. Continue ONLY the old-soil clearance
  // 35 mm into the existing, untouched GDC floor. That strip is backed by GDC,
  // not by an invented extension of this replacement's top.
  {
    const a = point(west, 1),
      b = point(east, 1),
      q = [
        a,
        b,
        b.clone().add(new T.Vector3(0, 0, 0.035)),
        a.clone().add(new T.Vector3(0, 0, 0.035)),
      ],
      lo = Math.min(a.y, b.y);
    oldGroundTrimVolumes.push(pobVolume(q, lo - 1, 4.2));
    volumes.push(pobVolume(q, lo - 0.06, 4.2));
  }
  let disposed = false;
  return {
    meshes: ground.meshes,
    colliderGeometries: ground.meshes.map((m) => m.geometry),
    materials: [] as T.MeshStandardMaterial[],
    ground,
    oldGroundTrimVolumes,
    volumes,
    contains: (x: number, z: number) => Number.isFinite(ground.height(x, z)),
    height: ground.height,
    paved: (x: number, z: number) =>
      Number.isFinite(ground.height(x, z)) && ((x >= 19 && x <= 19.85) || x >= east - 1.2),
    stats: {
      scope: "POB south-cap and soil shoulder to existing GDC north edge",
      approximateGrading: true,
      borrowedMaterials: 2,
      ownedMaterials: 0,
      batches: ground.meshes.length,
      triangles: ground.meshes.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0),
      cutVolumes: volumes.length,
      bounds: { west, east, north, southWest: southZ(west), southEast: southZ(east) },
      area: ((east - west) * (southZ(west) - north + (southZ(east) - north))) / 2,
      sharedSouthApronEdgePreserved: true,
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ground.meshes.forEach((m) => m.geometry.dispose());
    },
  };
}
