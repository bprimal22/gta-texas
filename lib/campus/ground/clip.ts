/**
 * Output-domain clipping for generated ground: remove the parts of a new
 * up-facing triangle that would lie on top of an existing up-facing surface,
 * keeping the rest. Pure geometry in plan (x, z); heights stay on the new
 * triangle's plane, so the kept pieces are exactly coplanar with the input.
 */

/** Plan point [x, z]. */
export type Point2 = [number, number];
/** Half-plane a*x + b*z + c >= 0. */
type Half = [number, number, number];

/** Explicit sub-millimetre tolerances (m, m²). A covered region narrower than
 * MIN_WIDTH and no larger than CONTACT_AREA is a numerical edge contact; a kept
 * piece (or fan triangle) narrower than MIN_WIDTH is omitted as a float32 sliver. */
export const MIN_WIDTH = 1e-4, CONTACT_AREA = 1e-6;

/** Height plane y = A*x + B*z + C through a triangle given as x,y,z triples; null when vertical in plan. */
export function plane(p: ArrayLike<number>): [number, number, number] | null {
  const ux = p[3] - p[0], uz = p[5] - p[2], vx = p[6] - p[0], vz = p[8] - p[2], d = ux * vz - vx * uz;
  if (Math.abs(d) < 1e-12) return null;
  const uy = p[4] - p[1], vy = p[7] - p[1];
  const A = (uy * vz - vy * uz) / d, B = (ux * vy - vx * uy) / d;
  return [A, B, p[1] - A * p[0] - B * p[2]];
}

export function area(poly: Point2[]) {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return Math.abs(s) / 2;
}

/** Width of a convex polygon: least extent across any of its edges. */
export function width(poly: Point2[]) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j][0], az = poly[j][1], dx = poly[i][0] - ax, dz = poly[i][1] - az, l = Math.hypot(dx, dz);
    if (l < 1e-12) continue;
    let far = 0;
    for (const p of poly) far = Math.max(far, Math.abs(dx * (p[1] - az) - dz * (p[0] - ax)) / l);
    best = Math.min(best, far);
  }
  return best === Infinity ? 0 : best;
}

/** Sutherland–Hodgman against one half-plane (convex in, convex out). */
function clip(poly: Point2[], [a, b, c]: Half): Point2[] {
  const out: Point2[] = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = poly[j], q = poly[i], dp = a * p[0] + b * p[1] + c, dq = a * q[0] + b * q[1] + c;
    if ((dp >= 0) !== (dq >= 0)) { const f = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]); }
    if (dq >= 0) out.push(q);
  }
  return out;
}

/**
 * Subtract from triangle `tri` (x,y,z triples) every region lying over an
 * up-facing `surfaces` triangle where tri is higher than that surface by more
 * than `tolerance` (and less than `maxRaise`). Each covered region is the
 * intersection of the surface's three plan edges and two linear raise bounds,
 * so the subtraction is exact convex clipping, not a sampled test.
 * A negative tolerance also removes output lying just below the surface.
 * Returns null when nothing is covered (keep the triangle as it is), otherwise
 * the convex plan polygons to keep (possibly none) and the covered plan area.
 */
export function subtractCovered(tri: ArrayLike<number>, surfaces: Iterable<ArrayLike<number>>, tolerance: number, maxRaise: number): { pieces: Point2[][]; coveredM2: number } | null {
  return subtractLayers(tri, [{ surfaces, tolerance, maxRaise }]);
}

/** One set of surfaces with the raise band (tolerance, maxRaise) removed above/below them. */
export interface ClipLayer { surfaces: Iterable<ArrayLike<number>>; tolerance: number; maxRaise: number;
  /** Also clip under steep (but not vertical or downward) surfaces, e.g. the cover a finish is trimmed from. */
  anySlope?: boolean }

/**
 * subtractCovered over several layers, each with its own raise band (e.g. authored
 * paving: remove output more than 3 cm above it; a mapped finish: remove output from
 * 1 m below to 5 cm above it, the near-coplanar band that would z-fight). The
 * subtraction is the same exact convex clipping; coveredM2 sums every layer.
 */
export function subtractLayers(tri: ArrayLike<number>, layers: ClipLayer[]): { pieces: Point2[][]; coveredM2: number } | null {
  const own = plane(tri);
  if (!own) return null;
  let pieces: Point2[][] = [[[tri[0], tri[2]], [tri[3], tri[5]], [tri[6], tri[8]]]];
  let touched = false, coveredM2 = 0;
  for (const { surfaces, tolerance, maxRaise, anySlope } of layers) for (const s of surfaces) {
    if (!pieces.length) break;
    // Up-facing surfaces only (as the tie-ins' own top test): n.y / |n| >= 0.5.
    const ux = s[3] - s[0], uy = s[4] - s[1], uz = s[5] - s[2], vx = s[6] - s[0], vy = s[7] - s[1], vz = s[8] - s[2];
    const ny = uz * vx - ux * vz, len = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx);
    if (len < 1e-12 || ny / len < (anySlope ? 1e-6 : .5)) continue;
    const old = plane(s)!;
    // Edge half-planes oriented towards the surface's centroid (any winding).
    const halves: Half[] = [], cx = (s[0] + s[3] + s[6]) / 3, cz = (s[2] + s[5] + s[8]) / 3;
    for (let e = 0; e < 3; e++) {
      const px = s[e * 3], pz = s[e * 3 + 2], qx = s[((e + 1) % 3) * 3], qz = s[((e + 1) % 3) * 3 + 2];
      const h: Half = [pz - qz, qx - px, -(pz - qz) * px - (qx - px) * pz];
      halves.push(h[0] * cx + h[1] * cz + h[2] >= 0 ? h : [-h[0], -h[1], -h[2]]);
    }
    const dA = own[0] - old[0], dB = own[1] - old[1], dC = own[2] - old[2];
    halves.push([dA, dB, dC - tolerance], [-dA, -dB, maxRaise - dC]);
    const next: Point2[][] = [];
    for (const piece of pieces) {
      let covered = piece;
      for (const h of halves) { covered = clip(covered, h); if (covered.length < 3) break; }
      if (covered.length < 3 || (area(covered) <= CONTACT_AREA && width(covered) < MIN_WIDTH)) { next.push(piece); continue; }
      touched = true; coveredM2 += area(covered);
      // piece \ covered = union over i of (inside halves 0..i-1) ∩ (outside half i).
      let rest = piece;
      for (const h of halves) {
        const outside = clip(rest, [-h[0], -h[1], -h[2]]);
        if (outside.length >= 3 && width(outside) >= MIN_WIDTH) next.push(outside);
        rest = clip(rest, h);
        if (rest.length < 3) break;
      }
    }
    pieces = next;
  }
  return touched ? { pieces: pieces.map(simplify).filter(poly => poly.length >= 3 && width(poly) >= MIN_WIDTH), coveredM2 } : null;
}

/** Drop repeated and nearly collinear points left by clipping, so fans have no
 * needles: a point within MIN_WIDTH of its neighbours' chord. On a convex piece
 * that only shrinks it, so coverage can never grow. */
function simplify(poly: Point2[]) {
  let out = poly;
  for (let changed = true; changed && out.length >= 3;) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const p = out[(i + out.length - 1) % out.length], q = out[i], r = out[(i + 1) % out.length];
      const chord = Math.hypot(r[0] - p[0], r[1] - p[1]), cross = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
      if (chord < MIN_WIDTH || Math.abs(cross) < MIN_WIDTH * chord) { out = out.filter((_, k) => k !== i); changed = true; break; }
    }
  }
  return out;
}
