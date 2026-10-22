import * as T from "three";
import { createCampusGlass } from "./campus-glass";

/** Keep this name stable: all existing POB frontages share this owned material. */
export const POB_GLASS_NAME = "POB recessed blue-gray glazing";
/** Bind the already-owned sky PMREM explicitly; scene.environmentIntensity=.25
 * otherwise overrides a material's null-map intensity in Three r185. */
export const POB_GLASS_SKY_INTENSITY = 0.85;

/** Photo-guided opaque exterior glass. The existing geometric jambs/recesses
 * supply real depth; neutral shaded interior radiance and dielectric sky
 * reflections replace the previous uniformly blue metallic diffuse surface.
 * No windows are made transparent and no environment is created or owned here. */
export function createPobGlass() {
  const material = createCampusGlass({
    name: POB_GLASS_NAME,
    roughness: 0.13,
    ior: 1.52,
    interiorLevel: 0.014,
    interiorVariation: 0.28,
    envMapIntensity: POB_GLASS_SKY_INTENSITY,
  });
  const baseCompile = material.onBeforeCompile.bind(material),
    baseKey = material.customProgramCacheKey(),
    variationUniform = { value: 0.018 };
  material.onBeforeCompile = (shader, renderer) => {
    if (!shader.fragmentShader.includes("#include <roughnessmap_fragment>"))
      throw new Error("POB glass requires the Three roughness injection point");
    baseCompile(shader, renderer);
    shader.uniforms.pobGlassRoughnessVariation = variationUniform;
    shader.fragmentShader = "uniform float pobGlassRoughnessVariation;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>
      // Weak, broad variation in reflection sharpness, in world metres. This
      // changes the native GGX lobe, never paints a reflection or a room image.
      vec2 pobGlassNoisePoint = vec2(vCampusGlassPoint.x + vCampusGlassPoint.z,
                                   vCampusGlassPoint.y) / vec2(2.4, 1.8);
      float pobGlassDetailFade = 1. - smoothstep(.25, 1.,
        max(fwidth(pobGlassNoisePoint.x), fwidth(pobGlassNoisePoint.y)));
      float pobGlassRoughnessNoise = campusGlassNoise(pobGlassNoisePoint) * 2. - 1.;
      roughnessFactor = clamp(roughnessFactor + pobGlassRoughnessNoise *
        pobGlassRoughnessVariation * pobGlassDetailFade, .055, .45);
      `,
    );
  };
  material.customProgramCacheKey = () => `${baseKey}:pob-neutral-recess-r185-v1`;
  return material as T.MeshPhysicalMaterial;
}
