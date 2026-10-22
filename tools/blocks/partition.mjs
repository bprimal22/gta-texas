// Whole-campus geographic partition (single source of truth). Rectangles are campus metres
// (X east, Z south), half-open [x0,x1) x [z0,z1). Cuts follow street centrelines measured from
// public/data/campus.json path medians (tools/blocks/build-manifest.mjs prints them):
//   (b07/b09 edge at x=290 for z 110..640 so the authored DKR west frontage (x≈300–330) is b09's.)
//   Guadalupe x≈-448 · Speedway x≈22 (corridor 0..45) · San Jacinto x≈256 (cut at 330 east of it,
//   clear of the residence halls) · Robert Dedman x≈621 / I-35 x≈782 (cut 780) ·
//   Dean Keeton z≈-290 (east) / -394 (west), cut -150..-480 band · W/E 24th z≈-194/-124 (cut -150) ·
//   21st z≈256/318 · MLK z≈490 (west) … 780 (east), cut 640 · 15th z≈939…1128 (cut 1100).
// Buildings belong to the block containing their GIS centre unless listed in OVERRIDES (footprint
// owner differs from ground owner; the footprint ring + 3 m then belongs to the override block).
export const BOUNDS = [-760, -864, 1296, 1536];
export const BLOCKS = [
  { id: 'b01-eer', name: 'Engineering: EER, PMA, ETC, ECJ site, Dean Keeton east of Speedway', rects: [[45, 330, -480, -150]], wave: 1,
    focus: 'EER two wings/atrium, west entrance + mall/courtyard, relation to Speedway, PMA/ETC/labs, stair + lawn levels' },
  { id: 'b02-sciences', name: 'Sciences: NHB, Welch, Painter, Burdine, Hackerman, POB', rects: [[-170, 0, -480, -40]], wave: 2,
    focus: 'Welch/NHB/Painter/Hackerman massing and the 24th St / Speedway science frontage; POB (footprint override)' },
  { id: 'b03-gdc-speedway', name: 'GDC, Speedway mall, East Mall, MLK statue', rects: [[0, 330, -150, 110], [0, 45, -480, -150]], wave: 1,
    focus: 'Speedway paving corridor north to Dean Keeton, GDC + Circle with Towers, East Mall, MLK memorial' },
  { id: 'b04-tower', name: 'Tower, Inner Campus, West Mall, Union, Garrison/Waggener', rects: [[-448, -170, -150, 170], [-170, 0, -40, 170]], wave: 1,
    focus: 'Main Building/Tower (scan), Inner Campus drive, West Mall, Union, historic central buildings, West 24th' },
  { id: 'b05-southmall', name: 'South Mall, PCL, Blanton, MLK Blvd west', rects: [[-448, 0, 170, 640]], wave: 2,
    focus: 'South Mall lawn/stairs, PCL, Harry Ransom (HRC spans b04/b05: b05 owns the ring), Blanton (BMA/BMS), Guadalupe–MLK edge' },
  { id: 'b06-northwest', name: 'Northwest: Communications, Littlefield, Biology, Dean Keeton west', rects: [[-448, -170, -480, -150]], wave: 3,
    focus: 'CMA/CMB, Littlefield fountain/house, Gearing, biology greenhouse, Dean Keeton west frontage' },
  { id: 'b07-wcp-gregory', name: 'WCP, Gregory Gym, Jester, San Jacinto residence halls', rects: [[0, 290, 110, 640]], wave: 2,
    focus: 'Student Activity Center/WCP, Gregory Gym + plaza, Jester, San Jacinto residence halls, 21st St' },
  { id: 'b08-east-north', name: 'Dean Keeton east: TNH, CRH, San Jacinto north, Duren', rects: [[330, 1296, -480, -150]], wave: 4,
    focus: 'Law school (TNH/CRH), Dean Keeton east frontage, residence halls north of the stadium' },
  { id: 'b09-stadium', name: 'Stadium + athletics: DKR, Moncrief, Bellmont, LBJ west of I-35', rects: [[330, 780, -150, 110], [290, 780, 110, 640]], wave: 3,
    focus: 'DKR exterior/frontage (captured west stand stays), Bellmont, Moncrief-Neuhaus, Robert Dedman Dr, LBJ, Bass Concert Hall/PAC, Texas Memorial Museum/TMM (centres here)' },
  { id: 'b10-east-campus', name: 'East campus beyond I-35: Manor Rd, Comal, garages, fields', rects: [[780, 1296, -150, 1100]], wave: 4,
    focus: 'East campus east of I-35 incl. SRH (Sid Richardson Hall centre here), Manor Rd, Comal, garages, fields' },
  { id: 'b11-south-medical', name: 'South campus: Dell Medical, Brackenridge, Trinity, MLK Blvd east', rects: [[-448, 780, 640, 1100]], wave: 3,
    focus: 'Dell Med buildings, Waller Creek, MLK/15th corridor (TMM/Bass are b09)' },
  { id: 'b12-west-campus', name: 'West of Guadalupe (West Campus, Drag)', rects: [[-760, -448, -480, 1100]], wave: 5,
    focus: 'Guadalupe (the Drag) frontage, West Campus blocks; mostly generated context' },
  { id: 'b13-north-perimeter', name: 'North perimeter (north of Dean Keeton band)', rects: [[-760, 1296, -864, -480]], wave: 5,
    focus: 'North campus perimeter, Hyde Park edge, 26th–32nd St; mostly generated context' },
  { id: 'b14-capitol', name: 'Capitol + downtown context south of 15th', rects: [[-760, 1296, 1100, 1536]], wave: 4,
    focus: 'Texas Capitol (authored), grounds, downtown/state buildings to the south bound' },
];
/** Footprint owner differs from the ground rectangle (user grouping). id: GIS building id. */
export const OVERRIDE_ABBR = { POB: 'b02-sciences' };
/** Existing authored modules (lib/campus/*.ts and their plan json) and their owning block.
 * Shared infrastructure (game/walkway/world/materials/context/scan/vegetation/ground/render)
 * stays integrator-owned. */
