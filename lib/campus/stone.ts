import * as THREE from 'three';

// Low-amplitude, world-space limestone coursing avoids stretching one tile over
// an entire extruded building. This is a procedural stand-in for scanned stone.
export function limestone(normalMap: THREE.Texture) {
  const material = new THREE.MeshStandardMaterial({
    normalMap,
    normalScale: new THREE.Vector2(0.055, 0.055),
    color: 0xc9bba0,
    roughness: 0.9,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'varying vec3 vStoneWorld;\nvarying vec3 vStoneNormal;\n' +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
      vStoneWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vStoneNormal = normalize(mat3(modelMatrix) * objectNormal);
      #include <project_vertex>
    `,
    );
    shader.fragmentShader =
      `
      varying vec3 vStoneWorld;
      varying vec3 vStoneNormal;
      float stoneHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      vec3 p = vStoneWorld;
      vec2 campus = mat2(.99639,.08490,-.08490,.99639) * p.xz;
      vec2 wall = abs(vStoneNormal.z) > abs(vStoneNormal.x) ? vec2(campus.x,p.y) : vec2(campus.y,p.y);
      if(abs(vStoneNormal.y)>.7) wall=campus;
      float row = floor(wall.y / .58);
      vec2 block = vec2(wall.x / 1.28 + mod(row, 2.0) * .5, wall.y / .58);
      vec2 seam = min(fract(block), 1.0-fract(block));
      vec2 width = max(fwidth(block), vec2(.0001));
      vec2 joint = 1.0-smoothstep(vec2(.003),vec2(.003)+width,seam);
      float mortar = max(joint.x,joint.y);
      float grain = stoneHash(floor(wall * 45.0));
      float shade = .93 + stoneHash(floor(block)) * .1;
      diffuseColor.rgb *= shade * (1.0 - .15 * mortar) * (.975 + .025 * grain);
    `,
    );
  };
  material.customProgramCacheKey = () => 'campus-limestone-v1';
  return material;
}
