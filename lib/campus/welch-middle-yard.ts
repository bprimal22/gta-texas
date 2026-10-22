import * as T from 'three';
import rawPlan from './welch-middle-yard-plan.json' with { type: 'json' };

type Volume = { planes: T.Plane[]; bounds: T.Box3 };
type Face = [T.Vector3, T.Vector3, T.Vector3];
export interface WelchMiddleYardOptions {
  /** Borrowed existing campus materials; this asset never edits/disposes them. */
  concrete: T.MeshStandardMaterial;
  grass: T.MeshStandardMaterial;
}
const plan = rawPlan;

/** Fully supported graded ground between the real Welch east wall and the
 * outer gray Speedway edge. The far edge is baked from actual authored mesh
 * triangles, including every change of direction/elevation. Source canopy is
 * never used as a ground height. World-position meshes need no transform.
 */
export function buildWelchMiddleYard(options: WelchMiddleYardOptions) {
  if (!options?.concrete || !options?.grass) throw new Error('Welch yard requires borrowed concrete and grass');
  const along = new T.Vector3(...plan.facade.along as [number, number, number]);
  const out = new T.Vector3(...plan.facade.out as [number, number, number]);
  const origin = new T.Vector3(plan.facade.a[0], 0, plan.facade.a[1]);
  const point = (s: number, d: number, y: number) => origin.clone().addScaledVector(along, s).addScaledVector(out, d).setY(y);
  const local = (x: number, z: number) => { const p = new T.Vector3(x, 0, z).sub(origin); return { s: p.dot(along), d: p.dot(out) }; };
  const endHeight = (which: number, t: number) => {
    const end = plan.ends[which];
    // The south end samples the exact existing-yard profile. The north end
    // uses actual fixed ground where present and an explicit low fallback
    // only for the missing portion; no live canopy is accepted as ground.
    const nodes = end.samples.filter(p => p.authored !== null).map(p => ({ t: p.t, y: p.authored!.y }));
    if (!nodes.some(p => p.t === 0)) nodes.unshift({ t: 0, y: end.fallbackWall });
    const farY = plan.rows[which ? plan.rows.length - 1 : 0].edge[1];
    const far = nodes.find(p => p.t === 1); if (far) far.y = farY; else nodes.push({ t: 1, y: farY });
    for (let i = 1; i < nodes.length; i++) if (t <= nodes[i].t + 1e-9) return T.MathUtils.lerp(nodes[i - 1].y, nodes[i].y, (t - nodes[i - 1].t) / (nodes[i].t - nodes[i - 1].t));
    return farY;
  };
  const wallHeight = (s: number) => {
    const z = point(s, 0, 0).z, anchors = plan.wallHeightAnchors;
    if (z <= anchors[0].z) return anchors[0].y;
    for (let i = 1; i < anchors.length; i++) if (z <= anchors[i].z)
      return T.MathUtils.lerp(anchors[i-1].y, anchors[i].y, (z-anchors[i-1].z)/(anchors[i].z-anchors[i-1].z));
    return anchors.at(-1)!.y;
  };
  const nominal = (s: number, t: number, width: number, edgeY: number) => {
    const d = t * width;
    let y = T.MathUtils.lerp(wallHeight(s), edgeY, T.MathUtils.clamp((d - plan.innerWalkWidth) / (width - plan.innerWalkWidth), 0, 1));
    if (s < plan.southernTaper) y = T.MathUtils.lerp(endHeight(0, t), y, T.MathUtils.smoothstep(s, 0, plan.southernTaper));
    if (s > plan.facade.length - plan.northernTaper) y = T.MathUtils.lerp(y, endHeight(1, t), T.MathUtils.smoothstep(s, plan.facade.length - plan.northernTaper, plan.facade.length));
    return t > 1 - 1e-9 ? edgeY : y;
  };
  const rows = plan.rows.map(r => {
    const dense = r.s <= plan.southernTaper || r.s >= plan.facade.length - plan.northernTaper;
    // Dense end profiles already include the exact south-seam walk break.
    // Adding a nearly coincident moving break creates submillimetre slivers.
    const ts = dense ? plan.fractions : [0, plan.innerWalkWidth, 6, 10, 14, 18, r.width].filter(d => d <= r.width).map(d => d / r.width);
    return { s: r.s, width: r.width, vertices: ts.map(t => ({ t, p: t === 1 ? new T.Vector3(...r.edge as [number, number, number]) : point(r.s, t * r.width, nominal(r.s, t, r.width, r.edge[1])) })) };
  });
  const positions = [[], []] as number[][], uvs = [[], []] as number[][];
  const topFaces: Face[] = [], stripFaces: Face[][] = [];
  const tri = (a: T.Vector3, b: T.Vector3, c: T.Vector3, material: number, upward = false) => {
    let points: Face = [a, b, c];
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    if (n.lengthSq() < 1e-14) return;
    if (upward && n.y < 0) points = [a, c, b];
    for (const p of points) { positions[material].push(...p.toArray()); uvs[material].push(p.x / 2, p.z / 2); }
    return points;
  };
  const top = (a: T.Vector3, b: T.Vector3, c: T.Vector3, list: Face[]) => {
    const mid = a.clone().add(b).add(c).multiplyScalar(1 / 3), loc = local(mid.x, mid.z);
    const concrete = loc.d < plan.innerWalkWidth + 1e-5 || Math.abs(loc.s - plan.doorChainage) < plan.doorPathWidth / 2;
    const face = tri(a, b, c, concrete ? 0 : 1, true); if (!face) return;
    topFaces.push(face); list.push(face);
    // Every ground triangle has an exactly corresponding closed underside.
    const under = face.map(p => p.clone().add(new T.Vector3(0, -plan.shellDepth, 0))) as Face;
    tri(under[0], under[2], under[1], 1);
  };
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i].vertices, b = rows[i + 1].vertices, faces: Face[] = []; let ai = 0, bi = 0;
    // Zip sparse ordinary rows to denser end profiles. Shared row edges use
    // identical vertices; this avoids both gratuitous planar tessellation and
    // cracks/T-junctions where the subdivision density changes.
    while (ai < a.length - 1 || bi < b.length - 1) {
      const an = a[ai + 1], bn = b[bi + 1];
      if (an && bn && Math.abs(an.t - bn.t) < 1e-9) { top(a[ai].p, b[bi].p, an.p, faces); top(an.p, b[bi].p, bn.p, faces); ai++; bi++; }
      else if (an && (!bn || an.t < bn.t)) { top(a[ai].p, b[bi].p, an.p, faces); ai++; }
      else if (bn) { top(a[ai].p, b[bi].p, bn.p, faces); bi++; }
      else break;
    }
    stripFaces.push(faces);
  }
  const perimeter: T.Vector3[] = [
    ...rows.map(r => r.vertices[0].p),
    ...rows.at(-1)!.vertices.slice(1).map(v => v.p),
    ...rows.slice(0, -1).reverse().map(r => r.vertices.at(-1)!.p),
    ...rows[0].vertices.slice(1, -1).reverse().map(v => v.p),
  ];
  for (let i = 0; i < perimeter.length; i++) {
    const a = perimeter[i], b = perimeter[(i + 1) % perimeter.length], aa = a.clone().add(new T.Vector3(0, -plan.shellDepth, 0)), bb = b.clone().add(new T.Vector3(0, -plan.shellDepth, 0));
    const mid = a.clone().add(b).multiplyScalar(.5), center = point(plan.facade.length / 2, rows[Math.floor(rows.length / 2)].width / 2, 0);
    const expected = mid.clone().sub(center).setY(0), normal = b.clone().sub(a).cross(bb.clone().sub(a));
    if (normal.dot(expected) >= 0) { tri(a, b, bb, 1); tri(a, bb, aa, 1); }
    else { tri(a, bb, b, 1); tri(a, aa, bb, 1); }
  }
  const meshes = positions.map((values, i) => {
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(values, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uvs[i], 2)); g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    const m = new T.Mesh(g, i === 0 ? options.concrete : options.grass); m.name = i === 0 ? 'Welch middle east yard: connected walks' : 'Welch middle east yard: graded planting'; m.receiveShadow = true; m.castShadow = true; return m;
  });
  const rowIndex = (s: number) => { let i = 0; while (i < rows.length - 2 && s > rows[i + 1].s) i++; return i; };
  const inside = (x: number, z: number) => {
    const { s, d } = local(x, z); if (s < -1e-6 || s > plan.facade.length + 1e-6) return false;
    const i = rowIndex(s), w = T.MathUtils.lerp(rows[i].width, rows[i + 1].width, (s - rows[i].s) / (rows[i + 1].s - rows[i].s));
    return d >= -1e-6 && d <= w + 1e-6;
  };
  const barycentric = (x: number, z: number, face: Face) => {
    const [a, b, c] = face, den = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    const wa = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / den;
    const wb = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / den, wc = 1 - wa - wb;
    return wa >= -1e-6 && wb >= -1e-6 && wc >= -1e-6 ? wa * a.y + wb * b.y + wc * c.y : null;
  };
  const height = (x: number, z: number) => {
    if (!inside(x, z)) return NaN;
    const i = rowIndex(local(x, z).s);
    for (const face of stripFaces[i]) { const y = barycentric(x, z, face); if (y !== null) return y; }
    throw new Error(`Welch yard surface missing at ${x},${z}`);
  };
  const paved = (x: number, z: number) => {
    if (!inside(x, z)) return false;
    const { s, d } = local(x, z);
    return d <= plan.innerWalkWidth || Math.abs(s - plan.doorChainage) <= plan.doorPathWidth / 2;
  };
  const volume = (points: T.Vector3[], low: number, high: number): Volume => {
    const center = points.reduce((s, p) => s.add(p), new T.Vector3()).multiplyScalar(1 / points.length);
    const planes = points.map((a, i) => { const b = points[(i + 1) % points.length], p = new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z - a.z, 0, a.x - b.x).normalize(), a); if (p.distanceToPoint(center) > 0) p.negate(); return p; });
    planes.push(new T.Plane(new T.Vector3(0, -1, 0), low), new T.Plane(new T.Vector3(0, 1, 0), -high));
    const bounds = new T.Box3().setFromPoints(points); bounds.min.y = low; bounds.max.y = high; return { planes, bounds };
  };
  const sourceClearanceVolumes: Volume[] = [], authoredGroundTrimVolumes: Volume[] = [];
  let area = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1], corners = [a.vertices[0].p, b.vertices[0].p, b.vertices.at(-1)!.p, a.vertices.at(-1)!.p];
    const lo = Math.min(...a.vertices.map(v => v.p.y), ...b.vertices.map(v => v.p.y));
    // One prism per fully replaced ground strip, not one cut per render face.
    // The low bound may pass below a higher part of the slope, but every X/Z
    // column in the prism is capped by the new closed, physical floor.
    sourceClearanceVolumes.push(volume(corners, lo - .04, plan.sourceCeiling));
    authoredGroundTrimVolumes.push(volume(corners, lo - 4, plan.sourceCeiling));
    area += (b.s - a.s) * (a.width + b.width) / 2;
  }
  let disposed = false;
  return { meshes, materials: [] as T.MeshStandardMaterial[], colliderGeometries: meshes.map(m => m.geometry), volumes: sourceClearanceVolumes, sourceClearanceVolumes, authoredGroundTrimVolumes, oldGroundTrimVolumes: authoredGroundTrimVolumes, height, inside, contains: inside, paved, local,
    outerEdge: rows.map(r => r.vertices.at(-1)!.p.toArray()),
    stats: { scope: 'Welch middle east graded forecourt, exact fixed outer gray Speedway edge', wallHeightAnchors: plan.wallHeightAnchors, areaM2: area, rowCount: rows.length, topTriangles: topFaces.length, triangles: meshes.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0), materialBatches: meshes.length, ownedMaterials: 0, sourceCutVolumes: sourceClearanceVolumes.length, oldGroundTrimVolumes: authoredGroundTrimVolumes.length, farEdgeExact: true, northEndPartlyEstimated: true, northernInnerFallbackDatum: 5.282954 },
    dispose() { if (disposed) return; disposed = true; for (const m of meshes) m.geometry.dispose(); } };
}
