// Deep-West extension high-rise profiles (D40, x < -760). The runtime binary (deep-west-v1) carries only two of the three raw
// City 2023 records taller than 45 m; coa-2023:470235 (89.8 m) is excluded by the bake because it crosses / lies within 3 m of
// the east seam x = -760 (extension ownership rule) and no campus.json footprint covers it: a possible seam-excluded coverage
// gap, flagged for the root (not Waterloo, not covered elsewhere). Profiles change ONLY the per-building wall family / colour
// read by the extension renderer; rings, heights, roofs, terrain and colliders are untouched (render geometry = collider is
// rebuilt from the same rings and heights).
import type { DeepWestBuilding } from '../../../extension/deep-west/format';

export interface DeepWestHighrise {
  key: string; runtime: boolean; heightMeters: number;
  identity: string; disposition: 'deep-west-profile' | 'deep-west-retained' | 'seam-excluded-gap';
  wall?: { family: 'precast'; rgb: [number, number, number] };
  evidence: string[]; limits: string;
}
const FR = (k: string, f: string) => `Cesium research frames ${f} (envelope projected from the frame camera; crop .work/references/frames/${k.replace(':', '-')}.jpg)`;
export const DEEP_WEST_HIGHRISES: DeepWestHighrise[] = [
  { key: 'coa-2023:726333', runtime: true, heightMeters: 58.239, identity: 'unverified (a "THE STANDARD" podium sign is visible near it in d40-orbit-northwest; not confirmed)', disposition: 'deep-west-profile',
    wall: { family: 'precast', rgb: [204, 206, 205] }, evidence: [FR('coa-2023:726333', 'd40-orbit-southwest, west-extension-c4-r3')],
    limits: 'baked wall was brownBrick 160,86,64; every frame shows a light-grey panel tower with charcoal vertical panel columns and green-tinted glass, so the wall becomes light-grey precast; charcoal columns not expressible (one wall colour per building)' },
  { key: 'coa-2023:615176', runtime: true, heightMeters: 58.993, identity: 'unverified', disposition: 'deep-west-retained', evidence: [FR('coa-2023:615176', 'd40-orbit-southwest, west-extension-c4-r3, d39-orbit-southwest')],
    limits: 'baked precast 214,214,208 matches the white/light-grey body seen in the frames; orange-brown vertical accent strips are not expressible; unchanged' },
  { key: 'coa-2023:470235', runtime: false, heightMeters: 89.792, identity: 'unverified (charcoal grid glass tower in d40-orbit-southwest)', disposition: 'seam-excluded-gap', evidence: [FR('coa-2023:470235', 'd40-orbit-southwest, d26-orbit-southeast, west-extension-c4-r3'), 'public/assets/extension/deep-west-v1.manifest.json excluded: "crosses or within 3 m of the east seam x=-760"'],
    limits: 'not in the runtime binary and not in campus.json: root decision needed (seam-crossing addition); no profile applied' },
];

/** Copies with the profiled wall family / colour; every other field (rings, heights, roof, district) is the same object data. */
export function applyDeepWestProfiles(buildings: DeepWestBuilding[]): DeepWestBuilding[] {
  const byKey = new Map(DEEP_WEST_HIGHRISES.filter(p => p.runtime && p.wall).map(p => [p.key, p.wall!]));
  return buildings.map(b => { const w = byKey.get(b.key); return w ? { ...b, wall: { family: w.family, rgb: [w.rgb[0], w.rgb[1], w.rgb[2]] } } : b; });
}
