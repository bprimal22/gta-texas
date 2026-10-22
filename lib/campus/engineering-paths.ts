import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { subtractVolumes, type CutVolume } from './clip-volume';

export type EngineeringRoute = {
  name: string;
  points: [number, number][];
  width: number;
  height: (x: number, z: number) => number;
  underBridge?: boolean;
};
const lerpProfile = (knots: [number, number][], v: number) => {
  if (v <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++)
    if (v <= knots[i][0])
      return T.MathUtils.lerp(
        knots[i - 1][1],
        knots[i][1],
        (v - knots[i - 1][0]) / (knots[i][0] - knots[i - 1][0]),
      );
  return knots.at(-1)![1];
};
export const engineeringStair = {
  upper: [124.484, -224.329] as [number, number],
  lower: [123.59, -213.078] as [number, number],
  upperY: 7.15,
  lowerY: 4.48,
  width: 3,
  risers: 16,
  landing: 2.45,
};

/** Mapped exterior routes with heights fitted to live, calibrated source rays.
 * The narrow ground repair retains the campus buildings and bridge overhead.
 * The stair's total rise is registered; tread count/landing are approximate.
 */
export function buildEngineeringPaths(
  speedwayHeight: (x: number, z: number) => number,
  sourceConcrete: T.MeshStandardMaterial,
) {
  const concrete = new T.MeshStandardMaterial({
    map: sourceConcrete.map,
    color: 0xbdbbb1,
    roughness: 0.95,
  });
  concrete.name = 'Engineering concrete walks';
  concrete.onBeforeCompile = (s) => {
    s.vertexShader = 'varying vec2 engineeringMetres;\n' + s.vertexShader;
    s.vertexShader = s.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nengineeringMetres=position.xz;',
    );
    s.fragmentShader = 'varying vec2 engineeringMetres;\n' + s.fragmentShader;
    s.fragmentShader = s.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      float concreteTone=smoothstep(.02,.45,dot(diffuseColor.rgb,vec3(.2126,.7152,.0722)));
      diffuseColor.rgb=mix(vec3(.52,.51,.46),vec3(.69,.68,.61),concreteTone);`,
    );
    s.fragmentShader = s.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      vec2 p=engineeringMetres, q=p/3.0;
      vec2 edge=min(fract(q),1.0-fract(q))*3.0;
      float aa=max(max(fwidth(p.x),fwidth(p.y)),.0001);
      diffuseColor.rgb*=1.0-(1.0-smoothstep(.0025,.0025+aa,min(edge.x,edge.y)))*.13;`,
    );
  };
  concrete.customProgramCacheKey = () => 'engineering-concrete-walk-v2';
  const metal = new T.MeshStandardMaterial({
    color: 0x454d4b,
    metalness: 0.55,
    roughness: 0.5,
  });
  const westHeight = (x: number, z: number) =>
    T.MathUtils.lerp(
      speedwayHeight(x, z) + 0.02,
      lerpProfile(
        [
          [30, 5.35],
          [44, 5.26],
          [56, 5.14],
          [68, 5.25],
          [80, 4.94],
          [92, 4.85],
          [104, 4.72],
          [112, 5.8],
          [116, 5.8],
          [123.504, 7.15],
        ],
        x,
      ),
      T.MathUtils.smoothstep(x, 27, 43),
    );
  const upperHeight = (_x: number, z: number) =>
    7.15 + 0.001 * Math.max(0, -z - 227.1);
  const lowerHeight = (_x: number, z: number) =>
    lerpProfile(
      [
        [-213.078, 4.48],
        [-200, 3.45],
        [-180.787, 3.15],
        [-175.521, 3.12],
      ],
      z,
    );
  const southHeight = (x: number) =>
    lerpProfile(
      [
        [119.168, 3.12],
        [136, 2.98],
        [154, 2.46],
        [166, 1.86],
        [178, 0.15],
        [190, -1.89],
        [195.378, -2.25],
      ],
      x,
    );
  const eastHeight = (_x: number, z: number) =>
    lerpProfile(
      [
        [-168.316, -2.25],
        [-158, -2.33],
        [-146, -2.4],
        [-138, -2.48],
        [-129.031, -2.74],
      ],
      z,
    );
  const routes: EngineeringRoute[] = [
    {
      name: 'Speedway to EER west approach',
      points: [
        [26.85, -234.944],
        [30.895, -234.306],
        [47.515, -233.009],
        [82.948, -230.26],
        [123.504, -227.1],
      ],
      width: 2.4,
      height: westHeight,
    },
    {
      name: 'EER upper terrace',
      points: [
        [124.484, -224.329],
        [123.504, -227.1],
        [124.34, -234.195],
        [125.474, -246.178],
        [130, -245.845],
      ],
      width: 2.6,
      height: upperHeight,
    },
    {
      name: 'Passage below GLT bridge',
      points: [
        [123.59, -213.078],
        [119.543, -180.787],
        [119.168, -175.521],
      ],
      width: 2.6,
      height: lowerHeight,
      underBridge: true,
    },
    {
      name: 'EER lower south walk',
      points: [
        [119.168, -175.521],
        [195.378, -168.316],
      ],
      width: 2.8,
      height: southHeight,
      underBridge: true,
    },
    {
      name: 'GLT east sidewalk to 24th',
      points: [
        [195.378, -168.316],
        [192.907, -129.396],
        [196.8, -129.031],
      ],
      width: 2.8,
      height: eastHeight,
    },
  ];
  const groundParts: T.BufferGeometry[] = [],
    railParts: T.BufferGeometry[] = [],
    volumes: CutVolume[] = [];
  const stairOrigin = new T.Vector3(
    engineeringStair.upper[0],
    0,
    engineeringStair.upper[1],
  );
  const stairAxis = new T.Vector3(
    engineeringStair.lower[0],
    0,
    engineeringStair.lower[1],
  )
    .sub(stairOrigin)
    .normalize();
  const beyondStairTop: CutVolume = {
    planes: [
      new T.Plane().setFromNormalAndCoplanarPoint(
        stairAxis.clone().negate(),
        stairOrigin,
      ),
    ],
    bounds: new T.Box3(
      new T.Vector3(116, -10, -228),
      new T.Vector3(134, 20, -210),
    ),
  };
  function prism(
    a: T.Vector3,
    b: T.Vector3,
    n: T.Vector3,
    half: number,
    bottomA: number,
    bottomB: number,
  ) {
    const points = [
      a.clone().addScaledVector(n, -half),
      a.clone().addScaledVector(n, half),
      b.clone().addScaledVector(n, -half),
      b.clone().addScaledVector(n, half),
    ];
    points.push(
      ...points.map((p, i) => p.clone().setY(i < 2 ? bottomA : bottomB)),
    );
    const position: number[] = [],
      uv: number[] = [];
    // Upward top, underside, two sides and both end caps. The floor and collider
    // share these exact triangles, including vertical riser faces.
    for (const i of [
      0, 1, 2, 1, 3, 2, 4, 6, 5, 5, 6, 7, 0, 2, 4, 2, 6, 4, 1, 5, 3, 3, 5, 7, 0,
      4, 1, 1, 4, 5, 2, 3, 6, 3, 7, 6,
    ]) {
      const p = points[i];
      position.push(p.x, p.y, p.z);
      uv.push(p.x * 0.5, p.z * 0.5);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }
  function cut(
    a: T.Vector3,
    b: T.Vector3,
    n: T.Vector3,
    half: number,
    cap?: number,
  ) {
    const d = b.clone().sub(a).setY(0),
      len = d.length();
    d.normalize();
    const low = Math.min(a.y, b.y) - 2.5,
      high = Math.min(cap ?? Infinity, Math.max(a.y, b.y) + 3.6);
    const points = [
      a.clone().addScaledVector(n, -half),
      a.clone().addScaledVector(n, half),
      b.clone().addScaledVector(n, -half),
      b.clone().addScaledVector(n, half),
    ];
    const bounds = new T.Box3().setFromPoints(points).expandByScalar(0.16);
    bounds.min.y = low;
    bounds.max.y = high;
    const plane = (normal: T.Vector3, point: T.Vector3) =>
      new T.Plane().setFromNormalAndCoplanarPoint(normal, point);
    volumes.push({
      bounds,
      planes: [
        plane(d.clone().negate(), a.clone().addScaledVector(d, -0.15)),
        plane(d, b.clone().addScaledVector(d, 0.15)),
        plane(n.clone().negate(), a.clone().addScaledVector(n, -half)),
        plane(n, a.clone().addScaledVector(n, half)),
        new T.Plane(new T.Vector3(0, -1, 0), low),
        new T.Plane(new T.Vector3(0, 1, 0), -high),
      ],
    });
    return len;
  }
  let length = 0;
  for (const route of routes)
    for (let k = 1; k < route.points.length; k++) {
      const a = new T.Vector3(
          route.points[k - 1][0],
          0,
          route.points[k - 1][1],
        ),
        b = new T.Vector3(route.points[k][0], 0, route.points[k][1]);
      const d = b.clone().sub(a),
        len = d.length(),
        n = new T.Vector3(-d.z, 0, d.x).normalize(),
        cells = Math.ceil(len / 0.75);
      length += len;
      for (let i = 0; i < cells; i++) {
        const p = a.clone().lerp(b, i / cells),
          q = a.clone().lerp(b, (i + 1) / cells);
        // Overlap angled segment caps and the stair landing. The floor also
        // covers the cut's 15 cm border, so clearance leaves no open white seam.
        if (i === 0) p.addScaledVector(d, -0.12 / len);
        if (i === cells - 1) q.addScaledVector(d, 0.12 / len);
        p.y = route.height(p.x, p.z);
        q.y = route.height(q.x, q.z);
        let slab = prism(p, q, n, route.width / 2 + 0.18, p.y - 2.4, q.y - 2.4);
        if (route.name === 'EER upper terrace') {
          const clipped = subtractVolumes(slab, new T.Matrix4(), [
            beyondStairTop,
          ]);
          if (clipped) {
            slab.dispose();
            slab = clipped;
          }
        }
        groundParts.push(slab);
      }
      const cuts = Math.ceil(len / 4);
      for (let i = 0; i < cuts; i++) {
        const p = a.clone().lerp(b, i / cuts),
          q = a.clone().lerp(b, (i + 1) / cuts);
        p.y = route.height(p.x, p.z);
        q.y = route.height(q.x, q.z);
        // Narrow passage cuts stop below the existing bridge deck. No building
        // footprint is extruded down through this documented pedestrian opening.
        cut(
          p,
          q,
          n,
          route.width / 2 + 0.15,
          route.underBridge ? 7.05 : undefined,
        );
      }
    }
  const stair = engineeringStair,
    a = new T.Vector3(stair.upper[0], 0, stair.upper[1]),
    b = new T.Vector3(stair.lower[0], 0, stair.lower[1]);
  const direction = b.clone().sub(a),
    stairLength = direction.length();
  direction.normalize();
  const normal = new T.Vector3(-direction.z, 0, direction.x),
    run = (stairLength - stair.landing) / stair.risers,
    rise = (stair.upperY - stair.lowerY) / stair.risers;
  // An angled path cap cannot form a square stair landing: it leaves a crack
  // on one side and masks the first riser on the other. End the terrace at the
  // stair plane and fill its full width with a flat, closed top landing.
  const landingStart = a
      .clone()
      .addScaledVector(direction, -1.2)
      .setY(stair.upperY),
    landingEnd = a.clone().setY(stair.upperY);
  groundParts.push(
    prism(
      landingStart,
      landingEnd,
      normal,
      stair.width / 2 + 0.18,
      stair.lowerY - 2.4,
      stair.lowerY - 2.4,
    ),
  );
  cut(landingStart, landingEnd, normal, stair.width / 2 + 0.15);
  const steps: { start: number; end: number; y: number }[] = [];
  let offset = 0;
  // The top landing is a separate mapped route. The first tread is one riser
  // below it; the last tread meets the lower path exactly.
  for (let i = 1; i <= stair.risers; i++) {
    if (i === 9) {
      steps.push({
        start: offset,
        end: offset + stair.landing,
        y: stair.upperY - 8 * rise,
      });
      offset += stair.landing;
    }
    steps.push({
      start: offset,
      end: offset + run,
      y: stair.upperY - i * rise,
    });
    offset += run;
  }
  for (const step of steps) {
    const p = a.clone().addScaledVector(direction, step.start).setY(step.y),
      q = a.clone().addScaledVector(direction, step.end).setY(step.y);
    groundParts.push(
      prism(
        p,
        q,
        normal,
        stair.width / 2 + 0.18,
        stair.lowerY - 2.4,
        stair.lowerY - 2.4,
      ),
    );
    cut(
      p,
      q,
      normal,
      stair.width / 2 + 0.15,
      // The fixed lower-passage cap was too low for a capsule stepping up
      // beside the scanned terrace edge. Retain 2.3 m above each stair tread
      // for body height plus the normal autostep sweep; leave the bridge's
      // lower-path cap unchanged farther south.
      Math.min(p.z, q.z) > -217 ? Math.max(7.05, step.y + 2.3) : undefined,
    );
  }
  const tube = (p: T.Vector3, q: T.Vector3, r: number) => {
    const delta = q.clone().sub(p),
      g = new T.CylinderGeometry(r, r, delta.length(), 8);
    g.applyQuaternion(
      new T.Quaternion().setFromUnitVectors(
        new T.Vector3(0, 1, 0),
        delta.normalize(),
      ),
    );
    g.translate(...p.clone().lerp(q, 0.5).toArray());
    railParts.push(g);
  };
  for (const side of [-1, 1]) {
    let last: T.Vector3 | undefined;
    for (const t of [0, 2, 4, stairLength / 2, 7, 9, stairLength]) {
      const step = steps.find((s) => t >= s.start && t <= s.end),
        y = t === 0 ? stair.upperY : (step?.y ?? stair.lowerY);
      const foot = a
          .clone()
          .addScaledVector(direction, t)
          .addScaledVector(normal, side * (stair.width / 2 - 0.08))
          .setY(y),
        top = foot.clone().add(new T.Vector3(0, 0.95, 0));
      tube(foot, top, 0.025);
      if (last) tube(last, top, 0.027);
      last = top;
    }
  }
  const floorGeometry = mergeGeometries(groundParts)!,
    railGeometry = mergeGeometries(railParts)!;
  groundParts.forEach((g) => g.dispose());
  railParts.forEach((g) => g.dispose());
  const floor = new T.Mesh(floorGeometry, concrete),
    rails = new T.Mesh(railGeometry, metal);
  floor.name = 'Engineering connected walks and stair';
  rails.name = 'Engineering stair handrails';
  floor.castShadow = floor.receiveShadow = true;
  rails.castShadow = rails.receiveShadow = true;
  const meshes = [floor, rails],
    materials = [concrete, metal],
    colliderGeometries = [floorGeometry, railGeometry];
  const contains = (x: number, z: number) =>
    volumes.some((v) =>
      v.planes
        .slice(0, 4)
        .every((p) => p.distanceToPoint(new T.Vector3(x, 0, z)) <= 0),
    );
  const triangles = meshes.reduce(
    (sum, m) =>
      sum +
      (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3,
    0,
  );
  return {
    meshes,
    materials,
    colliderGeometries,
    volumes,
    routes,
    steps,
    contains,
    stats: {
      routeMeters: Math.round(length + stairLength),
      stairFlights: 2,
      risers: stair.risers,
      triangles,
    },
  };
}
