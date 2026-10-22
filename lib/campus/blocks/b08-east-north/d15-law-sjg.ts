// D15 — Law school / San Jacinto north.
// Replaced (context.json `replaces`, flat massings rebuilt from the same rings/datum/tops):
//  - San Jacinto Garage 655726:905 (UT SJG): ut-sjg-494-directory-photo.jpg (official) shows a concrete open-deck garage:
//    thick pale spandrel beams, dark open decks, square columns, white guard rails. Measured: top deck Y 17.4 (LiDAR P50 17.4,
//    datum -4.9 + 22.3), 8 levels (catalog, UT). Estimate: 7.6 m bay, 1.05 m spandrel, rail line. The corner stair/ramp tower
//    in the photo is NOT placed (its LiDAR returns are not a resolvable blob).
//  - Jesse H. Jones Hall -801:add (UT JON): ut-jon-490-directory-photo.jpg (official): pale precast body, grouped punched square
//    windows on the upper floors, dark recessed ribbon glazing on the two lower floors. Measured: tiers Y 18.9 / 34.0 (LiDAR P10
//    18.99 / P50 33.95). Estimate: floor 4.0 m, window size/pitch; balcony slabs and projecting stair towers are not placed.
//  - UTM Thermal Storage 1 610961:686 (UT TS1): the City ring is a 16-gon (r ~16 m); measured top Y 17.9 (LiDAR P50 17.85);
//    plain pale concrete tank (no facade photograph; colour is an estimate).
// Additive (generated body kept, coverage-exempt): Connally Center for Justice -802:add (UT CCJ): ut-ccj-484-directory-photo.jpg
//  (official) shows pale limestone, flat stone pilasters between tall recessed windows on the lower wing and a strong cornice;
//  context.json gives CCJ the block archetype b08-east-north:ccj-limestone (limestone, 3.0 m window bay, no generated cornice)
//  and this module adds 0.5 m pilasters on the generator's bay boundaries of the lower wing plus a two-step cornice on the
//  flat volumes (visual relief <= 0.26 m proud, no collider). Townes Hall (TNH, arcaded courtyard in ut-tnh-495) is unchanged:
//  the arcade's courtyard cannot be located from the available views.
import type { Point } from '../../types';
import type { BlockInstallContext, BlockMassingVolume } from '../types';
import { Kit, col, outward, unit } from './lane-kit';
import { buildFlatMassing, occludersOf, type FacadeStyle, type Massing } from './flat-massing';
import context from './context.json' with { type: 'json' };

export const SJG_KEY = '655726:905', JON_KEY = '-801:add', TS1_KEY = '610961:686', CCJ_KEY = '-802:add';
const M = (context as unknown as { massing: Record<string, Massing> }).massing;
export const CCJ_BAY = 3.0;

const C = {
  precast: col('#d9d4c9'), precastShade: col('#c9c3b6'), garage: col('#cfcac0'), deckDark: col('#34332f'), rail: col('#e9ebe8'),
  roof: col('#cfccc4'), deckTop: col('#a9a7a2'), glass: col('#2b333a'), mullion: col('#7d8287'), tank: col('#d7d4cb'),
  stone: col('#e1d8c6'), stoneShade: col('#d2c8b4'),
};

export const garageStyle = (origin: number, levels: number, top: number, wall = C.garage): FacadeStyle => ({
  wall: 'concrete', wallColor: wall, roof: 'concrete', roofColor: C.deckTop, coping: C.precastShade,
  origin, floor: (top - origin) / levels, kind: () => 'deck', sill: 1.05, head: (top - origin) / levels, recess: 0.7,
  glass: C.deckDark, glassMat: 'matte', deck: { bay: 7.6, pier: 0.8 }, rail: C.rail, minEdge: 4,
});

