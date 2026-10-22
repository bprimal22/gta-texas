import * as THREE from 'three';

/** GDC east court and the walk along the north wing's east-court face.
 * Plan topology: MCHAP ground plan (paved court between the wings, east of
 * the atrium, opening east past the south wing). Extents follow UT402 walls;
 * the surface follows the sampled terrain +6 cm, so it never creates a step
 * or blocks a route. The paver module and banding are authored estimates.
 */
export const gdcEastCourtFrame = {
  origin: [21.8, -19.1] as const,
  east: [.996164, .087504] as const,
  south: [-.087504, .996164] as const,
};
/** Local (u east, v south) rectangles. Holes are the east entrance steps
 * built by gdc-atrium (u 44.75..46.0, v ±2.6); they are not paved over. */
export const gdcEastCourtPlan = {
  rects: [
    { name: 'east court', u0: 44.75, u1: 62.5, v0: -7.83, v1: 7.73 },
    { name: 'north wing east-court walk', u0: 62.5, u1: 90.4, v0: -7.83, v1: -4.6 },
  ],
  holes: [{ u0: 44.75, u1: 46.0, v0: -2.6, v1: 2.6 }],
  lift: .06,
  skirt: .35,
} as const;

const local = (x: number, z: number) => {
  const dx = x - gdcEastCourtFrame.origin[0], dz = z - gdcEastCourtFrame.origin[1];
  return [dx * gdcEastCourtFrame.east[0] + dz * gdcEastCourtFrame.east[1], dx * gdcEastCourtFrame.south[0] + dz * gdcEastCourtFrame.south[1]] as const;
};
const world = (u: number, v: number) => [
  gdcEastCourtFrame.origin[0] + u * gdcEastCourtFrame.east[0] + v * gdcEastCourtFrame.south[0],
  gdcEastCourtFrame.origin[1] + u * gdcEastCourtFrame.east[1] + v * gdcEastCourtFrame.south[1]] as const;

const inRect = (u: number, v: number, r: { u0: number; u1: number; v0: number; v1: number }, pad = 0) =>
  u >= r.u0 - pad && u <= r.u1 + pad && v >= r.v0 - pad && v <= r.v1 + pad;

/** True where the paved east court is the authored walking surface. */
export function inGdcEastCourt(x: number, z: number) {
  const [u, v] = local(x, z);
  return gdcEastCourtPlan.rects.some(r => inRect(u, v, r)) && !gdcEastCourtPlan.holes.some(h => inRect(u, v, h));
}

