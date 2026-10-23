import * as THREE from 'three';
import type { DowntownBuilding, DowntownCrown, DowntownData, DowntownTier, PolygonRings, RGB, Ring } from './format';
import { FACADE_CODE, FLOOR_HEIGHT } from './materials';

/** Exact height of the baked terrain grid (same diagonal as terrain.ts / the rendered and collider triangles). */
export class DowntownTerrain {
  readonly nx: number; readonly nz: number; readonly step: number;
  readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number;
  constructor(private readonly data: DowntownData) {
    const m = data.meta;
    this.nx = m.grid.nx; this.nz = m.grid.nz; this.step = m.step;
    this.x0 = m.rect.xmin; this.z0 = m.rect.zmin; this.x1 = m.rect.xmax; this.z1 = m.rect.zmax;
  }
  inside(x: number, z: number) { return x >= this.x0 && x <= this.x1 && z >= this.z0 && z <= this.z1; }
  cell(x: number, z: number) {
    const i = Math.min(this.nx - 2, Math.max(0, Math.floor((x - this.x0) / this.step)));
    const j = Math.min(this.nz - 2, Math.max(0, Math.floor((z - this.z0) / this.step)));
    return j * (this.nx - 1) + i;
  }
  rendered(x: number, z: number) { return this.inside(x, z) && (this.data.cellFlags[this.cell(x, z)] & 1) === 1; }
  collidable(x: number, z: number) { return this.inside(x, z) && (this.data.cellFlags[this.cell(x, z)] & 3) === 3; }
  height(x: number, z: number): number | null {
    if (!this.inside(x, z)) return null;
    const h = this.data.heights, nx = this.nx;
    const fx = Math.min((x - this.x0) / this.step, nx - 1.000001), fz = Math.min((z - this.z0) / this.step, this.nz - 1.000001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * nx + i;
    const a = h[k], b = h[k + 1], c = h[k + nx], e = h[k + nx + 1];
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : e + (c - e) * (1 - u) + (b - e) * (1 - v);
  }
}

export interface TerrainChunkGeometry { render: THREE.BufferGeometry | null; collider: { position: Float32Array; index: Uint32Array } | null; triangles: number; colliderTriangles: number }

/** Terrain for grid cells [i0,i1) x [j0,j1): rendered cells (bit0) as an indexed mesh with smooth grid normals and
 * campus lawn UVs; the collider is exactly the subset of those triangles whose cells are collidable (bit1). */
export function terrainChunk(data: DowntownData, i0: number, i1: number, j0: number, j1: number): TerrainChunkGeometry {
  const m = data.meta, nx = m.grid.nx, step = m.step, h = data.heights, flags = data.cellFlags;
  const vid = new Map<number, number>(), pos: number[] = [], uv: number[] = [], nrm: number[] = [], idx: number[] = [], cidx: number[] = [];
  const vert = (i: number, j: number) => {
    const k = j * nx + i;
    let v = vid.get(k);
    if (v !== undefined) return v;
    v = pos.length / 3; vid.set(k, v);
    const x = m.rect.xmin + i * step, z = m.rect.zmin + j * step;
    pos.push(x, h[k], z); uv.push((x + 760) / 2, (z + 864) / 2);
    const hl = h[j * nx + Math.max(0, i - 1)], hr = h[j * nx + Math.min(nx - 1, i + 1)];
    const hu = h[Math.max(0, j - 1) * nx + i], hd = h[Math.min(m.grid.nz - 1, j + 1) * nx + i];
    const n = new THREE.Vector3(hl - hr, 2 * step, hu - hd).normalize();
    nrm.push(n.x, n.y, n.z);
    return v;
  };
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
    const f = flags[j * (nx - 1) + i];
    if (!(f & 1)) continue;
    const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), e = vert(i + 1, j + 1);
    idx.push(a, c, b, b, c, e);
    if (f & 2) cidx.push(a, c, b, b, c, e);
  }
  if (!idx.length) return { render: null, collider: null, triangles: 0, colliderTriangles: 0 };
  const g = new THREE.BufferGeometry();
  const position = new Float32Array(pos);
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeBoundingBox(); g.computeBoundingSphere();
  return { render: g, collider: cidx.length ? { position, index: new Uint32Array(cidx) } : null, triangles: idx.length / 3, colliderTriangles: cidx.length / 3 };
}

