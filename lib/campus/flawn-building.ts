import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import source from '../../public/data/flawn-building-plan.json' with { type: 'json' };
import type { CutVolume } from './clip-volume';

type Point = [number, number];
type Rings = Point[][];
const plan = source as unknown as { footprint: Rings; core: Rings[]; upperCore: Rings[]; roof: Rings[]; clearance: Rings[]; fringe: Rings[] };

export const flawnFootprint = plan.footprint[0];
export interface FlawnOptions {
  /** World elevation of the exterior entrance slab. Photo estimate until surveyed. */
  baseElevation?: number;
  /** Above-slab roof height; includes recessed clerestory, not a six-floor guess. */
  roofHeight?: number;
  /** Ground under the foundation only. Does not author any exterior route. */
  groundHeight?: (x: number, z: number) => number;
}

function footprintShape(rings: Rings) {
  const s = new T.Shape(rings[0].map(([x, z]) => new T.Vector2(x, -z)));
  s.holes = rings.slice(1).map(r => new T.Path(r.map(([x, z]) => new T.Vector2(x, -z))));
  return s;
}

function clearanceVolumes(rings: Rings, low: number, high: number): CutVolume[] {
  const loops = rings.map(r => r.map(p => new T.Vector2(...p))), points = loops.flat();
  return T.ShapeUtils.triangulateShape(loops[0], loops.slice(1)).map(ids => {
    const tri = ids.map(i => new T.Vector3(points[i].x, 0, points[i].y));
    const center = tri.reduce((c, p) => c.add(p), new T.Vector3()).multiplyScalar(1 / 3);
    const planes = tri.map((a, i) => {
      const b = tri[(i + 1) % 3];
      const plane = new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z - a.z, 0, a.x - b.x).normalize(), a);
      if (plane.distanceToPoint(center) > 0) plane.negate();
      return plane;
    });
    planes.push(new T.Plane(new T.Vector3(0, -1, 0), low), new T.Plane(new T.Vector3(0, 1, 0), -high));
    const bounds = new T.Box3().setFromPoints(tri); bounds.min.y = low; bounds.max.y = high;
    return { planes, bounds };
  });
}

/** Native geometry based on FAC's inspected north, south and east elevations.
 * Screen openings, piers, the glazed recess and roof overhang have actual depth.
 * All collision buffers are the finished visible buffers; no hidden box wall.
 * This returns candidate scan cuts; the owner must review them before enabling.
 */
