// Builds public/data/building-catalog.json: one entry per campus.json building
// (keyed by id, with abbr), assigning a real-world architectural archetype and
// recording the basis of that assignment. Optional LiDAR roof measurements from
// public/data/derived/roofs-lidar.json (lidar lane) are only summarised (stats.massing).
// Usage: node tools/context/build-catalog.mjs [path/to/roofs-lidar.json]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const campus = JSON.parse(readFileSync(resolve(root, 'public/data/campus.json'), 'utf8'));
const lidarPath = resolve(process.argv[2] ?? resolve(root, 'public/data/derived/roofs-lidar.json'));
const lidar = existsSync(lidarPath) ? JSON.parse(readFileSync(lidarPath, 'utf8')) : null;

// Window/storey dimensions are metres. `head`/`sill` are above each floor line.
// Colours are linear-ish sRGB targets for the *average* rendered facade.
const W = (bay, width, sill, head, extra = {}) => ({ bay, width, sill, head, mullions: 1, transom: false, type: 'punched', frame: 'dark', ...extra });
export const ARCHETYPES = {
  'cret-core': {
    label: 'Cret/Greene-era Spanish-Mediterranean core', era: '1910s-1950s',
    wall: 'buffBrick', wallColor: '#d6c09c', ground: 'limestone', groundColor: '#e2d5ba', base: 'limestone', baseColor: '#ddd0b5', baseHeight: 1.3,
    trim: 'limestone', trimColor: '#e6dac2', roof: 'hip-tile', roofColor: '#b0583a', roofSlope: 0.42, overhang: 1.0, brackets: true,
    parapet: 0, cornice: 0.45, belt: true, floor: 4.3, groundFloor: 4.8,
    window: W(3.6, 1.35, 0.95, 3.05, { transom: true, frame: 'bronze', surround: true }),
    groundWindow: W(3.6, 1.5, 1.0, 3.6, { transom: true, frame: 'bronze', surround: true }), door: { width: 2.2, height: 3.0 },
    reference: 'UT 1930s Cret master plan idiom: cream limestone ground storey and trim, buff brick upper walls, red clay barrel-tile hipped roofs on carved/bracketed eaves (Garrison, Painter, Gearing, Biology Labs).',
  },
  'cret-residence': {
    label: 'Core-idiom residence hall', era: '1920s-1950s, 2000s revival',
    wall: 'buffBrick', wallColor: '#d4bd98', ground: 'buffBrick', groundColor: '#d4bd98', base: 'limestone', baseColor: '#ddd0b5', baseHeight: 1.0,
    trim: 'limestone', trimColor: '#e6dac2', roof: 'hip-tile', roofColor: '#b0583a', roofSlope: 0.42, overhang: 0.8, brackets: true,
    parapet: 0, cornice: 0.35, belt: false, floor: 3.5, groundFloor: 3.9,
    window: W(3.0, 1.1, 0.85, 2.45, { mullions: 0, transom: true, frame: 'bronze', surround: true }),
    groundWindow: W(3.0, 1.1, 0.9, 2.75, { mullions: 0, transom: true, frame: 'bronze', surround: true }), door: { width: 1.9, height: 2.7 },
    reference: 'Women\'s/men\'s dorms of 1927-1958 (Littlefield, Andrews, Carothers, Roberts, Prather, Moore-Hill, Kinsolving) and the 2000s San Jacinto/Duren halls: buff brick, limestone trim, red tile hipped roofs.',
  },
  'master-plan': {
    label: '1999 master-plan campus building', era: '2000s-2020s',
    wall: 'buffBrick', wallColor: '#d2b894', ground: 'limestone', groundColor: '#e0d3b8', base: 'limestone', baseColor: '#ddd0b5', baseHeight: 1.0,
    trim: 'limestone', trimColor: '#e4d8c0', roof: 'flat', roofColor: '#c9c6bf', roofSlope: 0, overhang: 0, brackets: false,
    parapet: 1.0, cornice: 0.3, belt: true, floor: 4.3, groundFloor: 5.0, sunshades: true,
    window: W(3.1, 2.1, 0.8, 3.1, { mullions: 2, transom: true }),
    groundWindow: W(3.1, 2.5, 0.45, 3.9, { type: 'glazed', mullions: 2, transom: true }), door: { width: 2.4, height: 3.0 },
    reference: 'Post-1999 Pelli master plan guidance: buff brick with limestone base and bands, larger punched windows with metal sunshades, flat roofs behind parapets (EER, Rowling, HDB-era campus buildings).',
  },
  'master-plan-tile': {
    label: '1999 master-plan building with tile roof', era: '2000s-2010s',
    wall: 'buffBrick', wallColor: '#d4bb96', ground: 'limestone', groundColor: '#e0d3b8', base: 'limestone', baseColor: '#ddd0b5', baseHeight: 1.0,
    trim: 'limestone', trimColor: '#e4d8c0', roof: 'hip-tile', roofColor: '#b25a3b', roofSlope: 0.4, overhang: 0.9, brackets: false,
    parapet: 0, cornice: 0.35, belt: true, floor: 4.2, groundFloor: 4.8, sunshades: true,
    window: W(3.2, 1.9, 0.85, 3.0, { mullions: 2, transom: true }),
    groundWindow: W(3.2, 2.2, 0.5, 3.8, { type: 'glazed', mullions: 2, transom: true }), door: { width: 2.4, height: 3.0 },
    reference: 'Master-plan buildings that reuse the red tile roof (AT&T Center, Blanton, Seay): buff brick, limestone, tile hipped roofs without heavy brackets.',
  },
  'modernist-lab': {
    label: '1960s-80s brick/precast teaching and lab building', era: '1960s-1980s',
    wall: 'buffBrick', wallColor: '#c8aa86', ground: 'buffBrick', groundColor: '#c8aa86', base: 'precast', baseColor: '#d3cdbf', baseHeight: 0.6,
    trim: 'precast', trimColor: '#d6d0c2', roof: 'flat', roofColor: '#c4c1ba', roofSlope: 0, overhang: 0, brackets: false,
    parapet: 0.9, cornice: 0.5, belt: false, floor: 4.0, groundFloor: 4.4,
    window: W(1.8, 1.62, 1.0, 2.6, { type: 'ribbon', mullions: 0 }),
    groundWindow: W(3.6, 1.8, 0.9, 3.0, { mullions: 1 }), door: { width: 2.4, height: 2.7 },
    reference: 'Late-modern UT labs and classroom blocks (Burdine, CPE, ETC, Sanchez, PMA/former RLM): tan brick piers or spandrels with precast bands and horizontal window strips, flat roofs with mechanical penthouses.',
  },
  'brutalist-precast': {
    label: '1970s precast/concrete', era: '1960s-1980s',
    wall: 'precast', wallColor: '#d0cabd', ground: 'precast', groundColor: '#cbc5b8', base: 'precast', baseColor: '#c7c1b4', baseHeight: 0.5,
    trim: 'precast', trimColor: '#d6d0c2', roof: 'flat', roofColor: '#c4c1ba', roofSlope: 0, overhang: 0, brackets: false,
    parapet: 1.2, cornice: 0.6, belt: false, floor: 4.0, groundFloor: 4.6, deepReveal: true,
    window: W(1.6, 1.0, 0.9, 2.8, { mullions: 0 }),
    groundWindow: W(3.2, 2.4, 0.4, 3.6, { type: 'glazed', mullions: 2 }), door: { width: 2.4, height: 2.8 },
    reference: '1970s precast concrete buildings (Communication B, Harry Ransom Center, Performing Arts Center): deep-set narrow windows in heavy precast frames.',
  },
  'modernist-dorm': {
    label: 'Late-modern high-rise residence', era: '1960s-1970s',
    wall: 'buffBrick', wallColor: '#ccae88', ground: 'precast', groundColor: '#d2ccbf', base: 'precast', baseColor: '#c9c3b6', baseHeight: 0.6,
    trim: 'precast', trimColor: '#d6d0c2', roof: 'flat', roofColor: '#c4c1ba', roofSlope: 0, overhang: 0, brackets: false,
    parapet: 1.0, cornice: 0.5, belt: false, floor: 3.15, groundFloor: 4.2,
    window: W(2.4, 1.2, 0.85, 2.25, { mullions: 1 }),
    groundWindow: W(3.6, 2.4, 0.5, 3.4, { type: 'glazed', mullions: 2 }), door: { width: 2.4, height: 2.7 },
    reference: 'Jester Center / Dobie-era residence towers: buff brick and precast, repetitive small dorm windows, flat roofs.',
  },
  'stone-civic': {
    label: 'Limestone civic/museum building', era: '1930s-1960s',
    wall: 'limestone', wallColor: '#e1d6bf', ground: 'limestone', groundColor: '#dccfb6', base: 'limestone', baseColor: '#d5c8ae', baseHeight: 1.2,
    trim: 'limestone', trimColor: '#e8decb', roof: 'flat', roofColor: '#c6c3bc', roofSlope: 0, overhang: 0, brackets: false,
    parapet: 1.1, cornice: 0.7, belt: true, floor: 4.4, groundFloor: 5.0,
    window: W(3.4, 1.3, 1.0, 3.3, { transom: true, frame: 'bronze' }),
    groundWindow: W(3.4, 1.5, 1.0, 3.8, { transom: true, frame: 'bronze' }), door: { width: 2.4, height: 3.2 },
    reference: 'Art-Deco/stripped classical limestone buildings (Texas Memorial Museum, Hogg Auditorium) and limestone state buildings of the Capitol complex.',
  },
  'monolith-stone': {
    label: 'Travertine monolith', era: '1971',
    wall: 'limestone', wallColor: '#e3dbcb', ground: 'limestone', groundColor: '#ddd4c2', base: 'limestone', baseColor: '#d6ccb9', baseHeight: 0.8,
    trim: 'limestone', trimColor: '#e6ddcc', roof: 'flat', roofColor: '#c6c3bc', roofSlope: 0, overhang: 0, brackets: false,
    parapet: 1.0, cornice: 0.0, belt: false, floor: 4.6, groundFloor: 5.4,
    window: W(4.0, 0, 0, 0, { type: 'none', mullions: 0 }),
    groundWindow: W(4.5, 3.6, 0.3, 4.6, { type: 'glazed', mullions: 2 }), door: { width: 2.6, height: 3.2 },
    reference: 'LBJ Library and Sid Richardson Hall (Skidmore Owings & Merrill, 1971): near-windowless travertine walls with glazed ground storey.',
  },
  garage: {
    label: 'Parking garage', era: '1980s-2010s',
    wall: 'precast', wallColor: '#d2cdc1', ground: 'precast', groundColor: '#cdc8bb', base: 'precast', baseColor: '#c9c3b6', baseHeight: 0.3,
    trim: 'precast', trimColor: '#d6d0c2', roof: 'flat', roofColor: '#9c9a95', roofSlope: 0, overhang: 0, brackets: false,
    parapet: 1.1, cornice: 0.3, belt: false, floor: 3.3, groundFloor: 3.6,
    window: W(8.4, 7.8, 1.05, 2.9, { type: 'open', mullions: 0 }),
    groundWindow: W(8.4, 7.6, 1.0, 3.2, { type: 'open', mullions: 0 }), door: { width: 6.0, height: 2.6, vehicle: true },
    reference: 'UT garages (Speedway, San Jacinto, Brazos, Trinity, 27th St): precast spandrel bands with open, unglazed decks.',
  },
  athletic: {
    label: 'Athletics/recreation hall', era: '1970s-2020s',
    wall: 'precast', wallColor: '#d4cebf', ground: 'buffBrick', groundColor: '#c9ad89', base: 'precast', baseColor: '#cbc5b8', baseHeight: 0.5,
    trim: 'metal', trimColor: '#a7aaac', roof: 'flat', roofColor: '#bfbdb8', roofSlope: 0, overhang: 0, brackets: false,
    parapet: 0.8, cornice: 0.4, belt: false, floor: 5.0, groundFloor: 5.0,
    window: W(6.0, 3.6, 2.6, 4.4, { mullions: 2 }),
    groundWindow: W(6.0, 3.6, 0.6, 3.6, { type: 'glazed', mullions: 2 }), door: { width: 2.4, height: 2.8 },
    reference: 'Stadium/field support buildings, natatorium and training halls: large precast/brick volumes with sparse high glazing.',
  },
  arena: {
    label: 'Arena (metal and glass)', era: '2022',
    wall: 'metal', wallColor: '#b8bbbd', ground: 'limestone', groundColor: '#d8ccb4', base: 'limestone', baseColor: '#d2c6ae', baseHeight: 0.8,
    trim: 'metal', trimColor: '#c2c4c5', roof: 'flat', roofColor: '#c9c8c4', roofSlope: 0, overhang: 0, brackets: false,
    parapet: 1.0, cornice: 0.6, belt: false, floor: 6.0, groundFloor: 6.0,
    window: W(6.0, 0, 0, 0, { type: 'none', mullions: 0 }),
    groundWindow: W(3.0, 2.8, 0.3, 5.2, { type: 'glazed', mullions: 3, transom: true }), door: { width: 2.4, height: 3.0 },
    reference: 'Moody Center: metal-clad arena bowl over a glazed concourse.',
  },
  utility: {
    label: 'Service / facilities building', era: 'various',
    wall: 'precast', wallColor: '#cdc8bb', ground: 'precast', groundColor: '#cdc8bb', base: 'precast', baseColor: '#c4beb1', baseHeight: 0.3,
    trim: 'metal', trimColor: '#a9acad', roof: 'flat', roofColor: '#bdbbb6', roofSlope: 0, overhang: 0, brackets: false,
    parapet: 0.5, cornice: 0.2, belt: false, floor: 4.5, groundFloor: 4.5,
    window: W(6.0, 1.2, 1.2, 2.8, { mullions: 0 }),
    groundWindow: W(6.0, 1.2, 1.0, 2.4, { mullions: 0 }), door: { width: 1.0, height: 2.2 },
    reference: 'Storehouses, plant and facilities buildings: painted CMU/precast with few windows.',
  },
  'medical-modern': {
    label: 'Dell Medical District building', era: '2010s',
    wall: 'limestone', wallColor: '#ddd2bc', ground: 'limestone', groundColor: '#d8ccb4', base: 'limestone', baseColor: '#d2c6ae', baseHeight: 0.8,
    trim: 'metal', trimColor: '#9ea2a5', roof: 'flat', roofColor: '#c9c7c2', roofSlope: 0, overhang: 0, brackets: false,
    parapet: 1.0, cornice: 0.3, belt: false, floor: 4.3, groundFloor: 5.2, sunshades: true,
    window: W(1.6, 1.45, 0.8, 3.3, { mullions: 0 }),
    groundWindow: W(3.2, 3.0, 0.3, 4.3, { type: 'glazed', mullions: 2 }), door: { width: 2.4, height: 3.0 },
    reference: 'Dell Medical School buildings (Health Discovery/Learning, 2017): limestone-like panels with tall glazing and metal fins.',
  },
  'office-tower': {
    label: 'Downtown/West-downtown office or condo tower', era: '1970s-2020s',
    wall: 'precast', wallColor: '#c9c4b8', ground: 'limestone', groundColor: '#d6cab3', base: 'limestone', baseColor: '#cfc2aa', baseHeight: 0.6,
    trim: 'metal', trimColor: '#a3a6a8', roof: 'flat', roofColor: '#c4c2bd', roofSlope: 0, overhang: 0, brackets: false,
    parapet: 1.2, cornice: 0.4, belt: false, floor: 3.9, groundFloor: 5.0,
    window: W(1.5, 1.35, 0.75, 3.0, { mullions: 0 }),
    groundWindow: W(3.0, 2.8, 0.3, 4.2, { type: 'glazed', mullions: 2 }), door: { width: 2.4, height: 3.0 },
    reference: 'Generic Austin downtown tower envelope: precast/metal spandrels with continuous glazing.',
  },
  'state-office': {
    label: 'Capitol-complex state office building', era: '1950s-1990s',
    wall: 'limestone', wallColor: '#dbd1bf', ground: 'limestone', groundColor: '#cdbfae', base: 'limestone', baseColor: '#c2ae9f', baseHeight: 1.4,
    trim: 'limestone', trimColor: '#e2d9c8', roof: 'flat', roofColor: '#c6c3bc', roofSlope: 0, overhang: 0, brackets: false,
    parapet: 1.0, cornice: 0.4, belt: true, floor: 3.9, groundFloor: 4.6,
    window: W(1.8, 1.15, 0.9, 2.9, { mullions: 0, frame: 'bronze' }),
    groundWindow: W(3.6, 2.2, 0.6, 3.6, { type: 'glazed', mullions: 2, frame: 'bronze' }), door: { width: 2.4, height: 3.0 },
    reference: 'Mid-century state office buildings around the Capitol (Sam Houston, LBJ, Travis buildings): cream limestone or granite-faced grids of punched windows, flat roofs; pink-granite base tone nods to the Capitol\'s sunset red granite.',
  },
  'wc-tower': {
    label: 'West Campus high-rise student housing', era: '2005-2020s',
    wall: 'stucco', wallColor: '#dcd1bf', ground: 'brownBrick', groundColor: '#b99c7f', base: 'precast', baseColor: '#c6c0b3', baseHeight: 0.5,
    trim: 'precast', trimColor: '#e2ddd2', roof: 'flat', roofColor: '#cfcdc8', roofSlope: 0, overhang: 0, brackets: false,
    parapet: 1.1, cornice: 0.4, belt: true, floor: 3.15, groundFloor: 4.6,
    window: W(3.0, 1.5, 0.75, 2.35, { mullions: 1 }),
    groundWindow: W(3.0, 1.6, 0.9, 2.8, { mullions: 1 }), door: { width: 2.0, height: 2.6 },
    reference: 'Post-2004 University Neighborhood Overlay towers: stucco and fibre-cement panel upper storeys over a brick/masonry base, retail at Guadalupe/24th frontages.',
  },
  'wc-midrise': {
    label: 'West/North Campus mid-rise apartments', era: '1990s-2010s',
    wall: 'stucco', wallColor: '#d8cbb5', ground: 'brownBrick', groundColor: '#b89a7b', base: 'precast', baseColor: '#c6c0b3', baseHeight: 0.5,
    trim: 'precast', trimColor: '#e4dfd4', roof: 'flat', roofColor: '#cfcdc8', roofSlope: 0, overhang: 0, brackets: false,
    parapet: 1.0, cornice: 0.35, belt: true, floor: 3.15, groundFloor: 3.6,
    window: W(3.2, 1.4, 0.8, 2.35, { mullions: 1 }),
    groundWindow: W(3.2, 1.4, 0.8, 2.6, { mullions: 1 }), door: { width: 1.8, height: 2.4 },
    reference: '4-8 storey student apartments: stucco over brick base, punched windows, flat roofs.',
  },
  'apartment-lowrise': {
    label: '1960s-80s low-rise apartments', era: '1960s-1980s',
    wall: 'brownBrick', wallColor: '#b99d80', ground: 'brownBrick', groundColor: '#b99d80', base: 'precast', baseColor: '#bfb8aa', baseHeight: 0.3,
    trim: 'stucco', trimColor: '#e6e0d4', roof: 'hip-shingle', roofColor: '#77736d', roofSlope: 0.33, overhang: 0.6, brackets: false,
    parapet: 0, cornice: 0, belt: false, floor: 3.06, groundFloor: 3.06,
    window: W(3.4, 1.5, 0.9, 2.1, { mullions: 1, frame: 'light' }),
    groundWindow: W(3.4, 1.5, 0.9, 2.1, { mullions: 1, frame: 'light' }), door: { width: 0.95, height: 2.1 },
    reference: 'Two/three-storey brick and stucco garden apartments typical of North University and West Campus side streets.',
  },
  house: {
    label: 'Bungalow / small house', era: '1900s-1950s',
    wall: 'siding', wallColor: '#e6e0d3', ground: 'siding', groundColor: '#e6e0d3', base: 'limestone', baseColor: '#bfb4a2', baseHeight: 0.6,
    trim: 'siding', trimColor: '#f2efe8', roof: 'hip-shingle', roofColor: '#6f6b66', roofSlope: 0.55, overhang: 0.55, brackets: false,
    parapet: 0, cornice: 0, belt: false, floor: 3.1, groundFloor: 3.2,
    window: W(3.0, 0.95, 0.8, 2.2, { mullions: 0, transom: true, frame: 'light' }),
    groundWindow: W(3.0, 0.95, 0.85, 2.3, { mullions: 0, transom: true, frame: 'light' }), door: { width: 0.95, height: 2.1 },
    reference: 'Hyde Park / North University / Judges Hill bungalows and four-squares: painted lap siding on a pier-and-beam limestone skirt, double-hung windows, hipped or gabled composition-shingle roofs.',
  },
  'historic-19c': {
    label: '19th-century masonry building', era: '1850s-1900s',
    wall: 'limestone', wallColor: '#d9ceb6', ground: 'limestone', groundColor: '#d4c8ae', base: 'limestone', baseColor: '#c9bca2', baseHeight: 0.9,
    trim: 'limestone', trimColor: '#e6dfcf', roof: 'hip-metal', roofColor: '#7c817f', roofSlope: 0.7, overhang: 0.5, brackets: true,
    parapet: 0, cornice: 0.3, belt: true, floor: 4.5, groundFloor: 4.8,
    window: W(3.0, 1.1, 0.8, 3.2, { mullions: 0, transom: true, frame: 'light' }),
    groundWindow: W(3.0, 1.1, 0.8, 3.4, { mullions: 0, transom: true, frame: 'light' }), door: { width: 1.6, height: 3.0 },
    reference: 'Pre-1900 stone/brick buildings (Littlefield Home, Arno Nowotny): tall narrow windows, steep metal or slate hipped roofs.',
  },
  'small-commercial': {
    label: 'Small commercial / retail', era: '1920s-2010s',
    wall: 'brownBrick', wallColor: '#c4a587', ground: 'brownBrick', groundColor: '#bfa083', base: 'precast', baseColor: '#bdb6a8', baseHeight: 0.4,
    trim: 'precast', trimColor: '#e0dacd', roof: 'flat', roofColor: '#c7c5c0', roofSlope: 0, overhang: 0, brackets: false,
    parapet: 1.0, cornice: 0.35, belt: false, floor: 4.0, groundFloor: 4.5, storefront: true,
    window: W(3.6, 1.5, 0.9, 2.8, { mullions: 1 }),
    groundWindow: W(3.6, 3.2, 0.45, 3.4, { type: 'glazed', mullions: 2, transom: true }), door: { width: 1.8, height: 2.4 },
    reference: 'One/two-storey retail and offices (Guadalupe "Drag", Lavaca, MLK): brick or stucco with storefront glazing and a parapet.',
  },
  shed: {
    label: 'Shed / kiosk / pump house', era: 'various',
    wall: 'metal', wallColor: '#c3c4c2', ground: 'metal', groundColor: '#c3c4c2', base: 'precast', baseColor: '#bdb7aa', baseHeight: 0.2,
    trim: 'metal', trimColor: '#b9bbba', roof: 'flat', roofColor: '#b7b5b0', roofSlope: 0, overhang: 0, brackets: false,
    parapet: 0.3, cornice: 0, belt: false, floor: 3.5, groundFloor: 3.5,
    window: W(4.0, 0, 0, 0, { type: 'none', mullions: 0 }),
    groundWindow: W(4.0, 0, 0, 0, { type: 'none', mullions: 0 }), door: { width: 1.0, height: 2.2 },
    reference: 'Small service structures.',
  },
};

