import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const CIRCLE_WITH_TOWERS_REFERENCE = {
  title: 'Circle with Towers', artist: 'Sol LeWitt', year: '2005/2012',
  material: 'Concrete block', towerCount: 8,
  heightMetres: 168 * .0254, diameterMetres: 308 * .0254,
  source: 'https://landmarks.utexas.edu/artwork/circle-towers',
} as const;

export type CircleWithTowers = {
  group: T.Group;
  meshes: T.Mesh[];
  materials: T.MeshStandardMaterial[];
  /** All owned buffers, including colliderGeometries. */
  geometries: T.BufferGeometry[];
  /** Eight tower boxes and one hollow low ring; the centre remains open. */
  colliderGeometries: T.BufferGeometry[];
  bounds: T.Box3;
  footprint: { outerRadius: number; innerRadius: number; lowWallHeight: number };
  towers: { angle: number; center: [number, number, number]; width: number; height: number }[];
  stats: { towers: number; blocks: number; courses: number; lowWallCourses: number; triangles: number; drawCalls: number; colliderTriangles: number };
  dispose: () => void;
};

/**
 * Photo-guided masonry reconstruction. The published overall height/diameter and
 * eight-tower rhythm are known; individual block sizes and course counts are
 * inferred. Origin is the ring centre at ground Y=0. No courtyard is included.
 */
