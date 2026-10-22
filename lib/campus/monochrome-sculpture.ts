import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** A recognizable, photo-guided approximation, not a scan of the artwork. */
export const MONOCHROME_REFERENCE = {
  title: 'Monochrome for Austin', artist: 'Nancy Rubins', year: 2015,
  latitude: 30.287462, longitude: -97.737132, boatCount: 70,
  publishedDimensionsMetres: [15.24, 16.3068, 12.4968] as const,
  source: 'https://landmarks.utexas.edu/artwork/monochrome-austin',
};
type V3 = [number, number, number];
export type MonochromeBoat = { center: V3; direction: V3; roll: number; length: number; beam: number; depth: number };
export type MonochromeSculpture = {
  group: T.Group;
  meshes: T.Mesh[];
  materials: T.MeshStandardMaterial[];
  geometries: T.BufferGeometry[];
  /** Local x/z bounding rectangle. This is an overhead extent, not a solid obstacle. */
  footprint: [number, number][];
  /** Simple ground obstacle; supportCollisionGeometry also includes the raised truss. */
  pedestalCollision: { center: V3; halfExtents: V3 };
  bounds: T.Box3;
  supportCollisionGeometry: T.BufferGeometry;
  /** Conservative artwork envelope for scan inspection; still avoid buildings. */
  referenceEnvelope: T.Box3;
  boats: MonochromeBoat[];
  stats: { boats: number; triangles: number; drawCalls: number; cableSegments: number };
  dispose: () => void;
};

function seeded(seed: number) {
  let n = seed >>> 0;
  return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
}

