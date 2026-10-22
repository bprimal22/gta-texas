// b12 round 2: City union 733792:1248 (Guadalupe frontage, W 23rd St to W 22nd St) rebuilt from its own context.json
// massing volumes (same rings, same LiDAR heights), with the University Co-op storefront (2246 Guadalupe) as a SUBSET of
// the Guadalupe face and separate low-rise shop fronts along the rest of the frontage.
// Evidence (research/whole-campus-92/west-campus-dataset-pass/b12-implementation/NOTES.md):
//  * coop-19.jpg (University Co-op, owner photo; https://www.universitycoop.com/pages/store-hours): cream parapet bays with a
//    cornice, a taller centre bay, dark masonry base, large dark shop windows with small dark hoods, a dark recessed
//    entrance portal with a display window above, banner/sign panels on the flanks.
//  * 2017 USGS 3DEP LiDAR roof profile along the frontage (b12-implementation/frontage-profile.txt): centre bay z -16..+1.5
//    to campus Y 23.9 (front parapet strip 24.4), south flank z +1.5..+13.5 to 21.7, north flank front band to 19.0;
//    the height ratios (south flank / centre 0.81) match the photo (0.79), which fixes the orientation (camera looking west).
//  * The rest of the frontage: LiDAR roof breaks at z 13.5 / 44 / 54 / 76.5 / 78.5 give the shop-unit divisions (measured);
//    materials, awnings and sign colours there are ESTIMATES (no current close photo per shop).
// Nothing here moves Guadalupe, its sidewalks or widths: every solid is inside the City ring except trim that projects
// <= 0.55 m (cornices, piers) and awnings/hoods whose underside is >= 3.0 m above the sidewalk (route clearance 2.1 m).
import * as THREE from 'three';
import type { CampusData, Point } from '../../types';
import { Kit, C, edgesOf, at, hash, inRing, segDist, UP, type Edge, type Bucket } from './kit';
import { word } from './glyphs';
import { volumesOf, buildVolumes } from './massing';

export const COOP_KEY = '733792:1248';
/** Co-op storefront extent along the Guadalupe face (campus z) and its sub-bays. */
export const COOP = { z0: -30.3, z1: 13.5, centre: [-16, 1.5] as [number, number], portal: [-12, -2.5] as [number, number], tops: { north: 19.0, centre: 24.4, south: 22.1 } };
const PARAPET = 0.12; // parapet thickness behind the skin front (split units)
const SKIN_OUT = 0.12; // skin front stands 0.12 m outside the City ring (the union's own frontage walls are skipped)

interface Unit { name: string; z0: number; z1: number; top: number; depth: number; skin: string; kind: 'coop-north' | 'coop-centre' | 'coop-south' | 'shop'; storeys?: number; sign?: string; awning?: string | null }
/** Frontage units (north -> south). Shop breaks from the LiDAR frontage profile; palettes are estimates. */
export const UNITS: Unit[] = [
  { name: 'Co-op north flank', z0: -30.3, z1: -16, top: COOP.tops.north, depth: 6, skin: '#d6c8ab', kind: 'coop-north' },
  { name: 'Co-op centre bay', z0: -16, z1: 1.5, top: COOP.tops.centre, depth: 1.5, skin: '#dccfb3', kind: 'coop-centre' },
  { name: 'Co-op south flank', z0: 1.5, z1: 13.5, top: COOP.tops.south, depth: 1.5, skin: '#d6c8ab', kind: 'coop-south' },
  { name: 'shop 1 (tan panels, coop-19 left edge)', z0: 13.5, z1: 24, top: 16.9, depth: 1.2, skin: '#9b7a5a', kind: 'shop', sign: '#1f4e8c', awning: null },
  { name: 'shop 2', z0: 24, z1: 34, top: 17.2, depth: 1.2, skin: '#b8b2a6', kind: 'shop', sign: '#2b2b2b', awning: '#7a1f1f' },
  { name: 'shop 3', z0: 34, z1: 44, top: 16.8, depth: 1.2, skin: '#8f4a37', kind: 'shop', sign: '#e8e1d0', awning: '#1d1d1d' },
  { name: 'shop 4', z0: 44, z1: 54, top: 17.9, depth: 1.2, skin: '#e3dccb', kind: 'shop', sign: '#2f5d3a', awning: '#2f5d3a' },
  { name: 'shop 5', z0: 54, z1: 65, top: 20.5, depth: 1.2, skin: '#a3683f', kind: 'shop', storeys: 2, sign: '#1d1d1d', awning: '#1d1d1d' },
  { name: 'shop 6', z0: 65, z1: 77, top: 20.3, depth: 1.2, skin: '#cfc3a6', kind: 'shop', storeys: 2, sign: '#8a2d24', awning: null },
  { name: 'shop 7', z0: 77, z1: 90, top: 20.9, depth: 1.2, skin: '#6e6a66', kind: 'shop', storeys: 2, sign: '#d8a23a', awning: '#2b2b2b' },
  { name: 'shop 8', z0: 90, z1: 101, top: 20.4, depth: 1.2, skin: '#b9a07a', kind: 'shop', storeys: 2, sign: '#1d3557', awning: '#1d3557' },
  { name: 'shop 9 (W 22nd St corner)', z0: 101, z1: 113, top: 20.6, depth: 1.2, skin: '#d9d2c3', kind: 'shop', storeys: 2, sign: '#2b2b2b', awning: '#5a2d1e' },
];

