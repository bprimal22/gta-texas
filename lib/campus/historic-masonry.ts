import * as T from 'three';

/** Already-loaded local assets. Images/wrapping/lifetime remain caller-owned. */
export interface HistoricMasonryTextures {
  /** Existing brick-diff.jpg, sRGB, unmodified 1024px red_brick_03 image. */
  brickColor: T.Texture;
  /** Existing brick-normal.jpg, linear/no color space, OpenGL normals. */
  brickNormal: T.Texture;
  /** Existing main-east-limestone-color.jpg, sRGB, 2048px Tiles139 image. */
  stoneColor: T.Texture;
}
type Role = 'brick' | 'stone';
const roles: Readonly<Record<string, Role>> = {
  'Historic campus buff varied brick': 'brick',
  'Historic campus warm limestone': 'stone',
};
const selection = /^(EPS|BRB|JGB|WAG|GAR) Historic campus /;
const treated = new WeakMap<T.MeshStandardMaterial, {role: Role; color: T.Texture; normal: T.Texture | null}>();
const marker = '#define HISTORIC_MINERAL_64';
const helper = `
vec3 historicMineralRelief(vec3 p,vec3 n,float height,float face) {
  vec3 dx=dFdx(p),dy=dFdy(p),r1=cross(dy,n),r2=cross(n,dx);
  float det=dot(dx,r1)*face;
  vec3 gradient=sign(det)*(dFdx(height)*r1+dFdy(height)*r2);
  return abs(det)>1e-10 ? normalize(abs(det)*n-gradient) : n;
}
// Proven mortar-free interiors in the existing 1024px brick image. The photo's
// color and running-bond joints are not copied onto the historic buff bricks.
vec4 historicBrickPatch(float seed) {
  float k=floor(seed*6.0);
  if(k<1.)return vec4(112,24,160,38);
  if(k<2.)return vec4(319,28,157,34);
  if(k<3.)return vec4(529,27,150,33);
  if(k<4.)return vec4(723,24,145,39);
  if(k<5.)return vec4(228,105,154,34);
  return vec4(635,110,140,30);
}
`;

