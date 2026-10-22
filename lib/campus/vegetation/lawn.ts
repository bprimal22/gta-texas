import * as T from 'three';

/**
 * Campus ground finish for every lawn / planting material.
 *  - Maintained lawn: ambientCG Grass004 (CC0) sampled at two rotated scales
 *    in world XZ plus low-frequency hue/brightness variation, so no 2 m tile
 *    grid survives at distance.
 *  - Under-oak root zones: ambientCG ScatteredLeaves009 (CC0) leaf litter /
 *    bare soil, from a campus mask built from the actual placed trees.
 *  - Hero-route beds: dark low groundcover (ambientCG Grass001, CC0, recoloured
 *    toward liriope / Asian jasmine), only around authored trees.
 *  - Under-canopy ambient darkening beyond the real shadow-map reach.
 * Geometry, UVs and colliders are untouched; world XZ drives every sample.
 */
export const GROUND_TEXTURES = {
  lawnColor: '/assets/materials/ground/lawn-color.jpg',
  lawnNormal: '/assets/materials/ground/lawn-normal.jpg',
  litterColor: '/assets/materials/ground/litter-color.jpg',
  litterNormal: '/assets/materials/ground/litter-normal.jpg',
  coverColor: '/assets/materials/ground/groundcover-color.jpg',
};

export interface GroundTextures {
  lawnColor: T.Texture; lawnNormal: T.Texture; litterColor: T.Texture; litterNormal: T.Texture; coverColor: T.Texture;
  dispose(): void;
}

export async function loadGroundTextures(renderer?: T.WebGLRenderer): Promise<GroundTextures> {
  const pending: Promise<unknown>[] = [];
  const browser = typeof document !== 'undefined' && typeof (globalThis as { Image?: unknown }).Image === 'function';
  const anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() ?? 1);
  const load = (url: string, srgb: boolean) => {
    const t = new T.Texture();
    t.name = url; t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = anisotropy;
    if (srgb) t.colorSpace = T.SRGBColorSpace;
    if (browser) pending.push(new T.ImageLoader().loadAsync(url).then(img => { t.image = img; t.needsUpdate = true; }));
    return t;
  };
  const set = {
    lawnColor: load(GROUND_TEXTURES.lawnColor, true), lawnNormal: load(GROUND_TEXTURES.lawnNormal, false),
    litterColor: load(GROUND_TEXTURES.litterColor, true), litterNormal: load(GROUND_TEXTURES.litterNormal, false),
    coverColor: load(GROUND_TEXTURES.coverColor, true),
  };
  await Promise.all(pending);
  return { ...set, dispose() { Object.values(set).forEach(t => t.dispose()); } };
}

export interface VegetationMask { texture: T.DataTexture; origin: T.Vector2; size: T.Vector2; resolution: number }

/** RGBA8 campus mask, ~2 m/px. R: root-zone litter, G: hero groundcover bed,
 * B: canopy cover (shade). Built from placed trees, not from imagery. */
export function buildVegetationMask(bounds: number[], trees: { x: number; z: number; radius: number; hero: boolean }[], resolution = 1024): VegetationMask {
  const [w, n, e, s] = bounds;
  const sx = (e - w) / resolution, sz = (s - n) / resolution;
  const data = new Uint8Array(resolution * resolution * 4);
  const stamp = (cx: number, cz: number, radius: number, channel: number, strength: number) => {
    const i0 = Math.max(0, Math.floor((cx - radius - w) / sx)), i1 = Math.min(resolution - 1, Math.ceil((cx + radius - w) / sx));
    const j0 = Math.max(0, Math.floor((cz - radius - n) / sz)), j1 = Math.min(resolution - 1, Math.ceil((cz + radius - n) / sz));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(w + (i + .5) * sx - cx, n + (j + .5) * sz - cz) / radius;
      if (d >= 1) continue;
      const v = Math.round(255 * strength * (1 - d * d) ** .6), k = (j * resolution + i) * 4 + channel;
      if (v > data[k]) data[k] = v;
    }
  };
  for (const t of trees) {
    stamp(t.x, t.z, Math.max(2.4, t.radius * .42), 0, 1);
    stamp(t.x, t.z, Math.max(3, t.radius * .95), 2, .9);
    if (t.hero) stamp(t.x, t.z, Math.max(3.2, t.radius * .6), 1, 1);
  }
  for (let k = 3; k < data.length; k += 4) data[k] = 255;
  const texture = new T.DataTexture(data, resolution, resolution, T.RGBAFormat, T.UnsignedByteType);
  texture.magFilter = T.LinearFilter; texture.minFilter = T.LinearFilter; texture.generateMipmaps = false;
  texture.wrapS = texture.wrapT = T.ClampToEdgeWrapping; texture.flipY = false;
  texture.needsUpdate = true; texture.name = 'Campus vegetation mask (from placed trees)';
  return { texture, origin: new T.Vector2(w, n), size: new T.Vector2(e - w, s - n), resolution };
}

