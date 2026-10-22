import * as THREE from 'three';
import type { Sky } from 'three/addons/objects/Sky.js';

export interface SkyEnvironmentOptions {
  /** Chroma of the sky part (1 = raw Preetham sky). Lower values neutralise
   * the very saturated blue for diffuse light; reflections stay sky-coloured. */
  saturation?: number;
  /** Linear radiance used below the horizon, in the same raw units as the Sky
   * shader. Null keeps the legacy behaviour (horizon haze continues downward,
   * which lights shaded walls from below as if the ground were bright sky). */
  groundRadiance?: [number, number, number] | null;
}

const SKY_OUTPUT = 'gl_FragColor = vec4( texColor, 1.0 );';

/** Diffuse sky illumination; direct sunlight is supplied by DirectionalLight.
 * With no options this is byte-for-byte the legacy environment. */
export function createSkyEnvironment(renderer: THREE.WebGLRenderer, sky: Sky, options: SkyEnvironmentOptions = {}) {
  const lightingSky = sky.clone();
  // Mesh.clone shares materials. Clone this separately so the visible sky keeps
  // its sun disc. The disc exceeds the half-float PMREM range on SwiftShader;
  // Infinity then spreads through filtering and makes lit materials black.
  // Material.clone does not copy instance hooks, so the visible-sky gain patch
  // (render/lighting.ts) is intentionally absent here: the environment stays raw-scale.
  lightingSky.material = sky.material.clone();
  lightingSky.material.uniforms.showSunDisc.value = false;
  const saturation = options.saturation ?? 1;
  const ground = options.groundRadiance ?? null;
  if (!Number.isFinite(saturation) || saturation < 0 || saturation > 1)
    throw new Error('Sky environment saturation must be within 0..1');
  if (ground && !ground.every(v => Number.isFinite(v) && v >= 0 && v < 1e4))
    throw new Error('Sky environment ground radiance must be finite and non-negative');
  if (saturation !== 1 || ground) {
    lightingSky.material.onBeforeCompile = shader => {
      if (!shader.fragmentShader.includes(SKY_OUTPUT))
        throw new Error('Sky environment requires the three r185 Sky shader output line');
      shader.uniforms.campusEnvSaturation = { value: saturation };
      shader.uniforms.campusEnvGround = { value: new THREE.Vector3(...(ground ?? [0, 0, 0])) };
      shader.uniforms.campusEnvGroundWeight = { value: ground ? 1 : 0 };
      shader.fragmentShader = 'uniform float campusEnvSaturation;\nuniform vec3 campusEnvGround;\nuniform float campusEnvGroundWeight;\n'
        + shader.fragmentShader.replace(SKY_OUTPUT, `
          float campusLuma = dot( texColor, vec3( 0.2126, 0.7152, 0.0722 ) );
          vec3 campusEnv = mix( vec3( campusLuma ), texColor, campusEnvSaturation );
          // Lit ground below a short horizon band: shaded walls receive warm, dim
          // bounce instead of bright horizon haze from beneath.
          float campusBelow = campusEnvGroundWeight * smoothstep( 0.0, -0.08, direction.y );
          gl_FragColor = vec4( mix( campusEnv, campusEnvGround, campusBelow ), 1.0 );`);
    };
    lightingSky.material.customProgramCacheKey = () => 'campus-sky-environment-v1';
  }
  const source = new THREE.Scene();
  source.add(lightingSky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  try {
    return pmrem.fromScene(source, 0.035, 0.1, 20000);
  } finally {
    pmrem.dispose();
    lightingSky.material.dispose();
    // The visible sky owns the shared geometry. The caller owns the returned
    // render target, including its framebuffer and environment texture.
  }
}
