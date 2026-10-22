import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { pobVolume, type PobVolume } from "./pob-frontage";
import rawPlan from "./pob-boundaries-plan.json" with { type: "json" };
import frontagePlan from "./pob-frontage-plan.json" with { type: "json" };
import { closeGround, type TopTriangle } from "./closed-ground";
import roadTopology from "./pob-north-road-topology.json" with { type: "json" };
/** Adds ground only where a closed replacement exists. Roof/branch volumes
 * remain upper-only and must never be reused as a ground-registration mask. */
export function buildPobBoundaries(options: {
  concrete: T.MeshStandardMaterial;
  grass: T.MeshStandardMaterial;
  stone: T.MeshStandardMaterial;
  westYardHeight?: (x: number, z: number) => number;
  fixedGroundHeight?: (x: number, z: number) => number;
  fixedRoadHeight?: (x: number, z: number) => number;
}) {
  const p = rawPlan,
    origin = new T.Vector3(p.origin[0], 0, p.origin[1]),
    along = new T.Vector3(p.along[0], 0, p.along[1]),
    out = new T.Vector3(p.out[0], 0, p.out[1]);
  const point = (s: number, d: number, y = 0) =>
    origin.clone().addScaledVector(along, s).addScaledVector(out, d).setY(y);
  const local = (x: number, z: number) => {
    const v = new T.Vector3(x, 0, z).sub(origin);
    return { s: v.dot(along), d: v.dot(out) };
  };
  const interpolate = (rows: number[][], s: number) => {
    let i = 0;
    while (i < rows.length - 2 && s > rows[i + 1][0]) i++;
    return T.MathUtils.lerp(
      rows[i][1],
      rows[i + 1][1],
      T.MathUtils.clamp((s - rows[i][0]) / (rows[i + 1][0] - rows[i][0]), 0, 1),
    );
  };
  const fixed = (x: number, z: number, fallback: number) => {
    if (!options.fixedGroundHeight) return fallback;
    const y = options.fixedGroundHeight(x, z);
    if (!Number.isFinite(y)) throw new Error(`POB59 fixed edge missing at ${x},${z}`);
    return y;
  };
  const west = (x: number, z: number, fallback: number) => {
    if (!options.westYardHeight) return fallback;
    const y = options.westYardHeight(x, z);
    if (!Number.isFinite(y)) throw new Error(`POB59 west-yard edge missing at ${x},${z}`);
    return y;
  };
  const northJoin = west(p.origin[0] - 0.001, p.origin[1] + 0.001, 4.09284);
  const inner = (s: number) =>
    s >= p.pavilion[0] && s <= p.pavilion[1] ? p.pavilionInner : p.wingInner;
  const outer = (s: number) => interpolate(p.outerShape, s);
  const grade = (s: number, d: number) => {
    const i = inner(s),
      width = outer(s) - i,
      iy =
        s < 1.25
          ? T.MathUtils.lerp(northJoin, p.innerGrade[1][1], s / 1.25)
          : interpolate(p.innerGrade, s),
      oy = interpolate(p.outerGrade, s);
    return T.MathUtils.lerp(
      iy,
      oy,
      T.MathUtils.clamp((d - i - 0.4) / Math.max(0.4, width - 1.3), 0, 1),
    );
  };
  const top: TopTriangle[] = [],
    cells: T.Vector3[][] = [],
    pavedTriangles: TopTriangle[] = [];
  const addTop = (a: T.Vector3, b: T.Vector3, c: T.Vector3, paved: boolean) => {
    const f = { points: [a, b, c] as [T.Vector3, T.Vector3, T.Vector3], material: paved ? 0 : 1 };
    top.push(f);
    if (paved) pavedTriangles.push(f);
  };
  const quad = (v: T.Vector3[], paved: boolean, clearance = true) => {
    addTop(v[0], v[1], v[2], paved);
    addTop(v[0], v[2], v[3], paved);
    if (clearance) cells.push(v);
  };
  const ss = [0, p.length, ...p.pavilion, ...p.outerShape.map((v) => v[0])];
  for (let s = 2; s < p.length; s += 2) if (!ss.some((x) => Math.abs(x - s) < 0.25)) ss.push(s);
  ss.sort((a, b) => a - b);
  const stations = ss.filter((s, i) => !i || s - ss[i - 1] > 1e-7);
  // Identical depth breakpoints on both sides of pavilion corners share exact
  // vertices. No sub-centimeter station strips and no hidden vertical seams.
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i],
      b = stations[i + 1],
      mid = (a + b) / 2,
      central = mid > p.pavilion[0] && mid < p.pavilion[1];
    const depths = (s: number) => [p.wingInner, 0.55, 1.2, p.pavilionInner, outer(s)];
    const aa = depths(a),
      bb = depths(b);
    for (let j = central ? 3 : 0; j < 4; j++) {
      const y = (s: number, d: number) => {
        const sample = central
          ? T.MathUtils.clamp(s, p.pavilion[0] + 1e-6, p.pavilion[1] - 1e-6)
          : s === p.pavilion[0]
            ? s - 1e-6
            : s === p.pavilion[1]
              ? s + 1e-6
              : s;
        return grade(sample, d);
      };
      // Shared step-edge heights come from a global outer profile, avoiding a
      // cross-section discontinuity at the projected pavilion corners.
      const vertex = (s: number, d: number) => {
        let h = y(s, d);
        if (Math.abs(s - p.pavilion[0]) < 1e-6 || Math.abs(s - p.pavilion[1]) < 1e-6)
          h = interpolate(p.outerGrade, s);
        return point(s, d, h);
      };
      const v = [vertex(a, aa[j]), vertex(b, bb[j]), vertex(b, bb[j + 1]), vertex(a, aa[j + 1])];
      const paved = central || j === 0 || j >= 2 || mid < 2.2;
      quad(v, paved, false);
    }
    const first = central ? p.pavilionInner : p.wingInner;
    const sectionY = (s: number, d: number) =>
      Math.abs(s - p.pavilion[0]) < 1e-6 || Math.abs(s - p.pavilion[1]) < 1e-6
        ? interpolate(p.outerGrade, s)
        : grade(s, d);
    cells.push([
      point(a, first, sectionY(a, first)),
      point(b, first, sectionY(b, first)),
      point(b, outer(b), sectionY(b, outer(b))),
      point(a, outer(a), sectionY(a, outer(a))),
    ]);
  }
  // Northwest corner closes the turn from the accepted west walk. Its two
  // north control points retain measured existing support rather than flattening
  // the whole junction to the lower north-frontage grade.
  const firstOuter = point(0, outer(0), interpolate(p.outerGrade, 0));
  const corner = [
    new T.Vector3(19, west(19, p.origin[1] + 0.001, northJoin), p.origin[1]),
    point(0, p.wingInner, northJoin),
    point(0, 0.55, grade(0, 0.55)),
    point(0, 1.2, grade(0, 1.2)),
    point(0, p.pavilionInner, grade(0, p.pavilionInner)),
    firstOuter,
    new T.Vector3(30, 3.97884, -118),
    new T.Vector3(26.85, T.MathUtils.lerp(fixed(25, -118, 4.06512), 3.97884, 1.85 / 5), -118),
    new T.Vector3(25, fixed(25, -118, 4.06512), -118),
    new T.Vector3(19, fixed(19, -118, 4.06602), -118),
  ];
  // This convex corner uses an interior fan to preserve EVERY graded boundary
  // vertex. Earcut legitimately drops collinear XZ points, but their Y values
  // are not collinear; dropping them created a small physical seam.
  const cornerCenter = new T.Vector3(25.5, 4.015, -116.45);
  for (let i = 0; i < corner.length; i++) {
    const f = [corner[i], corner[(i + 1) % corner.length], cornerCenter];
    addTop(f[0], f[1], f[2], true);
    cells.push(f);
  }
  // The live north approach exposed an existing unsupported strip immediately
  // outside the first corner (X28/29,Z-120/-119). Close only that transition.
  // The south edge reuses the split corner edge above, so no T-junction or
  // duplicated vertical collision wall is introduced at Z-118.
  const northEntryRows = [
    { z: -121.2, eastX: 31.1, eastY: 4.07369 },
    { z: -120, eastX: 31.1, eastY: 4.07369 },
    { z: -119, eastX: 31.1, eastY: 3.67251 },
    { z: -118, eastX: 30, eastY: 3.97884 },
  ].map((row) => ({
    ...row,
    westY:
      row.z === -118
        ? T.MathUtils.lerp(fixed(25, -118, 4.06512), 3.97884, 1.85 / 5)
        : fixed(26.85, row.z, 4.0616 + (row.z + 120) * 0.001615),
  }));
  for (let i = 0; i < northEntryRows.length - 1; i++) {
    const a = northEntryRows[i],
      b = northEntryRows[i + 1];
    quad(
      [
        new T.Vector3(26.85, a.westY, a.z),
        new T.Vector3(a.eastX, a.eastY, a.z),
        new T.Vector3(b.eastX, b.eastY, b.z),
        new T.Vector3(26.85, b.westY, b.z),
      ],
      true,
    );
  }
  // This residual source fold is attached to the street near Y3.02; an air
  // cut alone would either leave a stub or remove its only floor. Replace its
  // 5.565m² projection with the exact plane observed by two live low rays.
  const lowRoadPlane = (x: number, z: number) =>
    3.064078083199089 -
    (0.09148696288746307 / 0.9952765346630678) * (x - 46.65) +
    (0.032476994483842274 / 0.9952765346630678) * (z + 120.6);
  quad(
    [
      [45.55, -121.85],
      [47.65, -121.85],
      [47.65, -119.2],
      [45.55, -119.2],
    ].map(([x, z]) => new T.Vector3(x, lowRoadPlane(x, z), z)),
    true,
  );
  // The live east/west crossing exposed a continuous road-to-apron gap.
  // Keep the accepted small measured plane, but surround it with one closed
  // connection to the fixed north road and the exact existing apron/NW edges.
  const roadFallback = [
    [26.85, 3.7266906952],
    [28, 3.6941758031],
    [30, 3.6338295322],
    [32, 3.5531668369],
    [34, 3.4822505963],
    [38, 3.3462267347],
    [40, 3.302015279],
    [44, 3.248795925],
    [48, 3.2149557543],
    [49, 3.2063061655],
  ];
  const roadHeight = (x: number, z: number) => {
    if (!options.fixedRoadHeight) return interpolate(roadFallback, x);
    const y = options.fixedRoadHeight(x, z);
    if (!Number.isFinite(y)) throw new Error(`POB59 fixed north road missing at ${x},${z}`);
    return y;
  };
  const apronEdge = stations
    .filter((s) => s <= 18)
    .map((s) => point(s, outer(s), interpolate(p.outerGrade, s)));
  const eastX = apronEdge.at(-1)!.x;
  // Root's low-origin X49 samples plus their actual upward normals. Moving
  // this edge west by 0.069m follows each measured local plane, not a guessed
  // continuation across the larger western hole.
  const eastSamples = [
    [-121, 2.9048512967, 0.0163645611, 0.9913044583],
    [-120, 2.8676418308, 0.0914868245, 0.9952765503],
    [-119, 2.751007015, 0.0257615859, 0.9996237859],
    [-118.5, 2.7462981363, 0.0257615859, 0.9996237859],
  ];
  const roadXs = [26.85, 27.5, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, eastX];
  const outline = [
    ...roadXs.map((x) => new T.Vector3(x, roadHeight(x, -124), -124)),
    new T.Vector3(eastX, roadHeight(eastX, -122.5), -122.5),
    ...eastSamples.map(([z, y, nx, ny]) => new T.Vector3(eastX, y - (nx / ny) * (eastX - 49), z)),
    ...apronEdge.slice().reverse(),
    corner[6].clone(),
    ...northEntryRows
      .slice()
      .reverse()
      .slice(1)
      .map((r) => new T.Vector3(r.eastX, r.eastY, r.z)),
    new T.Vector3(26.85, northEntryRows[0].westY, -121.2),
  ];
  const island = [
    [45.55, -121.85],
    [47.65, -121.85],
    [47.65, -119.2],
    [45.55, -119.2],
  ].map(([x, z]) => new T.Vector3(x, lowRoadPlane(x, z), z));
  const vertices = [...outline, ...island];
  // The XZ triangulation and harmonic interpolation weights are baked offline.
  // Runtime only evaluates the actual boundary callbacks and weighted heights.
  if (vertices.length !== roadTopology.fixedXZ.length)
    throw new Error("POB59 road topology boundary changed");
  vertices.forEach((v, i) => {
    const p = roadTopology.fixedXZ[i];
    if (Math.hypot(v.x - p[0], v.z - p[1]) > 1e-8)
      throw new Error("POB59 road topology needs regeneration");
  });
  roadTopology.freeXZ.forEach(([x, z], i) => {
    const y = roadTopology.heightWeights[i].reduce((sum, w, j) => sum + w * vertices[j].y, 0);
    vertices.push(new T.Vector3(x, y, z));
  });
  const faces = roadTopology.faces,
    clearanceFaces = roadTopology.clearanceFaces;
  for (const face of faces) {
    const v = face.map((i) => vertices[i]);
    if (v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).lengthSq() < 1e-15)
      throw new Error(JSON.stringify({ face, v }));
    addTop(v[0], v[1], v[2], true);
  }
  // Keep source repair inexpensive: the coarse constrained outline triangles
  // cover the same ring as the refined floor. Use the ring's lowest floor as
  // a conservative lower clearance, with closed replacement under every cut.
  const connectionFloorMin = Math.min(...vertices.map((v) => v.y));
  for (const face of clearanceFaces)
    cells.push(face.map((i) => vertices[i].clone().setY(connectionFloorMin)));
  const south = p.southCap,
    swrows = [south.north, -61.5, -60.5, -59.5, south.south].sort((a, b) => a - b);
  const capHeight = (x: number, z: number) => {
    const u = (z - south.north) / (south.south - south.north);
    if (u < 1e-10) return west(x, south.north - 0.001, south.outerNorth);
    const edge = fixed(19, z, T.MathUtils.lerp(south.outerNorth, south.outerSouth, u));
    const innerY = T.MathUtils.lerp(
      west(south.east, south.north - 0.001, south.outerNorth),
      south.innerSouth,
      u,
    );
    return T.MathUtils.lerp(
      edge,
      innerY,
      T.MathUtils.clamp((x - 19 - 0.85) / (south.east - 19 - 1.7), 0, 1),
    );
  };
  const capXs = [19, 19.85, south.east - 1.2, south.east];
  for (let i = 0; i < swrows.length - 1; i++)
    for (let j = 0; j < capXs.length - 1; j++) {
      const v = [
        [capXs[j], swrows[i]],
        [capXs[j + 1], swrows[i]],
        [capXs[j + 1], swrows[i + 1]],
        [capXs[j], swrows[i + 1]],
      ].map(([x, z]) => new T.Vector3(x, capHeight(x, z), z));
      quad(v, j === 0 || j === 2);
    }
  const ground = closeGround(
    top,
    [options.concrete, options.grass],
    p.shellDepth,
    "POB59 boundary ground",
  );
  const volumes: PobVolume[] = [],
    oldGroundTrimVolumes: PobVolume[] = [];
  for (const cell of cells) {
    const lo = Math.min(...cell.map((v) => v.y));
    volumes.push(pobVolume(cell, lo - 0.04, p.sourceCeiling));
    oldGroundTrimVolumes.push(pobVolume(cell, lo - 4, p.sourceCeiling));
  }
  const upperVolumes = p.upperZones.map((zone) =>
    pobVolume(
      [
        point(zone.s[0], zone.d[0]),
        point(zone.s[1], zone.d[0]),
        point(zone.s[1], zone.d[1]),
        point(zone.s[0], zone.d[1]),
      ],
      zone.y[0],
      zone.y[1],
    ),
  );
  // A narrow closed stone foundation meets low north grades below the old Y3
  // facade base. It occupies the existing wall depth, never the pedestrian lane.
  const foundationParts: T.BufferGeometry[] = [];
  for (let e = 0; e < frontagePlan.north.length - 1; e++) {
    const a = frontagePlan.north[e],
      b = frontagePlan.north[e + 1],
      o = new T.Vector3(a[0], 0, a[1]),
      u = new T.Vector3(b[0] - a[0], 0, b[1] - a[1]),
      length = u.length();
    u.divideScalar(length);
    const n = u.clone().cross(new T.Vector3(0, 1, 0)),
      basis = new T.Matrix4().makeBasis(u, new T.Vector3(0, 1, 0), n).setPosition(o);
    const count = Math.ceil(length / 2);
    for (let k = 0; k < count; k++) {
      const x = ((k + 0.5) * length) / count,
        w = length / count + 0.002,
        world = o.clone().addScaledVector(u, x),
        q = local(world.x, world.z),
        lo =
          Math.min(grade(T.MathUtils.clamp(q.s, 0, p.length), Math.max(q.d, inner(q.s))), 3) - 0.5,
        hi = 3.2;
      const g = new T.BoxGeometry(w, hi - lo, 0.44);
      g.translate(x, (hi + lo) / 2, -0.2);
      g.applyMatrix4(basis);
      foundationParts.push(g);
    }
  }
  const fg = mergeGeometries(foundationParts, false)!;
  foundationParts.forEach((g) => g.dispose());
  fg.computeBoundingBox();
  fg.computeBoundingSphere();
  const foundation = new T.Mesh(fg, options.stone);
  foundation.name = "POB59 closed north limestone foundation";
  foundation.castShadow = true;
  foundation.receiveShadow = true;
  const meshes = [...ground.meshes, foundation],
    contains = (x: number, z: number) => Number.isFinite(ground.height(x, z));
  const inTriangle = (x: number, z: number, face: TopTriangle) => {
    const [a, b, c] = face.points,
      den = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z),
      u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / den,
      v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / den;
    return u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7;
  };
  let disposed = false;
  return {
    meshes,
    materials: [] as T.MeshStandardMaterial[],
    colliderGeometries: meshes.map((m) => m.geometry),
    volumes: [...volumes, ...upperVolumes],
    groundVolumes: volumes,
    upperVolumes,
    oldGroundTrimVolumes,
    contains,
    height: ground.height,
    paved: (x: number, z: number) => pavedTriangles.some((f) => inTriangle(x, z, f)),
    local,
    point,
    stations,
    ground,
    trees: [],
    stats: {
      scope: p.scope,
      placementEstimated: true,
      triangles: meshes.reduce(
        (n, m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3,
        0,
      ),
      batches: meshes.length,
      ownedMaterials: 0,
      groundVolumes: volumes.length,
      upperVolumes: upperVolumes.length,
      sourceCeiling: p.sourceCeiling,
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      meshes.forEach((m) => m.geometry.dispose());
    },
  };
}
