import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** Default for the GTAO pipeline. Codex measured the legacy opt-in pipeline on
 * the M5 Pro after warm-up at 16.7 ms median frame (vsync), CPU ~2.8 ms, GPU
 * 7.6–9.0 ms at spawn, with overview + 960x600 resize + reset showing no black
 * screen or errors; the 1–3 fps HUD figure was cold shader compilation only.
 * Kill switch: `?occlusion=off` (or set this constant to false). */
export const CAMPUS_AO_DEFAULT_ENABLED = true;
export const campusAoRequested = (search: string) => {
  const mode = new URLSearchParams(search).get('occlusion');
  return mode === 'on' ? true : mode === 'off' ? false : CAMPUS_AO_DEFAULT_ENABLED;
};

/** Materials whose colour is captured imagery (scans, photographs) set
 * `material.userData.capturedColor = true`. The pipeline then never wraps
 * their shader: no added ACES, no change to their own tone-mapping flag.
 * Captured-colour meshes should be unlit (MeshBasicMaterial, toneMapped:false)
 * so no scene light is added on top of baked lighting. */
export const isCapturedColor = (material: THREE.Material) => material.userData?.capturedColor === true;

/** Local contact shading from the depth already written by the color render.
 * There is no second campus/foliage geometry pass. Lit surfaces retain their
 * existing ACES transform, while photographed unlit surfaces bypass it. AO
 * operates on display-linear color; OutputPass only encodes the final sRGB.
 */