// ------------------------------------------------------------------ buildings
const lin = (c: RGB) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);

/** Flat-shaded triangle batch with the facade attributes read by materials.ts (one draw call per batch). */
export class FacadeBatch {
  position: number[] = []; normal: number[] = []; color: number[] = []; glass: number[] = []; fac: number[] = [];
  /** Per building: [first triangle, triangle count, bbox] for the bounded raycast. */
  ranges: { start: number; count: number; box: THREE.Box3 }[] = [];
  get triangles() { return this.position.length / 9; }
  private push(p: THREE.Vector3, n: THREE.Vector3, w: THREE.Color, a: THREE.Color, f: [number, number, number, number]) {
    this.position.push(p.x, p.y, p.z); this.normal.push(n.x, n.y, n.z);
    this.color.push(w.r, w.g, w.b); this.glass.push(a.r, a.g, a.b); this.fac.push(...f);
  }
  tri(p: THREE.Vector3[], f: [number, number, number, number][], w: THREE.Color, a: THREE.Color, facing?: THREE.Vector3) {
    const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0]));
    if (n.lengthSq() < 1e-12) return;
    n.normalize();
    let order = [0, 1, 2];
    if (facing && n.dot(facing) < 0) { n.negate(); order = [0, 2, 1]; }
    for (const k of order) this.push(p[k], n, w, a, f[k]);
  }
  quad(p: THREE.Vector3[], f: [number, number, number, number][], w: THREE.Color, a: THREE.Color, facing: THREE.Vector3) {
    this.tri([p[0], p[1], p[2]], [f[0], f[1], f[2]], w, a, facing);
    this.tri([p[0], p[2], p[3]], [f[0], f[2], f[3]], w, a, facing);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.position), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.normal), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.color), 3));
    g.setAttribute('aGlass', new THREE.BufferAttribute(new Float32Array(this.glass), 3));
    g.setAttribute('aFac', new THREE.BufferAttribute(new Float32Array(this.fac), 4));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

const signedArea = (r: Ring) => { let s = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };
const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);

function topOf(t: DowntownTier) {
  const pl = t.pl;
  return pl ? (x: number, z: number) => Math.min(t.y, pl[0] * x + pl[1] * z + pl[2]) : () => t.y;
}

function capTriangles(rings: PolygonRings) {
  const contour = rings[0].map(([x, z]) => new THREE.Vector2(x, z));
  const holes = rings.slice(1).map(r => r.map(([x, z]) => new THREE.Vector2(x, z)));
  const all = [contour, ...holes].flat();
  return THREE.ShapeUtils.triangulateShape(contour, holes).map(t => t.map(k => all[k]));
}

