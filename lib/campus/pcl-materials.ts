import * as THREE from 'three';

// Code-native surface shading: dimensions are in metres, so mortar/formwork
// and vertical concrete ribbing retain their scale across the façade geometry.
// Colors and surface relief are reference-informed approximations, not scans.
function masonry(kind: 'concrete' | 'fluted' | 'brick') {
  const material = new THREE.MeshStandardMaterial({
    color: kind === 'brick' ? 0xad9271 : kind === 'fluted' ? 0x81837c : 0xb3b2a9,
    roughness: 0.94,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec2 vPclSurface;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>',
      '#include <uv_vertex>\nvPclSurface = uv;');
    shader.fragmentShader = `
      varying vec2 vPclSurface;
      float pclHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      vec3 pclRelief(vec3 p, vec3 n, float h, float face) {
        vec3 dx = dFdx(p), dy = dFdy(p);
        vec3 r1 = cross(dy,n), r2 = cross(n,dx);
        float det = dot(dx,r1) * face;
        vec3 gradient = sign(det) * (dFdx(h)*r1 + dFdy(h)*r2);
        return normalize(abs(det)*n-gradient);
      }
    ` + shader.fragmentShader;
    const surface = kind === 'brick' ? `
      // The parapet builder's existing UVs are one repeat per two metres.
      vec2 p = vPclSurface * 2.0;
      float row = floor(p.y / .076);
      vec2 cells = vec2(p.x / .22 + mod(row,2.0)*.5, p.y/.076);
      vec2 edge = min(fract(cells),1.0-fract(cells))*vec2(.22,.076);
      vec2 aa = max(fwidth(p),vec2(.0001));
      float brick = smoothstep(.003,.003+aa.x,edge.x)*smoothstep(.003,.003+aa.y,edge.y);
      float variation = pclHash(floor(cells));
      vec3 faceColor = diffuseColor.rgb * (.83 + variation*.27);
      diffuseColor.rgb = mix(vec3(.39,.365,.315),faceColor,brick);
      float pclHeight = brick*.002 + (pclHash(floor(p*330.0))-.5)*.00012;
    ` : `
      vec2 p = vPclSurface;
      vec2 panel = vec2(p.x/3.2+mod(floor(p.y/1.2),2.0)*.5,p.y/1.2);
      vec2 edge = min(fract(panel),1.0-fract(panel))*vec2(3.2,1.2);
      vec2 aa = max(fwidth(p),vec2(.0001));
      float joint = 1.0-smoothstep(.002,.002+max(aa.x,aa.y),min(edge.x,edge.y));
      float grain = pclHash(floor(p*260.0));
      float coarse = pclHash(floor(p*2.0));
      float ribs = sin(p.x*314.159265);
      float ribFade = 1.0-smoothstep(.003,.012,fwidth(p.x));
      diffuseColor.rgb *= (.97+coarse*.035) * (1.0-joint*.10) * (.985+grain*.025);
      float pclHeight = -joint*.0012 + ribs*${kind === 'fluted' ? '.0008' : '.00025'}*ribFade;
    `;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
      `#include <color_fragment>\n${surface}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>',
      '#include <normal_fragment_maps>\nnormal = pclRelief(-vViewPosition,normal,pclHeight,faceDirection);');
  };
  material.customProgramCacheKey = () => `pcl-${kind}-metres-v1`;
  return material;
}

export function pclMaterials() {
  return {
    concrete: masonry('concrete'),
    fluted: masonry('fluted'),
    brick: masonry('brick'),
    glass: new THREE.MeshStandardMaterial({
      color: 0x22313a, metalness: 0.48, roughness: 0.22, envMapIntensity: 1.25,
    }),
    frame: new THREE.MeshStandardMaterial({
      color: 0x3c4140, metalness: 0.65, roughness: 0.38,
    }),
    recess: new THREE.MeshStandardMaterial({ color: 0x454844, roughness: 1 }),
  };
}
