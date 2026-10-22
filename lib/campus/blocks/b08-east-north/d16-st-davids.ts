// D16 — Eastern Dean Keeton: St. David's Medical Center (City 593681:655, corrected official/OSM-split hospital ring) and
// its two parking structures, replaced from their own context.json massing (same rings, datum Y 14.3 / 12.8, same 16 LiDAR
// tier tops -> unchanged roof assertions) with orbit-interpreted facades:
//  - d16-orbit-southwest / -southeast / -northwest (reviewed usable-context; no official photographs exist for D16): salmon-red
//    brick hospital blocks with long continuous dark ribbon-window bands between brick spandrels on every floor, a pale
//    mechanical block on the highest roof tier, open-deck garage stripes. Estimate: 4.3 m floor grid from the LiDAR ground
//    datum, 1.6 m ribbon band, brick colour, deck bay; entrances, canopies and the pale horizontal sunshades seen on one wing
//    are NOT placed (their locations are not resolved). Austin Lakes -804:add and the MOB 526703:285 stay generated.
//  - St. David's garage -803:add (6 levels, top Y 31.4 = LiDAR P50 31.47): open decks with spandrels, piers and guard-rail lines
//    (garage family as in D15); its white open-deck look matches the background garage in the orbits.
//  - 613563:735 (catalog name "Garage 1", top Y 27.1 = LiDAR P50 27.0), revision 2 after root IAB review: the L-shaped
//    foreground body of d16-orbit-southwest is NOT an open-deck garage in the source pixels. All four reviewed orbits show
//    salmon/brown brick piers framing tall recessed dark-teal glazed slots, a brick band above, a red-brown roof-edge coping and
//    a pale flat roof with rooftop units (d16-orbit-southeast). It is rebuilt with that finish on the unchanged footprint/datum/
//    roof: brick piers at a 3.0 m pitch (interpretive), slots 2.2 m wide from Y 16.9 to 23.6 recessed 0.45 m inside the GIS
//    line with mullions, brick band, 0.7 m red-brown coping. Bay / floor counts are interpretive; the record's catalog identity
//    (open parking) conflicts with the pixels and is left as an open question.
import type { BlockInstallContext, BlockMassingVolume } from '../types';
import { Kit, col } from './lane-kit';
import { buildFlatMassing, occludersOf, type FacadeStyle, type Massing } from './flat-massing';
import { garageStyle } from './d15-law-sjg';
import context from './context.json' with { type: 'json' };

export const HOSPITAL_KEY = '593681:655', SDMC_GARAGE_KEY = '-803:add', GARAGE1_KEY = '613563:735';
const M = (context as unknown as { massing: Record<string, Massing> }).massing;
const C = { brick: col('#b46d55'), brickShade: col('#a2604a'), mech: col('#e3e0d8'), mechShade: col('#d2cec4'), roof: col('#d9d7d0'),
  glass: col('#263038'), mullion: col('#6d7175'),
  g1Brick: col('#c08a72'), g1Coping: col('#7b3f30'), g1Glass: col('#1e4b50'), g1Roof: col('#d8d2c6') };
/** 613563:735 slot facade (revision 2): absolute slot sill / head (campus Y), pier pitch and slot width (interpretive). */
export const G1_FACADE = { sillY: 16.9, headY: 23.6, pitch: 3.0, slot: 2.2, recess: 0.45, coping: 0.7 } as const;

export function buildD16(kit: Kit, ctx: BlockInstallContext) {
  const h = M[HOSPITAL_KEY], hb = (h.datum as { aboveY: number }).aboveY;
  const tallest = Math.max(...h.volumes.map((v: BlockMassingVolume) => v.top));
  const brick: FacadeStyle = {
    wall: 'redBrick', wallColor: C.brick, roof: 'membrane', roofColor: C.roof, coping: C.brickShade,
    origin: hb, floor: 4.3, kind: () => 'ribbon', sill: 1.0, head: 2.6, recess: 0.3, glass: C.glass, glassMat: 'glass',
    mullion: { pitch: 1.6, color: C.mullion }, minEdge: 3,
  };
  const mech: FacadeStyle = { ...brick, wall: 'concrete', wallColor: C.mech, coping: C.mechShade, kind: () => null };
  const out: Record<string, unknown> = {};
  const occ = [HOSPITAL_KEY, SDMC_GARAGE_KEY, GARAGE1_KEY].flatMap(k => occludersOf(ctx, k, M[k]));
  out.hospital = buildFlatMassing(kit, ctx, HOSPITAL_KEY, h, (_i, v) => (v.top === tallest ? mech : brick), occ);
  const g1 = M[SDMC_GARAGE_KEY], d1 = (g1.datum as { aboveY: number }).aboveY;
  out.sdmcGarage = buildFlatMassing(kit, ctx, SDMC_GARAGE_KEY, g1, () => garageStyle(d1, 6, d1 + g1.volumes[0].top), occ);
  const g2 = M[GARAGE1_KEY], d2 = (g2.datum as { aboveY: number }).aboveY, F = G1_FACADE;
  const slots: FacadeStyle = {
    wall: 'redBrick', wallColor: C.g1Brick, roof: 'membrane', roofColor: C.g1Roof, coping: C.g1Coping, copingHeight: F.coping,
    origin: d2, floor: g2.volumes[0].top + 1, kind: f => (f === 0 ? 'punched' : null), sill: F.sillY - d2, head: F.headY - d2,
    recess: F.recess, glass: C.g1Glass, glassMat: 'glass', punched: { width: F.slot, pitch: F.pitch },
    mullion: { pitch: 1.1, color: C.mullion }, mullionOnPunched: true, minEdge: 3,
  };
  out.garage1 = buildFlatMassing(kit, ctx, GARAGE1_KEY, g2, () => slots, occ);
  return out;
}
