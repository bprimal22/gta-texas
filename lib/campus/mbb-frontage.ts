import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CutVolume } from './clip-volume';
import type { TreePlacement, HedgePlacement } from './foreground-trees';

// UT MBB feature 444, eastern wall of the south wing. s runs north along the
// wall; t runs east toward Speedway. Neither City 655081 nor its roof outline
// identifies this separate building. Window heights remain photo-informed.
const origin = new T.Vector3(-5.75332, 0, -194.71217);
const north = new T.Vector3(2.64614, 0, -29.90669).normalize();
const east = new T.Vector3(-north.z, 0, north.x);
const matrix = new T.Matrix4().makeBasis(north, new T.Vector3(0, 1, 0), east).setPosition(origin);
export const mbbPoint = (s: number, t: number, y = 0) => new T.Vector3(s, y, t).applyMatrix4(matrix);
export const mbbLocal = (x: number, z: number) => {
  const d = new T.Vector3(x - origin.x, 0, z - origin.z);
  return { s: d.dot(north), t: d.dot(east) };
};
type Rectangle = { s0: number; s1: number; t0: number; t1: number };
const garden: Rectangle = { s0: -4.25, s1: 43.5, t0: -1, t1: 23 };
const lane: Rectangle = { s0: -17.5, s1: -4.25, t0: -24, t1: 23 };
const within = (s: number, t: number, r: Rectangle) => s >= r.s0 && s <= r.s1 && t >= r.t0 && t <= r.t1;
export function inMbbFrontage(x: number, z: number) {
  const { s, t } = mbbLocal(x, z);
  return within(s, t, garden) || within(s, t, lane);
}
function volume(r: Rectangle, low: number, high: number): CutVolume {
  const points = [mbbPoint(r.s0, r.t0), mbbPoint(r.s1, r.t0), mbbPoint(r.s1, r.t1), mbbPoint(r.s0, r.t1)];
  const center = mbbPoint((r.s0 + r.s1) / 2, (r.t0 + r.t1) / 2);
  const planes = points.map((a, i) => {
    const b = points[(i + 1) % 4];
    const p = new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z - a.z, 0, a.x - b.x).normalize(), a);
    if (p.distanceToPoint(center) > 0) p.negate();
    return p;
  });
  planes.push(new T.Plane(new T.Vector3(0, -1, 0), low), new T.Plane(new T.Vector3(0, 1, 0), -high));
  const bounds = new T.Box3().setFromPoints(points); bounds.min.y = low; bounds.max.y = high;
  return { planes, bounds };
}

/** South MBB facade and its immediate Speedway garden/service lane.
 * Reuses simple trees. Ground and collision share triangles; source removal
 * is bounded to the reconstructed ground, bridge and facade.
 */