export function buildCircleWithTowers(): CircleWithTowers {
  const group = new T.Group(); group.name = 'Circle with Towers - Sol LeWitt, approximation';
  const height = CIRCLE_WITH_TOWERS_REFERENCE.heightMetres;
  const outerRadius = CIRCLE_WITH_TOWERS_REFERENCE.diameterMetres / 2;
  const courses = 21, lowCourses = 4, faceModules = 4, gapModules = 8;
  const course = height / courses, towerWidth = course * faceModules;
  const lowWallHeight = course * lowCourses, seam = .008, recess = .012;
  const half = towerWidth / 2;
  // The outside corners, rather than the centres of the outer tower faces,
  // stay inside the published diameter.
  const towerRadius = Math.sqrt(outerRadius ** 2 - half ** 2) - half;
  const innerRadius = towerRadius - half;
  const concrete = new T.MeshStandardMaterial({ name: 'Pale grey concrete blocks', color: 0xb8bbb4,
    roughness: .93, metalness: 0, vertexColors: true });
  const mortar = new T.MeshStandardMaterial({ name: 'Recessed concrete joints', color: 0x93978e,
    roughness: 1, metalness: 0, vertexColors: true });
  // Fine aggregate and quiet mottling are procedural; photographs are references,
  // not textures embedded in the asset. Geometry supplies the joint depth.
  concrete.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec3 circleLocalPoint;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ncircleLocalPoint=position;');
    shader.fragmentShader = `varying vec3 circleLocalPoint;
      float circleHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
      float circleNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(mix(circleHash(i),circleHash(i+vec3(1,0,0)),f.x),mix(circleHash(i+vec3(0,1,0)),circleHash(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(circleHash(i+vec3(0,0,1)),circleHash(i+vec3(1,0,1)),f.x),mix(circleHash(i+vec3(0,1,1)),circleHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
      ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float aggregate=circleNoise(circleLocalPoint*240.);
      float cloud=circleNoise(circleLocalPoint*3.4);
      diffuseColor.rgb*=.945+aggregate*.065+cloud*.035;`);
  };
  concrete.customProgramCacheKey = () => 'circle-with-towers-concrete-v1';

  const blockParts: T.BufferGeometry[] = [], mortarParts: T.BufferGeometry[] = [];
  const colliderGeometries: T.BufferGeometry[] = [];
  let seed = 20122005, blockCount = 0;
  function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
  function prepare(source: T.BufferGeometry, tint = 1) {
    const g = source.index ? source.toNonIndexed() : source;
    if (g !== source) source.dispose();
    g.deleteAttribute('uv');
    if (!g.attributes.normal) g.computeVertexNormals();
    const colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = tint; colors[i + 1] = tint; colors[i + 2] = tint * .994; }
    g.setAttribute('color', new T.BufferAttribute(colors, 3)); return g;
  }
  function block(g: T.BufferGeometry) { blockParts.push(prepare(g, .958 + random() * .066)); blockCount++; }
  function slab(g: T.BufferGeometry) { mortarParts.push(prepare(g)); }
  function box(w: number, h: number, d: number, x: number, y: number, z: number, rotation = 0) {
    return new T.BoxGeometry(w, h, d).rotateY(rotation).translate(x, y, z);
  }
  /** A closed annulus with outward-facing normals, also used for simple physics. */
  function annulus(inside: number, outside: number, h: number, segments: number) {
    const positions: number[] = [];
    function quad(a: number[], b: number[], c: number[], d: number[]) { positions.push(...a, ...b, ...c, ...a, ...c, ...d); }
    function p(r: number, angle: number, y: number) { return [Math.sin(angle) * r, y, Math.cos(angle) * r]; }
    for (let i = 0; i < segments; i++) {
      const a = i / segments * Math.PI * 2, b = (i + 1) / segments * Math.PI * 2;
      const ai = p(inside, a, 0), bi = p(inside, b, 0), ao = p(outside, a, 0), bo = p(outside, b, 0);
      const ait = p(inside, a, h), bit = p(inside, b, h), aot = p(outside, a, h), bot = p(outside, b, h);
      quad(ao, bo, bot, aot); quad(bi, ai, ait, bit); quad(ait, aot, bot, bit); quad(ai, bi, bo, ao);
    }
    const g = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    g.computeVertexNormals(); return g;
  }
  /** The short wall courses are trapezoids, fitted between rectangular piers. */
  function wallBlock(r0: number, r1: number, y0: number, y1: number, angle: number, column: number, joint = seam) {
    function corners(r: number) {
      const start = angle + Math.asin(half / r), end = angle + Math.PI / 4 - Math.asin(half / r);
      const a = T.MathUtils.lerp(start, end, column / gapModules) + joint / (2 * r);
      const b = T.MathUtils.lerp(start, end, (column + 1) / gapModules) - joint / (2 * r);
      return [[Math.sin(a) * r, Math.cos(a) * r], [Math.sin(b) * r, Math.cos(b) * r]];
    }
    const [ia, ib] = corners(r0), [oa, ob] = corners(r1);
    const vertices = [[ia[0], y0, ia[1]], [ib[0], y0, ib[1]], [ob[0], y0, ob[1]], [oa[0], y0, oa[1]],
      [ia[0], y1, ia[1]], [ib[0], y1, ib[1]], [ob[0], y1, ob[1]], [oa[0], y1, oa[1]]];
    const faces = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2]];
    const positions: number[] = [];
    for (const [a, b, c, d] of faces) positions.push(...vertices[a], ...vertices[b], ...vertices[c], ...vertices[a], ...vertices[c], ...vertices[d]);
    const g = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    g.computeVertexNormals(); return g;
  }

  const towers: CircleWithTowers['towers'] = [];
  for (let tower = 0; tower < 8; tower++) {
    const angle = Math.PI / 8 + tower * Math.PI / 4;
    const x = Math.sin(angle) * towerRadius, z = Math.cos(angle) * towerRadius;
    towers.push({ angle, center: [x, height / 2, z], width: towerWidth, height });
    slab(box(towerWidth - recess * 2, height - recess, towerWidth - recess * 2, x, (height - recess) / 2, z, angle));
    const towerCollider = box(towerWidth, height, towerWidth, x, height / 2, z, angle);
    colliderGeometries.push(towerCollider.toNonIndexed()); towerCollider.dispose();
    // Restrict backing mortar to the wall intervals: a full circular backing
    // would protrude through the flatter tower faces and erase their bottom grid.
    for (let col = 0; col < gapModules; col++) {
      slab(wallBlock(innerRadius + recess, outerRadius - recess, 0, lowWallHeight - recess, angle, col, 0));
    }
    for (let row = 0; row < courses; row++) {
      const y0 = row * course + (row === 0 ? 0 : seam / 2);
      const y1 = (row + 1) * course - (row === courses - 1 ? 0 : seam / 2);
      for (let u = 0; u < faceModules; u++) for (let v = 0; v < faceModules; v++) {
        // Entire blocks are retained: even in an elevated view, the top has its
        // four-by-four grid and the model never becomes a hollow facade shell.
        const lx = (u + .5) * course - half, lz = (v + .5) * course - half;
        const px = x + Math.cos(angle) * lx + Math.sin(angle) * lz;
        const pz = z - Math.sin(angle) * lx + Math.cos(angle) * lz;
        block(box(course - seam, y1 - y0, course - seam, px, (y0 + y1) / 2, pz, angle));
      }
    }
    for (let row = 0; row < lowCourses; row++) {
      const y0 = row * course + (row === 0 ? 0 : seam / 2);
      const y1 = (row + 1) * course - (row === lowCourses - 1 ? 0 : seam / 2);
      for (let depth = 0; depth < 4; depth++) {
        const r0 = T.MathUtils.lerp(innerRadius, outerRadius, depth / 4) + (depth === 0 ? 0 : seam / 2);
        const r1 = T.MathUtils.lerp(innerRadius, outerRadius, (depth + 1) / 4) - (depth === 3 ? 0 : seam / 2);
        for (let col = 0; col < gapModules; col++) block(wallBlock(r0, r1, y0, y1, angle, col));
      }
    }
  }
  colliderGeometries.push(annulus(innerRadius, outerRadius, lowWallHeight, 96));

  const meshes: T.Mesh[] = [], materials = [concrete, mortar], geometries: T.BufferGeometry[] = [];
  for (const [index, parts] of [blockParts, mortarParts].entries()) {
    const geometry = mergeGeometries(parts, false)!;
    for (const part of parts) part.dispose();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere(); geometries.push(geometry);
    const mesh = new T.Mesh(geometry, materials[index]); mesh.name = materials[index].name;
    mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); meshes.push(mesh);
  }
  const triangles = geometries.reduce((n, g) => n + g.attributes.position.count / 3, 0);
  const colliderTriangles = colliderGeometries.reduce((n, g) => n + g.attributes.position.count / 3, 0);
  geometries.push(...colliderGeometries); group.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(group); let disposed = false;
  return { group, meshes, materials, geometries, colliderGeometries, bounds,
    footprint: { outerRadius, innerRadius, lowWallHeight }, towers,
    stats: { towers: towers.length, blocks: blockCount, courses, lowWallCourses: lowCourses, triangles, drawCalls: meshes.length, colliderTriangles },
    dispose() { if (disposed) return; disposed = true; group.removeFromParent(); for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); },
  };
}
