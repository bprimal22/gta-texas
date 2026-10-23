import * as THREE from 'three';
import type { FacadeKind } from './format';

/** Facade code per treatment (aFac.z). 0 = roof, 10 = solid crown/trim metal. */
export const FACADE_CODE: Record<FacadeKind | 'roof' | 'solid', number> = {
  roof: 0, curtain: 1, balcony: 2, punched: 3, ribbon: 4, historic: 5, garage: 6, banded: 7, whitegrid: 8, stone: 9, solid: 10, podium: 11,
};
/** Storey height (m) used by each treatment; with the tier height it fixes the floor rhythm. */
export const FLOOR_HEIGHT: Record<number, number> = { 0: 4, 1: 4.0, 2: 3.2, 3: 3.7, 4: 3.8, 5: 4.4, 6: 3.1, 7: 4.0, 8: 3.25, 9: 4.4, 10: 4, 11: 4.2 };

/** One shared material for every downtown building (walls, roofs, crowns) in every chunk.
 * Procedural, distance-filtered facades: mullions, spandrels, slab edges, balconies, punched windows,
 * storefronts and brick coursing near the camera; periodic floor/window coverage is filtered over the pixel footprint;
 * fine pane variation resolves to its average colour/roughness, so the distant skyline keeps the same palette without aliasing.
 * Colours come from vertex attributes (wall/frame `color`, glass `aGlass`), baked from photo-derived palettes. */
export function createFacadeMaterial(envMap: THREE.Texture | null) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .86, metalness: 0, envMap, envMapIntensity: .65 });
  m.name = 'Downtown facades';
  m.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aGlass;\nattribute vec4 aFac;\nvarying vec3 vDtGlass;\nvarying vec4 vDtFac;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDtGlass = aGlass;\nvDtFac = aFac;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vDtGlass;
varying vec4 vDtFac;
float dtGlassMask;
float dtHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// 1 inside [a,b] of a periodic coordinate (period 1), anti-aliased by w.
float dtArea(float x, float a, float b){ return floor(x) * (b-a) + clamp(fract(x)-a, 0., b-a); }
float dtPulse(float x, float a, float b, float w){ w=max(w,1e-4); return clamp((dtArea(x+w*.5,a,b)-dtArea(x-w*.5,a,b))/w,0.,1.); }
`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float code = floor(vDtFac.z + .5);
  float u = vDtFac.x, v = vDtFac.y, fh = max(vDtFac.w, 2.);
  vec2 fw = max(fwidth(vDtFac.xy), vec2(1e-4));
  float lod = clamp((max(fw.x, fw.y) - .08) / .55, 0., 1.);
  float fy = v / fh, fi = floor(fy);
  float wv = fw.y / fh;
  float mask = 0., shade = 1.;
  vec3 wall = diffuseColor.rgb, glassC = vDtGlass;
  if (code < .5) {                      // roof: membrane/gravel with faint panel seams
    float n = dtHash(floor(vec2(u, v) * .5));
    shade = mix(.94 + .08 * n, .98, lod); mask = 0.;   // panel noise fades with distance (no far shimmer)
  } else if (code > 9.5 && code < 10.5) { // solid trim / crown metal
    mask = 0.;
  } else {
    float bay = code == 2. ? 3.2 : code == 3. ? 1.9 : code == 5. ? 2.8 : code == 8. ? 2.8 : code == 9. ? 3.0 : code == 11. ? 8.4 : 1.5;
    float ux = u / bay, bi = floor(ux), wu = fw.x / bay;
    float h = mix(dtHash(vec2(bi, fi)), .5, lod);
    if (code == 1.) {                   // unitized curtain wall: vision glass, spandrel band, thin mullions
      float vision = dtPulse(fy, .24, 1., wv) * (1. - dtPulse(ux + .5, .47, .53, wu));
      mask = vision; shade = mix(.62, 1., vision);
      glassC *= .93 + .14 * h;
    } else if (code == 7.) {            // banded glass: bright slab bands each floor
      float band = dtPulse(fy, 0., .2, wv);
      mask = (1. - band) * (1. - dtPulse(ux + .5, .48, .52, wu));
      glassC *= .94 + .12 * h;
    } else if (code == 2.) {            // residential balconies: slab edge, glass rail, recessed glazing
      float slab = dtPulse(fy, 0., .1, wv);
      float rail = dtPulse(fy, .1, .34, wv);
      float pier = dtPulse(ux + .5, .46, .54, wu);
      mask = (1. - slab) * (1. - pier);
      shade = 1. - .32 * (1. - slab) * (1. - rail) * step(.35, h);
      glassC = mix(glassC * (.85 + .2 * h), glassC * 1.25 + .03, rail * .5);
    } else if (code == 8.) {            // white frame grid with staggered windows (Waterline / Independent)
      float frameV = dtPulse(ux + .5, .4, .6, wu);
      float frameH = dtPulse(fy, 0., .16, wv);
      float solid = mix(step(.62, dtHash(vec2(bi, fi * 1.7 + 3.))), .38, lod);
      mask = (1. - frameV) * (1. - frameH) * (1. - solid);
      glassC *= .9 + .15 * h;
    } else if (code == 3. || code == 9.) { // punched windows in granite/precast/limestone
      float win = dtPulse(ux, .19, .81, wu) * dtPulse(fy, .3, .8, wv);
      if (code == 9.) win = dtPulse(ux, .33, .67, wu) * dtPulse(fy, .18, .86, wv);
      mask = win;
      shade = 1. - .25 * win;
      wall *= mix(.96 + .06 * dtHash(vec2(floor(u * 1.2), floor(v * 1.5))), .99, lod);
    } else if (code == 4.) {            // ribbon windows
      mask = dtPulse(fy, .36, .8, wv) * (1. - dtPulse(ux + .5, .48, .52, wu));
    } else if (code == 5.) {            // historic brick: tall sash windows, ground-floor storefront
      float win = dtPulse(ux, .32, .68, wu) * dtPulse(fy, .22, .78, wv);
      mask = win; shade = 1. - .3 * win;
      float course = dtPulse(v / .075, 0., .14, fw.y / .075);
      wall *= mix(.95 + .1 * dtHash(vec2(floor(u / .23 + floor(v / .075) * .5), floor(v / .075))), .8, course * (1. - lod));
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
    } else if (code == 5. && v < 4.4) {
      float sf = dtPulse(v / 4.4, .05, .8, fw.y / 4.4) * (1. - dtPulse(u / 3. + .5, .46, .54, fw.x / 3.));
      mask = max(mask, sf);
    }
  }
  // Periodic coverage filtering (dtPulse) keeps readable floor bands at range without aliasing.
  dtGlassMask = mask;
  diffuseColor.rgb = mix(wall * shade, glassC * .3, mask);
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .18, dtGlassMask);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, .04, dtGlassMask);');
  };
  m.customProgramCacheKey = () => 'downtown-facade-v2';
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

/** Instanced street/park trees: vertex-coloured trunk + crown, per-instance tint. */
export function createTreeMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 });
  m.name = 'Downtown trees (LiDAR canopy)';
  return m;
}
