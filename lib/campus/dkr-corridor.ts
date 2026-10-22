import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import plan from './data/dkr-surfaces.json' with { type: 'json' };
import type { CutVolume } from './clip-volume';

type Point = [number, number];
const profile = (knots: number[][], value: number) => {
  if (value <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++)
    if (value <= knots[i][0]) {
      const a = knots[i - 1],
        b = knots[i];
      return T.MathUtils.lerp(a[1], b[1], (value - a[0]) / (b[0] - a[0]));
    }
  return knots.at(-1)![1];
};
// Calibrated source-ground measurements, not the bare-earth grid: the bridge
// stands about two metres above that grid. Outlying canopy/rail hits are omitted.
const road24 = [
  [120, 1.49],
  [137, 0.66],
  [148, -0.15],
  [159, -0.94],
  [173, -1.89],
  [188, -2.82],
  [202, -3.25],
  [217, -3.89],
  [230, -4.12],
  [245, -4.8],
  [260, -5.36],
  [285, -5.39],
  [296, -5.3],
  [312, -5.18],
  [330, -4.87],
  [348, -4.69],
];
const sanJac = [
  [-110, -4.69],
  [-99, -4.69],
  [-80, -4.65],
  [-60, -4.3],
  [-40, -4.06],
  [-20, -3.84],
  [0, -3.72],
  [30, -3.82],
  [50, -4.07],
  [70, -4.57],
  [81.365, -5.08],
  [100, -5.62],
  [112.69, -6.05],
  [130, -6.45],
  [146, -6.99],
  [160.7, -7.46],
  [175.49, -7.79],
  [195.34, -7.86],
  [207, -7.82],
  [225, -8.42],
  [241, -8.62],
  [255, -8.52],
  [270, -8.68],
];
export const dkrRoute: Point[] = [
  [192.907, -129.396],
  [188.956, -129.784],
  [188.351, -121.071],
  [187.87, -114.265],
  [208, -112.7],
  [216.343, -111.716],
  [224.994, -110.94],
  [245, -109.67],
  [260, -108.95],
  [280, -107.48],
  [285.5, -107.1],
  [300, -105.9],
  [312, -104.88],
  [314, -104.65],
  [318, -102.6],
  [323.226, -100.93],
  [336.53, -100.154],
  [347.854, -99.522],
  [357.534, -98.979],
  [357.515, -93.891],
  [357.371, -46.036],
  [356.63, -21.261],
  [355.9, -6.219],
  [349.55, 46.901],
  [344.509, 81.365],
  [344.086, 87.838],
  [342.856, 100.941],
  [342.442, 105.386],
  [342.856, 108.157],
  [337.713, 112.691],
  [333.618, 140.326],
  [331.878, 151.888],
  [336.184, 160.734],
  [334.358, 172.074],
  [328.59, 175.488],
  [325.668, 192.604],
  [318.612, 241.467],
  [316.7, 268],
];

/** City road/sidewalk footprints form one street section. The route is an
 * exterior connection; this does not remodel stadium entrances or interiors.
 */