// Facade looks: deterministic per-building variation at build time (no re-bake). The baked, photo-derived palette stays
// the source of each building's hue family; the heritage low-rise (code 5) is remapped onto Austin's Congress Ave /
// E 6th St materials (red and brown brick, buff brick, cream limestone, painted brick/stucco), pale albedos are tamed
// (the campus sun + ACES blew them out to white), glass is darkened, and a per-building variant/seed and the tier
// height are packed into aFac for the shader (materials.ts):
//   aFac.z = code + (seed - .5) * .8, seed = (variant + r) / 8 (variant 0..7, r in [.05, .95])
//   aFac.w = floorHeight + 16 * round(tierTopAboveGround * 4)       (floorHeight < 16; 0 = no tier top, e.g. crowns)
const lum = (c: THREE.Color) => .2126 * c.r + .7152 * c.g + .0722 * c.b;
/** Soft-knee albedo compression in linear space (hue kept): l > knee -> knee + (l - knee) * slope. */
function tame(c: THREE.Color, knee: number, slope: number) { const l = lum(c); if (l > knee) c.multiplyScalar((knee + (l - knee) * slope) / l); return c; }
/** Stable uniform [0,1) from a building hash and a stream index. */
function unit(h: number, k: number) {
  let x = Math.imul(h ^ Math.imul(k + 1, 0x9e3779b1), 0x85ebca6b) >>> 0;
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35) >>> 0; x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
export const packFacadeCode = (code: number, variant: number, r: number) => code + ((variant + .05 + .9 * r) / 8 - .5) * .8;
export const packFloorHeight = (fh: number, topAboveGround: number) => fh + 16 * Math.max(0, Math.min(1600, Math.round(topAboveGround * 4)));
// Heritage low-rise materials (sRGB), from the downtown reference photos (Congress Ave / Sixth Street Historic District).
const BRICK: RGB[] = [[148, 74, 54], [128, 62, 46], [160, 92, 64], [112, 66, 52], [174, 108, 76], [138, 84, 66]];
const BUFF: RGB[] = [[192, 160, 116], [178, 142, 100], [200, 172, 130], [168, 134, 98]];
const LIMESTONE: RGB[] = [[202, 188, 156], [188, 174, 142], [212, 198, 168], [178, 166, 140]];
const PAINTED: RGB[] = [[214, 198, 164], [204, 176, 112], [140, 152, 120], [112, 128, 140], [172, 96, 70], [64, 86, 70],
  [76, 78, 80], [220, 214, 198], [198, 140, 118], [88, 128, 124], [186, 170, 150], [150, 60, 52]];
const OLD_GLASS: RGB[] = [[30, 34, 38], [26, 32, 32], [36, 36, 34], [28, 30, 36]];
const HOUSE_KINDS = new Set(['house', 'detached', 'shed', 'carport']);

interface TierLook { w: THREE.Color; a: THREE.Color; z: number; fh: number }
function tierLook(b: DowntownBuilding, t: DowntownTier, code: number, h: number): TierLook {
  const r = (k: number) => unit(h, k), pick = (p: RGB[], k: number) => p[Math.floor(r(k) * p.length) % p.length];
  const landmark = !!b.lm || b.src === 'landmark';
  let w = lin(t.w), a = lin(t.a), variant = 0;
  const reddish = t.w[0] - t.w[2] > 50;
  if (code === FACADE_CODE.historic) {
    // variant = material (0 brick, 1 limestone ashlar, 2 stucco/painted, 3 painted brick) + 4 for houses (no storefront).
    const p = r(1);
    let mat: number, pal: RGB[];
    if (reddish) { if (p < .62) { mat = 0; pal = BRICK; } else { mat = r(2) < .6 ? 3 : 2; pal = PAINTED; } }
    else if (p < .26) { mat = 0; pal = BUFF; }
    else if (p < .56) { mat = 1; pal = LIMESTONE; }
    else { mat = r(2) < .45 ? 3 : 2; pal = PAINTED; }
    w = lin(pick(pal, 3)); a = lin(pick(OLD_GLASS, 4));
    variant = mat + (HOUSE_KINDS.has(b.kind) ? 4 : 0);
  } else if (code === FACADE_CODE.punched || code === FACADE_CODE.ribbon) {
    // variant: window proportion 0..3 (+4 = brick coursing for the brick-red mid-rise palette).
    variant = Math.floor(r(5) * 4) + (reddish && !landmark ? 4 : 0);
  }
  if (!landmark) {
    // Local distinction: brightness and a slight warm/cool shift per building; glass a little darker and varied.
    const s = r(6) - .5;
    w.multiplyScalar(.9 + .2 * r(7)); w.r *= 1 + .08 * s; w.b *= 1 - .08 * s;
    a.multiplyScalar(.74 + .18 * r(8));
  } else a.multiplyScalar(.9);
  tame(w, landmark ? .34 : .28, landmark ? .62 : .5);
  // Mid-rise/tower floor rhythm varies a little per building (estimated storeys; landmark rhythm unchanged).
  const fh = FLOOR_HEIGHT[code] * (landmark || code === FACADE_CODE.historic ? 1 : .95 + .1 * r(9));
  return { w, a, z: packFacadeCode(code, variant, r(10)), fh };
}

