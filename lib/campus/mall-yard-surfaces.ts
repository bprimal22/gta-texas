import * as T from 'three';

type Target = 'legacy' | 'mlk' | 'wch';
export interface MallYardSurfaceOptions {
  /** The MLK extension is opt-in; its existing UVs are half world metres. */
  target?: Target;
}

const marker = '#define MALL_YARD_SURFACE_65';
const programKey = 'mall-yard-dry-live-soil-65-v1';
const applied = new WeakMap<T.MeshStandardMaterial, Target>();

function attach(material: T.MeshStandardMaterial, metresPerUv: number) {
  // Colors are specified in sRGB and converted by Three to linear reflectance.
  // References support a muted mixture, not a measured vegetation survey.
  const uniforms = {
    mallYardMetresPerUv: { value: metresPerUv },
    mallYardDry: { value: new T.Color(0x8b825f) },
    mallYardLive: { value: new T.Color(0x68774f) },
    mallYardSoil: { value: new T.Color(0x786b53) },
  };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    if (shader.fragmentShader.includes(marker)) return;
    if (!shader.vertexShader.includes('#include <uv_vertex>') ||
      !shader.fragmentShader.includes('#include <map_fragment>') ||
      !shader.fragmentShader.includes('#include <normal_fragment_maps>'))
      throw Error('Mall yard finish requires the installed Three surface shader chunks');
    shader.vertexShader = `uniform float mallYardMetresPerUv;
      varying vec2 vMallYardMetres;
    ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>',
      '#include <uv_vertex>\nvMallYardMetres = uv * mallYardMetresPerUv;');
    shader.fragmentShader = `${marker}
      varying vec2 vMallYardMetres;
      uniform vec3 mallYardDry;
      uniform vec3 mallYardLive;
      uniform vec3 mallYardSoil;
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      float mallYardRelief = 0.0;
      #ifdef USE_MAP
        // One fine sample: the existing 1024px dry-thatch photograph repeats
        // every two metres, so stems remain centimetres rather than giant blades.
        vec3 mallYardFine = texture2D(map, vMallYardMetres * .5).rgb;
        float mallYardTone = dot(mallYardFine, vec3(.2126, .7152, .0722));
        // Two coarse mip samples supply irregular, low-contrast growing/worn
        // patches. Explicit mips suppress oversized source blades. Different
        // scales and rotation avoid a shared two-metre repeating color grid.
        vec2 mallYardRotated = mat2(.8, .6, -.6, .8) * vMallYardMetres;
        float mallYardBroad = dot(textureLod(map,
          mallYardRotated * .047 + vec2(.17, .43), 7.0).rgb,
          vec3(.2126, .7152, .0722));
        float mallYardPatch = dot(textureLod(map,
          vMallYardMetres * .143 + vec2(.61, .29), 6.0).rgb,
          vec3(.2126, .7152, .0722));
        // Source linear-luminance mean is .32245. These thresholds are chosen
        // from that actual local image; they do not paint paths or hard edges.
        float mallYardDryWeight = smoothstep(.266, .354, mallYardBroad);
        float mallYardWear = 1.0 - smoothstep(.264, .310, mallYardPatch);
        vec3 mallYardBase = mix(mallYardLive, mallYardDry, mallYardDryWeight);
        mallYardBase = mix(mallYardBase, mallYardSoil, mallYardWear * .64);
        float mallYardDetail = clamp(.98 + (mallYardTone - .32245) * 1.65, .64, 1.30);
        // Exposed soil is quieter than thatch, never a uniformly dark mud fill.
        mallYardDetail = mix(mallYardDetail, 1.0, mallYardWear * .35);
        diffuseColor.rgb *= mallYardBase * mallYardDetail;
        float mallYardFootprint = max(max(fwidth(vMallYardMetres.x),
          fwidth(vMallYardMetres.y)), .00001);
        // Apparent millimetre relief only. Fade it before distant texture mips
        // could turn high-frequency straw into noisy broad surface normals.
        mallYardRelief = (mallYardTone - .32245) * .003
          * (1.0 - smoothstep(.006, .025, mallYardFootprint))
          * (1.0 - mallYardWear * .35);
      #endif
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      // Surface-gradient normal from the existing fine sample: no extra fetch,
      // displacement, collision change or separately owned normal texture.
      vec3 mallYardDx = dFdx(-vViewPosition), mallYardDy = dFdy(-vViewPosition);
      vec3 mallYardR1 = cross(mallYardDy, normal), mallYardR2 = cross(normal, mallYardDx);
      float mallYardDet = dot(mallYardDx, mallYardR1) * faceDirection;
      vec3 mallYardGradient = sign(mallYardDet)
        * (dFdx(mallYardRelief) * mallYardR1 + dFdy(mallYardRelief) * mallYardR2);
      if (abs(mallYardDet) > 1e-10)
        normal = normalize(abs(mallYardDet) * normal - mallYardGradient);
    `);
  };
  // Both UV conventions use one shader program; the scale is per-material data.
  material.customProgramCacheKey = () => programKey;
  // The campus lawn finish (vegetation/lawn.ts) supersedes this interim
  // dry-thatch look when installed; it may replace this hook.
  material.userData.lawn = true;
  material.userData.campusLawnReplaceable = true;
}

/** Decorate the existing ground material before AO, without allocating or owning
 * textures/materials. The source map is borrowed unchanged from the walkway.
 * Reapplication is a no-op, including after AO has wrapped onBeforeCompile.
 * Geometry, cuts, opacity and existing owner lifetimes remain untouched. */
export function applyMallYardSurfaces(
  meshes: readonly T.Mesh[], sourceGrass: T.MeshStandardMaterial,
  options: MallYardSurfaceOptions = {},
) {
  const target = options.target ?? 'legacy';
  if (target !== 'legacy' && target !== 'mlk' && target !== 'wch') throw Error('Unknown Mall yard finish target');
  const texture = sourceGrass.map;
  if (!texture?.isTexture || texture.colorSpace !== T.SRGBColorSpace ||
    texture.wrapS !== T.RepeatWrapping || texture.wrapT !== T.RepeatWrapping ||
    !texture.generateMipmaps || texture.minFilter !== T.LinearMipmapLinearFilter)
    throw Error('Mall yard finish requires the existing repeating sRGB grass texture with mipmaps');
  const prefix = target === 'legacy' ? 'Smooth East Mall buildings: ' : target === 'wch' ? 'WCH ' : 'MLK East Mall ';
  const name = target === 'legacy' ? 'Smooth East Mall buildings: Mall planting soil'
    : target === 'wch' ? 'WCH existing yard planting soil' : 'MLK East Mall grass';
  const materials = new Set<T.MeshStandardMaterial>();
  let selectedMeshes = 0;
  // Validate the complete selection before changing any material.
  for (const mesh of meshes) {
    if (!mesh.name.startsWith(prefix)) throw Error(`Unexpected Mall yard mesh: ${mesh.name}`);
    if (mesh.name !== name) continue;
    if (!(mesh.material instanceof T.MeshStandardMaterial) || mesh.material instanceof T.MeshPhysicalMaterial)
      throw Error('Mall yard finish expects one existing Standard material per ground mesh');
    const material = mesh.material, previous = applied.get(material);
    if (target === 'legacy' && material.name !== 'Mall planting soil')
      throw Error('Mall yard finish material name changed');
    if (!mesh.geometry.attributes.uv || mesh.geometry.attributes.uv.itemSize !== 2 ||
      mesh.geometry.attributes.uv.count !== mesh.geometry.attributes.position?.count)
      throw Error('Mall yard finish expects the existing metre-based ground UVs');
    if (previous && previous !== target) throw Error('Mall yard material UV convention changed');
    if (!previous && material.onBeforeCompile !== T.Material.prototype.onBeforeCompile)
      throw Error('Apply Mall yard finish before other custom/AO decoration');
    if ((material.map && material.map !== texture) || material.normalMap || material.bumpMap ||
      material.roughnessMap || material.metalnessMap || material.displacementMap ||
      material.alphaMap || material.transparent || material.opacity !== 1 || !material.depthWrite)
      throw Error('Mall yard finish requires the original opaque ground material and borrowed grass map');
    materials.add(material);
    selectedMeshes++;
  }
  if (materials.size !== 1) throw Error(`Expected one shared ${target} Mall yard material; found ${materials.size}`);
  let changedMaterials = 0;
  for (const material of materials) {
    if (applied.has(material)) continue;
    material.map = texture;
    material.color.set(0xffffff);
    material.roughness = .98;
    material.metalness = 0;
    attach(material, target === 'mlk' ? 2 : 1);
    applied.set(material, target);
    material.needsUpdate = true;
    changedMaterials++;
  }
  return { target, selectedMeshes, selectedMaterials: materials.size, changedMaterials,
    textureSamples: 3, newTextures: 0, newMaterials: 0, geometryChanged: false, collisionChanged: false };
}
