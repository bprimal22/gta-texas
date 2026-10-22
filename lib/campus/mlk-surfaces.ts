import * as T from 'three';

/** All images are borrowed from Walkway's texture owner, not loaded here. */
export interface MlkSurfaceTextures {
  gravelColor: T.Texture;
  gravelNormal: T.Texture;
  aggregateColor: T.Texture;
  aggregateNormal: T.Texture;
}
type Role = 'gravel' | 'concrete';
const names: Record<string, Role> = {'MLK East Mall gravel':'gravel','MLK East Mall concrete':'concrete'};
const applied = new WeakMap<T.MeshStandardMaterial, {role:Role;color:T.Texture;normal:T.Texture}>();
const marker='#define MLK_PHOTO_SURFACE_65';
// This original map block is replaced, while the concrete joint block remains
// byte-identical. Require the exact known factory hook instead of guessing.
const oldConcreteMap=`#ifdef USE_MAP
    vec4 c=texture2D(map,vMapUv);float l=dot(c.rgb,vec3(.2126,.7152,.0722));diffuseColor.rgb*=mix(.90,1.06,smoothstep(.05,.7,l));
    #endif`;
const oldGravelStart='vec2 p=mlkUv*25.0,b=floor(p),f=fract(p);';

function configure(material:T.MeshStandardMaterial,role:Role) {
  const previous=material.onBeforeCompile.bind(material),key=material.customProgramCacheKey();
  material.onBeforeCompile=(shader,renderer)=>{
    if(shader.fragmentShader.includes(marker))return;
    previous(shader,renderer);
    const fragment=shader.fragmentShader;
    for(const anchor of['#include <color_fragment>','#include <alphamap_fragment>','#include <roughnessmap_fragment>','#include <normal_fragment_maps>'])
      if(!fragment.includes(anchor))throw Error(`MLK65 missing shader anchor ${anchor}`);
    if(!shader.vertexShader.includes('mlkUv=uv*2.0;'))throw Error('MLK65 requires original metre UV convention');
    if(role==='gravel'){
      const a=fragment.indexOf('#include <color_fragment>'),b=fragment.indexOf('#include <alphamap_fragment>');
      const old=fragment.slice(a,b);
      if(!old.includes(oldGravelStart)||!old.includes('for(int x=-1;x<=1;x++)'))throw Error('MLK65 unexpected gravel hook');
      // Remove the full old procedural pebble loop, including its modulation.
      shader.fragmentShader=fragment.slice(0,a)+'#include <color_fragment>\n\t'+fragment.slice(b);
    }else if(!fragment.includes(oldConcreteMap))throw Error('MLK65 unexpected concrete map hook');
    const sample=`
      #ifdef USE_MAP
        vec3 mlk65Source=texture2D(map,vMapUv).rgb;
        float mlk65Lum=dot(mlk65Source,vec3(.2126,.7152,.0722));
        float mlk65Tone=smoothstep(${role==='gravel'?'.10,.38':'.075,.55'},mlk65Lum);
        // The source contains material detail, not the reference photograph's
        // shadows. Recolor its reflectance toward pale stone / warm aggregate.
        vec3 mlk65Tint=mix(vec3(1.),clamp(mlk65Source/max(mlk65Lum,.001),vec3(.8),vec3(1.2)),${role==='gravel'?'.08':'.14'});
        diffuseColor.rgb*=mix(${role==='gravel'?'vec3(.24,.24,.225),vec3(.86,.85,.80)':'vec3(.26,.25,.23),vec3(.65,.635,.605)'},mlk65Tone)*mlk65Tint;
        // Restore source dark/light separation without darkening pale stone tops.
        // This is albedo contrast, not a measurement of cavity occlusion.
        ${role==='gravel'?'diffuseColor.rgb *= mix(.38, 1., smoothstep(.16, .25, mlk65Lum));':''}
      #endif
      float mlk65Pixel=max(fwidth(mlkUv.x),fwidth(mlkUv.y));
      float mlk65NormalFade=1.-smoothstep(.012,.050,mlk65Pixel);
    `;
    shader.fragmentShader=shader.fragmentShader.replace(role==='gravel'?'#include <map_fragment>':oldConcreteMap,sample);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      #ifdef USE_MAP
        roughnessFactor=clamp(roughnessFactor*(1.+(.5-mlk65Tone)*.06),.90,1.);
      #endif`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`
      #ifdef USE_NORMALMAP_TANGENTSPACE
        vec3 mlk65Normal=texture2D(normalMap,vNormalMapUv).xyz*2.-1.;
        mlk65Normal.xy*=normalScale*mlk65NormalFade;
        normal=normalize(tbn*normalize(mlk65Normal));
      #endif`);
    shader.fragmentShader=marker+'\n'+shader.fragmentShader;
  };
  material.customProgramCacheKey=()=>`${key}-photo65-${role}-${role==='gravel'?'v2':'v1'}`;
}

