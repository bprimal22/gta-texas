// D13 (WCP, Gregory and Jester) authored architecture, block b07-wcp-gregory.
//
// Jester (Beauford H. Jester Center JES 526723:286 and Jester residence hall JCD 526236:273, 1969): the generated
// bodies stay (measured b07 LiDAR-tier massing). Their tower tiers carry the b07 archetype
// "b07-wcp-gregory:jester-tower" (context.json: tan brick, NO generated openings), and this file ADDS the window
// pattern the photographs show instead of the generic punched grid: windows grouped in continuous vertical stacks at
// the ends of each stepped wall plane with plain brick between (ut-jcd-563 / ut-jcd-659, ut-jes-552, d13 NE/NW
// orbits), precast sills, dark frames. Visual relief (<= 0.14 m proud of the generated wall), additive
// (userData.localContext) so the generated body and its colliders are untouched. Stack positions follow the measured
// tier outline; storey height 2.9 m is an estimate.
//
// Not built (documented gaps): Gregory Gym's photographed ground arcade (ut-gre-423) cannot be located on a GIS edge
// (photo direction not verified) and its north face already carries the authored basement/stairs (gregory-north.ts)
// and the retained upper scan; WCP/RLP (east-south-modern.ts), GRP/GRS/GRC and the pool ground are unchanged.
import ctxData from './context.json' with { type: 'json' };
import type { BlockInstallContext } from '../types';
import { Group, box, frames, open, pip, rect, type P2 } from './arch-kit';

export const JESTER_ARCHETYPE = 'b07-wcp-gregory:jester-tower';
/** Tower tier per record: massing volume index (context.json). */
export const JESTER_TOWERS = [{ key: '526723:286', abbr: 'JES', volume: 1 }, { key: '526236:273', abbr: 'JCD', volume: 1 }] as const;
const FLOOR = 2.9, WIN_W = 1.05, WIN_H = 1.5, SILL = 0.8;

/** Remove consecutive vertices closer than 0.25 m. */
export function clean(r: P2[]): P2[] {
  const out: P2[] = [];
  for (const p of open(r)) if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > 0.25) out.push(p);
  if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 0.25) out.pop();
  return out;
}

export function buildJester(_ctx: BlockInstallContext) {
  const g = new Group('Jester towers'), glass = g.d('glass'), brick = g.d('jesterBrick'), sill = g.d('precast'), frame = g.d('bronze');
  type Vol = { ring?: P2[]; rings?: P2[][]; bottom: number; top: number; roof: string };
  const massing = (ctxData as unknown as { massing: Record<string, { datum: { aboveY: number }; volumes: Vol[] }> }).massing;
  const towers: { abbr: string; stacks: number; windows: number; baseY: number; topY: number; floors: number }[] = [];
  const windowLog: { abbr: string; x: number; y: number; z: number; nx: number; nz: number }[] = [];
  for (const t of JESTER_TOWERS) {
    const m = massing[t.key], v = m.volumes[t.volume], hb = m.datum.aboveY, ring = clean((v.rings?.[0] ?? v.ring)!); // outer outline (tier rings carry holes)
    const y0 = hb + v.bottom, y1 = hb + v.top, floors = Math.floor((y1 - y0 - 1.6) / FLOOR);
    let stacks = 0, windows = 0;
    for (const f of frames(ring)) {
      if (f.len < 4.2) continue;
      // Only planes that face out (not into a re-entrant notch of the same tier).
      const mid = [f.a[0] + f.u[0] * f.len / 2 + f.n[0] * 1.2, f.a[1] + f.u[1] * f.len / 2 + f.n[1] * 1.2] as P2;
      if (pip(mid[0], mid[1], ring)) continue;
      const centres = f.len < 7.5 ? [f.len / 2] : [1.15, f.len - 1.15];
      for (const c of centres) {
        const s0 = c - WIN_W / 2, s1 = c + WIN_W / 2, top = y0 + 0.9 + floors * FLOOR - (FLOOR - SILL - WIN_H);
        // Continuous brick jambs framing the whole stack (the "vertical grouping"), dark frame line inside them.
        box(brick, f, s0 - 0.2, s0, 0, 0.1, y0 + 0.4, top + 0.25, { back: true });
        box(brick, f, s1, s1 + 0.2, 0, 0.1, y0 + 0.4, top + 0.25, { back: true });
        box(brick, f, s0 - 0.2, s1 + 0.2, 0, 0.1, top + 0.05, top + 0.25, { back: true });
        for (let k = 0; k < floors; k++) {
          const wy0 = y0 + 0.9 + k * FLOOR + SILL - 0.6, wy1 = wy0 + WIN_H;
          rect(glass, f, s0, s1, 0.035, wy0, wy1);
          box(frame, f, s0, s1, 0.035, 0.07, wy1 - 0.06, wy1, { back: true });
          box(frame, f, (s0 + s1) / 2 - 0.03, (s0 + s1) / 2 + 0.03, 0.035, 0.07, wy0, wy1, { back: true, top: true, bottom: true });
          box(sill, f, s0 - 0.08, s1 + 0.08, 0, 0.14, wy0 - 0.09, wy0, { back: true });
          windows++;
          if (k === Math.floor(floors / 2)) { const p = [f.a[0] + f.u[0] * c, f.a[1] + f.u[1] * c]; windowLog.push({ abbr: t.abbr, x: +p[0].toFixed(2), y: +((wy0 + wy1) / 2).toFixed(2), z: +p[1].toFixed(2), nx: f.n[0], nz: f.n[1] }); }
        }
        stacks++;
      }
    }
    towers.push({ abbr: t.abbr, stacks, windows, baseY: +y0.toFixed(2), topY: +y1.toFixed(2), floors });
  }
  return { group: g, stats: { towers }, windowLog };
}
