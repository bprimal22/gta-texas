import * as THREE from 'three';

/** Borrowed, caller-owned assets. Color images must be sRGB; normals are linear.
 * No loader, texture mutation, geometry change, or texture disposal occurs here.
 */
export type GdcMasonryTextures = {
  brickColor?: THREE.Texture;
  brickNormal?: THREE.Texture;
  stoneColor?: THREE.Texture;
};

const helpers = `
varying vec2 vGdcMetres;
float gdcHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float gdcNoise(vec2 p) {
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(gdcHash(i),gdcHash(i+vec2(1,0)),f.x),
    mix(gdcHash(i+vec2(0,1)),gdcHash(i+vec2(1,1)),f.x),f.y);
}
vec3 gdcRelief(vec3 p,vec3 n,float h,float face) {
  vec3 dx=dFdx(p),dy=dFdy(p),r1=cross(dy,n),r2=cross(n,dx);
  float det=dot(dx,r1)*face;
  vec3 gradient=sign(det)*(dFdx(h)*r1+dFdy(h)*r2);
  return abs(det)>1e-10 ? normalize(abs(det)*n-gradient) : n;
}
// Six mortar-free, intact brick-face interiors in red_brick_03's 1024px map.
// Image pixels use top-left origin; texture coordinates below account for flipY.
// Retain only surface grain: the provider's running bond is never sampled.
vec4 gdcBrickPatch(float seed) {
  float k=floor(seed*6.0);
  if(k<1.0)return vec4(112,24,160,38);
  if(k<2.0)return vec4(319,28,157,34);
  if(k<3.0)return vec4(529,27,150,33);
  if(k<4.0)return vec4(723,24,145,39);
  if(k<5.0)return vec4(228,105,154,34);
  return vec4(635,110,140,30);
}
`;

/** Close masonry detail in the facade's existing metre UVs. Stack bond is
 * documented by the architect; brick/module/joint dimensions remain estimates.
 */
