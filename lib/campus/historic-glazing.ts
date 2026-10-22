import * as T from 'three';
import { addHistoricWindowCoveringsShader } from './historic-window-coverings';

export interface HistoricGlazingOptions {
  /** Omit to preserve scene.environment (recommended). An explicit texture is
   * borrowed; this helper never captures, loads, mutates or disposes a sky. */
  environment?: T.Texture | null;
}
type Role = 'window' | 'shadow';
const roles: Readonly<Record<string, Role>> = {
  'Historic campus deep green glass': 'window',
  'Historic campus shadowed panes': 'shadow',
};
const buildingName = /^(EPS|BRB|JGB|WAG|GAR) Historic campus /;
const applied = new WeakMap<T.MeshStandardMaterial, Role>();
const key = (role: Role) => `historic-dielectric-glazing-79-${role}-v1`;

function attach(material: T.MeshStandardMaterial, role: Role) {
  material.onBeforeCompile = shader => {
    if (shader.fragmentShader.includes('#define HISTORIC_GLASS_63')) return;
    for (const anchor of ['#include <uv_vertex>'])
      if (!shader.vertexShader.includes(anchor)) throw Error(`Historic glass vertex anchor missing: ${anchor}`);
    if (!shader.fragmentShader.includes('#include <opaque_fragment>'))
      throw Error('Historic glass requires the installed Three opaque fragment');
    shader.vertexShader = 'varying vec2 vHistoricGlassMetres;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>',
      '#include <uv_vertex>\nvHistoricGlassMetres = uv;');
    shader.fragmentShader = `#define HISTORIC_GLASS_63
      varying vec2 vHistoricGlassMetres;
      float historicGlassHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float historicGlassNoise(vec2 p) {
        vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(historicGlassHash(i),historicGlassHash(i+vec2(1.,0.)),f.x),
          mix(historicGlassHash(i+vec2(0.,1.)),historicGlassHash(i+vec2(1.,1.)),f.x),f.y);
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      // MeshStandardMaterial supplies dielectric F0=0.04 and GGX specular.
      // Keep its actual reflected sky and highlights; exterior diffuse sun must
      // not turn the dark room proxy into an opaque painted green board.
      float historicFacing=clamp(dot(normal,normalize(vViewPosition)),0.,1.);
      vec3 historicFresnel=F_Schlick(material.specularColor,material.specularF90,historicFacing);
      float historicPixel=max(max(fwidth(vHistoricGlassMetres.x),fwidth(vHistoricGlassMetres.y)),.00001);
      float historicFade=1.-smoothstep(.12,.45,historicPixel);
      float historicRoom=historicGlassNoise(vHistoricGlassMetres/vec2(1.8,1.2))*2.-1.;
      // Small neutral-green interior variation is linear radiance, not a photo
      // or fake reflection. Existing two material groups remain subtly distinct.
      vec3 historicInterior=vec3(.96,1.02,1.0)*${role === 'window' ? '.0100' : '.0075'}
        *(1.+historicRoom*.12*historicFade);
      outgoingLight=totalSpecular+historicInterior*(vec3(1.)-historicFresnel);
      #include <opaque_fragment>
    `);
    addHistoricWindowCoveringsShader(shader);
  };
  material.customProgramCacheKey = () => key(role);
}

/** Treat only two existing pane materials, in place, before AO decoration.
 * The explicit mesh selection must contain only the five historic buildings.
 * Frame colors, masonry hooks, material identity, geometry and physics remain
 * untouched. Repeated calls do not wrap hooks twice and may rebind the sky.
 * All material and texture lifetimes remain with their existing owners. */
export function applyHistoricGlazing(meshes: readonly T.Mesh[], options: HistoricGlazingOptions = {}) {
  if (options.environment !== undefined && options.environment !== null && !options.environment?.isTexture)
    throw Error('Historic glass requires a borrowed sky texture or null');
  const all = new Set<T.Material>();
  for (const mesh of meshes) {
    if (!buildingName.test(mesh.name)) throw Error(`Unexpected historic glazing mesh: ${mesh.name}`);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) all.add(material);
  }
  const selected: { material: T.MeshStandardMaterial; role: Role }[] = [];
  // Validate the complete selection before the first mutation.
  for (const material of all) {
    const role = roles[material.name];
    if (!role) continue;
    if (!(material instanceof T.MeshStandardMaterial) || material instanceof T.MeshPhysicalMaterial)
      throw Error(`Historic glazing expects the existing Standard material: ${material.name}`);
    const previous = applied.get(material);
    if (previous && previous !== role) throw Error('Historic glass material role changed');
    if (!previous && material.onBeforeCompile !== T.Material.prototype.onBeforeCompile)
      throw Error(`Apply historic glazing before custom/AO decoration: ${material.name}`);
    if (material.map || material.normalMap || material.bumpMap || material.roughnessMap || material.metalnessMap)
      throw Error(`Historic glass expected map-free panes: ${material.name}`);
    selected.push({ material, role });
  }
  const changed: string[] = [];
  let environmentBindings = 0;
  for (const { material, role } of selected) {
    if (!applied.has(material)) {
      material.color.set(0xffffff);
      material.metalness = 0;
      material.roughness = role === 'window' ? .14 : .20;
      material.envMapIntensity = 1.1;
      material.transparent = false;
      material.opacity = 1;
      material.depthWrite = true;
      attach(material, role);
      applied.set(material, role);
      material.needsUpdate = true;
      changed.push(material.name);
    }
    if (options.environment !== undefined && material.envMap !== options.environment) {
      material.envMap = options.environment;
      material.needsUpdate = true;
      environmentBindings++;
    }
  }
  return {
    glass: selected.map(({ material }) => material), changed,
    stats: {selectedMeshes: meshes.length, selectedMaterials: selected.length,
      changedMaterials: changed.length, environmentBindings, newMaterials: 0,
      newTextures: 0, geometryChanged: false, collisionChanged: false,
      reflectionSource: options.environment === undefined ? 'existing scene.environment' : 'borrowed current sky environment'},
  };
}
