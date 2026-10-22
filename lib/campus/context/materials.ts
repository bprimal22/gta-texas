import * as THREE from 'three';
import type { WallFamily, RoofFamily } from './catalog';

/** Materials for the generated context: CC0 Poly Haven PBR sets shipped in
 * public/assets/materials/context (see sources.json there), tinted per
 * building through vertex colour. Material colour is the inverse of each
 * texture's mean colour, so a vertex colour equals the rendered average
 * facade colour taken from the building catalogue.
 *
 * Wall materials carry the facade-opening shader: openings described by the
 * aFac/aWin/aRange attributes are drawn as glass with frames and painted
 * stone surrounds far away, and are discarded (so the recessed detail geometry
 * shows) within `contextUniforms.uCtxDetailRadius` of the camera. */

export const contextUniforms = { uCtxDetailRadius: { value: 0 }, uCtxEye: { value: new THREE.Vector3() } };
/** Openings on storeys above this index (0 = ground) are never replaced by
 * geometry: they stay shader-drawn, which keeps near detail bounded on towers. */
export const MAX_DETAIL_FLOOR = 5;

/** Real-world tile size (m) per texture, its mean encoded sRGB colour (sources.json) and its mean LINEAR albedo
 * (tools/context/linear-means.mjs: per-pixel sRGB decode, then average). The material gain uses the linear mean;
 * decoding the encoded average instead biased walls 3–18 % bright (appearance-audit/REPORT.md §5). */
export const TEXTURES: Record<WallFamily | RoofFamily, { tile: number; mean: [number, number, number]; linearMean: [number, number, number]; normal: number }> = {
  buffBrick: { tile: 1.6, mean: [150, 124, 102], linearMean: [0.31511, 0.21281, 0.14153], normal: 1 },
  brownBrick: { tile: 2.0, mean: [164, 137, 107], linearMean: [0.40217, 0.27688, 0.17404], normal: 1 },
  limestone: { tile: 3.0, mean: [165, 146, 116], linearMean: [0.37763, 0.28873, 0.17665], normal: 0.7 },
  precast: { tile: 2.7, mean: [140, 133, 111], linearMean: [0.26622, 0.23713, 0.16189], normal: 0.6 },
  stucco: { tile: 3.0, mean: [157, 140, 120], linearMean: [0.34047, 0.26227, 0.18788], normal: 0.6 },
  siding: { tile: 2.6, mean: [180, 166, 157], linearMean: [0.46145, 0.3849, 0.34016], normal: 1 },
  metal: { tile: 2.0, mean: [112, 114, 115], linearMean: [0.16515, 0.17019, 0.17201], normal: 0.8 },
  clayTile: { tile: 2.8, mean: [145, 79, 43], linearMean: [0.30974, 0.08655, 0.02723], normal: 1.2 },
  shingle: { tile: 3.0, mean: [79, 79, 77], linearMean: [0.08502, 0.08427, 0.08005], normal: 1 },
  membrane: { tile: 4.0, mean: [122, 112, 94], linearMean: [0.19875, 0.16599, 0.11601], normal: 0.5 },
};
export const WALL_FAMILIES: WallFamily[] = ['buffBrick', 'brownBrick', 'limestone', 'precast', 'stucco', 'siding', 'metal'];
export const ROOF_FAMILIES: RoofFamily[] = ['clayTile', 'shingle', 'membrane'];

const FACADE_VERTEX_PARS = /* glsl */`
attribute vec4 aFac;
attribute vec4 aWin;
attribute vec2 aRange;
varying vec4 vCtxFac;
varying vec4 vCtxWin;
varying vec2 vCtxRange;
varying vec3 vCtxWorld;
`;
const FACADE_VERTEX = /* glsl */`
vCtxFac = aFac; vCtxWin = aWin; vCtxRange = aRange;
vCtxWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;
const FACADE_FRAGMENT_PARS = /* glsl */`
uniform float uCtxDetailRadius;
uniform vec3 uCtxEye;
varying vec4 vCtxFac;
varying vec4 vCtxWin;
varying vec2 vCtxRange;
varying vec3 vCtxWorld;
float ctxHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;
/* Opening code: type + 8*mullions + 32*transom + 64*frame + 256*surround.
 * type 1 punched, 2 ribbon, 3 glazed storefront, 4 open (garage deck), 5 door. */