// Word-bounded: 'courtyard concrete' is paving, 'yard planting soil' is not.
const LAWN_NAME = /\b(grass|lawn|turf|yard|planting|soil|garden|planter)\b/i;
const BED_NAME = /planting|soil|planter|bed/i;
/** Lawn/planting test shared with the ground index (lawn = not paved). */
export function isLawnMaterial(material: T.Material) {
  if (!material) return false;
  if (material.userData?.lawn) return true;
  if (LAWN_NAME.test(material.name)) return true;
  const map = (material as T.MeshStandardMaterial).map;
  const src = (map?.image as { src?: string } | undefined)?.src ?? (map?.source?.data as { src?: string } | undefined)?.src ?? map?.name ?? '';
  return typeof src === 'string' && /grass-diff|lawn-color/.test(src);
}

export interface LawnStats { decorated: number; beds: number; skippedCustomShader: string[]; meshes: number }
const MARK = '#define CAMPUS_LAWN_V1';

function decorate(material: T.MeshStandardMaterial, o: { mask: VegetationMask; textures: GroundTextures }, bed: boolean) {
  const uniforms = {
    lawnColorMap: { value: o.textures.lawnColor }, lawnNormalMap: { value: o.textures.lawnNormal },
    litterColorMap: { value: o.textures.litterColor }, litterNormalMap: { value: o.textures.litterNormal },
    coverColorMap: { value: o.textures.coverColor }, vegMask: { value: o.mask.texture },
    vegMaskOrigin: { value: o.mask.origin }, vegMaskSize: { value: o.mask.size }, lawnBed: { value: bed ? 1 : 0 },
  };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    if (shader.fragmentShader.includes(MARK)) return;
    for (const anchor of ['#include <map_fragment>', '#include <normal_fragment_maps>', '#include <roughnessmap_fragment>'])
      if (!shader.fragmentShader.includes(anchor)) throw Error(`Campus lawn: missing ${anchor}`);
    shader.vertexShader = 'varying vec3 vLawnWorld;\n' + shader.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n  vLawnWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = `${MARK}
      varying vec3 vLawnWorld;
      uniform sampler2D lawnColorMap, lawnNormalMap, litterColorMap, litterNormalMap, coverColorMap, vegMask;
      uniform vec2 vegMaskOrigin, vegMaskSize;
      uniform float lawnBed;
      float lawnHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float lawnNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
        return mix(mix(lawnHash(i), lawnHash(i + vec2(1, 0)), f.x), mix(lawnHash(i + vec2(0, 1)), lawnHash(i + vec2(1, 1)), f.x), f.y);
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      // Top-down XZ on lawns; side projection on berm/skirt faces (no streaks).
      vec3 lawnFaceN = normalize(cross(dFdx(vLawnWorld), dFdy(vLawnWorld)));
      vec2 lw = abs(lawnFaceN.y) > .5 ? vLawnWorld.xz : abs(lawnFaceN.x) > abs(lawnFaceN.z) ? vLawnWorld.zy : vLawnWorld.xy;
      mat2 lawnRot = mat2(.8, -.6, .6, .8);
      vec3 lawnA = texture2D(lawnColorMap, lw / 2.4).rgb;
      vec3 lawnB = texture2D(lawnColorMap, lawnRot * lw / 3.9 + .37).rgb;
      float macro = lawnNoise(lw / 23.) * .65 + lawnNoise(lw / 7.3) * .35;
      float dry = smoothstep(.55, .85, lawnNoise(lw / 41. + 3.1));
      // Maintained St. Augustine/Bermuda lawn: mid green, drier patches, no straw.
      vec3 lawn = mix(lawnA, lawnB, .5) * mix(vec3(.80, .92, .70), vec3(1.0, 1.03, .80), macro);
      lawn = mix(lawn, lawn * vec3(1.18, 1.08, .78), dry * .55);
      vec4 vm = texture2D(vegMask, (vLawnWorld.xz - vegMaskOrigin) / vegMaskSize);
      float edge = lawnNoise(lw * .55) - .5;
      float litter = smoothstep(.28, .62, vm.r + edge * .45);
      float cover = smoothstep(.35, .62, vm.g + edge * .35);
      vec3 litterCol = texture2D(litterColorMap, lw / 1.7).rgb * vec3(.78, .74, .70);
      vec3 coverCol = texture2D(coverColorMap, lawnRot * lw / 1.3).rgb * vec3(.62, .74, .58);
      float bedMix = max(cover, lawnBed);
      vec3 groundCol = mix(lawn, litterCol, litter * (1. - bedMix * .65));
      groundCol = mix(groundCol, mix(coverCol, litterCol, .28 * lawnNoise(lw * 1.7)), bedMix);
      // Canopy shade beyond the shadow-map reach (~28 m) so distant groves read.
      float viewFade = smoothstep(22., 48., length(vViewPosition));
      groundCol *= 1. - .32 * vm.b * viewFade;
      diffuseColor.rgb = groundCol;
      float lawnLitterW = max(litter * (1. - bedMix), 0.);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(.96, .88, bedMix);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        float lawnFoot = max(fwidth(lw.x), fwidth(lw.y));
        float lawnFade = 1. - smoothstep(.01, .06, lawnFoot);
        vec3 nl = texture2D(lawnNormalMap, lw / 2.4).xyz * 2. - 1.;
        vec3 nt = texture2D(litterNormalMap, lw / 1.7).xyz * 2. - 1.;
        vec3 ns = mix(nl, nt, lawnLitterW);
        vec3 worldN = normalize((vec4(normal, 0.) * viewMatrix).xyz);
        worldN = normalize(worldN + vec3(ns.x, 0., -ns.y) * .45 * lawnFade * step(.5, worldN.y));
        normal = normalize((viewMatrix * vec4(worldN, 0.)).xyz);
      }`);
  };
  material.customProgramCacheKey = () => 'campus-lawn-v1';
  material.map = null;
  material.color.set(0xffffff);
  material.roughness = .96; material.metalness = 0;
  material.userData.lawn = true;
  material.needsUpdate = true;
}

/** Decorate every lawn/planting material under `roots` exactly once. Materials
 * that already carry an unknown shader hook are left alone and reported. */
export function applyCampusLawn(roots: T.Object3D[], o: { mask: VegetationMask; textures: GroundTextures }): LawnStats {
  const seen = new Set<T.Material>(), stats: LawnStats = { decorated: 0, beds: 0, skippedCustomShader: [], meshes: 0 };
  for (const root of roots) root.traverse(object => {
    const mesh = object as T.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!(material instanceof T.MeshStandardMaterial) || !isLawnMaterial(material)) continue;
      stats.meshes++;
      if (seen.has(material)) continue;
      seen.add(material);
      const custom = material.onBeforeCompile !== T.Material.prototype.onBeforeCompile;
      if (custom && !material.userData.campusLawnReplaceable) { stats.skippedCustomShader.push(material.name || '(unnamed)'); continue; }
      const bed = BED_NAME.test(material.name);
      decorate(material, o, bed);
      stats.decorated++; if (bed) stats.beds++;
    }
  });
  return stats;
}