function decorate(material: T.MeshStandardMaterial, role: Role) {
  const previous = material.onBeforeCompile.bind(material), previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    if (shader.fragmentShader.includes(marker)) return;
    previous(shader, renderer);
    for (const anchor of ['#include <map_fragment>', '#include <roughnessmap_fragment>', '#include <normal_fragment_maps>'])
      if (!shader.fragmentShader.includes(anchor)) throw Error(`Historic mineral shader anchor missing: ${anchor}`);
    if (!shader.fragmentShader.includes('vHistoricMetres') || !shader.fragmentShader.includes('float mortar=') || !shader.fragmentShader.includes('float hcHash('))
      throw Error('Historic mineral treatment requires the original historic bond hook');
    shader.fragmentShader = `${marker}\n${helper}\n` + shader.fragmentShader;
    // StandardMaterial must not multiply the complete source image, including
    // its red tint and mortar, before our explicitly bounded patch sampling.
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
      '// Historic surface samples joint-free local mineral patches below.');
    const surface = role === 'brick' ? `
      vec2 hmP=vHistoricMetres,hmMetric=vec2(.235,.075);
      vec2 hmQ=hmP/hmMetric;hmQ.x+=mod(floor(hmQ.y),2.)*.5;
      vec2 hmCell=floor(hmQ),hmLocal=fract(hmQ);
      float hmPixel=max(max(fwidth(hmP.x),fwidth(hmP.y)),.00001);
      float hmFade=1.-smoothstep(.018,.070,hmPixel);
      // Reuse the original mortar coverage; never overlay a second bond grid.
      float hmBody=clamp(1.-mortar,0.,1.);
      float hmSeed=hcHash(hmCell+vec2(8.3,27.6));
      vec4 hmPatch=historicBrickPatch(hmSeed);
      vec2 hmPatchScale=hmPatch.zw/1024.;
      vec2 hmUv=vec2(hmPatch.x,1024.-hmPatch.y-hmPatch.w)/1024.+hmLocal*hmPatchScale;
      // Derivatives use continuous metre UVs; floor/fract discontinuities at
      // joints must not select an unrelated texture mip level.
      vec2 hmDx=dFdx(hmP)/hmMetric*hmPatchScale,hmDy=dFdy(hmP)/hmMetric*hmPatchScale;
      float hmIndex=floor(hmSeed*6.);
      float hmMedian=hmIndex<1.? .1084218072 : hmIndex<2.? .0976966132 : hmIndex<3.? .0624077388 :
        hmIndex<4.? .0655226981 : hmIndex<5.? .0865040926 : .0674861367;
      float hmLuminance=dot(textureGrad(map,hmUv,hmDx,hmDy).rgb,vec3(.2126,.7152,.0722));
      float hmMineral=clamp(hmLuminance/hmMedian,.70,1.30)-1.;
      // Luminance modulation preserves the source-independent buff base.
      // Mineral contrast is bounded to 5.4 percent before firing variation.
      float hmFiring=hcHash(hmCell+vec2(17.8,6.3))*2.-1.;
      // Reference-supported cream/buff/salmon firing variation around the
      // chosen mean palette. Symmetric multipliers keep firing tones balanced.
      vec3 hmChroma=vec3(1.)+hmFiring*vec3(.09,-.035,-.14)*hmBody*hmFade;
      diffuseColor.rgb*=hmChroma*(1.+hmMineral*.18*hmBody*hmFade);
      float hmHeight=(hmBody*.00030+hmMineral*.00018*hmBody)*hmFade;
      float hmRoughnessDelta=hmMineral*.10*hmBody*hmFade;
    ` : `
      vec2 hmP=vHistoricMetres;
      float hmPixel=max(max(fwidth(hmP.x),fwidth(hmP.y)),.00001);
      float hmFade=1.-smoothstep(.018,.070,hmPixel);
      float hmReliefFade=1.-smoothstep(.007,.028,hmPixel);
      // Existing Tiles139 inset: 280x280px, starting at (1054,30) image pixels.
      // Two continuous mirrored samples provide only mineral luminance. The
      // source's large square tile grid never becomes a limestone joint grid.
      vec2 hmMirror=1.-abs(fract(hmP/.546875)*2.-1.);
      vec2 hmUv=vec2(.5146484375,.8486328125)+hmMirror*.13671875;
      vec2 hmRotated=vec2(-hmP.y,hmP.x)*.70710678+vec2(.173,.391);
      vec2 hmMirror2=1.-abs(fract(hmRotated/.546875)*2.-1.);
      vec2 hmUv2=vec2(.5146484375,.8486328125)+hmMirror2*.13671875;
      vec3 hmSample=mix(textureGrad(map,hmUv,dFdx(hmUv),dFdy(hmUv)).rgb,
        textureGrad(map,hmUv2,dFdx(hmUv2),dFdy(hmUv2)).rgb,.35);
      float hmLuminance=dot(hmSample,vec3(.2126,.7152,.0722));
      float hmMineral=clamp(hmLuminance/.4071024629,.72,1.28)-1.;
      diffuseColor.rgb*=1.+hmMineral*.22*hmFade;
      float hmHeight=hmMineral*.00032*hmReliefFade;
      float hmRoughnessDelta=hmMineral*.12*hmFade;
    `;
    // This anchor follows the original color hook. Original palette/bond code
    // therefore stays byte-for-byte intact and executes before this treatment.
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>',
      `${surface}\n#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor+hmRoughnessDelta,.74,.96);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', role === 'brick' ? `
      #ifdef USE_NORMALMAP_TANGENTSPACE
        vec3 hmNormal=textureGrad(normalMap,hmUv,hmDx,hmDy).xyz*2.-1.;
        hmNormal.xy*=normalScale*hmBody*hmFade;
        normal=normalize(tbn*normalize(hmNormal));
      #endif
      normal=historicMineralRelief(-vViewPosition,normal,hmHeight,faceDirection);
    ` : `#include <normal_fragment_maps>
      normal=historicMineralRelief(-vViewPosition,normal,hmHeight,faceDirection);`);
  };
  material.customProgramCacheKey = () => `${previousKey}-mineral64-${role}-v2`;
}

function validateTexture(texture: T.Texture, label: string, colorSpace: T.ColorSpace, size: number) {
  if (!texture?.isTexture || texture.colorSpace !== colorSpace) throw Error(`Historic ${label} texture/color space mismatch`);
  if (texture.wrapS !== T.RepeatWrapping || texture.wrapT !== T.RepeatWrapping || !texture.flipY)
    throw Error(`Historic ${label} requires the existing repeating, flipY texture`);
  if(texture.channel!==0 || texture.rotation!==0 || texture.offset.lengthSq()!==0 || texture.repeat.x!==1 || texture.repeat.y!==1)
    throw Error(`Historic ${label} requires the existing untransformed UV0 texture`);
  // TextureLoader returns before decode completes. Validate dimensions if an
  // image is already available; exact local asset identity is caller-owned.
  const image=texture.image as {width?:number;height?:number}|undefined;
  if (image?.width && (image.width!==size || image.height!==size)) throw Error(`Historic ${label} image dimensions changed`);
}

/** Adds surface response to ONLY the two existing shared masonry materials.
 * Call after their factory and before AO. Leaves glazing63/roofs/frames alone.
 * The original bond, material identity, geometry, collisions and cuts survive.
 * Brick uses a photo-guided warm clay base; shared limestone stays unchanged.
 * Same-argument repeats preserve later AO wrapping; different
 * texture bindings are rejected rather than silently changing shared materials.
 * No loader, texture mutation, clone, material allocation or disposal. */
export function applyHistoricMasonry(meshes: readonly T.Mesh[], textures: HistoricMasonryTextures) {
  validateTexture(textures.brickColor,'brick color',T.SRGBColorSpace,1024);
  validateTexture(textures.brickNormal,'brick normal',T.NoColorSpace,1024);
  validateTexture(textures.stoneColor,'limestone color',T.SRGBColorSpace,2048);
  const all=new Set<T.Material>();
  for(const mesh of meshes) {
    if(!selection.test(mesh.name)) throw Error(`Unexpected historic masonry mesh: ${mesh.name}`);
    for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material]) all.add(m);
  }
  const selected:{material:T.MeshStandardMaterial;role:Role;color:T.Texture;normal:T.Texture|null}[]=[];
  for(const m of all) {
    const role=roles[m.name];if(!role)continue;
    if(!(m instanceof T.MeshStandardMaterial)||m instanceof T.MeshPhysicalMaterial)throw Error('Historic masonry expects existing Standard materials');
    const color=role==='brick'?textures.brickColor:textures.stoneColor,normal=role==='brick'?textures.brickNormal:null,old=treated.get(m);
    if(old) {
      if(old.role!==role||old.color!==color||old.normal!==normal)throw Error('Historic masonry already bound to different textures');
      if(m.map!==color||m.normalMap!==normal)throw Error('Historic masonry texture binding was changed outside its owner');
    } else {
      if(m.customProgramCacheKey()!==`historic-central-${role}-v1`)throw Error(`Apply historic masonry before unknown custom/AO decoration: ${m.name}`);
      if(m.map||m.normalMap||m.bumpMap||m.roughnessMap||m.metalnessMap)throw Error(`Historic masonry expected map-free factory material: ${m.name}`);
    }
    selected.push({material:m,role,color,normal});
  }
  const changed:string[]=[];
  for(const {material,role,color,normal} of selected) {
    if(treated.has(material))continue;
    material.map=color;material.normalMap=normal;
    if(role==='brick'){
      // Schoch L007 and GAR official references show buff/salmon masonry,
      // distinct from pale stone. The old #b39977 washed out under daylight.
      // This is a visual estimate, not a calibrated photograph color sample.
      material.color.set(0xad866a);
      material.normalMapType=T.TangentSpaceNormalMap;material.normalScale.set(.045,.045);
    }
    decorate(material,role);material.needsUpdate=true;
    treated.set(material,{role,color,normal});changed.push(material.name);
  }
  return {materials:selected.map(s=>s.material),changed,stats:{consideredMeshes:meshes.length,selectedMeshes:meshes.filter(mesh=>(Array.isArray(mesh.material)?mesh.material:[mesh.material]).some(m=>Boolean(roles[m.name]))).length,
    selectedMaterials:selected.length,changedMaterials:changed.length,newMaterials:0,newTextures:0,
    borrowedTextures:3,geometryChanged:false,collisionChanged:false,baseMaterialColorChanged:true,perBrickFiringVariation:true,
    originalBondPreserved:true,roofChanged:false,glazingChanged:false}};
}
