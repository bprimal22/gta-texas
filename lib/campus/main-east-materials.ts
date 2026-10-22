import * as THREE from 'three';

/** Material detail for the Main Building's east pavilion. The physical blocks
 * already define its joints; this adds only mineral grain and weathering.
 * Local surface coordinates are measured in metres, including the short returns.
 */
export function detailMainEastLimestone(material: THREE.MeshStandardMaterial, mineralTexture?: THREE.Texture) {
  material.roughness = .86;
  if(mineralTexture) material.map = mineralTexture;
  material.onBeforeCompile = shader => {
    shader.vertexShader = `varying vec3 vMainStonePoint;
      varying vec3 vMainStoneNormal;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      vMainStonePoint = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vMainStoneNormal = normalize(mat3(modelMatrix) * objectNormal);
      #include <project_vertex>
    `);
    shader.fragmentShader = `
      varying vec3 vMainStonePoint;
      varying vec3 vMainStoneNormal;
      float mainStoneHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float mainStoneNoise(vec2 p) {
        vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mainStoneHash(i),mainStoneHash(i+vec2(1.,0.)),f.x),
          mix(mainStoneHash(i+vec2(0.,1.)),mainStoneHash(i+vec2(1.,1.)),f.x),f.y);
      }
    ` + shader.fragmentShader;
    // Sample only the measured joint-free inset. The full source contains tile
    // seams, which must not overlay this facade's existing physical stone joints.
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '// Main east mineral map is sampled in facade metres below.');
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      // Rotate into the surveyed pavilion axes before selecting a face plane.
      vec2 mainXZ = mat2(-.083744416,.996487267,.996487267,.083744416) * vMainStonePoint.xz;
      vec2 mainN = mat2(-.083744416,.996487267,.996487267,.083744416) * vMainStoneNormal.xz;
      vec2 mainSurface = abs(mainN.y) > abs(mainN.x)
        ? vec2(mainXZ.x,vMainStonePoint.y) : vec2(mainXZ.y,vMainStonePoint.y);
      if(abs(vMainStoneNormal.y)>.7) mainSurface=mainXZ;
      float mainFootprint=max(max(fwidth(mainSurface.x),fwidth(mainSurface.y)),.00001);
      float mainFineFade=1.0-smoothstep(.002,.009,mainFootprint);
      float mainMineral=mainStoneNoise(mainSurface*2.7);
      float mainFine=mainStoneNoise(mainSurface*180.0)-.5;
      float mainStreak=mainStoneNoise(mainSurface*vec2(5.0,.43));
      diffuseColor.rgb *= .87 + .19*mainMineral + .07*mainStreak + .09*mainFine*mainFineFade;
      float mainStoneHeight=(mainFine*.00022*mainFineFade
        +(mainStoneNoise(mainSurface*18.0)-.5)*.0003)
        *(1.0-smoothstep(.008,.025,mainFootprint));
      #ifdef USE_MAP
        // Mirror the inset at its native 0.2734 m size. UVs remain continuous
        // at patch boundaries; no edited bitmap or incorrect mortar grid.
        vec2 mainMirror=1.0-abs(fract(mainSurface/.546875)*2.0-1.0);
        vec2 mainTextureUv=vec2(.5146484375,.8486328125)+mainMirror*.13671875;
        vec3 mainSample=textureGrad(map,mainTextureUv,dFdx(mainTextureUv),dFdy(mainTextureUv)).rgb;
        float mainSampleTone=dot(mainSample,vec3(.2126,.7152,.0722));
        // The provider color is warmer than the pavilion. Retain its mineral
        // contrast around the measured linear-luminance median, not its tint.
        diffuseColor.rgb *= mix(1.0,clamp(mainSampleTone/.4071024629,.65,1.35),.65);
        mainStoneHeight+=(mainSampleTone-.4071024629)*.0006
          *(1.0-smoothstep(.004,.016,mainFootprint));
      #endif
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      roughnessFactor=clamp(roughnessFactor+(mainMineral-.5)*.12,.72,.97);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      vec3 mainDx=dFdx(-vViewPosition), mainDy=dFdy(-vViewPosition);
      vec3 mainR1=cross(mainDy,normal), mainR2=cross(normal,mainDx);
      float mainDet=dot(mainDx,mainR1)*faceDirection;
      vec3 mainGradient=sign(mainDet)*(dFdx(mainStoneHeight)*mainR1+dFdy(mainStoneHeight)*mainR2);
      if(abs(mainDet)>1e-10) normal=normalize(abs(mainDet)*normal-mainGradient);
    `);
  };
  material.customProgramCacheKey = () => 'main-east-limestone-mineral-v2';
}