export function buildFlawnBuilding(options: FlawnOptions = {}) {
  const base = options.baseElevation ?? 17.3, height = options.roofHeight ?? 16.5;
  if (![base, height].every(Number.isFinite) || height < 13 || height > 23) throw new Error('Invalid FAC elevation or roof height');
  const ground = options.groundHeight ?? (() => base - 1);
  const bottom = Math.min(base - 2, ...plan.footprint[0].map(([x, z]) => ground(x, z) - .5));
  if (!Number.isFinite(bottom)) throw new Error('FAC ground elevation must be finite');
  const yScale = height / 16.5;
  const Y = (y: number) => base + y * yScale;
  const materials: T.MeshStandardMaterial[] = [];
  const material = (name: string, color: number, roughness: number, metalness = 0) => {
    const m = new T.MeshStandardMaterial({ color, roughness, metalness }); m.name = `FAC ${name}`; materials.push(m); return m;
  };
  const stone = material('light coursed limestone', 0xc4bda9, .83);
  const trim = material('honed limestone edging', 0xcfc8b6, .76);
  const screen = material('pierced stone screen', 0xbeb7a4, .81);
  const pier = material('dark ground stone', 0x403d36, .9);
  const glass = material('recessed green-grey glazing', 0x314541, .21, .46);
  const shadeGlass = material('shaded glazing variation', 0x25322f, .29, .35);
  const frame = material('warm anodized metal', 0x9b9f8e, .38, .6);
  const roof = material('flat roof surface', 0x747670, .96);
  const soffit = material('roof soffit panels', 0xb7b9a7, .79);
  const backing = material('interior shadow backstop', 0x252c29, .97);

  // Real-world metre UVs keep stone courses consistent on the long elevations.
  // Very small joints and surface variation avoid the high-contrast brick grid
  // that made prior simplified buildings read as toy blocks at eye level.
  for (const [mat, pitch, rise, joint] of [[stone, .48, .12, .0018], [pier, .95, .42, .0024]] as const) {
    mat.onBeforeCompile = shader => {
      if (shader.vertexShader.includes('varying vec2 vFacMetres;')) return;
      shader.vertexShader = 'varying vec2 vFacMetres;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvFacMetres=uv;');
      shader.fragmentShader = `varying vec2 vFacMetres;
        float facHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        vec3 facBump(vec3 p,vec3 n,float h,float side){vec3 dx=dFdx(p),dy=dFdy(p),a=cross(dy,n),b=cross(n,dx);float det=dot(dx,a)*side;return normalize(abs(det)*n-sign(det)*(dFdx(h)*a+dFdy(h)*b));}
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec2 q=vFacMetres/vec2(${pitch},${rise});q.x+=mod(floor(q.y),2.)*.5;
        vec2 edge=min(fract(q),1.-fract(q))*vec2(${pitch},${rise});
        float aa=max(max(fwidth(vFacMetres.x),fwidth(vFacMetres.y)),.0001);
        float facJoint=1.-smoothstep(${joint},${joint}+aa,min(edge.x,edge.y));
        float facTone=facHash(floor(q));
        float facGrain=sin(vFacMetres.y*91.+sin(vFacMetres.x*7.)*.8)*.009;
        diffuseColor.rgb*=(.964+.072*facTone+facGrain)*(1.-.12*facJoint);
        float facRelief=-facJoint*.0011;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal=facBump(-vViewPosition,normal,facRelief,faceDirection);');
    };
    mat.customProgramCacheKey = () => `fac-coursed-${mat.name}-v1`;
  }

  const batches = new Map<T.Material, T.BufferGeometry[]>();
  let panels = 0, columns = 0, latticeBars = 0, glazingBays = 0, soffitBays = 0;
  const wallSamples: { origin: number[]; direction: number[]; kind: string }[] = [];
  const add = (geometry: T.BufferGeometry, mat: T.Material) => {
    if (!batches.has(mat)) batches.set(mat, []);
    batches.get(mat)!.push(geometry);
  };
  const extrudeFootprint = (rings: Rings, low: number, high: number, mat: T.Material) => {
    const g = new T.ExtrudeGeometry(footprintShape(rings), { depth: high - low, bevelEnabled: false });
    g.rotateX(-Math.PI / 2).translate(0, low, 0); add(g, mat);
  };

  // The full GIS L-plan is retained, including the north-west polygonal wing.
  // Setbacks leave the front colonnade open instead of placing a solid cuboid
  // at the facade plane. The backstop starts behind the glazed wall.
  extrudeFootprint(plan.footprint, bottom, base - .12, pier);
  for (const r of plan.core) extrudeFootprint(r, base - .12, Y(4.02), backing);
  for (const r of plan.upperCore) extrudeFootprint(r, Y(4.02), Y(14.15), backing);
  for (const r of plan.core) extrudeFootprint(r, Y(14.15), Y(16.1), backing);
  extrudeFootprint(plan.footprint, Y(3.9), Y(4.24), trim);
  extrudeFootprint(plan.footprint, base - .12, base, trim);
  for (const r of plan.roof) extrudeFootprint(r, Y(16.1), Y(16.38), soffit);
  for (const r of plan.roof) extrudeFootprint(r, Y(16.38), Y(16.5), roof);

  const ring = [...plan.footprint[0]];
  const area = ring.reduce((sum, p, i) => sum + p[0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * p[1], 0);
  if (area > 0) ring.reverse();
  for (let e = 0; e < ring.length; e++) {
    const a = ring[e], b = ring[(e + 1) % ring.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    if (length < .1) continue;
    const along = new T.Vector3(dx / length, 0, dz / length), out = new T.Vector3(-dz / length, 0, dx / length);
    const transform = new T.Matrix4().makeBasis(along, new T.Vector3(0, 1, 0), out).setPosition(a[0], 0, a[1]);
    const point = (x: number, y: number, depth: number) => new T.Vector3(x, Y(y), depth).applyMatrix4(transform);
    const put = (g: T.BufferGeometry, mat: T.Material) => {
      const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) uv.setXY(i, Math.abs(n.getX(i)) > .7 ? p.getZ(i) : p.getX(i), Math.abs(n.getY(i)) > .7 ? p.getZ(i) : p.getY(i));
      g.applyMatrix4(transform); add(g, mat);
    };
    const box = (x: number, y: number, depth: number, w: number, h: number, d: number, mat: T.Material) => {
      put(new T.BoxGeometry(w, h * yScale, d).translate(x, Y(y), depth), mat);
    };
    const bar = (x1: number, y1: number, x2: number, y2: number, depth: number, width: number, mat: T.Material) => {
      const aa = new T.Vector3(x1, Y(y1), depth), bb = new T.Vector3(x2, Y(y2), depth), delta = bb.clone().sub(aa);
      const g = new T.BoxGeometry(width, delta.length(), .16);
      g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize()));
      g.translate(...aa.add(bb).multiplyScalar(.5).toArray()); put(g, mat); latticeBars++;
    };
    const sample = (x: number, y: number, kind: string) => wallSamples.push({ origin: point(x, y, 2).toArray(), direction: out.clone().negate().toArray(), kind });
    // The GIS outline has a sub-metre return beside the polygonal wing. It is
    // a closed masonry joint, not another window/column bay.
    if (length < 3.2) {
      box(length / 2, 1.96, -.25, length, 3.92, .5, pier);
      box(length / 2, 9.16, -.26, length, 9.98, .52, stone);
      box(length / 2, 15.13, -.86, length, 1.86, .10, shadeGlass);
      continue;
    }
    const bays = Math.max(1, Math.round(length / 7.4));
    const pitch = length / bays, hero = length > 35;
    const panelWidth = Math.min(2.55, pitch * .34), panelLo = 5.2, panelHi = 13.18;
    const upper = new T.Shape([new T.Vector2(0, Y(4.24)), new T.Vector2(length, Y(4.24)), new T.Vector2(length, Y(14.15)), new T.Vector2(0, Y(14.15))]);

    // Rhythm follows the inspected facade: widely spaced tall stone screens,
    // continuous solid limestone between them, no invented regular window grid.
    if (hero) for (let j = 0; j < bays; j++) {
      const center = (j + .5) * pitch;
      upper.holes.push(new T.Path([
        new T.Vector2(center - panelWidth / 2, Y(panelLo)), new T.Vector2(center - panelWidth / 2, Y(panelHi)),
        new T.Vector2(center + panelWidth / 2, Y(panelHi)), new T.Vector2(center + panelWidth / 2, Y(panelLo)),
      ]));
      const panelMid = (panelLo + panelHi) / 2, panelH = panelHi - panelLo;
      box(center, panelMid, -.87, panelWidth, panelH, .075, shadeGlass);
      for (const side of [-1, 1]) box(center + side * (panelWidth / 2 + .07), panelMid, -.015, .14, panelH + .28, .30, trim);
      for (const y of [panelLo - .07, panelHi + .07]) box(center, y, -.015, panelWidth + .28, .14, .30, trim);
      // Repeated interlaced hexagon/diamond webs approximate the photographed
      // irregular geometric carving. Every opening is empty through the stone.
      const rows = 10, cols = 3, cellW = panelWidth / cols, cellH = panelH / rows;
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const cx = center - panelWidth / 2 + (col + .5) * cellW, cy = panelLo + (row + .5) * cellH;
        const nodes: Point[] = [[cx, cy - cellH / 2], [cx + cellW / 2, cy - cellH * .24], [cx + cellW / 2, cy + cellH * .24], [cx, cy + cellH / 2], [cx - cellW / 2, cy + cellH * .24], [cx - cellW / 2, cy - cellH * .24]];
        for (let k = 0; k < 6; k++) {
          // Shared vertical edges are emitted by the left cell once.
          if (k === 4 && col > 0) continue;
          bar(...nodes[k], ...nodes[(k + 1) % 6], -.14, .059, screen);
        }
        const flip = (row + col) % 2 === 0;
        bar(cx - cellW / 2, cy + (flip ? -.24 : .24) * cellH, cx + cellW / 2, cy + (flip ? .24 : -.24) * cellH, -.14, .052, screen);
      }
      // Horizontal divisions are visible on the tall original panels.
      for (const y of [panelLo + panelH / 3, panelLo + 2 * panelH / 3]) box(center, y, -.14, panelWidth, .065, .18, screen);
      sample(center, 8.06, 'pierced upper screen / recessed glass'); panels++;
    }
    put(new T.ExtrudeGeometry(upper, { depth: .52, bevelEnabled: false }).translate(0, 0, -.52), stone);
    box(length / 2, 4.22, .02, length, .22, .64, trim);
    box(length / 2, 14.09, .035, length, .18, .65, trim);

    // Rectangular dark masonry piers stand clear of the ground-level glass.
    // Their shadowed gap is the main pedestrian cue in the real photographs.
    for (let j = 0; j <= bays; j++) {
      const x = j * pitch, w = j === 0 || j === bays ? .40 : .76;
      box(x, 1.96, -.25, w, 3.92, .84, pier);
      box(x, .12, -.22, w + .09, .24, .92, pier);
      box(x, 3.83, -.21, w + .07, .16, .92, pier);
      sample(x, 1.65, 'ground-level outer pier'); columns++;
    }
    for (let j = 0; j < bays; j++) {
      const x0 = j * pitch + .4, x1 = (j + 1) * pitch - .4, center = (x0 + x1) / 2;
      box(center, 1.94, -1.42, x1 - x0, 3.65, .10, j % 3 === 0 ? shadeGlass : glass);
      const paneCount = Math.max(2, Math.round((x1 - x0) / 1.5));
      for (let k = 0; k <= paneCount; k++) box(x0 + k * (x1 - x0) / paneCount, 1.95, -1.33, .045, 3.67, .08, frame);
      for (const y of [.18, 2.85, 3.75]) box(center, y, -1.33, x1 - x0, .055, .08, frame);
      // Door pairs recur in the glazed wall on the mall elevation, with actual
      // frames and handles. They are visibly closed; the module has no interior.
      const southFacing = out.z > .8;
      if (southFacing && j % 3 === 1) {
        for (const side of [-1, 1]) {
          const cx = center + side * .48;
          for (const sign of [-1, 1]) box(cx + sign * .455, 1.45, -1.25, .048, 2.55, .09, frame);
          box(cx, 2.72, -1.25, .96, .06, .09, frame);
          box(cx - side * .28, 1.45, -1.13, .028, .48, .065, frame);
        }
      }
      sample(center, 1.5, 'recessed ground glazing'); glazingBays++;
    }
    // Clerestory creates the dark continuous line below the oversailing roof.
    box(length / 2, 15.13, -.86, length, 1.86, .085, glass);
    const roofBays = Math.max(1, Math.round(length / 2.8));
    for (let j = 0; j <= roofBays; j++) box(j * length / roofBays, 15.14, -.71, .105, 1.90, .26, frame);
    for (const y of [14.25, 16.03]) box(length / 2, y, -.71, length, .09, .26, frame);
    // Roof fascia, thin drip edge and underside ribs read at oblique angles.
    box(length / 2, 16.29, .94, length + .2, .22, .13, trim);
    box(length / 2, 16.08, .83, length + .15, .065, .12, frame);
    for (let j = 0; j <= roofBays; j++) { box(j * length / roofBays, 16.05, .04, .09, .11, 1.84, trim); soffitBays++; }
    sample(length * .28, 6.3, 'solid upper wall');
    sample(length * .43, 15.13, 'clerestory glass');
  }

  const meshes: T.Mesh[] = [];
  for (const [mat, parts] of batches) {
    const nonIndexed = parts.map(g => g.index ? g.toNonIndexed() : g);
    const geometry = mergeGeometries(nonIndexed);
    if (!geometry) throw new Error('FAC material geometry could not be merged');
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new T.Mesh(geometry, mat); mesh.name = `Flawn architecture: ${mat.name}`;
    mesh.castShadow = mesh.receiveShadow = true; meshes.push(mesh);
    for (const part of new Set([...parts, ...nonIndexed])) part.dispose();
  }
  // Replace all old geometry inside the footprint, where the authored slab
  // supplies the floor. The narrow external registration fringe starts above
  // nearby ground so clearing a fuzzy scan wall cannot punch out the sidewalk.
  const volumes = clearanceVolumes(plan.footprint, bottom - .5, Y(17.8));
  for (const r of plan.fringe) {
    const fringeLow = Math.max(base + .35, ...r.flat().map(([x, z]) => ground(x, z) + .3));
    volumes.push(...clearanceVolumes(r, fringeLow, Y(17.8)));
  }
  return {
    meshes, materials, colliderGeometries: meshes.map(m => m.geometry),
    volumes, candidateClearanceVolumes: volumes,
    wallSamples,
    stats: {
      buildings: 1, panels, columns, latticeBars, glazingBays, soffitBays,
      triangles: meshes.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0),
      materialBatches: meshes.length, footprintVertices: ring.length,
      baseElevation: base, roofElevation: Y(16.5),
    },
  };
}
