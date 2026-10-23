import * as THREE from 'three';
import { createContextMaterialSet, type ContextMaterialOptions } from './context/materials';
import { BELLMONT_NORTH as BN, bellmontNorthV } from './stadium-bellmont-north';

/** Context materials. Buildings use shipped CC0 PBR textures (see
 * context/materials.ts); the stadium keeps its procedural canvas textures,
 * drawn at boot from code and tinted per vertex. */

export function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export interface Painter {
  color: CanvasRenderingContext2D;
  height: CanvasRenderingContext2D;
  rough: CanvasRenderingContext2D;
  size: number;
}

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw Error('2D canvas is unavailable for local scenery textures');
  return ctx;
}

export function painter(size: number): Painter {
  return { color: canvas(size), height: canvas(size), rough: canvas(size), size };
}

/** Fill a rect on all three layers. Coordinates are 0..1 with v = 0 at the bottom. */
export function rect(p: Painter, u0: number, v0: number, u1: number, v1: number, color: string, height: number, roughness: number) {
  const s = p.size, x = u0 * s, y = (1 - v1) * s, w = (u1 - u0) * s, h = (v1 - v0) * s;
  p.color.fillStyle = color; p.color.fillRect(x, y, w, h);
  const g = Math.round(height * 255), r = Math.round(roughness * 255);
  p.height.fillStyle = `rgb(${g},${g},${g})`; p.height.fillRect(x, y, w, h);
  p.rough.fillStyle = `rgb(${r},${r},${r})`; p.rough.fillRect(x, y, w, h);
}

export function noise(p: Painter, seed: number, amount: number, grain = 1) {
  const random = seeded(seed), s = p.size;
  const image = p.color.getImageData(0, 0, s, s), d = image.data;
  for (let y = 0; y < s; y += grain) for (let x = 0; x < s; x += grain) {
    const n = (random() - 0.5) * amount;
    for (let yy = y; yy < Math.min(s, y + grain); yy++) for (let xx = x; xx < Math.min(s, x + grain); xx++) {
      const i = (yy * s + xx) * 4;
      d[i] = Math.max(0, Math.min(255, d[i] + n)); d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n)); d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
  }
  p.color.putImageData(image, 0, 0);
}