const sOf = (e: Edge, z: number) => (z - e.a[1]) / e.u.z;

export function buildCoop(k: Kit, data: CampusData, g: (x: number, z: number) => number, stats: Record<string, unknown>) {
  const vols = volumesOf(COOP_KEY, data), main = vols[0];
  const front = edgesOf(main.ring).filter(e => e.n.x > 0.85 && (e.a[0] + e.c[0]) / 2 > -466 && e.L > 2.5);
  // Union massing (rear/side walls plain buff stucco/brick, estimate). Walls on the Guadalupe face are replaced by the skins.
  const onFront = (e: Edge) => e.n.x > 0.85 && front.some(f => segDist((e.a[0] + e.c[0]) / 2, (e.a[1] + e.c[1]) / 2, f.a, f.c) < 0.8);
  buildVolumes(k, vols, g, () => C('#bfae8e'), C('#8f8d88'), { skipEdge: (_v, e) => onFront(e) });
  const D = k.D(), G = k.D('glass');
  const deckUnder = (e: Edge, s0: number, s1: number, depth: number, below: number) => {
    let best = -Infinity;
    for (const fs of [0.1, 0.5, 0.9]) for (const d of [-0.2, -depth / 2, -depth + 0.15]) { const p = at(e, s0 + (s1 - s0) * fs, 0, d);
      for (const v of vols) if (v.top < below - 0.05 && v.top > best && inRing(p.x, p.z, v.ring)) best = v.top; }
    return best;
  };
  // Shop glazing (visual, flush): panes of <= 1.6 m with a transom, framed by thin dark mullions, pane tones varied
  // between dim interior and warm-lit display (coop-19: framed glazing with displays behind, not black voids).
  const PANES = ['#46494a', '#5a4e40', '#3d4447', '#6a5a46', '#4c4a44', '#575652'];
  const storefront = (e: Edge, a: number, b: number, y0: number, y1: number, d: number, seed: number, transom = 0.72) => {
    const n = Math.max(1, Math.round((b - a) / 1.6)), w = (b - a) / n, yt = y0 + (y1 - y0) * transom, M = k.D('metal'), fr = C('#2a2b2c');
    for (let i = 0; i < n; i++) for (const [p0, p1, r] of [[y0, yt, 0], [yt, y1, 1]] as [number, number, number][])
      k.panel(G, e, a + i * w, a + (i + 1) * w, p0, p1, d, C(PANES[Math.floor(hash(seed, i, r) * PANES.length)]));
    for (let i = 0; i <= n; i++) { const x = a + i * w; k.box(M, e, x - 0.045, x + 0.045, y0, y1, d, d + 0.05, fr); }
    for (const y of [y0, yt, y1]) k.box(M, e, a, b, y - 0.04, y + 0.04, d, d + 0.05, fr);
    return n;
  };
  // Extruded letters (authored serif glyphs, glyphs.ts): text reads left-to-right for a viewer looking at the face
  // from outside, i.e. along -u; fronts at d0 + depth. Visual detail only (no collider), > 7 m above the sidewalk.
  const letters = (b: Bucket, e: Edge, text: string, sCentre: number, yBase: number, cap: number, d0: number, depth: number, color: THREE.Color, tracking = 0.1) => {
    const { polys, width } = word(text, tracking), s0 = sCentre + width * cap / 2;
    const P = (gx: number, gy: number, d: number) => at(e, s0 - gx * cap, yBase + gy * cap, d), out = e.n, d1 = d0 + depth;
    let tris = 0;
    for (const p of polys) {
      const contour = p.outer.map(([x, y]) => new THREE.Vector2(x, y)), holes = (p.holes ?? []).map(h => h.map(([x, y]) => new THREE.Vector2(x, y)));
      const all = [contour, ...holes].flat();
      for (const [i, j, l] of THREE.ShapeUtils.triangulateShape(contour, holes)) { b.tri(P(all[i].x, all[i].y, d1), P(all[j].x, all[j].y, d1), P(all[l].x, all[l].y, d1), color, out); tris++; }
      for (const ring of [p.outer, ...(p.holes ?? [])]) for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length], mx = (ax + bx) / 2, my = (ay + by) / 2;
        // side wall normal: away from the polygon interior (test a point just off the edge midpoint)
        const nx = by - ay, ny = -(bx - ax), l = Math.hypot(nx, ny) || 1, probe = new THREE.Vector2(mx + nx / l * 1e-3, my + ny / l * 1e-3);
        const inPoly = pointInPoly(probe.x, probe.y, p.outer) && !(p.holes ?? []).some(h => pointInPoly(probe.x, probe.y, h));
        // outward 2D normal (sign) mapped to 3D: glyph +x runs along -u, glyph +y is up
        const sign = inPoly ? -1 : 1, hint = e.u.clone().multiplyScalar(-sign * nx / l).add(new THREE.Vector3(0, sign * ny / l, 0));
        b.quad(P(ax, ay, d0), P(bx, by, d0), P(bx, by, d1), P(ax, ay, d1), color, hint); tris += 2;
      }
    }
    return { tris, widthM: +(width * cap).toFixed(2) };
  };
  let pieces = 0;
  for (const e of front) {
    const zmin = Math.min(e.a[1], e.c[1]), zmax = Math.max(e.a[1], e.c[1]);
    const parts = UNITS.map(u => {
      // the first / last unit run 0.3-0.4 m past the ring corners so the skin's end faces never lie in the plane of the
      // W 23rd / W 22nd St walls (no z-fighting); both streets' footways are >= 3 m away.
      const z0 = u === UNITS[0] && zmin - u.z0 < 0.5 ? u.z0 : Math.max(u.z0, zmin), z1 = u === UNITS[UNITS.length - 1] && u.z1 - zmax < 0.5 ? u.z1 : Math.min(u.z1, zmax);
      return { u, z0, z1 };
    }).filter(p => p.z1 - p.z0 >= 0.3);
    parts.forEach(({ u, z0, z1 }, idx) => {
      const s0 = sOf(e, z0), s1 = sOf(e, z1), sm = (s0 + s1) / 2, mid = at(e, sm, 0, 1.0), gy = g(mid.x, mid.z);
      const gAt = (s: number) => { const p = at(e, s, 0, 1); return g(p.x, p.z); };
      const lo = Math.min(gAt(s0), gAt(s1), gy) - 0.6, f = SKIN_OUT, sk = C(u.skin);
      const prevTop = idx > 0 && Math.abs(parts[idx - 1].z1 - z0) < 1e-6 ? parts[idx - 1].u.top : -Infinity, nextTop = idx + 1 < parts.length && Math.abs(parts[idx + 1].z0 - z1) < 1e-6 ? parts[idx + 1].u.top : -Infinity;
      // Skin: front face (with openings for attached relief), top, end faces only where taller than the neighbour.
      // When the deck behind is < 1.05 m lower than the parapet, the skin body stops 2 cm under that deck and only a
      // thin parapet rises to the unit top (so no deck lies hidden < 1 m under a skin top).
      const deck = deckUnder(e, s0, s1, u.depth, u.top), split = u.top - deck < 1.05, bodyTop = split ? deck - 0.02 : u.top;
      const face = k.face(e, lo, u.top, sk, { d: f, s0, s1 });
      const S = k.S();
      const topQuad = (y: number, d0: number) => S.quad(at(e, s0, y, d0), at(e, s1, y, d0), at(e, s1, y, f), at(e, s0, y, f), sk, UP);
      topQuad(bodyTop, -u.depth);
      const end = (s: number, other: number, sign: number, d0: number, y0: number, y1: number) => { const ya = Math.max(y0, other); if (y1 - ya < 0.01) return;
        const n = e.u.clone().multiplyScalar(sign); S.quad(at(e, s, ya, d0), at(e, s, ya, f), at(e, s, y1, f), at(e, s, y1, d0), sk, n); };
      end(s0, prevTop, -1, -u.depth, lo, bodyTop); end(s1, nextTop, 1, -u.depth, lo, bodyTop);
      if (split) {
        topQuad(u.top, -PARAPET);
        S.quad(at(e, s1, bodyTop, -PARAPET), at(e, s0, bodyTop, -PARAPET), at(e, s0, u.top, -PARAPET), at(e, s1, u.top, -PARAPET), sk, e.n.clone().negate());
        end(s0, Math.max(prevTop, bodyTop), -1, -PARAPET, bodyTop, u.top); end(s1, Math.max(nextTop, bodyTop), 1, -PARAPET, bodyTop, u.top);
      }
      pieces++;
      const span = (a: number, b: number) => [Math.max(s0, sOf(e, a)), Math.min(s1, sOf(e, b))] as [number, number];
      if (u.kind.startsWith('coop')) {
        // dark masonry base (colour band), large dark shop windows with small dark hoods, cornice (coop-19.jpg)
        const baseTop = gy + 4.5, frame = C('#262628');
        k.panel(D, e, s0, s1, lo, baseTop, f + 0.01, C('#3b3532'));
        const wins: [number, number][] = u.kind === 'coop-centre' ? [[-15.2, -12.9], [-1.7, 0.9]] : u.kind === 'coop-south' ? [[2.4, 6.6], [7.6, 12.6]] : [[-27.5, -23.5], [-22.5, -17.0]];
        for (const w of wins) { const [a, b] = span(w[0], w[1]); if (b - a < 0.5) continue;
          storefront(e, a, b, gy + 0.5, gy + 3.45, f + 0.02, w[0]);
          k.attach(face, a - 0.1, b + 0.1, gy + 3.5, gy + 3.8, 0.85, C('#26292b'), 'metal'); }
        const [pa, pb] = [sOf(e, COOP.portal[0]), sOf(e, COOP.portal[1])];
        if (u.kind === 'coop-centre' && pa >= s0 && pb <= s1) {
          // recessed entrance portal: dark frame proud of the glass, doors, canopy band, display window, mullions
          // portal posts stand only 0.1 m proud of the skin (0.22 m beyond the ring): the scooter edge line stays clear (check 8)
          k.attach(face, pa, pa + 0.7, lo, gy + 7.6, 0.1, frame, 'metal'); k.attach(face, pb - 0.7, pb, lo, gy + 7.6, 0.1, frame, 'metal');
          k.attach(face, pa + 0.7, pb - 0.7, gy + 7.0, gy + 7.6, 0.1, frame, 'metal'); // lintel, flush with the posts
          // entrance: glazed doors (4 leaves, frames, push bars) under a glazed transom; display window above (coop-19)
          const da = pa + 0.7, db = pb - 0.7, M = k.D('metal');
          storefront(e, da, db, gy, gy + 3.35, f + 0.03, 91, 0.78);
          for (let j = 0; j < 4; j++) { const c0 = da + (db - da) * (0.18 + 0.64 * j / 3); k.box(M, e, c0 - 0.55, c0 + 0.55, gy + 1.0, gy + 1.06, f + 0.08, f + 0.12, C('#8d8a84')); }
          k.attach(face, pa + 0.7, pb - 0.7, gy + 3.4, gy + 4.2, 0.5, frame, 'metal');
          storefront(e, da, db, gy + 4.3, gy + 6.95, f + 0.03, 92, 1);
          // sign: "THE" / "CO-OP" in authored bold-serif letters (glyphs.ts), dark bronze, 0.08 m relief, visual only.
          // Scale from coop-19 relative to the cream band between the dark base and the cornice (cap heights
          // 0.21 / 0.085 of the band, CO-OP baseline 0.57 up the band); interpreted, not measured.
          const cs = (pa + pb) / 2, band0 = gy + 4.5, band1 = COOP.tops.centre - 0.75, bh = band1 - band0, lc = C('#2b2622');
          const coop = letters(M, e, 'CO-OP', cs, band0 + bh * 0.56, bh * 0.23, f, 0.08, lc, 0.12);
          const the = letters(M, e, 'THE', cs, band0 + bh * 0.84, bh * 0.09, f, 0.08, lc, 0.08);
          stats.coopSign = { capCoopM: +(bh * 0.23).toFixed(2), capTheM: +(bh * 0.09).toFixed(2), coopWidthM: coop.widthM, theWidthM: the.widthM, triangles: coop.tris + the.tris };
          stats.coopPortal = { centre: [+at(e, cs, 0).x.toFixed(2), +at(e, cs, 0).z.toFixed(2)], width: +(pb - pa).toFixed(2), groundY: +gy.toFixed(2) };
        }
        // flank banner / sign panel (colour only)
        if (u.kind === 'coop-south') k.panel(D, e, s0 + 0.6, s1 - 0.6, gy + 4.9, Math.min(u.top - 1.3, gy + 8.6), f + 0.01, C('#33402f'));
        // cornice (solid) + dentil band: alternating blocks and shadowed gaps in one plane (coop-19 dentil course)
        k.attach(face, s0, s1, u.top - 0.75, u.top - 0.25, 0.5, C('#cbbd9d'));
        for (let x = s0, j = 0; x < s1 - 1e-3; x += 0.22, j++) k.panel(D, e, x, Math.min(s1, x + 0.22), u.top - 1.15, u.top - 0.85, f + 0.01, C(j % 2 ? '#a89a7c' : '#d3c6a9'));
        // cream render joints (ashlar-scored panels, 0.9 m courses, 1.8 m staggered) between the dark base and the
        // dentils, skipping the banner, the portal and the sign zone; flush colour lines (interpreted from coop-19)
        const jc = C('#bcae90'), y0 = gy + 4.5, y1 = u.top - 1.2;
        const free = (a: number, b: number, ya: number, yb: number) => !(u.kind === 'coop-south' && ya < gy + 8.7 && yb > gy + 4.8) &&
          !(u.kind === 'coop-centre' && ((Math.max(a, sOf(e, COOP.portal[0])) < Math.min(b, sOf(e, COOP.portal[1])) && ya < gy + 7.7) || ya > gy + 7.9));
        for (let y = y0 + 0.9, r = 0; y < y1; y += 0.9, r++) if (free(s0, s1, y - 0.02, y + 0.02)) k.panel(D, e, s0, s1, y - 0.012, y + 0.012, f + 0.006, jc);
        for (let y = y0, r = 0; y + 0.9 <= y1 + 1e-3; y += 0.9, r++) for (let x = s0 + (r % 2 ? 0.9 : 1.8); x < s1 - 0.2; x += 1.8)
          if (free(x - 0.02, x + 0.02, y, y + 0.9)) k.panel(D, e, x - 0.012, x + 0.012, y + 0.012, y + 0.888, f + 0.006, jc);
        return;
      }
      // generic Drag shop front
      const pier = C('#5d5852'), w0 = s0 + 0.45, w1 = s1 - 0.45, door = w0 + (w1 - w0) * (0.25 + 0.5 * hash(u.z0, 3));
      // one pier per unit boundary (the south unit's), plus the closing pier at the end of the edge
      k.attach(face, s0, s0 + 0.45, lo, u.top, 0.1, pier); if (nextTop === -Infinity) k.attach(face, s1 - 0.45, s1, lo, u.top, 0.1, pier);
      storefront(e, w0, door - 1.0, gy + 0.45, gy + 3.0, f + 0.02, u.z0); storefront(e, door + 1.0, w1, gy + 0.45, gy + 3.0, f + 0.02, u.z0 + 7);
      storefront(e, door - 0.9, door + 0.9, gy, gy + 2.6, f + 0.03, u.z0 + 13, 0.8);
      k.panel(D, e, w0, w1, lo, gy + 0.45, f + 0.01, pier);
      k.panel(D, e, w0, w1, gy + 3.05, gy + 3.85, f + 0.01, C(u.sign ?? '#2b2b2b'));
      if (u.awning) k.attach(face, s0, s1, gy + 3.0, gy + 3.2, 1.35, C(u.awning), 'metal'); // full unit width: adjacent awnings butt at the boundary
      if ((u.storeys ?? 1) > 1) { const n = Math.max(2, Math.floor((w1 - w0) / 3.2)); for (let j = 0; j < n; j++) { const c0 = w0 + (w1 - w0) * (j + 0.5) / n; storefront(e, c0 - 0.75, c0 + 0.75, gy + 4.9, gy + 6.6, f + 0.02, u.z0 + j, 0.62); } }
      k.attach(face, w0, w1, u.top - 0.35, u.top, 0.18, C('#8a8580'));
    });
  }
  stats.coop = { frontageEdges: front.length, pieces, units: UNITS.length, volumes: vols.length };
  stats.coopPaving = paveFrontage(k, data, g, front);
  return vols;
}

