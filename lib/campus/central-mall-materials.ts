import * as T from 'three';

/** East Mall only. Photo-informed values, to be compared in the existing daylight. */
export function calibrateEastMallMaterials(aggregate: T.MeshStandardMaterial, stone: T.MeshStandardMaterial) {
  // The references show warm gray/buff aggregate, not Speedway's golden brick.
  // Numeric hex colors enter Three.js as sRGB and are converted to linear light.
  aggregate.color.set(0xb7a58d);
  aggregate.roughness = .98;
  stone.color.set(0xc0b29a);
  stone.roughness = .96;

  for (const [material, masonry] of [[aggregate, false], [stone, true]] as const) {
    material.onBeforeCompile = shader => {
      // This material hook may be wrapped by other scene effects. Do not inject twice.
      if (shader.fragmentShader.includes('// EAST_MALL_MATERIAL_V3')) return;
      shader.vertexShader = 'varying vec2 mallUv;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nmallUv = uv * 2.0;');
      shader.fragmentShader = `// EAST_MALL_MATERIAL_V3
        varying vec2 mallUv;
        float mallHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float mallNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(mallHash(i), mallHash(i+vec2(1.,0.)), f.x),
            mix(mallHash(i+vec2(0.,1.)), mallHash(i+vec2(1.,1.)), f.x), f.y);
        }
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        float mallTone = .145;
        float mallRelief = 0.0;
        #ifdef USE_MAP
          vec4 mallSample = texture2D(map, vMapUv);
          // Keep mineral contrast while removing the source map's green/brown cast.
          // Source texture's measured linear-luminance median is .145.
          mallTone = dot(mallSample.rgb, vec3(.2126,.7152,.0722));
          diffuseColor.rgb *= ${masonry ? 'clamp(.90 + .23 * mallTone, .90, 1.04)' : 'clamp(.82 + 1.10 * (mallTone - .145), .68, 1.20)'};
          diffuseColor.a *= mallSample.a;
        #endif
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', masonry ? `#include <color_fragment>
        vec2 cell = vec2(mallUv.x/.72 + mod(floor(mallUv.y/.30),2.0)*.5, mallUv.y/.30);
        vec2 edge = min(fract(cell), 1.0-fract(cell))*vec2(.72,.30);
        float aa = max(max(fwidth(mallUv.x), fwidth(mallUv.y)), .0001);
        float joint = 1.0-smoothstep(.002, .002+aa, min(edge.x,edge.y));
        // Subtle per-block mineral changes; the softer limestone remains distinct.
        float mineral = .975 + .05*mallHash(floor(cell));
        diffuseColor.rgb *= mineral * (1.0-joint*.18);
        mallRelief = (mallTone-.145)*.0007;
      ` : `#include <color_fragment>
        float footprint = max(max(fwidth(mallUv.x), fwidth(mallUv.y)), .0001);
        // A small near-field mineral grain, plus slow weathering that survives
        // walking-distance mip filtering. Never expand distant grains into gravel.
        float grainFade = 1.0-smoothstep(.005, .016, footprint);
        float grain = mallNoise(mallUv*105.0)-.5;
        float weather = mallNoise(mallUv*.65)-.5;
        diffuseColor.rgb *= 1.0 + grain*.18*grainFade + weather*.09;
        vec2 slab = min(fract(mallUv/3.2),1.0-fract(mallUv/3.2))*3.2;
        float joint = 1.0-smoothstep(.0015,.0015+footprint,min(slab.x,slab.y));
        diffuseColor.rgb *= 1.0-joint*.16;
        // Millimetre-scale apparent relief: normal perturbation only, no displacement.
        mallRelief = ((mallTone-.145)*.005 + grain*.0010*grainFade)
          * (1.0-smoothstep(.008,.030,footprint));
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // Surface-gradient bump from the already sampled texture; no new texture
        // fetch, geometry, collider, shadow pass, or normal-map allocation.
        vec3 mallDx = dFdx(-vViewPosition), mallDy = dFdy(-vViewPosition);
        vec3 mallR1 = cross(mallDy, normal), mallR2 = cross(normal, mallDx);
        float mallDet = dot(mallDx, mallR1) * faceDirection;
        vec3 mallGradient = sign(mallDet) * (dFdx(mallRelief)*mallR1 + dFdy(mallRelief)*mallR2);
        if (abs(mallDet) > 1e-10) normal = normalize(abs(mallDet)*normal - mallGradient);
      `);
    };
    material.customProgramCacheKey = () => masonry ? 'east-mall-buff-limestone-v3' : 'east-mall-warm-aggregate-v3';
    material.needsUpdate = true;
  }
}