/** Tangent-space normal map from the height layer (OpenGL convention). */
function normalFromHeight(ctx: CanvasRenderingContext2D, size: number, strength: number) {
  const src = ctx.getImageData(0, 0, size, size).data;
  const out = canvas(size), image = out.createImageData(size, size), d = image.data;
  const h = (x: number, y: number) => src[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
    d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  out.putImageData(image, 0, 0);
  return out.canvas;
}

export function texturesFrom(p: Painter, renderer: THREE.WebGLRenderer, normalStrength: number) {
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const make = (source: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(source);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return {
    map: make(p.color.canvas, true),
    normalMap: make(normalFromHeight(p.height, p.size, normalStrength), false),
    roughnessMap: make(p.rough.canvas, false),
  };
}

export function glass(p: Painter, u0: number, v0: number, u1: number, v1: number, seed: number) {
  const s = p.size, x = u0 * s, y = (1 - v1) * s, w = (u1 - u0) * s, h = (v1 - v0) * s;
  const g = p.color.createLinearGradient(x, y, x + w * 0.4, y + h);
  const random = seeded(seed);
  const tone = 0.85 + random() * 0.3;
  g.addColorStop(0, `rgb(${Math.round(78 * tone)},${Math.round(94 * tone)},${Math.round(108 * tone)})`);
  g.addColorStop(0.55, `rgb(${Math.round(36 * tone)},${Math.round(44 * tone)},${Math.round(52 * tone)})`);
  g.addColorStop(1, `rgb(${Math.round(28 * tone)},${Math.round(32 * tone)},${Math.round(36 * tone)})`);
  p.color.fillStyle = g; p.color.fillRect(x, y, w, h);
  p.height.fillStyle = 'rgb(40,40,40)'; p.height.fillRect(x, y, w, h);
  p.rough.fillStyle = 'rgb(36,36,36)'; p.rough.fillRect(x, y, w, h);
}

/** Context architecture materials: CC0 PBR sets with the facade-opening
 * shader (lib/campus/context/materials.ts). Same entry point as before. */
export function createContextMaterials(renderer: THREE.WebGLRenderer, options: ContextMaterialOptions = {}) {
  return createContextMaterialSet(renderer, options);
}

/** Masonry coursing: 0.5 m courses of ~1.1 m units with a 1 px joint, toned per unit. */
function coursing(p: Painter, seed: number, rgb: [number, number, number], spread: number, v0: number, v1: number, courses: number, units: number) {
  const random = seeded(seed), ch = (v1 - v0) / courses;
  for (let r = 0; r < courses; r++) for (let c = -1; c < units; c++) {
    const u0 = (c + (r % 2) * 0.5) / units, k = (random() - 0.5) * spread;
    const shade = `rgb(${Math.round(rgb[0] + k)},${Math.round(rgb[1] + k * 0.9)},${Math.round(rgb[2] + k * 0.75)})`;
    rect(p, Math.max(0, u0 + 0.003), v0 + r * ch + 0.004, Math.min(1, u0 + 1 / units - 0.003), v0 + (r + 1) * ch, shade, 0.82, 0.92);
  }
}

/** Dark framed glazing: the shared glass gradient plus dark frame mullions/transom. */
function framedGlass(p: Painter, u0: number, v0: number, u1: number, v1: number, seed: number, mullions: number, transom: number | null) {
  glass(p, u0, v0, u1, v1, seed);
  const frame = '#3b3f42', fw = 0.007;
  rect(p, u0, v0, u1, v0 + fw, frame, 0.3, 0.5); rect(p, u0, v1 - fw, u1, v1, frame, 0.3, 0.5);
  rect(p, u0, v0, u0 + fw, v1, frame, 0.3, 0.5); rect(p, u1 - fw, v0, u1, v1, frame, 0.3, 0.5);
  for (let k = 1; k < mullions; k++) { const u = u0 + ((u1 - u0) * k) / mullions; rect(p, u - fw / 2, v0, u + fw / 2, v1, frame, 0.3, 0.5); }
  if (transom !== null) rect(p, u0, transom - fw / 2, u1, transom + fw / 2, frame, 0.3, 0.5);
}

/** DKR outer wall, east side and north end (2008-09 NEZ, east side): warm orange-buff brick with cream cast-stone bands
 * and caps and dark recessed bays, as in the official 2022 aerials (ref-ut-dji0226 north + east elevations,
 * ref-ut-pano0001) and the Dec 2025 Commons photograph (ref-commons-ajay-2025, same brick). Authored pattern, no photo
 * pixels. One tile = STADIUM_FACADE_TILE.stadiumFacade (9 m along x 12.5 m up): a brick pier with a cream cap, then a
 * recessed bay of three levels: dark openings / tinted glazing between cream spandrel bands and slim cream mullions. The
 * projecting square pier towers themselves are geometry (stadium-bowl.ts east/north piers). */
function stadiumFacade(p: Painter) {
  rect(p, 0, 0, 1, 1, '#b77f4e', 0.7, 0.95); // mortar
  coursing(p, 1001, [200, 140, 92], 14, 0, 1, 34, 6);
  const cream = '#e4dccb', dark = '#24282c', shade = '#7f5a3a';
  // Recessed bay (u 0.27..1): three levels of dark openings framed by cream bands.
  const levels: [number, number][] = [[0.07, 0.31], [0.37, 0.62], [0.68, 0.92]];
  for (const [v0, v1] of levels) {
    rect(p, 0.29, v0, 0.985, v1, dark, 0.1, 0.4);
    glass(p, 0.31, v0 + 0.03, 0.965, v1 - 0.02, 1003 + Math.round(v0 * 100));
    for (let k = 1; k < 4; k++) { const u = 0.29 + (0.695 * k) / 4; rect(p, u - 0.006, v0, u + 0.006, v1, cream, 0.8, 0.8); }
  }
  for (const v of [0.31, 0.62, 0.92]) { rect(p, 0.27, v, 1, v + 0.06, cream, 1, 0.85); rect(p, 0.27, v, 1, v + 0.008, '#b7ae9c', 0.9, 0.85); }
  rect(p, 0.27, 0.0, 0.29, 1, shade, 0.5, 0.95); // pier shade edge
  // Pier: brick with cream cap and base.
  rect(p, 0.02, 0.94, 0.25, 1, cream, 1, 0.85);
  rect(p, 0, 0, 1, 0.07, cream, 1, 0.85);
  rect(p, 0, 0.065, 1, 0.07, '#a79f8f', 0.9, 0.85);
  noise(p, 1002, 7, 2);
}

/** 2021 South End Zone exterior (ref-commons-ajay-2025: Dec 2025 photograph from the south; ref-ut-dji0226): warm brick
 * piers framing, per 12.5 m band, two open balcony / club levels (white soffits, glass balustrades, shaded interior) under
 * a level of large dark windows with white mullion grids, with cream cast-stone bands. Authored, no photo pixels.
 * One tile = STADIUM_FACADE_TILE.stadiumSezSouth (9 m x 12.5 m). */
function stadiumSezSouth(p: Painter) {
  rect(p, 0, 0, 1, 1, '#b77f4e', 0.7, 0.95);
  coursing(p, 1801, [202, 142, 94], 14, 0, 1, 34, 5);
  const cream = '#e6dfcf', white = '#f1efea';
  // Two balcony levels.
  for (const [v0, v1] of [[0.05, 0.32], [0.36, 0.63]] as [number, number][]) {
    rect(p, 0.17, v0, 0.98, v1, '#5d6266', 0.3, 0.8);                 // shaded interior
    rect(p, 0.17, v1 - 0.05, 0.98, v1, white, 1, 0.8);                 // white soffit / slab edge
    rect(p, 0.17, v0, 0.98, v0 + 0.1, '#a9b8bf', 0.55, 0.3);           // glass balustrade
    rect(p, 0.17, v0 + 0.1, 0.98, v0 + 0.11, white, 1, 0.6);
  }
  // Club level: large dark windows with white mullion grid.
  rect(p, 0.17, 0.67, 0.98, 0.93, '#1f2529', 0.2, 0.3);
  glass(p, 0.18, 0.68, 0.97, 0.92, 1803);
  for (let k = 1; k < 5; k++) { const u = 0.17 + (0.81 * k) / 5; rect(p, u - 0.005, 0.67, u + 0.005, 0.93, white, 1, 0.6); }
  rect(p, 0.17, 0.795, 0.98, 0.802, white, 1, 0.6);
  for (const v of [0.32, 0.63, 0.93]) rect(p, 0.15, v, 1, v + 0.04, cream, 1, 0.85);
  rect(p, 0, 0, 1, 0.05, cream, 1, 0.85);
  rect(p, 0.15, 0, 0.17, 1, '#7f5a3a', 0.5, 0.95);
  noise(p, 1802, 7, 2);
}

/** SEZ field club seats inside the longhorn outline (ref-ut-pano0009 / ref-ut-dji0226: dark slate chairbacks). */
function stadiumClubSeats(p: Painter) {
  rect(p, 0, 0, 1, 1, '#3d4650', 0.6, 0.7);
  rect(p, 0.08, 0.38, 0.92, 0.9, '#4a5561', 1, 0.5);
  rect(p, 0.08, 0.38, 0.92, 0.46, '#2c333a', 0.9, 0.6);
  noise(p, 1901, 8, 1);
}

/** Burnt-orange terrace fascia / frames of the 2021 SEZ (longhorn outline, flank-tower frames). */
function stadiumTerraceFascia(p: Painter) {
  rect(p, 0, 0, 1, 1, '#b4521c', 0.8, 0.6);
  rect(p, 0, 0.9, 1, 1, '#c8692e', 1, 0.55);
  noise(p, 1951, 5, 1);
}

/** DKR outer wall, west side and south end: pale coated concrete. The west is Bellmont Hall
 * (official history: pale coated piers; dkr-frontage-58 measured a 9.5 m bay); the 2021 south end
 * reads pale with dark glazing in the official 2022 aerials but is NOT detailed here (no reference
 * of its elevation). One tile = STADIUM_FACADE_TILE.stadiumFacadePale (9.5 m x 12.5 m): a deep pale
 * band, then one tall zone of dark framed glazing (dark frame transoms only, no pale floor edge, so
 * each band reads as one concourse level) between a wide pier and two slender fins. */
function stadiumFacadePale(p: Painter) {
  // West (Bellmont) / south: pale concrete. Per 9.5 m bay one near-full-height structural pier,
  // then an inset panel of dense vertical fins/sunshades over narrow dark windows, one broad
  // framed window band with a flat lintel per level, and the deep flat concourse band. Interpreted
  // from Street View observation (Bellmont, Feb 2022; no imagery used); proportions are estimates.
  rect(p, 0, 0, 1, 1, '#d8d5ce', 0.9, 0.88);
  // Broad horizontal framed window band and its flat lintel.
  rect(p, 0.17, 0.15, 0.97, 0.158, '#8e8b84', 0.5, 0.95);
  framedGlass(p, 0.17, 0.158, 0.97, 0.285, 1402, 6, null);
  rect(p, 0.17, 0.285, 0.97, 0.315, '#e4e1da', 1, 0.85);
  rect(p, 0.17, 0.309, 0.97, 0.315, '#a9a69f', 0.9, 0.9);
  // Inset fin panel: narrow dark windows behind closely spaced pale fins.
  rect(p, 0.17, 0.315, 0.97, 0.95, '#3f4447', 0.35, 0.6);
  for (let k = 0; k < 13; k++) {
    const u0 = 0.17 + k * (0.8 / 13) + 0.004, u1 = u0 + 0.8 / 13 * 0.46;
    rect(p, u0, 0.315, u1, 0.95, '#dedbd4', 0.95, 0.85);
    rect(p, u1 - 0.007, 0.315, u1, 0.95, '#a5a29b', 0.9, 0.9);
  }
  rect(p, 0.17, 0.94, 0.97, 0.95, '#bdbab3', 0.9, 0.88);
  // Near-full-height structural pier (lit face + shade edge) and a narrow return at the bay edge.
  rect(p, 0, 0.12, 0.17, 0.985, '#e2dfd8', 1, 0.85);
  rect(p, 0.152, 0.12, 0.17, 0.985, '#a9a69f', 0.9, 0.9);
  rect(p, 0.97, 0.12, 1, 0.985, '#d4d1ca', 0.95, 0.86);
  // Deep flat concourse band and soffit shadow.
  rect(p, 0, 0, 1, 0.14, '#e6e3dc', 1, 0.85);
  rect(p, 0, 0.128, 1, 0.14, '#efece6', 1, 0.8);
  rect(p, 0, 0, 1, 0.01, '#bab7af', 0.95, 0.85);
  rect(p, 0, 0.975, 1, 1, '#76736d', 0.45, 0.95);
  noise(p, 1404, 6, 2);
}

/** Bellmont north outer wall (stadium-bellmont-north.ts for the measured values). One tile = one
 * 10.6 m bay across and the whole wall height vertically (V = absolute campus Y from BN.yBottom to
 * BN.yTop, clamped), so the floors stay where priority-07 shows them: a tall pale pier, then stacked
 * continuous dark ribbon windows on pale spandrels up to the block top and its coping. Above the top,
 * the set-back upper-deck rear as a CLOSED shaded wall: a pale deck-edge beam over a soffit shadow
 * line and one pale support post per bay (painted framing only, no openings). */
function stadiumFacadeBellmontNorth(p: Painter) {
  const v = bellmontNorthV, top = BN.blockTop, pier = BN.pier;
  rect(p, 0, 0, 1, 1, '#d6d3cc', 0.9, 0.88); // spandrels
  for (let c = top - BN.firstRibbonBelowTop; c - BN.ribbonHeight / 2 > BN.yBottom; c -= BN.ribbonPitch) {
    const lo = c - BN.ribbonHeight / 2, hi = c + BN.ribbonHeight / 2;
    rect(p, pier, v(lo - 0.12), 1, v(lo), '#a7a49d', 0.75, 0.92); // sill shade
    // Glazing with metric frames (the atlas is 64 m tall, so framedGlass' fractional frames would be 0.45 m).
    glass(p, pier, v(lo), 1, v(hi), 1501 + Math.round(c * 10));
    rect(p, pier, v(lo), 1, v(lo + 0.06), '#3b3f42', 0.3, 0.5); rect(p, pier, v(hi - 0.06), 1, v(hi), '#3b3f42', 0.3, 0.5);
    for (let k = 1; k < 7; k++) { const u = pier + ((1 - pier) * k) / 7; rect(p, u - 0.003, v(lo), u + 0.003, v(hi), '#3b3f42', 0.3, 0.5); }
    rect(p, pier, v(hi), 1, v(hi + 0.1), '#e2dfd8', 1, 0.85); // lintel edge
  }
  rect(p, pier, v(top - 0.6), 1, v(top), '#e6e3dc', 1, 0.85); // coping
  // Set-back upper-deck rear (closed wall in shade), soffit shadow, deck-edge beam, posts.
  const [b0, b1] = BN.beam;
  rect(p, 0, v(top), 1, v(b0 - 0.4), '#8e8c87', 0.35, 0.92);
  rect(p, 0, v(b0 - 0.4), 1, v(b0), '#5a5954', 0.3, 0.95);
  rect(p, 0, v(b0), 1, v(b1), '#d8d5ce', 0.95, 0.86);
  rect(p, 0, v(b0), 1, v(b0 + 0.12), '#b1aea7', 0.9, 0.88);
  rect(p, 0, v(b1), 1, 1, '#7d7b77', 0.35, 0.92);
  rect(p, 0.02, v(b1), 0.08, 1, '#cdcac3', 0.9, 0.86);
  rect(p, 0.07, v(b1), 0.08, 1, '#9e9b95', 0.8, 0.9);
  // Tall pier (lit face + shade edge) rising to the coping.
  rect(p, 0, 0, pier, v(top + 0.3), '#e2dfd8', 1, 0.85);
  rect(p, pier - 0.015, 0, pier, v(top + 0.3), '#a9a69f', 0.9, 0.9);
  noise(p, 1502, 6, 2);
}

/** DKR seating palette measured from the aligned west-stand photogrammetry through each captured
 * face's own source-photo UVs (tools/scans/stand-palette-uv.mjs on the source-UV build; the earlier
 * orthographic re-bake mixed in other layers' photos): sunlit seat median sRGB (132,134,133) / 0.87
 * (lit-to-albedo ratio of sunlit limestone in this renderer) -> base #989a99; grey aluminium bench
 * rows, warm/orange pixels are 0.3 % of the captured seats. */
function stadiumSeats(p: Painter) {
  rect(p, 0, 0, 1, 1, '#989a99', 0.6, 0.95);
  rect(p, 0.08, 0.38, 0.92, 0.9, '#a1a3a2', 1, 0.55);
  rect(p, 0.08, 0.38, 0.92, 0.46, '#7f8180', 0.9, 0.6);
  rect(p, 0.12, 0.2, 0.88, 0.38, '#8b8d8c', 0.85, 0.7);
  noise(p, 1101, 10, 1);
}

/** DKR concrete (risers, rim, coping, press box): field-facing captured fascia median through
 * source-photo UVs (181,172,163) / 0.87 -> #d0c6bb (warm pale concrete). */
function stadiumConcrete(p: Painter) {
  rect(p, 0, 0, 1, 1, '#d0c6bb', 0.9, 0.92);
  for (let k = 0; k < 2; k++) rect(p, k / 2, 0, k / 2 + 0.006, 1, '#c2b8ad', 0.75, 0.94);
  noise(p, 1301, 9, 2);
}

function stadiumSuites(p: Painter) {
  rect(p, 0, 0, 1, 1, '#d8d5ce', 0.9, 0.9);
  glass(p, 0.03, 0.18, 0.97, 0.88, 1201);
  for (const u of [0.03, 0.5, 0.97]) rect(p, u - 0.01, 0.18, u + 0.01, 0.88, '#9da1a3', 0.7, 0.4);
  rect(p, 0, 0.5, 1, 0.51, '#9da1a3', 0.7, 0.4);
}

/** 2021 SEZ corner towers (ref-ut-dkr2, ref-ut-dji0226: white-framed premium levels with glass
 * balustrades between the board and the east/west stands). One tile = one 4 m level x 4 m: a deep
 * white slab edge, a recessed dark glazed storey behind a pale glass rail, white frame posts at the
 * tile edges. Authored pattern (no photo pixels); proportions are estimates. */
function stadiumSezTower(p: Painter) {
  rect(p, 0, 0, 1, 1, '#2c3338', 0.3, 0.35);
  glass(p, 0.04, 0.2, 0.96, 0.92, 1601);
  rect(p, 0, 0.2, 1, 0.46, '#9fb0b8', 0.55, 0.3); // glass balustrade catching the sky
  rect(p, 0, 0.45, 1, 0.47, '#e9e7e2', 1, 0.6);   // rail cap
  rect(p, 0, 0, 1, 0.2, '#efede8', 1, 0.82);      // white slab edge
  rect(p, 0, 0.19, 1, 0.2, '#b9b6af', 0.9, 0.85);
  rect(p, 0, 0.92, 1, 1, '#5a5f62', 0.4, 0.8);    // soffit shade under the next slab
  rect(p, 0, 0.2, 0.05, 0.92, '#ecebe6', 1, 0.8); rect(p, 0.95, 0.2, 1, 0.92, '#ecebe6', 1, 0.8);
  noise(p, 1602, 5, 2);
}

/** East outer-wall pier towers: plain buff brick coursing (the stadiumFacade palette, no openings). */
function stadiumBrick(p: Painter) {
  rect(p, 0, 0, 1, 1, '#b77f4e', 0.7, 0.95);
  coursing(p, 1701, [200, 140, 92], 14, 0, 1, 17, 4);
  noise(p, 1702, 7, 2);
}

function fieldCanvas() {
  // u: sideline to sideline (71 m plate), v: end line to end line (126 m plate).
  const w = 512, h = 1024, ctx = canvas(w);
  ctx.canvas.height = h;
  const halfW = 35.5, halfL = 63, px = (m: number) => ((m + halfW) / (2 * halfW)) * w, pz = (m: number) => ((m + halfL) / (2 * halfL)) * h;
  ctx.fillStyle = '#3f6b33'; ctx.fillRect(0, 0, w, h);
  const yard = 0.9144, play = 26.67 * yard, end = 60 * yard;
  for (let k = -12; k < 12; k++) {
    ctx.fillStyle = k % 2 ? '#4a7a3b' : '#43723a';
    ctx.fillRect(px(-play), pz(k * 5 * yard), px(play) - px(-play), pz((k + 1) * 5 * yard) - pz(k * 5 * yard));
  }
  ctx.fillStyle = '#bf5700';
  ctx.fillRect(px(-play), pz(-end), px(play) - px(-play), pz(-50 * yard) - pz(-end));
  ctx.fillRect(px(-play), pz(50 * yard), px(play) - px(-play), pz(end) - pz(50 * yard));
  ctx.fillStyle = '#f4f2ea';
  for (let y = -50; y <= 50; y += 5) ctx.fillRect(px(-play), pz(y * yard) - 1.5, px(play) - px(-play), 3);
  for (let y = -50; y < 50; y += 1) for (const x of [-play + 0.6, -6.2 * yard, 6.2 * yard - 0.6, play - 1.2])
    ctx.fillRect(px(x), pz(y * yard) - 0.75, px(x + 0.6) - px(x), 1.5);
  ctx.strokeStyle = '#f4f2ea'; ctx.lineWidth = 3;
  ctx.strokeRect(px(-play), pz(-end), px(play) - px(-play), pz(end) - pz(-end));
  ctx.font = 'bold 44px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const [y, rot] of [[-55 * yard, Math.PI], [55 * yard, 0]] as const) {
    ctx.save(); ctx.translate(w / 2, pz(y)); ctx.rotate(rot); ctx.fillText('TEXAS', 0, 0); ctx.restore();
  }
  ctx.fillStyle = '#bf5700'; ctx.beginPath(); ctx.arc(w / 2, h / 2, 26, 0, Math.PI * 2); ctx.fill();
  return ctx.canvas;
}

export function createStadiumMaterials(renderer: THREE.WebGLRenderer) {
  const materials = new Map<string, THREE.MeshStandardMaterial>(), textures: THREE.Texture[] = [];
  const add = (key: string, draw: (p: Painter) => void, size: number, normal: number, clampV = false) => {
    const p = painter(size); draw(p);
    const t = texturesFrom(p, renderer, normal);
    if (clampV) for (const x of [t.map, t.normalMap, t.roughnessMap]) x.wrapT = THREE.ClampToEdgeWrapping;
    textures.push(t.map, t.normalMap, t.roughnessMap);
    const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 1, metalness: 0 });
    m.name = `Local context ${key}`;
    materials.set(key, m);
  };
  add('stadiumFacade', stadiumFacade, 256, 3);
  add('stadiumFacadePale', stadiumFacadePale, 256, 3);
  // Bellmont north only (absolute-height atlas, clamped vertically; ~16 px per metre up).
  add(BN.key, stadiumFacadeBellmontNorth, 1024, 3, true);
  add('stadiumSeat', stadiumSeats, 128, 2);
  add('stadiumSuite', stadiumSuites, 128, 1.5);
  add('stadiumSezTower', stadiumSezTower, 128, 1.5);
  add('stadiumBrick', stadiumBrick, 128, 2);
  add('stadiumSezSouth', stadiumSezSouth, 256, 3);
  add('stadiumClubSeat', stadiumClubSeats, 64, 1);
  add('stadiumTerraceFascia', stadiumTerraceFascia, 64, 1);
  add('stadiumRiser', stadiumConcrete, 128, 1.5);
  // Stadium rim/coping (previously shared with the building trim material).
  add('trim', stadiumConcrete, 128, 1.5);
  const turf = new THREE.CanvasTexture(fieldCanvas());
  turf.colorSpace = THREE.SRGBColorSpace;
  turf.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  textures.push(turf);
  const field = new THREE.MeshStandardMaterial({ map: turf, roughness: 0.95, metalness: 0 });
  field.name = 'Local context stadiumField';
  materials.set('stadiumField', field);
  return { materials, textures };
}