function validate(texture:T.Texture,color:boolean,label:string){
  if(!texture?.isTexture||texture.colorSpace!==(color?T.SRGBColorSpace:T.NoColorSpace))throw Error(`MLK65 ${label} color space mismatch`);
  if(texture.wrapS!==T.RepeatWrapping||texture.wrapT!==T.RepeatWrapping||!texture.flipY||texture.channel!==0||texture.rotation!==0||texture.offset.lengthSq()!==0||texture.repeat.x!==1||texture.repeat.y!==1)
    throw Error(`MLK65 ${label} requires untransformed repeating UV0 / flipY`);
  const image=texture.image as {width?:number;height?:number}|undefined,size=color?1024:512;
  if(image?.width&&(image.width!==size||image.height!==size))throw Error(`MLK65 ${label} image dimensions changed`);
}

/** Apply immediately after buildMlkMall, before AO. Updates ONLY the existing
 * concrete/gravel materials; preserves all geometry, colliders, trees and cuts.
 * Existing floor UVs are world XZ/2, so one image tile spans its source's 2m.
 * The below-ground closing faces keep their inherited UVs and are not repaved.
 * Four caller-owned maps; no allocations, loaders or disposal in this helper. */
export function applyMlkSurfaces(meshes:readonly T.Mesh[],textures:MlkSurfaceTextures){
  for(const [label,t,color] of[
    ['gravel color',textures.gravelColor,true],['gravel normal',textures.gravelNormal,false],
    ['aggregate color',textures.aggregateColor,true],['aggregate normal',textures.aggregateNormal,false],
  ] as const)validate(t,color,label);
  const targets=new Map<T.MeshStandardMaterial,{role:Role;color:T.Texture;normal:T.Texture}>();
  for(const mesh of meshes){
    if(!mesh.name.startsWith('MLK East Mall '))throw Error(`MLK65 unexpected mesh ${mesh.name}`);
    const role=names[mesh.name];if(!role)continue;
    if(Array.isArray(mesh.material)||!(mesh.material instanceof T.MeshStandardMaterial)||mesh.material instanceof T.MeshPhysicalMaterial)throw Error('MLK65 expected original shared Standard material');
    const m=mesh.material,color=role==='gravel'?textures.gravelColor:textures.aggregateColor,normal=role==='gravel'?textures.gravelNormal:textures.aggregateNormal,old=applied.get(m);
    if(old){
      if(old.role!==role||old.color!==color||old.normal!==normal||m.map!==color||m.normalMap!==normal)throw Error('MLK65 existing binding differs');
    }else{
      if(m.customProgramCacheKey()!==(role==='gravel'?'mlk-pale-gravel-v1':'mlk-aggregate-v1'))throw Error('Apply MLK65 before unknown/AO material decoration');
      if(m.normalMap||m.roughnessMap||m.bumpMap||m.metalnessMap)throw Error('MLK65 conflicting existing maps');
      if(role==='gravel'&&m.map)throw Error('MLK65 unexpected gravel map');
    }
    const selected=targets.get(m);if(selected&&selected.role!==role)throw Error('MLK65 conflicting shared material role');
    targets.set(m,{role,color,normal});
  }
  // A selected material may not also be used by grass/furnishings.
  for(const mesh of meshes)if(!names[mesh.name])for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])
    if(targets.has(m as T.MeshStandardMaterial))throw Error('MLK65 material shared with another surface');
  const changed:string[]=[];
  for(const [m,binding]of targets){
    if(applied.has(m))continue;
    m.map=binding.color;m.normalMap=binding.normal;m.normalMapType=T.TangentSpaceNormalMap;
    m.normalScale.setScalar(binding.role==='gravel'?.16:.12);m.color.set(0xffffff);m.roughness=binding.role==='gravel'?.97:.94;
    configure(m,binding.role);m.needsUpdate=true;applied.set(m,binding);changed.push(binding.role);
  }
  return {materials:[...targets.keys()],changed,stats:{selectedMaterials:targets.size,newMaterials:0,newTextures:0,borrowedTextures:4,
    textureTileWidthMetres:2,concreteJointsPreserved:true,gravelProceduralLoopRemoved:true,geometryChanged:false,collisionChanged:false,treesChanged:false}};
}