/** Projecting cornice on heritage low-rise (code 5) street walls: a cove (wall -> d out) and a vertical fascia, sharing
 * the wall's u so the shader paints them as the cornice band, closed on top by a roof-coloured cap at the roof height
 * (so a downward ray meets the same up-facing surface in the render and in the two-sided collider). Mitered with the
 * neighbouring edges; 6 triangles per edge. */
const CORNICE_MIN_EDGE = 6;
function addCornice(batch: FacadeBatch, a: THREE.Vector2, b: THREE.Vector2, nPrev: THREE.Vector2, n: THREE.Vector2, nNext: THREE.Vector2,
  top: number, g0: number, u: number, len: number, look: TierLook, fw: number, roofColor: THREE.Color) {
  const tall = top - g0 >= 6, d = tall ? .36 : .26, cove = tall ? .75 : .6, fascia = tall ? .3 : .24;
  const miter = (m: THREE.Vector2) => { const k = 1 + m.dot(n); return k < .5 ? n.clone().multiplyScalar(d) : m.clone().add(n).multiplyScalar(d / k); };
  const oa = a.clone().add(miter(nPrev)), ob = b.clone().add(miter(nNext));
  const out = new THREE.Vector3(n.x, 0, n.y);
  const P = (q: THREE.Vector2, y: number) => new THREE.Vector3(q.x, y, q.y);
  const F = (uu: number, y: number): [number, number, number, number] => [uu, y - g0, look.z, fw];
  const y0 = top - cove, y1 = top - fascia;
  batch.quad([P(a, y0), P(b, y0), P(ob, y1), P(oa, y1)], [F(u, y0), F(u + len, y0), F(u + len, y1), F(u, y1)], look.w, look.a, out);
  batch.quad([P(oa, y1), P(ob, y1), P(ob, top), P(oa, top)], [F(u, y1), F(u + len, y1), F(u + len, top), F(u, top)], look.w, look.a, out);
  const R = (q: THREE.Vector2): [number, number, number, number] => [q.x, q.y, 0, 4];
  batch.quad([P(a, top), P(b, top), P(ob, top), P(oa, top)], [R(a), R(b), R(ob), R(oa)], roofColor, roofColor, UP);
}

/** Massing of one tier: walls from `bottom` to the (flat or planar) top, a roof cap and, for raised tiers, a soffit. */
function addTier(batch: FacadeBatch, b: DowntownBuilding, t: DowntownTier, roofColor: THREE.Color, h: number) {
  const g0 = b.g[0], bottom = t.b ?? g0 - .6, top = topOf(t);
  const code = FACADE_CODE[t.f] ?? 1;
  const look = tierLook(b, t, code, h), w = look.w, a = look.a, z = look.z, fw = packFloorHeight(look.fh, t.y - g0);
  const cornice = code === FACADE_CODE.historic && !b.visual && t.b === undefined && !t.pl && t.y - g0 >= 4;
  t.r.forEach((ring, ri) => {
    const ccw = signedArea(ring) > 0, outwardSign = (ccw ? 1 : -1) * (ri ? -1 : 1);
    // Outward unit normals per edge (null for degenerate edges), for the cornice miters.
    const normals = ring.map(([ax, az], i) => {
      const [bx, bz] = ring[(i + 1) % ring.length], len = Math.hypot(bx - ax, bz - az);
      return len < .02 ? null : new THREE.Vector2((bz - az) * outwardSign / len, -(bx - ax) * outwardSign / len);
    });
    const near = (i: number, step: number) => { for (let k = 1; k <= ring.length; k++) { const q = normals[((i + step * k) % ring.length + ring.length) % ring.length]; if (q) return q; } return normals[i]!; };
    let u = 0;
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < .02) continue;
      const out = new THREE.Vector3((bz - az) * outwardSign, 0, -(bx - ax) * outwardSign).normalize();
      const ta = top(ax, az), tb = top(bx, bz);
      const p = [new THREE.Vector3(ax, bottom, az), new THREE.Vector3(bx, bottom, bz), new THREE.Vector3(bx, tb, bz), new THREE.Vector3(ax, ta, az)];
      const f: [number, number, number, number][] = [[u, bottom - g0, z, fw], [u + len, bottom - g0, z, fw], [u + len, tb - g0, z, fw], [u, ta - g0, z, fw]];
      batch.quad(p, f, w, a, out);
      if (cornice && ri === 0 && len >= CORNICE_MIN_EDGE)
        addCornice(batch, new THREE.Vector2(ax, az), new THREE.Vector2(bx, bz), near(i, -1), normals[i]!, near(i, 1), t.y, g0, u, len, look, fw, roofColor);
      u += len;
    }
  });
  for (const tri of capTriangles(t.r)) {
    const p = tri.map(q => new THREE.Vector3(q.x, top(q.x, q.y), q.y));
    batch.tri(p, tri.map(q => [q.x, q.y, 0, 4] as [number, number, number, number]), roofColor, roofColor, UP);
    if (t.b !== undefined) {
      const s = tri.map(q => new THREE.Vector3(q.x, bottom, q.y));
      batch.tri(s, tri.map(q => [q.x, q.y, 10, 4] as [number, number, number, number]), w.clone().multiplyScalar(.7), a, DOWN);
    }
  }
}

