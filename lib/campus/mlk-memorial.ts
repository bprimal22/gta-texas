import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type V3 = [number, number, number];
type Section = { y: number; depth: number; width: number; x: number; z: number };

/** Dimensions of the bronze are from the sculptors' 1999 KUT interview.
 * The platform, pose and sculpted likeness are photo-informed approximations. */
export const MLK_MEMORIAL_REFERENCE = {
  artist: 'Jeffrey Varilla and Anna Koh-Varilla',
  title: 'Dr. Martin Luther King Jr. memorial',
  source: 'https://americanarchive.org/catalog/cpb-aacip-529-jd4pk0887s',
  figureHeight: 2.4384,
  bronzePedestalHeight: 1.2192,
  front: '+X (east, generally toward the LBJ library)',
  likeness: 'Authored approximation; not a scanned or exact portrait',
} as const;

export type MlkMemorial = {
  group: T.Group;
  meshes: T.Mesh[];
  materials: T.MeshStandardMaterial[];
  geometries: T.BufferGeometry[];
  /** Local-space closed geometry. Apply the same placement as the visual group. */
  colliderGeometries: T.BufferGeometry[];
  bounds: T.Box3;
  dimensions: {
    figureHeight: number; bronzePedestalHeight: number; platformHeight: number;
    platformRadius: number; platformRiserHeight: number; totalHeight: number;
  };
  stats: { triangles: number; collisionTriangles: number; drawCalls: number; platformSteps: number };
  dispose: () => void;
};

