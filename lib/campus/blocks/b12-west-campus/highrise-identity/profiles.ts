// b12 high-rise identity (west-campus-identity 2026-10-21): per-building facade profiles for the West Campus high-rises that
// the GENERATED context still builds (lib/campus/context/architecture.ts). Every profile defines owner-prefixed catalogue
// archetypes; the root integrator merges them into the owning block's context.json (catalog archetype or per-volume massing
// archetype, plus source-backed evidence) from .work/INTEGRATION.json (integration.ts, against the frozen baseline.json).
// What a profile changes, and what it does not (verified by scripts/harness/b12-highrise-identity-check.ts):
//  * it CHANGES the generated facade render geometry and trim: wall family + colour, window type (punched / ribbon / glazed /
//    open), bay, width, sill, head, mullions, frame, storey grid, ground storey (podium) family / colour / height / glazing,
//    and therefore the near-camera recessed opening detail and the positions of the 5-7 cm plinth / belt trim bands;
//  * it PRESERVES the body envelope: roof form / colour, parapet, cornice, belt flag, plinth height and sunshades are copied
//    from the prior archetype (PRESERVED_KEYS); no massing ring, height or datum is edited. The check proves, per record,
//    that the collider wall + roof shell triangles, the collider top and the outward extent are identical, that render =
//    collider coverage does not regress, and that the collider triangle count is unchanged except a declared trim side
//    effect (profile.trim: a belt course not built because storey-high glazing fails the generator's belt condition);
//  * glass tint is the shared context glass (architecture.ts has no per-building glass colour field; none is invented).
// Evidence is research reference only (photos / Cesium research frames, never runtime textures). Colours are rendered
// averages read by eye from those references (estimates), not material surveys. No profile claims a 1:1 facade.
import type { Archetype, WindowSpec, WallFamily, WindowType, FrameKind } from '../../../context/catalog';

export type Owner = 'b12-west-campus' | 'b11-south-medical';
/** Archetype fields copied verbatim from the prior archetype (collider tops / trim bands / roof semantics). */
export const PRESERVED_KEYS = ['roof', 'roofColor', 'roofSlope', 'overhang', 'brackets', 'parapet', 'cornice', 'belt', 'baseHeight', 'sunshades'] as const;
export type PreservedKey = typeof PRESERVED_KEYS[number];
/** The facade part a profile may set (everything except the preserved envelope keys and era). */
export type Facade = Omit<Archetype, PreservedKey | 'era' | 'door'> & { door?: Archetype['door'] };
export type Scope = { kind: 'catalog' } | { kind: 'tall-volumes'; minTop: number } | { kind: 'split'; tallest: string; others: string };
export type IdentityStatus = 'official' | 'confirmed-by-root' | 'named-unverified' | 'probable' | 'unverified';
export interface Expect {
  /** Upper-storey opening type that must carry >= 90 % of the upper opening area. */
  upperType: WindowType;
  /** Upper glazed area versus the prior (default) archetype on the same volumes, with the source reason. */
  glazing: 'more' | 'less' | 'similar';
  /** Opening character: 'vertical' = storey-high slots (head-sill >= 85 % storey, height/width >= 2.5);
   * 'band' = continuous horizontal band (opening width >= 85 % of the bay); 'storey-high' = head-sill >= 80 % of the storey. */
  character?: 'vertical' | 'band' | 'storey-high';
  reason: string;
}
export interface HighriseProfile {
  id: string; key: string; owner: Owner; name: string;
  identity: { status: IdentityStatus; source: string };
  /** Archetype the generator used before this profile (prior default; PRESERVED_KEYS come from it). */
  priorArchetype: string;
  scope: Scope;
  /** Local archetype name -> facade. Full key = `${owner}:${local}`. */
  archetypes: Record<string, Facade>;
  primary: string;
  evidence: { basis: 'reference-interpreted' | 'estimate'; sources: string[]; observed: string; limits: string };
  expect: Expect;
  /** Declared, bounded trim side effect (the only allowed collider triangle-count change). */
  trim?: { beltDropped: true; reason: string };
}

const W = (type: WindowType, bay: number, width: number, sill: number, head: number, mullions: number, frame: FrameKind, transom = false): WindowSpec => ({ bay, width, sill, head, mullions, transom, type, frame });
const F = (o: { label: string; reference: string; wall: WallFamily; wallColor: string; ground: WallFamily; groundColor: string; base: WallFamily; baseColor: string; trim: WallFamily; trimColor: string;
  floor: number; groundFloor: number; window: WindowSpec; groundWindow: WindowSpec; storefront?: boolean; door?: Archetype['door'] }): Facade => ({ storefront: false, ...o });

const REF = '.work/references'; // local research copies in this workdir (not shipped)
const FR = (key: string, frames: string) => `Cesium research frames ${frames} (screenshot-dataset; envelope projected from the frame's recorded camera, crop ${REF}/frames/${key.replace(':', '-')}.jpg)`;