export function buildDkrCorridor(
  sourceConcrete: T.MeshStandardMaterial,
  approachHeight: (x: number, z: number) => number,
) {
  const height = (x: number, z: number, kind = 'concrete') => {
    const west = T.MathUtils.lerp(
      approachHeight(x, z),
      profile(road24, x),
      T.MathUtils.smoothstep(x, 120, 140),
    );
    const road = T.MathUtils.lerp(
      west,
      profile(sanJac, z),
      Math.max(
        T.MathUtils.smoothstep(x, 328, 349),
        T.MathUtils.smoothstep(z, -110, -90),
      ),
    );
    return road + (kind === 'concrete' ? 0.15 : 0);
  };
  const concrete = new T.MeshStandardMaterial({
    map: sourceConcrete.map,
    color: 0xffffff,
    roughness: 0.94,
  });
  const asphalt = new T.MeshStandardMaterial({
    map: sourceConcrete.map,
    color: 0xffffff,
    roughness: 0.98,
  });
  for (const [material, road] of [
    [concrete, false],
    [asphalt, true],
  ] as const) {
    material.onBeforeCompile = (s) => {
      s.vertexShader = 'varying vec2 streetMetres;\n' + s.vertexShader;
      s.vertexShader = s.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nstreetMetres=position.xz;',
      );
      s.fragmentShader = 'varying vec2 streetMetres;\n' + s.fragmentShader;
      s.fragmentShader = s.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float tone=smoothstep(.02,.45,dot(diffuseColor.rgb,vec3(.2126,.7152,.0722)));
        diffuseColor.rgb=${road ? 'mix(vec3(.085,.088,.084),vec3(.15,.155,.145),tone)' : 'mix(vec3(.45,.44,.40),vec3(.64,.63,.57),tone)'};`,
      );
      if (!road)
        s.fragmentShader = s.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
        vec2 p=streetMetres, q=p/2.4;
        vec2 e=min(fract(q),1.-fract(q))*2.4;
        float aa=max(max(fwidth(p.x),fwidth(p.y)),.0001);
        diffuseColor.rgb*=1.-(1.-smoothstep(.003,.003+aa,min(e.x,e.y)))*.15;`,
        );
    };
    material.customProgramCacheKey = () =>
      `dkr-street-${road ? 'asphalt' : 'concrete'}-v1`;
  }
  const metal = new T.MeshStandardMaterial({
    color: 0x353d3b,
    metalness: 0.45,
    roughness: 0.58,
  });
  const batches: Record<string, T.BufferGeometry[]> = {
    asphalt: [],
    concrete: [],
  };
  const volumes: CutVolume[] = [];
  const cellRings: Point[][] = [];
  const cellKinds: string[] = [];
  let planarSlivers = 0;
  for (const cell of plan.surfaces) {
    // Preprocessing supplies convex cells with no holes. Shared cell edges use
    // identical heights, and physics receives these same triangle buffers.
    const ring = (cell.rings[0] as Point[]).filter(
      (p, i, r) =>
        i === 0 || Math.hypot(p[0] - r[i - 1][0], p[1] - r[i - 1][1]) > 1e-8,
    );
    if (ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1])
      ring.pop();
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i],
        b = ring[(i + 1) % ring.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (ring.length < 3 || Math.abs(area) < 1e-8) continue;
    if (area < 0) ring.reverse();
    cellRings.push(ring);
    cellKinds.push(cell.kind);
    const top = ring.map(
      ([x, z]) => new T.Vector3(x, height(x, z, cell.kind), z),
    );
    // A few map-boundary cells are metres long but less than a millimetre
    // wide. Sampling a curved height field independently at their corners
    // amplifies rounding into an artificial steep cross-slope. A plane along
    // the longest chord keeps these tiny seams physically flat across width.
    let longest = 0,
      chordA = top[0],
      chordB = top[1];
    for (const a of top)
      for (const b of top) {
        const d = (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
        if (d > longest) {
          longest = d;
          chordA = a;
          chordB = b;
        }
      }
    if (Math.abs(area) / (2 * Math.sqrt(longest)) < 0.001) {
      const ax = chordA.x,
        az = chordA.z,
        dx = chordB.x - ax,
        dz = chordB.z - az,
        ay = chordA.y,
        by = chordB.y;
      for (const p of top)
        p.y = T.MathUtils.lerp(
          ay,
          by,
          ((p.x - ax) * dx + (p.z - az) * dz) / longest,
        );
      planarSlivers++;
    }
    const onBridge =
      Math.min(...top.map((p) => p.x)) <= 315 &&
      Math.max(...top.map((p) => p.x)) >= 284 &&
      top.every((p) => p.z < -101);
    const depth = onBridge ? 0.48 : 1.45;
    const bottom = top.map((p) => p.clone().add(new T.Vector3(0, -depth, 0)));
    const positions: number[] = [],
      uv: number[] = [];
    const tri = (a: T.Vector3, b: T.Vector3, c: T.Vector3) => {
      for (const p of [a, b, c]) {
        positions.push(p.x, p.y, p.z);
        uv.push(p.x * 0.5, p.z * 0.5);
      }
    };
    for (let i = 1; i < ring.length - 1; i++) {
      tri(top[0], top[i + 1], top[i]);
      tri(bottom[0], bottom[i], bottom[i + 1]);
    }
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      tri(top[i], top[j], bottom[i]);
      tri(top[j], bottom[j], bottom[i]);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      'position',
      new T.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    geometry.computeVertexNormals();
    batches[cell.kind].push(geometry);
  }
  // The City's pavement and building outlines are not perfectly registered to
  // the streamed facade. Keep the measured stadium-wall safety margin out of
  // scan removal while retaining the same continuous foreground floors.
  for (const cell of plan.clearanceSurfaces) {
    const ring = (cell.rings[0] as Point[]).filter(
      (p, i, r) =>
        i === 0 || Math.hypot(p[0] - r[i - 1][0], p[1] - r[i - 1][1]) > 1e-8,
    );
    if (ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1])
      ring.pop();
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i],
        b = ring[(i + 1) % ring.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (ring.length < 3 || Math.abs(area) < 1e-8) continue;
    if (area < 0) ring.reverse();
    const top = ring.map(
      ([x, z]) => new T.Vector3(x, height(x, z, cell.kind), z),
    );
    const onBridge =
      Math.min(...top.map((p) => p.x)) <= 315 &&
      Math.max(...top.map((p) => p.x)) >= 284 &&
      top.every((p) => p.z < -101);
    const depth = onBridge ? 0.48 : 1.45;
    const bounds = new T.Box3().setFromPoints(top),
      low = bounds.min.y - depth + 0.025,
      high = bounds.max.y + 3.4;
    bounds.min.y = low;
    bounds.max.y = high;
    const planes = ring.map((a, i) => {
      const b = ring[(i + 1) % ring.length],
        normal = new T.Vector3(b[1] - a[1], 0, a[0] - b[0]).normalize();
      return new T.Plane().setFromNormalAndCoplanarPoint(
        normal,
        new T.Vector3(a[0], 0, a[1]),
      );
    });
    planes.push(
      new T.Plane(new T.Vector3(0, -1, 0), low),
      new T.Plane(new T.Vector3(0, 1, 0), -high),
    );
    volumes.push({ bounds, planes });
  }
  const meshes: T.Mesh[] = [],
    colliderGeometries: T.BufferGeometry[] = [];
  for (const [kind, parts] of Object.entries(batches)) {
    const geometry = mergeGeometries(parts)!;
    parts.forEach((g) => g.dispose());
    const mesh = new T.Mesh(geometry, kind === 'asphalt' ? asphalt : concrete);
    mesh.name = `24th and San Jacinto ${kind} surfaces`;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    meshes.push(mesh);
    colliderGeometries.push(geometry);
  }
  // The reference photos show a yellow curb along the stadium frontage.
  // Paint only actual concrete/asphalt boundaries; cell subdivision seams
  // and building-side apron edges must not acquire a stripe.
  const yellow = new T.MeshStandardMaterial({
    color: 0xb9a05e,
    roughness: 0.94,
  });
  const curbPositions: number[] = [],
    curbUv: number[] = [];
  const inAsphalt = (x: number, z: number) =>
    cellRings.some(
      (r, k) =>
        cellKinds[k] === 'asphalt' &&
        r.every((a, i) => {
          const b = r[(i + 1) % r.length];
          return (
            (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]) >= -1e-5
          );
        }),
    );
  for (let k = 0; k < cellRings.length; k++)
    if (cellKinds[k] === 'concrete') {
      const r = cellRings[k];
      for (let i = 0; i < r.length; i++) {
        const a = r[i],
          b = r[(i + 1) % r.length],
          dx = b[0] - a[0],
          dz = b[1] - a[1],
          length = Math.hypot(dx, dz);
        if (length < 0.05 || Math.min(a[1], b[1]) < 100) continue;
        const nx = dz / length,
          nz = -dx / length;
        if (
          !inAsphalt(
            (a[0] + b[0]) / 2 + nx * 0.03,
            (a[1] + b[1]) / 2 + nz * 0.03,
          )
        )
          continue;
        const pa = new T.Vector3(a[0], height(...a) + 0.001, a[1]),
          pb = new T.Vector3(b[0], height(...b) + 0.001, b[1]);
        const qa = pa.clone().add(new T.Vector3(-nx * 0.14, 0, -nz * 0.14)),
          qb = pb.clone().add(new T.Vector3(-nx * 0.14, 0, -nz * 0.14));
        for (const v of [
          pa,
          qa,
          pb,
          pb,
          qa,
          qb,
          pa,
          pb,
          pa.clone().add(new T.Vector3(0, -0.14, 0)),
          pb,
          pb.clone().add(new T.Vector3(0, -0.14, 0)),
          pa.clone().add(new T.Vector3(0, -0.14, 0)),
        ]) {
          curbPositions.push(v.x, v.y, v.z);
          curbUv.push(v.x, v.z);
        }
      }
    }
  if (curbPositions.length) {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      'position',
      new T.Float32BufferAttribute(curbPositions, 3),
    );
    geometry.setAttribute('uv', new T.Float32BufferAttribute(curbUv, 2));
    geometry.computeVertexNormals();
    const mesh = new T.Mesh(geometry, yellow);
    mesh.name = 'DKR yellow curb paint';
    mesh.receiveShadow = true;
    meshes.push(mesh);
  }
  // Open rectangular railing follows the City's outer bridge edges. Height,
  // member sizes and spacing approximate the historical UT photograph.
  const rails: T.BufferGeometry[] = [];
  const bar = (a: T.Vector3, b: T.Vector3, width: number) => {
    const d = b.clone().sub(a),
      g = new T.BoxGeometry(width, d.length(), width);
    g.applyQuaternion(
      new T.Quaternion().setFromUnitVectors(
        new T.Vector3(0, 1, 0),
        d.normalize(),
      ),
    );
    g.translate(...a.clone().lerp(b, 0.5).toArray());
    rails.push(g);
  };
  for (const [a, b] of [
    [
      [286.4, -122.4],
      [312, -120.16],
    ],
    [
      [286.4, -106.06],
      [312, -103.96],
    ],
  ] as [Point, Point][]) {
    const pa = new T.Vector3(a[0], height(...a), a[1]),
      pb = new T.Vector3(b[0], height(...b), b[1]);
    for (const h of [0.16, 1.1])
      bar(
        pa.clone().add(new T.Vector3(0, h, 0)),
        pb.clone().add(new T.Vector3(0, h, 0)),
        0.055,
      );
    const n = Math.ceil(pa.distanceTo(pb) / 0.36);
    for (let i = 0; i <= n; i++) {
      const p = pa.clone().lerp(pb, i / n),
        post = i % 5 === 0;
      bar(
        p.clone().add(new T.Vector3(0, post ? 0 : 0.16, 0)),
        p.clone().add(new T.Vector3(0, 1.1, 0)),
        post ? 0.065 : 0.032,
      );
    }
  }
  const railGeometry = mergeGeometries(rails)!;
  rails.forEach((g) => g.dispose());
  const railMesh = new T.Mesh(railGeometry, metal);
  railMesh.name = '24th bridge open metal railings';
  railMesh.castShadow = railMesh.receiveShadow = true;
  meshes.push(railMesh);
  colliderGeometries.push(railGeometry);
  const contains = (x: number, z: number) =>
    cellRings.some((r) =>
      r.every((a, i) => {
        const b = r[(i + 1) % r.length];
        return (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]) >= -1e-5;
      }),
    );
  const routeMeters = dkrRoute
    .slice(1)
    .reduce(
      (n, p, i) => n + Math.hypot(p[0] - dkrRoute[i][0], p[1] - dkrRoute[i][1]),
      0,
    );
  return {
    meshes,
    materials: [concrete, asphalt, metal, yellow],
    colliderGeometries,
    volumes,
    contains,
    height,
    route: dkrRoute,
    stats: {
      routeMeters: Math.round(routeMeters),
      surfaceCells: cellRings.length,
      clearanceCells: volumes.length,
      planarSlivers,
      triangles: meshes.reduce(
        (n, m) =>
          n +
          (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3,
        0,
      ),
    },
  };
}
