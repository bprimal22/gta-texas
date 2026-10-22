import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';

/** Cascaded sun shadows without per-material setup.
 *
 * three's CSM addon requires `csm.setupMaterial(material)` on every lit
 * material, and that call REPLACES `material.onBeforeCompile`, which would
 * silently drop this project's AO tone-mapping hook, Speedway paving,
 * local-reflection box projection and glass hooks. Worse, any material it
 * misses is lit once per cascade (3x sun). Its bundled CSMShader chunk is also
 * an older copy of `lights_fragment_begin` (it lacks r185 iridescence, point
 * shadow and probe-grid lines).
 *
 * This wrapper keeps three's CSM only for cascade frustum fitting, light
 * placement and texel snapping, and installs ONE global replacement of the
 * directional-light loop built from the installed r185 chunk. Cascade bands
 * are compile-time constants in view-space metres, so no uniforms, no
 * material hooks and no missed materials: every lit material receives the sun
 * exactly once. Disposing restores the original chunks.
 */

export interface CascadedShadowOptions {
  /** Unit vector toward the sun (campus axes). */
  sunDirection: THREE.Vector3;
  color: THREE.ColorRepresentation;
  intensity: number;
  /** Far edge of each cascade in view-space metres, ascending. */
  splits?: number[];
  mapSize?: number;
  /** Re-render cascade i every refresh[i] frames (staggered). */
  refresh?: number[];
  /** Metres of casters kept between the light and the camera frustum. */
  lightMargin?: number;
}

const DIR_BLOCK_START = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
const DIR_BLOCK_END = '#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )';

export const DEFAULT_CASCADE_SPLITS = [14, 70, 300];
export const FOUR_CASCADE_SPLITS = [12, 50, 180, 600];

/** Build the replacement chunks from the installed originals (exported for Node checks). */
export function buildCascadeChunks(originalPars: string, originalFragment: string, splits: number[]) {
  if (!splits.length || splits.some((s, i) => !(s > (splits[i - 1] ?? 0))))
    throw new Error('Cascade splits must be positive and ascending');
  const start = originalFragment.indexOf(DIR_BLOCK_START);
  const end = originalFragment.indexOf(DIR_BLOCK_END);
  if (start < 0 || end < start) throw new Error('Unsupported three lights_fragment_begin chunk for campus cascades');
  const bands = splits.map((far, i) => `vec2( ${(i ? splits[i - 1] : 0).toFixed(3)}, ${far.toFixed(3)} )`).join(', ');
  const pars = `#define CAMPUS_CSM_CASCADES ${splits.length}
const vec2 campusCsmBands[ ${splits.length} ] = vec2[ ${splits.length} ]( ${bands} );
` + originalPars;
  const directional = `#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )

	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	float campusCsmDepth = vViewPosition.z;

	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		{
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS ) && ( UNROLLED_LOOP_INDEX < CAMPUS_CSM_CASCADES )
			// Each cascade light is the same sun. Exactly one band applies per
			// fragment; beyond the last band the last light shines unshadowed.
			vec2 campusBand = campusCsmBands[ UNROLLED_LOOP_INDEX ];
			bool campusInBand = campusCsmDepth >= campusBand.x && campusCsmDepth < campusBand.y;
			bool campusCarries = campusInBand || ( UNROLLED_LOOP_INDEX == CAMPUS_CSM_CASCADES - 1 && campusCsmDepth >= campusBand.y );
			if ( campusCarries ) {
				if ( campusInBand ) {
					directionalLightShadow = directionalLightShadows[ i ];
					directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
				}
				RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
			}
		#elif defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < CAMPUS_CSM_CASCADES ) && ( NUM_DIR_LIGHT_SHADOWS > 0 )
			// Unreachable with campus lights (shadow casters sort first); kept explicit.
			RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
		#else
			#if ( NUM_DIR_LIGHT_SHADOWS == 0 ) && ( UNROLLED_LOOP_INDEX < CAMPUS_CSM_CASCADES )
				// Cascade lights cast shadows; with shadow maps disabled (e.g. an
				// offscreen bake scene) only the first of them may light.
				if ( UNROLLED_LOOP_INDEX == 0 || NUM_DIR_LIGHTS <= CAMPUS_CSM_CASCADES - 1 ) RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
			#else
				RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
			#endif
		#endif
		}
	}
	#pragma unroll_loop_end

#endif

`;
  const fragment = originalFragment.slice(0, start) + directional + originalFragment.slice(end);
  return { pars, fragment };
}

export class CampusCascadedShadows {
  readonly csm: CSM;
  readonly splits: number[];
  readonly mapSize: number;
  private readonly refresh: number[];
  private readonly originalPars: string;
  private readonly originalFragment: string;
  private frame = 0;
  private lastFov = NaN;
  private lastAspect = NaN;
  private lastNear = NaN;
  private renders: number[];
  private disposed = false;