const FACADE_FRAGMENT = /* glsl */`
float ctxIn = 0.0;      // inside an opening
float ctxGlass = 0.0;   // reflective glass
float ctxFrameHit = 0.0;
if (vCtxWin.w > 0.5 && vCtxFac.z > 0.01 && vCtxFac.w > 0.01) {
  float code = floor(vCtxWin.w + 0.5);
  float ctxType = mod(code, 8.0);
  float mull = mod(floor(code / 8.0), 4.0);
  float transom = mod(floor(code / 32.0), 2.0);
  float frameK = mod(floor(code / 64.0), 4.0);
  float surround = mod(floor(code / 256.0), 2.0);
  float k = floor(vCtxFac.y);
  if (k >= vCtxRange.x - 0.5 && k <= vCtxRange.y + 0.5) {
    float wm = vCtxWin.x * vCtxFac.z;
    float xm = (fract(vCtxFac.x) - 0.5 + vCtxWin.x * 0.5) * vCtxFac.z;
    float hm = (vCtxWin.z - vCtxWin.y) * vCtxFac.w;
    float ym = (fract(vCtxFac.y) - vCtxWin.y) * vCtxFac.w;
    bool inside = xm >= 0.0 && xm <= wm && ym >= 0.0 && ym <= hm;
    if (inside) {
      ctxIn = 1.0;
      if (ctxType != 4.0 && k <= ${MAX_DETAIL_FLOOR.toFixed(1)} && distance(vCtxWorld, uCtxEye) < uCtxDetailRadius) discard;
      float fw = ctxType == 2.0 ? 0.04 : 0.055;
      float bar = (xm < fw || xm > wm - fw || ym < fw || ym > hm - fw) ? 1.0 : 0.0;
      for (int i = 1; i <= 3; i++) { if (float(i) <= mull && abs(xm - wm * float(i) / (mull + 1.0)) < fw * 0.5) bar = 1.0; }
      if (transom > 0.5 && hm > 1.2) {
        float ty = ctxType == 5.0 ? max(0.78, (hm - 0.5) / hm) : (frameK == 2.0 ? 0.5 : 0.72);
        if (abs(ym - hm * ty) < fw * 0.5) bar = 1.0;
      }
      vec3 frameCol = frameK == 2.0 ? vec3(0.78, 0.77, 0.74) : frameK == 1.0 ? vec3(0.09, 0.065, 0.045) : vec3(0.055, 0.06, 0.065);
      if (ctxType == 4.0) {
        // Open garage deck: shaded interior with the slab soffit above.
        diffuseColor.rgb = mix(vec3(0.035), vec3(0.07), smoothstep(0.0, hm, ym));
      } else if (ctxType == 5.0 && frameK == 2.0) {
        diffuseColor.rgb = bar > 0.5 ? frameCol : vec3(0.16, 0.1, 0.06);
        ctxFrameHit = 1.0;
      } else {
        // Glass: dark, with a head shadow and occasional pale blinds behind it.
        float cell = ctxHash(vec2(floor(vCtxFac.x) + 0.37 * k, k + floor(vCtxWorld.x * 0.01)));
        vec3 glassCol = vec3(0.032, 0.038, 0.045);
        float blind = step(0.72, cell) * smoothstep(hm * (0.35 + 0.4 * fract(cell * 7.0)), hm, ym);
        glassCol = mix(glassCol, vec3(0.32, 0.30, 0.26), blind * 0.55);
        glassCol *= mix(1.0, 0.55, smoothstep(hm - 0.35, hm, ym));
        diffuseColor.rgb = bar > 0.5 ? frameCol : glassCol;
        ctxGlass = bar > 0.5 ? 0.0 : 1.0 - blind * 0.6;
        ctxFrameHit = bar;
      }
    } else if (surround > 0.5) {
      // Painted cast-stone lintel and sill around punched openings.
      bool lintel = ym > hm && ym < hm + 0.28 && xm > -0.12 && xm < wm + 0.12;
      bool sill = ym < 0.0 && ym > -0.09 && xm > -0.06 && xm < wm + 0.06;
      if (lintel || sill) diffuseColor.rgb = vec3(0.74, 0.68, 0.56);
    }
  }
}
`;

