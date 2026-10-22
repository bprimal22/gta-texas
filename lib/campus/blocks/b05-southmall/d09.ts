// D09 (PCL, AT&T and Rowling) authored architecture, block b05-southmall. PCL closure (index.ts), UTC (-501:add),
// Rowling Hall and the Dobie Garage exclusion are unchanged.
//
// AT&T Executive Education and Conference Center (City 505680:201, generated from the measured b05 massing): the
// generated body gets the b05 archetype "b05-southmall:att-conference" (context.json: brick body, limestone base,
// deep bracketless tile eaves, paired punched windows; ut-att-551) and this file ADDS the photographed corner-pavilion
// elements as physical geometry: a steel roof trellis (pergola) projecting under the top-floor eave and two stacked
// balconies with steel railings below it. ut-att-551 shows these at a top corner pavilion facing the street; which
// pavilions carry them is not surveyed, so they are placed on the east ends of the two 8-floor bars (estimate).
// Heights come from the generator's own hip function for the measured massing (eave = roof line).
import ctxData from './context.json' with { type: 'json' };
import { CATALOG } from '../../context/catalog';
import type { BlockInstallContext } from '../types';
import { Group, box, frames, type P2 } from './arch-kit';
import { clean, generatedHip } from './d08';

export const ATT_KEY = '505680:201';
export const ATT_ARCHETYPE = 'b05-southmall:att-conference';
/** Massing volumes (context.json 505680) with an east-end corner pavilion module: south bar, north bar. */
const MODULE_VOLUMES = [1, 2];

export function buildAtt(_ctx: BlockInstallContext) {
  const g = new Group('ATT');
  type Vol = { ring: P2[]; top: number; roof: 'hip-tile' | 'flat'; slope: number };
  const m = (ctxData as unknown as { massing: Record<string, { datum: { aboveY: number }; volumes: Vol[] }> }).massing['505680'];
  const arch = CATALOG.archetypes[ATT_ARCHETYPE];
  const overhang = Math.max(0.35, arch?.overhang || 0.5);
  const steel = g.s('steel'), slab = g.s('concrete'), rail = g.d('steel');
  const modules: { volume: number; eaveTop: number; trellisY: number; balconies: number[]; edge: [P2, P2] }[] = [];
  for (const vi of MODULE_VOLUMES) {
    const v = m.volumes[vi], ring = clean(v.ring), hip = generatedHip(v, m.datum.aboveY, overhang);
    const f = frames(ring).filter(e => e.len > 15).reduce((a, b) => (b.n[0] > a.n[0] ? b : a)); // east end
    const w = Math.min(10.5, f.len - 6), s0 = (f.len - w) / 2, s1 = s0 + w, depth = 2.4;
    const yt = hip.eaveTop - 0.5, L1 = hip.eaveTop - 3.55, L2 = L1 - 3.5;
    // Balcony slabs (top floor and the floor below), cantilevered from the generated wall.
    for (const L of [L1, L2]) {
      box(slab, f, s0, s1, 0, depth, L - 0.28, L, { back: true });
      for (let s = s0 + 0.05; s <= s1 - 0.04; s += (w - 0.1) / 7) box(rail, f, s - 0.025, s + 0.025, depth - 0.12, depth - 0.07, L, L + 1.05, { bottom: true });
      box(rail, f, s0, s1, depth - 0.14, depth - 0.05, L + 1.05, L + 1.1, {});
      for (const [a, b] of [[s0, s0 + 0.05], [s1 - 0.05, s1]]) box(rail, f, a, b, 0, depth - 0.05, L + 1.05, L + 1.1, {});
    }
    // Steel trellis: two posts from the top balcony, a front beam and joists every ~1.2 m back to a wall ledger.
    for (const s of [s0 + 0.15, s1 - 0.4]) box(steel, f, s, s + 0.25, depth - 0.35, depth - 0.1, L1, yt - 0.42, { top: true, bottom: true });
    box(steel, f, s0, s1, depth - 0.4, depth - 0.1, yt - 0.42, yt, {});
    box(steel, f, s0, s1, 0, 0.2, yt - 0.3, yt, { back: true });
    const n = Math.max(2, Math.round(w / 1.2));
    for (let k = 0; k <= n; k++) { const s = s0 + 0.1 + ((w - 0.36) * k) / n; box(steel, f, s, s + 0.16, 0.2, depth - 0.4, yt - 0.28, yt, { back: true, front: true }); }
    modules.push({ volume: vi, eaveTop: +hip.eaveTop.toFixed(2), trellisY: +yt.toFixed(2), balconies: [+L1.toFixed(2), +L2.toFixed(2)], edge: [f.a, f.b] });
  }
  return { group: g, stats: { modules, overhang } };
}
