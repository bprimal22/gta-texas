import * as T from 'three';
import rawPlan from './welch-west-gap-plan.json' with { type: 'json' };
type Face = [T.Vector3, T.Vector3, T.Vector3];
type Volume = { planes: T.Plane[]; bounds: T.Box3 };
export function buildWelchWestGap(options: {
  concrete: T.MeshStandardMaterial;
  grass: T.MeshStandardMaterial;
}) {
  const plan = rawPlan,
    origin = new T.Vector3(plan.origin[0], 0, plan.origin[1]),
    along = new T.Vector3(...(plan.along as [number, number, number])),
    out = new T.Vector3(...(plan.out as [number, number, number]));
  const point = (s: number, d: number, y = 0) =>
    origin.clone().addScaledVector(along, s).addScaledVector(out, d).setY(y);
  const local = (x: number, z: number) => {
    const p = new T.Vector3(x, 0, z).sub(origin);
    return { s: p.dot(along), d: p.dot(out) };
  };
  const rows = plan.rows.map((r) => ({
    ...r,
    vertices: r.vertices.map((v) => ({
      t: v.t,
      p: new T.Vector3(...(v.p as [number, number, number])),
    })),
  }));
  const isPavedLocal = ({s,d}: {s:number;d:number}) => {
    const q=T.MathUtils.smoothstep(s,plan.pathCenter.blendStart,plan.length);
    const center=T.MathUtils.lerp(plan.pathCenter.east,plan.pathCenter.west,q);
    let i=0;while(i<rows.length-2&&s>rows[i+1].s)i++;
    const a=rows[i],b=rows[i+1],t=T.MathUtils.clamp((s-a.s)/(b.s-a.s),0,1);
    const width=T.MathUtils.lerp(a.width,b.width,t);
    return s<=plan.eastCrossWidth || Math.abs(d-center)<=plan.pathWidth/2+1e-6 || d>=width-plan.roadWalkWidth-1e-6;
  };
  const values: number[][] = [[], []],
    uvs: number[][] = [[], []],
    groundFaces: Face[] = [],
    walkFaces: Face[] = [],
    componentStats: { name: string; triangles: number }[] = [];
  const tri = (
    a: T.Vector3,
    b: T.Vector3,
    c: T.Vector3,
    mat: number,
    up = false,
  ) => {
    if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() < 1e-14)
      return null;
    const f: Face =
      up && b.clone().sub(a).cross(c.clone().sub(a)).y < 0
        ? [a, c, b]
        : [a, b, c];
    for (const p of f) {
      values[mat].push(...p.toArray());
      uvs[mat].push(p.x * 0.5, p.z * 0.5);
    }
    return f;
  };
  const top = (a: T.Vector3, b: T.Vector3, c: T.Vector3) => {
    const p = a
        .clone()
        .add(b)
        .add(c)
        .multiplyScalar(1 / 3),
      f = tri(a, b, c, isPavedLocal(local(p.x, p.z)) ? 0 : 1, true);
    if (!f) return;
    groundFaces.push(f);
    const q = f.map((p) =>
      p.clone().add(new T.Vector3(0, -plan.shellDepth, 0)),
    ) as Face;
    tri(q[0], q[2], q[1], 1);
  };
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i].vertices,
      b = rows[i + 1].vertices;
    let ai = 0,
      bi = 0;
    while (ai < a.length - 1 || bi < b.length - 1) {
      const an = a[ai + 1],
        bn = b[bi + 1];
      if (an && bn && Math.abs(an.t - bn.t) < 1e-9) {
        top(a[ai].p, b[bi].p, an.p);
        top(an.p, b[bi].p, bn.p);
        ai++;
        bi++;
      } else if (an && (!bn || an.t < bn.t)) {
        top(a[ai].p, b[bi].p, an.p);
        ai++;
      } else if (bn) {
        top(a[ai].p, b[bi].p, bn.p);
        bi++;
      } else break;
    }
  }
  const perimeter = [
    ...rows.map((r) => r.vertices[0].p),
    ...rows
      .at(-1)!
      .vertices.slice(1)
      .map((v) => v.p),
    ...rows
      .slice(0, -1)
      .reverse()
      .map((r) => r.vertices.at(-1)!.p),
    ...rows[0].vertices
      .slice(1, -1)
      .reverse()
      .map((v) => v.p),
  ];
  const center = point(plan.length / 2, 10);
  const walls = (
    a: T.Vector3,
    b: T.Vector3,
    aa: T.Vector3,
    bb: T.Vector3,
    mat: number,
  ) => {
    const mid = a.clone().add(b).multiplyScalar(0.5),
      normal = b.clone().sub(a).cross(bb.clone().sub(a));
    if (normal.dot(mid.clone().sub(center).setY(0)) >= 0) {
      tri(a, b, bb, mat);
      tri(a, bb, aa, mat);
    } else {
      tri(a, bb, b, mat);
      tri(a, aa, bb, mat);
    }
  };
  for (let i = 0; i < perimeter.length; i++) {
    const a = perimeter[i],
      b = perimeter[(i + 1) % perimeter.length];
    walls(
      a,
      b,
      a.clone().add(new T.Vector3(0, -plan.shellDepth, 0)),
      b.clone().add(new T.Vector3(0, -plan.shellDepth, 0)),
      1,
    );
  }
  const terrainTrianglesByMaterial = values
      .slice(0, 2)
      .map((v) => v.length / 9),
    terrainTriangles = (values[0].length + values[1].length) / 9;
  componentStats.push({
    name: 'Closed continuous terrain',
    triangles: terrainTriangles,
  });
  const bary = (x: number, z: number, [a, b, c]: Face) => {
    const den = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(den) < 1e-12) return null;
    const wa = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / den,
      wb = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / den,
      wc = 1 - wa - wb;
    return Math.min(wa, wb, wc) >= -1e-7
      ? wa * a.y + wb * b.y + wc * c.y
      : null;
  };
  const terrainHeight = (x: number, z: number) => {
    for (const f of groundFaces) {
      const y = bary(x, z, f);
      if (y !== null) return y;
    }
    return NaN;
  };
  const meshes = values.map((v, i) => {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(v, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uvs[i], 2));
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const m = new T.Mesh(g, [options.concrete, options.grass][i]);
    m.name = [
      'Welch west gap: continuous north sidewalk',
      'Welch west gap: closed planting ground',
    ][i];
    m.receiveShadow = true;
    m.castShadow = true;
    return m;
  });
  const height = (x: number, z: number) => {
    let y = terrainHeight(x, z);
    if (!Number.isFinite(y)) return y;
    for (const f of walkFaces) {
      const h = bary(x, z, f);
      if (h !== null) y = Math.max(y, h);
    }
    return y;
  };
  const contains = (x: number, z: number) =>
    Number.isFinite(terrainHeight(x, z));
  const paved = (x: number, z: number) => contains(x,z)&&isPavedLocal(local(x,z));
  const volume = (p: T.Vector3[], low: number, high: number): Volume => {
    const c = p
        .reduce((a, b) => a.add(b), new T.Vector3())
        .multiplyScalar(1 / p.length),
      planes = p.map((a, i) => {
        const b = p[(i + 1) % p.length],
          q = new T.Plane().setFromNormalAndCoplanarPoint(
            new T.Vector3(b.z - a.z, 0, a.x - b.x).normalize(),
            a,
          );
        if (q.distanceToPoint(c) > 0) q.negate();
        return q;
      });
    planes.push(
      new T.Plane(new T.Vector3(0, -1, 0), low),
      new T.Plane(new T.Vector3(0, 1, 0), -high),
    );
    const bounds = new T.Box3().setFromPoints(p);
    bounds.min.y = low;
    bounds.max.y = high;
    return { planes, bounds };
  };
  const sourceClearanceVolumes: Volume[] = [],
    oldGroundTrimVolumes: Volume[] = [];
  let area = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i],
      b = rows[i + 1],
      p = [
        a.vertices[0].p,
        b.vertices[0].p,
        b.vertices.at(-1)!.p,
        a.vertices.at(-1)!.p,
      ],
      low = Math.min(
        ...a.vertices.map((v) => v.p.y),
        ...b.vertices.map((v) => v.p.y),
      );
    const source = p.map((v, j) =>
      j < 2 ? v.clone().addScaledVector(out, plan.sourceWallInset) : v.clone(),
    );
    sourceClearanceVolumes.push(volume(source, low - 0.04, plan.sourceCeiling));
    oldGroundTrimVolumes.push(volume(p, low - 4, plan.sourceCeiling));
    area +=
      Math.abs(
        p.reduce(
          (sum, v, k) => sum + v.x * p[(k + 1) % 4].z - p[(k + 1) % 4].x * v.z,
          0,
        ),
      ) / 2;
  }
  const trees = plan.treeSuggestions.map((t) => {
    const p = point(t.s, t.d);
    return {
      x: p.x,
      z: p.z,
      y: height(p.x, p.z) - 0.025,
      rotation: t.rotation,
      scale: t.scale,
    };
  });
  let disposed = false;
  return {
    meshes,
    materials: [],
    colliderGeometries: meshes.map((m) => m.geometry),
    volumes: sourceClearanceVolumes,
    sourceClearanceVolumes,
    oldGroundTrimVolumes,
    authoredGroundTrimVolumes: oldGroundTrimVolumes,
    height,
    terrainHeight,
    contains,
    inside: contains,
    paved,
    local,
    trees,
    stats: {
      scope: plan.scope,
      length: plan.length,
      areaM2: area,
      rows: rows.length,
      triangles: values.reduce((n, v) => n + v.length / 9, 0),
      terrainTriangles,
      terrainTrianglesByMaterial,
      materialBatches: meshes.length,
      ownedMaterials: 0,
      sourceCutVolumes: sourceClearanceVolumes.length,
      sourceCeiling: plan.sourceCeiling,
      placementEstimated: true,
      componentStats,
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const m of meshes) m.geometry.dispose();
      
    },
  };
}
