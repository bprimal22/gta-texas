import * as THREE from 'three';

/** GDC-only glazing. The depth cue is a shallow, generic shaded room box, not
 * a photographed interior or a navigable room. Real mullions remain geometry.
 * The exterior sky reflection still comes from the scene's physical lighting.
 */
export function createGdcGlazing(name: string, options: { skyReflection?: number } = {}) {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x647575, roughness: .085, metalness: 0, ior: 1.52,
    // Faint green-grey float-glass tint on the reflected sky, not blue paint.
    specularColor: 0xdfe9e6, clearcoat: 0, envMapIntensity: 1.65,
  });
  material.name = name;
  // Reflection strength when the glass samples the scene's sky PMREM. Three
  // r185 otherwise substitutes scene.environmentIntensity (the game uses .25
  // for diffuse sky light), which left every pane a flat dark navy. An
  // explicit envMap (e.g. the Speedway local capture) keeps its own intensity.
  const skyReflection = options.skyReflection ?? 1.35;
  if (!Number.isFinite(skyReflection) || skyReflection < 0 || skyReflection > 4)
    throw new Error('Invalid GDC glazing sky reflection');
  const skyGain = { value: 1 };
  material.userData.gdcSkyReflection = skyReflection;
  material.onBeforeRender = (_renderer, scene) => {
    const environment = (scene as THREE.Scene).environment;
    const ambient = (scene as THREE.Scene).environmentIntensity ?? 1;
    skyGain.value = !material.envMap && environment && ambient > .001 ? skyReflection / ambient : 1;
  };
  material.onBeforeCompile = shader => {
    shader.uniforms.gdcSkyGain = skyGain;
    shader.vertexShader = `
      attribute vec2 gdcWindowUV;
      attribute vec2 gdcWindowSize;
      attribute vec3 gdcWindowAxis;
      attribute vec3 gdcWindowOut;
      attribute float gdcWindowSeed;
      varying vec2 vGdcWindowUV;
      varying vec2 vGdcWindowSize;
      varying vec3 vGdcWindowEye;
      varying float vGdcWindowSeed;
    ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      #include <project_vertex>
      vec3 gdcEye = cameraPosition - (modelMatrix * vec4(transformed, 1.0)).xyz;
      vGdcWindowUV = gdcWindowUV;
      vGdcWindowSize = gdcWindowSize;
      vGdcWindowSeed = gdcWindowSeed;
      vGdcWindowEye = vec3(dot(gdcEye, gdcWindowAxis), gdcEye.y, dot(gdcEye, gdcWindowOut));
    `);
    shader.fragmentShader = `
      uniform float gdcSkyGain;
      varying vec2 vGdcWindowUV;
      varying vec2 vGdcWindowSize;
      varying vec3 vGdcWindowEye;
      varying float vGdcWindowSeed;
      float gdcGlassHash(float p) { return fract(sin(p * 127.13) * 43758.5453); }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      // Project the eye ray through this particular field into an enclosed box.
      // Ceilings and jambs slide with the eye, unlike a painted dark rectangle.
      vec2 gdcSize = max(vGdcWindowSize, vec2(.05));
      vec2 gdcRoomXY = (vGdcWindowUV - .5) * gdcSize;
      vec3 gdcView = normalize(vGdcWindowEye);
      vec3 gdcRay = vec3(-gdcView.xy, -max(abs(gdcView.z), .04));
      vec2 gdcWallLimit = mix(-.5 * gdcSize, .5 * gdcSize, step(vec2(0.0), gdcRay.xy));
      vec2 gdcSafeXY = sign(gdcRay.xy + vec2(.0000001)) * max(abs(gdcRay.xy), vec2(.0001));
      vec2 gdcSideT = max((gdcWallLimit - gdcRoomXY) / gdcSafeXY, vec2(.0));
      float gdcSeed = gdcGlassHash(vGdcWindowSeed);
      float gdcDepth = 1.2 + gdcSeed * .7;
      float gdcBackT = -gdcDepth / gdcRay.z;
      float gdcT = min(gdcBackT, min(gdcSideT.x, gdcSideT.y));
      vec3 gdcHit = vec3(gdcRoomXY, 0.0) + gdcRay * gdcT;
      float gdcSide = 1.0 - step(gdcBackT - .001, gdcT);
      float gdcCeiling = gdcSide * step(gdcSideT.y, gdcSideT.x) * step(0.0, gdcRay.y);
      float gdcFloor = gdcSide * step(gdcSideT.y, gdcSideT.x) * step(gdcRay.y, 0.0);
      // No exterior diffuse sun on the shaded interior. These linear levels
      // approximate dark rooms and softly lit ceilings visible in STG photos.
      float gdcTone = gdcGlassHash(vGdcWindowSeed + 9.7);
      vec3 gdcInterior = mix(vec3(.022,.027,.027), vec3(.060,.060,.052), gdcTone * gdcTone);
      gdcInterior *= mix(1.0, .65, gdcSide);
      // About a quarter of rooms show a lit, pale ceiling plane and a brighter
      // rear wall; the rest stay dim. Varies per field, never per facade.
      float gdcLit = step(.74, gdcGlassHash(vGdcWindowSeed + 2.3));
      vec3 gdcCeilingTone = mix(vec3(.115,.116,.101), vec3(.34,.33,.29), gdcLit);
      gdcInterior = mix(gdcInterior, gdcCeilingTone, gdcCeiling * .85);
      gdcInterior += gdcLit * (1.0 - gdcSide) * vec3(.035,.034,.029);
      // Low furniture/partition silhouettes on the rear plane.
      float gdcRearX = gdcHit.x / max(gdcSize.x, .05) * 3.0 + vGdcWindowSeed;
      float gdcPartition = step(.55, gdcGlassHash(floor(gdcRearX))) * step(gdcHit.y, -.5 * gdcSize.y + .9 + gdcGlassHash(floor(gdcRearX) + 1.7) * .5);
      gdcInterior *= 1.0 - .45 * gdcPartition * (1.0 - gdcSide);
      gdcInterior = mix(gdcInterior, vec3(.016,.020,.019), gdcFloor);
      float gdcRearShadow = smoothstep(-gdcDepth, -.05, gdcHit.z);
      gdcInterior *= .7 + .3 * gdcRearShadow;
      // A minority of fields have pale blinds at varying heights, as in the
      // courtyard photos. Their slats fade out before becoming pixel noise.
      float gdcBlindBottom = .67 + gdcGlassHash(vGdcWindowSeed + 4.1) * .22;
      float gdcBlind = step(.69, gdcSeed) * smoothstep(gdcBlindBottom - .006, gdcBlindBottom + .006, vGdcWindowUV.y);
      float gdcSlatY = vGdcWindowUV.y * gdcSize.y / .035;
      float gdcSlatFade = 1.0 - smoothstep(.25, .75, fwidth(gdcSlatY));
      float gdcSlat = .82 + .18 * smoothstep(.12, .24, fract(gdcSlatY)) * gdcSlatFade;
      gdcInterior = mix(gdcInterior, vec3(.12,.119,.101) * gdcSlat, gdcBlind);
      diffuseColor.rgb = gdcInterior;
    `);
    if (!shader.fragmentShader.includes('#include <lights_fragment_maps>'))
      throw new Error('GDC glazing requires the Three IBL shader chunk');
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_maps>', `
      #include <lights_fragment_maps>
      radiance *= gdcSkyGain;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      // Keep the ordinary physical specular response, but avoid treating the
      // unseen interior as an opaque painted wall lit by exterior direct sun.
      float gdcFacing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
      float gdcFresnel = .04 + .96 * pow(1.0 - gdcFacing, 5.0);
      outgoingLight = gdcInterior * (1.0 - gdcFresnel) + totalSpecular;
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => 'gdc-recessed-glazing-v2';
  return material;
}