// [archetype, basis, note, overrides?]. basis: 'known' = identity and general
// architecture known to the author; 'estimate' = named building, style guessed.
const K = 'known', E = 'estimate';
const KNOWN = {
  MAI: ['cret-core', K, 'Main Building & Tower (Cret, 1937); authored package owns it'],
  GAR: ['cret-core', K, 'Garrison Hall (Greene, LaRoche & Dahl 1926)'],
  WAG: ['cret-core', K, 'Waggener Hall (1931)'],
  GOL: ['cret-core', K, 'Goldsmith Hall (Cret, 1933)'],
  SUT: ['cret-core', K, 'Sutton Hall (Cass Gilbert, 1918): cream brick, terracotta, red tile'],
  HRH: ['cret-core', K, 'Rainey Hall (1942)'],
  MEZ: ['cret-core', K, 'Mezes Hall (1952), core idiom'],
  WCH: ['cret-core', K, 'Will C. Hogg Building (1933); authored package'],
  GEB: ['cret-core', E, 'Gebauer Building (Old Engineering, 1904); approximated with the core idiom'],
  PAI: ['cret-core', K, 'T.S. Painter Hall (Greene/Cret, 1933)'],
  BIO: ['cret-core', K, 'Biological Laboratories (Greene, 1924)'],
  GEA: ['cret-core', K, 'Gearing Hall (1933)'],
  GWB: ['cret-core', E, 'Gordon-White Building (1952), core idiom assumed'],
  HMA: ['stone-civic', K, 'Hogg Memorial Auditorium (Cret, 1933), limestone'],
  UNB: ['cret-core', K, 'Texas Union (1933); authored package'],
  WMB: ['cret-core', E, 'West Mall Office Building (1961); tile roof assumed'],
  GRE: ['cret-core', K, 'Gregory Gymnasium (1930)'],
  AHG: ['cret-core', K, 'Anna Hiss Gymnasium (1931)'],
  BAT: ['cret-core', K, 'Batts Hall'],
  LTD: ['cret-residence', K, 'Littlefield Residence Hall (1927)'],
  AND: ['cret-residence', K, 'Andrews Residence Hall (1936)'],
  CRD: ['cret-residence', K, 'Carothers Residence Hall (1937)'],
  KIN: ['cret-residence', K, 'Kinsolving Residence Hall (1958), buff brick with tile roofs'],
  RHD: ['cret-residence', K, 'Roberts Residence Hall (1936)'],
  PHD: ['cret-residence', K, 'Prather Residence Hall (1937)'],
  MHD: ['cret-residence', K, 'Moore-Hill Residence Hall (1956)'],
  SJH: ['cret-residence', K, 'San Jacinto Residence Hall (2000), master-plan revival of the core idiom'],
  ADH: ['cret-residence', K, 'Almetris Duren Residence Hall (2007)'],
  CRH: ['cret-residence', E, 'Creekside Residence Hall (1955)'],
  LFH: ['historic-19c', K, 'Littlefield Home (1893 Victorian mansion; red brick and stone, approximated)', { wallFamily: 'brownBrick', wallColor: '#a8735b' }],
  LCH: ['historic-19c', E, 'Littlefield Carriage House', { wallFamily: 'brownBrick', wallColor: '#a8735b' }],
  ANB: ['historic-19c', K, 'Arno Nowotny Building (1859 former State Asylum building)'],
  JHH: ['historic-19c', E, 'John W. Hargis Hall (former State School for the Blind campus)'],
  FDH: ['house', K, 'J. Frank Dobie House'],
  BWY: ['house', E, '2616 Wichita (former residence, offices)'],
  SW7: ['house', E, '2617 Speedway (small office in a former residence)'],
  FAC: ['stone-civic', K, 'Flawn Academic Center (1963), marble/limestone modernist'],
  TMM: ['stone-civic', K, 'Texas Science & Natural History Museum (Texas Memorial Museum, 1939), Art Deco limestone'],
  BMA: ['master-plan-tile', K, 'Blanton Museum (Kallmann McKinnell & Wood, 2006): limestone, tile roofs', { wallFamily: 'limestone', wallColor: '#ded3bd' }],
  BMS: ['master-plan-tile', K, 'Blanton Museum Smith Building (2006)', { wallFamily: 'limestone', wallColor: '#ded3bd' }],
  BMK: ['stone-civic', K, 'Ellsworth Kelly "Austin" (2018), white stone chapel', { wallColor: '#ece8df' }],
  LBJ: ['monolith-stone', K, 'LBJ Presidential Library (SOM, 1971), travertine'],
  SRH: ['monolith-stone', K, 'Sid Richardson Hall (SOM, 1971), travertine'],
  HRC: ['brutalist-precast', K, 'Harry Ransom Center (1972, 2003 renovation)'],
  CMB: ['brutalist-precast', K, 'Jesse H. Jones Communication Center B (1974)'],
  PAC: ['brutalist-precast', K, 'Performing Arts Center / Bass Concert Hall (1981)'],
  MRH: ['brutalist-precast', K, 'Butler School of Music building & Recital Hall (1970s)', { wallFamily: 'buffBrick', wallColor: '#c8a984' }],
  ART: ['modernist-lab', K, 'Art Building and Museum (1962)'],
  WIN: ['modernist-lab', K, 'F. Loren Winship Drama Building (1962)'],
  SZB: ['modernist-lab', K, 'George I. Sanchez Building (1975)'],
  BUR: ['modernist-lab', K, 'Burdine Hall (1970)'],
  PMA: ['modernist-lab', K, 'Physics, Math & Astronomy (former Robert Lee Moore Hall, 1972), 17-storey tower'],
  CPE: ['modernist-lab', K, 'Chemical & Petroleum Engineering (1987)'],
  ETC: ['modernist-lab', K, 'Engineering Teaching Center II (1984)'],
  PAT: ['modernist-lab', K, 'J.T. Patterson Labs (1983)'],
  JGB: ['modernist-lab', K, 'Jackson Geological Sciences Building (1967)'],
  EPS: ['modernist-lab', E, 'E.P. Schoch Building'],
  PHR: ['modernist-lab', E, 'Pharmacy Building'],
  CBA: ['modernist-lab', K, 'College of Business Administration (1962)'],
  TNH: ['modernist-lab', K, 'Townes Hall (law school, 1953)'],
  TCC: ['modernist-lab', E, 'Thompson Conference Center (1970)'],
  NUR: ['modernist-lab', E, 'School of Nursing (1974)'],
  SSB: ['modernist-lab', E, 'Student Services Building (1985)'],
  UPB: ['modernist-lab', E, 'University Police Building'],
  CDL: ['brutalist-precast', E, 'Collections Deposit Library'],
  UTX: ['master-plan-tile', E, 'Etter-Harbin Alumni Center (1965, 2001 renovation)'],
  JES: ['modernist-dorm', K, 'Beauford H. Jester Center (1969)'],
  JCD: ['modernist-dorm', K, 'Jester residence hall (1969)'],
  D21: ['modernist-dorm', K, 'Dobie Twenty21 (1972 private residence tower)', { wallFamily: 'precast', wallColor: '#d2cdc2' }],
  ATT: ['master-plan-tile', K, 'AT&T Executive Education & Conference Center (2008)'],
  RRH: ['master-plan', K, 'Robert B. Rowling Hall (2018)'],
  SEA: ['master-plan-tile', E, 'Seay Building (2002)'],
  DMC: ['master-plan', E, 'Dealey Center for New Media (recent Moody College building)'],
  EER: ['master-plan', K, 'Engineering Education & Research Center (2017)'],
  ACS: ['master-plan', K, 'Autry C. Stephens Engineering Discovery Building (2017)'],
  GLT: ['master-plan', K, 'Gary L. Thomas Energy Engineering Building (2022)'],
  POB: ['master-plan-tile', K, 'Peter O\'Donnell Jr. Building (ACES, 2000); authored package'],
  NHB: ['master-plan', K, 'Norman Hackerman Building (2010); authored package'],
  GDC: ['master-plan', K, 'Gates Dell Complex (2013); authored package'],
  WEL: ['modernist-lab', K, 'Welch Hall; authored package'],
  BRB: ['master-plan', K, 'Rapoport Building; authored package'],
  WCP: ['master-plan', K, 'William C. Powers Jr. SAC (2011); authored package'],
  PCL: ['brutalist-precast', K, 'Perry-Castaneda Library (1977); authored package'],
  RSC: ['athletic', K, 'Recreational Sports Center (1990)', { wallFamily: 'buffBrick', wallColor: '#c9ad89' }],
  GRS: ['shed', K, 'Gregory pool storage building'],
  GRC: ['shed', K, 'Gregory pool control building'],
  GRP: ['athletic', E, 'Gregory Aquatic Pool equipment building'],
  TCP: ['shed', E, 'Texas Cowboys Pavilion'],
  BSB: ['shed', E, 'Basketball support building'],
  LTH: ['modernist-lab', E, 'Laboratory Theater building'],
  BOT: ['utility', E, 'Biological greenhouse (glasshouse approximated as service building)'],
  MCA: ['arena', K, 'Moody Center arena (2022)'],
  MMS: ['athletic', K, 'Mike A. Myers Track & Soccer Stadium structures'],
  DFF: ['athletic', K, 'UFCU Disch-Falk Field structures', { wallFamily: 'buffBrick', wallColor: '#c3a283' }],
  SBS: ['athletic', K, 'McCombs Field (softball) structures'],
  TSC: ['athletic', K, 'Lee & Joe Jamail Texas Swimming Center (1977)'],
  TSP: ['shed', E, 'Texas Swimming Center pump house'],
  TTC: ['athletic', E, 'Texas Tennis Center'],
  FTC: ['athletic', K, 'Football Training Complex'],
  BBR: ['athletic', E, 'Basketball & Rowing training facility'],
  IPF: ['athletic', K, 'Indoor Practice Facility', { wallFamily: 'metal', wallColor: '#c4c6c6' }],
  CLK: ['shed', E, 'Caven Clark field support'],
  AF1: ['shed', E, 'Athletic fields pavilion'],
  AF2: ['shed', E, 'Athletic fields pavilion'],
  AFP: ['shed', E, 'Athletic fields pavilion'],
  HDB: ['medical-modern', K, 'Health Discovery Building (Dell Med, 2017)'],
  HLB: ['medical-modern', K, 'Health Learning Building (Dell Med, 2017)'],
  SMC: ['medical-modern', K, 'Dell Seton Medical Center (2017)'],
  SWG: ['garage', K, 'Speedway Garage'],
  SJG: ['garage', K, 'San Jacinto Garage'],
  TSG: ['garage', K, '27th Street Garage'],
  SAG: ['garage', K, 'San Antonio Garage'],
  BRG: ['garage', K, 'Brazos Garage'],
  TRG: ['garage', K, 'Trinity Garage'],
  GUG: ['garage', K, 'Guadalupe Garage'],
  MAG: ['garage', K, 'Manor Garage'],
  ECG: ['garage', K, 'East Campus Garage'],
  FDG: ['garage', K, 'J. Frank Dobie Garage'],
  GHA: ['apartment-lowrise', E, 'Graduate housing'], GHB: ['apartment-lowrise', E, 'Graduate housing'],
  GHC: ['apartment-lowrise', E, 'Graduate housing'], GHD: ['apartment-lowrise', E, 'Graduate housing'],
  GHE: ['apartment-lowrise', E, 'Graduate housing'], GHF: ['apartment-lowrise', E, 'Graduate housing'],
  CML: ['small-commercial', E, 'Child development center', { storefront: false }],
  LNA: ['small-commercial', E, 'Child development center', { storefront: false }],
  MSB: ['utility', E, 'Mail service building'],
  DEV: ['modernist-lab', E, 'Development Office Building'],
  UIL: ['modernist-lab', E, 'University Interscholastic League building'],
  UA9: ['modernist-lab', E, '2609 University Avenue office building'],
  KEY: ['utility', E, 'University Key building'],
  WWH: ['cret-residence', E, 'Walter Webb Hall'],
  CPC: ['shed', E, 'Field staff office'],
  G17: ['shed', K, 'Traffic kiosk'],
  LS1: ['shed', E, 'Landscape services storage'],
  E23: ['utility', E, 'Equipment storehouse #23 (footprint height looks implausible; LiDAR preferred)'],
  E24: ['utility', E, 'Equipment storehouse #24'], E26: ['utility', E, 'Equipment storehouse #26'],
  FC2: ['utility', E, 'Facilities complex'], FC3: ['utility', E, 'Facilities complex'], FC4: ['utility', E, 'Facilities complex'],
  FC5: ['utility', E, 'Facilities complex'], FC6: ['utility', E, 'Facilities complex'], FC7: ['utility', E, 'Facilities complex'],
  FC8: ['utility', E, 'Facilities complex'], FC9: ['utility', E, 'Custodial training facility'],
  NEZ: ['athletic', K, 'DKR North End Zone (stadium generator owns it)'],
  SEZ: ['athletic', K, 'DKR South End Zone (stadium generator owns it)'],
};

