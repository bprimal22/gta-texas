import * as THREE from 'three';
import type { FacadeKind } from './format';

/** Facade code per treatment (aFac.z). 0 = roof, 10 = solid crown/trim metal. */
export const FACADE_CODE: Record<FacadeKind | 'roof' | 'solid', number> = {
  roof: 0, curtain: 1, balcony: 2, punched: 3, ribbon: 4, historic: 5, garage: 6, banded: 7, whitegrid: 8, stone: 9, solid: 10, podium: 11,
};
/** Storey height (m) used by each treatment; with the tier height it fixes the floor rhythm. */
export const FLOOR_HEIGHT: Record<number, number> = { 0: 4, 1: 4.0, 2: 3.2, 3: 3.7, 4: 3.8, 5: 4.4, 6: 3.1, 7: 4.0, 8: 3.25, 9: 4.4, 10: 4, 11: 4.2 };

/** One shared material for every downtown building (walls, roofs, crowns, low-rise cornices) in every chunk.
 * Procedural, distance-filtered facades: slim dark mullions and shadow-box spandrels on curtain walls, slab edges and
 * balconies, punched windows with sills and shadowed heads, and heritage commercial fronts on the low-rise (storefront
 * glazing, bulkheads, transoms, sign band, pilasters, sash windows with sills/hoods, frieze and cornice, brick or ashlar
 * coursing). Periodic coverage is box-filtered over the pixel footprint (dtPulse; dtBand for single bands) and per-pane /
 * per-brick noise fades with distance, so the far skyline resolves to the average colour without shimmer.
 * Colours come from vertex attributes (wall `color`, glass `aGlass`; geometry.ts tierLook varies them per building);
 * aFac packs the per-building variant/seed and the tier top (geometry.ts packFacadeCode / packFloorHeight), decoded once
 * per vertex into a flat varying. Glass keeps the explicit envMap reflection, scaled/tinted per facade family. */
export function createFacadeMaterial(envMap: THREE.Texture | null) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .86, metalness: 0, envMap, envMapIntensity: .65 });
  m.name = 'Downtown facades';
  m.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aGlass;\nattribute vec4 aFac;\nvarying vec3 vDtGlass;\nvarying vec4 vDtFac;\nflat varying vec4 vDtInfo;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vDtGlass = aGlass;