export const MODULE_OWNERS = [
  [/^(engineering-|pma-|dean-sidewalk-clearance)/, 'b01-eer'],
  [/^(welch-|pob-|hackerman-|science-west24-details)/, 'b02-sciences'],
  [/^(gdc-(?!glazing)|circle-with-towers|mlk-|speedway-|brb-yard-priority|mbb-frontage|monochrome-sculpture)/, 'b03-gdc-speedway'],
  [/^(main-building-|main-east-|tower-offline-base|landmarks|inner-campus|union-|wch-building|hogg-building|historic-(glazing|masonry|roof-detail|window-coverings)|waggener-eaves|garrison-|flawn-building|west24\.ts|central-malls|central-mall-materials|mall-yard-surfaces)/, 'b04-tower'],
  [/^(pcl-)/, 'b05-southmall'],
  [/^(wcp-|gregory-|east-south-modern)/, 'b07-wcp-gregory'],
  [/^(dkr-)/, 'b09-stadium'],
  [/^(capitol-)/, 'b14-capitol'],
];
/** Multi-zone generators and shared materials: ROOT-owned. Zone owners return per-building
 * profile/override data for them (lib/campus/blocks/<id>/shared-requests.json); the integrator
 * applies those sequentially (coverage-audit/REVIEW.md "Shared modules are not geographic owners"). */
export const ROOT_SHARED_MODULES = ['historic-central-buildings.ts', 'mall-buildings.ts', 'west24-buildings.ts', 'gdc-glazing.ts',
  'public/data/historic-central-plan.json', 'public/data/mall-buildings-plan.json', 'public/data/west24-buildings-plan.json'];
/** Review units: each block is cut into cells of at most UNIT m so large perimeter zones get
 * street-block-scale accounting (every building record listed per unit). */
export const UNIT = 220;
export const inRect = (x, z, [x0, x1, z0, z1]) => x >= x0 && x < x1 && z >= z0 && z < z1;
export const blockAt = (x, z) => BLOCKS.find(b => b.rects.some(r => inRect(x, z, r)))?.id ?? null;