const area = r => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);

/** District from campus coordinates (x east, z south; metres from 24th/Speedway area origin). */
export function district(x, z) {
  if (x >= 970) return 'east-i35';
  if (z > 600) return x < -466 ? 'judges-hill' : x < 100 ? 'capitol' : 'medical';
  if (x < -466) return 'west-campus';
  if (z < -300) return 'north-university';
  return x > 10 ? 'east-campus' : 'core';
}

function districtDefault(d, h, a) {
  if (a < 35 || h < 3.2) return ['shed', 'tiny footprint or very low'];
  const small = a < 350 && h < 11;
  switch (d) {
    case 'core': return h < 6 ? ['utility', 'low campus service structure'] : ['master-plan', 'unnamed campus infill: master-plan default'];
    case 'east-campus': return h < 6 ? ['utility', 'low campus service structure'] : ['master-plan', 'unnamed east-campus building: master-plan default'];
    case 'north-university':
    case 'west-campus':
      if (small) return ['house', 'small residential footprint'];
      if (h < 11) return ['apartment-lowrise', 'low multi-family footprint'];
      if (h < 26) return ['wc-midrise', 'mid-rise student apartments'];
      return ['wc-tower', 'high-rise student housing'];
    case 'judges-hill':
      if (small) return ['house', 'Judges Hill / West Downtown house'];
      if (h < 14) return ['small-commercial', 'low office/retail'];
      return ['office-tower', 'West Downtown mid/high-rise'];
    case 'capitol':
      if (small) return ['house', 'historic house (offices) near the Capitol complex'];
      if (h < 12) return ['small-commercial', 'low commercial near the Capitol'];
      return h > 60 ? ['office-tower', 'downtown high-rise'] : ['state-office', 'Capitol-complex state office building'];
    case 'medical':
      if (small) return ['house', 'small house'];
      if (h < 12) return ['small-commercial', 'low commercial'];
      return ['medical-modern', 'medical district building'];
    case 'east-i35':
      if (small) return ['house', 'east-of-I-35 house'];
      if (h < 12) return ['apartment-lowrise', 'low multi-family'];
      return ['master-plan', 'campus building east of I-35'];
  }
  return ['master-plan', 'fallback'];
}