vDtFac = aFac;
float dtCode = floor(aFac.z + .5);
float dtTop = floor(aFac.w / 16.);
vDtInfo = vec4((aFac.z - dtCode) / .8 + .5, dtTop * .25, aFac.w - dtTop * 16., dtCode);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vDtGlass;
varying vec4 vDtFac;
flat varying vec4 vDtInfo;
float dtGlassMask;
vec3 dtSpecTint;
float dtHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// 1 inside [a,b] of a periodic coordinate (period 1), anti-aliased by w.
float dtArea(float x, float a, float b){ return floor(x) * (b-a) + clamp(fract(x)-a, 0., b-a); }
float dtPulse(float x, float a, float b, float w){ w=max(w,1e-4); return clamp((dtArea(x+w*.5,a,b)-dtArea(x-w*.5,a,b))/w,0.,1.); }
// 1 inside the single interval [a,b] (not periodic), box-filtered over w.
float dtBand(float x, float a, float b, float w){ w=max(w,1e-4); return clamp((min(x+w*.5,b)-max(x-w*.5,a))/w,0.,1.); }
// Trim (sills, hoods, cornice, pilaster caps): cream stone on dark masonry, a darker tone of pale walls.
vec3 dtTrim(vec3 c, float r){ float l = dot(c, vec3(.2126, .7152, .0722)); return l > .3 ? c * (.68 + .1 * r) : mix(c, vec3(.5, .45, .36), .55 + .25 * r); }
`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float code = vDtInfo.w;
  float u = vDtFac.x, v = vDtFac.y, fh = max(vDtInfo.z, 2.);
  float top = vDtInfo.y > 1. ? vDtInfo.y : 1e4;
  float kind = floor(vDtInfo.x * 8.), rnd = fract(vDtInfo.x * 8.);
  vec2 fw = max(fwidth(vDtFac.xy), vec2(1e-4));
  float lod = clamp((max(fw.x, fw.y) - .08) / .55, 0., 1.);
  float fine = clamp((max(fw.x, fw.y) - .025) / .06, 0., 1.);
  float fy = v / fh, fi = floor(fy);
  float wv = fw.y / fh;
  float mask = 0., shade = 1.;
  vec3 wall = diffuseColor.rgb, glassC = vDtGlass;
  float spec = .85;
  if (code < .5) {                      // roof: membrane/gravel with faint panel seams
    float n = dtHash(floor(vec2(u, v) * .5));
    shade = mix(.94 + .08 * n, .98, lod); mask = 0.;   // panel noise fades with distance (no far shimmer)
  } else if (code > 9.5 && code < 10.5) { // solid trim / crown metal
    mask = 0.;
  } else {
    float bay = code == 2. ? 3.2 : code == 3. ? 1.9 : code == 5. ? 2.8 : code == 8. ? 2.8 : code == 9. ? 3.0 : code == 11. ? 8.4 : 1.5;
    if (code == 3. || code == 5.) bay *= .88 + .26 * rnd;
    float ux = u / bay, bi = floor(ux), wu = fw.x / bay;
    float h = mix(dtHash(vec2(bi + floor(rnd * 97.), fi)), .5, lod);
    vec3 trim = dtTrim(wall, rnd);
    if (code == 1.) {                   // unitized curtain wall: vision glass, shadow-box spandrel, slim dark mullions
      float mull = dtPulse(ux + .5, .485, .515, wu);
      float spand = dtPulse(fy, 0., .2, wv) * (1. - mull);
      float op = mull + .35 * spand;
      mask = 1. - op;
      wall *= (.5 * mull + .25 * spand) / max(op, 1e-3);
      glassC *= (.93 + .14 * h) * (1. - .25 * spand);
      spec = 1.;
    } else if (code == 7.) {            // banded glass: bright slab bands each floor, slim mullions
      float band = dtPulse(fy, 0., .2, wv);
      float mull = dtPulse(ux + .5, .49, .51, wu) * (1. - band);
      mask = 1. - band - mull;
      wall *= (band + .55 * mull) / max(band + mull, 1e-3);
      glassC *= .94 + .12 * h;
      spec = .95;
    } else if (code == 2.) {            // residential balconies: slab edge, glass rail, recessed glazing
      float slab = dtPulse(fy, 0., .085, wv);
      float rail = dtPulse(fy, .085, .33, wv);
      float pier = dtPulse(ux + .5, .47, .53, wu);
      mask = (1. - slab) * (1. - pier);
      shade = 1. - .32 * (1. - slab) * (1. - rail) * step(.35, h);
      glassC = mix(glassC * (.85 + .2 * h), glassC * 1.25 + .03, rail * .5);
      spec = .9;
    } else if (code == 8.) {            // white frame grid with staggered infill (Waterline / Independent): slimmer frame
      float frameV = dtPulse(ux + .5, .43, .57, wu);
      float frameH = dtPulse(fy, 0., .13, wv);
      float frame = 1. - (1. - frameV) * (1. - frameH);
      float solid = mix(step(.7, dtHash(vec2(bi, fi * 1.7 + 3.))), .3, lod) * (1. - frame);
      mask = 1. - frame - solid;
      wall *= (frame + .78 * solid) / max(frame + solid, 1e-3);   // infill panels a step greyer than the frame
      glassC *= .9 + .15 * h;
      spec = .95;
    } else if (code == 3. || code == 9.) { // punched windows in granite/precast/limestone/brick: sills, shadowed heads
      float wk = code == 9. ? 3. : mod(kind, 4.);
      float x0 = wk == 1. ? .3 : wk == 2. ? .12 : wk == 3. ? .33 : .19;
      float y0 = wk == 1. ? .2 : wk == 2. ? .34 : wk == 3. ? .18 : .3;
      float y1 = wk == 1. ? .84 : wk == 2. ? .78 : wk == 3. ? .86 : .8;
      float cap = dtBand(v, top - .8, top + 1., fw.y);
      float wx = dtPulse(ux, x0, 1. - x0, wu);
      float win = wx * dtPulse(fy, y0, y1, wv) * (1. - cap);
      float head = wx * dtPulse(fy, y1 - .07, y1, wv) * (1. - cap);
      float mull = win * dtPulse(ux, .49, .51, wu) * step(.25, .5 - x0);
      float sill = dtPulse(ux, x0 - .04, 1.04 - x0, wu) * dtPulse(fy, y0 - .05, y0, wv) * (1. - cap);
      vec3 c = wall * mix(.96 + .06 * dtHash(vec2(floor(u * 1.2), floor(v * 1.5))), .99, lod);
      if (kind > 3.5) {
        float crs = floor(v / .075);
        c *= mix(.92 + .16 * dtHash(vec2(floor(u / .23 + crs * .5), crs)), 1., fine) * (1. - .18 * dtPulse(v / .075, 0., .14, fw.y / .075));
      }
      c = mix(c, trim, max(sill, cap * .85));
      c *= 1. - .25 * dtBand(v, top - 1., top - .8, fw.y);
      float nonWin = 1. - win;
      mask = max(win - head - mull, 0.);
      wall = (c * nonWin + wall * .3 * head + wall * .4 * mull) / max(nonWin + head + mull, 1e-3);
      spec = .7;
    } else if (code == 4.) {            // ribbon windows: continuous glazing bands, slim mullions, sill line
      float rb = dtPulse(fy, .36, .8, wv);
      float mull = rb * dtPulse(ux + .5, .485, .515, wu);
      float sill = dtPulse(fy, .33, .36, wv);
      mask = rb - mull;
      vec3 c = mix(wall, trim, sill);
      if (kind > 3.5) c *= 1. - .16 * dtPulse(v / .075, 0., .14, fw.y / .075);
      wall = (c * (1. - rb) + wall * .45 * mull) / max(1. - rb + mull, 1e-3);
      spec = .8;
    } else if (code == 5.) {            // heritage commercial block (Congress Ave / E 6th St)
      float house = step(3.5, kind);
      float mtl = kind - 4. * house;    // 0 brick, 1 limestone ashlar, 2 stucco / painted, 3 painted brick
      float par = top < 6. ? .95 : 1.25;
      float sfH = min(3.9 + .8 * rnd, top - par);
      if (top - par - sfH < 2.6) sfH = top - par;
      sfH *= 1. - house;
      float base = max(sfH, .7 * house);
      float span = max(top - par - base, 0.);
      float fhU = max(span / max(1., floor(span / 3.7 + .5)), 1.);
      float yU = (v - base) / fhU, wvU = fw.y / fhU;
      float upZ = dtBand(v, base, top - par, fw.y);
      float sfZ = dtBand(v, -1., sfH, fw.y) * (1. - house);
      float lot = bay * (rnd < .5 ? 3. : 2.);
      float corn = dtBand(v, top - .75, top + 1., fw.y);
      float pil = dtPulse(u / lot + .04, 0., .08, fw.x / lot) * (1. - corn);
      // upper storeys: tall sash windows (meeting rail), stone sills and hoods
      float x0 = mtl == 1. ? .34 : .31;
      float wx = dtPulse(ux, x0, 1. - x0, wu);
      float sash = wx * dtPulse(yU, .2, .8, wvU) * upZ;
      float pane = dtPulse(ux, x0 + .03, .97 - x0, wu) * dtPulse(yU, .225, .775, wvU) * (1. - dtPulse(yU, .49, .515, wvU)) * upZ;
      float wide = dtPulse(ux, x0 - .05, 1.05 - x0, wu) * upZ;
      float sill = wide * dtPulse(yU, .15, .2, wvU);
      float hood = wide * dtPulse(yU, .8, .88, wvU);
      // storefront: bulkhead, display glass, transom bar and transom lights, sign band
      float signB = dtBand(v, sfH - .62, sfH, fw.y) * sfZ;
      float trans = dtBand(v, sfH - 1.3, sfH - .62, fw.y) * sfZ;
      float bar = dtBand(v, sfH - 1.38, sfH - 1.3, fw.y) * sfZ;
      float bulk = dtBand(v, -1., .5, fw.y) * sfZ;
      float sfMull = min(dtPulse(ux + .5, .485, .515, wu) + dtPulse(ux * 3. + .5, .47, .53, wu * 3.) * trans, 1.);
      float sfOp = sfZ * (1. - pil);
      float sfGlass = max(sfOp - signB - bar - bulk, 0.) * (1. - sfMull);
      // frieze (dentils) and the shadow under the cornice; the cornice geometry shares this band
      float shadowL = dtBand(v, top - .95, top - .75, fw.y);
      float dent = dtBand(v, top - par, top - .95, fw.y) * dtPulse(u / .42, 0., .45, fw.x / .42);
      float coping = dtBand(v, top - .1, top + 1., fw.y);
      vec3 c = wall;
      if (mtl == 0. || mtl == 3.) {      // running-bond brick: mortar courses, per-brick tone (fades before it can alias)
        float crs = floor(v / .075);
        c *= mix(.9 + .2 * dtHash(vec2(floor(u / .23 + crs * .5), crs)), 1., max(fine, mtl / 3.));
        c *= 1. - (mtl == 0. ? .2 : .07) * dtPulse(v / .075, 0., .14, fw.y / .075);
      } else if (mtl == 1.) {            // coursed limestone ashlar
        float ac = floor(v / .62);
        float joint = max(dtPulse(v / .62, 0., .04, fw.y / .62), dtPulse(u / 1.25 + .5 * ac, 0., .02, fw.x / 1.25));
        c *= mix(.95 + .1 * dtHash(vec2(floor(u / 1.25 + .5 * ac), ac)), 1., lod) * (1. - .14 * joint);
      } else {
        c *= mix(.97 + .06 * dtHash(vec2(floor(u / 2.), floor(v / 2.))), 1., lod);
      }
      c *= .86 + .14 * clamp(v / 2.2, 0., 1.);          // street grime at the base
      float acc = fract(rnd * 7.);
      vec3 frameC = fract(rnd * 3.) > .55 ? vec3(.022, .026, .024) : mix(trim, vec3(.5, .48, .42), .5);   // dark or cream paint
      vec3 signC = acc < .4 ? trim : acc < .7 ? c * .78 : mix(vec3(.12, .025, .02), vec3(.015, .06, .04), fract(rnd * 13.));
      vec3 pilC = mix(c, trim, .45) * 1.04;
      c = mix(c, trim, max(max(sill, hood), dent));
      c = mix(c, pilC, pil);
      c = mix(c, c * .5, shadowL);
      c = mix(c, trim, corn);
      c = mix(c, trim * 1.12, coping);
      c = mix(c, frameC, max(sash - pane, 0.));
      c = mix(c, frameC * .9, max(sfOp - signB - sfGlass, 0.));
      c = mix(c, signC, signB * (1. - pil));
      mask = pane + sfGlass;
      wall = c;   // glass coverage replaces its share in the final mix
      glassC = mix(glassC, mix(glassC, vec3(.07, .055, .04), .45), sfZ);  // warm, dim shop interiors
      glassC = mix(glassC, glassC * 1.5 + .02, trans);                       // transom lights read paler
      spec = mix(.5, .7, sfZ);
    } else if (code == 6. || code == 11.) { // garage / podium: horizontal openings between columns
      float col = dtPulse(ux + .5, .45, .55, wu);
      float open = dtPulse(fy, code == 6. ? .38 : .3, .86, wv) * (1. - col);
      mask = open * (code == 6. ? .25 : 1.);
      shade = 1. - (code == 6. ? .55 : .2) * open;
    }
    // Ground-floor storefronts on towers and mid-rises.
    if (v < 4.6 && code != 5. && code != 6. && code != 9.) {
      float sf = dtPulse(v / 4.6, .06, .86, fw.y / 4.6) * (1. - dtPulse(u / 3. + .5, .47, .53, fw.x / 3.));
      mask = max(mask, sf); shade = mix(shade, 1., sf);
      glassC = mix(glassC, vec3(.035, .045, .05), sf * .5);
      spec = mix(spec, .75, sf);
    }
  }
  // Periodic coverage filtering (dtPulse) keeps readable floor bands at range without aliasing.
  dtGlassMask = mask;
  vec3 dtT = glassC / max(max(glassC.r, max(glassC.g, glassC.b)), 1e-3);
  dtSpecTint = mix(vec3(1.), spec * mix(vec3(1.), dtT, .35), mask);
  diffuseColor.rgb = mix(wall * shade, glassC * .3, mask);
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .18, dtGlassMask);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, .04, dtGlassMask);')
      // Glass reflections: the envMap radiance, scaled per family (dark interiors behind punched/sash windows) and tinted by the glass.
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectSpecular *= dtSpecTint;');
  };
  m.customProgramCacheKey = () => 'downtown-facade-v3';
  return m;
}

/** Terrain ground shaded from the baked class map (nearest texels blended bilinearly per class, so 1 m class
 * edges read smooth): lawn/park (campus lawn texture), asphalt (campus asphalt finish), concrete (campus
 * concrete), warm plaza paving, decomposed-granite trail, footprint slab. Same textures as the campus ground. */
export function createGroundMaterial(options: { grass: THREE.MeshStandardMaterial; asphalt: THREE.MeshStandardMaterial; concrete: THREE.MeshStandardMaterial;
  classMap: Uint8Array; width: number; height: number; origin: [number, number]; res: number }) {
  const tex = new THREE.DataTexture(options.classMap, options.width, options.height, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
  tex.flipY = false; tex.needsUpdate = true;
  tex.name = 'Downtown ground classes (CoA 2023)';
  const m = new THREE.MeshStandardMaterial({ map: options.grass.map, color: options.grass.color.clone(), roughness: 1 });
  m.name = 'Downtown ground';
  const uniforms = {
    dtClass: { value: tex }, dtOrigin: { value: new THREE.Vector2(...options.origin) }, dtRes: { value: options.res },
    dtSize: { value: new THREE.Vector2(options.width, options.height) },
    dtAsphalt: { value: options.asphalt.map }, dtAsphaltTint: { value: options.asphalt.color.clone() },
    dtConcrete: { value: options.concrete.map }, dtConcreteTint: { value: options.concrete.color.clone() },
  };
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDtWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDtWorld = (modelMatrix * vec4(transformed, 1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vDtWorld;
uniform sampler2D dtClass; uniform vec2 dtOrigin; uniform float dtRes; uniform vec2 dtSize;
uniform sampler2D dtAsphalt; uniform vec3 dtAsphaltTint; uniform sampler2D dtConcrete; uniform vec3 dtConcreteTint;
float dtCls(ivec2 p){ p = clamp(p, ivec2(0), ivec2(dtSize) - 1); return floor(texelFetch(dtClass, p, 0).r * 255. + .5); }
`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec2 g = (vDtWorld.xz - dtOrigin) / dtRes - .5;
  ivec2 i0 = ivec2(floor(g)); vec2 f = fract(g);
  float c00 = dtCls(i0), c10 = dtCls(i0 + ivec2(1, 0)), c01 = dtCls(i0 + ivec2(0, 1)), c11 = dtCls(i0 + ivec2(1, 1));
  vec4 wq = vec4((1. - f.x) * (1. - f.y), f.x * (1. - f.y), (1. - f.x) * f.y, f.x * f.y);
  // Weight per class family: 0 lawn, 1 asphalt, 2 concrete-like, 3 trail.
  vec4 fam = vec4(0.);
  float cs[4]; cs[0] = c00; cs[1] = c10; cs[2] = c01; cs[3] = c11;
  vec3 concreteTint = vec3(0.); float concreteW = 0.;
  for (int k = 0; k < 4; k++) {
    float c = cs[k], w = wq[k];
    if (c == 0. || c == 6. || c == 5.) fam.x += w;
    else if (c == 1. || c == 8.) fam.y += w;
    else if (c == 4.) fam.w += w;
    else {
      fam.z += w;
      concreteTint += w * (c == 3. ? vec3(1.08, .98, .86) : c == 7. ? vec3(.82) : vec3(1.));
      concreteW += w;
    }
  }
  // Sharpen the 1 m bilinear blend into a crisp-but-smooth edge.
  vec4 s = smoothstep(.35, .65, fam); s /= max(dot(s, vec4(1.)), 1e-3);
  vec2 wuv = vDtWorld.xz / 3.;
  vec3 asphalt = texture2D(dtAsphalt, wuv).rgb * dtAsphaltTint;
  vec3 concrete = texture2D(dtConcrete, wuv).rgb * dtConcreteTint * (concreteW > 0. ? concreteTint / concreteW : vec3(1.));
  vec3 trail = texture2D(dtConcrete, wuv * .7).rgb * dtConcreteTint * vec3(1.02, .86, .64);
  diffuseColor.rgb = diffuseColor.rgb * s.x + asphalt * s.y + concrete * s.z + trail * s.w;
}`);
  };
  m.customProgramCacheKey = () => 'downtown-ground-v1';
  return { material: m, texture: tex };
}

/** Lady Bird Lake: static, opaque, slightly reflective green-grey water (no simulation). */
export function createWaterMaterial(envMap: THREE.Texture | null) {
  // Grazing views reflect the bright horizon sky (Fresnel -> 1): with low roughness that whitened the far lake
  // (root CUA review, river-west). Rougher, nearly dielectric, lower env intensity, and the indirect specular tinted
  // toward the water colour so distant water stays a muted green-blue.
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(.05, .085, .08), roughness: .34, metalness: .02, envMap, envMapIntensity: .4 });
  m.name = 'Lady Bird Lake water';
  m.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vDtW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDtW = (modelMatrix * vec4(transformed, 1.)).xz;');
    // Gentle, static ripple normals (no time uniform: no animation cost, no per-frame updates).
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vDtW;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 p = vDtW;
  float a = sin(p.x * .9 + p.y * .35) * .5 + sin(p.x * .23 - p.y * 1.3) * .5 + sin((p.x + p.y) * 2.7) * .25;
  vec2 d = vec2(cos(p.x * .9 + p.y * .35) * .45 + cos(p.x * .23 - p.y * 1.3) * .12 + cos((p.x + p.y) * 2.7) * .67,
                cos(p.x * .9 + p.y * .35) * .17 - cos(p.x * .23 - p.y * 1.3) * .65 + cos((p.x + p.y) * 2.7) * .67);
  float fade = 1. - clamp(length(fwidth(p)) / .8, 0., 1.);
  normal = normalize(normal + (viewMatrix * vec4(d.x * .035 * fade, 0., d.y * .035 * fade, 0.)).xyz);
}`).replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
reflectedLight.indirectSpecular *= vec3(.52, .66, .7);`);
  };
  m.customProgramCacheKey = () => 'downtown-water-v2';
  return m;
}