export class CampusAmbientOcclusion {
  readonly color: THREE.WebGLRenderTarget;
  readonly composite: THREE.WebGLRenderTarget;
  readonly ao: GTAOPass;
  readonly output = new OutputPass();
  /** Whether the offscreen pipeline (and material patching) is used at all.
   * `?occlusion=off` renders directly with Three's antialiased renderer exactly
   * as before this pass; `?occlusion=on` forces it on. */
  private readonly pipelineRequested: boolean;
  private readonly fusedOutput: boolean;
  enabled: boolean;
  readonly resolutionScale = .75;
  private readonly size = new THREE.Vector2();
  private applied = false;
  private patchedMaterials = 0;
  private skippedCaptured = 0;
  private resizes = 0;
  private warmup: { state: 'idle' | 'compiling' | 'ready' | 'timeout' | 'failed'; programs: number; ms: number; error: string } =
    { state: 'idle', programs: 0, ms: 0, error: '' };
  private disposed = false;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    search = typeof location === 'undefined' ? '' : location.search,
  ) {
    const params = new URLSearchParams(search);
    this.fusedOutput = params.get('aocomposite') !== 'legacy';
    this.pipelineRequested = campusAoRequested(search);
    this.enabled = this.pipelineRequested;
    const msaa = params.get('aomsaa');
    const samples = msaa === '0' ? 0 : Math.min(4, renderer.capabilities.maxSamples);
    const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.color = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthTexture: depth,
      samples,
    });
    this.color.texture.name = 'Campus display-linear color and shared depth';
    this.composite = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, depthBuffer: false,
    });
    // r185 expects its internal normal target to exist for setSize/dispose,
    // even with external depth. Construct normally, then bind shared depth;
    // that unused normal target never renders or allocates a GPU framebuffer.
    this.ao = new GTAOPass(scene, camera, 1, 1);
    this.ao.setGBuffer(depth);
    this.ao.blendIntensity = .6;
    this.ao.updateGtaoMaterial({ radius: 1.2, thickness: .7, samples: 12, distanceFallOff: 1 });
    // Local contact detail fades away before the distant photographic context.
    this.ao.gtaoMaterial.defines.FRAGMENT_OUTPUT =
      'vec4(vec3(mix(1.0, ao, 1.0 - smoothstep(30.0, 65.0, -viewPos.z))), 1.0)';
    this.ao.updatePdMaterial({ radius: 5, samples: 8, rings: 2 });
    if (this.fusedOutput) {
      // GTAOPass normally copies full-resolution scene colour to a second
      // half-float buffer, multiplies AO into it, then OutputPass reads it back.
      // Apply that same multiplication before the existing output transform:
      // two fewer full-resolution passes and no composite framebuffer.
      this.ao.output = GTAOPass.OUTPUT.Off;
      this.output.uniforms.campusAO = { value: this.ao.pdRenderTarget.texture };
      this.output.uniforms.campusAOIntensity = { value: 0 };
      this.output.material.fragmentShader = this.output.material.fragmentShader
        .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;\nuniform sampler2D campusAO;\nuniform float campusAOIntensity;')
        .replace('gl_FragColor = texture2D( tDiffuse, vUv );', `gl_FragColor = texture2D( tDiffuse, vUv );
          vec4 campusOcclusion = texture2D(campusAO, vUv);
          gl_FragColor.rgb *= mix(vec3(1.0), campusOcclusion.rgb, campusAOIntensity);`);
    }
    this.output.renderToScreen = true;
    this.resize();
  }

  /** Call after authored scenery and the avatar have loaded, before rendering.
   * Three normally omits per-material tone mapping for offscreen targets.
   * Keep it here for toneMapped materials, rather than applying ACES globally
   * to the photographed MeshBasicMaterials at the end of the pipeline.
   * Safe to call again for materials added later; already-wrapped and
   * captured-colour materials are skipped.
   */
  prepareMaterials(root: THREE.Object3D = this.scene) {
    if (!this.pipelineRequested) return;
    root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.material) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material.toneMapped || material.userData.campusDisplayLinear) continue;
        if (isCapturedColor(material)) {
          if (!material.userData.campusCapturedCounted) { material.userData.campusCapturedCounted = true; this.skippedCaptured++; }
          continue;
        }
        material.userData.campusDisplayLinear = true;
        this.patchedMaterials++;
        const before = material.onBeforeCompile.bind(material), key = material.customProgramCacheKey();
        material.onBeforeCompile = (shader, renderer) => {
          before(shader, renderer);
          // Some materials delegate to another material's live shader hook
          // (the 24th/DKR asphalt does this). That hook may already be wrapped.
          if (shader.fragmentShader.includes('CAMPUS_DISPLAY_LINEAR')) return;
          if (!shader.fragmentShader.includes('#include <tonemapping_fragment>')) return;
          shader.uniforms.toneMappingExposure = { value: renderer.toneMappingExposure };
          shader.uniforms.campusLinearCapture = this.scene.userData.campusLinearCapture ?? {value:false};
          shader.fragmentShader = '#define CAMPUS_DISPLAY_LINEAR\nuniform bool campusLinearCapture;\n#ifndef TONE_MAPPING\n#include <tonemapping_pars_fragment>\n#endif\n' + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace('#include <tonemapping_fragment>', `
            #ifdef TONE_MAPPING
              #include <tonemapping_fragment>
            #else
              if(!campusLinearCapture)gl_FragColor.rgb = ACESFilmicToneMapping(gl_FragColor.rgb);
            #endif`);
        };
        material.customProgramCacheKey = () => `${key}-campus-display-linear-v3`;
        material.needsUpdate = true;
      }
    });
  }

  get materialRenderTarget(){return this.pipelineRequested?this.color:null;}

  /** Idempotent; also invoked from render() whenever the drawing buffer changed,
   * so a missed resize event or a devicePixelRatio change can never leave the
   * offscreen targets at a stale size. */
  resize() {
    this.renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x)), h = Math.max(1, Math.floor(this.size.y));
    if (this.color.width === w && this.color.height === h) return;
    this.resizes++;
    this.color.setSize(w, h);
    if (!this.fusedOutput) this.composite.setSize(w, h);
    this.ao.setSize(Math.max(1, Math.ceil(w * this.resolutionScale)), Math.max(1, Math.ceil(h * this.resolutionScale)));
  }

  /** Compile every scene program for the active output path while the loading
   * screen is still up, using KHR_parallel_shader_compile when available, then
   * render once so the GTAO/output and shadow-depth programs exist too. This
   * removes the cold-compile 1–3 fps period from the first seconds of play. */
  async warmUp(timeoutMs = 20000) {
    if (this.disposed) return this.warmup;
    const started = performance.now();
    this.warmup = { state: 'compiling', programs: 0, ms: 0, error: '' };
    const renderer = this.renderer, previous = renderer.getRenderTarget();
    let pending: { isReady: () => boolean }[] = [];
    try {
      this.resize();
      renderer.setRenderTarget(this.pipelineRequested ? this.color : null);
      const materials = renderer.compile(this.scene, this.camera);
      pending = [...new Set([...materials].map(m =>
        (renderer.properties.get(m) as { currentProgram?: { isReady: () => boolean } }).currentProgram).filter(p => !!p && typeof p.isReady === 'function'))] as { isReady: () => boolean }[];
      this.warmup.programs = pending.length;
    } catch (error) {
      this.warmup = { state: 'failed', programs: 0, ms: performance.now() - started, error: error instanceof Error ? error.message : String(error) };
    } finally {
      renderer.setRenderTarget(previous);
    }
    if (this.warmup.state === 'failed') return this.warmup;
    // Poll our own list (never three's uncancellable compileAsync timer).
    while (pending.length && !this.disposed) {
      pending = pending.filter(p => { try { return !p.isReady(); } catch { return false; } });
      if (!pending.length) break;
      if (performance.now() - started > timeoutMs) { this.warmup.state = 'timeout'; break; }
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    if (this.disposed) return this.warmup;
    try { this.render(true); } catch (error) {
      this.warmup.error = error instanceof Error ? error.message : String(error);
    }
    if (this.warmup.state === 'compiling') this.warmup.state = 'ready';
    this.warmup.ms = performance.now() - started;
    return this.warmup;
  }

  render(allowOcclusion = true) {
    const renderer = this.renderer;
    if (!this.pipelineRequested) {
      this.applied = false;
      renderer.render(this.scene, this.camera);
      return;
    }
    this.resize();
    const target = renderer.getRenderTarget(), autoReset = renderer.info.autoReset;
    const toneMapping = renderer.toneMapping;
    renderer.info.autoReset = false;
    renderer.info.reset();
    try {
      renderer.setRenderTarget(this.color);
      renderer.render(this.scene, this.camera);
      this.applied = this.enabled && allowOcclusion;
      if (this.applied) this.ao.render(renderer, this.composite, this.color, 0, false);
      renderer.toneMapping = THREE.NoToneMapping;
      if (this.fusedOutput) this.output.uniforms.campusAOIntensity.value = this.applied ? this.ao.blendIntensity : 0;
      this.output.render(renderer, this.composite, this.applied && !this.fusedOutput ? this.composite : this.color, 0, false);
    } finally {
      renderer.toneMapping = toneMapping;
      renderer.setRenderTarget(target);
      renderer.info.autoReset = autoReset;
    }
  }

  snapshot() {
    return {
      enabled: this.enabled, applied: this.applied,
      experimentalPipeline: this.pipelineRequested,
      defaultEnabled: CAMPUS_AO_DEFAULT_ENABLED,
      method: 'GTAO from shared scene depth',
      radiusMeters: this.ao.gtaoMaterial.uniforms.radius.value,
      fadeDepthMeters: [30, 65],
      intensity: this.ao.blendIntensity,
      colorSize: [this.color.width, this.color.height],
      occlusionSize: [this.ao.width, this.ao.height],
      colorSamples: this.color.samples,
      sceneGeometryPasses: 1,
      fusedOutput: this.fusedOutput,
      fullscreenPasses: this.applied ? this.fusedOutput ? 3 : 5 : 1,
      compositeSize: [this.composite.width, this.composite.height],
      toneMapping: 'Per lit material; photographed imagery bypasses ACES',
      patchedLitMaterials: this.patchedMaterials,
      capturedColorMaterialsSkipped: this.skippedCaptured,
      resizes: this.resizes,
      warmup: { ...this.warmup },
    };
  }

  dispose() {
    this.disposed = true;
    this.ao.dispose();
    // r185 GTAOPass.dispose omits these two owned shader materials.
    this.ao.gtaoMaterial.dispose();
    this.ao.blendMaterial.dispose();
    this.output.dispose();
    this.composite.dispose();
    this.color.dispose();
  }
}
