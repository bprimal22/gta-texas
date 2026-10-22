import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import source from '../../public/data/union-building-plan.json' with { type: 'json' };
import type { CutVolume } from './clip-volume';
import { applyUnionStoneFinish } from './union-stone';

type P = [number, number];
type Rings = P[][];
type Zone = { id: string; datum: 'south' | 'service'; wallHeight: number; roofRise: number; rings: Rings; core: Rings[]; roofTriangles: [number, number, number][][] };
const plan = source as unknown as { origin: P; east: P; north: P; footprintWorld: Rings; footprintLocal: Rings; zones: Zone[]; fringeWorld: Rings[] };
export const unionFootprint = plan.footprintWorld[0];
export interface UnionOptions {
  /** Separate thresholds account for the campus slope. Defaults are estimates. */
  southBaseElevation?: number;
  serviceBaseElevation?: number;
  groundHeight?: (x: number, z: number) => number;
}

function shape(rings: Rings) {
  const s = new T.Shape(rings[0].map(([x, z]) => new T.Vector2(x, -z)));
  s.holes = rings.slice(1).map(r => new T.Path(r.map(([x, z]) => new T.Vector2(x, -z))));
  return s;
}

function volumes(rings: Rings, low: number | ((triangle: T.Vector3[], center: T.Vector3) => number), high: number): CutVolume[] {
  const r = rings.map(p => p.map(v => new T.Vector2(...v))), all = r.flat();
  return T.ShapeUtils.triangulateShape(r[0], r.slice(1)).map(ids => {
    const tri = ids.map(i => new T.Vector3(all[i].x, 0, all[i].y));
    const center = tri.reduce((c, p) => c.add(p), new T.Vector3()).multiplyScalar(1 / 3);
    const bottom = typeof low === 'number' ? low : low(tri, center);
    if (!Number.isFinite(bottom)) throw new Error('Union cut ground samples must be finite');
    const planes = tri.map((a, i) => { const b = tri[(i + 1) % 3], p = new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z - a.z, 0, a.x - b.x).normalize(), a); if (p.distanceToPoint(center) > 0) p.negate(); return p; });
    planes.push(new T.Plane(new T.Vector3(0, -1, 0), bottom), new T.Plane(new T.Vector3(0, 1, 0), -high));
    const bounds = new T.Box3().setFromPoints(tri); bounds.min.y = bottom; bounds.max.y = high; return { planes, bounds };
  });
}

/** Texas Union's official plan with independent photo-informed roof masses.
 * The photographed south entrance has a tall arched opening and upper loggia;
 * the east service wall is deliberately sparse. No adjacent route is authored.
 */