export function buildMbbFrontage(
  speedwayHeight: (x: number, z: number) => number,
  terrainHeight: (x: number, z: number) => number,
  courtHeight: (x: number, z: number) => number,
  sourceConcrete: T.MeshStandardMaterial,
  sourceGrass: T.MeshStandardMaterial,
) {
  const stone = new T.MeshStandardMaterial({ color: 0xafa796, roughness: .86 });
  const plinth = new T.MeshStandardMaterial({ color: 0x555e5a, roughness: .87 });
  const coping = new T.MeshStandardMaterial({ color: 0xa8a18e, roughness: .91 });
  const glass = new T.MeshStandardMaterial({ color: 0x263c41, metalness: .35, roughness: .18 });
  const frame = new T.MeshStandardMaterial({ color: 0x829a96, metalness: .45, roughness: .4 });
  const shadow = new T.MeshStandardMaterial({ color: 0x464743, roughness: 1 });
  const concrete = new T.MeshStandardMaterial({ map: sourceConcrete.map, color: 0xffffff, roughness: .94 });
  const grass = new T.MeshStandardMaterial({ map: sourceGrass.map, color: 0x718055, roughness: 1 });
  const metal = new T.MeshStandardMaterial({ color: 0x79817a, metalness: .45, roughness: .52 });
  const globe = new T.MeshStandardMaterial({ color: 0xe7e5d9, roughness: .38 });
  const banner = new T.MeshStandardMaterial({ color: 0xb4532a, roughness: .93 });
  const materials = [stone, plinth, coping, glass, frame, shadow, concrete, grass, metal, globe, banner];
  ['MBB pale limestone', 'MBB gray stone base', 'MBB weathered cornice', 'MBB recessed glazing',
    'MBB window frames', 'MBB closed interior', 'MBB concrete walks', 'MBB planted ground',
    'MBB globe lamp metal', 'MBB lamp glass', 'MBB orange banners'].forEach((name, i) => materials[i].name = name);
  for (const [m, width, height] of [[stone, 1.18, .56], [plinth, .88, .52]] as const) {
    m.onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec2 mbbMetres;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nmbbMetres=uv;');
      shader.fragmentShader = `varying vec2 mbbMetres;
        float mbbHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec2 q=mbbMetres/vec2(${width},${height});q.x+=mod(floor(q.y),2.)*.5;
        vec2 edge=min(fract(q),1.-fract(q))*vec2(${width},${height});
        float aa=max(max(fwidth(mbbMetres.x),fwidth(mbbMetres.y)),.0001);
        float joint=1.-smoothstep(.0015,.0015+aa,min(edge.x,edge.y));
        diffuseColor.rgb*=(.965+.07*mbbHash(floor(q)))*(1.-joint*.13);`);
    };
    m.customProgramCacheKey = () => `mbb-stone-${width}-v1`;
  }
  concrete.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec2 mbbGround;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nmbbGround=position.xz;');
    shader.fragmentShader = 'varying vec2 mbbGround;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float tone=smoothstep(.025,.45,dot(diffuseColor.rgb,vec3(.2126,.7152,.0722)));
      diffuseColor.rgb=mix(vec3(.40,.39,.35),vec3(.61,.60,.55),tone);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec2 edge=min(fract(mbbGround/2.4),1.-fract(mbbGround/2.4))*2.4;
      float aa=max(max(fwidth(mbbGround.x),fwidth(mbbGround.y)),.0001);
      diffuseColor.rgb*=1.-.13*(1.-smoothstep(.003,.003+aa,min(edge.x,edge.y)));`);
  };
  concrete.customProgramCacheKey = () => 'mbb-concrete-v1';
  const groundHeight = (x: number, z: number) => {
    const { s, t } = mbbLocal(x, z);
    let h = T.MathUtils.lerp(speedwayHeight(x, z) - .015, terrainHeight(x, z) + .22,
      1 - T.MathUtils.smoothstep(t, 3, 17));
    // Reuse the adjoining NHB apron at the south seam rather than creating a
    // second elevation assumption across a walkable junction.
    if (s < -13.5) h = T.MathUtils.lerp(h, courtHeight(x, z), T.MathUtils.smoothstep(-s, 13.5, 17.5));
    return h;
  };
  const meshes: T.Mesh[] = [], colliderGeometries: T.BufferGeometry[] = [];
  const batches = new Map<T.Material, T.BufferGeometry[]>();
  const add = (geometry: T.BufferGeometry, material: T.Material, solid = false) => {
    if (geometry.index) { const old = geometry; geometry = old.toNonIndexed(); old.dispose(); }
    const p = geometry.attributes.position, n = geometry.attributes.normal, uv = geometry.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, Math.abs(n.getX(i)) > .7 ? p.getZ(i) : p.getX(i), Math.abs(n.getY(i)) > .7 ? p.getZ(i) : p.getY(i));
    geometry.applyMatrix4(matrix);
    if (!batches.has(material)) batches.set(material, []);
    batches.get(material)!.push(geometry);
    if (solid) colliderGeometries.push(geometry.clone());
  };
  const box = (s: number, y: number, t: number, w: number, h: number, d: number, mat: T.Material, solid = false) =>
    add(new T.BoxGeometry(w, h, d).translate(s, y, t), mat, solid);
  let windows = 0;
  const volumes: CutVolume[] = [];
  const facade = (a: [number, number], b: [number, number], top: number, count: number) => {
    const ds = b[0] - a[0], dt = b[1] - a[1], length = Math.hypot(ds, dt), ns = -dt / length, nt = ds / length;
    const angle = Math.atan2(-dt, ds), pitch = length / count;
    const faceBox = (u: number, y: number, inset: number, w: number, h: number, d: number, mat: T.Material, solid = false, collisionOnly = false) => {
      const g = new T.BoxGeometry(w, h, d).rotateY(angle);
      g.translate(a[0] + ds * u / length + ns * inset, y, a[1] + dt * u / length + nt * inset);
      if (collisionOnly) colliderGeometries.push(g.applyMatrix4(matrix));
      else add(g, mat, solid);
    };
    const low = 4.3, baseTop = 7.8;
    faceBox(length / 2, (low + baseTop) / 2, -.26, length, baseTop - low, .52, plinth);
    const sillRows = [[8.85, 11.15], [14.30, 16.60], [19.70, 22.00]];
    let last = baseTop;
    for (const [bottom, upper] of sillRows) {
      faceBox(length / 2, (last + bottom) / 2, -.26, length, bottom - last, .52, stone);
      for (let i = 0; i < count; i++) {
        const center = (i + .5) * pitch, width = Math.min(2.16, pitch * .58), pier = (pitch - width) / 2;
        for (const side of [-1, 1]) {
          faceBox(center + side * (width / 2 + pier / 2), (bottom + upper) / 2, -.26, pier, upper - bottom, .52, stone);
          faceBox(center + side * (width / 2 - .035), (bottom + upper) / 2, -.13, .07, upper - bottom, .23, frame);
        }
        faceBox(center, (bottom + upper) / 2, -.39, width, upper - bottom, .055, glass);
        faceBox(center, (bottom + upper) / 2, -.22, .055, upper - bottom, .095, frame);
        faceBox(center, bottom - .065, .065, width + .20, .13, .67, stone);
        faceBox(center, upper + .055, -.10, width + .15, .11, .50, stone);
        windows++;
      }
      last = upper;
    }
    faceBox(length / 2, (last + top - .5) / 2, -.26, length, top - .5 - last, .52, stone);
    for (const [y, h, d] of [[12.30, .20, .74], [top - .49, .18, .71], [top - .28, .24, .90], [top - .07, .14, 1.03]])
      faceBox(length / 2, y, .015, length + .1, h, d, coping);
    // Closed exterior support: the collision envelope reaches the visible wall
    // plane, while glass remains visibly recessed. No interior is claimed.
    faceBox(length / 2, (low + top) / 2, -2.8, length, top - low, 5.6, shadow, true, true);
    faceBox(length / 2, (low + top) / 2, -5.4, length, top - low, .4, shadow);
    faceBox(length / 2, top - .10, -2.9, length + .10, .20, 6.2, coping);
    const corners = [a, b, [a[0] - ns * 5.6, a[1] - nt * 5.6], [b[0] - ns * 5.6, b[1] - nt * 5.6]];
    volumes.push(volume({ s0: Math.min(...corners.map(p => p[0])) - .6, s1: Math.max(...corners.map(p => p[0])) + .6,
      t0: Math.min(...corners.map(p => p[1])) - .6, t1: Math.max(...corners.map(p => p[1])) + .6 }, low - .1, top + .20));
  };
  facade([0, 0], [30.02, 0], 24.25, 7);
  facade([-4, -2.44], [0, -2.44], 24.85, 1);
  facade([-4, -22.18], [-4, -2.44], 24.85, 4);
  // Visible stepped bay in the official outline, followed by the beginning of
  // the taller middle block. The distant arched entrance remains source imagery.
  facade([30.02, 3.65], [34.85, 3.65], 26.35, 1);
  facade([34.85, 2.43], [43.5, 2.43], 26.35, 2);
  box(30.15, 15.30, 1.7, .30, 22.10, 3.7, stone, true);
  box(34.72, 15.30, 2.8, .30, 22.10, 1.8, stone, true);
  box(-.15, 14.55, -1.20, .30, 20.60, 2.6, stone, true);

  // The source probe resolves the glazed connector that the coarser initial
  // grid missed: east face near X-17.4, roof Y20.1, soffit about Y14.1.
  // Its plan follows the same building axes. Native glazing/frame geometry
  // replaces the warped slab while retaining a generous passage underneath.
  const bridge = { s0: -17.7, s1: -3.7, t0: -16.2, t1: -10.6, low: 14.10, high: 20.15 };
  const bs = (bridge.s0 + bridge.s1) / 2, bt = (bridge.t0 + bridge.t1) / 2;
  box(bs, 14.24, bt, 14, .28, 5.6, coping, true);
  box(bs, 19.99, bt, 14, .32, 5.6, metal, true);
  box(bs, 17.1, bt, 14, 5.5, 4.9, shadow);
  for (const t of [bridge.t0, bridge.t1]) {
    box(bs, 15.00, t, 14, 1.52, .12, metal, true);
    box(bs, 17.78, t, 14, 4.02, .065, glass, true);
    for (let i = 0; i <= 10; i++) box(bridge.s0 + i * 1.4, 17.78, t + (t === bridge.t1 ? .055 : -.055), .065, 4.02, .13, frame);
    for (const y of [15.82, 17.20, 19.79]) box(bs, y, t + (t === bridge.t1 ? .055 : -.055), 14, .08, .13, frame);
  }
  volumes.push(volume({ s0: -18.1, s1: -3.1, t0: -16.9, t1: -9.5 }, 13.65, 20.5));
  // Observed bulges on NHB's existing reconstructed north wall protruded into
  // the lane. This bounded band clears those witnesses, not the whole lane.
  volumes.push(volume({ s0: -19, s1: -15.35, t0: -15.8, t1: 7.5 }, 10.65, 35.2));

  // Ground is sampled on a metre grid. Closed skirts end beneath the pavement;
  // the facade and sidewalk therefore cannot expose the former white void.
  for (const r of [lane, garden]) {
    const positions = new Map<T.Material, number[]>(), uvs = new Map<T.Material, number[]>();
    const emit = (points: T.Vector3[], mat: T.Material) => {
      if (!positions.has(mat)) { positions.set(mat, []); uvs.set(mat, []); }
      for (const p of points) { positions.get(mat)!.push(...p.toArray()); uvs.get(mat)!.push(p.x / 2, p.z / 2); }
    };
    const ns = Math.ceil(r.s1 - r.s0), nt = Math.ceil(r.t1 - r.t0);
    const vertex = (s: number, t: number) => { const p = mbbPoint(s, t); p.y = groundHeight(p.x, p.z); return p; };
    for (let i = 0; i < ns; i++) for (let j = 0; j < nt; j++) {
      const s0 = T.MathUtils.lerp(r.s0, r.s1, i / ns), s1 = T.MathUtils.lerp(r.s0, r.s1, (i + 1) / ns);
      const t0 = T.MathUtils.lerp(r.t0, r.t1, j / nt), t1 = T.MathUtils.lerp(r.t0, r.t1, (j + 1) / nt);
      const s = (s0 + s1) / 2, t = (t0 + t1) / 2;
      // The north bay projects 3.65 m beyond the long wall. Broaden the walk
      // before that corner so its visible paving leads around the wall rather
      // than inviting a straight route into it. Ground elevations stay shared.
      const innerWalk = s > 26 ? 7.4 : 3.5;
      const paved = r === lane || t < innerWalk || t > 16.5 || s < 1 || s > 40;
      const mat = paved ? concrete : grass;
      const a = vertex(s0, t0), b = vertex(s1, t0), c = vertex(s0, t1), d = vertex(s1, t1);
      emit([a, c, b, b, c, d], mat);
    }
    const ring = [[r.s0, r.t0], [r.s1, r.t0], [r.s1, r.t1], [r.s0, r.t1]];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % 4], n = Math.ceil(Math.hypot(a[0] - b[0], a[1] - b[1]));
      for (let j = 0; j < n; j++) {
        const p = vertex(T.MathUtils.lerp(a[0], b[0], j / n), T.MathUtils.lerp(a[1], b[1], j / n));
        const q = vertex(T.MathUtils.lerp(a[0], b[0], (j + 1) / n), T.MathUtils.lerp(a[1], b[1], (j + 1) / n));
        const pl = p.clone().add(new T.Vector3(0, -1.6, 0)), ql = q.clone().add(new T.Vector3(0, -1.6, 0));
        emit([p, pl, q, q, pl, ql], concrete);
      }
    }
    for (const [mat, points] of positions) {
      const geometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(points, 3));
      geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs.get(mat)!, 2)); geometry.computeVertexNormals();
      const mesh = new T.Mesh(geometry, mat); mesh.name = 'MBB graded planting and service walk'; mesh.receiveShadow = true;
      meshes.push(mesh); colliderGeometries.push(geometry);
    }
    // Keep the bridge's air gap: floor cleanup stays below its reconstructed
    // soffit. Garden clearance contains the replacement trees.
    volumes.push(volume(r, 3.35, r === lane ? 10.7 : 27.0));
  }
  const trees: TreePlacement[] = [], hedges: HedgePlacement[] = [];
  for (const [i, s] of [8, 23, 37].entries()) {
    const p = mbbPoint(s, 9.1);
    trees.push({ x: p.x, z: p.z, y: groundHeight(p.x, p.z), scale: 1.03 + .06 * i, width: 1.13, rotation: i * 2.4 + .7 });
  }
  for (const t of [4.8, 15.1]) for (const [s0, s1] of (t < 10 ? [[2, 16], [18, 25]] : [[2, 16], [18, 31], [33, 39]])) {
    const a = mbbPoint(s0, t), b = mbbPoint(s1, t);
    hedges.push({ a: [a.x, a.z], b: [b.x, b.z], y: groundHeight(a.x, a.z), endY: groundHeight(b.x, b.z), width: .62, height: .35 });
  }
  for (const s of [-10, 10, 31]) {
    const t = 17.3, p = mbbPoint(s, t), y = groundHeight(p.x, p.z);
    for (const [r, h, at] of [[.23, .10, .05], [.16, .28, .22], [.065, 3.30, 2.01], [.10, .15, 3.68]])
      add(new T.CylinderGeometry(r, r, h, 12).translate(s, y + at, t), metal, h > 3);
    const profile = [[0, 0], [.17, .04], [.24, .15], [.26, .34], [.20, .49], [.11, .55], [0, .56]].map(p => new T.Vector2(...p));
    add(new T.LatheGeometry(profile, 16).translate(s, y + 3.75, t), globe);
    box(s + .32, y + 2.83, t, .48, 1.05, .025, banner);
    box(s + .32, y + 3.40, t, .66, .035, .04, metal);
  }
  for (const [mat, parts] of batches) {
    const geometry = mergeGeometries(parts)!; parts.forEach(g => g.dispose());
    const mesh = new T.Mesh(geometry, mat); mesh.name = mat.name; mesh.castShadow = mesh.receiveShadow = true; meshes.push(mesh);
  }
  return { meshes, materials, colliderGeometries, volumes, trees, hedges, height: groundHeight, contains: inMbbFrontage,
    stats: { frontageMeters: 48, windows, trees: trees.length, lamps: 3, skybridges: 1, triangles: meshes.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0) } };
}