export function buildGdcEastCourt(options: { height: (x: number, z: number) => number; pavingMap?: THREE.Texture | null }) {
  const { lift, skirt } = gdcEastCourtPlan;
  const height = (u: number, v: number) => { const [x, z] = world(u, v); return options.height(x, z) + lift; };
  const positions: number[] = [], uvs: number[] = [];
  const vertex = (u: number, v: number, y: number) => {
    const [x, z] = world(u, v);
    if (![x, y, z].every(Number.isFinite)) throw new Error('GDC east court sampled a non-finite height');
    positions.push(x, y, z); uvs.push(u, v);
  };
  let cells = 0;
  for (const r of gdcEastCourtPlan.rects) {
    // Breakpoints every <=1 m, including every hole edge, so holes are exact.
    const cuts = (a: number, b: number, extra: number[]) => {
      const n = Math.ceil((b - a) / 1), out = Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);
      for (const e of extra) if (e > a && e < b) out.push(e);
      return [...new Set(out.map(t => +t.toFixed(4)))].sort((p, q) => p - q);
    };
    const us = cuts(r.u0, r.u1, gdcEastCourtPlan.holes.flatMap(h => [h.u0, h.u1]));
    const vs = cuts(r.v0, r.v1, gdcEastCourtPlan.holes.flatMap(h => [h.v0, h.v1]));
    for (let i = 0; i + 1 < us.length; i++) for (let j = 0; j + 1 < vs.length; j++) {
      const cu = (us[i] + us[i + 1]) / 2, cv = (vs[j] + vs[j + 1]) / 2;
      if (gdcEastCourtPlan.holes.some(h => inRect(cu, cv, h))) continue;
      const q = [[us[i], vs[j]], [us[i + 1], vs[j]], [us[i + 1], vs[j + 1]], [us[i], vs[j + 1]]] as const;
      // (u,v) is a left-handed plan pair in X/Z; this winding faces up.
      for (const k of [0, 3, 2, 0, 2, 1]) vertex(q[k][0], q[k][1], height(q[k][0], q[k][1]));
      cells++;
    }
  }
  const surfaceVertices = positions.length / 3;
  // Short vertical skirts on the open (non-wall) edges hide the terrain seam.
  const edges: [number, number, number, number][] = [
    [62.5, -4.6, 62.5, 7.73],      // court east edge beyond the walk
    [62.5, 7.73, 59.6, 7.73],      // court south edge beyond the south wing end
    [90.4, -4.6, 62.5, -4.6],      // walk south edge
    [90.4, -7.83, 90.4, -4.6],     // walk east end
  ];
  for (const [u0, v0, u1, v1] of edges) {
    const n = Math.max(1, Math.ceil(Math.hypot(u1 - u0, v1 - v0)));
    for (let i = 0; i < n; i++) {
      const a = [u0 + (u1 - u0) * i / n, v0 + (v1 - v0) * i / n], b = [u0 + (u1 - u0) * (i + 1) / n, v0 + (v1 - v0) * (i + 1) / n];
      const ya = height(a[0], a[1]), yb = height(b[0], b[1]);
      const quad = [[a, ya], [b, yb], [b, yb - skirt], [a, ya - skirt]] as const;
      for (const k of [0, 1, 2, 0, 2, 3]) vertex(quad[k][0][0], quad[k][0][1], quad[k][1]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({ color: 0xc4bdab, roughness: .9, map: options.pavingMap ?? null, side: THREE.DoubleSide });
  material.name = 'GDC east court pale concrete pavers';
  material.onBeforeCompile = shader => {
    if (!shader.fragmentShader.includes('#include <map_fragment>') || !shader.vertexShader.includes('#include <uv_vertex>'))
      throw new Error('GDC east court shader anchors missing');
    shader.vertexShader = 'varying vec2 gdcCourtUv;\n' + shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\ngdcCourtUv=uv;');
    shader.fragmentShader = 'varying vec2 gdcCourtUv;\nfloat gdcCourtHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n' +
      shader.fragmentShader.replace('#include <map_fragment>', `
      vec2 p = gdcCourtUv;
      // 0.60 x 0.30 m stack-jointed pavers; a darker 0.30 m band every 6 m
      // echoes the plan's banded court. Texture supplies luminance only.
      vec2 q = p / vec2(.6, .3), cell = floor(q), e = min(fract(q), 1. - fract(q)) * vec2(.6, .3);
      float aa = max(max(fwidth(p.x), fwidth(p.y)), .0001);
      float joint = (1. - smoothstep(.003, .003 + aa, min(e.x, e.y))) * (1. - smoothstep(.02, .08, aa));
      float band = step(fract(p.x / 6.), .05);
      float tone = .93 + .10 * gdcCourtHash(cell);
      #ifdef USE_MAP
        tone *= .85 + .3 * dot(texture2D(map, p * .37).rgb, vec3(.2126, .7152, .0722));
      #endif
      diffuseColor.rgb *= tone * mix(1., .78, band) * (1. - .28 * joint);`);
  };
  material.customProgramCacheKey = () => 'gdc-east-court-v1';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = material.name; mesh.receiveShadow = true;
  let disposed = false;
  return {
    meshes: [mesh], colliderGeometries: [geometry], materials: [material], contains: inGdcEastCourt,
    stats: { cells, triangles: positions.length / 9, surfaceTriangles: surfaceVertices / 3, drawCalls: 1 },
    dispose() { if (disposed) return; disposed = true; geometry.dispose(); material.dispose(); },
  };
}