const buildings = {};
const counts = { known: 0, 'district-default': 0, estimate: 0 }, byArchetype = {}, massingStats = { measured: 0, conflict: 0, 'no-data': 0, missing: 0 };
for (const b of campus.buildings) {
  const a = area(b.rings[0]);
  const d = district(b.center[0], b.center[1]);
  const known = b.abbr ? KNOWN[b.abbr] : undefined;
  let archetype, basis, note, overrides;
  if (known) [archetype, basis, note, overrides] = known;
  else if (b.abbr) { [archetype, note] = districtDefault(d, b.h, a); basis = 'estimate'; note = `${b.name || b.abbr}: style not catalogued; ${note}`; }
  else { [archetype, note] = districtDefault(d, b.h, a); basis = 'district-default'; }
  // Very small named structures stay sheds whatever their parent complex is.
  if ((a < 35 || b.h < 3.2) && archetype !== 'shed') { archetype = 'shed'; note += '; reduced to shed (tiny footprint)'; }
  counts[basis]++;
  byArchetype[archetype] = (byArchetype[archetype] ?? 0) + 1;
  const entry = { abbr: b.abbr || undefined, archetype, basis, district: d, note, ...(overrides ? { overrides } : {}) };
  // LiDAR massing itself is read at runtime from roofs-lidar.json (lidar lane);
  // only its status is summarised here so the catalogue stays small.
  const m = lidar?.buildings?.[String(b.id)];
  if (m) massingStats[m.status] = (massingStats[m.status] ?? 0) + 1; else massingStats.missing++;
  buildings[b.id] = entry;
}