/** Local origin is the bottom centre of the pedestal; the bouquet leans toward +X. */
export function buildMonochromeSculpture(): MonochromeSculpture {
  const group = new T.Group(); group.name = 'Monochrome for Austin - Nancy Rubins, approximation';
  const random = seeded(201570);
  const materials: T.MeshStandardMaterial[] = [];
  const material = (name: string, color: number, metalness: number, roughness: number) => {
    const m = new T.MeshStandardMaterial({ name, color, metalness, roughness, vertexColors: true });
    materials.push(m); return m;
  };
  const outer = material('Weathered aluminum hulls', 0xb7bab4, .82, .48);
  const inner = material('Aluminum hull interiors', 0xa3a8a0, .76, .59);
  const trim = material('Gunwales, ribs and seats', 0xc4c8c1, .88, .36);
  const steel = material('Leaning steel support', 0x77746b, .80, .54);
  const wire = material('Suspension cables', 0x747771, .72, .40);
  const stone = material('Pale concrete pedestal', 0xbdbbae, .02, .92);
  // Restrained tarnish, without baking reference photographs into the asset.
  for (const mat of [outer, inner]) {
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = 'varying vec3 sculpturePoint;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nsculpturePoint=position;');
      shader.fragmentShader = `varying vec3 sculpturePoint;
        float sculptureNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        vec4 a=vec4(dot(i,vec3(127.1,311.7,74.7)),dot(i+vec3(1,0,0),vec3(127.1,311.7,74.7)),dot(i+vec3(0,1,0),vec3(127.1,311.7,74.7)),dot(i+vec3(1,1,0),vec3(127.1,311.7,74.7)));
        vec4 lo=fract(sin(a)*43758.5453),hi=fract(sin(a+74.7)*43758.5453);
        return mix(mix(mix(lo.x,lo.y,f.x),mix(lo.z,lo.w,f.x),f.y),mix(mix(hi.x,hi.y,f.x),mix(hi.z,hi.w,f.x),f.y),f.z);}
        ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float oxide=sculptureNoise(sculpturePoint*7.0)*.66+sculptureNoise(sculpturePoint*29.0)*.34;
        diffuseColor.rgb*=mix(vec3(.69,.67,.61),vec3(1.),smoothstep(.1,.8,oxide));`);
    };
    mat.customProgramCacheKey = () => 'monochrome-aluminum-v1';
  }
  const batches = new Map<T.MeshStandardMaterial, T.BufferGeometry[]>();
  const supportParts: T.BufferGeometry[] = [];
  let recordingSupport = false;
  function add(source: T.BufferGeometry, mat: T.MeshStandardMaterial, matrix?: T.Matrix4, tint = 1) {
    if (matrix) source.applyMatrix4(matrix);
    const g = source.index ? source.toNonIndexed() : source;
    if (g !== source) source.dispose();
    g.deleteAttribute('uv');
    if (!g.attributes.normal) g.computeVertexNormals();
    const colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i++) colors[i] = tint;
    g.setAttribute('color', new T.BufferAttribute(colors, 3));
    if (!batches.has(mat)) batches.set(mat, []);
    batches.get(mat)!.push(g);
    if (recordingSupport) supportParts.push(g.clone());
  }
  function bar(a: T.Vector3, b: T.Vector3, radius: number, mat: T.MeshStandardMaterial, sides = 6, transform?: T.Matrix4) {
    const delta = b.clone().sub(a);
    const g = new T.CylinderGeometry(radius, radius, delta.length(), sides, 1);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize()));
    g.translate(...a.clone().add(b).multiplyScalar(.5).toArray()); add(g, mat, transform);
  }
  function box(center: V3, size: V3, mat: T.MeshStandardMaterial, transform?: T.Matrix4) {
    add(new T.BoxGeometry(...size).translate(...center), mat, transform);
  }
  function widthAt(t: number, beam: number) {
    return Math.max(.009, beam * .5 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), 1.65)), .72));
  }
  function shellPoint(t: number, theta: number, boat: MonochromeBoat, inset = 0) {
    const w = Math.max(.004, widthAt(t, boat.beam) - inset);
    const rocker = .16 * Math.pow(Math.abs(t), 3);
    const y = rocker - Math.sin(theta) * Math.max(.008, boat.depth * (1 - Math.pow(Math.abs(t), 4)) - inset);
    return new T.Vector3(t * boat.length * .5, y, -Math.cos(theta) * w);
  }
  function hull(boat: MonochromeBoat, matrix: T.Matrix4, inset: number, inside: boolean, tint: number) {
    const longitudinal = 22, cross = 12, vertices: number[] = [], indices: number[] = [];
    for (let i = 0; i <= longitudinal; i++) for (let j = 0; j <= cross; j++) {
      const p = shellPoint(i / longitudinal * 2 - 1, j / cross * Math.PI, boat, inset);
      if (inside) p.y += .012;
      vertices.push(...p.toArray());
    }
    for (let i = 0; i < longitudinal; i++) for (let j = 0; j < cross; j++) {
      const a = i * (cross + 1) + j, b = a + cross + 1;
      // Outer normals face below the open canoe. Reverse them for its interior.
      const face = [a, b, a + 1, b, b + 1, a + 1];
      indices.push(...(inside ? [face[0], face[2], face[1], face[3], face[5], face[4]] : face));
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    g.setIndex(indices); g.computeVertexNormals(); add(g, inside ? inner : outer, matrix, tint);
  }
  const boats: MonochromeBoat[] = [];
  // Hero members give the bouquet its irregular diagonal silhouette. Their exact
  // attachment positions are authored from the supplied views, not surveyed.
  const heroes: Array<[V3, V3, number, number]> = [
    [[2.6, 10.0, 1.1], [.40, .84, .05], .8, 6.6],
    [[4.7, 10.2, -.8], [-.62, .76, -.07], -.4, 6.5],
    [[2.0, 11.8, -.7], [-.15, .98, -.10], .1, 5.7],
    [[4.3, 11.6, .2], [.18, .97, .15], 1.5, 6.4],
    [[5.2, 10.7, 1.3], [.63, .66, .18], 2.8, 6.5],
    [[5.6, 9.2, -.6], [.96, .17, -.23], -.7, 6.7],
    [[5.3, 8.5, 1.1], [.86, -.35, .18], 1.2, 6.2],
    [[3.4, 7.8, 2.6], [.86, -.24, -.43], -.3, 6.4],
    [[1.0, 8.4, 2.3], [-.80, .52, -.25], 2.9, 5.9],
    [[.1, 7.5, .5], [-.86, .35, .25], .3, 6.1],
    [[1.2, 6.7, -.4], [.90, .40, -.13], 2.0, 6.2],
    [[2.3, 5.8, 1.4], [.96, -.13, -.20], .5, 5.8],
    [[-.5, 6.2, 1.6], [.87, -.16, .46], -.9, 5.4],
    [[2.0, 8.8, -2.4], [.10, .92, -.38], 1.5, 6.2],
    [[3.5, 9.4, -2.2], [.64, .48, -.61], 2.9, 6.4],
    [[2.6, 10.1, 3.0], [.06, .65, .76], -1.1, 6.1],
    [[4.5, 8.5, 2.7], [.60, .24, .76], .7, 5.8],
    [[-.2, 9.2, -.7], [-.37, .92, -.09], .8, 6.0],
    [[1.0, 7.8, -2.2], [-.57, .34, -.75], -1.8, 5.7],
    [[3.6, 6.8, -1.2], [.72, -.32, -.61], 2.5, 5.6],
    [[4.8, 11.6, -2.0], [.52, .80, -.27], -.6, 5.8],
    [[.5, 10.2, 1.6], [-.34, .78, .53], 2.0, 6.4],
  ];
  for (const [center, direction, roll, length] of heroes) boats.push({ center, direction, roll, length, beam: .77 + random() * .31, depth: .30 + random() * .14 });
  for (let i = boats.length; i < MONOCHROME_REFERENCE.boatCount; i++) {
    const angle = i * 2.39996323, tier = random();
    const x = 2.4 + Math.cos(angle) * (1.0 + random() * 1.9) + tier * 1.5;
    const y = 6.4 + tier * 5.3, z = Math.sin(angle) * (1.0 + random() * 1.65);
    const direction = new T.Vector3(Math.cos(angle), -.20 + tier * 1.2, Math.sin(angle) * .72).normalize();
    boats.push({ center: [x, y, z], direction: direction.toArray(), roll: random() * Math.PI * 2,
      length: 4.5 + random() * 1.9, beam: .72 + random() * .35, depth: .27 + random() * .18 });
  }
  const tiePoints: T.Vector3[][] = [];
  for (const [boatIndex, boat] of boats.entries()) {
    const direction = new T.Vector3(...boat.direction).normalize();
    const rotation = new T.Quaternion().setFromUnitVectors(new T.Vector3(1, 0, 0), direction)
      .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), boat.roll));
    const matrix = new T.Matrix4().compose(new T.Vector3(...boat.center), rotation, new T.Vector3(1, 1, 1));
    const tint = .77 + random() * .22;
    hull(boat, matrix, 0, false, tint); hull(boat, matrix, .017, true, tint);
    // Both gunwales follow the boat's pointed planform and raised bow/stern.
    for (const side of [0, Math.PI]) {
      const points = Array.from({ length: 25 }, (_, i) => shellPoint(i / 12 - 1, side, boat));
      const curve = new T.CatmullRomCurve3(points);
      add(new T.TubeGeometry(curve, 30, .024, 5, false), trim, matrix, tint);
    }
    // Pressed ribs bend inside the U-shaped hull; broad seats span its opening.
    for (const t of [-.65, -.42, -.18, .08, .34, .59]) {
      const points = Array.from({ length: 11 }, (_, i) => shellPoint(t, i / 10 * Math.PI, boat, .025).add(new T.Vector3(0, .026, 0)));
      add(new T.TubeGeometry(new T.CatmullRomCurve3(points), 10, .016, 4, false), trim, matrix, tint);
    }
    for (const t of [-.43, .40]) {
      const halfWidth = widthAt(t, boat.beam) * .92;
      box([t * boat.length / 2, -.08, 0], [.22, .025, halfWidth * 2], trim, matrix);
    }
    // A raised external keel and occasional side stringers remain legible in
    // underside views where the open hull is turned away from the pedestrian.
    const keel = Array.from({ length: 21 }, (_, i) => shellPoint(i / 10 - 1, Math.PI / 2, boat).add(new T.Vector3(0, -.015, 0)));
    add(new T.TubeGeometry(new T.CatmullRomCurve3(keel), 24, .018, 4, false), trim, matrix, tint);
    const ties: T.Vector3[] = [];
    for (const end of [-.86, .86]) {
      const p = shellPoint(end, 0, boat).applyMatrix4(matrix); ties.push(p);
      if (boatIndex < 26) {
        const eye = new T.TorusGeometry(.044, .009, 4, 9).rotateY(Math.PI / 2)
          .translate(...shellPoint(end, 0, boat).toArray()); add(eye, trim, matrix);
      }
    }
    tiePoints.push(ties);
  }
  // Photos show a narrow rectangular concrete pier, flange and an open,
  // diagonally leaning steel lattice - not a solid tapered tree trunk.
  recordingSupport = true;
  box([0, 1.35, 0], [1.03, 2.7, .93], stone);
  box([0, 2.74, 0], [1.23, .13, 1.13], steel);
  for (const x of [-.46, -.23, 0, .23, .46]) for (const z of [-.46, .46]) {
    add(new T.CylinderGeometry(.036, .036, .11, 6).translate(x, 2.85, z), steel);
  }
  const levels = [new T.Vector3(0, 2.82, 0), new T.Vector3(.50, 4.1, .10), new T.Vector3(1.2, 5.6, .22), new T.Vector3(2.2, 7.4, .38)];
  for (let level = 0; level < levels.length - 1; level++) {
    const lo = levels[level], hi = levels[level + 1];
    for (const x of [-.37, .37]) for (const z of [-.34, .34]) {
      bar(lo.clone().add(new T.Vector3(x, 0, z)), hi.clone().add(new T.Vector3(x, 0, z)), .065, steel, 4);
    }
    for (const z of [-.34, .34]) {
      bar(lo.clone().add(new T.Vector3(-.37, 0, z)), hi.clone().add(new T.Vector3(.37, 0, z)), .048, steel, 4);
      bar(lo.clone().add(new T.Vector3(.37, 0, z)), hi.clone().add(new T.Vector3(-.37, 0, z)), .04, steel, 4);
    }
    for (const x of [-.37, .37]) bar(lo.clone().add(new T.Vector3(x, 0, -.34)), hi.clone().add(new T.Vector3(x, 0, .34)), .042, steel, 4);
  }
  recordingSupport = false;
  let cableSegments = 0;
  for (let i = 0; i < tiePoints.length; i++) {
    const next = (i + 7) % tiePoints.length;
    bar(tiePoints[i][0], tiePoints[next][1], .008, wire, 4); cableSegments++;
    if (i % 2 === 0) {
      const anchor = new T.Vector3(1.3, 5.65, .22);
      bar(tiePoints[i][1], anchor, .010, wire, 4); cableSegments++;
    }
  }
  const meshes: T.Mesh[] = [], geometries: T.BufferGeometry[] = [];
  for (const [mat, sources] of batches) {
    const geometry = mergeGeometries(sources, false)!;
    for (const source of sources) source.dispose();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere(); geometries.push(geometry);
    const mesh = new T.Mesh(geometry, mat); mesh.name = mat.name; mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh); meshes.push(mesh);
  }
  group.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(group);
  const footprint: [number, number][] = [[bounds.min.x, bounds.min.z], [bounds.max.x, bounds.min.z], [bounds.max.x, bounds.max.z], [bounds.min.x, bounds.max.z]];
  const triangles = geometries.reduce((sum, g) => sum + (g.index?.count ?? g.attributes.position.count) / 3, 0);
  const supportCollisionGeometry = mergeGeometries(supportParts, false)!;
  for (const part of supportParts) part.dispose();
  geometries.push(supportCollisionGeometry);
  const referenceEnvelope = bounds.clone().union(new T.Box3(new T.Vector3(-5.5, 2.7, -6.25), new T.Vector3(10.81, 15.5, 6.25)));
  let disposed = false;
  return { group, meshes, materials, geometries, footprint, pedestalCollision: { center: [0, 1.35, 0], halfExtents: [.515, 1.35, .465] },
    bounds, supportCollisionGeometry, referenceEnvelope, boats, stats: { boats: boats.length, triangles, drawCalls: meshes.length, cableSegments },
    dispose() { if (disposed) return; disposed = true; group.removeFromParent(); for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); },
  };
}
