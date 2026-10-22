import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export interface ScooterTargets {
  leftGrip: T.Object3D;
  rightGrip: T.Object3D;
  frontFoot: T.Object3D;
  rearFoot: T.Object3D;
}
export interface ScooterVisualState {
  /** Radians. Positive steers toward the rider's left (+X). */
  steer: number;
  /** Absolute collision-resolved forward travel in metres. */
  distance: number;
  parked?: boolean;
}
const C = {
  white: "#e7ece8",
  green: "#73d82c",
  black: "#202625",
  deck: "#323a36",
  metal: "#87958f",
  red: "#cf3c24",
  amber: "#dfab38",
};
export function buildScooterModel() {
  const root = new T.Group();
  root.name = "ScooterRoot";
  const steering = new T.Group();
  steering.name = "SteeringAssembly";
  steering.position.set(0, 0.24, 0.56);
  root.add(steering);
  const frontWheel = new T.Group();
  frontWheel.name = "FrontWheel";
  frontWheel.position.set(0, -0.09, 0.02);
  steering.add(frontWheel);
  const rearWheel = new T.Group();
  rearWheel.name = "RearWheel";
  rearWheel.position.set(0, 0.125, -0.45);
  root.add(rearWheel);
  const kickstand = new T.Group();
  kickstand.name = "Kickstand";
  kickstand.position.set(0, 0.105, -0.12);
  root.add(kickstand);
  const materials = {
    paint: new T.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.47,
      metalness: 0.1,
    }),
    rubber: new T.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
    }),
    metal: new T.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.32,
      metalness: 0.72,
    }),
    wheel: new T.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.72,
      metalness: 0.12,
    }),
  };
  Object.entries(materials).forEach(([key, m]) => (m.name = "Scooter " + key));
  type Mat = keyof typeof materials;
  const buckets = new Map<T.Group, Map<Mat, T.BufferGeometry[]>>();
  const add = (parent: T.Group, mat: Mat, g: T.BufferGeometry, color: string) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    for (const key of Object.keys(n.attributes))
      if (key !== "position" && key !== "normal") n.deleteAttribute(key);
    if (!n.attributes.normal) n.computeVertexNormals();
    const rgb = new T.Color(color),
      a = new Float32Array(n.attributes.position.count * 3);
    for (let i = 0; i < a.length; i += 3) {
      a[i] = rgb.r;
      a[i + 1] = rgb.g;
      a[i + 2] = rgb.b;
    }
    n.setAttribute("color", new T.BufferAttribute(a, 3));
    let b = buckets.get(parent);
    if (!b) {
      b = new Map();
      buckets.set(parent, b);
    }
    const list = b.get(mat) ?? [];
    list.push(n);
    b.set(mat, list);
  };
  const box = (
    parent: T.Group,
    mat: Mat,
    color: string,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    r = 0.015,
    rx = 0,
  ) => {
    const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w * 0.24, h * 0.24, d * 0.24));
    g.rotateX(rx);
    g.translate(x, y, z);
    add(parent, mat, g, color);
  };
  const tube = (
    parent: T.Group,
    mat: Mat,
    color: string,
    pts: number[][],
    radius: number,
    segments = 16,
    radial = 8,
  ) => {
    const g = new T.TubeGeometry(
      new T.CatmullRomCurve3(pts.map((p) => new T.Vector3(...(p as [number, number, number])))),
      segments,
      radius,
      radial,
      false,
    );
    add(parent, mat, g, color);
  };
  const rod = (
    parent: T.Group,
    mat: Mat,
    color: string,
    a: number[],
    b: number[],
    radius: number,
    radial = 12,
  ) => {
    const A = new T.Vector3(...(a as [number, number, number])),
      B = new T.Vector3(...(b as [number, number, number])),
      v = B.clone().sub(A);
    const g = new T.CylinderGeometry(radius, radius, v.length(), radial);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), v.normalize()));
    g.translate(...A.add(B).multiplyScalar(0.5).toArray());
    add(parent, mat, g, color);
  };
  // Fixed chassis: gently curved white neck, broad low deck, battery, and rear fender.
  box(root, "paint", C.white, 0.252, 0.061, 0.76, 0, 0.125, -0.105, 0.018);
  box(root, "rubber", C.deck, 0.226, 0.009, 0.681, 0, 0.161, -0.111, 0.02);
  box(root, "paint", C.green, 0.018, 0.023, 0.43, 0.128, 0.126, -0.075, 0.005);
  box(root, "paint", C.green, 0.018, 0.023, 0.43, -0.128, 0.126, -0.075, 0.005);
  tube(
    root,
    "paint",
    C.white,
    [
      [0, 0.127, 0.21],
      [0, 0.15, 0.31],
      [0, 0.245, 0.395],
      [0, 0.415, 0.513],
      [0, 0.55, 0.505],
    ],
    0.041,
    24,
    10,
  );
  box(root, "paint", C.white, 0.13, 0.272, 0.113, 0, 0.315, 0.33, 0.025, -0.45);
  box(root, "paint", C.green, 0.012, 0.183, 0.071, 0.072, 0.335, 0.336, 0.009, -0.45);
  box(root, "paint", C.green, 0.012, 0.183, 0.071, -0.072, 0.335, 0.336, 0.009, -0.45);
  box(root, "paint", C.red, 0.092, 0.025, 0.014, 0, 0.263, -0.545, 0.006, -0.2);
  for (const x of [-0.09, 0.09]) {
    rod(root, "metal", C.metal, [x, 0.125, -0.34], [x, 0.125, -0.45], 0.016);
    rod(root, "metal", C.metal, [x, 0.125, -0.45], [0, 0.125, -0.45], 0.012);
  }
  function fender(parent: T.Group, r: number, width: number, center: T.Vector3, mat: Mat) {
    const p: number[] = [],
      idx: number[] = [];
    const segments = 24;
    for (let i = 0; i <= segments; i++) {
      const a = 0.16 + (Math.PI * 0.9 * i) / segments;
      for (const rr of [r, r + 0.012])
        for (const x of [-width / 2, width / 2])
          p.push(center.x + x, center.y + Math.sin(a) * rr, center.z + Math.cos(a) * rr);
    }
    for (let i = 0; i < segments; i++) {
      const n = i * 4,
        k = n + 4;
      for (const [a, b, c, d] of [
        [n, k, k + 1, n + 1],
        [n + 2, n + 3, k + 3, k + 2],
        [n, n + 2, k + 2, k],
        [n + 1, k + 1, k + 3, n + 3],
      ])
        idx.push(a, b, c, a, c, d);
    }
    idx.push(
      0,
      2,
      1,
      1,
      2,
      3,
      segments * 4,
      segments * 4 + 1,
      segments * 4 + 2,
      segments * 4 + 1,
      segments * 4 + 3,
      segments * 4 + 2,
    );
    const g = new T.BufferGeometry().setAttribute("position", new T.Float32BufferAttribute(p, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    add(parent, mat, g, C.black);
  }
  fender(root, 0.151, 0.112, new T.Vector3(0, 0.125, -0.45), "rubber");
  // Coordinates in the assembly are relative to the lower stem's steering axis.
  tube(
    steering,
    "paint",
    C.green,
    [
      [0, 0.275, -0.055],
      [0, 0.43, -0.083],
      [0, 0.64, -0.121],
      [0, 0.845, -0.157],
    ],
    0.026,
    20,
    10,
  );
  box(steering, "paint", C.green, 0.082, 0.179, 0.069, 0, 0.658, -0.118, 0.014, -0.17);
  box(steering, "rubber", C.black, 0.087, 0.065, 0.083, 0, 0.856, -0.153, 0.015, -0.15);
  box(steering, "metal", C.white, 0.037, 0.024, 0.008, 0, 0.858, -0.106, 0.006);
  box(steering, "metal", C.amber, 0.011, 0.04, 0.024, 0.044, 0.665, -0.107, 0.004);
  const bars = [
    [-0.285, 0.868, -0.219],
    [-0.19, 0.878, -0.185],
    [-0.095, 0.883, -0.15],
    [0, 0.883, -0.15],
    [0.095, 0.883, -0.15],
    [0.19, 0.878, -0.185],
    [0.285, 0.868, -0.219],
  ];
  tube(steering, "metal", C.black, bars, 0.013, 24, 8);
  for (const side of [-1, 1]) {
    rod(
      steering,
      "rubber",
      C.black,
      [side * 0.188, 0.878, -0.185],
      [side * 0.287, 0.868, -0.221],
      0.022,
      16,
    );
    rod(
      steering,
      "metal",
      C.metal,
      [side * 0.292, 0.868, -0.223],
      [side * 0.296, 0.868, -0.225],
      0.023,
      12,
    );
    tube(
      steering,
      "metal",
      C.metal,
      [
        [side * 0.174, 0.867, -0.17],
        [side * 0.206, 0.841, -0.184],
        [side * 0.27, 0.833, -0.2],
      ],
      0.0065,
      10,
      6,
    );
    tube(
      steering,
      "rubber",
      C.black,
      [
        [side * 0.172, 0.86, -0.171],
        [side * 0.11, 0.71, -0.11],
        [side * 0.045, 0.59, -0.065],
        [side * 0.02, 0.34, -0.043],
      ],
      0.003,
      16,
      5,
    );
    // Separate fork struts and suspension collars flank the larger front wheel.
    rod(
      steering,
      "metal",
      C.metal,
      [side * 0.061, 0.16, -0.005],
      [side * 0.061, -0.09, 0.02],
      0.012,
      12,
    );
    rod(
      steering,
      "rubber",
      C.black,
      [side * 0.061, 0.12, 0],
      [side * 0.061, 0.025, 0.009],
      0.021,
      12,
    );
    rod(steering, "metal", C.metal, [side * 0.072, -0.09, 0.02], [0, -0.09, 0.02], 0.012, 12);
  }
  fender(steering, 0.178, 0.12, new T.Vector3(0, -0.09, 0.02), "rubber");
  function wheel(parent: T.Group, r: number) {
    const tire = new T.TorusGeometry(r - 0.027, 0.027, 10, 48);
    tire.rotateY(Math.PI / 2);
    add(parent, "wheel", tire, C.black);
    const rim = new T.TorusGeometry(r - 0.057, 0.012, 6, 32);
    rim.rotateY(Math.PI / 2);
    add(parent, "wheel", rim, C.metal);
    rod(parent, "wheel", C.black, [-0.037, 0, 0], [0.037, 0, 0], r * 0.38, 24);
    for (let n = 0; n < 7; n++) {
      const a = (n * Math.PI * 2) / 7;
      rod(
        parent,
        "wheel",
        C.metal,
        [0, Math.sin(a) * r * 0.25, Math.cos(a) * r * 0.25],
        [0, Math.sin(a + 0.17) * (r - 0.058), Math.cos(a + 0.17) * (r - 0.058)],
        0.008,
        6,
      );
    }
    // Reflector makes true wheel rotation legible at slow speed.
    box(parent, "wheel", C.amber, 0.009, 0.035, 0.014, 0.034, 0, r - 0.06, 0.003);
  }
  wheel(frontWheel, 0.15);
  wheel(rearWheel, 0.125);
  for (const side of [-1, 1]) {
    rod(
      kickstand,
      "metal",
      C.black,
      [side * 0.069, 0, 0],
      [side * 0.145, -0.089, -0.067],
      0.008,
      10,
    );
    rod(
      kickstand,
      "metal",
      C.black,
      [side * 0.13, -0.089, -0.075],
      [side * 0.164, -0.089, -0.059],
      0.009,
      8,
    );
  }
  const target = (parent: T.Group, name: string, p: number[]) => {
    const n = new T.Object3D();
    n.name = name;
    n.position.fromArray(p);
    parent.add(n);
    return n;
  };
  const targets: ScooterTargets = {
    leftGrip: target(steering, "LeftGrip", [0.242, 0.8725, -0.2045]),
    rightGrip: target(steering, "RightGrip", [-0.242, 0.8725, -0.2045]),
    frontFoot: target(root, "FrontFootTarget", [0.045, 0.166, 0.045]),
    rearFoot: target(root, "RearFootTarget", [-0.045, 0.166, -0.25]),
  };
  const meshes: T.Mesh[] = [];
  for (const [parent, b] of buckets)
    for (const [mat, gs] of b) {
      const g = mergeGeometries(gs, false)!;
      gs.forEach((x) => x.dispose());
      g.computeBoundingSphere();
      const m = new T.Mesh(g, materials[mat]);
      m.name = parent.name + " " + mat;
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      meshes.push(m);
    }
  const axis = new T.Vector3(0, 0.845, -0.157).normalize();
  let disposed = false;
  const update = ({ steer, distance, parked = false }: ScooterVisualState) => {
    if (disposed) return;
    steering.quaternion.setFromAxisAngle(
      axis,
      T.MathUtils.clamp(
        Number.isFinite(steer) ? steer : 0,
        (-Math.PI * 35) / 180,
        (Math.PI * 35) / 180,
      ),
    );
    const travel = Number.isFinite(distance) ? distance : 0;
    frontWheel.rotation.x = travel / 0.15;
    rearWheel.rotation.x = travel / 0.125;
    kickstand.rotation.x = parked ? 0 : 1.15;
    root.updateMatrixWorld(true);
  };
  update({ steer: 0, distance: 0 });
  const bounds = new T.Box3().setFromObject(root, true),
    size = bounds.getSize(new T.Vector3());
  const dimensions = {
    frontWheelZ: 0.58,
    rearWheelZ: -0.45,
    wheelbase: 1.03,
    frontWheelRadius: 0.15,
    rearWheelRadius: 0.125,
    deckHeight: 0.166,
    handlebarWidth: 0.592,
    modelBounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    length: size.z,
    width: size.x,
    height: size.y,
  };
  const stats = {
    triangles: meshes.reduce(
      (sum, m) => sum + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3,
      0,
    ),
    drawBatches: meshes.length,
    ownedMaterials: Object.keys(materials).length,
  };
  return {
    root,
    steering,
    frontWheel,
    rearWheel,
    kickstand,
    targets,
    dimensions,
    stats,
    meshes,
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      meshes.forEach((m) => m.geometry.dispose());
      Object.values(materials).forEach((m) => m.dispose());
      root.clear();
    },
  };
}
export type ScooterModel = ReturnType<typeof buildScooterModel>;
