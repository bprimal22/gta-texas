// Deep-West extension high-rise profiles (D40, x < -760). The runtime binary (deep-west-v1) carries only two of the three raw
// City 2023 records taller than 45 m; coa-2023:470235 (89.8 m) is excluded by the bake because it crosses / lies within 3 m of
// the east seam x = -760 (extension ownership rule) and no campus.json footprint covers it: a possible seam-excluded coverage
// gap, flagged for the root (not Waterloo, not covered elsewhere). West Campus pass (2026-10-23): identified as Union on 24th
// and added by lib/campus/extension/west-campus (City ring + City height, seam-crossing, its own module). Profiles change ONLY
// the per-building wall family / colour and the optional runtime facade accent (pier colour / spacing, glass tint) read by
// the extension renderer; rings, heights, roofs, terrain and colliders are untouched (render geometry = collider is rebuilt
// from the same rings and heights).
import type { DeepWestBuilding } from '../../../extension/deep-west/format';

export interface DeepWestHighrise {
  key: string; runtime: boolean; heightMeters: number;
  identity: string; disposition: 'deep-west-profile' | 'deep-west-retained' | 'seam-excluded-gap' | 'west-campus-addition';
  wall?: { family: 'precast'; rgb: [number, number, number] };
  /** Runtime facade accent (geometry.ts facadeProgram): vertical pier colour, every N bays, glass tint index. */
  facade?: { accent?: [number, number, number]; every?: number; glass?: number };
  evidence: string[]; limits: string;
}
const FR = (k: string, f: string) => `Cesium research frames ${f} (envelope projected from the frame camera; crop .work/references/frames/${k.replace(':', '-')}.jpg)`;
export const DEEP_WEST_HIGHRISES: DeepWestHighrise[] = [
  { key: 'coa-2023:726333', runtime: true, heightMeters: 58.239, identity: 'unverified (a "THE STANDARD" podium sign is visible near it in d40-orbit-northwest; not confirmed)', disposition: 'deep-west-profile',
    wall: { family: 'precast', rgb: [204, 206, 205] }, facade: { accent: [62, 64, 68], every: 2, glass: 1 }, evidence: [FR('coa-2023:726333', 'd40-orbit-southwest, west-extension-c4-r3'), 'OSM way 380916747 "The Standard", 715 W 23rd St (name/address over this ring)'],
    limits: 'baked wall was brownBrick 160,86,64; every frame shows a light-grey panel tower with charcoal vertical panel columns and green-tinted glass, so the wall becomes light-grey precast; West Campus pass: charcoal piers every 2 bays + green glass tint (pier width/spacing estimated)' },
  { key: 'coa-2023:615176', runtime: true, heightMeters: 58.993, identity: 'unverified', disposition: 'deep-west-retained', facade: { accent: [166, 96, 60], every: 3 }, evidence: [FR('coa-2023:615176', 'd40-orbit-southwest, west-extension-c4-r3, d39-orbit-southwest')],
    limits: 'baked precast 214,214,208 matches the white/light-grey body seen in the frames (wall unchanged); West Campus pass: orange-brown vertical accent strips every 3 bays (spacing estimated)' },
  { key: 'coa-2023:470235', runtime: false, heightMeters: 89.792, identity: 'Union on 24th, 701 W 24th St (OSM way 1208654798 name/address; Perkins&Will project photos)', disposition: 'west-campus-addition', evidence: [FR('coa-2023:470235', 'd40-orbit-southwest, d26-orbit-southeast, west-extension-c4-r3'), 'public/assets/extension/deep-west-v1.manifest.json excluded: "crosses or within 3 m of the east seam x=-760"'],
    limits: 'not in the deep-west binary and not in campus.json; built by lib/campus/extension/west-campus/towers.ts from the City ring and City height (no profile applied here)' },
];

/** Copies with the profiled wall family / colour and facade accent; every other field (rings, heights, roof, district) is the same object data. */
export function applyDeepWestProfiles(buildings: DeepWestBuilding[]): DeepWestBuilding[] {
  const byKey = new Map(DEEP_WEST_HIGHRISES.filter(p => p.runtime && (p.wall || p.facade)).map(p => [p.key, p]));
  return buildings.map(b => {
    const p = byKey.get(b.key);
    if (!p) return b;
    const out: DeepWestBuilding = { ...b };
    if (p.wall) out.wall = { family: p.wall.family, rgb: [p.wall.rgb[0], p.wall.rgb[1], p.wall.rgb[2]] };
    if (p.facade) out.facade = { ...p.facade };
    return out;
  });
}