/** Origin is the platform's bottom centre. The figure faces +X; its right is +Z. */
export function buildMlkMemorial(): MlkMemorial {
  const group = new T.Group();
  group.name = 'MLK memorial — photo-informed sculptural approximation';
  const materials: T.MeshStandardMaterial[] = [];
  const textureSize = 128, casting = new Uint8Array(textureSize * textureSize);
  function noise(x: number, y: number, cells: number) {
    const gx = x / textureSize * cells, gy = y / textureSize * cells;
    const ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = gx - ix, fy = gy - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const hash = (a: number, b: number) => {
      const n = Math.sin((a % cells) * 127.1 + (b % cells) * 311.7 + 17.3) * 43758.5453;
      return n - Math.floor(n);
    };
    return T.MathUtils.lerp(T.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), u),
      T.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), u), v);
  }
  for (let y = 0; y < textureSize; y++) for (let x = 0; x < textureSize; x++) {
    casting[y * textureSize + x] = Math.round(255 * (.22 + noise(x, y, 8) * .27 + noise(x, y, 32) * .31 + noise(x, y, 128) * .18));
  }
  const castingTexture = new T.DataTexture(casting, textureSize, textureSize, T.RedFormat);
  castingTexture.name = 'MLK fine cast bronze grain';
  castingTexture.wrapS = castingTexture.wrapT = T.RepeatWrapping;
  castingTexture.magFilter = T.LinearFilter; castingTexture.minFilter = T.LinearMipmapLinearFilter;
  castingTexture.generateMipmaps = true; castingTexture.needsUpdate = true;

  let remainingMaterials = 0;
  function material(name: string, color: number, metalness: number, roughness: number) {
    const m = new T.MeshStandardMaterial({ name, color, metalness, roughness, vertexColors: true,
      bumpMap: castingTexture, bumpScale: metalness > .5 ? .006 : .009 });
    remainingMaterials++;
    // The campus consumer owns individual materials rather than this group.
    // Release the shared grain texture when those materials are disposed too.
    const release = () => {
      m.removeEventListener('dispose', release);
      if (--remainingMaterials === 0) castingTexture.dispose();
    };
    m.addEventListener('dispose', release);
    materials.push(m); return m;
  }
  const bronze = material('MLK charcoal weathered bronze', 0x535254, .68, .78);
  const burnished = material('MLK raised bronze edges', 0x777475, .67, .66);
  const recess = material('MLK recessed bronze patina', 0x3b3d3b, .6, .85);
  const hair = material('MLK short sculpted hair and facial recesses', 0x454344, .58, .87);
  const stone = material('MLK pale stone platform', 0xb8b5aa, .015, .98);
  const stoneJoint = material('MLK platform fine joints', 0x94928a, .015, 1);
  const batches = new Map<T.Material, T.BufferGeometry[]>();
  const colliderGeometries: T.BufferGeometry[] = [];
  const platformHeight = .6, pedestalHeight = MLK_MEMORIAL_REFERENCE.bronzePedestalHeight;
  const figureBase = platformHeight + pedestalHeight;
  const figureHeight = MLK_MEMORIAL_REFERENCE.figureHeight;

  function add(source: T.BufferGeometry, m: T.Material, tone = 1) {
    const g = source.index ? source.toNonIndexed() : source;
    if (g !== source) source.dispose();
    // Planar projection per triangle keeps this high-frequency grain evenly sized
    // on vertical bronze faces as well as horizontal limestone. Seams are hidden
    // by the isotropic texture; the sculpture does not need an external UV atlas.
    const uv = new Float32Array(g.attributes.position.count * 2);
    const position = g.attributes.position;
    const va = new T.Vector3(), vb = new T.Vector3(), vc = new T.Vector3();
    for (let i = 0; i < position.count; i += 3) {
      va.fromBufferAttribute(position, i); vb.fromBufferAttribute(position, i + 1); vc.fromBufferAttribute(position, i + 2);
      const n = vb.sub(va).cross(vc.sub(va));
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      for (let k = i; k < i + 3; k++) {
        const x = position.getX(k), y = position.getY(k), z = position.getZ(k);
        uv[k * 2] = (ax >= ay && ax >= az ? z : x) * 2.4;
        uv[k * 2 + 1] = (ay >= ax && ay >= az ? z : y) * 2.4;
      }
    }
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position, colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      // Very restrained large-scale casting variation. No photograph is baked in.
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const grain = Math.sin(x * 38.7 + y * 24.3 + z * 37.1) * Math.sin(y * 67.1 - x * 31.2);
      const patina = Math.sin(x * 13.2 + z * 9.1) * Math.sin(y * 6.3 - z * 8.7);
      const t = tone * (.94 + grain * .035 + patina * .065);
      colors.set([t, t, t], i * 3);
    }
    g.setAttribute('color', new T.BufferAttribute(colors, 3));
    if (!batches.has(m)) batches.set(m, []);
    batches.get(m)!.push(g);
  }
  function ellipsoid(center: V3, radii: V3, m: T.Material, segments = 20, rings = 14, rotation?: T.Euler) {
    const g = new T.SphereGeometry(1, segments, rings).scale(...radii);
    if (rotation) g.applyQuaternion(new T.Quaternion().setFromEuler(rotation));
    g.translate(...center); add(g, m);
  }
  function box(center: V3, size: V3, m: T.Material, yaw = 0) {
    add(new T.BoxGeometry(...size).rotateY(yaw).translate(...center), m);
  }
  function line(points: V3[], radius: number, m: T.Material, segments = 16, sides = 6) {
    add(new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p => new T.Vector3(...p))), segments, radius, sides, false), m);
  }
  function cylinderBetween(a: V3, b: V3, radius: number, sides = 10) {
    const from = new T.Vector3(...a), to = new T.Vector3(...b), delta = to.clone().sub(from);
    return new T.CylinderGeometry(radius, radius, delta.length(), sides)
      .applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize()))
      .translate(...from.lerp(to, .5).toArray());
  }

  // The reference has a low circular gathering platform, then two square
  // limestone courses below a square bronze pedestal. Keep the existing overall
  // footprint and four 15 cm risers so this remains a walkable campus landmark.
  const tiers = [
    new T.CylinderGeometry(3.1, 3.1, .15, 96).translate(0, .075, 0),
    new T.CylinderGeometry(2.98, 2.98, .15, 96).translate(0, .225, 0),
    new T.BoxGeometry(2.0, .15, 2.0).translate(0, .375, 0),
    new T.BoxGeometry(1.43, .15, 1.43).translate(0, .525, 0),
  ];
  for (const tier of tiers) { colliderGeometries.push(tier.clone()); add(tier, stone); }
  for (let j = 0; j < 16; j++) {
    const a = j * Math.PI / 8;
    // Fine radial joints and vertical joints in the platform's stone facing.
    box([Math.cos(a) * 2.06, .3008, Math.sin(a) * 2.06], [1.84, .0016, .005], stoneJoint, -a);
    box([Math.cos(a) * 2.976, .225, Math.sin(a) * 2.976], [.008, .15, .004], stoneJoint, -a);
  }
  for (const [halfWidth, y] of [[1.0, .375], [.715, .525]]) {
    for (let side = 0; side < 4; side++) {
      const angle = side * Math.PI / 2;
      box([Math.cos(angle) * halfWidth, y, Math.sin(angle) * halfWidth], [.004, .15, .004], stoneJoint);
    }
  }

  // Bevels catch light along the cast pedestal edges without an octagonal plan.
  function plinth(size: number, height: number, y: number, bevel: number) {
    const h = size / 2 - bevel;
    const shape = new T.Shape().moveTo(-h, -h).lineTo(h, -h).lineTo(h, h).lineTo(-h, h).closePath();
    const g = new T.ExtrudeGeometry(shape, {depth: height - bevel * 2, bevelEnabled: true,
      bevelSegments: 1, steps: 1, bevelSize: bevel, bevelThickness: bevel, curveSegments: 1})
      .rotateX(-Math.PI / 2).translate(0, y + bevel, 0);
    add(g, bronze);
    colliderGeometries.push(new T.BoxGeometry(size, height, size).translate(0, y + height / 2, 0));
  }
  plinth(1.18, .078, platformHeight, .018);
  plinth(1.09, .064, platformHeight + .078, .012);
  plinth(1.025, pedestalHeight - .228, platformHeight + .142, .013);
  plinth(1.11, .040, figureBase - .086, .008);
  plinth(1.18, .046, figureBase - .046, .010);
  const pedestalFace = .513;
  for (let side = 0; side < 4; side++) {
    const rotation = new T.Matrix4().makeRotationY(side * Math.PI / 2);
    const panelY = platformHeight + .66;
    const local = (x: number, y: number, z: number) => new T.Vector3(x, y, z).applyMatrix4(rotation).toArray() as V3;
    function panelBox(x: number, y: number, z: number, w: number, h: number, d: number, m: T.Material) {
      add(new T.BoxGeometry(w, h, d).translate(x, y, z).applyMatrix4(rotation), m);
    }
    panelBox(pedestalFace + .002, panelY, 0, .008, .79, .79, recess);
    for (const z of [-.437, .437]) panelBox(pedestalFace + .014, panelY, z, .027, .88, .027, bronze);
    for (const y of [panelY - .438, panelY + .438]) panelBox(pedestalFace + .014, y, 0, .027, .028, .89, bronze);
    // Shallow framed relief: central architectural forms, flanking figures and
    // raised edging seen in the reference, not invented readable lettering.
    for (const sign of [-1, 1]) {
      // Small attendant figures flank the architectural relief in the photo.
      // Their thin silhouettes stay part of the cast panel, not freestanding props.
      const z = sign * .333;
      for (const [y, ry, rz] of [[panelY + .151, .027, .022], [panelY + .046, .077, .033]]) {
        add(new T.SphereGeometry(1, 8, 5).scale(.018, ry, rz)
          .translate(pedestalFace + .028, y, z).applyMatrix4(rotation), bronze);
      }
      for (const offset of [-.017, .017]) {
        line([local(pedestalFace + .030, panelY - .008, z + offset),
          local(pedestalFace + .030, panelY - .125, z + offset * 1.4),
          local(pedestalFace + .030, panelY - .251, z + offset * 1.9)], .013, bronze, 6, 5);
      }
      line([local(pedestalFace + .033, panelY + .10, z),
        local(pedestalFace + .040, panelY + .17, z - sign * .048),
        local(pedestalFace + .040, panelY + .23, z - sign * .081)], .011, bronze, 7, 5);
      line([local(pedestalFace + .033, panelY + .10, z + sign * .024),
        local(pedestalFace + .031, panelY + .01, z + sign * .04),
        local(pedestalFace + .031, panelY - .06, z - sign * .020)], .011, bronze, 7, 5);
    }
    panelBox(pedestalFace + .014, panelY - .014, 0, .024, .42, .50, bronze);
    panelBox(pedestalFace + .030, panelY + .10, 0, .019, .17, .41, recess);
    for (let column = 0; column < 7; column++) {
      panelBox(pedestalFace + .045, panelY + .10, -.18 + column * .06, .022, .17, .022, bronze);
    }
    for (const y of [panelY + .22, panelY + .195, panelY - .015, panelY - .045]) {
      panelBox(pedestalFace + .038, y, 0, .024, .018, .49, bronze);
    }
    // Raised crowd silhouettes stay shallow enough to read as bas-relief.
    for (let i = 0; i < 9; i++) {
      const z = -.205 + i * .052, y = panelY - .13 + Math.sin(i * 2.3) * .025;
      ellipsoid(local(pedestalFace + .035, y + .058, z), [.013, .018, .015], bronze, 8, 4);
      add(new T.SphereGeometry(1, 8, 4).scale(.013, .045, .018)
        .translate(pedestalFace + .031, y, z).applyMatrix4(rotation), bronze);
    }
    // Blank lower inscription field: the photograph cannot resolve its text.
    panelBox(pedestalFace + .018, panelY - .293, 0, .016, .103, .50, bronze);
  }

  const robeSections: Section[] = [
    { y: .34, depth: .264, width: .425, x: .012, z: .012 },
    { y: .55, depth: .255, width: .418, x: -.007, z: .022 },
    { y: .70, depth: .245, width: .396, x: -.015, z: .020 },
    { y: 1.0, depth: .227, width: .360, x: -.012, z: .010 },
    { y: 1.31, depth: .224, width: .35, x: -.025, z: 0 },
    { y: 1.56, depth: .25, width: .361, x: -.024, z: 0 },
    { y: 1.79, depth: .243, width: .409, x: -.031, z: 0 },
    { y: 1.94, depth: .20, width: .404, x: -.033, z: 0 },
    { y: 2.015, depth: .156, width: .287, x: -.029, z: 0 },
    { y: 2.07, depth: .107, width: .116, x: -.012, z: 0 },
  ];
  function section(y: number) {
    let i = 1; while (i < robeSections.length - 1 && robeSections[i].y < y) i++;
    const a = robeSections[i - 1], b = robeSections[i], t = T.MathUtils.clamp((y - a.y) / (b.y - a.y), 0, 1);
    return { depth: T.MathUtils.lerp(a.depth, b.depth, t), width: T.MathUtils.lerp(a.width, b.width, t),
      x: T.MathUtils.lerp(a.x, b.x, t), z: T.MathUtils.lerp(a.z, b.z, t) };
  }
  function robeGeometry(radial: number, rows: number, folds: boolean) {
    const pos: number[] = [], indices: number[] = [];
    for (let row = 0; row <= rows; row++) {
      const y = T.MathUtils.lerp(.34, 2.07, row / rows), s = section(y);
      for (let j = 0; j <= radial; j++) {
        const a = j / radial * Math.PI * 2;
        const fold = folds ? (Math.sin(a * 13 + y * .55) * .012 + Math.sin(a * 7 - y * .8) * .010) * (1 - .6 * row / rows) : 0;
        const front = Math.atan2(Math.sin(a), Math.cos(a));
        const slit = .30 * Math.exp(-((front / .17) ** 2)) * Math.exp(-(y - .34) * 8);
        const hem = slit + (folds ? Math.sin(a * 5 + .4) * .022 * Math.exp(-(y - .34) * 8) : 0);
        pos.push(s.x + Math.cos(a) * (s.depth + fold), figureBase + y + hem, s.z + Math.sin(a) * (s.width + fold));
      }
    }
    for (let row = 0; row < rows; row++) for (let j = 0; j < radial; j++) {
      const a = row * (radial + 1) + j, b = a + radial + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
    // Close both ends; there is no collision opening under the robe.
    for (const [row, reverse] of [[0, true], [rows, false]] as const) {
      const y = row === 0 ? .34 : 2.07, s = section(y), c = pos.length / 3;
      pos.push(s.x, figureBase + y, s.z);
      for (let j = 0; j < radial; j++) {
        const a = row * (radial + 1) + j;
        indices.push(...(reverse ? [c, a, a + 1] : [c, a + 1, a]));
      }
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(indices); g.computeVertexNormals(); return g;
  }
  add(robeGeometry(72, 32, true), bronze);
  colliderGeometries.push(robeGeometry(16, 10, false));
  // Shins and shoes are exposed below the calf-length robe.
  for (const [x, z] of [[.012, .19], [-.045, -.18]]) {
    ellipsoid([x, figureBase + .265, z], [.10, .23, .109], bronze, 18, 12);
    line([[x + .083, figureBase + .13, z], [x + .095, figureBase + .30, z],
      [x + .081, figureBase + .46, z]], .007, burnished, 8, 5);
  }
  for (const [x, z, angle] of [[.14, .19, -.07], [.07, -.18, .075]]) {
    ellipsoid([x, figureBase + .062, z], [.235, .067, .112], bronze, 20, 12, new T.Euler(0, angle, 0));
    box([x - .008, figureBase + .019, z], [.39, .031, .17], recess, angle);
  }

  // A slightly open academic collar and two flattened front bands sit on the
  // robe's body, making the dress read as cloth rather than a cylindrical cone.
  for (const sign of [-1, 1]) {
    const positions: number[] = [], indices: number[] = [];
    for (let row = 0; row <= 20; row++) {
      const t = row / 20, y = 2.024 - t * 1.36, z = sign * (.076 + Math.sin(t * 1.9) * .095);
      const s = section(y);
      for (const offset of [-.019, .019]) {
        const theta = Math.asin(T.MathUtils.clamp((z + offset) / s.width, -.95, .95));
        const fold = (Math.sin(theta * 13 + y * .55) * .012 + Math.sin(theta * 7 - y * .8) * .010) * (1 - .6 * (y - .34) / 1.73);
        positions.push(s.x + (s.depth + fold) * Math.cos(theta) + .011, figureBase + y, z + offset);
      }
      if (row < 20) { const a = row * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    g.setIndex(indices); g.computeVertexNormals(); add(g, bronze, 1.06);
  }
  // Vertical cloth creases follow the changing torso section instead of straight
  // parallel rods. These are shallow ridges in the bronze, not separate cords.
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2 + .27;
    const points = Array.from({ length: 10 }, (_, j) => {
      const y = .38 + j * .139, s = section(y), theta = a + Math.sin(y * 1.5 + a) * .036;
      return [s.x + Math.cos(theta) * (s.depth + .008), figureBase + y, s.z + Math.sin(theta) * (s.width + .008)] as V3;
    });
    line(points, .0045, bronze, 18, 5);
  }

  function sleeve(points: V3[], startRadius: number, endRadius: number) {
    const curve = new T.CatmullRomCurve3(points.map(p => new T.Vector3(p[0], figureBase + p[1], p[2])));
    const frames = curve.computeFrenetFrames(22, false), positions: number[] = [], indices: number[] = [];
    const radial = 28;
    for (let row = 0; row <= 22; row++) {
      const t = row / 22, center = curve.getPointAt(t), radius = T.MathUtils.lerp(startRadius, endRadius, t);
      for (let j = 0; j <= radial; j++) {
        const a = j / radial * Math.PI * 2, r = radius + Math.sin(a * 8 + t * 1.8) * .014;
        const p = center.clone().addScaledVector(frames.normals[row], Math.cos(a) * r)
          .addScaledVector(frames.binormals[row], Math.sin(a) * r * .92);
        // The lower side of the flared sleeve drapes with gravity.
        p.y -= Math.max(0, center.y - p.y) * t * .45;
        positions.push(...p.toArray());
      }
    }
    for (let row = 0; row < 22; row++) for (let j = 0; j < radial; j++) {
      const a = row * (radial + 1) + j, b = a + radial + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    g.setIndex(indices); g.computeVertexNormals(); add(g, bronze);
    const end = curve.getPointAt(1), tangent = curve.getTangentAt(1), q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), tangent);
    add(new T.CircleGeometry(endRadius * .94, 28).applyQuaternion(q).translate(...end.toArray()), recess);
    add(new T.TorusGeometry(endRadius, .012, 5, 28).applyQuaternion(q).translate(...end.toArray()), burnished);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      colliderGeometries.push(cylinderBetween([a[0], figureBase + a[1], a[2]], [b[0], figureBase + b[1], b[2]], .15, 8));
    }
  }
  sleeve([[-.055, 1.87, .275], [.08, 1.70, .445], [.24, 1.80, .395], [.34, 2.035, .31]], .155, .132);
  sleeve([[-.055, 1.87, -.275], [.005, 1.61, -.43], [.16, 1.39, -.385], [.29, 1.66, -.17]], .159, .126);
  // Both sleeve roots begin inside the shoulder volume; no spherical shoulder caps.

  const handBatchStarts = new Map([...batches].map(([m, parts]) => [m, parts.length]));
  // Raised right hand: palm beside the face, fingers upright and softly curled.
  // It is modelled in three dimensions, so the speaking gesture also reads in profile.
  add(cylinderBetween([.335, figureBase + 2.012, .31], [.378, figureBase + 2.105, .304], .052, 12), bronze);
  ellipsoid([.392, figureBase + 2.145, .302], [.039, .094, .075], bronze, 18, 12, new T.Euler(0, 0, -.10));
  for (const [i, length] of [.129, .146, .105, .079].entries()) {
    const z = .250 + i * .035, y = 2.20 - Math.abs(i - 1.2) * .007;
    line([[.399, figureBase + y, z], [.425, figureBase + y + length * .58, z + .004],
      [.446, figureBase + y + length * .91, z + .009]], .013 - i * .0006, bronze, 9, 7);
    ellipsoid([.446, figureBase + y + length * .91, z + .009], [.012 - i * .0006, .012 - i * .0006, .012 - i * .0006], bronze, 8, 5);
  }
  line([[.402, figureBase + 2.105, .255], [.454, figureBase + 2.137, .207],
    [.473, figureBase + 2.176, .200]], .021, bronze, 10, 8);
  ellipsoid([.473, figureBase + 2.176, .200], [.020, .020, .020], bronze, 10, 6);
  // Turn the palm partway inward, avoiding a flat, front-facing high-five pose.
  const handTurn = new T.Matrix4().makeTranslation(.34, figureBase + 2.035, .31)
    .multiply(new T.Matrix4().makeRotationY(-.45))
    .multiply(new T.Matrix4().makeTranslation(-.34, -figureBase - 2.035, -.31));
  for (const [m, parts] of batches) for (let i = handBatchStarts.get(m) ?? 0; i < parts.length; i++) parts[i].applyMatrix4(handTurn);
  // Left hand rests across the chest, with the thumb separated from the fingers.
  ellipsoid([.350, figureBase + 1.708, -.112], [.054, .068, .089], bronze, 18, 12, new T.Euler(.27, -.2, 0));
  for (let i = 0; i < 4; i++) {
    const y = figureBase + 1.668 + i * .026;
    line([[.39, y, -.13], [.41, y + .008, -.071], [.39, y + .014, -.018]], .012, bronze, 8, 4);
  }
  line([[.345, figureBase + 1.758, -.125], [.39, figureBase + 1.775, -.062],
    [.40, figureBase + 1.745, -.025]], .018, bronze, 8, 7);

  // A continuous sculpted head replaces separate cheek/chin spheres. The face
  // is displaced smoothly from a closed loft, so light travels across the jaw,
  // cheeks and nose without the seams of overlapping primitive shapes.
  ellipsoid([-.015, figureBase + 2.083, 0], [.092, .105, .088], bronze, 20, 12);
  const headY = figureBase + figureHeight - .175;
  // Each row gives height, front, back and half-width, relative to head centre.
  const headProfile = [
    [-.175, .012, -.018, .010], [-.149, .085, -.060, .060],
    [-.119, .114, -.094, .096], [-.076, .127, -.122, .117],
    [-.025, .124, -.144, .133], [.035, .121, -.150, .131],
    [.070, .131, -.146, .132], [.111, .119, -.129, .118],
    [.147, .086, -.098, .084], [.168, .043, -.048, .042], [.175, 0, 0, 0],
  ];
  function profileAt(y: number) {
    let i = 1; while (i < headProfile.length - 1 && headProfile[i][0] < y) i++;
    const a = headProfile[i - 1], b = headProfile[i];
    const t = T.MathUtils.clamp((y - a[0]) / (b[0] - a[0]), 0, 1);
    return [T.MathUtils.lerp(a[1], b[1], t), T.MathUtils.lerp(a[2], b[2], t), T.MathUtils.lerp(a[3], b[3], t)];
  }
  const gaussian = (y: number, z: number, cy: number, cz: number, sy: number, sz: number) =>
    Math.exp(-(((y - cy) / sy) ** 2 + ((z - cz) / sz) ** 2) / 2);
  function facialRelief(y: number, z: number) {
    let value = .032 * gaussian(y, z, .012, 0, .051, .017)
      + .052 * gaussian(y, z, -.027, 0, .016, .026)
      + .017 * gaussian(y, z, -.100, 0, .028, .043);
    for (const sign of [-1, 1]) {
      value += .012 * gaussian(y, z, -.022, sign * .082, .035, .026)
        - .016 * gaussian(y, z, .033, sign * .057, .014, .025)
        + .010 * gaussian(y, z, .059, sign * .057, .010, .028)
        + .018 * gaussian(y, z, -.041, sign * .027, .010, .014);
    }
    return value;
  }
  function faceX(y: number, z: number) {
    const [front, back, width] = profileAt(y);
    const cos = Math.sqrt(Math.max(0, 1 - (z / Math.max(width, .001)) ** 2));
    return .003 + (front + back) / 2 + (front - back) / 2 * cos + facialRelief(y, z) * cos ** 3;
  }
  const head = new T.SphereGeometry(1, 64, 48), hp = head.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    const y = hp.getY(i) * .175, a = Math.atan2(hp.getZ(i), hp.getX(i));
    const [front, back, width] = profileAt(y), z = Math.sin(a) * width, c = Math.cos(a);
    hp.setXYZ(i, .003 + (front + back) / 2 + (front - back) / 2 * c
      + facialRelief(y, z) * Math.max(0, c) ** 3, headY + y, z);
  }
  head.computeVertexNormals(); add(head, bronze);
  colliderGeometries.push(new T.SphereGeometry(.174, 14, 10).scale(.88, 1, .79).translate(.003, headY, 0));
  for (const sign of [-1, 1]) {
    ellipsoid([-.018, headY - .003, sign * .129], [.025, .043, .015], bronze, 14, 10);
    line([[-.006, headY + .024, sign * .136], [.001, headY + .005, sign * .141],
      [-.003, headY - .022, sign * .137]], .004, recess, 8, 5);
    // Recessed eyes and lids follow the head surface rather than sitting on top.
    const eyeY = .030, eyeZ = sign * .055;
    ellipsoid([faceX(eyeY, eyeZ) + .001, headY + eyeY, eyeZ], [.0025, .0035, .020], recess, 12, 6);
    for (const [dy, m, r] of [[.006, bronze, .003], [-.006, bronze, .0025]] as const) {
      const points = [-.020, 0, .020].map((dz, i) => {
        const y = eyeY + dy + (i === 1 ? .0015 : -.0015), z = eyeZ + dz;
        return [faceX(y, z) + .003, headY + y, z] as V3;
      });
      line(points, r, m, 9, 5);
    }
    const brow = [-.020, 0, .021].map((dz, i) => {
      const y = .057 + (i === 1 ? .003 : 0), z = eyeZ + dz;
      return [faceX(y, z) + .001, headY + y, z] as V3;
    });
    line(brow, .0032, hair, 10, 5);
    ellipsoid([faceX(-.043, sign * .024) + .001, headY - .044, sign * .024], [.002, .0035, .008], recess, 10, 6);
  }
  // A short moustache, parted lips and philtrum supply small, restrained landmarks.
  const moustache = [-.038, -.024, -.009, 0, .009, .024, .038].map(z => {
    const y = -.059 + .004 * (1 - Math.abs(z) / .038);
    return [faceX(y, z) + .002, headY + y, z] as V3;
  });
  line(moustache, .0052, hair, 20, 5);
  ellipsoid([faceX(-.079, 0) + .002, headY - .079, 0], [.0025, .004, .028], recess, 16, 6);
  for (const [y, r] of [[-.073, .003], [-.087, .0035]]) {
    const points = [-.029, -.014, 0, .014, .029].map(z =>
      [faceX(y, z) + .003, headY + y + Math.abs(z) * .075, z] as V3);
    line(points, r, bronze, 14, 5);
  }

  // Close-cropped scalp conforms to the same head loft, with subtle cast texture
  // instead of concentric rings that resemble a beanie.
  const scalpPositions: number[] = [], scalpIndices: number[] = [];
  for (let row = 0; row <= 12; row++) for (let j = 0; j <= 48; j++) {
    const a = j / 48 * Math.PI * 2;
    const edgeY = .008 + .074 * Math.max(0, Math.cos(a)) - .060 * Math.max(0, -Math.cos(a));
    const y = T.MathUtils.lerp(.175, edgeY, row / 12), [front, back, width] = profileAt(y);
    const grain = row === 0 ? 0 : .0007 * (1 + Math.sin(a * 29 + row * 4.1));
    const c = Math.cos(a), z = Math.sin(a) * (width + .0008 + grain);
    scalpPositions.push(.003 + (front + back) / 2 + ((front - back) / 2 + .0008 + grain) * c
      + facialRelief(y, z) * Math.max(0, c) ** 3, headY + y, z);
    if (row < 12 && j < 48) {
      const n = row * 49 + j; scalpIndices.push(n, n + 1, n + 49, n + 1, n + 50, n + 49);
    }
  }
  const scalp = new T.BufferGeometry(); scalp.setAttribute('position', new T.Float32BufferAttribute(scalpPositions, 3));
  scalp.setIndex(scalpIndices); scalp.computeVertexNormals(); add(scalp, hair);
  // Shirt collar and tie appear in the opening of the academic gown.
  const collar = new T.BufferGeometry();
  collar.setAttribute('position', new T.Float32BufferAttribute([
    .093, figureBase + 2.124, -.064, .126, figureBase + 2.065, -.012, .137, figureBase + 2.016, -.048,
    .093, figureBase + 2.124, .064, .137, figureBase + 2.016, .048, .126, figureBase + 2.065, .012,
  ], 3));
  collar.computeVertexNormals(); add(collar, bronze, 1.05);
  ellipsoid([.120, figureBase + 2.049, 0], [.012, .043, .021], recess, 12, 8);
  // Conservative small hand collisions avoid an invisible full arm-span box.
  colliderGeometries.push(cylinderBetween([.35, figureBase + 2.045, .305], [.412, figureBase + 2.32, .30], .080, 8));

  let disposed = false;
  const meshes: T.Mesh[] = [], geometries: T.BufferGeometry[] = [];
  for (const [m, parts] of batches) {
    const g = mergeGeometries(parts, false);
    if (!g) throw new Error('Could not merge MLK memorial material batch');
    for (const part of parts) part.dispose();
    g.computeBoundingBox(); g.computeBoundingSphere(); geometries.push(g);
    const mesh = new T.Mesh(g, m); mesh.name = m.name; mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh); meshes.push(mesh);
  }
  group.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(group);
  const triangleCount = (g: T.BufferGeometry) => (g.index?.count ?? g.attributes.position.count) / 3;
  const stats = { triangles: geometries.reduce((sum, g) => sum + triangleCount(g), 0),
    collisionTriangles: colliderGeometries.reduce((sum, g) => sum + triangleCount(g), 0), drawCalls: meshes.length, platformSteps: 4 };
  if (stats.triangles > 35000) throw new Error('MLK memorial exceeded its geometry budget');
  for (const g of [...geometries, ...colliderGeometries]) {
    for (const value of g.attributes.position.array) if (!Number.isFinite(value)) throw new Error('Non-finite MLK memorial vertex');
  }
  return { group, meshes, materials, geometries, colliderGeometries, bounds,
    dimensions: { figureHeight, bronzePedestalHeight: pedestalHeight, platformHeight,
      platformRadius: 3.1, platformRiserHeight: .15, totalHeight: platformHeight + pedestalHeight + figureHeight },
    stats, dispose() {
      if (disposed) return; disposed = true;
      group.removeFromParent();
      for (const g of [...geometries, ...colliderGeometries]) g.dispose();
      for (const m of materials) m.dispose();
    } };
}