function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; }
// Membrane, gravel and dark-tar roofs (sRGB); the warm grey entry reads as gravel ballast on heritage parapet roofs.
const ROOFS: RGB[] = [[150, 150, 146], [176, 176, 170], [120, 122, 122], [196, 194, 186], [104, 104, 100], [138, 128, 116], [84, 86, 88]];

/** Crowns (landmarks.json `crown`): authored, reference-guided ESTIMATES built in the top tier's oriented frame. */
export function addCrown(batch: FacadeBatch, c: DowntownCrown) {
  const col = lin(c.color), u = new THREE.Vector2(c.u[0], c.u[1]), v = new THREE.Vector2(-c.u[1], c.u[0]);
  const P = (du: number, dv: number, y: number) => new THREE.Vector3(c.c[0] + u.x * du + v.x * dv, y, c.c[1] + u.y * du + v.y * dv);
  const solid: [number, number, number, number] = [0, 0, FACADE_CODE.solid, 4];
  const F = (n: number) => Array.from({ length: n }, () => solid);
  const box = (du0: number, du1: number, dv0: number, dv1: number, y0: number, y1: number, color = col, glassy = false) => {
    const cs = [P(du0, dv0, y0), P(du1, dv0, y0), P(du1, dv1, y0), P(du0, dv1, y0)];
    const ts = cs.map(p => p.clone().setY(y1));
    const ctr = P((du0 + du1) / 2, (dv0 + dv1) / 2, (y0 + y1) / 2);
    const f = glassy ? (Array.from({ length: 4 }, () => [0, 0, FACADE_CODE.curtain, 4]) as [number, number, number, number][]) : F(4);
    for (let k = 0; k < 4; k++) {
      const q = [cs[k], cs[(k + 1) % 4], ts[(k + 1) % 4], ts[k]];
      const out = q[0].clone().add(q[1]).multiplyScalar(.5).sub(ctr).setY(0).normalize();
      batch.quad(q, f, color, color, out);
    }
    batch.quad([ts[0], ts[1], ts[2], ts[3]], f, color, color, UP);
  };
  const pyramid = (cu: number, cv: number, hu: number, hv: number, y0: number, h: number, color: THREE.Color) => {
    const base = [P(cu - hu, cv - hv, y0), P(cu + hu, cv - hv, y0), P(cu + hu, cv + hv, y0), P(cu - hu, cv + hv, y0)];
    const apex = P(cu, cv, y0 + h), ctr = P(cu, cv, y0);
    const glassF = Array.from({ length: 3 }, (_, k) => [k * 3, y0 + k, FACADE_CODE.curtain, 4] as [number, number, number, number]);
    for (let k = 0; k < 4; k++) {
      const out = base[k].clone().add(base[(k + 1) % 4]).multiplyScalar(.5).sub(ctr).setY(.6).normalize();
      batch.tri([base[k], base[(k + 1) % 4], apex], glassF, color, color, out);
    }
  };
  const L = c.L / 2, W = c.W / 2, y = c.y;
  if (c.type === 'frame' || c.type === 'parapet') {
    // Open rooftop frame / screen: four thin walls (no roof) rising c.h above the roof edge.
    const t = c.type === 'frame' ? .9 : .45;
    box(-L, L, -W, -W + t, y, y + c.h); box(-L, L, W - t, W, y, y + c.h);
    box(-L, -L + t, -W, W, y, y + c.h); box(L - t, L, -W, W, y, y + c.h);
    if (c.type === 'frame') for (const s of [-1, 1]) box(-L, L, s * W * .34 - .3, s * W * .34 + .3, y + c.h - 1.2, y + c.h);
  } else if (c.type === 'mast') {
    box(-1.6, 1.6, -1.6, 1.6, y, y + c.h * .35);
    box(-.6, .6, -.6, .6, y + c.h * .35, y + c.h);
  } else if (c.type === 'fin') {
    // Austonian: thin curved blade rising along the long axis to c.h above the roof at one end.
    const n = 8;
    for (let k = 0; k < n; k++) {
      const a0 = k / n, a1 = (k + 1) / n;
      const du0 = -L + 2 * L * a0, du1 = -L + 2 * L * a1;
      box(du0, du1, -.5, .5, y, y + c.h * a1 * a1, col, true);
    }
  } else if (c.type === 'spires') {
    // Frost Bank Tower: folded glass crown, two tall central spires and four lower corner peaks.
    const glassCol = col;
    pyramid(0, 0, L * .62, W * .7, y, c.h * .45, glassCol);
    for (const s of [-1, 1]) pyramid(s * L * .3, 0, L * .22, W * .32, y + c.h * .1, c.h * .9, glassCol);
    for (const su of [-1, 1]) for (const sv of [-1, 1]) pyramid(su * L * .72, sv * W * .62, L * .18, W * .22, y, c.h * .5, glassCol);
  }
}

