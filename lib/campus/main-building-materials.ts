import * as T from 'three';

export interface MainMaterialOptions {
  region: 'base' | 'east' | 'envelope';
  /** The existing Tiles139 sRGB color image; borrowed without mutation. */
  limestoneTexture?: T.Texture;
  /** Existing scene sky PMREM. This function never captures or owns it. */
  glassEnvironment?: T.Texture | null;
}
type Role='field'|'dress'|'aged'|'upper'|'tile'|'glass';
const treated=new WeakMap<T.MeshStandardMaterial,{region:MainMaterialOptions['region'];role:Role;texture?:T.Texture}>();
const palette:Partial<Record<Role,number>>={field:0xb7ad98,dress:0xbfb49d,aged:0xaba18c,upper:0xaa8973,tile:0x815742};
const names:Record<MainMaterialOptions['region'],Record<string,Role>>={
 base:{'Main Building warm limestone':'field','Main Building pale stone blocks':'dress','Main Building weathered stone blocks':'aged','Main Building bronze dark glazing':'glass'},
 east:{'Main east limestone':'field','Main east pale limestone':'dress','Main east weathered blocks':'aged'},
 envelope:{'Main Building warm limestone':'field','Main Building pale stone blocks':'dress','Main Building bronze dark glazing':'glass','MAI envelope salmon clerestory panels':'upper','MAI envelope terracotta roof':'tile'},
};
const header=`
varying vec3 vMaiSurfacePoint;
varying vec3 vMaiSurfaceNormal;
float maiHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float maiNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(maiHash(i),maiHash(i+vec2(1.,0.)),f.x),mix(maiHash(i+vec2(0.,1.)),maiHash(i+vec2(1.,1.)),f.x),f.y);}

`;
const metric=`
 // Official Main footprint axes, in metres. BoxGeometry UVs are deliberately
 // not reused: they span 0..1 regardless of actual wall size.
 vec2 maiXZ=vMaiSurfacePoint.xz-vec2(-237.0937333403,34.9761845561);
 vec2 maiPlan=vec2(dot(maiXZ,vec2(.9964761528,.0838765574)),dot(maiXZ,vec2(-.0838765574,.9964761528)));
 vec2 maiN=vec2(dot(vMaiSurfaceNormal.xz,vec2(.9964761528,.0838765574)),dot(vMaiSurfaceNormal.xz,vec2(-.0838765574,.9964761528)));
 vec2 maiP=abs(maiN.x)>abs(maiN.y)?vec2(maiPlan.y,vMaiSurfacePoint.y):vec2(maiPlan.x,vMaiSurfacePoint.y);
 if(abs(vMaiSurfaceNormal.y)>.7)maiP=maiPlan;
 float maiPixel=max(max(fwidth(maiP.x),fwidth(maiP.y)),.00001);
 float maiFineFade=1.-smoothstep(.006,.024,maiPixel);
 float maiMidFade=1.-smoothstep(.06,.22,maiPixel);
`;
function prepareShader(material:T.MeshStandardMaterial,role:Role,region:MainMaterialOptions['region']){
 material.onBeforeCompile=shader=>{
  for(const anchor of ['#include <project_vertex>'])if(!shader.vertexShader.includes(anchor))throw Error('Main material missing vertex anchor '+anchor);
  for(const anchor of ['#include <color_fragment>','#include <map_fragment>','#include <roughnessmap_fragment>','#include <normal_fragment_maps>','#include <opaque_fragment>'])if(!shader.fragmentShader.includes(anchor))throw Error('Main material missing fragment anchor '+anchor);
  shader.vertexShader='varying vec3 vMaiSurfacePoint;\nvarying vec3 vMaiSurfaceNormal;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`
    vMaiSurfacePoint=(modelMatrix*vec4(transformed,1.)).xyz;
    vMaiSurfaceNormal=normalize(mat3(modelMatrix)*objectNormal);
    #include <project_vertex>
  `);
  shader.fragmentShader=header+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','// Main samples a joint-free mineral inset in world metres below.');
  if(role==='glass'){
   shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>\n${metric}
    float maiRoom=maiNoise(maiP/vec2(1.8,1.2))*2.-1.;
    vec3 maiInterior=vec3(.0096,.0102,.0100)*(1.+maiRoom*.16*maiMidFade);
   `);
   shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
    // StandardMaterial already uses Three's dielectric F0=0.04 and GGX specular.
    // Replace exterior diffuse sun on the opaque interior proxy, not reflections.
    float maiFacing=clamp(dot(normal,normalize(vViewPosition)),0.,1.);
    vec3 maiFresnel=F_Schlick(material.specularColor,material.specularF90,maiFacing);
    outgoingLight=totalSpecular+maiInterior*(vec3(1.)-maiFresnel);
    #include <opaque_fragment>
   `);
  }else{
   const stoneModule=region==='base'?'vec2(1.25,.43)':region==='east'?'vec2(1.28,.51)':'vec2(1.20,.56)';
   const surface=role==='tile'?`${metric}
    // Shallow barrel-tile light response, not geometry displacement. Tile rows
    // follow each hip's downslope axis; module dimensions are photographic estimates.
    vec2 maiRoof=abs(maiN.x)>abs(maiN.y)?maiPlan.yx:maiPlan.xy;
    vec2 maiRoofMetric=vec2(.18,.34),maiRoofCell=floor(maiRoof/maiRoofMetric);
    vec2 maiRoofQ=fract(maiRoof/maiRoofMetric);
    float maiTileFade=1.-smoothstep(.018,.085,maiPixel);
    float maiTileTone=(maiHash(maiRoofCell)-.5)*.17*maiTileFade;
    float maiBarrel=sin(maiRoofQ.x*3.14159265);
    float maiLap=(1.-smoothstep(.01,.03,maiRoofQ.y*.34))*maiTileFade;
    diffuseColor.rgb*=1.+maiTileTone+(maiBarrel-.5)*.055*maiTileFade-maiLap*.065;
    float maiHeight=(maiBarrel*.0014-maiLap*.0004)*maiTileFade;
    float maiRoughness=clamp(.9+maiTileTone*.3,.80,.96);
   `:`${metric}
    // Existing modeled rustication supplies the joints and distinct block colors.
    // Continuous broad mineral tone avoids seams across those physical blocks.
    vec2 maiModule=${stoneModule};
    float maiStoneTone=(maiNoise(maiP/maiModule)-.5)*${role==='dress'?'.018':'.070'}*maiMidFade;
    float maiCloud=maiNoise(maiP*vec2(1.9,2.7))-.5;
    float maiGrain=maiNoise(maiP*vec2(74.,96.))-.5;
    float maiMineral=maiCloud*.09;
    #ifdef USE_MAP
     // Exact existing Tiles139 280x280px inset: 0.2734375 m at provider scale.
     // Two continuous mirrored samples reduce the obvious reflected-repeat pattern.
     vec2 maiMirror=1.-abs(fract(maiP/.546875)*2.-1.);
     vec2 maiUv=vec2(.5146484375,.8486328125)+maiMirror*.13671875;
     vec2 maiRotated=vec2(-maiP.y,maiP.x)*.70710678+vec2(.173,.391);
     vec2 maiMirror2=1.-abs(fract(maiRotated/.546875)*2.-1.);
     vec2 maiUv2=vec2(.5146484375,.8486328125)+maiMirror2*.13671875;
     vec3 maiSample=mix(textureGrad(map,maiUv,dFdx(maiUv),dFdy(maiUv)).rgb,textureGrad(map,maiUv2,dFdx(maiUv2),dFdy(maiUv2)).rgb,.35);
     float maiLuminance=dot(maiSample,vec3(.2126,.7152,.0722));
     maiMineral=(clamp(maiLuminance/.4071024629,.65,1.35)-1.)*(1.-smoothstep(.004,.016,maiPixel));
    #endif
    // The references show clean dressed cream limestone with restrained mineral
    // contrast; no invented broad dirt streaks, chips or algae are added.
    diffuseColor.rgb*=1.+maiStoneTone+maiMineral*${role==='dress'?'.30':'.46'}+maiCloud*.025+maiGrain*.018*maiFineFade;
    float maiHeight=(maiMineral*.00048+maiGrain*.00014)*maiFineFade;
    float maiRoughness=clamp(${role==='dress'?'.79':'.86'}+maiMineral*.16+maiGrain*.045*maiFineFade,.71,.96);
   `;
   shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n'+surface);
   shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=maiRoughness;');
   shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
    vec3 maiDx=dFdx(-vViewPosition),maiDy=dFdy(-vViewPosition),maiR1=cross(maiDy,normal),maiR2=cross(normal,maiDx);
    float maiDet=dot(maiDx,maiR1)*faceDirection;
    vec3 maiGradient=sign(maiDet)*(dFdx(maiHeight)*maiR1+dFdy(maiHeight)*maiR2);
    if(abs(maiDet)>1e-10)normal=normalize(abs(maiDet)*normal-maiGradient);
   `);
  }
 };
 material.customProgramCacheKey=()=>`mai-surface-62-${region}-${role}-v1`;
}