/** Shadow-map pass: openings replaced by recessed geometry let sunlight in. */
const FACADE_DEPTH_FRAGMENT = /* glsl */`
if (vCtxWin.w > 0.5 && vCtxFac.z > 0.01 && vCtxFac.w > 0.01 && uCtxDetailRadius > 0.0) {
  float code = floor(vCtxWin.w + 0.5);
  float k = floor(vCtxFac.y);
  if (mod(code, 8.0) != 4.0 && k <= ${MAX_DETAIL_FLOOR.toFixed(1)} && k >= vCtxRange.x - 0.5 && k <= vCtxRange.y + 0.5
      && distance(vCtxWorld, uCtxEye) < uCtxDetailRadius) {
    float wm = vCtxWin.x * vCtxFac.z;
    float xm = (fract(vCtxFac.x) - 0.5 + vCtxWin.x * 0.5) * vCtxFac.z;
    float hm = (vCtxWin.z - vCtxWin.y) * vCtxFac.w;
    float ym = (fract(vCtxFac.y) - vCtxWin.y) * vCtxFac.w;
    if (xm >= 0.0 && xm <= wm && ym >= 0.0 && ym <= hm) discard;
  }
}
`;

/** Depth material for wall meshes so shadows match the openings near the camera. */
export function facadeDepthMaterial() {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = shader => {
    shader.uniforms.uCtxDetailRadius = contextUniforms.uCtxDetailRadius;
    shader.uniforms.uCtxEye = contextUniforms.uCtxEye;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FACADE_VERTEX_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${FACADE_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FACADE_FRAGMENT_PARS}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FACADE_DEPTH_FRAGMENT}`);
  };
  m.customProgramCacheKey = () => 'utcontext-facade-depth-v1';
  m.name = 'Local context facade depth';
  return m;
}

/** Patch a MeshStandardMaterial with the facade-opening shader. */
export function applyFacadeShader(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uCtxDetailRadius = contextUniforms.uCtxDetailRadius;
    shader.uniforms.uCtxEye = contextUniforms.uCtxEye;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FACADE_VERTEX_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${FACADE_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FACADE_FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FACADE_FRAGMENT}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.07, ctxGlass);
metalnessFactor = mix(metalnessFactor, 0.3, ctxGlass);
roughnessFactor = mix(roughnessFactor, 0.45, ctxFrameHit);
metalnessFactor = mix(metalnessFactor, 0.4, ctxFrameHit * (1.0 - step(0.5, ctxGlass)));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, ctxIn));`);
  };
  material.customProgramCacheKey = () => 'utcontext-facade-v1';
}