export const PROFILES: HighriseProfile[] = [
  { id: 'linden', key: '683551:996', owner: 'b12-west-campus', name: 'The Linden, 313 W 17th St', priorArchetype: 'office-tower',
    identity: { status: 'named-unverified', source: 'b12 catalog note (OSM 28 levels); architect gallery https://www.rhodepartners.com/the-linden/' },
    scope: { kind: 'catalog' }, primary: 'linden',
    archetypes: { linden: F({ label: 'The Linden: glass grid between light taupe piers over a ribbed pale-silver podium', reference: 'Rhode Partners architect aerial (rhodepartners.com/the-linden): near-full-height glass bays between thin light-taupe piers and slab lines; ribbed pale-silver metal screen podium; glazed lobby. Sunset gold in the photo is reflection, not base colour.',
      wall: 'precast', wallColor: '#d8d0c3', trim: 'precast', trimColor: '#d8d0c3', ground: 'metal', groundColor: '#c3c5c4', base: 'metal', baseColor: '#9fa3a4',
      floor: 3.4, groundFloor: 15, window: W('glazed', 3.1, 2.45, 0.12, 3.1, 1, 'light'), groundWindow: W('glazed', 3.1, 2.7, 0.3, 4.3, 2, 'dark', true), door: { width: 2.4, height: 3 } }) },
    evidence: { basis: 'reference-interpreted', sources: [`${REF}/linden-architect-aerial.jpg (https://www.rhodepartners.com/the-linden/, root-acquired)`, FR('683551:996', 'd28-orbit-southwest, priority-14-r2')],
      observed: 'tower: storey-high glass bays (blue/teal by sky reflection) between ~0.6 m light-taupe piers and thin slab bands; dark open amenity level; ribbed pale-silver podium screen ~8 storeys; ribbed metal crown screen',
      limits: 'generator ground storey is capped at 15 m, so the podium screen reads to 15 m only (the real screen reaches ~25 m); the dark amenity level and crown screen are not expressed; glass tint is the shared context glass' },
    expect: { upperType: 'glazed', glazing: 'more', character: 'storey-high', reason: 'architect photo: near-full-height glazing between piers vs generic punched office grid' } },
  { id: 'rise', key: '554717:450', owner: 'b12-west-campus', name: 'Rise at West Campus, 2206 Nueces St', priorArchetype: 'wc-tower',
    identity: { status: 'named-unverified', source: 'b12 catalog note; contractor page https://gmitexas.com/project/rise-at-west-campus/' },
    scope: { kind: 'catalog' }, primary: 'rise',
    archetypes: { rise: F({ label: 'Rise at West Campus: white panel tower with dense dark punched windows over a charcoal screen podium', reference: 'GMI contractor photo GMI_RISE_Kristian-Alveo_Hires-1 (tallest pale tower above the RISE-signed podium) + Cesium frames: white/very light grey panels, dense small dark/blue punched windows, charcoal textured podium screen, colonnade retail base.',
      wall: 'precast', wallColor: '#e4e4e0', trim: 'precast', trimColor: '#f0f0ec', ground: 'metal', groundColor: '#4b5257', base: 'precast', baseColor: '#c9c8c3',
      floor: 3.15, groundFloor: 7.5, window: W('punched', 1.7, 1.15, 0.45, 2.6, 0, 'dark'), groundWindow: W('glazed', 3.2, 2.9, 0.3, 4.2, 1, 'dark', true), storefront: true, door: { width: 2.4, height: 3 } }) },
    evidence: { basis: 'reference-interpreted', sources: [`${REF}/rise-gmi-1-683x1024.jpg (https://gmitexas.com/wp-content/uploads/2026/06/GMI_RISE_Kristian-Alveo_Hires-1-683x1024.jpg)`, FR('554717:450', 'd26-orbit-southeast, west-extension-c4-r4')],
      observed: 'white/very light grey panel body with dense dark and blue punched windows; charcoal podium screen; recessed glazed base',
      limits: 'pale body is accurate (kept pale); the official Entrata gallery returned HTTP 403 (not viewed); blue vertical window stacks and the charcoal corner recess are not expressed separately' },
    expect: { upperType: 'punched', glazing: 'more', reason: 'denser, taller punched windows than the generic 3 m bay stucco grid' } },
  { id: 'travis-courts', key: '597128:680', owner: 'b12-west-campus', name: 'Travis County Civil and Family Courts Facility, 1700 Guadalupe St', priorArchetype: 'office-tower',
    identity: { status: 'named-unverified', source: 'b12 catalog note' }, scope: { kind: 'catalog' }, primary: 'travis-courts',
    archetypes: { 'travis-courts': F({ label: 'Travis County courts: silver-white panels with storey-high dark glass slots', reference: 'Cesium frames b12-r0-a7-30m / d10-orbit-northeast: silver-white cladding with full-height dark vertical glass strips; glazed lobby base.',
      wall: 'metal', wallColor: '#d2d5d4', trim: 'metal', trimColor: '#c4c8c8', ground: 'metal', groundColor: '#cfd2d1', base: 'limestone', baseColor: '#c9c3b6',
      floor: 4.5, groundFloor: 6, window: W('glazed', 3.0, 1.25, 0.1, 4.2, 0, 'dark'), groundWindow: W('glazed', 3.0, 2.7, 0.2, 4.8, 2, 'dark', true), door: { width: 2.4, height: 3.2 } }) },
    evidence: { basis: 'reference-interpreted', sources: [FR('597128:680', 'b12-r0-a7-30m, d10-orbit-northeast')], observed: 'silver-white panels, continuous dark vertical glass slots, glass corner',
      limits: 'Cesium mesh only (no ground photo); the glass corner is not expressed; storey height 4.5 m is an estimate' },
    expect: { upperType: 'glazed', glazing: 'similar', character: 'vertical', reason: 'vertical storey-high slots replace the square punched grid; total glass about the same' } },
  { id: 'clements', key: '486277:108', owner: 'b12-west-campus', name: 'William P. Clements, Jr. Building (tower volumes)', priorArchetype: 'state-office',
    identity: { status: 'named-unverified', source: 'b12 catalog note (City ring spans 2 OSM buildings)' }, scope: { kind: 'tall-volumes', minTop: 35 }, primary: 'clements',
    archetypes: { clements: F({ label: 'Clements Building: pale precast with dark horizontal ribbon windows', reference: 'Cesium frames d28-orbit-northwest / d23-orbit-northeast: pale stepped mass, continuous dark window ribbons between pale spandrels.',
      wall: 'precast', wallColor: '#e2e0d9', trim: 'precast', trimColor: '#ebe9e3', ground: 'precast', groundColor: '#d4d1c8', base: 'precast', baseColor: '#c9c5bb',
      floor: 3.9, groundFloor: 4.6, window: W('ribbon', 3.0, 2.8, 0.95, 2.75, 1, 'dark'), groundWindow: W('glazed', 3.6, 3.2, 0.5, 3.6, 2, 'dark'), door: { width: 2.4, height: 3 } }) },
    evidence: { basis: 'reference-interpreted', sources: [FR('486277:108', 'd28-orbit-northwest, d23-orbit-northeast')], observed: 'pale precast with horizontal dark ribbon windows; stepped upper mass',
      limits: 'only volumes >= 35 m above the datum get the profile (the merged 7-level neighbour wing keeps state-office); the stepped terraces are the existing LiDAR tiers' },
    expect: { upperType: 'ribbon', glazing: 'more', character: 'band', reason: 'continuous ribbons instead of punched limestone windows' } },
  { id: '21-rio', key: '503131:167', owner: 'b12-west-campus', name: '21 Rio, 2101 Rio Grande St', priorArchetype: 'wc-tower',
    identity: { status: 'named-unverified', source: 'b12 catalog note (OSM 21 levels)' }, scope: { kind: 'catalog' }, primary: '21-rio',
    archetypes: { '21-rio': F({ label: '21 Rio: white panels with wide glazed bays', reference: 'Cesium frames b12-r0-a4-30m-r2 / d27-orbit-southeast: white panel tower with wide teal-tinted glazed bays and a glazed band; grey base.',
      wall: 'precast', wallColor: '#e6e6e2', trim: 'precast', trimColor: '#efefeb', ground: 'precast', groundColor: '#a7aaa9', base: 'precast', baseColor: '#9ea1a0',
      floor: 3.15, groundFloor: 4.6, window: W('glazed', 2.4, 1.7, 0.5, 2.7, 1, 'dark'), groundWindow: W('glazed', 3.0, 2.7, 0.4, 3.6, 2, 'dark', true), door: { width: 2.2, height: 2.8 } }) },
    evidence: { basis: 'estimate', sources: [FR('503131:167', 'b12-r0-a4-30m-r2, d26-orbit-northwest, d27-orbit-southeast')], observed: 'white panels, wide glazed bays, glass band',
      limits: 'adjacent towers overlap in the oblique frames; facade split per face not expressed; low confidence' },
    expect: { upperType: 'glazed', glazing: 'more', reason: 'wide glazed bays seen in the frames vs generic punched' } },
  { id: 'ion', key: '622603:771', owner: 'b12-west-campus', name: 'Ion Austin, 2100 San Antonio St (tower volumes)', priorArchetype: 'wc-tower',
    identity: { status: 'confirmed-by-root', source: 'root reconciliation: OSM way 516283026 Ion Austin (98 % inside the City ring, 29 % of it; the host union also holds 2103 Nueces, 382 m2)' },
    scope: { kind: 'tall-volumes', minTop: 30 }, primary: 'ion',
    archetypes: { ion: F({ label: 'Ion Austin: off-white tower with red-brick trim bands', reference: 'Cesium frame b12-r0-a4-30m-r2 (all candidate envelopes drawn, multi-b12-r0-a4-30m-r2.jpg): off-white body with red-brick end piers/bays over a red-brick garage podium.',
      wall: 'stucco', wallColor: '#e5e1d6', trim: 'brownBrick', trimColor: '#9a4a3a', ground: 'brownBrick', groundColor: '#9a4a3a', base: 'brownBrick', baseColor: '#8a4234',
      floor: 3.15, groundFloor: 4.6, window: W('punched', 2.2, 1.2, 0.7, 2.45, 1, 'dark'), groundWindow: W('punched', 3.2, 1.6, 0.9, 2.8, 1, 'dark') }) },
    evidence: { basis: 'reference-interpreted', sources: [FR('622603:771', 'b12-r0-a4-30m-r2, d26-orbit-northwest'), `${REF}/frames/multi-b12-r0-a4-30m-r2.jpg`],
      observed: 'off-white tower with red-brick vertical piers / end walls; red-brick garage podium; teal crown caps',
      limits: 'only the tall volumes (>= 30 m above datum) get the profile; the shared main volume (podium + the 2103 Nueces wing) keeps its prior archetype; brick piers are expressed only as brick trim bands' },
    expect: { upperType: 'punched', glazing: 'more', reason: 'b12-r0-a4-30m-r2 shows paired windows on the off-white body at roughly twice the sparse generic density; identity change is also the red-brick trim' } },
  { id: 'lark', key: '735333:1272', owner: 'b12-west-campus', name: 'Lark Austin (probable), 2100 Nueces St', priorArchetype: 'wc-tower',
    identity: { status: 'probable', source: 'b12 catalog note (listing only)' }, scope: { kind: 'catalog' }, primary: 'lark',
    archetypes: { lark: F({ label: 'Lark (probable): light grey panels with large glazed bays', reference: 'Cesium frames d26-orbit-northwest (envelope fits a teal glass curtain-wall tower) and d27-orbit-southwest (white panels with a dark band): mixed glass and light panels.',
      wall: 'precast', wallColor: '#dcdedd', trim: 'precast', trimColor: '#e8e9e8', ground: 'metal', groundColor: '#6d7376', base: 'metal', baseColor: '#5f6467',
      floor: 3.15, groundFloor: 4.6, window: W('glazed', 2.0, 1.6, 0.5, 2.75, 1, 'dark'), groundWindow: W('glazed', 3.0, 2.7, 0.3, 3.8, 2, 'dark', true), door: { width: 2.2, height: 2.8 } }) },
    evidence: { basis: 'estimate', sources: [FR('735333:1272', 'd26-orbit-northwest, d27-orbit-southwest, b12-r0-a4-30m')], observed: 'frames conflict: one shows a teal glass curtain wall, another white panels',
      limits: 'conflicting frames; a middle profile (large glazed bays in light panels) is used; identity probable only' },
    expect: { upperType: 'glazed', glazing: 'more', reason: 'both frames show far more glass than the generic punched stucco grid' } },
  { id: 'signature-1909', key: '486699:114', owner: 'b12-west-campus', name: 'Signature 1909, 1909 Rio Grande St', priorArchetype: 'wc-tower',
    identity: { status: 'named-unverified', source: 'b12 catalog note (listing only)' }, scope: { kind: 'catalog' }, primary: 'signature-1909',
    archetypes: { 'signature-1909': F({ label: 'Signature 1909: white panels with horizontal blue-grey window bands', reference: 'Cesium frames d27-orbit-southeast / west-extension-c4-r5: white tower with continuous horizontal blue-grey window bands.',
      wall: 'precast', wallColor: '#e5e6e3', trim: 'precast', trimColor: '#eeefec', ground: 'precast', groundColor: '#b9bcbb', base: 'precast', baseColor: '#a9acab',
      floor: 3.15, groundFloor: 4.6, window: W('ribbon', 3.2, 3.05, 0.9, 2.45, 1, 'light'), groundWindow: W('glazed', 3.0, 2.7, 0.4, 3.6, 2, 'dark', true), door: { width: 2.2, height: 2.8 } }) },
    evidence: { basis: 'reference-interpreted', sources: [FR('486699:114', 'west-extension-c4-r5, d27-orbit-southeast, b12-r0-a4-30m-r2')], observed: 'white panels, horizontal light blue-grey window bands',
      limits: 'official gallery (prospectportal) returned HTTP 403 (not viewed); Cesium mesh only' },
    expect: { upperType: 'ribbon', glazing: 'more', character: 'band', reason: 'continuous horizontal window bands' } },
  { id: 'doubletree', key: '525738:260', owner: 'b12-west-campus', name: 'DoubleTree Suites Austin Downtown Capitol, 303 W 15th St', priorArchetype: 'office-tower',
    identity: { status: 'named-unverified', source: 'b12 catalog note (OSM 15 levels)' }, scope: { kind: 'catalog' }, primary: 'doubletree',
    archetypes: { doubletree: F({ label: 'DoubleTree Suites: beige precast with punched dark windows', reference: 'Cesium frame d34-orbit-southeast / b12-r0-b8-30m: beige-tan precast hotel with a regular grid of small punched dark windows (a pink-brick part is visible but not expressed).',
      wall: 'precast', wallColor: '#cbbfa9', trim: 'precast', trimColor: '#d9cfbd', ground: 'limestone', groundColor: '#c9bba3', base: 'limestone', baseColor: '#bfb099',
      floor: 3.1, groundFloor: 5, window: W('punched', 1.9, 1.2, 0.85, 2.45, 0, 'dark'), groundWindow: W('glazed', 3.0, 2.6, 0.3, 4.0, 2, 'dark', true), door: { width: 2.4, height: 3 } }) },
    evidence: { basis: 'reference-interpreted', sources: [FR('525738:260', 'b12-r0-b8-30m, d34-orbit-southeast, b14-r0-a1-30m')], observed: 'beige precast, small punched windows; pink brick portion',
      limits: 'SXSW Center glass ribbons sit next to it in the same frames; the pink-brick portion is not expressed (volume split unknown)' },
    expect: { upperType: 'punched', glazing: 'less', reason: 'small hotel punched windows vs the generic office near-continuous grid' } },
  { id: 'villas-on-rio', key: '641335:834', owner: 'b12-west-campus', name: 'Villas on Rio, 2111 Rio Grande St', priorArchetype: 'wc-tower',
    identity: { status: 'named-unverified', source: 'b12 catalog note (listing only)' }, scope: { kind: 'catalog' }, primary: 'villas-on-rio',
    archetypes: { 'villas-on-rio': F({ label: 'Villas on Rio: white panels with dense dark punched windows', reference: 'Cesium frame b12-r0-a4-30m-r2 (cyan envelope): white sawtooth-stepped facade with dark punched windows in a diagonal arrangement; a teal glass portion on one side.',
      wall: 'precast', wallColor: '#e8e8e4', trim: 'precast', trimColor: '#f1f1ee', ground: 'precast', groundColor: '#c2c4c2', base: 'precast', baseColor: '#b2b4b2',
      floor: 3.15, groundFloor: 4.6, window: W('punched', 2.1, 1.25, 0.6, 2.4, 0, 'dark'), groundWindow: W('glazed', 3.0, 2.7, 0.4, 3.6, 2, 'dark', true), door: { width: 2.2, height: 2.8 } }) },
    evidence: { basis: 'reference-interpreted', sources: [FR('641335:834', 'b12-r0-a4-30m, d26-orbit-northwest'), `${REF}/frames/multi-b12-r0-a4-30m-r2.jpg`], observed: 'white sawtooth facade, dense dark punched windows (diagonal pattern), teal glass side',
      limits: 'the sawtooth plan and diagonal window pattern are not expressible by the generator; the teal glass side is not expressed' },
    expect: { upperType: 'punched', glazing: 'more', reason: 'denser punched windows in a white panel facade' } },
  { id: 'inspire', key: '697152:1015', owner: 'b12-west-campus', name: 'Inspire on 22nd, 2200 Nueces St', priorArchetype: 'wc-tower',
    identity: { status: 'confirmed-by-root', source: 'root reconciliation: OSM way 380922461, 97 % matched' }, scope: { kind: 'catalog' }, primary: 'inspire',
    archetypes: { inspire: F({ label: 'Inspire on 22nd: light grey panels, charcoal trim and base', reference: 'Cesium frames b12-r0-a4-30m / d26-orbit-northeast: light grey/white panels with charcoal vertical bands, teal-tinted punched windows, dark base.',
      wall: 'precast', wallColor: '#cfd1cf', trim: 'metal', trimColor: '#4a4e52', ground: 'metal', groundColor: '#4a4e52', base: 'metal', baseColor: '#3f4346',
      floor: 3.15, groundFloor: 4.6, window: W('punched', 1.7, 1.2, 0.5, 2.6, 0, 'dark'), groundWindow: W('glazed', 3.0, 2.7, 0.3, 3.8, 2, 'dark', true), door: { width: 2.2, height: 2.8 } }) },
    evidence: { basis: 'reference-interpreted', sources: [FR('697152:1015', 'd26-orbit-northeast, b12-r0-a4-30m, west-extension-c4-r4')], observed: 'light grey panels, charcoal vertical bands, teal-tinted windows',
      limits: 'charcoal vertical bands expressed only as charcoal trim/base (no per-stripe colour)' },
    expect: { upperType: 'punched', glazing: 'more', reason: 'taller, denser windows than the generic grid' } },
  { id: 'sxsw-center', key: '717464:1161', owner: 'b12-west-campus', name: 'SXSW Center, 1400 Lavaca St', priorArchetype: 'office-tower',
    identity: { status: 'confirmed-by-root', source: 'root reconciliation' }, scope: { kind: 'catalog' }, primary: 'sxsw-center',
    archetypes: { 'sxsw-center': F({ label: 'SXSW Center: glass ribbon curtain wall with pale spandrels over a pale ribbed screen podium', reference: 'Cesium frames b12-r0-b8-30m / b14-r0-a1-30m: continuous teal-tinted glass ribbons with pale metal spandrel bands; pale ribbed screen on the lower levels.',
      wall: 'metal', wallColor: '#b9bdbf', trim: 'metal', trimColor: '#c9cdce', ground: 'metal', groundColor: '#c9ccca', base: 'metal', baseColor: '#9da1a3',
      floor: 4.2, groundFloor: 12, window: W('ribbon', 3.0, 2.85, 0.85, 3.75, 1, 'dark'), groundWindow: W('glazed', 3.0, 2.7, 0.3, 4.5, 2, 'dark', true), door: { width: 2.4, height: 3.2 } }) },
    evidence: { basis: 'reference-interpreted', sources: [FR('717464:1161', 'b12-r0-b8-30m, d34-orbit-southeast, b14-r0-a1-30m')], observed: 'glass ribbons + pale spandrels, pale ribbed podium screen',
      limits: 'podium screen height (12 m) estimated from the frames' },
    expect: { upperType: 'ribbon', glazing: 'more', character: 'band', reason: 'continuous ribbon curtain wall' } },
  { id: 'tma', key: '525515:254', owner: 'b12-west-campus', name: 'TMA office + union garage', priorArchetype: 'office-tower',
    identity: { status: 'confirmed-by-root', source: 'root reconciliation: 3-level garage + 10-level TMA office in one City union' },
    scope: { kind: 'split', tallest: 'tma-office', others: 'tma-garage' }, primary: 'tma-office',
    archetypes: {
      'tma-office': F({ label: 'TMA office: taupe-brown masonry with punched dark windows', reference: 'Cesium frames b12-r0-a8-30m / d28-orbit-northwest: taupe-brown masonry office block with a regular punched window grid.',
        wall: 'brownBrick', wallColor: '#8f7466', trim: 'precast', trimColor: '#b9aa98', ground: 'brownBrick', groundColor: '#8f7466', base: 'precast', baseColor: '#a99a88',
        floor: 3.6, groundFloor: 4.6, window: W('punched', 1.8, 1.2, 0.8, 2.6, 0, 'dark'), groundWindow: W('glazed', 3.0, 2.6, 0.4, 3.6, 2, 'dark'), door: { width: 2.4, height: 3 } }),
      'tma-garage': F({ label: 'TMA union garage: open precast parking decks', reference: 'Cesium frames b12-r0-a8-30m / d28-orbit-northwest: open-deck precast garage beside the office.',
        wall: 'precast', wallColor: '#a9a29a', trim: 'precast', trimColor: '#b8b1a8', ground: 'precast', groundColor: '#a9a29a', base: 'precast', baseColor: '#9b958d',
        floor: 3.1, groundFloor: 3.6, window: W('open', 3.2, 2.8, 1.0, 2.5, 0, 'dark'), groundWindow: W('open', 3.2, 2.8, 1.0, 2.6, 0, 'dark'), door: { width: 2.6, height: 2.6 } }) },
    evidence: { basis: 'reference-interpreted', sources: [FR('525515:254', 'b12-r0-a8-30m, d28-orbit-northwest, b14-r0-a1-30m')], observed: 'taupe-brown punched-window office beside an open precast garage',
      limits: 'office = the tallest non-mech volume, garage = the other non-mech volumes (podium/tower split preserved; no ring changes)' },
    expect: { upperType: 'punched', glazing: 'less', reason: 'masonry punched office vs the generic office near-continuous grid' } },
  { id: 'waterloo', key: '594352:667', owner: 'b12-west-campus', name: 'Yugo Austin Waterloo, 2400 Seton Ave', priorArchetype: 'wc-tower',
    identity: { status: 'named-unverified', source: 'b12 catalog note; developer article https://lvcollective.com/rendering-reality-waterloo/' }, scope: { kind: 'catalog' }, primary: 'waterloo',
    archetypes: { waterloo: F({ label: 'Waterloo: pale grey panel tower with large glazed bays over a black textured masonry podium', reference: 'LV Collective developer photo DSC06440 (2400 frontage): black textured masonry podium with a glazed ground storey; pale grey panel tower with large blue glass bays above. Article: copper panels on the 24th Street face (not expressed).',
      wall: 'precast', wallColor: '#cdd0d0', trim: 'precast', trimColor: '#e4e5e3', ground: 'brownBrick', groundColor: '#2f3133', base: 'brownBrick', baseColor: '#26282a',
      floor: 3.15, groundFloor: 15, window: W('glazed', 2.6, 2.0, 0.35, 2.85, 1, 'dark'), groundWindow: W('glazed', 2.6, 2.2, 0.3, 4.4, 2, 'dark', true), storefront: true, door: { width: 2.4, height: 3 } }) },
    evidence: { basis: 'reference-interpreted', sources: [`${REF}/waterloo-DSC06440-1.jpg (https://lvcollective.com/wp-content/uploads/2023/04/DSC06440-1.jpg)`, 'https://lvcollective.com/rendering-reality-waterloo/ ("the exterior of Waterloo facing 24th Street features copper panels")', FR('594352:667', 'd26-orbit-southeast, west-extension-c3-r2')],
      observed: 'black textured masonry podium, glazed ground storey, pale grey panels with large blue glass bays; Cesium frames show charcoal and white grid sections',
      limits: 'copper panels on the 24th St face need a per-face colour the generator does not have (optional hook, not implemented); podium white herringbone panels and podium windows not expressed; podium reads to 15 m (generator cap)' },
    expect: { upperType: 'glazed', glazing: 'more', reason: 'large glass bays above a pale spandrel in the developer photo DSC06440 tower floors (sill 0.35 m keeps the prior belt course)' } },
  { id: 'union-san-antonio', key: '512858:245', owner: 'b12-west-campus', name: 'Union on San Antonio, 2011 San Antonio St', priorArchetype: 'wc-tower',
    identity: { status: 'named-unverified', source: 'b12 catalog note (OSM way 380922462); Greystar page https://www.greystar.com/union-on-san-antonio-austin-tx/p_20476 (2011 San Antonio)' }, scope: { kind: 'catalog' }, primary: 'union-san-antonio',
    archetypes: { 'union-san-antonio': F({ label: 'Union on San Antonio: slim vertical silver metal cladding with storey-high glass doors and windows', reference: 'Greystar photo 20476BDG1 (finished facade, partial view at left): silver standing-seam vertical metal panels, storey-high glass balcony doors / windows in dark frames, projecting concrete balcony slabs with dark railings (balconies not expressed).',
      wall: 'metal', wallColor: '#b8bab7', trim: 'metal', trimColor: '#c6c8c5', ground: 'brownBrick', groundColor: '#b99c7f', base: 'precast', baseColor: '#c6c0b3',
      floor: 3.2, groundFloor: 4.6, window: W('glazed', 3.2, 1.9, 0.1, 2.9, 1, 'dark'), groundWindow: W('punched', 3, 1.6, 0.9, 2.8, 1, 'dark'), door: { width: 2, height: 2.6 } }) },
    evidence: { basis: 'reference-interpreted', sources: ['../references/union-san-antonio.jpg (root-acquired; https://s7d9.scene7.com/is/image/greystarprod/20476BDG1, page https://www.greystar.com/union-on-san-antonio-austin-tx/p_20476, sha256 b851fe7fed6938501f78982d84ab209929f104b097d397945875f21395a038a5)'],
      observed: 'partial finished facade (one face, upper storeys): slim vertical silver metal cladding, storey-high glass doors / windows with dark frames, projecting concrete balcony slabs with dark vertical railings',
      limits: 'partial photo of one face only: other faces assumed alike (estimate); balcony slabs / railings not modelled (no exact balcony geometry claimed); ground storey not shown, so it keeps the prior wc-tower ground values (the wc-tower name-based storefront rule no longer applies); Cesium frames predate completion' },
    expect: { upperType: 'glazed', glazing: 'more', character: 'storey-high', reason: 'storey-high glass doors / windows in the Greystar photo vs the generic punched stucco grid' },
    trim: { beltDropped: true, reason: 'storey-high balcony doors (sill 0.1 m) fail the generator belt condition (window sill > 0.3 m), so the 5 cm belt course at the ground-storey line is not built; the photo shows no belt course on the visible upper facade (the ground storey is not shown)' } },
  { id: 'hilton-garden-inn-17th', key: '528581:317', owner: 'b11-south-medical', name: 'Hilton Garden Inn Austin University Capitol District, 301 W 17th St', priorArchetype: 'office-tower',
    identity: { status: 'named-unverified', source: 'b11 catalog (basis known, OSM way 960180825; DPR / HRI pages)' }, scope: { kind: 'catalog' }, primary: 'hilton-garden-inn-17th',
    archetypes: { 'hilton-garden-inn-17th': F({ label: 'Hilton Garden Inn 17th St: pale precast hotel with punched windows', reference: 'Cesium frames b12-r0-b7-30m / d28-orbit-southwest: pale grey-white precast with vertical bands of punched windows and a beige stone-textured section.',
      wall: 'precast', wallColor: '#dedfdc', trim: 'precast', trimColor: '#e9e9e6', ground: 'limestone', groundColor: '#cdbfa8', base: 'limestone', baseColor: '#c1b39c',
      floor: 3.9, groundFloor: 5, window: W('punched', 1.8, 1.1, 0.8, 2.6, 0, 'dark'), groundWindow: W('glazed', 3.0, 2.7, 0.3, 4.2, 2, 'dark', true), door: { width: 2.4, height: 3 } }) },
    evidence: { basis: 'reference-interpreted', sources: [FR('528581:317', 'b12-r0-b7-30m, priority-14-r2, d28-orbit-southwest')], observed: 'pale precast hotel with punched windows in vertical groups; beige stone section',
      limits: 'outside parent (b11-south-medical owns the record): delivered as a b11 patch only; the beige section is not expressed' },
    expect: { upperType: 'punched', glazing: 'less', reason: 'hotel punched windows grouped in a pale precast body vs the generic office near-continuous grid' } },
];