export interface BuildingChunk { major: FacadeBatch; minor: FacadeBatch; buildings: number; majorBuildings: DowntownBuilding[]; minorBuildings: DowntownBuilding[] }

/** All buildings of one chunk in two batches: skyline (top >= 30 m above ground, landmarks) and low-rise. */
export function buildingChunk(buildings: DowntownBuilding[]): BuildingChunk {
  const major = new FacadeBatch(), minor = new FacadeBatch(), majorBuildings: DowntownBuilding[] = [], minorBuildings: DowntownBuilding[] = [];
  for (const b of buildings) {
    const top = Math.max(...b.tiers.map(t => t.y)) - b.g[0];
    const batch = top >= 30 || b.lm ? major : minor;
    (batch === major ? majorBuildings : minorBuildings).push(b);
    const start = batch.triangles;
    const h = hash(b.k), roof = lin(ROOFS[h % ROOFS.length]);
    for (const t of b.tiers) addTier(batch, b, t, roof, h);
    if (b.crown) addCrown(batch, b.crown);
    const box = new THREE.Box3();
    for (let i = start * 9; i < batch.position.length; i += 3) box.expandByPoint(new THREE.Vector3(batch.position[i], batch.position[i + 1], batch.position[i + 2]));
    batch.ranges.push({ start, count: batch.triangles - start, box });
  }
  return { major, minor, buildings: buildings.length, majorBuildings, minorBuildings };
}

