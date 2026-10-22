import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import rawPlan from '../../public/data/welch-south-roof-plan.json' with { type: 'json' };

type P = [number, number];
type Edge = { id: string; a: P; b: P; nx: number; nz: number; c: number };
type Volume = { planes: T.Plane[]; bounds: T.Box3 };
const plan = rawPlan;

export interface WelchSouthRoofOptions {
  /** Must match the replacement facade cornice. World metres, not above grade. */
  eaveElevation?: number;
  pitch?: number;
}

/** Complete roof over the projecting south cap. Its northern cross-section is
 * a continuing two-slope roof, not an invented northern hip. The cut never
 * enters the west lecture extension or the main leg north of that section.
 */
export function buildWelchSouthRoof(options: WelchSouthRoofOptions = {}) {
  const eave = options.eaveElevation ?? plan.eaveElevation;
  const pitch = options.pitch ?? plan.pitch;
  if (!Number.isFinite(eave) || eave < 24 || eave > 27 || !Number.isFinite(pitch) || pitch < .35 || pitch > .55) throw new Error('Invalid Welch south roof calibration');
  const ring = plan.footprint.map(p => [p[0], p[1]] as P);
  const center = ring.reduce((c, p) => [c[0] + p[0] / 4, c[1] + p[1] / 4] as P, [0, 0] as P);
  const edge = (a: P, b: P, id: string): Edge => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let nx = -(b[1] - a[1]) / l, nz = (b[0] - a[0]) / l;
    if (nx * (center[0] - a[0]) + nz * (center[1] - a[1]) < 0) { nx *= -1; nz *= -1; }
    return { id, a, b, nx, nz, c: -nx * a[0] - nz * a[1] };
  };
  const edges = ring.map((p, i) => edge(p, ring[(i + 1) % 4], ['south', 'east', 'north seam', 'west'][i]));
  const slopeEdges = [edges[0], edges[1], edges[3]];
  const distance = (e: Edge, p: P) => e.nx * p[0] + e.nz * p[1] + e.c;
  const roofHeight = (x: number, z: number) => eave + pitch * Math.min(...slopeEdges.map(e => distance(e, [x, z])));
  const inside = (p: P) => edges.every(e => distance(e, p) >= -1e-7);
  const clip = (polygon: P[], a: number, b: number, c: number) => {
    const result: P[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i], q = polygon[(i + 1) % polygon.length], dp = a * p[0] + b * p[1] + c, dq = a * q[0] + b * q[1] + c;
      if (dp <= 1e-9) result.push(p);
      if ((dp < -1e-9 && dq > 1e-9) || (dp > 1e-9 && dq < -1e-9)) {
        const t = dp / (dp - dq); result.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
    return result;
  };
  const roof = new T.MeshStandardMaterial({ color: 0x9a654b, roughness: .9 }); roof.name = 'Welch south calibrated terracotta roof';
  const underside = new T.MeshStandardMaterial({ color: 0xb4aa96, roughness: .92 }); underside.name = 'Welch south closed roof soffit';
  // Tile coordinates are metres along the eave and up the slope. Derivative
  // filtering softens joints at a distance; shallow barrel relief modifies the
  // lighting normal without adding thousands of disconnected tile meshes.
  roof.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec2 welchRoofUv;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nwelchRoofUv=uv;');
    shader.fragmentShader = 'varying vec2 welchRoofUv;\nfloat welchRoofHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec2 tileQ=welchRoofUv/vec2(.205,.39),tileF=fract(tileQ),tileAA=max(fwidth(tileQ),vec2(.0001));
      float tileJoint=smoothstep(.01,.025+tileAA.x,min(tileF.x,1.-tileF.x))*smoothstep(.018,.04+tileAA.y,min(tileF.y,1.-tileF.y));
      float tileRandom=welchRoofHash(floor(tileQ));
      diffuseColor.rgb*=mix(vec3(.76,.77,.76),mix(vec3(.92,.91,.87),vec3(1.07,1.035,.97),tileRandom),tileJoint);
      float tileRelief=(sin(tileF.x*3.14159265)*.014+tileJoint*.0018)*clamp(1.-max(tileAA.x,tileAA.y)*1.7,0.,1.);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      vec3 roofDx=dFdx(-vViewPosition),roofDy=dFdy(-vViewPosition),roofRx=cross(roofDy,normal),roofRy=cross(normal,roofDx);
      float roofDet=dot(roofDx,roofRx);
      normal=normalize(abs(roofDet)*normal-sign(roofDet)*(dFdx(tileRelief)*roofRx+dFdy(tileRelief)*roofRy));`);
  };
  roof.customProgramCacheKey = () => 'welch-south-complete-roof-metric-v1';
  const roofParts: T.BufferGeometry[] = [], shellParts: T.BufferGeometry[] = [];
  const face = (points: T.Vector3[], uv: P[], outward: T.Vector3) => {
    const positions: number[] = [], coords: number[] = [];
    for (let i = 1; i < points.length - 1; i++) {
      const ids = [0, i, i + 1];
      const normal = points[i].clone().sub(points[0]).cross(points[i + 1].clone().sub(points[0]));
      if (normal.dot(outward) < 0) ids.reverse();
      if (normal.lengthSq() < 1e-12) continue;
      for (const id of ids) { positions.push(...points[id].toArray()); coords.push(...uv[id]); }
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(coords, 2)); g.computeVertexNormals(); return g;
  };
  const faces: { id: string; polygon: P[] }[] = [];
  for (const active of slopeEdges) {
    let polygon = ring;
    for (const other of slopeEdges) if (other !== active) polygon = clip(polygon, active.nx - other.nx, active.nz - other.nz, active.c - other.c);
    const points = polygon.map(p => new T.Vector3(p[0], roofHeight(...p), p[1]));
    const tangent = [active.nz, -active.nx];
    const uv: P[] = polygon.map(p => [(p[0] - active.a[0]) * tangent[0] + (p[1] - active.a[1]) * tangent[1], distance(active, p) * Math.sqrt(1 + pitch * pitch)]);
    roofParts.push(face(points, uv, new T.Vector3(0, 1, 0))); faces.push({ id: active.id, polygon });
  }
  const bottom = eave - plan.shellThickness;
  // Split every perimeter edge at any roof-face vertex on it. In particular the
  // northern seam includes the ridge vertex, so its cross-section has no hole.
  const roofVertices = faces.flatMap(f => f.polygon);
  for (const e of edges) {
    const dx = e.b[0] - e.a[0], dz = e.b[1] - e.a[1], lengthSq = dx * dx + dz * dz;
    const ts = [0, 1, ...roofVertices.filter(p => Math.abs(distance(e, p)) < 1e-6).map(p => ((p[0] - e.a[0]) * dx + (p[1] - e.a[1]) * dz) / lengthSq)];
    const sorted = [...new Set(ts.map(t => Math.max(0, Math.min(1, t)).toFixed(9)))].map(Number).sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a: P = [e.a[0] + sorted[i] * dx, e.a[1] + sorted[i] * dz], b: P = [e.a[0] + sorted[i + 1] * dx, e.a[1] + sorted[i + 1] * dz];
      const p = [new T.Vector3(a[0], bottom, a[1]), new T.Vector3(b[0], bottom, b[1]), new T.Vector3(b[0], roofHeight(...b), b[1]), new T.Vector3(a[0], roofHeight(...a), a[1])];
      shellParts.push(face(p, [[sorted[i] * Math.sqrt(lengthSq), bottom], [sorted[i + 1] * Math.sqrt(lengthSq), bottom], [sorted[i + 1] * Math.sqrt(lengthSq), roofHeight(...b)], [sorted[i] * Math.sqrt(lengthSq), roofHeight(...a)]], new T.Vector3(-e.nx, 0, -e.nz)));
    }
  }
  // A centre fan uses the same perimeter splits as the side walls, giving a
  // watertight underside even at the north ridge projection.
  const perimeter = ring.flatMap((p, i) => {
    const e = edges[i], dx = e.b[0] - p[0], dz = e.b[1] - p[1], l2 = dx * dx + dz * dz;
    const all = [p, ...roofVertices.filter(q => Math.abs(distance(e, q)) < 1e-6 && Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-6 && Math.hypot(q[0] - e.b[0], q[1] - e.b[1]) > 1e-6)];
    return all.filter((q, j) => all.findIndex(r => Math.hypot(q[0] - r[0], q[1] - r[1]) < 1e-6) === j).sort((a, b) => ((a[0] - b[0]) * dx + (a[1] - b[1]) * dz) / l2);
  });
  for (let i = 0; i < perimeter.length; i++) {
    const points = [center, perimeter[i], perimeter[(i + 1) % perimeter.length]];
    shellParts.push(face(points.map(p => new T.Vector3(p[0], bottom, p[1])), points, new T.Vector3(0, -1, 0)));
  }
  const bodyTriangleCount = [...roofParts, ...shellParts].reduce((n, g) => n + g.attributes.position.count / 3, 0);
  // Continuous low ridge caps sit in the roof, not as floating independent
  // strips. One cylinder per geometric ridge keeps the whole asset inexpensive.
  const ridges: { a: number[]; b: number[] }[] = [];
  for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
    const shared = faces[i].polygon.filter(p => faces[j].polygon.some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6));
    if (shared.length !== 2) continue;
    const a = new T.Vector3(shared[0][0], roofHeight(...shared[0]) + .018, shared[0][1]), b = new T.Vector3(shared[1][0], roofHeight(...shared[1]) + .018, shared[1][1]);
    const g = new T.CylinderGeometry(plan.ridgeCapRadius, plan.ridgeCapRadius, a.distanceTo(b), 12, 1, false);
    const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 2 * Math.PI * plan.ridgeCapRadius, uv.getY(k) * a.distanceTo(b));
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize())); g.translate(...a.clone().lerp(b, .5).toArray()); roofParts.push(g); ridges.push({ a: a.toArray(), b: b.toArray() });
  }
  const makeMesh = (parts: T.BufferGeometry[], material: T.MeshStandardMaterial) => {
    const normalized = parts.map(g => g.index ? g.toNonIndexed() : g), geometry = mergeGeometries(normalized)!;
    geometry.computeBoundingBox(); geometry.computeBoundingSphere(); const mesh = new T.Mesh(geometry, material); mesh.name = material.name; mesh.castShadow = mesh.receiveShadow = true;
    for (const p of new Set([...parts, ...normalized])) p.dispose(); return mesh;
  };
  const meshes = [makeMesh(roofParts, roof), makeMesh(shellParts, underside)];
  const planes = edges.map(e => new T.Plane(new T.Vector3(-e.nx, 0, -e.nz), -e.c));
  planes.push(new T.Plane(new T.Vector3(0, -1, 0), bottom), new T.Plane(new T.Vector3(0, 1, 0), -plan.cutCeiling));
  const bounds = new T.Box3().setFromPoints(ring.flatMap(p => [new T.Vector3(p[0], bottom, p[1]), new T.Vector3(p[0], plan.cutCeiling, p[1])]));
  const volumes: Volume[] = [{ planes, bounds }]; let disposed = false;
  return { meshes, materials: [roof, underside], colliderGeometries: meshes.map(m => m.geometry), volumes, roofHeight, inside, footprint: ring, faces, ridges,
    stats: { building: 'WEL', scope: 'Projecting south cap roof only', eave, pitch, roofPeak: Math.max(...roofVertices.map(p => roofHeight(...p))), cutBottom: bottom, cutCeiling: plan.cutCeiling, northernHip: false, bodyTriangles: bodyTriangleCount, triangles: meshes.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0), materialBatches: meshes.length, cutVolumes: volumes.length },
    dispose() { if (disposed) return; disposed = true; for (const m of meshes) m.geometry.dispose(); roof.dispose(); underside.dispose(); } };
}
