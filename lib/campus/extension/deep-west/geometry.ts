import * as THREE from 'three';
import { Batch, type FacadeAttr } from '../../context/batch';
import type { DeepWestBuilding, DeepWestData, DistrictStyle, PolygonRings, Ring } from './format';
import { SEAM_X } from './format';

/** Render geometry for one material slot. The same BufferGeometry is the Rapier trimesh
 * (render/collider parity): nothing is rendered that is not also collidable, and vice versa. */
export interface DeepWestPart { name: string; district: string | null; material: string; geometry: THREE.BufferGeometry }

const BUCKET = 4;

/** Exact height of the baked terrain triangles (the rendered and collidable surface). */
export class TerrainHeight {
  private readonly cells = new Map<number, number[]>();
  private readonly nx: number;
  constructor(private readonly position: Float32Array, private readonly index: Uint32Array,
    private readonly union: { xmin: number; xmax: number; zmin: number; zmax: number }) {
    this.nx = Math.ceil((union.xmax - union.xmin) / BUCKET) + 2;
    for (let t = 0; t < index.length; t += 3) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const i = index[t + k] * 3;
        x0 = Math.min(x0, position[i]); x1 = Math.max(x1, position[i]);
        z0 = Math.min(z0, position[i + 2]); z1 = Math.max(z1, position[i + 2]);
      }
      for (let cz = this.cz(z0); cz <= this.cz(z1); cz++) for (let cx = this.cx(x0); cx <= this.cx(x1); cx++) {
        const key = cz * this.nx + cx, list = this.cells.get(key);
        if (list) list.push(t); else this.cells.set(key, [t]);
      }
    }
  }
  private cx(x: number) { return Math.floor((x - this.union.xmin) / BUCKET) + 1; }
  private cz(z: number) { return Math.floor((z - this.union.zmin) / BUCKET) + 1; }
  /** Height at (x, z) on the extension triangles, or null outside the owned union / at x >= -760. */
  height(x: number, z: number): number | null {
    const u = this.union;
    if (!(x < SEAM_X && x >= u.xmin && z >= u.zmin && z <= u.zmax)) return null;
    const list = this.cells.get(this.cz(z) * this.nx + this.cx(x));
    if (!list) return null;
    const p = this.position, idx = this.index;
    for (const t of list) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ax = p[a], az = p[a + 2], bx = p[b], bz = p[b + 2], cx = p[c], cz = p[c + 2];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-12) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-7 || l2 < -1e-7 || l3 < -1e-7) continue;
      return l1 * p[a + 1] + l2 * p[b + 1] + l3 * p[c + 1];
    }
    return null;
  }
}

/** Terrain: the baked indexed triangles expanded to a flat-shaded soup, matching the
 * offline-terrain-61 look and its UV convention ((x + 760) / 2, (z + 864) / 2). */