const catalog = {
  version: 1,
  generatedBy: 'tools/context/build-catalog.mjs',
  description: 'Architectural catalogue for campus.json footprints used by the generated context (lib/campus/context). Archetypes encode real UT/Austin building families; every building records basis: known (identity and architecture known), estimate (named, style guessed) or district-default (unnamed; assigned from district, footprint area and height). Colours/modules are reference-guided estimates, not measurements. Measured massing is applied at runtime from public/data/derived/roofs-lidar.json (2017 USGS 3DEP LiDAR) when present.',
  lidar: lidar ? { source: lidar.source, file: 'public/data/derived/roofs-lidar.json' } : null,
  districts: {
    core: 'x -466..10, z -300..600 (Tower, Cret core)', 'east-campus': 'x 10..970, z -300..600',
    'north-university': 'z < -300 (North University / North Campus)', 'west-campus': 'x < -466 (west of Guadalupe)',
    capitol: 'z > 600, x -466..100', 'judges-hill': 'z > 600, x < -466', medical: 'z > 600, x 100..970', 'east-i35': 'x >= 970',
  },
  stats: { buildings: campus.buildings.length, basis: counts, archetypes: byArchetype, massing: massingStats },
  archetypes: ARCHETYPES,
  buildings,
};
const text = JSON.stringify(catalog);
writeFileSync(resolve(root, 'public/data/building-catalog.json'), text + '\n');
console.log(JSON.stringify(catalog.stats), 'bytes', text.length);