export function buildD15(kit: Kit, ctx: BlockInstallContext) {
  const out: Record<string, unknown> = {};
  const occ = [SJG_KEY, JON_KEY, TS1_KEY].flatMap(k => occludersOf(ctx, k, M[k]));
  const sjg = M[SJG_KEY], sjgTop = -4.9 + sjg.volumes[0].top;
  out.sjg = buildFlatMassing(kit, ctx, SJG_KEY, sjg, () => garageStyle(-4.9, 8, sjgTop), occ);
  const jonStyle: FacadeStyle = {
    wall: 'concrete', wallColor: C.precast, roof: 'membrane', roofColor: C.roof, coping: C.precastShade,
    origin: 4.7, floor: 4.0, kind: f => (f <= 1 ? 'ribbon' : 'punched'), sill: 0.9, head: 3.1, recess: 0.5,
    glass: C.glass, glassMat: 'glass', punched: { width: 1.5, pitch: 3.2 }, mullion: { pitch: 1.5, color: C.mullion },
  };
  out.jon = buildFlatMassing(kit, ctx, JON_KEY, M[JON_KEY], () => jonStyle, occ);
  const tank: FacadeStyle = { ...jonStyle, wallColor: C.tank, roof: 'concrete', roofColor: C.tank, kind: () => null };
  out.ts1 = buildFlatMassing(kit, ctx, TS1_KEY, M[TS1_KEY], () => tank, occ);
  out.ccj = ccjRelief(kit, ctx);
  return out;
}

/** CCJ (kept generated): pilasters on the generator's bay boundaries of the lower wing and stepped cornices (visual only). */
function ccjRelief(kit: Kit, ctx: BlockInstallContext) {
  const b = ctx.data.buildings.find(x => x.key === CCJ_KEY);
  if (!b) throw new Error(`D15: ${CCJ_KEY} not in campus data`);
  const m = M[CCJ_KEY], hb = (m.datum as { aboveY: number }).aboveY, g = ctx.groundHeight;
  const prev = kit.group; kit.group = 'add';
  const ring = b.rings[0] as Point[], mainTop = hb + m.volumes[0].top;
  let pil = 0, corn = 0;
  const cornice = (r: Point[], top: number) => {
    for (let i = 0; i < r.length; i++) {
      const a = r[i], c = r[(i + 1) % r.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 1) continue;
      const T = unit(a, c), N = outward(r, i);
      kit.box('detail', 'stone', C.stoneShade, a, T, N, 0, L, 0, 0.12, top - 1.0, top - 0.55, 'k');
      kit.box('detail', 'stone', C.stone, a, T, N, 0, L, 0, 0.26, top - 0.55, top - 0.1, 'k');
      corn++;
    }
  };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < CCJ_BAY) continue;
    const T = unit(a, c), N = outward(ring, i), bays = Math.max(1, Math.round(L / CCJ_BAY)), bw = L / bays;
    const y0 = Math.min(g(a[0], a[1]), g(c[0], c[1])) - 0.3;
    // Each pilaster starts 0.3 m below the lowest ground under its own footprint (buried), and its never-visible bottom
    // cap is not emitted (it read as a low horizontal surface inside the CCJ/TNH footprints in the strict route check).
    const at = (t: number, n: number) => g(a[0] + T[0] * t + N[0] * n, a[1] + T[1] * t + N[1] * n);
    for (let k = 1; k < bays; k++) {
      const t0 = k * bw - 0.25, t1 = k * bw + 0.25, base = Math.min(y0, Math.min(at(t0, 0), at(t1, 0), at(t0, 0.22), at(t1, 0.22)) - 0.3);
      kit.box('detail', 'stone', C.stoneShade, a, T, N, t0, t1, 0, 0.22, base, mainTop - 1.0, 'kb'); pil++;
    }
  }
  cornice(ring, mainTop);
  const flatTier = m.volumes.find((v: BlockMassingVolume) => v.roof === 'flat' && v.ring);
  if (flatTier?.ring) cornice(flatTier.ring, hb + flatTier.top);
  kit.group = prev;
  return { pilasters: pil, corniceRuns: corn };
}
