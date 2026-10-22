import * as THREE from 'three';
import type { Sky } from 'three/addons/objects/Sky.js';
import { createSkyEnvironment } from '../sky-environment';
import { setDefaultCampusGlassEnvironment } from '../campus-glass';
import { CampusCascadedShadows, DEFAULT_CASCADE_SPLITS, FOUR_CASCADE_SPLITS } from './cascaded-shadows';
import {
  DEFAULT_LIGHTING_PRESET, DEFAULT_SHADOW_MODE, LIGHTING_PRESETS,
  type LightingPreset, type ShadowMode,
} from './lighting-presets';
import { horizonDisplayHex, luminance, srgbHexToLinear } from './sky-model';
import { directionToSolar, solarPosition, sunDirection } from './solar';

/** Calibrated campus daylight. Every global change is switchable by URL:
 *   ?lighting=legacy|austin-late-morning   (default austin-late-morning)
 *   ?shadows=single|csm                     (default single)
 *   ?shadowcascades=3|4                     (csm only)
 *   ?fog=legacy|height                      (default: preset)
 * `?lighting=legacy` reproduces the pre-overhaul constants exactly.
 */
export interface CampusLightingOptions {
  camera: THREE.PerspectiveCamera;
  hemisphere?: THREE.HemisphereLight;
  /** Defaults to location.search in a browser. */
  search?: string;
  preset?: string;
  shadows?: ShadowMode;
}

const SKY_OUTPUT = 'gl_FragColor = vec4( texColor, 1.0 );';

/** Exponential height fog plus a far fade into the horizon colour. The FOG_EXP2
 * density becomes extinction per metre at `baseHeight`. Built from constants
 * so no material needs new uniforms; non-campus FogExp2 behaviour is replaced
 * only while installed. Exported for the Node shader-string checks. */
export function buildHeightFogChunks(fog: LightingPreset['fog'], original: Record<string, string>) {
  const f = (v: number) => (Number.isFinite(v) ? v : 0).toFixed(6);
  return {
    fog_pars_vertex: original.fog_pars_vertex + `
#ifdef USE_FOG
	varying vec3 vCampusFogView;
#endif
`,
    fog_vertex: original.fog_vertex + `
#ifdef USE_FOG
	vCampusFogView = mvPosition.xyz;
#endif
`,
    fog_pars_fragment: original.fog_pars_fragment + `
#ifdef USE_FOG
	varying vec3 vCampusFogView;
#endif
`,
    fog_fragment: `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		// World-space rise of the view ray (rows of the view rotation).
		float campusFogRise = ( vCampusFogView * mat3( viewMatrix ) ).y;
		float campusFogDistance = length( vCampusFogView );
		float campusFogK = clamp( ${f(fog.falloff)} * campusFogRise, -30.0, 30.0 );
		float campusFogShape = abs( campusFogK ) > 1e-3 ? ( 1.0 - exp( - campusFogK ) ) / campusFogK : 1.0 - 0.5 * campusFogK;
		float campusFogStart = exp( - ${f(fog.falloff)} * clamp( cameraPosition.y - ${f(fog.baseHeight)}, -60.0, 2000.0 ) );
		float fogFactor = 1.0 - exp( - fogDensity * campusFogStart * campusFogDistance * campusFogShape );
		fogFactor = max( fogFactor, smoothstep( ${f(fog.edgeNear)}, ${f(fog.edgeFar)}, campusFogDistance ) );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`,
  };
}

const FOG_CHUNKS = ['fog_pars_vertex', 'fog_vertex', 'fog_pars_fragment', 'fog_fragment'] as const;

