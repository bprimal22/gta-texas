import * as THREE from 'three';

/** Photo-informed finish for the existing Union shell. The courtyard photo
 * shows large, tightly jointed ashlar and smoother dressed surrounds. Course
 * dimensions below are visual estimates; no survey or displacement is implied.
 * Retains the material's ownership, color, geometry, UVs and render state. */
export function applyUnionStoneFinish(material: THREE.MeshStandardMaterial, mode: 'ashlar' | 'cut') {
  material.roughness = mode === 'ashlar' ? .88 : .82;
  material.onBeforeCompile = shader => {
    if (shader.vertexShader.includes('varying vec2 vUnionStoneMetres;')) return;
    for (const [stage, marker] of [
      ['vertexShader', '#include <uv_vertex>'],
      ['fragmentShader', '#include <color_fragment>'],
      ['fragmentShader', '#include <normal_fragment_maps>'],
      ['fragmentShader', '#include <roughnessmap_fragment>'],
    ] as const) {
      if (!shader[stage].includes(marker)) throw new Error(`Union stone shader is missing ${marker}`);
    }
    shader.vertexShader = 'varying vec2 vUnionStoneMetres;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>',
      '#include <uv_vertex>\nvUnionStoneMetres = uv;');
    shader.fragmentShader = `
      varying vec2 vUnionStoneMetres;
      float unionStoneHash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453);
      }
      float unionStoneNoise(vec2 p) {
        vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(unionStoneHash(i),unionStoneHash(i+vec2(1.,0.)),f.x),
                   mix(unionStoneHash(i+vec2(0.,1.)),unionStoneHash(i+vec2(1.,1.)),f.x),f.y);
      }
      vec3 unionStoneBump(vec3 p, vec3 n, float h, float face) {
        vec3 dx=dFdx(p),dy=dFdy(p),a=cross(dy,n),b=cross(n,dx);
        float det=dot(dx,a)*face;
        return normalize(abs(det)*n-sign(det)*(dFdx(h)*a+dFdy(h)*b));
      }
    ` + shader.fragmentShader;
    const joints = mode === 'ashlar' ? `
      // Four unequal courses, 0.42/0.49/0.39/0.50m, repeat over 1.80m.
      // Each row has an independently shifted 1.02..1.40m nominal block span.
      float unionStoneGroup=floor(unionStoneP.y/1.80);
      float unionStoneY=mod(unionStoneP.y,1.80);
      float unionStoneRow=0.,unionStoneLow=0.,unionStoneHigh=.42;
      if(unionStoneY>=.42){unionStoneRow=1.;unionStoneLow=.42;unionStoneHigh=.91;}
      if(unionStoneY>=.91){unionStoneRow=2.;unionStoneLow=.91;unionStoneHigh=1.30;}
      if(unionStoneY>=1.30){unionStoneRow=3.;unionStoneLow=1.30;unionStoneHigh=1.80;}
      unionStoneRow+=unionStoneGroup*4.;
      float unionStonePitch=1.02+.38*unionStoneHash(vec2(unionStoneRow,7.));
      float unionStoneX=unionStoneP.x+unionStonePitch*unionStoneHash(vec2(unionStoneRow,19.));
      float unionStoneCell=floor(unionStoneX/unionStonePitch);
      float unionStoneSeamDistance=100.,unionStoneBlock=unionStoneCell;
      // Jitter individual boundaries, preserving ordered, closed courses.
      for(int i=-1;i<=2;i++){
        float seam=unionStoneCell+float(i);
        float boundary=(seam+.28*(unionStoneHash(vec2(seam,unionStoneRow))-.5))*unionStonePitch;
        unionStoneSeamDistance=min(unionStoneSeamDistance,abs(unionStoneX-boundary));
        if(unionStoneX>=boundary)unionStoneBlock=seam;
      }
      float unionStoneEdge=min(unionStoneSeamDistance,min(unionStoneY-unionStoneLow,unionStoneHigh-unionStoneY));
      float unionStoneJoint=(1.-smoothstep(.0015,.0015+unionStonePixel,unionStoneEdge))
        *(1.-smoothstep(.035,.12,unionStonePixel));
      float unionStoneTone=unionStoneHash(vec2(unionStoneBlock,unionStoneRow))-.5;
    ` : `
      // Arch surrounds already have explicit stone geometry. Do not print
      // horizontal courses through voussoirs or invent tiny repeated bricks.
      float unionStoneJoint=0.,unionStoneTone=0.;
    `;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      vec2 unionStoneP=vUnionStoneMetres;
      float unionStonePixel=max(max(fwidth(unionStoneP.x),fwidth(unionStoneP.y)),.0001);
      ${joints}
      float unionStoneMineral=unionStoneNoise(unionStoneP*vec2(2.6,3.4))-.5;
      float unionStoneCloud=unionStoneNoise(unionStoneP*vec2(.53,.18))-.5;
      float unionStoneFine=(unionStoneNoise(unionStoneP*90.)-.5)
        *(1.-smoothstep(.002,.018,unionStonePixel));
      // Narrow joints and quiet mineral variation keep the broad pale face;
      // they are not AO, baked shadows, or a photo pasted over the geometry.
      diffuseColor.rgb*=1.+unionStoneTone*.048+unionStoneMineral*.035+unionStoneCloud*.035;
      diffuseColor.rgb*=1.-unionStoneJoint*.12;
      float unionStoneHeight=-unionStoneJoint*.0009+unionStoneMineral*.00020+unionStoneFine*.00012;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>',
      '#include <normal_fragment_maps>\nnormal=unionStoneBump(-vViewPosition,normal,unionStoneHeight,faceDirection);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor+unionStoneMineral*.035+unionStoneJoint*.045,.72,.98);');
  };
  material.customProgramCacheKey = () => `union-stone-${mode}-v2`;
  material.needsUpdate = true;
  return material;
}
