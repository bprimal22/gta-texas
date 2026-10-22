import * as THREE from 'three';

/** Indexed, flat-shaded triangle batch with metric UVs, vertex colour and the
 * facade attributes read by the context wall shader:
 *   aFac   = (u in bays, v in floors, bay width m, floor height m)
 *   aWin   = (window width / bay, sill / floor, head / floor, code)
 *   aRange = (first, last) floor index that carries openings.
 * Geometry without openings uses aWin = 0 (code 0 = solid). */

export type V3 = THREE.Vector3;
export type UV = [number, number];
export interface FacadeAttr { fac: [number, number, number, number][]; win: [number, number, number, number]; range: [number, number] }

const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
const ZERO4: [number, number, number, number] = [0, 0, 0, 0];

export class Batch {
  position: number[] = [];
  normal: number[] = [];
  uv: number[] = [];
  color: number[] = [];
  fac: number[] = [];
  win: number[] = [];
  range: number[] = [];
  index: number[] = [];
  constructor(readonly facade = false) {}
  get triangles() { return this.index.length / 3; }
  get vertices() { return this.position.length / 3; }

  private face(points: V3[], facing?: V3) {
    n.crossVectors(e1.subVectors(points[1], points[0]), e2.subVectors(points[2], points[0]));
    if (points.length === 4 && n.lengthSq() < 1e-12) n.crossVectors(e1.subVectors(points[2], points[0]), e2.subVectors(points[3], points[0]));
    const l = n.length();
    if (l < 1e-9) return false;
    n.divideScalar(l);
    if (facing && n.dot(facing) < 0) return 'flip';
    return true;
  }
  private push(p: V3, t: UV, c: THREE.Color, f: [number, number, number, number], a: FacadeAttr | undefined) {
    this.position.push(p.x, p.y, p.z);
    this.normal.push(n.x, n.y, n.z);
    this.uv.push(t[0], t[1]);
    this.color.push(c.r, c.g, c.b);
    if (this.facade) {
      this.fac.push(f[0], f[1], f[2], f[3]);
      const w = a ? a.win : ZERO4;
      this.win.push(w[0], w[1], w[2], w[3]);
      this.range.push(a ? a.range[0] : 0, a ? a.range[1] : -1);
    }
  }
  tri(a: V3, b: V3, c: V3, ua: UV, ub: UV, uc: UV, color: THREE.Color, facing?: V3) {
    const ok = this.face([a, b, c], facing);
    if (!ok) return;
    if (ok === 'flip') { [b, c] = [c, b]; [ub, uc] = [uc, ub]; n.negate(); }
    const i = this.vertices;
    this.push(a, ua, color, ZERO4, undefined); this.push(b, ub, color, ZERO4, undefined); this.push(c, uc, color, ZERO4, undefined);
    this.index.push(i, i + 1, i + 2);
  }
  /** Planar quad a-b-c-d (counter-clockwise seen from the front). */
  quad(a: V3, b: V3, c: V3, d: V3, ua: UV, ub: UV, uc: UV, ud: UV, color: THREE.Color, facing?: V3, attr?: FacadeAttr) {
    const ok = this.face([a, b, c, d], facing);
    if (!ok) return;
    const i = this.vertices;
    const f = attr?.fac ?? [ZERO4, ZERO4, ZERO4, ZERO4];
    this.push(a, ua, color, f[0], attr); this.push(b, ub, color, f[1], attr);
    this.push(c, uc, color, f[2], attr); this.push(d, ud, color, f[3], attr);
    if (ok === 'flip') { n.negate(); for (let k = 0; k < 4; k++) { const o = (i + k) * 3; this.normal[o] = n.x; this.normal[o + 1] = n.y; this.normal[o + 2] = n.z; } this.index.push(i, i + 2, i + 1, i, i + 3, i + 2); }
    else this.index.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  /** Axis-free box from a base quad (p0..p3, CCW from above) extruded by `up`. Bottom omitted unless asked. */
  box(p: V3[], height: number, uvScale: number, color: THREE.Color, bottom = false) {
    const top = p.map(q => q.clone().setY(q.y + height));
    for (let k = 0; k < 4; k++) {
      const a = p[k], b = p[(k + 1) % 4], c = top[(k + 1) % 4], d = top[k];
      const len = a.distanceTo(b);
      const out = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3(0, 1, 0)).normalize();
      this.quad(a, b, c, d, [0, a.y / uvScale], [len / uvScale, b.y / uvScale], [len / uvScale, c.y / uvScale], [0, d.y / uvScale], color, out);
    }
    this.quad(top[0], top[1], top[2], top[3], [top[0].x / uvScale, top[0].z / uvScale], [top[1].x / uvScale, top[1].z / uvScale],
      [top[2].x / uvScale, top[2].z / uvScale], [top[3].x / uvScale, top[3].z / uvScale], color, new THREE.Vector3(0, 1, 0));
    if (bottom) this.quad(p[0], p[1], p[2], p[3], [0, 0], [1, 0], [1, 1], [0, 1], color, new THREE.Vector3(0, -1, 0));
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
    if (this.facade) {
      g.setAttribute('aFac', new THREE.Float32BufferAttribute(this.fac, 4));
      g.setAttribute('aWin', new THREE.Float32BufferAttribute(this.win, 4));
      g.setAttribute('aRange', new THREE.Float32BufferAttribute(this.range, 2));
    }
    const count = this.vertices;
    g.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(this.index, 1) : new THREE.Uint16BufferAttribute(this.index, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}