export class CampusLighting {
  readonly preset: LightingPreset;
  readonly shadowMode: ShadowMode;
  /** Diffuse/scene environment (desaturated sky + lit ground below the horizon). */
  readonly environment: THREE.WebGLRenderTarget;
  /** Sky-coloured reflection environment for explicit glass envMaps. Same target as
   * `environment` for the legacy preset. Raw Sky units, so existing per-material
   * envMapIntensity values keep their meaning. */
  readonly reflectionEnvironment: THREE.WebGLRenderTarget;
  readonly sunDirection = new THREE.Vector3();
  readonly fogColor: number;
  readonly cascades?: CampusCascadedShadows;
  private readonly skyGain = { value: 1 };
  private readonly hemisphere?: THREE.HemisphereLight;
  private readonly fogChunksOriginal?: Record<string, string>;
  private readonly shadowFocus = new THREE.Vector3();
  private readonly lightBasis = new THREE.Matrix4();
  private readonly lightBasisInverse = new THREE.Matrix4();
  private cascadeError = '';
  private disposed = false;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private sun: THREE.DirectionalLight,
    private sky: Sky,
    options: CampusLightingOptions,
  ) {
    const params = new URLSearchParams(options.search ?? (typeof location === 'undefined' ? '' : location.search));
    const presetId = params.get('lighting') ?? options.preset ?? DEFAULT_LIGHTING_PRESET;
    const base = LIGHTING_PRESETS[presetId] ?? LIGHTING_PRESETS[DEFAULT_LIGHTING_PRESET];
    const fogParam = params.get('fog');
    const fog = fogParam === 'legacy' ? LIGHTING_PRESETS.legacy.fog : fogParam === 'height' ? LIGHTING_PRESETS['austin-late-morning'].fog : base.fog;
    this.preset = { ...base, fog };
    const shadowParam = params.get('shadows');
    this.shadowMode = shadowParam === 'csm' || shadowParam === 'single' ? shadowParam : options.shadows ?? DEFAULT_SHADOW_MODE;
    const preset = this.preset;

    // Sun direction.
    const dir = 'direction' in preset.sun ? preset.sun.direction : sunDirection(solarPosition(new Date(preset.sun.time)));
    this.sunDirection.set(...dir).normalize();

    // Visible sky.
    const u = sky.material.uniforms;
    u.turbidity.value = preset.sky.turbidity;
    u.rayleigh.value = preset.sky.rayleigh;
    u.mieCoefficient.value = preset.sky.mieCoefficient;
    u.mieDirectionalG.value = preset.sky.mieDirectionalG;
    if (u.cloudCoverage) u.cloudCoverage.value = preset.sky.cloudCoverage;
    // Legacy used an unnormalised position; only its direction (and y > 0) matters.
    u.sunPosition.value.copy(this.sunDirection).multiplyScalar(100);
    this.skyGain.value = preset.sky.visibleGain;
    sky.userData.campusSkyGain = this.skyGain;
    if (preset.sky.visibleGain !== 1) {
      const gain = this.skyGain;
      sky.material.onBeforeCompile = shader => {
        if (!shader.fragmentShader.includes(SKY_OUTPUT)) throw new Error('Campus sky gain requires the three r185 Sky output line');
        shader.uniforms.campusSkyGain = gain;
        shader.fragmentShader = 'uniform float campusSkyGain;\n'
          + shader.fragmentShader.replace(SKY_OUTPUT, 'gl_FragColor = vec4( texColor * campusSkyGain, 1.0 );');
      };
      sky.material.customProgramCacheKey = () => 'campus-visible-sky-gain-v1';
      sky.material.needsUpdate = true;
    }

    // Exposure / tone mapping (tone mapping operator unchanged: ACES Filmic).
    renderer.toneMappingExposure = preset.exposure;

    // Hemisphere fill.
    let hemisphere = options.hemisphere;
    if (!hemisphere) scene.traverse(o => { if (!hemisphere && (o as THREE.HemisphereLight).isHemisphereLight) hemisphere = o as THREE.HemisphereLight; });
    this.hemisphere = hemisphere;
    if (hemisphere) {
      hemisphere.color.set(preset.hemisphere.sky);
      hemisphere.groundColor.set(preset.hemisphere.ground);
      hemisphere.intensity = preset.hemisphere.intensity;
    }

    // Sun light.
    sun.color.set(preset.sunColor);
    sun.intensity = preset.sunIntensity;

    // Environments. The ground radiance below the horizon is the lit ground
    // (albedo/pi x horizontal irradiance) expressed in raw sky units.
    const env = preset.environment;
    let groundRadiance: [number, number, number] | null = null;
    if (env.groundAlbedo !== null) {
      const sunLinear = srgbHexToLinear(preset.sunColor);
      const direct = preset.sunIntensity * Math.max(0, this.sunDirection.y) * luminance(sunLinear);
      // Clear-sky diffuse adds roughly a quarter of the direct horizontal term.
      const horizontal = direct * 1.25;
      const tint = srgbHexToLinear(env.groundTint), tintY = luminance(tint) || 1;
      groundRadiance = tint.map(c => c / tintY * env.groundAlbedo! / Math.PI * horizontal / Math.max(env.intensity, 1e-3)) as [number, number, number];
    }
    this.environment = createSkyEnvironment(renderer, sky, { saturation: env.saturation, groundRadiance });
    this.reflectionEnvironment = env.saturation === 1 ? this.environment
      : createSkyEnvironment(renderer, sky, { saturation: 1, groundRadiance });
    scene.environment = this.environment.texture;
    setDefaultCampusGlassEnvironment(this.reflectionEnvironment.texture);
    scene.environmentIntensity = env.intensity;

    // Fog: colour of the displayed sky just above the horizon.
    this.fogColor = preset.fog.color ?? horizonDisplayHex(dir, preset.sky, preset.sky.visibleGain, preset.exposure);
    scene.fog = new THREE.FogExp2(this.fogColor, preset.fog.density);
    scene.background = new THREE.Color(this.fogColor);
    if (preset.fog.kind === 'height') {
      const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
      this.fogChunksOriginal = Object.fromEntries(FOG_CHUNKS.map(k => [k, chunks[k]]));
      Object.assign(chunks, buildHeightFogChunks(preset.fog, this.fogChunksOriginal));
    }

    // Shadows.
    sun.castShadow = true;
    if (this.shadowMode === 'csm') {
      try {
        const splits = params.get('shadowcascades') === '4' ? FOUR_CASCADE_SPLITS : DEFAULT_CASCADE_SPLITS;
        this.cascades = new CampusCascadedShadows(scene, options.camera, {
          sunDirection: this.sunDirection, color: preset.sunColor, intensity: preset.sunIntensity, splits,
        });
        // The cascade lights replace the single sun for lighting and shadowing.
        sun.castShadow = false;
        sun.visible = false;
      } catch (error) {
        this.cascadeError = error instanceof Error ? error.message : String(error);
        this.shadowMode = 'single';
      }
    }
    this.configureSingleShadow();
    this.lightBasis.lookAt(new THREE.Vector3(), this.sunDirection.clone().negate(), new THREE.Vector3(0, 1, 0));
    this.lightBasisInverse.copy(this.lightBasis).invert();
  }

  private configureSingleShadow() {
    const s = this.preset.shadow, shadow = this.sun.shadow;
    shadow.mapSize.set(s.singleMapSize, s.singleMapSize);
    Object.assign(shadow.camera, { left: -s.singleReach, right: s.singleReach, top: s.singleReach, bottom: -s.singleReach, near: 1, far: 300 });
    shadow.camera.updateProjectionMatrix();
    shadow.bias = s.bias;
    shadow.normalBias = s.normalBias;
    shadow.radius = s.radius;
    if (shadow.map) { shadow.map.dispose(); shadow.map = null; }
  }

  /** Per frame, after the camera is final. `focus` is where shadows must be
   * sharp: the player, or the camera-shot focus while a shot is active. */
  update(focus: { x: number; y: number; z: number }) {
    if (this.disposed) return;
    if (this.cascades) { this.cascades.update(); return; }
    const s = this.preset.shadow;
    this.shadowFocus.set(focus.x, focus.y, focus.z);
    if (s.texelSnap) {
      // Snap the frustum centre to whole shadow texels in light space so the
      // map does not shimmer while the player walks.
      const texel = 2 * s.singleReach / s.singleMapSize;
      this.shadowFocus.applyMatrix4(this.lightBasisInverse);
      this.shadowFocus.x = Math.round(this.shadowFocus.x / texel) * texel;
      this.shadowFocus.y = Math.round(this.shadowFocus.y / texel) * texel;
      this.shadowFocus.applyMatrix4(this.lightBasis);
    } else {
      // Legacy: world-space 1/16 m rounding.
      this.shadowFocus.x = Math.round(focus.x * 16) / 16;
      this.shadowFocus.z = Math.round(focus.z * 16) / 16;
    }
    this.sun.target.position.copy(this.shadowFocus);
    if ('direction' in this.preset.sun) {
      const [x, y, z] = this.preset.sun.direction;
      this.sun.position.set(this.shadowFocus.x + x, this.shadowFocus.y + y, this.shadowFocus.z + z);
    } else {
      this.sun.position.copy(this.shadowFocus).addScaledVector(this.sunDirection, 140);
    }
    this.sun.target.updateMatrixWorld();
  }

  snapshot() {
    const solar = directionToSolar([this.sunDirection.x, this.sunDirection.y, this.sunDirection.z]);
    return {
      preset: this.preset.id,
      sun: { elevationDeg: +solar.elevationDeg.toFixed(2), azimuthDeg: +solar.azimuthDeg.toFixed(2),
        time: 'time' in this.preset.sun ? this.preset.sun.time : null, intensity: this.sun.intensity,
        color: '#' + this.sun.color.getHexString() },
      sky: { ...this.preset.sky },
      environment: { ...this.preset.environment, separateReflectionTarget: this.reflectionEnvironment !== this.environment },
      hemisphere: this.hemisphere ? this.hemisphere.intensity : null,
      exposure: this.renderer.toneMappingExposure,
      fog: { ...this.preset.fog, color: '#' + this.fogColor.toString(16).padStart(6, '0') },
      shadows: this.cascades ? this.cascades.snapshot() : {
        mode: 'single' as const, reach: this.preset.shadow.singleReach, mapSize: this.preset.shadow.singleMapSize,
        texelSnap: this.preset.shadow.texelSnap, radius: this.preset.shadow.radius,
        fallbackReason: this.cascadeError || null,
      },
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cascades?.dispose();
    setDefaultCampusGlassEnvironment(null);
    if (this.fogChunksOriginal) Object.assign(THREE.ShaderChunk as unknown as Record<string, string>, this.fogChunksOriginal);
    if (this.reflectionEnvironment !== this.environment) this.reflectionEnvironment.dispose();
    this.environment.dispose();
  }
}

/** Convenience wrapper matching the lane brief. */
export function configureCampusLighting(renderer: THREE.WebGLRenderer, scene: THREE.Scene,
  sun: THREE.DirectionalLight, sky: Sky, opts: CampusLightingOptions) {
  return new CampusLighting(renderer, scene, sun, sky, opts);
}