/** Literal same-origin URLs (kept literal so the offline audit can verify asset closure). */
const URLS: Record<WallFamily | RoofFamily, [string, string, string]> = {
  buffBrick: ['/assets/materials/context/buffBrick-color.jpg', '/assets/materials/context/buffBrick-normal.jpg', '/assets/materials/context/buffBrick-rough.jpg'],
  brownBrick: ['/assets/materials/context/brownBrick-color.jpg', '/assets/materials/context/brownBrick-normal.jpg', '/assets/materials/context/brownBrick-rough.jpg'],
  limestone: ['/assets/materials/context/limestone-color.jpg', '/assets/materials/context/limestone-normal.jpg', '/assets/materials/context/limestone-rough.jpg'],
  precast: ['/assets/materials/context/precast-color.jpg', '/assets/materials/context/precast-normal.jpg', '/assets/materials/context/precast-rough.jpg'],
  stucco: ['/assets/materials/context/stucco-color.jpg', '/assets/materials/context/stucco-normal.jpg', '/assets/materials/context/stucco-rough.jpg'],
  siding: ['/assets/materials/context/siding-color.jpg', '/assets/materials/context/siding-normal.jpg', '/assets/materials/context/siding-rough.jpg'],
  metal: ['/assets/materials/context/metal-color.jpg', '/assets/materials/context/metal-normal.jpg', '/assets/materials/context/metal-rough.jpg'],
  clayTile: ['/assets/materials/context/clayTile-color.jpg', '/assets/materials/context/clayTile-normal.jpg', '/assets/materials/context/clayTile-rough.jpg'],
  shingle: ['/assets/materials/context/shingle-color.jpg', '/assets/materials/context/shingle-normal.jpg', '/assets/materials/context/shingle-rough.jpg'],
  membrane: ['/assets/materials/context/membrane-color.jpg', '/assets/materials/context/membrane-normal.jpg', '/assets/materials/context/membrane-rough.jpg'],
};

export interface ContextMaterialOptions {
  /** Shared campus glazing (e.g. createCampusGlazing('lowE') from campus-glass.ts) for the
   * recessed near-camera panes; a local dark reflective standard material is used otherwise. */
  glass?: THREE.Material;
}

export function createContextMaterialSet(renderer: THREE.WebGLRenderer, options: ContextMaterialOptions = {}) {
  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const materials = new Map<string, THREE.Material>(), textures: THREE.Texture[] = [];
  const load = (key: WallFamily | RoofFamily, map: 0 | 1 | 2, srgb: boolean, tile: number) => {
    const t = loader.load(URLS[key][map]);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / tile, 1 / tile);
    t.anisotropy = anisotropy;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    textures.push(t);
    return t;
  };
  const pbr = (family: WallFamily | RoofFamily) => {
    const spec = TEXTURES[family];
    const mean = spec.linearMean; // linear-light average of the decoded texture
    const m = new THREE.MeshStandardMaterial({
      map: load(family, 0, true, spec.tile), normalMap: load(family, 1, false, spec.tile),
      roughnessMap: load(family, 2, false, spec.tile), roughness: 1, metalness: family === 'metal' ? 0.25 : 0,
      vertexColors: true, color: new THREE.Color(1 / mean[0], 1 / mean[1], 1 / mean[2]),
      normalScale: new THREE.Vector2(spec.normal, spec.normal),
    });
    return m;
  };
  const depth = facadeDepthMaterial();
  for (const family of WALL_FAMILIES) {
    const m = pbr(family);
    applyFacadeShader(m);
    m.name = `Local context wall ${family}`;
    // Picked up by local-context.ts as mesh.customDepthMaterial.
    m.userData.facadeDepth = depth;
    materials.set(`wall:${family}`, m);
  }
  for (const family of ROOF_FAMILIES) {
    const m = pbr(family);
    m.name = `Local context roof ${family}`;
    materials.set(`roof:${family}`, m);
  }
  const glass = options.glass ?? new THREE.MeshStandardMaterial({ color: new THREE.Color('#0d1115'), roughness: 0.07, metalness: 0.3 });
  if (!options.glass) glass.name = 'Local context glass';
  materials.set('glass', glass);
  const frame = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.4 });
  frame.name = 'Local context frames';
  materials.set('frame', frame);
  // The shared facade depth material is not in `materials` (walls reference it
  // via userData/customDepthMaterial); the caller owns and disposes it once.
  return { materials, textures, depthMaterial: depth };
}