/** Main-only in-place treatment, called after factory/clone creation and BEFORE
 * ambient-occlusion hook decoration. No geometry, material allocation, texture
 * loading, disposal or world mutation occurs. Caller keeps every lifetime.
 */
export function applyMainBuildingMaterials(meshes:readonly T.Mesh[],options:MainMaterialOptions){
 if(options.limestoneTexture&&options.limestoneTexture.colorSpace!==T.SRGBColorSpace)throw Error('Main limestone requires the existing sRGB color texture');
 const all=new Set<T.Material>();for(const mesh of meshes){if(!mesh.name.startsWith('MAI '))throw Error('Main treatment requires explicit MAI meshes only');for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])all.add(m);}
 // Validate the whole explicit selection before changing its first material.
 for(const m of all){const role=names[options.region][m.name];if(!role)continue;
  if(!(m instanceof T.MeshStandardMaterial))throw Error('Main treatment requires Standard/Physical material');
  const previous=treated.get(m);
  if(previous&&(previous.region!==options.region||previous.role!==role||previous.texture!==options.limestoneTexture))throw Error('Main material instance cannot be shared across differently configured regions');
  if(!previous&&m.onBeforeCompile!==T.Material.prototype.onBeforeCompile&&m.customProgramCacheKey()!=='main-east-limestone-mineral-v2')throw Error('Attach Main treatment before custom/AO decoration: '+m.name);
 }
 const changed:string[]=[],glass:T.MeshStandardMaterial[]=[],skipped:string[]=[];
 for(const m of all){const role=names[options.region][m.name];if(!role){skipped.push(m.name);continue;}if(!(m instanceof T.MeshStandardMaterial))throw Error('Main treatment requires Standard/Physical material');
  const previous=treated.get(m);
  if(previous){if(previous.region!==options.region||previous.role!==role||previous.texture!==options.limestoneTexture)throw Error('Main material instance cannot be shared across differently configured regions');if(role==='glass'){if(options.glassEnvironment!==undefined&&m.envMap!==options.glassEnvironment){m.envMap=options.glassEnvironment;m.needsUpdate=true;}glass.push(m);}continue;}
  const oldKey=m.customProgramCacheKey();
  if(m.onBeforeCompile!==T.Material.prototype.onBeforeCompile&&oldKey!=='main-east-limestone-mineral-v2')throw Error('Attach Main treatment before custom/AO decoration: '+m.name);
  if(role==='glass'){
   m.color.set(0xffffff);m.metalness=0;m.roughness=.14;m.envMapIntensity=1.1;
   m.transparent=false;m.opacity=1;m.depthWrite=true;
   if(options.glassEnvironment!==undefined)m.envMap=options.glassEnvironment;
   glass.push(m);
  }else{
   m.color.set(palette[role]!);m.roughness=role==='dress'?.79:role==='tile'?.9:.86;
   m.metalness=0;if(role!=='tile')m.map=options.limestoneTexture??null;
  }
  prepareShader(m,role,options.region);m.needsUpdate=true;treated.set(m,{region:options.region,role,texture:options.limestoneTexture});changed.push(m.name);
 }
 return{changed,skipped,glass,stats:{region:options.region,changedMaterials:changed.length,glassMaterials:glass.length,newMaterials:0,newTextures:0,geometryChanged:false,usesBorrowedMineralTexture:!!options.limestoneTexture}};
}