export function buildUnionBuilding(options: UnionOptions = {}) {
  const south = options.southBaseElevation ?? 16.25, service = options.serviceBaseElevation ?? 16.9;
  if (![south, service].every(Number.isFinite) || Math.abs(south - service) > 8) throw new Error('Invalid Union entrance datums');
  const ground = options.groundHeight ?? (() => Math.min(south, service) - 1);
  const floor = Math.min(south - 2, service - 2, ...unionFootprint.map(([x, z]) => ground(x, z) - .4));
  const toWorld = new T.Matrix4().makeBasis(new T.Vector3(plan.east[0], 0, plan.east[1]), new T.Vector3(0, 1, 0), new T.Vector3(-plan.north[0], 0, -plan.north[1])).setPosition(plan.origin[0], 0, plan.origin[1]);
  // Asset coordinates use X=east and Z=south, so GIS local north is negated.
  const localWorld = (u: number, y: number, v: number) => new T.Vector3(u, y, -v).applyMatrix4(toWorld);
  const materials: T.MeshStandardMaterial[] = [];
  const mat = (name: string, color: number, roughness = .83, metalness = 0) => { const m = new T.MeshStandardMaterial({ color, roughness, metalness }); m.name = `Union ${name}`; materials.push(m); return m; };
  const limestone = mat('warm coursed limestone', 0xbdb098), trim = mat('pale carved limestone', 0xc8bca3, .77);
  const shadow = mat('deep interior shadow', 0x242c29, .99), glass = mat('dark framed glass', 0x344442, .24, .35), alternateGlass = mat('shaded glass', 0x283835, .32, .3);
  const frame = mat('bronze painted sash', 0x59584b, .6, .28), iron = mat('weathered iron', 0x383e39, .62, .4);
  const clay = mat('red clay barrel tiles', 0x89563f, .89), roofTrim = mat('tile caps variation', 0xa36745, .88);
  const ochre = mat('ochre entry recess', 0xa36c3c, .84), wood = mat('dark entrance doors', 0x44392d, .81);

  applyUnionStoneFinish(limestone, 'ashlar');
  applyUnionStoneFinish(trim, 'cut');
  for (const [m, mode] of [[clay, 'tile']] as const) {
    m.onBeforeCompile = s => {
      if (s.vertexShader.includes('varying vec2 vUnionMetres;')) return;
      s.vertexShader = 'varying vec2 vUnionMetres;\n' + s.vertexShader;
      s.vertexShader = s.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvUnionMetres=uv;');
      s.fragmentShader = `varying vec2 vUnionMetres;
        float unHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        vec3 unBump(vec3 p,vec3 n,float h,float face){vec3 dx=dFdx(p),dy=dFdy(p),a=cross(dy,n),b=cross(n,dx);float det=dot(dx,a)*face;return normalize(abs(det)*n-sign(det)*(dFdx(h)*a+dFdy(h)*b));}
      ` + s.fragmentShader;
      const body = `
        vec2 q=vUnionMetres/vec2(.205,.35);q.y+=mod(floor(q.x),2.)*.12;
        float aa=max(fwidth(q.y),.0001),edge=1.-smoothstep(.018,.018+aa,min(fract(q.y),1.-fract(q.y)));
        float ridge=pow(.5+.5*cos(q.x*6.2831853),.8);float tone=unHash(floor(q));
        diffuseColor.rgb*=(.81+.31*tone)*(.87+.16*ridge)*(1.-edge*.13);float unHeight=ridge*.014-edge*.003;
      `;
      s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + body);
      s.fragmentShader = s.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal=unBump(-vViewPosition,normal,unHeight,faceDirection);');
    };
    m.customProgramCacheKey = () => `union-${mode}-v1`;
  }

  const batches = new Map<T.Material, T.BufferGeometry[]>();
  const wallSamples: { origin: number[]; direction: number[]; kind: string }[] = [];
  const openingSamples: typeof wallSamples = [];
  let windows = 0, arches = 0, canopies = 0, roofTiles = 0;
  const add = (g: T.BufferGeometry, m: T.Material) => { if (!batches.has(m)) batches.set(m, []); batches.get(m)!.push(g); };
  const global = (g: T.BufferGeometry, m: T.Material) => { g.applyMatrix4(toWorld); add(g, m); };
  const extrude = (r: Rings, lo: number, hi: number, m: T.Material) => {
    // shape() flips north coordinate; rotating places it back on the local XZ
    // plane. Then negate Z so the right-handed campus transform is preserved.
    const xz = r.map(p => p.map(([u, v]) => [u, -v] as P));
    global(new T.ExtrudeGeometry(shape(xz), { depth: hi - lo, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, lo, 0), m);
  };
  const inExterior = (u: number, v: number) => {
    const p = plan.footprintLocal[0]; let best = Infinity;
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], dx = b[0] - a[0], dz = b[1] - a[1], t = T.MathUtils.clamp(((u - a[0]) * dx + (v - a[1]) * dz) / (dx * dx + dz * dz), 0, 1); best = Math.min(best, Math.hypot(u - a[0] - t * dx, v - a[1] - t * dz)); }
    return best < .04;
  };
  const archPath = (x: number, lo: number, w: number, h: number, rounded: boolean) => {
    const p = new T.Shape(); p.moveTo(x - w / 2, lo); p.lineTo(x + w / 2, lo);
    if (rounded) { const r = w / 2, spring = lo + h - r; p.lineTo(x + r, spring); p.absarc(x, spring, r, 0, Math.PI, false); }
    else p.lineTo(x + w / 2, lo + h);
    p.lineTo(x - w / 2, rounded ? lo + h - w / 2 : lo + h); p.closePath(); return p;
  };

  for (const zone of plan.zones) {
    const base = zone.datum === 'south' ? south : service, top = base + zone.wallHeight;
    extrude(zone.rings, floor, base, limestone);
    for (const r of zone.core) extrude(r, base, top, shadow);
    // Roof slopes are clipped to each separate mass, preserving the lower west
    // annexe and tall south tower rather than one oversized flat cap.
    const vs: number[] = [], uv: number[] = [];
    for (const tri of zone.roofTriangles) {
      const points = tri.map(([u, v, rise]) => new T.Vector3(u, top + rise, -v));
      const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
      if (normal.y < 0) points.reverse();
      for (const p of points) { vs.push(...p.toArray()); uv.push(p.x, -p.z); }
    }
    const roof = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(vs, 3)); roof.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); roof.computeVertexNormals(); global(roof, clay);
    const ring = zone.rings[0].map(([u, v]) => [u, -v] as P), area = ring.reduce((s, p, i) => s + p[0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * p[1], 0);
    if (area > 0) ring.reverse();
    for (let e = 0; e < ring.length; e++) {
      const a = ring[e], b = ring[(e + 1) % ring.length], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz); if (length < .15) continue;
      const along = new T.Vector3(dx / length, 0, dz / length), out = new T.Vector3(-dz / length, 0, dx / length);
      const transform = toWorld.clone().multiply(new T.Matrix4().makeBasis(along, new T.Vector3(0, 1, 0), out).setPosition(a[0], 0, a[1]));
      const midpoint = [(a[0] + b[0]) / 2, -(a[1] + b[1]) / 2], exterior = inExterior(...midpoint as P);
      const southFace = out.z > .8, eastFace = out.x > .8;
      const put = (g: T.BufferGeometry, m: T.Material) => { const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv; for (let k = 0; k < p.count; k++) uv.setXY(k, Math.abs(n.getX(k)) > .7 ? p.getZ(k) : p.getX(k), Math.abs(n.getY(k)) > .7 ? p.getZ(k) : p.getY(k)); g.applyMatrix4(transform); add(g, m); };
      const box = (x: number, y: number, d: number, w: number, h: number, depth: number, m: T.Material) => put(new T.BoxGeometry(w, h, depth).translate(x, base + y, d), m);
      const witness = (x: number, y: number, kind: string) => ({ origin: new T.Vector3(x, base + y, 2).applyMatrix4(transform).toArray(), direction: out.clone().negate().transformDirection(toWorld).toArray(), kind });
      const wall = new T.Shape([new T.Vector2(0, base), new T.Vector2(length, base), new T.Vector2(length, top), new T.Vector2(0, top)]);
      const opening = (x: number, lo: number, w: number, h: number, rounded = false, door = false, deep = .72) => {
        const path = archPath(x, base + lo, w, h, rounded); wall.holes.push(new T.Path(path.getPoints(18)));
        put(new T.ExtrudeGeometry(path, { depth: .07, bevelEnabled: false }).translate(0, 0, -deep), door ? wood : (windows % 3 === 0 ? alternateGlass : glass));
        const surround = archPath(x, base + lo - .16, w + .32, h + .32, rounded); surround.holes.push(new T.Path(path.getPoints(18)));
        put(new T.ExtrudeGeometry(surround, { depth: .24, bevelEnabled: false }).translate(0, 0, -.03), trim);
        const spring = rounded ? lo + h - w / 2 : lo + h;
        for (const side of [-1, 1]) box(x + side * (w / 2 - .045), (lo + spring) / 2, -deep + .1, .075, spring - lo, .1, frame);
        for (const y of [lo + .045, spring]) box(x, y, -deep + .1, w, .075, .1, frame);
        for (const yy of [.25, .5, .75]) box(x, lo + (spring - lo) * yy, -deep + .1, w, .035, .065, frame);
        for (const side of [-1, 0, 1]) box(x + side * w / 4, (lo + spring) / 2, -deep + .1, .035, spring - lo, .065, frame);
        box(x, lo - .14, .07, w + .36, .14, .48, trim);
        if (rounded) {
          for (let j = 0; j < 18; j++) {
            const angle = (j + .5) * Math.PI / 18, r = w / 2 + .085;
            const g = new T.BoxGeometry(.035, .23, .09).rotateZ(angle - Math.PI / 2).translate(x + Math.cos(angle) * r, base + spring + Math.sin(angle) * r, .23); put(g, limestone);
          }
          arches++;
        }
        openingSamples.push(witness(x + w * .12, lo + h * .43, rounded ? 'arched recessed glazing' : 'recessed framed glazing')); windows++;
      };

      if (zone.id === 'entry-tower') {
        if (southFace && length > 8) {
          // One deep, warm ochre arch anchors the south entrance. Above it sit
          // three small windows and an open-looking three-bay upper loggia.
          opening(length / 2, .08, 4.3, 7.55, true, true, 1.7);
          const inner = archPath(length / 2, base + .08, 4.05, 7.3, true), innerHole = archPath(length / 2, base + .08, 2.4, 4.75, true);
          inner.holes.push(new T.Path(innerHole.getPoints(18))); put(new T.ExtrudeGeometry(inner, { depth: .12, bevelEnabled: false }).translate(0, 0, -.9), ochre);
          for (const x of [length / 2 - 2.75, length / 2 + 2.75]) { box(x, 3.75, .13, .32, 7.5, .43, trim); box(x, .22, .18, .55, .44, .55, trim); }
          for (const x of [length / 2 - 2.25, length / 2, length / 2 + 2.25]) opening(x, 11.3, 1.4, 2.8);
          box(length / 2, 10.92, .29, 7.8, .32, .94, trim);
          for (let i = 0; i < 18; i++) box(length / 2 - 3.58 + i * .421, 11.47, .69, .065, .8, .065, iron);
          box(length / 2, 11.9, .69, 7.7, .08, .09, iron);
          for (const x of [length * .25, length * .5, length * .75]) opening(x, 18.7, 1.5, 3.25, false, false, 1.05);
          box(length / 2, 17.8, .08, length, .25, .4, trim);
          box(length / 2, 15.4, .02, length * .58, .78, .18, trim);
          wallSamples.push(witness(length * .08, 5, 'south entry tower stone pier'));
        } else if (length > 7) {
          for (let j = 0; j < 3; j++) opening((j + 1) * length / 4, 18.7, 1.35, 3.25, false, false, 1.05);
          if (exterior) opening(length / 2, 11.3, 1.6, 2.8);
        }
      } else if (exterior && length > 4) {
        if (zone.id === 'south-wing' && southFace) {
          const count = Math.max(1, Math.round(length / 4.9));
          for (let j = 0; j < count; j++) { const x = (j + .5) * length / count; opening(x, 6.65, Math.min(2.4, length / count - 1), 4.55, true); opening(x, 1.0, Math.min(2.15, length / count - 1), 2.65); }
          box(length / 2, 5.5, .06, length, .25, .36, trim);
          for (let j = 0; j < count; j++) box((j + .5) * length / count, 12.5, -.28, 1.15, .76, .1, alternateGlass);
        } else if (eastFace && midpoint[1] > 69 && zone.id === 'main-hall') {
          // The inspected loading-court wall has a few irregular upper windows
          // and one small tile-hooded door, not a dense repeated campus grid.
          for (const t of [.19, .47, .8]) opening(length * t, 8.1, t === .47 ? 1.35 : 1.85, t === .47 ? 1.5 : 2.1);
          const x = T.MathUtils.clamp((76.8 + a[1]) / (-dz / length), 1.7, length - 1.7);
          opening(x, .12, 1.18, 2.5, false, true);
          opening(length * .58, 3.7, 1.3, 1.15);
          const canopy = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute([x - 1.05, base + 3.3, -.04, x + 1.05, base + 3.3, -.04, x + 1.05, base + 2.9, 1.05, x - 1.05, base + 3.3, -.04, x + 1.05, base + 2.9, 1.05, x - 1.05, base + 2.9, 1.05], 3));
          canopy.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 2.1, 0, 2.1, 1.1, 0, 0, 2.1, 1.1, 0, 1.1], 2)); canopy.computeVertexNormals(); clay.side = T.DoubleSide; put(canopy, clay);
          for (const xx of [x - .8, x + .8]) box(xx, 2.79, .44, .13, .42, .75, wood);
          canopies++;
          for (const xx of [length * .38, length - .8]) box(xx, zone.wallHeight / 2, .12, .10, zone.wallHeight, .10, iron);
        } else {
          const count = Math.max(1, Math.round(length / (zone.id === 'west-annex' ? 5.4 : 7.5)));
          for (let j = 0; j < count; j++) {
            const x = (j + .5) * length / count;
            opening(x, 1.15, Math.min(1.75, length / count - .9), 2.2);
            if (zone.wallHeight > 9) opening(x + (j % 2 ? .25 : -.25), 7.7, 1.45, 2.3);
          }
        }
      }
      put(new T.ExtrudeGeometry(wall, { depth: .68, bevelEnabled: false }).translate(0, 0, -.68), limestone);
      box(length / 2, zone.wallHeight - .16, .055, length, .28, .43, trim);
      box(length / 2, zone.wallHeight + .02, .20, length + .12, .15, .74, trim);
      if (exterior || zone.id === 'entry-tower') {
        // Curved barrel ends produce a genuinely broken tile silhouette at
        // eaves, while the broad slopes use a shared procedural PBR material.
        const count = Math.floor(length / .23);
        for (let j = 0; j < count; j++) {
          const g = new T.CylinderGeometry(.102, .102, .45, 6, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate((j + .5) * length / count, top + .07, .27); put(g, j % 5 === 0 ? roofTrim : clay); roofTiles++;
        }
        if (length > 3.5) for (const t of [.2, .49, .82]) wallSamples.push(witness(length * t, !exterior && zone.id === 'entry-tower' ? 18 : Math.min(5.2, zone.wallHeight - .4), 'coursed exterior wall'));
      }
    }
  }
  const meshes: T.Mesh[] = [];
  for (const [m, parts] of batches) {
    const flat = parts.map(g => g.index ? g.toNonIndexed() : g), geometry = mergeGeometries(flat);
    if (!geometry) throw new Error('Union material batch could not be merged');
    geometry.computeBoundingBox(); geometry.computeBoundingSphere(); const mesh = new T.Mesh(geometry, m); mesh.name = `Texas Union: ${m.name}`; mesh.castShadow = mesh.receiveShadow = true; meshes.push(mesh);
    for (const g of new Set([...parts, ...flat])) g.dispose();
  }
  const high = Math.max(...plan.zones.map(z => (z.datum === 'south' ? south : service) + z.wallHeight + z.roofRise)) + 2;
  const cuts = volumes(plan.footprintWorld, floor - .4, high);
  // Fringe cells are at most 4 m across. Each triangle protects its own local
  // ground, rather than inheriting a higher threshold from the distant court.
  for (const fringe of plan.fringeWorld) cuts.push(...volumes(fringe, (triangle, center) => Math.max(...triangle.map(p => ground(p.x, p.z)), ground(center.x, center.z)) + .25, high));
  return { meshes, materials, colliderGeometries: meshes.map(m => m.geometry), volumes: cuts, candidateClearanceVolumes: cuts, wallSamples, openingSamples,
    entrancePoints: { south: localWorld(14.05, south, -2.8).toArray(), service: localWorld(33.41, service, 76.8).toArray() },
    stats: { buildings: 1, roofMasses: plan.zones.length, windows, arches, canopies, roofTiles, materialBatches: meshes.length, triangles: meshes.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0), southBaseElevation: south, serviceBaseElevation: service, tallestRoofElevation: high - 2 } };
}