export function terrainGeometry(data: DeepWestData) {
  const { terrainPosition: p, terrainIndex: idx } = data;
  const pos = new Float32Array(idx.length * 3), uv = new Float32Array(idx.length * 2);
  for (let i = 0; i < idx.length; i++) {
    const v = idx[i] * 3;
    pos[i * 3] = p[v]; pos[i * 3 + 1] = p[v + 1]; pos[i * 3 + 2] = p[v + 2];
    uv[i * 2] = (p[v] + 760) / 2; uv[i * 2 + 1] = (p[v + 2] + 864) / 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

/** Imported 2023 surface polygons, already clipped, non-overlapping and split on the terrain
 * triangles by the bake; each vertex is the terrain plane + `meta.drape`, fading to 0 at the
 * seam so the collidable sheets meet offline-61 flush (no lip, no gap). */
export function surfaceGeometry(positions: Float32Array) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(positions), uv = new Float32Array(pos.length / 3 * 2);
  for (let i = 0; i < pos.length / 3; i++) { uv[i * 2] = pos[i * 3] / 3; uv[i * 2 + 1] = pos[i * 3 + 2] / 3; }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

const srgb = (rgb: [number, number, number], scale = 1) =>
  new THREE.Color().setRGB(rgb[0] / 255 * scale, rgb[1] / 255 * scale, rgb[2] / 255 * scale, THREE.SRGBColorSpace);

function signedArea(ring: Ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

/** Outward (away from the polygon's material) horizontal normal factor for a ring,
 * independent of the stored winding: +1 means (dz, -dx) points outward. */
function outwardFactor(ring: Ring, hole: boolean) {
  return (signedArea(ring) > 0 ? 1 : -1) * (hole ? -1 : 1);
}

/** Deterministic [0,1) per building key and salt. */
function keyHash(key: string, salt: number) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100003) / 100003;
}
/** Opening code (context facade shader): type + 8*mullions + 32*transom + 64*frame + 256*surround; the extension's own
 * material reads 512*glass tint (0 blue-grey, 1 green, 2 deep blue, 3 bronze) on top. */
const openCode = (type: number, mull: number, transom: number, frame: number, surround: number, glass: number) =>
  type + 8 * mull + 32 * transom + 64 * frame + 256 * surround + 512 * glass;
/** Accent colours seen on West Campus / Judges' Hill apartment blocks (d39/d40 orbit pixels; ESTIMATED palette). */
const ACCENTS: [number, number, number][] = [[58, 60, 64], [176, 98, 62], [196, 156, 82], [92, 112, 132], [134, 150, 120], [150, 84, 70]];

export interface FacadeProgram {
  upper: [number, number, number, number];
  /** Glazed ground storey (taller flat buildings only). */
  ground: [number, number, number, number] | null; groundColor: THREE.Color;
  accent: THREE.Color | null; every: number; pierWidth: number;
  base: THREE.Color | null; parapet: THREE.Color | null;
}

/** ESTIMATED per-building facade programme: no surveyed openings. Taller flat-roofed apartment blocks (D37/D39/D40,
 * >= 9 m) get one of three window types, light or dark frames by wall family, and (by hash, always on >= 20 m) accent
 * piers between bays plus a glazed ground storey; houses keep the district punched window with a transom bar. Profiles
 * (highrise-identity/deep-west.ts) may fix the accent colour, spacing and glass tint. */
export function facadeProgram(b: DeepWestBuilding, style: DistrictStyle, gable: boolean, height: number): FacadeProgram {
  const h1 = keyHash(b.key, 1), h2 = keyHash(b.key, 2), h3 = keyHash(b.key, 3);
  const light = b.wall.family !== 'brownBrick' && b.wall.family !== 'buffBrick';
  const frame = light ? 2 : style.frame === 1 ? 1 : 0;
  const glass = b.facade?.glass ?? (h3 < .45 ? 0 : h3 < .7 ? 2 : h3 < .88 ? 1 : 3);
  const wall = srgb(b.wall.rgb);
  const none: FacadeProgram = { upper: [style.window[0], style.window[1], style.window[2], openCode(1, 0, 1, frame, style.surround, glass)],
    ground: null, groundColor: wall, accent: null, every: 3, pierWidth: 0, base: null, parapet: null };
  if (gable || height < 9 || b.district === 'D38') return none;
  const tall = height >= 20;
  // Window type: wide paired casements, tall narrow units, or horizontal ribbons (precast/stucco only).
  const kind = h1 < .45 ? 'pair' : h1 < .8 || !light ? 'tall' : 'ribbon';
  const upper: [number, number, number, number] = kind === 'pair' ? [.62, .26, .8, openCode(1, 1, 0, frame, 0, glass)]
    : kind === 'tall' ? [.4, .12, .9, openCode(1, 0, 1, frame, style.surround, glass)]
    : [.88, .3, .78, openCode(2, 3, 0, frame, 0, glass)];
  const accented = b.facade?.accent || tall || h2 < (b.district === 'D40' ? .55 : .3);
  const pick = ACCENTS[Math.floor(h2 * 997) % ACCENTS.length];
  const accent = b.facade?.accent ? srgb(b.facade.accent) : accented ? (light ? srgb(pick) : srgb(b.wall.rgb, .62)) : null;
  const dark = srgb(b.wall.rgb, .45).lerp(new THREE.Color().setRGB(.05, .05, .055), .35);
  return {
    upper,
    ground: tall ? [.86, .04, .86, openCode(3, 2, 1, 0, 0, glass)] : null, groundColor: dark,
    accent, every: b.facade?.every ?? (kind === 'ribbon' ? 4 : 2 + Math.floor(h3 * 2)), pierWidth: tall ? 1.1 : .8,
    base: tall ? dark : null, parapet: accent && tall ? accent.clone().multiplyScalar(.9) : null,
  };
}

export interface BuildingStats { buildings: number; walls: number; roofTriangles: number; gable: number; flatParapet: number; flat: number; holes: number; windowsEdges: number }

/** Clean massing from the measured footprint (holes kept) and MAX_HEIGHT, with generic,
 * ESTIMATED architecture: plinth band, storey/bay window rhythm drawn by the borrowed context
 * facade shader, 0.9 m parapet with coping on flat roofs, and estimated gables on small
 * near-rectangular houses (ridge at the measured top). Nothing here is surveyed detail. */
export function buildingParts(buildings: DeepWestBuilding[], districts: Record<string, DistrictStyle>) {
  const walls = new Map<string, Batch>(), roofs = new Map<string, Batch>();
  const stats: BuildingStats = { buildings: 0, walls: 0, roofTriangles: 0, gable: 0, flatParapet: 0, flat: 0, holes: 0, windowsEdges: 0 };
  const batch = (map: Map<string, Batch>, key: string, facade: boolean) => {
    let b = map.get(key);
    if (!b) { b = new Batch(facade); map.set(key, b); }
    return b;
  };
  const up = new THREE.Vector3(0, 1, 0);
  for (const b of buildings) {
    const style = districts[b.district];
    const wall = batch(walls, `${b.district}|wall:${b.wall.family}`, true);
    const roof = batch(roofs, `${b.district}|roof:${b.roof.family}`, false);
    const color = srgb(b.wall.rgb), plinth = srgb(b.wall.rgb, .7);
    const trim = color.clone().lerp(new THREE.Color().setRGB(.62, .6, .56), .55);
    const roofColor = srgb(b.roof.rgb);
    const r = b.roof;
    const gable = r.form === 'gable-estimated' ? r : null;
    const topY = gable ? gable.ridgeY : (r as { topY: number }).topY;
    const limit = gable ? gable.eaveY : (r as { deckY: number }).deckY;
    const y0 = b.groundMin - .6;
    const plinthTop = Math.max(y0 + .2, Math.min(b.groundMax + .45, limit - 2.2));
    const floors = Math.max(1, Math.round((limit - plinthTop) / style.floor));
    const floorH = (limit - plinthTop) / floors;
    const program = facadeProgram(b, style, !!gable, limit - b.groundMin);
    const win = program.upper;
    const normal = gable ? [-gable.ridge[1][1], gable.ridge[1][0]] : [0, 0];
    const dist = (x: number, z: number) => gable ? (x - gable.ridge[0][0]) * normal[0] + (z - gable.ridge[0][1]) * normal[1] : 0;
    const top = (x: number, z: number) => gable ? gable.ridgeY - gable.slope * Math.abs(dist(x, z)) : topY;
    stats.buildings++;
    if (gable) stats.gable++; else if (r.form === 'flat-parapet') stats.flatParapet++; else stats.flat++;
    stats.holes += b.rings.length - 1;
    b.rings.forEach((source, ringIndex) => {
      const f = outwardFactor(source, ringIndex > 0);
      // Gable walls follow the roof: split edges where they cross the ridge line.
      const ring: Ring = [];
      for (let i = 0; i < source.length; i++) {
        const p = source[i], q = source[(i + 1) % source.length];
        ring.push(p);
        if (gable) {
          const dp = dist(p[0], p[1]), dq = dist(q[0], q[1]);
          if (dp * dq < 0) { const t = dp / (dp - dq); ring.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
        }
      }
      for (let i = 0; i < ring.length; i++) {
        const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < .02) continue;
        const out = new THREE.Vector3((bz - az) * f, 0, -(bx - ax) * f).normalize();
        const ta = top(ax, az), tb = top(bx, bz);
        const A0 = new THREE.Vector3(ax, y0, az), B0 = new THREE.Vector3(bx, y0, bz);
        const A1 = new THREE.Vector3(ax, plinthTop, az), B1 = new THREE.Vector3(bx, plinthTop, bz);
        const A2 = new THREE.Vector3(ax, ta, az), B2 = new THREE.Vector3(bx, tb, bz);
        wall.quad(A0, B0, B1, A1, [0, y0], [len, y0], [len, plinthTop], [0, plinthTop], program.base ?? plinth, out);
        const bays = Math.max(1, Math.round(len / style.bay)), bayW = len / bays;
        const v = (y: number) => (y - plinthTop) / floorH;
        stats.walls++;
        if (gable || len < 1.6) {
          let attr: FacadeAttr | undefined;
          if (len >= 1.6) {
            attr = { fac: [[0, 0, bayW, floorH], [bays, 0, bayW, floorH], [bays, v(tb), bayW, floorH], [0, v(ta), bayW, floorH]],
              win, range: [0, floors - 1] };
            stats.windowsEdges++;
          }
          wall.quad(A1, B1, B2, A2, [0, plinthTop], [len, plinthTop], [len, tb], [0, ta], color, out, attr);
          continue;
        }
        // Flat roofs: the same wall plane, split into coplanar strips (render = collider unchanged in shape): optional
        // accent piers between window bays, a glazed ground storey on taller buildings, the parapet as a trim band.
        stats.windowsEdges++;
        const ux = (bx - ax) / len, uz = (bz - az) / len;
        const P = (s: number, y: number) => new THREE.Vector3(ax + ux * s, y, az + uz * s);
        const cuts: [number, number, boolean][] = [];
        const pier = program.accent ? Math.min(program.pierWidth, bayW * (1 - win[0]) - .25) : 0;
        let s = 0;
        if (pier >= .3 && bays >= 2) for (let k = program.every; k < bays; k += program.every) {
          const c = k * bayW;
          cuts.push([s, c - pier / 2, false], [c - pier / 2, c + pier / 2, true]);
          s = c + pier / 2;
        }
        cuts.push([s, len, false]);
        const deck = Math.min(limit, topY), groundTop = program.ground ? Math.min(plinthTop + floorH, deck) : plinthTop;
        const strip = (s0: number, s1: number, y0s: number, y1s: number, c: THREE.Color, w?: [number, number, number, number], range?: [number, number]) => {
          if (y1s - y0s < .01 || s1 - s0 < .01) return;
          const attr: FacadeAttr | undefined = w ? { fac: [[s0 / bayW, v(y0s), bayW, floorH], [s1 / bayW, v(y0s), bayW, floorH], [s1 / bayW, v(y1s), bayW, floorH], [s0 / bayW, v(y1s), bayW, floorH]], win: w, range: range! } : undefined;
          wall.quad(P(s0, y0s), P(s1, y0s), P(s1, y1s), P(s0, y1s), [s0, y0s], [s1, y0s], [s1, y1s], [s0, y1s], c, out, attr);
        };
        for (const [s0, s1, isPier] of cuts) {
          if (isPier) { strip(s0, s1, plinthTop, topY, program.accent!); continue; }
          if (program.ground) strip(s0, s1, plinthTop, groundTop, program.groundColor, program.ground, [0, 0]);
          strip(s0, s1, groundTop, deck, color, win, [program.ground ? 1 : 0, floors - 1]);
          strip(s0, s1, deck, topY, program.parapet ?? trim);
        }
      }
    });
    const flat = (polys: PolygonRings[], y: number, target: Batch, c: THREE.Color) => {
      for (const rings of polys) {
        const contour = rings[0].map(([x, z]) => new THREE.Vector2(x, z));
        const holes = rings.slice(1).map(h => h.map(([x, z]) => new THREE.Vector2(x, z)));
        const all = [contour, ...holes].flat();
        for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, holes)) {
          const a = all[i], bb = all[j], cc = all[k];
          target.tri(new THREE.Vector3(a.x, y, a.y), new THREE.Vector3(bb.x, y, bb.y), new THREE.Vector3(cc.x, y, cc.y),
            [a.x, a.y], [bb.x, bb.y], [cc.x, cc.y], c, up);
          if (target === roof) stats.roofTriangles++;
        }
      }
    };
    if (gable) {
      for (const half of gable.halves) {
        const contour = half[0].map(([x, z]) => new THREE.Vector2(x, z));
        for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
          const v = [contour[i], contour[j], contour[k]].map(p => new THREE.Vector3(p.x, top(p.x, p.y), p.y));
          roof.tri(v[0], v[1], v[2], [v[0].x, v[0].z], [v[1].x, v[1].z], [v[2].x, v[2].z], roofColor, up);
          stats.roofTriangles++;
        }
      }
    } else if (r.form === 'flat-parapet' && r.deck && r.coping) {
      flat(r.deck, r.deckY, roof, roofColor);
      flat(r.coping, r.topY, wall, trim);
      // Inner parapet faces, looking into the deck (away from the parapet solid).
      for (const rings of r.deck) rings.forEach((ring, ringIndex) => {
        const f = -outwardFactor(ring, ringIndex > 0);
        for (let i = 0; i < ring.length; i++) {
          const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
          const len = Math.hypot(bx - ax, bz - az);
          if (len < .02) continue;
          const inward = new THREE.Vector3((bz - az) * f, 0, -(bx - ax) * f).normalize();
          wall.quad(new THREE.Vector3(ax, r.deckY, az), new THREE.Vector3(bx, r.deckY, bz), new THREE.Vector3(bx, r.topY, bz), new THREE.Vector3(ax, r.topY, az),
            [0, r.deckY], [len, r.deckY], [len, r.topY], [0, r.topY], trim, inward);
        }
      });
    } else {
      flat([b.rings], topY, roof, roofColor);
    }
  }
  const parts: DeepWestPart[] = [];
  for (const [key, b] of [...walls, ...roofs]) {
    if (!b.triangles) continue;
    const [district, material] = key.split('|');
    parts.push({ name: `Deep West ${district} ${material}`, district, material, geometry: b.geometry() });
  }
  return { parts, stats };
}