export function createGdcMasonry(kind: 'brick' | 'stone', textures: GdcMasonryTextures = {}) {
  const brick=kind==='brick';
  const material=new THREE.MeshStandardMaterial({
    // Keep the current base palette; the change is surface response and detail.
    color:brick?0xb58460:0xc8bfae,roughness:brick?.88:.81,
    map:(brick?textures.brickColor:textures.stoneColor)??null,
    normalMap:brick?(textures.brickNormal??null):null,
    normalScale:new THREE.Vector2(.065,.065),
  });
  material.name=brick?'GDC varied stack-bond brick':'GDC pale cut stone';
  material.onBeforeCompile=shader=>{
    for(const anchor of ['#include <color_fragment>','#include <map_fragment>',
      '#include <roughnessmap_fragment>','#include <normal_fragment_maps>'])
      if(!shader.fragmentShader.includes(anchor))throw new Error('GDC masonry shader anchor missing: '+anchor);
    if(!shader.vertexShader.includes('#include <uv_vertex>'))throw new Error('GDC masonry UV anchor missing');
    shader.vertexShader='varying vec2 vGdcMetres;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>',
      '#include <uv_vertex>\nvGdcMetres=uv;');
    shader.fragmentShader=helpers+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',
      '// GDC texture patches are sampled below in physical masonry coordinates.');
    const surface=brick?`
      vec2 p=vGdcMetres,metric=vec2(.226,.076),cell=floor(p/metric);
      vec2 q=fract(p/metric),edge=min(q,1.0-q)*metric;
      vec2 footprint=max(fwidth(p),vec2(.00001));
      float pixel=max(footprint.x,footprint.y);
      // Approximately 6 mm mortar opening with a 1.5 mm rounded arris.
      // Filtered coverage converges to its area average, not a distant grid.
      vec2 coverage=smoothstep(vec2(.003)-footprint*.5,
        vec2(.0045)+footprint*.5,edge);
      float nearBody=coverage.x*coverage.y;
      float jointFade=1.0-smoothstep(.018,.070,pixel);
      float body=mix(.87139,nearBody,jointFade);
      float detailFade=1.0-smoothstep(.018,.09,pixel);
      float seed=gdcHash(cell),tone=gdcHash(cell+vec2(17.8,6.3));
      vec3 firing=mix(vec3(.91,1.035,1.085),vec3(1.08,.98,.92),tone);
      vec3 faceColor=diffuseColor.rgb*mix(vec3(1),firing*(.84+seed*.32),detailFade);
      vec4 brickPatch=gdcBrickPatch(gdcHash(cell+vec2(8.3,27.6)));
      vec2 patchScale=vec2(brickPatch.z,brickPatch.w)/1024.0;
      vec2 patchUv=vec2(brickPatch.x,1024.0-brickPatch.y-brickPatch.w)/1024.0+q*patchScale;
      vec2 patchDx=dFdx(p)/metric*patchScale,patchDy=dFdy(p)/metric*patchScale;
      float surfaceTone=.5;
      #ifdef USE_MAP
        // The old red-brick image supplies luminance texture, not GDC's color.
        // Individual patch medians are normalized so color variation is deliberate.
        float patchIndex=floor(gdcHash(cell+vec2(8.3,27.6))*6.0);
        float median=patchIndex<1.0?0.1084218072:patchIndex<2.0?0.0976966132:patchIndex<3.0?0.0624077388:
          patchIndex<4.0?0.0655226981:patchIndex<5.0?0.0865040926:0.0674861367;
        float sampleTone=dot(textureGrad(map,patchUv,patchDx,patchDy).rgb,vec3(.2126,.7152,.0722));
        surfaceTone=clamp(sampleTone/median,.65,1.35)-.5;
        faceColor*=mix(1.0,clamp(sampleTone/median,.50,1.50),.26*detailFade);
      #else
        surfaceTone=gdcNoise(p*vec2(58,130));
        faceColor*=1.0+(surfaceTone-.5)*.06*detailFade;
      #endif
      vec3 mortar=mix(diffuseColor.rgb,vec3(.38,.31,.23),.55);
      diffuseColor.rgb=mix(mortar,faceColor,body);
      // Recessed, shallow relief. Real geometric ribs and chamfers remain intact.
      float gdcHeight=nearBody*.00065*jointFade;
      float gdcRoughness=clamp(.88+(surfaceTone-.5)*.14*detailFade+(1.0-body)*.07,.76,.97);
    `:`
      vec2 p=vGdcMetres,metric=vec2(1.16,.58),cell=floor(p/metric);
      vec2 edge=min(fract(p/metric),1.0-fract(p/metric))*metric;
      vec2 footprint=max(fwidth(p),vec2(.00001));
      float pixel=max(footprint.x,footprint.y);
      float joint=(1.0-smoothstep(.0014-pixel*.5,.0026+pixel*.5,min(edge.x,edge.y)))
        *(1.0-smoothstep(.018,.060,pixel));
      float cloud=gdcNoise(p*vec2(2.3,4.1));
      float mineral=cloud-.5;
      #ifdef USE_MAP
        // Existing Tiles139 joint-free inset, 280x280px / 0.2734375 m.
        // Mirroring keeps patch seams continuous. Only mineral luminance is used.
        vec2 mirrored=1.0-abs(fract(p/.546875)*2.0-1.0);
        vec2 stoneUv=vec2(.5146484375,.8486328125)+mirrored*.13671875;
        vec2 rotated=vec2(-p.y,p.x)*.70710678+vec2(.173,.391);
        vec2 secondMirror=1.0-abs(fract(rotated/.546875)*2.0-1.0);
        vec2 secondUv=vec2(.5146484375,.8486328125)+secondMirror*.13671875;
        vec3 stoneSample=mix(textureGrad(map,stoneUv,dFdx(stoneUv),dFdy(stoneUv)).rgb,
          textureGrad(map,secondUv,dFdx(secondUv),dFdy(secondUv)).rgb,.38);
        float sampleTone=dot(stoneSample,vec3(.2126,.7152,.0722));
        mineral=(clamp(sampleTone/.4071024629,.72,1.28)-1.0)
          *(1.0-smoothstep(.018,.070,pixel));
      #endif
      float fineFade=1.0-smoothstep(.007,.028,pixel);
      float panelTone=(gdcHash(cell)-.5)*.032;
      diffuseColor.rgb*=(1.0+panelTone+mineral*.43+(.5-cloud)*.016)*(1.0-joint*.052);
      // Clean cast stone in the photos: pore-scale dirt/relief, no invented
      // streaks, black seams, chipped edges, or global grime overlay.
      float gdcHeight=-joint*.0009+mineral*.00032*fineFade;
      float gdcRoughness=clamp(.83+mineral*.12+joint*.08,.76,.95);
    `;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\n'+surface);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\nroughnessFactor=gdcRoughness;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',brick?`
      #ifdef USE_NORMALMAP_TANGENTSPACE
        vec3 brickNormal=textureGrad(normalMap,patchUv,patchDx,patchDy).xyz*2.0-1.0;
        brickNormal.xy*=normalScale*nearBody*detailFade;
        // Both patch axes increase with metre UVs; the stored image is flipY.
        // OpenGL tangent normals therefore use the existing UV basis unchanged.
        normal=normalize(tbn*normalize(brickNormal));
      #endif
      normal=gdcRelief(-vViewPosition,normal,gdcHeight,faceDirection);
    `:`#include <normal_fragment_maps>
      normal=gdcRelief(-vViewPosition,normal,gdcHeight,faceDirection);`);
  };
  material.customProgramCacheKey=()=>brick?'gdc-brick-surface-v59':'gdc-stone-surface-v59';
  return material;
}