/** Attach per-field dimensions before applying the facade's campus matrix.
 * This changes only shading attributes, never vertex positions or colliders.
 * x: west facade local horizontal; z: atrium cross-courtyard local horizontal.
 */
export function annotateGdcGlazing(geometry: THREE.BufferGeometry,
  horizontal: 'x' | 'z', axis: THREE.Vector3, outward: THREE.Vector3, seed: number,
  subdivisions = 1) {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!, p = geometry.attributes.position;
  const lo = horizontal === 'x' ? bounds.min.x : bounds.min.z;
  const fullWidth = (horizontal === 'x' ? bounds.max.x : bounds.max.z) - lo;
  const sizeY = bounds.max.y - bounds.min.y;
  // For continuous atrium glazing, retain a coherent room behind each framed
  // group instead of creating discontinuities through one unsplit triangle.
  const roomWidth = fullWidth / Math.max(1, subdivisions);
  const uv = new Float32Array(p.count * 2), size = new Float32Array(p.count * 2);
  const axes = new Float32Array(p.count * 3), outs = new Float32Array(p.count * 3);
  const seeds = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const h = horizontal === 'x' ? p.getX(i) : p.getZ(i);
    uv.set([(h - lo) / fullWidth, (p.getY(i) - bounds.min.y) / sizeY], i * 2);
    size.set([roomWidth, sizeY], i * 2);
    axes.set(axis.toArray(), i * 3); outs.set(outward.toArray(), i * 3); seeds[i] = seed;
  }
  geometry.setAttribute('gdcWindowUV', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('gdcWindowSize', new THREE.BufferAttribute(size, 2));
  geometry.setAttribute('gdcWindowAxis', new THREE.BufferAttribute(axes, 3));
  geometry.setAttribute('gdcWindowOut', new THREE.BufferAttribute(outs, 3));
  geometry.setAttribute('gdcWindowSeed', new THREE.BufferAttribute(seeds, 1));
}
