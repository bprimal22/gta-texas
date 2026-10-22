import * as T from 'three';
import { CampusAmbientOcclusion } from '@/lib/campus/ambient-occlusion';
import { buildCapitolArea } from '@/lib/campus/capitol-area';
import { buildCapitolDome } from '@/lib/campus/capitol-dome';

type Shader = T.WebGLProgramParametersWithUniforms;

/** Regression: the Capitol exterior blockwork delegates to the dome's pink
 * granite hook, which the AO pipeline wraps and which reads
 * renderer.toneMappingExposure. The delegate must forward the real renderer.
 * Runs without a GPU: the renderer is a renderer-like object, and the shader is
 * three's own MeshStandardMaterial source. */
export function runCapitolShaderCheck() {
  const failures: string[] = [];
  const exposure = 1.37;
  const renderer = {
    toneMappingExposure: exposure,
    capabilities: { maxSamples: 4 },
    getDrawingBufferSize: (target: T.Vector2) => target.set(1, 1),
  } as unknown as T.WebGLRenderer;
  const dome = buildCapitolDome();
  const area = buildCapitolArea(dome.materials);
  const scene = new T.Scene();
  scene.add(...dome.meshes, ...area.meshes);
  const ao = new CampusAmbientOcclusion(renderer, scene, new T.PerspectiveCamera(), '');
  ao.prepareMaterials();

  const sourceStone = dome.materials.find(m => m.name === 'Capitol pink granite')!;
  const exterior = area.materials.find(m => m.name === 'Capitol exterior granite blockwork')!;
  if (!sourceStone.userData.campusDisplayLinear) failures.push('AO did not wrap Capitol pink granite');
  if (!exterior.userData.campusDisplayLinear) failures.push('AO did not wrap Capitol exterior granite blockwork');

  const freshShader = (): Shader => ({
    uniforms: T.UniformsUtils.clone(T.ShaderLib.standard.uniforms),
    vertexShader: T.ShaderLib.standard.vertexShader,
    fragmentShader: T.ShaderLib.standard.fragmentShader,
  } as Shader);

  // Guard that this check exercises the failure mode: the wrapped source hook
  // cannot run without a renderer.
  let nullError = '';
  try { sourceStone.onBeforeCompile(freshShader(), null as unknown as T.WebGLRenderer); }
  catch (error) { nullError = error instanceof Error ? error.message : String(error); }
  if (!nullError.includes('toneMappingExposure')) failures.push(`wrapped source hook accepted a null renderer (${nullError || 'no error'})`);

  const seen: unknown[] = [];
  const wrappedSource = sourceStone.onBeforeCompile.bind(sourceStone);
  sourceStone.onBeforeCompile = (shader, r) => { seen.push(r); wrappedSource(shader, r); };
  const shader = freshShader();
  let compileError = '';
  try { exterior.onBeforeCompile(shader, renderer); }
  catch (error) { compileError = error instanceof Error ? error.message : String(error); }
  finally { sourceStone.onBeforeCompile = wrappedSource; }
  if (compileError) failures.push(`exterior hook threw: ${compileError}`);

  if (seen.length !== 1 || seen[0] !== renderer) failures.push(`source hook received ${seen.length} call(s), renderer identity ${seen[0] === renderer}`);
  const uniform = shader.uniforms.toneMappingExposure?.value;
  if (uniform !== exposure) failures.push(`toneMappingExposure uniform ${uniform} != ${exposure}`);
  const frag = shader.fragmentShader, vert = shader.vertexShader;
  const count = (s: string, needle: string) => s.split(needle).length - 1;
  const expectations: [string, boolean][] = [
    ['base varying in vertex shader', vert.includes('vCapitolMetres=position;')],
    ['base varying in fragment shader', frag.includes('varying vec3 vCapitolMetres;')],
    ['base granite grain', frag.includes('capGrain') && frag.includes('capWeather')],
    ['blockwork masonry', frag.includes('vec2 masonry=') && frag.includes('mortar*.16')],
    ['AO display-linear wrap applied once', count(frag, '#define CAMPUS_DISPLAY_LINEAR') === 1],
    ['AO ACES fallback', frag.includes('ACESFilmicToneMapping(gl_FragColor.rgb)')],
    ['exterior cache key wrapped', exterior.customProgramCacheKey() === 'capitol-exterior-blockwork-86-v1-campus-display-linear-v3'],
  ];
  for (const [name, ok] of expectations) if (!ok) failures.push(`missing: ${name}`);
  ao.dispose();
  return {
    failures,
    nullRendererError: nullError,
    sourceHookCalls: seen.length,
    rendererIdentity: seen[0] === renderer,
    toneMappingExposure: uniform,
    checks: Object.fromEntries(expectations),
  };
}
