import * as T from 'three';

/** Same-origin textures only. Bark reuses Poly Haven island_tree_02 (CC0)
 * tileable branch bark already shipped in public/assets/foreground-tree;
 * foliage is the lane-built LeafSet022 (ambientCG, CC0) spray atlas. */
export const TREE_TEXTURES = {
  barkColor: '/assets/foreground-tree/textures/island_tree_02_branches_diff_1k.jpg',
  barkNormal: '/assets/foreground-tree/textures/island_tree_02_branches_nor_gl_1k.jpg',
  barkArm: '/assets/foreground-tree/textures/island_tree_02_branches_arm_1k.jpg',
  leafColor: '/assets/vegetation/live-oak-foliage-color.png',
  leafNormal: '/assets/vegetation/live-oak-foliage-normal.jpg',
};

export interface TreeMaterials { bark: T.MeshStandardMaterial; foliage: T.MeshStandardMaterial; textures: T.Texture[] }

function canLoadImages() {
  return typeof document !== 'undefined' && typeof (globalThis as { Image?: unknown }).Image === 'function';
}

/** Leaves are alpha-tested cards with crown-radial normals. Back faces keep
 * the authored (outward) normal instead of Three's flipped one, so the far side
 * of a card is lit like its crown position rather than turning black. */
function foliageShader(material: T.MeshStandardMaterial) {
  material.onBeforeCompile = shader => {
    if (shader.fragmentShader.includes('LIVE_OAK_FOLIAGE')) return;
    // Same chunk, minus the back-face normal flip (column 2 of tbn follows).
    const begin = T.ShaderChunk.normal_fragment_begin.replace(/#ifdef DOUBLE_SIDED\s*normal \*= faceDirection;\s*#endif/, '');
    if (begin === T.ShaderChunk.normal_fragment_begin) throw Error('Live-oak foliage: unexpected normal chunk');
    shader.fragmentShader = '#define LIVE_OAK_FOLIAGE\n' + shader.fragmentShader.replace('#include <normal_fragment_begin>', begin);
    // Thin leaves: wrap lighting (light reaching past the terminator) and a
    // yellow-green transmission tint when the sun is behind the clump. The
    // vertex shade (inner clumps darker) already scales diffuseColor, so deep
    // interior leaves do not glow.
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>',
      `#include <lights_fragment_end>
      reflectedLight.indirectDiffuse += diffuseColor.rgb * .05;
      #if NUM_DIR_LIGHTS > 0
      {
        vec3 leafL = directionalLights[ 0 ].direction;
        float leafNL = dot( normal, leafL );
        float leafWrap = clamp( ( leafNL + .5 ) / 1.5, 0., 1. ) - clamp( leafNL, 0., 1. );
        float leafBack = pow( clamp( -leafNL, 0., 1. ), 1.5 );
        reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[ 0 ].color
          * ( leafWrap * .22 + leafBack * .38 * vec3( 1.1, 1.18, .55 ) ) * RECIPROCAL_PI;
      }
      #endif`);
  };
  material.customProgramCacheKey = () => 'live-oak-foliage-v2';
}

export async function loadTreeMaterials(renderer?: T.WebGLRenderer): Promise<TreeMaterials> {
  const textures: T.Texture[] = [], pending: Promise<unknown>[] = [];
  const anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() ?? 1);
  const load = (url: string, srgb: boolean, repeat: boolean) => {
    // ImageLoader fills the texture in place; resolution is awaited below so
    // impostor baking never sees blank images.
    const t = new T.Texture();
    t.name = url;
    if (srgb) t.colorSpace = T.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = anisotropy;
    if (canLoadImages()) pending.push(new T.ImageLoader().loadAsync(url).then(img => { t.image = img; t.needsUpdate = true; }));
    textures.push(t);
    return t;
  };
  const bark = new T.MeshStandardMaterial({
    name: 'Live oak bark (island_tree_02 branch bark, CC0)',
    map: load(TREE_TEXTURES.barkColor, true, true),
    normalMap: load(TREE_TEXTURES.barkNormal, false, true),
    roughnessMap: load(TREE_TEXTURES.barkArm, false, true),
    normalScale: new T.Vector2(1.1, 1.1),
    // Speedway/Jackson School oak bark reads darker gray-brown than the source.
    color: new T.Color(0x8d8478),
    roughness: 1, metalness: 0, vertexColors: true,
  });
  const foliage = new T.MeshStandardMaterial({
    name: 'Live oak foliage spray cards (LeafSet022, CC0)',
    map: load(TREE_TEXTURES.leafColor, true, false),
    normalMap: load(TREE_TEXTURES.leafNormal, false, false),
    normalScale: new T.Vector2(.6, .6),
    color: new T.Color(0xe4e8d6),
    // Alpha-to-coverage (the AO colour target is 4x MSAA) gives anti-aliased
    // leaf edges; with MSAA off it degrades to the same 0.5 cut-out.
    alphaTest: .5, alphaToCoverage: true, side: T.DoubleSide, vertexColors: true,
    roughness: .74, metalness: 0, envMapIntensity: .55,
  });
  foliageShader(foliage);
  await Promise.all(pending);
  return { bark, foliage, textures };
}

export function disposeTreeMaterials(m: TreeMaterials) {
  m.bark.dispose(); m.foliage.dispose();
  for (const t of m.textures) t.dispose();
}