const pointInPoly = (x: number, y: number, r: [number, number][]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };

/** Concrete sidewalk finish from the storefront skin to Guadalupe's west curb along the union frontage (coop-19 shows a
 * continuous paved apron, not a grass strip). VISUAL ONLY (no collider): slabs of <= 1.5 m are draped on the baked
 * terrain height g() + PAVE_LIFT at every vertex, i.e. on the same surface the terrain collider is built from, so what
 * is drawn is what supports the player; any higher mapped footway / road surface stays on top. Curb line = the check's
 * Guadalupe roadway centreline (OSM 655414277 / 201680476 / 1354456442) - 7 m, minus 0.1 m. No grade, width or
 * support change. */
export const PAVE_LIFT = 0.015;
const ROADWAY = [655414277, 201680476, 1354456442];
function paveFrontage(k: Kit, data: CampusData, g: (x: number, z: number) => number, front: Edge[]) {
  const roadway = ROADWAY.flatMap(id => (data.paths.find(p => p.id === id)?.points ?? []) as Point[]);
  const roadX = (z: number) => { let best = NaN, bd = Infinity; for (let i = 0; i + 1 < roadway.length; i++) { const a = roadway[i], b = roadway[i + 1]; if ((a[1] - z) * (b[1] - z) <= 0 && a[1] !== b[1]) { const x = a[0] + (z - a[1]) / (b[1] - a[1]) * (b[0] - a[0]), d = Math.abs(x + 440); if (d < bd) { bd = d; best = x; } } } return best; };
  const P = k.D('paving'), joint = C('#9d9a93'); let slabs = 0, area = 0, widthMin = Infinity, widthMax = 0;
  for (const e of front) {
    const nS = Math.max(1, Math.ceil(e.L / 1.5)), ds = e.L / nS;
    for (let i = 0; i < nS; i++) {
      const sa = i * ds, sb = (i + 1) * ds, pm = at(e, (sa + sb) / 2, 0, 0), curb = roadX(pm.z);
      if (!Number.isFinite(curb)) continue;
      const dEnd = (curb - 7 - 0.1 - pm.x) / e.n.x, dStart = SKIN_OUT;
      if (dEnd - dStart < 0.5) continue;
      widthMin = Math.min(widthMin, dEnd - dStart); widthMax = Math.max(widthMax, dEnd - dStart);
      const nD = Math.max(1, Math.ceil((dEnd - dStart) / 1.5)), dd = (dEnd - dStart) / nD;
      const V = (s: number, d: number) => { const p = at(e, s, 0, d); p.y = g(p.x, p.z) + PAVE_LIFT; return p; };
      for (let j = 0; j < nD; j++) {
        const da = dStart + j * dd, db = da + dd, jw = 0.025;
        const tone = C(['#c2beb5', '#bdb9b0', '#c6c2b9', '#b9b6ae'][Math.floor(hash(e.i * 31 + i, j) * 4)]);
        // slab face, then its two joint strips (along s at the far edge, along d at the end) in the same draped plane
        P.quad(V(sa, da), V(sb - jw, da), V(sb - jw, db - jw), V(sa, db - jw), tone, UP);
        P.quad(V(sa, db - jw), V(sb - jw, db - jw), V(sb - jw, db), V(sa, db), joint, UP);
        P.quad(V(sb - jw, da), V(sb, da), V(sb, db), V(sb - jw, db), joint, UP);
        slabs++; area += ds * dd;
      }
    }
  }
  return { slabs, areaM2: Math.round(area), widthM: [+widthMin.toFixed(2), +widthMax.toFixed(2)], lift: PAVE_LIFT, basis: 'visual-only; draped on baked terrain = terrain collider surface' };
}
export type { Point };
