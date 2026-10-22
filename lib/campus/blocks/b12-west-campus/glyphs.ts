// b12: authored bold-serif capital outlines for the University Co-op sign ("THE" / "CO-OP", coop-19.jpg).
// Drawn here from rectangles and elliptical arcs in cap-height units (cap = 1, baseline y = 0); no font file, no photo
// pixels. Every glyph is a set of NON-OVERLAPPING polygons (components only share edges), each optionally with holes,
// so the extruded fronts never z-fight. Proportions are interpreted from the owner photograph (heavy stems, thin
// hairlines, bracketless serifs, wide round O/C), not a digitised typeface.
export type Poly = { outer: [number, number][]; holes?: [number, number][][] };
export interface Glyph { advance: number; polys: Poly[] }

const R = (x0: number, y0: number, x1: number, y1: number): Poly => ({ outer: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const ell = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n: number) => {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
  return out;
};
const STEM = 0.19, HAIR = 0.075, SERIF = 0.065, OVER = 0.1; // stem width, hairline, serif thickness, serif overhang

function T(): Glyph {
  const w = 0.74, c = w / 2;
  return { advance: w, polys: [
    R(0, 1 - HAIR - 0.03, w, 1),                                         // top bar
    R(0, 1 - 0.27, HAIR, 1 - HAIR - 0.03), R(w - HAIR, 1 - 0.27, w, 1 - HAIR - 0.03), // bar end serifs
    R(c - STEM / 2, SERIF, c + STEM / 2, 1 - HAIR - 0.03),               // stem
    R(c - STEM / 2 - OVER, 0, c + STEM / 2 + OVER, SERIF),                // foot serif
  ] };
}
function H(): Glyph {
  const w = 0.86, l0 = OVER, l1 = OVER + STEM, r1 = w - OVER, r0 = r1 - STEM;
  return { advance: w, polys: [
    R(l0, SERIF, l1, 1 - SERIF), R(r0, SERIF, r1, 1 - SERIF),            // stems
    R(0, 0, l1 + OVER, SERIF), R(0, 1 - SERIF, l1 + OVER, 1),            // left serifs
    R(r0 - OVER, 0, w, SERIF), R(r0 - OVER, 1 - SERIF, w, 1),            // right serifs
    R(l1, 0.47, r0, 0.47 + HAIR),                                        // crossbar
  ] };
}
function E(): Glyph {
  const w = 0.68, s0 = OVER * 0.7, s1 = s0 + STEM;
  return { advance: w, polys: [
    R(0, 0, w, SERIF + 0.015), R(0, 1 - SERIF - 0.015, w - 0.03, 1),    // foot / head bars
    R(s0, SERIF + 0.015, s1, 1 - SERIF - 0.015),                         // stem
    R(s1, 0.47, w - 0.17, 0.47 + HAIR),                                  // middle arm
    R(w - HAIR, SERIF + 0.015, w, 0.25), R(w - 0.03 - HAIR, 0.76, w - 0.03, 1 - SERIF - 0.015), // arm serifs
    R(w - 0.17 - HAIR * 0.6, 0.40, w - 0.17, 0.47), R(w - 0.17 - HAIR * 0.6, 0.47 + HAIR, w - 0.17, 0.62),
  ] };
}
/** Round bowl (O) or open bowl (C); contrast: thick at the sides, hairline at top/bottom. */
function O(): Glyph {
  const w = 1.0, cx = w / 2;
  const outer = ell(cx, 0.5, 0.5, 0.515, 0, Math.PI * 2, 64).slice(0, -1) as [number, number][];
  const inner = ell(cx, 0.5, 0.5 - STEM * 1.05, 0.515 - HAIR, 0, Math.PI * 2, 64).slice(0, -1).reverse() as [number, number][];
  return { advance: w, polys: [{ outer, holes: [inner] }] };
}
function Cc(): Glyph {
  const w = 0.92, cx = 0.5, a0 = Math.PI * 0.26, a1 = Math.PI * 1.74;
  const outer = ell(cx, 0.5, 0.5, 0.515, a0, a1, 48), inner = ell(cx, 0.5, 0.5 - STEM * 1.05, 0.515 - HAIR, a1, a0, 48);
  const poly: Poly = { outer: [...outer, ...inner] as [number, number][] };
  // vertical beak serifs at both terminals (heavy at the top, as in bold Roman capitals)
  // The beaks hang from / stand on the terminal cut (the line outer(a) -> inner(a)), sharing that edge so they never
  // overlap the bowl.
  const ri = [0.5 - STEM * 1.05, 0.515 - HAIR], cut = (a: number) => {
    const o: [number, number] = [cx + 0.5 * Math.cos(a), 0.5 + 0.515 * Math.sin(a)], i: [number, number] = [cx + ri[0] * Math.cos(a), 0.5 + ri[1] * Math.sin(a)];
    return { o, i, y: (x: number) => i[1] + (x - i[0]) * (o[1] - i[1]) / (o[0] - i[0]) };
  };
  const top = cut(a0), bot = cut(a1), xa = top.o[0] - 0.075, xb = top.o[0] + 0.02;
  return { advance: w, polys: [poly,
    { outer: [[xa, top.o[1] - 0.24], [xb, top.o[1] - 0.24], [xb, top.y(xb)], [xa, top.y(xa)]] },
    { outer: [[xa, bot.y(xa)], [xb, bot.y(xb)], [xb, bot.o[1] + 0.16], [xa, bot.o[1] + 0.16]] }] };
}
function Hyphen(): Glyph { return { advance: 0.42, polys: [R(0.04, 0.4, 0.38, 0.4 + 0.11)] }; }
function P(): Glyph {
  const s0 = OVER * 0.7, x0 = s0 + STEM, top = 1 - SERIF, bowlY = 0.44, rxo = 0.27, cy = (top + bowlY) / 2 + SERIF / 2, ryo = (1 - bowlY) / 2;
  const kx = x0 + 0.1, rxi = rxo - STEM * 0.95, ryi = ryo - HAIR;
  const bowl: [number, number][] = [[x0, bowlY], [kx, bowlY], ...ell(kx, cy, rxo, ryo, -Math.PI / 2, Math.PI / 2, 32), [x0, 1],
    [x0, 1 - HAIR], ...ell(kx, cy, rxi, ryi, Math.PI / 2, -Math.PI / 2, 32), [x0, bowlY + HAIR]] as [number, number][];
  return { advance: kx + rxo + 0.04, polys: [
    R(s0, SERIF, x0, 1 - SERIF), R(0, 0, x0 + OVER, SERIF), R(0, 1 - SERIF, x0, 1),
    { outer: bowl },
  ] };
}
const GLYPHS: Record<string, () => Glyph> = { T, H, E, O, C: Cc, '-': Hyphen, P };
/** Lay out a word: polygons in cap units, x from 0, with the given tracking (cap units) between glyphs. */
export function word(text: string, tracking = 0.1) {
  const polys: Poly[] = []; let x = 0;
  for (const ch of text) {
    const g = GLYPHS[ch]?.(); if (!g) { x += 0.4; continue; }
    for (const p of g.polys) polys.push({ outer: p.outer.map(([a, b]) => [a + x, b]), holes: p.holes?.map(h => h.map(([a, b]) => [a + x, b] as [number, number])) });
    x += g.advance + tracking;
  }
  return { polys, width: x - tracking };
}
