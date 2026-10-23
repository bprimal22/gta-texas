// b12 measured ground paving (West Campus pass 3, "far too green"): City of Austin Planimetrics 2023 impervious cover
// (sidewalks, pavement, courtyards, patios, driveways, parking, and the curb / gutter band of the City road polygons the
// drawn roads leave as lawn), baked by tools/extension/bake-b12-paving.py into paving.json: only the ground the game
// still drew as lawn (minus footprints, mapped road / footway finishes, road-infill bands and the Co-op frontage that
// coop.ts paves). Medians, unpaved kinds, decks, pools and courts stay lawn.
// Visual only, exactly like the Co-op frontage: each polygon is triangulated, split on the offline terrain's regular
// 8 m lattice (the bake asserts every touched cell is a plain two-triangle cell on the x + z diagonal) so every piece
// lies in ONE terrain triangle, and each vertex is set to the baked terrain height + PAVE_LIFT: the drape is exactly
// parallel to the terrain collider surface (no floating edge, no buried crease). Goes into the block's existing
// 'paving' detail bucket (same material and draw call as the Co-op frontage).
import * as THREE from 'three';
import { C, hash, UP, type Bucket } from './kit';
import { PAVE_LIFT } from './coop';
import PAVING from './paving.json';

interface PavingData { kinds: string[]; lattice: number; diagonal: string; quantum: number; areaM2: number; polygons: (number | number[])[][] }
const DATA = PAVING as unknown as PavingData;

/** Base tones (sRGB) per baked kind: light broom-finished concrete for walks and plazas, warmer patios, weathered
 * asphalt for lots and the curb lanes beside the drawn roads (kept lighter than road asphalt). Interpreted finish. */
const TONES: Record<string, string> = {
  sidewalk: '#bfbbb2', pavement: '#b8b4ab', courtyard: '#c6bdad', patio: '#c2b9a8',
  driveway: '#b1ada4', parking: '#8c8983', gutter: '#8a8783',
};

type P2 = [number, number];
const decodeRing = (r: number[], q: number): P2[] => {
  const out: P2[] = []; let x = 0, z = 0;
  for (let i = 0; i + 1 < r.length; i += 2) { x += r[i]; z += r[i + 1]; out.push([x * q, z * q]); }
  return out;
};
/** Sutherland-Hodgman against a*x + b*z <= c. */
const clip = (poly: P2[], a: number, b: number, c: number): P2[] => {
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], dp = a * p[0] + b * p[1] - c, dq = a * q[0] + b * q[1] - c;
    if (dp <= 0) out.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
};
const area2 = (p: P2[]) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };

export interface PavingStats { polygons: number; sourceTriangles: number; triangles: number; areaM2: number; bakedAreaM2: number; byKindM2: Record<string, number>; lift: number; basis: string }

/** Append the baked paving to `P` (the block's 'paving' detail bucket). `g` = visible baked terrain height. */
export function buildPaving(P: Bucket, g: (x: number, z: number) => number): PavingStats {
  if (DATA.diagonal !== 'x+z' || DATA.lattice !== 8) throw Error('b12 paving: unexpected terrain lattice');
  const L = DATA.lattice, q = DATA.quantum, byKind: Record<string, number> = {};
  let sourceTriangles = 0, triangles = 0, total = 0;
  const v = (x: number, z: number) => new THREE.Vector3(x, g(x, z) + PAVE_LIFT, z);
  const emit = (poly: P2[], color: THREE.Color, kind: string) => {
    if (poly.length < 3) return;
    const a = Math.abs(area2(poly)); if (a < 1e-5) return;
    const vs = poly.map(([x, z]) => v(x, z));
    for (let i = 1; i + 1 < vs.length; i++) { P.tri(vs[0], vs[i], vs[i + 1], color, UP); triangles++; }
    byKind[kind] = (byKind[kind] ?? 0) + a; total += a;
  };
  DATA.polygons.forEach((rec, n) => {
    const kind = DATA.kinds[rec[0] as number], rings = (rec.slice(1) as number[][]).map(r => decodeRing(r, q));
    const base = C(TONES[kind] ?? TONES.sidewalk), color = base.clone().multiplyScalar(0.96 + 0.08 * hash(n, rec[0] as number));
    const contour = rings[0].map(([x, z]) => new THREE.Vector2(x, z)), holes = rings.slice(1).map(r => r.map(([x, z]) => new THREE.Vector2(x, z)));
    const pts = [...rings[0], ...rings.slice(1).flat()];
    for (const [ia, ib, ic] of THREE.ShapeUtils.triangulateShape(contour, holes)) {
      sourceTriangles++;
      const tri: P2[] = [pts[ia], pts[ib], pts[ic]];
      const xs = tri.map(p => p[0]), zs = tri.map(p => p[1]);
      const i0 = Math.floor(Math.min(...xs) / L), i1 = Math.floor(Math.max(...xs) / L), j0 = Math.floor(Math.min(...zs) / L), j1 = Math.floor(Math.max(...zs) / L);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const x0 = i * L, z0 = j * L, d = x0 + z0 + L;
        // Cell [x0, x0+L] x [z0, z0+L], split on x + z = d into its two terrain triangles.
        const cell = clip(clip(clip(clip(tri, -1, 0, -x0), 1, 0, x0 + L), 0, -1, -z0), 0, 1, z0 + L);
        if (cell.length < 3) continue;
        emit(clip(cell, 1, 1, d), color, kind);
        emit(clip(cell, -1, -1, -d), color, kind);
      }
    }
  });
  const round = (x: number) => Math.round(x * 10) / 10;
  return { polygons: DATA.polygons.length, sourceTriangles, triangles, areaM2: round(total), bakedAreaM2: DATA.areaM2,
    byKindM2: Object.fromEntries(Object.entries(byKind).map(([k, a]) => [k, round(a)])), lift: PAVE_LIFT,
    basis: 'City of Austin Planimetrics 2023 impervious cover (measured polygons); visual-only drape on the baked terrain lattice' };
}