export type Disposition = 'changed-profile' | 'retained-authored-verified' | 'authored-root-patch' | 'uncertain-unchanged' | 'outside-parent-patch' | 'delegated-other-lane' | 'seam-excluded-gap' | 'deep-west-profile' | 'deep-west-retained' | 'west-campus-addition';
export interface RootPatch { file: string; old: string; new: string; why: string }
export interface LedgerNote { key: string; name: string; owner: string; runtime: string; disposition: Disposition; evidence: string[]; uncertainty: string; rootPatches?: RootPatch[] }

/** Authored (b12 install) towers: audited against the local photos; no geometry is rebuilt or duplicated here. */
export const AUTHORED: LedgerNote[] = [
  { key: '732897:1231', name: 'Moontower', owner: 'b12-west-campus', runtime: 'authored (towers.ts)', disposition: 'retained-authored-verified', evidence: ['west-campus-dataset-pass/photos/moontower-architect-01.jpg'], uncertainty: 'white offset panels on a dark body, glass corner column and orange crown frame match the photo; unchanged' },
  { key: '550397:416', name: 'Skyloft', owner: 'b12-west-campus', runtime: 'authored (towers.ts)', disposition: 'authored-root-patch', evidence: ['west-campus-dataset-pass/photos/skyloft-01.jpg'],
    uncertainty: 'skyloft-01 shows cool white / light-grey panels; the authored N/S-face colour is warm sand. One-literal colour patch proposed (medium confidence: single photo, daylight white balance)',
    rootPatches: [{ file: 'lib/campus/blocks/b12-west-campus/towers.ts', old: "  const pale = C('#dcd7cb'), warm = C('#c9b796');", new: "  const pale = C('#dcd7cb'), warm = C('#c4c7c5'); // N/S faces: cool light-grey panels in skyloft-01 (was warm sand #c9b796)", why: 'source colour correction; geometry, windows and colliders unchanged' }] },
  { key: '657418:943', name: 'The Castilian', owner: 'b12-west-campus', runtime: 'authored (towers.ts)', disposition: 'retained-authored-verified', evidence: ['west-campus-dataset-pass/photos/castilian-10.jpg'], uncertainty: 'pale tower piers with dark vertical glazing, blue-grey finned glass podium and dark band match; unchanged (genuinely light)' },
  { key: '525341:252', name: '2400 Nueces + Nueces Garage', owner: 'b12-west-campus', runtime: 'authored (towers.ts)', disposition: 'retained-authored-verified', evidence: ['west-campus-dataset-pass/photos/nueces2400-00.jpg'], uncertainty: 'maroon / tan / zinc tiers, balconies and multicolour garage slats match; unchanged' },
  { key: '490461:139', name: 'Torre', owner: 'b12-west-campus', runtime: 'authored (towers.ts)', disposition: 'retained-authored-verified', evidence: ['west-campus-dataset-pass/photos/torre-02.jpg'], uncertainty: 'white body with dark punched windows and glazed amenity band is the photographed finish; unchanged (genuinely white)' },
  { key: '592244:630', name: 'Moody Bank Tower', owner: 'b12-west-campus', runtime: 'authored (district.ts, PBR)', disposition: 'authored-root-patch', evidence: [`${REF}/linden-architect-aerial.jpg (background, Rhode Partners)`],
    uncertainty: 'tan piers (#bca889) and dark slots (#4a4643) match; the black crown sign band is missing (top band all pale). Patch splits the existing flush 3.6 m top-band quad: pale lower 1.4 m, black upper 2.2 m (band height estimated from the photo); same plane, so colliders keep the same surface. Note: the b12 harness moodyUpperWalls family tally will gain a metal share',
    rootPatches: [
      { file: 'lib/campus/blocks/b12-west-campus/pbr.ts', old: "mbSoffit: ['#d8d2c4', 'limestone'],", new: "mbSoffit: ['#d8d2c4', 'limestone'], mbCrown: ['#1f2022', 'metal'],", why: 'palette entry for the black crown sign band (PBR family metal)' },
      { file: 'lib/campus/blocks/b12-west-campus/district.ts', old: "    Q(e, 0, e.L, yT, T, 0, 0, col('mbBand'), e.n);", new: "    Q(e, 0, e.L, yT, T - 2.2, 0, 0, col('mbBand'), e.n);\n    Q(e, 0, e.L, T - 2.2, T, 0, 0, col('mbCrown'), e.n); // black crown sign band (linden-architect-aerial background)", why: 'crown band colour; same flush plane, no new relief' }] },
];

export const LEDGER_EXTRA: LedgerNote[] = [
  { key: '484112:83', name: 'Dobie Center (b05)', owner: 'b05-southmall', runtime: 'b05 lane', disposition: 'delegated-other-lane', evidence: [], uncertainty: 'separate b05 Dobie lane (not touched here)' },
];

/** Deep-West extension: raw source high-rises (> 45 m) vs the two that are actually in the runtime binary. See deep-west.ts. */
export const RAW_DEEP_WEST_OVER_45 = ['coa-2023:470235', 'coa-2023:615176', 'coa-2023:726333'] as const;