  constructor(private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, options: CascadedShadowOptions) {
    this.splits = options.splits ?? DEFAULT_CASCADE_SPLITS;
    this.mapSize = options.mapSize ?? 2048;
    this.refresh = options.refresh ?? [1, 2, 3, 4].slice(0, this.splits.length);
    if (this.refresh.length !== this.splits.length || this.refresh.some(r => !Number.isInteger(r) || r < 1))
      throw new Error('Cascade refresh must list one positive integer per cascade');
    this.originalPars = THREE.ShaderChunk.lights_pars_begin;
    this.originalFragment = THREE.ShaderChunk.lights_fragment_begin;
    // Validate before CSM's constructor overwrites the global chunks.
    const chunks = buildCascadeChunks(this.originalPars, this.originalFragment, this.splits);
    const maxFar = this.splits[this.splits.length - 1];
    const fractions = this.splits.map(s => s / maxFar);
    this.csm = new CSM({
      camera, parent: scene, cascades: this.splits.length, maxFar, mode: 'custom',
      customSplitsCallback: (_count, _near, _far, breaks) => { breaks.push(...fractions); },
      shadowMapSize: this.mapSize, shadowBias: -0.00002, lightIntensity: options.intensity,
      lightDirection: options.sunDirection.clone().normalize().negate(),
      lightMargin: options.lightMargin ?? 200, lightNear: 1, lightFar: 2400,
    });
    this.csm.fade = false;
    // Replace CSM's (outdated) chunks with ours, built from the r185 originals.
    THREE.ShaderChunk.lights_pars_begin = chunks.pars;
    THREE.ShaderChunk.lights_fragment_begin = chunks.fragment;
    for (const [i, light] of this.csm.lights.entries()) {
      light.name = `Campus sun cascade ${i}`;
      light.color.set(options.color);
      light.shadow.autoUpdate = false;
      light.shadow.needsUpdate = true;
    }
    this.renders = this.splits.map(() => 0);
    this.fitBiases();
  }

  /** Texel size (m) and per-cascade softening so world-space blur stays ~3 cm near the player. */
  private fitBiases() {
    for (const light of this.csm.lights) {
      const cam = light.shadow.camera;
      const texel = (cam.right - cam.left) / this.mapSize;
      light.shadow.normalBias = Math.max(0.008, texel * 1.2);
      light.shadow.radius = THREE.MathUtils.clamp(Math.round(0.03 / Math.max(texel, 1e-4)), 1, 3);
    }
  }

  setSun(direction: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number) {
    this.csm.lightDirection.copy(direction).normalize().negate();
    for (const light of this.csm.lights) { light.color.set(color); light.intensity = intensity; }
  }

  /** Call once per rendered frame after the camera is final. */
  update() {
    if (this.disposed) return;
    const c = this.camera;
    if (c.fov !== this.lastFov || c.aspect !== this.lastAspect || c.near !== this.lastNear) {
      this.lastFov = c.fov; this.lastAspect = c.aspect; this.lastNear = c.near;
      this.csm.updateFrustums();
      this.fitBiases();
    }
    c.updateMatrixWorld();
    this.csm.update();
    // Stale far maps stay consistent: three only rewrites a shadow matrix when
    // that map re-renders, so sampling uses the matrix the map was drawn with.
    for (const [i, light] of this.csm.lights.entries()) {
      const due = (this.frame + i) % this.refresh[i] === 0;
      if (due) { light.shadow.needsUpdate = true; this.renders[i]++; }
    }
    this.frame++;
  }

  snapshot() {
    return {
      mode: 'csm' as const,
      cascades: this.splits.length,
      splitsMeters: this.splits,
      mapSize: this.mapSize,
      refreshFrames: this.refresh,
      texelMeters: this.csm.lights.map(l => +((l.shadow.camera.right - l.shadow.camera.left) / this.mapSize).toFixed(4)),
      normalBias: this.csm.lights.map(l => +l.shadow.normalBias.toFixed(4)),
      radius: this.csm.lights.map(l => l.shadow.radius),
      mapRenders: [...this.renders],
      shadowMapMiB: +(this.splits.length * this.mapSize * this.mapSize * 4 / 1048576).toFixed(1),
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    THREE.ShaderChunk.lights_pars_begin = this.originalPars;
    THREE.ShaderChunk.lights_fragment_begin = this.originalFragment;
    for (const light of this.csm.lights) light.shadow.dispose();
    this.csm.remove();
    // Programs compiled with the cascade chunk must recompile if the scene lives on.
    this.scene.traverse(object => {
      const material = (object as THREE.Mesh).material;
      if (!material) return;
      for (const m of Array.isArray(material) ? material : [material]) m.needsUpdate = true;
    });
  }
}