const _ray = new THREE.Ray(), _inv = new THREE.Matrix4(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _hit = new THREE.Vector3();
/** Raycast that tests only the triangles of buildings whose box the ray hits (non-indexed geometry). */
export function rangeRaycast(mesh: THREE.Mesh, ranges: { start: number; count: number; box: THREE.Box3 }[]) {
  mesh.raycast = (raycaster, intersects) => {
    _inv.copy(mesh.matrixWorld).invert();
    _ray.copy(raycaster.ray).applyMatrix4(_inv);
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (const r of ranges) {
      if (!_ray.intersectsBox(r.box)) continue;
      for (let t = r.start; t < r.start + r.count; t++) {
        _a.fromBufferAttribute(pos, t * 3); _b.fromBufferAttribute(pos, t * 3 + 1); _c.fromBufferAttribute(pos, t * 3 + 2);
        const p = _ray.intersectTriangle(_a, _b, _c, mesh.material instanceof THREE.Material && mesh.material.side !== THREE.DoubleSide, _hit);
        if (!p) continue;
        const world = p.clone().applyMatrix4(mesh.matrixWorld), distance = raycaster.ray.origin.distanceTo(world);
        if (distance < raycaster.near || distance > raycaster.far) continue;
        const normal = new THREE.Vector3().subVectors(_c, _b).cross(new THREE.Vector3().subVectors(_a, _b)).normalize();
        intersects.push({ distance, point: world, object: mesh, face: { a: t * 3, b: t * 3 + 1, c: t * 3 + 2, normal, materialIndex: 0 }, faceIndex: t });
      }
    }
  };
}

/** Vertical rays on terrain: exact analytic hit on the grid (same triangles); other rays use the default raycast. */
export function terrainRaycast(mesh: THREE.Mesh, terrain: DowntownTerrain) {
  const fallback = THREE.Mesh.prototype.raycast.bind(mesh);
  const box = mesh.geometry.boundingBox!;
  mesh.raycast = (raycaster, intersects) => {
    const d = raycaster.ray.direction, o = raycaster.ray.origin;
    if (Math.abs(d.x) > 1e-6 || Math.abs(d.z) > 1e-6 || d.y > -0.999999) { fallback(raycaster, intersects); return; }
    if (o.x < box.min.x || o.x > box.max.x || o.z < box.min.z || o.z > box.max.z || !terrain.rendered(o.x, o.z)) return;
    const y = terrain.height(o.x, o.z);
    if (y === null || y > o.y) return;
    const distance = o.y - y;
    if (distance < raycaster.near || distance > raycaster.far) return;
    const e = .5, hx = (terrain.height(o.x - e, o.z) ?? y) - (terrain.height(o.x + e, o.z) ?? y), hz = (terrain.height(o.x, o.z - e) ?? y) - (terrain.height(o.x, o.z + e) ?? y);
    const normal = new THREE.Vector3(hx, 2 * e, hz).normalize();
    intersects.push({ distance, point: new THREE.Vector3(o.x, y, o.z), object: mesh, face: { a: 0, b: 0, c: 0, normal, materialIndex: 0 } });
  };
}

// ------------------------------------------------------------------ bridges, water, trees
export function soupGeometry(tris: Float32Array, keep?: (t: number) => boolean) {
  const out: number[] = [];
  for (let t = 0; t < tris.length / 9; t++) if (!keep || keep(t)) for (let k = 0; k < 9; k++) out.push(tris[t * 9 + k]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(out), 3));
  g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

/** Bridge decks: rendered soup; collider = the collidable subset (same triangles). Deck tops face up. */
export function bridgeGeometry(data: DowntownData) {
  const src = data.bridges, n = src.length / 9;
  // Orient every top triangle upward (the bake emits xz-triangulation order).
  const fixed = new Float32Array(src);
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const ax = fixed[o + 3] - fixed[o], ay = fixed[o + 4] - fixed[o + 1], az = fixed[o + 5] - fixed[o + 2];
    const bx = fixed[o + 6] - fixed[o], by = fixed[o + 7] - fixed[o + 1], bz = fixed[o + 8] - fixed[o + 2];
    const ny = az * bx - ax * bz;
    const vertical = Math.abs(ny) < 1e-6 * Math.hypot(ay * bz - az * by, ax * by - ay * bx, 1);
    if (!vertical && ny < 0) for (let k = 0; k < 3; k++) { const tmp = fixed[o + 3 + k]; fixed[o + 3 + k] = fixed[o + 6 + k]; fixed[o + 6 + k] = tmp; }
  }
  const render = soupGeometry(fixed);
  const collider = soupGeometry(fixed, t => data.bridgeCollide[t] === 1);
  return { render, collider, triangles: n, colliderTriangles: collider.getAttribute('position').count / 3 };
}

export function waterGeometry(data: DowntownData) { return soupGeometry(data.water); }
